"""Driving the battery to a state of charge (set_target_soc)."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, call

import pytest
from homeassistant.const import ATTR_CONFIG_ENTRY_ID
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.zeo_sonnen.api import SonnenConnectionError
from custom_components.zeo_sonnen.const import DOMAIN
from custom_components.zeo_sonnen.target_soc import TARGET_POWER_W

from .conftest import SERIAL


@pytest.fixture
def manual(mock_api: MagicMock) -> MagicMock:
    """Battery in manual mode at 55 %."""
    config = mock_api.async_get_configurations.return_value
    config["EM_OperatingMode"] = "1"
    return mock_api


def _eid(hass: HomeAssistant) -> str:
    entity_id = er.async_get(hass).async_get_entity_id("sensor", DOMAIN, f"{SERIAL}_target_soc")
    assert entity_id
    return entity_id


async def _start(hass: HomeAssistant, entry_id: str, soc: int) -> None:
    await hass.services.async_call(
        DOMAIN, "set_target_soc", {ATTR_CONFIG_ENTRY_ID: entry_id, "soc": soc}, blocking=True
    )


async def _poll(hass: HomeAssistant, entry: MockConfigEntry, api: MagicMock, **status: Any) -> None:
    api.async_get_status.return_value.update(status)
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()


async def test_discharge_to_target_and_hold(
    hass: HomeAssistant, manual: MagicMock, mock_config_entry: MockConfigEntry
) -> None:
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(_eid(hass)).state == "idle"

    await _start(hass, mock_config_entry.entry_id, 28)
    manual.async_set_power_setpoint.assert_awaited_with("discharge", TARGET_POWER_W)
    state = hass.states.get(_eid(hass))
    assert state.state == "discharging"
    assert state.attributes["target"] == 28
    assert state.attributes["start_soc"] == 55

    # still above the target: keeps running, no 0 W
    await _poll(hass, mock_config_entry, manual, USOC=40)
    assert hass.states.get(_eid(hass)).state == "discharging"
    assert call("charge", 0) not in manual.async_set_power_setpoint.await_args_list

    # target reached: 0 W, stays in manual mode
    await _poll(hass, mock_config_entry, manual, USOC=28)
    manual.async_set_power_setpoint.assert_awaited_with("charge", 0)
    assert hass.states.get(_eid(hass)).state == "reached"
    manual.async_set_configuration.assert_not_awaited()


async def test_charge_to_target(
    hass: HomeAssistant, manual: MagicMock, mock_config_entry: MockConfigEntry
) -> None:
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    await _start(hass, mock_config_entry.entry_id, 80)
    manual.async_set_power_setpoint.assert_awaited_with("charge", TARGET_POWER_W)
    await _poll(hass, mock_config_entry, manual, USOC=81)
    manual.async_set_power_setpoint.assert_awaited_with("charge", 0)
    assert hass.states.get(_eid(hass)).state == "reached"


async def test_needs_manual_mode(hass: HomeAssistant, init_integration: MockConfigEntry) -> None:
    with pytest.raises(ServiceValidationError) as err:
        await _start(hass, init_integration.entry_id, 28)
    assert err.value.translation_key == "target_soc_manual_required"


async def test_already_there(
    hass: HomeAssistant, manual: MagicMock, mock_config_entry: MockConfigEntry
) -> None:
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    with pytest.raises(ServiceValidationError) as err:
        await _start(hass, mock_config_entry.entry_id, 55)
    assert err.value.translation_key == "target_soc_already"


async def test_setpoint_rejected(
    hass: HomeAssistant, manual: MagicMock, mock_config_entry: MockConfigEntry
) -> None:
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    manual.async_set_power_setpoint.side_effect = SonnenConnectionError("no")
    with pytest.raises(HomeAssistantError) as err:
        await _start(hass, mock_config_entry.entry_id, 28)
    assert err.value.translation_key == "setpoint_failed"
    assert hass.states.get(_eid(hass)).state == "aborted"


async def test_stop_and_mode_change_end_the_run(
    hass: HomeAssistant, manual: MagicMock, mock_config_entry: MockConfigEntry
) -> None:
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    entry_id = mock_config_entry.entry_id

    # stop button = set_power 0 W
    await _start(hass, entry_id, 28)
    await hass.services.async_call(
        DOMAIN,
        "set_power",
        {ATTR_CONFIG_ENTRY_ID: entry_id, "direction": "charge", "power": 0},
        blocking=True,
    )
    state = hass.states.get(_eid(hass))
    assert state.state == "stopped"
    assert state.attributes["reason"] == "setpoint"
    await _poll(hass, mock_config_entry, manual, USOC=28)
    assert hass.states.get(_eid(hass)).state == "stopped"

    # operating mode changed elsewhere
    await _start(hass, entry_id, 20)
    manual.async_get_configurations.return_value["EM_OperatingMode"] = "2"
    await _poll(hass, mock_config_entry, manual)
    state = hass.states.get(_eid(hass))
    assert state.state == "aborted"
    assert state.attributes["reason"] == "mode_changed"


async def test_battery_unreachable_keeps_the_run(
    hass: HomeAssistant, manual: MagicMock, mock_config_entry: MockConfigEntry
) -> None:
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    await _start(hass, mock_config_entry.entry_id, 28)
    manual.async_get_status.side_effect = SonnenConnectionError("down")
    await mock_config_entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    manual.async_get_status.side_effect = None
    await _poll(hass, mock_config_entry, manual, USOC=30)
    assert hass.states.get(_eid(hass)).state == "discharging"


async def test_restart_during_run_stops_with_zero(
    hass: HomeAssistant, manual: MagicMock, mock_config_entry: MockConfigEntry
) -> None:
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    await _start(hass, mock_config_entry.entry_id, 28)

    # unload (as on HA shutdown): 0 W right away
    manual.async_set_power_setpoint.reset_mock()
    assert await hass.config_entries.async_unload(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    manual.async_set_power_setpoint.assert_awaited_once_with("charge", 0)

    # next start: run is not resumed, 0 W again, state aborted (restart)
    manual.async_set_power_setpoint.reset_mock()
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    manual.async_set_power_setpoint.assert_awaited_once_with("charge", 0)
    state = hass.states.get(_eid(hass))
    assert state.state == "aborted"
    assert state.attributes["reason"] == "restart"

    # and only once
    manual.async_set_power_setpoint.reset_mock()
    assert await hass.config_entries.async_reload(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    manual.async_set_power_setpoint.assert_not_awaited()


async def test_info_has_target_soc(hass: HomeAssistant, init_integration: MockConfigEntry) -> None:
    from custom_components.zeo_sonnen.frontend import entity_map

    assert entity_map(hass, init_integration)["target_soc"] == _eid(hass)
