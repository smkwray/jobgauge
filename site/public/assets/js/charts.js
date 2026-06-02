// charts.js — Apache ECharts option builders for jobgauge.
// Rules honored: raw value is truth; null renders as a gap (never zero);
// no default dual axes; recession bands; restrained research-grade styling.

import { fmtValue, fmtDate, fmtMapValue, fmtMapChange, fmtMapCompact } from "./format.js";

export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    ink: v("--ink"), ink2: v("--ink-2"), ink3: v("--ink-3"),
    line: v("--line"), line2: v("--line-2"), line3: v("--line-3"), surface: v("--surface"),
    paper2: v("--paper-2"), brand: v("--brand"), accent: v("--accent"),
    pos: v("--pos"), neg: v("--neg"), recession: v("--recession"),
    fontMono: "IBM Plex Mono, monospace", fontSans: "IBM Plex Sans, sans-serif",
  };
}

// Respect the OS "reduce motion" setting: charts snap into place instead of animating.
export function reduceMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}
function anim() { return reduceMotion() ? { animation: false } : { animation: true }; }
function animMs(ms) { return reduceMotion() ? 0 : ms; }

// runs of consecutive nulls bounded by real values -> [[fromDate,toDate]]
export function nullRuns(data) {
  const runs = []; let start = null, prev = null;
  for (let i = 0; i < data.length; i++) {
    const [d, val] = data[i];
    if (val === null) { if (start === null && prev) start = prev; }
    else { if (start !== null) runs.push([start, d]); start = null; prev = d; }
  }
  return runs;
}

function fmtCtx(v, s) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const u = (s.displayUnit || "").toLowerCase();
  if (u.includes("percent change") || u === "percent" || u.includes("%")) return (v > 0 && /change/.test(u) ? "+" : "") + v.toFixed(2).replace(/\.?0+$/, "") + "%";
  if (u.includes("pp")) return (v > 0 ? "+" : "") + v.toFixed(2).replace(/\.?0+$/, "") + " pp";
  if (u.includes("index")) return v.toFixed(1);
  return fmtValue(v, s.origUnits);
}

const RECESSIONS = [
  ["1990-07-01", "1991-03-01"], ["2001-03-01", "2001-11-01"],
  ["2007-12-01", "2009-06-01"], ["2020-02-01", "2020-04-01"],
];

function recessionMarkArea(c, opts = {}) {
  const labels = !!opts.labels;
  return {
    silent: true, itemStyle: { color: c.recession },
    label: labels
      ? { show: true, position: "insideTop", distance: 4, color: c.ink3, fontFamily: c.fontMono, fontSize: 9, opacity: .85, formatter: (p) => p.name || "" }
      : { show: false },
    data: RECESSIONS.map(([f, t]) => [{ xAxis: f, name: labels ? "’" + f.slice(2, 4) : "" }, { xAxis: t }]),
  };
}

// Fill style for an area/stacked line. Stacked bands read as flat translucent fills;
// single/overlapping areas fade vertically so the baseline doesn't dominate.
function areaFill(c, color, present, multi) {
  if (present === "stacked" || present === "share") return { color: hexA(color, .72) };
  const top = multi ? .16 : .18;
  return { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1,
    colorStops: [{ offset: 0, color: hexA(color, top) }, { offset: 1, color: hexA(color, .01) }] } };
}

// Subtle max/min dots + labels for a single primary line (research-grade peak/trough markers).
function extremaMarkPoint(c, s) {
  return {
    symbol: "circle", symbolSize: 7, silent: true,
    itemStyle: { color: c.surface, borderWidth: 2 },
    data: [
      { type: "max", name: "peak", itemStyle: { borderColor: c.brand },
        label: { show: true, position: "top", color: c.ink2, fontFamily: c.fontMono, fontSize: 10, fontWeight: 600, formatter: (p) => fmtCtx(p.value, s) } },
      { type: "min", name: "trough", itemStyle: { borderColor: c.ink3 },
        label: { show: true, position: "bottom", color: c.ink3, fontFamily: c.fontMono, fontSize: 10, formatter: (p) => fmtCtx(p.value, s) } },
    ],
  };
}

function baseGrid() { return { left: 14, right: 80, top: 20, bottom: 26, containLabel: true }; }

function baseAxisX(c, freq) {
  return {
    type: "time", boundaryGap: false,
    axisLine: { lineStyle: { color: c.line2 } },
    axisTick: { show: false },
    axisLabel: { color: c.ink3, fontFamily: c.fontMono, fontSize: 11, hideOverlap: true },
    splitLine: { show: false },
  };
}
function baseAxisY(c, name, log) {
  return {
    type: log ? "log" : "value", scale: !log, name, nameLocation: "end", nameGap: 12,
    nameTextStyle: { color: c.ink3, fontSize: 10.5, align: "left", fontFamily: c.fontSans },
    axisLabel: { color: c.ink3, fontFamily: c.fontMono, fontSize: 11 },
    axisLine: { show: false }, axisTick: { show: false },
    splitLine: { lineStyle: { color: c.line, type: [3, 4] } },
  };
}

function tooltip(c, series, freq) {
  const byName = new Map(series.map((s) => [s.name, s]));
  return {
    trigger: "axis",
    backgroundColor: c.surface, borderColor: c.line2, borderWidth: 1,
    padding: [9, 12], textStyle: { color: c.ink, fontFamily: c.fontSans, fontSize: 12.5 },
    extraCssText: "border-radius:10px; box-shadow:0 8px 26px -10px rgba(0,0,0,.25);",
    axisPointer: { type: "line", lineStyle: { color: c.ink3, type: [2, 3] } },
    formatter: (params) => {
      if (!params.length) return "";
      const date = fmtDate(toISO(params[0].axisValue), freq);
      let html = `<div style="font-family:${c.fontMono};font-size:11px;color:${c.ink3};margin-bottom:5px">${date}</div>`;
      for (const p of params) {
        const s = byName.get(p.seriesName) || {};
        const val = p.value && p.value[1] != null ? fmtCtx(p.value[1], s) : "—";
        html += `<div style="display:flex;align-items:center;gap:8px;margin:2px 0">
          <span style="width:9px;height:9px;border-radius:2px;background:${p.color};flex:none"></span>
          <span style="flex:1">${p.seriesName}</span>
          <b style="font-family:${c.fontMono}">${val}</b></div>`;
      }
      return html;
    },
  };
}
function toISO(v) {
  if (typeof v === "string") return v.slice(0, 10);
  const d = new Date(v); return d.toISOString().slice(0, 10);
}

// ---------------- LINE / AREA ----------------
// series: [{ id, name, color, data:[[date,val]], displayUnit, origUnits, area }]
export function lineOption(series, opts = {}) {
  const c = themeColors();
  const freq = opts.freq || "M";
  const multi = series.length > 1;
  const stacked = opts.present === "stacked" || opts.present === "share";
  // With a secondary (right) axis, the end-of-line value labels sit on top of the right-axis
  // ticks — hide them in that case (they read fine on a single-axis chart).
  const dual = series.some((s) => s.axis === "right");
  const ecSeries = series.map((s, i) => {
    const showArea = (s.area || stacked) && !opts.log;
    return {
      name: s.name, type: "line", showSymbol: !!opts.missingMarkers, symbolSize: 4,
      // Never bridge gaps: a null is a real missing observation, not zero. Stacking across a
      // bridged gap would invent a value and mislabel the stack total for that period.
      connectNulls: false, smooth: false, sampling: "lttb",
      stack: s.stack ? "stack-total" : undefined,
      yAxisIndex: s.axis === "right" ? 1 : 0,
      lineStyle: { width: stacked ? 1 : (multi ? 1.7 : 2.1), color: s.color, type: s.dashed ? "dashed" : "solid" },
      itemStyle: { color: s.color },
      areaStyle: showArea ? areaFill(c, s.color, opts.present, multi) : undefined,
      emphasis: { focus: "series" },
      endLabel: (opts.endLabels !== false && !stacked && !dual && series.length <= 3) ? {
        show: true, color: s.color, fontFamily: c.fontMono, fontSize: 11, fontWeight: 600,
        formatter: (p) => p.value[1] == null ? "" : fmtCtx(p.value[1], s),
      } : undefined,
      data: s.data,
      markArea: i === 0 && opts.recession ? recessionMarkArea(c, { labels: true }) : undefined,
      markPoint: (opts.markExtremes && i === 0 && !stacked) ? extremaMarkPoint(c, s) : undefined,
      z: 3 - i,
    };
  });

  // missing-data markers: faint vertical bands over null runs of the primary series.
  // Pushed as a separate silent helper series so it never clobbers the recession bands
  // (which live on ecSeries[0].markArea). Excluded from the legend via legend.data below.
  if (opts.missingMarkers && series[0]) {
    const runs = nullRuns(series[0].data);
    if (runs.length) ecSeries.push({
      name: "Missing data", type: "line", data: [], silent: true, tooltip: { show: false },
      markArea: { silent: true, itemStyle: { color: hexA(c.accent, .10) },
        data: runs.map(([f, t]) => [{ xAxis: f }, { xAxis: t }]) },
    });
  }

  const yAxis = dual
    ? [baseAxisY(c, opts.yName || "", opts.log),
       // Right axis: show a visible spine + ticks so a series moved to the right reads as
       // having its own scale (the reported "no right axis" was an invisible right spine).
       { ...baseAxisY(c, opts.yNameRight || "", opts.log), position: "right", splitLine: { show: false },
         axisLine: { show: true, lineStyle: { color: c.line2 } },
         axisTick: { show: true, length: 4, lineStyle: { color: c.line2 } } }]
    : baseAxisY(c, opts.yName || "", opts.log);
  // 100%-share view pins the axis to 0–100 with percent ticks
  if (!dual && opts.yPct) {
    yAxis.scale = false; yAxis.min = 0; yAxis.max = 100;
    yAxis.axisLabel = { ...yAxis.axisLabel, formatter: (v) => v + "%" };
  }

  const SLIDER_H = 30; // FRED-style timeline brush lives in the bottom margin
  return {
    ...anim(),
    aria: { show: true, label: { enabled: true } },
    color: series.map((s) => s.color),
    // multi-series: extra headroom so the right-aligned legend clears the
    // top-left y-axis unit label (they sit on opposite sides, no overlap).
    grid: { left: 14, right: dual ? 78 : 80, top: multi ? 48 : 22, bottom: SLIDER_H + 30, containLabel: true },
    tooltip: tooltip(c, series, freq),
    // legend.data lists only the real series so the silent recession / missing-data
    // helper series never appear as legend entries.
    legend: multi ? { top: 6, right: 8, icon: "roundRect", itemWidth: 11, itemHeight: 11, itemGap: 14,
      data: series.map((s) => s.name),
      textStyle: { color: c.ink2, fontFamily: c.fontSans, fontSize: 12 }, type: "scroll" } : { show: false },
    xAxis: baseAxisX(c, freq),
    yAxis,
    // Plain mouse-wheel no longer hijacks the page or rockets the zoom; the
    // slider below is the primary range selector (drag the handles or the
    // middle), and you can still drag the chart body to pan.
    dataZoom: [
      { type: "inside", throttle: 60, zoomOnMouseWheel: false, moveOnMouseWheel: false, moveOnMouseMove: true },
      { type: "slider", bottom: 8, height: SLIDER_H, ...sliderStyle(c) },
    ],
    series: ecSeries,
    animationDuration: animMs(420),
  };
}

// theme-aware styling for the bottom timeline brush
function sliderStyle(c) {
  return {
    borderColor: "transparent",
    backgroundColor: hexA(c.ink3, .04),
    fillerColor: hexA(c.brand, .12),
    dataBackground: { lineStyle: { color: c.line2, width: 1, opacity: .9 }, areaStyle: { color: hexA(c.ink3, .10) } },
    selectedDataBackground: { lineStyle: { color: c.brand, width: 1.2 }, areaStyle: { color: hexA(c.brand, .14) } },
    handleStyle: { color: c.surface, borderColor: c.line3, borderWidth: 1, shadowBlur: 5, shadowColor: hexA("#000000", .18) },
    moveHandleStyle: { color: c.line2, opacity: .9 },
    handleSize: "120%",
    textStyle: { color: c.ink3, fontFamily: c.fontMono, fontSize: 10 },
    labelFormatter: (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : String(d.getUTCFullYear()); },
    brushSelect: false,
  };
}

// ---------------- MINI LINE (small multiples) ----------------
// One tiny chart per series: no axes, its own y-scale (compare shapes, not levels),
// a faint recession backdrop, the latest point dotted, and a lightweight hover readout.
export function miniLineOption(s, opts = {}) {
  const c = themeColors();
  const freq = opts.freq || "M";
  return {
    grid: { left: 3, right: 3, top: 8, bottom: 4 },
    tooltip: {
      trigger: "axis", backgroundColor: c.surface, borderColor: c.line2, borderWidth: 1,
      padding: [7, 10], textStyle: { color: c.ink, fontFamily: c.fontSans, fontSize: 12 },
      extraCssText: "border-radius:9px;", confine: true,
      axisPointer: { type: "line", lineStyle: { color: c.ink3, type: [2, 3] } },
      formatter: (ps) => {
        if (!ps.length) return "";
        const p = ps[0];
        const v = p.value && p.value[1] != null ? fmtCtx(p.value[1], s) : "—";
        return `<span style="font-family:${c.fontMono};font-size:10px;color:${c.ink3}">${fmtDate(toISO(p.axisValue), freq)}</span>&nbsp; <b style="font-family:${c.fontMono}">${v}</b>`;
      },
    },
    xAxis: { type: "time", show: false, boundaryGap: false,
      min: opts.xMin != null ? opts.xMin : undefined, max: opts.xMax != null ? opts.xMax : undefined },
    yAxis: { type: "value", scale: true, show: false },
    series: [{
      type: "line", data: s.data, showSymbol: false, smooth: false, sampling: "lttb",
      lineStyle: { width: 1.6, color: s.color },
      areaStyle: areaFill(c, s.color, "single", false),
      markArea: opts.recession ? recessionMarkArea(c) : undefined,
      // peak dot only — no value label (it would overlap the line in a tiny chart)
      markPoint: { symbol: "circle", symbolSize: 5, silent: true, data: [{ type: "max" }],
        label: { show: false }, itemStyle: { color: s.color, borderColor: c.surface, borderWidth: 1 } },
      emphasis: { disabled: true },
    }],
    ...anim(),
    animationDuration: animMs(280),
  };
}

// ---------------- SCATTER (Beveridge) ----------------
// pairs: [{date, x, y}] ordered by date
export function scatterOption(pairs, opts = {}) {
  const c = themeColors();
  // 3rd value dimension = chronological index, so the visualMap can color each point by time.
  const pts = pairs.map((p, i) => ({ value: [p.x, p.y, i], date: p.date, idx: i }));
  const n = pairs.length;
  return {
    ...anim(),
    aria: { show: true, label: { enabled: true } },
    grid: { left: 14, right: 24, top: 24, bottom: 44, containLabel: true },
    tooltip: {
      trigger: "item", backgroundColor: c.surface, borderColor: c.line2, borderWidth: 1,
      padding: [9, 12], textStyle: { color: c.ink, fontFamily: c.fontSans, fontSize: 12.5 },
      extraCssText: "border-radius:10px;",
      formatter: (p) => {
        const d = pairs[p.data.idx];
        return `<div style="font-family:${c.fontMono};font-size:11px;color:${c.ink3};margin-bottom:4px">${fmtDate(d.date, "M")}</div>
          <div>${opts.xName}: <b style="font-family:${c.fontMono}">${d.x.toFixed(1)}%</b></div>
          <div>${opts.yName}: <b style="font-family:${c.fontMono}">${d.y.toFixed(1)}%</b></div>`;
      },
    },
    xAxis: { type: "value", scale: true, name: opts.xName, nameLocation: "middle", nameGap: 28,
      nameTextStyle: { color: c.ink2, fontSize: 12, fontFamily: c.fontSans },
      axisLabel: { color: c.ink3, fontFamily: c.fontMono, fontSize: 11, formatter: "{value}%" },
      axisLine: { lineStyle: { color: c.line2 } }, splitLine: { lineStyle: { color: c.line, type: [3, 4] } } },
    yAxis: { type: "value", scale: true, name: opts.yName, nameLocation: "end", nameGap: 12,
      nameTextStyle: { color: c.ink3, fontSize: 10.5, align: "left" },
      axisLabel: { color: c.ink3, fontFamily: c.fontMono, fontSize: 11, formatter: "{value}%" },
      axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: c.line, type: [3, 4] } } },
    visualMap: {
      show: true, seriesIndex: 1, dimension: 2, min: 0, max: Math.max(1, n - 1), calculable: false,
      orient: "horizontal", left: "center", bottom: 0, itemWidth: 12, itemHeight: 90,
      text: ["recent", pairs.length ? String(+pairs[0].date.slice(0, 4)) : ""],
      textStyle: { color: c.ink3, fontSize: 10, fontFamily: c.fontMono },
      inRange: { color: [hexA(c.brand, .25), c.brand, c.accent] },
    },
    series: [
      { type: "line", data: pts.map((p) => [p.value[0], p.value[1]]), showSymbol: false, smooth: false,
        lineStyle: { color: hexA(c.ink3, .28), width: 1 }, z: 1, silent: true, tooltip: { show: false } },
      { type: "scatter", data: pts, symbolSize: 8,
        itemStyle: { borderColor: c.surface, borderWidth: .5 },
        markPoint: n ? { symbol: "circle", symbolSize: 15, data: [{ coord: pts[n - 1].value.slice(0, 2) }],
          itemStyle: { color: c.accent, borderColor: c.surface, borderWidth: 2 },
          label: { show: true, position: "right", formatter: "now", color: c.accent, fontFamily: c.fontMono, fontSize: 10, fontWeight: 700 } } : undefined,
        z: 2 },
    ],
    animationDuration: 480,
  };
}

// ---------------- BAR / LOLLIPOP (rankings & changes) ----------------
// items: [{name, value, color}] (already sorted)
export function barOption(items, opts = {}) {
  const c = themeColors();
  return {
    aria: { show: true, label: { enabled: true } },
    grid: { left: 14, right: 60, top: 16, bottom: 24, containLabel: true },
    tooltip: { trigger: "item", backgroundColor: c.surface, borderColor: c.line2, borderWidth: 1,
      textStyle: { color: c.ink, fontSize: 12.5 }, extraCssText: "border-radius:10px;",
      formatter: (p) => `${p.name}<br><b style="font-family:${c.fontMono}">${opts.fmt ? opts.fmt(p.value) : p.value}</b>` },
    xAxis: { type: "value", axisLabel: { color: c.ink3, fontFamily: c.fontMono, fontSize: 11, formatter: opts.axisFmt || "{value}" },
      axisLine: { show: false }, splitLine: { lineStyle: { color: c.line, type: [3, 4] } },
      ...(opts.zeroLine ? { axisLine: { show: true, lineStyle: { color: c.line2 } } } : {}) },
    yAxis: { type: "category", data: items.map((i) => i.name), inverse: true,
      axisLabel: { color: c.ink2, fontFamily: c.fontSans, fontSize: 12 },
      axisLine: { lineStyle: { color: c.line2 } }, axisTick: { show: false } },
    series: [{
      type: "bar", barWidth: "52%", data: items.map((i) => ({ value: i.value, itemStyle: { color: i.color, borderRadius: 3 } })),
      label: { show: true, position: opts.zeroLine ? "outside" : "right", color: c.ink2,
        fontFamily: c.fontMono, fontSize: 11, formatter: (p) => opts.fmt ? opts.fmt(p.value) : p.value },
    }],
    ...anim(),
    animationDuration: animMs(460),
  };
}

// ---------------- CHOROPLETH (state map) ----------------
// rows: [{name, value, change}] — `name` must match the registered GeoJSON feature names
// (full state names; see geoName()). The "usa-states" map must be registered before use.
export function mapOption(rows, opts = {}) {
  const c = themeColors();
  const units = opts.units || "Percent";
  const label = opts.label || "";
  const priorLabel = opts.freq === "Q" ? "vs prior quarter" : opts.freq === "A" ? "vs prior year" : "vs prior month";
  const vals = rows.map((r) => r.value).filter((v) => Number.isFinite(v));
  const min = vals.length ? Math.min(...vals) : 0;
  let max = vals.length ? Math.max(...vals) : 1;
  if (max <= min) max = min + 1;
  return {
    ...anim(),
    aria: { show: true, label: { enabled: true } },
    tooltip: {
      trigger: "item", backgroundColor: c.surface, borderColor: c.line2, borderWidth: 1,
      padding: [9, 12], textStyle: { color: c.ink, fontFamily: c.fontSans, fontSize: 12.5 },
      extraCssText: "border-radius:10px;",
      formatter: (p) => {
        const d = p.data;
        if (!d || !Number.isFinite(d.value)) return `<b>${p.name}</b><br><span style="color:${c.ink3}">no data</span>`;
        const chg = Number.isFinite(d.change)
          ? `<div style="color:${d.change > 0 ? c.neg : d.change < 0 ? c.pos : c.ink3};font-family:${c.fontMono};font-size:11px;margin-top:2px">${fmtMapChange(d.change, units)} ${priorLabel}</div>`
          : "";
        return `<div style="font-weight:600;margin-bottom:3px">${p.name}</div>
          <div><b style="font-family:${c.fontMono};font-size:15px">${fmtMapValue(d.value, units)}</b>${label ? ` <span style="color:${c.ink3}">${label}</span>` : ""}</div>${chg}`;
      },
    },
    visualMap: {
      type: "continuous", min, max, calculable: true,
      left: 8, top: "center", itemWidth: 12, itemHeight: 130,
      text: ["higher", "lower"], textStyle: { color: c.ink3, fontFamily: c.fontMono, fontSize: 10 },
      inRange: { color: mapRamp() },
      formatter: (v) => fmtMapCompact(v, units),
    },
    series: [{
      type: "map", map: "usa-states", roam: false,
      layoutCenter: ["50%", "50%"], layoutSize: "112%",
      data: rows.map((r) => ({ name: r.name, value: r.value, change: r.change })),
      itemStyle: { borderColor: c.surface, borderWidth: .6, areaColor: hexA(c.ink3, .08) },
      emphasis: { label: { show: false }, itemStyle: { areaColor: c.brand, borderColor: c.surface } },
      select: { disabled: true },
      label: { show: false },
    }],
    animationDuration: animMs(300),
  };
}

// Choropleth with a time scrubber. frames: [{date, label, data:[{name,value,change}]}] oldest→newest.
// Color scale is fixed across all frames so months are visually comparable.
export function mapTimelineOption(frames, opts = {}) {
  const c = themeColors();
  const units = opts.units || "Percent";
  const freq = opts.freq || "M";
  const label = opts.label || "";
  const priorLabel = freq === "Q" ? "vs prior quarter" : freq === "A" ? "vs prior year" : "vs prior month";
  const n = frames.length;
  // Per-frame color scale: each month is scaled to its own min/max spread (not a global range),
  // so within-month variation reads clearly. The legend bounds update as you scrub.
  const stats = frames.map((f) => {
    let mn = Infinity, mx = -Infinity;
    for (const d of f.data) if (Number.isFinite(d.value)) { mn = Math.min(mn, d.value); mx = Math.max(mx, d.value); }
    if (!Number.isFinite(mn)) { mn = 0; mx = 1; }
    return { min: mn, max: mx <= mn ? mn + 1 : mx };  // raw bounds: keep spread for small-range metrics
  });
  const init = stats[n - 1] || { min: 0, max: 1 };
  // aim for ~9 axis labels regardless of series length (monthly LAUS can be 300+ frames)
  const labelEvery = opts.labelInterval ?? Math.max(5, Math.ceil(n / 9));
  return {
    baseOption: {
      timeline: {
        // styled as a continuous scrubber/slider (no per-frame dots): a rounded rail, a filled
        // "elapsed" portion, a prominent draggable handle, and sparse year/quarter tick labels.
        axisType: "category", data: frames.map((f) => f.label), currentIndex: n - 1,
        autoPlay: false, playInterval: 600, loop: false, left: 58, right: 26, bottom: 12, height: 40,
        symbol: "none",
        lineStyle: { color: c.line2, width: 6, cap: "round" },
        progress: { lineStyle: { color: hexA(c.brand, .85), width: 6, cap: "round" } },
        checkpointStyle: { color: c.brand, borderColor: c.surface, borderWidth: 3, size: 18, animation: true, animationDuration: 220 },
        controlStyle: { color: c.ink2, borderColor: c.ink2, itemSize: 17, showPlayBtn: true, showPrevBtn: true, showNextBtn: true },
        label: { color: c.ink3, fontFamily: c.fontMono, fontSize: 10.5, interval: labelEvery, align: "center" },
        emphasis: { label: { color: c.ink }, checkpointStyle: { borderColor: c.brand }, controlStyle: { color: c.brand, borderColor: c.brand } },
      },
      tooltip: {
        trigger: "item", backgroundColor: c.surface, borderColor: c.line2, borderWidth: 1,
        padding: [9, 12], textStyle: { color: c.ink, fontFamily: c.fontSans, fontSize: 12.5 },
        extraCssText: "border-radius:10px;",
        formatter: (p) => {
          const d = p.data;
          if (!d || !Number.isFinite(d.value)) return `<b>${p.name}</b><br><span style="color:${c.ink3}">no data</span>`;
          const chg = Number.isFinite(d.change)
            ? `<div style="color:${d.change > 0 ? c.neg : d.change < 0 ? c.pos : c.ink3};font-family:${c.fontMono};font-size:11px;margin-top:2px">${fmtMapChange(d.change, units)} ${priorLabel}</div>`
            : "";
          return `<div style="font-weight:600;margin-bottom:3px">${p.name}</div>
            <div><b style="font-family:${c.fontMono};font-size:15px">${fmtMapValue(d.value, units)}</b>${label ? ` <span style="color:${c.ink3}">${label}</span>` : ""}</div>${chg}`;
        },
      },
      visualMap: {
        type: "continuous", min: init.min, max: init.max, calculable: true,
        left: 8, top: "center", itemWidth: 12, itemHeight: 140,
        text: ["higher", "lower"], textStyle: { color: c.ink3, fontFamily: c.fontMono, fontSize: 10 },
        inRange: { color: mapRamp() },
        formatter: (v) => fmtMapCompact(v, units),
      },
      series: [{
        type: "map", map: "usa-states", roam: false,
        layoutCenter: ["50%", "47%"], layoutSize: "110%",
        itemStyle: { borderColor: c.surface, borderWidth: .6, areaColor: hexA(c.ink3, .08) },
        emphasis: { label: { show: false }, itemStyle: { areaColor: c.brand, borderColor: c.surface } },
        select: { disabled: true }, label: { show: false },
        data: n ? frames[n - 1].data : [],
      }],
    },
    options: frames.map((f, i) => ({ visualMap: [{ min: stats[i].min, max: stats[i].max }], series: [{ data: f.data }] })),
  };
}

// Heatmap of the whole state panel: states (rows, sorted by latest value) × periods (cols).
// frames: [{date, label, data:[{name,value}]}] oldest→newest.
export function heatmapOption(frames, opts = {}) {
  const c = themeColors();
  const units = opts.units || "Percent";
  const last = frames[frames.length - 1] || { data: [] };
  const lastVal = new Map(last.data.map((d) => [d.name, d.value]));
  const states = [...new Set(frames.flatMap((f) => f.data.map((d) => d.name)))]
    .sort((a, b) => (lastVal.get(b) ?? -Infinity) - (lastVal.get(a) ?? -Infinity));
  const sIdx = new Map(states.map((s, i) => [s, i]));
  const periods = frames.map((f) => f.label);
  const cells = []; let mn = Infinity, mx = -Infinity;
  frames.forEach((f, ci) => { for (const d of f.data) { if (!Number.isFinite(d.value)) continue; cells.push([ci, sIdx.get(d.name), d.value]); mn = Math.min(mn, d.value); mx = Math.max(mx, d.value); } });
  if (!Number.isFinite(mn)) { mn = 0; mx = 1; }
  return {
    ...anim(),
    aria: { show: true, label: { enabled: true } },
    grid: { left: 96, right: 70, top: 14, bottom: 34 },
    tooltip: {
      backgroundColor: c.surface, borderColor: c.line2, borderWidth: 1, padding: [9, 12],
      textStyle: { color: c.ink, fontFamily: c.fontSans, fontSize: 12.5 }, extraCssText: "border-radius:10px;",
      formatter: (p) => `<div style="font-weight:600">${states[p.value[1]]}</div>
        <div style="font-family:${c.fontMono};font-size:11px;color:${c.ink3};margin:2px 0">${periods[p.value[0]]}</div>
        <b style="font-family:${c.fontMono};font-size:14px">${fmtMapValue(p.value[2], units)}</b>`,
    },
    xAxis: { type: "category", data: periods, splitArea: { show: false },
      axisLine: { lineStyle: { color: c.line2 } }, axisTick: { show: false },
      axisLabel: { color: c.ink3, fontFamily: c.fontMono, fontSize: 10, interval: Math.max(1, Math.ceil(periods.length / 9)) } },
    yAxis: { type: "category", data: states, inverse: true, splitArea: { show: false },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: c.ink2, fontFamily: c.fontSans, fontSize: 9.5 } },
    visualMap: { min: mn, max: mx, calculable: true, orient: "vertical", right: 14, top: "middle",
      itemWidth: 12, itemHeight: 150, text: ["higher", "lower"],
      textStyle: { color: c.ink3, fontFamily: c.fontMono, fontSize: 10 },
      inRange: { color: mapRamp() }, formatter: (v) => fmtMapCompact(v, units) },
    series: [{ type: "heatmap", data: cells, progressive: 4000,
      itemStyle: { borderWidth: 0 }, emphasis: { itemStyle: { borderColor: c.ink, borderWidth: 1 } } }],
    animationDuration: animMs(360),
  };
}

// Distribution across states over time: a boxplot per period (min / Q1 / median / Q3 / max).
export function distributionOption(frames, opts = {}) {
  const c = themeColors();
  const units = opts.units || "Percent";
  const q = (v, p) => { if (!v.length) return null; const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
  const periods = frames.map((f) => f.label);
  const boxes = frames.map((f) => { const v = f.data.map((d) => d.value).filter(Number.isFinite).sort((a, b) => a - b); return v.length ? [v[0], q(v, .25), q(v, .5), q(v, .75), v[v.length - 1]] : [null, null, null, null, null]; });
  return {
    ...anim(),
    aria: { show: true, label: { enabled: true } },
    grid: { left: 60, right: 20, top: 16, bottom: 50, containLabel: true },
    tooltip: { trigger: "item", backgroundColor: c.surface, borderColor: c.line2, borderWidth: 1, padding: [9, 12],
      textStyle: { color: c.ink, fontFamily: c.fontSans, fontSize: 12.5 }, extraCssText: "border-radius:10px;",
      formatter: (p) => { const v = p.value; if (!v || v[1] == null) return periods[p.dataIndex] + "<br>no data";
        const f = (x) => fmtMapValue(x, units);
        return `<div style="font-family:${c.fontMono};font-size:11px;color:${c.ink3};margin-bottom:4px">${periods[p.dataIndex]}</div>
          <div>max <b style="font-family:${c.fontMono}">${f(v[5])}</b></div>
          <div>Q3 <b style="font-family:${c.fontMono}">${f(v[4])}</b></div>
          <div>median <b style="font-family:${c.fontMono}">${f(v[3])}</b></div>
          <div>Q1 <b style="font-family:${c.fontMono}">${f(v[2])}</b></div>
          <div>min <b style="font-family:${c.fontMono}">${f(v[1])}</b></div>`; } },
    xAxis: { type: "category", data: periods, boundaryGap: true,
      axisLine: { lineStyle: { color: c.line2 } }, axisTick: { show: false },
      axisLabel: { color: c.ink3, fontFamily: c.fontMono, fontSize: 10, interval: Math.max(1, Math.ceil(periods.length / 9)) } },
    yAxis: { type: "value", scale: true, name: units, nameTextStyle: { color: c.ink3, fontSize: 10.5, align: "left" },
      axisLabel: { color: c.ink3, fontFamily: c.fontMono, fontSize: 11, formatter: (v) => fmtMapCompact(v, units) },
      axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: c.line, type: [3, 4] } } },
    series: [{ type: "boxplot", data: boxes,
      itemStyle: { color: hexA(c.brand, .18), borderColor: c.brand, borderWidth: 1.2 },
      emphasis: { itemStyle: { color: hexA(c.brand, .32), borderColor: c.brand } } }],
    animationDuration: animMs(360),
  };
}

// Sequential choropleth ramp (low → high). Cool green→blue family, theme-aware.
// Avoids the red/amber "alert" reading and works for any metric, not just unemployment.
function mapRamp() {
  return document.documentElement.getAttribute("data-theme") === "terminal"
    ? ["#14403A", "#1E6E62", "#2E9C8C", "#5FC8B3", "#A6ECD9"]   // dark teal → bright mint
    : ["#E8F2DC", "#A9DBB0", "#5FC2BE", "#2E8FBE", "#0F63A6"];  // pale green → deep blue
}

function hexA(hex, a) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
