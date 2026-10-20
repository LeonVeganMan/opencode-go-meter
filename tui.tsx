/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, For, Show } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { DEFAULTS, loadConfig, pollingNeeded, saveConfig, type Config, type Glyph } from "./src/config"
import { alerting, buildRows, orderRows, type Row } from "./src/rows"
import { fetchUsageResult, readAuthKey } from "./src/usage"
import { Settings } from "./settings"

// Local TUI plugin: one "Context & Go" block, the session's context usage as the
// first row and the OpenCode Go plan windows under it, plus the same two figures
// on the prompt footer row. It replaces the built-ins disabled in cli.json
// ("-opencode.sidebar.context", "-opencode.prompt.footer") and the separate
// go-usage plugin it used to be split across: a single file means a single label
// column, so every bar starts on the same one.
//
// Every figure is an option: the panel writes the same config.json a hand edit
// does, and the file is re-read on a timer, so neither one needs a restart.
// Every row is "[label padded to LABEL_WIDTH][bar]", so the bars line up.
const LABEL_WIDTH = 8
// The bar glyphs: blocks by default, ascii for the fonts that draw the block
// characters double width and push the row out of its column.
const GLYPHS: Record<Glyph, { filled: string; empty: string }> = {
  blocks: { filled: "\u2588", empty: "\u2591" },
  ascii: { filled: "#", empty: "-" },
}
const TITLE = "Context & Go"
const SHORT: Record<string, string> = { "5h": "5h", weekly: "w", monthly: "m" }
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

type Thresholds = Config["thresholds"]

// The plan windows come from the usage endpoint this plugin reads itself, so the
// figures and the countdown are the same ones src/windows.ts computes, without a
// second implementation to keep in step.
async function readRows(config: Config): Promise<{ rows: Row[]; error: string | null }> {
  const key = await readAuthKey()
  if (!key) return { rows: [], error: "no opencode-go key in auth.json" }
  const { usage, error } = await fetchUsageResult(key)
  return usage ? { rows: buildRows(usage, config), error: null } : { rows: [], error: error ?? "no usage data" }
}

function thresholdColor(theme: any, percent: number, thresholds: Thresholds): string {
  const f = theme?.text?.feedback ?? {}
  const pick = (c: any, fallback: string) => c?.base ?? c?.default ?? fallback
  if (percent >= thresholds.error) return pick(f.error, "#ff6b6b")
  if (percent >= thresholds.warning) return pick(f.warning, "#ffcc66")
  return pick(f.success, "#7fd37f")
}

function compact(n: number): string {
  // One decimal only below 100: 12000 → "12.0K", 128000 → "128K".
  const scale = (v: number) => (v >= 100 ? String(Math.round(v)) : v.toFixed(1))
  if (n >= 1e6) return scale(n / 1e6) + "M"
  if (n >= 1e4) return scale(n / 1e3) + "K"
  return n.toLocaleString("en-US")
}

function bar(percent: number, cells: number, glyphs: Glyph): string {
  const { filled: on, empty: off } = GLYPHS[glyphs]
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * cells)
  return on.repeat(filled) + off.repeat(cells - filled)
}

// Tokens after the percentage: the used tokens alone. The model's context window
// is deliberately left out, it pushed the row past the sidebar width. The
// percentage is not part of this string because it is a separately coloured run.
function tokens(info: { used: number } | undefined): string {
  return info ? compact(info.used) : ""
}

// A window that is close to its limit and resets within 24h is worth flagging:
// the countdown then carries the threshold colour instead of muted.
function resetImminent(row: Row, thresholds: Thresholds): boolean {
  return row.percent >= thresholds.warning && row.remaining < 86_400
}

// Where the pace seen so far lands by the reset. This reads on the line after the
// row that carries the figures, joined to the elapsed span, so it starts lowercase.
function planMessage(row: Row): string {
  if (row.projected <= 0) return "Too early in the window to project a pace."
  return (
    `reaches ${row.projected}% at this pace` +
    (row.projected > 100 ? ", so the limit saturates before it resets." : ".")
  )
}

// Footer form of the plan windows, the percentages alone: the alert is not baked
// into this string because it travels as a separately coloured run, the same (!)
// the sidebar rows carry.
function brief(rows: Row[]): string {
  return rows.map((row) => `${SHORT[row.label] ?? row.label}:${row.percent}%`).join(" ")
}

// Label column: "context ", "5h      ", "monthly ".
function col(label: string): string {
  return label.padEnd(LABEL_WIDTH)
}

// Same accounting as the built-in opencode.sidebar.context, including the
// session's own location when resolving the model limit.
function read(context: any, sessionID?: string) {
  if (!sessionID) return
  const session = context.data.session.get(sessionID)
  const messages = context.data.session.message.list(sessionID) ?? []
  const revertID = session?.revert?.messageID
  const stop = revertID ? messages.findIndex((m: any) => m.id === revertID) : -1
  let last: any
  for (let i = messages.length - 1; i >= 0; i--) {
    if (stop >= 0 && i >= stop) continue
    const m = messages[i]
    if ((m.type ?? m.role) === "assistant" && m.tokens) {
      last = m
      break
    }
  }
  if (!last) return
  const t = last.tokens
  const used = (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0)
  if (used <= 0) return
  const models = context.data.location.model.list(session?.location ?? context.location) ?? []
  const info = models.find(
    (m: any) =>
      m.providerID === last.model?.providerID && (m.id === last.model?.id || m.modelID === last.model?.id),
  )
  const limit = info?.limit?.context
  // The window and the model name are not for the sidebar row, which has no room
  // for them, but for the detail dialog.
  return {
    used,
    percent: limit ? Math.round((used / limit) * 100) : undefined,
    window: limit,
    model: info?.name ?? last.model?.id,
  }
}

export default Plugin.define({
  id: "opencode-go-meter",
  setup(context) {
    const [tick, setTick] = createSignal(0)
    const [rows, setRows] = createSignal<Row[]>([])
    // Why the plan figures are missing, shown in place of "n/a".
    const [planError, setPlanError] = createSignal<string | null>(null)
    // The config is read on the context tick as well as on every refresh: it is a
    // local file, so keeping it live costs no API call, and it is also the only way
    // back when both views are off and the panel has nowhere to be opened from.
    const [cfg, setCfg] = createSignal<Config>(DEFAULTS)
    // One order for every place the windows are listed, so the sidebar, the footer
    // and the dialog cannot disagree about which window comes first.
    const shown = createMemo(() => orderRows(rows(), cfg().order))

    // The session id arrives with a render and the dialog that opens by itself needs
    // the same session to show its cost, so the latest one is kept for it.
    let sessionID: string | undefined
    // A window that starts forecasting past its limit gets the dialog once: the labels
    // already announced are remembered, so it does not reopen on every refresh while the
    // alert continues. The first reading only seeds that set, so a session that starts
    // with a window already over the line shows the (!) instead of an unprompted modal.
    // The config vetoes: the alert is still tracked while it says no, so turning the
    // switch back on does not replay an alert that was already announced.
    let announced: Set<string> | null = null
    const refresh = async () => {
      const config = await loadConfig()
      setCfg(config)
      const { rows: next, error } = await readRows(config)
      setRows(next)
      setPlanError(error)
      const now = new Set(
        next
          .filter((row) => alerting(row, config) && config.autoOpenWindows.includes(row.label))
          .map((row) => row.label),
      )
      const seen = announced
      const started = seen === null ? [] : [...now].filter((label) => !seen.has(label))
      announced = now
      if (started.length && config.autoOpen) openDetail(sessionID)
    }

    const muted = () => context.theme?.text?.muted ?? context.theme?.text?.subdued ?? "#808080"
    // Theme accent for the cost and the section headers, so they stand apart from the
    // threshold colours and from the muted title.
    const accent = () =>
      context.theme?.hue?.accent?.["500"] ?? context.theme?.hue?.interactive?.["300"] ?? "#FF9654"

    // One <text> per run: fg given to a <span> is ignored, that run would render in
    // the default colour. The label is left out on the footer row, which has no room
    // for a label column.
    const ContextRow = (props: { sessionID?: string; cost?: boolean; label?: boolean }) => {
      const info = createMemo(() => {
        tick()
        return read(context, props.sessionID)
      })
      // Session cost, the same figure the disabled built-in showed as "$x spent".
      const spent = createMemo(() => {
        tick()
        return props.cost && props.sessionID ? (context.data.session.cost(props.sessionID) ?? 0) : 0
      })
      return (
        <Show when={info()}>
          <box flexDirection="row" gap={0}>
            <Show when={props.label}>
              <text>{col("context")}</text>
            </Show>
            <text fg={thresholdColor(context.theme, info()?.percent ?? 0, cfg().thresholds)}>
              {bar(info()?.percent ?? 0, cfg().bar.cells, cfg().bar.glyphs)}
            </text>
            <Show when={cfg().columns.percent && info()?.percent !== undefined}>
              <text fg={thresholdColor(context.theme, info()?.percent ?? 0, cfg().thresholds)}>
                {" " + String(info()?.percent).padStart(3) + "%"}
              </text>
            </Show>
            <Show when={cfg().columns.tokens}>
              <text>{" " + tokens(info())}</text>
            </Show>
            <Show when={cfg().columns.cost && spent() > 0}>
              <text fg={accent()}>{" " + USD.format(spent())}</text>
            </Show>
          </box>
        </Show>
      )
    }

    // Same shape as the context row: label column, then the bar and the percentage
    // in the threshold colour, then the reset countdown, then a flag when the pace
    // seen so far projects past the limit before the window resets.
    //
    // A forecast breach wears that colour on the bar and the percentage too, not only
    // on the (!): a window still at 14% that is going to saturate has to look like it.
    // alerting() is the same predicate the (!), the dialog and the automatic opening
    // use, so the three cannot disagree.
    //
    // The forecast itself is a detail, so it is not in the row: clicking a row (or the
    // title) opens every figure in one dialog and the (!) is the hint that there is one
    // to read. onMouseUp, not onMouseDown, is what the built-in rows use.
    //
    // alert colours the label for the dialog: there a saturating window has to stand
    // out from the rest, while in the sidebar the (!) is enough.
    const PlanRow = (props: { row: Row; onDetail?: () => void; alert?: boolean }) => {
      const colour = () =>
        alerting(props.row, cfg())
          ? thresholdColor(context.theme, 100, cfg().thresholds)
          : thresholdColor(context.theme, props.row.percent, cfg().thresholds)
      return (
        <box flexDirection="row" gap={0} onMouseUp={props.onDetail}>
          <text fg={props.alert ? colour() : undefined}>{col(props.row.label)}</text>
          <text fg={colour()}>{bar(props.row.percent, cfg().bar.cells, cfg().bar.glyphs)}</text>
          <Show when={cfg().columns.percent}>
            <text fg={colour()}>{" " + String(props.row.percent).padStart(3) + "%"}</text>
          </Show>
          <Show when={cfg().columns.reset}>
            <text fg={resetImminent(props.row, cfg().thresholds) ? colour() : muted()}>
              {" " + props.row.reset}
            </text>
          </Show>
          <Show when={cfg().columns.flag && alerting(props.row, cfg())}>
            <text fg={colour()}>{" (!)"}</text>
          </Show>
        </box>
      )
    }

    // Where the detail goes: the forecast of every window and the context figures
    // that do not fit the sidebar row, in one dialog opened from the title or from
    // any row. The plan rows are rendered here without their click handler, so a
    // click inside the dialog cannot stack a second copy of it.
    const Detail = (props: { sessionID?: string }) => {
      const info = createMemo(() => {
        tick()
        return read(context, props.sessionID)
      })
      const spent = createMemo(() => {
        tick()
        return props.sessionID ? (context.data.session.cost(props.sessionID) ?? 0) : 0
      })
      return (
        <box
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={muted()}
          title={TITLE}
          titleAlignment="left"
          paddingLeft={2}
          paddingRight={2}
        >
          <text fg={cfg().accentLabels ? accent() : muted()}>{"Go plan"}</text>
          <For each={shown()}>
            {(row, index) => (
              <box flexDirection="column">
                <PlanRow row={row} alert={alerting(row, cfg())} />
                <text fg={alerting(row, cfg()) ? thresholdColor(context.theme, 100, cfg().thresholds) : muted()}>
                  {col("") + (row.span ? row.span + " · " : "") + planMessage(row)}
                </text>
                <Show when={index() < shown().length - 1}>
                  <text>{" "}</text>
                </Show>
              </box>
            )}
          </For>
          <text>{" "}</text>
          <Show when={info()}>
            <text fg={cfg().accentLabels ? accent() : muted()}>{"Context"}</text>
            <Show when={info()?.model}>
              <text>{col("model") + info()?.model}</text>
            </Show>
            <text>
              {col("used") +
                tokens(info()) +
                (info()?.window ? " of " + compact(info()?.window ?? 0) : "") +
                (info()?.percent === undefined ? "" : ` (${info()?.percent}%)`)}
            </text>
            <Show when={spent() > 0}>
              <text fg={accent()}>{col("cost") + USD.format(spent())}</text>
            </Show>
          </Show>
          <text>{" "}</text>
          <text fg={cfg().accentLabels ? accent() : muted()} onMouseUp={openSettings}>
            {"Settings"}
          </text>
          <text fg={muted()} onMouseUp={() => context.ui.dialog.clear()}>
            {"esc, or a click here, closes"}
          </text>
        </box>
      )
    }

    const openDetail = (sessionID?: string) => {
      context.ui.dialog.show(() => <Detail sessionID={sessionID} />)
      context.ui.dialog.set({ size: "large", centered: true })
    }

    // The panel writes the same config.json a hand edit does, and the signal takes the
    // new value straight away so the render behind the dialog moves with the click
    // instead of waiting for the next refresh to read the file back.
    const openSettings = () => {
      context.ui.dialog.show(() => (
        <Settings
          config={cfg}
          onChange={(next) => {
            setCfg(next)
            void saveConfig(next)
            void applyConfig()
            // The dialog body is drawn once, so the panel is reopened to show the
            // value the click just wrote.
            context.ui.dialog.clear()
            openSettings()
          }}
          onClose={() => context.ui.dialog.clear()}
        />
      ))
      context.ui.dialog.set({ size: "large", centered: true })
    }

    // A view that is off must not be registered at all: a registered slot that renders
    // nothing still leaves an empty line where its block would have been.
    let sidebarSlot: (() => void) | undefined
    let footerSlot: (() => void) | undefined
    let handleSlot: (() => void) | undefined
    const syncSlots = (config: Config) => {
      if (config.sidebar && !sidebarSlot) {
        // Sidebar: one title, then one row per figure. A failed call to the endpoint
        // leaves the context row in place and a single placeholder for the plan windows.
        sidebarSlot = context.ui.slot({
          append: "sidebar.content",
          render: (props: any) => {
            sessionID = props.sessionID
            return (
              <box flexDirection="column">
                <box flexDirection="row" gap={1}>
                  <text fg={muted()} onMouseUp={() => openDetail(props.sessionID)}>
                    {TITLE}
                  </text>
                  <text fg={accent()} onMouseUp={() => openSettings()}>
                    {"settings"}
                  </text>
                </box>
                <box onMouseUp={() => openDetail(props.sessionID)}>
                  <ContextRow sessionID={props.sessionID} cost label />
                </box>
                <For each={shown()}>
                  {(row) => <PlanRow row={row} onDetail={() => openDetail(props.sessionID)} />}
                </For>
                <Show when={shown().length === 0}>
                  <text fg={muted()}>{col("plan") + (planError() ?? "n/a")}</text>
                </Show>
              </box>
            )
          },
        })
      } else if (!config.sidebar && sidebarSlot) {
        sidebarSlot()
        sidebarSlot = undefined
      }
      if (config.footer && !footerSlot) {
        // Prompt footer row: no label column, the plan windows in the compact form,
        // a divider between the two areas, and the same forecast alert the rows carry
        // as a separately coloured (!) — coherence with the sidebar is the point.
        footerSlot = context.ui.slot({
          append: "prompt.footer.status",
          render: (props: any) => {
            sessionID = props.sessionID
            return (
              <box flexDirection="row" gap={0}>
                <ContextRow sessionID={props.sessionID} />
                <Show when={shown().length > 0}>
                  <text>{" | " + brief(shown())}</text>
                </Show>
                <Show when={shown().some((row) => alerting(row, cfg()))}>
                  <text fg={thresholdColor(context.theme, 100, cfg().thresholds)}>{" (!)"}</text>
                </Show>
              </box>
            )
          },
        })
      } else if (!config.footer && footerSlot) {
        footerSlot()
        footerSlot = undefined
      }
      // With nothing on screen there is no way into the dialog, and the panel lives in
      // it, so one muted word stays behind as the door. A slot is the verified way in: a
      // keybind would need a chord whose syntax cannot be confirmed here, and a rejected
      // command list throws while the plugin is still setting up.
      const needsHandle = !config.sidebar && !config.footer
      if (needsHandle && !handleSlot) {
        handleSlot = context.ui.slot({
          append: "prompt.footer.status",
          render: (props: any) => {
            sessionID = props.sessionID
            return (
              <text fg={muted()} onMouseUp={() => openDetail(props.sessionID)}>
                {"go-meter"}
              </text>
            )
          },
        })
      } else if (!needsHandle && handleSlot) {
        handleSlot()
        handleSlot = undefined
      }
    }

    // Nothing visible and nothing to announce means the endpoint is never called. The
    // context tick stays on either way: it reads local session data, and it is what
    // notices a config change that turns a view back on.
    let contextTimer: ReturnType<typeof setInterval> | undefined
    let rowsTimer: ReturnType<typeof setInterval> | undefined
    let contextMs = 0
    let planMs = 0
    const syncTimers = (config: Config) => {
      const wantsRows = pollingNeeded(config)
      if (config.refresh.contextMs !== contextMs) {
        contextMs = config.refresh.contextMs
        if (contextTimer) clearInterval(contextTimer)
        contextTimer = setInterval(() => {
          setTick((n) => n + 1)
          void applyConfig()
        }, contextMs)
      }
      if (config.refresh.planMs !== planMs) {
        planMs = config.refresh.planMs
        if (rowsTimer) clearInterval(rowsTimer)
        rowsTimer = wantsRows ? setInterval(() => void refresh(), planMs) : undefined
      } else if (wantsRows && !rowsTimer) {
        // Turning a view back on should not wait out a whole refresh interval.
        rowsTimer = setInterval(() => void refresh(), planMs)
        void refresh()
      } else if (!wantsRows && rowsTimer) {
        clearInterval(rowsTimer)
        rowsTimer = undefined
      }
    }

    const applyConfig = async () => {
      const config = await loadConfig()
      setCfg(config)
      syncSlots(config)
      syncTimers(config)
    }

    // Shortcut hints that belonged to the disabled built-in footer. Plain text:
    // the key caps styling of the built-in is not reproduced.
    const agentKey = context.keymap?.shortcuts?.("agent.cycle")?.[0] ?? ""
    const commandKey = context.keymap?.shortcuts?.("command.palette.show")?.[0] ?? ""
    const footerShortcuts =
      agentKey && commandKey
        ? context.ui.slot({
            append: "prompt.footer.status",
            render: () => <text fg={muted()}>{`${agentKey} agents ${commandKey} commands`}</text>,
          })
        : undefined

    void applyConfig().then(() => void refresh())

    return () => {
      if (contextTimer) clearInterval(contextTimer)
      if (rowsTimer) clearInterval(rowsTimer)
      sidebarSlot?.()
      footerSlot?.()
      handleSlot?.()
      footerShortcuts?.()
    }
  },
})
