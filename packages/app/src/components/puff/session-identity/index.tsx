import { Show, createMemo } from "solid-js"
import { sessionIdentityView, type SessionIdentityProps } from "./model"
import "./session-identity.css"

export { sessionIdentityView } from "./model"
export type { SessionIdentityProps } from "./model"

export function SessionIdentity(props: SessionIdentityProps) {
  const view = createMemo(() => sessionIdentityView(props))
  return (
    <span
      class="puff-session-identity"
      classList={{ "puff-session-identity--header": props.density === "header" }}
      role="group"
      aria-label={view().accessibleLabel}
      title={view().accessibleLabel}
    >
      <span class="puff-session-identity__title" aria-hidden="true">{view().title}</span>
      <Show when={view().state}>
        {(state) => <span class="puff-session-identity__state" aria-hidden="true">{state()}</span>}
      </Show>
    </span>
  )
}
