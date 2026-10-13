/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import { cycleOption, optionKeys, optionLabel, type Config } from "./src/config"

// The options panel: one row per config value, and a click moves that value to its
// next state. It writes the same config.json a hand edit does, through the same
// cycleOption the tests cover, so a click and a hand edit cannot produce different
// files.
//
// onClose is optional and only draws the way out: whether Esc closes one of these
// dialogs is not verified, so the panel offers the same click-to-close line the
// detail dialog does.
export function Settings(props: {
  config: () => Config
  onChange: (cfg: Config) => void
  onClose?: () => void
}) {
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      title="Settings"
      titleAlignment="left"
      paddingLeft={2}
      paddingRight={2}
    >
      <text>{"Click a row to move it to its next value."}</text>
      <text>{" "}</text>
      <For each={optionKeys(props.config())}>
        {(key) => (
          <text onMouseUp={() => props.onChange(cycleOption(props.config(), key))}>
            {optionLabel(props.config(), key)}
          </text>
        )}
      </For>
      <text>{" "}</text>
      <Show when={props.onClose}>
        <text onMouseUp={() => props.onClose?.()}>{"esc, or a click here, closes"}</text>
      </Show>
    </box>
  )
}
