import { Schema } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { ProjectApiError, serviceUrl, type ProjectTransport } from "./project-api"

export const TeamThread = Schema.Struct({
  thread: Coordination.Thread,
  instructions: Schema.Array(Coordination.InstructionRequest),
  runs: Schema.Array(Coordination.Run),
  approvals: Schema.Array(Coordination.Approval),
  // The registered HTTP handler serializes an absent card as null.
  workCard: Schema.optional(Schema.NullOr(Coordination.WorkCard)),
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
  async function request<S extends Schema.Decoder<unknown>>(path: string, schema: S, body?: unknown) {
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
      signal: AbortSignal.timeout(10_000),
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
    projects: () => request("/projects", Schema.Array(Coordination.SharedProject)),
    threads: (projectId: string) =>
      request(`/projects/${encodeURIComponent(projectId)}/threads`, Schema.Array(Coordination.Thread)),
    thread: (id: string) => request(thread(id), TeamThread),
    events: (id: string, after = 0) => request(`${thread(id)}/events?after=${after}&limit=200`, Replay),
    comments: (id: string) => request(`${thread(id)}/comments`, Schema.Array(Coordination.Comment)),
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
