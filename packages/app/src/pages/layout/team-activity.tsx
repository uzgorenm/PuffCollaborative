import { createEffect, For, onCleanup, Show, untrack, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"

type MemberCredentials = { username: string; password: string; baseUrl: string }
type SharedProject = { id: string; name: string }
type SourceThread = { sessionId: string; threadId: string }
type Working = {
  id: string
  sourceThread: SourceThread
  status: string
  objective: string | null
  step: string | null
  blockers: string[]
  recentVerifiedOutcome: string | null
}
type Queued = { id: string; sourceThread: SourceThread; actorId: string; text: string }
type Recent = {
  id: string
  sourceThread: SourceThread | null
  kind: string
  occurredAt: string
  actorId: string | null
  outcome: string | null
}
type ActivityView = { workingNow: Working[]; upNext: Queued[]; recent: Recent[] }
type ApiError = "connection" | "unauthorized" | "unavailable" | "invalid" | "request"

export function TeamActivitySidebar(props: {
  serverUrl?: string
  projectId?: string
  projectName?: string
  onOpenSession: (sessionId: string) => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({
    expanded: true,
    username: "",
    password: "",
    connecting: false,
    refreshing: false,
    credentials: undefined as MemberCredentials | undefined,
    projects: [] as SharedProject[],
    selectedProjectId: "",
    activity: undefined as ActivityView | undefined,
    error: "" as ApiError | "",
    stale: false,
  })

  async function connect(event: SubmitEvent) {
    event.preventDefault()
    if (!props.serverUrl || state.connecting) return
    setState({ connecting: true, error: "", stale: false })
    try {
      const credentials = {
        username: state.username.trim(),
        password: state.password,
        baseUrl: normalizeBaseUrl(props.serverUrl),
      }
      if (!credentials.username || !credentials.password) throw new CoordinationApiError("unauthorized")
      const projects = readProjects(await request(credentials, "/api/coordination/v1/projects"))
      const selectedProjectId =
        projects.find((project) => project.id === props.projectId)?.id ?? projects[0]?.id ?? ""
      setState({
        credentials,
        projects,
        selectedProjectId,
        password: "",
        connecting: false,
        error: "",
        activity: undefined,
      })
      if (selectedProjectId) await refresh(credentials, selectedProjectId)
    } catch (error) {
      setState({ error: errorCode(error), connecting: false })
    }
  }

  async function refresh(credentials = state.credentials, projectId = state.selectedProjectId, quiet = false) {
    if (!credentials || !projectId || state.refreshing) return
    setState({ refreshing: true, ...(quiet ? {} : { error: "" as const }) })
    try {
      const activity = readActivity(
        await request(credentials, `/api/coordination/v1/projects/${encodeURIComponent(projectId)}/activity`),
      )
      setState({ activity, refreshing: false, error: "", stale: false })
    } catch (error) {
      setState({ error: errorCode(error), refreshing: false, stale: !!state.activity })
    }
  }

  function disconnect() {
    setState({
      credentials: undefined,
      projects: [],
      selectedProjectId: "",
      activity: undefined,
      username: "",
      password: "",
      error: "",
      stale: false,
    })
  }

  createEffect(() => {
    const credentials = state.credentials
    const projectId = state.selectedProjectId
    if (!credentials || !projectId) return
    const timer = window.setInterval(() => untrack(() => void refresh(credentials, projectId, true)), 5_000)
    onCleanup(() => window.clearInterval(timer))
  })

  const errorMessage = () => {
    if (!state.error) return ""
    return language.t(errorTranslationKey(state.error))
  }

  return (
    <section class="shrink-0 border-t border-border-weak-base px-3 py-2" data-component="team-activity-sidebar">
      <button
        type="button"
        class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-surface-base-hover"
        aria-expanded={state.expanded}
        onClick={() => setState("expanded", !state.expanded)}
      >
        <span class="flex min-w-0 items-center gap-2 text-12-medium text-text-strong">
          <span class="size-2 shrink-0 rounded-full" classList={{
            "bg-icon-success-base": !!state.credentials && !state.error,
            "bg-icon-critical-base": !!state.error,
            "bg-border-weak-base": !state.credentials && !state.error,
          }} />
          <span class="truncate">{language.t("teamActivity.title")}</span>
          <Show when={state.activity?.recent.length}>
            <span class="text-11-regular text-text-weak">{state.activity?.recent.length}</span>
          </Show>
        </span>
        <span class="shrink-0 text-12-regular text-text-weak">{state.expanded ? "−" : "+"}</span>
      </button>

      <Show when={state.expanded}>
        <div class="mt-2 flex flex-col gap-2" aria-live="polite">
          <Show when={!state.credentials}>
            <form class="flex flex-col gap-2" onSubmit={connect}>
              <p class="px-2 text-11-regular text-text-weak">
                {props.projectName
                  ? language.t("teamActivity.signInHint", { project: props.projectName })
                  : language.t("teamActivity.signInHintGeneric")}
              </p>
              <label class="flex flex-col gap-1 px-2 text-11-medium text-text-base">
                {language.t("teamActivity.username")}
                <input
                  class="h-8 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular text-text-strong outline-none focus-visible:border-border-interactive-base"
                  autocomplete="username"
                  value={state.username}
                  onInput={(event) => setState("username", event.currentTarget.value)}
                  required
                />
              </label>
              <label class="flex flex-col gap-1 px-2 text-11-medium text-text-base">
                {language.t("teamActivity.password")}
                <input
                  class="h-8 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular text-text-strong outline-none focus-visible:border-border-interactive-base"
                  type="password"
                  autocomplete="current-password"
                  value={state.password}
                  onInput={(event) => setState("password", event.currentTarget.value)}
                  required
                />
              </label>
              <Button size="normal" class="mx-2" type="submit" disabled={state.connecting || !props.serverUrl}>
                {language.t(state.connecting ? "teamActivity.signingIn" : "teamActivity.signIn")}
              </Button>
            </form>
          </Show>

          <Show when={state.credentials}>
            <div class="flex items-center justify-between gap-2 px-2">
              <span class="truncate text-11-regular text-text-weak">
                {language.t("teamActivity.signedInAs", { username: state.credentials?.username ?? "" })}
              </span>
              <button type="button" class="shrink-0 text-11-medium text-text-base hover:text-text-strong" onClick={disconnect}>
                {language.t("teamActivity.signOut")}
              </button>
            </div>
            <Show when={state.projects.length > 1}>
              <label class="flex flex-col gap-1 px-2 text-11-medium text-text-base">
                {language.t("teamActivity.project")}
                <select
                  class="h-8 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular text-text-strong"
                  value={state.selectedProjectId}
                  onChange={(event) => {
                    setState({ selectedProjectId: event.currentTarget.value, activity: undefined })
                    void refresh(state.credentials, event.currentTarget.value)
                  }}
                >
                  <For each={state.projects}>{(project) => <option value={project.id}>{project.name}</option>}</For>
                </select>
              </label>
            </Show>
            <Show when={state.error}>
              <p class="px-2 text-11-regular text-icon-critical-base" role="alert">{errorMessage()}</p>
            </Show>
            <Show
              when={state.activity}
              fallback={
                <p class="px-2 text-11-regular text-text-weak">
                  {state.projects.length === 0
                    ? language.t("teamActivity.noProjects")
                    : language.t(state.refreshing ? "teamActivity.loading" : "teamActivity.noActivity")}
                </p>
              }
            >
              {(activity) => (
                <div class="max-h-64 overflow-y-auto px-1 pb-1">
                  <Show when={state.stale}>
                    <p class="px-1 pb-2 text-11-regular text-icon-critical-base">{language.t("teamActivity.stale")}</p>
                  </Show>
                  <Show when={activity().workingNow.length > 0}>
                    <ActivityGroup title={language.t("teamActivity.workingNow")}>
                      <For each={activity().workingNow.slice(0, 4)}>
                        {(item) => (
                          <button
                            type="button"
                            class="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-base-hover"
                            onClick={() => props.onOpenSession(item.sourceThread.sessionId)}
                          >
                            <span class="flex items-center justify-between gap-2 text-11-medium text-text-strong">
                              <span class="truncate">{item.objective ?? item.status}</span>
                              <span class="shrink-0 text-text-weak">{item.status}</span>
                            </span>
                            <Show when={item.step}>
                              <span class="line-clamp-2 text-11-regular text-text-weak">{item.step}</span>
                            </Show>
                            <Show when={item.blockers.length > 0}>
                              <span class="line-clamp-2 text-11-regular text-icon-critical-base">
                                {item.blockers.join(" · ")}
                              </span>
                            </Show>
                          </button>
                        )}
                      </For>
                    </ActivityGroup>
                  </Show>
                  <Show when={activity().upNext.length > 0}>
                    <ActivityGroup title={language.t("teamActivity.upNext")}>
                      <For each={activity().upNext.slice(0, 3)}>
                        {(item) => (
                          <button
                            type="button"
                            class="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-base-hover"
                            onClick={() => props.onOpenSession(item.sourceThread.sessionId)}
                          >
                            <span class="line-clamp-2 text-11-regular text-text-strong">{item.text}</span>
                            <span class="text-11-regular text-text-weak">
                              {language.t("teamActivity.queuedBy", { user: item.actorId })}
                            </span>
                          </button>
                        )}
                      </For>
                    </ActivityGroup>
                  </Show>
                  <Show when={activity().recent.length > 0}>
                    <ActivityGroup title={language.t("teamActivity.recent")}>
                      <For each={activity().recent.slice(0, 5)}>
                        {(item) => (
                          <button
                            type="button"
                            class="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-base-hover"
                            disabled={!item.sourceThread}
                            onClick={() => item.sourceThread && props.onOpenSession(item.sourceThread.sessionId)}
                          >
                            <span class="line-clamp-2 text-11-regular text-text-strong">
                              {item.outcome ?? eventLabel(item.kind)}
                            </span>
                            <span class="text-11-regular text-text-weak">
                              {language.t("teamActivity.recentBy", {
                                user: item.actorId ?? language.t("teamActivity.system"),
                                time: relativeTime(item.occurredAt),
                              })}
                            </span>
                          </button>
                        )}
                      </For>
                    </ActivityGroup>
                  </Show>
                  <Show when={!activity().workingNow.length && !activity().upNext.length && !activity().recent.length}>
                    <p class="px-2 py-1 text-11-regular text-text-weak">{language.t("teamActivity.noActivity")}</p>
                  </Show>
                  <button
                    type="button"
                    class="mt-1 w-full px-2 py-1 text-left text-11-medium text-text-base hover:text-text-strong"
                    disabled={state.refreshing}
                    onClick={() => void refresh()}
                  >
                    {language.t(state.refreshing ? "teamActivity.refreshing" : "teamActivity.refresh")}
                  </button>
                </div>
              )}
            </Show>
          </Show>
        </div>
      </Show>
    </section>
  )
}

function ActivityGroup(props: { title: string; children: JSX.Element }) {
  return (
    <div class="mb-2">
      <h3 class="px-2 pb-1 text-10-medium uppercase tracking-wide text-text-weak">{props.title}</h3>
      <div class="flex flex-col">{props.children}</div>
    </div>
  )
}

async function request(credentials: MemberCredentials, path: string): Promise<unknown> {
  const auth = btoa(
    Array.from(new TextEncoder().encode(`${credentials.username}:${credentials.password}`), (byte) =>
      String.fromCharCode(byte),
    ).join(""),
  )
  const response = await fetch(`${credentials.baseUrl}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    throw new CoordinationApiError("connection")
  })
  if (response.status === 503) throw new CoordinationApiError("unavailable")
  if (response.status === 401 || response.status === 403) throw new CoordinationApiError("unauthorized")
  if (!response.ok) throw new CoordinationApiError("request")
  return response.json().catch(() => {
    throw new CoordinationApiError("invalid")
  })
}

function normalizeBaseUrl(value: string) {
  if (!URL.canParse(value)) throw new CoordinationApiError("connection")
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol))
    throw new CoordinationApiError("connection")
  return url.href.replace(/\/$/, "")
}

function readProjects(value: unknown): SharedProject[] {
  if (!Array.isArray(value)) throw new CoordinationApiError("invalid")
  return value.map((entry) => {
    const item = record(entry)
    return { id: requiredString(item.id), name: requiredString(item.name) }
  })
}

function readActivity(value: unknown): ActivityView {
  const data = record(value)
  if (!Array.isArray(data.workingNow) || !Array.isArray(data.upNext) || !Array.isArray(data.recent))
    throw new CoordinationApiError("invalid")
  return {
    workingNow: data.workingNow.map((entry) => {
      const item = record(entry)
      return {
        id: requiredString(item.id),
        sourceThread: readSourceThread(item.sourceThread),
        status: requiredString(item.status),
        objective: nullableString(item.objective),
        step: nullableString(item.step),
        blockers: stringArray(item.blockers),
        recentVerifiedOutcome: nullableString(item.recentVerifiedOutcome),
      }
    }),
    upNext: data.upNext.map((entry) => {
      const item = record(entry)
      return {
        id: requiredString(item.id),
        sourceThread: readSourceThread(item.sourceThread),
        actorId: requiredString(item.actorId),
        text: requiredString(item.text),
      }
    }),
    recent: data.recent.map((entry) => {
      const item = record(entry)
      return {
        id: requiredString(item.id),
        sourceThread: item.sourceThread === null ? null : readSourceThread(item.sourceThread),
        kind: requiredString(item.kind),
        occurredAt: requiredString(item.occurredAt),
        actorId: nullableString(item.actorId),
        outcome: nullableString(item.outcome),
      }
    }),
  }
}

function readSourceThread(value: unknown): SourceThread {
  const item = record(value)
  return { sessionId: requiredString(item.sessionId), threadId: requiredString(item.threadId) }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CoordinationApiError("invalid")
  return value as Record<string, unknown>
}

function requiredString(value: unknown) {
  if (typeof value !== "string") throw new CoordinationApiError("invalid")
  return value
}

function nullableString(value: unknown): string | null {
  if (value !== null && typeof value !== "string") throw new CoordinationApiError("invalid")
  return value
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new CoordinationApiError("invalid")
  return value
}

function eventLabel(kind: string) {
  return kind.replace(/[.-]/g, " ")
}

function errorTranslationKey(code: ApiError) {
  switch (code) {
    case "connection":
      return "teamActivity.error.connection"
    case "unauthorized":
      return "teamActivity.error.unauthorized"
    case "unavailable":
      return "teamActivity.error.unavailable"
    case "invalid":
      return "teamActivity.error.invalid"
    case "request":
      return "teamActivity.error.request"
  }
}

function relativeTime(value: string) {
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return value
  const seconds = Math.max(0, Math.floor((Date.now() - date) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h`
}

function errorCode(value: unknown): ApiError {
  if (value instanceof CoordinationApiError) return value.code
  return "connection"
}

class CoordinationApiError extends Error {
  constructor(readonly code: ApiError) {
    super(code)
  }
}
