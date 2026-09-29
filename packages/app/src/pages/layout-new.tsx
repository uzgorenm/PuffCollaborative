import { createEffect, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { TeamActivitySidebar } from "@/pages/layout/team-activity"
import { sessionHref } from "@/utils/session-route"
import { setV2Toast, ToastRegion } from "@/utils/toast"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const server = useServer()
  const navigate = useNavigate()
  const [state, setState] = createStore({ debugTools: true })

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <main class="flex flex-1 min-h-0 min-w-0 overflow-hidden items-stretch">
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Suspense>{props.children}</Suspense>
        </div>
        <aside class="hidden w-80 min-w-80 shrink-0 overflow-y-auto border-s border-border-weak-base bg-background-base xl:flex xl:flex-col">
          <TeamActivitySidebar
            serverUrl={server.current?.http.url}
            onOpenSession={(sessionId) => navigate(sessionHref(server.key, sessionId))}
          />
        </aside>
      </main>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
