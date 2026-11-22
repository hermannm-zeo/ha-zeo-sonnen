"""ZEO Lademanager – Testaufbau auf HA Zeo (pyscript).

Regelt den sonnenCharger 3 über die OCPP-Integration nach charge_logic.py aus zeo_sonnen.
Später zieht das in die Integration selbst um; bis dahin läuft es hier ohne HA-Neustart.

Helfer (UI): input_select.wallbox_lademodus, input_boolean.wallbox_trockenlauf,
             input_number.wallbox_batterievorrang_bis
Modus Ziel:  input_number.wallbox_ladestand_auto (Ladestand jetzt, %), input_number.wallbox_ziel_ladestand (%),
             input_datetime.wallbox_abfahrt (Datum + Uhrzeit); Fahrzeug = aktives Fahrzeug aus zeo_sonnen
             (.storage/zeo_sonnen.vehicles). Basis der Hochrechnung in pyscript.wallbox_ziel_basis (persistent).
Ausgabe:     sensor.wallbox_lademanager (Grund + Klartext), sensor.wallbox_pv_ueberschuss
"""

import json
import os
import time
from datetime import datetime, timedelta, timezone

from custom_components.zeo_sonnen.charge_logic import ChargeLogic, Measurement, Mode, Settings, Target

CHARGER = "sonnencharger"
MAX_AMPS = 16  # Zuleitung B16
E = {
    "grid": "sensor.controlroom_sonnenbatterie_netzleistung",  # HA: + Bezug, - Einspeisung
    "bat": "sensor.controlroom_sonnenbatterie_batterieleistung",  # + Entladen, - Laden
    "soc": "sensor.controlroom_sonnenbatterie_ladestand",
    "buffer": "number.controlroom_sonnenbatterie_notstrompuffer",
    "ev": "sensor.sonnencharger_power_active_import",  # kW
    "status": "sensor.sonnencharger_status_connector",
    "mode": "input_select.wallbox_lademodus",
    "dry": "input_boolean.wallbox_trockenlauf",
    "prio": "input_number.wallbox_batterievorrang_bis",
    "meter": "sensor.sonnencharger_energy_active_import_register",  # kWh, Zählerstand
    "soc_car": "input_number.wallbox_ladestand_auto",
    "soc_goal": "input_number.wallbox_ziel_ladestand",
    "departure": "input_datetime.wallbox_abfahrt",
}
# "Aus" steht nicht mehr in der Auswahl; bleibt hier, falls ein alter Zustand übrig ist
MODES = {
    "Aus": Mode.OFF,
    "Eco": Mode.ECO,
    "Eco+": Mode.ECO_PLUS,
    "Power": Mode.POWER,
    "Ziel": Mode.TARGET,
    "Manuell": Mode.MANUAL,
}
BASIS = "pyscript.wallbox_ziel_basis"
VEHICLES = "/config/.storage/zeo_sonnen.vehicles"
ETA = 0.9  # Ladeverluste AC (Annahme), Energie an der Wallbox = Energie in den Akku / ETA
RESERVE_S = 900  # Ziel 15 min vor der Abfahrt erreichen
IN_TX = ("Charging", "SuspendedEV", "SuspendedEVSE")
VALID_S = 300  # Profil läuft nach 5 min ab, wenn HA nicht erneuert (Ausfallschutz)
RENEW_S = 60

_logic = ChargeLogic(settings=Settings(max_amps=MAX_AMPS))
_last = {"amps": None, "phases": None, "t": 0.0, "error": ""}
_veh = {"mtime": None, "data": None, "checked": 0.0}
_tx = {"prev": None}

state.persist(BASIS, default_value=0, default_attributes={"input_ts": 0, "soc_in": None, "last_tx_end": 0})


@pyscript_compile
def _read_vehicle(path, mtime):
    """Aktives Fahrzeug aus dem Store von zeo_sonnen (läuft im Executor)."""
    try:
        m = os.path.getmtime(path)
    except OSError:
        return None, None
    if m == mtime:
        return m, False
    with open(path, encoding="utf-8") as f:
        data = json.load(f).get("data", {})
    act = data.get("active")
    return m, next((v for v in data.get("vehicles", []) if v.get("id") == act), None)


def _vehicle():
    now = time.monotonic()
    if now - _veh["checked"] >= 60:
        _veh["checked"] = now
        m, v = task.executor(_read_vehicle, VEHICLES, _veh["mtime"])
        if m is None:
            _veh.update({"mtime": None, "data": None})
        elif v is not False:
            _veh.update({"mtime": m, "data": v})
    return _veh["data"]


@state_trigger(E["soc_car"])
def zeo_lademanager_soc_input(value=None):
    """Neuer Ladestand eingegeben: Zählerstand als Basis der Hochrechnung merken."""
    attrs = state.getattr(BASIS) or {}
    state.set(
        BASIS,
        value=_num(E["meter"], 0.0),
        new_attributes={**attrs, "input_ts": time.time(), "soc_in": _num(E["soc_car"], None)},
    )


def _ziel(veh):
    """Ziel-Vorgabe für die Regelung + Infos für die Karte. Ohne gültige Eingabe: (None, Info)."""
    info = {"target_state": "ok"}
    if not veh:
        info["target_state"] = "no_vehicle"
        return None, info
    attrs = state.getattr(BASIS) or {}
    soc_in = attrs.get("soc_in")
    if soc_in is None or attrs.get("input_ts", 0) < attrs.get("last_tx_end", 0):
        info["target_state"] = "no_soc"
        return None, info
    try:
        dep = float((state.getattr(E["departure"]) or {}).get("timestamp"))
    except Exception:
        dep = 0.0
    left = dep - time.time() - RESERVE_S
    try:  # Ortszeit direkt aus dem Helfer, die Zeitzone des Prozesses kann UTC sein
        dep_local = datetime.strptime(state.get(E["departure"]), "%Y-%m-%d %H:%M:%S")
    except Exception:
        dep = 0.0
    if dep <= time.time():
        info["target_state"] = "no_departure"
        return None, info
    cap = float(veh.get("capacity_kwh") or 0)
    goal = _num(E["soc_goal"], 80.0)
    meter = _num(E["meter"], None)
    base = _num(BASIS, 0.0)
    charged = max(0.0, meter - base) if meter is not None and meter >= base else 0.0
    soc_now = min(100.0, soc_in + charged * ETA / cap * 100) if cap else soc_in
    energy_wh = max(0.0, goal - soc_now) / 100 * cap / ETA * 1000
    ph = 1 if int(veh.get("phases") or 3) == 1 else 3
    max_w = min(float(veh.get("ac_kw") or 22) * 1000, MAX_AMPS * 230.0 * ph)
    tg = Target(energy_wh=energy_wh, seconds_left=left, max_w=max_w, max_phases=ph)
    reach = soc_now + max(0.0, left) * max_w / 3600 * ETA / 1000 / cap * 100 if cap else None
    info.update(
        {
            "target_soc": round(goal),
            "target_soc_estimate": round(soc_now, 1),
            "target_energy_kwh": round(energy_wh / 1000, 2),
            "target_need_kw": round(min(tg.need_w, 1e6) / 1000, 2),
            "target_departure": dep_local.isoformat(timespec="minutes"),
            "target_reach_soc": round(min(100.0, reach)) if reach is not None else None,
            # pyscript kennt keine Generator-Ausdrücke, daher von Hand
            "target_vehicle": f"{veh.get('brand') or ''} {veh.get('model') or ''}".strip(),
        }
    )
    # spätestens ab: wenn der nötige Wert die Startschwelle 1,5 kW erreicht
    if 0 < tg.need_w < 1500:
        latest = dep_local - timedelta(seconds=RESERVE_S + energy_wh * 3600 / 1500)
        info["target_latest_start"] = latest.strftime("%H:%M")
    return tg, info


def _num(eid, default=0.0):
    try:
        return float(state.get(eid))
    except Exception:
        return default


def _txt(eid):
    try:
        return state.get(eid)
    except Exception:
        return "unavailable"


def _de(x, d=1):
    return f"{x:.{d}f}".replace(".", ",")


def _profile(amps, phases):
    valid_to = (datetime.now(timezone.utc) + timedelta(seconds=VALID_S)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "chargingProfileId": 101,
        "stackLevel": 1,
        "chargingProfilePurpose": "TxDefaultProfile",
        "chargingProfileKind": "Relative",
        "validTo": valid_to,
        "chargingSchedule": {
            "chargingRateUnit": "A",
            "chargingSchedulePeriod": [{"startPeriod": 0, "limit": amps, "numberPhases": phases}],
        },
    }


_NO_TARGET = {
    "no_vehicle": "Ziel: kein Fahrzeug gewählt, lädt bis dahin wie Eco",
    "no_soc": "Ziel: Ladestand des Autos eingeben, bis dahin wie Eco",
    "no_departure": "Ziel: Abfahrtszeit eingeben, bis dahin wie Eco",
}


def _text(d, mode_name, soc, prio, zi=None):
    r = d.reason.value
    if mode_name == "Ziel" and zi:
        st = zi.get("target_state")
        if st != "ok":
            return _NO_TARGET.get(st, "Ziel: Eingaben fehlen, lädt wie Eco")
        if st == "ok":
            hh = zi["target_departure"][11:16]
            goal = zi["target_soc"]
            est = _de(zi["target_soc_estimate"], 0)
            kw = _de(d.power_w / 1000)
            if r == "idle":
                return f"Ziel {goal} % bis {hh} Uhr: lädt nach dem Anstecken, Sonnenstrom zuerst"
            if r == "target_reached":
                return f"Ziel erreicht (ca. {est} %), Ladung pausiert"
            if r == "too_tight":
                return f"Zu knapp: volle Leistung ({kw} kW), bis {hh} Uhr ca. {zi['target_reach_soc']} %"
            if r == "target":
                return f"Ziel {goal} % bis {hh} Uhr: {kw} kW, Rest aus Speicher und Netz (jetzt ca. {est} %)"
            if r == "solar":
                return f"Ziel {goal} % bis {hh} Uhr: lädt mit Sonnenstrom, {kw} kW (jetzt ca. {est} %)"
            if r in ("waiting", "battery_priority"):
                at = zi.get("target_latest_start")
                if at:
                    return f"Ziel {goal} % bis {hh} Uhr: wartet auf Sonnenstrom, spätestens ab ca. {at} Uhr aus dem Netz"
                return f"Ziel {goal} % bis {hh} Uhr: Ladung startet gleich (jetzt ca. {est} %)"
    free = _de(max(0, d.available_w) / 1000)
    kw = _de(d.power_w / 1000)
    if r == "off":
        return "Laden ausgeschaltet"
    if r == "manual":
        return "Manuell: die Regelung greift nicht ein"
    if r == "idle":
        if mode_name == "Eco+":
            return "Bereit: lädt nach dem Anstecken mit mindestens 1,4 kW"
        if mode_name == "Power":
            return "Bereit: lädt nach dem Anstecken mit voller Leistung"
        return f"Bereit: lädt mit Sonnenstrom, sobald ein Auto angesteckt ist ({free} kW frei)"
    if r == "power":
        return f"Power: volle Leistung ({kw} kW) für diese Ladung"
    if r == "starting":
        return "Ladestart: die Regelung beginnt nach einer Minute"
    if r == "settling":
        return "Phasenwechsel: kurz warten, bis das Auto nachgezogen hat"
    if r == "waiting":
        return f"Wartet auf Sonnenstrom: {free} kW frei, Start ab 1,5 kW"
    if r == "battery_priority":
        return f"Batterie hat Vorrang bis {prio:.0f} % (jetzt {soc:.0f} %)"
    if r == "minimum":
        return f"Mindestladung {d.amps} A einphasig ({kw} kW), Rest aus dem Netz"
    return f"Lädt mit Sonnenstrom: {d.amps} A {d.phases}-phasig ({kw} kW)"


@time_trigger("startup", "period(now, 10s)")
def zeo_lademanager_tick():
    mode_name = _txt(E["mode"])
    mode = MODES.get(mode_name, Mode.MANUAL)
    st = _txt(E["status"])
    online = st not in ("unavailable", "unknown")
    in_tx = st in IN_TX
    soc, prio = _num(E["soc"]), _num(E["prio"], 80.0)
    _logic.settings = Settings(max_amps=MAX_AMPS, battery_priority_soc=prio)
    m = Measurement(
        t=time.monotonic(),
        grid_feed_in_w=-_num(E["grid"]),
        battery_w=_num(E["bat"]),
        usoc=soc,
        backup_buffer=_num(E["buffer"]),
        ev_w=_num(E["ev"]) * 1000 if st == "Charging" else 0.0,
        in_transaction=in_tx,
    )
    if _tx["prev"] and not in_tx:  # Ladevorgang beendet: alter Ladestand gilt nicht mehr
        state.setattr(f"{BASIS}.last_tx_end", time.time())
    _tx["prev"] = in_tx
    tg, zi = (None, None)
    if mode == Mode.TARGET:
        tg, zi = _ziel(_vehicle())
    d = _logic.step(mode, m, tg)

    if d.revert_to_eco and mode_name == "Power":
        input_select.select_option(entity_id=E["mode"], option="Eco")

    dry = _txt(E["dry"]) == "on"
    now = time.monotonic()
    if d.amps is None:
        _last["amps"] = None
    elif online and not dry:
        changed = _last["amps"] is None or abs(d.amps - _last["amps"]) >= 1 or d.phases != _last["phases"]
        if changed or now - _last["t"] >= RENEW_S:
            try:
                ocpp.set_charge_rate(devid=CHARGER, conn_id=1, custom_profile=_profile(d.amps, d.phases))
                _last.update({"amps": d.amps, "phases": d.phases, "t": now, "error": ""})
            except Exception as err:
                _last["error"] = str(err)
                log.warning(f"Lademanager: Profil abgelehnt: {err}")

    text = _text(d, mode_name, soc, prio, zi)
    state.set(
        "sensor.wallbox_lademanager",
        value=d.reason.value,
        new_attributes={
            "friendly_name": "Wallbox Lademanager",
            "icon": "mdi:ev-station",
            "text": text,
            "mode": mode_name,
            "dry_run": dry,
            "target_amps": d.amps,
            "target_phases": d.phases if d.amps else None,
            "target_kw": round(d.power_w / 1000, 2),
            "available_w": round(d.available_w),
            "sent_amps": _last["amps"],
            "error": _last["error"],
            **(zi or {}),
        },
    )
    state.set(
        "sensor.wallbox_pv_ueberschuss",
        value=round(d.available_w),
        new_attributes={
            "friendly_name": "Wallbox PV-Überschuss",
            "unit_of_measurement": "W",
            "device_class": "power",
            "state_class": "measurement",
        },
    )
