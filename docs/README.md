# Documentation

`dsh-gantt` is a DeepSeek Harness Web UI plugin: a hierarchical task tree, a
personal day plan, a deterministic daily 该动 brief, and an authenticated JSON
API, backed by SQLite. The host half is seven ESM modules under `src/host/`; the
browser half is ESM under `src/client/` bundled into the single `lib/client.js`
artifact. The
Gantt page and the Today page render one unified tree
imported from an external task-tracker workspace; the Gantt page adds the brief
strip and perspectives, and a native conversation gets a right-rail **甘特** tab
plus host assistant tools for focused-task context, decomposition, and automatic
session/turn provenance. Start with the [README](../README.md) for installation
and a feature tour.

## Guides

| Document | Audience | Contents |
| --- | --- | --- |
| [development.md](development.md) | contributors | Prerequisites, setup, install, toolchain, quality gates, test layout, database, task-day clock, schema migration and import runbooks, dev loop, verification, troubleshooting |
| [api.md](api.md) | integrators | Complete JSON API reference: twenty-eight routes, auth, the extended task shape, frontier `brief` and the daily report, decompose/schedule/context, brief read/recompute, conversation focus, task trajectory, work-mode bindings, external agents and completion reports, assistant tools and background prompt context, request/response examples, errors |
| [mcp.md](mcp.md) | integrators | The external-agent MCP server: stdio/HTTP transports, authentication, the five tools with parameter and return schemas, database path resolution, Kubernetes scope, troubleshooting |
| [compatibility.md](compatibility.md) | maintainers | Supported DSH/Node set, harness seams with evidence (optional tools, right-rail sidebar, and systemPrompt services), rules, v2→v5 migration and data layering, limitations, verification |
| [personal-task-system.md](personal-task-system.md) | integrators, maintainers | The unified task tree and the system built on it: tracks/nodes/decomposed tasks, refs and provenance, state mapping, decomposition discipline, frontier/next, the daily 该动 report algorithm, perspectives, native-conversation assistant tools, task trajectory/protocol context, links, context export, deferred work |
| [work-context.md](work-context.md) | integrators, maintainers | What a work-mode conversation sees: the static protocol section, the dynamic focus context (ancestor chain, focus detail including the description, trajectory), the `gantt_context` result, the workbench prompt editor, data sources, renderers, and the rules for adding a new context field |

## Reference notes

[reference/dsh-context/](reference/dsh-context/README.md) holds internal study
notes about DeepSeek Harness internals (context assembly, instructions, memory,
compaction, extension points). They are background reading for maintainers, not
plugin documentation and not a compatibility contract.

## Contributing

[CONTRIBUTING.md](../CONTRIBUTING.md) covers the workflow — commits, the local
gates, and the release checklist. [AGENTS.md](../AGENTS.md) holds the engineering
policy.

## Conventions

- Documentation is English; UI copy ships in English and Chinese.
- `docs/` is lowercase. There is no `Docs/` directory.
- Keep relative links valid when moving pages.
