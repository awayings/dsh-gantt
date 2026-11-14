# Documentation

`dsh-gantt` is a DeepSeek Harness Web UI plugin: a hierarchical task Gantt page
backed by SQLite and an authenticated JSON API. Start with the
[README](../README.md) for installation and a feature tour.

## Guides

| Document | Audience | Contents |
| --- | --- | --- |
| [development.md](development.md) | contributors | Prerequisites, setup, toolchain, quality gates, test layout, database, dev loop, verification, troubleshooting |
| [api.md](api.md) | integrators | Complete JSON API reference: routes, auth, request/response examples, errors |
| [compatibility.md](compatibility.md) | maintainers | Supported DSH/Node set, harness seams with evidence, rules, limitations, verification |

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
