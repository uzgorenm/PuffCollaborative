import { Schema } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { ProjectApiError, serviceUrl, type ProjectTransport } from "./project-api"

// Read-side compatibility with the registered backend at 0a91f6231a.
// Keep this adapter local until the team's newer schema is integrated.
const TeamWorkCard = Schema.Struct({
  ...Coordination.WorkCard.fields,
  projectId: Schema.optional(Coordination.ProjectID),
  recentVerifiedOutcome: Schema.optional(Schema.NullOr(Schema.String)),
  contributors: Schema.optional(Schema.Array(Coordination.UserID)),
  evidenceRefs: Schema.optional(
    Schema.Array(Schema.Struct({ threadId: Coordination.ThreadID, eventId: Schema.String, seq: Schema.Int })),
  ),
  generatedAt: Schema.optional(Schema.String),
  submittedBy: Schema.optional(Schema.String),
})

export const TeamThread = Schema.Struct({
  thread: Coordination.Thread,
  instructions: Schema.Array(Coordination.InstructionRequest),
  runs: Schema.Array(Coordination.Run),
  approvals: Schema.Array(Coordination.Approval),
  // The registered HTTP handler serializes an absent card as null.
  workCard: Schema.optional(Schema.NullOr(TeamWorkCard)),
  cursor: Schema.Int,
})
export type TeamThread = typeof TeamThread.Type
const Replay = Schema.Struct({ events: Schema.Array(Coordination.Event), cursor: Schema.Int, hasMore: Schema.Boolean })

export function createTeamApi(config: {
  baseUrl: string
  username: string
  password: string
  transport?: ProjectTransport
}) {
  const root = `${serviceUrl(config.baseUrl)}/api/coordination/v1`
  if (!config.username || config.username.includes(":")) throw new ProjectApiError("unauthorized")
  const credential = btoa(
    Array.from(new TextEncoder().encode(`${config.username}:${config.password}`), (byte) =>
      String.fromCharCode(byte),
    ).join(""),
  )
  async function request<S extends Schema.Decoder<unknown>>(
    path: string,
    schema: S,
    body?: unknown,
    signal?: AbortSignal,
  ) {
    const response = await (config.transport ?? fetch)(`${root}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Basic ${credential}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new ProjectApiError("connection")
    })
    if (!response.ok)
      throw new ProjectApiError(
        response.status === 503
          ? "unavailable"
          : [401, 403].includes(response.status)
            ? "unauthorized"
            : response.status === 409
              ? "conflict"
              : "request",
        response.status,
      )
    const value: unknown = await response.json().catch(() => {
      throw new ProjectApiError("invalid")
    })
    try {
      return Schema.decodeUnknownSync(schema)(value)
    } catch {
      throw new ProjectApiError("invalid")
    }
  }
  const thread = (id: string) => `/threads/${encodeURIComponent(id)}`
  return {
    projects: (signal?: AbortSignal) =>
      request("/projects", Schema.Array(Coordination.SharedProject), undefined, signal),
    threads: (projectId: string, signal?: AbortSignal) =>
      request(
        `/projects/${encodeURIComponent(projectId)}/threads`,
        Schema.Array(Coordination.Thread),
        undefined,
        signal,
      ),
    thread: (id: string, signal?: AbortSignal) => request(thread(id), TeamThread, undefined, signal),
    events: (id: string, after = 0, signal?: AbortSignal) =>
      request(`${thread(id)}/events?after=${after}&limit=200`, Replay, undefined, signal),
    async source(
      projectId: string,
      ref: { threadId: string; eventId: string; seq: number },
      signal?: AbortSignal,
    ): Promise<Coordination.Event> {
      const expected = { threadId: ref.threadId, eventId: ref.eventId, seq: ref.seq }
      if (
        !projectId ||
        !expected.threadId ||
        !expected.eventId ||
        !Number.isSafeInteger(expected.seq) ||
        expected.seq < 1
      )
        throw new ProjectApiError("invalid")
      signal?.throwIfAborted()
      const page = await request(
        `/projects/${encodeURIComponent(projectId)}/events?after=${expected.seq - 1}&limit=1`,
        Replay,
        undefined,
        signal,
      )
      signal?.throwIfAborted()
      const event = page.events[0]
      if (
        page.events.length !== 1 ||
        !event ||
        event.projectId !== projectId ||
        event.threadId !== expected.threadId ||
        event.id !== expected.eventId ||
        event.seq !== expected.seq
      )
        throw new ProjectApiError("invalid")
      return event
    },
    comments: (id: string, signal?: AbortSignal) =>
      request(`${thread(id)}/comments`, Schema.Array(Coordination.Comment), undefined, signal),
    submit: (id: string, text: string, requestId: string) =>
      request(
        `${thread(id)}/instructions`,
        Schema.Struct({ instruction: Coordination.InstructionRequest, run: Coordination.Run }),
        { requestId, text },
      ),
    comment: (id: string, body: string, requestId: string) =>
      request(`${thread(id)}/comments`, Coordination.Comment, { requestId, body }),
    cancel: (id: string, instructionId: string) =>
      request(`${thread(id)}/instructions/${encodeURIComponent(instructionId)}/cancel`, Coordination.Run, {}),
    claim: (id: string, approval: Coordination.Approval) =>
      request(`${thread(id)}/approvals/${encodeURIComponent(approval.id)}/claim`, Coordination.Approval, {
        expectedVersion: approval.version,
      }),
    decide: (id: string, approval: Coordination.Approval, decision: "approve" | "reject", decisionId: string) =>
      request(`${thread(id)}/approvals/${encodeURIComponent(approval.id)}/decision`, Coordination.Approval, {
        expectedVersion: approval.version,
        decision,
        decisionId,
      }),
  }
}
