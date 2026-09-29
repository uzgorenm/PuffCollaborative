import { For, Show, createMemo, createEffect, onCleanup, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { A, useLocation, useNavigate } from "@solidjs/router"
import { QueryClientProvider, useQuery } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useGlobal, type ServerCtx } from "@/context/global"
import { ServerConnection, serverName, useServer } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { useTeam } from "@/pages/puff/team-context"
import { FixSuggestion } from "@/pages/puff/fix-suggestion"
import { loadHomeSessionIndex, type HomeSessionEvents } from "@/context/global-sync/home-session-index"
import { sessionHref } from "@/utils/session-route"
import { ContextPanel } from "./context-panel"
import { SessionIdentity, sessionIdentityView, type SessionIdentityProps } from "./session-identity"
import { projectRail } from "./project-rail-model"
import "./team.css"

export function TeamShell(props: ParentProps) {
  const team = useTeam()
  const language = useLanguage()
  const global = useGlobal()
  const server = useServer()
  const tabs = useTabs()
  const navigate = useNavigate()
  const location = useLocation()
  const dialog = useDialog()
  const [filter, setFilter] = createStore({ text: "" })
  const openConnection = () => void dialog.show(() => <TeamConnection team={team} />)
  const identityLabels = (): SessionIdentityProps["labels"] => ({
    session: language.t("puff.session"),
    worker: language.t("puff.worker"),
    owner: language.t("puff.owner"),
    runState: (state) => language.t(`puff.team.run.${state}`),
  })
  const rail = createMemo(() => projectRail({
    projectId: team.state.projectId,
    threads: team.state.threads,
    overview: team.state.overview,
    simulation: team.state.simulation,
    missing: language.t("puff.team.rail.noReport"),
    stale: language.t("puff.team.rail.staleReport"),
    loading: language.t("puff.team.rail.loadingReport"),
    loadingReport: team.state.overviewLoading,
    t: (key) => language.t(key as keyof typeof import("@/i18n/puff-en").puff),
  }))
  const personName = (id: string) => {
    const actor = team.state.simulation?.actors.find((item) => item.userId === id)
    if (actor) return actor.displayName
    const index = rail().members.findIndex((item) => item.userId === id)
    return index < 0 ? language.t("puff.team.rail.unknownPerson") : language.t("puff.team.rail.memberFallback", { number: index + 1 })
  }
  const projectName = (projectId: string, name: string) => {
    const scenario = team.state.simulation?.scenarios.find((item) => item.projectId === projectId)
    return scenario ? language.t(`puff.team.people.demoProject.${scenario.id}`) : name
  }
  const selectedProjectName = createMemo(() => {
    const project = team.state.projects.find((item) => item.id === team.state.projectId)
    return project ? projectName(project.id, project.name) : undefined
  })
  const visibleGroups = createMemo(() => {
    const query = filter.text.trim().toLowerCase()
    return rail().groups.flatMap((group) => {
      const nameMatches = personName(group.member.userId).toLowerCase().includes(query)
      const sessions = !query || nameMatches ? group.sessions : group.sessions.filter((row) =>
        `${row.thread.title} ${row.summary}`.toLowerCase().includes(query))
      if (query && !nameMatches && !sessions.length && !group.reports.some((report) => report.text.toLowerCase().includes(query))) return []
      return [{ ...group, sessions, allSessionCount: group.sessions.length }]
    })
  })
  const visibleUnknownRows = createMemo(() => rail().unknownRows.filter((row) =>
    !filter.text || `${row.thread.title} ${row.summary}`.toLowerCase().includes(filter.text.trim().toLowerCase())))
  createEffect(() => {
    if (team.state.connected && team.state.projectId) void team.refreshOverview()
  })
  const overviewPoll = setInterval(() => {
    if (team.state.connected && team.state.projectId) void team.refreshOverview()
  }, 12_000)
  onCleanup(() => clearInterval(overviewPoll))
  const createSession = () => {
    const conn = server.current
    if (!conn) return
    const projects = global.ensureServerCtx(conn).projects
    void tabs.newDraft({
      server: ServerConnection.key(conn),
      directory: projects.last() ?? projects.list()[0]?.worktree ?? "",
    })
  }
  const localSession = createMemo(() =>
    tabs.store.find((tab) => tab.type === "session" && sessionHref(tab.server, tab.sessionId) === location.pathname),
  )
  const localTarget = createMemo(() => {
    const tab = localSession()
    if (!tab || tab.type !== "session") return
    const conn = global.servers.list().find((item) => ServerConnection.key(item) === tab.server)
    const sameService = !!team.state.serviceUrl && conn?.http.url.replace(/\/+$/, "") === team.state.serviceUrl
    const matches = sameService ? team.state.threads.filter((thread) => thread.sessionId === tab.sessionId) : []
    const thread = matches.length === 1 ? matches[0] : undefined
    return { sessionId: tab.sessionId, workerId: thread?.workerId, threadId: thread?.id }
  })
  createEffect(() => {
    if (location.pathname.startsWith("/puff/thread/")) return
    team.selectThread(localTarget()?.threadId ?? "")
  })
  const localSnapshot = () => {
    const target = localTarget()
    const snapshot = team.state.snapshot
    return target?.threadId === snapshot?.thread.id &&
      target?.workerId === snapshot?.thread.workerId &&
      target?.sessionId === snapshot?.thread.sessionId
      ? snapshot
      : undefined
  }
  let contextToggle: HTMLButtonElement | undefined
  const closeContext = () => {
    team.set("context", false)
    contextToggle?.focus()
  }
  return (
    <div class="team-shell" classList={{
      "team-collapsed": !team.state.sidebar,
      "team-show-demo-controls": !!team.state.simulation && new URLSearchParams(location.search).has("demo-controls"),
    }}>
      <aside class="team-sidebar" aria-label={language.t("puff.team.sessions")}>
        <div class="team-rail-head">
          <A href="/" class="team-logo" aria-label={language.t("puff.team.home")}>
            p<span>{language.t("puff.name")}</span>
          </A>
          <button
            class="team-icon"
            type="button"
            onClick={() => team.set("sidebar", (value) => !value)}
            aria-label={language.t(team.state.sidebar ? "puff.team.collapse" : "puff.team.expand")}
            aria-expanded={team.state.sidebar}
          >
            ◧
          </button>
        </div>
        <button type="button" class="team-new" onClick={createSession} title={language.t("puff.team.newSession")}>
          <span aria-hidden="true">＋</span>
          <span>{language.t("puff.team.newSession")}</span>
        </button>
        <div class="team-rail-body" inert={!team.state.sidebar}>
          <div class="team-section-heading team-projects-heading">{language.t("puff.team.rail.projects")}</div>
          <Show when={team.state.connected}>
            <label class="team-project-select">
              <span class="team-project-icon" aria-hidden="true">▱</span>
              <span class="team-sr-only">{language.t("puff.team.project")}</span>
              <select
                value={team.state.projectId}
                title={selectedProjectName()}
                onChange={(event) => {
                  void team.chooseProject(event.currentTarget.value)
                }}
              >
                <For each={team.state.projects}>{(project) => <option value={project.id}>{projectName(project.id, project.name)}</option>}</For>
              </select>
            </label>
          </Show>
          <Show
            when={team.state.connected}
            fallback={
              <div class="team-empty-rail">
                <span class="team-orbit" aria-hidden="true">
                  ↗
                </span>
                <strong>{language.t("puff.team.workTogether")}</strong>
                <p>{language.t("puff.team.connectHint")}</p>
                <Button onClick={openConnection}>{language.t("puff.team.connect")}</Button>
              </div>
            }
          >
            <div class="team-section-heading team-people-heading">{language.t("puff.team.rail.people")}</div>
            <label class="team-search">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label={language.t("puff.team.search")}
                placeholder={language.t("puff.team.search")}
                value={filter.text}
                onInput={(event) => setFilter("text", event.currentTarget.value)}
              />
            </label>
            <Show when={!rail().members.length}>
              <p class="team-empty-text">{language.t(team.state.overviewLoading ? "puff.team.rail.loadingPeople" : "puff.team.rail.noPeople")}</p>
            </Show>
            <Show when={!rail().rows.length}><p class="team-empty-text">{language.t("puff.team.noShared")}</p></Show>
            <Show when={rail().members.length && filter.text.trim() && !visibleGroups().length && !visibleUnknownRows().length}>
              <p class="team-empty-text">{language.t("puff.team.noMatches")}</p>
            </Show>
            <For each={visibleGroups()}>{(group) => <section class="team-person-group" aria-label={personName(group.member.userId)}>
              <header class="team-person-heading">
                <span class="team-person-avatar" aria-hidden="true">{personName(group.member.userId).slice(0, 2).toUpperCase()}</span>
                <strong>{personName(group.member.userId)}</strong>
              </header>
              <div class="team-person-overview">
                <Show when={group.startedTopics.length}>
                  <strong>{language.t("puff.team.people.startedTopics")}</strong>
                  <For each={group.startedTopics}>{(topic) => <p>{topic}</p>}</For>
                </Show>
                <Show when={group.reports.length}>
                  <strong>{language.t("puff.team.people.contributorReports")}</strong>
                  <For each={group.reports}>{(report) => <p>{report.text}</p>}</For>
                  <details class="team-person-sources">
                    <summary>{language.t("puff.team.people.reportSources")}</summary>
                    <For each={group.reports}>{(report) => <A href={`/puff/thread/${encodeURIComponent(report.threadId)}`}>
                      {language.t("puff.team.people.reportSource", { title: report.threadTitle, event: report.sourceRef.eventId })}
                    </A>}</For>
                  </details>
                </Show>
                <Show when={!group.startedTopics.length && !group.reports.length}>
                  <p>{language.t("puff.team.people.noCurrentReport")}</p>
                </Show>
              </div>
              <div class="team-person-sessions">
                <Show when={group.sessions.length} fallback={<p class="team-empty-text">{language.t(
                  group.allSessionCount ? "puff.team.people.noMatchingSessions" : "puff.team.people.noStartedSessions",
                )}</p>}>
                  <For each={group.sessions}>{(row) => <SharedSessionRow row={row} creator={personName(group.member.userId)} />}</For>
                </Show>
              </div>
              <details class="team-person-attribution">
                <summary>{language.t("puff.team.people.aboutAttribution")}</summary>
                <p>{language.t("puff.team.people.attributionHint")}</p>
              </details>
            </section>}</For>
            <Show when={visibleUnknownRows().length}>
              <section class="team-person-group team-person-unknown" aria-label={language.t("puff.team.rail.unknownCreator")}>
                <header class="team-person-heading"><span class="team-person-avatar" aria-hidden="true">?</span>
                  <strong>{language.t("puff.team.rail.unknownCreator")}</strong></header>
                <p class="team-person-unknown-note">{language.t("puff.team.people.unknownCreatorHint")}</p>
                <div class="team-person-sessions">
                  <For each={visibleUnknownRows()}>{(row) => <SharedSessionRow row={row} />}</For>
                </div>
              </section>
            </Show>
          </Show>
          <div class="team-section-heading team-private-heading">{language.t("puff.team.yours")}</div>
          <For each={global.servers.list()}>
            {(conn) => {
              const ctx = global.ensureServerCtx(conn)
              return (
                <QueryClientProvider client={ctx.queryClient}>
                  <PersonalSessions ctx={ctx} conn={conn} filter={filter.text} labels={identityLabels()} />
                </QueryClientProvider>
              )
            }}
          </For>
          <Show when={team.state.error}>
            <div role="status" class="team-sidebar-error">
              {language.t(`puff.${team.state.error || "request"}`)}
              <button type="button" onClick={() => void team.refresh()}>
                {language.t("puff.refresh")}
              </button>
            </div>
          </Show>
        </div>
        <div class="team-rail-footer">
          <Show
            when={team.state.connected}
            fallback={
              <button
                class="team-connection-button"
                type="button"
                onClick={openConnection}
                title={language.t("puff.team.connect")}
              >
                <span class="team-status-dot" />
                <span>{language.t("puff.team.connect")}</span>
              </button>
            }
          >
            <button
              class="team-connection-button"
              type="button"
              disabled={!!team.state.action}
              onClick={() => {
                team.disconnect()
                if (location.pathname.startsWith("/puff")) navigate("/")
              }}
              title={language.t("puff.disconnect")}
            >
              <span class="team-status-dot connected" />
              <span>{language.t("puff.team.connected")}</span>
              <small>↪</small>
            </button>
          </Show>
          <Show when={team.state.simulation}>
            <details class="team-simulation-details">
              <summary>{language.t("puff.team.connectionSettings")}</summary>
              <p>{language.t("puff.simulation.bannerDetail")}</p>
              <A href="/puff?demo-controls=1">{language.t("puff.team.people.demoControls")}</A>
            </details>
          </Show>
        </div>
      </aside>
      <div
        class="team-main team-local-host"
        classList={{
          "team-local-active": !!localTarget(),
          "team-local-context-open": !!localTarget() && team.state.context,
        }}
      >
        <Show when={localTarget()}>
          <div class="team-local-toolbar">
            <span>{language.t("puff.team.codingSession")}</span>
            <button
              ref={contextToggle}
              type="button"
              class="team-context-toggle"
              aria-expanded={team.state.context}
              aria-controls="local-team-context"
              onClick={() => team.set("context", (value) => !value)}
            >
              {language.t("puff.team.context")}
              <span aria-hidden="true">◧</span>
            </button>
          </div>
        </Show>
        <Show when={localSnapshot()}><FixSuggestion /></Show>
        <div class="team-local-grid">
          <div class="team-local-chat">{props.children}</div>
          <aside
            id="local-team-context"
            class="team-context-panel team-local-context"
            inert={!localTarget() || !team.state.context}
            aria-label={language.t("puff.team.context")}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation()
                closeContext()
              }
            }}
          >
            <ContextPanel
              target={localTarget()}
              snapshot={localSnapshot()}
              related={team.state.threads}
              connected={team.state.connected}
              loading={!!localTarget()?.threadId && team.state.loading}
              error={team.state.error}
              writable={!!localSnapshot() && team.writable()}
              busy={!!team.state.action}
              onCancel={(run) => void team.control("cancel", run)}
              onReject={(approval) => void team.control("reject", approval)}
              sourceScope={team.state.sourceScope}
              resolveSource={team.resolveSource}
              canRetryDecision={team.canRetryDecision}
              onRetryDecision={team.retryDecision}
            />
          </aside>
        </div>
      </div>
    </div>
  )
}

function SharedSessionRow(props: { row: ReturnType<typeof projectRail>["rows"][number]; creator?: string }) {
  const language = useLanguage()
  return <A class="team-session-item" activeClass="team-session-active"
    href={`/puff/thread/${encodeURIComponent(props.row.thread.id)}`}>
    <span class="team-chat-glyph" aria-hidden="true">◌</span>
    <span class="team-session-copy">
      <span class="team-sr-only">{props.creator
        ? language.t("puff.team.rail.startedBy", { person: props.creator })
        : language.t("puff.team.people.unknownCreatorHint")}</span>
      <span class="team-session-topline">
        <strong title={props.row.thread.title}>{props.row.thread.title}</strong>
        <Show when={props.row.runState}>{(state) => <span class="team-session-run" data-state={state()}>
          {language.t(`puff.team.rail.run.${state()}`)}
        </span>}</Show>
      </span>
      <span class="team-session-summary">{props.row.summary}</span>
    </span>
  </A>
}

function PersonalSessions(props: {
  ctx: ServerCtx
  conn: ServerConnection.Any
  filter: string
  labels: SessionIdentityProps["labels"]
}) {
  const language = useLanguage()
  const tabs = useTabs()
  const cache = props.ctx.sync.homeSessions
  const events = useQuery(() => ({
    queryKey: cache.eventsKey,
    queryFn: async (): Promise<HomeSessionEvents> => ({ sequence: 0, entries: [] }),
    initialData: { sequence: 0, entries: [] },
    enabled: false,
  }))
  const sessions = useQuery(() => ({
    queryKey: cache.indexKey,
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const sequence = cache.eventSequence()
      const index = await loadHomeSessionIndex(
        (input, options) => props.ctx.sdk.client.v2.session.list(input, options),
        sequence,
        signal,
      )
      cache.complete(sequence)
      return index
    },
  }))
  const list = createMemo(() =>
    cache
      .sessions(sessions.data, events.data)
      .filter((session) => !session.time.archived && session.title.toLowerCase().includes(props.filter.toLowerCase()))
      .sort((a, b) => b.time.updated - a.time.updated)
      .slice(0, 15),
  )
  const location = useLocation()
  return (
    <div class="team-personal-list">
      <Show when={sessions.isLoading}>
        <div class="team-loading-lines" aria-label={language.t("puff.team.loading")}>
          <i />
          <i />
          <i />
        </div>
      </Show>
      <Show when={sessions.isError}>
        <p class="team-empty-text">
          {language.t("puff.team.localUnavailable")}
          <button type="button" onClick={() => void sessions.refetch()}>
            {language.t("puff.refresh")}
          </button>
        </p>
      </Show>
      <Show when={!sessions.isLoading && !sessions.isError && !list().length}>
        <p class="team-empty-text">{language.t(props.filter ? "puff.team.noMatches" : "puff.team.noLocal")}</p>
      </Show>
      <For each={list()}>
        {(session) => (
          <button
            class="team-session-item"
            classList={{
              "team-session-active": location.pathname === sessionHref(ServerConnection.key(props.conn), session.id),
            }}
            type="button"
            aria-label={
              sessionIdentityView({ title: session.title, sessionId: session.id, labels: props.labels }).accessibleLabel
            }
            onClick={() => {
              props.ctx.projects.open(session.directory)
              props.ctx.projects.touch(session.directory)
              tabs.select(tabs.addSessionTab({ server: ServerConnection.key(props.conn), sessionId: session.id }))
            }}
          >
            <span class="team-chat-glyph" aria-hidden="true">
              ◌
            </span>
            <span class="team-session-copy">
              <SessionIdentity title={session.title} sessionId={session.id} labels={props.labels} density="rail" />
              <small>{session.directory.split(/[\\/]/).filter(Boolean).at(-1) || serverName(props.conn)}</small>
            </span>
          </button>
        )}
      </For>
    </div>
  )
}

export function TeamConnection(props: { team: ReturnType<typeof useTeam> }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [form, set] = createStore({ url: props.team.defaultUrl(), username: "", password: "" })
  return (
    <Dialog title={language.t("puff.team.connectTitle")} description={language.t("puff.team.connectDescription")}>
      <form
        class="team-connect-form"
        onSubmit={async (event) => {
          event.preventDefault()
          const password = form.password
          set("password", "")
          if (await props.team.connect(form.url.trim(), form.username.trim(), password)) dialog.close()
        }}
      >
        <label>
          {language.t("puff.username")}
          <input
            autofocus
            autocomplete="username"
            value={form.username}
            onInput={(event) => set("username", event.currentTarget.value)}
            required
          />
        </label>
        <label>
          {language.t("puff.password")}
          <input
            type="password"
            autocomplete="off"
            value={form.password}
            onInput={(event) => set("password", event.currentTarget.value)}
            required
          />
        </label>
        <details>
          <summary>{language.t("puff.team.connectionSettings")}</summary>
          <label>
            {language.t("puff.hubUrl")}
            <input type="url" value={form.url} onInput={(event) => set("url", event.currentTarget.value)} required />
          </label>
        </details>
        <Show when={props.team.state.error}>
          <p class="team-error" role="alert">
            {language.t(`puff.${props.team.state.error || "request"}`)}
          </p>
        </Show>
        <p class="team-caption">{language.t("puff.team.credentialsHint")}</p>
        <Button type="submit" variant="primary" disabled={props.team.state.connecting}>
          {language.t(props.team.state.connecting ? "puff.connecting" : "puff.team.connect")}
        </Button>
      </form>
    </Dialog>
  )
}
