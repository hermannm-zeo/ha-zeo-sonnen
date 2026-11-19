"""OCPP 1.6J central system on Home Assistant's own HTTP port.

The wallbox connects to ws://<HA>:8123/api/zeo_sonnen/ocpp/ and appends its id itself.
No extra port, no firewall rule (tested with the Alfen / sonnenCharger 3 on 19.11.2026).

The box does not authenticate (OCPP security profile 0), so only connections from private
LAN addresses are accepted; remote access through Home Assistant Cloud is refused.
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import logging
import re
import time
from datetime import datetime
from typing import Any

from aiohttp import WSMsgType, web
from homeassistant.components.http import HomeAssistantView
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.network import is_cloud_connection

from .const import DOMAIN
from .ocpp_charge_point import ChargePointState, ZeoChargePoint

_LOGGER = logging.getLogger(__name__)

OCPP_PATH = f"/api/{DOMAIN}/ocpp"
SUBPROTOCOL = "ocpp1.6"
SIGNAL_OCPP_UPDATE = f"{DOMAIN}_ocpp_update"  # args: cp_id
DATA_OCPP = f"{DOMAIN}_ocpp_server"
STATUS_REQUEST_DELAY = 5.0  # seconds after connecting before asking for the status
_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,48}$")


class ConnectionClosed(Exception):
    """The websocket is gone; ends ChargePoint.start()."""


class NotConnectedError(Exception):
    """The wallbox is not connected right now."""


class _Connection:
    """The recv/send interface the ocpp library expects, on top of an aiohttp websocket."""

    def __init__(self, ws: web.WebSocketResponse) -> None:
        self._ws = ws

    async def recv(self) -> str:
        while True:
            msg = await self._ws.receive()
            if msg.type == WSMsgType.TEXT:
                return str(msg.data)
            if msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED, WSMsgType.ERROR):
                raise ConnectionClosed

    async def send(self, data: str) -> None:
        await self._ws.send_str(data)


def remote_allowed(hass: HomeAssistant, remote: str | None) -> bool:
    """Private LAN addresses only; loopback and cloud connections are refused."""
    if not remote or is_cloud_connection(hass):
        return False
    try:
        ip = ipaddress.ip_address(remote)
    except ValueError:
        return False
    return ip.is_private and not ip.is_loopback


class OcppServer:
    """Keeps the connected boxes and their last known state."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.states: dict[str, ChargePointState] = {}
        self.charge_points: dict[str, ZeoChargePoint] = {}
        self._sockets: dict[str, web.WebSocketResponse] = {}
        self._last_tx = 0

    def next_transaction_id(self) -> int:
        """Unique and increasing across HA restarts (seconds since epoch, fits in int32 until 2038)."""
        self._last_tx = max(self._last_tx + 1, int(time.time()))
        return self._last_tx

    @callback
    def _updated(self, state: ChargePointState) -> None:
        async_dispatcher_send(self.hass, SIGNAL_OCPP_UPDATE, state.cp_id)

    async def async_handle(self, request: web.Request, cp_id: str) -> web.StreamResponse:
        if not _ID_RE.match(cp_id):
            return web.Response(status=404)
        if not remote_allowed(self.hass, request.remote):
            _LOGGER.warning("OCPP: refused %s from %s (LAN only)", cp_id, request.remote)
            return web.Response(status=403)
        offered = [
            p.strip() for p in request.headers.get("Sec-WebSocket-Protocol", "").split(",") if p.strip()
        ]
        if offered and SUBPROTOCOL not in offered:
            _LOGGER.warning("OCPP: %s offers %s, only %s is supported", cp_id, offered, SUBPROTOCOL)
            return web.Response(status=400, text=f"only {SUBPROTOCOL} is supported")

        ws = web.WebSocketResponse(protocols=(SUBPROTOCOL,), heartbeat=None)
        if not ws.can_prepare(request).ok:
            return web.Response(status=400, text="websocket upgrade expected")
        await ws.prepare(request)

        old = self._sockets.get(cp_id)
        if old is not None and not old.closed:
            _LOGGER.info("OCPP: %s connected again, closing the old connection", cp_id)
            await old.close()

        state = self.states.setdefault(cp_id, ChargePointState(cp_id))
        cp = ZeoChargePoint(cp_id, _Connection(ws), state, self._updated, self.next_transaction_id)
        self.charge_points[cp_id] = cp
        self._sockets[cp_id] = ws
        state.connected = True
        self._updated(state)
        _LOGGER.info("OCPP: %s connected from %s", cp_id, request.remote)

        setup_task = self.hass.async_create_background_task(
            self._after_connect(cp), f"{DOMAIN} ocpp setup {cp_id}"
        )
        try:
            await cp.start()
        except ConnectionClosed:
            pass
        finally:
            setup_task.cancel()
            if self._sockets.get(cp_id) is ws:
                del self._sockets[cp_id]
                self.charge_points.pop(cp_id, None)
                state.connected = False
                self._updated(state)
                _LOGGER.info("OCPP: %s disconnected", cp_id)
        return ws

    async def _after_connect(self, cp: ZeoChargePoint) -> None:
        """Refresh the status and make sure the box reports what we need. Never fatal."""
        await asyncio.sleep(STATUS_REQUEST_DELAY)
        for step in (cp.async_request_status, cp.async_ensure_configuration):
            try:
                await step()
            except Exception as err:
                _LOGGER.warning("OCPP %s: %s failed: %s", cp.id, step.__name__, err)

    # --- commands, used by the charge manager and the entities -----------------

    def _cp(self, cp_id: str) -> ZeoChargePoint:
        cp = self.charge_points.get(cp_id)
        if cp is None:
            raise NotConnectedError(cp_id)
        return cp

    async def async_set_limit(
        self, cp_id: str, amps: int, phases: int, valid_to: datetime | None = None
    ) -> bool:
        return await self._cp(cp_id).async_set_limit(amps, phases, valid_to)

    async def async_clear_limit(self, cp_id: str) -> bool:
        return await self._cp(cp_id).async_clear_limit()

    async def async_get_configuration(
        self, cp_id: str, keys: list[str] | None = None
    ) -> dict[str, str | None]:
        return await self._cp(cp_id).async_get_configuration(keys)

    async def async_change_configuration(self, cp_id: str, key: str, value: str) -> str:
        return await self._cp(cp_id).async_change_configuration(key, value)

    async def async_close(self, *_: Any) -> None:
        for ws in list(self._sockets.values()):
            with contextlib.suppress(Exception):
                await ws.close()


class OcppView(HomeAssistantView):
    """GET /api/zeo_sonnen/ocpp/{cp_id} upgrades to the OCPP websocket."""

    url = OCPP_PATH + "/{cp_id}"
    name = f"api:{DOMAIN}:ocpp"
    requires_auth = False  # the box cannot log in; remote_allowed() limits access to the LAN

    def __init__(self, server: OcppServer) -> None:
        self._server = server

    async def get(self, request: web.Request, cp_id: str) -> web.StreamResponse:
        return await self._server.async_handle(request, cp_id)


@callback
def async_setup_ocpp(hass: HomeAssistant) -> OcppServer:
    """Start the central system once per Home Assistant run."""
    server: OcppServer | None = hass.data.get(DATA_OCPP)
    if server is not None:
        return server
    server = OcppServer(hass)
    hass.data[DATA_OCPP] = server
    hass.http.register_view(OcppView(server))

    async def _stop(event: Event) -> None:
        await server.async_close()

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, _stop)
    return server
