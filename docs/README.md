# Documentation

`dsh-gantt` is a DeepSeek Harness Web UI plugin: a hierarchical task tree, a
personal day plan, and an authenticated JSON API, backed by SQLite. The Gantt
page and the Today page render one unified tree imported from an external
task-tracker workspace. Start with the [README](../README.md) for installation
and a feature tour.

## Guides

| Document | Audience | Contents |
| --- | --- | --- |
| [development.md](development.md) | contributors | Prerequisites, setup, install, toolchain, quality gates, test layout, database, schema migration and import runbooks, dev loop, verification, troubleshooting |
| [api.md](api.md) | integrators | Complete JSON API reference: fourteen routes, auth, the extended task shape, `brief`, decompose/schedule/context, request/response examples, errors |
| [compatibility.md](compatibility.md) | maintainers | Supported DSH/Node set, harness seams with evidence, rules, v2→v3 migration and data layering, limitations, verification |
| [personal-task-system.md](personal-task-system.md) | integrators, maintainers | The unified task tree: why the two datasets were merged, tracks/nodes/decomposed tasks, refs and provenance, the state mapping, decomposition discipline, frontier/next, links, context export, deferred work |

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
