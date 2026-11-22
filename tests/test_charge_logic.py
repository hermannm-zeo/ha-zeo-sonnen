"""Charging logic with simulated time: no Home Assistant needed."""

from __future__ import annotations

import pytest

from custom_components.zeo_sonnen.charge_logic import (
    ChargeLogic,
    Decision,
    Measurement,
    Mode,
    Reason,
    Settings,
    Target,
    amps_for,
    available_power,
)


class Sim:
    """Feeds one measurement every `dt` seconds."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.logic = ChargeLogic(settings=settings or Settings())
        self.t = 0.0

    def run(
        self,
        mode: Mode,
        seconds: float,
        *,
        feed_in: float = 0.0,
        battery: float = 0.0,
        usoc: float = 90.0,
        buffer: float = 10.0,
        ev: float = 0.0,
        tx: bool = True,
        dt: float = 10.0,
        target: Target | None = None,
    ) -> Decision:
        end = self.t + seconds
        d = None
        while d is None or self.t < end:
            d = self.logic.step(
                mode,
                Measurement(
                    t=self.t,
                    grid_feed_in_w=feed_in,
                    battery_w=battery,
                    usoc=usoc,
                    backup_buffer=buffer,
                    ev_w=ev,
                    in_transaction=tx,
                ),
                target,
            )
            self.t += dt
        return d


def _m(**kw: float) -> Measurement:
    base = {
        "t": 0.0,
        "grid_feed_in_w": 0.0,
        "battery_w": 0.0,
        "usoc": 50.0,
        "backup_buffer": 10.0,
        "ev_w": 0.0,
    }
    base.update(kw)
    return Measurement(in_transaction=True, **base)


def test_available_power() -> None:
    s = Settings()
    assert available_power(_m(grid_feed_in_w=2000, ev_w=1000), s) == 3000
    # discharging battery is never used for the car
    assert available_power(_m(grid_feed_in_w=0, battery_w=500, ev_w=1500), s) == 1000
    # battery charging below the priority SoC keeps its power
    assert available_power(_m(grid_feed_in_w=500, battery_w=-3000, usoc=50), s) == 500
    # above the priority SoC its charging power goes to the car
    assert available_power(_m(grid_feed_in_w=500, battery_w=-3000, usoc=85), s) == 3500
    # but never while the SoC is at the backup buffer
    assert available_power(_m(grid_feed_in_w=500, battery_w=-3000, usoc=85, backup_buffer=90), s) == 500


def test_amps_for() -> None:
    s = Settings(max_amps=32)
    assert amps_for(500, 1, s) == 6  # never below the minimum
    assert amps_for(2300, 1, s) == 10
    assert amps_for(9000, 1, s) == 16  # single phase capped at 16 A
    assert amps_for(9000, 3, s) == 13
    assert amps_for(50000, 3, s) == 32
    assert amps_for(50000, 3, Settings(max_amps=16)) == 16


def test_decision_power() -> None:
    assert Decision(10, 3, Reason.SOLAR, 0).power_w == 6900
    assert Decision(None, 3, Reason.MANUAL, 0).power_w == 0


@pytest.mark.parametrize(
    ("mode", "amps", "phases", "reason"),
    [
        (Mode.MANUAL, None, 3, Reason.MANUAL),
        (Mode.POWER, 16, 3, Reason.POWER),
        (Mode.ECO_PLUS, 6, 1, Reason.IDLE),
        (Mode.ECO, 0, 3, Reason.IDLE),
        (Mode.OFF, 0, 3, Reason.OFF),
    ],
)
def test_without_car(mode: Mode, amps: int | None, phases: int, reason: Reason) -> None:
    d = Sim().run(mode, 0, tx=False)
    assert (d.amps, d.phases, d.reason) == (amps, phases, reason)
    assert not d.revert_to_eco


@pytest.mark.parametrize(
    ("mode", "amps", "reason"),
    [(Mode.MANUAL, None, Reason.MANUAL), (Mode.OFF, 0, Reason.OFF), (Mode.POWER, 16, Reason.POWER)],
)
def test_fixed_modes_during_session(mode: Mode, amps: int | None, reason: Reason) -> None:
    d = Sim().run(mode, 120, feed_in=8000)
    assert (d.amps, d.reason) == (amps, reason)


def test_power_reverts_to_eco_after_the_session() -> None:
    sim = Sim()
    sim.run(Mode.POWER, 60)
    d = sim.run(Mode.POWER, 0, tx=False)
    assert d.revert_to_eco
    assert d.reason == Reason.IDLE
    # only once
    assert not sim.run(Mode.POWER, 0, tx=False).revert_to_eco


def test_eco_waits_then_starts_single_phase() -> None:
    sim = Sim()
    d = sim.run(Mode.ECO, 30, feed_in=2000)
    assert (d.amps, d.reason) == (0, Reason.WAITING)
    d = sim.run(Mode.ECO, 190, feed_in=2000)  # start hold 60 s + 120 s above 1.5 kW
    assert (d.amps, d.phases) == (8, 1)  # 2 kW / 230 V
    assert d.reason == Reason.SETTLING
    d = sim.run(Mode.ECO, 70, feed_in=0, ev=2300)
    assert (d.amps, d.phases, d.reason) == (10, 1, Reason.SOLAR)


def test_eco_battery_priority() -> None:
    d = Sim().run(Mode.ECO, 300, feed_in=200, battery=-3000, usoc=40)
    assert (d.amps, d.reason) == (0, Reason.BATTERY_PRIORITY)


def test_eco_switches_to_three_phases_and_back() -> None:
    sim = Sim()
    sim.run(Mode.ECO, 200, feed_in=2000)
    assert sim.logic.phases == 1
    # lots of sun: up to 3 phases after 60 s settling + 5 min
    d = sim.run(Mode.ECO, 400, feed_in=3500, ev=3680)
    assert d.phases == 3
    d = sim.run(Mode.ECO, 70, feed_in=200, ev=7000)
    assert (d.phases, d.reason) == (3, Reason.SOLAR)
    # clouds: back to 1 phase, but only 10 min after the last phase change
    d = sim.run(Mode.ECO, 200, feed_in=0, ev=3000)
    assert d.phases == 3
    d = sim.run(Mode.ECO, 700, feed_in=0, ev=3000)  # gap 10 min, then 5 min below 3.9 kW
    assert d.phases == 1


def test_eco_pauses_when_the_sun_is_gone() -> None:
    sim = Sim()
    sim.run(Mode.ECO, 200, feed_in=2000)
    assert sim.logic.phases == 1
    d = sim.run(Mode.ECO, 400, feed_in=-500, ev=1380)
    assert (d.amps, d.reason) == (0, Reason.WAITING)


def test_eco_keeps_phase_between_thresholds() -> None:
    sim = Sim()
    sim.run(Mode.ECO, 200, feed_in=2000)
    d = sim.run(Mode.ECO, 600, feed_in=1000, ev=1500)  # 2.5 kW: neither up nor pause
    assert (d.phases, d.reason) == (1, Reason.SOLAR)


def test_eco_plus_charges_minimum_from_grid() -> None:
    sim = Sim()
    d = sim.run(Mode.ECO_PLUS, 30, feed_in=-1000)
    assert (d.amps, d.phases, d.reason) == (6, 1, Reason.STARTING)
    d = sim.run(Mode.ECO_PLUS, 400, feed_in=-1000, ev=1380)
    assert (d.amps, d.phases, d.reason) == (6, 1, Reason.MINIMUM)  # never pauses


# ---------- Ziel ----------

T11 = 11040.0  # 16 A, 3 phases


def test_target_need_w() -> None:
    assert Target(10000, 3600, T11).need_w == 10000
    assert Target(0, 3600, T11).need_w == 0
    assert Target(-5, 0, T11).need_w == 0
    assert Target(100, 0, T11).need_w == float("inf")


def test_target_without_input_behaves_like_eco() -> None:
    sim = Sim()
    d = sim.run(Mode.TARGET, 600, feed_in=0)
    assert (d.amps, d.reason) == (0, Reason.WAITING)


def test_target_tops_up_from_grid_single_phase() -> None:
    sim = Sim()
    # 20 kWh in 8 h = 2.5 kW needed, no sun
    d = sim.run(Mode.TARGET, 600, target=Target(20000, 8 * 3600, T11))
    assert (d.amps, d.phases, d.reason) == (10, 1, Reason.TARGET)


def test_target_uses_surplus_when_larger_than_need() -> None:
    sim = Sim()
    d = sim.run(Mode.TARGET, 600, feed_in=3000, target=Target(5000, 8 * 3600, T11))
    assert (d.phases, d.reason) == (1, Reason.SOLAR)
    assert d.amps == 13


def test_target_small_need_waits_for_the_sun() -> None:
    sim = Sim()
    # 0.5 kW needed: below the 1.5 kW start threshold, nothing happens yet
    d = sim.run(Mode.TARGET, 900, target=Target(4000, 8 * 3600, T11))
    assert (d.amps, d.reason) == (0, Reason.WAITING)


def test_target_switches_to_three_phases_for_large_need() -> None:
    sim = Sim()
    d = sim.run(Mode.TARGET, 1200, target=Target(30000, 4 * 3600, T11))  # 7.5 kW
    assert (d.phases, d.reason) == (3, Reason.TARGET)
    assert d.amps == 10


def test_target_single_phase_car_stays_single_phase() -> None:
    sim = Sim()
    d = sim.run(Mode.TARGET, 1200, target=Target(30000, 4 * 3600, 3680.0, max_phases=1))
    assert d.phases == 1
    assert d.reason == Reason.TOO_TIGHT
    assert d.amps == 16


def test_target_capped_by_car() -> None:
    sim = Sim()
    # car takes 7.4 kW on one phase only: 16 A single phase at most here
    d = sim.run(Mode.TARGET, 600, feed_in=9000, target=Target(5000, 8 * 3600, 3680.0, max_phases=1))
    assert (d.amps, d.phases) == (16, 1)


def test_target_too_tight_goes_full_power_at_once() -> None:
    sim = Sim()
    d = sim.run(Mode.TARGET, 10, target=Target(40000, 3600, T11))
    assert (d.amps, d.phases, d.reason) == (16, 3, Reason.TOO_TIGHT)
    d = sim.run(Mode.TARGET, 10, target=Target(40000, 0, T11))
    assert d.reason == Reason.TOO_TIGHT


def test_target_reached_pauses() -> None:
    sim = Sim()
    sim.run(Mode.TARGET, 600, target=Target(20000, 8 * 3600, T11))
    d = sim.run(Mode.TARGET, 10, target=Target(0, 8 * 3600, T11))
    assert (d.amps, d.reason) == (0, Reason.TARGET_REACHED)
    assert sim.logic.phases == 0


def test_target_idle_without_car() -> None:
    sim = Sim()
    d = sim.run(Mode.TARGET, 10, tx=False, target=Target(20000, 3600, T11))
    assert (d.amps, d.reason) == (0, Reason.IDLE)
