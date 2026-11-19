"""Wallbox (sonnenCharger 3 / Alfen) as a device under the battery, fed by our OCPP server.

No polling: every message of the box fires SIGNAL_OCPP_UPDATE and the entities write
their state. The entities are created only when the entry has a wallbox id (option).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from statistics import fmean
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity, EntityDescription
from homeassistant.util import dt as dt_util

from .const import CONF_WALLBOX_ID, CONF_WALLBOX_MAX_CURRENT, DEFAULT_WALLBOX_MAX_CURRENT, DOMAIN
from .coordinator import SonnenConfigEntry
from .ocpp_charge_point import PHASES, ChargePointState
from .ocpp_server import DATA_OCPP, SIGNAL_OCPP_UPDATE, OcppServer

MANUFACTURER = "sonnen"
MODEL = "sonnenCharger 3"
UNIQUE_INFIX = "_wallbox_"
# HA 2026.8+ links devices by device id (via_device_id) and looks them up per config entry;
# older cores (down to the 2025.2 minimum) only know the identifier tuple (via_device).
NEW_DEVICE_API = "via_device_id" in getattr(DeviceInfo, "__annotations__", {})
_PARENTS: dict[str, str] = {}  # entry_id -> device id of the battery


def wallbox_id(entry: SonnenConfigEntry) -> str | None:
    value = str(entry.options.get(CONF_WALLBOX_ID) or "").strip()
    return value or None


def wallbox_max_current(entry: SonnenConfigEntry) -> int:
    return int(entry.options.get(CONF_WALLBOX_MAX_CURRENT, DEFAULT_WALLBOX_MAX_CURRENT))


def server(hass: HomeAssistant) -> OcppServer:
    srv: OcppServer = hass.data[DATA_OCPP]
    return srv


def device_identifier(serial: str) -> tuple[str, str]:
    return (DOMAIN, f"{serial}_wallbox")


def find_device(
    registry: dr.DeviceRegistry, identifier: tuple[str, str], entry_id: str
) -> dr.DeviceEntry | None:
    if NEW_DEVICE_API:  # pragma: no cover - not available in the test core
        device: dr.DeviceEntry | None = registry.async_get_device_by_identifier(identifier, entry_id)
        return device
    return registry.async_get_device(identifiers={identifier})


def via(entry: SonnenConfigEntry) -> dict[str, Any]:
    """Link to the battery device in the form this core understands."""
    serial = str(entry.runtime_data.serial)
    if NEW_DEVICE_API:  # pragma: no cover - not available in the test core
        parent = _PARENTS.get(entry.entry_id)
        return {"via_device_id": parent} if parent else {}
    return {"via_device": (DOMAIN, serial)}


@callback
def async_setup_wallbox(hass: HomeAssistant, entry: SonnenConfigEntry) -> None:
    """Let the box connect and keep the device (model, firmware) up to date."""
    cp_id = wallbox_id(entry)
    if cp_id is None:
        return
    srv = server(hass)
    entry.async_on_unload(srv.async_allow(cp_id))
    serial = str(entry.runtime_data.serial)
    registry = dr.async_get(hass)

    # The battery device must exist before the wallbox can point to it.
    parent = registry.async_get_or_create(config_entry_id=entry.entry_id, **entry.runtime_data.device_info)
    _PARENTS[entry.entry_id] = parent.id

    # After an HA restart the box usually only reconnects without a BootNotification:
    # keep model and firmware from the device registry until it reports them again.
    state = srv.states[cp_id]
    if (known := find_device(registry, device_identifier(serial), entry.entry_id)) is not None:
        state.model = state.model or known.model_id
        state.firmware = state.firmware or known.sw_version

    @callback
    def _update_device(changed: str) -> None:
        if changed != cp_id:
            return
        state = srv.states[cp_id]
        device = find_device(registry, device_identifier(serial), entry.entry_id)
        if device is None:
            return
        if device.sw_version != state.firmware or device.model_id != state.model:
            registry.async_update_device(device.id, sw_version=state.firmware, model_id=state.model)

    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_OCPP_UPDATE, _update_device))


def _charging(s: ChargePointState) -> bool:
    return s.connector_status == "Charging"


def _phase_values(values: dict[str, float], charging: bool) -> dict[str, float]:
    return {p: (round(values.get(p, 0.0), 2) if charging else 0.0) for p in PHASES}


def power_value(s: ChargePointState) -> float:
    return round(s.power_w or 0.0, 1) if _charging(s) else 0.0


def current_value(s: ChargePointState) -> float:
    return max(_phase_values(s.current_a, _charging(s)).values())


def voltage_value(s: ChargePointState) -> float | None:
    values = [s.voltage_v[p] for p in PHASES if s.voltage_v.get(p)]
    return round(fmean(values), 1) if values else None


def kwh(wh: float | None) -> float | None:
    return None if wh is None else round(wh / 1000, 3)


def session_minutes(s: ChargePointState) -> float | None:
    if s.session_start is None:
        return None
    end = s.session_end or dt_util.utcnow()
    return round(max(0.0, (end - s.session_start).total_seconds()) / 60, 1)


@dataclass(frozen=True, kw_only=True)
class WallboxDescription(EntityDescription):
    value_fn: Callable[[ChargePointState], Any]
    attrs_fn: Callable[[ChargePointState], dict[str, Any]] | None = None


def power_attrs(s: ChargePointState) -> dict[str, Any]:
    return _phase_values(s.power_phase_w, _charging(s))


def current_attrs(s: ChargePointState) -> dict[str, Any]:
    charging = _charging(s)
    return {
        **_phase_values(s.current_a, charging),
        "N": round(s.current_a.get("N", 0.0), 2) if charging else 0.0,
    }


def voltage_attrs(s: ChargePointState) -> dict[str, Any]:
    return {p: s.voltage_v.get(p) for p in PHASES}


def limit_attrs(s: ChargePointState) -> dict[str, Any]:
    valid_to: datetime | None = s.limit_valid_to
    return {"phases": s.limit_phases, "valid_to": valid_to.isoformat() if valid_to else None}


class WallboxEntity(Entity):
    """Base: unique id, device, availability and updates from the OCPP server."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    entity_description: WallboxDescription

    def __init__(self, entry: SonnenConfigEntry, cp_id: str, description: WallboxDescription) -> None:
        serial = str(entry.runtime_data.serial)
        self.entity_description = description
        self._cp_id = cp_id
        self._server = server(entry.runtime_data.hass)
        self._attr_unique_id = f"{serial}{UNIQUE_INFIX}{description.key}"
        state = self.cp_state
        self._attr_device_info = DeviceInfo(
            identifiers={device_identifier(serial)},
            manufacturer=MANUFACTURER,
            model=MODEL,
            model_id=state.model,
            name="Wallbox",
            serial_number=cp_id,
            sw_version=state.firmware,
            **via(entry),
        )

    @property
    def cp_state(self) -> ChargePointState:
        return self._server.states.setdefault(self._cp_id, ChargePointState(self._cp_id))

    @property
    def available(self) -> bool:
        return self.cp_state.connected

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        fn = self.entity_description.attrs_fn
        return fn(self.cp_state) if fn else None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_OCPP_UPDATE, self._on_update))

    @callback
    def _on_update(self, cp_id: str) -> None:
        if cp_id == self._cp_id:
            self.async_write_ha_state()
