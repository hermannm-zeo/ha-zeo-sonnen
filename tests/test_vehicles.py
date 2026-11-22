"""Vehicle catalogue and household vehicles (websocket commands)."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.zeo_sonnen import vehicles
from custom_components.zeo_sonnen.vehicles import CATALOG_FILE, MAX_VEHICLES, async_get_store


async def _ws(client: Any, payload: dict[str, Any]) -> dict[str, Any]:
    await client.send_json_auto_id(payload)
    return await client.receive_json()


def test_bundled_catalog_is_valid() -> None:
    data = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
    assert data["count"] > 1000
    assert {s["code"] for s in data["sources"]} >= {"o", "k"}
    ids = set()
    for brand in data["brands"]:
        assert brand["m"]
        for model in brand["m"]:
            for v in model["v"]:
                assert v["id"] not in ids
                ids.add(v["id"])
                assert v["kwh"] is None or 5 <= v["kwh"] <= 250
                assert v["ac"] is None or v["ac"] <= 22
                assert not (v["ph"] == 3 and v["ac"] in (3.7, 7.4))
    names = {b["n"] for b in data["brands"]}
    assert {"Kia", "Tesla", "Volkswagen", "Renault", "Škoda"} <= names


async def test_catalog_levels(
    hass: HomeAssistant, init_integration: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/catalog"})
    assert msg["success"]
    brands = {b["n"]: b for b in msg["result"]["brands"]}
    assert brands["Tesla"]["models"] >= 4
    assert msg["result"]["sources"]

    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/catalog", "brand": "tesla"})
    models = [m["n"] for m in msg["result"]["models"]]
    assert "Model 3" in models

    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/catalog", "brand": "Tesla", "model": "model 3"})
    assert msg["result"]["model"] == "Model 3"
    assert all("kwh" in v for v in msg["result"]["variants"])

    for bad in ({"brand": "Nope"}, {"brand": "Tesla", "model": "Nope"}):
        msg = await _ws(client, {"type": "zeo_sonnen/vehicles/catalog", **bad})
        assert msg["error"]["code"] == "not_found"


async def test_search(
    hass: HomeAssistant, init_integration: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/search", "query": "kia ev6"})
    assert msg["success"]
    assert msg["result"]["results"][0] == {**msg["result"]["results"][0], "brand": "Kia", "model": "EV6"}
    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/search", "query": "x"})
    assert not msg["success"]


async def test_missing_catalog(
    hass: HomeAssistant, init_integration: MockConfigEntry, hass_ws_client: WebSocketGenerator, tmp_path
) -> None:
    hass.data.pop(vehicles._DATA_CATALOG, None)
    with patch.object(vehicles, "CATALOG_FILE", tmp_path / "missing.json"):
        client = await hass_ws_client(hass)
        msg = await _ws(client, {"type": "zeo_sonnen/vehicles/catalog"})
    assert msg["result"]["brands"] == []


async def test_household_vehicles(
    hass: HomeAssistant, init_integration: MockConfigEntry, hass_ws_client: WebSocketGenerator, hass_storage
) -> None:
    client = await hass_ws_client(hass)
    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/list"})
    assert msg["result"] == {"vehicles": [], "active": None}

    car = {
        "brand": "Kia",
        "model": "EV6",
        "variant": "Long Range 2WD",
        "years": [2021, 2021],
        "capacity_kwh": 77.4,
        "ac_kw": 11,
        "phases": 3,
        "catalog_id": "kia-ev6-x",
    }
    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/save", "vehicle": car})
    assert msg["success"]
    first = msg["result"]["saved"]
    assert msg["result"]["active"] == first
    assert msg["result"]["vehicles"][0]["name"] == "Kia EV6"

    own = {
        "name": "Firmenwagen",
        "brand": "Opel",
        "model": "Combo Electric",
        "capacity_kwh": 46,
        "ac_kw": 11,
        "phases": 3,
    }
    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/save", "vehicle": own})
    second = msg["result"]["saved"]
    assert msg["result"]["active"] == second  # newly added car is in use

    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/activate", "vehicle_id": first})
    assert msg["result"]["active"] == first
    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/activate", "vehicle_id": "nope"})
    assert msg["error"]["code"] == "not_found"

    # update keeps the id
    msg = await _ws(
        client,
        {"type": "zeo_sonnen/vehicles/save", "vehicle": {**car, "id": first, "ac_kw": 7.4, "phases": 1}},
    )
    assert [v["ac_kw"] for v in msg["result"]["vehicles"] if v["id"] == first] == [7.4]

    store = await async_get_store(hass)
    assert store.active_vehicle()["id"] == first
    assert hass_storage["zeo_sonnen.vehicles"]["data"]["active"] == first

    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/delete", "vehicle_id": first})
    assert msg["result"]["active"] == second
    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/delete", "vehicle_id": second})
    assert msg["result"] == {"vehicles": [], "active": None}


async def test_save_validation_and_limit(
    hass: HomeAssistant, init_integration: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    client = await hass_ws_client(hass)
    bad = {"brand": "Kia", "model": "EV6", "capacity_kwh": 77, "ac_kw": 50, "phases": 3}
    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/save", "vehicle": bad})
    assert msg["error"]["code"] == "invalid_format"

    ok = {"brand": "Kia", "model": "EV6", "capacity_kwh": 77, "ac_kw": 11, "phases": 3}
    for _ in range(MAX_VEHICLES):
        assert (await _ws(client, {"type": "zeo_sonnen/vehicles/save", "vehicle": ok}))["success"]
    msg = await _ws(client, {"type": "zeo_sonnen/vehicles/save", "vehicle": ok})
    assert msg["error"]["code"] == "too_many"


async def test_store_loads_and_repairs(hass: HomeAssistant, hass_storage) -> None:
    hass_storage["zeo_sonnen.vehicles"] = {
        "version": 1,
        "key": "zeo_sonnen.vehicles",
        "data": {
            "vehicles": [{"id": "a1", "brand": "Kia", "model": "EV6"}, {"brand": "no id"}],
            "active": "gone",
        },
    }
    store = await async_get_store(hass)
    assert [v["id"] for v in store.vehicles] == ["a1"]
    assert store.active == "a1"
