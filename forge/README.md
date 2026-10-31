# Runtime workspaces

The forge creates one ignored subdirectory per approved request. It contains runtime AGENTS.md, boss/command schemas, immutable request data, arena/policy files, examples, a bundled offline gate and read-only script compiler worker. The agent may write boss.json and optional finite boss.ts. Source is statically checked and executed only in QuickJS WebAssembly; the sim receives validated commands. See [script isolation](../docs/scripts.md).

The server keeps its own metadata and gate reports in ignored `.artifacts/requests/`. The model's neighboring gate-report.json is feedback only. The queue always uses a fresh independent worker report and an in-memory copy of the verified JSON.
