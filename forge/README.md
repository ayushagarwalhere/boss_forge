# Runtime workspaces

M3 creates one ignored subdirectory per request. It contains runtime AGENTS.md, the boss schema, immutable request data, arena/policy files, examples, and a bundled offline `npm run gate` command. The agent may write boss.json. boss.ts remains disabled until M5's isolated executor exists.

The server keeps its own metadata and gate reports in ignored `.artifacts/requests/`. The model's neighboring gate-report.json is feedback only. The queue always uses a fresh independent worker report and an in-memory copy of the verified JSON.
