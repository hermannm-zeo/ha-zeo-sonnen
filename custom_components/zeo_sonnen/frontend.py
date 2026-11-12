"""Ships the dashboard card and a sidebar panel with the integration.

* The card (``custom:zeo-sonnen-card``) is served from the integration folder
  and loaded on every dashboard, so it needs no manual resource.
* Every config entry gets its own sidebar panel that shows the card full page.
* ``zeo_sonnen/info`` tells the card which entities belong to an entry and
  which model (housing colour) the installer picked, so entity IDs don't matter.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from .const import (
    CARD_FILENAME,
    DEFAULT_MODEL,
    DOMAIN,
    FRONTEND_URL_BASE,
    MODELS,
    PANEL_ELEMENT,
    PANEL_ICON,
)
from .coordinator import SonnenConfigEntry
from .schema import vol

_DATA_REGISTERED = f"{DOMAIN}_frontend_registered"

# unique_id suffix (integration key) -> key the card uses
CARD_KEYS: dict[str, str] = {
    "production_power": "pv_power",
    "consumption_power": "consumption_power",
    "battery_charge_power": "charge_power",
    "battery_discharge_power": "discharge_power",
    "grid_import_power": "grid_import_power",
    "grid_export_power": "grid_export_power",
    "state_of_charge": "soc",
    "state_of_health": "soh",
    "cycle_count": "cycles",
    "installed_capacity": "capacity",
    "remaining_energy": "remaining",
    "full_charge_capacity": "full_capacity",
    "system_status": "system_status",
    "status_led": "status_light",
    "problem": "problem",
    "on_grid": "on_grid",
    "backup_reserve": "backup_reserve",
    "operating_mode": "operating_mode",
    "solar_production_energy": "pv_energy",
    "home_consumption_energy": "consumption_energy",
    "grid_import_energy": "grid_import_energy",
    "grid_export_energy": "grid_export_energy",
}


def _version() -> str:
    # Cache buster: changes with every release of the integration.
    path = Path(__file__).parent / "manifest.json"
    return str(json.loads(path.read_text(encoding="utf-8")).get("version", "0"))


async def async_register_frontend(hass: HomeAssistant) -> None:
    """Static files, the global card script and the websocket command. Once."""
    if hass.data.get(_DATA_REGISTERED):
        return
    hass.data[_DATA_REGISTERED] = True
    folder = Path(__file__).parent / "frontend"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(FRONTEND_URL_BASE, str(folder), cache_headers=False)]
    )
    version = await hass.async_add_executor_job(_version)
    frontend.add_extra_js_url(hass, card_url(version))
    websocket_api.async_register_command(hass, ws_info)
    hass.data[f"{DOMAIN}_version"] = version


def card_url(version: str) -> str:
    return f"{FRONTEND_URL_BASE}/{CARD_FILENAME}?v={version}"


def panel_path(entry: SonnenConfigEntry) -> str:
    return f"zeo-sonnen-{entry.entry_id[-6:].lower()}"


async def async_register_panel(hass: HomeAssistant, entry: SonnenConfigEntry) -> None:
    version = hass.data.get(f"{DOMAIN}_version", "0")
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=PANEL_ELEMENT,
        frontend_url_path=panel_path(entry),
        sidebar_title="sonnenBatterie",
        sidebar_icon=PANEL_ICON,
        module_url=card_url(version),
        config={"entry_id": entry.entry_id},
        require_admin=False,
    )


@callback
def async_remove_panel(hass: HomeAssistant, entry: SonnenConfigEntry) -> None:
    frontend.async_remove_panel(hass, panel_path(entry), warn_if_unknown=False)


def entity_map(hass: HomeAssistant, entry: SonnenConfigEntry) -> dict[str, str]:
    """card key -> current entity_id, resolved through the entity registry."""
    serial = str(entry.runtime_data.serial)
    result: dict[str, str] = {}
    for reg_entry in er.async_entries_for_config_entry(er.async_get(hass), entry.entry_id):
        if not reg_entry.unique_id.startswith(f"{serial}_"):
            continue
        key = CARD_KEYS.get(reg_entry.unique_id[len(serial) + 1 :])
        if key:
            result[key] = reg_entry.entity_id
    return result


@websocket_api.websocket_command(
    {
        "type": "zeo_sonnen/info",
        vol.Optional("entry_id"): str,
    }
)
@callback
def ws_info(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Entities and model of one entry (or the first loaded one)."""
    entries = [e for e in hass.config_entries.async_entries(DOMAIN) if e.state is ConfigEntryState.LOADED]
    if msg.get("entry_id"):
        entries = [e for e in entries if e.entry_id == msg["entry_id"]]
    if not entries:
        connection.send_error(msg["id"], "not_found", "No loaded sonnenBatterie entry")
        return
    entry: SonnenConfigEntry = entries[0]
    coordinator = entry.runtime_data
    model_key = coordinator.model_key
    model = MODELS.get(model_key, MODELS[DEFAULT_MODEL])
    connection.send_result(
        msg["id"],
        {
            "entry_id": entry.entry_id,
            "title": entry.title,
            "model": model_key,
            "model_label": model["label"],
            "color": model["color"],
            "serial": coordinator.serial,
            "entities": entity_map(hass, entry),
        },
    )
