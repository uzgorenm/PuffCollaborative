import { batch } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { createTeamApi, type TeamThread } from "./team-api"
import { ProjectApiError, serviceUrl, type ProjectTransport } from "./project-api"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { activeFailure, verifiedFix, fixInstruction, type VerifiedFix } from "./fix-reuse"

export type FixAttempt = { fix: VerifiedFix; requestId: string; runId?: string; uncertain: boolean }

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
type Decision = { approval: Coordination.Approval; decisionId: string; account: string }
type SourceRef = { threadId: string; eventId: string; seq: number }
type Compartment = {
  drafts: Record<string, Draft>
  pending: Record<string, Submission | undefined>
  positions: Record<string, Position>
  decisions: Record<string, Decision | undefined>
  fixAttempts: Record<string, FixAttempt | undefined>
  dismissedFixes: Record<string, boolean>
}
type Read = { controller: AbortController; promise?: Promise<void> }
type OverviewRead = {
  project: Coordination.SharedProject
  members: readonly Coordination.Membership[]
  threads: readonly Coordination.Thread[]
  cards: readonly Coordination.WorkCard[]
  snapshots: readonly TeamThread[]
}

export function createTeamController(transport?: ProjectTransport) {
  const [state, set] = createStore({
    connected: false,
    connecting: false,
    sidebar: true,
    context: true,
    projects: [] as readonly Coordination.SharedProject[],
    threads: [] as readonly Coordination.Thread[],
    overview: undefined as OverviewRead | undefined,
    overviewLoading: false,
    overviewError: "" as "" | ProjectApiError["code"],
    overviewLastSuccess: 0,
    projectId: "",
    threadId: "",
    serviceUrl: "",
    sourceScope: "",
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
    fixProposal: undefined as VerifiedFix | undefined,
    fixLoading: false,
    fixError: "" as "" | ProjectApiError["code"],
    fixAttempts: {} as Record<string, FixAttempt | undefined>,
    dismissedFixes: {} as Record<string, boolean>,
    approvalIds: {} as Record<string, string>,
  })
  const compartments = new Map<string, Compartment>()
  const errors = { thread: "", roster: "", action: "" } as Record<"thread" | "roster" | "action", typeof state.error>
  let decisions: Compartment["decisions"] = {}
  let account = ""
  let api: ReturnType<typeof createTeamApi> | undefined
  let connection = 0
  let selection = 0
  let sourceSelection = 0
  let connecting: AbortController | undefined
  let reading: Read | undefined
  let roster: Read | undefined
  let overviewRead: Read | undefined
  let fixRead: AbortController | undefined
  let fixStamp = ""

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
    fixRead?.abort()
    fixRead = undefined
    fixStamp = ""
    set({ fixProposal: undefined, fixLoading: false, fixError: "" })
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
          fixAttempts: unwrap(state.fixAttempts),
          dismissedFixes: unwrap(state.dismissedFixes),
        }),
      )
    connection++
    sourceSelection++
    invalidateThread()
    roster?.controller.abort()
    roster = undefined
    overviewRead?.controller.abort()
    overviewRead = undefined
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
        sourceScope: "",
        projects: [],
        threads: [],
        overview: undefined,
        overviewLoading: false,
        overviewError: "",
        overviewLastSuccess: 0,
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
      set("fixAttempts", reconcile({}))
      set("dismissedFixes", reconcile({}))
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
        compartments.get(account) ?? {
          drafts: {},
          pending: {},
          positions: {},
          decisions: {},
          fixAttempts: {},
          dismissedFixes: {},
        },
      )
      decisions = saved.decisions
      batch(() => {
        set("drafts", reconcile(saved.drafts))
        set("pending", reconcile(saved.pending))
        set("positions", reconcile(saved.positions))
        set("fixAttempts", reconcile(saved.fixAttempts))
        set("dismissedFixes", reconcile(saved.dismissedFixes))
        set({
          connected: true,
          projects,
          serviceUrl: url,
          sourceScope: crypto.randomUUID(),
          loading: !!state.threadId,
          lastSuccess: 0,
        })
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
    sourceSelection++
    roster?.controller.abort()
    roster = undefined
    overviewRead?.controller.abort()
    overviewRead = undefined
    fixRead?.abort()
    fixRead = undefined
    fixStamp = ""
    set({ fixProposal: undefined, fixLoading: false, fixError: "" })
    set({
      projectId: id,
      threads: [],
      overview: undefined,
      overviewError: "",
      overviewLastSuccess: 0,
      overviewLoading: false,
    })
    errors.roster = ""
    showError()
    return refreshRoster()
  }

  function refreshOverview(): Promise<void> {
    if (!api || !state.projectId) return Promise.resolve()
    if (overviewRead) return overviewRead.promise ?? Promise.resolve()
    const current = api
    const projectId = state.projectId
    const ticket = connection
    const read: Read = { controller: new AbortController() }
    overviewRead = read
    set("overviewLoading", true)
    const valid = () =>
      overviewRead === read &&
      current === api &&
      ticket === connection &&
      state.projectId === projectId &&
      !read.controller.signal.aborted
    read.promise = (async () => {
      try {
        const [{ project, members }, threads, cards] = await Promise.all([
          current.project(projectId, read.controller.signal),
          current.threads(projectId, read.controller.signal),
          current.workCards(projectId, read.controller.signal),
        ])
        if (!valid()) return
        if (
          threads.some((thread) => thread.projectId !== projectId) ||
          cards.some((card) => !threads.some((thread) => thread.id === card.threadId))
        )
          throw new ProjectApiError("invalid")
        const snapshots = await Promise.all(threads.map((thread) => current.thread(thread.id, read.controller.signal)))
        if (!valid()) return
        if (
          snapshots.some((snapshot, index) => {
            const thread = threads[index]
            return (
              !thread ||
              snapshot.thread.id !== thread.id ||
              snapshot.thread.projectId !== projectId ||
              snapshot.thread.sessionId !== thread.sessionId ||
              snapshot.thread.workerId !== thread.workerId ||
              snapshot.thread.activitySeq !== thread.activitySeq
            )
          })
        )
          throw new ProjectApiError("invalid")
        const next = { project, members, threads, cards, snapshots }
        // Keep citation controls and their focus stable across identical polling responses.
        if (JSON.stringify(state.overview) !== JSON.stringify(next)) set("overview", reconcile(next))
        set({ overviewError: "", overviewLastSuccess: Date.now() })
        void refreshFix()
      } catch (error) {
        if (!valid()) return
        if (error instanceof ProjectApiError && [401, 403].includes(error.status)) {
          clearConnection("unauthorized")
          return
        }
        set({
          overview: undefined,
          overviewLastSuccess: 0,
          overviewError: error instanceof ProjectApiError ? error.code : "connection",
        })
      } finally {
        if (overviewRead === read) {
          overviewRead = undefined
          set("overviewLoading", false)
        }
      }
    })()
    return read.promise
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
    sourceSelection++
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
          if (approval.deliveryState === "delivered") delete decisions[approval.id]
        }
        batch(() => {
          // Preserve keyed row identity so routine polling does not replace focused controls.
          set("snapshot", reconcile(snapshot))
          set({ events, cursor, lastSuccess: more ? 0 : Date.now(), loading: more })
        })
        errors.thread = errors.action = ""
        showError()
        void refreshFix()
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

  async function refreshFix() {
    const current = api
    const target = state.snapshot && structuredClone(unwrap(state.snapshot.thread))
    const overview = state.overview
    const failure = activeFailure(state.events, state.threadId)
    if (
      !current ||
      !target ||
      target.id !== state.threadId ||
      !failure ||
      !overview ||
      overview.project.id !== target.projectId ||
      state.projectId !== target.projectId ||
      state.overviewError ||
      Date.now() - state.overviewLastSuccess > 20_000 ||
      state.error
    ) {
      fixRead?.abort()
      fixRead = undefined
      fixStamp = ""
      set({ fixProposal: undefined, fixLoading: false })
      return
    }
    const cards = overview.cards.filter(
      (card) =>
        card.threadId !== target.id &&
        card.status === "done" &&
        card.sourceActivitySeq === overview.threads.find((thread) => thread.id === card.threadId)?.activitySeq,
    )
    const stamp = JSON.stringify([
      state.sourceScope,
      target.id,
      target.activitySeq,
      failure.id,
      failure.seq,
      cards,
      overview.members,
    ])
    if (stamp === fixStamp) return
    fixRead?.abort()
    const controller = new AbortController()
    fixRead = controller
    fixStamp = stamp
    const ticket = connection
    const generation = selection
    const valid = () =>
      !controller.signal.aborted &&
      current === api &&
      ticket === connection &&
      generation === selection &&
      state.threadId === target.id &&
      state.snapshot?.thread.activitySeq === target.activitySeq &&
      fixRead === controller &&
      fixStamp === stamp
    set({ fixProposal: undefined, fixLoading: true, fixError: "" })
    try {
      const choices = await Promise.all(
        cards.slice(0, 20).map(async (card) => {
          const thread = overview.threads.find((thread) => thread.id === card.threadId)!
          const sources = await Promise.all(
            card.evidenceRefs.slice(0, 10).map((ref) => current.source(target.projectId, ref, controller.signal)),
          )
          return sources
            .map((source) =>
              verifiedFix({
                failure,
                thread,
                card,
                source,
                memberIds: overview.members.map((member) => member.userId),
              }),
            )
            .find((fix) => !!fix)
        }),
      )
      if (!valid()) return
      const fix = choices
        .filter((fix): fix is VerifiedFix => !!fix)
        .toSorted((a, b) => b.source.occurredAt.localeCompare(a.source.occurredAt))[0]
      set("fixProposal", fix && !state.dismissedFixes[`${fix.failure.id}:${fix.source.id}`] ? fix : undefined)
    } catch (error) {
      if (!valid()) return
      fixStamp = ""
      if (error instanceof ProjectApiError && [401, 403].includes(error.status)) clearConnection("unauthorized")
      else set("fixError", error instanceof ProjectApiError ? error.code : "connection")
    } finally {
      if (fixRead === controller) {
        fixRead = undefined
        set("fixLoading", false)
      }
    }
  }

  function dismissFix() {
    const fix = state.fixProposal
    if (!fix || state.action) return
    set("dismissedFixes", `${fix.failure.id}:${fix.source.id}`, true)
    set("fixProposal", undefined)
  }

  function canApplyFix() {
    return (
      state.connected &&
      !!state.snapshot &&
      !state.loading &&
      !state.error &&
      !!state.lastSuccess &&
      Date.now() - state.lastSuccess < 8_000 &&
      !state.action &&
      !state.pending[state.threadId] &&
      !state.fixAttempts[state.threadId]?.runId
    )
  }

  async function applyFix() {
    const previous = state.fixAttempts[state.threadId]
    const fix = previous?.uncertain ? previous.fix : state.fixProposal
    const current = api
    const target = state.snapshot?.thread
    if (!current || !target || !fix || !canApplyFix()) return
    const ticket = connection
    const generation = selection
    const id = target.id
    const valid = () => current === api && ticket === connection && generation === selection && state.threadId === id
    set({ action: `fix:${id}`, fixError: "" })
    try {
      // Exact retries reconcile an ambiguous admission even if the target has since completed.
      if (!previous?.uncertain) {
        const [source, sourceThread, targetThread, cards, project] = await Promise.all([
          current.source(target.projectId, {
            threadId: fix.source.threadId!,
            eventId: fix.source.id,
            seq: fix.source.seq,
          }),
          current.thread(fix.source.threadId!),
          current.thread(id),
          current.workCards(target.projectId),
          current.project(target.projectId),
        ])
        if (!valid()) return
        const card = cards.find((item) => item.threadId === fix.source.threadId)
        const checked =
          card &&
          verifiedFix({
            failure: fix.failure,
            thread: sourceThread.thread,
            card,
            source,
            memberIds: project.members.map((member) => member.userId),
          })
        if (
          !checked ||
          JSON.stringify(checked) !== JSON.stringify(fix) ||
          targetThread.thread.activitySeq !== target.activitySeq ||
          activeFailure(state.events, id)?.id !== fix.failure.id
        )
          throw new ProjectApiError("conflict", 409)
      }
      const attempt = previous?.uncertain ? previous : { fix, requestId: crypto.randomUUID(), uncertain: true }
      if (!valid()) return
      set("fixAttempts", id, attempt)
      const response = await current.submit(id, fixInstruction(attempt.fix), attempt.requestId)
      if (!valid()) return
      if (
        response.instruction.threadId !== id ||
        response.instruction.requestId !== attempt.requestId ||
        response.instruction.text !== fixInstruction(attempt.fix) ||
        response.run.threadId !== id ||
        response.run.id !== response.instruction.runId
      )
        throw new ProjectApiError("invalid")
      set("fixAttempts", id, { ...attempt, uncertain: false, runId: response.run.id })
      invalidateThread()
      overviewRead?.controller.abort()
      overviewRead = undefined
    } catch (error) {
      if (!valid()) return
      if (
        error instanceof ProjectApiError &&
        [400, 401, 403, 404, 409, 422].includes(error.status) &&
        !previous?.uncertain
      )
        set("fixAttempts", id, undefined)
      set("fixError", error instanceof ProjectApiError ? error.code : "connection")
      if (error instanceof ProjectApiError && [401, 403].includes(error.status)) clearConnection("unauthorized")
    } finally {
      if (ticket === connection) {
        set("action", "")
        if (state.fixAttempts[id]?.runId) await Promise.all([refresh(), refreshOverview()])
        else void refresh()
      }
    }
  }

  async function resolveSource(ref: SourceRef, signal: AbortSignal): Promise<Coordination.Event> {
    const current = api
    const visible = state.snapshot?.thread
    const projectId = visible?.projectId
    const rosterProject = state.projectId
    const target = state.threadId
    const scope = state.sourceScope
    const identity = account
    const ticket = connection
    const generation = sourceSelection
    if (
      !current ||
      !state.connected ||
      !projectId ||
      !target ||
      visible?.id !== target ||
      !scope ||
      !identity ||
      signal.aborted
    )
      throw new ProjectApiError("invalid")
    const event = await current.source(projectId, ref, signal)
    if (
      signal.aborted ||
      current !== api ||
      ticket !== connection ||
      identity !== account ||
      scope !== state.sourceScope ||
      generation !== sourceSelection ||
      rosterProject !== state.projectId ||
      target !== state.threadId ||
      state.snapshot?.thread.id !== target ||
      state.snapshot.thread.projectId !== projectId ||
      event.projectId !== projectId ||
      event.threadId !== ref.threadId ||
      event.id !== ref.eventId ||
      event.seq !== ref.seq
    )
      throw new ProjectApiError("invalid")
    return event
  }

  async function resolveOverviewSource(ref: SourceRef, signal: AbortSignal): Promise<Coordination.Event> {
    const current = api
    const read = state.overview
    const projectId = state.projectId
    const identity = account
    const scope = state.sourceScope
    const ticket = connection
    const generation = sourceSelection
    const expected = { threadId: ref.threadId, eventId: ref.eventId, seq: ref.seq }
    const cited = (overview: OverviewRead | undefined) =>
      !!overview &&
      overview.project.id === projectId &&
      overview.cards.some(
        (card) =>
          card.threadId === expected.threadId &&
          card.evidenceRefs.some(
            (item) =>
              item.threadId === expected.threadId && item.eventId === expected.eventId && item.seq === expected.seq,
          ),
      )
    if (!current || !state.connected || !identity || !scope || !projectId || !cited(read) || signal.aborted)
      throw new ProjectApiError("invalid")
    const event = await current.source(projectId, expected, signal)
    if (
      signal.aborted ||
      current !== api ||
      ticket !== connection ||
      identity !== account ||
      scope !== state.sourceScope ||
      generation !== sourceSelection ||
      state.projectId !== projectId ||
      !cited(state.overview) ||
      event.projectId !== projectId ||
      event.threadId !== expected.threadId ||
      event.id !== expected.eventId ||
      event.seq !== expected.seq
    )
      throw new ProjectApiError("invalid")
    return event
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

  function canRetryDecision(value: Coordination.Approval): boolean {
    const attempt = decisions[value.id]
    const visible = state.snapshot?.approvals.find((approval) => approval.id === value.id)
    return !!(
      api &&
      account &&
      attempt?.account === account &&
      writable() &&
      !state.action &&
      value.threadId === state.threadId &&
      visible?.threadId === state.threadId &&
      visible.version === value.version &&
      visible.decisionId === attempt.decisionId &&
      visible.decision === "reject" &&
      visible.state === "rejected" &&
      visible.deliveryState === value.deliveryState &&
      (visible.deliveryState === "pending" || visible.deliveryState === "failed")
    )
  }

  async function retryDecision(value: Coordination.Approval): Promise<void> {
    if (!canRetryDecision(value)) return
    await control("reject", value)
  }

  async function control(kind: "cancel" | "approve" | "reject", value: Coordination.Run | Coordination.Approval) {
    // This API exposes only tool IDs, not reviewable permission details.
    if (kind === "approve" || !api || !writable() || state.action || value.threadId !== state.threadId) return
    if (
      kind === "reject" &&
      "toolCallId" in value &&
      (value.state === "approved" || value.state === "rejected") &&
      !canRetryDecision(value)
    )
      return
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
          attempt = { approval, decisionId: crypto.randomUUID(), account }
          decisions[value.id] = attempt
        }
        // An uncertain decision retries the original claimed version and ID directly.
        const result = await current.decide(id, attempt.approval, "reject", attempt.decisionId)
        if (ticket === connection && result.deliveryState === "delivered") delete decisions[value.id]
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
    refreshOverview,
    refreshFix,
    dismissFix,
    applyFix,
    canApplyFix,
    resolveSource,
    resolveOverviewSource,
    send,
    control,
    canRetryDecision,
    retryDecision,
    writable,
    dispose: () => {
      clearConnection()
      compartments.clear()
    },
  }
}
