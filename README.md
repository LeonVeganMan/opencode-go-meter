# opencode-go-usage

**This plugin only works for [opencode-go](https://opencode.ai) subscribers.** It reads your key
from `~/.local/share/opencode/auth.json` (the `opencode-go` entry) and calls
`https://opencode.ai/zen/go/v1/usage`. With no opencode-go subscription there is nothing to show.

A TUI plugin for opencode: your context usage and your opencode-go plan windows in the sidebar and
on the prompt footer row, with a forecast of where the current pace lands by each reset.

## Install

```bash
git clone <this repo> ~/.config/opencode/plugins/opencode-go-usage
```

Local plugins are discovered from `~/.config/opencode/plugins/<name>/` — no entry in
`opencode.json` is needed. Restart opencode: the plugin itself is read at startup.

The built-in blocks this plugin replaces are the reason it exists. If you keep them, disable them in
`cli.json` so the figures are not shown twice:

```json
{ "disabled": ["-opencode.sidebar.context", "-opencode.prompt.footer"] }
```

## What it shows

Sidebar, one "Context & Go" block:

```
Context & Go
context ████████   6% 56.8K $0.08
5h      ████████  20% 2h 16m
weekly  ████████  17% 5d 14h
monthly ████████  14% 28d 3h (!)
```

- The first row is the session's context: a bar, the percentage, the tokens used and, on the sidebar,
  the session cost.
- One row per plan window: the bar and the percentage in the threshold colour, the countdown to that
  window's reset, and `(!)` when the pace seen so far would saturate the window before it resets.
- A window that is only *forecasting* a breach already takes the alert colour: 14% used but heading
  for 152% looks like an alert, not like a healthy window.

Prompt footer row: the same context figures in compact form, then ` | 5h:20% w:17% m:14%`.

Clicking the title or any row opens one detail dialog: every window with how much of it has elapsed
and where the pace lands by the reset, the model, the used tokens against the context window, the
cost, and a **Settings** row. The dialog also opens by itself the first time a window starts
forecasting past the threshold — once per alert, not on every refresh.

## Options

Click any row in **Settings** to move it to its next value: the panel writes `config.json` beside
`tui.tsx`, the same file you can edit by hand. A missing key means the default, and the file is
re-read on a timer, so neither a click nor an edit needs a restart.

| Key | Default | What it does |
| --- | --- | --- |
| `sidebar` | `true` | The sidebar block |
| `footer` | `true` | The prompt footer block |
| `autoOpen` | `true` | Open the detail dialog by itself on a new alert |
| `autoOpenAt` | `100` | Projected percentage that counts as an alert |
| `autoOpenWindows` | `["5h","weekly","monthly"]` | Which windows may raise it |
| `thresholds.warning` | `75` | Percentage that turns a figure amber |
| `thresholds.error` | `90` | Percentage that turns a figure red |
| `bar.cells` | `8` | Bar width in cells |
| `bar.glyphs` | `"blocks"` | `"blocks"` or `"ascii"` (`#`/`-`) for fonts that draw the blocks double width |
| `columns.percent` | `true` | The percentage run on each row |
| `columns.tokens` | `true` | The tokens used on the context row |
| `columns.cost` | `true` | The session cost on the context row |
| `columns.reset` | `true` | The reset countdown on each plan row |
| `columns.flag` | `true` | The `(!)` forecast flag |
| `order` | `"fixed"` | `"fixed"` (5h, weekly, monthly) or `"projection"` (worst forecast first) |
| `accentLabels` | `true` | Section headers in the theme accent instead of grey |
| `refresh.contextMs` | `3000` | How often the context figures are recomputed |
| `refresh.planMs` | `60000` | How often the plan windows are fetched |
| `projectionMinElapsed` | `5` | Below this much of a window elapsed, no forecast is attempted |

One option is not in the file: with `sidebar`, `footer` and `autoOpen` all `false` nothing can show or
announce the figures, and the endpoint is never called.

## Development

```bash
bun test     # window math, response parsing, config merge and the panel's cycle
```

Pure logic lives in `src/`, is dependency-free and is what the tests exercise; `tui.tsx` renders and
wires it into the opencode host. `bun build ./tui.tsx --external '*' --target=bun` checks that the
entry still bundles.

## License

MIT.
