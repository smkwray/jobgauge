// format.js — number/date/unit formatting (tabular) + state FIPS map + provider labels

export const FIPS = {
  "01":"Alabama","02":"Alaska","04":"Arizona","05":"Arkansas","06":"California","08":"Colorado",
  "09":"Connecticut","10":"Delaware","11":"District of Columbia","12":"Florida","13":"Georgia",
  "15":"Hawaii","16":"Idaho","17":"Illinois","18":"Indiana","19":"Iowa","20":"Kansas","21":"Kentucky",
  "22":"Louisiana","23":"Maine","24":"Maryland","25":"Massachusetts","26":"Michigan","27":"Minnesota",
  "28":"Mississippi","29":"Missouri","30":"Montana","31":"Nebraska","32":"Nevada","33":"New Hampshire",
  "34":"New Jersey","35":"New Mexico","36":"New York","37":"North Carolina","38":"North Dakota",
  "39":"Ohio","40":"Oklahoma","41":"Oregon","42":"Pennsylvania","44":"Rhode Island","45":"South Carolina",
  "46":"South Dakota","47":"Tennessee","48":"Texas","49":"Utah","50":"Vermont","51":"Virginia",
  "53":"Washington","54":"West Virginia","55":"Wisconsin","56":"Wyoming","72":"Puerto Rico"
};

// "state:06" -> "California"; falls back to the raw label
export function geoName(geo) {
  if (!geo) return "United States";
  if (geo === "US") return "United States";
  const m = String(geo).match(/state:(\d+)/);
  if (m) return FIPS[m[1]] || `State ${m[1]}`;
  return geo;
}

export const PROVIDER_LABEL = {
  bls: "BLS", fred: "FRED", dol: "DOL", qcew: "BLS QCEW", census_qwi: "Census QWI", bea: "BEA",
};
export const FREQ_LABEL = { M: "Monthly", W: "Weekly", Q: "Quarterly", A: "Annual", D: "Daily" };
export const SA_LABEL = { SA: "Seasonally adjusted", NSA: "Not seasonally adjusted" };

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function fmtDate(iso, freq) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (freq === "A") return String(y);
  if (freq === "Q") return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
  if (freq === "W" || freq === "D") return `${MONTHS[m - 1]} ${d}, ${y}`;
  return `${MONTHS[m - 1]} ${y}`;
}

export function fmtTimestamp(iso) {
  if (!iso) return "—";
  const [date, time] = iso.replace("Z", "").split("T");
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y} ${time ? time.slice(0, 5) : ""} UTC`.trim();
}

// Value formatting tuned to the indicator's units.
export function fmtValue(v, units, opts = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const u = (units || "").toLowerCase();
  const compact = opts.compact;

  if (u.includes("percent")) return round(v, v >= 100 ? 1 : v < 1 ? 2 : 1);
  if (u.includes("boolean")) return v >= 0.5 ? "yes" : "no";
  if (u.includes("dollars per hour")) return "$" + round(v, 2);
  if (u.includes("dollars per week")) return "$" + grp(round(v, 0));
  if (u.includes("billions")) return "$" + grp(round(v, 1)) + "B";
  if (u.includes("index")) return round(v, 1);
  if (u.includes("weeks")) return round(v, 1);
  if (u.includes("hours")) return round(v, 1);

  // counts (thousands / jobs / persons / number / hires / separations)
  if (u.includes("thousand")) {
    // values are already in thousands; show in millions when large for headline cards
    if (compact && v >= 1000) return grp(round(v / 1000, 2)) + "M";
    return grp(round(v, 0)) + "K";
  }
  if (u.includes("number") || u.includes("person") || u.includes("job") || u.includes("hire") || u.includes("separation")) {
    if (v >= 1e6) return grp(round(v / 1e6, 2)) + "M";
    if (v >= 1e3) return grp(round(v / 1e3, 0)) + "K";
    return grp(round(v, 0));
  }
  return grp(round(v, 1));
}

// short unit suffix shown next to big numbers
export function unitShort(units) {
  const u = (units || "").toLowerCase();
  if (u.includes("percent")) return "%";
  if (u.includes("dollars per hour")) return "/hr";
  if (u.includes("dollars per week")) return "/wk";
  if (u.includes("weeks")) return "wks";
  if (u.includes("hours")) return "hrs";
  if (u.includes("index")) return "idx";
  return "";
}

export function fmtDelta(v, units, kind) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  if (kind === "pct") return `${sign}${round(v, 1)}%`;
  const u = (units || "").toLowerCase();
  if (u.includes("percent")) return `${sign}${round(v, 1)} pp`;
  if (u.includes("thousand")) return `${sign}${grp(round(v, 0))}K`;
  if (u.includes("dollars per hour")) return `${sign}$${round(v, 2)}`;
  if (Math.abs(v) >= 1e6) return `${sign}${grp(round(v / 1e6, 2))}M`;
  if (Math.abs(v) >= 1e3) return `${sign}${grp(round(v / 1e3, 0))}K`;
  return `${sign}${round(v, 1)}`;
}

function round(v, d) {
  const f = Math.pow(10, d);
  return (Math.round(v * f) / f).toFixed(d);
}
function grp(s) {
  const str = String(s);
  const neg = str.startsWith("-");
  const [int, dec] = (neg ? str.slice(1) : str).split(".");
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + g + (dec ? "." + dec : "");
}

// --- map metric formatting (unit-aware: percent / dollars / counts) ---
export function fmtMapValue(v, units) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const u = (units || "").toLowerCase();
  if (u.includes("percent")) return (+v.toFixed(2)) + "%";
  if (u.includes("dollar")) return "$" + grp(Math.round(v));
  return grp(Math.round(v)); // jobs / hires / separations / persons / counts
}
export function fmtMapChange(v, units) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v), u = (units || "").toLowerCase();
  if (u.includes("percent")) return sign + (+a.toFixed(2)) + " pp";
  if (u.includes("dollar")) return sign + "$" + grp(Math.round(a));
  return sign + grp(Math.round(a));
}
// compact form for legend ticks (K / M / B)
export function fmtMapCompact(v, units) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const u = (units || "").toLowerCase();
  if (u.includes("percent")) return (+v.toFixed(2)) + "%";
  const a = Math.abs(v); let s;
  if (a >= 1e9) s = round(v / 1e9, 1) + "B";
  else if (a >= 1e6) s = round(v / 1e6, 1) + "M";
  else if (a >= 1e3) s = round(v / 1e3, 0) + "K";
  else s = String(Math.round(v));
  return (u.includes("dollar") ? "$" : "") + s;
}

// deterministic palette for compare series (brand-led, restrained).
// Dark variants are brighter so lines keep contrast on a charcoal background.
export const SERIES_COLORS = [
  "#0C766C", "#B9722A", "#2D5BA8", "#9A3C6B", "#5C7A29", "#8A5A2B", "#3F8E8E", "#A23E32",
];
export const SERIES_COLORS_DARK = [
  "#3FD6C4", "#E6A856", "#6FA8FF", "#E27CB2", "#A6CF6A", "#D89A5A", "#5FD3D0", "#ED8270",
];
export function seriesPalette() {
  return document.documentElement.getAttribute("data-theme") === "terminal" ? SERIES_COLORS_DARK : SERIES_COLORS;
}
