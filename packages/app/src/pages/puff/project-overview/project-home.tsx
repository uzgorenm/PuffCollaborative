import { Show, createEffect, createMemo, createResource, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useGlobal } from "@/context/global"
import { ServerConnection } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { loadHomeSessionIndex, type HomeSessionEvents } from "@/context/global-sync/home-session-index"
import { sessionHref } from "@/utils/session-route"
import { TeamConnection } from "@/components/puff/team-shell"
import { createSourcePeek, type SourcePeekState } from "@/components/puff/context-panel/source-peek"
import { useTeam } from "../team-context"
import { teamEventText } from "../team-state"
import { buildProjectOverview } from "./overview-model"
import { ProjectOverviewView, type OverviewCopyKey, type PrivateSession, type SourceRef } from "./overview-view"
import { SimulationGuide } from "./simulation-guide"
import { scenarioForProject } from "./simulation-contract"

type OtherSession = PrivateSession & { serverKey: ReturnType<typeof ServerConnection.key>; directory: string }

export function ProjectHome() {
  const team = useTeam()
  const global = useGlobal()
  const tabs = useTabs()
  const language = useLanguage()
  const navigate = useNavigate()
  const dialog = useDialog()
  const [peekView, setPeekView] = createStore<{ source: SourcePeekState }>({ source: { status: "closed" } })
  const peek = createSourcePeek((source) => setPeekView("source", source))
  const sourceScope = createMemo(() => {
    const read = team.state.overview
    if (!read || !team.state.sourceScope || read.project.id !== team.state.projectId) return ""
    return JSON.stringify([team.state.sourceScope, read.project.id,
      read.cards.map((card) => [card.id, card.version, card.sourceActivitySeq])])
  })
  createEffect(() => peek.setScope(sourceScope(), team.resolveOverviewSource))
  onCleanup(() => peek.close())

  createEffect(() => {
    if (team.state.connected && team.state.projectId) void team.refreshOverview()
  })
  const interval = setInterval(() => {
    if (team.state.connected && team.state.projectId) void team.refreshOverview()
  }, 12_000)
  onCleanup(() => clearInterval(interval))

  const [local] = createResource(
    () => JSON.stringify([!!team.state.simulation, global.servers.list().map((server) => ServerConnection.key(server))]),
    async (): Promise<OtherSession[]> => {
      if (team.state.simulation) return []
      const servers = global.servers.list()
      const results = await Promise.allSettled(servers.map(async (server) => {
        const ctx = global.ensureServerCtx(server)
        const cache = ctx.sync.homeSessions
        const index = await ctx.queryClient.fetchQuery({
          queryKey: cache.indexKey,
          staleTime: 30_000,
          queryFn: async ({ signal }) => {
            const sequence = cache.eventSequence()
            const result = await loadHomeSessionIndex(
              (input, options) => ctx.sdk.client.v2.session.list(input, options), sequence, signal,
            )
            cache.complete(sequence)
            return result
          },
        })
        const events = ctx.queryClient.getQueryData<HomeSessionEvents>(cache.eventsKey)
        const serverKey = ServerConnection.key(server)
        return cache.sessions(index, events).map((session): OtherSession => ({
          id: session.id,
          title: session.title,
          updatedAt: new Date(session.time.updated).toISOString(),
          href: sessionHref(serverKey, session.id),
          serverKey,
          directory: session.directory,
        }))
      }))
      return results.flatMap((result) => result.status === "fulfilled" ? result.value : [])
    },
  )

  const other = createMemo(() => local()?.filter((session) => {
    const server = global.servers.list().find((item) => ServerConnection.key(item) === session.serverKey)
    const sameService = !!team.state.serviceUrl && server?.http.url.replace(/\/+$/, "") === team.state.serviceUrl
    return !sameService || !team.state.threads.some((thread) => thread.sessionId === session.id)
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 15) ?? [])
  const view = createMemo(() => {
    const read = team.state.overview
    if (!read || read.project.id !== team.state.projectId) return
    return buildProjectOverview({ ...read, statedFocus: [] })
  })
  const t = (key: OverviewCopyKey, values?: Record<string, string | number>) =>
    language.t(`puff.overview.${key}`, values)
  let closeSourceButton: HTMLButtonElement | undefined
  const openOther = (session: PrivateSession) => {
    const entry = other().find((item) => item.id === session.id && item.href === session.href)
    const server = global.servers.list().find((item) => ServerConnection.key(item) === entry?.serverKey)
    if (!entry || !server) return
    const ctx = global.ensureServerCtx(server)
    ctx.projects.open(entry.directory)
    ctx.projects.touch(entry.directory)
    tabs.select(tabs.addSessionTab({ server: entry.serverKey, sessionId: entry.id }))
  }
  const inspect = (ref: SourceRef) => {
    const citedByCard = view()?.sessions.some((session) => session.thread.id === ref.threadId &&
      session.card?.evidenceRefs.some((item) => item.threadId === ref.threadId && item.eventId === ref.eventId && item.seq === ref.seq))
    const demo = team.state.simulation
    const source = demo?.wf02?.sourceRef
    const citedByDemo = demo && scenarioForProject(demo, team.state.projectId)?.id === "wf02" &&
      source?.threadId === ref.threadId && source.eventId === ref.eventId && source.seq === ref.seq
    if (!citedByCard && !citedByDemo) return
    void peek.inspect(ref, team.state.projectId, document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
    queueMicrotask(() => closeSourceButton?.focus())
  }

  return (
    <Show when={team.state.connected} fallback={
      <main class="team-conversation-empty team-welcome">
        <span class="team-empty-symbol">✳</span>
        <h1>{t("connectTitle")}</h1>
        <p>{t("connectHint")}</p>
        <button type="button" onClick={() => void dialog.show(() => <TeamConnection team={team} />)}>{t("connectAction")}</button>
        <button type="button" onClick={() => void team.connect("http://127.0.0.1:4187", "alice", "demo-alice")}>{language.t("puff.simulation.connect")}</button>
        <p>{language.t("puff.simulation.connectHint")}</p>
        <Show when={team.state.error}><p role="alert">{language.t(`puff.${team.state.error || "request"}`)}</p></Show>
      </main>
    }>
      <Show when={team.state.projectId} fallback={<main class="team-conversation-empty team-welcome"><h1>{t("title")}</h1><p>{t("noProject")}</p></main>}>
        <Show when={team.state.simulation}>
          {(manifest) => <SimulationGuide
            manifest={manifest()}
            projectId={team.state.projectId}
            busy={!!team.state.simulationAction}
            error={!!team.state.simulationError}
            operator={team.state.simulationOperator}
            onSelect={(id) => void team.chooseProject(id)}
            onAdvance={() => void team.advanceSimulation()}
            onReset={() => void team.resetSimulation()}
            onInspect={inspect}
            onOpenTarget={(id) => navigate(`/puff/thread/${encodeURIComponent(id)}`)}
          />}
        </Show>
        <Show when={view()} fallback={
          <main class="team-conversation-empty team-welcome" role="status">
            <h1>{t("title")}</h1>
            <p>{team.state.overviewError ? t("loadError") : t("loading")}</p>
            <Show when={team.state.overviewError}><button type="button" onClick={() => void team.refreshOverview()}>{language.t("puff.refresh")}</button></Show>
          </main>
        }>
          {(value) => <>
            <ProjectOverviewView
              view={value()}
              privateSessions={team.state.simulation ? [] : other()}
              related={[]}
              t={t}
              onInspect={inspect}
              onOpenShared={(id) => navigate(`/puff/thread/${encodeURIComponent(id)}`)}
              onOpenPrivate={openOther}
              actorLabel={team.state.simulation ? (id) =>
                team.state.simulation?.actors.find((actor) => actor.userId === id)?.displayName ?? language.t("puff.simulation.unknownActor")
              : undefined}
            />
            <Show when={peekView.source.status !== "closed"}>
              <aside class="puff-overview-peek" role="region" aria-label={language.t("puff.team.sourceEvent")} onKeyDown={(event) => {
                if (event.key === "Escape") { event.stopPropagation(); peek.close(true) }
              }}>
                <button ref={closeSourceButton} type="button" onClick={() => peek.close(true)}>{language.t("puff.team.sourceClose")}</button>
                <Show when={peekView.source.status === "loading"}><p role="status">{language.t("puff.team.sourceLoading")}</p></Show>
                <Show when={peekView.source.status === "missing"}><p role="status">{language.t("puff.team.sourceMissing")}</p></Show>
                <Show when={peekView.source.status === "no-access"}><p role="status">{language.t("puff.team.sourceNoAccess")}</p></Show>
                <Show when={peekView.source.status === "unavailable"}><p role="status">{language.t("puff.team.sourceUnavailable")}</p></Show>
                <Show when={peekView.source.status === "ready" ? peekView.source.event : undefined}>
                  {(event) => <>
                    <p><strong>{event().kind}</strong></p>
                    <p><code>{event().id}</code></p>
                    <p>{language.t("puff.team.sequence", { sequence: event().seq })}</p>
                    <p>{teamEventText(event()) || language.t("puff.team.recorded")}</p>
                  </>}
                </Show>
              </aside>
            </Show>
          </>}
        </Show>
      </Show>
    </Show>
  )
}
