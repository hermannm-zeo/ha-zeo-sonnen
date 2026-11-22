#!/usr/bin/env python3
"""Build the vehicle catalogue for zeo_sonnen (custom_components/zeo_sonnen/vehicles.json).

Two open sources are merged:

* OpenEV Data (github.com/open-ev-data/open-ev-data-dataset), dataset licence
  CDLA-Permissive-2.0. Clean structure, but no Kia/Opel and gaps in AC data.
* Open EV Data, KilowattApp fork (github.com/KilowattApp/open-ev-data), MIT with
  attribution. Wide coverage (incl. older cars), but messy names and some wrong
  AC values.

What the script does:
  1. normalises brand names, drops motorbikes and records without a model name,
  2. splits each record into base model + variant,
  3. checks plausibility (capacity 5-250 kWh, AC <= 22 kW, 7.4 kW is single-phase),
  4. merges identical variants across sources and model years.

Usage:
  python3 tools/build_vehicle_db.py                 # downloads the pinned sources
  python3 tools/build_vehicle_db.py --openev a.json --kilowatt b.json
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

OPENEV_VERSION = "v1.24.0"
OPENEV_URL = (
    "https://github.com/open-ev-data/open-ev-data-dataset/releases/download/"
    f"{OPENEV_VERSION}/open-ev-data-{OPENEV_VERSION}.json"
)
KILOWATT_URL = "https://raw.githubusercontent.com/KilowattApp/open-ev-data/master/data/ev-data.json"
OUT = Path(__file__).resolve().parent.parent / "custom_components" / "zeo_sonnen" / "vehicles.json"

BRANDS = {
    "opel / vauxhall": "Opel",
    "opel": "Opel",
    "mercedes": "Mercedes-Benz",
    "mercedes-benz": "Mercedes-Benz",
    "smart": "smart",
    "skoda": "Škoda",
    "škoda": "Škoda",
    "cupra": "Cupra",
    "xpeng": "XPeng",
    "vinfast": "VinFast",
    "mg": "MG",
    "mg motor": "MG",
    "ds": "DS",
    "ds automobiles": "DS",
    "seat": "SEAT",
    "kgm": "KGM",
    "ssangyong": "SsangYong",
    "nio": "NIO",
    "byd": "BYD",
    "gwm": "GWM",
    "ora": "ORA",
    "e.go mobile": "e.GO",
}
SKIP_BRANDS = {"zero motorcycles", "energica", "silence"}
# names Kilowatt stores without the model (lost during an old import)
JUNK_OK = re.compile(r"^(e-\d|ë-|#\d|i\d)", re.I)
SINGLE_PHASE_KW = {3.6, 3.7, 4.6, 6.6, 7.2, 7.4}


def load(path_or_url: str) -> dict:
    if re.match(r"^https?://", path_or_url):
        with urllib.request.urlopen(path_or_url, timeout=60) as resp:
            return json.load(resp)
    return json.loads(Path(path_or_url).read_text(encoding="utf-8"))


def brand_name(raw: str) -> str:
    return BRANDS.get(raw.strip().lower(), raw.strip())


def model_key(name: str) -> str:
    """Key to match the same model across sources: 'Megane E-Tech Electric' == 'Megane E-Tech'."""
    n = name.lower().replace("-", " ").replace(".", " ")
    n = re.sub(r"\b(electric|ev|bev|iv|eq)$", "", n.strip())
    return re.sub(r"[^a-z0-9#ë]+", "", n)


def clean(text: str) -> str:
    t = re.sub(r"\s+", " ", text or "").strip(" -,")
    t = re.sub(r"(\d)\s*kwh\b", r"\1 kWh", t, flags=re.I)
    t = re.sub(r"(\d)\s*kw-ac\b", r"\1 kW AC", t, flags=re.I)
    return t


def num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def plausible(kwh, ac, ph) -> tuple[float | None, float | None, int | None]:
    kwh = kwh if kwh and 5 <= kwh <= 250 else None
    ac = ac if ac and 1.4 <= ac <= 22 else None
    ph = int(ph) if ph in (1, 2, 3) else None
    if ac and ph == 3 and ac in SINGLE_PHASE_KW:
        ph = 1  # 7.4 kW = 32 A single-phase, never three-phase
    if ac and ph == 1 and ac > 7.4:
        ph = 3 if ac >= 11 else ph
    if ac is None:
        ph = None
    return (round(kwh, 1) if kwh else None, round(ac, 1) if ac else None, ph)


# ---------- OpenEV ----------


def from_openev(data: dict) -> list[dict]:
    rows = []
    for v in data["vehicles"]:
        brand = brand_name(v["make"]["name"])
        model = v["model"]["name"].strip()
        trim = (v.get("trim") or {}).get("name") or ""
        var = (v.get("variant") or {}).get("name") or ""
        if trim.lower() == "base":
            trim = ""
        if var and trim and var.lower().startswith(trim.lower()):
            trim = ""
        if var and trim and trim.lower().startswith(var.lower()):
            var = ""
        variant = clean(" ".join(x for x in (trim, var) if x))
        bat = v.get("battery") or {}
        ac = ((v.get("charging") or {}).get("ac")) or {}
        kwh, akw, ph = plausible(
            num(bat.get("pack_capacity_kwh_net")), num(ac.get("max_power_kw")), ac.get("phases")
        )
        if kwh is None and num(bat.get("pack_capacity_kwh_gross")):
            kwh = plausible(num(bat.get("pack_capacity_kwh_gross")) * 0.93, None, None)[0]
        rows.append(
            {
                "b": brand,
                "m": model,
                "v": variant,
                "y": v.get("year"),
                "kwh": kwh,
                "ac": akw,
                "ph": ph,
                "s": "o",
            }
        )
    return rows


# ---------- Kilowatt ----------


def from_kilowatt(data: dict, known: dict[str, dict[str, str]]) -> list[dict]:
    recs = []
    for v in data["data"]:
        if v.get("vehicle_type") == "motorbike" or v["brand"].lower() in SKIP_BRANDS:
            continue
        raw = (v.get("model") or "").strip()
        if (
            not raw
            or (raw == raw.lower() and not JUNK_OK.match(raw))
            or (re.match(r"^[\d.,]+\s*(kwh)?\b", raw, re.I) and not JUNK_OK.match(raw))
        ):
            continue  # model name lost in the source ('50kwh', 'long range', '39.', ...)
        recs.append((brand_name(v["brand"]), clean(raw), clean(v.get("variant") or ""), v))

    def prefix_key(cands: dict[str, str], tokens: list[str]) -> int:
        """Number of leading tokens that form a known model (longest match), 0 if none."""
        for n in range(len(tokens), 0, -1):
            if model_key(" ".join(tokens[:n])) in cands:
                return n
        return 0

    # base model candidates: OpenEV models, then Kilowatt models that carry a separate variant
    # (shortest first, so 'Model 3 Long Range' + 'RWD' does not become its own model next to 'Model 3')
    cands: dict[str, dict[str, str]] = collections.defaultdict(dict)
    for b, models in known.items():
        cands[b].update(models)
    for b, model, var, _ in sorted(recs, key=lambda r: len(r[1])):
        if var and not prefix_key(cands[b], model.split(" ")):
            cands[b][model_key(model)] = model
    rows = []
    for b, model, var, v in recs:
        tokens = f"{model} {var}".strip().split(" ")
        n = prefix_key(cands[b], tokens)
        if n == 0:
            n = 2 if (tokens[0].isdigit() or len(tokens[0]) <= 1) and len(tokens) > 1 else 1
            cands[b].setdefault(model_key(" ".join(tokens[:n])), " ".join(tokens[:n]))
        base = cands[b][model_key(" ".join(tokens[:n]))]
        variant = clean(" ".join(tokens[n:]))
        ac = v.get("ac_charger") or {}
        kwh, akw, ph = plausible(
            num(v.get("usable_battery_size")), num(ac.get("max_power")), ac.get("usable_phases")
        )
        rows.append(
            {
                "b": b,
                "m": base,
                "v": variant,
                "y": v.get("release_year"),
                "kwh": kwh,
                "ac": akw,
                "ph": ph,
                "s": "k",
            }
        )
    return rows


# ---------- own additions (tools/vehicles_extra.json) ----------

EXTRA = Path(__file__).resolve().parent / "vehicles_extra.json"


def from_extra(known: dict[str, dict[str, str]]) -> list[dict]:
    """Hand-maintained entries (missing models, corrections). Each needs a source URL."""
    if not EXTRA.exists():
        return []
    rows = []
    for e in json.loads(EXTRA.read_text(encoding="utf-8")).get("vehicles", []):
        b = brand_name(e["brand"])
        model = known.get(b, {}).get(model_key(e["model"]), e["model"])
        kwh, ac, ph = plausible(num(e.get("kwh")), num(e.get("ac_kw")), e.get("phases"))
        for y in range(int(e["years"][0]), int(e["years"][-1]) + 1):
            rows.append(
                {
                    "b": b,
                    "m": model,
                    "v": clean(e.get("variant", "")),
                    "y": y,
                    "kwh": kwh,
                    "ac": ac,
                    "ph": ph,
                    "s": "z",
                }
            )
    return rows


# ---------- merge ----------


def build(openev: dict, kilowatt: dict) -> dict:
    o_rows = from_openev(openev)
    known: dict[str, dict[str, str]] = collections.defaultdict(dict)
    for r in o_rows:
        known[r["b"]].setdefault(model_key(r["m"]), r["m"])
    rows = o_rows + from_kilowatt(kilowatt, known) + from_extra(known)

    brands: dict[str, dict[str, dict]] = collections.defaultdict(dict)
    for r in rows:
        mk = model_key(r["m"])
        model = brands[r["b"]].setdefault(mk, {"names": collections.Counter(), "items": {}})
        model["names"][r["m"]] += 1
        key = (r["v"].lower(), r["kwh"])
        it = model["items"].get(key)
        if it is None:
            it = model["items"][key] = {
                "v": r["v"],
                "kwh": r["kwh"],
                "ac": r["ac"],
                "ph": r["ph"],
                "y": set(),
                "s": set(),
            }
        if r["y"]:
            it["y"].add(int(r["y"]))
        it["s"].add(r["s"])
        # OpenEV and own entries win for AC data
        if (r["s"] in ("o", "z") or it["ac"] is None) and r["ac"] is not None:
            it["ac"], it["ph"] = r["ac"], r["ph"]

    out_brands = []
    count = 0
    for bname in sorted(brands, key=lambda s: s.lower()):
        models = []
        for m in brands[bname].values():
            name = sorted(m["names"].items(), key=lambda kv: (-kv[1], len(kv[0])))[0][0]
            variants = []
            for it in m["items"].values():
                if it["kwh"] is None and it["ac"] is None:
                    continue
                ys = sorted(it["y"])
                vid = re.sub(r"[^a-z0-9]+", "-", f"{bname}-{name}-{it['v']}-{it['kwh']}".lower()).strip("-")
                variants.append(
                    {
                        "id": vid,
                        "n": it["v"],
                        "y": [ys[0], ys[-1]] if ys else None,
                        "kwh": it["kwh"],
                        "ac": it["ac"],
                        "ph": it["ph"],
                        "src": "".join(sorted(it["s"])),
                    }
                )
            if not variants:
                continue
            variants.sort(key=lambda x: (-(x["y"][1] if x["y"] else 0), x["n"].lower(), x["kwh"] or 0))
            seen = collections.Counter()
            for x in variants:  # ids must be unique
                seen[x["id"]] += 1
                if seen[x["id"]] > 1:
                    x["id"] += f"-{seen[x['id']]}"
            count += len(variants)
            years = [y for x in variants if x["y"] for y in x["y"]]
            models.append({"n": name, "y": [min(years), max(years)] if years else None, "v": variants})
        if models:
            models.sort(key=lambda x: x["n"].lower())
            out_brands.append({"n": bname, "m": models})

    return {
        "version": date.today().isoformat(),
        "count": count,
        "sources": [
            {
                "name": "OpenEV Data",
                "url": "https://github.com/open-ev-data/open-ev-data-dataset",
                "license": "CDLA-Permissive-2.0",
                "version": OPENEV_VERSION,
                "code": "o",
            },
            {
                "name": "Open EV Data",
                "url": "https://github.com/KilowattApp/open-ev-data",
                "license": "MIT",
                "version": kilowatt.get("meta", {}).get("updated_at", "")[:10],
                "code": "k",
            },
            {
                "name": "ZEO Solar",
                "url": "https://github.com/hermannm-zeo/ha-zeo-sonnen",
                "license": "MIT",
                "code": "z",
            },
        ],
        "brands": out_brands,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--openev", default=OPENEV_URL)
    ap.add_argument("--kilowatt", default=KILOWATT_URL)
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    result = build(load(args.openev), load(args.kilowatt))
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{args.out}: {len(result['brands'])} brands, {result['count']} variants", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
