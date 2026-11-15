"""Card, sidebar panel and the zeo_sonnen/info websocket command."""

from __future__ import annotations

import re

from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL, DATA_PANELS
from homeassistant.const import CONF_SCAN_INTERVAL
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.zeo_sonnen.const import CONF_DASHBOARD
from custom_components.zeo_sonnen.frontend import _version, panel_path


async def test_panel_and_card_registered(hass: HomeAssistant, init_integration: MockConfigEntry) -> None:
    path = panel_path(init_integration)
    panel = hass.data[DATA_PANELS][path]
    assert panel.config["_panel_custom"]["name"] == "zeo-sonnen-panel"
    assert panel.config["entry_id"] == init_integration.entry_id
    # entries without a dashboard choice keep the classic portal only
    assert panel.config["style"] == "classic"
    assert panel.sidebar_title == "sonnenBatterie Classic"
    assert panel_path(init_integration, "modern") not in hass.data[DATA_PANELS]
    assert any("zeo-sonnen-card.js" in url for url in hass.data[DATA_EXTRA_MODULE_URL].urls)

    await hass.config_entries.async_unload(init_integration.entry_id)
    await hass.async_block_till_done()
    assert path not in hass.data[DATA_PANELS]


async def test_ws_info(
    hass: HomeAssistant, init_integration: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "zeo_sonnen/info", "entry_id": init_integration.entry_id})
    msg = await client.receive_json()
    assert msg["success"]
    result = msg["result"]
    assert result["model"] == "performance"
    assert result["color"] == "black"
    assert result["protect"] == "none"
    assert result["backup"] is False
    entities = result["entities"]
    assert entities["soc"] == "sensor.sonnenbatterie_state_of_charge"
    assert entities["pv_power"] == "sensor.sonnenbatterie_solar_production_power"
    assert entities["backup_reserve"] == "number.sonnenbatterie_backup_reserve"
    assert entities["pv_energy"] == "sensor.sonnenbatterie_solar_production_energy"

    # renamed entities are followed
    from homeassistant.helpers import entity_registry as er

    er.async_get(hass).async_update_entity(
        "sensor.sonnenbatterie_state_of_charge", new_entity_id="sensor.firma_soc"
    )
    await client.send_json_auto_id({"type": "zeo_sonnen/info"})
    msg = await client.receive_json()
    assert msg["result"]["entities"]["soc"] == "sensor.firma_soc"


async def test_ws_info_not_found(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator, init_integration
) -> None:
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "zeo_sonnen/info", "entry_id": "nope"})
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "not_found"


async def test_dashboard_option_both(hass: HomeAssistant, init_integration: MockConfigEntry) -> None:
    """Switching to both adds the modern panel next to the classic one; unload removes both."""
    result = await hass.config_entries.options.async_init(init_integration.entry_id)
    await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_SCAN_INTERVAL: 10, CONF_DASHBOARD: "both"}
    )
    await hass.async_block_till_done()
    panels = hass.data[DATA_PANELS]
    classic, modern = panel_path(init_integration, "classic"), panel_path(init_integration, "modern")
    assert panels[classic].config["style"] == "classic"
    assert panels[modern].config["style"] == "modern"
    assert panels[modern].sidebar_title == "sonnenBatterie Modern"
    assert modern != classic

    result = await hass.config_entries.options.async_init(init_integration.entry_id)
    await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_SCAN_INTERVAL: 10, CONF_DASHBOARD: "modern"}
    )
    await hass.async_block_till_done()
    assert modern in hass.data[DATA_PANELS]
    assert classic not in hass.data[DATA_PANELS]

    await hass.config_entries.async_unload(init_integration.entry_id)
    await hass.async_block_till_done()
    assert modern not in hass.data[DATA_PANELS]


def test_version_has_frontend_hash() -> None:
    """The card URL changes whenever a frontend file changes (cache buster)."""
    assert re.fullmatch(r"\d+\.\d+\.\d+-[0-9a-f]{8}", _version())
