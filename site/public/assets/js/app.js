// app.js — jobgauge application shell, views, command palette, workspace, exports.

import { store, boot, isAvailable, latestRow, latestRows, loadSeries, meta } from "./store.js";
import { fmtValue, fmtDelta, fmtDate, fmtTimestamp, unitShort, geoName,
         PROVIDER_LABEL, FREQ_LABEL, SA_LABEL, seriesPalette, fmtMapValue, fmtMapChange } from "./format.js";
import { TRANSFORMS, filterRange, applyTransform, transformAvailability, transformUnit, transformVerb,
         rollingLabel, alignByDate, COMBINE_OPS, combineSeries, combineLabel, compileFormula } from "./transforms.js";
import { lineOption, scatterOption, barOption, mapOption, heatmapOption, distributionOption, miniLineOption } from "./charts.js";
import { searchAll, PRESETS, presetById, THEMES, highlight } from "./search.js";
import { parseState, syncURL, encodeState } from "./router.js";
import { exportCSV, exportJSON, exportPNG, exportSVG, copyText } from "./exporters.js";

let state = parseState();
let chart = null;            // active ECharts instance
let lastView = null;         // cached {series, freq, special, option} for exports
let paletteSel = 0, paletteItems = [];
let paletteMode = "default";  // "add" = launched from the compare tray: every pick adds to the chart
let usaMapPromise = null;     // lazy one-time registration of the US states GeoJSON for the choropleth
let multiCharts = [];         // ECharts instances for the small-multiples grid (disposed on re-render)
let focusChart = null;        // ECharts instance inside the focus/fullscreen overlay
let focusMulti = [];          // small-multiples instances when the overlay shows a multiples view
let focusOpen = false;
let renderSeq = 0;            // monotonic token; a workspace render that finds itself stale bails
const DERIVED_ID = "__derived";  // synthetic id for a user-built formula series (e.g. a − b)

// Fetch + register the US states boundaries once; ECharts needs registerMap before a map series renders.
function ensureUsaMap() {
  if (usaMapPromise) return usaMapPromise;
  usaMapPromise = fetch("assets/geo/usa-states.json")
    .then((r) => { if (!r.ok) throw new Error("map data " + r.status); return r.json(); })
    .then((geo) => { window.echarts.registerMap("usa-states", geo); return true; })
    .catch((e) => { usaMapPromise = null; throw e; });
  return usaMapPromise;
}
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const HEADLINE = [
  { id: "unemployment_rate", pol: "up_bad" },
  { id: "total_nonfarm_payrolls", pol: "up_good", deltaField: "change_1" },
  { id: "job_openings_rate", pol: "up_good" },
  { id: "quits_rate", pol: "neutral" },
  { id: "initial_claims_sa", pol: "up_bad", deltaField: "change_1" },
  { id: "prime_age_employment_population_ratio", pol: "up_good" },
];

// ---------------------------------------------------------------- boot
(async function init() {
  try { await boot(); } catch (e) {
    $("#main").innerHTML = `<div class="empty"><div class="empty__big">Could not load the data record.</div><div>${e.message}</div></div>`;
    return;
  }
  $("#app").removeAttribute("data-booting");
  // freshness + rail stats
  $("#profileLabel").textContent = store.manifest.profile;
  $("#freshnessWhen").textContent = "updated " + fmtDate(store.manifest.generated_at.slice(0, 10), "W");
  $("#freshnessBadge").title = `Export profile: ${store.manifest.profile} · Generated ${fmtTimestamp(store.manifest.generated_at)}`;
  $("#railAvail").textContent = store.manifest.available_indicator_ids.length;
  $("#railCat").textContent = store.catalog.indicators.length;

  initTheme();
  wireGlobal();
  if (!state.ids.length && !state.preset && state.view === "overview") applyPresetState("labor_market_now");
  navigate(state.view, true);
})();

// ---------------------------------------------------------------- theme
function initTheme() {
  const saved = localStorage.getItem("jg-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  $("#themeToggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "paper" ? "terminal" : "paper";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("jg-theme", next);
    if (state.view === "map") renderStateMapView($("#main")); // recolor the choropleth
    else if (chart || multiCharts.length) renderWorkspace(); // recolor the workspace chart / small multiples
  });
}

// ---------------------------------------------------------------- global wiring
function wireGlobal() {
  $("#searchTrigger").addEventListener("click", openPalette);
  $("#shareBtn").addEventListener("click", () => openSheet());
  $("#focusExport")?.addEventListener("click", () => openSheet());
  document.addEventListener("keydown", (e) => {
    trapTab(e);  // keep Tab inside the top-most open overlay
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
    else if (e.key === "/" && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openPalette(); }
    // Shift+F (not bare "f") opens focus mode — a bare single-character shortcut hijacks
    // speech-to-text and assistive input (WCAG 2.1.4 Character Key Shortcuts).
    else if (e.shiftKey && e.key.toLowerCase() === "f" && !focusOpen && $("#palette").hidden && $("#exportSheet").hidden
             && !/input|textarea|select/i.test(document.activeElement.tagName) && lastView?.ids?.length
             && (state.view === "overview" || state.view === "explore")) { e.preventDefault(); openFocus(); }
    else if (e.key === "Escape") {
      if (!$("#exportSheet").hidden) closeSheet();
      else if (!$("#palette").hidden) closePalette();
      else if (focusOpen) closeFocus();
    }
  });
  // SPA nav (rail + brand + any [data-nav])
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { e.preventDefault(); navigate(nav.dataset.nav); }
    if (e.target.closest("[data-close-palette]")) closePalette();
    if (e.target.closest("[data-close-sheet]")) closeSheet();
    if (e.target.closest("[data-close-focus]")) closeFocus();
  });
  window.addEventListener("resize", () => {
    if (chart) chart.resize();
    multiCharts.forEach((c) => c.resize());
    if (focusChart) focusChart.resize();
    focusMulti.forEach((c) => c.resize());
  });
  // palette input + keys
  const pin = $("#paletteInput");
  pin.addEventListener("input", () => renderPaletteResults(pin.value));
  pin.addEventListener("keydown", paletteKeys);
}

// ---------------------------------------------------------------- visualization teardown
// Dispose every live chart instance and stop the map play timer BEFORE the DOM that hosts
// them is replaced. Without this, navigating to About/Themes (which rewrite #main) leaves
// the resize handler calling .resize() on an instance whose container is gone, and a
// playing map keeps a setInterval closure firing against a stale `chart`.
function clearMapTimer() { if (mapPlayTimer) { clearInterval(mapPlayTimer); mapPlayTimer = null; } }
function disposeWorkspaceCharts() {
  disposeMulti();
  if (chart) { try { chart.dispose(); } catch (e) {} chart = null; }
}
function cleanupVisualizations() { clearMapTimer(); disposeWorkspaceCharts(); }

// ---------------------------------------------------------------- navigation
function navigate(view, initial) {
  if (focusOpen) closeFocus();
  cleanupVisualizations();
  renderSeq++;            // invalidate any in-flight workspace render from the view we're leaving
  state.view = view;
  if (!initial) syncURL(state);
  $$(".rail__item").forEach((it) => it.classList.toggle("is-active", it.dataset.nav === view));
  const main = $("#main");
  if (view === "explore") renderExplore(main);
  else if (view === "map") renderStateMapView(main);
  else if (view === "themes") renderThemes(main);
  else if (view === "about") renderAbout(main);
  else renderOverview(main);
  main.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

// ============================================================ OVERVIEW
function renderOverview(main) {
  const ur = latestRow("unemployment_rate"), urm = meta("unemployment_rate");
  const aside = ur ? `
          <div class="hero__aside">
            <div class="eyebrow">Latest release</div>
            <div class="hero__askv"><b>${esc(urm.release || "Employment Situation")}</b></div>
            <div class="hero__askv">${esc(fmtDate(ur.date, urm.frequency))} · <b>${fmtValue(ur.value, urm.units)}${unitShort(urm.units) || ""}</b> jobless rate</div>
          </div>` : "";
  main.innerHTML = `
    <section class="view">
      <div class="stagger">
        <div class="hero">
          <div class="hero__lead">
            <div class="eyebrow">U.S. labor market · ${esc(store.manifest.profile)} export</div>
            <h1 class="hero__title">The labor market, at a glance</h1>
            <p class="hero__sub">A calm, research-grade read on jobs, slack, wages, and who’s working — search anything, chart it, compare it, and export it with full provenance.</p>
          </div>${aside}
        </div>
        <div class="chips" id="chips"></div>
        <div class="cards" id="cards"></div>
        <div id="workspaceMount"></div>
      </div>
    </section>`;
  renderChips();
  renderCards();
  renderWorkspace();
}

function renderChips() {
  const wrap = $("#chips"); if (!wrap) return;
  const builtin = PRESETS.filter((p) => p.chip).map((p) =>
    `<button class="chip ${state.preset === p.id ? "is-active" : ""}" data-preset="${p.id}">
       <span class="chip__dot"></span>${p.label}</button>`).join("");
  const user = getUserPresets();
  const userChips = user.length
    ? `<span class="chips__div"></span><span class="chips__lbl">Yours</span>` + user.map((p) =>
      `<button class="chip chip--user" data-userpreset="${p.id}" title="Your saved preset">
         <span class="chip__dot"></span>${esc(p.name)}<span class="chip__rm" data-delpreset="${p.id}" title="Delete preset">✕</span></button>`).join("")
    : "";
  wrap.innerHTML = builtin + userChips;
  $$("[data-preset]", wrap).forEach((b) => b.addEventListener("click", () => {
    applyPresetState(b.dataset.preset); syncURL(state); refreshChipsActive(); renderWorkspace();
  }));
  $$("[data-userpreset]", wrap).forEach((b) => b.addEventListener("click", (e) => {
    const del = e.target.closest("[data-delpreset]");
    if (del) { e.stopPropagation(); deleteUserPreset(del.dataset.delpreset); return; }
    applyUserPreset(b.dataset.userpreset);
  }));
}
function refreshChipsActive() {
  $$("#chips .chip").forEach((c) => c.classList.toggle("is-active", c.dataset.preset === state.preset));
  $$("#cards .card").forEach((c) => c.classList.toggle("is-selected", state.ids.length === 1 && c.dataset.id === state.ids[0]));
}

async function renderCards() {
  const wrap = $("#cards"); if (!wrap) return;
  wrap.innerHTML = HEADLINE.map((h) => {
    const m = meta(h.id), row = latestRow(h.id);
    return `<button class="card ${state.ids.length === 1 && state.ids[0] === h.id ? "is-selected" : ""}" data-id="${h.id}" data-pol="${h.pol}">
      <div class="card__top">
        <span class="card__label">${m.short_title}</span>
        ${m.mirror ? `<span class="card__mirror" title="Same numbers as the official release — shown via FRED">FRED</span>` : ""}
      </div>
      <div class="card__value">${row ? fmtValue(row.value, m.units, { compact: true }) : "—"}<span class="card__unit">${unitShort(m.units) || ""}</span></div>
      <div class="card__delta" data-delta></div>
      <div class="card__spark skel" data-spark style="height:40px"></div>
      <div class="card__date" data-date></div>
    </button>`;
  }).join("");

  $$("#cards .card").forEach((c) => c.addEventListener("click", () => {
    state.ids = [c.dataset.id]; state.preset = null; state.special = null; state.chart = "line"; state.transform = "level";
    state.present = "line"; state.axes = {}; state.combine = null;
    syncURL(state); refreshChipsActive(); renderWorkspace();
    $("#workspaceMount")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));

  for (const h of HEADLINE) {
    const card = $(`#cards .card[data-id="${h.id}"]`); if (!card) continue;
    const m = meta(h.id), row = latestRow(h.id);
    const series = await loadSeries(h.id);
    const obs = series ? series.observations : [];
    // delta
    const dEl = card.querySelector("[data-delta]");
    const df = h.deltaField || "change_1";
    const dv = row ? row[df] : null;
    const cls = dv == null ? "delta-flat" : (dv > 0 ? "delta-up" : dv < 0 ? "delta-down" : "delta-flat");
    const good = h.pol === "up_good" ? (dv > 0) : h.pol === "up_bad" ? (dv < 0) : null;
    const semClass = good === true ? "delta-up" : good === false ? "delta-down" : (dv > 0 ? "delta-up" : dv < 0 ? "delta-down" : "delta-flat");
    const arrow = dv == null ? "" : dv > 0 ? "▲" : dv < 0 ? "▼" : "•";
    dEl.className = "card__delta " + (h.pol === "neutral" ? "delta-flat" : semClass);
    dEl.innerHTML = `${arrow} ${fmtDelta(dv, m.units)}<span class="card__deltalbl">MoM</span>`;
    // sparkline
    const sp = card.querySelector("[data-spark]");
    sp.classList.remove("skel");
    const tail = obs.slice(-72).map((o) => o.value);
    sp.innerHTML = sparkSVG(tail, good === false ? "var(--neg)" : "var(--brand)");
    card.querySelector("[data-date]").textContent = row ? fmtDate(row.date, m.frequency) : "—";
  }
}

function sparkSVG(values, color) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x));
  if (v.length < 2) return "";
  const w = 200, h = 40, pad = 3;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((val, i) => {
    const x = pad + (i / (v.length - 1)) * (w - pad * 2);
    const y = h - pad - ((val - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = d + ` L${pts[pts.length - 1][0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <path d="${area}" fill="${color}" opacity="0.08"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="2.4" fill="${color}"/>
  </svg>`;
}

// ============================================================ WORKSPACE
function applyPresetState(id) {
  const p = presetById.get(id); if (!p) return;
  state.preset = id; state.ids = [...p.ids]; state.transform = p.transform || "level";
  state.range = p.range || "10y"; state.chart = p.chartType || "line";
  state.rec = true; state.log = false; state.miss = false;
  state.special = p.special || null;
  state.present = p.present || "line";
  state.axes = {}; state.combine = p.combine ? { ...p.combine } : null;
}

// ---- user presets (browser localStorage; per-origin — persists on GitHub Pages,
//      separate store when the project is downloaded and run on localhost) ----
const UKEY = "jg-user-presets";
function getUserPresets() { try { return JSON.parse(localStorage.getItem(UKEY) || "[]"); } catch (e) { return []; } }
function setUserPresets(a) { try { localStorage.setItem(UKEY, JSON.stringify(a)); } catch (e) { toast("Browser storage unavailable"); } }
function currentSpecial() { return state.preset ? (presetById.get(state.preset)?.special || null) : (state.special || null); }
function saveCurrentAsPreset() {
  const ids = state.ids.length ? state.ids : (state.preset ? presetById.get(state.preset).ids : []);
  if (!ids.length) { toast("Open a chart first"); return; }
  const suggested = ids.map((i) => meta(i).short_title).join(" vs ").slice(0, 44);
  const name = (window.prompt("Name this preset (saved in your browser):", suggested) || "").trim();
  if (!name) return;
  const arr = getUserPresets();
  arr.push({ id: "user_" + Date.now().toString(36), name, ids: [...ids],
    transform: state.transform, range: state.range, chart: state.chart, special: currentSpecial(),
    present: state.present, axes: { ...state.axes }, combine: state.combine });
  setUserPresets(arr);
  toast(`Saved “${name}” — find it on Overview`);
  if ($("#chips")) renderChips();
}
function applyUserPreset(id) {
  const p = getUserPresets().find((x) => x.id === id); if (!p) return;
  state.ids = [...p.ids]; state.transform = p.transform; state.range = p.range;
  state.chart = p.chart; state.special = p.special || null; state.preset = null;
  state.rec = true; state.log = false; state.miss = false;
  state.present = p.present || "line";
  state.axes = p.axes || {}; state.combine = p.combine || null;
  syncURL(state); renderWorkspace(); refreshChipsActive();
}
function deleteUserPreset(id) { setUserPresets(getUserPresets().filter((x) => x.id !== id)); renderChips(); }

async function buildViewSeries() {
  const preset = state.preset ? presetById.get(state.preset) : null;
  const special = preset ? (preset.special || null) : (state.special || null);
  const ids = state.ids.length ? state.ids : (preset ? preset.ids : []);
  const loaded = await Promise.all(ids.map((id) => loadSeries(id)));
  const freq = (meta(ids[0] || "")).frequency || "M";
  const PAL = seriesPalette();

  const series = ids.map((id, i) => {
    const m = meta(id);
    const full = loaded[i] ? loaded[i].observations : [];
    const vis = filterRange(full, state.range);
    const t = applyTransform(vis, state.transform, m.frequency);
    const viewObs = vis.map((o, k) => [o.date, num(o.value), t[k] ? t[k][1] : null]);
    return {
      id, meta: m, full, vis,
      color: PAL[i % PAL.length],
      data: t, viewObs,
      axis: state.axes[id] === "right" ? "right" : "left",
      displayUnit: transformUnit(state.transform, m.units), origUnits: m.units,
      area: ids.length === 1 && ["level", "rolling"].includes(state.transform),
    };
  });
  // A derived series (e.g. a − b) the user built in the Combine panel, computed on the
  // CURRENTLY DISPLAYED (transformed) values and overlaid as one extra line. It is NOT a source:
  // it carries its own name/unit, isn't a formula variable, and is removed by clearing combine.
  const combine = special ? null : resolveCombine(state.combine, ids.length);
  let derived = null;
  if (combine && series.length >= 2) {
    const inputs = series.map((s) => s.data.map(([d, v]) => ({ date: d, value: v })));
    const ddata = combineSeries(inputs, combine.expr) || [];
    const dunit = combineUnit(combine, series);
    const dname = combine.name || combineLabel(combine.opKey, series.map((s) => s.meta.short_title), combine.expr);
    derived = {
      id: DERIVED_ID, derived: true, dashed: true,
      meta: { id: DERIVED_ID, short_title: dname, title: dname, units: dunit, frequency: freq, provider: "derived" },
      color: PAL[ids.length % PAL.length], data: ddata, vis: [],
      viewObs: ddata.map(([d, v]) => [d, null, v]),
      axis: state.axes[DERIVED_ID] === "right" ? "right" : "left",
      displayUnit: dunit, origUnits: dunit, area: false,
    };
  }
  return { series, derived, freq, special, preset, ids, combine };
}

// resolve a combine spec to a usable {opKey, expr, name} or null (needs ≥2 series + a valid formula)
function combineExpr(combine) {
  if (!combine) return null;
  if (combine.expr) return combine.expr;
  return (COMBINE_OPS.find((o) => o.key === combine.opKey) || {}).expr || null;
}
function resolveCombine(combine, n) {
  if (!combine || n < 2) return null;
  const expr = combineExpr(combine);
  if (!expr || !compileFormula(expr, n)) return null;
  return { opKey: combine.opKey || null, expr, name: combine.name || null };
}
function combineUnit(combine, series) {
  if (combine.opKey === "share") return "%";
  if (combine.opKey === "ratio") return "ratio";
  if (combine.opKey === "diff" || combine.opKey === "sum") {
    const u = [...new Set(series.slice(0, 2).map((s) => s.meta.units))];
    if (u.length === 1) return /percent/i.test(u[0]) && combine.opKey === "diff" ? "pp" : u[0];
    return "";
  }
  return ""; // custom formula — unit is whatever the math produces
}

async function renderWorkspace() {
  const mount = $("#workspaceMount") || $("#workspaceMountExplore");
  if (!mount) return;
  const seq = ++renderSeq;
  mount.innerHTML = `<div class="workspace"><div class="chartcard"><div class="chart skel" style="margin:14px"></div></div><div></div></div>`;

  const view = await buildViewSeries();
  // A newer render (or a navigation) started while series were loading — abandon this one so
  // a slow earlier load can't overwrite the DOM / lastView / chart option with stale state.
  if (seq !== renderSeq) return;
  lastView = view;
  if (!view.ids.length) {
    if (mount.id === "workspaceMountExplore") { mount.innerHTML = ""; return; }
    mount.innerHTML = `<div class="chartcard"><div class="empty"><div class="empty__big">No series selected</div><div>Search above or pick a preset to start charting.</div><button class="btn btn--accent" id="emptyAdd" style="margin-top:8px">Search indicators</button></div></div>`;
    $("#emptyAdd")?.addEventListener("click", openPalette); return;
  }

  const primary = view.series[0];
  const m = primary.meta;
  const anyMirror = view.series.some((s) => s.meta.mirror);
  // A derived line is just an extra series on the comparison — the view keeps its own identity.
  const title = (view.preset && (view.ids.length > 1 || view.preset.special) ? view.preset.label : m.title);
  const kicker = view.preset ? view.preset.kicker : (view.ids.length > 1 ? "Comparison" : "Indicator");
  const desc = view.preset ? view.preset.desc : friendlyNotes(m.description || "");

  mount.innerHTML = `
    <div class="workspace">
      <div class="chartcard">
        <div class="chartcard__head">
          <div class="chartcard__titlewrap">
            <div class="chartcard__kicker">${kicker}</div>
            <h2 class="chartcard__title">${esc(title)}</h2>
            ${desc ? `<p class="chartcard__desc">${esc(desc)}</p>` : ""}
          </div>
          <div class="chartcard__actions">
            ${view.special === "state_table" ? "" : `<button class="btn btn--sm" id="wsFocus" title="Open a large, focused view (Esc to close)"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" style="margin-right:4px"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" stroke-linecap="round" stroke-linejoin="round"/></svg>Focus</button>`}
            <button class="btn btn--sm" id="wsSave" title="Save this view as a preset (stored in your browser)">★ Save</button>
            <button class="btn btn--sm" id="wsExport">Export</button>
          </div>
        </div>
        ${(view.special === "state_table" || view.special === "state_map") ? "" : renderControls(view)}
        <div class="${view.special === "state_table" ? "" : "chart"}" id="chartBox"></div>
        <div class="transform-note" id="tnote"></div>
        ${renderMetastrip(primary, anyMirror)}
      </div>
      <div class="side">
        ${renderTray(view)}
        ${renderCombine(view)}
        ${renderSourceNote(view, anyMirror)}
      </div>
    </div>`;

  // render chart / table / map
  let mapFailed = false;
  if (view.special === "state_map") {
    try { await ensureUsaMap(); }
    catch (e) { mapFailed = true; $("#chartBox").innerHTML = `<div class="empty"><div class="empty__big">Couldn't load the map.</div><div>${esc(e.message)}</div></div>`; }
  }
  if (view.special === "state_table") renderStateTable($("#chartBox"));
  else if (!mapFailed) renderChart(view);

  wireControls(view);
  $("#wsFocus")?.addEventListener("click", openFocus);
  $("#wsSave")?.addEventListener("click", saveCurrentAsPreset);
  $("#wsExport")?.addEventListener("click", () => openSheet());
  $("#trayAdd")?.addEventListener("click", () => openPalette("add"));
  $$("[data-rm]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.rm === DERIVED_ID) {  // the derived line lives in combine, not in ids
      state.combine = null; delete state.axes[DERIVED_ID]; syncURL(state); renderWorkspace(); return;
    }
    state.ids = state.ids.filter((x) => x !== b.dataset.rm);
    delete state.axes[b.dataset.rm];
    state.preset = null; state.special = null; syncURL(state); renderWorkspace();
    refreshChipsActive?.();
  }));
  // axis assignment (left/right) per series — works for sources and the derived line
  $$("[data-axisid]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.axis === "right") state.axes[b.dataset.axisid] = "right";
    else delete state.axes[b.dataset.axisid];
    syncURL(state); renderWorkspace();
  }));
  // combine ops: fill the formula box and plot the derived line immediately (name kept editable)
  $$("[data-cmb]").forEach((b) => b.addEventListener("click", () => {
    state.combine = { opKey: b.dataset.cmb, expr: null, name: state.combine?.name || null };
    syncURL(state); renderWorkspace();
  }));
  $("#cmbApply")?.addEventListener("click", () => applyCombineExpr($("#cmbInput").value, $("#cmbName")?.value));
  $("#cmbInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyCombineExpr(e.target.value, $("#cmbName")?.value); } });
  $("#cmbName")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyCombineExpr($("#cmbInput")?.value, e.target.value); } });
  $("#cmbClear")?.addEventListener("click", () => { state.combine = null; syncURL(state); renderWorkspace(); });
}

// ---- presentation modes (line / area / stacked / share / small multiples) ----
// Stacking & share only make sense for additive levels (counts, dollars, persons) —
// never for rates, indices, or ratios, where summing states is meaningless.
function additiveUnits(units) {
  const u = (units || "").toLowerCase();
  if (/percent|index|ratio|per hour|per week|\bweeks\b|\bhours\b|boolean/.test(u)) return false;
  return /thousand|number|person|job|hire|separation|dollar|employ|count|level/.test(u);
}
// Specials with their own bespoke rendering (scatter/bar/map/table/gap) keep one look;
// everything else (claims, comparisons, plain indicators) is line-family and can switch presentation.
const NONLINE_SPECIAL = new Set(["beveridge", "industry_bar", "state_map", "state_table", "gap"]);
function isLineFamily(view) { return !NONLINE_SPECIAL.has(view.special); }
function presentOptions(view) {
  const opts = [{ v: "line", l: "Line" }];
  if (!isLineFamily(view) || view.series.length < 2) return opts;  // single series / bespoke specials keep one look
  const units = [...new Set(view.series.map((s) => s.meta.units))];
  const sameUnit = units.length === 1;
  // Area/stacked/share share ONE vertical axis, so they only make sense when units match.
  // A mismatched-unit comparison stays on Line, where the L/R axis toggle is the right tool.
  if (sameUnit) opts.push({ v: "area", l: "Area" });
  if (shareStackEligible(view)) { opts.push({ v: "stacked", l: "Stacked" }); opts.push({ v: "share", l: "Share %" }); }
  opts.push({ v: "multiples", l: "Small multiples" });
  return opts;
}
function currentPresent(view) {
  const ok = presentOptions(view).map((o) => o.v);
  return ok.includes(state.present) ? state.present : "line";
}
// Normalize aligned series to each period's share of the across-series total (0–100).
// A period where any series is missing yields null for all (shares wouldn't sum to 100).
function toShare(arrs) {
  const dates = [...new Set(arrs.flatMap((a) => a.map((p) => p[0])))].sort();
  const maps = arrs.map((a) => new Map(a.map((p) => [p[0], p[1]])));
  return arrs.map((_, i) => dates.map((d) => {
    const vals = maps.map((m) => m.get(d));
    if (vals.some((v) => v == null || !Number.isFinite(v))) return [d, null];
    const sum = vals.reduce((s, v) => s + v, 0);
    return [d, sum ? (maps[i].get(d) / sum) * 100 : null];
  }));
}
// Stacked/share are only meaningful for same-unit, same-frequency, non-negative additive levels
// with ≥2 periods that EVERY series actually covers. Otherwise the stack total / shares are
// arithmetic on incomparable or too-sparse data (negatives → shares <0 or >100; one shared
// date → a meaningless dot; mixed frequency → mostly-blank columns).
function finiteDates(data) { return new Set(data.filter(([, v]) => v != null && Number.isFinite(v)).map(([d]) => d)); }
function commonFiniteDateCount(series) {
  const sets = series.map((s) => finiteDates(s.data));
  if (!sets.length) return 0;
  const [first, ...rest] = sets;
  return [...first].filter((d) => rest.every((set) => set.has(d))).length;
}
function hasNegativeSeries(series) { return series.some((s) => s.data.some(([, v]) => v != null && Number.isFinite(v) && v < 0)); }
function shareStackEligible(view) {
  const units = [...new Set(view.series.map((s) => s.meta.units))];
  const freqs = [...new Set(view.series.map((s) => s.meta.frequency))];
  return units.length === 1 && freqs.length === 1 &&
    additiveUnits(units[0]) && ["level", "rolling"].includes(state.transform) &&
    !hasNegativeSeries(view.series) && commonFiniteDateCount(view.series) >= 2;
}
// Align series on a shared date axis, blanking ALL series on any date where one is missing.
// A stacked total must never mix present + absent parts (that would understate the total and
// imply a value that isn't there). Share normalization (toShare) applies the same rule.
function alignMask(arrs) {
  const dates = [...new Set(arrs.flatMap((a) => a.map((p) => p[0])))].sort();
  const maps = arrs.map((a) => new Map(a.map((p) => [p[0], p[1]])));
  return arrs.map((_, i) => dates.map((d) => {
    const vals = maps.map((m) => m.get(d));
    if (vals.some((v) => v == null || !Number.isFinite(v))) return [d, null];
    return [d, maps[i].get(d)];
  }));
}
function disposeMulti() { multiCharts.forEach((ch) => { try { ch.dispose(); } catch (e) {} }); multiCharts = []; }

function renderControls(view) {
  // ranking/table presets ignore transforms & range — show no controls
  if (view.special === "state_table" || view.special === "industry_bar") return "";

  const SEG_LABEL = { transform: "Transform", range: "Date range", present: "Presentation" };
  const seg = (key, items, active) => `<div class="segmented" data-seg="${key}" role="group" aria-label="${esc(SEG_LABEL[key] || key)}">` +
    items.map((it) => `<button class="seg ${it.v === active ? "is-active" : ""}" data-v="${it.v}" aria-pressed="${it.v === active ? "true" : "false"}" ${it.dis ? "disabled title='" + esc(it.reason || "") + "'" : ""}>${it.l}</button>`).join("") + `</div>`;
  const rItems = [["1y", "1Y"], ["5y", "5Y"], ["10y", "10Y"], ["all", "All"]].map(([v, l]) => ({ v, l }));
  const rangeGroup = `<div class="ctrl-group"><span class="ctrl-label">Range</span>${seg("range", rItems, state.range)}</div>`;

  // scatter is always a level/level pairing — only the date range applies
  if (view.special === "beveridge") {
    return `<div class="controls">${rangeGroup}
      <div class="ctrl-group"><span class="ctrl-label" style="color:var(--ink-3);text-transform:none;letter-spacing:0">Paired scatter, colored oldest → most recent</span></div></div>`;
  }

  const avail = transformAvailabilityAll(view.series);
  const tItems = TRANSFORMS.map((t) => ({ v: t.key, l: t.key === "rolling" ? rollingLabel(view.freq) : t.label, dis: !avail[t.key].ok, reason: avail[t.key].reason }));
  const logDis = !["level", "rolling", "indexed"].includes(state.transform) || hasNonPositive(view);

  const transformGroup = `<div class="ctrl-group"><span class="ctrl-label">Transform</span>${seg("transform", tItems, state.transform)}</div>`;

  const pOpts = presentOptions(view);
  const presentGroup = pOpts.length > 1
    ? `<div class="ctrl-group"><span class="ctrl-label">Show as</span>${seg("present", pOpts, currentPresent(view))}</div>`
    : "";

  return `<div class="controls">
    ${transformGroup}
    ${presentGroup}
    ${rangeGroup}
    <div class="ctrl-toggles">
      <label class="toggle"><input type="checkbox" data-tg="rec" ${state.rec ? "checked" : ""}><span class="toggle__sw"></span>Recession bands</label>
      <label class="toggle" ${logDis ? "style='opacity:.4'" : ""}><input type="checkbox" data-tg="log" ${state.log ? "checked" : ""} ${logDis ? "disabled" : ""}><span class="toggle__sw"></span>Log scale</label>
      <label class="toggle"><input type="checkbox" data-tg="miss" ${state.miss ? "checked" : ""}><span class="toggle__sw"></span>Missing markers</label>
    </div>
  </div>`;
}

function wireControls(view) {
  // Scope to the workspace so the focus overlay's own copy of the controls
  // (wired separately) isn't double-bound.
  const root = $(".workspace") || document;
  $$("[data-seg] .seg", root).forEach((b) => b.addEventListener("click", () => {
    if (b.disabled) return;
    const key = b.closest("[data-seg]").dataset.seg;
    state[key] = b.dataset.v;
    if (key === "transform" || key === "range" || key === "present") { syncURL(state); renderWorkspace(); }
  }));
  $$("[data-tg]", root).forEach((cb) => cb.addEventListener("change", () => {
    state[cb.dataset.tg] = cb.checked; syncURL(state); renderWorkspace();
  }));
}

function renderChart(view) {
  const box = $("#chartBox"); if (!box) return;
  disposeMulti();
  if (chart) { chart.dispose(); chart = null; }

  // Small multiples: a grid of mini charts instead of one combined chart.
  const present = isLineFamily(view) ? currentPresent(view) : "line";
  // Canonicalize the URL: an incompatible ?p= carried onto this view (e.g. ?p=stacked deep-linked
  // onto a single series, or stacked left over from a now-ineligible comparison) collapses to the
  // resolved presentation so the shareable link matches what's actually drawn.
  if (state.present !== present) { state.present = present; syncURL(state); }
  if (present === "multiples") {
    lastView.option = null;            // no single ECharts option to export as image
    renderSmallMultiples(view, box);
    if (focusOpen) refreshFocus();
    return;
  }

  chart = window.echarts.init(box, null, { renderer: "canvas" });

  let option;
  if (view.special === "beveridge") {
    const a = view.series[0], b = view.series[1];
    // alignByDate yields {date,a,b}; scatterOption consumes {date,x,y} (x→horizontal, y→vertical).
    const pairs = alignByDate(a.vis, b.vis).map((p) => ({ date: p.date, x: p.a, y: p.b }));
    option = scatterOption(pairs, { xName: a.meta.short_title, yName: b.meta.short_title });
    setNote("");
  } else if (view.special === "industry_bar") {
    const items = view.series.map((s) => {
      const row = latestRow(s.id);
      return { name: s.meta.short_title.replace(/^Payrolls,?\s*/i, ""), value: row ? round1(row.pct_change_12) : 0,
        color: (row && row.pct_change_12 >= 0) ? cssvar("--pos") : cssvar("--neg") };
    }).sort((x, y) => y.value - x.value);
    option = barOption(items, { zeroLine: true, fmt: (v) => (v > 0 ? "+" : "") + v + "%", axisFmt: "{value}%" });
    setNote(view.preset?.note ? "⚠ " + view.preset.note : "");
  } else if (view.special === "state_map") {
    const rows = latestRows("laus_state_unemployment_template")
      .map((r) => ({ name: geoStateName(r.geo_id), value: r.value, change: r.change_1 }))
      .filter((r) => r.name && Number.isFinite(r.value));
    option = mapOption(rows, { unit: "%" });
    setNote("");
  } else {
    const stacked = present === "stacked" || present === "share";
    // The derived line is drawn in line/area, but excluded from stacked/share (you don't stack a
    // computed series with its own inputs). Removing the sources leaves just the derived line.
    const plot = (view.derived && !stacked) ? [...view.series, view.derived] : view.series;
    const dual = present === "line" && plot.some((s) => s.axis === "right");
    let datas = plot.map((s) => s.data);
    if (present === "share") datas = toShare(datas);
    else if (present === "stacked") datas = alignMask(datas);  // blank a period unless every part is present
    const ser = plot.map((s, i) => ({
      name: s.meta.short_title, color: s.color, data: datas[i], dashed: s.dashed,
      displayUnit: present === "share" ? "%" : s.displayUnit, origUnits: s.origUnits,
      area: present === "area" || stacked || (present === "line" && s.area && !dual),
      stack: stacked, axis: present === "line" ? s.axis : "left",
    }));
    const ax = present === "share"
      ? { left: "Share of total", right: "", note: "" }
      : axisNames(plot, dual);
    option = lineOption(ser, { freq: view.freq, recession: state.rec, log: present === "line" && state.log,
      missingMarkers: state.miss, yName: ax.left, yNameRight: ax.right, present,
      yPct: present === "share", endLabels: !stacked,
      markExtremes: present === "line" && plot.length === 1 });
    // One-line plain-language note explaining the math of the current presentation.
    let note = ax.note;
    if (present === "share") note = "Each line is its share of the across-series total that period (sums to 100%); a period is blank if any series is missing.";
    else if (present === "stacked") note = "Stacked same-unit levels; a period is blank unless every series has a value.";
    else if (present === "line" && state.transform === "indexed") note = "Indexed to 100 at each line's first visible observation — base dates differ when a series starts later.";
    setNote(note);
  }
  chart.setOption(option);
  lastView.option = option;
  // Canvas charts are opaque to screen readers: give the container an image role + a concise
  // label (ECharts' own aria.show adds a fuller hidden description inside).
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", chartAriaLabel(view));
  if (focusOpen) refreshFocus();
}

function chartAriaLabel(view) {
  const all = view.derived ? [...view.series, view.derived] : view.series;
  const names = all.map((s) => s.meta.short_title).join(", ");
  const kind = view.special === "beveridge" ? "Scatter plot" : view.special === "industry_bar" ? "Bar chart" : "Time-series chart";
  return `${kind} of ${names}. Export CSV or JSON for exact values.`;
}

function setNote(txt) {
  const n = $("#tnote"); if (!n) return;
  n.classList.toggle("show", !!txt);
  n.innerHTML = txt ? `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10" cy="10" r="8"/><path d="M10 9v5M10 6v.5" stroke-linecap="round"/></svg> ${esc(txt)}` : "";
}

// ---- SMALL MULTIPLES: a grid of mini trend charts, one per series ----
function renderSmallMultiples(view, box, opts = {}) {
  const targetArr = opts.targetArr || multiCharts;
  box.style.height = "auto";
  const cells = view.series.map((s, i) => {
    const m = s.meta, row = latestRow(s.id);
    const val = row ? fmtValue(row.value, m.units, { compact: true }) + (unitShort(m.units) || "") : "—";
    const dv = row ? row.change_1 : null;
    const arrow = dv == null ? "" : dv > 0 ? "▲" : dv < 0 ? "▼" : "•";
    return `<button class="smcell" data-open-id="${esc(s.id)}" title="Open ${esc(m.short_title)}">
      <div class="smcell__head"><span class="smcell__sw" style="background:${s.color}"></span>
        <span class="smcell__name">${esc(m.short_title)}</span></div>
      <div class="smcell__val">${val}${dv == null ? "" : ` <span class="smcell__delta">${arrow} ${esc(fmtDelta(dv, m.units))}</span>`}</div>
      <div class="smcell__chart" data-mini="${i}"></div>
    </button>`;
  }).join("");
  box.innerHTML = `<div class="smgrid${opts.big ? " smgrid--big" : ""}">${cells}</div>`;
  // Shared x-window so the minis are comparable: start at the LATEST series-start (the common
  // window — a since-2000 series and a since-1990 series both begin at 2000) and end at the
  // latest series-end. ISO date strings compare lexically. Line mode keeps each series' full span.
  const firsts = [], lasts = [];
  for (const s of view.series) {
    const f = s.data.find((p) => p[1] != null); if (f) firsts.push(f[0]);
    for (let k = s.data.length - 1; k >= 0; k--) { if (s.data[k][1] != null) { lasts.push(s.data[k][0]); break; } }
  }
  const xMin = firsts.length ? firsts.reduce((a, b) => (a > b ? a : b)) : undefined;
  const xMax = lasts.length ? lasts.reduce((a, b) => (a > b ? a : b)) : undefined;
  view.series.forEach((s, i) => {
    const el = box.querySelector(`[data-mini="${i}"]`); if (!el) return;
    const ch = window.echarts.init(el, null, { renderer: "canvas" });
    ch.setOption(miniLineOption({ data: s.data, color: s.color, displayUnit: s.displayUnit, origUnits: s.origUnits },
      { freq: view.freq, recession: state.rec, xMin, xMax }));
    targetArr.push(ch);
  });
  box.querySelectorAll("[data-open-id]").forEach((b) => b.addEventListener("click", () => {
    if (focusOpen) closeFocus();
    openSingle(b.dataset.openId);
  }));
}

// ============================================================ FOCUS / FULLSCREEN
// A large, distraction-free view of the current chart over a blurred backdrop.
// Reuses the exact option built for the workspace, with a live copy of the controls.
function openFocus() {
  if (!lastView || !lastView.ids?.length) { toast("Open a chart first"); return; }
  focusOpen = true;
  const ov = $("#focus"); ov.hidden = false;
  document.body.style.overflow = "hidden";
  refreshFocus();
  pushModal(ov);
  requestAnimationFrame(() => { focusChart && focusChart.resize(); focusMulti.forEach((c) => c.resize()); });
}
function closeFocus() {
  focusOpen = false;
  const ov = $("#focus"); if (ov) { ov.hidden = true; popModal(ov); }
  document.body.style.overflow = "";
  if (focusChart) { focusChart.dispose(); focusChart = null; }
  focusMulti.forEach((c) => { try { c.dispose(); } catch (e) {} }); focusMulti = [];
}
// (Re)build the overlay's header, controls, chart and footer from lastView.
function refreshFocus() {
  if (!focusOpen || !lastView) return;
  const view = lastView;
  const primary = view.series[0]; if (!primary) { closeFocus(); return; }
  const m = primary.meta;
  const title = (view.preset && (view.ids.length > 1 || view.preset.special) ? view.preset.label : m.title);
  const kicker = view.preset ? view.preset.kicker : (view.ids.length > 1 ? "Comparison" : "Indicator");
  $("#focusKicker").textContent = kicker;
  $("#focusTitle").textContent = title;
  const owners = [...new Set(view.series.map((s) => sourceOwner(s.meta)))];
  $("#focusFoot").innerHTML = `Published by <b>${esc(owners.join(", "))}</b> · ${esc(FREQ_LABEL[m.frequency] || m.frequency)} · updated ${esc(fmtTimestamp(store.manifest.generated_at))}`;

  // controls: only meaningful for the time-series presentations
  const showControls = view.special !== "state_table" && view.special !== "industry_bar" && view.special !== "state_map";
  $("#focusControls").innerHTML = showControls ? renderControls(view) : "";
  if (showControls) wireFocusControls();

  // chart body
  const box = $("#focusChart");
  focusMulti.forEach((c) => { try { c.dispose(); } catch (e) {} }); focusMulti = [];
  if (focusChart) { focusChart.dispose(); focusChart = null; }
  box.innerHTML = ""; box.style.height = "";
  const present = isLineFamily(view) ? currentPresent(view) : "line";
  if (present === "multiples") {
    renderSmallMultiples(view, box, { targetArr: focusMulti, big: true });
  } else if (lastView.option) {
    focusChart = window.echarts.init(box, null, { renderer: "canvas" });
    focusChart.setOption(lastView.option);
  }
}
// Controls inside the overlay: update shared state, re-render the (hidden) workspace
// so lastView.option rebuilds, then repaint the overlay.
function wireFocusControls() {
  const root = $("#focusControls"); if (!root) return;
  $$("[data-seg] .seg", root).forEach((b) => b.addEventListener("click", () => {
    if (b.disabled) return;
    const key = b.closest("[data-seg]").dataset.seg;
    state[key] = b.dataset.v;
    if (key === "transform" || key === "range" || key === "present") { syncURL(state); renderWorkspace(); }
  }));
  $$("[data-tg]", root).forEach((cb) => cb.addEventListener("change", () => {
    state[cb.dataset.tg] = cb.checked; syncURL(state); renderWorkspace();
  }));
}

// y-axis name(s) + a plain-language nudge when units don't match. Operates on the plotted list
// (sources + any derived line) using each series' already-resolved displayUnit. Percentage points
// (a derived gap) and Percent share an axis, so a gap line doesn't trigger the mismatch nudge.
const unitClass = (u) => /^(pp|percent|percentage points?)$/i.test(u || "") ? "Percent" : (u || "");
function axisNames(seriesList, dual) {
  const t = state.transform;
  if (t === "indexed") return { left: "Index (visible start = 100)", right: "", note: "" };
  const unitOf = (arr) => { const u = [...new Set(arr.map((s) => s.displayUnit))]; return u.length === 1 ? u[0] : ""; };
  if (dual) {
    return { left: unitOf(seriesList.filter((s) => s.axis !== "right")),
             right: unitOf(seriesList.filter((s) => s.axis === "right")), note: "" };
  }
  if (t === "pct_change" || t === "yoy") return { left: "Percent change", right: "", note: "" };
  const classes = [...new Set(seriesList.map((s) => unitClass(s.displayUnit)))];
  if (seriesList.length > 1 && classes.length > 1)
    return { left: "", right: "",
      note: "These series use different units. Put one on the right axis (the L · R toggle in the compare tray), or switch to Index or % change." };
  return { left: seriesList[0].displayUnit, right: "", note: "" };
}

function renderMetastrip(s, anyMirror) {
  const m = s.meta, row = latestRow(s.id);
  const src = store.sourceById.get(m.source_id) || {};
  const cell = (k, v) => `<div class="metastrip__item"><div class="metastrip__k">${k}</div><div class="metastrip__v">${esc(v)}</div></div>`;
  return `<div class="metastrip">
    ${cell("Units", m.units || "—")}
    ${cell("Frequency", FREQ_LABEL[m.frequency] || m.frequency || "—")}
    ${cell("Seasonal adj.", m.seasonal_adjustment || "—")}
    ${cell("Source", (src.owner || m.source_title || PROVIDER_LABEL[m.provider] || "—") + (m.mirror ? " (via FRED)" : ""))}
    ${cell("Release", m.release || "—")}
    ${cell("Series ID", m.series_id || "—")}
    ${cell("Latest", row ? fmtDate(row.date, m.frequency) : "—")}
    ${cell("Generated", fmtTimestamp(store.manifest.generated_at))}
  </div>`;
}

const VARLETTERS = "abcdefgh";
function renderTray(view) {
  const nSources = view.series.length;
  const multi = nSources > 1;
  const plotCount = nSources + (view.derived ? 1 : 0);
  // The L/R axis toggle only takes effect for line-family series in "line" presentation
  // (stacked/area/share share one axis; specials & multiples don't honor per-series axes).
  // It applies to the derived line too, so you can give a different-unit formula its own axis.
  const showAxis = isLineFamily(view) && currentPresent(view) === "line" && plotCount > 1;
  const axisTog = (s, name) => `<div class="axistog" role="group" aria-label="Vertical axis for ${esc(name)}" title="Plot this line against the left or right vertical axis">
       <button class="axisbtn ${s.axis !== "right" ? "is-on" : ""}" data-axis="left" data-axisid="${s.id}" aria-pressed="${s.axis !== "right"}" aria-label="Plot ${esc(name)} on the left axis" title="Left axis">L</button>
       <button class="axisbtn ${s.axis === "right" ? "is-on" : ""}" data-axis="right" data-axisid="${s.id}" aria-pressed="${s.axis === "right"}" aria-label="Plot ${esc(name)} on the right axis" title="Right axis">R</button>
     </div>`;
  const chips = view.series.map((s, i) => `
    <div class="serieschip">
      ${multi ? `<span class="serieschip__var">${VARLETTERS[i] || "?"}</span>` : ""}
      <span class="serieschip__sw" style="background:${s.color}"></span>
      <div class="serieschip__main">
        <div class="serieschip__name">${esc(s.meta.short_title)}</div>
        <div class="serieschip__meta">${PROVIDER_LABEL[s.meta.provider] || s.meta.provider}${s.meta.mirror ? " · via FRED" : ""} · ${FREQ_LABEL[s.meta.frequency] || s.meta.frequency}</div>
      </div>
      ${showAxis ? axisTog(s, s.meta.short_title)
        : `<span class="unitbadge">${esc(unitShort(s.meta.units) || (s.meta.units || "").split(" ")[0])}</span>`}
      ${multi ? `<button class="serieschip__rm" data-rm="${s.id}" title="Remove">✕</button>` : ""}
    </div>`).join("");
  // The derived line (a − b, etc.) is shown as its own chip: a ƒ badge instead of a variable
  // letter, a dashed-style swatch, the formula, and a remove that clears the combine.
  const d = view.derived;
  const derivedChip = d ? `
    <div class="serieschip serieschip--derived">
      <span class="serieschip__var serieschip__var--fx" title="Derived from a formula">ƒ</span>
      <span class="serieschip__sw serieschip__sw--dashed" style="background:${d.color}"></span>
      <div class="serieschip__main">
        <div class="serieschip__name">${esc(d.meta.short_title)}</div>
        <div class="serieschip__meta">Derived · ${esc(combineExpr(view.combine) || "formula")}${d.displayUnit ? " · " + esc(d.displayUnit) : ""}</div>
      </div>
      ${showAxis ? axisTog(d, d.meta.short_title)
        : (d.displayUnit ? `<span class="unitbadge">${esc(d.displayUnit)}</span>` : "")}
      <button class="serieschip__rm" data-rm="${DERIVED_ID}" title="Remove derived line">✕</button>
    </div>` : "";
  return `<div class="panel">
    <div class="panel__head"><span class="panel__title">Compare tray</span><span class="panel__count">${plotCount}</span></div>
    <div class="panel__body">
      <div class="tray">${(chips + derivedChip) || `<div class="tray-empty">No series yet.</div>`}</div>
      <button class="btn btn--sm addmore" id="trayAdd">+ Add series to compare</button>
    </div>
  </div>`;
}

// "Create a series" panel: build a new line from a formula over the tray series (a, b, …),
// give it a name, and add it to the chart alongside the originals. Curated ops fill the formula.
function renderCombine(view) {
  if (view.series.length < 2 || view.special) return "";
  const vars = view.series.map((s, i) => `<span><b>${VARLETTERS[i]}</b>&nbsp;${esc(s.meta.short_title)}</span>`).join("");
  const activeKey = view.combine ? view.combine.opKey : null;
  const curExpr = view.combine ? (combineExpr(view.combine) || "") : "";
  const curName = view.combine ? (view.combine.name || "") : "";
  const autoName = view.derived ? view.derived.meta.short_title : "New series";
  const ops = COMBINE_OPS.map((o) =>
    `<button class="cmb-op ${activeKey === o.key ? "is-on" : ""}" data-cmb="${o.key}">${o.label}<small>${o.hint}</small></button>`).join("");
  return `<div class="panel">
    <div class="panel__head"><span class="panel__title">Create a series</span>
      ${view.combine ? `<button class="cmb-off" id="cmbClear">remove</button>` : ""}</div>
    <div class="panel__body">
      <div class="combine-vars">${vars}</div>
      <div class="combine-ops">${ops}</div>
      <div class="combine-field">
        <label class="cmb-lbl" for="cmbInput">Formula</label>
        <div class="combine-formula">
          <span class="cmb-eq">=</span>
          <input class="cmb-input" id="cmbInput" value="${esc(curExpr)}" placeholder="a - b" spellcheck="false" autocomplete="off" aria-label="Formula">
        </div>
      </div>
      <div class="combine-field">
        <label class="cmb-lbl" for="cmbName">Name</label>
        <input class="cmb-input cmb-name" id="cmbName" value="${esc(curName)}" placeholder="${esc(autoName)}" spellcheck="false" autocomplete="off" maxlength="48" aria-label="Series name">
      </div>
      <button class="btn btn--sm btn--accent cmb-apply" id="cmbApply">${view.combine ? "Update line" : "Add to chart"}</button>
    </div>
  </div>`;
}
function applyCombineExpr(raw, rawName) {
  const expr = (raw || "").trim();
  if (!expr) { toast("Type a formula like a − b"); return; }
  const n = lastView ? lastView.series.length : state.ids.length;
  if (!compileFormula(expr, n)) { toast("That formula isn't valid — use a, b, … with + − × ÷ and ( )"); return; }
  const flat = expr.replace(/\s/g, "");
  const match = COMBINE_OPS.find((o) => o.expr.replace(/\s/g, "") === flat);
  const name = (rawName || "").trim() || null;
  state.combine = match ? { opKey: match.key, expr: null, name } : { opKey: null, expr, name };
  syncURL(state); renderWorkspace();
}

function renderSourceNote(view, anyMirror) {
  const owners = [...new Set(view.series.map((s) => sourceOwner(s.meta)))];
  const note = friendlyNotes(view.series[0].meta.notes);
  return `<div class="panel">
    <div class="panel__head"><span class="panel__title">Where this comes from</span></div>
    <div class="panel__body sourcenote">
      <p>Published by <b>${esc(owners.join(", "))}</b>.${note ? " " + esc(note) : ""}</p>
      ${anyMirror ? `<div class="callout callout--info" style="margin-top:10px">
        <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10" cy="10" r="8"/><path d="M10 9v5M10 6v.5" stroke-linecap="round"/></svg>
        <span>Some lines come <b>via FRED</b> — the same numbers as the official release, just fetched through FRED.</span>
      </div>` : ""}
    </div>
  </div>`;
}

// the agency that actually publishes a series, for plain-language attribution
function sourceOwner(m) {
  const src = store.sourceById.get(m.source_id) || {};
  return src.owner || m.source_title || PROVIDER_LABEL[m.provider] || m.provider || "an official agency";
}
// drop the dev-facing sentences (canonical/mirror/pipeline talk) from notes shown to readers
function friendlyNotes(notes) {
  if (!notes) return "";
  return notes.split(/(?<=[.!?])\s+/)
    .filter((s) => !/canonical|convenience|\bmirror|redistribut|deflate nominal|frontend|backend|\bapi\b|flat file/i.test(s))
    .join(" ").trim();
}

// ranked state table (state/local preset)
function renderStateTable(box) {
  const rows = latestRows("laus_state_unemployment_template")
    .map((r) => ({ name: geoStateName(r.geo_id), value: r.value, change: r.change_1 }));
  renderStateRank(box, rows, { units: "Percent", label: "Unemployment" });
}

// Ranked state list from explicit rows ([{name,value,change}]); unit-aware so it serves any map
// metric. The state-map view re-renders it per selected month to stay in sync with the timeline.
function renderStateRank(box, rowsIn, opts = {}) {
  if (!box) return;
  const units = opts.units || "Percent";
  const rows = rowsIn.filter((r) => r.name && Number.isFinite(r.value)).slice().sort((a, b) => b.value - a.value);
  const max = rows.length ? Math.max(...rows.map((r) => r.value)) : 1;
  box.style.padding = "0";
  box.innerHTML = `<div style="max-height:${opts.maxHeight || 560}px;overflow:auto">
    <table class="ranktable">
      <thead><tr><th>#</th><th>State</th><th class="r">${esc(opts.label || "Value")}</th><th></th><th class="r">change</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td class="rank-i">${i + 1}</td>
        <td>${esc(r.name)}</td>
        <td class="r"><b>${esc(fmtMapValue(r.value, units))}</b></td>
        <td><div class="rankbar" style="width:${Math.max(4, (r.value / max) * 100)}%"></div></td>
        <td class="r" style="color:${r.change > 0 ? "var(--neg)" : r.change < 0 ? "var(--pos)" : "var(--ink-3)"}">${r.change == null ? "—" : esc(fmtMapChange(r.change, units))}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;
}

// ---- map-ready metric discovery (from catalog chart metadata ∩ manifest availability) ----
function mapMetrics() {
  return (store.manifest.available_indicator_ids || [])
    .map((id) => meta(id))
    .filter((m) => m.chart && (m.chart.default_type === "map" || m.chart.allow_geography_filter === true));
  // Note: a metric can be "available" yet published all-null (e.g. a QWI variable the export
  // couldn't fill). We keep it in the picker and degrade to a clear empty state when selected,
  // rather than excluding it via latest.json (whose per-state coverage is uneven).
}
function mapMetricGroup(m) {
  if (m.provider === "census_qwi") return /dollar/i.test(m.units) ? "QWI · earnings & pay" : "QWI · jobs & flows";
  return "LAUS · unemployment & labor force";
}
function currentMapMetric() {
  const metrics = mapMetrics();
  if (!metrics.length) return null;
  if (state.mapMetric && metrics.some((m) => m.id === state.mapMetric)) return state.mapMetric;
  return metrics.some((m) => m.id === "laus_state_unemployment_template") ? "laus_state_unemployment_template" : metrics[0].id;
}
// LAUS rows use "state:06"; QWI rows use bare "06". Normalize either to a friendly state name.
function geoStateName(geo) {
  const m = String(geo == null ? "" : geo).match(/(\d{1,2})\s*$/);
  return m ? geoName("state:" + m[1].padStart(2, "0")) : geoName(geo);
}

// Limit a list of {date,…} frames to a trailing window relative to the latest frame.
function framesInRange(frames, range) {
  if (!range || range === "all" || !frames.length) return frames;
  const years = { "1y": 1, "5y": 5, "10y": 10 }[range] || 0;
  if (!years) return frames;
  const last = frames[frames.length - 1].date;
  const [y, mo, d] = last.split("-").map(Number);
  const cutoff = `${y - years}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return frames.filter((f) => f.date >= cutoff);
}

// ============================================================ STATE MAP (dedicated view)
let mapPlayTimer = null;    // setInterval id for the play-through control
async function renderStateMapView(main) {
  if (mapPlayTimer) { clearInterval(mapPlayTimer); mapPlayTimer = null; }
  disposeMulti();
  const metricId = currentMapMetric();
  if (!metricId) {
    main.innerHTML = `<section class="view"><div class="eyebrow">State &amp; local</div><h1 class="h-title">State map</h1><div class="empty"><div class="empty__big">No map-ready state data in this export.</div></div></section>`;
    return;
  }
  state.mapMetric = metricId;
  const m = meta(metricId);
  const mode = state.mapMode || "map";
  const isMap = mode === "map";
  const mapRange = state.mapRange || "all";

  // grouped metric picker
  const groups = {};
  for (const mm of mapMetrics()) (groups[mapMetricGroup(mm)] ||= []).push(mm);
  const order = ["LAUS · unemployment & labor force", "QWI · jobs & flows", "QWI · earnings & pay"].filter((g) => groups[g]);
  const selHtml = `<select id="mapMetricSel" class="mapsel" aria-label="Map metric">` + order.map((g) =>
    `<optgroup label="${esc(g)}">` + groups[g].map((mm) =>
      `<option value="${mm.id}"${mm.id === metricId ? " selected" : ""}>${esc(mm.short_title)}</option>`).join("") + `</optgroup>`).join("") + `</select>`;
  const srcLine = `${esc(m.source_title || PROVIDER_LABEL[m.provider] || m.provider)}${m.release ? " · " + esc(m.release) : ""} · ${esc(m.units)} · ${FREQ_LABEL[m.frequency] || m.frequency}`;
  const MODES = [["map", "Map"], ["heatmap", "Heatmap"], ["dist", "Distribution"]];
  const modeHtml = `<div class="segmented" id="mapModeSeg" role="group" aria-label="Map view">` + MODES.map(([k, l]) => `<button class="seg ${mode === k ? "is-active" : ""}" data-mode="${k}" aria-pressed="${mode === k ? "true" : "false"}">${l}</button>`).join("") + `</div>`;
  const RANGES = [["1y", "1Y"], ["5y", "5Y"], ["10y", "10Y"], ["all", "All"]];
  const rangeHtml = `<div class="segmented" id="mapRangeSeg" role="group" aria-label="Date range">` + RANGES.map(([k, l]) => `<button class="seg ${mapRange === k ? "is-active" : ""}" data-r="${k}" aria-pressed="${mapRange === k ? "true" : "false"}">${l}</button>`).join("") + `</div>`;
  const blurb = isMap
    ? "Each state is shaded by its value — darker is higher. Hover a state for detail; click anywhere on the slider (or press play) to move through time."
    : mode === "heatmap"
      ? "Every state over time: each row is a state (sorted by latest value), each column a period, color = value."
      : "How the value is spread across states each period — the box covers the middle 50% of states, the line is the median, whiskers are the range.";
  main.innerHTML = `
    <section class="view">
      <div class="mapview-head">
        <div>
          <div class="eyebrow">State &amp; local</div>
          <h1 class="h-title">State map</h1>
          <p class="h-sub">${blurb}<span class="map-src">${srcLine}</span></p>
        </div>
        <div class="mapview-controls">
          ${modeHtml}
          ${rangeHtml}
          <label class="mapsel-wrap">Metric ${selHtml}</label>
        </div>
      </div>
      <div class="section-rule"></div>
      ${isMap ? `
      <div class="statemap">
        <div class="statemap__main">
          <div class="chartcard"><div class="chart chart--map" id="chartBox"></div></div>
          <div class="maptime">
            <button class="maptime__play" id="mtPlay" aria-label="Play through time" title="Play / pause">▶</button>
            <div class="maptime__track">
              <input type="range" class="maptime__range" id="mtRange" min="0" max="0" value="0" step="1" aria-label="Time period">
              <div class="maptime__ticks" id="mtTicks"></div>
            </div>
            <output class="maptime__label" id="mtLabel">—</output>
          </div>
        </div>
        <div class="chartcard statemap__rank">
          <div class="statemap__rankhead">${esc(m.short_title)} — <b id="stateRankMonth">latest</b></div>
          <div id="stateRankMount"></div>
        </div>
      </div>`
      : `<div class="chartcard"><div class="chart chart--tall" id="chartBox"></div></div>`}
    </section>`;
  $("#mapMetricSel")?.addEventListener("change", (e) => { state.mapMetric = e.target.value; syncURL(state); renderStateMapView(main); });
  $$("#mapModeSeg .seg").forEach((b) => b.addEventListener("click", () => { state.mapMode = b.dataset.mode; syncURL(state); renderStateMapView(main); }));
  $$("#mapRangeSeg .seg").forEach((b) => b.addEventListener("click", () => { state.mapRange = b.dataset.r; syncURL(state); renderStateMapView(main); }));

  if (chart) { chart.dispose(); chart = null; }
  const box = $("#chartBox");

  // one frame per period: {date, label, data:[{name,value,change}]}
  const series = await loadSeries(metricId);
  const obs = (series && series.observations) || [];
  const byDate = new Map();
  for (const o of obs) {
    if (!Number.isFinite(o.value)) continue;
    const name = geoStateName(o.geo_id || o.geography); if (!name) continue;
    if (!byDate.has(o.date)) byDate.set(o.date, []);
    byDate.get(o.date).push({ name, value: o.value, change: o.change_1 });
  }
  const allFrames = [...byDate.keys()].sort().map((d) => ({ date: d, label: fmtDate(d, m.frequency), data: byDate.get(d) }));
  // drop near-empty periods (e.g. a just-released month with one state reporting) — they make a
  // misleading single-state map / blank heatmap column / one-point box.
  const maxCount = allFrames.reduce((mx, f) => Math.max(mx, f.data.length), 0);
  const dense = allFrames.filter((f) => f.data.length >= Math.max(2, maxCount * 0.5));
  // apply the selected period window (default "all"); fall back to the full set if a short
  // window would leave nothing (e.g. a lagging quarterly metric with a 1Y filter).
  const ranged = framesInRange(dense, mapRange);
  const frames = ranged.length ? ranged : dense;
  if (!frames.length) {
    box.innerHTML = `<div class="empty"><div class="empty__big">No data published yet</div><div>${esc(m.short_title)} is in the catalog but its values aren't in the current export. Pick another metric above.</div></div>`;
    if (isMap) renderStateRank($("#stateRankMount"), [], { units: m.units, label: m.units });
    return;
  }

  if (mode === "heatmap") {
    chart = window.echarts.init(box, null, { renderer: "canvas" });
    chart.setOption(heatmapOption(frames, { units: m.units }));
    return;
  }
  if (mode === "dist") {
    chart = window.echarts.init(box, null, { renderer: "canvas" });
    chart.setOption(distributionOption(frames, { units: m.units, freq: m.frequency }));
    return;
  }

  // ---- MAP mode: choropleth + native range slider (click-anywhere + drag) ----
  try { await ensureUsaMap(); }
  catch (e) { box.innerHTML = `<div class="empty"><div class="empty__big">Couldn't load the map.</div><div>${esc(e.message)}</div></div>`; return; }
  chart = window.echarts.init(box, null, { renderer: "canvas" });
  const rankBox = $("#stateRankMount"), rankMonth = $("#stateRankMonth");
  const range = $("#mtRange"), labelEl = $("#mtLabel"), play = $("#mtPlay");
  range.max = String(frames.length - 1);
  // date scale beneath the slider so you can aim for a period instead of guessing
  const ticksEl = $("#mtTicks");
  if (ticksEl) {
    const N = frames.length, T = Math.min(6, N);
    const idxs = [...new Set(Array.from({ length: T }, (_, k) => (T <= 1 ? 0 : Math.round(k * (N - 1) / (T - 1)))))];
    ticksEl.innerHTML = idxs.map((i) => `<span style="left:${(N > 1 ? i / (N - 1) : 0) * 100}%">${esc(frames[i].label)}</span>`).join("");
  }
  let cur = frames.length - 1, inited = false;
  const minMax = (data) => { const v = data.map((d) => d.value).filter(Number.isFinite); const mn = v.length ? Math.min(...v) : 0; let mx = v.length ? Math.max(...v) : 1; return [mn, mx <= mn ? mn + 1 : mx]; };
  const setFrame = (i) => {
    cur = Math.max(0, Math.min(frames.length - 1, i));
    const f = frames[cur];
    if (!inited) { chart.setOption(mapOption(f.data, { units: m.units, label: m.short_title, freq: m.frequency })); inited = true; }
    else { const [mn, mx] = minMax(f.data); chart.setOption({ visualMap: [{ min: mn, max: mx }], series: [{ data: f.data.map((r) => ({ name: r.name, value: r.value, change: r.change })) }] }); }
    renderStateRank(rankBox, f.data, { units: m.units, label: m.units });
    if (rankMonth) rankMonth.textContent = f.label;
    if (labelEl) labelEl.textContent = f.label;
    if (range) range.value = String(cur);
  };
  const stopPlay = () => { if (mapPlayTimer) { clearInterval(mapPlayTimer); mapPlayTimer = null; } play.classList.remove("is-playing"); play.textContent = "▶"; };
  range.addEventListener("input", () => { stopPlay(); setFrame(+range.value); });
  play.addEventListener("click", () => {
    if (mapPlayTimer) { stopPlay(); return; }
    if (cur >= frames.length - 1) setFrame(0);
    play.classList.add("is-playing"); play.textContent = "❚❚";
    mapPlayTimer = setInterval(() => { if (cur >= frames.length - 1) { stopPlay(); return; } setFrame(cur + 1); }, 520);
  });
  setFrame(cur);
}

// ============================================================ EXPLORE
let exploreFilters = { group: null, provider: null, freq: null, avail: null };
function renderExplore(main) {
  const liveN = store.manifest.available_indicator_ids.length;
  const catN = Math.max(0, store.catalog.indicators.length - liveN);
  const facet = (key, label, opts) => `<div class="facet-group" data-filt="${key}">
        <span class="facet-group__label">${label}</span>
        ${opts.map(([v, l]) => `<button class="facet ${exploreFilters[key] === v ? "is-on" : ""}" data-v="${v}">${esc(l)}</button>`).join("")}
      </div>`;
  main.innerHTML = `
    <section class="view">
      <div class="explore-head">
        <div>
          <div class="eyebrow">Catalog</div>
          <h1 class="explore-head__title">Explore the catalog</h1>
          <p class="explore-head__sub">${liveN} live series, ${catN} catalog-only — across BLS, FRED, DOL, QCEW and Census QWI.</p>
        </div>
      </div>
      <div id="workspaceMountExplore"></div>
      <div class="toolbar">
        <div class="toolbar__row">
          <label class="ex-search">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="6"></circle><path d="M14 14 L18 18" stroke-linecap="round"></path></svg>
            <input type="text" id="exQuery" placeholder="Search the catalog — title, series ID, tag, alias…" value="${esc(state._q || "")}" autocomplete="off">
          </label>
        </div>
        <div class="facetbar">
          ${facet("avail", "Availability", [["live", "Live"], ["catalog", "Catalog only"]])}
          <span class="facet-div"></span>
          ${facet("group", "Group", [["core", "Core"], ["demographics", "Demographics"], ["wages_prices_productivity", "Wages & prices"], ["industry_state_local", "Industry & state"], ["flows", "Flows"]])}
          <span class="facet-div"></span>
          ${facet("provider", "Source", [["bls", "BLS"], ["fred", "FRED"], ["dol", "DOL"], ["qcew", "QCEW"], ["census_qwi", "Census QWI"]])}
          <span class="facet-div"></span>
          ${facet("freq", "Frequency", [["M", "Monthly"], ["W", "Weekly"], ["Q", "Quarterly"], ["A", "Annual"]])}
          <button class="facet-clear" id="facetClear">Clear</button>
        </div>
      </div>
      <div class="results-bar">
        <div class="results-bar__l" id="exCount"></div>
        <div class="results-sort">Sorted by <b>relevance</b></div>
      </div>
      <div class="results" id="exResults"></div>
    </section>`;
  renderWorkspace();
  const q = $("#exQuery");
  q.addEventListener("input", () => { state._q = q.value; renderExploreResults(); });
  $$("[data-filt] .facet").forEach((b) => b.addEventListener("click", () => {
    const f = b.closest("[data-filt]").dataset.filt;
    exploreFilters[f] = exploreFilters[f] === b.dataset.v ? null : b.dataset.v;
    $$(`[data-filt="${f}"] .facet`).forEach((x) => x.classList.toggle("is-on", x.dataset.v === exploreFilters[f]));
    renderExploreResults();
  }));
  $("#facetClear")?.addEventListener("click", () => {
    exploreFilters = { group: null, provider: null, freq: null, avail: null };
    $$("[data-filt] .facet").forEach((x) => x.classList.remove("is-on"));
    renderExploreResults();
  });
  renderExploreResults();
}

function passFilters(doc) {
  const f = exploreFilters;
  if (f.group && doc.group !== f.group) return false;
  if (f.provider && doc.provider !== f.provider) return false;
  if (f.freq && doc.frequency !== f.freq) return false;
  const live = isAvailable(doc.id) && doc.has_series;
  if (f.avail === "live" && !live) return false;
  if (f.avail === "catalog" && live) return false;
  return true;
}

function renderExploreResults() {
  const q = (state._q || "").trim();
  let actions = [], available = [], catalog = [];
  if (q) {
    const r = searchAll(q);
    actions = r.actions;
    available = r.available.filter((x) => passFilters(x.doc));
    catalog = r.catalog.filter((x) => passFilters(x.doc));
  } else {
    const docs = store.search.documents.filter(passFilters).map((doc) => ({ doc, meta: meta(doc.id), latest: (isAvailable(doc.id) && doc.has_series) ? latestRow(doc.id) : null }));
    const sortKey = (x) => (x.doc.priority === "core" ? 0 : x.doc.priority === "recommended" ? 1 : 2);
    docs.sort((a, b) => sortKey(a) - sortKey(b) || a.doc.title.localeCompare(b.doc.title));
    available = docs.filter((x) => isAvailable(x.doc.id) && x.doc.has_series);
    catalog = docs.filter((x) => !(isAvailable(x.doc.id) && x.doc.has_series));
  }
  $("#exCount").innerHTML = `<b>${available.length}</b> live · <b>${catalog.length}</b> catalog`;

  const cap = 50;
  let html = "";
  if (actions.length) html += bucketHead("Actions & presets", actions.length) + actions.map((a) => actionCard(a.preset)).join("");
  if (available.length) html += bucketHead("Available series", available.length) + available.slice(0, cap).map((x) => resultCard(x, q)).join("") + moreNote(available.length, cap);
  if (catalog.length) html += bucketHead("Catalog only · not fetched in this export", catalog.length) + catalog.slice(0, cap).map((x) => resultCard(x, q, true)).join("") + moreNote(catalog.length, cap);
  if (!html) html = `<div class="empty"><div class="empty__big">Nothing matches.</div><div>Try “claims”, “Beveridge curve”, “prime age”, or clear the filters.</div></div>`;
  $("#exResults").innerHTML = html;
  wireResults();
}
function moreNote(total, cap) {
  return total > cap ? `<div class="more-note">Showing ${cap} of ${total} — refine your search or add a filter to see the rest.</div>` : "";
}
function bucketHead(title, n) {
  return `<div class="bucket">${esc(title)} <span class="cnt">${n}</span><span class="ln"></span></div>`;
}

function actionCard(p) {
  return `<div class="result" data-action="${p.id}" style="cursor:pointer">
    <div class="result__avail"><span class="avail avail--preset">Preset</span></div>
    <div class="result__body">
      <div class="result__title"><span class="result__name">${esc(p.label)}</span></div>
      <div class="result__meta"><span>${esc(p.kicker)}</span><span>${p.ids.length} series</span></div>
      <div class="result__desc2">${esc(p.desc)}</div>
    </div>
    <div class="result__num"><span class="result__open">Open →</span></div>
    <div class="result__actions"><button class="actbtn actbtn--primary" data-action-open="${p.id}">Open preset</button></div>
  </div>`;
}

function resultCard(x, q, isCatalog) {
  const m = x.meta, row = x.latest;
  const fred = m.mirror ? `<span class="tag-fred">via FRED</span>` : "";
  const meta1 = esc(m.release || m.subgroup || "") || "—";
  const num = row
    ? `<div class="result__val">${fmtValue(row.value, m.units, { compact: true })}<span class="result__valunit">${unitShort(m.units) || ""}</span></div>
       <div class="result__date">${fmtDate(row.date, m.frequency)}</div>`
    : `<div class="result__val result__val--muted">Not fetched</div>
       <div class="result__date">${esc(PROVIDER_LABEL[m.provider] || m.provider)} · catalog</div>`;
  const actions = isCatalog
    ? `<button class="actbtn" data-explain="${m.id}">Explain</button>`
    : `<button class="actbtn actbtn--primary" data-add="${m.id}">+ Chart</button>
       <button class="actbtn" data-open="${m.id}">Open</button>
       <button class="actbtn actbtn--icon" data-dl="${m.id}" title="Download CSV"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
       <button class="actbtn actbtn--icon" data-explain="${m.id}" title="Explain"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6"></circle><path d="M8 7v4M8 5v.4" stroke-linecap="round"></path></svg></button>`;
  return `<div class="result ${isCatalog ? "result--catalog" : ""}" data-id="${m.id}">
    <div class="result__avail"><span class="avail ${isCatalog ? "avail--cat" : "avail--live"}">${isCatalog ? "Catalog" : "Live"}</span></div>
    <div class="result__body">
      <div class="result__title"><span class="result__name">${highlight(m.title, q)}</span>${fred}</div>
      <div class="result__meta"><span>${meta1}</span><span>${esc(geoName(m.geography))}</span></div>
      <div class="result__tags" style="margin-top:7px">
        <span class="tag tag--src">${PROVIDER_LABEL[m.provider] || m.provider}</span>
        <span class="tag">${FREQ_LABEL[m.frequency] || m.frequency}</span>
        <span class="tag">${esc(m.units)}</span>
        ${m.series_id ? `<span class="tag tag--id">${esc(m.series_id)}</span>` : ""}
        ${(m.tags || []).slice(0, 1).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
      </div>
    </div>
    <div class="result__num">${num}</div>
    <div class="result__actions">${actions}</div>
  </div>`;
}

function wireResults() {
  $$("[data-action-open]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); applyPresetState(b.dataset.actionOpen); syncURL(state); renderWorkspace(); scrollWorkspace(); }));
  $$("[data-action]").forEach((b) => b.addEventListener("click", () => { applyPresetState(b.dataset.action); syncURL(state); renderWorkspace(); scrollWorkspace(); }));
  $$("[data-open]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openSingle(b.dataset.open); }));
  $$("[data-add]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); addToChart(b.dataset.add); }));
  $$("[data-dl]").forEach((b) => b.addEventListener("click", async (e) => { e.stopPropagation(); await downloadSingle(b.dataset.dl); }));
  $$("[data-explain]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); explain(b.dataset.explain); }));
}
function scrollWorkspace() { ($("#workspaceMountExplore") || $("#workspaceMount"))?.scrollIntoView({ behavior: "smooth", block: "start" }); }

function openSingle(id) { state.ids = [id]; state.preset = null; state.special = null; state.transform = "level"; state.chart = "line"; state.present = "line"; state.axes = {}; state.combine = null; syncURL(state); renderWorkspace(); refreshChipsActive?.(); scrollWorkspace(); }
function addToChart(id) {
  if (!state.ids.includes(id)) state.ids.push(id);
  state.preset = null; state.special = null; syncURL(state); renderWorkspace(); scrollWorkspace();
  toast(`Added ${meta(id).short_title} to chart`);
}

// ============================================================ THEMES
function renderThemes(main) {
  main.innerHTML = `<section class="view">
    <div><div class="eyebrow">Curated</div><h1 class="h-title">Themes</h1>
    <p class="h-sub">Hand-built presets that answer a question rather than show a single number — each opens the chart workspace ready to compare and export.</p></div>
    <div class="section-rule"></div>
    <div class="themegrid">
      ${userThemeCard()}
      ${THEMES.map((th) => `<div class="themecard">
        <div class="themecard__h">${esc(th.title)}</div>
        <div class="themecard__d">${esc(th.desc)}</div>
        ${th.presets.map((pid) => { const p = presetById.get(pid); return p ? `<div class="preset-row" data-action="${p.id}" style="cursor:pointer">
          <span class="preset-row__name">${esc(p.label)}</span><span class="preset-row__go">${p.ids.length} series →</span></div>` : ""; }).join("")}
      </div>`).join("")}
    </div>
  </section>`;
  $$("[data-action]").forEach((b) => b.addEventListener("click", () => { applyPresetState(b.dataset.action); navigate("explore"); }));
  $$("[data-userpreset]").forEach((b) => b.addEventListener("click", () => { applyUserPreset(b.dataset.userpreset); navigate("explore"); }));
  $$("[data-delpreset]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); deleteUserPreset(b.dataset.delpreset); navigate("themes"); }));
}

function userThemeCard() {
  const u = getUserPresets();
  if (!u.length) return `<div class="themecard"><div class="themecard__h">Your presets</div>
    <div class="themecard__d">Build a chart you like, then hit <b>★ Save</b> on it. Your presets live in this browser and appear here and on Overview.</div></div>`;
  return `<div class="themecard" style="border-color:var(--accent);">
    <div class="themecard__h">★ Your presets</div>
    <div class="themecard__d">Saved in this browser. ${u.length} preset${u.length > 1 ? "s" : ""}.</div>
    ${u.map((p) => `<div class="preset-row"><span class="preset-row__name" data-userpreset="${p.id}" style="cursor:pointer;flex:1">${esc(p.name)}</span>
      <span class="preset-row__go" data-userpreset="${p.id}" style="cursor:pointer">${p.ids.length} →</span>
      <button class="serieschip__rm" data-delpreset="${p.id}" title="Delete" style="margin-left:8px">✕</button></div>`).join("")}
  </div>`;
}

// ============================================================ ABOUT
function renderAbout(main) {
  const sources = store.catalog.sources || [];
  main.innerHTML = `<section class="view prose">
    <div class="eyebrow">Provenance &amp; method</div><h1 class="h-title">About the data</h1>
    <p class="h-sub">jobgauge is a static instrument: it reads pre-built JSON exported from official statistical agencies. Nothing is computed on a server at request time.</p>

    <h3>Sources</h3>
    <table class="srctable"><thead><tr><th>Owner</th><th>Provider</th><th>Preferred for</th><th>Access</th></tr></thead><tbody>
    ${sources.map((s) => `<tr><td><b>${esc(s.owner || s.title)}</b></td><td>${esc(PROVIDER_LABEL[s.provider] || s.provider)}</td>
      <td>${esc((s.preferred_for || []).slice(0, 3).join("; ") || s.title)}</td><td>${esc(s.access || s.update_frequency || "")}</td></tr>`).join("")}
    </tbody></table>

    <h3>What's in this build</h3>
    <p>This build was generated ${fmtTimestamp(store.manifest.generated_at)} and includes <b>${store.manifest.available_indicator_ids.length}</b> live series out of <b>${store.catalog.indicators.length}</b> we track. Some series come <b>via FRED</b> (currently ${store.catalog.indicators.filter((i) => i.provider === "fred").length}) — the same numbers as the official BLS/BEA release, just fetched through FRED, and labeled wherever they appear.</p>

    <h3>How the numbers are handled</h3>
    <p>We show each agency's published figures as-is. When a month is missing, the line simply has a gap — we never fill it with a zero. The Change, % change, year-over-year, and rolling-average views are standard period comparisons; “Index” rescales each line to 100 at the start of what you're viewing so you can compare shapes. By default every line shares one vertical axis — if two series use different units, move one to the right axis (the L · R toggle in the compare tray) or switch to Index or % change.</p>

    <h3>Downloads</h3>
    <p>Every CSV, JSON, PNG, SVG, and shareable link includes where the data came from: the publishing agency, release, series ID, units, frequency, seasonal adjustment, geography, the latest observation date, and when this build was generated.</p>

    <div class="callout callout--warn" style="margin-top:18px">
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 3 18 17H2Z" stroke-linejoin="round"/><path d="M10 8v4M10 14v.5" stroke-linecap="round"/></svg>
      <span>Catalog entries that are not in this export are clearly marked <b>“Catalog only”</b> and cannot be charted — they describe series the backend knows about but did not fetch.</span>
    </div>
  </section>`;
}

// ============================================================ COMMAND PALETTE
function openPalette(mode) {
  paletteMode = mode === "add" ? "add" : "default";  // event objects (click handlers) fall through to default
  const p = $("#palette"); p.hidden = false;
  const inp = $("#paletteInput"); inp.value = "";
  inp.placeholder = paletteMode === "add"
    ? "Add a series to the chart — search title, series ID, alias…"
    : "Search indicators, presets, and actions — try “laid off”, “wage inflation”, “ICSA”…";
  const hintEnter = $("#palHintEnter"), hintAdd = $("#palHintAdd");
  if (hintEnter) hintEnter.innerHTML = paletteMode === "add" ? "<kbd>↵</kbd> add to chart" : "<kbd>↵</kbd> open (replace)";
  if (hintAdd) hintAdd.style.display = paletteMode === "add" ? "none" : "";
  inp.setAttribute("aria-expanded", "true");
  renderPaletteResults("");
  pushModal(p, inp);
}
function closePalette() {
  const p = $("#palette"); p.hidden = true;
  $("#paletteInput")?.setAttribute("aria-expanded", "false");
  popModal(p);
}

function renderPaletteResults(query) {
  const box = $("#paletteResults");
  let groups = [];
  // In add-to-chart mode (launched from the compare tray) we only offer series — presets/actions
  // would *replace* the chart, which contradicts "add to compare".
  const addMode = paletteMode === "add";
  if (!query.trim()) {
    if (!addMode) groups.push({ name: "Presets", items: PRESETS.filter((p) => p.chip).map((p) => ({ kind: "action", preset: p })) });
    groups.push({ name: addMode ? "Add a core series" : "Core series", items: store.search.documents.filter((d) => d.priority === "core" && isAvailable(d.id)).slice(0, 8).map((d) => ({ kind: "series", doc: d, meta: meta(d.id), latest: latestRow(d.id) })) });
  } else {
    const r = searchAll(query);
    if (!addMode && r.actions.length) groups.push({ name: "Actions", items: r.actions.map((a) => ({ kind: "action", preset: a.preset })) });
    if (r.available.length) groups.push({ name: "Available series", items: r.available.slice(0, 8) });
    // In add-to-compare mode, only offer addable (live) series — catalog-only rows would open
    // the Explain dialog instead of adding, which contradicts "any of these should add to chart".
    if (!addMode && r.catalog.length) groups.push({ name: "Catalog only · not fetched", items: r.catalog.slice(0, 5).map((x) => ({ ...x, catalog: true })) });
  }
  paletteItems = groups.flatMap((g) => g.items);
  paletteSel = 0;
  if (!paletteItems.length) { box.innerHTML = `<div class="palette__empty">No matches for “${esc(query)}”.<br>Try a concept like “tight labor market” or an acronym like “LFPR”.</div>`; $("#paletteCount").textContent = ""; return; }

  let idx = 0;
  box.innerHTML = groups.map((g) => `<div class="palette__group">${esc(g.name)} <span class="cnt">${g.items.length}</span></div>` +
    g.items.map((it) => paletteRow(it, idx++, query)).join("")).join("");
  $("#paletteCount").textContent = `${paletteItems.length} results`;
  $$(".presult", box).forEach((row, i) => {
    row.addEventListener("mouseenter", () => setPaletteSel(i));
    row.addEventListener("click", (e) => activatePalette(i, e.metaKey || e.ctrlKey));
  });
  // explicit per-row action buttons (clearer than relying on the ⌘↵ hotkey)
  $$("[data-pal-open]", box).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); closePalette(); openSingle(b.dataset.palOpen); }));
  $$("[data-pal-add]", box).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); closePalette(); addToChart(b.dataset.palAdd); }));
  $$("[data-pal-explain]", box).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); closePalette(); explain(b.dataset.palExplain); }));
  $$("[data-pal-preset]", box).forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation(); closePalette(); applyPresetState(b.dataset.palPreset); syncURL(state); refreshChipsActive();
    if (state.view !== "overview" && state.view !== "explore") navigate("overview"); else renderWorkspace();
    scrollWorkspace();
  }));
  setPaletteSel(0);
}

function paletteRow(it, i, query) {
  if (it.kind === "action") {
    const p = it.preset;
    return `<div class="presult" data-i="${i}" id="presult-${i}" role="option" aria-selected="false">
      <div class="presult__ico presult__ico--action">◆</div>
      <div class="presult__main"><div class="presult__title">${esc(p.label)} <span class="tag tag--src">preset</span></div>
        <div class="presult__sub">${esc(p.desc)}</div></div>
      <div class="presult__right">
        <div class="presult__valwrap"><div class="presult__avail">${p.ids.length} series</div></div>
        <div class="presult__acts"><button class="actbtn actbtn--primary" data-pal-preset="${p.id}">Open preset</button></div>
      </div></div>`;
  }
  const m = it.meta, row = it.latest;
  return `<div class="presult" data-i="${i}" id="presult-${i}" role="option" aria-selected="false">
    <div class="presult__ico">${it.catalog ? "○" : "≈"}</div>
    <div class="presult__main"><div class="presult__title">${highlight(m.title, query)} ${m.mirror ? `<span class="tag-fred">via FRED</span>` : ""}</div>
      <div class="presult__sub">${PROVIDER_LABEL[m.provider] || m.provider} · ${FREQ_LABEL[m.frequency] || m.frequency} · ${esc(m.units)}${it.catalog ? " · catalog only" : ""}</div></div>
    <div class="presult__right">
      <div class="presult__valwrap">${row ? `<div class="presult__val">${fmtValue(row.value, m.units, { compact: true })}</div><div class="presult__avail">${fmtDate(row.date, m.frequency)}</div>` : `<div class="presult__avail">not fetched</div>`}</div>
      <div class="presult__acts">
        ${it.catalog ? `<button class="actbtn" data-pal-explain="${m.id}">Explain</button>`
          : paletteMode === "add" ? `<button class="actbtn actbtn--primary" data-pal-add="${m.id}">+ Add to chart</button>`
          : `<button class="actbtn" data-pal-open="${m.id}">Open</button><button class="actbtn actbtn--primary" data-pal-add="${m.id}">+ Chart</button>`}
      </div>
    </div>
  </div>`;
}

function setPaletteSel(i) {
  paletteSel = i;
  const rows = $$(".presult");
  rows.forEach((r, k) => { const on = k === i; r.classList.toggle("is-active", on); r.setAttribute("aria-selected", on ? "true" : "false"); });
  rows[i]?.scrollIntoView({ block: "nearest" });
  $("#paletteInput")?.setAttribute("aria-activedescendant", rows[i] ? `presult-${i}` : "");
}
function paletteKeys(e) {
  // Close on the input's own keydown. Some browsers (e.g. Firefox/Safari) treat the first
  // Escape in a text field as a native "revert/clear" and swallow it, so it never reaches the
  // document-level handler — that's the "press Escape twice" symptom. preventDefault suppresses
  // the native revert and we close immediately, so one Escape always works.
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePalette(); return; }
  if (e.key === "ArrowDown") { e.preventDefault(); setPaletteSel(Math.min(paletteSel + 1, paletteItems.length - 1)); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setPaletteSel(Math.max(paletteSel - 1, 0)); }
  else if (e.key === "Enter") { e.preventDefault(); activatePalette(paletteSel, e.metaKey || e.ctrlKey); }
}
function activatePalette(i, add) {
  const it = paletteItems[i]; if (!it) return;
  closePalette();
  if (it.kind === "action") { applyPresetState(it.preset.id); syncURL(state); refreshChipsActive?.(); if (state.view !== "overview" && state.view !== "explore") navigate("overview"); else renderWorkspace(); scrollWorkspace(); return; }
  if (it.catalog) { explain(it.doc.id); return; }
  if (paletteMode === "add" || add) addToChart(it.doc.id); else openSingle(it.doc.id);
}

// ============================================================ EXPLAIN dialog (reuses sheet)
function explain(id) {
  const m = meta(id), src = store.sourceById.get(m.source_id) || {}, row = latestRow(id);
  const cell = (k, v) => `<div class="metastrip__item" style="border:none;padding:7px 0;min-width:0"><div class="metastrip__k">${k}</div><div class="metastrip__v">${esc(v)}</div></div>`;
  $("#sheetBody").innerHTML = `
    <div class="result__title" style="font-size:18px;margin-bottom:2px">${esc(m.title)} ${m.mirror ? `<span class="avail avail--mirror">via FRED</span>` : ""} ${m.available ? `<span class="avail avail--live">Live</span>` : `<span class="avail avail--cat">Catalog only</span>`}</div>
    <p style="color:var(--ink-2);font-size:13px;margin:4px 0 14px">${esc(friendlyNotes(m.description || m.notes) || "")}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 18px">
      ${cell("Latest", row ? `${fmtValue(row.value, m.units)} ${unitShort(m.units)} · ${fmtDate(row.date, m.frequency)}` : "not fetched")}
      ${cell("Units", m.units)}${cell("Frequency", FREQ_LABEL[m.frequency] || m.frequency)}${cell("Seasonal adj.", m.seasonal_adjustment || "—")}
      ${cell("Provider", (PROVIDER_LABEL[m.provider] || m.provider))}${cell("Source owner", src.owner || m.source_title || "—")}
      ${cell("Release", m.release || "—")}${cell("Series ID", m.series_id || "—")}
      ${cell("Group", `${m.group}${m.subgroup ? " · " + m.subgroup : ""}`)}${cell("Geography", geoName(m.geography))}
      ${cell("Aliases", (m.aliases || []).join(", ") || "—")}${cell("Tags", (m.tags || []).join(", ") || "—")}
    </div>
    ${m.available ? `<div style="display:flex;gap:8px;margin-top:18px"><button class="btn btn--accent" id="explainOpen">Open in chart</button><button class="btn" id="explainAdd">+ Add to compare</button></div>`
      : `<div class="callout callout--warn" style="margin-top:16px"><span>This indicator is cataloged but not fetched in the ${store.manifest.profile} export, so it can’t be charted here.</span></div>`}
    ${m.documentation_url || src.documentation_url ? `<p style="margin-top:14px;font-size:12px"><a style="color:var(--brand-2)" href="${esc(m.documentation_url || src.documentation_url)}" target="_blank" rel="noopener">Official documentation ↗</a></p>` : ""}`;
  $("#exportSheet").querySelector(".sheet__head h2").textContent = "Explain series";
  showSheet();
  $("#explainOpen")?.addEventListener("click", () => { closeSheet(); openSingle(id); });
  $("#explainAdd")?.addEventListener("click", () => { closeSheet(); addToChart(id); });
}

// ============================================================ SHARE / EXPORT SHEET
function openSheet() {
  $("#exportSheet").querySelector(".sheet__head h2").textContent = "Share & export";
  const ids = state.ids.length ? state.ids : (state.preset ? presetById.get(state.preset).ids : []);
  if (!ids.length) { $("#sheetBody").innerHTML = `<p style="color:var(--ink-2)">Open a chart first, then export it here.</p>`; showSheet(); return; }
  const link = encodeState(state, { full: true });
  const opt = (ico, t, d, act) => `<button class="export-opt" data-exp="${act}"><span class="export-opt__ico">${ico}</span><span><span class="export-opt__t">${t}</span><span class="export-opt__d">${d}</span></span></button>`;
  $("#sheetBody").innerHTML = `
    <div class="export-grid">
      ${opt("CSV", "Download CSV", "One row per observation", "csv")}
      ${opt("{ }", "Download JSON", "State, metadata & values", "json")}
      ${opt("PNG", "Export PNG", "Chart image · 2× retina", "png")}
      ${opt("SVG", "Export SVG", "Vector chart", "svg")}
    </div>
    <div style="margin-top:16px"><div class="sheet__label">Shareable link</div>
      <div class="linkrow"><input id="shareLink" readonly value="${esc(link)}"><button class="btn btn--accent" id="copyLink">Copy</button></div></div>
    <div class="provenance">Every download keeps the full trail: <b>publishing agency · release · series ID · units · frequency · seasonal adjustment · geography · latest observation date · build date</b>.</div>`;
  showSheet();
  $$("[data-exp]").forEach((b) => b.addEventListener("click", () => doExport(b.dataset.exp)));
  $("#copyLink")?.addEventListener("click", async () => { (await copyText(link)) ? toast("Link copied") : toast("Copy failed"); });
}
function showSheet() { const s = $("#exportSheet"); s.hidden = false; pushModal(s); }
function closeSheet() { const s = $("#exportSheet"); s.hidden = true; popModal(s); }

// The CSV/JSON export carries the numbers the chart is actually showing. In Share % that's each
// series' share (not its level). A derived line (a − b, etc.) is appended as its own series with
// its name/unit. Everything else exports the transformed series as-is.
function renderedSeriesForExport(view) {
  const present = isLineFamily(view) ? currentPresent(view) : "line";
  let list;
  if (present === "share") {
    const shareData = toShare(view.series.map((s) => s.data));
    list = view.series.map((s, i) => ({
      meta: { ...s.meta, units: "Percent (share of total)", short_title: `${s.meta.short_title} (share)`, title: `${s.meta.title} — share of total` },
      viewObs: shareData[i].map(([date, value]) => [date, null, value]) }));
  } else {
    list = view.series.map((s) => ({ meta: s.meta, viewObs: s.viewObs }));
  }
  if (view.derived) {
    const d = view.derived;
    list.push({ meta: { ...d.meta, id: "derived_series", series_id: `(derived: ${combineExpr(view.combine) || ""})` }, viewObs: d.viewObs });
  }
  return list;
}

async function doExport(kind) {
  if (!lastView || !lastView.series.length) return;
  const present = isLineFamily(lastView) ? currentPresent(lastView) : "line";
  const view = { transform: state.transform, range: state.range, chartType: state.chart, rec: state.rec, log: state.log, present };
  const series = renderedSeriesForExport(lastView);
  if (kind === "csv") { exportCSV(series, view); toast("CSV downloaded"); }
  else if (kind === "json") { exportJSON(series, view); toast("JSON downloaded"); }
  else if (kind === "png" || kind === "svg") {
    const m = lastView.series[0].meta, row = latestRow(m.id);
    const info = { id: m.id, title: lastView.preset && lastView.ids.length > 1 ? lastView.preset.label : m.title,
      source: lastView.series.map((s) => `${s.meta.short_title} — ${(store.sourceById.get(s.meta.source_id) || {}).owner || s.meta.provider}${s.meta.mirror ? " (FRED mirror)" : ""}`).join("  ·  "),
      latest: row ? fmtDate(row.date, m.frequency) : "—", generated: fmtTimestamp(store.manifest.generated_at), profile: store.manifest.profile };
    const opt = cleanExportOption();
    if (!opt) { toast("Switch to a single chart (not small multiples) to export an image"); closeSheet(); return; }
    if (kind === "png") { exportPNG(opt, info); toast("PNG exported"); }
    else { exportSVG(opt, info); toast("SVG exported"); }
  }
  closeSheet();
}

// A static-image-friendly copy of the live chart option: keep the current zoom window but hide
// the range slider (the "dynamic timeline"), reclaim its bottom margin, and disable animation so
// the off-screen render captures the final frame immediately.
function cleanExportOption() {
  if (!chart) return null;
  const o = chart.getOption();
  const hadSlider = Array.isArray(o.dataZoom) && o.dataZoom.some((z) => z.type === "slider" && z.show !== false);
  if (Array.isArray(o.dataZoom)) o.dataZoom = o.dataZoom.map((z) => ({ ...z, show: false }));
  if (hadSlider) {
    const shrink = (g) => ({ ...g, bottom: 34 });
    o.grid = Array.isArray(o.grid) ? o.grid.map(shrink) : (o.grid ? shrink(o.grid) : o.grid);
  }
  o.animation = false;
  return o;
}

async function downloadSingle(id) {
  const m = meta(id), series = await loadSeries(id);
  if (!series) { toast("No series file for this indicator"); return; }
  const vis = filterRange(series.observations, "all");
  const t = applyTransform(vis, "level", m.frequency);
  exportCSV([{ meta: m, viewObs: vis.map((o, k) => [o.date, num(o.value), t[k][1]]) }],
    { transform: "level", range: "all", chartType: "line" });
  toast(`Downloaded ${m.short_title}`);
}

// ============================================================ modal focus management
// Trap Tab within the top-most open overlay, make the background (#app) inert while a modal
// is open, and restore focus to the invoking control on close — WAI-ARIA modal behavior,
// zero-build. The palette, export sheet, and focus overlay all route through this.
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const modalStack = [];
function focusablesIn(root) { return $$(FOCUSABLE, root).filter((el) => !el.disabled && el.getClientRects().length); }
function pushModal(el, initial) {
  modalStack.push({ el, returnTo: document.activeElement });
  $("#app")?.setAttribute("inert", "");
  requestAnimationFrame(() => { (initial || focusablesIn(el)[0] || el)?.focus?.(); });
}
function popModal(el) {
  const i = modalStack.map((m) => m.el).lastIndexOf(el);
  const entry = i >= 0 ? modalStack.splice(i, 1)[0] : null;
  if (!modalStack.length) $("#app")?.removeAttribute("inert");
  entry?.returnTo?.focus?.();
}
function trapTab(e) {
  if (e.key !== "Tab" || !modalStack.length) return;
  const els = focusablesIn(modalStack[modalStack.length - 1].el);
  if (!els.length) return;
  const first = els[0], last = els[els.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ============================================================ utils
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function round1(v) { return v == null ? 0 : Math.round(v * 10) / 10; }
function cssvar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function hasNonPositive(view) { return view.series.some((s) => s.data.some((d) => d[1] != null && d[1] <= 0)); }
function transformAvailabilityAll(series) {
  const out = {};
  for (const t of TRANSFORMS) out[t.key] = { ok: true, reason: "" };
  for (const s of series) {
    const a = transformAvailability(s.full, s.meta.units, s.meta.frequency);
    for (const t of TRANSFORMS) if (!a[t.key].ok) { out[t.key] = { ok: false, reason: a[t.key].reason }; }
  }
  return out;
}
let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove("show"); setTimeout(() => (t.hidden = true), 300); }, 2200);
}
