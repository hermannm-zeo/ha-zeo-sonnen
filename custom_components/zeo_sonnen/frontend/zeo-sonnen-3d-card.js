/* zeo-sonnen-3d-card – Energieportal für die sonnenBatterie in Home Assistant
 * ZEO Solar – Teil der Integration zeo_sonnen
 *
 * Hausbild als Hintergrund (Tag/Nacht nach Sonnenstand am HA-Standort),
 * darüber runde Wertanzeigen und animierte Energieflüsse. Daten ausschließlich
 * von der sonnenBatterie (zeo_sonnen), Entitäten über den Websocket zeo_sonnen/info.
 * Die Bilder liegen als eigene Module neben der Karte (zeo-sonnen-bg-day.js,
 * zeo-sonnen-bg-night.js) oder werden über bg_day / bg_night angegeben.
 */
const Z3_TAG = "zeo-sonnen-3d-card";
const Z3_VERSION = "0.5.0";
// sonnen-Systemstatus kundenverständlich
const Z3_SYS = { ongrid: "Netzbetrieb", offgrid: "Notstrombetrieb", island: "Notstrombetrieb", standby: "Bereitschaft", error: "Störung" };
const Z3_BASE = "/zeo_sonnen_static";
// Version aus der eigenen URL, damit auch die Bildmodule nach einem Update neu geladen werden
const Z3_Q = (() => { try { const v = new URL(import.meta.url).searchParams.get("v"); return v ? `?v=${encodeURIComponent(v)}` : ""; } catch (e) { return ""; } })();

const K = {
  ink: "#16262D",
  sub: "#5F717A",
  dim: "#93A2AA",
  line: "#E3E9EC",
  petrol: "#0E3A43",
  pv: "#F5B52E",
  pv2: "#F08A24",
  bat: "#4CC38A",
  bat2: "#1E9E68",
  cons: "#2E9BD6",
  cons2: "#1F6FB2",
  grid: "#8695A0",
  exp: "#9C7FE0",
  ev: "#9BD62A",
  hp: "#12C2D6",
  ok: "#3DBE7A",
  warn: "#E9A23B",
  err: "#E2574C",
};
const HOUSING = { black: "schwarz", white: "weiß", grey: "grau" };

const Z3_DEFAULTS = (p) => ({
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
  full_capacity: `sensor.${p}_full_charge_capacity`,
  system_status: `sensor.${p}_system_status`,
  status_light: `sensor.${p}_status_light`,
  problem: `binary_sensor.${p}_problem`,
  backup_reserve: `number.${p}_backup_reserve`,
  operating_mode: `select.${p}_operating_mode`,
  pv_energy: `sensor.${p}_solar_production_energy`,
  consumption_energy: `sensor.${p}_house_consumption_energy`,
  grid_import_energy: `sensor.${p}_grid_import_energy`,
  grid_export_energy: `sensor.${p}_grid_export_energy`,
  charge_energy: `sensor.${p}_battery_charge_energy`,
  discharge_energy: `sensor.${p}_battery_discharge_energy`,
});

const Z3_MODE = { automatic: "Eigenverbrauch", manual: "Manuell", time_of_use: "Time-of-Use", optimisation: "Optimierung" };
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONL = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

const ICON = {
  pv: "M4,2H20A2,2 0 0,1 22,4V14A2,2 0 0,1 20,16H15V20H18V22H13V16H11V22H6V20H9V16H4A2,2 0 0,1 2,14V4A2,2 0 0,1 4,2M4,4V8H11V4H4M4,14H11V10H4V14M20,14V10H13V14H20M20,4H13V8H20V4Z",
  home: "M12,3L2,12H5V20H19V12H22L12,3M11.5,18V14H9L12.5,7V11H15L11.5,18Z",
  bat: "M16,20H8V6H16M16.67,4H15V2H9V4H7.33A1.33,1.33 0 0,0 6,5.33V20.67C6,21.4 6.6,22 7.33,22H16.67A1.33,1.33 0 0,0 18,20.67V5.33C18,4.6 17.4,4 16.67,4Z",
  grid: "M8.28,5.45L6.5,4.55L7.76,2H16.23L17.5,4.55L15.72,5.44L15,4H9L8.28,5.45M18.62,8H14.09L13.3,5H10.7L9.91,8H5.38L4.1,10.55L5.89,11.44L6.62,10H17.38L18.1,11.45L19.89,10.56L18.62,8M17.77,22H15.7L15.46,21.1L12,15.9L8.53,21.1L8.3,22H6.23L9.12,11H11.19L10.83,12.35L12,14.1L13.16,12.35L12.81,11H14.88L17.77,22M11.4,15L10.5,13.65L9.32,18.13L11.4,15M14.68,18.12L13.5,13.64L12.6,15L14.68,18.12Z",
  leaf: "M17,8C8,10 5.9,16.17 3.82,21.34L5.71,22L6.66,19.7C7.14,19.87 7.64,20 8,20C19,20 22,3 22,3C21,5 14,5.25 9,6.25C4,7.25 2,11.5 2,13.5C2,15.5 3.75,17.25 3.75,17.25C7,8 17,8 17,8Z",
  ev: "M19.77,7.23L19.78,7.22L16.06,3.5L15,4.56L17.11,6.67C16.17,7.03 15.5,7.93 15.5,9A2.5,2.5 0 0,0 18,11.5C18.36,11.5 18.69,11.42 19,11.29V18.5A1,1 0 0,1 18,19.5A1,1 0 0,1 17,18.5V14A2,2 0 0,0 15,12H14V5A2,2 0 0,0 12,3H6A2,2 0 0,0 4,5V21H14V13.5H15.5V18.5A2.5,2.5 0 0,0 18,21A2.5,2.5 0 0,0 20.5,18.5V9C20.5,8.31 20.22,7.68 19.77,7.23M18,10A1,1 0 0,1 17,9A1,1 0 0,1 18,8A1,1 0 0,1 19,9A1,1 0 0,1 18,10M8,18V13.5H6L10,6V11H12L8,18Z",
  hp: "M12,11A1,1 0 0,0 11,12A1,1 0 0,0 12,13A1,1 0 0,0 13,12A1,1 0 0,0 12,11M12.5,2C17,2 17.11,5.57 14.75,6.75C13.76,7.24 13.32,8.29 13.13,9.22C13.61,9.42 14.03,9.73 14.35,10.13C18.05,8.13 22.03,8.92 22.03,12.5C22.03,17 18.46,17.1 17.28,14.73C16.78,13.74 15.72,13.3 14.79,13.11C14.59,13.59 14.28,14 13.88,14.34C15.87,18.03 15.08,22 11.5,22C7,22 6.91,18.42 9.27,17.24C10.25,16.75 10.69,15.71 10.89,14.79C10.4,14.59 9.97,14.27 9.65,13.87C5.96,15.85 2,15.07 2,11.5C2,7 5.56,6.89 6.74,9.26C7.24,10.25 8.29,10.68 9.22,10.87C9.41,10.39 9.73,9.97 10.14,9.65C8.15,5.96 8.94,2 12.5,2Z",
  left: "M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z",
  right: "M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z",
};
const svgI = (p, s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor"><path d="${p}"/></svg>`;

/* Bildgeometrie (1365 x 768): Kreise (node), Objektpunkt im Bild (anchor) */
const IMG = { w: 1365, h: 768 };
// Kreisgröße in Bildpixeln (skaliert mit dem Bild)
const NODE_D = 88;
const SPOTS = {
  // m: Kreisposition bei schmaler Ansicht (Handy)
  pv: { node: [797, 150], m: [810, 95], anchor: [790, 262], lead: false },
  home: { node: [600, 467], m: [565, 380], anchor: [690, 478], lead: false },
  bat: { node: [992, 385], m: [1070, 300], anchor: [968, 500], lead: false },
  grid: { node: [398, 594], m: [545, 565], anchor: [566, 560], lead: false },
  // lead: false = keine gestrichelte Linie und kein Punkt am Objekt
  // optional, nur wenn eine Entität angegeben ist
  hp: { node: [804, 620], m: [810, 565], anchor: [876, 548], opt: "heatpump_power", lead: false },
  ev: { node: [1062, 620], m: [1095, 560], anchor: [1052, 489], opt: "wallbox_power", lead: false },
};
// Flüsse: Quelle, Ziel, Steuerpunkt der Kurve (Bildpixel), Farbe, Pillen-Beschriftung
const FLOWS = {
  // Jede Linie zeigt genau den Strom, der auf ihr fließt; das Haus ist Knotenpunkt (rein = Verbrauch + Einspeisung)
  // line/val: Wert für Linie bzw. Pille; now: false = Pille nur in „Heute“ (in „Jetzt“ steht der Wert im Kreis);
  // nowIf: Pille in „Jetzt“ nur, wenn dieser Fluss aktiv ist
  pvHome: { a: "pv", b: "home", c: [720, 330], col: K.pv, label: "PV ins Haus", line: "pvHouse", val: "pvHouse" },
  pvBat: { a: "pv", b: "bat", c: [1020, 140], col: K.pv, label: "Gespeichert", nowIf: "gridBat" },
  // Netz immer über das Haus: Bezug Netz → Haus (ganzer Bezug, auch fürs Speicherladen),
  // Einspeisung auf demselben Weg rückwärts Haus → Netz. Netzladung läuft Haus → Speicher auf dem Weg
  // der Speicherentladung; so kreuzt keine Linie eine andere.
  gridHome: { a: "grid", b: "home", c: [470, 600], col: "#EEF3F6", label: "Bezug", pill: false, line: "gridIn" },
  homeGrid: { a: "home", b: "grid", c: [470, 600], col: K.exp, label: "Einspeisung", now: false },
  gridBat: { a: "home", b: "bat", c: [790, 350], col: "#EEF3F6", label: "Netz → Speicher" },
  batHome: { a: "bat", b: "home", c: [790, 350], col: K.bat, label: "Aus Speicher", now: false },
  // pill: false = nur Flusslinie, Wert steht im Kreis
  // inc: Gerät hängt hinter der sonnen-Messung (Teil des Verbrauchs); mit <gerät>_included: false keine Linie vom Verbrauch
  homeHp: { a: "home", b: "hp", c: [680, 620], col: K.hp, label: "Wärmepumpe", pill: false, inc: "heatpump_included" },
  homeEv: { a: "home", b: "ev", c: [700, 860], m: [830, 470], col: K.ev, label: "Wallbox", pill: false, inc: "wallbox_included" },
};

const fN = (v, d = 1) =>
  v == null || isNaN(v) ? "–" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const p2 = (n) => String(n).padStart(2, "0");
const d0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addD = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fD = (d) => `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
const fDs = (d) => `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.`;
const kW = (w) => (w == null ? "–" : fN(Math.abs(w) / 1000, Math.abs(w) >= 10000 ? 1 : 2));
const kWh = (v) => (v == null ? "–" : fN(v, Math.abs(v) >= 100 ? 0 : 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const w1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - w1) / 86400000 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7);
};

/* Sonnenstand (vereinfachte NOAA-Formel), Ergebnis in Grad */
function sunPos(ms, lat, lon) {
  const r = Math.PI / 180;
  const d = ms / 86400000 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * r;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r;
  const e = (23.439 - 0.00000036 * d) * r;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const H = (gmst * 15 + lon) * r - ra;
  const la = lat * r;
  return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H)) / r;
}

/* Zeiträume der Auswertung */
function z3Range(mode, d) {
  const y = d.getFullYear(), m = d.getMonth();
  if (mode === "day") { const s = d0(d); return { s, e: addD(s, 1), period: "hour", n: 24 }; }
  if (mode === "week") { const s = addD(d0(d), -((d.getDay() + 6) % 7)); return { s, e: addD(s, 7), period: "day", n: 7 }; }
  if (mode === "month") { const s = new Date(y, m, 1), e = new Date(y, m + 1, 1); return { s, e, period: "day", n: Math.round((e - s) / 86400000) }; }
  return { s: new Date(y, 0, 1), e: new Date(y + 1, 0, 1), period: "month", n: 12 };
}
function z3Shift(mode, d, n) {
  if (mode === "day") return addD(d, n);
  if (mode === "week") return addD(d, 7 * n);
  if (mode === "month") return new Date(d.getFullYear(), d.getMonth() + n, 1);
  return new Date(d.getFullYear() + n, 0, 1);
}
function z3Label(mode, r, short) {
  const s = r.s;
  if (mode === "day") {
    const t = d0(new Date()).getTime();
    const pre = s.getTime() === t ? "Heute" : s.getTime() === addD(new Date(t), -1).getTime() ? "Gestern" : WD[s.getDay()];
    // schmal: Heute/Gestern ohne Datum, sonst Wochentag mit Tag.Monat
    if (short) return pre === "Heute" || pre === "Gestern" ? pre : `${pre}, ${fDs(s)}`;
    return `${pre}, ${fD(s)}`;
  }
  if (mode === "week") return short ? `KW ${isoWeek(s)}` : `KW ${isoWeek(s)} · ${fDs(s)}–${fD(addD(r.e, -1))}`;
  if (mode === "month") return short ? `${MON[s.getMonth()]} ${s.getFullYear()}` : `${MONL[s.getMonth()]} ${s.getFullYear()}`;
  return String(s.getFullYear());
}
function z3Slot(mode, r, ts) {
  const t = new Date(ts);
  if (mode === "day") return t.getHours();
  if (mode === "week") return Math.round((d0(t) - r.s) / 86400000);
  if (mode === "month") return t.getDate() - 1;
  return t.getMonth();
}

/* Energieaufteilung aus den sonnen-Werten (Leistung in W oder Energie in kWh) */
function split(v) {
  const pv = Math.max(0, v.pv || 0), cons = Math.max(0, v.cons || 0), ch = Math.max(0, v.ch || 0);
  const dis = Math.max(0, v.dis || 0), imp = Math.max(0, v.imp || 0), exp = Math.max(0, v.exp || 0);
  // Einspeisung ohne PV (z. B. nachts) stammt aus dem Speicher
  const pvGrid = Math.min(exp, pv);
  const batGrid = Math.min(Math.max(0, exp - pvGrid), dis);
  const pvHome = Math.max(0, Math.min(pv - ch - pvGrid, cons - (dis - batGrid)));
  const pvBat = Math.min(ch, Math.max(0, pv - pvHome));
  const gridBat = Math.max(0, ch - pvBat);
  const gridHome = Math.max(0, imp - gridBat);
  // batHome = Fluss auf der Linie Speicher → Haus (enthält den Teil, der über das Haus eingespeist wird)
  return { pvHome, pvBat, pvGrid, batGrid, batHome: dis, gridHome, gridBat, gridIn: gridHome + gridBat };
}

/* Quadratische Bézierkurve */
const qPt = (a, c, b, t) => [
  (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
  (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
];
// Parameter, an dem die Kurve einen Kreis (Mittelpunkt p, Radius r) verlässt
function qExit(a, c, b, p, r, fromStart) {
  let lo = fromStart ? 0 : 1, hi = 0.5;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    const q = qPt(a, c, b, m);
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < r) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
const rectHit = (a, b, pad = 4) =>
  a.x - a.w / 2 - pad < b.x + b.w / 2 && a.x + a.w / 2 + pad > b.x - b.w / 2 && a.y - a.h / 2 - pad < b.y + b.h / 2 && a.y + a.h / 2 + pad > b.y - b.h / 2;

/* ================================================================== */
/*  Grafik-Helfer (Diagramme)                                          */
/* ================================================================== */
function smooth(pts, yMin, yMax) {
  if (!pts.length) return "";
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], q = pts[i + 1], p3 = pts[i + 2] || q;
    const c1 = [p1[0] + (q[0] - p0[0]) / 6, clamp(p1[1] + (q[1] - p0[1]) / 6, yMin, yMax)];
    const c2 = [q[0] - (p3[0] - p1[0]) / 6, clamp(q[1] - (p3[1] - p1[1]) / 6, yMin, yMax)];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
  }
  return d;
}
function runs(arr) {
  const out = [];
  let cur = null;
  arr.forEach((v, i) => {
    if (v == null) { cur = null; return; }
    if (!cur) { cur = []; out.push(cur); }
    cur.push(i);
  });
  return out;
}
const niceMax = (v) => {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
};
function ring(frac, size, sw, col, track, inner = "") {
  const r = (size - sw) / 2, c = 2 * Math.PI * r, f = clamp(frac || 0, 0, 1);
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${sw}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})" class="arc"/>${inner}</svg>`;
}
function donut(parts, size, sw, inner) {
  const r = (size - sw) / 2, c = 2 * Math.PI * r;
  const tot = parts.reduce((a, p) => a + Math.max(0, p.v), 0);
  let off = 0, s = "";
  if (tot > 0)
    parts.forEach((p) => {
      const l = (Math.max(0, p.v) / tot) * c;
      if (l > 0.5) s += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.c}" stroke-width="${sw}" stroke-dasharray="${Math.max(0, l - 2).toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
      off += l;
    });
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--zl)" stroke-width="${sw}"/>${s}${inner}</svg>`;
}

/* ================================================================== */

class ZeoSonnen3DCard extends HTMLElement {
  setConfig(config) {
    const prefix = config.prefix || "zeo_sonnen";
    this._wsMode = !config.prefix;
    this._info = null;
    this._cfg = {
      title: "Mein Energiefluss",
      threshold: 30,
      bg_day: null,
      bg_night: null,
      ...config,
      entities: { ...Z3_DEFAULTS(prefix), ...(config.entities || {}) },
    };
    if (config.wallbox) this._cfg.entities.wallbox_power = config.wallbox;
    if (config.wallbox_energy) this._cfg.entities.wallbox_energy = config.wallbox_energy;
    if (config.heatpump) this._cfg.entities.heatpump_power = config.heatpump;
    if (config.heatpump_energy) this._cfg.entities.heatpump_energy = config.heatpump_energy;
    this._userEntities = { ...(config.entities || {}) };
    ["wallbox_power", "wallbox_energy", "heatpump_power", "heatpump_energy"].forEach((k) => { if (this._cfg.entities[k]) this._userEntities[k] = this._cfg.entities[k]; });
    this._mode = this._mode || "day";
    this._chartKind = this._chartKind || "power";
    this._heroMode = this._heroMode || "now";
    this._day = this._day || d0(new Date());
    // Höchstleistung der letzten Tage für das Punkt-Tempo (pro Browser gemerkt, verfällt nach 7 Tagen ohne neuen Höchstwert)
    try {
      const p = JSON.parse(localStorage.getItem("zeo3d_peak") || "null");
      if (p && Date.now() - p.t < 7 * 864e5) this._peak = p.v;
    } catch (e) { /* kein Speicher verfügbar */ }
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._wsMode && !this._info && !this._infoLoading) this._loadInfo();
    if (!this._built) this._build();
    this._theme();
    this._update();
  }
  _theme() {
    // theme: auto (folgt HA), light, dark
    const t = this._cfg.theme || "auto";
    const h = this._hass || {}, sel = h.selectedTheme;
    // ohne feste Auswahl im Profil folgt HA dem Gerät; darkMode ist beim ersten Laden oft noch nicht gesetzt
    const sys = !sel || typeof sel.dark !== "boolean";
    const dev = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = t === "dark" || (t !== "light" && (sys ? !!(h.themes && h.themes.darkMode) || dev : sel.dark));
    const z = this.shadowRoot && this.shadowRoot.querySelector(".z3");
    if (z && z.classList.contains("dark") !== dark) z.classList.toggle("dark", dark);
  }

  connectedCallback() {
    if (!this._timer) this._timer = setInterval(() => this._tick(), 30000);
  }
  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = null;
  }
  _tick() {
    if (!this._hass || !this._built) return;
    const now = Date.now();
    if (!this._todayAt || now - this._todayAt > 120000) this._loadToday();
    const today = d0(new Date()).getTime();
    if (this._lastToday && this._lastToday !== today && this._day.getTime() === this._lastToday) this._day = new Date(today);
    this._lastToday = today;
    if (this._mode === "day" && this._day.getTime() === today && now - (this._anaAt || 0) > 120000) this._loadAna();
    this._daylight();
  }

  async _loadInfo() {
    this._infoLoading = true;
    try {
      const msg = { type: "zeo_sonnen/info" };
      if (this._cfg.entry_id) msg.entry_id = this._cfg.entry_id;
      const info = await this._hass.callWS(msg);
      this._info = info;
      this._cfg.entities = { ...this._cfg.entities, ...info.entities, ...(this._userEntities || {}) };
      if (!info.entities.charge_energy) this._cfg.entities.charge_energy = this._sibling(/_(ladeenergie|battery_charge_energy)$/) || this._cfg.entities.charge_energy;
      if (!info.entities.discharge_energy) this._cfg.entities.discharge_energy = this._sibling(/_(entladeenergie|battery_discharge_energy)$/) || this._cfg.entities.discharge_energy;
      if (!this._cfg.model) this._cfg.model_label = info.model_label;
      if (!this._cfg.color) this._cfg.color = info.color;
      if (typeof this._cfg.backup !== "boolean") this._cfg.backup = info.backup === true;
      this._build();
      this._theme();
      this._update();
    } catch (err) {
      this._infoError = String((err && err.message) || err);
      this._update();
    } finally {
      this._infoLoading = false;
    }
  }
  // Entität desselben Geräts wie der Ladestand (für ältere Integrationsstände)
  _sibling(re) {
    const reg = (this._hass && this._hass.entities) || {};
    const soc = this._cfg.entities.soc;
    const dev = reg[soc] && reg[soc].device_id;
    if (!dev) return null;
    return Object.keys(reg).find((id) => reg[id].device_id === dev && re.test(id)) || null;
  }

  getCardSize() { return 16; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
  static getStubConfig() { return {}; }

  /* ---------- Daten ---------- */
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
  _w(key) {
    const v = this._num(key);
    if (v == null) return null;
    const u = (this._st(key).attributes || {}).unit_of_measurement;
    return u === "kW" ? v * 1000 : v;
  }
  _eScale(id) {
    const s = this._hass && this._hass.states[id];
    const u = s && s.attributes && s.attributes.unit_of_measurement;
    return u === "Wh" ? 0.001 : u === "MWh" ? 1000 : 1;
  }
  _avail() {
    const s = this._st("soc");
    return !!s && s.state !== "unavailable" && s.state !== "unknown";
  }
  _health() {
    if (!this._avail()) return { ok: false, text: "Keine Verbindung", color: K.warn };
    const prob = this._st("problem"), sys = this._st("system_status"), light = this._st("status_light");
    if ((prob && prob.state === "on") || (sys && /error/i.test(sys.state)) || (light && /red/.test(light.state)))
      return { ok: false, text: "Störung" + (sys ? ` (${sys.state})` : ""), color: K.err };
    if (sys && /off-?grid|island/i.test(sys.state)) return { ok: true, text: "Notstrombetrieb", color: K.warn };
    return { ok: true, text: "Alles in Ordnung", color: K.ok };
  }
  _flows() {
    const t = this._cfg.threshold;
    const v = {
      pv: this._w("pv_power"), cons: this._w("consumption_power"),
      ch: this._w("charge_power"), dis: this._w("discharge_power"),
      imp: this._w("grid_import_power"), exp: this._w("grid_export_power"),
      soc: this._num("soc"),
      ev: this._w("wallbox_power"), hp: this._w("heatpump_power"),
    };
    ["pv", "cons", "ch", "dis", "imp", "exp", "ev", "hp"].forEach((k) => { if (v[k] != null && v[k] < t) v[k] = 0; });
    return v;
  }
  // optionaler Kreis vorhanden (Entität angegeben und in HA bekannt)
  _has(k) {
    const sp = SPOTS[k];
    if (!sp.opt) return true;
    const id = this._cfg.entities[sp.opt];
    return !!(id && this._hass && this._hass.states[id]);
  }
  // Skala für das Punkt-Tempo in W: fest per max_power oder automatisch aus der Höchstleistung
  _scale() {
    if (this._cfg.max_power > 0) return Number(this._cfg.max_power);
    return clamp(this._peak || 0, 2000, 40000);
  }
  _notePeak(w) {
    if (!(w > (this._peak || 0))) return;
    this._peak = w;
    try { localStorage.setItem("zeo3d_peak", JSON.stringify({ v: w, t: Date.now() })); } catch (e) { /* egal */ }
  }
  _housing() { return HOUSING[this._cfg.color] || "weiß"; }
  _elev() {
    const c = (this._hass && this._hass.config) || {};
    if (c.latitude == null) {
      const h = new Date().getHours() + new Date().getMinutes() / 60;
      return 40 * Math.sin(((h - 7) / 11) * Math.PI);
    }
    return sunPos(Date.now(), c.latitude, c.longitude);
  }

  /* ---------- Gerüst ---------- */
  _build() {
    this._built = true;
    const root = this.shadowRoot;
    const kpis = `<div class="kpi" data-k="aut"></div><div class="kpi" data-k="eig"></div>`;
    root.innerHTML = `<style>${this._css()}</style>
    <div class="z3">
      <section class="hero" id="hero">
        <div class="bg" id="bg-day"></div><div class="bg" id="bg-night"></div>
        <div class="shade"></div>
        <svg class="links" id="links"></svg>
        <div class="ovl" id="ovl">
          ${Object.keys(SPOTS).map((k) => `<span class="dot" id="dt-${k}"></span>`).join("")}
          ${this._node("pv", "Erzeugung", ICON.pv, K.pv)}
          ${this._node("home", "Verbrauch", ICON.home, K.cons)}
          ${this._node("bat", "Speicher", ICON.bat, K.bat)}
          ${this._node("grid", "Netz", ICON.grid, K.grid)}
          ${this._node("hp", "Wärmepumpe", ICON.hp, K.hp)}
          ${this._node("ev", "Wallbox", ICON.ev, K.ev)}
          ${Object.keys(FLOWS).map((k) => `<div class="pill off" id="p-${k}" style="--c:${FLOWS[k].col}"><i></i><span></span></div>`).join("")}
        </div>
        <div class="htop">
          <div class="brand">
            ${this._cfg.menu_button ? `<button class="menubtn" id="menubtn" aria-label="Menü">☰</button>` : ""}
            <div><h1>${this._cfg.title}</h1><div class="subt" id="subt"></div></div>
          </div>
          <div class="kpis in">${kpis}</div>
          <div class="seg hseg" id="hseg"><button data-h="now">Jetzt</button><button data-h="today">Heute</button></div>
        </div>
        <div class="hfoot"><span class="chip" id="hchip"></span><span class="chip" id="hstamp"></span></div>
      </section>
      <div class="kpis out">${kpis}</div>
      <div id="banner"></div>
      <section class="grid">
        <article class="card c-bat">
          <header><h2>sonnenBatterie</h2><span class="tag" id="b-model"></span></header>
          <div class="batrow">
            <div class="bring" id="bring"></div>
            <div class="bside">
              <div class="bstate" id="bstate"></div>
              <div class="bpow" id="bpow"></div>
              <div class="btime" id="btime"></div>
            </div>
          </div>
          <div class="pair"><div><span>Gespeichert heute</span><b id="b-in">–</b></div><div><span>Genutzt heute</span><b id="b-out">–</b></div></div>
        </article>
        <article class="card">
          <header><h2>Verbrauch heute</h2></header>
          <div class="dwrap" id="d-cons"></div>
        </article>
        <article class="card">
          <header><h2>Erzeugung heute</h2></header>
          <div class="dwrap" id="d-pv"></div>
        </article>
        <article class="card wide ana">
          <header class="anahead">
            <div class="seg" id="tabs">${[["day", "Tag"], ["week", "Woche"], ["month", "Monat"], ["year", "Jahr"]].map(([k, l]) => `<button data-m="${k}">${l}</button>`).join("")}</div>
            <div class="dnav">
              <button id="prev" aria-label="zurück">${svgI(ICON.left)}</button><span id="rlbl"></span><button id="next" aria-label="weiter">${svgI(ICON.right)}</button>
              <button class="today" id="today">Heute</button>
            </div>
            <div class="seg small" id="kind"><button data-k="power">Leistung</button><button data-k="energy">Arbeit</button></div>
          </header>
          <div class="chart" id="chart"><div class="msg">Lade Daten …</div></div>
          <div class="chips" id="chips"></div>
        </article>
        <article class="card">
          <header><h2>Autarkie</h2></header>
          <div id="autm"></div>
        </article>
        <article class="card wide2">
          <header><h2>System &amp; Einstellungen</h2></header>
          <div class="sysgrid">
            <div class="facts" id="facts"></div>
            <div class="ctrls">
              <div class="ctl"><span><b>Betriebsart</b><small>Lade- und Entladeverhalten</small></span><select id="c-mode"></select></div>
              <div class="confirm" id="c-mode-ok" hidden><span id="c-mode-q"></span><span class="cbtns"><button class="no" id="c-mode-no">Abbrechen</button><button class="yes" id="c-mode-yes">Übernehmen</button></span></div>
              ${this._cfg.backup ? `<div class="ctl"><span><b>Notstrompuffer</b><small>Reserve für Stromausfall</small></span>
                <span class="rng"><input type="range" min="0" max="100" step="1" id="c-res"><em id="c-res-v"></em></span></div>
              <div class="confirm" id="c-res-ok" hidden><span id="c-res-q"></span><span class="cbtns"><button class="no" id="c-res-no">Abbrechen</button><button class="yes" id="c-res-yes">Übernehmen</button></span></div>` : ""}
            </div>
          </div>
        </article>
      </section>
    </div>`;
    const $ = (id) => root.getElementById(id);
    const mb = $("menubtn");
    if (mb) mb.addEventListener("click", () => this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true })));
    root.querySelectorAll("#hseg button").forEach((b) => b.addEventListener("click", () => { this._heroMode = b.dataset.h; this._update(); }));
    root.querySelectorAll("#tabs button").forEach((b) =>
      b.addEventListener("click", () => { this._mode = b.dataset.m; if (this._day > new Date()) this._day = d0(new Date()); this._loadAna(); })
    );
    root.querySelectorAll("#kind button").forEach((b) => b.addEventListener("click", () => { this._chartKind = b.dataset.k; this._draw(); this._seg(); }));
    $("prev").addEventListener("click", () => { this._day = z3Shift(this._mode, this._day, -1); this._loadAna(); });
    $("next").addEventListener("click", () => {
      const n = z3Shift(this._mode, z3Range(this._mode, this._day).s, 1);
      if (n <= new Date()) { this._day = n; this._loadAna(); }
    });
    $("today").addEventListener("click", () => { this._day = d0(new Date()); this._loadAna(); });
    const sel = $("c-mode");
    // Betriebsart erst nach Bestätigung an die Batterie senden
    const box = $("c-mode-ok");
    const closeBox = () => { this._pendingMode = null; box.hidden = true; this._update(); };
    sel.addEventListener("change", () => {
      const cur = (this._st("operating_mode") || {}).state;
      if (sel.value === cur) { closeBox(); return; }
      this._pendingMode = sel.value;
      $("c-mode-q").textContent = `Betriebsart auf „${Z3_MODE[sel.value] || sel.value}“ ändern?`;
      box.hidden = false;
    });
    $("c-mode-no").addEventListener("click", closeBox);
    $("c-mode-yes").addEventListener("click", async () => {
      const opt = this._pendingMode;
      const yes = $("c-mode-yes");
      yes.disabled = true;
      try {
        await this._hass.callService("select", "select_option", { entity_id: this._cfg.entities.operating_mode, option: opt });
      } finally {
        yes.disabled = false;
        closeBox();
      }
    });
    const res = $("c-res");
    if (res) {
      res.addEventListener("input", () => ($("c-res-v").textContent = `${res.value} %`));
      // Notstrompuffer ebenfalls erst nach Bestätigung senden
      const rbox = $("c-res-ok");
      const closeR = () => { this._pendingRes = null; rbox.hidden = true; this._update(); };
      res.addEventListener("change", () => {
        const cur = this._num("backup_reserve");
        if (Number(res.value) === cur) { closeR(); return; }
        this._pendingRes = Number(res.value);
        $("c-res-q").textContent = `Notstrompuffer auf ${res.value} % setzen?`;
        rbox.hidden = false;
      });
      $("c-res-no").addEventListener("click", closeR);
      $("c-res-yes").addEventListener("click", async () => {
        const v = this._pendingRes;
        const yes = $("c-res-yes");
        yes.disabled = true;
        try {
          await this._hass.callService("number", "set_value", { entity_id: this._cfg.entities.backup_reserve, value: v });
        } finally {
          yes.disabled = false;
          closeR();
        }
      });
    }
    if (this._ro) this._ro.disconnect();
    this._ro = new ResizeObserver(() => { this._layout(); this._draw(); });
    this._ro.observe($("chart"));
    this._ro.observe($("hero"));
    this._seg();
    this._loadBg();
    this._daylight(true);
    if (this._hass) { this._loadToday(); this._loadAna(); }
  }

  _node(id, label, icon, col) {
    return `<div class="node" id="n-${id}" style="--c:${col}">
      <svg class="nring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47"/><circle class="na" cx="50" cy="50" r="47" pathLength="100"/></svg>
      <i>${svgI(icon, 22)}</i><b id="n-${id}-v">–</b><span id="n-${id}-l">${label}</span></div>`;
  }

  async _loadBg() {
    const r = this.shadowRoot;
    const set = (id, url) => { const el = r.getElementById(id); if (el && url) el.style.backgroundImage = `url("${url}")`; };
    try {
      if (!window.__zeoBg) {
        window.__zeoBg = Promise.all([
          this._cfg.bg_day ? { default: this._cfg.bg_day } : import(`${Z3_BASE}/zeo-sonnen-bg-day.js${Z3_Q}`),
          this._cfg.bg_night ? { default: this._cfg.bg_night } : import(`${Z3_BASE}/zeo-sonnen-bg-night.js${Z3_Q}`),
        ]);
      }
      const [d, n] = await window.__zeoBg;
      set("bg-day", d.default);
      set("bg-night", n.default);
    } catch (err) {
      r.getElementById("hero").classList.add("nobg");
    }
  }
  _daylight(force) {
    const r = this.shadowRoot;
    if (!r || !r.getElementById("bg-night")) return;
    const el = this._elev();
    // ab 4° unter dem Horizont Nacht, ab 6° darüber Tag, dazwischen Überblendung
    const night = clamp((6 - el) / 10, 0, 1);
    const key = Math.round(night * 20);
    if (!force && key === this._nightKey) return;
    this._nightKey = key;
    r.getElementById("bg-night").style.opacity = night.toFixed(2);
    r.getElementById("hero").classList.toggle("is-night", night > 0.5);
  }

  /* ---------- Anordnung im Bild ---------- */
  _layout() {
    const r = this.shadowRoot;
    const hero = r && r.getElementById("hero");
    if (!hero) return;
    const w = hero.clientWidth, h = hero.clientHeight;
    if (!w || !h) return;
    // gleiche Rechnung wie background-size: cover mit background-position X%
    const narrow = w < 720;
    this._narrow = narrow;
    const posX = narrow ? 0.72 : 0.5;
    const s = Math.max(w / IMG.w, h / IMG.h);
    // Kreise und Pillen wachsen mit dem Bild
    const D = Math.round(clamp(NODE_D * s, narrow ? 66 : 65, 165));
    hero.style.setProperty("--nd", `${D}px`);
    // Pillen-Schrift = Beschriftung im Kreis (Kreisschrift D/6.4, mind. 10.5 px, davon 0.8)
    hero.style.setProperty("--pf", `${(Math.max(D / 6.4, 10.5) * 0.8).toFixed(1)}px`);
    const ox = (w - IMG.w * s) * posX, oy = (h - IMG.h * s) * 0.6;
    hero.style.setProperty("--bgx", `${posX * 100}%`);
    const P = (p) => [ox + p[0] * s, oy + p[1] * s];
    const top = narrow ? 64 : 12, bottom = narrow ? 52 : 50;
    const nodes = {};
    Object.entries(SPOTS).forEach(([k, sp]) => {
      const el = r.getElementById(`n-${k}`);
      const dot = r.getElementById(`dt-${k}`);
      const on = this._has(k);
      el.classList.toggle("hide", !on);
      dot.classList.toggle("hide", !on || sp.lead === false);
      if (!on) return;
      const R = el.offsetWidth / 2;
      let [x, y] = P(narrow && sp.m ? sp.m : sp.node);
      x = clamp(x, R + 8, w - R - 8);
      y = clamp(y, R + top, h - R - bottom);
      el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
      const [ax, ay] = P(sp.anchor);
      dot.style.transform = `translate(${ax.toFixed(1)}px,${ay.toFixed(1)}px) translate(-50%,-50%)`;
      nodes[k] = { x, y, R, ax, ay, el, lead: sp.lead !== false };
    });
    // Verbindungslinien: Kreis -> Objekt (gestrichelt) und Energieflüsse zwischen den Kreisen
    let svg = "";
    Object.values(nodes).forEach((n) => {
      const dx = n.ax - n.x, dy = n.ay - n.y, L = Math.hypot(dx, dy);
      if (n.lead && L > n.R + 6) svg += `<line class="lead" x1="${(n.x + (dx / L) * (n.R + 3)).toFixed(1)}" y1="${(n.y + (dy / L) * (n.R + 3)).toFixed(1)}" x2="${n.ax.toFixed(1)}" y2="${n.ay.toFixed(1)}"/>`;
    });
    const fl = this._flowState || {};
    const obstacles = Object.values(nodes).map((n) => ({ x: n.x, y: n.y, w: n.R * 2 + 6, h: n.R * 2 + 6 }));
    // Titel, Kennzahlen, Umschalter und Statuszeile freihalten
    const hb = hero.getBoundingClientRect();
    r.querySelectorAll(".htop .brand, .htop .kpis.in, #hseg, .hfoot .chip").forEach((el) => {
      const q = el.getBoundingClientRect();
      if (q.width && q.height) obstacles.push({ x: q.x - hb.x + q.width / 2, y: q.y - hb.y + q.height / 2, w: q.width, h: q.height });
    });
    const placed = [];
    // Tempo: live relativ zur Höchstleistung der Anlage, „Heute“ relativ zum größten Tagesfluss
    const liveScale = this._scale();
    const todayScale = Math.max(1, ...Object.values(fl).map((x) => (x.today ? x.v || 0 : 0)));
    Object.entries(FLOWS).forEach(([k, f]) => {
      const A = nodes[f.a], Bn = nodes[f.b];
      const pill = r.getElementById(`p-${k}`);
      if (!A || !Bn || (f.inc && this._cfg[f.inc] === false)) { pill.classList.add("off"); return; }
      const a = [A.x, A.y], b = [Bn.x, Bn.y];
      const c = P(narrow && f.m ? f.m : f.c);
      const t0 = qExit(a, c, b, a, A.R + 6, true);
      const t1 = qExit(a, c, b, b, Bn.R + 6, false);
      const st = fl[k] || { v: 0 };
      if (!(st.v > 0) || t1 <= t0) { pill.classList.add("off"); return; }
      // Kurvenstück zwischen den Kreisrändern als eigene quadratische Kurve
      const p0 = qPt(a, c, b, t0), p1 = qPt(a, c, b, t1);
      const cm = qPt(a, c, b, (t0 + t1) / 2);
      const cc = [2 * cm[0] - (p0[0] + p1[0]) / 2, 2 * cm[1] - (p0[1] + p1[1]) / 2];
      const d = `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} Q${cc[0].toFixed(1)} ${cc[1].toFixed(1)} ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`;
      const dur = clamp(3.2 - (st.v / (st.today ? todayScale : liveScale)) * 2.4, 0.7, 3.2).toFixed(2);
      svg += `<path class="fshade" d="${d}"/><path class="fglow" d="${d}" stroke="${f.col}"/><path class="fline" d="${d}" stroke="${f.col}"/>
        <path class="fdots" d="${d}" stroke="${f.col}" style="animation-duration:${dur}s"/>`;
      const hideNow = !st.today && (f.now === false || (f.nowIf && !((fl[f.nowIf] || {}).v > 0)));
      if (f.pill === false || hideNow || !(st.pv > 0)) { pill.classList.add("off"); return; }
      // Pille auf der Kurve platzieren, ohne Kreise und andere Pillen zu überdecken
      pill.classList.remove("off");
      const pw = pill.offsetWidth, ph = pill.offsetHeight;
      let best = null;
      for (const tt of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74]) {
        const q = qPt(p0, cc, p1, tt);
        const box = { x: clamp(q[0], pw / 2 + 6, w - pw / 2 - 6), y: clamp(q[1], ph / 2 + 6, h - ph / 2 - 6), w: pw, h: ph };
        const hit = obstacles.some((o) => rectHit(box, o, 2)) || placed.some((o) => rectHit(box, o, 4));
        if (!hit) { best = box; break; }
        if (!best) best = box;
      }
      // notfalls nach oben oder unten ausweichen, bis frei
      const blocked = (bx) => obstacles.some((o) => rectHit(bx, o, 2)) || placed.some((o) => rectHit(bx, o, 4)) || bx.y - bx.h / 2 < 4 || bx.y + bx.h / 2 > h - 4;
      if (blocked(best)) {
        for (let i = 1; i <= 10; i++) {
          const up = { ...best, y: best.y - i * (ph + 4) }, dn = { ...best, y: best.y + i * (ph + 4) };
          if (!blocked(up)) { best = up; break; }
          if (!blocked(dn)) { best = dn; break; }
        }
      }
      placed.push(best);
      pill.style.transform = `translate(${best.x.toFixed(1)}px,${best.y.toFixed(1)}px) translate(-50%,-50%)`;
    });
    const links = r.getElementById("links");
    links.setAttribute("viewBox", `0 0 ${w} ${h}`);
    links.innerHTML = `<defs><filter id="fg" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter></defs>${svg}`;
  }

  /* ---------- Live ---------- */
  _update() {
    if (!this._hass || !this._built) return;
    const r = this.shadowRoot;
    const $ = (id) => r.getElementById(id);
    const set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
    const html = (id, t) => { const e = $(id); if (e) e.innerHTML = t; };
    const h = this._health();
    const f = this._flows();
    this._notePeak(Math.max(f.pv || 0, f.cons || 0, f.ch || 0, f.dis || 0, f.imp || 0, f.exp || 0));
    const model = this._cfg.model || this._cfg.model_label || "sonnenBatterie";
    const cap = this._num("capacity");
    set("subt", `${model}${cap != null ? ` · ${fN(cap, 0)} kWh` : ""}`);
    html("hchip", `<i style="background:${h.color}"></i>${h.text}`);
    const stamps = ["soc", "pv_power", "consumption_power", "charge_power", "discharge_power", "grid_import_power"]
      .map((k) => this._st(k)).filter(Boolean).map((s) => Date.parse(s.last_updated)).filter((v) => !isNaN(v));
    if (stamps.length) { const t = new Date(Math.max(...stamps)); set("hstamp", `Stand ${p2(t.getHours())}:${p2(t.getMinutes())}:${p2(t.getSeconds())}`); }

    const banner = $("banner");
    if (this._infoError) banner.innerHTML = `<div class="banner">Integration zeo_sonnen nicht erreichbar: ${this._infoError}</div>`;
    else if (this._info && !this._avail()) {
      const sf = this._st("soc");
      const since = sf ? new Date(sf.last_changed) : null;
      banner.innerHTML = `<div class="banner">Keine Verbindung zur sonnenBatterie${since ? ` seit ${fD(since)} ${p2(since.getHours())}:${p2(since.getMinutes())} Uhr` : ""}. Angezeigt werden die zuletzt bekannten Daten.</div>`;
    } else banner.innerHTML = "";

    // Jetzt (kW) oder Heute (kWh)
    const today = this._today;
    const useToday = this._heroMode === "today" && today;
    const sp = useToday ? split(today) : split(f);
    const fmt = (v) => (useToday ? `${kWh(v)} kWh` : `${kW(v)} kW`);
    const node = (k, v, label, on) => {
      set(`n-${k}-v`, v);
      set(`n-${k}-l`, label);
      const el = $(`n-${k}`);
      if (el) { el.classList.toggle("on", !!on); el.classList.toggle("idle", !on && k !== "home" && k !== "bat"); }
    };
    if (useToday) {
      node("pv", `${kWh(today.pv)} kWh`, "Erzeugung", today.pv > 0);
      node("home", `${kWh(today.cons)} kWh`, "Verbrauch", today.cons > 0);
      node("bat", f.soc == null ? "–" : `${fN(f.soc, 0)} %`, "Speicher", true);
      node("grid", `${kWh(today.imp)} kWh`, "Netzbezug", today.imp > 0);
      node("ev", today.ev == null ? "–" : `${kWh(today.ev)} kWh`, "Wallbox", today.ev > 0);
      node("hp", today.hp == null ? "–" : `${kWh(today.hp)} kWh`, "Wärmepumpe", today.hp > 0);
    } else {
      node("pv", `${kW(f.pv)} kW`, "Erzeugung", f.pv > 0);
      node("home", `${kW(f.cons)} kW`, "Verbrauch", f.cons > 0);
      node("bat", f.soc == null ? "–" : `${fN(f.soc, 0)} %`, f.ch > 0 ? (this._narrow ? "lädt" : `lädt ${kW(f.ch)} kW`) : f.dis > 0 ? (this._narrow ? "entlädt" : `entlädt ${kW(f.dis)} kW`) : "Speicher", f.ch > 0 || f.dis > 0);
      node("grid", `${kW(f.imp > 0 ? f.imp : f.exp)} kW`, f.imp > 0 ? "Netzbezug" : f.exp > 0 ? "Einspeisung" : "Netz", f.imp > 0 || f.exp > 0);
      node("ev", `${kW(f.ev)} kW`, f.ev > 0 ? "Wallbox lädt" : "Wallbox", f.ev > 0);
      node("hp", `${kW(f.hp)} kW`, "Wärmepumpe", f.hp > 0);
    }
    // Punkte am Objekt pulsieren nur, wenn dort gerade Leistung fließt (immer Live-Wert)
    const act = { pv: f.pv > 0, home: f.cons > 0, grid: f.imp > 0 || f.exp > 0, bat: f.ch > 0 || f.dis > 0, ev: f.ev > 0, hp: f.hp > 0 };
    Object.keys(SPOTS).forEach((k) => { const d = $(`dt-${k}`); if (d) d.classList.toggle("act", !!act[k]); });
    // Einspeisung läuft vom Haus ins Netz; PV-Linie ins Haus trägt alles, was nicht in den Speicher geht
    sp.homeGrid = sp.pvGrid + sp.batGrid;
    sp.pvHouse = Math.max(0, (useToday ? today.pv : f.pv) - sp.pvBat);
    sp.homeEv = useToday ? today.ev || 0 : f.ev || 0;
    sp.homeHp = useToday ? today.hp || 0 : f.hp || 0;
    // Plausibilität: Abgänge vom Haus können nicht größer sein als der gemessene Verbrauch
    // (verschiedene Messquellen, z. B. Wallbox-Cloud mit Verzögerung). Linien anteilig begrenzen,
    // die Kreise zeigen weiter die echten Messwerte.
    {
      const base = Math.max(0, useToday ? today.cons || 0 : f.cons || 0);
      const sub = (this._cfg.wallbox_included === false ? 0 : sp.homeEv) + (this._cfg.heatpump_included === false ? 0 : sp.homeHp);
      if (sub > base && sub > 0) { const k = base / sub; sp.homeEv *= k; sp.homeHp *= k; }
    }
    const nb = $("n-bat");
    if (nb) nb.style.setProperty("--p", f.soc == null ? 0 : clamp(f.soc, 0, 100));
    const flowState = {};
    Object.entries(FLOWS).forEach(([k, fdef]) => {
      const v = sp[fdef.line || k] || 0;
      const pv = sp[fdef.val || k] || 0;
      flowState[k] = { v, pv, today: !!useToday };
      const el = $(`p-${k}`);
      if (el) el.querySelector("span").innerHTML = `${fdef.label} <b>${fmt(pv)}</b>`;
    });
    const sig = JSON.stringify(Object.entries(flowState).map(([k, s]) => [k, s.v > 0, Math.round(s.v / (useToday ? 1 : 500))]))
      + r.querySelector(".ovl").textContent.length + Object.keys(SPOTS).map((k) => (this._has(k) ? 1 : 0)).join("");
    this._flowState = flowState;
    r.querySelectorAll("#hseg button").forEach((b) => b.classList.toggle("act", b.dataset.h === this._heroMode));
    if (sig !== this._layoutSig) { this._layoutSig = sig; this._layout(); }

    // Speicher-Karte
    const soc = f.soc, fc = this._num("full_capacity");
    set("b-model", model);
    html("bring", ring((soc || 0) / 100, 150, 12, K.bat, "var(--zl)",
      `<text x="75" y="76" text-anchor="middle" class="rbig">${soc == null ? "–" : fN(soc, 0)}<tspan class="rpct"> %</tspan></text>
       <text x="75" y="98" text-anchor="middle" class="rsub">${fc != null && soc != null ? `${fN((soc / 100) * fc, 1)} kWh` : "Ladestand"}</text>`));
    set("bstate", f.ch > 0 ? "Lädt" : f.dis > 0 ? "Entlädt" : "Bereit");
    $("bstate").style.color = f.ch > 0 ? K.bat2 : f.dis > 0 ? K.cons2 : "var(--zs)";
    set("bpow", f.ch > 0 ? `${kW(f.ch)} kW` : f.dis > 0 ? `${kW(f.dis)} kW` : "0,00 kW");
    let bt = "";
    if (fc != null && soc != null) {
      // Notstrompuffer bleibt für den Stromausfall reserviert und zählt nicht zur Laufzeit
      const rsv = this._cfg.backup ? Math.max(0, this._num("backup_reserve") || 0) : 0;
      const hrs = f.ch > 0 ? (((100 - soc) / 100) * fc * 1000) / f.ch : f.dis > 0 ? ((Math.max(0, soc - rsv) / 100) * fc * 1000) / f.dis : null;
      if (f.dis > 0 && rsv > 0 && soc <= rsv) bt = "Notstromreserve erreicht";
      else if (hrs != null && isFinite(hrs) && hrs < 100) {
        const tm = Math.round(hrs * 60), hh = Math.floor(tm / 60), mm = tm % 60;
        bt = `${f.ch > 0 ? "voll in" : "reicht ca."} ${hh ? `${hh} h` : ""}${hh && mm ? " " : ""}${mm || !hh ? `${mm} min` : ""}${f.dis > 0 && rsv > 0 ? ` (bis ${fN(rsv, 0)} % Reserve)` : ""}`;
      }
    }
    set("btime", bt);

    // System
    const modeS = this._st("operating_mode");
    const mode = modeS && modeS.state;
    const sys = this._st("system_status");
    const soh = this._num("soh");
    const fact = (l, v) => `<div><span>${l}</span><b>${v}</b></div>`;
    html("facts",
      fact("Modell", model) +
      fact("Kapazität", cap == null ? "–" : `${fN(cap, 1)} kWh`) +
      fact("Ladezyklen", this._num("cycles") == null ? "–" : fN(this._num("cycles"), 0)) +
      (soh == null ? "" : fact("Gesundheit", `${fN(soh, 0)} %`)) +
      // Betriebsart und Notstrompuffer stehen daneben als Einstellung, hier nicht doppelt
      fact("Systemstatus", sys && sys.state !== "unavailable" && sys.state !== "unknown" ? Z3_SYS[sys.state.replace(/[\s_-]/g, "").toLowerCase()] || sys.state : "–")
    );
    const avail = this._avail();
    const sel = $("c-mode");
    if (sel && r.activeElement !== sel && !this._pendingMode) {
      const opts = (modeS && modeS.attributes.options) || [];
      const k = opts.join("|");
      if (sel.dataset.k !== k) { sel.innerHTML = opts.map((o) => `<option value="${o}">${Z3_MODE[o] || o}</option>`).join(""); sel.dataset.k = k; }
      if (mode && opts.includes(mode)) sel.value = mode;
      sel.disabled = !avail || !opts.includes(mode);
    }
    const res = $("c-res");
    const rv = this._num("backup_reserve");
    if (res && r.activeElement !== res && this._pendingRes == null) {
      res.value = rv == null ? 0 : rv;
      res.disabled = !avail || rv == null;
      set("c-res-v", rv == null ? "–" : `${fN(rv, 0)} %`);
    }
  }

  _seg() {
    const r = this.shadowRoot;
    r.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("act", b.dataset.m === this._mode));
    r.querySelectorAll("#kind button").forEach((b) => b.classList.toggle("act", b.dataset.k === this._chartKind));
    const kind = r.getElementById("kind");
    if (kind) kind.style.visibility = this._mode === "day" ? "visible" : "hidden";
  }

  /* ---------- Heute ---------- */
  _eIds() {
    const e = this._cfg.entities;
    return { pv: e.pv_energy, cons: e.consumption_energy, imp: e.grid_import_energy, exp: e.grid_export_energy, ch: e.charge_energy, dis: e.discharge_energy, ev: e.wallbox_energy, hp: e.heatpump_energy };
  }
  async _stats(s, e, period) {
    const ids = this._eIds();
    const list = Object.values(ids).filter((id) => id && this._hass.states[id]);
    const st = await this._hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: s.toISOString(),
      end_time: e.toISOString(),
      statistic_ids: list,
      period,
      types: ["change"],
    });
    // Langzeitstatistik endet mit der letzten fertigen Stunde: Rest bis jetzt ergänzen
    if (e.getTime() > Date.now() - 3600000) {
      try {
        const tail = await this._tail(list);
        list.forEach((id) => {
          const add = (tail[id] || []).filter((r) => r.start >= s.getTime() && r.start < e.getTime());
          if (add.length) st[id] = [...(st[id] || []), ...add];
        });
      } catch (err) { /* ohne Ergänzung bleibt die Stundenstatistik */ }
    }
    return { st, ids };
  }
  async _tail(list) {
    // je Aufruf höchstens alle 60 s neu holen
    if (this._tailC && Date.now() - this._tailC.at < 60000 && this._tailC.key === list.join()) return this._tailC.v;
    const tms = (v) => (typeof v === "number" ? v : Date.parse(v));
    const now = Date.now();
    const hr = await this._hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: new Date(now - 4 * 3600000).toISOString(),
      statistic_ids: list,
      period: "hour",
      types: ["state"],
    });
    const base = {}, last = {};
    list.forEach((id) => {
      const rows = hr[id] || [];
      const r = rows[rows.length - 1];
      base[id] = r ? tms(r.end) : Math.floor(now / 3600000) * 3600000;
      last[id] = r && r.state != null ? r.state : null;
    });
    const from = Math.min(...Object.values(base));
    const sh = from < now ? await this._hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: new Date(from).toISOString(),
      statistic_ids: list,
      period: "5minute",
      types: ["change", "state"],
    }) : {};
    const v = {};
    list.forEach((id) => {
      const out = [];
      let end = base[id], st = last[id];
      (sh[id] || []).forEach((r) => {
        const a = tms(r.start);
        if (a < base[id]) return;
        out.push({ start: a, change: r.change || 0 });
        end = Math.max(end, tms(r.end));
        if (r.state != null) st = r.state;
      });
      // laufende 5 Minuten: aktueller Zählerstand minus letzter Statistikstand
      const cur = parseFloat((this._hass.states[id] || {}).state);
      if (st != null && isFinite(cur) && cur >= st) out.push({ start: end, change: cur - st });
      v[id] = out;
    });
    this._tailC = { at: Date.now(), key: list.join(), v };
    return v;
  }
  async _loadToday() {
    this._todayAt = Date.now();
    // Höchstleistung der letzten 7 Tage aus der Langzeitstatistik (einmal je Seitenaufruf)
    const pe = this._cfg.entities;
    const pids = [pe.pv_power, pe.consumption_power, pe.charge_power, pe.discharge_power].filter((id) => id && this._hass.states[id]);
    if (!this._peakLoaded && !(this._cfg.max_power > 0) && pids.length) {
      this._peakLoaded = true;
      try {
        const ids = pids;
        const st = await this._hass.callWS({
          type: "recorder/statistics_during_period",
          start_time: addD(d0(new Date()), -7).toISOString(),
          statistic_ids: ids,
          period: "day",
          types: ["max"],
        });
        ids.forEach((id) => {
          const u = (this._hass.states[id].attributes || {}).unit_of_measurement;
          const f = u === "kW" ? 1000 : 1;
          (st[id] || []).forEach((r) => { if (r.max != null) this._notePeak(r.max * f); });
        });
      } catch (err) { /* ohne Statistik bleibt die Live-Höchstleistung */ }
    }
    try {
      const s = d0(new Date());
      const { st, ids } = await this._stats(s, addD(s, 1), "hour");
      const sum = (id) => (id && st[id] ? st[id].reduce((a, r) => a + (r.change || 0), 0) * this._eScale(id) : 0);
      this._today = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, sum(id)]));
      // Wallbox/Wärmepumpe nur mit eigener Energie-Entität
      ["ev", "hp"].forEach((k) => { if (!ids[k] || !this._hass.states[ids[k]]) this._today[k] = null; });
    } catch (err) {
      this._today = null;
    }
    try {
      const n = new Date();
      const s = new Date(n.getFullYear(), n.getMonth() - 2, 1);
      const { st, ids } = await this._stats(s, new Date(n.getFullYear(), n.getMonth() + 1, 1), "month");
      const months = [0, 1, 2].map((i) => new Date(n.getFullYear(), n.getMonth() - 2 + i, 1));
      const get = (id, m) => (id && st[id] ? st[id].filter((r) => new Date(typeof r.start === "number" ? r.start : Date.parse(r.start)).getMonth() === m.getMonth()).reduce((a, r) => a + (r.change || 0), 0) * this._eScale(id) : 0);
      this._months = months.map((m) => ({ m, cons: get(ids.cons, m), imp: get(ids.imp, m) }));
    } catch (err) {
      this._months = null;
    }
    this._drawToday();
    this._update();
  }
  _drawToday() {
    const r = this.shadowRoot;
    const t = this._today;
    const set = (id, v) => { const el = r.getElementById(id); if (el) el.textContent = v; };
    const kpi = (k, frac, label, col) => {
      r.querySelectorAll(`.kpi[data-k="${k}"]`).forEach((el) => {
        el.innerHTML = ring(frac, 74, 6, col, "rgba(255,255,255,.22)", `<text x="37" y="42" text-anchor="middle" class="kv">${frac == null ? "–" : Math.round(frac * 100)}<tspan class="kp">%</tspan></text>`) + `<span>${label}</span>`;
      });
    };
    const aut = t && t.cons > 0 ? clamp((t.cons - t.imp) / t.cons, 0, 1) : null;
    const eig = t && t.pv > 0 ? clamp((t.pv - t.exp) / t.pv, 0, 1) : null;
    kpi("aut", aut, "Autarkie heute", K.pv2);
    kpi("eig", eig, "Eigenverbrauch heute", K.bat);
    if (!t) return;
    set("b-in", `${kWh(t.ch)} kWh`);
    set("b-out", `${kWh(t.dis)} kWh`);
    const sp = split(t);
    const leg = (parts, tot) => `<div class="dleg">${parts.map((p) => `<div><i style="background:${p.c}"></i><span>${p.l}</span><b>${tot > 0 ? Math.round((p.v / tot) * 100) : 0} %</b><em>${kWh(p.v)} kWh</em></div>`).join("")}</div>`;
    const dc = [{ l: "Direktverbrauch", v: sp.pvHome, c: K.pv }, { l: "Aus Speicher", v: sp.batHome - sp.batGrid, c: K.bat }, { l: "Netzbezug", v: sp.gridHome, c: K.grid }];
    const dp = [{ l: "Direktverbrauch", v: sp.pvHome, c: K.pv }, { l: "Gespeichert", v: sp.pvBat, c: K.bat }, { l: "Eingespeist", v: sp.pvGrid, c: K.exp }];
    const tot = (a) => a.reduce((x, p) => x + p.v, 0);
    // Rest, den die Aufteilung nicht erklärt (Messlücken), sichtbar machen statt verschweigen
    const rest = (a, total) => { const d = total - tot(a); if (d > Math.max(0.05, total * 0.03)) a.push({ l: "Nicht zugeordnet", v: d, c: "#C9D3D8" }); };
    rest(dc, t.cons);
    rest(dp, t.pv);
    const mid = (v) => `<text x="70" y="70" text-anchor="middle" class="dv">${kWh(v)}</text><text x="70" y="88" text-anchor="middle" class="du">kWh</text>`;
    r.getElementById("d-cons").innerHTML = donut(dc, 140, 16, mid(Math.max(t.cons, tot(dc)))) + leg(dc, tot(dc));
    r.getElementById("d-pv").innerHTML = donut(dp, 140, 16, mid(Math.max(t.pv, tot(dp)))) + leg(dp, tot(dp));
    const am = r.getElementById("autm");
    if (am && this._months) {
      const vals = this._months.map((x) => (x.cons > 0 ? clamp((x.cons - x.imp) / x.cons, 0, 1) : null));
      const cur = vals[2];
      // Monate ohne Daten (z. B. vor der Inbetriebnahme) nicht als leere Kästen zeigen
      const shown = this._months.map((x, i) => i).filter((i) => i === 2 || vals[i] != null);
      am.innerHTML = `<div class="autnow"><span>Diesen Monat</span><b>${cur == null ? "–" : Math.round(cur * 100)} %</b></div>
        <div class="abars">${shown.map((i) => [this._months[i], i]).map(([x, i]) => `<div class="ab ${i === 2 ? "cur" : ""}" style="grid-column:${i + 1}"><div class="abv"><div style="height:${vals[i] == null ? 0 : Math.max(4, vals[i] * 100)}%"><em>${vals[i] == null ? "–" : Math.round(vals[i] * 100) + " %"}</em></div></div><span>${MON[x.m.getMonth()]} ${String(x.m.getFullYear()).slice(2)}</span></div>`).join("")}</div>`;
    }
  }

  /* ---------- Auswertung ---------- */
  async _loadAna() {
    const req = (this._anaReq = (this._anaReq || 0) + 1);
    this._anaAt = Date.now();
    const r = this.shadowRoot;
    const mode = this._mode;
    const rg = z3Range(mode, this._day);
    this._seg();
    r.getElementById("rlbl").textContent = z3Label(mode, rg, this.clientWidth > 0 && this.clientWidth <= 720);
    r.getElementById("next").disabled = z3Shift(mode, rg.s, 1) > new Date();
    r.getElementById("today").disabled = rg.s.getTime() === z3Range(mode, new Date()).s.getTime();
    const e = this._cfg.entities;
    const data = { mode, rg };
    if (mode === "day") {
      try {
        const ids = [e.pv_power, e.consumption_power, e.charge_power, e.discharge_power, e.soc];
        const hist = await this._hass.callWS({
          type: "history/history_during_period",
          start_time: rg.s.toISOString(),
          end_time: rg.e.toISOString(),
          entity_ids: ids,
          minimal_response: true,
          no_attributes: true,
          significant_changes_only: false,
        });
        const N = Math.round((rg.e - rg.s) / 300000);
        const now = Date.now();
        const sample = (id, scale) => {
          const rows = (hist[id] || []).map((x) => [((x.lu ?? x.lc) || 0) * 1000, parseFloat(x.s)]);
          const out = new Array(N).fill(null);
          let j = 0, cur = null;
          for (let i = 0; i < N; i++) {
            const t = rg.s.getTime() + i * 300000 + 150000;
            if (t > now) break;
            while (j < rows.length && rows[j][0] <= t) { cur = rows[j][1]; j++; }
            out[i] = cur == null || isNaN(cur) ? null : cur * scale;
          }
          return out;
        };
        const ws = (key) => { const s = this._st(key); const u = s && s.attributes.unit_of_measurement; return u === "kW" ? 1 : 0.001; };
        data.N = N;
        data.pv = sample(e.pv_power, ws("pv_power"));
        data.cons = sample(e.consumption_power, ws("consumption_power"));
        const ch = sample(e.charge_power, ws("charge_power"));
        const dis = sample(e.discharge_power, ws("discharge_power"));
        data.batt = ch.map((c, i) => (c == null && dis[i] == null ? null : (c || 0) - (dis[i] || 0)));
        data.soc = sample(e.soc, 1);
        // Tagesverlauf (kW) fließt in die Höchstleistung ein
        const all = [...data.pv, ...data.cons, ...data.batt.map((v) => (v == null ? null : Math.abs(v)))].filter((v) => v != null);
        if (all.length) this._notePeak(Math.max(...all) * 1000);
      } catch (err) {
        data.err = String((err && err.message) || err);
      }
    }
    try {
      const { st, ids } = await this._stats(rg.s, rg.e, rg.period);
      const slots = (id) => {
        const out = new Array(rg.n).fill(0);
        if (!id || !st[id]) return out;
        const sc = this._eScale(id);
        st[id].forEach((row) => {
          const ts = typeof row.start === "number" ? row.start : Date.parse(row.start);
          const i = z3Slot(mode, rg, ts);
          if (i >= 0 && i < rg.n && row.change != null) out[i] += row.change * sc;
        });
        return out;
      };
      data.stats = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, slots(id)]));
    } catch (err) {
      data.stats = null;
    }
    if (req !== this._anaReq) return;
    this._ana = data;
    this._draw();
  }

  _draw() {
    if (!this._ana || !this.shadowRoot || !this.shadowRoot.getElementById("chart")) return;
    const a = this._ana;
    if (a.mode === "day" && this._chartKind === "power") this._drawDay(a); else this._drawBars(a);
    const chips = this.shadowRoot.getElementById("chips");
    const st = a.stats;
    // Tag = heute: die Tageswerte stehen schon in Batterie-, Verbrauchs- und Erzeugungskarte
    const isToday = a.mode === "day" && a.rg.s.getTime() === d0(new Date()).getTime();
    chips.style.display = !st || isToday ? "none" : "";
    if (!st || isToday) { chips.innerHTML = ""; return; }
    const S = (k) => (st[k] || []).reduce((x, y) => x + y, 0);
    const P = S("pv"), C = S("cons"), I = S("imp"), E = S("exp"), CH = S("ch"), DI = S("dis");
    const aut = C > 0 ? clamp((C - I) / C, 0, 1) : null;
    const chip = (c, icon, l, v, u) => `<div class="chipx"><i style="background:${c}">${svgI(icon, 16)}</i><span>${l}</span><b>${v}<small>${u}</small></b></div>`;
    chips.innerHTML =
      chip(K.pv, ICON.pv, "Erzeugung", kWh(P), " kWh") +
      chip(K.cons, ICON.home, "Verbrauch", kWh(C), " kWh") +
      chip(K.bat, ICON.bat, "Geladen", kWh(CH), " kWh") +
      chip(K.bat2, ICON.bat, "Entladen", kWh(DI), " kWh") +
      chip(K.grid, ICON.grid, "Netzbezug", kWh(I), " kWh") +
      chip(K.exp, ICON.grid, "Einspeisung", kWh(E), " kWh") +
      chip(K.pv2, ICON.leaf, "Autarkie", aut == null ? "–" : Math.round(aut * 100), " %");
  }

  _drawDay(a) {
    const host = this.shadowRoot.getElementById("chart");
    const W = Math.max(300, host.clientWidth || 800), H = 280;
    const L = 48, R = 40, T = 22, B = 30, pw = W - L - R, ph = H - T - B;
    const all = [...(a.pv || []), ...(a.cons || []), ...((a.batt || []).map((v) => (v == null ? null : Math.abs(v))))].filter((v) => v != null);
    if (!all.length) { host.innerHTML = `<div class="msg">${a.err ? "Fehler: " + a.err : "Für diesen Tag liegen keine Daten vor."}</div>`; return; }
    const max = niceMax(Math.max(0.5, ...all) * 1.05);
    const N = a.N;
    const x = (i) => L + (i / (N - 1)) * pw;
    const zero = T + ph * 0.8;
    const y = (v) => zero - (v / max) * ph * 0.8;
    const ys = (v) => T + ph - (v / 100) * ph;
    const curve = (arr, fy) => runs(arr).map((rn) => smooth(rn.map((i) => [x(i), fy(arr[i])]), T, T + ph));
    const area = (arr) => runs(arr).map((rn) => {
      const d = smooth(rn.map((i) => [x(i), y(arr[i])]), T, T + ph);
      return `${d} L${x(rn[rn.length - 1]).toFixed(1)} ${zero} L${x(rn[0]).toFixed(1)} ${zero}Z`;
    }).join(" ");
    let g = "";
    const step = max / 4;
    for (let k = -1; k <= 4; k++) {
      const yy = y(step * k);
      g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="gl ${k === 0 ? "zl" : ""}"/>
        <text x="${L - 8}" y="${yy + 3}" class="ax" text-anchor="end">${fN(step * k, Number.isInteger(step) ? 0 : 1)}</text>`;
    }
    for (let k = 0; k <= 4; k++) g += `<text x="${W - R + 8}" y="${T + ph - (k / 4) * ph + 3}" class="ax">${k * 25}%</text>`;
    g += `<text x="${L - 8}" y="${T - 8}" class="ax" text-anchor="end">kW</text><text x="${W - 2}" y="${T - 8}" class="ax" text-anchor="end">Ladestand</text>`;
    const hstep = W < 560 ? 6 : 2;
    for (let hh = 0; hh <= 24; hh += hstep) g += `<text x="${L + (hh / 24) * pw}" y="${H - 8}" class="ax" text-anchor="middle">${p2(hh)}:00</text>`;
    let nowL = "";
    const nowI = (Date.now() - a.rg.s.getTime()) / 300000;
    if (nowI > 0 && nowI < N) { const xx = x(nowI); nowL = `<line x1="${xx}" x2="${xx}" y1="${T}" y2="${T + ph}" stroke="var(--zd)" stroke-dasharray="3 4"/>`; }
    host.innerHTML = `<svg width="${W}" height="${H}" class="csvg">
      <defs>
        <linearGradient id="gpv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${K.pv}" stop-opacity=".85"/><stop offset="1" stop-color="${K.pv}" stop-opacity=".15"/></linearGradient>
        <linearGradient id="gco" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${K.cons}" stop-opacity=".35"/><stop offset="1" stop-color="${K.cons}" stop-opacity=".05"/></linearGradient>
        <linearGradient id="gbt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${K.bat}" stop-opacity=".75"/><stop offset="1" stop-color="${K.bat}" stop-opacity=".25"/></linearGradient>
      </defs>${g}
      <path d="${area(a.pv)}" fill="url(#gpv)"/>
      <path d="${area(a.batt)}" fill="url(#gbt)"/>
      <path d="${area(a.cons)}" fill="url(#gco)"/>
      ${curve(a.cons, y).map((d) => `<path d="${d}" fill="none" stroke="${K.cons}" stroke-width="2"/>`).join("")}
      ${curve(a.pv, y).map((d) => `<path d="${d}" fill="none" stroke="${K.pv2}" stroke-width="1.6"/>`).join("")}
      ${curve(a.soc, ys).map((d) => `<path d="${d}" fill="none" stroke="#8E5BB8" stroke-width="2"/>`).join("")}
      ${nowL}
      <line id="cx" y1="${T}" y2="${T + ph}" stroke="var(--zi)" stroke-opacity=".35" visibility="hidden"/>
      <rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="transparent" id="hit"/>
    </svg><div class="tip" id="tip"></div>
    <div class="clegend"><span><i style="background:${K.pv}"></i>Erzeugung</span><span><i style="background:${K.cons}"></i>Verbrauch</span><span><i style="background:${K.bat}"></i>Speicher (+ laden / − entladen)</span><span><i class="ln" style="background:#8E5BB8"></i>Ladestand</span></div>`;
    const q = (s) => host.querySelector(s);
    const hit = q("#hit"), cx = q("#cx"), tip = q("#tip");
    const move = (ev) => {
      const rect = q("svg").getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      const i = clamp(Math.round(((px - L) / pw) * (N - 1)), 0, N - 1);
      const xx = x(i);
      cx.setAttribute("x1", xx); cx.setAttribute("x2", xx); cx.setAttribute("visibility", "visible");
      const t = new Date(a.rg.s.getTime() + i * 300000);
      const row = (c, l, v) => `<div><i style="background:${c}"></i>${l}<b>${v}</b></div>`;
      const b = a.batt[i];
      tip.innerHTML = `<div class="tt">${p2(t.getHours())}:${p2(t.getMinutes())} Uhr</div>
        ${row(K.pv, "Erzeugung", a.pv[i] == null ? "–" : fN(a.pv[i], 2) + " kW")}
        ${row(K.cons, "Verbrauch", a.cons[i] == null ? "–" : fN(a.cons[i], 2) + " kW")}
        ${row(K.bat, b != null && b < 0 ? "Entladung" : "Ladung", b == null ? "–" : fN(Math.abs(b), 2) + " kW")}
        ${row("#8E5BB8", "Ladestand", a.soc[i] == null ? "–" : fN(a.soc[i], 0) + " %")}`;
      tip.style.display = "block";
      tip.style.left = `${xx + 200 > W ? xx - 196 : xx + 12}px`;
    };
    hit.addEventListener("mousemove", move);
    hit.addEventListener("touchmove", move, { passive: true });
    hit.addEventListener("mouseleave", () => { tip.style.display = "none"; cx.setAttribute("visibility", "hidden"); });
  }

  _drawBars(a) {
    const host = this.shadowRoot.getElementById("chart");
    const st = a.stats;
    if (!st) { host.innerHTML = `<div class="msg">Keine Statistikdaten vorhanden.</div>`; return; }
    const W = Math.max(300, host.clientWidth || 800), H = 280;
    const L = 52, R = 12, T = 22, B = 30, pw = W - L - R, ph = H - T - B;
    const n = a.rg.n;
    const max = niceMax(Math.max(0.1, ...st.pv, ...st.cons) * 1.05);
    const bw = pw / n;
    const w = clamp(bw * 0.3, 2, 18);
    const bar = (x0, v, fill) => {
      const hgt = (v / max) * ph;
      if (hgt <= 0.5) return "";
      const rr = Math.min(w / 2, 4, hgt);
      const y0 = T + ph - hgt;
      return `<path d="M${x0} ${T + ph} V${y0 + rr} Q${x0} ${y0} ${x0 + rr} ${y0} H${x0 + w - rr} Q${x0 + w} ${y0} ${x0 + w} ${y0 + rr} V${T + ph}Z" fill="${fill}"/>`;
    };
    let g = "";
    for (let k = 0; k <= 4; k++) {
      const yy = T + ph - (k / 4) * ph;
      g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="gl"/><text x="${L - 8}" y="${yy + 3}" class="ax" text-anchor="end">${fN((max / 4) * k, Number.isInteger(max / 4) ? 0 : 1)}</text>`;
    }
    g += `<text x="${L - 8}" y="${T - 8}" class="ax" text-anchor="end">kWh</text>`;
    const lbl = (i) => {
      if (a.mode === "day") return i % (W < 560 ? 6 : 2) === 0 ? `${p2(i)}:00` : "";
      if (a.mode === "week") return WD[addD(a.rg.s, i).getDay()];
      if (a.mode === "month") return i === 0 || (i + 1) % (W < 560 ? 10 : 5) === 0 ? String(i + 1) : "";
      return W < 560 ? MON[i][0] : MON[i];
    };
    let bars = "";
    for (let i = 0; i < n; i++) {
      const x0 = L + i * bw + bw / 2;
      bars += bar(x0 - w - 1, st.cons[i], K.cons) + bar(x0 + 1, st.pv[i], K.pv);
      const t = lbl(i);
      if (t) g += `<text x="${x0}" y="${H - 8}" class="ax" text-anchor="middle">${t}</text>`;
    }
    host.innerHTML = `<svg width="${W}" height="${H}" class="csvg">${g}<rect id="hl" y="${T}" height="${ph}" fill="var(--zi)" fill-opacity=".06" rx="6" visibility="hidden"/>${bars}
      <rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="transparent" id="hit"/></svg><div class="tip" id="tip"></div>
      <div class="clegend"><span><i style="background:${K.pv}"></i>Erzeugung</span><span><i style="background:${K.cons}"></i>Verbrauch</span></div>`;
    const q = (s) => host.querySelector(s);
    const hit = q("#hit"), hl = q("#hl"), tip = q("#tip");
    const move = (ev) => {
      const rect = q("svg").getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      const i = clamp(Math.floor((px - L) / bw), 0, n - 1);
      hl.setAttribute("x", L + i * bw + 1); hl.setAttribute("width", Math.max(2, bw - 2)); hl.setAttribute("visibility", "visible");
      const t = a.mode === "year" ? `${MONL[i]} ${a.rg.s.getFullYear()}` : a.mode === "day" ? `${p2(i)}:00–${p2(i + 1)}:00 Uhr` : (() => { const d = addD(a.rg.s, i); return `${WD[d.getDay()]}, ${fD(d)}`; })();
      const row = (c, l, v) => `<div><i style="background:${c}"></i>${l}<b>${fN(v, 1)} kWh</b></div>`;
      tip.innerHTML = `<div class="tt">${t}</div>${row(K.pv, "Erzeugung", st.pv[i])}${row(K.cons, "Verbrauch", st.cons[i])}${row(K.bat, "Speicherladung", (st.ch || [])[i] || 0)}${row(K.bat2, "Speicherentladung", (st.dis || [])[i] || 0)}${row(K.grid, "Netzbezug", st.imp[i])}${row(K.exp, "Einspeisung", st.exp[i])}`;
      tip.style.display = "block";
      const xx = L + i * bw + bw / 2;
      tip.style.left = `${xx + 200 > W ? xx - 196 : xx + 12}px`;
    };
    hit.addEventListener("mousemove", move);
    hit.addEventListener("touchmove", move, { passive: true });
    hit.addEventListener("mouseleave", () => { tip.style.display = "none"; hl.setAttribute("visibility", "hidden"); });
  }

  /* ---------- Stil ---------- */
  _css() {
    return `
    :host{display:block;container-type:inline-size}
    *{box-sizing:border-box}
    .z3{--zi:#16262D;--zs:#5F717A;--zd:#93A2AA;--zl:#E3E9EC;--zbg:#EEF2F3;--zc:#fff;--zf:#F2F6F7;--zseg:#E6ECEE;--zsa:#fff;
      --zbd:#D5DEE2;--zbar:#C9D6DB;--zgl:#EDF1F3;--zzl:#CBD5DA;--zh:#0E3A43;--zbtn:#0E3A43;--zwb:#FFF5E4;--zwbd:#F3C97E;--zwi:#7A4E0E;
      --zsh:0 1px 2px rgba(16,40,48,.06),0 8px 24px rgba(16,40,48,.06);color-scheme:light}
    .z3.dark{--zi:#E6EEF0;--zs:#9DB1B8;--zd:#6E858D;--zl:#26434B;--zbg:#0B2227;--zc:#122C32;--zf:#183840;--zseg:#183840;--zsa:#2A4B53;
      --zbd:#33555E;--zbar:#33555E;--zgl:#1D3A41;--zzl:#3A5C65;--zh:#7FD6CB;--zbtn:#1F8A80;--zwb:#3A2F16;--zwbd:#8C6B2B;--zwi:#F2D9A2;
      --zsh:0 1px 2px rgba(0,0,0,.25),0 8px 24px rgba(0,0,0,.25);color-scheme:dark}
    .z3{max-width:1480px;margin:0 auto;color:var(--zi);font-family:var(--ha-font-family-body,Roboto,"Helvetica Neue",Arial,sans-serif);
      background:var(--zbg);border-radius:var(--ha-card-border-radius,16px);overflow:hidden;font-variant-numeric:tabular-nums}
    /* Hero mit Hintergrundbild */
    .hero{position:relative;width:100%;height:clamp(420px,56.3cqw,780px);overflow:hidden;background:#0F5A63}
    .hero.is-night{background:#0A2E33}
    .bg{position:absolute;inset:0;background-size:cover;background-position:var(--bgx,50%) 60%;background-repeat:no-repeat;transition:opacity 4s ease}
    #bg-night{opacity:0}
    .shade{position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(4,30,36,.38) 0%,rgba(4,30,36,.12) 32%,rgba(4,30,36,0) 55%)}
    .links{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
    .lead{stroke:rgba(255,255,255,.75);stroke-width:1.3;stroke-dasharray:3 4}
    .fglow{fill:none;stroke-width:7;opacity:.35;filter:url(#fg);stroke-linecap:round}
    .fshade{fill:none;stroke:rgba(0,22,28,.42);stroke-width:4.5;stroke-linecap:round}
    .fline{fill:none;stroke-width:2;opacity:.95;stroke-linecap:round}
    .fdots{fill:none;stroke-width:5;stroke-linecap:round;stroke-dasharray:.1 16;animation:z3m linear infinite}
    @keyframes z3m{from{stroke-dashoffset:16.1}to{stroke-dashoffset:0}}
    .ovl{position:absolute;inset:0;pointer-events:none}
    .dot{position:absolute;left:0;top:0;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 0 0 4px rgba(255,255,255,.28),0 0 14px rgba(255,255,255,.7)}
    .dot::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid rgba(255,255,255,.7);opacity:0}
    .dot:not(.act){box-shadow:0 0 0 3px rgba(255,255,255,.18);opacity:.75}
    .dot.act::after{animation:z3pulse 2.4s ease-out infinite}
    @keyframes z3pulse{from{transform:scale(.6);opacity:1}to{transform:scale(2.2);opacity:0}}
    .node{position:absolute;left:0;top:0;width:var(--nd,74px);height:var(--nd,74px);border-radius:50%;background:rgba(255,255,255,.96);color:#16262D;
      font-size:max(calc(var(--nd,92px) / 6.4), 10.5px);
      display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 .9em 2.2em rgba(0,20,26,.35);will-change:transform}
    .node i{color:var(--c);display:flex;margin-bottom:.1em}
    .node i svg{width:1.55em;height:1.55em}
    .node b{font-size:1.32em;font-weight:600;line-height:1.15;white-space:nowrap}
    .node span{font-size:.8em;color:#5F717A;max-width:90%;text-align:center;line-height:1.15;white-space:nowrap}
    .node.hide,.dot.hide{display:none}
    /* ohne Fluss zurücknehmen, damit das Aktive ins Auge fällt */
    .node{transition:opacity .6s}.node.idle{opacity:.55}
    .nring{position:absolute;inset:-.45em;width:calc(100% + .9em);height:calc(100% + .9em);transform:rotate(-90deg);overflow:visible}
    .nring circle{fill:none;stroke:rgba(255,255,255,.4);stroke-width:3.5}
    .nring .na{stroke:var(--c);stroke-dasharray:0 100;stroke-linecap:round;opacity:0;transition:opacity .6s}
    .node.on .na{opacity:1;stroke-dasharray:24 76;animation:z3spin 3.5s linear infinite}
    #n-bat .na{opacity:1;stroke-dasharray:calc(var(--p,0) * 1) 100;animation:none}
    @keyframes z3spin{to{stroke-dashoffset:-100}}
    .pill{position:absolute;left:0;top:0;display:flex;align-items:center;gap:.5em;padding:.4em .85em;border-radius:999px;background:rgba(255,255,255,.95);
      color:#16262D;font-size:var(--pf,12px);white-space:nowrap;box-shadow:0 6px 18px rgba(0,20,26,.3);will-change:transform}
    .pill i{width:.65em;height:.65em;border-radius:50%;background:var(--c)}
    .pill span{color:#5F717A}.pill b{color:#16262D;font-weight:600;margin-left:.25em}
    .pill.off{display:none}
    .htop{position:absolute;left:0;top:0;padding:22px 26px;display:flex;flex-direction:column;align-items:flex-start;gap:18px;pointer-events:none}
    .brand{display:flex;gap:12px;align-items:center;color:#fff;text-shadow:0 1px 10px rgba(0,0,0,.35)}
    .menubtn{pointer-events:auto;background:rgba(255,255,255,.15);border:0;color:#fff;border-radius:10px;width:36px;height:36px;font-size:18px;cursor:pointer}
    h1{font-size:24px;font-weight:600;margin:0;letter-spacing:.2px}
    .subt{font-size:13px;opacity:.88;margin-top:2px}
    .kpis{display:flex;gap:12px}
    .kpi{display:flex;flex-direction:column;align-items:center;gap:4px;background:rgba(4,34,40,.42);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
      border:1px solid rgba(255,255,255,.16);border-radius:18px;padding:10px 12px 8px;color:#fff;min-width:104px}
    .kpi span{font-size:11px;opacity:.88}
    .kv{font-size:20px;font-weight:600;fill:#fff}.kp{font-size:11px;fill:rgba(255,255,255,.8)}
    .kpis.out{display:none}
    .hfoot{position:absolute;left:26px;bottom:18px;display:flex;gap:8px}
    .chip{display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;background:rgba(4,34,40,.5);color:#fff;font-size:12px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
    .chip i{width:8px;height:8px;border-radius:50%}
    .chip:empty{display:none}
    .hero.nobg .bg{display:none}
    /* Segment-Schalter */
    .seg{display:inline-flex;background:var(--zseg);border-radius:12px;padding:3px;gap:2px;pointer-events:auto}
    .seg button{font:inherit;font-size:13px;color:var(--zs);background:none;border:0;border-radius:9px;padding:7px 14px;cursor:pointer}
    .seg button.act{background:var(--zsa);color:var(--zi);font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.12)}
    .hseg{background:rgba(255,255,255,.2);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
    .hseg button{color:#fff}.hseg button.act{background:#fff;color:${K.petrol}}
    .seg.small button{padding:6px 11px;font-size:12px}
    /* Karten */
    .banner{margin:16px 20px 0;background:var(--zwb);border:1px solid var(--zwbd);color:var(--zwi);padding:10px 14px;border-radius:12px;font-size:13px}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;padding:20px}
    .card{background:var(--zc);border-radius:16px;box-shadow:var(--zsh);padding:18px 20px;min-width:0}
    .card.wide{grid-column:1 / -1}
    .card.wide2{grid-column:span 2}
    .card header{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}
    h2{font-size:16px;font-weight:600;margin:0;color:var(--zh)}
    .tag{font-size:12px;color:var(--zs);background:var(--zf);border-radius:999px;padding:4px 10px}
    .batrow{display:flex;align-items:center;gap:22px}
    .rbig{font-size:34px;font-weight:600;fill:var(--zi)}.rpct{font-size:15px;fill:var(--zs)}.rsub{font-size:12px;fill:var(--zs)}
    .bstate{font-size:15px;font-weight:600}.bpow{font-size:28px;font-weight:600;margin:2px 0;white-space:nowrap}.btime{font-size:12.5px;color:var(--zs)}
    .pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px;padding-top:14px;border-top:1px solid var(--zl)}
    .pair span{display:block;font-size:12px;color:var(--zs)}.pair b{font-size:17px;font-weight:600}
    .dwrap{display:flex;align-items:center;gap:20px}
    .dv{font-size:22px;font-weight:600;fill:var(--zi)}.du{font-size:11px;fill:var(--zs)}
    .dleg{display:flex;flex-direction:column;gap:9px;flex:1;min-width:0}
    .dleg div{display:grid;grid-template-columns:10px 1fr auto;column-gap:8px;align-items:center;font-size:13px}
    .dleg i{width:10px;height:10px;border-radius:50%}.dleg b{font-weight:600;white-space:nowrap}
    .dleg em{grid-column:2 / 4;font-style:normal;font-size:11.5px;color:var(--zs);margin-top:-2px}
    .anahead{align-items:center}
    .dnav{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:500}
    .dnav button{width:34px;height:34px;border-radius:10px;border:0;background:var(--zf);color:var(--zi);display:grid;place-items:center;cursor:pointer}
    .dnav button:disabled{opacity:.35;cursor:default}
    .dnav span{min-width:200px;text-align:center}
    .dnav .today{width:auto;padding:0 12px;font:inherit;font-size:13px;color:var(--zh);font-weight:600}
    .chart{position:relative;min-height:300px}
    .csvg{display:block}
    .gl{stroke:var(--zgl)}.zl{stroke:var(--zzl)}
    .ax{font-size:10.5px;fill:var(--zd)}
    .msg{padding:110px 0;text-align:center;color:var(--zs);font-size:13px}
    .clegend{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--zs);margin-top:6px}
    .clegend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
    .clegend i.ln{width:16px;height:3px;vertical-align:3px}
    .tip{display:none;position:absolute;top:10px;width:196px;padding:10px 12px;border-radius:12px;background:var(--zc);border:1px solid var(--zl);box-shadow:0 10px 30px rgba(0,20,26,.25);font-size:12px;pointer-events:none}
    .tip .tt{color:var(--zs);margin-bottom:6px}
    .tip div{display:flex;align-items:center;gap:7px;margin:3px 0}
    .tip i{width:8px;height:8px;border-radius:50%}
    .tip b{margin-left:auto;font-weight:600}
    .chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:16px}
    /* zweizeilig: Bezeichnung klein oben, Wert darunter – kein Überlappen bei schmalen Spalten */
    .chipx{display:grid;grid-template-columns:34px minmax(0,1fr);grid-template-rows:auto auto;column-gap:10px;align-items:center;border:1px solid var(--zl);border-radius:999px;padding:6px 14px 6px 6px;min-width:0}
    .chipx i{grid-row:1 / 3;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff}
    .chipx span{font-size:11.5px;color:var(--zs);line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .chipx b{font-size:16px;font-weight:600;white-space:nowrap;line-height:1.2}.chipx small{font-size:11px;color:var(--zs);font-weight:400}
    .autnow{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}.autnow span{font-size:12px;color:var(--zs)}.autnow b{font-size:28px;font-weight:600;color:var(--zh)}
    .abars{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;height:170px}
    .ab{display:flex;flex-direction:column;gap:6px}
    .abv{flex:1;display:flex;align-items:flex-end;background:var(--zf);border-radius:10px;overflow:hidden}
    .abv div{width:100%;background:var(--zbar);border-radius:10px 10px 0 0;display:flex;justify-content:center;transition:height .8s}
    .ab.cur .abv div{background:linear-gradient(180deg,${K.pv},${K.pv2})}
    .abv em{font-style:normal;font-size:12px;font-weight:600;color:var(--zi);padding-top:6px}
    .ab span{font-size:12px;color:var(--zs);text-align:center}
    .sysgrid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:22px}
    .facts{display:grid;grid-template-columns:repeat(3,1fr);gap:12px 18px}
    .facts div{display:flex;flex-direction:column;gap:2px}
    .facts span{font-size:11.5px;color:var(--zs)}.facts b{font-size:14px;font-weight:500}
    .ctrls{display:flex;flex-direction:column;gap:12px}
    .ctl{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px 14px;background:var(--zf);border-radius:12px}
    .ctl b{display:block;font-size:13.5px;font-weight:500}.ctl small{font-size:11.5px;color:var(--zs)}
    .confirm{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px;background:var(--zwb);border:1px solid var(--zwbd);border-radius:12px;font-size:13px;color:var(--zi)}
    .confirm[hidden]{display:none}
    .cbtns{display:flex;gap:8px}
    .confirm button{font:inherit;font-size:13px;border-radius:9px;padding:7px 14px;cursor:pointer;border:1px solid var(--zbd);background:var(--zc);color:var(--zi)}
    .confirm button.yes{background:var(--zbtn);border-color:var(--zbtn);color:#fff;font-weight:600}
    .confirm button:disabled{opacity:.5;cursor:default}
    .ctl select{font:inherit;font-size:13px;color:var(--zi);background:var(--zc);border:1px solid var(--zbd);border-radius:9px;padding:7px 10px}
    .rng{display:flex;align-items:center;gap:10px}.rng input{width:150px;accent-color:var(--zbtn)}.rng em{font-style:normal;min-width:42px;text-align:right}
    @container (max-width:1100px){.grid{grid-template-columns:1fr 1fr}.card.wide2{grid-column:1 / -1}}
    @container (max-width:720px){
      .z3{border-radius:0}
      .hero{height:100cqw;min-height:0}
      .htop{position:static;padding:14px 16px;gap:10px}
      .htop .brand{position:relative;z-index:2}
      .htop .hseg{position:absolute;right:12px;bottom:12px}
      #hstamp{display:none}
      .kpis.in{display:none}
      .kpis.out{display:flex;justify-content:center;background:${K.petrol};padding:10px 12px 14px}
      .kpi{min-width:0;flex:1;max-width:170px}
      h1{font-size:19px}
      .hfoot{left:14px;bottom:12px}
      .dot{width:9px;height:9px}
      .grid{grid-template-columns:1fr;padding:12px;gap:12px}
      .card.wide2{grid-column:auto}
      .dwrap{gap:16px}.dwrap .ring{width:108px;height:108px;flex:none}
      .dnav span{min-width:0;font-size:13px}
      /* Grafik-Leiste: oben Zeitraum über die volle Breite, darunter Blättern und Leistung/Arbeit */
      #tabs{order:1;width:100%;display:flex}#tabs button{flex:1;padding:7px 4px}
      .dnav{order:2;gap:4px}.dnav button{width:30px;height:30px}.dnav .today:disabled{display:none}
      #kind{order:3;margin-left:auto}
      .sysgrid{grid-template-columns:1fr}.facts{grid-template-columns:repeat(2,1fr)}
    }
    `;
  }
}

if (!customElements.get(Z3_TAG)) {
  customElements.define(Z3_TAG, ZeoSonnen3DCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: Z3_TAG,
    name: "ZEO sonnenBatterie Haus",
    description: "Hausansicht (Tag/Nacht) mit Live-Energiefluss der sonnenBatterie, Tageskennzahlen und Auswertung",
  });
  console.info(`%c ZEO-SONNEN-HAUS %c v${Z3_VERSION} `, "background:#0E3A43;color:#fff", "background:#F5B52E;color:#0E3A43");
}
