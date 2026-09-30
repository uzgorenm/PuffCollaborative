import { models } from "./session-api.ts"
import type { ModelId, SessionReply, TaskAnalysis, TaskOption, TaskRequest } from "./session-api.ts"
import { findSolvedProblem, matchesStartupProblem } from "./workspace.ts"
import type { WorkspaceSession, WorkspaceState } from "./workspace.ts"

export function analyzeSessionTask(request: TaskRequest, workspace: WorkspaceState): TaskAnalysis {
  requireRequest(request)
  const visible = visibleSessions(workspace, request.owner)
  const family = taskFamily(request.prompt)
  const sources = visible.filter((session) => {
    if (family === "navigation" || family === "session-search") return session.topic === "navigation" && session.status !== "complete"
    if (family === "backend") return session.topic === "backend" && session.status !== "complete"
    if (family === "port") return session.topic === "dev-server" && session.status === "complete" && session.findings?.some((finding) => finding.id === "server-port")
    return false
  })
  // Prefer the base scope over a linked mobile/review workstream, irrespective
  // of sidebar ordering or most-recent activity.
  const source = sources.find((session) => !session.relatedSessionId) ?? sources[0]
  if (!source) {
    const option = { title: concise(request.prompt.trim()), description: "Start a separate session for this task with a concrete first step.", task: request.prompt.trim(), boundary: "Keep the requested feature in scope and confirm its project interfaces before extending adjacent work.", action: "create" as const }
    return { kind: "clear", headline: "Ready to start a new task", explanation: `Checked ${visible.length} visible sessions. No matching scope was found for this request.`, checkedCount: visible.length, options: [{ ...option, id: choiceId(request, workspace, "requested", option) }] }
  }

  const reference = `${source.owner} · ${source.title}`
  const scope = family === "navigation" || family === "session-search"
    ? "the sidebar, project switcher, and base session list"
    : family === "backend" ? "project membership and shared-session API contracts" : "a completed diagnosis of an EADDRINUSE conflict on development port 3000"
  const proposed: Omit<TaskOption, "id">[] = family === "navigation" || family === "session-search"
    ? [
      { title: "Finish navigation states", description: "Add loading, empty, error, and keyboard accessibility states around the existing navigation surfaces.", task: "Finish navigation loading, empty, error, and keyboard accessibility states.", boundary: "Own the navigation state and accessibility behavior; keep the sidebar shell, project switcher layout, and mobile drawer in their source sessions.", action: "create", sourceSessionId: source.id },
      { title: "Build session search and filters", description: "Add title/task search plus owner and status filters for the session list. The source describes the base list; search is a separate feature to build.", task: "Build session search and filters by title, task, owner, and status.", boundary: "Own session search, filter state, and no-results behavior; reuse the session data contract and preserve the sidebar shell, project switcher, and mobile drawer.", action: "create", sourceSessionId: source.id },
    ]
    : family === "backend"
      ? [{ title: "Review API access and edge cases", description: "Review membership, private-session visibility, and empty/error response cases alongside the API scope.", task: "Review project API membership, private-session visibility, and empty/error contracts.", boundary: "Own the access and edge-case review; endpoint implementation remains in the source session.", action: "create", sourceSessionId: source.id }]
      : [{ title: "Verify the startup configuration", description: "Compare your exact startup error with the recorded port conflict and check the configured development port.", task: "Verify the development startup configuration against the recorded EADDRINUSE port conflict.", boundary: "Confirm the frontend startup error and process owner before using the port finding; database and other server failures need their own investigation.", action: "create", sourceSessionId: source.id }]
  const options = [
    ...proposed,
    { title: source.owner === request.owner ? "Open your source session" : `Open ${source.owner}'s source session`, description: `Review ${reference} and its recorded scope before deciding what to build.`, task: source.task, boundary: source.scopeBoundary ?? scope, action: "open" as const, sourceSessionId: source.id },
    { title: "Use my original approach", description: "Keep your original task in a separate session and compare its scope with the source as you go.", task: request.prompt.trim(), boundary: `Keep an independent approach to the original request; compare with ${reference} before proposing changes to its scope.`, action: "create" as const, sourceSessionId: source.id },
  ].map((option, index) => ({ ...option, id: choiceId(request, workspace, `scope-${index}`, option, source) }))
  return {
    kind: "overlap",
    headline: source.owner === request.owner ? "You have related work in another session" : family === "port" ? `${source.owner} has related startup guidance` : `${source.owner} has related work`,
    explanation: `${reference} covers ${scope}. ${family === "session-search" ? "Search and filters would be a separate scope alongside that base list. " : ""}Choose a distinct scope, review the source, or keep an independent approach.`,
    checkedCount: visible.length,
    sourceSessionId: source.id,
    options,
  }
}

export function createGuidedSession(request: TaskRequest & { choiceId?: string; sourceSessionId?: string }, workspace: WorkspaceState): WorkspaceSession {
  const analysis = analyzeSessionTask(request, workspace)
  if (analysis.kind === "overlap" && !request.choiceId) throw new Error("Choose a task scope before creating this session")
  const option = request.choiceId ? analysis.options.find((option) => option.id === request.choiceId) : analysis.options[0]
  if (!option) throw new Error("This task choice is invalid or stale. Review the current scopes again.")
  if (option.action === "open") throw new Error("An open-source choice cannot create a new session")
  if (request.sourceSessionId && request.sourceSessionId !== option.sourceSessionId) throw new Error("The choice does not belong to this source session")
  const source = option.sourceSessionId ? visibleSessions(workspace, request.owner).find((session) => session.id === option.sourceSessionId) : undefined
  const member = workspace.project.members.find((member) => member.name === request.owner)
  const independent = option.title === "Use my original approach"
  const session: WorkspaceSession = {
    id: `task-${crypto.randomUUID()}`,
    title: independent ? concise(option.task) : option.title,
    task: option.task,
    scopeBoundary: option.boundary,
    owner: request.owner,
    initials: member?.initials ?? request.owner.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
    color: member?.color ?? "orange",
    scope: request.scope,
    topic: taskFamily(option.task),
    status: "waiting",
    summary: `${independent ? "Independent scope" : "Next step ready"}: ${option.task}`,
    updatedAt: new Date().toISOString(),
    modelId: request.modelId,
    messages: [{ role: "user", text: request.prompt, modelId: request.modelId }],
    ...(source ? { relatedSessionId: source.id, relation: `${independent ? "Independent alongside" : "Related to"} ${source.owner} · ${source.title}` } : {}),
  }
  return { ...session, messages: [...session.messages, { role: "assistant", text: guidance(session, workspace, request.modelId, source, false), modelId: request.modelId }] }
}

export function replyToSession(prompt: string, session: WorkspaceSession, workspace: WorkspaceState, modelId: ModelId): SessionReply {
  requireRequest({ prompt, owner: session.owner, scope: session.scope, modelId })
  const visible = visibleSessions(workspace, session.owner).filter((source) => source.id !== session.id)
  const solved = findSolvedProblem(prompt, visible)
  const received = solved && session.receivedFindings?.includes(`${solved.session.id}:${solved.finding.id}`)
  const source = session.relatedSessionId ? visible.find((source) => source.id === session.relatedSessionId) : undefined
  const text = solved
    ? `${received ? "This finding is already in your context" : "There is a related completed finding"}: ${solved.finding.source}.\n\n${solved.finding.problem}\n\n${solved.finding.solution}\n\nCompare the exact error and port before applying this guidance. ${received ? "Reuse the attributed context already attached to this session." : "You can add this attributed finding to this session's context."} Then resume “${session.task}”.`
    : guidance(session, workspace, modelId, source, true, prompt)
  return {
    session: { ...session, status: "waiting", modelId, updatedAt: new Date().toISOString(), messages: [...session.messages, { role: "user", text: prompt, modelId }, { role: "assistant", text, modelId }] },
    ...(solved && !received ? { finding: { sourceSessionId: solved.session.id, findingId: solved.finding.id, targetId: session.id } } : {}),
  }
}

export function applySessionFinding(target: WorkspaceSession, source: WorkspaceSession, findingId: string, workspace: WorkspaceState): WorkspaceSession {
  const admitted = visibleSessions(workspace, target.owner).find((session) => session.id === source.id)
  if (!admitted) throw new Error("This source is private or no longer visible to the session owner")
  const finding = admitted.findings?.find((finding) => finding.id === findingId)
  if (!finding || admitted.status !== "complete") throw new Error("The finding is unavailable or no longer complete")
  const key = `${admitted.id}:${finding.id}`
  if (target.receivedFindings?.includes(key)) return target
  return {
    ...target,
    updatedAt: new Date().toISOString(),
    receivedFindings: [...target.receivedFindings ?? [], key],
    messages: [...target.messages, { role: "assistant", text: `Context from ${finding.source}\n\nProblem: ${finding.problem}\n\nFinding: ${finding.solution}\n\nFor “${target.task}”, use this finding only when the current error matches its recorded cause. Check the process owner and the project's startup configuration before changing a port; keep unrelated feature work and database errors under their own diagnosis. The original source remains available for comparison.`, ...(target.modelId ? { modelId: target.modelId } : {}) }],
  }
}

function requireRequest(request: TaskRequest) {
  if (!request.prompt.trim()) throw new Error("Describe the task before starting a session")
  if (!request.owner.trim()) throw new Error("A session owner is required")
  if (!models.some((model) => model.id === request.modelId)) throw new Error("Select a supported model")
}

function visibleSessions(workspace: WorkspaceState, owner: string) {
  return workspace.sessions.filter((session) => session.scope === "project" || session.owner === owner)
}

function taskFamily(prompt: string): string {
  const text = prompt.toLowerCase()
    .replace(/front[ -]+end/g, "frontend")
    .replace(/\b(?:frontned|frondend|fontend|fronend|fronted|fronent|frntend|frontened)\b/g, "frontend")
    .replace(/\b(?:navigaton|navigtion|navgation|navigaiton|navagation)\b/g, "navigation")
    .replace(/\b(?:sidebr|sidbar|siderbar)\b/g, "sidebar")
    .replace(/\b(?:swicher|switchr|swithcer)\b/g, "switcher")
  if (matchesStartupProblem(text)) return "port"
  const workspaceNavigation = /\b(?:project (?:navigation|switcher|sidebar)|session (?:list|navigation|search|filter)|workspace (?:navigation|sidebar))\b/.test(text)
  const unrelatedFeature = /\b(?:billing|checkout|payments?|invoice|pricing|catalog|shopping|profile|customer|dashboard|landing|marketing|analytics|reports?|database)\b/.test(text)
    || (/\b(?:search|filter)\b/.test(text) && !/\bsessions?\b/.test(text))
  if (unrelatedFeature && !workspaceNavigation) return "general"
  if (/\bsessions?\b/.test(text) && /\b(?:search|filters?)\b/.test(text)) return "session-search"
  if (/\b(?:navigation|sidebar|drawer|project switcher|session list|frontend)\b/.test(text)) return "navigation"
  if (/\b(?:projects?|membership|members?|shared[ -]sessions?)\b/.test(text) && /\b(?:api|backend|back[ -]end|auth|access|contract)\b/.test(text)) return "backend"
  return "general"
}

function concise(text: string) {
  return text.length > 72 ? `${text.slice(0, 69)}…` : text
}

function choiceId(request: TaskRequest, workspace: WorkspaceState, name: string, option: Omit<TaskOption, "id">, source?: WorkspaceSession) {
  const value = JSON.stringify([request.prompt, request.owner, request.scope, workspace.project.name, workspace.project.goal, option, source && [source.id, source.owner, source.title, source.task, source.scope, source.topic, source.status, source.scopeBoundary]])
  const hash = [...value].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261)
  return `${name}-${hash.toString(36)}`
}

function guidance(session: WorkspaceSession, workspace: WorkspaceState, modelId: ModelId, source: WorkspaceSession | undefined, continued: boolean, prompt?: string) {
  const states = session.title === "Finish navigation states" || /navigation.*(?:loading|empty|error|accessibility)/i.test(session.task)
  const search = session.topic === "session-search"
  const frontend = states || search || taskFamily(session.task) === "navigation" || /\b(?:frontend|front[ -]end|react|ui)\b/i.test(session.task)
  const reference = source ? `${source.owner} · ${source.title}` : undefined
  const intro = `${continued ? "Continue with" : "Let's start"} “${session.task}” for ${workspace.project.name}. ${session.scopeBoundary ?? "Keep this session focused on the requested outcome and confirm the inputs before extending its scope."}`
  const context = source ? `Source context: ${reference}. The source scope is ${source.scopeBoundary ?? source.task} Use those notes to compare interfaces and coordinate the handoff.` : "Start by locating the closest existing project surface and its data contract. Keep the first change small enough to review with a concrete input and expected result."
  const next = states
    ? "First define loading, ready-with-items, ready-empty, and error states at the session-list boundary. Keep the selected project label stable while loading. Give retry a clear button label, announce loading politely, and let keyboard users reach each session without a focus reset."
    : search
      ? "First add a controlled query plus owner and status selections above the existing session list. Filter only sessions already admitted by the visibility boundary. Distinguish an empty project from zero matches, preserve the query while opening a session, and provide a clear-all action."
      : session.topic === "backend"
        ? "First write down the membership input and the exact session fields allowed in the response. Apply owner/project visibility before serializing rows. Review missing membership, empty lists, and denied access as separate outcomes."
        : session.topic === "port"
          ? "First capture the exact startup error and compare the port with the source. Read apps/web/package.json for the configured development command. Identify the owner of a busy port before deciding whether to restart that process; otherwise preserve it and use the configured port."
          : /billing|checkout|payment/i.test(session.task)
            ? "First map the screen's input data and the primary action. Keep loading, missing data, validation, and request failure visible. Treat prices and payment state as server-provided data; use a reviewable UI example before wiring the action to a real endpoint."
            : "First turn the request into one observable outcome. Identify the existing entry point, map the inputs and state transitions, then implement one small component or function before expanding the flow."
  const code = states ? navigationCode : search ? searchCode : frontend ? featureCode : session.topic === "backend" ? accessCode : session.topic === "port" ? portCode : planCode
  const followup = prompt && !/^(?:continue|build it|do it|go ahead|next|implement it)[.!\s]*$/i.test(prompt)
    ? `Your latest request is “${prompt}”. Apply it within this session's task and compare any expanded scope with the source before proceeding.\n\n` : ""
  const starter = `Suggested implementation:\n\n${code}`
  const validation = states
    ? "Review the four states, retry behavior, and keyboard focus after a project switch. Verify that the sidebar shell and mobile drawer keep their current behavior."
    : search
      ? "Check title/task matches, owner/status combinations, no results, clear-all, and opening a result. Confirm that filtering never reveals sessions outside the permitted input list."
      : "Review the normal path, empty input, and one failure case against the actual project contract. Record the result of each check when it has been run."
  if (modelId === "gpt-6-luna") return `${intro}\n\n${context}\n\n${followup}${next}\n\n${starter}\n\n${validation}`
  const plan = `Suggested order:\n1. Read the existing state and data boundary in apps/web/app/page.tsx and the relevant styles in apps/web/app/workflow.css.\n2. Adapt the example to the current props and preserve the project's existing visual and data conventions.\n3. Exercise the normal and failure paths, then record any open questions for the source owner.`
  const status = "Next: adapt this to the existing interfaces and verify the behavior in the project."
  if (modelId === "gpt-6.1-sol") return `${intro}\n\n${context}\n\n${followup}${next}\n\n${plan}\n\n${starter}\n\n${validation}\n\n${status}`
  return `${intro}\n\n${context}\n\n${followup}${next}\n\n${plan}\n\n${starter}\n\nAcceptance to review: ${validation} Capture the specific input, expected output, and observed output separately for each case.\n\nHandoff notes should identify the proposed integration point, the source scope being referenced, and any unresolved data or accessibility assumptions. If the source changes while this work is underway, compare the updated contract before adopting its details.\n\n${status}`
}

const navigationCode = `\`\`\`tsx
type SessionRow = { id: string; title: string };
type ListState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; sessions: SessionRow[] };

function NavigationContent({ state, openSession }: {
  state: ListState;
  openSession: (id: string) => void;
}) {
  if (state.status === "loading")
    return <p role="status" aria-live="polite">Loading sessions…</p>;
  if (state.status === "error")
    return <div role="alert"><p>Sessions could not load.</p>
      <button onClick={state.retry}>Retry loading sessions</button></div>;
  if (state.sessions.length === 0)
    return <p>No shared sessions yet. Start the first task when ready.</p>;
  return <ul aria-label="Project sessions">{state.sessions.map(session =>
    <li key={session.id}><button onClick={() => openSession(session.id)}>
      {session.title}
    </button></li>
  )}</ul>;
}
\`\`\``

const searchCode = `\`\`\`tsx
type SearchableSession = {
  id: string; title: string; task: string; owner: string;
  status: "running" | "waiting" | "complete";
};

function filterSessions(visible: SearchableSession[], query: string,
  owner: string, status: string) {
  const needle = query.trim().toLocaleLowerCase();
  return visible.filter(session =>
    (owner === "all" || session.owner === owner) &&
    (status === "all" || session.status === status) &&
    [session.title, session.task].some(text =>
      text.toLocaleLowerCase().includes(needle))
  );
}

// Pass only the already-authorized session list to this component.
function SearchResults({ results, clearFilters }: {
  results: SearchableSession[]; clearFilters: () => void;
}) {
  if (!results.length) return <div role="status">
    <p>No sessions match these filters.</p>
    <button onClick={clearFilters}>Clear filters</button>
  </div>;
  return <ul>{results.map(session =>
    <li key={session.id}>{session.title} · {session.owner}</li>
  )}</ul>;
}
\`\`\``

const featureCode = `\`\`\`tsx
type FeatureState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "ready"; title: string; description: string };

function FeaturePanel({ state }: { state: FeatureState }) {
  if (state.status === "loading") return <p role="status">Loading…</p>;
  if (state.status === "error") return <div role="alert">
    <p>{state.message}</p><button onClick={state.retry}>Try again</button>
  </div>;
  return <section aria-label={state.title}>
    <h2>{state.title}</h2><p>{state.description}</p>
  </section>;
}
\`\`\``

const accessCode = `\`\`\`ts
type SessionAccess = { owner: string; scope: "project" | "private" };
function visibleToMember(rows: SessionAccess[], owner: string,
  isProjectMember: boolean) {
  if (!isProjectMember) return [];
  return rows.filter(row => row.scope === "project" || row.owner === owner);
}
// Apply this boundary before building the response or matching related work.
\`\`\``

const portCode = `\`\`\`sh
# Inspect the process owner; review the result before restarting anything.
lsof -nP -iTCP:3000 -sTCP:LISTEN
# From apps/web, use the project command configured for port 3005.
npm run dev
\`\`\``

const planCode = `\`\`\`ts
type ReviewStep = { input: string; expected: string; observed?: string };
const checks: ReviewStep[] = [
  { input: "normal request", expected: "requested outcome" },
  { input: "empty input", expected: "clear next action" },
  { input: "failed request", expected: "visible error and recovery" },
];
// Fill observed only after each check is exercised in the project.
\`\`\``
