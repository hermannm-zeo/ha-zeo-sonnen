/* zeo-sonnen-card – Kundenportal für die sonnenBatterie in Home Assistant
 * ZEO Solar – Teil der Integration zeo_sonnen
 * Datenquelle: zeo_sonnen (lokale JSON-API). Entitäten und Modell kommen über
 * den Websocket-Befehl zeo_sonnen/info, die Entity-IDs sind damit egal.
 */
const SPC_VERSION = "0.4.0";

const C = {
  navy: "#0A1535",
  text: "#181A27",
  grey: "#61687A",
  light: "#C5C6C9",
  line: "#DADCE0",
  blue: "#0B7AC2",
  pv: "#FFCE4A",
  bat: "#A1D343",
  cons: "#2BB4DE",
  direct: "#A8E2D5",
  soc: "#7AA52A",
  ok: "#8CC63F",
  warn: "#F2A33A",
  err: "#E02F2F",
};

const DEFAULTS = (p) => ({
  pv_power: `sensor.${p}_solar_production_power`,
  consumption_power: `sensor.${p}_house_consumption_power`,
  charge_power: `sensor.${p}_battery_charge_power`,
  discharge_power: `sensor.${p}_battery_discharge_power`,
  grid_import_power: `sensor.${p}_grid_import_power`,
  grid_export_power: `sensor.${p}_grid_export_power`,
  soc: `sensor.${p}_state_of_charge`,
  soh: `sensor.${p}_state_of_health`,
  cycles: `sensor.${p}_cycle_count`,
  capacity: `sensor.${p}_installed_capacity`,
  remaining: `sensor.${p}_remaining_energy`,
  full_capacity: `sensor.${p}_full_charge_capacity`,
  system_status: `sensor.${p}_system_status`,
  status_light: `sensor.${p}_status_light`,
  problem: `binary_sensor.${p}_problem`,
  on_grid: `binary_sensor.${p}_on_grid`,
  backup_reserve: `number.${p}_backup_reserve`,
  operating_mode: `select.${p}_operating_mode`,
  pv_energy: `sensor.${p}_solar_production_energy`,
  consumption_energy: `sensor.${p}_house_consumption_energy`,
  grid_import_energy: `sensor.${p}_grid_import_energy`,
  grid_export_energy: `sensor.${p}_grid_export_energy`,
});

// Gehäusefarbe je Modell: [Fläche hell, Fläche dunkel, Linie, LED-Feld]
const HOUSING = {
  black: { a: "#3A3D43", b: "#16181C", stroke: "#2A2D33", fill: "#26292E", label: "schwarz" },
  white: { a: "#F6F6F4", b: "#DCDCD8", stroke: "#4A5260", fill: "#FFFFFF", label: "weiß" },
  grey: { a: "#CDD0D4", b: "#9EA3A9", stroke: "#4A5260", fill: "#B8BCC1", label: "grau" },
};

const MODE_LABEL = {
  automatic: "Eigenverbrauch",
  manual: "Manuell",
  time_of_use: "Time-of-Use",
  optimisation: "Optimierung",
};

const PAGES = [
  { id: "overview", label: "Übersicht", icon: "mdi:home-outline" },
  { id: "flow", label: "Energiefluss live", icon: "mdi:graph-outline" },
  { id: "analysis", label: "Auswertung", icon: "mdi:chart-areaspline" },
  { id: "battery", label: "sonnenBatterie", icon: "mdi:battery-outline" },
];

const fmtNum = (v, d = 1) =>
  v == null || isNaN(v) ? "–" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const kW = (w) => (w == null ? "–" : fmtNum(Math.abs(w) / 1000, 1));
const pad = (n) => String(n).padStart(2, "0");
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fmtDate = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

/* ------------------------------------------------------------------ */
/*  Illustration (eigene, generische Szene im Strichstil)              */
/* ------------------------------------------------------------------ */
const SCENE_SVG = `
<svg viewBox="0 0 600 300" preserveAspectRatio="xMidYMax meet" class="scene">
  <defs>
    <linearGradient id="spc-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E4F1F7"/><stop offset="1" stop-color="#FFFFFF"/>
    </linearGradient>
  </defs>
  <rect x="-600" width="1800" height="300" fill="url(#spc-sky)"/>
  <g stroke="#B7BCC4" stroke-width="1.2" fill="none">
    <line x1="88" y1="110" x2="88" y2="200"/><path d="M88 110 l-14 -10 M88 110 l16 -6 M88 110 l-2 17"/>
    <line x1="120" y1="122" x2="120" y2="200"/><path d="M120 122 l-11 -8 M120 122 l13 -5 M120 122 l-1 14"/>
    <path d="M330 200 V120 M318 132 h24 M322 146 h16 M330 120 l-12 80 M330 120 l12 80"/>
    <path d="M150 150 Q240 135 318 132 M150 160 Q240 150 322 146"/>
    <rect x="520" y="130" width="10" height="70"/><rect x="535" y="112" width="12" height="88"/><rect x="552" y="140" width="9" height="60"/>
  </g>
  <path d="M-600 205 Q-300 185 0 215 Q120 175 260 200 T600 190 T1200 200 V300 H-600Z" fill="#D9EBC4"/>
  <path d="M-600 236 Q-300 225 0 240 Q160 215 330 232 T600 228 T1200 232 V300 H-600Z" fill="#CBE3AE"/>
  <path d="M60 300 Q120 255 200 245" stroke="#E8EFE0" stroke-width="16" fill="none"/>
  <g stroke="#4A5260" stroke-width="1.4" fill="#fff">
    <path d="M50 192 l14 -12 l14 12 v18 h-28z"/><path d="M78 196 h26 v14 h-26z"/>
    <rect x="58" y="196" width="5" height="5"/><rect x="66" y="196" width="5" height="5"/><rect x="86" y="200" width="5" height="5"/>
  </g>
  <!-- Haus -->
  <g stroke="#4A5260" stroke-width="1.6">
    <path d="M318 112 L360 62 H500 L542 112 Z" fill="#D9DBDF"/>
    <rect x="330" y="112" width="200" height="140" fill="#F7F8FA"/>
  </g>
  <g id="spc-pv" class="spot">
    <path d="M376 102 L392 74 H462 L478 102 Z" fill="#CFE8F7" stroke="#3E9BD6" stroke-width="1.6"/>
    <path d="M392 88 H470 M405 74 L397 102 M423 74 L420 102 M441 74 L443 102 M459 74 L466 102" stroke="#3E9BD6" stroke-width="1.2"/>
  </g>
  <g id="spc-cons" class="spot" stroke="#4A5260" stroke-width="1.4" fill="none">
    <line x1="455" y1="112" x2="455" y2="128"/>
    <path d="M449 140 a6 6 0 1 1 12 0 c0 4 -3 5 -3 8 h-6 c0 -3 -3 -4 -3 -8z" fill="#fff"/>
    <path d="M440 146 l-5 3 M470 146 l5 3 M455 156 v5 M444 136 l-5 -3 M466 136 l5 -3"/>
  </g>
  <g id="spc-bat" class="spot" stroke="#4A5260" stroke-width="1.6">
    <rect id="spc-bat-body" x="364" y="168" width="46" height="72" rx="2" fill="#fff"/>
    <line x1="364" y1="188" x2="410" y2="188"/>
    <rect id="spc-bat-led" x="380" y="176" width="14" height="3" rx="1.5" fill="#A1D343" stroke="none"/>
    <path d="M344 224 h20" stroke="#4A5260"/><rect x="326" y="219" width="18" height="10" rx="2" fill="#fff"/>
  </g>
  <g id="spc-grid" class="spot" stroke="#4A5260" stroke-width="1.6" fill="#fff">
    <rect x="470" y="196" width="34" height="32" rx="2"/><circle cx="487" cy="212" r="7"/>
  </g>
  <g id="spc-ev" class="spot" stroke="#4A5260" stroke-width="1.6" fill="#fff">
    <path d="M150 262 v-18 c0 -6 4 -9 10 -10 l24 -14 c4 -2 8 -3 12 -3 h40 c6 0 10 3 14 7 l12 12 c8 1 14 4 14 10 v16 z"/>
    <path d="M188 230 l12 -9 h34 l10 9z" fill="#EEF2F5"/>
    <circle cx="176" cy="262" r="11"/><circle cx="252" cy="262" r="11"/>
    <rect x="282" y="222" width="16" height="30" rx="3"/><line x1="290" y1="252" x2="290" y2="262"/>
    <path d="M282 238 q-10 4 -16 18" fill="none"/>
  </g>
</svg>`;

/* ------------------------------------------------------------------ */

class SonnenPortalCard extends HTMLElement {
  setConfig(config) {
    const prefix = config.prefix || "zeo_sonnen";
    this._wsMode = !config.prefix;
    this._info = null;
    this._cfg = {
      title: "sonnenBatterie",
      model: "sonnenBatterie",
      serial: null,
      default_page: "overview",
      threshold: 30,
      color: null,
      ...config,
      entities: { ...DEFAULTS(prefix), ...(config.entities || {}) },
    };
    this._userEntities = config.entities || null;
    this._userModel = !!config.model;
    this._userColor = !!config.color;
    this._page = this._page || this._cfg.default_page;
    this._slide = this._slide || 0;
    this._day = this._day || dayStart(new Date());
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._wsMode && !this._info && !this._infoLoading) this._loadInfo();
    if (!this._built) this._build();
    this._update();
  }

  async _loadInfo() {
    this._infoLoading = true;
    try {
      const msg = { type: "zeo_sonnen/info" };
      if (this._cfg.entry_id) msg.entry_id = this._cfg.entry_id;
      const info = await this._hass.callWS(msg);
      this._info = info;
      this._cfg.entities = { ...this._cfg.entities, ...info.entities, ...(this._userEntities || {}) };
      if (!this._userModel) this._cfg.model = info.model_label;
      if (!this._userColor) this._cfg.color = info.color;
      this._built = false;
      this._build();
      this._update();
    } catch (err) {
      this._infoError = String((err && err.message) || err);
      this._update();
    } finally {
      this._infoLoading = false;
    }
  }

  _housing() {
    return HOUSING[this._cfg.color] || HOUSING.white;
  }

  getCardSize() {
    return 12;
  }
  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }
  static getStubConfig() {
    return { prefix: "sonnen_battery" };
  }

  /* ---------- Datenzugriff ---------- */
  _st(key) {
    const id = this._cfg.entities[key];
    return id && this._hass ? this._hass.states[id] : undefined;
  }
  _num(key) {
    const s = this._st(key);
    if (!s || s.state === "unavailable" || s.state === "unknown") return null;
    const v = parseFloat(s.state);
    return isNaN(v) ? null : v;
  }
  _avail() {
    const s = this._st("soc");
    return !!s && s.state !== "unavailable" && s.state !== "unknown";
  }
  _health() {
    if (!this._avail()) return { ok: false, text: "Keine Verbindung", color: C.warn };
    const prob = this._st("problem");
    const sys = this._st("system_status");
    const light = this._st("status_light");
    if ((prob && prob.state === "on") || (sys && /error/i.test(sys.state)) || (light && /red/.test(light.state)))
      return { ok: false, text: "Störung" + (sys ? ` (${sys.state})` : ""), color: C.err };
    return { ok: true, text: "Alles in Ordnung", color: C.ok };
  }
  _flows() {
    const t = this._cfg.threshold;
    const pv = this._num("pv_power");
    const cons = this._num("consumption_power");
    const ch = this._num("charge_power");
    const dis = this._num("discharge_power");
    const imp = this._num("grid_import_power");
    const exp = this._num("grid_export_power");
    return {
      pv, cons, ch, dis, imp, exp,
      soc: this._num("soc"),
      pvOn: pv > t, consOn: cons > t, chOn: ch > t, disOn: dis > t, impOn: imp > t, expOn: exp > t,
    };
  }

  /* ---------- Grundgerüst ---------- */
  _build() {
    this._built = true;
    const root = this.shadowRoot;
    root.innerHTML = `<style>${this._css()}</style>
      <div class="portal">
        <div class="topbar">
          <div class="brand">${this._cfg.menu_button ? `<button class="menubtn" id="menubtn" aria-label="Menü"><ha-icon icon="mdi:menu"></ha-icon></button>` : ""}<span class="logo"></span><span class="bt">${this._info && this._cfg.title === "sonnenBatterie" ? this._info.model_label : this._cfg.title}</span></div>
          <div class="conn" id="conn"></div>
        </div>
        <div class="body">
          <nav class="menu">${PAGES.map(
            (p) => `<a data-page="${p.id}"><ha-icon icon="${p.icon}"></ha-icon><span>${p.label}</span></a>`
          ).join("")}</nav>
          <main id="main"></main>
        </div>
      </div>`;
    const mb = root.getElementById("menubtn");
    if (mb)
      mb.addEventListener("click", () =>
        this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }))
      );
    root.querySelectorAll(".menu a").forEach((a) =>
      a.addEventListener("click", () => {
        this._page = a.dataset.page;
        this._renderPage();
        this._update();
      })
    );
    this._renderPage();
  }

  _renderPage() {
    const root = this.shadowRoot;
    root.querySelectorAll(".menu a").forEach((a) => a.classList.toggle("active", a.dataset.page === this._page));
    const main = root.getElementById("main");
    if (!PAGES.some((p) => p.id === this._page)) this._page = "overview";
    const title = PAGES.find((p) => p.id === this._page).label;
    this._flowSig = null;
    let html = `<div id="banner"></div><h1>${this._page === "overview" ? "Willkommen" : title}</h1>`;
    if (this._page === "overview") html += this._tplOverview();
    if (this._page === "flow") html += `<div class="flowwrap" id="flow"></div>`;
    if (this._page === "analysis") html += this._tplAnalysis();
    if (this._page === "battery") html += this._tplBattery();
    main.innerHTML = html;
    if (this._page === "overview") this._bindOverview();
    if (this._page === "analysis") this._bindAnalysis();
    if (this._page === "battery") this._bindBattery();
  }

  _update() {
    if (!this._hass || !this._built) return;
    const r = this.shadowRoot;
    const h = this._health();
    r.getElementById("conn").innerHTML = this._avail()
      ? `<span class="dot" style="background:${C.ok}"></span>Online`
      : `<span class="dot" style="background:${C.warn}"></span>Offline`;
    const banner = r.getElementById("banner");
    if (banner && this._wsMode && !this._info && !this._infoError) {
      banner.innerHTML = "";
    } else if (banner && this._infoError) {
      banner.innerHTML = `<div class="banner">Integration zeo_sonnen nicht erreichbar: ${this._infoError}</div>`;
    } else if (banner) {
      if (!this._avail()) {
        const s = this._st("soc");
        const since = s ? new Date(s.last_changed) : null;
        banner.innerHTML = `<div class="banner">Keine Verbindung zur sonnenBatterie${
          since ? ` seit ${fmtDate(since)} ${pad(since.getHours())}:${pad(since.getMinutes())} Uhr` : ""
        }. Angezeigt werden die zuletzt bekannten Daten.</div>`;
      } else banner.innerHTML = "";
    }
    if (this._page === "overview") this._updOverview(h);
    if (this._page === "flow") this._updFlow();
    if (this._page === "battery") this._updBattery(h);
    if (this._page === "analysis" && !this._anaLoaded) this._loadAnalysis();
  }

  /* ================================================================ */
  /*  Übersicht                                                        */
  /* ================================================================ */
  _slides() {
    const f = this._flows();
    const h = this._health();
    const gridTxt = f.expOn ? "Aktuelle Einspeisung" : "Aktueller Netzbezug";
    const gridVal = f.expOn ? f.exp : f.imp;
    return [
      { spot: "spc-pv", title: "Photovoltaikanlage", status: h, label: "Aktuelle Erzeugung", icon: "mdi:solar-panel", val: kW(f.pv), unit: "kW", color: C.pv },
      { spot: "spc-bat", title: "sonnenBatterie", status: h, label: "Aktueller Ladestand", icon: "mdi:battery-outline", val: fmtNum(f.soc, 0), unit: "%", color: C.bat },
      { spot: "spc-cons", title: "Verbrauch", status: h, label: "Aktueller Verbrauch", icon: "mdi:home-outline", val: kW(f.cons), unit: "kW", color: C.blue },
      { spot: "spc-grid", title: "Netz", status: h, label: gridTxt, icon: "mdi:transmission-tower", val: kW(gridVal), unit: "kW", color: C.grey },
    ];
  }
  _tplOverview() {
    return `<div class="ovw">
        <div class="scenebox">${SCENE_SVG}</div>
        <div class="slide card">
          <div class="s-title" id="s-title"></div>
          <div class="s-status" id="s-status"></div>
          <div class="s-label" id="s-label"></div>
          <div class="s-val"><ha-icon id="s-icon"></ha-icon><span id="s-val"></span><small id="s-unit"></small></div>
          <div class="s-nav"><a id="s-prev">‹ zurück</a><a id="s-next">weiter ›</a></div>
        </div>
      </div>
      <div class="ovw2">
        <div class="mini card" data-goto="flow"><ha-icon icon="mdi:graph-outline"></ha-icon><div><b>Energiefluss live</b><span>Durch den Energiefluss sind Sie immer auf dem neuesten Stand.</span></div></div>
        <div class="mini card" data-goto="analysis"><ha-icon icon="mdi:chart-areaspline"></ha-icon><div><b>Auswertung</b><span>Behalten Sie Ihren Energieverbrauch im Blick.</span></div></div>
        <div class="mini card" data-goto="battery"><ha-icon icon="mdi:battery-outline"></ha-icon><div><b>sonnenBatterie</b><span>Hier können Sie das Ladeverhalten Ihrer Batterie verfolgen.</span></div></div>
      </div>`;
  }
  _bindOverview() {
    const r = this.shadowRoot;
    const n = this._slides().length;
    r.getElementById("s-prev").onclick = () => { this._slide = (this._slide + n - 1) % n; this._update(); };
    r.getElementById("s-next").onclick = () => { this._slide = (this._slide + 1) % n; this._update(); };
    const spots = ["spc-pv", "spc-bat", "spc-cons", "spc-grid"];
    spots.forEach((id, i) => {
      const el = r.getElementById(id);
      if (el) el.addEventListener("click", () => { this._slide = i; this._update(); });
    });
    r.querySelectorAll("[data-goto]").forEach((el) =>
      el.addEventListener("click", () => { this._page = el.dataset.goto; this._renderPage(); this._update(); })
    );
  }
  _updOverview(h) {
    const r = this.shadowRoot;
    const s = this._slides()[this._slide];
    r.querySelectorAll(".spot").forEach((el) => el.classList.toggle("hl", el.id === s.spot));
    r.getElementById("s-title").textContent = s.title;
    r.getElementById("s-status").innerHTML = `<span style="color:${h.color}">${h.ok ? "✓" : "!"} ${h.text}</span>`;
    r.getElementById("s-label").textContent = s.label;
    r.getElementById("s-icon").setAttribute("icon", s.icon);
    r.getElementById("s-icon").style.color = C.grey;
    const v = r.getElementById("s-val");
    v.textContent = s.val;
    v.style.color = s.color;
    r.getElementById("s-unit").textContent = s.unit;
    const led = r.getElementById("spc-bat-led");
    if (led) led.setAttribute("fill", h.ok ? C.bat : h.color);
    const body = r.getElementById("spc-bat-body");
    if (body) body.setAttribute("fill", this._housing().fill);
  }

  /* ================================================================ */
  /*  Energiefluss live                                               */
  /* ================================================================ */
  _updFlow() {
    const f = this._flows();
    const host = this.shadowRoot.getElementById("flow");
    if (!host) return;
    const J = [250, 170];
    const segs = {
      pv: { from: [250, 118], on: f.pvOn, src: true, col: C.pv, p: f.pv },
      cons: { from: [154, 170], on: f.consOn, src: false, col: f.pvOn ? C.pv : f.disOn ? C.bat : C.grey, p: f.cons },
      bat: {
        from: [346, 170],
        on: f.chOn || f.disOn,
        src: f.disOn,
        col: f.disOn ? C.bat : f.pvOn ? C.pv : C.grey,
        p: f.disOn ? f.dis : f.ch,
      },
      grid: { from: [250, 222], on: f.impOn || f.expOn, src: f.impOn, col: f.impOn ? C.grey : f.disOn && !f.pvOn ? C.bat : C.pv, p: f.impOn ? f.imp : f.exp },
    };
    const dur = (p) => Math.max(0.6, Math.min(3, 3 - (Math.abs(p || 0) / 22000) * 2.4)).toFixed(1);
    const sig = JSON.stringify(Object.values(segs).map((s) => [s.on, s.src, s.col, s.on ? dur(s.p) : 0]));
    if (sig !== this._flowSig) {
      this._flowSig = sig;
      const base = Object.values(segs)
        .map((s) => {
          const vert = s.from[0] === J[0];
          const o = 4;
          const a = vert ? `M${s.from[0] - o} ${s.from[1]} L${J[0] - o} ${J[1]}` : `M${s.from[0]} ${s.from[1] - o} L${J[0]} ${J[1] - o}`;
          const b = vert ? `M${s.from[0] + o} ${s.from[1]} L${J[0] + o} ${J[1]}` : `M${s.from[0]} ${s.from[1] + o} L${J[0]} ${J[1] + o}`;
          return `<path d="${a}" class="rail"/><path d="${b}" class="rail"/>`;
        })
        .join("");
      const act = Object.values(segs)
        .filter((s) => s.on)
        .map((s) => {
          const d = `M${s.from[0]} ${s.from[1]} L${J[0]} ${J[1]}`;
          return `<path d="${d}" class="act" stroke="${s.col}"/>
            <path d="${d}" class="dots" stroke="${s.col}" style="animation-duration:${dur(s.p)}s;animation-direction:${s.src ? "normal" : "reverse"}"/>`;
        })
        .join("");
      host.innerHTML = `
        <svg viewBox="0 0 500 340" class="flowsvg">${base}${act}
          <circle cx="${J[0]}" cy="${J[1]}" r="3.5" fill="${Object.values(segs).some((s) => s.on) ? C.pv : C.light}"/>
        </svg>
        ${this._node("pv", 250, 70, C.pv, "mdi:solar-panel", "Erzeugung")}
        ${this._node("cons", 106, 170, C.blue, "mdi:home-outline", "Verbrauch")}
        ${this._node("bat", 394, 170, C.bat, "mdi:battery-outline", "sonnenBatterie")}
        ${this._node("grid", 250, 270, C.grey, "mdi:transmission-tower", "Netz")}`;
    }
    const set = (id, txt) => { const e = this.shadowRoot.getElementById(id); if (e) e.textContent = txt; };
    set("n-pv-v", `${kW(f.pv)} kW`);
    set("n-cons-v", `${kW(f.cons)} kW`);
    set("n-bat-v", `${kW(f.disOn ? f.dis : f.ch)} kW`);
    set("n-bat-x", f.soc == null ? "–" : `${fmtNum(f.soc, 0)}%`);
    set("n-grid-v", `${kW(f.impOn ? f.imp : f.expOn ? f.exp : 0)} kW`);
    set("n-grid-l", f.impOn ? "Netzbezug" : f.expOn ? "Netzeinspeisung" : "Netz");
      }
  _node(id, x, y, col, icon, label) {
    return `<div class="node" style="left:${(x / 500) * 100}%;top:${(y / 340) * 100}%;border-color:${col}">
      <ha-icon icon="${icon}" style="color:${C.grey}"></ha-icon>
      <div class="nv" id="n-${id}-v" style="color:${id === "grid" ? C.grey : col}">–</div>
      <div class="nl" id="n-${id}-l">${label}</div>
      ${id === "bat" ? `<div class="nx" id="n-bat-x" style="color:${C.bat}">–</div>` : ""}
    </div>`;
  }

  /* ================================================================ */
  /*  sonnenBatterie                                                  */
  /* ================================================================ */
  _tplBattery() {
    return `<div class="batgrid">
      <div class="card bcard">
        <h2>Meine sonnenBatterie</h2>
        <div class="bin">
          <div class="device" id="b-device" style="background:linear-gradient(145deg,${this._housing().a},${this._housing().b})"><div class="dled" id="b-led"></div></div>
          <dl>
            <dt>Modell</dt><dd id="b-model"></dd>
            <dt>Gehäuse</dt><dd>${this._housing().label}</dd>
            <dt>Kapazität</dt><dd id="b-cap"></dd>
            <dt>Betriebsart</dt><dd id="b-mode"></dd>
            ${this._cfg.serial ? `<dt>Seriennummer</dt><dd>${this._cfg.serial}</dd>` : `<dt>Systemstatus</dt><dd id="b-sys"></dd>`}
          </dl>
        </div>
        <div class="foot" id="b-health"></div>
      </div>
      <div class="card bcard">
        <h2>Batterie Status</h2>
        <div class="bin">
          <div class="cell"><div class="cap"></div><div class="fill" id="b-fill"></div></div>
          <dl>
            <dt>Ladestand</dt><dd class="big" id="b-soc"></dd>
            <dt>Ladezyklen</dt><dd id="b-cyc"></dd>
            <dt>Min. Notstrompuffer</dt><dd id="b-res"></dd>
            <dt>Gespeicherte Energie</dt><dd id="b-rem"></dd>
          </dl>
        </div>
        <div class="foot" id="b-online"></div>
      </div>
    </div>
    <h1 class="sub">Einstellungen</h1>
    <div class="card settings">
      <div class="srow">
        <div><b>Notstrompuffer</b><span>Reserve, die für einen Stromausfall in der Batterie bleibt.</span></div>
        <div class="ctl"><input type="range" min="0" max="100" step="1" id="c-res"><span id="c-res-v"></span></div>
      </div>
      <div class="srow">
        <div><b>Betriebsart</b><span>Steuerung des Lade- und Entladeverhaltens.</span></div>
        <div class="ctl"><select id="c-mode"></select></div>
      </div>
    </div>`;
  }
  _bindBattery() {
    const r = this.shadowRoot;
    const res = r.getElementById("c-res");
    res.addEventListener("input", () => (r.getElementById("c-res-v").textContent = `${res.value} %`));
    res.addEventListener("change", () => {
      this._hass.callService("number", "set_value", { entity_id: this._cfg.entities.backup_reserve, value: Number(res.value) });
    });
    const sel = r.getElementById("c-mode");
    sel.addEventListener("change", () => {
      this._hass.callService("select", "select_option", { entity_id: this._cfg.entities.operating_mode, option: sel.value });
    });
  }
  _updBattery(h) {
    const r = this.shadowRoot;
    const set = (id, txt) => { const e = r.getElementById(id); if (e) e.textContent = txt; };
    const soc = this._num("soc");
    const modeS = this._st("operating_mode");
    const mode = modeS && modeS.state;
    set("b-model", this._cfg.model);
    set("b-cap", this._num("capacity") == null ? "–" : `${fmtNum(this._num("capacity"), 1)} kWh`);
    set("b-mode", MODE_LABEL[mode] || (mode && mode !== "unavailable" ? mode : "–"));
    const sys = this._st("system_status");
    set("b-sys", sys && sys.state !== "unavailable" ? sys.state : "–");
    set("b-soc", soc == null ? "–" : `${fmtNum(soc, 0)}%`);
    set("b-cyc", this._num("cycles") == null ? "–" : fmtNum(this._num("cycles"), 0));
    set("b-res", this._num("backup_reserve") == null ? "–" : `${fmtNum(this._num("backup_reserve"), 0)}%`);
    const fc = this._num("full_capacity");
    set("b-rem", soc == null || fc == null ? "–" : `${fmtNum((soc / 100) * fc, 1)} kWh`);
    r.getElementById("b-fill").style.height = `${Math.max(0, Math.min(100, soc || 0))}%`;
    r.getElementById("b-led").style.background = h.ok ? C.bat : h.color;
    r.getElementById("b-health").innerHTML = `<span style="color:${h.color}">${h.ok ? "✓" : "!"}&nbsp; ${h.text}</span>`;
    r.getElementById("b-online").innerHTML = this._avail()
      ? `<span style="color:${C.ok}">Online</span>`
      : `<span style="color:${C.warn}">Offline</span>`;
    const res = r.getElementById("c-res");
    const rv = this._num("backup_reserve");
    const avail = this._avail();
    if (res && this.shadowRoot.activeElement !== res) {
      res.value = rv == null ? 0 : rv;
      res.disabled = !avail || rv == null;
      set("c-res-v", rv == null ? "–" : `${fmtNum(rv, 0)} %`);
    }
    const sel = r.getElementById("c-mode");
    if (sel && this.shadowRoot.activeElement !== sel) {
      const opts = (modeS && modeS.attributes.options) || [];
      const key = opts.join("|");
      if (sel.dataset.k !== key) {
        sel.innerHTML = opts.map((o) => `<option value="${o}">${MODE_LABEL[o] || o}</option>`).join("");
        sel.dataset.k = key;
      }
      if (mode && opts.includes(mode)) sel.value = mode;
      sel.disabled = !avail || !opts.includes(mode);
    }
  }

  /* ================================================================ */
  /*  Auswertung                                                      */
  /* ================================================================ */
  _tplAnalysis() {
    return `<div class="card ana">
        <div class="anahead">
          <div class="datenav"><a id="d-prev">‹</a><span id="d-lbl"></span><a id="d-next">›</a></div>
          <div class="legend">
            <span><i style="background:${C.pv}"></i>Erzeugung</span>
            <span><i style="background:${C.cons}"></i>Verbrauch</span>
            <span><i style="background:${C.direct}"></i>Direktverbrauch</span>
            <span><i class="ln" style="background:${C.soc}"></i>Ladestand</span>
          </div>
        </div>
        <div class="chart" id="chart"><div class="loading">Lade Daten …</div></div>
      </div>
      <h1 class="sub">Statistik</h1>
      <div class="card ana">
        <div class="zeit">Zeitraum: <b id="z-lbl"></b></div>
        <h2>Tageszusammenfassung</h2>
        <div class="sumgrid">
          <div class="bars" id="bars"></div>
          <div class="donuts" id="donuts"></div>
        </div>
      </div>`;
  }
  _bindAnalysis() {
    const r = this.shadowRoot;
    r.getElementById("d-prev").onclick = () => { this._day = new Date(this._day.getTime() - 86400000); this._day = dayStart(this._day); this._loadAnalysis(); };
    r.getElementById("d-next").onclick = () => {
      const n = new Date(this._day.getTime() + 36 * 3600000);
      if (n <= new Date()) { this._day = dayStart(n); this._loadAnalysis(); }
    };
    if (!this._ro) {
      this._ro = new ResizeObserver(() => { if (this._page === "analysis" && this._series) { this._drawChart(); this._drawBars(); } });
    }
    this._ro.observe(r.getElementById("chart"));
    this._anaLoaded = false;
  }
  async _loadAnalysis() {
    this._anaLoaded = true;
    const r = this.shadowRoot;
    const e = this._cfg.entities;
    const start = dayStart(this._day);
    const end = new Date(start.getTime() + 86400000);
    const lbl = fmtDate(start);
    const dl = r.getElementById("d-lbl"); if (dl) dl.textContent = lbl;
    const zl = r.getElementById("z-lbl"); if (zl) zl.textContent = lbl;
    const ids = [e.pv_power, e.consumption_power, e.soc];
    try {
      const hist = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const N = 288;
      const now = Date.now();
      const sample = (id, scale) => {
        const rows = (hist[id] || []).map((x) => [((x.lu ?? x.lc) || 0) * 1000, parseFloat(x.s)]);
        const out = new Array(N).fill(null);
        let j = 0, cur = null;
        for (let i = 0; i < N; i++) {
          const t = start.getTime() + i * 300000 + 150000;
          if (t > now) break;
          while (j < rows.length && rows[j][0] <= t) { cur = rows[j][1]; j++; }
          out[i] = cur == null || isNaN(cur) ? null : cur * scale;
        }
        return out;
      };
      const pv = sample(e.pv_power, 0.001);
      const cons = sample(e.consumption_power, 0.001);
      const soc = sample(e.soc, 1);
      const direct = pv.map((p, i) => (p == null || cons[i] == null ? null : Math.min(p, cons[i])));
      this._series = { pv, cons, soc, direct, start };
    } catch (err) {
      this._series = { pv: [], cons: [], soc: [], direct: [], start, err: String(err.message || err) };
    }
    try {
      const st = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: [e.pv_energy, e.consumption_energy, e.grid_import_energy, e.grid_export_energy],
        period: "hour",
        types: ["change"],
      });
      const hourly = (id) => {
        const out = new Array(24).fill(0);
        (st[id] || []).forEach((row) => {
          const h = Math.floor((row.start - start.getTime()) / 3600000);
          if (h >= 0 && h < 24 && row.change != null) out[h] += row.change;
        });
        return out;
      };
      this._stats = {
        pv: hourly(e.pv_energy),
        cons: hourly(e.consumption_energy),
        imp: hourly(e.grid_import_energy),
        exp: hourly(e.grid_export_energy),
      };
    } catch (err) {
      this._stats = null;
    }
    this._drawChart();
    this._drawBars();
  }
  _drawChart() {
    const host = this.shadowRoot.getElementById("chart");
    if (!host || !this._series) return;
    const s = this._series;
    const W = Math.max(320, host.clientWidth || 700);
    const H = 230;
    const L = 6, R = 6, T = 14, B = 26;
    const pw = W - L - R, ph = H - T - B;
    const all = [...s.pv, ...s.cons].filter((v) => v != null);
    if (!all.length) {
      host.innerHTML = `<div class="loading">${s.err ? "Fehler: " + s.err : "Für diesen Tag liegen keine Daten vor."}</div>`;
      return;
    }
    let max = Math.max(0.5, ...all) * 1.1;
    const step = max / 4;
    const N = 288;
    const x = (i) => L + (i / (N - 1)) * pw;
    const y = (v) => T + ph - (v / max) * ph;
    const ys = (v) => T + ph - (v / 100) * ph;
    const area = (arr) => {
      let d = "", open = false, first = 0;
      arr.forEach((v, i) => {
        if (v == null) { if (open) { d += `L${x(i - 1)} ${y(0)} L${x(first)} ${y(0)}Z`; open = false; } return; }
        if (!open) { d += `M${x(i)} ${y(0)} L${x(i)} ${y(v)}`; open = true; first = i; } else d += `L${x(i)} ${y(v)}`;
      });
      if (open) { const li = arr.length - 1 - [...arr].reverse().findIndex((v) => v != null); d += `L${x(li)} ${y(0)} L${x(first)} ${y(0)}Z`; }
      return d;
    };
    const line = (arr, fy) => {
      let d = "", open = false;
      arr.forEach((v, i) => {
        if (v == null) { open = false; return; }
        d += `${open ? "L" : "M"}${x(i)} ${fy(v)}`; open = true;
      });
      return d;
    };
    let grid = "";
    for (let k = 0; k <= 4; k++) {
      const yy = T + ph - (k / 4) * ph;
      grid += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="gl"/>
        <text x="${L + 2}" y="${yy - 3}" class="ax">${fmtNum(step * k, 2)} kW</text>
        <text x="${W - R - 2}" y="${yy - 3}" class="ax" text-anchor="end">${k * 25}%</text>`;
    }
    let xt = "";
    for (let hh = 0; hh <= 24; hh += 6) {
      const xx = L + (hh / 24) * pw;
      xt += `<text x="${xx}" y="${H - 6}" class="ax" text-anchor="${hh === 0 ? "start" : hh === 24 ? "end" : "middle"}">${pad(hh)}:00</text>`;
    }
    host.innerHTML = `<svg width="${W}" height="${H}" class="csvg">
        ${grid}
        <path d="${area(s.cons)}" fill="${C.cons}"/>
        <path d="${area(s.pv)}" fill="${C.pv}" fill-opacity="0.9"/>
        <path d="${area(s.direct)}" fill="${C.direct}"/>
        <path d="${line(s.soc, ys)}" fill="none" stroke="${C.soc}" stroke-width="2"/>
        ${xt}
        <line id="cx" y1="${T}" y2="${T + ph}" stroke="${C.text}" stroke-width="1" visibility="hidden"/>
        <circle id="cxh" cy="${T + ph + 8}" r="7" fill="#fff" stroke="${C.blue}" stroke-width="2" visibility="hidden"/>
        <rect x="${L}" y="${T}" width="${pw}" height="${ph + 20}" fill="transparent" id="hit"/>
      </svg><div class="tip" id="tip"></div>`;
    const hit = host.querySelector("#hit");
    const cx = host.querySelector("#cx");
    const cxh = host.querySelector("#cxh");
    const tip = host.querySelector("#tip");
    const move = (ev) => {
      const rect = host.querySelector("svg").getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      const i = Math.max(0, Math.min(N - 1, Math.round(((px - L) / pw) * (N - 1))));
      const xx = x(i);
      cx.setAttribute("x1", xx); cx.setAttribute("x2", xx); cx.setAttribute("visibility", "visible");
      cxh.setAttribute("cx", xx); cxh.setAttribute("visibility", "visible");
      const t = new Date(s.start.getTime() + i * 300000);
      const row = (c, lab, v) => `<div><i style="background:${c}"></i>${lab}<b>${v}</b></div>`;
      tip.innerHTML = `<div class="th">${fmtDate(t)} ${pad(t.getHours())}:${pad(t.getMinutes())}</div>
        ${row(C.cons, "Verbrauch", s.cons[i] == null ? "–" : fmtNum(s.cons[i], 1) + " kW")}
        ${row(C.direct, "Direktverbrauch", s.direct[i] == null ? "–" : fmtNum(s.direct[i], 1) + " kW")}
        ${row(C.pv, "Erzeugung", s.pv[i] == null ? "–" : fmtNum(s.pv[i], 1) + " kW")}
        ${row(C.soc, "Ladestand", s.soc[i] == null ? "–" : fmtNum(s.soc[i], 0) + " %")}`;
      tip.style.display = "block";
      const tw = 180;
      tip.style.left = `${Math.min(W - tw - 4, Math.max(4, xx - tw / 2))}px`;
    };
    hit.addEventListener("mousemove", move);
    hit.addEventListener("touchmove", move, { passive: true });
    hit.addEventListener("mouseleave", () => { tip.style.display = "none"; cx.setAttribute("visibility", "hidden"); cxh.setAttribute("visibility", "hidden"); });
  }
  _drawBars() {
    const r = this.shadowRoot;
    const host = r.getElementById("bars");
    const dn = r.getElementById("donuts");
    if (!host || !dn) return;
    const st = this._stats;
    if (!st) { host.innerHTML = `<div class="loading">Keine Statistikdaten vorhanden.</div>`; dn.innerHTML = ""; return; }
    const W = Math.max(280, host.clientWidth || 500), H = 200, L = 52, B = 22, T = 10;
    const pw = W - L - 4, ph = H - T - B;
    const max = Math.max(0.1, ...st.pv, ...st.cons) * 1.1;
    const bw = pw / 24;
    let g = "";
    for (let k = 0; k <= 4; k++) {
      const yy = T + ph - (k / 4) * ph;
      g += `<line x1="${L}" x2="${W}" y1="${yy}" y2="${yy}" class="gl"/><text x="${L - 6}" y="${yy + 3}" class="ax" text-anchor="end">${fmtNum((max / 4) * k, 1)} kWh</text>`;
    }
    for (let hh = 0; hh < 24; hh++) {
      const x0 = L + hh * bw;
      const w = Math.max(2, bw * 0.32);
      const hp = (st.pv[hh] / max) * ph, hc = (st.cons[hh] / max) * ph;
      g += `<rect x="${x0 + bw * 0.5 - w - 1}" y="${T + ph - hc}" width="${w}" height="${hc}" fill="${C.cons}"/>`;
      g += `<rect x="${x0 + bw * 0.5 + 1}" y="${T + ph - hp}" width="${w}" height="${hp}" fill="${C.pv}"/>`;
      if (hh % 2 === 0) g += `<text x="${x0 + bw / 2}" y="${H - 6}" class="ax" text-anchor="middle">${hh}</text>`;
    }
    host.innerHTML = `<svg width="${W}" height="${H}">${g}</svg>`;
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const P = sum(st.pv), Cn = sum(st.cons), I = sum(st.imp), E = sum(st.exp);
    const aut = Cn > 0 ? Math.max(0, Math.min(1, (Cn - I) / Cn)) : 0;
    const eig = P > 0 ? Math.max(0, Math.min(1, (P - E) / P)) : 0;
    const ring = (frac, col, val, lab, tcol) => {
      const R0 = 46, c = 2 * Math.PI * R0;
      return `<svg viewBox="0 0 120 120" class="ring"><circle cx="60" cy="60" r="${R0}" fill="none" stroke="#E4E6E9" stroke-width="5"/>
        <circle cx="60" cy="60" r="${R0}" fill="none" stroke="${col}" stroke-width="5" stroke-dasharray="${frac * c} ${c}" transform="rotate(-90 60 60)"/>
        <text x="60" y="60" text-anchor="middle" class="rv" fill="${tcol}">${fmtNum(val, val >= 100 ? 0 : 1)}<tspan class="ru"> kWh</tspan></text>
        <text x="60" y="78" text-anchor="middle" class="rl">${lab}</text></svg>`;
    };
    const pct = (v) => `${Math.round(v * 100)}%`;
    const autR = Cn > 0 ? pct(1 - aut) : "0%";
    const eigR = P > 0 ? pct(1 - eig) : "0%";
    dn.innerHTML = `
      <div class="drow">${ring(aut, "#45B39C", Cn, "Verbrauch", C.cons)}
        <div class="dleg"><div><i style="background:#45B39C"></i><b>${pct(aut)}</b> Autarkie</div><div><i style="background:#B8DCD4"></i><b>${autR}</b> Netzbezug</div></div></div>
      <div class="drow">${ring(eig, C.pv, P, "Erzeugung", "#F2B230")}
        <div class="dleg"><div><i style="background:${C.pv}"></i><b>${pct(eig)}</b> Eigenverbrauch</div><div><i style="background:#E4E6E9"></i><b>${eigR}</b> Netzeinspeisung</div></div></div>`;
  }

  /* ================================================================ */
  _css() {
    return `
    :host{display:block}
    *{box-sizing:border-box}
    .portal{max-width:1200px;margin:0 auto;font-family:"SonnenText","Helvetica Neue",Helvetica,Arial,sans-serif;color:${C.text};background:#fff;border-radius:var(--ha-card-border-radius,12px);overflow:hidden;box-shadow:var(--ha-card-box-shadow,none)}
    .topbar{background:${C.navy};height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;color:#fff}
    .brand{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;letter-spacing:.2px}
    .menubtn{background:none;border:0;color:#fff;cursor:pointer;padding:4px;margin-left:-8px;display:flex}
    .menubtn ha-icon{--mdc-icon-size:22px}
    .logo{width:20px;height:20px;border-radius:50%;border:2px solid #fff;display:inline-block;flex:0 0 20px}
    .conn{font-size:13px;color:#9FB3D1;display:flex;align-items:center;gap:6px}
    .dot{width:8px;height:8px;border-radius:50%;display:inline-block}
    .body{display:flex;gap:24px;padding:28px 24px 36px;min-height:520px}
    .menu{flex:0 0 200px;align-self:flex-start;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.15)}
    .menu a{display:flex;align-items:center;gap:12px;padding:0 16px;height:44px;font-size:13px;color:${C.text};cursor:pointer;border-bottom:1px solid #EEF0F2;user-select:none}
    .menu a:last-child{border-bottom:none}
    .menu a ha-icon{--mdc-icon-size:18px;color:${C.grey}}
    .menu a.active,.menu a.active ha-icon{color:${C.blue}}
    .menu a:hover{background:#F6F8FA}
    main{flex:1;min-width:0}
    h1{font-size:18px;font-weight:400;margin:6px 0 20px;padding-bottom:10px;border-bottom:1px solid ${C.line}}
    h1.sub{margin-top:34px}
    h2{font-size:16px;font-weight:400;margin:0 0 16px;padding-bottom:10px;border-bottom:1px solid ${C.line}}
    .card{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.15)}
    .banner{background:#FFF6E5;border-left:3px solid ${C.warn};padding:10px 14px;font-size:13px;margin-bottom:16px;color:#6B4A12}
    /* Übersicht */
    .ovw{position:relative;display:flex;align-items:stretch}
    .scenebox{flex:1;min-width:0;aspect-ratio:2/1;max-height:320px;overflow:hidden;display:flex;background:linear-gradient(180deg,#E4F1F7 0%,#FFFFFF 58%,#D9EBC4 66%,#CBE3AE 100%)}
    .scene{width:100%;height:100%;display:block;overflow:visible}
    .spot{cursor:pointer;transition:filter .2s}
    .spot.hl{filter:drop-shadow(0 0 6px rgba(11,122,194,.55))}
    .spot.hl [stroke="#4A5260"],.spot.hl{stroke:${C.blue}}
    .slide{flex:0 0 220px;margin:-8px 0 -8px -12px;padding:18px 18px 14px;display:flex;flex-direction:column;z-index:1}
    .s-title{font-size:16px;padding-bottom:10px;margin-bottom:10px;border-bottom:1px solid ${C.line}}
    .s-status{font-size:12px;margin-bottom:26px}
    .s-label{font-size:12px;color:${C.grey}}
    .s-val{display:flex;align-items:baseline;justify-content:center;gap:6px;margin:14px 0 auto}
    .s-val ha-icon{--mdc-icon-size:22px;align-self:center}
    .s-val span{font-size:32px;font-weight:500}
    .s-val small{font-size:14px;color:${C.grey}}
    .s-nav{display:flex;justify-content:space-between;font-size:12px;margin-top:22px}
    .s-nav a{color:${C.blue};cursor:pointer;user-select:none}
    .ovw2{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:28px}
    .mini{display:flex;gap:12px;padding:16px;cursor:pointer;align-items:flex-start}
    .mini ha-icon{color:${C.blue};--mdc-icon-size:22px}
    .mini b{display:block;font-weight:500;font-size:14px;margin-bottom:4px}
    .mini span{font-size:12px;color:${C.grey};line-height:1.4}
    /* Energiefluss */
    .flowwrap{position:relative;width:100%;max-width:560px;margin:10px auto;aspect-ratio:500/340;container-type:inline-size}
    .flowsvg{position:absolute;inset:0;width:100%;height:100%}
    .rail{stroke:${C.line};stroke-width:1.2;fill:none}
    .act{stroke-width:1.6;fill:none;opacity:.55}
    .dots{fill:none;stroke-width:5;stroke-linecap:round;stroke-dasharray:0.1 16;animation:spc-move linear infinite}
    @keyframes spc-move{from{stroke-dashoffset:16}to{stroke-dashoffset:0}}
    .node{position:absolute;width:17.6%;aspect-ratio:1;transform:translate(-50%,-50%);border:2px solid;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
    .node{overflow:hidden}
    .node ha-icon{--mdc-icon-size:clamp(13px,3.6cqw,20px);margin-bottom:0.6cqw}
    .nv{font-size:clamp(11px,3.3cqw,18px);font-weight:500;line-height:1.1;white-space:nowrap}
    .nl{font-size:clamp(7.5px,1.95cqw,10.5px);color:${C.grey};font-weight:500;margin-top:2px;white-space:nowrap}
    .nx{font-size:clamp(9px,2.4cqw,13px);font-weight:500;margin-top:1px}
    /* Batterie */
    .batgrid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
    .bcard{padding:20px 20px 0;display:flex;flex-direction:column}
    .bin{display:flex;gap:28px;padding:10px 0 24px;flex:1}
    .device{width:130px;height:130px;background:linear-gradient(145deg,#F4F4F2,#DCDCD8);box-shadow:2px 3px 8px rgba(0,0,0,.18);position:relative;flex:0 0 auto}
    .dled{position:absolute;left:50%;top:44%;width:26px;height:4px;border-radius:2px;transform:translateX(-50%);background:${C.bat}}
    .cell{width:64px;height:130px;border:2px solid #E1E3E6;border-radius:3px;position:relative;flex:0 0 auto;margin-left:20px;background:#fff;display:flex;align-items:flex-end;padding:3px}
    .cell .cap{position:absolute;top:-7px;left:50%;transform:translateX(-50%);width:22px;height:5px;background:#E1E3E6;border-radius:2px 2px 0 0}
    .cell .fill{width:100%;background:${C.bat};transition:height .6s}
    dl{margin:0;font-size:12px}
    dt{color:${C.grey};margin-top:6px}
    dd{margin:2px 0 0;color:${C.text}}
    dd.big{font-size:30px;color:${C.bat};font-weight:400}
    .foot{border-top:1px solid ${C.line};margin:0 -20px;padding:16px;text-align:center;font-size:14px}
    .settings{padding:6px 20px}
    .srow{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:14px 0;border-bottom:1px solid #EEF0F2}
    .srow:last-child{border-bottom:none}
    .srow b{display:block;font-weight:500;font-size:14px}
    .srow span{font-size:12px;color:${C.grey}}
    .ctl{display:flex;align-items:center;gap:10px}
    .ctl input[type=range]{width:180px;accent-color:${C.blue}}
    .ctl span{min-width:44px;text-align:right;font-size:14px;color:${C.text}}
    .ctl select{font:inherit;font-size:13px;padding:6px 10px;border:1px solid ${C.light};border-radius:3px;background:#fff;color:${C.text}}
    /* Auswertung */
    .ana{padding:16px 20px 20px}
    .anahead{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:8px;padding-bottom:10px;border-bottom:1px solid ${C.line}}
    .datenav{display:flex;align-items:center;gap:12px;font-size:14px}
    .datenav a{color:${C.blue};cursor:pointer;font-size:20px;user-select:none;padding:0 4px}
    .legend{display:flex;gap:16px;font-size:11px;color:${C.grey};flex-wrap:wrap}
    .legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
    .legend i.ln{width:14px;height:2px;border-radius:0;vertical-align:middle}
    .chart{position:relative;min-height:230px}
    .csvg{display:block}
    .gl{stroke:#EEF0F2;stroke-width:1}
    .ax{font-size:9px;fill:#9EA3AE}
    .loading{padding:60px 0;text-align:center;color:${C.grey};font-size:13px}
    .tip{display:none;position:absolute;top:6px;width:180px;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.2);padding:8px 10px;font-size:11px;pointer-events:none}
    .tip .th{color:${C.grey};margin-bottom:6px}
    .tip div{display:flex;align-items:center;gap:6px;margin:3px 0}
    .tip i{width:7px;height:7px;border-radius:50%;display:inline-block}
    .tip b{margin-left:auto;font-weight:500}
    .zeit{font-size:12px;color:${C.grey};padding-bottom:12px;margin:0 -20px 18px;padding-left:20px;border-bottom:1px solid ${C.line}}
    .zeit b{color:${C.text};font-weight:400;margin-left:8px}
    .sumgrid{display:grid;grid-template-columns:1fr 260px;gap:24px;align-items:center}
    .bars{min-width:0}
    .drow{display:flex;align-items:center;gap:14px;margin:6px 0}
    .ring{width:120px;height:120px;flex:0 0 120px}
    .rv{font-size:15px}.ru{font-size:8px}.rl{font-size:9px;fill:#9EA3AE}
    .dleg{font-size:11px;color:${C.grey}}
    .dleg div{margin:4px 0;display:flex;align-items:center;gap:6px}
    .dleg i{width:7px;height:7px;border-radius:50%;display:inline-block}
    .dleg b{color:${C.text};font-weight:500}
    @media (max-width:860px){
      .body{flex-direction:column;padding:16px 12px}
      .menu{flex:none;width:100%;display:flex;overflow-x:auto}
      .menu a{border-bottom:none;border-right:1px solid #EEF0F2;white-space:nowrap;flex:1;justify-content:center}
      .menu a span{font-size:12px}
      .ovw{flex-direction:column}
      .scenebox{max-height:none}
      .slide{flex:none;margin:-10px 10px 0;}
      .ovw2,.batgrid,.sumgrid{grid-template-columns:1fr}
      .bin{gap:18px}
      .srow{flex-direction:column;align-items:flex-start}
      .menu a ha-icon{display:none}
      .brand{font-size:13px}
      .node{width:21%}
    }
    `;
  }
}

/* Vollbild-Panel in der Seitenleiste (von der Integration registriert) */
class ZeoSonnenPanel extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    this._render();
  }
  set panel(panel) {
    this._panel = panel;
    this._render();
  }
  set narrow(narrow) {
    this._narrow = narrow;
    if (this._card && this._card._cfg && this._card._cfg.menu_button !== !!narrow) {
      this._card.setConfig({ ...this._baseCfg, menu_button: !!narrow });
      if (this._hass) this._card.hass = this._hass;
    }
  }
  _render() {
    if (!this._hass || !this._panel) return;
    if (!this._card) {
      this.style.cssText = "display:block;min-height:100vh;background:#EEF0F2;box-sizing:border-box;padding:16px";
      this._baseCfg = { entry_id: (this._panel.config || {}).entry_id, default_page: "overview" };
      this._card = document.createElement("zeo-sonnen-card");
      this._card.setConfig({ ...this._baseCfg, menu_button: !!this._narrow });
      this.appendChild(this._card);
    }
    this._card.hass = this._hass;
  }
}

if (!customElements.get("zeo-sonnen-card")) {
  customElements.define("zeo-sonnen-card", SonnenPortalCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "zeo-sonnen-card",
    name: "ZEO sonnenBatterie",
    description: "Kundenportal: Übersicht, Energiefluss, Auswertung, sonnenBatterie",
  });
  console.info(`%c ZEO-SONNEN %c v${SPC_VERSION} `, "background:#0A1535;color:#fff", "background:#A1D343;color:#0A1535");
}
if (!customElements.get("zeo-sonnen-panel")) customElements.define("zeo-sonnen-panel", ZeoSonnenPanel);
