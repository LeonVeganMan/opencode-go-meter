# AGENTS.md — opencode-go-meter

TUI plugin for OpenCode v2: session context usage and the OpenCode Go plan windows in the
sidebar, with a forecast of where the current pace lands by each reset. Requires an
OpenCode Go subscription.

## Layout

- `tui.tsx` — the plugin: `Plugin.define({ id, setup(context) })`. Exposed as the package's `./tui` export.
- `settings.tsx` — settings panel.
- `src/config.ts`, `src/rows.ts`, `src/usage.ts`, `src/windows.ts` — data and formatting, no TUI imports.
- `src/*.test.ts` — `bun test` (30 tests).
- `assets/` — panel artwork shipped in the package.

## Commands

```bash
bun test                                            # unit tests
bun build tui.tsx --target=node --external '*'      # build check (CI does this too)
~/work/opencode/release.sh patch                    # release: bump, commit, tag, push, wait for npm
~/work/opencode/release.sh --dry-run patch          # show what it would do
```

## Hard requirements (each one cost a broken release)

- **`peerDependencies` are mandatory**: `@opentui/core`, `@opentui/solid` (`>=0.5.8`),
  `solid-js` (`>=1.9.0`). For a `.tsx` plugin the loader injects `@opentui/solid` as the JSX
  runtime, and an npm-installed plugin must resolve its own imports from its own tree.
  Without them: `Cannot find package '@opentui/solid' imported from .../tui.tsx`, while the
  same code works when loaded from a local clone (the host resolves imports differently there).
- **`@opencode/plugin` stays a `devDependency`.** As a runtime dependency it pulls ~300 MB of
  transitive packages; OpenCode resolves `@opencode/plugin/tui` at runtime.
- **`exports` must keep `"./tui": "./tui.tsx"`**, otherwise the TUI never loads.
- **The package must not depend on native OpenCode panels.** The plugin renders the usage
  blocks itself, so `cli.json` disables the built-ins that would duplicate them:
  `"-opencode.sidebar.context"` and `"-opencode.prompt.footer"` (see the README, they are a
  setup step for the user: without it the same figures appear twice).
- **Numbers come from the plan, not from guesses**: context usage and window resets are read
  from the session and plan data. Never hardcode a limit that the API reports.

## Release and install

Publishing is tag-driven (`.github/workflows/publish.yml`): push a `v*` tag, CI runs
`bun test`, the build check, a tag-vs-`package.json` version guard, then
`npm publish --access public --provenance` and creates the GitHub release.

- Auth is **npm trusted publishing over OIDC only** — no `NPM_TOKEN` secret exists, and none
  must be added. It requires npm >= 11.5.1, which is why the workflow installs `npm@latest`
  on Node 24 (Node 22 ships npm 10 → `ENEEDAUTH`).
- The npm trusted publisher is configured on npmjs.com for repo `LeonVeganMan/opencode-go-meter`
  and workflow filename **`publish.yml`** (file name only, empty environment, allow publish).
  A mismatch is reported as `403 ... OIDC permission denied for this action`, not as a config error.
- npm propagation is slow and variable (1 to 8 minutes). `release.sh` polls `npm view` for that reason.
- Users install with `opencode plugin add opencode-go-meter`. A clone in
  `~/.config/opencode/plugins/` **loads the plugin a second time** (duplicate palette entries,
  doubled footer, key bind registered twice): dev clones live outside the discovery dir, in
  `~/work/opencode/`.

## Debugging

- A plugin that fails to load shows `TUI plugin error` at startup and in
  `~/.local/share/opencode/log/opencode.log`.
- `opencode plugin list` shows the installed version; `opencode plugin update <name>` accepts
  one package at a time.
- Restart the TUI after installing, updating or editing `cli.json`: a running session keeps
  the code it loaded.
- `opencode plugin add` refuses local tarballs (registry or Git specifiers only). To test a
  package before publishing: `npm pack`, `npm i <tarball>` in a temp dir, then check that
  `@opentui/solid`, `@opentui/core` and `solid-js` resolve from the plugin directory — this is
  the check that would have caught the peer-dependency bug above.
