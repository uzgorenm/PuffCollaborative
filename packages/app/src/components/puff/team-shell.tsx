import { For, Show, createMemo, createEffect, type ParentProps } from "solid-js"
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
import { loadHomeSessionIndex, type HomeSessionEvents } from "@/context/global-sync/home-session-index"
import { sessionHref } from "@/utils/session-route"
import { ContextPanel } from "./context-panel"
import { SessionIdentity, sessionIdentityView, type SessionIdentityProps } from "./session-identity"
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
  const matches = (title: string) => title.toLowerCase().includes(filter.text.toLowerCase())
  const identityLabels = (): SessionIdentityProps["labels"] => ({
    session: language.t("puff.session"),
    worker: language.t("puff.worker"),
    owner: language.t("puff.owner"),
    runState: (state) => language.t(`puff.team.run.${state}`),
  })
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
    <div class="team-shell" classList={{ "team-collapsed": !team.state.sidebar }}>
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
          <label class="team-search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label={language.t("puff.team.search")}
              placeholder={language.t("puff.team.search")}
              value={filter.text}
              onInput={(event) => setFilter("text", event.currentTarget.value)}
            />
          </label>
          <div class="team-section-heading">{language.t("puff.team.yours")}</div>
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
          <div class="team-section-heading team-shared-heading">
            <span>{language.t("puff.team.shared")}</span>
            <span class="team-mini-count">{team.state.threads.length || "—"}</span>
          </div>
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
            <label class="team-project-select">
              <span class="team-sr-only">{language.t("puff.team.project")}</span>
              <select
                value={team.state.projectId}
                onChange={(event) => void team.loadProject(event.currentTarget.value)}
              >
                <For each={team.state.projects}>{(project) => <option value={project.id}>{project.name}</option>}</For>
              </select>
            </label>
            <Show
              when={team.state.threads.length}
              fallback={<p class="team-empty-text">{language.t("puff.team.noShared")}</p>}
            >
              <For each={team.state.threads.filter((thread) => matches(thread.title))}>
                {(thread) => {
                  const identity = (): SessionIdentityProps => ({
                    title: thread.title,
                    sessionId: thread.sessionId,
                    workerId: thread.workerId,
                    threadId: thread.id,
                    run:
                      team.writable() && team.state.snapshot?.thread.id === thread.id
                        ? team.state.snapshot.runs.find(
                            (run) =>
                              run.threadId === thread.id && !["completed", "failed", "cancelled"].includes(run.state),
                          )
                        : undefined,
                    labels: identityLabels(),
                  })
                  return (
                    <A
                      class="team-session-item"
                      activeClass="team-session-active"
                      href={`/puff/thread/${encodeURIComponent(thread.id)}`}
                      aria-label={sessionIdentityView(identity()).accessibleLabel}
                    >
                      <span class="team-avatar" aria-hidden="true">
                        {thread.createdBy.replace(/^usr_/, "").slice(0, 2).toUpperCase()}
                      </span>
                      <SessionIdentity {...identity()} density="rail" />
                    </A>
                  )
                }}
              </For>
            </Show>
          </Show>
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
