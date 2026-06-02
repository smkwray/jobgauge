# jobgauge local data tools — failure modes and mitigations

## 1. Stale clone

**Symptom:** latest dates are older than expected, indicators are missing, or `git pull` has not been run.

**Mitigation:** The README tells the agent to `git pull` before answering. The CLI `doctor` reports `generated_at`, profile, catalog counts, latest-row counts, missing series, and FRED-origin warnings.

## 2. Wrong export profile

**Symptom:** `doctor` shows `profile: hosted` or FRED mirror rows/metadata. The attached sample bundle is hosted, but the offline redistributable clone should be origin-only.

**Mitigation:** `doctor --require-origin-only` marks hosted/FRED exports as not OK. `AGENTS.md` instructs the agent to warn and not package hosted/FRED data as the offline redistributable version. The tool itself never fetches FRED.

## 3. Sparse or incomplete checkout

**Symptom:** `manifest.json` references a series path that is not present. This can happen in samples or a bad export.

**Mitigation:** `doctor` reports missing files. `search --available-only` can restrict to series that are physically present. If a command fails, the error names the missing series path.

## 4. Question outside the data

**Symptom:** search returns no relevant indicator, or the user asks for a concept not bundled in jobgauge.

**Mitigation:** The agent must say the bundled data do not contain that item, then show the closest local search results. It must not call live APIs at query time unless the user explicitly asks for outside context.

## 5. Agent hallucinates a number

**Symptom:** prose contains values not supported by CLI output.

**Mitigation:** `AGENTS.md` requires the agent to run CLI commands for numbers and cite indicator id, series id, source/provider, units, frequency, seasonal adjustment, geography, and observation date. JSON output includes metadata and truncation flags.

## 6. Units or transformations misinterpreted

**Symptom:** percentage changes are described as percentage points, or indexed series are described incorrectly.

**Mitigation:** Transform labels and units are emitted by the CLI. `field` and `transform_field` show which precomputed column was used. `indexed` is recomputed from the visible range; use `--field index_first_100` for the precomputed whole-series index.

## 7. Cross-series misalignment

**Symptom:** ratio/diff/share uses mismatched dates.

**Mitigation:** `combine` aligns by observation date and returns null when any input is missing or non-finite. It includes the formula and input metadata.

## 8. Panel/state geography ambiguity

**Symptom:** user asks for “CA” or “Washington” and the wrong geography is selected.

**Mitigation:** The CLI accepts state names, postal abbreviations, and `state:<FIPS>` IDs. For ambiguous prose, the agent should show the CLI command it used. Output includes geo labels and series ids.

## 9. macOS permission denial

**Symptom:** Codex/Claude cannot read the repo or write an export.

**Mitigation:** Keep the repo in a normal user folder if possible. If macOS blocks a protected folder, use System Settings → Privacy & Security → Files & Folders for the app or terminal. Use Full Disk Access only if a narrower permission fails. Apple documents that apps may need explicit permission for Desktop/Documents/Downloads and that full-storage access must be granted in Privacy & Security.

## 10. Python not found or too old

**Symptom:** `python3` is missing or below 3.10.

**Mitigation:** The bootstrap script fails with a clear message. The agent installs Python 3.10+ once using an approved path, then reruns bootstrap. The CLI has no package dependencies.

## 11. Codex vs Claude instruction-loading gap

**Symptom:** Codex follows `AGENTS.md`, but Claude ignores it.

**Mitigation:** `CLAUDE.md` imports `@AGENTS.md`. Anthropic documents that Claude Code reads `CLAUDE.md`, not `AGENTS.md`, and recommends this import pattern.

## 12. Claude Desktop confusion

**Symptom:** User opens ordinary Claude chat instead of Claude Code Desktop Code tab.

**Mitigation:** The README says to use Claude Code / Code tab and select the local project folder. Claude Code Desktop local sessions include an integrated terminal; plain chat without Code/local tools cannot reliably run the CLI.

## 13. Sandbox/approval friction

**Symptom:** The agent repeatedly asks permission to run safe local commands.

**Mitigation:** Codex can run in workspace-write with on-request approvals. Claude Code can use sandboxed Bash or Ask Permissions mode. The instructions confine writes to `exports/agent/` and avoid network calls.

## 14. User asks for an edited dashboard

**Symptom:** The agent starts changing frontend code to answer a data question.

**Mitigation:** `AGENTS.md` says the hosted static site is separate and untouched. For data answers, use the CLI and write only requested exports/charts.

## 15. SVG chart limitations

**Symptom:** The quick SVG is too simple for publication.

**Mitigation:** Treat CLI SVG as a fast analytic preview. Export CSV for publication graphics or ask a designer/frontend workflow to make final charts.
