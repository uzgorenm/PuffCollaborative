import { onCleanup } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import {
  createProjectApi,
  ProjectApiError,
  type ContextJob,
  type ProjectSnapshot,
  type Proposal,
  type SharedSession,
  type SharingInput,
} from "./project-api"
import { checkCoordination } from "./coordination-api"
import { rememberJob, pendingJob, submittedJob } from "./context-job"
import { previewSnapshot, type PreviewScenario } from "./preview"

export function createPuffController() {
  const [state, setState] = createStore({
    snapshot: previewSnapshot(),
    viewId: 1,
    mode: "preview" as "preview" | "live",
    scenario: "collaboration" as PreviewScenario,
    now: Date.now(),
    lastVerified: 0,
    error: "" as "" | ProjectApiError["code"],
    notice: "" as "" | "saved" | "simulated" | "backendReady",
    connectionOpen: false,
    connecting: false,
    connectionKind: "coordination" as "coordination" | "fixture",
    username: "",
    hubUrl: "",
    projectId: "",
    token: "",
    action: "",
    job: undefined as ContextJob | undefined,
    jobUnresolved: false,
  })
  let api: ReturnType<typeof createProjectApi> | undefined
  let epoch = 0
  let reading = false
  const approvals = new Map<string, { approvalId: string; decidedAt: string }>()
  const decisions = new Map<string, string>()
  const writable = () => state.mode === "preview" || (!state.error && state.now - state.lastVerified < 6_000)
  const busy = () => !!state.action || state.connecting
  const fail = (error: unknown) => setState("error", error instanceof ProjectApiError ? error.code : "connection")

  async function refresh() {
    if (!api || reading || state.action) return
    const current = api
    const ticket = epoch
    reading = true
    try {
      const snapshot = await current.snapshot(state.snapshot.projectId)
      if (ticket !== epoch) return
      setState({ snapshot, lastVerified: Date.now(), error: "" })
      if (state.job?.status === "pending") {
        const job = await current.request(state.job.requestId).catch(() => undefined)
        if (ticket !== epoch) return
        setState({ jobUnresolved: !job, ...(job ? { job } : {}) })
        if (job) rememberJob(state.hubUrl.trim(), snapshot.projectId, job)
      }
    } catch (error) {
      if (ticket === epoch) fail(error)
    } finally {
      reading = false
    }
  }

  async function connect() {
    if (state.connecting || state.action) return
    const ticket = ++epoch
    setState({ connecting: true, error: "", notice: "" })
    try {
      if (state.connectionKind === "coordination") {
        await checkCoordination({
          baseUrl: state.hubUrl.trim(),
          username: state.username.trim(),
          password: state.token,
        })
        if (ticket === epoch) setState({ notice: "backendReady", token: "", connectionOpen: false })
        return
      }
      const next = createProjectApi({ baseUrl: state.hubUrl.trim(), token: state.token.trim() })
      const snapshot = await next.snapshot(state.projectId.trim())
      if (ticket !== epoch) return
      api = next
      setState({
        snapshot,
        viewId: state.viewId + 1,
        mode: "live",
        lastVerified: Date.now(),
        now: Date.now(),
        connectionOpen: false,
        token: "",
        job: pendingJob(state.hubUrl.trim(), snapshot.projectId),
        jobUnresolved: false,
      })
    } catch (error) {
      if (ticket === epoch) fail(error)
    } finally {
      if (ticket === epoch) setState("connecting", false)
    }
  }

  function preview(scenario = state.scenario) {
    if (busy()) return
    epoch++
    api = undefined
    approvals.clear()
    decisions.clear()
    setState({
      mode: "preview",
      viewId: state.viewId + 1,
      scenario,
      snapshot: previewSnapshot(scenario),
      now: Date.now(),
      error: "",
      notice: "",
      token: "",
      job: undefined,
      jobUnresolved: false,
    })
  }

  async function action(
    key: string,
    live: (client: NonNullable<typeof api>) => Promise<unknown>,
    simulated: (snapshot: ProjectSnapshot) => ProjectSnapshot,
  ) {
    if (!writable() || busy()) return
    const ticket = ++epoch
    setState({ action: key, error: "", notice: "" })
    try {
      if (state.mode === "preview")
        setState({ snapshot: simulated(structuredClone(unwrap(state.snapshot))), notice: "simulated" })
      if (api) {
        await live(api)
        if (ticket === epoch) setState("notice", "saved")
      }
    } catch (error) {
      if (ticket === epoch) fail(error)
      return error
    } finally {
      if (ticket === epoch) {
        setState("action", "")
        void refresh()
      }
    }
  }

  function review(proposal: Proposal, decision: "approve" | "reject", finalText: string) {
    const key = JSON.stringify([proposal.proposalId, proposal.version, decision, finalText])
    const identity = approvals.get(key) ?? { approvalId: crypto.randomUUID(), decidedAt: new Date().toISOString() }
    approvals.set(key, identity)
    return action(
      key,
      (client) =>
        client.approve(proposal.proposalId, { ...identity, expectedVersion: proposal.version, decision, finalText }),
      (snapshot) => ({
        ...snapshot,
        proposals: snapshot.proposals.map((p) =>
          p.proposalId === proposal.proposalId
            ? { ...p, text: finalText, state: decision === "approve" ? "approved" : "rejected" }
            : p,
        ),
        deliveries:
          decision === "reject"
            ? snapshot.deliveries
            : [
                ...snapshot.deliveries,
                {
                  deliveryId: identity.approvalId,
                  sourceKind: "approvedProposal",
                  sourceId: proposal.proposalId,
                  targetWorkerId: proposal.targetWorkerId,
                  targetSessionId: proposal.targetSessionId,
                  messageId: null,
                  state: "pending",
                  error: null,
                },
              ],
      }),
    )
  }

  function sharing(session: SharedSession, input: SharingInput) {
    return action(
      `sharing:${session.workerId}:${session.sessionId}`,
      (client) => client.sharing(session.sessionId, input),
      (snapshot) => ({
        ...snapshot,
        sessions: snapshot.sessions.flatMap((s) =>
          s.workerId !== session.workerId || s.sessionId !== session.sessionId
            ? [s]
            : input.shared
              ? [
                  {
                    ...s,
                    featureTopic: input.featureTopic,
                    relationship: input.relationship,
                    awarenessMuted: input.awarenessMuted,
                  },
                ]
              : [],
        ),
        awarenessNotes: snapshot.awarenessNotes.map((note) =>
          !input.shared || input.awarenessMuted || input.featureTopic !== session.featureTopic
            ? (note.targetWorkerId === session.workerId && note.targetSessionId === session.sessionId) ||
              (note.sourceWorkerId === session.workerId && note.sourceSessionId === session.sessionId)
              ? { ...note, state: "stale" }
              : note
            : note,
        ),
      }),
    )
  }

  function accept(proposal: Proposal) {
    const key = JSON.stringify([proposal.proposalId, proposal.version, proposal.text])
    const decisionId = decisions.get(key) ?? crypto.randomUUID()
    decisions.set(key, decisionId)
    const input = {
      decisionId,
      projectId: state.snapshot.projectId,
      text: proposal.text,
      evidenceRefs: proposal.evidenceRefs,
      supersedesId: null,
    }
    return action(
      `decision:${key}`,
      (client) => client.acceptDecision(input),
      (snapshot) => ({
        ...snapshot,
        decisions: [
          ...snapshot.decisions,
          { ...input, approvedAt: new Date().toISOString(), approvedBy: snapshot.viewerId ?? "", state: "accepted" },
        ],
      }),
    )
  }

  async function check(session: SharedSession, question: string) {
    if (!writable() || busy() || state.job?.status === "pending") return
    const requestId = crypto.randomUUID()
    const input = {
      requestId,
      projectId: state.snapshot.projectId,
      targetWorkerId: session.workerId,
      targetSessionId: session.sessionId,
      question,
      evidenceRefs: state.snapshot.summaries.flatMap((s) => s.evidenceRefs),
      createdAt: new Date().toISOString(),
    }
    setState({ job: { requestId, status: "pending" }, jobUnresolved: false })
    if (state.mode === "live") rememberJob(state.hubUrl.trim(), input.projectId, { requestId, status: "pending" })
    const error = await action(
      `context:${requestId}`,
      (client) => client.context(input),
      (snapshot) => snapshot,
    )
    if (state.mode === "preview") setState("job", { requestId, status: "completed", runId: "example-flower-042" })
    // Keep the same request ID if submission was ambiguous; polling reconciles it without another paid run.
    if (error && state.mode === "live") {
      const job = submittedJob({ requestId, status: "pending" }, error)
      setState({ job, jobUnresolved: job.status === "pending" })
      rememberJob(state.hubUrl.trim(), input.projectId, job)
    }
  }

  const timer = setInterval(() => {
    if (state.mode !== "live") return
    setState("now", Date.now())
    void refresh()
  }, 2_000)
  onCleanup(() => {
    clearInterval(timer)
    epoch++
    api = undefined
  })
  return { state, setState, writable, busy, connect, preview, refresh, review, sharing, accept, check }
}
