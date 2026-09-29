import { batch } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { createTeamApi, type TeamThread } from "./team-api"
import { ProjectApiError, serviceUrl, type ProjectTransport } from "./project-api"
import type { Coordination } from "@opencode-ai/schema/coordination"

export type Submission = {
  threadId: string
  kind: "instruction" | "comment"
  text: string
  requestId: string
  uncertain?: boolean
}

export function mergeTeamEvents(
  current: readonly Coordination.Event[],
  incoming: readonly Coordination.Event[],
  threadId: string,
) {
  return [
    ...new Map(
      [...current, ...incoming].filter((event) => event.threadId === threadId).map((event) => [event.id, event]),
    ).values(),
  ].sort((a, b) => a.seq - b.seq)
}

export function submissionAttempt(
  current: Submission | undefined,
  input: Omit<Submission, "requestId">,
  id: () => string = () => crypto.randomUUID(),
): Submission {
  if (!current) return { ...input, requestId: id() }
  if (current.threadId !== input.threadId || current.kind !== input.kind || current.text !== input.text)
    throw new Error("Unresolved submission")
  return current
}

export function teamEventText(event: Coordination.Event) {
  const field =
    event.kind === "comment.created"
      ? "body"
      : event.kind === "run.output" || event.kind === "instruction.submitted"
        ? "text"
        : "summary"
  return typeof event.payload[field] === "string" ? event.payload[field] : ""
}

type Draft = { text: string; kind: "instruction" | "comment" }
type Position = { top: number; followTail: boolean }
type Decision = { approval: Coordination.Approval; decisionId: string }
type Compartment = {
  drafts: Record<string, Draft>
  pending: Record<string, Submission | undefined>
  positions: Record<string, Position>
  decisions: Record<string, Decision | undefined>
}
type Read = { controller: AbortController; promise?: Promise<void> }

export function createTeamController(transport?: ProjectTransport) {
  const [state, set] = createStore({
    connected: false,
    connecting: false,
    sidebar: true,
    context: true,
    projects: [] as readonly Coordination.SharedProject[],
    threads: [] as readonly Coordination.Thread[],
    projectId: "",
    threadId: "",
    serviceUrl: "",
    snapshot: undefined as TeamThread | undefined,
    events: [] as Coordination.Event[],
    cursor: 0,
    loading: false,
    error: "" as "" | ProjectApiError["code"],
    lastSuccess: 0,
    now: Date.now(),
    drafts: {} as Record<string, Draft>,
    pending: {} as Record<string, Submission | undefined>,
    positions: {} as Record<string, Position>,
    action: "",
    approvalIds: {} as Record<string, string>,
  })
  const compartments = new Map<string, Compartment>()
  const errors = { thread: "", roster: "", action: "" } as Record<"thread" | "roster" | "action", typeof state.error>
  let decisions: Compartment["decisions"] = {}
  let account = ""
  let api: ReturnType<typeof createTeamApi> | undefined
  let connection = 0
  let selection = 0
  let connecting: AbortController | undefined
  let reading: Read | undefined
  let roster: Read | undefined

  const writable = () =>
    state.connected &&
    !!state.snapshot &&
    !state.error &&
    state.lastSuccess > 0 &&
    state.now - state.lastSuccess < 8_000 &&
    !state.loading &&
    state.snapshot.thread.id === state.threadId
  const showError = () => set("error", errors.thread || errors.roster || errors.action)

  function invalidateThread() {
    selection++
    reading?.controller.abort()
    reading = undefined
  }

  function clearConnection(error: typeof state.error = "") {
    if (account)
      compartments.set(
        account,
        structuredClone({
          drafts: unwrap(state.drafts),
          pending: unwrap(state.pending),
          positions: unwrap(state.positions),
          decisions,
        }),
      )
    connection++
    invalidateThread()
    roster?.controller.abort()
    roster = undefined
    connecting?.abort()
    connecting = undefined
    api = undefined
    account = ""
    decisions = {}
    errors.thread = errors.roster = errors.action = ""
    batch(() => {
      set({
        connected: false,
        connecting: false,
        serviceUrl: "",
        projects: [],
        threads: [],
        projectId: "",
        snapshot: undefined,
        events: [],
        cursor: 0,
        loading: false,
        lastSuccess: 0,
        error,
        action: "",
      })
      set("drafts", reconcile({}))
      set("pending", reconcile({}))
      set("positions", reconcile({}))
      set("approvalIds", reconcile({}))
    })
  }

  function fail(error: unknown, source: keyof typeof errors) {
    if (error instanceof ProjectApiError && [401, 403].includes(error.status)) {
      clearConnection("unauthorized")
      return
    }
    errors[source] = error instanceof ProjectApiError ? error.code : "connection"
    showError()
  }

  async function connect(baseUrl: string, username: string, password: string) {
    if (state.connecting || state.action || state.connected) return false
    const ticket = ++connection
    const controller = new AbortController()
    connecting = controller
    set({ connecting: true, error: "" })
    try {
      const url = serviceUrl(baseUrl).replace(/\/+$/, "")
      const member = username.trim()
      const client = createTeamApi({ baseUrl: url, username: member, password, transport })
      const projects = await client.projects(controller.signal)
      if (ticket !== connection) return false
      api = client
      account = JSON.stringify([url, member])
      const saved = structuredClone(
        compartments.get(account) ?? { drafts: {}, pending: {}, positions: {}, decisions: {} },
      )
      decisions = saved.decisions
      batch(() => {
        set("drafts", reconcile(saved.drafts))
        set("pending", reconcile(saved.pending))
        set("positions", reconcile(saved.positions))
        set({ connected: true, projects, serviceUrl: url, loading: !!state.threadId, lastSuccess: 0 })
      })
      if (projects[0]) await loadProject(projects[0].id)
      if (ticket !== connection) return false
      void refreshThread()
      return true
    } catch (error) {
      if (ticket === connection) fail(error, "roster")
      return false
    } finally {
      if (ticket === connection) {
        connecting = undefined
        set("connecting", false)
      }
    }
  }

  function disconnect() {
    if (state.action) return
    clearConnection()
  }

  function loadProject(id: string) {
    if (!api) return Promise.resolve()
    roster?.controller.abort()
    roster = undefined
    set({ projectId: id, threads: [] })
    errors.roster = ""
    showError()
    return refreshRoster()
  }

  function refreshRoster(): Promise<void> {
    if (!api) return Promise.resolve()
    if (roster) return roster.promise ?? Promise.resolve()
    const current = api
    const ticket = connection
    const read: Read = { controller: new AbortController() }
    roster = read
    const valid = () => roster === read && current === api && ticket === connection && !read.controller.signal.aborted
    read.promise = (async () => {
      try {
        const projects = await current.projects(read.controller.signal)
        if (!valid()) return
        const project = projects.find((value) => value.id === state.projectId) ?? projects[0]
        const threads = project ? await current.threads(project.id, read.controller.signal) : []
        if (!valid()) return
        if (threads.some((thread) => thread.projectId !== project?.id)) throw new ProjectApiError("invalid")
        batch(() => {
          set("projects", reconcile(projects))
          set("threads", reconcile(threads))
          set("projectId", project?.id ?? "")
        })
        errors.roster = ""
        showError()
      } catch (error) {
        if (valid()) fail(error, "roster")
      } finally {
        if (roster === read) roster = undefined
      }
    })()
    return read.promise
  }

  function selectThread(id: string) {
    if (state.threadId === id) return
    invalidateThread()
    errors.thread = errors.action = ""
    set({ threadId: id, snapshot: undefined, events: [], cursor: 0, lastSuccess: 0, loading: !!id && state.connected })
    showError()
    void refreshThread()
  }

  function refreshThread(): Promise<void> {
    if (!api || !state.threadId || state.action) return Promise.resolve()
    if (reading) return reading.promise ?? Promise.resolve()
    const current = api
    const id = state.threadId
    const ticket = connection
    const generation = selection
    const read: Read = { controller: new AbortController() }
    reading = read
    const valid = () =>
      reading === read && ticket === connection && generation === selection && !read.controller.signal.aborted
    let more = false
    read.promise = (async () => {
      try {
        const snapshot = await current.thread(id, read.controller.signal)
        if (!valid()) return
        if (snapshot.thread.id !== id) throw new ProjectApiError("invalid")
        let cursor = state.cursor
        let events = [...state.events]
        for (let page = 0; page < 25; page++) {
          const replay = await current.events(id, cursor, read.controller.signal)
          if (!valid()) return
          if (
            replay.events.some((event) => event.threadId !== id || event.projectId !== snapshot.thread.projectId) ||
            replay.cursor < cursor ||
            (replay.hasMore && replay.cursor <= cursor)
          )
            throw new ProjectApiError("invalid")
          events = mergeTeamEvents(events, replay.events, id)
          cursor = replay.cursor
          more = replay.hasMore
          if (!more) break
        }
        if (!valid()) return
        for (const approval of snapshot.approvals) {
          if (approval.state === "approved" || approval.state === "rejected") delete decisions[approval.id]
        }
        batch(() => {
          // Preserve keyed row identity so routine polling does not replace focused controls.
          set("snapshot", reconcile(snapshot))
          set({ events, cursor, lastSuccess: more ? 0 : Date.now(), loading: more })
        })
        errors.thread = errors.action = ""
        showError()
      } catch (error) {
        more = false
        if (valid()) {
          set("loading", false)
          fail(error, "thread")
        }
      } finally {
        if (reading === read) {
          reading = undefined
          // A capped batch is incomplete, never fresh. Continue without waiting for polling.
          if (more)
            queueMicrotask(() => {
              if (ticket === connection && generation === selection) void refreshThread()
            })
        }
      }
    })()
    return read.promise
  }

  async function refresh() {
    await Promise.all([refreshRoster(), refreshThread()])
  }

  async function send() {
    const id = state.threadId
    const draft = state.drafts[id]
    if (!api || !writable() || state.action || !draft?.text.trim()) return
    const current = api
    const ticket = connection
    const previous = state.pending[id]
    const attempt = submissionAttempt(previous, { threadId: id, kind: draft.kind, text: draft.text.trim() })
    // Once dispatched the outcome is uncertain until a definitive response arrives.
    // This also preserves identity when a concurrent read invalidates authentication.
    set("pending", id, { ...attempt, uncertain: true })
    set("action", id)
    try {
      if (attempt.kind === "comment") await current.comment(id, attempt.text, attempt.requestId)
      else await current.submit(id, attempt.text, attempt.requestId)
      if (ticket !== connection) return
      set("pending", id, undefined)
      set("drafts", id, { text: "", kind: attempt.kind })
    } catch (error) {
      if (ticket !== connection) return
      if (!previous?.uncertain && error instanceof ProjectApiError && [400, 401, 403, 404, 422].includes(error.status))
        set("pending", id, undefined)
      fail(error, "action")
    } finally {
      if (ticket === connection) {
        set("action", "")
        void refresh()
      }
    }
  }

  async function control(kind: "cancel" | "approve" | "reject", value: Coordination.Run | Coordination.Approval) {
    // This API exposes only tool IDs, not reviewable permission details.
    if (kind === "approve" || !api || !writable() || state.action || value.threadId !== state.threadId) return
    const current = api
    const id = state.threadId
    const ticket = connection
    set("action", value.id)
    try {
      if (kind === "cancel" && "instructionId" in value) await current.cancel(id, value.instructionId)
      if (kind === "reject" && "toolCallId" in value) {
        let attempt = decisions[value.id]
        if (!attempt) {
          if (value.state === "approved" || value.state === "rejected") return
          const approval = await current.claim(id, value)
          if (ticket !== connection) return
          attempt = { approval, decisionId: crypto.randomUUID() }
          decisions[value.id] = attempt
        }
        // An uncertain decision retries the original claimed version and ID directly.
        await current.decide(id, attempt.approval, "reject", attempt.decisionId)
        if (ticket === connection) delete decisions[value.id]
      }
    } catch (error) {
      if (ticket === connection) fail(error, "action")
    } finally {
      if (ticket === connection) {
        set("action", "")
        void refresh()
      }
    }
  }

  return {
    state,
    set,
    connect,
    disconnect,
    loadProject,
    selectThread,
    refresh,
    send,
    control,
    writable,
    dispose: () => {
      clearConnection()
      compartments.clear()
    },
  }
}
