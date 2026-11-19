"""Charging logic for a wallbox driven by the sonnenBatterie (no Home Assistant imports).

Pure decision code: the charge manager feeds it one measurement every few seconds and
sends whatever it returns to the wallbox. Kept free of HA so it can be tested with
simulated days.

Conventions (sonnen API v2 /api/v2/status):
  GridFeedIn_W  + = feeding into the grid, - = drawing from the grid
  Pac_total_W   + = battery discharging,   - = battery charging
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from enum import StrEnum

VOLTAGE = 230.0
MIN_AMPS = 6
MAX_AMPS_1P = 16  # VDE-AR-N 4100 5.5: single phase at most 4.6 kVA, we stay at 16 A


class Mode(StrEnum):
    OFF = "off"
    ECO = "eco"
    ECO_PLUS = "eco_plus"
    POWER = "power"
    MANUAL = "manual"  # set by hand in the card, the logic keeps its hands off


class Reason(StrEnum):
    OFF = "off"
    MANUAL = "manual"
    IDLE = "idle"  # no car / no transaction
    POWER = "power"
    STARTING = "starting"  # first minute after the session started
    SETTLING = "settling"  # waiting after a phase switch
    WAITING = "waiting"  # Eco: not enough surplus yet
    SOLAR = "solar"  # charging from surplus
    MINIMUM = "minimum"  # Eco+: minimum from the grid
    BATTERY_PRIORITY = "battery_priority"  # battery below threshold takes the surplus first


@dataclass(frozen=True)
class Settings:
    max_amps: int = 16
    battery_priority_soc: float = 80.0
    avg_window_s: float = 30.0
    start_1p_w: float = 1500.0
    start_1p_s: float = 120.0
    up_3p_w: float = 4200.0
    up_3p_s: float = 300.0
    down_1p_w: float = 3900.0
    down_1p_s: float = 300.0
    pause_w: float = 1200.0
    pause_s: float = 300.0
    phase_switch_gap_s: float = 600.0
    settle_s: float = 60.0
    start_hold_s: float = 60.0


@dataclass(frozen=True)
class Measurement:
    t: float  # seconds, monotonic
    grid_feed_in_w: float
    battery_w: float  # Pac_total_W
    usoc: float
    backup_buffer: float
    ev_w: float  # what the wallbox delivers right now
    in_transaction: bool  # Charging / SuspendedEV / SuspendedEVSE


@dataclass(frozen=True)
class Decision:
    amps: int | None  # None = do not touch the wallbox
    phases: int  # 1 or 3 (meaningless when amps is 0 or None)
    reason: Reason
    available_w: float
    revert_to_eco: bool = False  # Power ends with the session

    @property
    def power_w(self) -> float:
        return (self.amps or 0) * VOLTAGE * self.phases


def available_power(m: Measurement, s: Settings) -> float:
    """Power the car may use: export + what the car already takes + allowed battery charge."""
    p = m.grid_feed_in_w + m.ev_w
    if m.battery_w > 0:  # battery discharging: never feed the car from it
        p -= m.battery_w
    elif m.usoc >= s.battery_priority_soc and m.usoc > m.backup_buffer:
        p += -m.battery_w  # battery full enough: its charging power goes to the car
    return p


def amps_for(power_w: float, phases: int, s: Settings) -> int:
    top = min(s.max_amps, MAX_AMPS_1P) if phases == 1 else s.max_amps
    return max(MIN_AMPS, min(top, int(power_w // (VOLTAGE * phases))))


@dataclass
class ChargeLogic:
    settings: Settings = field(default_factory=Settings)
    phases: int = 0  # 0 = paused, 1, 3
    _samples: deque[tuple[float, float]] = field(default_factory=deque)
    _tx_start: float | None = None
    _last_switch: float = float("-inf")
    _last_phase_change: float = float("-inf")
    _cond: str | None = None
    _cond_since: float = 0.0
    _was_power_tx: bool = False

    def _avg(self, t: float, p: float) -> float:
        self._samples.append((t, p))
        while self._samples and self._samples[0][0] < t - self.settings.avg_window_s:
            self._samples.popleft()
        return sum(v for _, v in self._samples) / len(self._samples)

    def _held(self, name: str | None, t: float, need: float) -> bool:
        """True once the condition `name` has held for `need` seconds."""
        if name != self._cond:
            self._cond, self._cond_since = name, t
        return name is not None and t - self._cond_since >= need

    def _switch(self, phases: int, t: float) -> None:
        if {phases, self.phases} == {1, 3}:
            self._last_phase_change = t
        self.phases = phases
        self._last_switch = t
        self._cond = None

    def step(self, mode: Mode, m: Measurement) -> Decision:
        s = self.settings
        avail = self._avg(m.t, available_power(m, s))

        if not m.in_transaction:
            revert = self._was_power_tx
            self._tx_start, self._was_power_tx, self._cond = None, False, None
            self.phases = 1 if mode == Mode.ECO_PLUS else 0
            if mode == Mode.MANUAL:
                return Decision(None, 3, Reason.MANUAL, avail, revert)
            if mode == Mode.POWER and not revert:
                return Decision(s.max_amps, 3, Reason.POWER, avail)
            if mode == Mode.ECO_PLUS:
                return Decision(MIN_AMPS, 1, Reason.IDLE, avail, revert)
            # Off/Eco keep a 0 A profile ready: a new session starts paused, not at full power.
            return Decision(0, 3, Reason.IDLE if mode != Mode.OFF else Reason.OFF, avail, revert)

        if self._tx_start is None:
            self._tx_start = m.t
        if mode == Mode.MANUAL:
            return Decision(None, 3, Reason.MANUAL, avail)
        if mode == Mode.OFF:
            self.phases = 0
            return Decision(0, 3, Reason.OFF, avail)
        if mode == Mode.POWER:
            self._was_power_tx = True
            self.phases = 3
            return Decision(s.max_amps, 3, Reason.POWER, avail)

        eco_plus = mode == Mode.ECO_PLUS
        if eco_plus and self.phases == 0:
            self._switch(1, m.t)

        hold = m.t - self._tx_start < s.start_hold_s or m.t - self._last_switch < s.settle_s
        if not hold:
            self._transition(avail, m.t, eco_plus)

        if self.phases == 0:
            reason = Reason.BATTERY_PRIORITY if self._battery_first(m) else Reason.WAITING
            return Decision(0, 3, reason, avail)
        amps = amps_for(avail, self.phases, s)
        if hold:
            reason = Reason.STARTING if m.t - self._tx_start < s.start_hold_s else Reason.SETTLING
        elif eco_plus and avail < MIN_AMPS * VOLTAGE:
            reason = Reason.MINIMUM
        else:
            reason = Reason.SOLAR
        return Decision(amps, self.phases, reason, avail)

    def _battery_first(self, m: Measurement) -> bool:
        return m.battery_w < -100 and m.usoc < self.settings.battery_priority_soc

    def _transition(self, avail: float, t: float, eco_plus: bool) -> None:
        s = self.settings
        can_change_phase = t - self._last_phase_change >= s.phase_switch_gap_s
        if self.phases == 0:
            if self._held("start" if avail >= s.start_1p_w else None, t, s.start_1p_s):
                self._switch(1, t)
        elif self.phases == 1:
            if avail >= s.up_3p_w and can_change_phase:
                if self._held("up", t, s.up_3p_s):
                    self._switch(3, t)
            elif avail < s.pause_w and not eco_plus:
                if self._held("pause", t, s.pause_s):
                    self._switch(0, t)
            else:
                self._held(None, t, 0)
        elif avail < s.down_1p_w and can_change_phase:
            if self._held("down", t, s.down_1p_s):
                self._switch(1, t)
        else:
            self._held(None, t, 0)
