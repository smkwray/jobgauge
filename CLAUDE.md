@AGENTS.md

## Claude Code notes

Claude Code reads `CLAUDE.md`, not `AGENTS.md`; this file imports the shared project instructions above so Claude and Codex follow the same local-data protocol.

For ordinary data questions, use the CLI and avoid editing source files. Prefer Claude Code sandbox mode for command execution. Ask for human approval only when macOS or Claude blocks a necessary local command, file read, or export write.

Do not use WebFetch, live APIs, MCP connectors, or external tools to answer jobgauge data questions unless the user explicitly asks for outside context. Query-time answers should be grounded in `site/public/data` and `site/public/search` only.
