"""Actions: battery power setpoint and wallbox commands (OCPP)."""

from __future__ import annotations

from datetime import timedelta

from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import ATTR_CONFIG_ENTRY_ID
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.util import dt as dt_util

from .api import SETPOINT_DIRECTIONS, SonnenError
from .const import DOMAIN
from .coordinator import SonnenConfigEntry
from .ocpp_server import DATA_OCPP, NotConnectedError, OcppServer
from .schema import vol

SERVICE_SET_POWER = "set_power"
ATTR_DIRECTION = "direction"
ATTR_POWER = "power"
MAX_SETPOINT_W = 20_000  # above any sonnen inverter; the battery clamps to its own limit

SERVICE_WALLBOX_SET_LIMIT = "wallbox_set_limit"
SERVICE_WALLBOX_CLEAR_LIMIT = "wallbox_clear_limit"
SERVICE_WALLBOX_GET_CONFIGURATION = "wallbox_get_configuration"
ATTR_CHARGE_POINT = "charge_point_id"
ATTR_CURRENT = "current"
ATTR_PHASES = "phases"
ATTR_VALID_FOR = "valid_for"
ATTR_KEYS = "keys"

WALLBOX_SCHEMA = vol.Schema({vol.Required(ATTR_CHARGE_POINT): cv.string})
WALLBOX_SET_LIMIT_SCHEMA = WALLBOX_SCHEMA.extend(
    {
        vol.Required(ATTR_CURRENT): vol.All(vol.Coerce(int), vol.Range(min=0, max=32)),
        vol.Optional(ATTR_PHASES, default=3): vol.All(vol.Coerce(int), vol.In((1, 3))),
        vol.Optional(ATTR_VALID_FOR): vol.All(vol.Coerce(int), vol.Range(min=1, max=1440)),  # minutes
    }
)
WALLBOX_GET_CONFIGURATION_SCHEMA = WALLBOX_SCHEMA.extend(
    {vol.Optional(ATTR_KEYS): vol.All(cv.ensure_list, [cv.string])}
)

SET_POWER_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_CONFIG_ENTRY_ID): cv.string,
        vol.Required(ATTR_DIRECTION): vol.In(SETPOINT_DIRECTIONS),
        vol.Required(ATTR_POWER): vol.All(vol.Coerce(int), vol.Range(min=0, max=MAX_SETPOINT_W)),
    }
)


def _get_entry(hass: HomeAssistant, entry_id: str) -> SonnenConfigEntry:
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry is None or entry.domain != DOMAIN:
        raise ServiceValidationError(translation_domain=DOMAIN, translation_key="entry_not_found")
    if entry.state is not ConfigEntryState.LOADED:
        raise ServiceValidationError(translation_domain=DOMAIN, translation_key="entry_not_loaded")
    return entry


async def _async_set_power(call: ServiceCall) -> None:
    entry = _get_entry(call.hass, call.data[ATTR_CONFIG_ENTRY_ID])
    coordinator = entry.runtime_data
    try:
        await coordinator.api.async_set_power_setpoint(call.data[ATTR_DIRECTION], call.data[ATTR_POWER])
    except SonnenError as err:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="setpoint_failed") from err
    await coordinator.async_request_refresh()


def _server(hass: HomeAssistant) -> OcppServer:
    server: OcppServer = hass.data[DATA_OCPP]
    return server


async def _wallbox(call: ServiceCall, command: str, *args: object) -> object:
    """Run one command; turn the usual failures into readable messages."""
    cp_id = call.data[ATTR_CHARGE_POINT]
    placeholders = {"charge_point": cp_id}
    try:
        return await getattr(_server(call.hass), command)(cp_id, *args)
    except NotConnectedError as err:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="wallbox_not_connected",
            translation_placeholders=placeholders,
        ) from err
    except ValueError as err:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="wallbox_invalid_current"
        ) from err
    except Exception as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="wallbox_command_failed",
            translation_placeholders={**placeholders, "error": str(err) or type(err).__name__},
        ) from err


async def _async_wallbox_set_limit(call: ServiceCall) -> None:
    valid_to = None
    if (minutes := call.data.get(ATTR_VALID_FOR)) is not None:
        valid_to = dt_util.utcnow() + timedelta(minutes=minutes)
    accepted = await _wallbox(
        call, "async_set_limit", call.data[ATTR_CURRENT], call.data[ATTR_PHASES], valid_to
    )
    if not accepted:
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="wallbox_rejected")


async def _async_wallbox_clear_limit(call: ServiceCall) -> None:
    if not await _wallbox(call, "async_clear_limit"):
        raise HomeAssistantError(translation_domain=DOMAIN, translation_key="wallbox_rejected")


async def _async_wallbox_get_configuration(call: ServiceCall) -> ServiceResponse:
    config = await _wallbox(call, "async_get_configuration", call.data.get(ATTR_KEYS))
    return {"configuration": config}  # type: ignore[dict-item]


def async_setup_services(hass: HomeAssistant) -> None:
    hass.services.async_register(DOMAIN, SERVICE_SET_POWER, _async_set_power, schema=SET_POWER_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_WALLBOX_SET_LIMIT, _async_wallbox_set_limit, schema=WALLBOX_SET_LIMIT_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_WALLBOX_CLEAR_LIMIT, _async_wallbox_clear_limit, schema=WALLBOX_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_WALLBOX_GET_CONFIGURATION,
        _async_wallbox_get_configuration,
        schema=WALLBOX_GET_CONFIGURATION_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
