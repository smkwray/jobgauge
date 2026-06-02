// exporters.js — first-class exports. Every artifact carries full provenance:
// source owner, provider, release, series id, units, frequency, SA, geography,
// latest observation date, generated timestamp, and export profile.

import { fmtDate, PROVIDER_LABEL, FREQ_LABEL, geoName } from "./format.js";
import { store } from "./store.js";
import { transformUnit, transformVerb } from "./transforms.js";

function provenanceRow(m, viewObs) {
  const src = store.sourceById.get(m.source_id) || {};
  const last = viewObs && viewObs.length ? viewObs[viewObs.length - 1] : null;
  return {
    indicator_id: m.id, title: m.title, series_id: m.series_id,
    provider: m.provider, access_layer: m.mirror ? "FRED mirror" : (PROVIDER_LABEL[m.provider] || m.provider),
    source_owner: src.owner || m.source_title || "", release: m.release,
    units: m.units, frequency: m.frequency, seasonal_adjustment: m.seasonal_adjustment,
    geography: geoName(m.geography), latest_observation: last ? last[0] : "",
  };
}

function ctx() {
  return { generated_at: store.manifest.generated_at, export_profile: store.manifest.profile,
           schema_version: store.manifest.schema_version, tool: "jobgauge" };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function slug(s) { return s.map((x) => x).join("_").slice(0, 60).replace(/[^a-z0-9_]+/gi, "_"); }

// view = { transform, range, chartType }; series = [{ meta, viewObs:[[date,raw,view]] }]
export function exportCSV(series, view) {
  const c = ctx();
  const lines = [];
  lines.push(`# jobgauge view export`);
  lines.push(`# generated_at: ${c.generated_at}   export_profile: ${c.export_profile}   schema_version: ${c.schema_version}`);
  lines.push(`# transform: ${view.transform} (${transformVerb(view.transform) || "level"})   range: ${view.range}   chart: ${view.chartType}   presentation: ${view.present || "line"}`);
  for (const s of series) {
    const p = provenanceRow(s.meta, s.viewObs);
    lines.push(`# series ${p.indicator_id} | ${p.title} | series_id=${p.series_id} | ${p.access_layer} | owner=${p.source_owner} | release=${p.release} | units=${p.units} | ${FREQ_LABEL[p.frequency] || p.frequency} | ${p.seasonal_adjustment} | geo=${p.geography} | latest=${p.latest_observation}`);
  }
  const cols = ["date", "indicator_id", "title", "series_id", "value_raw", "value_view", "transform",
    "units", "frequency", "seasonal_adjustment", "provider", "access_layer", "source_owner",
    "release", "geography", "generated_at", "export_profile"];
  lines.push(cols.join(","));
  for (const s of series) {
    const m = s.meta;
    const acc = m.mirror ? "FRED mirror" : (PROVIDER_LABEL[m.provider] || m.provider);
    for (const [date, raw, view_v] of s.viewObs) {
      const row = [date, m.id, q(m.title), m.series_id, fmtNum(raw), fmtNum(view_v), view.transform,
        q(m.units), m.frequency, m.seasonal_adjustment, m.provider, q(acc), q((store.sourceById.get(m.source_id) || {}).owner || ""),
        q(m.release), q(geoName(m.geography)), c.generated_at, c.export_profile];
      lines.push(row.join(","));
    }
  }
  triggerDownload(new Blob([lines.join("\n")], { type: "text/csv" }), `jobgauge_${slug(series.map((s) => s.meta.id))}_${view.transform}.csv`);
}

export function exportJSON(series, view) {
  const c = ctx();
  const payload = {
    schema: "jobgauge-view-export/0.1", ...c,
    chart_state: { transform: view.transform, transform_label: transformVerb(view.transform) || "level",
      range: view.range, chart_type: view.chartType, presentation: view.present || "line",
      recession_bands: view.rec, log_scale: view.log },
    series: series.map((s) => ({
      ...provenanceRow(s.meta, s.viewObs),
      group: s.meta.group, priority: s.meta.priority, tags: s.meta.tags,
      view_units: transformUnit(view.transform, s.meta.units),
      observations: s.viewObs.map(([date, raw, view_v]) => ({ date, value: nz(raw), view_value: nz(view_v) })),
    })),
  };
  triggerDownload(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `jobgauge_${slug(series.map((s) => s.meta.id))}_${view.transform}.json`);
}

// PNG: composite chart image with a research-grade title/source/date footer.
// Renders the (cleaned) option in an off-screen instance so the export reflects exactly the
// option we hand it — e.g. with the range slider stripped — rather than the on-screen chrome.
export function exportPNG(option, info) {
  const tmp = document.createElement("div");
  tmp.style.cssText = "position:absolute;left:-99999px;top:0;width:1000px;height:520px";
  document.body.appendChild(tmp);
  const ec = window.echarts.init(tmp, null, { renderer: "canvas", width: 1000, height: 520 });
  ec.setOption(option);
  const base = ec.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: getVar("--surface") });
  ec.dispose(); tmp.remove();
  const img = new Image();
  img.onload = () => {
    const pad = 28 * 2, headH = 96, footH = 78;
    const cv = document.createElement("canvas");
    cv.width = img.width + pad * 0; // image already at 2x; keep its width
    cv.width = img.width; cv.height = img.height + headH + footH;
    const g = cv.getContext("2d");
    g.fillStyle = getVar("--surface"); g.fillRect(0, 0, cv.width, cv.height);
    const ink = getVar("--ink"), ink2 = getVar("--ink-2"), ink3 = getVar("--ink-3"), brand = getVar("--brand");
    g.textBaseline = "top";
    g.fillStyle = brand; g.font = "600 22px 'IBM Plex Mono', monospace"; g.fillText("jobgauge", 36, 26);
    g.fillStyle = ink; g.font = "500 30px 'Fraunces', Georgia, serif"; g.fillText(clip(info.title, 64), 36, 52);
    g.drawImage(img, 0, headH);
    const fy = headH + img.height + 16;
    g.fillStyle = ink2; g.font = "13px 'IBM Plex Sans', sans-serif"; g.fillText(clip(info.source, 120), 36, fy);
    g.fillStyle = ink3; g.font = "12px 'IBM Plex Mono', monospace";
    g.fillText(`Latest: ${info.latest}   ·   Generated: ${info.generated}   ·   Profile: ${info.profile}`, 36, fy + 22);
    triggerDownload(dataURLtoBlob(cv.toDataURL("image/png")), `jobgauge_${slug([info.id || "chart"])}.png`);
  };
  img.src = base;
}

// SVG: render the same option through a temporary SVG-renderer instance.
export function exportSVG(option, info) {
  const tmp = document.createElement("div");
  tmp.style.cssText = "position:absolute;left:-99999px;width:1000px;height:520px";
  document.body.appendChild(tmp);
  const ec = window.echarts.init(tmp, null, { renderer: "svg", width: 1000, height: 520 });
  ec.setOption(option);
  let svg = typeof ec.renderToSVGString === "function" ? ec.renderToSVGString() : decodeURIComponent(ec.getDataURL({ type: "svg" }).split(",")[1]);
  // inject footer
  const footer = `<text x="20" y="498" font-family="IBM Plex Sans" font-size="12" fill="${getVar("--ink-2")}">${escapeXml(clip(info.source,110))}</text>
<text x="20" y="514" font-family="IBM Plex Mono" font-size="11" fill="${getVar("--ink-3")}">Latest ${info.latest} · Generated ${info.generated} · ${info.profile} · jobgauge</text>`;
  svg = svg.replace("</svg>", footer + "</svg>");
  ec.dispose(); tmp.remove();
  triggerDownload(new Blob([svg], { type: "image/svg+xml" }), `jobgauge_${slug([info.id || "chart"])}.svg`);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

// helpers
function q(s) { s = String(s ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function fmtNum(v) { return v === null || v === undefined || Number.isNaN(v) ? "" : v; }
function nz(v) { return v === undefined || Number.isNaN(v) ? null : v; }
function getVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function clip(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function escapeXml(s) { return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
function dataURLtoBlob(u) { const [h, d] = u.split(","); const m = h.match(/:(.*?);/)[1]; const b = atob(d); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return new Blob([a], { type: m }); }
