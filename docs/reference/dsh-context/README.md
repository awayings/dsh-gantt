# DSH context study notes (reference)

> **These are study notes, not plugin documentation.** They describe DeepSeek
> Harness internals for background — how the harness assembles model context,
> loads layered instructions, compacts history, and exposes extension points.
> Nothing here documents `dsh-gantt` itself, and nothing here is a compatibility
> contract. The harness evolves quickly; read the installed packages under
> `/data/app/node_modules/@deepseek-ai/` (or a clone of
> [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)) when a
> fact matters.

The notes were written on 2026-11-08 against the locally installed
`@deepseek-ai/dsh` `0.2.2-rc.1` under `/data/app/node_modules/@deepseek-ai/`,
with `DSH_HOME=/data/dsh-home`. They are kept in their original language and
wording; cite them only as background, and prefer the harness source when the
two disagree.

| File | Contents |
| --- | --- |
| [00-overview.md](00-overview.md) | Overview, five-minute summary, and table of contents |
| [01-context-pipeline.md](01-context-pipeline.md) | How one request's context is assembled: four inputs, section order, `preStep()` |
| [02-knowledge-layers.md](02-knowledge-layers.md) | `AGENTS.md` instruction chain, memory, and skills |
| [03-history-and-compaction.md](03-history-and-compaction.md) | History, compaction, and context metering |
| [04-control-and-extension.md](04-control-and-extension.md) | Who decides what enters context, and where to change it |
| [05-four-agent-modes.md](05-four-agent-modes.md) | 四种 Web agent preset（standard / ptc / minimal / cordis）的实现区别：提示词、最终上下文组织、工具集、适用特点 |
| [appendix-file-map.md](appendix-file-map.md) | Package file map and evidence-gathering method |

For this plugin's own documentation, start at [docs/README.md](../../README.md).
