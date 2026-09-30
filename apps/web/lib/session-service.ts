import { models } from "./session-api.ts"
import type { ModelId, SessionApiReply, TaskRequest } from "./session-api.ts"
import { analyzeSessionTask, applySessionFinding, createGuidedSession, replyToSession } from "./session-engine.ts"
import { createDemoWorkspace } from "./workspace.ts"
import type { WorkspaceSession, WorkspaceState } from "./workspace.ts"
import { WorkspaceApiError, WorkspaceStore, validateWorkspaceId } from "./workspace-store.ts"

export { WorkspaceApiError } from "./workspace-store.ts"
export const workspaceRequestLimit = 256 * 1024

export class WorkspaceService {
  private readonly store: WorkspaceStore

  constructor(options: { directory?: string } = {}) {
    this.store = new WorkspaceStore(options.directory)
  }

  async execute(body: unknown): Promise<SessionApiReply> {
    try {
      return await this.dispatch(body)
    } catch (error) {
      if (error instanceof WorkspaceApiError) throw error
      throw new WorkspaceApiError(500, "The local workspace could not be loaded or saved")
    }
  }

  private async dispatch(body: unknown): Promise<SessionApiReply> {
    const request = record(body, "Request")
    const command = text(request.command, "command", 32)
    if (command === "bootstrap") {
      keys(request, ["command", "workspaceId", "initialWorkspace"], "Request")
      if (request.workspaceId !== undefined) {
        if (request.initialWorkspace !== undefined) invalid("initialWorkspace can only be used when creating a workspace")
        const workspaceId = validateWorkspaceId(request.workspaceId)
        return this.store.transaction(workspaceId, (stored) => ({ result: { workspaceId, workspace: storedWorkspace(stored) } }))
      }
      const workspace = request.initialWorkspace === undefined ? createDemoWorkspace() : validateWorkspace(request.initialWorkspace)
      const workspaceId = await this.store.create(workspace)
      return { workspaceId, workspace }
    }
    if (!["replace", "analyze", "create", "message", "add-context"].includes(command)) invalid("Unknown workspace command")
    const workspaceId = validateWorkspaceId(request.workspaceId)
    const fields = command === "replace" ? ["workspace"] : command === "message" ? ["sessionId", "prompt", "modelId"] : command === "add-context" ? ["targetId", "sourceSessionId", "findingId"] : ["prompt", "owner", "scope", "modelId", ...(command === "create" ? ["choiceId", "sourceSessionId"] : [])]
    keys(request, ["command", "workspaceId", ...fields], "Request")
    const replacement = command === "replace" ? validateWorkspace(request.workspace) : undefined
    return this.store.transaction<SessionApiReply>(workspaceId, (stored) => {
      const workspace = storedWorkspace(stored)
      if (replacement) return { workspace: replacement, result: { workspaceId, workspace: replacement } }
      const visible = { ...workspace, sessions: workspace.sessions.filter(isAccessible) }
      if (command === "analyze" || command === "create") {
        const task = validateTask(request, workspace)
        const analysis = analyzeSessionTask(task, visible)
        if (command === "analyze") return { result: { workspaceId, workspace: visible, analysis } }
        const choiceId = request.choiceId === undefined ? undefined : text(request.choiceId, "choiceId", 256)
        const sourceSessionId = request.sourceSessionId === undefined ? undefined : sessionReference(request.sourceSessionId, "sourceSessionId")
        if (sourceSessionId) accessibleSession(workspace, sourceSessionId, task.owner)
        if (analysis.kind === "overlap" && !choiceId) invalid("Choose a task boundary after reviewing related work")
        const option = choiceId ? analysis.options.find((option) => option.id === choiceId && option.action === "create") : undefined
        if (choiceId && !option) invalid("This task choice is no longer available; analyze the task again")
        if (sourceSessionId && option?.sourceSessionId !== sourceSessionId) invalid("The source does not match this task choice")
        const session = createGuidedSession({ ...task, choiceId, sourceSessionId: sourceSessionId ?? option?.sourceSessionId }, visible)
        const next = validateWorkspace({ ...workspace, sessions: [session, ...workspace.sessions] })
        return { workspace: next, result: { workspaceId, workspace: next, sessionId: session.id } }
      }
      if (command === "message") {
        const session = accessibleSession(workspace, sessionReference(request.sessionId, "sessionId"))
        const reply = replyToSession(text(request.prompt, "prompt", 20_000), session, visible, model(request.modelId))
        const next = validateWorkspace({ ...workspace, sessions: workspace.sessions.map((entry) => entry.id === session.id ? reply.session : entry) })
        return { workspace: next, result: { workspaceId, workspace: next, sessionId: session.id, ...(reply.finding ? { finding: reply.finding } : {}) } }
      }
      const target = accessibleSession(workspace, sessionReference(request.targetId, "targetId"))
      const source = accessibleSession(workspace, sessionReference(request.sourceSessionId, "sourceSessionId"), target.owner)
      const findingId = sessionReference(request.findingId, "findingId")
      if (target.id === source.id) invalid("Finding context must come from another session")
      if (!source.findings?.some((finding) => finding.id === findingId)) throw new WorkspaceApiError(404, "Finding not found")
      if (source.status !== "complete") invalid("Finding context must come from a completed session")
      const session = applySessionFinding(target, source, findingId, visible)
      const next = validateWorkspace({ ...workspace, sessions: workspace.sessions.map((entry) => entry.id === target.id ? session : entry) })
      return { workspace: next, result: { workspaceId, workspace: next, sessionId: target.id, finding: { sourceSessionId: source.id, findingId, targetId: target.id } } }
    })
  }
}

const service = new WorkspaceService()
export function getWorkspaceService() {
  return service
}

export async function parseWorkspaceRequest(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length")
  if (length && (!/^\d+$/.test(length) || Number(length) > workspaceRequestLimit)) invalid("Workspace request exceeds 256 KiB")
  if (!request.body) invalid("Request body must contain JSON")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > workspaceRequestLimit) {
        await reader.cancel()
        invalid("Workspace request exceeds 256 KiB")
      }
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size)
    let position = 0
    for (const chunk of chunks) {
      bytes.set(chunk, position)
      position += chunk.byteLength
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
  } catch (error) {
    if (error instanceof WorkspaceApiError) throw error
    invalid("Request body must contain valid JSON")
  } finally {
    reader.releaseLock()
  }
}

function validateTask(request: Record<string, unknown>, workspace: WorkspaceState): TaskRequest {
  const owner = text(request.owner, "owner", 120)
  if (!workspace.project.members.some((member) => member.name === owner)) invalid("Task owner must be a project member")
  if (request.scope !== "project" && request.scope !== "private") invalid("scope must be project or private")
  if (request.scope === "private" && owner !== "You") invalid("Private sessions belong to You")
  return { prompt: text(request.prompt, "prompt", 20_000), owner, scope: request.scope, modelId: model(request.modelId) }
}

function accessibleSession(workspace: WorkspaceState, id: string, owner = "You"): WorkspaceSession {
  const session = workspace.sessions.find((session) => session.id === id && (session.scope === "project" || session.owner === owner))
  if (!session) throw new WorkspaceApiError(404, "Session not found")
  return session
}

function isAccessible(session: WorkspaceSession): boolean {
  return session.scope === "project" || session.owner === "You"
}

function storedWorkspace(value: unknown): WorkspaceState {
  try {
    return validateWorkspace(value)
  } catch {
    throw new WorkspaceApiError(500, "The saved local workspace is invalid")
  }
}

export function validateWorkspace(value: unknown): WorkspaceState {
  const workspace = record(value, "workspace")
  keys(workspace, ["project", "sessions"], "workspace")
  const project = record(workspace.project, "project")
  keys(project, ["name", "goal", "members"], "project")
  const members = array(project.members, "members", 32).map((value) => {
    const member = record(value, "member")
    keys(member, ["name", "initials", "color", "focus"], "member")
    return { name: text(member.name, "member name", 120), initials: text(member.initials, "initials", 16), color: color(member.color), focus: text(member.focus, "focus", 4000, true) }
  })
  if (!members.length || !members.some((member) => member.name === "You") || new Set(members.map((member) => member.name)).size !== members.length) invalid("Project members must be unique and include You")
  const sessions = array(workspace.sessions, "sessions", 500).map((value): WorkspaceSession => {
    const session = record(value, "session")
    keys(session, ["id", "title", "owner", "initials", "color", "status", "summary", "updatedAt", "messages", "task", "scope", "topic", "findings", "relation", "relatedSessionId", "receivedFindings", "modelId", "scopeBoundary"], "session")
    const owner = text(session.owner, "session owner", 120)
    if (!members.some((member) => member.name === owner)) invalid("Session owner must be a project member")
    if (session.scope !== "project" && session.scope !== "private") invalid("Session scope must be project or private")
    if (session.scope === "private" && owner !== "You") invalid("Private sessions belong to You")
    if (session.status !== "running" && session.status !== "waiting" && session.status !== "complete") invalid("Invalid session status")
    const updatedAt = text(session.updatedAt, "updatedAt", 100)
    if (!Number.isFinite(Date.parse(updatedAt))) invalid("updatedAt must be a valid date")
    const findings = session.findings === undefined ? undefined : array(session.findings, "findings", 100).map((value) => {
      const finding = record(value, "finding")
      keys(finding, ["id", "title", "problem", "solution", "source"], "finding")
      return { id: sessionReference(finding.id, "finding id"), title: text(finding.title, "finding title", 2000), problem: text(finding.problem, "finding problem", 20_000), solution: text(finding.solution, "finding solution", 20_000), source: text(finding.source, "finding source", 2000) }
    })
    if (findings && new Set(findings.map((finding) => finding.id)).size !== findings.length) invalid("Finding IDs must be unique within a session")
    const receivedFindings = session.receivedFindings === undefined ? undefined : array(session.receivedFindings, "receivedFindings", 500).map((value) => text(value, "received finding", 322))
    if (receivedFindings && new Set(receivedFindings).size !== receivedFindings.length) invalid("Received findings must be unique")
    return {
      id: sessionReference(session.id, "session id"), title: text(session.title, "session title", 2000), owner, initials: text(session.initials, "initials", 16), color: color(session.color), status: session.status, summary: text(session.summary, "summary", 20_000, true), updatedAt,
      task: text(session.task, "task", 20_000), scope: session.scope, topic: text(session.topic, "topic", 160),
      messages: array(session.messages, "messages", 1000).map((value) => {
        const message = record(value, "message")
        keys(message, ["role", "text", "modelId"], "message")
        if (message.role !== "user" && message.role !== "assistant") invalid("Message role must be user or assistant")
        return { role: message.role, text: text(message.text, "message text", 20_000), ...(message.modelId !== undefined ? { modelId: model(message.modelId) } : {}) }
      }),
      ...(findings !== undefined ? { findings } : {}),
      ...(receivedFindings !== undefined ? { receivedFindings } : {}),
      ...(session.relation !== undefined ? { relation: text(session.relation, "relation", 2000) } : {}),
      ...(session.relatedSessionId !== undefined ? { relatedSessionId: sessionReference(session.relatedSessionId, "relatedSessionId") } : {}),
      ...(session.modelId !== undefined ? { modelId: model(session.modelId) } : {}),
      ...(session.scopeBoundary !== undefined ? { scopeBoundary: text(session.scopeBoundary, "scopeBoundary", 4000) } : {}),
    }
  })
  if (new Set(sessions.map((session) => session.id)).size !== sessions.length) invalid("Session IDs must be unique")
  for (const session of sessions) {
    if (session.relatedSessionId && !sessions.some((source) => source.id === session.relatedSessionId && (source.scope === "project" || source.owner === session.owner))) invalid("Related session is unavailable")
    for (const key of session.receivedFindings ?? []) {
      if (!sessions.some((source) => (source.scope === "project" || source.owner === session.owner) && source.findings?.some((finding) => `${source.id}:${finding.id}` === key))) invalid("Received finding source is unavailable")
    }
  }
  return { project: { name: text(project.name, "project name", 200), goal: text(project.goal, "project goal", 4000), members }, sessions }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`${name} must be an object`)
  return value as Record<string, unknown>
}

function array(value: unknown, name: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid(`${name} must be an array with at most ${maximum} entries`)
  return value
}

function keys(value: Record<string, unknown>, allowed: string[], name: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid(`${name} contains an unsupported field`)
}

function text(value: unknown, name: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim()) || value.includes("\u0000")) invalid(`${name} must be ${allowEmpty ? "a" : "a nonempty"} string of at most ${maximum} characters`)
  return value
}

function sessionReference(value: unknown, name: string): string {
  const id = text(value, name, 160)
  if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) invalid(`${name} contains invalid characters`)
  return id
}

function model(value: unknown): ModelId {
  const selected = models.find((entry) => entry.id === value)
  if (!selected) invalid("Unknown modelId")
  return selected.id
}

function color(value: unknown): WorkspaceSession["color"] {
  if (value !== "purple" && value !== "blue" && value !== "orange" && value !== "green") invalid("Invalid member color")
  return value
}

function invalid(message: string): never {
  throw new WorkspaceApiError(400, message)
}
