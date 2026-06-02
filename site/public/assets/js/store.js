// store.js — loads the real backend JSON contract and exposes lookups.
// Availability source of truth = manifest.available_indicator_ids.

const DATA = "data/";

export const store = {
  catalog: null,       // {indicators, sources}
  manifest: null,
  latest: null,        // {observations}
  search: null,        // {documents}
  byId: new Map(),     // indicator_id -> catalog indicator
  docById: new Map(),  // indicator_id -> search doc
  latestById: new Map(), // indicator_id -> [rows]
  availableSet: new Set(),
  sourceById: new Map(),
  seriesCache: new Map(),
};

export async function boot() {
  const [catalog, manifest, latest, search] = await Promise.all([
    fetchJSON(DATA + "catalog.json"),
    fetchJSON(DATA + "manifest.json"),
    fetchJSON(DATA + "latest.json"),
    fetchJSON("search/index.json"),
  ]);
  store.catalog = catalog;
  store.manifest = manifest;
  store.latest = latest;
  store.search = search;

  for (const ind of catalog.indicators) store.byId.set(ind.id, ind);
  for (const src of catalog.sources || []) store.sourceById.set(src.id, src);
  for (const doc of search.documents) store.docById.set(doc.id, doc);
  for (const id of manifest.available_indicator_ids) store.availableSet.add(id);

  for (const obs of latest.observations) {
    const arr = store.latestById.get(obs.indicator_id) || [];
    arr.push(obs);
    store.latestById.set(obs.indicator_id, arr);
  }
  return store;
}

async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

export function isAvailable(id) { return store.availableSet.has(id); }
export function isMirror(id) {
  const ind = store.byId.get(id);
  return ind && ind.provider === "fred";
}

// the headline latest row for an indicator (US/national first, else first row)
export function latestRow(id) {
  const rows = store.latestById.get(id);
  if (!rows || !rows.length) return null;
  return rows.find((r) => r.geo_id === "US" || r.geography === "US") || rows[0];
}
export function latestRows(id) { return store.latestById.get(id) || []; }

// Fetch (and cache) a full series file. Returns {indicator, observations} or null.
export async function loadSeries(id) {
  if (store.seriesCache.has(id)) return store.seriesCache.get(id);
  const path = store.manifest.series_file_by_indicator[id];
  if (!path) { store.seriesCache.set(id, null); return null; }
  try {
    const json = await fetchJSON(DATA + path);
    store.seriesCache.set(id, json);
    return json;
  } catch (e) {
    console.warn("series load failed", id, e);
    store.seriesCache.set(id, null);
    return null;
  }
}

// merged catalog + search-doc metadata view used across the UI
export function meta(id) {
  const ind = store.byId.get(id) || {};
  const doc = store.docById.get(id) || {};
  return {
    id,
    title: ind.title || doc.title || id,
    short_title: ind.short_title || doc.short_title || ind.title || id,
    description: doc.description || ind.notes || "",
    units: ind.units || doc.units || "",
    frequency: ind.frequency || doc.frequency || "",
    seasonal_adjustment: ind.seasonal_adjustment || doc.seasonal_adjustment || "",
    provider: ind.provider || doc.provider || "",
    source_id: ind.source_id || doc.source_id || "",
    source_title: doc.source_title || (store.sourceById.get(ind.source_id)?.title) || "",
    series_id: ind.series_id || doc.series_id || "",
    release: ind.release || doc.release || "",
    group: ind.group || doc.group || "",
    subgroup: ind.subgroup || doc.subgroup || "",
    priority: ind.priority || doc.priority || "",
    geography: ind.geography || doc.geography || "US",
    tags: ind.tags || doc.tags || [],
    aliases: ind.aliases || doc.aliases || [],
    chart: ind.chart || doc.chart || {},
    documentation_url: ind.documentation_url || doc.documentation_url || null,
    source_url: ind.source_url || null,
    notes: ind.notes || "",
    available: isAvailable(id),
    mirror: isMirror(id),
  };
}

// NBER recession ranges. The last three are confirmed exactly by the
// backend's recession_indicator_monthly series (which only starts 2000);
// the 1990–91 band is the canonical NBER date the series does not cover.
export const RECESSIONS = [
  { from: "1990-07-01", to: "1991-03-01" },
  { from: "2001-03-01", to: "2001-11-01" },
  { from: "2007-12-01", to: "2009-06-01" },
  { from: "2020-02-01", to: "2020-04-01" },
];
