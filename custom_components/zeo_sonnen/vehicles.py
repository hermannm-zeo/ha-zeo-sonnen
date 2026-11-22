"""Vehicle catalogue and the household's vehicles (for target charging).

* The catalogue (``vehicles.json``) ships with the integration. It is built by
  ``tools/build_vehicle_db.py`` from two open datasets, see ``sources`` in the
  file. Brand -> model -> variant, with usable capacity and AC charging data.
* The household's vehicles live in a Store (one list per Home Assistant), so
  every user of the customer dashboard sees the same cars. No admin rights are
  needed: the customer picks his own car.

Websocket commands (all return the full state where it changes):

    zeo_sonnen/vehicles/catalog   {brand?, model?}  brands | models | variants
    zeo_sonnen/vehicles/search    {query}           matching models over all brands
    zeo_sonnen/vehicles/list                        {vehicles, active}
    zeo_sonnen/vehicles/save      {vehicle}         add (no id) or update
    zeo_sonnen/vehicles/delete    {vehicle_id}
    zeo_sonnen/vehicles/activate  {vehicle_id}
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .schema import vol

CATALOG_FILE = Path(__file__).parent / "vehicles.json"
STORE_KEY = f"{DOMAIN}.vehicles"
STORE_VERSION = 1
SIGNAL_VEHICLES = f"{DOMAIN}_vehicles"
MAX_VEHICLES = 10
SEARCH_LIMIT = 30

_DATA_CATALOG = f"{DOMAIN}_vehicle_catalog"
_DATA_STORE = f"{DOMAIN}_vehicle_store"


def _strip(value: str) -> str:
    return value.strip()


def _text(max_len: int) -> Any:
    return vol.All(str, _strip, vol.Length(max=max_len))


VEHICLE_SCHEMA = vol.Schema(
    {
        vol.Optional("id"): vol.Any(None, _text(40)),
        vol.Optional("name", default=""): _text(40),
        vol.Required("brand"): vol.All(_text(40), vol.Length(min=1)),
        vol.Required("model"): vol.All(_text(60), vol.Length(min=1)),
        vol.Optional("variant", default=""): _text(80),
        vol.Optional("years"): vol.Any(None, [vol.All(int, vol.Range(min=1990, max=2100))]),
        vol.Required("capacity_kwh"): vol.All(vol.Coerce(float), vol.Range(min=5, max=250)),
        vol.Required("ac_kw"): vol.All(vol.Coerce(float), vol.Range(min=1.4, max=22)),
        vol.Required("phases"): vol.In([1, 2, 3]),
        vol.Optional("catalog_id"): vol.Any(None, _text(120)),
    }
)


# ---------- catalogue ----------


async def async_catalog(hass: HomeAssistant) -> dict[str, Any]:
    """The bundled catalogue, read once."""
    data = hass.data.get(_DATA_CATALOG)
    if data is None:
        data = await hass.async_add_executor_job(_read_catalog)
        hass.data[_DATA_CATALOG] = data
    return data


def _read_catalog() -> dict[str, Any]:
    try:
        return json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"version": None, "count": 0, "sources": [], "brands": []}


def _years(items: list[dict[str, Any]]) -> list[int] | None:
    ys = [y for it in items if it.get("y") for y in it["y"]]
    return [min(ys), max(ys)] if ys else None


def _find(seq: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    low = name.strip().lower()
    return next((x for x in seq if x["n"].lower() == low), None)


# ---------- household store ----------


class VehicleStore:
    """The household's vehicles and the one in use."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORE_VERSION, STORE_KEY)
        self.vehicles: list[dict[str, Any]] = []
        self.active: str | None = None

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.vehicles = [v for v in data.get("vehicles", []) if isinstance(v, dict) and v.get("id")]
        self.active = data.get("active")
        if self.active not in {v["id"] for v in self.vehicles}:
            self.active = self.vehicles[0]["id"] if self.vehicles else None

    def as_dict(self) -> dict[str, Any]:
        return {"vehicles": self.vehicles, "active": self.active}

    def active_vehicle(self) -> dict[str, Any] | None:
        return next((v for v in self.vehicles if v["id"] == self.active), None)

    async def _async_save(self) -> None:
        await self._store.async_save(self.as_dict())
        async_dispatcher_send(self.hass, SIGNAL_VEHICLES)

    async def async_upsert(self, vehicle: dict[str, Any]) -> dict[str, Any]:
        vehicle = dict(vehicle)
        if not vehicle.get("name"):
            vehicle["name"] = f"{vehicle['brand']} {vehicle['model']}"
        vid = vehicle.get("id")
        idx = next((i for i, v in enumerate(self.vehicles) if v["id"] == vid), None) if vid else None
        if idx is None:
            if len(self.vehicles) >= MAX_VEHICLES:
                raise ValueError("too_many")
            vehicle["id"] = uuid.uuid4().hex[:12]
            self.vehicles.append(vehicle)
            self.active = vehicle["id"]  # a newly added car is the one in use
        else:
            self.vehicles[idx] = vehicle
        await self._async_save()
        return vehicle

    async def async_delete(self, vehicle_id: str) -> None:
        self.vehicles = [v for v in self.vehicles if v["id"] != vehicle_id]
        if self.active == vehicle_id:
            self.active = self.vehicles[0]["id"] if self.vehicles else None
        await self._async_save()

    async def async_activate(self, vehicle_id: str) -> None:
        if vehicle_id not in {v["id"] for v in self.vehicles}:
            raise KeyError(vehicle_id)
        self.active = vehicle_id
        await self._async_save()


async def async_get_store(hass: HomeAssistant) -> VehicleStore:
    store: VehicleStore | None = hass.data.get(_DATA_STORE)
    if store is None:
        store = VehicleStore(hass)
        await store.async_load()
        hass.data[_DATA_STORE] = store
    return store


# ---------- websocket ----------


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    for cmd in (ws_catalog, ws_search, ws_list, ws_save, ws_delete, ws_activate):
        websocket_api.async_register_command(hass, cmd)


@websocket_api.websocket_command(
    {
        "type": "zeo_sonnen/vehicles/catalog",
        vol.Optional("brand"): str,
        vol.Optional("model"): str,
    }
)
@websocket_api.async_response
async def ws_catalog(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Brands; with brand: its models; with brand and model: the variants."""
    cat = await async_catalog(hass)
    meta = {"version": cat.get("version"), "count": cat.get("count", 0), "sources": cat.get("sources", [])}
    if not msg.get("brand"):
        brands = [{"n": b["n"], "models": len(b["m"]), "y": _years(b["m"])} for b in cat["brands"]]
        connection.send_result(msg["id"], {**meta, "brands": brands})
        return
    brand = _find(cat["brands"], msg["brand"])
    if brand is None:
        connection.send_error(msg["id"], "not_found", "Unknown brand")
        return
    if not msg.get("model"):
        models = [{"n": m["n"], "y": m.get("y"), "variants": len(m["v"])} for m in brand["m"]]
        connection.send_result(msg["id"], {**meta, "brand": brand["n"], "models": models})
        return
    model = _find(brand["m"], msg["model"])
    if model is None:
        connection.send_error(msg["id"], "not_found", "Unknown model")
        return
    connection.send_result(
        msg["id"],
        {**meta, "brand": brand["n"], "model": model["n"], "y": model.get("y"), "variants": model["v"]},
    )


@websocket_api.websocket_command(
    {"type": "zeo_sonnen/vehicles/search", vol.Required("query"): vol.All(str, vol.Length(min=2, max=60))}
)
@websocket_api.async_response
async def ws_search(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Models whose 'brand model' contains every word of the query."""
    cat = await async_catalog(hass)
    words = [w for w in msg["query"].lower().split() if w]
    hits: list[dict[str, Any]] = []
    for b in cat["brands"]:
        for m in b["m"]:
            hay = f"{b['n']} {m['n']}".lower()
            if all(w in hay for w in words):
                hits.append({"brand": b["n"], "model": m["n"], "y": m.get("y"), "variants": len(m["v"])})
    hits.sort(
        key=lambda h: (not h["model"].lower().startswith(words[-1]), h["brand"].lower(), h["model"].lower())
    )
    connection.send_result(msg["id"], {"results": hits[:SEARCH_LIMIT], "total": len(hits)})


@websocket_api.websocket_command({"type": "zeo_sonnen/vehicles/list"})
@websocket_api.async_response
async def ws_list(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    connection.send_result(msg["id"], (await async_get_store(hass)).as_dict())


@websocket_api.websocket_command({"type": "zeo_sonnen/vehicles/save", vol.Required("vehicle"): dict})
@websocket_api.async_response
async def ws_save(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    try:
        vehicle = VEHICLE_SCHEMA(msg["vehicle"])
    except vol.Invalid as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    store = await async_get_store(hass)
    try:
        saved = await store.async_upsert(vehicle)
    except ValueError:
        connection.send_error(msg["id"], "too_many", f"At most {MAX_VEHICLES} vehicles")
        return
    connection.send_result(msg["id"], {**store.as_dict(), "saved": saved["id"]})


@websocket_api.websocket_command({"type": "zeo_sonnen/vehicles/delete", vol.Required("vehicle_id"): str})
@websocket_api.async_response
async def ws_delete(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    store = await async_get_store(hass)
    await store.async_delete(msg["vehicle_id"])
    connection.send_result(msg["id"], store.as_dict())


@websocket_api.websocket_command({"type": "zeo_sonnen/vehicles/activate", vol.Required("vehicle_id"): str})
@websocket_api.async_response
async def ws_activate(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    store = await async_get_store(hass)
    try:
        await store.async_activate(msg["vehicle_id"])
    except KeyError:
        connection.send_error(msg["id"], "not_found", "Unknown vehicle")
        return
    connection.send_result(msg["id"], store.as_dict())
