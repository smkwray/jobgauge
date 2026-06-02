# jobgauge local data tools — architecture decision

## Decision

Ship a **stdlib-only Python CLI + shared agent instructions** as the first-class local data tools layer.

Do **not** ship an MCP server as the default path. Keep MCP as a future adapter if a non-coding chat surface cannot run local shell commands or if a team later wants the same tools exposed through a formal tool registry.

## Why this architecture wins here

The jobgauge data contract is static JSON. The economist’s local agent does not need a daemon, an API key, a database, a web server, or live network access. A CLI gives Codex, Claude Code terminal, and Claude Code Desktop the same interface: run a local command, parse JSON, cite metadata, optionally write CSV/SVG outputs.

This is the lowest-friction path because:

1. **Codex has native project instructions.** OpenAI documents that Codex reads `AGENTS.md` before work and discovers global/project/nested files.
2. **Claude Code has native project instructions via `CLAUDE.md`.** Anthropic documents that Claude Code reads `CLAUDE.md`, not `AGENTS.md`, and recommends creating a `CLAUDE.md` that imports `AGENTS.md` when a repo already uses AGENTS.
3. **Both can run shell commands in a bounded workspace.** Codex’s default local path is `workspace-write` with `on-request` approvals; Claude Code supports permissions and sandboxed Bash, and Claude Code Desktop has an integrated terminal in local sessions.
4. **The data are already local.** MCP’s main value is standardized connection to external systems/tools. Here, the local shell is the most portable “tool bus” across coding agents.
5. **No query-time installation/config.** MCP would require server code, client registration, trust prompts, per-client config, and version skew. The CLI needs only Python 3.10+ and reads files already in the clone.

Research links checked for this decision:

- Codex `AGENTS.md`: https://developers.openai.com/codex/guides/agents-md
- Codex sandbox / approvals: https://developers.openai.com/codex/concepts/sandboxing and https://developers.openai.com/codex/cli/reference
- Claude Code memory / `CLAUDE.md` / AGENTS import: https://code.claude.com/docs/en/memory
- Claude Code permissions and security: https://code.claude.com/docs/en/security and https://code.claude.com/docs/en/settings
- Claude Code Desktop local sessions / terminal: https://code.claude.com/docs/en/desktop and https://code.claude.com/docs/en/desktop-quickstart
- MCP overview: https://modelcontextprotocol.io/docs/getting-started/intro
- Codex and Claude skills: https://developers.openai.com/codex/skills and https://code.claude.com/docs/en/skills

## Cross-agent compatibility story

### Codex

- Reads repo-root `AGENTS.md` automatically.
- Shells out to `python3 tools/jobgauge_data.py ...` or the bootstrap-created wrapper `./.jobgauge/bin/jg ...`.
- Recommended local launch posture for setup/integration work: workspace write with on-request approvals. Query-only analysis can be read-only except when creating requested CSV/SVG files under `exports/agent/`.

### Claude Code terminal

- Reads `CLAUDE.md`; this repository's `CLAUDE.md` imports `@AGENTS.md` so the same instructions drive both agents.
- Use sandboxed Bash or ordinary Ask Permissions mode. The tool only needs read access to `site/public/data` and write access to `exports/agent/` when exports are requested.

### Claude Code Desktop

- Use the **Code** tab, choose **Local**, and select the jobgauge folder.
- Desktop includes Claude Code; the Code tab can use local files directly, and local sessions include an integrated terminal. This is enough for the CLI path.
- Plain Claude chat without Code/local-session access is not enough to execute a local CLI. For that surface, either use Claude Code Desktop’s Code tab or add a future MCP adapter.

## Why not default MCP?

MCP is strong when an AI app needs a reusable, registered connector to external tools or services. It is an open standard with broad client/server support. For this jobgauge use case, however, MCP adds at least four moving parts that a non-technical economist should not need: a server process, a client config file, transport/log troubleshooting, and per-client permission setup. A local coding agent already has a robust command runner, so a CLI gives the same capability with less fragility.

A future MCP adapter should be considered only if one of these becomes true:

- The user must use a chat surface that cannot run shell commands but can connect to local MCP servers.
- The tools need fine-grained interactive UI widgets rather than JSON/table/CSV/SVG outputs.
- Multiple applications beyond coding agents need the same tool registry.
- The team wants formal MCP tool schemas for enterprise governance.

If added later, implement MCP as a **thin wrapper around the CLI/core library**, not a separate data logic stack.

## Why not default skills?

Skills are useful for progressive-disclosure instructions. They are not necessary for the MVP because the core instructions fit in `AGENTS.md` and `CLAUDE.md`, and the work is command execution rather than long procedural generation. This repository still includes optional minimal skills under `.agents/skills/jobgauge-data/` and `.claude/skills/jobgauge-data/` so Codex/Claude can discover the workflow in installations where skills are enabled. The CLI and `AGENTS.md` remain authoritative.

## Dependency policy

The CLI is **standard-library only**. That avoids `pip`, `uv`, venv, lockfile, native wheels, Gatekeeper, and package-manager friction. It also makes query-time operation fully offline.

Python 3.10+ is the only runtime requirement. If a clean Mac lacks `python3`, the agent can install Python once during setup via an already-approved package manager or the signed python.org installer. The CLI itself installs no packages.

## Output formats

- **JSON default** for agent reasoning: deterministic, parseable, includes metadata and truncation flags.
- **Human table** for quick inspection and user-facing sanity checks.
- **CSV** for spreadsheet-ready exports.
- **SVG** for static offline charts: no JavaScript, no telemetry, no hosted assets, no additional dependencies.

## Data-contract boundaries

The tools read:

- `site/public/data/catalog.json`
- `site/public/data/manifest.json`
- `site/public/data/latest.json`
- `site/public/data/series/<indicator_id>.json`
- `site/public/search/index.json`

The tools must not modify these files. They use catalog metadata for labels and preserve source, series id, units, frequency, seasonal adjustment, and geography in outputs.
