"""One OCPP 1.6J charge point (sonnenCharger 3 / Alfen Eve) as seen by our central system.

Handles what the box sends (boot, heartbeat, status, meter values, transactions) and keeps
the latest values in `ChargePointState`. Every change is reported through `on_update`, so
entities can follow later without this module knowing about them.

Authorisation: every id tag is accepted. The box checks RFID itself; at customers there may
be no card at all (plug & charge). An allow list can be added later.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from homeassistant.util import dt as dt_util
from ocpp.routing import on
from ocpp.v16 import ChargePoint, call, call_result
from ocpp.v16.enums import (
    Action,
    AuthorizationStatus,
    DataTransferStatus,
    MessageTrigger,
    RegistrationStatus,
)

_LOGGER = logging.getLogger(__name__)

HEARTBEAT_INTERVAL = 60  # seconds, the box takes this from our BootNotification answer
PHASES = ("L1", "L2", "L3")
IN_TRANSACTION = ("Charging", "SuspendedEV", "SuspendedEVSE")


def iso_now() -> str:
    """UTC time as OCPP wants it (also sets the clock of the box)."""
    return dt_util.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


@dataclass
class ChargePointState:
    """Latest known values of one box. None = not reported yet."""

    cp_id: str
    connected: bool = False
    vendor: str | None = None
    model: str | None = None
    serial: str | None = None
    firmware: str | None = None
    status: dict[int, str] = field(default_factory=dict)  # connector -> OCPP status
    error_code: str | None = None
    transaction_id: int | None = None
    id_tag: str | None = None
    meter_start_wh: float | None = None
    session_start: datetime | None = None
    last_stop_reason: str | None = None
    energy_wh: float | None = None  # Energy.Active.Import.Register
    power_w: float | None = None
    power_phase_w: dict[str, float] = field(default_factory=dict)
    current_a: dict[str, float] = field(default_factory=dict)
    current_offered_a: float | None = None
    voltage_v: dict[str, float] = field(default_factory=dict)
    clock_offset_s: float | None = None  # box clock minus HA clock, from meter timestamps
    last_seen: datetime | None = None

    @property
    def connector_status(self) -> str | None:
        return self.status.get(1)

    @property
    def in_transaction(self) -> bool:
        return self.connector_status in IN_TRANSACTION

    @property
    def session_energy_wh(self) -> float | None:
        if self.energy_wh is None or self.meter_start_wh is None or self.transaction_id is None:
            return None
        return max(0.0, self.energy_wh - self.meter_start_wh)

    @property
    def active_phases(self) -> int:
        """Phases the car actually draws on (> 1 A)."""
        return sum(1 for p in PHASES if self.current_a.get(p, 0.0) > 1.0)


def _to_base_unit(value: float, unit: str | None) -> float:
    """kWh -> Wh, kW -> W; everything else unchanged."""
    if unit in ("kWh", "kW"):
        return value * 1000
    return value


def _phase_key(phase: str | None) -> str | None:
    """'L1-N' -> 'L1', 'N' stays 'N', None stays None."""
    if not phase:
        return None
    return phase.split("-")[0]


class ZeoChargePoint(ChargePoint):  # type: ignore[misc]
    """Central system side of one websocket connection."""

    def __init__(
        self,
        cp_id: str,
        connection: Any,
        state: ChargePointState,
        on_update: Callable[[ChargePointState], None],
        next_transaction_id: Callable[[], int],
    ) -> None:
        super().__init__(cp_id, connection, logger=_LOGGER)
        self.state = state
        self._on_update = on_update
        self._next_tx = next_transaction_id

    def _changed(self) -> None:
        self.state.last_seen = dt_util.utcnow()
        self._on_update(self.state)

    def _clock(self, timestamp: str | None) -> None:
        if not timestamp:
            return
        box_time = dt_util.parse_datetime(timestamp)
        if box_time is not None:
            self.state.clock_offset_s = round((box_time - dt_util.utcnow()).total_seconds(), 1)

    # --- messages from the box ------------------------------------------------

    @on(Action.boot_notification)
    def on_boot_notification(
        self, charge_point_vendor: str, charge_point_model: str, **kwargs: Any
    ) -> call_result.BootNotification:
        s = self.state
        s.vendor, s.model = charge_point_vendor, charge_point_model
        s.serial = kwargs.get("charge_point_serial_number") or kwargs.get("charge_box_serial_number")
        s.firmware = kwargs.get("firmware_version")
        _LOGGER.info("OCPP %s: boot %s %s, firmware %s", self.id, s.vendor, s.model, s.firmware)
        self._changed()
        return call_result.BootNotification(
            current_time=iso_now(), interval=HEARTBEAT_INTERVAL, status=RegistrationStatus.accepted
        )

    @on(Action.heartbeat)
    def on_heartbeat(self) -> call_result.Heartbeat:
        self._changed()
        return call_result.Heartbeat(current_time=iso_now())

    @on(Action.status_notification)
    def on_status_notification(
        self, connector_id: int, error_code: str, status: str, **kwargs: Any
    ) -> call_result.StatusNotification:
        self.state.status[connector_id] = status
        if connector_id in (0, 1):
            self.state.error_code = error_code
        self._clock(kwargs.get("timestamp"))
        _LOGGER.debug("OCPP %s: connector %s %s (%s)", self.id, connector_id, status, error_code)
        self._changed()
        return call_result.StatusNotification()

    @on(Action.authorize)
    def on_authorize(self, id_tag: str) -> call_result.Authorize:
        return call_result.Authorize(id_tag_info={"status": AuthorizationStatus.accepted})

    @on(Action.start_transaction)
    def on_start_transaction(
        self, connector_id: int, id_tag: str, meter_start: int, timestamp: str, **kwargs: Any
    ) -> call_result.StartTransaction:
        s = self.state
        s.transaction_id = self._next_tx()
        s.id_tag, s.meter_start_wh = id_tag, float(meter_start)
        s.session_start = dt_util.parse_datetime(timestamp) or dt_util.utcnow()
        s.energy_wh = float(meter_start)
        _LOGGER.info("OCPP %s: transaction %s started", self.id, s.transaction_id)
        self._changed()
        return call_result.StartTransaction(
            transaction_id=s.transaction_id, id_tag_info={"status": AuthorizationStatus.accepted}
        )

    @on(Action.stop_transaction)
    def on_stop_transaction(
        self, meter_stop: int, timestamp: str, transaction_id: int, **kwargs: Any
    ) -> call_result.StopTransaction:
        s = self.state
        s.energy_wh = float(meter_stop)
        s.last_stop_reason = kwargs.get("reason") or "Local"
        _LOGGER.info("OCPP %s: transaction %s stopped (%s)", self.id, transaction_id, s.last_stop_reason)
        s.transaction_id = None
        s.power_w, s.power_phase_w, s.current_a = 0.0, {}, {}
        self._changed()
        return call_result.StopTransaction(id_tag_info={"status": AuthorizationStatus.accepted})

    @on(Action.meter_values)
    def on_meter_values(
        self, connector_id: int, meter_value: list[dict[str, Any]], **kwargs: Any
    ) -> call_result.MeterValues:
        s = self.state
        tx = kwargs.get("transaction_id")
        if tx is not None and s.transaction_id is None:
            s.transaction_id = tx  # reconnect during a running session; start meter unknown
        for mv in meter_value:
            self._clock(mv.get("timestamp"))
            power: dict[str | None, float] = {}  # None = total
            for sv in mv.get("sampled_value", []):
                self._sample(sv, power)
            total = power.pop(None, None)
            if power:
                s.power_phase_w = {k: v for k, v in power.items() if k is not None}
            if total is not None:
                s.power_w = round(total, 1)
            elif power:
                s.power_w = round(sum(power.get(p, 0.0) for p in PHASES), 1)
        self._changed()
        return call_result.MeterValues()

    def _sample(self, sv: dict[str, Any], power: dict[str | None, float]) -> None:
        try:
            value = _to_base_unit(float(sv["value"]), sv.get("unit"))
        except (KeyError, TypeError, ValueError):
            return
        measurand = sv.get("measurand", "Energy.Active.Import.Register")
        phase = _phase_key(sv.get("phase"))
        s = self.state
        if measurand == "Energy.Active.Import.Register":
            if phase is None:
                s.energy_wh = value
        elif measurand == "Power.Active.Import":
            power[phase] = value
        elif measurand == "Current.Import" and phase is not None:
            s.current_a[phase] = value
        elif measurand == "Current.Offered":
            s.current_offered_a = value
        elif measurand == "Voltage" and phase is not None:
            s.voltage_v[phase] = value

    @on(Action.data_transfer)
    def on_data_transfer(self, vendor_id: str, **kwargs: Any) -> call_result.DataTransfer:
        return call_result.DataTransfer(status=DataTransferStatus.unknown_vendor_id)

    @on(Action.firmware_status_notification)
    def on_firmware_status(self, status: str) -> call_result.FirmwareStatusNotification:
        return call_result.FirmwareStatusNotification()

    @on(Action.diagnostics_status_notification)
    def on_diagnostics_status(self, status: str) -> call_result.DiagnosticsStatusNotification:
        return call_result.DiagnosticsStatusNotification()

    # --- requests to the box --------------------------------------------------

    async def async_request_status(self) -> None:
        """Ask the box to resend its status (after a reconnect HA knows nothing yet)."""
        await self.call(call.TriggerMessage(requested_message=MessageTrigger.status_notification))
