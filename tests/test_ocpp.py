"""OCPP 1.6J central system: a simulated sonnenCharger 3 talks to the real websocket view."""

from __future__ import annotations

import asyncio
import itertools
import json
from collections.abc import AsyncGenerator, Callable
from typing import Any
from unittest.mock import patch

import pytest
from aiohttp import ClientWebSocketResponse, WSMsgType
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util

from custom_components.zeo_sonnen import ocpp_server
from custom_components.zeo_sonnen.const import DOMAIN
from custom_components.zeo_sonnen.ocpp_server import (
    DATA_OCPP,
    OCPP_PATH,
    SIGNAL_OCPP_UPDATE,
    OcppServer,
    async_setup_ocpp,
    remote_allowed,
)

CP = "ACE0871215"


class Box:
    """Minimal charge point: sends CALLs, answers the CALLs of the central system."""

    def __init__(self, ws: ClientWebSocketResponse) -> None:
        self.ws = ws
        self._ids = itertools.count(1)
        self.received_calls: list[list[Any]] = []

    async def call(self, action: str, payload: dict[str, Any]) -> list[Any]:
        uid = str(next(self._ids))
        await self.ws.send_str(json.dumps([2, uid, action, payload]))
        while True:
            msg = await asyncio.wait_for(self.ws.receive(), 5)
            assert msg.type == WSMsgType.TEXT, msg
            frame = json.loads(msg.data)
            if frame[0] == 2:  # request from the central system
                self.received_calls.append(frame)
                await self.ws.send_str(json.dumps([3, frame[1], {"status": "Accepted"}]))
                continue
            assert frame[1] == uid
            return frame

    async def result(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        frame = await self.call(action, payload)
        assert frame[0] == 3, frame
        return frame[2]


@pytest.fixture
async def server(hass: HomeAssistant) -> OcppServer:
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    return hass.data[DATA_OCPP]


@pytest.fixture
def lan() -> Any:
    with (
        patch.object(ocpp_server, "remote_allowed", return_value=True),
        patch.object(ocpp_server, "STATUS_REQUEST_DELAY", 0),
    ):
        yield


@pytest.fixture
async def connect(
    hass: HomeAssistant, server: OcppServer, hass_client_no_auth: Callable[..., Any], lan: Any
) -> AsyncGenerator[Callable[..., Any]]:
    client = await hass_client_no_auth()
    sockets: list[ClientWebSocketResponse] = []

    async def _connect(cp_id: str = CP) -> Box:
        ws = await client.ws_connect(f"{OCPP_PATH}/{cp_id}", protocols=("ocpp1.6",))
        assert ws.protocol == "ocpp1.6"
        sockets.append(ws)
        return Box(ws)

    yield _connect
    for ws in sockets:
        await ws.close()


async def _settle(hass: HomeAssistant) -> None:
    for _ in range(5):
        await asyncio.sleep(0)
    await hass.async_block_till_done()


def _sv(value: float, measurand: str, unit: str, phase: str | None = None) -> dict[str, Any]:
    sv: dict[str, Any] = {"value": str(value), "measurand": measurand, "unit": unit}
    if phase:
        sv["phase"] = phase
    return sv


async def test_session(hass: HomeAssistant, server: OcppServer, connect: Callable[..., Any]) -> None:
    updates: list[str] = []
    async_dispatcher_connect(hass, SIGNAL_OCPP_UPDATE, updates.append)
    box = await connect()

    boot = await box.result(
        "BootNotification",
        {
            "chargePointVendor": "Alfen BV",
            "chargePointModel": "AHP02-60327",
            "chargePointSerialNumber": CP,
            "firmwareVersion": "2.8.0",
        },
    )
    assert boot["status"] == "Accepted"
    assert boot["interval"] == 60
    assert dt_util.parse_datetime(boot["currentTime"]) is not None

    state = server.states[CP]
    assert state.connected
    assert (state.vendor, state.model, state.serial, state.firmware) == (
        "Alfen BV",
        "AHP02-60327",
        CP,
        "2.8.0",
    )

    # The central system asks for the status right after connecting.
    await box.result("Heartbeat", {})
    assert [c[2] for c in box.received_calls] == ["TriggerMessage"]
    assert box.received_calls[0][3] == {"requestedMessage": "StatusNotification"}

    await box.result("StatusNotification", {"connectorId": 0, "errorCode": "NoError", "status": "Available"})
    await box.result("StatusNotification", {"connectorId": 1, "errorCode": "NoError", "status": "Preparing"})
    assert state.connector_status == "Preparing"
    assert not state.in_transaction
    assert state.session_energy_wh is None

    auth = await box.result("Authorize", {"idTag": "04A1B2C3"})
    assert auth["idTagInfo"]["status"] == "Accepted"

    start = await box.result(
        "StartTransaction",
        {"connectorId": 1, "idTag": "04A1B2C3", "meterStart": 1000000, "timestamp": "2026-11-20T10:00:00Z"},
    )
    tx = start["transactionId"]
    assert isinstance(tx, int)
    assert start["idTagInfo"]["status"] == "Accepted"
    assert state.transaction_id == tx

    await box.result("StatusNotification", {"connectorId": 1, "errorCode": "NoError", "status": "Charging"})
    assert state.in_transaction

    box_time = (dt_util.utcnow().replace(microsecond=0)).isoformat().replace("+00:00", "Z")
    sampled = [
        _sv(1002.5, "Energy.Active.Import.Register", "kWh"),
        _sv(10.1, "Current.Import", "A", "L1"),
        _sv(10.0, "Current.Import", "A", "L2"),
        _sv(9.9, "Current.Import", "A", "L3"),
        _sv(0.2, "Current.Import", "A", "N"),
        _sv(10, "Current.Offered", "A"),
        _sv(2380, "Power.Active.Import", "W", "L1"),
        _sv(2.39, "Power.Active.Import", "kW", "L2"),
        _sv(2390, "Power.Active.Import", "W", "L3"),
        _sv(231.4, "Voltage", "V", "L1-N"),
        _sv(232.0, "Voltage", "V", "L2-N"),
        _sv(230.9, "Voltage", "V", "L3-N"),
        {"value": "not a number", "measurand": "Voltage", "phase": "L1-N"},
    ]
    await box.result(
        "MeterValues",
        {
            "connectorId": 1,
            "transactionId": tx,
            "meterValue": [{"timestamp": box_time, "sampledValue": sampled}],
        },
    )
    assert state.energy_wh == 1002500
    assert state.session_energy_wh == 2500
    assert state.current_a == {"L1": 10.1, "L2": 10.0, "L3": 9.9, "N": 0.2}
    assert state.active_phases == 3
    assert state.current_offered_a == 10
    assert state.power_phase_w == {"L1": 2380, "L2": 2390, "L3": 2390}
    assert state.power_w == 7160
    assert state.voltage_v == {"L1": 231.4, "L2": 232.0, "L3": 230.9}
    assert state.clock_offset_s is not None and abs(state.clock_offset_s) < 5

    stop = await box.result(
        "StopTransaction",
        {"transactionId": tx, "meterStop": 1003000, "timestamp": box_time, "reason": "EVDisconnected"},
    )
    assert stop["idTagInfo"]["status"] == "Accepted"
    assert state.transaction_id is None
    assert state.last_stop_reason == "EVDisconnected"
    assert state.energy_wh == 1003000
    assert state.power_w == 0

    dt = await box.result("DataTransfer", {"vendorId": "Alfen BV", "messageId": "x"})
    assert dt["status"] == "UnknownVendorId"
    assert await box.result("FirmwareStatusNotification", {"status": "Idle"}) == {}
    assert await box.result("DiagnosticsStatusNotification", {"status": "Idle"}) == {}

    await box.ws.close()
    await _settle(hass)
    assert not state.connected
    assert CP not in server.charge_points
    assert updates and set(updates) == {CP}


async def test_meter_values_variants(server: OcppServer, connect: Callable[..., Any]) -> None:
    """Total power without phase, Wh units, default measurand, session already running."""
    box = await connect()
    await box.result(
        "MeterValues",
        {
            "connectorId": 1,
            "transactionId": 4711,
            "meterValue": [
                {
                    "timestamp": "2026-11-20T10:00:00Z",
                    "sampledValue": [
                        {"value": "123456"},  # default: Energy.Active.Import.Register in Wh
                        _sv(1.9, "Power.Active.Import", "kW"),
                        _sv(1900, "Power.Active.Import", "W", "L1"),
                        _sv(8.1, "Current.Import", "A", "L1"),
                        _sv(50, "Frequency", "Hertz"),
                    ],
                }
            ],
        },
    )
    state = server.states[CP]
    assert state.transaction_id == 4711
    assert state.energy_wh == 123456
    assert state.session_energy_wh is None  # start meter unknown after a reconnect
    assert state.power_w == 1900
    assert state.power_phase_w == {"L1": 1900}
    assert state.active_phases == 1


async def test_reconnect_replaces_old_connection(server: OcppServer, connect: Callable[..., Any]) -> None:
    first = await connect()
    await first.result("Heartbeat", {})
    second = await connect()
    await second.result("Heartbeat", {})
    msg = await asyncio.wait_for(first.ws.receive(), 5)
    assert msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.CLOSING)
    assert server.states[CP].connected


async def test_status_request_failure_is_ignored(server: OcppServer, connect: Callable[..., Any]) -> None:
    with patch(
        "custom_components.zeo_sonnen.ocpp_charge_point.ZeoChargePoint.async_request_status",
        side_effect=TimeoutError,
    ):
        box = await connect()
        await box.result("Heartbeat", {})
        await box.result("Heartbeat", {})
    assert server.states[CP].connected


async def test_server_closes_sockets(
    hass: HomeAssistant, server: OcppServer, connect: Callable[..., Any]
) -> None:
    box = await connect()
    await box.result("Heartbeat", {})
    await server.async_close()
    msg = await asyncio.wait_for(box.ws.receive(), 5)
    assert msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.CLOSING)
    await _settle(hass)
    assert not server.states[CP].connected


async def test_refused_outside_lan(server: OcppServer, hass_client_no_auth: Callable[..., Any]) -> None:
    client = await hass_client_no_auth()
    resp = await client.get(f"{OCPP_PATH}/{CP}")
    assert resp.status == 403


@pytest.mark.usefixtures("server", "lan")
async def test_bad_requests(hass_client_no_auth: Callable[..., Any]) -> None:
    client = await hass_client_no_auth()
    assert (await client.get(f"{OCPP_PATH}/{'x' * 60}")).status == 404
    assert (await client.get(f"{OCPP_PATH}/{CP}")).status == 400  # no websocket upgrade
    resp = await client.get(
        f"{OCPP_PATH}/{CP}",
        headers={
            "Connection": "Upgrade",
            "Upgrade": "websocket",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Protocol": "ocpp2.0.1",
        },
    )
    assert resp.status == 400


@pytest.mark.parametrize(
    ("remote", "cloud", "allowed"),
    [
        ("192.168.2.112", False, True),
        ("10.0.0.5", False, True),
        ("192.168.2.112", True, False),
        ("127.0.0.1", False, False),
        ("8.8.8.8", False, False),
        ("garbage", False, False),
        (None, False, False),
    ],
)
async def test_remote_allowed(hass: HomeAssistant, remote: str | None, cloud: bool, allowed: bool) -> None:
    with patch.object(ocpp_server, "is_cloud_connection", return_value=cloud):
        assert remote_allowed(hass, remote) is allowed


async def test_setup_once_and_transaction_ids(hass: HomeAssistant, server: OcppServer) -> None:
    assert async_setup_ocpp(hass) is server
    with patch.object(ocpp_server.time, "time", return_value=1_800_000_000):
        first = server.next_transaction_id()
        second = server.next_transaction_id()
    assert first == 1_800_000_000
    assert second == first + 1
