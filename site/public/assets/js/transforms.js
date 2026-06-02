// transforms.js — apply transforms over observation arrays.
// Source of truth is raw `value`; precomputed deltas are used where the
// backend baked them, and visible-range index is computed in the browser.

export const TRANSFORMS = [
  { key: "level",      label: "Level" },
  { key: "change",     label: "Change" },
  { key: "pct_change", label: "% Change" },
  { key: "yoy",        label: "YoY" },
  { key: "rolling",    label: "Rolling" },
  { key: "indexed",    label: "Index" },
];

// precomputed field that backs each transform, given frequency
function rollingField(freq) { return freq === "W" || freq === "Q" ? "rolling_4" : "rolling_3"; }
function fieldFor(key, freq) {
  return { level: "value", change: "change_1", pct_change: "pct_change_1",
           yoy: "pct_change_12", rolling: rollingField(freq) }[key] || "value";
}

const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);

// Filter observations to a range relative to the latest observation date.
export function filterRange(obs, range) {
  if (!obs.length || range === "all") return obs;
  const years = { "1y": 1, "5y": 5, "10y": 10 }[range] || 0;
  if (!years) return obs;
  const last = obs[obs.length - 1].date;
  const [y, m, d] = last.split("-").map(Number);
  const cutoff = `${y - years}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return obs.filter((o) => o.date >= cutoff);
}

// Apply a transform to a (range-filtered) observation array.
// Returns [[dateISO, value|null], ...] — null preserved as a gap.
export function applyTransform(obs, transform, freq) {
  if (transform === "indexed") {
    const base = obs.find((o) => isFiniteNum(o.value))?.value;
    if (!isFiniteNum(base) || base === 0) return obs.map((o) => [o.date, null]);
    return obs.map((o) => [o.date, isFiniteNum(o.value) ? (o.value / base) * 100 : null]);
  }
  const f = fieldFor(transform, freq);
  return obs.map((o) => [o.date, isFiniteNum(o[f]) ? o[f] : null]);
}

// Which transforms make sense for this series? Returns {key: {ok, reason}}.
export function transformAvailability(obs, units, freq) {
  const u = (units || "").toLowerCase();
  const boolean = u.includes("boolean");
  const has = (field) => obs.some((o) => isFiniteNum(o[field]));
  const firstVal = obs.find((o) => isFiniteNum(o.value))?.value;
  const anyNonPositive = obs.some((o) => isFiniteNum(o.value) && o.value <= 0);

  const out = {};
  out.level = { ok: true };
  out.change = { ok: has("change_1") && !boolean, reason: "No period-over-period change for this series." };
  out.pct_change = { ok: has("pct_change_1") && !boolean, reason: boolean ? "Percent change is meaningless for a 0/1 indicator." : "No percent-change baseline available." };
  out.yoy = { ok: has("pct_change_12") && !boolean, reason: boolean ? "Year-over-year change is meaningless for a 0/1 indicator." : "Not enough history for a year-over-year comparison." };
  out.rolling = { ok: has(rollingField(freq)) && freq !== "A", reason: freq === "A" ? "Rolling averages don't apply to annual data." : "No rolling average precomputed." };
  out.indexed = { ok: isFiniteNum(firstVal) && firstVal > 0 && !anyNonPositive && !boolean,
                  reason: boolean ? "Cannot index a 0/1 indicator." : "Indexing needs strictly positive values in the visible range." };
  return out;
}

// Unit label after a transform (drives axis label + tooltip).
export function transformUnit(transform, units) {
  const u = (units || "").toLowerCase();
  if (transform === "pct_change" || transform === "yoy") return "Percent change";
  if (transform === "indexed") return "Index (visible start = 100)";
  if (transform === "change") {
    if (u.includes("percent")) return "Change (pp)";
    return "Change, " + (units || "");
  }
  return units || "";
}

export function transformVerb(transform) {
  return { level: "", change: "MoM change", pct_change: "% change", yoy: "year-over-year",
           rolling: "rolling avg", indexed: "indexed to 100" }[transform] || "";
}

// Human label for the rolling-average window, which is fixed by frequency:
// 4 periods for weekly/quarterly data, 3 for everything else (matches rollingField).
export function rollingLabel(freq) {
  return { W: "4-wk avg", Q: "4-qtr avg", M: "3-mo avg", D: "3-day avg" }[freq] || "Rolling avg";
}

// ---- cross-series alignment (for paired presets / gaps / ratios) ----

export function alignByDate(obsA, obsB) {
  const map = new Map(obsB.map((o) => [o.date, o.value]));
  const out = [];
  for (const o of obsA) {
    const b = map.get(o.date);
    if (isFiniteNum(o.value) && isFiniteNum(b)) out.push({ date: o.date, a: o.value, b });
  }
  return out;
}

// derived gap series A - B aligned on date -> [[date, value|null]]
export function computeGap(obsA, obsB) {
  const map = new Map(obsB.map((o) => [o.date, o.value]));
  return obsA.map((o) => {
    const b = map.get(o.date);
    return [o.date, isFiniteNum(o.value) && isFiniteNum(b) ? o.value - b : null];
  });
}

// ---- combine two-or-more series into a single derived line ----
// Curated operations double as one-click shortcuts that fill the formula box,
// so the menu and the free-form box are the same mechanism (no hidden modes).
export const COMBINE_OPS = [
  { key: "ratio", label: "Ratio",      hint: "a ÷ b",     expr: "a / b" },
  { key: "diff",  label: "Difference", hint: "a − b",     expr: "a - b" },
  { key: "sum",   label: "Sum",        hint: "a + b",     expr: "a + b" },
  { key: "share", label: "Share",      hint: "a ÷ b × 100", expr: "a / b * 100" },
];

const VARS = "abcdefgh";

// Compile a small arithmetic formula over line variables a, b, c, … into a
// function. Only variables a–h, numbers, ( ) and + - * / are allowed — anything
// else (identifiers, calls, property access) is rejected, so this can't run
// arbitrary code on the user's own input.
export function compileFormula(expr, n) {
  const cleaned = String(expr || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (!/^[a-h0-9+\-*/().\s]+$/.test(cleaned)) return null;
  for (const v of new Set(cleaned.match(/[a-h]/g) || [])) {
    if (VARS.indexOf(v) >= n) return null; // references a line that isn't present
  }
  try {
    const fn = new Function(...VARS.slice(0, Math.max(n, 1)).split(""), `"use strict"; return (${cleaned});`);
    fn(...Array(Math.max(n, 1)).fill(1)); // smoke-test it evaluates to a number
    return fn;
  } catch (e) { return null; }
}

// Evaluate `expr` per date across N observation arrays, aligned on the first
// series' dates. Missing/non-finite inputs on any line -> null (renders as a gap).
export function combineSeries(obsArrays, expr) {
  const fn = compileFormula(expr, obsArrays.length);
  if (!fn || !obsArrays.length) return null;
  const maps = obsArrays.map((a) => new Map(a.map((o) => [o.date, o.value])));
  return obsArrays[0].map((o) => {
    const args = maps.map((m) => m.get(o.date));
    if (args.some((v) => !isFiniteNum(v))) return [o.date, null];
    let r;
    try { r = fn(...args); } catch (e) { r = null; }
    return [o.date, isFiniteNum(r) ? r : null];
  });
}

// human label for the combined line
export function combineLabel(opKey, names, expr) {
  const [a, b] = names;
  if (opKey === "ratio") return `${a} ÷ ${b}`;
  if (opKey === "diff")  return `${a} − ${b}`;
  if (opKey === "sum")   return `${a} + ${b}`;
  if (opKey === "share") return `${a} as % of ${b}`;
  // custom: substitute a,b,c… back to the short titles
  return String(expr || "").replace(/[a-h]/g, (v) => names[VARS.indexOf(v)] ? `[${names[VARS.indexOf(v)]}]` : v);
}
