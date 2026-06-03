// search.js — field-aware fuzzy search + deterministic intent scorer + presets.
// Corpus = search/index.json documents. Availability = manifest (via store).

import { store, isAvailable, latestRow, meta } from "./store.js";

// ---------------- PRESETS ----------------
// `special` drives the chart builder; `chip` shows it on the Overview rail.
export const PRESETS = [
  // --- Overview pills (chip: true) — ordered as they appear in the top row ---
  { id: "labor_market_now", label: "Labor market now", chip: true, theme: "jobs",
    kicker: "Pulse", desc: "Headline unemployment with recession context — the single most-watched gauge of labor-market slack.",
    ids: ["unemployment_rate"], chartType: "line", transform: "level", range: "10y" },

  { id: "jobs_report", label: "Jobs report", chip: true, theme: "jobs",
    kicker: "Monthly · payrolls", desc: "Net jobs added each month — the headline figure from the Employment Situation. Total nonfarm and private payrolls shown as month-over-month change.",
    ids: ["total_nonfarm_payrolls", "total_private_payrolls"], chartType: "line", transform: "change", range: "5y" },

  { id: "claims_pressure", label: "Claims pressure", chip: true, theme: "slack", special: "claims",
    kicker: "Weekly", desc: "Initial and continued unemployment-insurance claims — the highest-frequency read on layoffs. Shown as 4-week moving averages.",
    ids: ["initial_claims_sa", "continued_claims_sa"], chartType: "line", transform: "rolling", range: "5y" },

  { id: "wage_inflation", label: "Wages vs inflation", chip: true, theme: "wages",
    kicker: "Year-over-year", desc: "Nominal average hourly earnings against consumer prices, both as year-over-year growth — the honest way to ask whether pay is keeping up.",
    ids: ["average_hourly_earnings_total_private", "cpi_all_urban_consumers"], chartType: "line", transform: "yoy", range: "10y" },

  { id: "job_openings", label: "Job openings & hiring", chip: true, theme: "jobs",
    kicker: "JOLTS · levels", desc: "Job openings, hires, and quits from JOLTS — vacancies posted, people hired, and people quitting. Together they read labor demand and worker confidence.",
    ids: ["job_openings_level", "hires_level", "quits_level"], chartType: "line", transform: "level", range: "all" },

  { id: "prime_age", label: "Prime-age workers", chip: true, theme: "demographics",
    kicker: "25–54", desc: "Prime-age employment-population ratio and participation — a cleaner gauge of labor supply that strips out aging and schooling effects.",
    ids: ["prime_age_employment_population_ratio", "prime_age_labor_force_participation_rate"], chartType: "line", transform: "level", range: "10y" },

  { id: "demo_gap", label: "Black vs White unemployment", chip: true, theme: "demographics",
    kicker: "Gap", desc: "Black and White unemployment side by side, with the gap between them. The gap typically widens in downturns and narrows in tight labor markets. The gap line is a derived series — edit or remove it in the Combine panel.",
    ids: ["unemployment_rate_black", "unemployment_rate_white"], chartType: "line", transform: "level", range: "all",
    combine: { opKey: "diff", expr: null, name: "Black − White gap" } },

  // --- Themes / search only (no chip) ---
  { id: "beveridge", label: "Beveridge curve", theme: "slack", special: "beveridge",
    kicker: "Paired", desc: "Unemployment rate against the job-openings rate, traced through time. Outward shifts signal a less efficient match between workers and jobs.",
    ids: ["unemployment_rate", "job_openings_rate"], chartType: "scatter", transform: "level", range: "all" },

  { id: "payrolls_industry", label: "Payrolls by industry", theme: "jobs", special: "industry_bar",
    kicker: "12-month change", desc: "Year-over-year change in payroll employment across major industries (fetched subset).",
    ids: ["payrolls_manufacturing", "payrolls_construction", "payrolls_leisure_hospitality", "payrolls_government"],
    note: "6 further industry payroll series are cataloged but not fetched in this export.",
    chartType: "bar", transform: "level", range: "1y" },

  { id: "hours", label: "Hours worked", theme: "jobs",
    kicker: "Weekly · early signal", desc: "Average weekly hours for all private employees. Employers tend to cut (or add) hours before headcount, so hours often turn before payrolls.",
    ids: ["average_weekly_hours_total_private"], chartType: "line", transform: "level", range: "10y" },

  { id: "unemp_education", label: "Unemployment by education", theme: "demographics",
    kicker: "25+ · by schooling", desc: "Unemployment rate by educational attainment, from less than high school to a bachelor's degree or higher — one of the strongest predictors of who loses work in a downturn.",
    ids: ["unemployment_rate_less_than_high_school", "unemployment_rate_high_school_no_college", "unemployment_rate_some_college_associate", "unemployment_rate_bachelors_higher"],
    chartType: "line", transform: "level", range: "all" },

  { id: "unemp_race", label: "Unemployment by race", theme: "demographics",
    kicker: "By race & ethnicity", desc: "Unemployment rate for Black, White, Hispanic, and Asian workers. Gaps persist across the cycle and typically widen when the labor market weakens.",
    ids: ["unemployment_rate_black", "unemployment_rate_white", "unemployment_rate_hispanic", "unemployment_rate_asian"],
    chartType: "line", transform: "level", range: "all" },

  { id: "unemp_reasons", label: "Why people are unemployed", theme: "slack",
    kicker: "Reason for joblessness", desc: "Unemployment by reason: job losers, voluntary leavers, reentrants, and new entrants. Job losers spike in recessions; leavers reflect worker confidence. Try the Share % view.",
    ids: ["unemployment_level_job_losers", "unemployment_level_job_leavers", "unemployment_level_reentrants", "unemployment_level_new_entrants"],
    chartType: "line", transform: "level", range: "all" },

  { id: "hidden_slack", label: "Hidden slack", theme: "slack",
    kicker: "Beyond the U-3", desc: "Slack the headline rate misses: the long-term unemployed (27+ weeks), people working part-time who want full-time, and those who want a job but aren't actively looking.",
    ids: ["long_term_unemployed_27_weeks_over", "part_time_for_economic_reasons", "not_in_labor_force_want_job_now"],
    chartType: "line", transform: "level", range: "all" },

  { id: "inflation", label: "Inflation: CPI vs PCE", theme: "wages",
    kicker: "Year-over-year", desc: "The two main inflation gauges side by side: headline CPI and the Fed's preferred PCE price index, as year-over-year growth — context for whether pay is keeping up.",
    ids: ["cpi_all_urban_consumers", "pce_price_index"], chartType: "line", transform: "yoy", range: "10y" },

  { id: "labor_slack", label: "U-3 vs U-6 slack", theme: "slack",
    kicker: "Underemployment", desc: "The headline unemployment rate against the broader U-6 measure that counts discouraged and involuntarily part-time workers.",
    ids: ["unemployment_rate", "u6_underemployment_rate"], chartType: "line", transform: "level", range: "all" },

  { id: "quits_layoffs", label: "Quits vs layoffs", theme: "jobs",
    kicker: "JOLTS", desc: "Quits (worker confidence) against layoffs and discharges (employer distress). The two tell opposite sides of the turnover story.",
    ids: ["quits_rate", "layoffs_discharges_rate"], chartType: "line", transform: "level", range: "all" },

  { id: "participation", label: "Participation & EPOP", theme: "demographics",
    kicker: "Supply", desc: "Labor-force participation and the employment-population ratio for the civilian population 16 and over.",
    ids: ["labor_force_participation_rate", "employment_population_ratio"], chartType: "line", transform: "level", range: "all" },

  { id: "productivity", label: "Productivity & unit labor costs", theme: "wages",
    kicker: "Quarterly", desc: "Nonfarm-business labor productivity and unit labor costs, year-over-year.",
    ids: ["labor_productivity_nonfarm_business", "unit_labor_cost_nonfarm_business"], chartType: "line", transform: "yoy", range: "10y" },

  { id: "state_unemp_map", label: "State unemployment (map)", theme: "state", special: "state_map",
    kicker: "State & local", desc: "Unemployment rate by state on a U.S. map — warmer means higher unemployment. Hover any state for its rate and one-month change.",
    ids: ["laus_state_unemployment_template"], chartType: "map", transform: "level", range: "1y" },

  { id: "state_unemp", label: "State unemployment (ranked)", theme: "state", special: "state_table",
    kicker: "State & local", desc: "State unemployment rates ranked highest to lowest, with a one-month change column — the same data as the map, read as a list.",
    ids: ["laus_state_unemployment_template"], chartType: "table", transform: "level", range: "1y" },

  { id: "flows", label: "Labor-market flows", theme: "flows",
    kicker: "CPS", desc: "Monthly gross flows between employment, unemployment, and out of the labor force.",
    ids: ["cps_flow_unemployed_to_employed", "cps_flow_employed_to_unemployed", "cps_flow_not_in_labor_force_to_employed"],
    chartType: "line", transform: "level", range: "5y" },
];
export const presetById = new Map(PRESETS.map((p) => [p.id, p]));

export const THEMES = [
  { id: "slack", title: "Labor slack", desc: "How much spare capacity is in the labor market.",
    presets: ["labor_slack", "claims_pressure", "beveridge", "unemp_reasons", "hidden_slack"] },
  { id: "jobs", title: "Jobs & demand", desc: "Hiring, openings, and where the jobs are.",
    presets: ["labor_market_now", "jobs_report", "job_openings", "quits_layoffs", "payrolls_industry", "hours"] },
  { id: "wages", title: "Wages, prices & productivity", desc: "Pay, the cost of living, and what an hour of work produces.",
    presets: ["wage_inflation", "inflation", "productivity"] },
  { id: "demographics", title: "Demographics", desc: "Who is working, and the gaps between groups.",
    presets: ["demo_gap", "unemp_race", "unemp_education", "prime_age", "participation"] },
  { id: "flows", title: "Flows", desc: "Movement between employment, unemployment, and the sidelines.",
    presets: ["flows"] },
  { id: "state", title: "State & local", desc: "Geography of the labor market.",
    presets: ["state_unemp_map", "state_unemp"] },
];

// ---------------- INTENT / SYNONYM EXPANSIONS ----------------
// token -> extra search terms (handles acronyms the haystack may under-index)
const SYNONYMS = {
  lfpr: ["labor", "force", "participation"], epop: ["employment", "population", "ratio"],
  jolts: ["job", "openings", "quits", "hires", "layoffs"], qcew: ["quarterly", "census", "employment", "wages"],
  qwi: ["quarterly", "workforce", "indicators"], cps: ["household"], ces: ["payroll", "establishment"],
  eci: ["employment", "cost", "index"], icsa: ["initial", "claims"], ccsa: ["continued", "claims"],
  nfp: ["nonfarm", "payrolls"], ahe: ["average", "hourly", "earnings"], pce: ["pce", "price"],
  u3: ["unemployment", "rate"], "u-3": ["unemployment", "rate"], u6: ["underemployment"], "u-6": ["underemployment"],
  vacancies: ["job", "openings"], "help": ["job", "openings"], laidoff: ["layoffs", "discharges"],
};

// phrase intents -> presets + indicator ids to surface as Actions / boosts
const INTENTS = [
  { rx: /\bjobs?\s*report\b|\bnonfarm\b|\bpayrolls?\b|\bjobs added\b|\bnfp\b|\bemployment situation\b|\bces\b/, presets: ["jobs_report", "payrolls_industry"], ids: ["total_nonfarm_payrolls", "total_private_payrolls"] },
  { rx: /\b(jobless|unemployment)?\s*claims\b|\bicsa\b|\bccsa\b|\bui claims\b/, presets: ["claims_pressure"], ids: ["initial_claims_sa", "continued_claims_sa"] },
  { rx: /\blaid(\s*off)?\b|\blayoffs?\b|\bjob loss(es)?\b|\bdischarge/, presets: ["quits_layoffs"], ids: ["layoffs_discharges_rate", "layoffs_discharges_level"] },
  { rx: /\bvacanc|\bhelp wanted\b|\bopenings?\b|\bjolts\b|\bhir(e|es|ing)\b|\bquits?\b|\bturnover\b/, presets: ["job_openings", "beveridge"], ids: ["job_openings_level", "hires_level", "quits_level"] },
  { rx: /\bprime[\s-]?age\b|\b25[\s-]?(to|–|-)?[\s-]?54\b/, presets: ["prime_age"], ids: ["prime_age_employment_population_ratio"] },
  { rx: /\btight\b|\bbeveridge\b|\bmismatch\b/, presets: ["beveridge"], ids: ["unemployment_rate", "job_openings_rate"] },
  { rx: /\bwage(s)?\s*(after|vs|versus|and)?\s*inflation\b|\breal wage|\bwage inflation\b|\bpurchasing power\b/, presets: ["wage_inflation"], ids: ["average_hourly_earnings_total_private", "cpi_all_urban_consumers"] },
  { rx: /\binflation\b|\bcpi\b|\bpce\b|\bprices?\b|\bcost of living\b/, presets: ["inflation", "wage_inflation"], ids: ["cpi_all_urban_consumers", "pce_price_index"] },
  { rx: /\beducation\b|\bdegree\b|\bcollege\b|\bbachelor|\bhigh school\b|\bschooling\b|\bdiploma\b/, presets: ["unemp_education"], ids: ["unemployment_rate_bachelors_higher", "unemployment_rate_less_than_high_school"] },
  { rx: /\bby race\b|\bhispanic\b|\basian\b|\bethnicit|\bracial\b/, presets: ["unemp_race", "demo_gap"], ids: ["unemployment_rate_hispanic", "unemployment_rate_asian"] },
  { rx: /\bblack\b.*\bwhite\b|\bracial\b.*\bgap\b|\bunemployment gap\b/, presets: ["demo_gap", "unemp_race"], ids: ["unemployment_rate_black", "unemployment_rate_white"] },
  { rx: /\bjob losers?\b|\bjob leavers?\b|\breentrant|\bnew entrant|\breason(s)?\s*(for|of)?\s*unemploy/, presets: ["unemp_reasons"], ids: ["unemployment_level_job_losers", "unemployment_level_job_leavers"] },
  { rx: /\bhours\b|\bweekly hours\b|\bovertime\b|\bworkweek\b/, presets: ["hours"], ids: ["average_weekly_hours_total_private"] },
  { rx: /\bstate\b|\bby state\b|\blocal\b|\bgeograph|\blaus\b|\bmap\b|\bchoropleth\b/, presets: ["state_unemp_map", "state_unemp"], ids: [] },
  { rx: /\bproductivity\b|\bunit labor cost\b/, presets: ["productivity"], ids: ["labor_productivity_nonfarm_business"] },
  { rx: /\blong[\s-]?term unemploy|\bpart[\s-]?time\b|\bdiscouraged\b|\bwant a job\b|\binvoluntary\b/, presets: ["hidden_slack"], ids: ["long_term_unemployed_27_weeks_over", "part_time_for_economic_reasons"] },
  { rx: /\bslack\b|\bu-?6\b|\bunderemploy/, presets: ["labor_slack", "hidden_slack"], ids: ["u6_underemployment_rate"] },
];

const STATE_HINT = /\bstate|\blocal|\bby state\b|\bgeograph|\blaus\b/;

function norm(s) { return (s || "").toLowerCase().trim(); }
function tokenize(s) { return norm(s).split(/[^a-z0-9-]+/).filter(Boolean); }

// Damerau–Levenshtein distance from `a` to the CLOSEST PREFIX of `b`, so a short
// typo can match the start of a longer word ("uun" -> "un(employment)", dist 1).
function prefixEditDist(a, b) {
  const n = a.length, m = b.length;
  if (!n) return 0;
  let prev2 = null, prev = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1);
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
    }
    prev2 = prev; prev = cur;
  }
  let best = 99;
  for (let j = 1; j <= m; j++) if (prev[j] < best) best = prev[j]; // min over all prefix lengths
  return best;
}

// typo-tolerant: does token `t` match a word (or its prefix) in `words` within a small
// edit budget? 1 edit for short tokens, 2 for longer ones. Handles transpositions too.
function fuzzyHit(t, words) {
  const budget = t.length <= 4 ? 1 : 2;
  for (const w of words) {
    if (w.length < t.length - budget) continue; // too short to hold a near-prefix of t
    if (prefixEditDist(t, w) <= budget) return true;
  }
  return false;
}

function scoreDoc(doc, q, tokens, stateMode) {
  const id = norm(doc.id), title = norm(doc.title), shortT = norm(doc.short_title);
  const seriesId = norm(doc.series_id), hay = doc.haystack || "";
  const aliases = (doc.aliases || []).map(norm), tags = (doc.tags || []).map(norm);
  const boost = (doc.boost_terms || []).map(norm);
  // high-signal words for typo-tolerant matching: title/short-title/aliases/tags/boost terms
  // (curated fields — not the full haystack, which would over-match).
  const fuzzyWords = [...new Set((title + " " + shortT + " " + aliases.join(" ") + " " + tags.join(" ") + " " + boost.join(" ")).split(/[^a-z0-9]+/).filter((w) => w.length >= 3))];
  let s = 0, strong = 0, exactHit = false;

  if (id === q) { s += 1000; exactHit = true; }
  if (seriesId && seriesId === q) { s += 900; exactHit = true; }
  if (title === q || shortT === q) { s += 650; exactHit = true; }
  if (aliases.includes(q)) { s += 520; exactHit = true; }
  if (q.length >= 3 && (title.startsWith(q) || shortT.startsWith(q))) { s += 200; exactHit = true; }
  if (q.length >= 3 && (title.includes(q) || shortT.includes(q))) { s += 110; exactHit = true; }

  // strong = real lexical match (substring/alias/tag); fuzzy is a weak tiebreaker only
  let matchedStrong = 0;
  for (const t of tokens) {
    let hit = 0, st = false;
    if (title.includes(t) || shortT.includes(t)) { hit = 34; st = true; }
    else if (aliases.some((a) => a.includes(t)) || boost.includes(t)) { hit = 24; st = true; }
    else if (tags.includes(t)) { hit = 20; st = true; }
    else if (hay.includes(t)) { hit = 16; st = true; }
    else if (t.length >= 3 && fuzzyHit(t, fuzzyWords)) { hit = 15; st = true; } // typo-tolerant ("uun" -> unemployment)
    if (st) { strong++; matchedStrong++; }
    s += hit;
  }
  // acronym / concept synonyms (LFPR -> labor force participation): only counts
  // when the FULL concept is present, so it can't match every "labor" doc.
  for (const t of tokens) {
    const syns = SYNONYMS[t]; if (!syns) continue;
    const present = syns.filter((w) => hay.includes(w)).length;
    if (present === syns.length) { s += 30; strong++; }
    else if (present >= Math.ceil(syns.length / 2)) s += 7;
  }

  if (tokens.length && matchedStrong === tokens.length) s += 40; // phrase-quality bonus

  // a doc must have a real (strong/exact) hit — ranking boosts below cannot
  // rescue a doc that only fuzzy-subsequence-matched a long haystack.
  if (!exactHit && strong === 0) return 0;
  if (s < 15) return 0;

  // ranking signals
  if (isAvailable(doc.id) && doc.has_series) s += 32;
  if (doc.priority === "core") s += 26; else if (doc.priority === "recommended") s += 8;
  const national = (doc.geography || "US") === "US";
  if (stateMode) { if (!national) s += 24; } else if (national) s += 7;
  if (doc.provider === "fred") s -= 2; // gentle preference for origin-source docs on ties
  return s;
}

// returns { actions:[{preset}], available:[{doc,score,latest}], catalog:[...], total }
export function searchAll(query) {
  const q = norm(query);
  if (!q) return { actions: [], available: [], catalog: [], total: 0, query: q };
  const tokens = tokenize(q);
  const stateMode = STATE_HINT.test(q);

  // intent-matched presets -> actions, and id boosts
  const actionPresetIds = new Set();
  const idBoost = new Set();
  for (const intent of INTENTS) {
    if (intent.rx.test(q)) {
      intent.presets.forEach((p) => actionPresetIds.add(p));
      intent.ids.forEach((i) => idBoost.add(i));
    }
  }
  // also let preset labels match directly
  for (const p of PRESETS) {
    if (norm(p.label).includes(q) || tokens.every((t) => norm(p.label + " " + p.desc).includes(t)) && tokens.length) {
      if (norm(p.label).includes(q)) actionPresetIds.add(p.id);
    }
  }

  const actions = [...actionPresetIds].map((id) => presetById.get(id)).filter(Boolean)
    .map((preset) => ({ preset }));

  const scored = [];
  for (const doc of store.search.documents) {
    let s = scoreDoc(doc, q, tokens, stateMode);
    if (idBoost.has(doc.id)) s += 130;
    if (s > 14) scored.push({ doc, score: s });
  }
  scored.sort((a, b) => b.score - a.score);

  const available = [], catalog = [];
  for (const r of scored) {
    const live = isAvailable(r.doc.id) && r.doc.has_series;
    const row = live ? latestRow(r.doc.id) : null;
    const item = { doc: r.doc, score: r.score, latest: row, meta: meta(r.doc.id) };
    (live ? available : catalog).push(item);
  }
  return { actions, available, catalog, total: available.length + catalog.length, query: q };
}

// highlight the query phrase within a title
export function highlight(text, query) {
  const q = norm(query);
  if (!q) return escapeHtml(text);
  const i = norm(text).indexOf(q);
  if (i < 0) return escapeHtml(text);
  return escapeHtml(text.slice(0, i)) + "<span class='hl'>" + escapeHtml(text.slice(i, i + q.length)) + "</span>" + escapeHtml(text.slice(i + q.length));
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
