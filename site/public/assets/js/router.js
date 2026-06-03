// router.js — shareable query-string state (?view=compare&ids=a,b&transform=indexed&range=10y)

export const DEFAULT_STATE = {
  view: "overview", ids: [], transform: "level", range: "10y",
  chart: "line", preset: null, rec: true, log: false, miss: false,
  present: "line",   // workspace presentation: line | area | stacked | share | multiples (?p=)
  mapMetric: null,   // selected indicator id for the state-map view (?metric=)
  mapMode: "map",    // state-map presentation: "map" | "heatmap" | "dist" (?mode=)
  mapRange: "all",   // state-map period window: 1y | 5y | 10y | all (?mr=)
  bdKey: null,       // composition view: selected breakdown key (?bd=)
  indView: null,     // composition view: "change" | "share" | "latest" (?iv=); null → breakdown's own default
  indWindow: "1m",   // composition change window: 1m | 3m | 6m | 12m (?iw=)
  indMeasure: "net", // composition change measure: "net" (count) | "pct" (%) (?im=)
  axes: {},          // { indicatorId: "right" } — series moved to the secondary axis
  combine: null,     // { opKey } for a curated op, or { expr } for a custom formula
};

export function parseState() {
  const p = new URLSearchParams(location.search);
  const s = { ...DEFAULT_STATE };
  if (p.has("view")) s.view = p.get("view");
  if (p.has("ids")) s.ids = p.get("ids").split(",").map((x) => x.trim()).filter(Boolean);
  if (p.has("transform")) s.transform = p.get("transform");
  if (p.has("range")) s.range = p.get("range");
  if (p.has("chart")) s.chart = p.get("chart");
  if (p.has("p")) s.present = p.get("p");
  if (p.has("metric")) s.mapMetric = p.get("metric");
  if (p.has("mode")) s.mapMode = p.get("mode");
  if (p.has("mr")) s.mapRange = p.get("mr");
  if (p.has("bd")) s.bdKey = p.get("bd");
  if (p.has("iv")) s.indView = p.get("iv");
  if (p.has("iw")) s.indWindow = p.get("iw");
  if (p.has("im")) s.indMeasure = p.get("im");
  if (p.has("preset")) s.preset = p.get("preset");
  if (p.has("rec")) s.rec = p.get("rec") === "1";
  if (p.has("log")) s.log = p.get("log") === "1";
  if (p.has("miss")) s.miss = p.get("miss") === "1";
  s.axes = {};
  if (p.has("raxis")) p.get("raxis").split(",").filter(Boolean).forEach((id) => { s.axes[id] = "right"; });
  s.combine = null;
  if (p.has("cmb")) s.combine = { opKey: p.get("cmb"), expr: null };
  else if (p.has("cmbx")) s.combine = { opKey: null, expr: p.get("cmbx") };
  if (s.combine && p.has("cmbn")) s.combine.name = p.get("cmbn");
  // compare is a flavor of explore
  if (s.view === "compare") s.view = "explore";
  return s;
}

export function encodeState(s, { full = false } = {}) {
  const p = new URLSearchParams();
  // The state map is a self-contained view with no series/preset params; keep its URL clean
  // (and don't let the >1-series "compare" relabeling below hijack it).
  if (s.view === "map") {
    p.set("view", "map");
    if (s.mapMetric) p.set("metric", s.mapMetric);
    if (s.mapMode && s.mapMode !== "map") p.set("mode", s.mapMode);
    if (s.mapRange && s.mapRange !== "all") p.set("mr", s.mapRange);
    const qs = "?" + p.toString();
    return full ? location.origin + location.pathname + qs : qs;
  }
  // The composition view is self-contained (no series/preset params); keep its URL clean.
  if (s.view === "composition") {
    p.set("view", "composition");
    if (s.bdKey) p.set("bd", s.bdKey);
    if (s.indView) p.set("iv", s.indView);
    if (s.indWindow && s.indWindow !== "1m") p.set("iw", s.indWindow);
    if (s.indMeasure && s.indMeasure !== "net") p.set("im", s.indMeasure);
    const qs = "?" + p.toString();
    return full ? location.origin + location.pathname + qs : qs;
  }
  // "compare" is only a relabeling of Explore with >1 series — About/Themes/Overview
  // must keep their own view even when a multi-series chart is still loaded in state.
  p.set("view", s.view === "explore" && s.ids.length > 1 ? "compare" : s.view);
  if (s.preset) p.set("preset", s.preset);
  if (s.ids.length) p.set("ids", s.ids.join(","));
  if (s.transform !== "level") p.set("transform", s.transform);
  if (s.range !== DEFAULT_STATE.range) p.set("range", s.range);
  if (s.chart !== "line") p.set("chart", s.chart);
  if (s.present && s.present !== "line") p.set("p", s.present);
  if (!s.rec) p.set("rec", "0");
  if (s.log) p.set("log", "1");
  if (s.miss) p.set("miss", "1");
  const rax = Object.keys(s.axes || {}).filter((id) => s.axes[id] === "right");
  if (rax.length) p.set("raxis", rax.join(","));
  if (s.combine) {
    if (s.combine.opKey) p.set("cmb", s.combine.opKey);
    else if (s.combine.expr) p.set("cmbx", s.combine.expr);
    if (s.combine.name) p.set("cmbn", s.combine.name);
  }
  const qs = "?" + p.toString();
  return full ? location.origin + location.pathname + qs : qs;
}

export function syncURL(s) {
  history.replaceState(null, "", encodeState(s));
}
