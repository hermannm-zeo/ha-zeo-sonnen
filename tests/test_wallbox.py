"""Wallbox device and entities: an entry with a wallbox id, a simulated box connects."""

from __future__ import annotations

from collections.abc import AsyncGenerator, Callable
from datetime import timedelta
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from homeassistant.const import CONF_API_TOKEN, CONF_HOST, STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant, State
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry, mock_restore_cache_with_extra_data

from custom_components.zeo_sonnen import ocpp_server
from custom_components.zeo_sonnen.const import DOMAIN
from custom_components.zeo_sonnen.ocpp_server import DATA_OCPP, OCPP_PATH, OcppServer

from .conftest import HOST, SERIAL, TOKEN
from .test_ocpp import CALL_ERROR, Box, _settle, _sv

CP = "ACE0871215"


@pytest.fixture
def wallbox_entry() -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        title="sonnenBatterie Performance",
        unique_id=SERIAL,
        data={CONF_HOST: HOST, CONF_API_TOKEN: TOKEN},
        options={"wallbox_id": CP, "wallbox_max_current": 16},
    )


@pytest.fixture
async def loaded(hass: HomeAssistant, wallbox_entry: MockConfigEntry, mock_api: MagicMock) -> MockConfigEntry:
    wallbox_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(wallbox_entry.entry_id)
    await hass.async_block_till_done()
    return wallbox_entry


@pytest.fixture
async def connect(
    hass: HomeAssistant, hass_client_no_auth: Callable[..., Any]
) -> AsyncGenerator[Callable[..., Any]]:
    boxes: list[Box] = []
    clients: list[Any] = []
    with (
        patch.object(ocpp_server, "remote_allowed", return_value=True),
        patch.object(ocpp_server, "STATUS_REQUEST_DELAY", 0),
    ):

        async def _connect(cp_id: str = CP) -> Box:
            if not clients:  # created on first use, after the integration (and http) is loaded
                clients.append(await hass_client_no_auth())
            ws = await clients[0].ws_connect(f"{OCPP_PATH}/{cp_id}", protocols=("ocpp1.6",))
            box = Box(ws)
            boxes.append(box)
            await box.wait_calls(4)  # status, boot, meter values, settings
            return box

        yield _connect
        for box in boxes:
            await box.ws.close()


def _eid(hass: HomeAssistant, platform: str, key: str) -> str:
    entity_id = er.async_get(hass).async_get_entity_id(platform, DOMAIN, f"{SERIAL}_wallbox_{key}")
    assert entity_id, key
    return entity_id


def _state(hass: HomeAssistant, platform: str, key: str) -> Any:
    return hass.states.get(_eid(hass, platform, key))


async def _boot(box: Box) -> None:
    await box.result(
        "BootNotification",
        {
            "chargePointVendor": "Alfen BV",
            "chargePointModel": "AHP02-60327",
            "chargePointSerialNumber": CP,
            "firmwareVersion": "2.8.0",
        },
    )
    await box.result("StatusNotification", {"connectorId": 0, "errorCode": "NoError", "status": "Available"})
    await box.result("StatusNotification", {"connectorId": 1, "errorCode": "NoError", "status": "Available"})


async def test_no_wallbox_without_option(
    hass: HomeAssistant, init_integration: MockConfigEntry, connect: Callable[..., Any], hass_ws_client: Any
) -> None:
    ent_reg = er.async_get(hass)
    assert not [e for e in ent_reg.entities.values() if "_wallbox_" in e.unique_id]
    with pytest.raises(Exception, match="404"):
        await connect()
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "zeo_sonnen/info"})
    assert (await ws.receive_json())["result"]["wallbox"] is None


async def test_entities_follow_the_box(
    hass: HomeAssistant, loaded: MockConfigEntry, connect: Callable[..., Any]
) -> None:
    # before the box connects: everything unavailable, "connected" is off
    assert _state(hass, "sensor", "power").state == STATE_UNAVAILABLE
    assert _state(hass, "binary_sensor", "connected").state == "off"

    box = await connect()
    await _boot(box)
    await _settle(hass)
    assert _state(hass, "binary_sensor", "connected").state == "on"
    assert _state(hass, "sensor", "status").state == "Available"
    assert _state(hass, "sensor", "power").state == "0.0"
    assert _state(hass, "switch", "available").state == "on"

    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, f"{SERIAL}_wallbox")})
    assert device is not None
    assert (device.model, device.model_id, device.sw_version) == ("sonnenCharger 3", "AHP02-60327", "2.8.0")
    assert device.serial_number == CP
    battery = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, SERIAL)})
    assert battery is not None and device.via_device_id == battery.id

    start = dt_util.utcnow().replace(microsecond=0)
    tx = (
        await box.result(
            "StartTransaction",
            {"connectorId": 1, "idTag": "04A1", "meterStart": 1000000, "timestamp": start.isoformat()},
        )
    )["transactionId"]
    await box.result("StatusNotification", {"connectorId": 1, "errorCode": "NoError", "status": "Charging"})
    await box.result(
        "MeterValues",
        {
            "connectorId": 1,
            "transactionId": tx,
            "meterValue": [
                {
                    "timestamp": dt_util.utcnow().isoformat(),
                    "sampledValue": [
                        _sv(1002500, "Energy.Active.Import.Register", "Wh"),
                        _sv(10.1, "Current.Import", "A", "L1"),
                        _sv(10.0, "Current.Import", "A", "L2"),
                        _sv(9.9, "Current.Import", "A", "L3"),
                        _sv(10, "Current.Offered", "A"),
                        _sv(2380, "Power.Active.Import", "W", "L1"),
                        _sv(2390, "Power.Active.Import", "W", "L2"),
                        _sv(2390, "Power.Active.Import", "W", "L3"),
                        _sv(230, "Voltage", "V", "L1-N"),
                        _sv(232, "Voltage", "V", "L2-N"),
                        _sv(231, "Voltage", "V", "L3-N"),
                    ],
                }
            ],
        },
    )
    await _settle(hass)
    power = _state(hass, "sensor", "power")
    assert power.state == "7160.0"
    assert power.attributes["L1"] == 2380
    current = _state(hass, "sensor", "current")
    assert current.state == "10.1"
    assert current.attributes["L3"] == 9.9
    assert _state(hass, "sensor", "voltage").state == "231.0"
    assert _state(hass, "sensor", "voltage").attributes["L2"] == 232
    assert _state(hass, "sensor", "current_offered").state == "10.0"
    assert float(_state(hass, "sensor", "energy_total").state) == 1002.5
    assert float(_state(hass, "sensor", "session_energy").state) == 2.5
    assert float(_state(hass, "sensor", "session_duration").state) >= 0
    assert abs(float(_state(hass, "sensor", "clock_offset").state)) < 5
    assert _state(hass, "sensor", "last_seen").state != STATE_UNAVAILABLE
    assert _state(hass, "sensor", "error_code").state == "NoError"

    # limit set through the action shows up in the limit sensor
    await hass.services.async_call(
        DOMAIN,
        "wallbox_set_limit",
        {"charge_point_id": CP, "current": 8, "phases": 1, "valid_for": 5},
        blocking=True,
    )
    await _settle(hass)
    limit = _state(hass, "sensor", "limit")
    assert limit.state == "8"
    assert limit.attributes["phases"] == 1
    assert limit.attributes["valid_to"] is not None

    # pause: not charging any more -> power 0, phase values 0
    await box.result(
        "StatusNotification", {"connectorId": 1, "errorCode": "NoError", "status": "SuspendedEVSE"}
    )
    await _settle(hass)
    assert _state(hass, "sensor", "power").state == "0.0"
    assert _state(hass, "sensor", "current").attributes["N"] == 0.0

    end = start + timedelta(minutes=30)
    await box.result(
        "StopTransaction",
        {"transactionId": tx, "meterStop": 1003000, "timestamp": end.isoformat(), "reason": "EVDisconnected"},
    )
    await _settle(hass)
    assert _state(hass, "sensor", "stop_reason").state == "EVDisconnected"
    assert float(_state(hass, "sensor", "session_duration").state) == 30

    await box.ws.close()
    await box.closed()
    await _settle(hass)
    assert _state(hass, "binary_sensor", "connected").state == "off"
    assert _state(hass, "sensor", "status").state == STATE_UNAVAILABLE


async def test_switch_blocks_and_releases(
    hass: HomeAssistant, loaded: MockConfigEntry, connect: Callable[..., Any]
) -> None:
    box = await connect()
    switch = _eid(hass, "switch", "available")
    assert hass.states.get(switch).state == "unknown"  # no status of connector 0 yet
    await _boot(box)

    await hass.services.async_call("switch", "turn_off", {"entity_id": switch}, blocking=True)
    assert box.received_calls[-1][2:] == ["ChangeAvailability", {"connectorId": 0, "type": "Inoperative"}]
    await box.result(
        "StatusNotification", {"connectorId": 0, "errorCode": "NoError", "status": "Unavailable"}
    )
    await _settle(hass)
    assert hass.states.get(switch).state == "off"

    await hass.services.async_call("switch", "turn_on", {"entity_id": switch}, blocking=True)
    assert box.received_calls[-1][3]["type"] == "Operative"

    box.answers["ChangeAvailability"] = {"status": "Rejected"}
    with pytest.raises(HomeAssistantError) as err:
        await hass.services.async_call("switch", "turn_on", {"entity_id": switch}, blocking=True)
    assert err.value.translation_key == "wallbox_rejected"

    box.answers["ChangeAvailability"] = CALL_ERROR
    with pytest.raises(HomeAssistantError) as err:
        await hass.services.async_call("switch", "turn_off", {"entity_id": switch}, blocking=True)
    assert err.value.translation_key == "wallbox_command_failed"


async def test_info_has_wallbox(
    hass: HomeAssistant, loaded: MockConfigEntry, connect: Callable[..., Any], hass_ws_client: Any
) -> None:
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "zeo_sonnen/info"})
    wallbox = (await ws.receive_json())["result"]["wallbox"]
    assert wallbox["charge_point_id"] == CP
    assert wallbox["max_current"] == 16
    assert wallbox["connected"] is False
    assert wallbox["device"] == {"vendor": None, "model": None, "firmware": None, "serial": CP}
    assert wallbox["entities"]["power"] == _eid(hass, "sensor", "power")
    assert wallbox["entities"]["connected"] == _eid(hass, "binary_sensor", "connected")
    assert wallbox["entities"]["available"] == _eid(hass, "switch", "available")
    assert len(wallbox["entities"]) == 15

    box = await connect()
    await _boot(box)
    await ws.send_json({"id": 2, "type": "zeo_sonnen/info"})
    wallbox = (await ws.receive_json())["result"]["wallbox"]
    assert wallbox["connected"] is True
    assert wallbox["device"]["model"] == "AHP02-60327"
    assert wallbox["device"]["firmware"] == "2.8.0"


async def test_id_is_matched_without_case(
    hass: HomeAssistant, mock_api: MagicMock, connect: Callable[..., Any]
) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=SERIAL,
        data={CONF_HOST: HOST, CONF_API_TOKEN: TOKEN},
        options={"wallbox_id": "ace0871215"},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    box = await connect("ACE0871215")
    await _boot(box)
    server: OcppServer = hass.data[DATA_OCPP]
    assert server.states["ace0871215"].connected
    assert "ACE0871215" not in server.states


async def test_unload_withdraws_the_box(
    hass: HomeAssistant, loaded: MockConfigEntry, connect: Callable[..., Any]
) -> None:
    box = await connect()
    await _boot(box)
    assert await hass.config_entries.async_unload(loaded.entry_id)
    await hass.async_block_till_done()
    assert await box.closed()
    with pytest.raises(Exception, match="404"):
        await connect()


async def test_model_and_firmware_survive_a_restart(
    hass: HomeAssistant, loaded: MockConfigEntry, connect: Callable[..., Any]
) -> None:
    """The box reconnects after an HA restart without a BootNotification."""
    box = await connect()
    await _boot(box)
    await _settle(hass)
    assert await hass.config_entries.async_reload(loaded.entry_id)
    await hass.async_block_till_done()
    server: OcppServer = hass.data[DATA_OCPP]
    server.states[CP].model = server.states[CP].firmware = None  # as after a restart
    assert await hass.config_entries.async_reload(loaded.entry_id)
    await hass.async_block_till_done()
    assert (server.states[CP].model, server.states[CP].firmware) == ("AHP02-60327", "2.8.0")

    box = await connect()
    # firmware known again -> no BootNotification requested
    assert [c[3].get("requestedMessage") for c in box.received_calls[:3]] == [
        "StatusNotification",
        None,  # GetConfiguration
        "MeterValues",
    ]


async def test_counter_reading_survives_a_restart(
    hass: HomeAssistant, wallbox_entry: MockConfigEntry, mock_api: MagicMock, connect: Callable[..., Any]
) -> None:
    """The Alfen sends no meter values when idle: the last reading is kept over a restart."""
    eid = "sensor.wallbox_meter"
    er.async_get(hass).async_get_or_create(
        "sensor", DOMAIN, f"{SERIAL}_wallbox_energy_total", suggested_object_id="wallbox_meter"
    )
    mock_restore_cache_with_extra_data(
        hass, [(State(eid, "1234.5"), {"native_value": 1234.5, "native_unit_of_measurement": "kWh"})]
    )
    wallbox_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(wallbox_entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(eid).state == STATE_UNAVAILABLE  # box not connected yet

    box = await connect()
    await _boot(box)
    await _settle(hass)
    assert float(hass.states.get(eid).state) == 1234.5

    # a real value from the box wins
    await box.result(
        "MeterValues",
        {
            "connectorId": 1,
            "meterValue": [
                {
                    "timestamp": dt_util.utcnow().isoformat(),
                    "sampledValue": [_sv(1240000, "Energy.Active.Import.Register", "Wh")],
                }
            ],
        },
    )
    await _settle(hass)
    assert float(hass.states.get(eid).state) == 1240.0


async def test_counter_reading_not_restored_when_unknown(
    hass: HomeAssistant, wallbox_entry: MockConfigEntry, mock_api: MagicMock
) -> None:
    eid = "sensor.wallbox_meter"
    er.async_get(hass).async_get_or_create(
        "sensor", DOMAIN, f"{SERIAL}_wallbox_energy_total", suggested_object_id="wallbox_meter"
    )
    mock_restore_cache_with_extra_data(
        hass, [(State(eid, "unknown"), {"native_value": None, "native_unit_of_measurement": "kWh"})]
    )
    wallbox_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(wallbox_entry.entry_id)
    await hass.async_block_till_done()
    assert hass.data[DATA_OCPP].states[CP].energy_wh is None
