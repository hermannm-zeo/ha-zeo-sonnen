"""Drive the battery to a state of charge in manual mode, then hold it at 0 W.

Used to bring the battery to a fixed level, e.g. 28 % before replacing or
adding modules. Always runs at full power (no slow-down near the target) and
stops at the first poll that reaches the target. The battery then stays in
manual mode at 0 W, so the level holds.

Safe stop: a run that was active when Home Assistant stopped or the entry was
unloaded is ended with 0 W at the next start. A run never resumes by itself.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .api import SonnenError
from .const import CONF_KEY_OPERATING_MODE, DOMAIN, OPERATING_MODES
from .coordinator import SonnenConfigEntry, SonnenCoordinator

_LOGGER = logging.getLogger(__name__)

TARGET_POWER_W = 9900  # always full power, as asked for module service
RESEND_S = 60.0  # repeat the setpoint now and then so it never gets lost
SIGNAL_TARGET_SOC = f"{DOMAIN}_target_soc"
STORE_VERSION = 1

# states of the run
IDLE = "idle"
CHARGING = "charging"
DISCHARGING = "discharging"
REACHED = "reached"
STOPPED = "stopped"
ABORTED = "aborted"
STATES = (IDLE, CHARGING, DISCHARGING, REACHED, STOPPED, ABORTED)


class TargetSocError(Exception):
    """Run cannot start: `reason` is a translation key."""

    def __init__(self, reason: str, **placeholders: Any) -> None:
        super().__init__(reason)
        self.reason = reason
        self.placeholders = {k: str(v) for k, v in placeholders.items()}


@dataclass
class TargetRun:
    state: str = IDLE
    target: int | None = None
    start_soc: float | None = None
    power: int = TARGET_POWER_W
    started: str | None = None  # ISO time
    ended: str | None = None
    reason: str | None = None  # why it ended (aborted/stopped)

    @property
    def active(self) -> bool:
        return self.state in (CHARGING, DISCHARGING)


def current_soc(coordinator: SonnenCoordinator) -> float | None:
    data = coordinator.data
    if data is None:
        return None
    try:
        return float(data.status.get("USOC"))
    except (TypeError, ValueError):
        return None


def manual_mode(coordinator: SonnenCoordinator) -> bool | None:
    """True/False, or None while the setting is unknown."""
    data = coordinator.data
    raw = ((data.configurations if data else None) or {}).get(CONF_KEY_OPERATING_MODE)
    if raw is None:
        return None
    return str(raw) == OPERATING_MODES["manual"]


class TargetSocController:
    def __init__(self, hass: HomeAssistant, entry: SonnenConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.coordinator: SonnenCoordinator = entry.runtime_data
        self.run = TargetRun()
        key = f"{DOMAIN}.target_soc.{entry.entry_id}"
        self._store: Store[dict[str, Any]] = Store(hass, STORE_VERSION, key)
        self._sent_at = 0.0
        self._busy = False
        self._unsub = None

    # --- life cycle ---------------------------------------------------------
    async def async_setup(self) -> None:
        stored = await self._store.async_load()
        if stored and stored.get("active"):
            # HA went down during a run: never resume, stop safely
            _LOGGER.warning("sonnenBatterie: run to %s %% interrupted, 0 W", stored.get("target"))
            await self._send(0)
            self.run = TargetRun(
                state=ABORTED,
                target=stored.get("target"),
                started=stored.get("started"),
                ended=dt_util.utcnow().isoformat(),
                reason="restart",
            )
            await self._save(False)
        self._unsub = self.coordinator.async_add_listener(self._on_update)

    async def async_unload(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        if self.run.active:
            # the store keeps "active", so the next start ends the run with 0 W;
            # try right away as well
            await self._send(0)

    # --- commands -------------------------------------------------------------
    async def async_start(self, target: int) -> TargetRun:
        if manual_mode(self.coordinator) is not True:
            raise TargetSocError("target_soc_manual_required")
        soc = current_soc(self.coordinator)
        if soc is None:
            raise TargetSocError("target_soc_no_soc")
        if round(soc) == target:
            raise TargetSocError("target_soc_already", soc=round(soc))
        state = CHARGING if target > soc else DISCHARGING
        self.run = TargetRun(
            state=state,
            target=target,
            start_soc=soc,
            power=TARGET_POWER_W,
            started=dt_util.utcnow().isoformat(),
        )
        await self._save(True)
        if not await self._send(TARGET_POWER_W):
            await self._end(ABORTED, "send_failed", send_zero=False)
            raise TargetSocError("setpoint_failed")
        _LOGGER.info("sonnenBatterie: target run %s %s %% -> %s %%, %s W", state, soc, target, TARGET_POWER_W)
        self._changed()
        return self.run

    async def async_cancel(self, reason: str = "user") -> None:
        """Called before any other setpoint command, and by the stop button."""
        if self.run.active:
            await self._end(STOPPED, reason, send_zero=False)

    # --- control loop ---------------------------------------------------------
    @callback
    def _on_update(self) -> None:
        if self.run.active and not self._busy:
            self.hass.async_create_task(self._check(), eager_start=True)

    async def _check(self) -> None:
        self._busy = True
        try:
            run = self.run
            if not run.active or not self.coordinator.last_update_success:
                return  # battery not reachable: wait, keep the run
            if manual_mode(self.coordinator) is False:
                await self._end(ABORTED, "mode_changed", send_zero=False)
                return
            soc = current_soc(self.coordinator)
            if soc is None or run.target is None:
                return
            up, down = run.state == CHARGING, run.state == DISCHARGING
            if (up and soc >= run.target) or (down and soc <= run.target):
                await self._end(REACHED, None, send_zero=True)
                return
            if time.monotonic() - self._sent_at >= RESEND_S:
                await self._send(run.power)
        finally:
            self._busy = False

    async def _end(self, state: str, reason: str | None, *, send_zero: bool) -> None:
        if send_zero:
            await self._send(0)
        self.run.state = state
        self.run.reason = reason
        self.run.ended = dt_util.utcnow().isoformat()
        _LOGGER.info("sonnenBatterie: target run to %s %% ended: %s %s", self.run.target, state, reason or "")
        await self._save(False)
        self._changed()

    async def _send(self, watts: int) -> bool:
        direction = "discharge" if self.run.state == DISCHARGING and watts else "charge"
        try:
            await self.coordinator.api.async_set_power_setpoint(direction, watts)
        except SonnenError as err:
            _LOGGER.warning("sonnenBatterie: setpoint %s %s W failed: %s", direction, watts, err)
            return False
        self._sent_at = time.monotonic()
        return True

    async def _save(self, active: bool) -> None:
        run = self.run
        await self._store.async_save({"active": active, "target": run.target, "started": run.started})

    @callback
    def _changed(self) -> None:
        async_dispatcher_send(self.hass, SIGNAL_TARGET_SOC, self.entry.entry_id)
