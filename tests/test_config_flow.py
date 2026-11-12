"""Config flow: setup, errors, duplicates, re-auth, reconfigure and options."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from homeassistant.config_entries import SOURCE_USER
from homeassistant.const import CONF_API_TOKEN, CONF_HOST, CONF_SCAN_INTERVAL
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.zeo_sonnen.api import SonnenAuthError, SonnenConnectionError
from custom_components.zeo_sonnen.const import CONF_MODEL, DOMAIN

from .conftest import HOST, SERIAL, TOKEN


async def test_user_flow(hass: HomeAssistant, mock_api: MagicMock) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "192.168.1.50", CONF_API_TOKEN: TOKEN}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "sonnenBatterie Performance"
    assert result["data"] == {CONF_HOST: HOST, CONF_API_TOKEN: TOKEN, CONF_MODEL: "performance"}
    assert result["result"].unique_id == SERIAL


async def test_user_flow_model(hass: HomeAssistant, mock_api: MagicMock) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "192.168.1.50", CONF_API_TOKEN: TOKEN, CONF_MODEL: "hybrid"}
    )
    assert result["title"] == "sonnenBatterie hybrid"
    assert result["data"][CONF_MODEL] == "hybrid"
    await hass.async_block_till_done()
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, SERIAL)})
    assert device is not None
    assert device.model == "sonnenBatterie hybrid"


@pytest.mark.parametrize(
    ("exc", "error"),
    [
        (SonnenAuthError("no"), "invalid_auth"),
        (SonnenConnectionError("down"), "cannot_connect"),
        (RuntimeError("boom"), "unknown"),
    ],
)
async def test_user_flow_errors_then_recovers(
    hass: HomeAssistant, mock_api: MagicMock, exc: Exception, error: str
) -> None:
    mock_api.async_get_status.side_effect = exc
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "192.168.1.50", CONF_API_TOKEN: TOKEN}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": error}

    mock_api.async_get_status.side_effect = None
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "192.168.1.50", CONF_API_TOKEN: TOKEN}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def test_falls_back_to_host_without_serial(hass: HomeAssistant, mock_api: MagicMock) -> None:
    mock_api.async_get_configurations.return_value = {}
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "192.168.1.50", CONF_API_TOKEN: TOKEN}
    )
    assert result["result"].unique_id == HOST


async def test_already_configured_updates_host(
    hass: HomeAssistant, mock_api: MagicMock, mock_config_entry: MockConfigEntry
) -> None:
    mock_config_entry.add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "192.168.1.99", CONF_API_TOKEN: TOKEN}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"
    assert mock_config_entry.data[CONF_HOST] == "http://192.168.1.99"


async def test_reauth(hass: HomeAssistant, mock_api: MagicMock, mock_config_entry: MockConfigEntry) -> None:
    mock_config_entry.add_to_hass(hass)
    result = await mock_config_entry.start_reauth_flow(hass)
    assert result["step_id"] == "reauth_confirm"

    mock_api.async_get_status.side_effect = SonnenAuthError("still wrong")
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_API_TOKEN: "bad"})
    assert result["errors"] == {"base": "invalid_auth"}

    mock_api.async_get_status.side_effect = None
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_API_TOKEN: "new-token"})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reauth_successful"
    assert mock_config_entry.data[CONF_API_TOKEN] == "new-token"


async def test_reconfigure(
    hass: HomeAssistant, mock_api: MagicMock, mock_config_entry: MockConfigEntry
) -> None:
    mock_config_entry.add_to_hass(hass)
    result = await mock_config_entry.start_reconfigure_flow(hass)
    assert result["step_id"] == "reconfigure"
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "10.0.0.5", CONF_API_TOKEN: "other"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reconfigure_successful"
    assert mock_config_entry.data == {CONF_HOST: "http://10.0.0.5", CONF_API_TOKEN: "other"}


async def test_reconfigure_replaced_power_unit(
    hass: HomeAssistant, mock_api: MagicMock, init_integration: MockConfigEntry
) -> None:
    """A new serial (power unit swapped) keeps entity IDs, device and entry."""
    ent_reg = er.async_get(hass)
    soc_id = "sensor.sonnenbatterie_state_of_charge"
    assert ent_reg.async_get(soc_id).unique_id == f"{SERIAL}_state_of_charge"

    mock_api.async_get_configurations.return_value = {"DE_Ticket_Number": "999999"}
    result = await init_integration.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "10.0.0.5", CONF_API_TOKEN: "new"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "replace_unit"
    assert result["description_placeholders"] == {"old": SERIAL, "new": "999999"}

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "unit_replaced"
    await hass.async_block_till_done()

    assert init_integration.unique_id == "999999"
    assert init_integration.data[CONF_HOST] == "http://10.0.0.5"
    assert ent_reg.async_get(soc_id).unique_id == "999999_state_of_charge"
    assert dr.async_get(hass).async_get_device(identifiers={(DOMAIN, "999999")}) is not None
    # no duplicates were created
    assert ent_reg.async_get("sensor.sonnenbatterie_state_of_charge_2") is None
    assert len(hass.config_entries.async_entries(DOMAIN)) == 1


async def test_reconfigure_serial_of_other_entry(
    hass: HomeAssistant, mock_api: MagicMock, mock_config_entry: MockConfigEntry
) -> None:
    mock_config_entry.add_to_hass(hass)
    MockConfigEntry(
        domain=DOMAIN, unique_id="999999", data={CONF_HOST: "x", CONF_API_TOKEN: "y"}
    ).add_to_hass(hass)
    mock_api.async_get_configurations.return_value = {"DE_Ticket_Number": "999999"}
    result = await mock_config_entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "10.0.0.5", CONF_API_TOKEN: TOKEN}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"
    assert mock_config_entry.data[CONF_HOST] == HOST


async def test_options_flow(hass: HomeAssistant, init_integration: MockConfigEntry) -> None:
    result = await hass.config_entries.options.async_init(init_integration.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(result["flow_id"], {CONF_SCAN_INTERVAL: 30})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    assert init_integration.options == {CONF_SCAN_INTERVAL: 30, CONF_MODEL: "performance"}
    assert init_integration.runtime_data.update_interval.total_seconds() == 30


async def test_options_flow_model(hass: HomeAssistant, init_integration: MockConfigEntry) -> None:
    result = await hass.config_entries.options.async_init(init_integration.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_SCAN_INTERVAL: 10, CONF_MODEL: "eco"}
    )
    await hass.async_block_till_done()
    assert init_integration.runtime_data.model_key == "eco"
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, SERIAL)})
    assert device.model == "sonnenBatterie 10 / eco"
