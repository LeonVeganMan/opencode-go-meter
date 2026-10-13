/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, For, Show } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { loadConfig } from "./src/config"
import { buildRows, type Row } from "./src/rows"
import { fetchUsage, readAuthKey } from "./src/usage"

// Local TUI plugin: one "Context & Go" block, the session's context usage as the
// first row and the OpenCode Go plan windows under it, plus the same two figures
// on the prompt footer row. It replaces the built-ins disabled in cli.json
// ("-opencode.sidebar.context", "-opencode.prompt.footer") and the separate
// go-usage plugin it used to be split across: a single file means a single label
// column, so every bar starts on the same one.
// The plan windows come from a remote API and move on a long cycle; the context
// usage changes with every message, so it gets its own shorter tick.
const REFRESH_MS = 60_000
const CONTEXT_MS = 3_000
const CELLS = 8
// Every row is "[label padded to LABEL_WIDTH][bar]", so the bars line up.
const LABEL_WIDTH = 8
const FILLED = "\u2588"
const EMPTY = "\u2591"
const TITLE = "Context & Go"
const SHORT: Record<string, string> = { "5h": "5h", weekly: "w", monthly: "m" }
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

// The plan windows come from the usage endpoint this plugin reads itself, so the
// figures and the countdown are the same ones src/windows.ts computes, without a
// second implementation to keep in step.
async function readRows(): Promise<Row[]> {
  const key = await readAuthKey()
  const usage = key ? await fetchUsage(key) : null
  return usage ? buildRows(usage, await loadConfig()) : []
}

function thresholdColor(theme: any, percent: number): string {
  const f = theme?.text?.feedback ?? {}
  const pick = (c: any, fallback: string) => c?.base ?? c?.default ?? fallback
  if (percent >= 90) return pick(f.error, "#ff6b6b")
  if (percent >= 75) return pick(f.warning, "#ffcc66")
  return pick(f.success, "#7fd37f")
}

function compact(n: number): string {
  // One decimal only below 100: 12000 → "12.0K", 128000 → "128K".
  const scale = (v: number) => (v >= 100 ? String(Math.round(v)) : v.toFixed(1))
  if (n >= 1e6) return scale(n / 1e6) + "M"
  if (n >= 1e4) return scale(n / 1e3) + "K"
  return n.toLocaleString("en-US")
}

function bar(percent: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * CELLS)
  return FILLED.repeat(filled) + EMPTY.repeat(CELLS - filled)
}

// Tokens after the percentage: the used tokens alone. The model's context window
// is deliberately left out, it pushed the row past the sidebar width. The
// percentage is not part of this string because it is a separately coloured run.
function tokens(info: { used: number } | undefined): string {
  return info ? compact(info.used) : ""
}

// A window that is close to its limit and resets within 24h is worth flagging:
// the countdown then carries the threshold colour instead of muted.
function resetImminent(row: Row): boolean {
  return row.percent >= 75 && row.remaining < 86_400
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

// Footer form of the plan windows, the same string the script prints with --brief.
function brief(rows: Row[]): string {
  const worst = Math.max(...rows.map((row) => row.percent))
  const flag = worst >= 90 ? " !!" : worst >= 75 ? " !" : ""
  return rows.map((row) => `${SHORT[row.label] ?? row.label}:${row.percent}%`).join(" ") + flag
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
  id: "go-usage",
  setup(context) {
    const [tick, setTick] = createSignal(0)
    const contextTimer = setInterval(() => setTick((n) => n + 1), CONTEXT_MS)

    const [rows, setRows] = createSignal<Row[]>([])

    // The session id arrives with a render and the dialog that opens by itself needs
    // the same session to show its cost, so the latest one is kept for it.
    let sessionID: string | undefined
    // A window that starts projecting past its limit gets the dialog once: the labels
    // already announced are remembered, so it does not reopen on every refresh while the
    // alert continues. The first reading only seeds that set, so a session that starts
    // with a window already over the line shows the (!) instead of an unprompted modal.
    // The config vetoes: the alert is still tracked while it says no, so turning the
    // switch back on does not replay an alert that was already announced.
    let alerting: Set<string> | null = null
    const refresh = () =>
      void readRows().then(async (next) => {
        setRows(next)
        const cfg = await loadConfig()
        const now = new Set(
          next
            .filter((row) => row.projected > cfg.autoOpenAt && cfg.autoOpenWindows.includes(row.label))
            .map((row) => row.label),
        )
        const seen = alerting
        const started = seen === null ? [] : [...now].filter((label) => !seen.has(label))
        alerting = now
        if (started.length && cfg.autoOpen) openDetail(sessionID)
      })
    refresh()
    const rowsTimer = setInterval(refresh, REFRESH_MS)

    const muted = () => context.theme?.text?.muted ?? context.theme?.text?.subdued ?? "#808080"
    // Theme accent for the cost, so it stands apart from the threshold colours and
    // from the muted title.
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
            <text fg={thresholdColor(context.theme, info()?.percent ?? 0)}>{bar(info()?.percent ?? 0)}</text>
            <Show when={info()?.percent !== undefined}>
              <text fg={thresholdColor(context.theme, info()?.percent ?? 0)}>
                {" " + String(info()?.percent).padStart(3) + "%"}
              </text>
            </Show>
            <text>{" " + tokens(info())}</text>
            <Show when={spent() > 0}>
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
    // The forecast is a detail, so it is not in the row: clicking a row (or the
    // title) opens every figure in one dialog and the (!) is the hint that there is
    // one to read. onMouseUp, not onMouseDown, is what the built-in rows use.
    //
    // alert colours the label for the dialog: there a saturating window has to stand out
    // from the rest, while in the sidebar the (!) is enough.
    const PlanRow = (props: { row: Row; onDetail?: () => void; alert?: boolean }) => (
      <box flexDirection="row" gap={0} onMouseUp={props.onDetail}>
        <text fg={props.alert ? thresholdColor(context.theme, props.row.projected) : undefined}>
          {col(props.row.label)}
        </text>
        <text fg={thresholdColor(context.theme, props.row.percent)}>{bar(props.row.percent)}</text>
        <text fg={thresholdColor(context.theme, props.row.percent)}>
          {" " + String(props.row.percent).padStart(3) + "%"}
        </text>
        <text fg={resetImminent(props.row) ? thresholdColor(context.theme, props.row.percent) : muted()}>
          {" " + props.row.reset}
        </text>
        <Show when={props.row.projected > 100}>
          <text fg={thresholdColor(context.theme, props.row.projected)}>{" (!)"}</text>
        </Show>
      </box>
    )

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
          <text fg={accent()}>{"Go plan"}</text>
          <For each={rows()}>
            {(row, index) => (
              <box flexDirection="column">
                <PlanRow row={row} alert={row.projected > 100} />
                <text fg={row.projected > 100 ? thresholdColor(context.theme, row.projected) : muted()}>
                  {col("") + (row.span ? row.span + " · " : "") + planMessage(row)}
                </text>
                <Show when={index() < rows().length - 1}>
                  <text>{" "}</text>
                </Show>
              </box>
            )}
          </For>
          <text>{" "}</text>
          <Show when={info()}>
            <text fg={accent()}>{"Context"}</text>
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

    // Sidebar: one title, then one row per figure. A failed script call leaves the
    // context row in place and a single placeholder instead of the plan windows.
    const sidebar = context.ui.slot({
      append: "sidebar.content",
      render: (props: any) => {
        sessionID = props.sessionID
        return (
          <box flexDirection="column">
            <text fg={muted()} onMouseUp={() => openDetail(props.sessionID)}>
              {TITLE}
            </text>
            <box onMouseUp={() => openDetail(props.sessionID)}>
              <ContextRow sessionID={props.sessionID} cost label />
            </box>
            <For each={rows()}>
              {(row) => <PlanRow row={row} onDetail={() => openDetail(props.sessionID)} />}
            </For>
            <Show when={rows().length === 0}>
              <text fg={muted()}>{col("plan") + "n/a"}</text>
            </Show>
          </box>
        )
      },
    })

    // Prompt footer row: no label column, the plan windows in the compact form,
    // and a divider between the two areas.
    const footer = context.ui.slot({
      append: "prompt.footer.status",
      render: (props: any) => (
        <box flexDirection="row" gap={0}>
          <ContextRow sessionID={props.sessionID} />
          <Show when={rows().length > 0}>
            <text>{" | " + brief(rows())}</text>
          </Show>
        </box>
      ),
    })

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

    return () => {
      clearInterval(contextTimer)
      clearInterval(rowsTimer)
      sidebar()
      footer()
      footerShortcuts?.()
    }
  },
})
