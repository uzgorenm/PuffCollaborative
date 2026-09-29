import { createSimpleContext } from "@opencode-ai/ui/context"
import { onCleanup } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { createTeamController } from "./team-state"

export const { use: useTeam, provider: TeamProvider } = createSimpleContext({
  name: "Team",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const server = useServer()
    const team = createTeamController(platform.fetch)
    const interval = setInterval(() => {
      team.set("now", Date.now())
      void team.refresh()
    }, 2_000)
    onCleanup(() => {
      team.dispose()
      clearInterval(interval)
    })
    return { ...team, defaultUrl: () => server.current?.http.url ?? "" }
  },
})
