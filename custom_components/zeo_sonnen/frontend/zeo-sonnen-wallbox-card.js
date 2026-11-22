/* zeo-sonnen-wallbox-card – Wallbox-Ansicht (sonnenCharger 3 / Alfen über OCPP) im Stil der Hauskarte
 * ZEO Solar – Teil der Integration zeo_sonnen
 *
 * Daten aus dem OCPP-Server von zeo_sonnen (Websocket zeo_sonnen/info → Entitäten), Statistiken aus dem Recorder.
 * Befehle über die Aktionen zeo_sonnen.wallbox_set_limit / zeo_sonnen.wallbox_clear_limit.
 * Fahrzeuge des Haushalts über zeo_sonnen/vehicles/* (Auswahl Marke → Modell → Ausführung aus dem Katalog der Integration).
 * Konfiguration:
 *   entry:      entry_id der Integration (Standard: erste geladene)
 *   title:      Überschrift (Standard: Meine Wallbox)
 *   name:       Gerätename unter der Überschrift (Standard: Modell aus der Box bzw. sonnenCharger 3)
 *   max_power:  Höchstleistung in kW für die Anzeige (Standard: 11)
 *   rfid:       true = Hinweis „Laden mit Karte starten“ (Standard: true)
 *   max_current: höchster einstellbarer Ladestrom in A (Standard: aus der Integration, sonst 16)
 *   mode:       optional input_select/select für den Lademodus (Aus, Eco, Eco+, Power, Manuell)
 *   manager:    Status-Sensor des Lademanagers (Standard: sensor.wallbox_lademanager)
 *   dry_run:    input_boolean Trockenlauf (Standard: input_boolean.wallbox_trockenlauf)
 *   theme:      auto | light | dark
 *   entities:   einzelne Entitäten überschreiben, z. B. { power: sensor.xyz }
 */
const ZW_TAG = "zeo-sonnen-wallbox-card";
const ZW_VERSION = "0.7.0-dev4";

const ZK = {
  ev: "#9BD62A", ev2: "#6FAE12", petrol: "#0E3A43",
  ok: "#3DBE7A", warn: "#E9A23B", err: "#E2574C", grey: "#8695A0", l1: "#9BD62A", l2: "#2E9BD6", l3: "#F5B52E",
};

// OCPP 1.6 ChargePointStatus → Kundentext, Farbe, Erklärung
const ZW_STATUS = {
  Available: ["Bereit", ZK.grey, "Kein Fahrzeug angeschlossen."],
  Preparing: ["Fahrzeug verbunden", ZK.warn, "Wartet auf Freigabe, z. B. durch die Ladekarte."],
  Charging: ["Lädt", ZK.ev, "Das Fahrzeug wird geladen."],
  SuspendedEVSE: ["Pausiert", ZK.warn, "Die Wallbox wartet auf Freigabe, z. B. auf Sonnenstrom, und lädt danach von selbst weiter."],
  SuspendedEV: ["Fahrzeug pausiert", ZK.warn, "Das Fahrzeug nimmt gerade keinen Strom ab, z. B. weil es voll ist oder ein Ladelimit gesetzt ist."],
  Finishing: ["Ladevorgang beendet", ZK.grey, "Das Fahrzeug kann abgesteckt werden."],
  Reserved: ["Reserviert", ZK.grey, ""],
  Unavailable: ["Gesperrt", ZK.err, "Die Wallbox ist außer Betrieb gesetzt."],
  Faulted: ["Störung", ZK.err, "Die Wallbox meldet einen Fehler."],
};
const ZW_STOP = {
  EVDisconnected: "Fahrzeug abgesteckt", Local: "An der Wallbox beendet", Remote: "Per Fernbefehl beendet",
  PowerLoss: "Stromausfall", Reboot: "Neustart", HardReset: "Neustart", SoftReset: "Neustart",
  EmergencyStop: "Not-Aus", DeAuthorized: "Karte nicht berechtigt", UnlockCommand: "Entriegelt", Other: "Sonstiges",
};
const ZW_WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
// Marken, die oben in der Fahrzeugauswahl stehen (Neuzulassungen DE, grob)
const ZW_TOP_BRANDS = ["Volkswagen", "Tesla", "Škoda", "BMW", "Mercedes-Benz", "Audi", "Hyundai", "Kia", "Renault", "Opel", "Cupra", "Fiat", "MG", "BYD", "Volvo", "smart", "Peugeot", "Polestar"];

const zf = (v, d = 1) =>
  v == null || isNaN(v) ? "–" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const zp2 = (n) => String(n).padStart(2, "0");
const zd0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const zesc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const zdur = (min) => {
  if (min == null || isNaN(min)) return "–";
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${zp2(m % 60)} min`;
};
const ZW_EV = "M19.77,7.23L19.78,7.22L16.06,3.5L15,4.56L17.11,6.67C16.17,7.03 15.5,7.93 15.5,9A2.5,2.5 0 0,0 18,11.5C18.36,11.5 18.69,11.42 19,11.29V18.5A1,1 0 0,1 18,19.5A1,1 0 0,1 17,18.5V14A2,2 0 0,0 15,12H14V5A2,2 0 0,0 12,3H6A2,2 0 0,0 4,5V21H14V13.5H15.5V18.5A2.5,2.5 0 0,0 18,21A2.5,2.5 0 0,0 20.5,18.5V9C20.5,8.31 20.22,7.68 19.77,7.23M18,10A1,1 0 0,1 17,9A1,1 0 0,1 18,8A1,1 0 0,1 19,9A1,1 0 0,1 18,10M8,18V13.5H6L10,6V11H12L8,18Z";

class ZeoSonnenWallboxCard extends HTMLElement {
  setConfig(config) {
    this._cfg = { title: "Meine Wallbox", max_power: 11, rfid: true, theme: "auto", ...config };
    this._e = this._entityMap();
    this._range = this._range || "today";
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._built = false;
  }
  _entityMap() {
    const w = (this._info && this._info.wallbox) || {};
    return {
      ...(w.entities || {}),
      manager: this._cfg.manager || "sensor.wallbox_lademanager", dry: this._cfg.dry_run || "input_boolean.wallbox_trockenlauf",
      ...(this._cfg.entities || {}),
    };
  }
  _wb() { return (this._info && this._info.wallbox) || null; }
  async _loadInfo() {
    if (this._infoBusy || !this._hass) return;
    this._infoBusy = true;
    this._infoAt = Date.now();
    const keyOf = () => JSON.stringify(this._wb() ? this._wb().entities || {} : null);
    const before = this._info ? keyOf() : undefined;
    try {
      const msg = { type: "zeo_sonnen/info" };
      if (this._cfg.entry) msg.entry_id = this._cfg.entry;
      this._info = await this._hass.callWS(msg);
      this._infoErr = false;
    } catch (e) {
      this._infoErr = true;
    } finally {
      this._infoBusy = false;
    }
    this._e = this._entityMap();
    if (before !== keyOf()) this._built = false;  // neu aufbauen nur, wenn sich Entitäten geändert haben
    if (this._hass) this.hass = this._hass;
  }
  getCardSize() { return 12; }

  set hass(hass) {
    this._hass = hass;
    const age = this._infoAt ? Date.now() - this._infoAt : Infinity;
    // Info alle 5 min auffrischen (Gerätedaten kommen erst nach der Anmeldung der Box), bei Fehler alle 30 s
    if (age > (!this._info || this._infoErr ? 30000 : 5 * 60000)) this._loadInfo();
    if (!this._info || this._infoErr) {
      if (!this._info) { this._empty(this._infoErr ? "Die Wallbox-Daten konnten nicht geladen werden. Neuer Versuch in 30 Sekunden." : "Lade Wallbox …"); return; }
    }
    if (!this._wb()) {
      this._empty("Keine Wallbox eingerichtet. Ladepunkt-ID unter Einstellungen → Geräte & Dienste → ZEO sonnenBatterie → Konfigurieren eintragen.");
      return;
    }
    if (!this._built) this._build();
    this._theme();
    this._update();
    if (!this._statsAt || Date.now() - this._statsAt > 5 * 60000) this._loadStats();
  }
  _empty(text) {
    if (this._emptyText === text && !this._built) return;
    this._built = false;
    this._emptyText = text;
    this.shadowRoot.innerHTML = `<style>${this._css()}</style><div class="z3"><section class="hero"><div class="brand"><i>${this._svg(ZW_EV, 30)}</i><div><h1>${zesc(this._cfg.title)}</h1></div></div></section><section class="grid"><article class="card full"><div class="msg">${zesc(text)}</div></article></section></div>`;
    this._theme();
  }
  connectedCallback() { if (!this._timer) this._timer = setInterval(() => this._loadStats(), 5 * 60000); }
  disconnectedCallback() { clearInterval(this._timer); this._timer = null; }

  _theme() {
    const t = this._cfg.theme || "auto";
    const h = this._hass || {}, sel = h.selectedTheme;
    const sys = !sel || typeof sel.dark !== "boolean";
    const dev = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = t === "dark" || (t !== "light" && (sys ? !!(h.themes && h.themes.darkMode) || dev : sel.dark));
    const z = this.shadowRoot && this.shadowRoot.querySelector(".z3");
    if (z && z.classList.contains("dark") !== dark) z.classList.toggle("dark", dark);
  }

  _st(k) { return this._hass && this._hass.states[this._e[k]]; }
  _num(k) {
    const s = this._st(k);
    if (!s || s.state === "unavailable" || s.state === "unknown" || s.state === "") return null;
    const v = parseFloat(s.state);
    return isNaN(v) ? null : v;
  }
  _attrNum(k, a) {
    const s = this._st(k);
    if (!s || s.state === "unavailable") return null;
    const v = parseFloat(s.attributes[a]);
    return isNaN(v) ? null : v;
  }

  /* ---------- Gerüst ---------- */
  _build() {
    this._built = true;
    this._emptyText = null;
    const c = this._cfg;
    const dev = (this._wb() && this._wb().device) || {};
    const devName = c.name || (dev.model === "AHP02-60327" ? "sonnenCharger 3" : dev.model) || "sonnenCharger 3";
    this.shadowRoot.innerHTML = `<style>${this._css()}</style>
    <div class="z3">
      <section class="hero">
        <div class="brand"><i>${this._svg(ZW_EV, 30)}</i><div><h1>${zesc(c.title)}</h1><div class="subt" id="subt">${zesc(devName)}</div></div></div>
        <div class="hstat"><span class="chip" id="chip"><i></i><span></span></span></div>
      </section>
      <div id="banner"></div>
      <section class="grid">
        <article class="card wide2">
          <header><h2>Jetzt</h2><span class="tag" id="phtag">–</span></header>
          <div class="modebar" id="modebar" hidden>
            <div class="seg" id="modes"></div>
            <div class="why"><i id="why-dot"></i><span id="why">–</span><em class="dry" id="why-dry" hidden>Trockenlauf</em></div>
          </div>
          <div class="now">
            <div id="ring"></div>
            <div class="nside">
              <div class="nstate" id="nstate">–</div>
              <div class="npow" id="npow">–</div>
              <div class="nhint" id="nhint"></div>
            </div>
          </div>
          <div class="tgls">
            <button class="settgl" id="set-tgl" aria-expanded="false"><span>Einstellungen</span><em id="set-sum"></em><i>▾</i></button>
            <button class="settgl" id="veh-tgl" aria-expanded="false" hidden><span>Fahrzeug</span><em id="veh-sum"></em><i>▾</i></button>
            <button class="settgl" id="det-tgl" aria-expanded="false"><span>Details</span><em id="det-sum"></em><i>▾</i></button>
          </div>
          <div class="vehs" id="veh-box" hidden></div>
          <div class="ctrls" id="set-box" hidden>
            <div class="ctl"><div><b>Ladestrom</b><small>Höchstwert je Phase</small></div>
              <div class="rng"><input type="range" id="set-cur" min="6" max="16" step="1"><em id="set-cur-v">–</em></div></div>
            <div class="ctl"><div><b>Phasen</b><small>3-phasig bis 11 kW, 1-phasig bis 3,7 kW</small></div>
              <div class="seg small" id="set-ph"><button data-p="3">3-phasig</button><button data-p="1">1-phasig</button></div></div>
            <div class="ctl"><div><b>Ladung</b><small id="set-run-h">–</small></div><button class="btn" id="set-pause">Pausieren</button></div>
            <div class="ctl"><div><b>Wallbox</b><small id="set-av-h">–</small></div><button class="btn" id="set-avail">–</button></div>
            <div class="confirm" id="set-conf" hidden><span id="set-conf-t"></span><div class="cbtns"><button id="set-no">Abbrechen</button><button class="yes" id="set-yes">Übernehmen</button></div></div>
            <div class="setfoot"><span id="set-info">Keine Begrenzung aktiv</span><button class="link" id="set-reset">Begrenzung aufheben</button></div>
          </div>
          <div class="dets" id="det-box" hidden>
            <div class="dsec">
              <div class="dh"><b>Phasen</b><small>Strom und Leistung je Phase</small></div>
              <div class="phases" id="phases"></div>
            </div>
            <div class="dsec">
              <div class="dh"><b>Gerät</b><span class="tag" id="online">–</span></div>
              <div class="facts f4">
                <div><span>Modell</span><b id="g-model">–</b></div>
                <div><span>Firmware</span><b id="g-fw">–</b></div>
                <div><span>Seriennummer</span><b id="g-serial">–</b></div>
                <div><span>Fehlercode</span><b id="g-err">–</b></div>
              </div>
              <div class="facts f3 volts" id="volts"></div>
            </div>
          </div>
        </article>
        <article class="card sess">
          <header><h2 id="s-head">Ladevorgang</h2></header>
          <div class="facts f2">
            <div><span>Geladen</span><b id="s-kwh">–</b></div>
            <div><span>Dauer</span><b id="s-time">–</b></div>
            <div><span>Freigegeben</span><b id="s-off">–</b></div>
            <div><span>Zuletzt beendet</span><b id="s-stop">–</b></div>
          </div>
        </article>
        <article class="card">
          <header><h2>Geladene Energie</h2></header>
          <div class="facts f2">
            <div><span>Heute</span><b id="e-day">–</b></div>
            <div><span>Diese Woche</span><b id="e-week">–</b></div>
            <div><span>Dieser Monat</span><b id="e-month">–</b></div>
            <div><span>Dieses Jahr</span><b id="e-year">–</b></div>
          </div>
          <div class="nhint mt">Zählerstand Wallbox: <b id="e-total">–</b></div>
        </article>
        <article class="card full">
          <header>
            <h2>Ladeleistung</h2>
            <div class="seg small" id="rng"><button data-r="today">Heute</button><button data-r="days">14 Tage</button></div>
          </header>
          <div class="chart" id="chart"><div class="msg">Lade Daten …</div></div>
        </article>
        <article class="card know3">
          <header><h2>Gut zu wissen</h2></header>
          <ul class="know" id="know"></ul>
        </article>
      </section>
    </div>`;
    const r = this.shadowRoot;
    r.querySelectorAll("#rng button").forEach((b) => b.addEventListener("click", () => {
      this._range = b.dataset.r;
      this._paintRange();
      this._drawChart();
    }));
    this._paintRange();
    this._bindSettings();
    const know = [];
    if (this._cfg.rfid) know.push("Laden starten Sie mit Ihrer Ladekarte am Lesefeld der Wallbox.");
    know.push(`Einphasig lädt die Wallbox mit höchstens 3,7 kW, dreiphasig mit bis zu ${zf(this._cfg.max_power, 0)} kW. Die Umschaltung erfolgt automatisch, das Fahrzeug pausiert dabei kurz.`);
    know.push("„Pausiert“ heißt: Die Wallbox wartet, zum Beispiel auf Sonnenstrom, und lädt danach von selbst weiter.");
    know.push("„Fahrzeug pausiert“ heißt: Das Auto nimmt keinen Strom ab, meist weil es voll ist oder im Auto ein Ladelimit eingestellt ist.");
    r.getElementById("know").innerHTML = know.map((t) => `<li>${zesc(t)}</li>`).join("");
  }
  _paintRange() {
    this.shadowRoot.querySelectorAll("#rng button").forEach((b) => b.classList.toggle("act", b.dataset.r === this._range));
  }
  _svg(p, s = 20) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor"><path d="${p}"/></svg>`; }

  /* ---------- Live-Werte ---------- */
  _update() {
    if (!this._hass || !this._built) return;
    const r = this.shadowRoot, c = this._cfg;
    const st = this._st("status");
    const con = this._st("connected");
    const offline = !st || st.state === "unavailable" || st.state === "unknown" || (con ? con.state !== "on" : !this._wb().connected);
    const [label, col, hint] = offline ? ["Nicht erreichbar", ZK.err, "Keine Verbindung zur Wallbox."] : ZW_STATUS[st.state] || [st.state, ZK.grey, ""];
    const chip = r.getElementById("chip");
    chip.querySelector("i").style.background = col;
    chip.querySelector("span").textContent = label;

    const charging = !offline && st.state === "Charging";
    const inTx = !offline && ["Charging", "SuspendedEV", "SuspendedEVSE"].includes(st.state);
    const pw = this._num("power");
    const kw = charging ? (pw == null ? null : pw / 1000) : offline ? null : 0;
    const cur = ["L1", "L2", "L3"].map((l) => (inTx ? this._attrNum("current", l) : null));
    const nph = cur.filter((a) => a != null && a > 0.5).length;
    r.getElementById("phtag").textContent = !charging ? "–" : nph === 1 ? "1-phasig" : nph === 3 ? "3-phasig" : `${nph}-phasig`;
    r.getElementById("nstate").innerHTML = `<span style="color:${col}">${zesc(label)}</span>`;
    r.getElementById("npow").textContent = kw == null ? "–" : `${zf(kw, kw >= 10 ? 1 : 2)} kW`;
    r.getElementById("nhint").textContent = hint;
    r.getElementById("ring").innerHTML = this._ring(kw || 0, c.max_power, charging);

    const maxA = Math.max(16, ...cur.map((a) => a || 0));
    r.getElementById("phases").innerHTML = ["L1", "L2", "L3"].map((l, i) => {
      const a = cur.at(i), pc = a == null ? 0 : Math.min(100, (a / maxA) * 100);
      const w = inTx ? this._attrNum("power", l) : null;
      return `<div class="ph"><span>${l}</span><div class="pbar"><div style="width:${pc}%;background:${[ZK.l1, ZK.l2, ZK.l3].at(i)}"></div></div>
        <b>${a == null ? "–" : `${zf(a, 1)} A`}</b><small>${w == null ? "" : `${zf(w / 1000, 2)} kW`}</small></div>`;
    }).join("");

    const sk = this._num("session_energy"), tm = this._num("session_duration"), off = this._num("current_offered");
    r.getElementById("s-kwh").textContent = sk == null ? "–" : `${zf(sk, 2)} kWh`;
    r.getElementById("s-time").textContent = zdur(tm);
    r.getElementById("s-off").textContent = off == null || !inTx ? "–" : `${zf(off, 0)} A`;
    r.getElementById("s-head").textContent = inTx ? "Ladevorgang" : "Letzter Ladevorgang";
    const stop = this._st("stop_reason");
    r.getElementById("s-stop").textContent = stop && stop.state && stop.state !== "unknown" && stop.state !== "unavailable" ? ZW_STOP[stop.state] || stop.state : "–";

    const tot = this._num("energy_total");
    r.getElementById("e-total").textContent = tot == null ? "–" : `${zf(tot, 1)} kWh`;

    const v = this._st("voltage");
    const va = v && v.state !== "unavailable" ? v.attributes : {};
    r.getElementById("volts").innerHTML = ["L1", "L2", "L3"].map((k) => {
      const x = parseFloat(va[k]);
      return `<div><span>Spannung ${k}</span><b>${isNaN(x) ? "–" : `${zf(x, 0)} V`}</b></div>`;
    }).join("");

    const txt = (k) => { const s = this._st(k); return s && s.state !== "unavailable" && s.state !== "unknown" ? s.state : "–"; };
    const dev = this._wb().device || {};
    const dv = (v) => (v == null || v === "" ? "–" : String(v));
    r.getElementById("g-model").textContent = dev.model === "AHP02-60327" ? "Alfen Eve Single Plus" : dv(dev.model);
    r.getElementById("g-fw").textContent = dv(dev.firmware);
    r.getElementById("g-serial").textContent = dv(dev.serial);
    const err = txt("error_code");
    r.getElementById("g-err").textContent = err === "NoError" ? "kein Fehler" : err;
    const on = r.getElementById("online");
    on.textContent = offline ? "Offline" : "Online";
    on.style.color = offline ? ZK.err : ZK.ok;
    const ds = r.getElementById("det-sum");
    ds.textContent = offline ? "Offline" : err !== "–" && err !== "NoError" ? `Fehler ${err}` : "Online";
    ds.style.color = offline || (err !== "–" && err !== "NoError") ? ZK.err : "";

    const av = this._st("available");
    const banner = r.getElementById("banner");
    banner.innerHTML = offline
      ? `<div class="banner">Die Wallbox ist gerade nicht erreichbar. Laden ist trotzdem möglich, die Anzeige fehlt nur.</div>`
      : av && av.state === "off" ? `<div class="banner">Die Wallbox ist außer Betrieb gesetzt.</div>` : "";

    this._updateMode();
    this._updateSettings(st, offline, inTx);
  }

  /* ---------- Einstellungen (OCPP-Ladeprofil auf Anschluss 1) ---------- */
  _getLim() {
    // Begrenzung, wie die Box sie zuletzt angenommen hat (Entität limit). null = keine Begrenzung.
    const s = this._st("limit");
    if (!s || s.state === "unknown" || s.state === "unavailable" || s.state === "") return null;
    const a = parseFloat(s.state);
    if (isNaN(a)) return null;
    const lim = { a: Math.round(a), p: Number(s.attributes.phases) === 1 ? 1 : 3 };
    if (lim.a > 0) this._lastLim = lim;
    return lim;
  }
  _cpId() { return this._wb().charge_point_id; }
  _maxA() { return Math.max(6, Number(this._cfg.max_current) || Number(this._wb() && this._wb().max_current) || 16); }
  _send(a, p) {
    // einphasig nie über 16 A (VDE-AR-N 4100, Schieflast ≤ 4,6 kVA); der Server kappt zusätzlich
    const amp = p === 1 ? Math.min(a, 16) : a;
    return this._hass.callService("zeo_sonnen", "wallbox_set_limit", { charge_point_id: this._cpId(), current: amp, phases: p });
  }
  _clear() { return this._hass.callService("zeo_sonnen", "wallbox_clear_limit", { charge_point_id: this._cpId() }); }
  _ask(text, fn) {
    const r = this.shadowRoot;
    if (!this._isManual()) text += " Der Lademodus wechselt dabei auf Manuell.";
    const inner = fn;
    fn = async () => { await this._toManual(); await inner(); };
    r.getElementById("set-conf-t").textContent = text;
    r.getElementById("set-conf").hidden = false;
    this._pendingFn = fn;
  }
  _done(msg) {
    const r = this.shadowRoot;
    r.getElementById("set-conf").hidden = true;
    this._pendingFn = null;
    this._pend = null;
    if (msg) this._flash = msg;
    this._updateSettings(this._st("status"), false, true);
  }
  _bindSettings() {
    const r = this.shadowRoot;
    // Einstellungen und Details klappen unter den beiden Knöpfen auf, immer nur eins
    const panes = { set: "set-box", veh: "veh-box", det: "det-box" };
    const toggle = (key) => {
      for (const [k, id] of Object.entries(panes)) {
        const box = r.getElementById(id), t = r.getElementById(`${k}-tgl`);
        const was = !box.hidden;
        box.hidden = k === key ? was : true;
        t.setAttribute("aria-expanded", String(!box.hidden));
        if (k === "set" && was && box.hidden) this._done();
      }
    };
    r.getElementById("set-tgl").addEventListener("click", () => toggle("set"));
    r.getElementById("det-tgl").addEventListener("click", () => toggle("det"));
    r.getElementById("veh-tgl").addEventListener("click", () => { toggle("veh"); if (!r.getElementById("veh-box").hidden) this._vehOpen(); });
    this._bindVehicles();
    const slider = r.getElementById("set-cur");
    slider.max = String(this._maxA());
    const stage = () => {
      const lim = this._getLim();
      const a = Number(slider.value), p = (this._pend && this._pend.p) || (lim && lim.p) || 3;
      this._pend = { a, p };
      const amp = p === 1 ? Math.min(a, 16) : a;
      this._ask(`Ladestrom ${amp} A, ${p}-phasig (${zf((amp * 230 * p) / 1000, 1)} kW) übernehmen?`, async () => {
        await this._send(amp, p);
      });
    };
    slider.addEventListener("input", () => { r.getElementById("set-cur-v").textContent = `${slider.value} A`; });
    slider.addEventListener("change", stage);
    r.querySelectorAll("#set-ph button").forEach((b) => b.addEventListener("click", () => {
      const lim = this._getLim();
      const p = Number(b.dataset.p);
      const a = Number(slider.value) || (lim && lim.a) || this._maxA();
      this._pend = { a, p };
      const amp = p === 1 ? Math.min(a, 16) : a;
      if (p === 1 && a > 16) slider.value = "16";
      this._paintPh(p);
      this._ask(`${p}-phasig mit ${amp} A (${zf((amp * 230 * p) / 1000, 1)} kW) übernehmen?`, async () => {
        await this._send(amp, p);
      });
    }));
    r.getElementById("set-no").addEventListener("click", () => this._done());
    r.getElementById("set-yes").addEventListener("click", async () => {
      const fn = this._pendingFn, btn = r.getElementById("set-yes");
      if (!fn) return;
      btn.disabled = true;
      try { await fn(); this._done("Übernommen"); }
      catch (e) { this._done(`Fehler: ${e && e.message ? e.message : "Wallbox hat abgelehnt"}`); }
      finally { btn.disabled = false; }
    });
    r.getElementById("set-pause").addEventListener("click", () => {
      const st = this._st("status");
      if (st && st.state === "SuspendedEVSE") {
        this._getLim();
        const lim = this._lastLim;
        this._ask("Ladung fortsetzen?", async () => { if (lim) await this._send(lim.a, lim.p); else await this._clear(); });
      } else {
        this._ask("Ladung pausieren? Die Wallbox gibt dann keinen Strom mehr frei, bis Sie fortsetzen.", async () => { await this._send(0, 3); });
      }
    });
    r.getElementById("set-reset").addEventListener("click", () => {
      this._ask("Alle Begrenzungen aufheben? Die Wallbox lädt dann wieder mit voller Leistung.", async () => { await this._clear(); this._lastLim = null; });
    });
    r.getElementById("set-avail").addEventListener("click", () => {
      const av = this._st("available"), on = av && av.state === "on";
      this._ask(on ? "Wallbox sperren? Sie lädt dann nicht mehr, auch nicht mit Karte." : "Wallbox wieder freigeben?", async () => {
        await this._hass.callService("switch", on ? "turn_off" : "turn_on", { entity_id: this._e.available });
      });
    });
  }
  _paintPh(p) { this.shadowRoot.querySelectorAll("#set-ph button").forEach((b) => b.classList.toggle("act", Number(b.dataset.p) === p)); }
  _updateSettings(st, offline, inTx) {
    const r = this.shadowRoot;
    if (!r.getElementById("set-cur")) return;
    const lim = this._getLim();
    const slider = r.getElementById("set-cur");
    if (!this._pend && !this._pendingFn) {
      slider.value = String(lim && lim.a > 0 ? lim.a : this._maxA());
      r.getElementById("set-cur-v").textContent = `${slider.value} A`;
      this._paintPh(lim ? lim.p : 3);
    }
    const paused = st && st.state === "SuspendedEVSE";
    const pb = r.getElementById("set-pause");
    pb.textContent = paused ? "Fortsetzen" : "Pausieren";
    pb.disabled = !inTx;
    r.getElementById("set-run-h").textContent = !inTx ? "Kein Ladevorgang aktiv" : paused ? "Pausiert" : "Läuft";
    const av = this._st("available"), on = av && av.state === "on";
    const ab = r.getElementById("set-avail");
    ab.textContent = on ? "Sperren" : "Freigeben";
    ab.disabled = offline || !av;
    r.getElementById("set-av-h").textContent = on ? "Freigegeben" : "Gesperrt";
    const info = r.getElementById("set-info");
    info.textContent = this._flash || (!this._isManual() ? "Der Lademodus regelt die Wallbox" : lim ? (lim.a === 0 ? "Pausiert (0 A)" : `Begrenzt auf ${lim.a} A, ${lim.p}-phasig`) : "Keine Begrenzung aktiv");
    if (this._flash) { clearTimeout(this._flashT); this._flashT = setTimeout(() => { this._flash = null; this._updateSettings(this._st("status"), false, true); }, 4000); }
    r.getElementById("set-reset").hidden = !lim;
    r.getElementById("set-sum").textContent = lim && this._isManual() ? (lim.a === 0 ? "Pausiert" : `${lim.a} A, ${lim.p}-phasig`) : "";
  }

  _modeState() { const e = this._cfg.mode; return e && this._hass.states[e]; }
  _isManual() { const s = this._modeState(); return !s || s.state === "Manuell"; }
  async _toManual() {
    const s = this._modeState();
    if (!s || s.state === "Manuell" || !(s.attributes.options || []).includes("Manuell")) return;
    await this._hass.callService(this._cfg.mode.split(".")[0], "select_option", { entity_id: this._cfg.mode, option: "Manuell" });
  }
  _updateMode() {
    const r = this.shadowRoot, s = this._modeState();
    r.getElementById("modebar").hidden = !s;
    if (!s) return;
    const opts = s.attributes.options || [];
    const box = r.getElementById("modes");
    const key = opts.join("|") + "#" + s.state;
    if (box.dataset.k !== key) {
      box.dataset.k = key;
      box.innerHTML = opts.map((o) => `<button data-o="${zesc(o)}" class="${o === s.state ? "act" : ""}">${zesc(o)}</button>`).join("");
      box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
        if (b.dataset.o === s.state) return;
        this._hass.callService(this._cfg.mode.split(".")[0], "select_option", { entity_id: this._cfg.mode, option: b.dataset.o });
      }));
    }
    const m = this._st("manager"), dry = this._st("dry");
    const ok = m && m.state !== "unavailable" && m.state !== "unknown";
    const col = !ok ? ZK.err : { solar: ZK.ev, power: ZK.ev, minimum: ZK.ev2, waiting: ZK.warn, battery_priority: ZK.warn, starting: ZK.warn, settling: ZK.warn }[m.state] || ZK.grey;
    r.getElementById("why-dot").style.background = col;
    r.getElementById("why").textContent = ok ? m.attributes.text || m.state : "Lademanager läuft nicht";
    r.getElementById("why-dry").hidden = !(dry && dry.state === "on" && s.state !== "Manuell");
  }

  _ring(kw, max, on) {
    const size = 132, sw = 11, rr = (size - sw) / 2, cf = 2 * Math.PI * rr;
    const pc = Math.max(0, Math.min(1, kw / (max || 11)));
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring">
      <circle cx="${size / 2}" cy="${size / 2}" r="${rr}" fill="none" stroke="var(--zl)" stroke-width="${sw}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${rr}" fill="none" stroke="${ZK.ev}" stroke-width="${sw}" stroke-linecap="round"
        stroke-dasharray="${(pc * cf).toFixed(1)} ${cf.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})" class="${on ? "pulse" : ""}"/>
      <g transform="translate(${size / 2 - 17} ${size / 2 - 27})" style="color:${on ? ZK.ev2 : "var(--zd)"}"><path d="${ZW_EV}" fill="currentColor" transform="scale(1.4)"/></g>
      <text x="${size / 2}" y="${size / 2 + 30}" text-anchor="middle" class="rsub">${Math.round(pc * 100)} % von ${zf(max, 0)} kW</text>
    </svg>`;
  }

  /* ---------- Fahrzeuge (Haushalt) und Auswahl Marke → Modell → Ausführung ---------- */
  async _vehWS(type, extra = {}) { return this._hass.callWS({ type: `zeo_sonnen/vehicles/${type}`, ...extra }); }
  async _vehLoad() {
    try {
      this._veh = await this._vehWS("list");
      this._vehOk = true;
    } catch (e) {
      this._vehOk = false;  // ältere Integration ohne Fahrzeuge: Knopf bleibt aus
    }
    this._vehSum();
  }
  _vehSum() {
    const r = this.shadowRoot, t = r && r.getElementById("veh-tgl");
    if (!t) return;
    t.hidden = !this._vehOk;
    const a = this._vehActive();
    r.getElementById("veh-sum").textContent = a ? a.name : "Nicht gewählt";
  }
  _vehActive() { const v = this._veh; return v ? (v.vehicles || []).find((x) => x.id === v.active) || null : null; }
  _vehOpen() {
    if (!this._vw || this._vw.view !== "form") this._vw = { view: (this._veh && this._veh.vehicles.length) ? "list" : "brand" };
    this._vehRender();
  }
  _vehSpec(kwh, ac, ph) {
    const p = [];
    if (kwh != null) p.push(`${zf(kwh, kwh % 1 ? 1 : 0)} kWh`);
    if (ac != null) p.push(`${zf(ac, ac % 1 ? 1 : 0)} kW${ph ? ` ${ph}-phasig` : ""}`);
    return p.join(" · ");
  }
  _vehYears(y) { return !y ? "" : y[0] === y[1] ? String(y[0]) : `${y[0]}–${y[1]}`; }
  async _vehCat(params = {}) {
    const key = JSON.stringify(params);
    this._vehCache = this._vehCache || {};
    if (!this._vehCache[key]) this._vehCache[key] = this._vehWS("catalog", params).catch((e) => { delete this._vehCache[key]; throw e; });
    return this._vehCache[key];
  }
  _bindVehicles() {
    const box = this.shadowRoot.getElementById("veh-box");
    box.addEventListener("click", (ev) => {
      const el = ev.target.closest("[data-act]");
      if (el && box.contains(el)) this._vehAct(el.dataset.act, el.dataset);
    });
    box.addEventListener("input", (ev) => {
      if (ev.target.id === "veh-q") { this._vw.q = ev.target.value; clearTimeout(this._vqT); this._vqT = setTimeout(() => this._vehList(), 250); }
    });
    box.addEventListener("submit", (ev) => { ev.preventDefault(); this._vehAct("save", {}); });
    this._vehLoad();
  }
  async _vehAct(act, d) {
    const w = this._vw;
    try {
      if (act === "add") this._vw = { view: "brand" };
      else if (act === "list") this._vw = { view: "list" };
      else if (act === "brand") this._vw = { view: "model", brand: d.b };
      else if (act === "model") this._vw = { view: "variant", brand: d.b, model: d.m };
      else if (act === "back") this._vw = w.view === "variant" ? { view: "model", brand: w.brand } : w.view === "model" ? { view: "brand" } : { view: (this._veh && this._veh.vehicles.length) ? "list" : "brand" };
      else if (act === "variant") {
        const res = await this._vehCat({ brand: w.brand, model: w.model });
        const v = res.variants.find((x) => x.id === d.id);
        if (!v) return;
        this._vw = { view: "form", back: w, f: { name: `${res.brand} ${res.model}`, brand: res.brand, model: res.model, variant: v.n, years: v.y,
          capacity_kwh: v.kwh, ac_kw: v.ac, phases: v.ph, catalog_id: v.id }, fromCat: true };
      } else if (act === "manual") {
        this._vw = { view: "form", back: w, f: { name: "", brand: w.brand || "", model: w.model || "", variant: "", capacity_kwh: null, ac_kw: 11, phases: 3 }, fromCat: false };
      } else if (act === "edit") {
        const v = this._veh.vehicles.find((x) => x.id === d.id);
        if (v) this._vw = { view: "form", back: { view: "list" }, f: { ...v }, fromCat: !!v.catalog_id };
      } else if (act === "formback") this._vw = w.back || { view: "list" };
      else if (act === "ph") { this._vehReadForm(); w.f.phases = Number(d.p); }
      else if (act === "use") { this._veh = await this._vehWS("activate", { vehicle_id: d.id }); this._vehSum(); }
      else if (act === "del") {
        if (w.confirmDel !== d.id) { w.confirmDel = d.id; }
        else { this._veh = await this._vehWS("delete", { vehicle_id: d.id }); w.confirmDel = null; this._vehSum(); if (!this._veh.vehicles.length) this._vw = { view: "brand" }; }
      } else if (act === "save") { await this._vehSave(); return; }
      else return;
    } catch (e) {
      (this._vw || {}).err = `Fehler: ${e && e.message ? e.message : "Aktion nicht möglich"}`;
    }
    this._vehRender();
  }
  _vehNum(s) { const v = parseFloat(String(s == null ? "" : s).replace(",", ".")); return isNaN(v) ? null : v; }
  _vehReadForm() {
    const r = this.shadowRoot, f = this._vw.f, g = (id) => r.getElementById(id);
    if (!g("vf-kwh")) return;
    f.name = g("vf-name").value.trim();
    if (!this._vw.fromCat) { f.brand = g("vf-brand").value.trim(); f.model = g("vf-model").value.trim(); f.variant = g("vf-var").value.trim(); }
    f.capacity_kwh = this._vehNum(g("vf-kwh").value);
    f.ac_kw = this._vehNum(g("vf-ac").value);
  }
  async _vehSave() {
    this._vehReadForm();
    const w = this._vw, f = w.f;
    const errs = [];
    if (!f.brand || !f.model) errs.push("Marke und Modell angeben");
    if (f.capacity_kwh == null || f.capacity_kwh < 5 || f.capacity_kwh > 250) errs.push("Akkugröße zwischen 5 und 250 kWh");
    if (f.ac_kw == null || f.ac_kw < 1.4 || f.ac_kw > 22) errs.push("Ladeleistung zwischen 1,4 und 22 kW");
    if (![1, 2, 3].includes(f.phases)) errs.push("Phasen wählen");
    if (errs.length) { w.err = errs.join(", ") + "."; this._vehRender(); return; }
    const vehicle = { name: f.name, brand: f.brand, model: f.model, variant: f.variant || "", capacity_kwh: f.capacity_kwh, ac_kw: f.ac_kw, phases: f.phases };
    if (f.id) vehicle.id = f.id;
    if (f.years) vehicle.years = f.years;
    if (f.catalog_id) vehicle.catalog_id = f.catalog_id;
    try {
      this._veh = await this._vehWS("save", { vehicle });
      this._vw = { view: "list", flash: "Gespeichert" };
      this._vehSum();
    } catch (e) {
      w.err = `Nicht gespeichert: ${e && e.message ? e.message : "Fehler"}`;
    }
    this._vehRender();
  }
  _vehHead(title, back = true) {
    return `<div class="vhd">${back ? `<button class="link" data-act="back">‹ Zurück</button>` : "<span></span>"}<b>${zesc(title)}</b><span></span></div>`;
  }
  _vehCrumbs() {
    const w = this._vw, c = [`<span class="${w.view === "brand" ? "on" : ""}">Marke</span>`, `<span class="${w.view === "model" ? "on" : ""}">Modell</span>`, `<span class="${w.view === "variant" ? "on" : ""}">Ausführung</span>`];
    return `<div class="crumbs">${c.join("<i>›</i>")}</div>`;
  }
  async _vehRender() {
    const box = this.shadowRoot.getElementById("veh-box");
    if (!box || box.hidden) return;
    const w = this._vw || { view: "list" };
    const token = (this._vehTok = (this._vehTok || 0) + 1);
    const err = w.err ? `<div class="verr">${zesc(w.err)}</div>` : "";
    w.err = null;
    if (w.view === "list") {
      const vs = (this._veh && this._veh.vehicles) || [];
      box.innerHTML = `${this._vehHead("Ihre Fahrzeuge", false)}${err}
        ${w.flash ? `<div class="vok">${zesc(w.flash)}</div>` : ""}
        <div class="vlist">${vs.map((v) => {
          const act = v.id === this._veh.active;
          return `<div class="vrow ${act ? "act" : ""}">
            <button class="vsel" data-act="use" data-id="${zesc(v.id)}" aria-pressed="${act}"><i></i><span><b>${zesc(v.name)}</b>
              <small>${zesc([v.variant, this._vehYears(v.years)].filter(Boolean).join(" · "))}</small>
              <small>${zesc(this._vehSpec(v.capacity_kwh, v.ac_kw, v.phases))}</small></span></button>
            <div class="vbtns"><button class="btn" data-act="edit" data-id="${zesc(v.id)}">Ändern</button>
              <button class="btn ${w.confirmDel === v.id ? "warn" : ""}" data-act="del" data-id="${zesc(v.id)}">${w.confirmDel === v.id ? "Wirklich entfernen?" : "Entfernen"}</button></div>
          </div>`;
        }).join("")}</div>
        <button class="btn add" data-act="add">+ Fahrzeug hinzufügen</button>
        <div class="vhint">Das gewählte Fahrzeug nutzt die Wallbox für das Laden bis zur Abfahrtszeit.</div>
        ${this._vehFoot()}`;
      w.flash = null;
      return;
    }
    if (w.view === "form") { box.innerHTML = this._vehForm(err); return; }
    const hasCars = !!(this._veh && this._veh.vehicles && this._veh.vehicles.length);
    box.innerHTML = `${this._vehHead(w.view === "brand" ? "Fahrzeug wählen" : w.view === "model" ? w.brand : `${w.brand} ${w.model}`, w.view !== "brand" || hasCars)}${this._vehCrumbs()}${err}
      ${w.view === "brand" ? `<input class="vq" id="veh-q" type="search" placeholder="Marke oder Modell suchen, z. B. ID.3" autocomplete="off" value="${zesc(w.q || "")}">` : ""}
      <div id="veh-items"><div class="msg sm">Lade …</div></div>
      <div class="vmiss">Ihr Fahrzeug ist nicht dabei? <button class="link" data-act="manual">Selbst eingeben</button></div>
      ${this._vehFoot()}`;
    if (w.view === "brand") { const q = this.shadowRoot.getElementById("veh-q"); if (q && w.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    await this._vehList(token);
  }
  async _vehList(token) {
    const w = this._vw, el = this.shadowRoot.getElementById("veh-items");
    if (!el) return;
    if (token == null) token = (this._vehTok = (this._vehTok || 0) + 1);
    let html = "";
    try {
      if (w.view === "brand") {
        const cat = await this._vehCat();
        this._vehMeta = cat;
        const q = (w.q || "").trim().toLowerCase();
        if (q.length >= 2) {
          const brands = cat.brands.filter((b) => b.n.toLowerCase().includes(q));
          const res = await this._vehWS("search", { query: q });
          html = (brands.length ? `<div class="vsub">Marken</div><div class="vgrid">${brands.map((b) => this._vehBrandBtn(b)).join("")}</div>` : "")
            + (res.results.length ? `<div class="vsub">Modelle</div><div class="vitems">${res.results.map((m) => `<button class="vit" data-act="model" data-b="${zesc(m.brand)}" data-m="${zesc(m.model)}"><b>${zesc(m.brand)} ${zesc(m.model)}</b><small>${zesc(this._vehYears(m.y))}</small><i>›</i></button>`).join("")}</div>` : "")
            || `<div class="msg sm">Nichts gefunden. Anders schreiben oder selbst eingeben.</div>`;
        } else {
          const top = ZW_TOP_BRANDS.map((n) => cat.brands.find((b) => b.n === n)).filter(Boolean);
          html = `<div class="vsub">Häufig</div><div class="vgrid">${top.map((b) => this._vehBrandBtn(b)).join("")}</div>
            <div class="vsub">Alle Marken</div><div class="vgrid">${[...cat.brands].sort((x, y) => x.n.localeCompare(y.n, "de", { sensitivity: "base" })).map((b) => this._vehBrandBtn(b)).join("")}</div>`;
        }
      } else if (w.view === "model") {
        const res = await this._vehCat({ brand: w.brand });
        const ms = [...res.models].sort((a, b) => ((b.y ? b.y[1] : 0) - (a.y ? a.y[1] : 0)) || a.n.localeCompare(b.n, "de"));
        html = `<div class="vitems">${ms.map((m) => `<button class="vit" data-act="model" data-b="${zesc(res.brand)}" data-m="${zesc(m.n)}"><b>${zesc(m.n)}</b><small>${zesc(this._vehYears(m.y))}</small><i>›</i></button>`).join("")}</div>`;
      } else if (w.view === "variant") {
        const res = await this._vehCat({ brand: w.brand, model: w.model });
        html = `<div class="vitems">${res.variants.map((v) => `<button class="vit" data-act="variant" data-id="${zesc(v.id)}"><b>${zesc(v.n || "Standard")}</b>
          <small>${zesc([this._vehYears(v.y), this._vehSpec(v.kwh, v.ac, v.ph)].filter(Boolean).join(" · "))}</small><i>›</i></button>`).join("")}</div>
          <div class="vhint">Unterscheiden sich die Ausführungen nur im Akku, hilft die Angabe im Fahrzeugschein nicht. Die nutzbare Akkugröße steht im Datenblatt oder in der App des Herstellers.</div>`;
      }
    } catch (e) {
      html = `<div class="msg sm">Der Fahrzeugkatalog konnte nicht geladen werden.</div>`;
    }
    if (token !== this._vehTok) return;  // inzwischen weitergeklickt
    el.innerHTML = html;
  }
  _vehBrandBtn(b) { return `<button class="vb" data-act="brand" data-b="${zesc(b.n)}">${zesc(b.n)}</button>`; }
  _vehForm(err) {
    const w = this._vw, f = w.f, ro = w.fromCat;
    const inp = (id, label, val, attrs = "") => `<label class="vf"><span>${label}</span><input id="${id}" value="${zesc(val == null ? "" : val)}" ${attrs}></label>`;
    const num = (v) => (v == null ? "" : String(v).replace(".", ","));
    const missing = ro && (f.ac_kw == null || !f.phases);
    return `${this._vehHead(f.id ? "Fahrzeug ändern" : "Angaben prüfen")}${err}
      <form class="vform" autocomplete="off">
        ${inp("vf-name", "Name (z. B. Kennzeichen)", f.name, 'maxlength="40"')}
        ${ro ? `<div class="vfix"><b>${zesc(f.brand)} ${zesc(f.model)}</b><small>${zesc([f.variant, this._vehYears(f.years)].filter(Boolean).join(" · "))}</small></div>`
          : `<div class="vf2">${inp("vf-brand", "Marke", f.brand, 'maxlength="40" required')}${inp("vf-model", "Modell", f.model, 'maxlength="60" required')}</div>${inp("vf-var", "Ausführung (optional)", f.variant, 'maxlength="80"')}`}
        <div class="vf2">
          ${inp("vf-kwh", "Akku nutzbar (kWh)", num(f.capacity_kwh), 'inputmode="decimal" required')}
          ${inp("vf-ac", "Laden an der Wallbox (kW)", num(f.ac_kw), 'inputmode="decimal" required')}
        </div>
        <div class="ctl"><div><b>Phasen beim Laden</b><small>Wie viele Phasen das Auto beim AC-Laden nutzt</small></div>
          <div class="seg small">${[1, 2, 3].map((p) => `<button type="button" data-act="ph" data-p="${p}" class="${f.phases === p ? "act" : ""}">${p}</button>`).join("")}</div></div>
        ${missing ? `<div class="vwarn">Für diese Ausführung fehlen Angaben zum Laden. Bitte prüfen, z. B. im Datenblatt. Viele aktuelle Autos laden mit 11 kW dreiphasig.</div>` : ""}
        <div class="vhint">Die Werte stammen aus einer offenen Datenbank und können abweichen. Sie lassen sich hier jederzeit ändern.</div>
        <div class="cbtns end"><button type="button" class="btn" data-act="formback">Abbrechen</button><button type="submit" class="btn yes">Speichern</button></div>
      </form>`;
  }
  _vehFoot() {
    const m = this._vehMeta;
    const src = (m && m.sources && m.sources.length ? m.sources : [{ name: "OpenEV Data", url: "https://github.com/open-ev-data/open-ev-data-dataset", license: "CDLA-Permissive-2.0" }, { name: "Open EV Data", url: "https://github.com/KilowattApp/open-ev-data", license: "MIT" }])
      .filter((s) => s.code !== "z")
      .map((s) => `<a href="${zesc(s.url)}" target="_blank" rel="noopener">${zesc(s.name)}</a> (${zesc(s.license)})`);
    return `<div class="vfoot">Fahrzeugdaten: ${src.join(", ")}${m && m.version ? ` · Stand ${zesc(m.version)}` : ""}</div>`;
  }

  /* ---------- Statistiken ---------- */
  async _loadStats() {
    if (!this._hass || this._statsBusy) return;
    this._statsBusy = true;
    this._statsAt = Date.now();
    const ws = this._hass.connection;
    const tot = this._e.energy_total, pow = this._e.power;
    if (!tot && !pow) { this._statsBusy = false; return; }
    const per = async (period) => {
      if (!tot) return null;
      try {
        const res = await ws.sendMessagePromise({ type: "recorder/statistic_during_period", statistic_id: tot, calendar: { period }, types: ["change"] });
        return res && res.change != null ? res.change : null;
      } catch (e) { return null; }
    };
    try {
      const [d, w, m, y] = await Promise.all([per("day"), per("week"), per("month"), per("year")]);
      this._sum = { d, w, m, y };
      const now = new Date(), start = zd0(now);
      const s14 = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 13);
      const [days, five] = await Promise.all([
        ws.sendMessagePromise({ type: "recorder/statistics_during_period", start_time: s14.toISOString(), period: "day", statistic_ids: [tot], types: ["change"] }).catch(() => ({})),
        ws.sendMessagePromise({ type: "recorder/statistics_during_period", start_time: start.toISOString(), period: "5minute", statistic_ids: [pow], types: ["mean"] }).catch(() => ({})),
      ]);
      this._days = (days && days[tot]) || [];
      this._five = ((five && five[pow]) || []).map((p) => ({ ...p, mean: p.mean == null ? null : p.mean / 1000 }));  // W -> kW
    } finally {
      this._statsBusy = false;
    }
    const r = this.shadowRoot;
    const kwhT = (v) => (v == null ? "–" : `${zf(v, v >= 100 ? 0 : 1)} kWh`);
    r.getElementById("e-day").textContent = kwhT(this._sum.d);
    r.getElementById("e-week").textContent = kwhT(this._sum.w);
    r.getElementById("e-month").textContent = kwhT(this._sum.m);
    r.getElementById("e-year").textContent = kwhT(this._sum.y);
    this._drawChart();
  }

  _drawChart() {
    const box = this.shadowRoot.getElementById("chart");
    if (!box) return;
    const W = Math.max(300, box.clientWidth || 640), H = 240, L = 40, R = 16, T = 24, B = 26;
    const iw = W - L - R, ih = H - T - B;
    if (this._range === "days") {
      const start = zd0(new Date());
      const days = Array.from({ length: 14 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() - 13 + i));
      const val = days.map((d) => {
        const row = (this._days || []).find((x) => zd0(new Date(x.start)).getTime() === d.getTime());
        return row && row.change != null ? Math.max(0, row.change) : 0;
      });
      const max = Math.max(1, ...val);
      const step = this._nice(max), top = Math.ceil(max / step) * step;
      const bw = iw / 14;
      let s = this._grid(W, L, R, T, ih, top, step, "kWh");
      days.forEach((d, i) => {
        const h = (val.at(i) / top) * ih, x = L + i * bw;
        s += `<rect x="${(x + bw * 0.18).toFixed(1)}" y="${(T + ih - h).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${ZK.ev}"><title>${zp2(d.getDate())}.${zp2(d.getMonth() + 1)}.: ${zf(val.at(i), 1)} kWh</title></rect>`;
        if (i % 2 === 1 || W > 520) s += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${ZW_WD.at(d.getDay())} ${d.getDate()}.</text>`;
      });
      box.innerHTML = val.some((v) => v > 0) ? `<svg width="${W}" height="${H}" class="csvg">${s}</svg>` : `<div class="msg">Noch keine Ladevorgänge in den letzten 14 Tagen.</div>`;
      return;
    }
    const pts = (this._five || []).filter((p) => p.mean != null);
    if (!pts.length) { box.innerHTML = `<div class="msg">Heute noch nicht geladen.</div>`; return; }
    const d0 = zd0(new Date()).getTime(), span = 864e5;
    const max = Math.max(1, ...pts.map((p) => p.mean));
    const step = this._nice(max), top = Math.ceil(max / step) * step;
    const X = (t) => L + ((t - d0) / span) * iw, Y = (v) => T + ih - (v / top) * ih;
    let s = this._grid(W, L, R, T, ih, top, step, "kW");
    const hs = W < 520 ? 6 : 3;
    for (let h = 0; h <= 24; h += hs) s += `<text x="${X(d0 + h * 36e5).toFixed(1)}" y="${H - 8}" text-anchor="${h === 0 ? "start" : h === 24 ? "end" : "middle"}" class="ax">${zp2(h)}:00</text>`;
    let path = "", area = "", prev = null;
    pts.forEach((p) => {
      const t = new Date(p.start).getTime(), x = X(t), y = Y(p.mean);
      const gap = prev == null || t - prev > 6 * 60000;
      path += `${gap ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      prev = t;
    });
    pts.forEach((p, i) => {
      const x = X(new Date(p.start).getTime()), y = Y(p.mean);
      area += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    const xa = X(new Date(pts.at(0).start).getTime()), xb = X(new Date(pts.at(-1).start).getTime());
    s += `<path d="${area}L${xb.toFixed(1)} ${T + ih}L${xa.toFixed(1)} ${T + ih}Z" fill="${ZK.ev}" opacity=".18"/>`;
    s += `<path d="${path}" fill="none" stroke="${ZK.ev2}" stroke-width="2" stroke-linejoin="round"/>`;
    const nx = X(Date.now());
    s += `<line x1="${nx.toFixed(1)}" x2="${nx.toFixed(1)}" y1="${T}" y2="${T + ih}" class="zl" stroke-dasharray="3 4"/>`;
    box.innerHTML = `<svg width="${W}" height="${H}" class="csvg">${s}</svg>`;
  }
  _nice(max) {
    const raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }
  _grid(W, L, R, T, ih, top, step, unit) {
    let s = "";
    for (let v = 0; v <= top + 1e-9; v += step) {
      const y = T + ih - (v / top) * ih;
      s += `<line x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="${v === 0 ? "zl" : "gl"}"/>`;
      s += `<text x="${L - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="ax">${zf(v, step < 1 ? 1 : 0)}</text>`;
    }
    s += `<text x="${L - 6}" y="${T - 12}" text-anchor="end" class="ax">${unit}</text>`;
    return s;
  }

  _css() {
    return `
    :host{display:block;container-type:inline-size}
    *{box-sizing:border-box}
    .z3{--zi:#16262D;--zs:#5F717A;--zd:#93A2AA;--zl:#E3E9EC;--zbg:#EEF2F3;--zc:#fff;--zf:#F2F6F7;--zseg:#E6ECEE;--zsa:#fff;
      --zgl:#EDF1F3;--zzl:#CBD5DA;--zh:#0E3A43;--zwb:#FFF5E4;--zwbd:#F3C97E;--zwi:#7A4E0E;
      --zsh:0 1px 2px rgba(16,40,48,.06),0 8px 24px rgba(16,40,48,.06);color-scheme:light}
    .z3.dark{--zi:#E6EEF0;--zs:#9DB1B8;--zd:#6E858D;--zl:#26434B;--zbg:#0B2227;--zc:#122C32;--zf:#183840;--zseg:#183840;--zsa:#2A4B53;
      --zgl:#1D3A41;--zzl:#3A5C65;--zh:#7FD6CB;--zwb:#3A2F16;--zwbd:#8C6B2B;--zwi:#F2D9A2;
      --zsh:0 1px 2px rgba(0,0,0,.25),0 8px 24px rgba(0,0,0,.25);color-scheme:dark}
    .z3{max-width:1480px;margin:0 auto;color:var(--zi);font-family:var(--ha-font-family-body,Roboto,"Helvetica Neue",Arial,sans-serif);
      background:var(--zbg);border-radius:var(--ha-card-border-radius,16px);overflow:hidden;font-variant-numeric:tabular-nums}
    .hero{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:24px 26px;
      background:linear-gradient(120deg,#0E3A43 0%,#155560 60%,#1E6B5C 100%);color:#fff}
    .brand{display:flex;gap:14px;align-items:center}
    .brand i{display:grid;place-items:center;width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.12);color:${ZK.ev}}
    h1{font-size:24px;font-weight:600;margin:0}
    .subt{font-size:13px;opacity:.85;margin-top:2px}
    .chip{display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:rgba(255,255,255,.14);font-size:14px;font-weight:500}
    .chip i{width:10px;height:10px;border-radius:50%}
    .banner{margin:16px 20px 0;background:var(--zwb);border:1px solid var(--zwbd);color:var(--zwi);padding:10px 14px;border-radius:12px;font-size:13px}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;padding:20px}
    .card{background:var(--zc);border-radius:16px;box-shadow:var(--zsh);padding:18px 20px;min-width:0}
    .card[hidden]{display:none}
    .card.wide2,.card.sess{grid-column:span 2}.card.full{grid-column:1 / -1}
    .card.know3{grid-column:3;grid-row:1}
    .sess .facts.f2{grid-template-columns:repeat(4,minmax(0,1fr))}
    .grid{grid-auto-flow:row dense}
    .card header{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}
    h2{font-size:16px;font-weight:600;margin:0;color:var(--zh)}
    .tag{font-size:12px;color:var(--zs);background:var(--zf);border-radius:999px;padding:4px 10px}
    .now{display:flex;align-items:center;gap:24px}
    .ring{flex:none}.rsub{font-size:11px;fill:var(--zs)}
    .ring .pulse{animation:zwp 2.4s ease-in-out infinite}
    @keyframes zwp{50%{opacity:.6}}
    .nstate{font-size:15px;font-weight:600}
    .npow{font-size:32px;font-weight:600;margin:2px 0;white-space:nowrap}
    .nhint{font-size:12.5px;color:var(--zs);line-height:1.4}.nhint.mt{margin-top:14px}
    .phases{display:flex;flex-direction:column;gap:10px}
    .ph{display:grid;grid-template-columns:24px 1fr 64px 64px;align-items:center;gap:10px;font-size:13px}
    .ph span{color:var(--zs);font-weight:600}.ph b{text-align:right;font-weight:600}.ph small{text-align:right;color:var(--zs);font-size:12px}
    .pbar{height:10px;background:var(--zf);border-radius:999px;overflow:hidden}
    .pbar div{height:100%;border-radius:999px;transition:width .8s}
    .facts{display:grid;gap:14px 18px}.facts.f2{grid-template-columns:1fr 1fr}.facts.f3{grid-template-columns:repeat(3,1fr)}
    .facts div{display:flex;flex-direction:column;gap:2px;min-width:0}
    .facts span{font-size:11.5px;color:var(--zs)}.facts b{font-size:17px;font-weight:600;overflow:hidden;text-overflow:ellipsis}
    .seg{display:inline-flex;flex-wrap:wrap;background:var(--zseg);border-radius:12px;padding:3px;gap:2px}
    .seg button{font:inherit;font-size:13px;color:var(--zs);background:none;border:0;border-radius:9px;padding:7px 14px;cursor:pointer}
    .seg button.act{background:var(--zsa);color:var(--zi);font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.12)}
    .seg.small button{padding:6px 11px;font-size:12px}
    .modebar{display:flex;flex-direction:column;gap:10px;margin-bottom:16px}.modebar[hidden]{display:none}
    .modebar .seg{display:flex;flex-wrap:nowrap}.modebar .seg button{flex:1;padding:8px 6px}
    .why{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;font-size:13px;color:var(--zi);min-height:20px}
    .why i{flex:none;width:9px;height:9px;border-radius:50%}
    .dry{font-style:normal;font-size:11px;font-weight:600;color:var(--zwi);background:var(--zwb);border:1px solid var(--zwbd);border-radius:999px;padding:2px 8px;white-space:nowrap}
    .dry[hidden]{display:none}
    .chart{position:relative;min-height:230px}
    .csvg{display:block}
    .gl{stroke:var(--zgl)}.zl{stroke:var(--zzl)}
    .ax{font-size:10.5px;fill:var(--zd)}
    .msg{padding:90px 0;text-align:center;color:var(--zs);font-size:13px}
    .know{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:9px;font-size:13px;line-height:1.45;color:var(--zi)}
    .know li::marker{color:${ZK.ev2}}
    .tgls{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:10px;margin-top:18px;padding-top:14px;border-top:1px solid var(--zl)}
    .settgl{display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:10px 12px;font:inherit;font-size:13.5px;font-weight:500;color:var(--zh);background:var(--zf);border:0;border-radius:12px;cursor:pointer}
    .settgl em{flex:1;text-align:right;font-style:normal;font-size:12px;color:var(--zs);font-weight:400}
    .settgl i{font-style:normal;transition:transform .2s}.settgl[aria-expanded="true"] i{transform:rotate(180deg)}
    .ctrls{display:flex;flex-direction:column;gap:10px;margin-top:10px}.ctrls[hidden]{display:none}
    .ctl{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;background:var(--zf);border-radius:12px}
    .ctl b{display:block;font-size:13.5px;font-weight:500}.ctl small{font-size:11.5px;color:var(--zs)}
    .rng{display:flex;align-items:center;gap:8px}.rng input{width:120px;accent-color:${ZK.ev2}}.rng em{font-style:normal;min-width:38px;text-align:right;font-weight:600}
    .btn{font:inherit;font-size:13px;border-radius:9px;padding:7px 14px;cursor:pointer;border:1px solid var(--zl);background:var(--zc);color:var(--zi);white-space:nowrap}
    .btn:disabled{opacity:.45;cursor:default}
    .confirm{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;background:var(--zwb);border:1px solid var(--zwbd);border-radius:12px;font-size:13px;color:var(--zi)}
    .confirm[hidden]{display:none}
    .cbtns{display:flex;gap:8px}
    .confirm button{font:inherit;font-size:13px;border-radius:9px;padding:7px 14px;cursor:pointer;border:1px solid var(--zl);background:var(--zc);color:var(--zi)}
    .confirm button.yes{background:${ZK.petrol};border-color:${ZK.petrol};color:#fff;font-weight:600}
    .confirm button:disabled{opacity:.5;cursor:default}
    .setfoot{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;color:var(--zs);padding:2px 4px}
    .link{font:inherit;font-size:12px;color:var(--zh);background:none;border:0;cursor:pointer;text-decoration:underline;padding:0}
    .link[hidden]{display:none}
    .dets{display:flex;flex-direction:column;gap:10px;margin-top:10px}.dets[hidden]{display:none}
    .settgl[hidden]{display:none}
    .vehs{display:flex;flex-direction:column;gap:10px;margin-top:10px}.vehs[hidden]{display:none}
    .vhd{display:grid;grid-template-columns:90px 1fr 90px;align-items:center;gap:8px}.vhd b{text-align:center;font-size:14px;color:var(--zh)}.vhd .link{justify-self:start}
    .crumbs{display:flex;justify-content:center;gap:6px;font-size:11.5px;color:var(--zd)}.crumbs .on{color:var(--zh);font-weight:600}.crumbs i{font-style:normal}
    .vq{width:100%;font:inherit;font-size:14px;padding:10px 12px;border-radius:12px;border:1px solid var(--zl);background:var(--zc);color:var(--zi)}
    .vsub{font-size:11.5px;color:var(--zs);text-transform:uppercase;letter-spacing:.04em;margin:6px 2px 0}
    .vgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:6px}
    .vb{font:inherit;font-size:13px;padding:10px 8px;border-radius:10px;border:0;background:var(--zf);color:var(--zi);cursor:pointer;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .vb:hover,.vit:hover{outline:2px solid var(--zl)}
    .vitems{display:flex;flex-direction:column;gap:6px}
    .vit{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto;column-gap:10px;text-align:left;font:inherit;padding:10px 12px;border-radius:12px;border:0;background:var(--zf);color:var(--zi);cursor:pointer}
    .vit b{font-size:13.5px;font-weight:500}.vit small{grid-column:1;font-size:12px;color:var(--zs)}.vit i{grid-column:2;grid-row:1 / 3;align-self:center;font-style:normal;color:var(--zd);font-size:18px}
    .vmiss{font-size:12.5px;color:var(--zs);padding:2px 4px}
    .vlist{display:flex;flex-direction:column;gap:8px}
    .vrow{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;background:var(--zf);border-radius:12px;border:2px solid transparent}
    .vrow.act{border-color:${ZK.ev}}
    .vsel{display:flex;gap:12px;align-items:center;font:inherit;text-align:left;background:none;border:0;color:var(--zi);cursor:pointer;padding:0;flex:1;min-width:180px}
    .vsel i{flex:none;width:18px;height:18px;border-radius:50%;border:2px solid var(--zd)}.vrow.act .vsel i{border-color:${ZK.ev2};background:radial-gradient(circle,${ZK.ev2} 45%,transparent 50%)}
    .vsel span{display:flex;flex-direction:column;gap:2px}.vsel b{font-size:14px;font-weight:600}.vsel small{font-size:12px;color:var(--zs)}
    .vbtns{display:flex;gap:6px}.btn.warn{border-color:${ZK.err};color:${ZK.err}}.btn.add{align-self:flex-start}
    .btn.yes{background:${ZK.petrol};border-color:${ZK.petrol};color:#fff;font-weight:600}
    .vform{display:flex;flex-direction:column;gap:10px}
    .vf{display:flex;flex-direction:column;gap:4px;min-width:0}.vf span{font-size:11.5px;color:var(--zs)}
    .vf input{font:inherit;font-size:14px;padding:9px 11px;border-radius:10px;border:1px solid var(--zl);background:var(--zc);color:var(--zi);width:100%}
    .vf2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .vfix{display:flex;flex-direction:column;gap:2px;padding:10px 12px;background:var(--zf);border-radius:12px}.vfix b{font-size:14px}.vfix small{font-size:12px;color:var(--zs)}
    .vhint,.vfoot{font-size:11.5px;color:var(--zs);line-height:1.4;padding:0 4px}.vfoot a{color:var(--zs)}
    .vwarn,.verr{padding:9px 12px;border-radius:12px;font-size:12.5px;background:var(--zwb);border:1px solid var(--zwbd);color:var(--zwi)}
    .verr{border-color:${ZK.err}}
    .vok{font-size:12.5px;color:${ZK.ok};padding:0 4px}
    .cbtns.end{justify-content:flex-end}
    .msg.sm{padding:24px 0}
    .dsec{border:1px solid var(--zl);border-radius:12px;padding:12px 14px}
    .dh{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:12px}
    .dh b{font-size:13.5px;font-weight:600;color:var(--zh)}.dh small{font-size:11.5px;color:var(--zs)}
    .facts.f4{grid-template-columns:repeat(4,minmax(0,1fr))}
    .dsec .facts b{font-size:15px}
    .volts{margin-top:14px;padding-top:12px;border-top:1px solid var(--zl)}
    @container (max-width:1100px){
      .grid{grid-template-columns:1fr 1fr}
      .card.wide2,.card.know3{grid-column:1 / -1;grid-row:auto}
      .card.sess{grid-column:auto}.sess .facts.f2{grid-template-columns:1fr 1fr}
    }
    @container (max-width:720px){
      .z3{border-radius:0}
      .hero{padding:16px}
      h1{font-size:19px}
      .grid{grid-template-columns:1fr;padding:12px;gap:12px}
      .card.wide2,.card.know3{grid-column:auto}
      .now{gap:16px}.ring{width:110px;height:110px}
      .npow{font-size:26px}
      .ctl{flex-wrap:wrap}.seg.small{flex-wrap:nowrap}.rng input{width:110px}
      .facts.f4{grid-template-columns:1fr 1fr}
      .settgl em{display:none}
      .tgls{gap:6px}.settgl{padding:10px 8px;gap:6px;font-size:13px}
      .vf2{grid-template-columns:1fr}.vgrid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr))}
      .vhd{grid-template-columns:70px 1fr 70px}
    }
    `;
  }
}

if (!customElements.get(ZW_TAG)) {
  customElements.define(ZW_TAG, ZeoSonnenWallboxCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: ZW_TAG, name: "ZEO Wallbox", description: "Wallbox (sonnenCharger 3 über OCPP) im Stil der sonnenBatterie-Hausansicht" });
}
