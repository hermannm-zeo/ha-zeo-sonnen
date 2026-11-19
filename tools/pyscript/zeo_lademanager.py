"""ZEO Lademanager – Testaufbau auf HA Zeo (pyscript).

Regelt den sonnenCharger 3 über die OCPP-Integration nach charge_logic.py aus zeo_sonnen.
Später zieht das in die Integration selbst um; bis dahin läuft es hier ohne HA-Neustart.

Helfer (UI): input_select.wallbox_lademodus, input_boolean.wallbox_trockenlauf,
             input_number.wallbox_batterievorrang_bis
Ausgabe:     sensor.wallbox_lademanager (Grund + Klartext), sensor.wallbox_pv_ueberschuss
"""

import time
from datetime import datetime, timedelta, timezone

from custom_components.zeo_sonnen.charge_logic import ChargeLogic, Measurement, Mode, Settings

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
}
MODES = {"Aus": Mode.OFF, "Eco": Mode.ECO, "Eco+": Mode.ECO_PLUS, "Power": Mode.POWER, "Manuell": Mode.MANUAL}
IN_TX = ("Charging", "SuspendedEV", "SuspendedEVSE")
VALID_S = 300  # Profil läuft nach 5 min ab, wenn HA nicht erneuert (Ausfallschutz)
RENEW_S = 60

_logic = ChargeLogic(settings=Settings(max_amps=MAX_AMPS))
_last = {"amps": None, "phases": None, "t": 0.0, "error": ""}


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


def _text(d, mode_name, soc, prio):
    r = d.reason.value
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
    d = _logic.step(mode, m)

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

    text = _text(d, mode_name, soc, prio)
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
