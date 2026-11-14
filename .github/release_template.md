## Install / Update

`dsh-gantt` is a private plugin that ships its source directly — there is no npm package. Install it from a local
checkout of this repository on [DeepSeek Harness](https://www.deepseek.com/harness/).

With the plugin manager tool:

```text
plugin_manager install_bundle { target: "/absolute/path/to/dsh-gantt" }
```

Or with the DSH CLI, which forwards to pnpm in the `web` profile:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-gantt
```

Update an existing local checkout with `git pull`, then re-run the same install command and restart `dsh web`.

## What's New

(The important user-facing changes)

### Features

- ** <Headline change N>**
  - <Key briefing 1>
  - <Key briefing 2>

### Fixes
- ...

### Changes
- ...

## Commits

- commit message ([commit_id](link_to_commit))
- commit message ([commit_id](link_to_commit))

[vPREV...vNEW](https://github.com/awayings/dsh-gantt/compare/vPREV...vNEW) · N commits

## Contributors

- @contributor1
- @contributor2
