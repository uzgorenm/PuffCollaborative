import type { Session } from "./sessions"

export type WorkspaceSession = Session & {
  task: string
  scope: "project" | "private"
  topic: string
  findings?: { id: string; title: string; problem: string; solution: string; source: string }[]
  relation?: string
  relatedSessionId?: string
  receivedFindings?: string[]
  scopeBoundary?: string
}

export type WorkspaceProject = {
  name: string
  goal: string
  members: { name: string; initials: string; color: Session["color"]; focus: string }[]
}

export type WorkspaceState = { project: WorkspaceProject; sessions: WorkspaceSession[] }

const serverStartupGuidance = "The startup error was a port conflict: another process owned port 3000. Identify its owner first. This project uses development port 3005, so use its configured dev command. Reusing 3000 requires a deliberate restart after confirming the process belongs to this project. This finding is specific to that startup error; compare your error before applying it."

export function createDemoWorkspace(projectName = "Puff", goal = "Build a collaborative workspace"): WorkspaceState {
  const now = Date.now()
  return {
    project: {
      name: projectName.trim() || "Puff",
      goal: goal.trim() || "Build a collaborative workspace",
      members: [
        { name: "You", initials: "Y", color: "green", focus: "Building the project API and reviewing access rules in parallel." },
        { name: "Sam", initials: "S", color: "purple", focus: "Building frontend project navigation and checking its mobile layout." },
        { name: "Alice", initials: "A", color: "blue", focus: "Resolved the development server startup problem; now checking regressions." },
      ],
    },
    // Each call owns its fixture objects. These conversations illustrate a scenario.
    sessions: [
      {
        id: "demo-you-api",
        title: "Build the project API",
        owner: "You",
        initials: "Y",
        color: "green",
        status: "running",
        summary: "Planning project membership endpoints and the data the frontend needs.",
        updatedAt: new Date(now - 4 * 60_000).toISOString(),
        task: "Build the backend API for projects and project membership.",
        scope: "project",
        topic: "backend",
        scopeBoundary: "Project membership and shared-session API contracts; frontend navigation and access-policy review have separate sessions.",
        messages: [
          { role: "user", text: "Build the backend API for projects and project membership." },
          { role: "assistant", text: "The API scope covers listing projects, their members, and shared sessions. Contract references: docs/coordination-contract.md and the request boundary in apps/web/app/api/sessions/route.ts. First map the response shapes the frontend needs, then check membership before returning shared work. Your access review has its own session; its decisions will inform this contract. Sam's navigation session covers the sidebar, project switcher, and session list." },
        ],
      },
      {
        id: "demo-you-auth",
        title: "Review project access rules",
        owner: "You",
        initials: "Y",
        color: "green",
        status: "waiting",
        summary: "Reviewing who can see a project's shared sessions before connecting access rules to the API.",
        updatedAt: new Date(now - 11 * 60_000).toISOString(),
        task: "Review project access rules alongside the API implementation.",
        scope: "project",
        topic: "backend",
        scopeBoundary: "Review membership and visibility rules; endpoint implementation remains in the project API session.",
        relation: "Parallel to You · Build the project API",
        relatedSessionId: "demo-you-api",
        messages: [
          { role: "user", text: "Review project access rules alongside the API implementation." },
          { role: "assistant", text: "This session reviews project membership and shared-session visibility. The API implementation stays in your other session, so both workstreams retain their own task and conversation." },
        ],
      },
      {
        id: "demo-sam-frontend",
        title: "Build project navigation",
        owner: "Sam",
        initials: "S",
        color: "purple",
        status: "running",
        summary: "Building the frontend sidebar, project switcher, and session list.",
        updatedAt: new Date(now - 7 * 60_000).toISOString(),
        task: "Build frontend project navigation with a sidebar and project switcher.",
        scope: "project",
        topic: "navigation",
        scopeBoundary: "The sidebar shell, project switcher, and base session list. Loading, empty, error, keyboard accessibility, and session search remain distinct follow-up scopes.",
        messages: [
          { role: "user", text: "Build frontend project navigation with a sidebar and project switcher." },
          { role: "assistant", text: "My scope is the sidebar shell, project switcher, and base session list. Working references are apps/web/app/page.tsx, apps/web/app/workflow.css, and apps/web/components/project-overview.tsx. The plan is to keep the selected project visible, group sessions by person, and make opening a session predictable. The mobile drawer has its own session. Loading, empty, error, and keyboard accessibility states would be useful separate work; session search and owner/status filters are another independent feature." },
        ],
      },
      {
        id: "demo-sam-mobile",
        title: "Check navigation on mobile",
        owner: "Sam",
        initials: "S",
        color: "purple",
        status: "waiting",
        summary: "Checking drawer behavior and session navigation at smaller screen sizes.",
        updatedAt: new Date(now - 19 * 60_000).toISOString(),
        task: "Check the frontend navigation layout on mobile while the main navigation is built.",
        scope: "project",
        topic: "navigation",
        scopeBoundary: "Mobile drawer behavior and small-screen navigation; keep this separate from the sidebar shell and session search.",
        relation: "Parallel to Sam · Build project navigation",
        relatedSessionId: "demo-sam-frontend",
        messages: [
          { role: "user", text: "Check the frontend navigation layout on mobile while the main navigation is built." },
          { role: "assistant", text: "This is Sam's second session: it checks mobile drawer behavior, readable labels, and switching between sessions. The main frontend implementation remains in Build project navigation." },
        ],
      },
      {
        id: "demo-alice-server",
        title: "Fix the failing development server",
        owner: "Alice",
        initials: "A",
        color: "blue",
        status: "complete",
        summary: "Found a port 3000 conflict and documented the project's development port, 3005.",
        updatedAt: new Date(now - 31 * 60_000).toISOString(),
        task: "Investigate why the development server fails to start with EADDRINUSE.",
        scope: "project",
        topic: "dev-server",
        scopeBoundary: "Recorded EADDRINUSE diagnosis for frontend development port 3000 and the configured port 3005; database, authentication, and dependency errors require a separate diagnosis.",
        findings: [
          {
            id: "server-port",
            title: "Development server port conflict",
            problem: "The development server could not bind to port 3000 because another process already owned it (EADDRINUSE).",
            solution: "Identify the process that owns port 3000 before changing anything. Use this project's configured development port, 3005. If port 3000 must be reused, deliberately restart only after checking the process owner and confirming that process belongs to this project.",
            source: "Alice · Fix the failing development server · message 2",
          },
        ],
        messages: [
          { role: "user", text: "Investigate why the development server fails to start with EADDRINUSE." },
          { role: "assistant", text: serverStartupGuidance },
        ],
      },
      {
        id: "demo-alice-tests",
        title: "Check the server regression",
        owner: "Alice",
        initials: "A",
        color: "blue",
        status: "running",
        summary: "Checking that the configured development port is reflected in startup guidance and regression checks.",
        updatedAt: new Date(now - 24 * 60_000).toISOString(),
        task: "Review regression coverage after resolving the development server startup problem.",
        scope: "project",
        topic: "testing",
        scopeBoundary: "Review the startup instructions in apps/web/package.json and propose port-conflict regression checks; no execution results are recorded here.",
        relation: "Follows Alice · Fix the failing development server",
        relatedSessionId: "demo-alice-server",
        messages: [
          { role: "user", text: "Review regression coverage after resolving the development server startup problem." },
          { role: "assistant", text: "The port finding remains in my completed server session. This separate session checks startup guidance and regression coverage, preserving the original source for teammates who encounter the same error." },
        ],
      },
    ],
  }
}

export function refreshWorkspacePresentation(workspace: WorkspaceState): WorkspaceState {
  return {
    ...workspace,
    sessions: workspace.sessions.map((session) => ({
      ...session,
      summary: session.summary === "Task assigned in this demo; the first step is ready to review." ? "The first step is ready to review." : session.summary,
      messages: session.messages.map((message) => {
        if (message.role !== "assistant") return message
        const text = refreshGeneratedGuidance(message.text)
        return text === message.text ? message : { ...message, text }
      }),
    })),
  }
}

function refreshGeneratedGuidance(text: string): string {
  // Match complete generated templates so saved user prose and quoted context survive.
  if (text === serverStartupGuidance.replace("The startup error", "The scenario's error")) return serverStartupGuidance
  const independent = text.match(/^Demo plan for ([\s\S]+): clarify the outcome for “([\s\S]+)”, inspect the relevant project context, and propose a small first step\.(?: ([\s\S]+) is related work; keep this task independent and compare scope before implementing\.)? This creates a local demo session; it does not run an agent or change another session\.$/)
  if (independent) return `Plan for ${independent[1]}: clarify the outcome for “${independent[2]}”, inspect the relevant project context, and propose a small first step.${independent[3] ? ` ${independent[3]} is related work; keep this task independent and compare scope before implementing.` : ""}`
  const complementary = text.match(/^Demo plan for ([\s\S]+): review ([\s\S]+) as source context, then take a complementary scope: ([\s\S]+)\. Keep a separate approach and record your own findings\. This creates a local demo session; it does not run an agent, copy the source implementation, or stop the source session\.$/)
  if (complementary) return `Plan for ${complementary[1]}: review ${complementary[2]} as source context, then consider this proposed complementary scope: ${complementary[3]}. Keep a separate approach and record your own findings.`
  const next = text.match(/^Demo next step: keep “([\s\S]+)” as this session's task, inspect the relevant context for “([\s\S]+)”, and propose a small check\. This walkthrough does not execute an agent or modify project files\.$/)
  if (next) return `Next step: keep “${next[1]}” as this session's task, inspect the relevant context for “${next[2]}”, and propose a small check.`
  const context = text.match(/^Demo context check: ([\s\S]+)'s port-conflict finding is already in this session\. Reuse that attributed context: check who owns port 3000, preserve that process, use this project's port 3005, and verify this server before continuing “([\s\S]+)”\. The finding has not been added a second time\.$/)
  if (context) return `Context check: ${context[1]}'s port-conflict finding is already in this session. Reuse that attributed context: check who owns port 3000, preserve that process, use this project's port 3005, and verify this server before continuing “${context[2]}”. The finding has not been added a second time.`
  const adaptation = text.match(/^(Context from [\s\S]+\n\nProblem: [\s\S]+\n\nFinding: [\s\S]+)\n\nDemo adaptation for “([\s\S]+)”:\n1\. Check which process owns port 3000\.\n2\. Preserve that session and use this project's configured port, 3005\.\n3\. Verify this session's server starts on that port before resuming the original task\.\n\nThis is a walkthrough plan, not a live execution result\.$/)
  if (adaptation) return `${adaptation[1]}\n\nSuggested steps for “${adaptation[2]}”:\n1. Check which process owns port 3000.\n2. Preserve that session and use this project's configured port, 3005.\n3. Verify this session's server starts on that port before resuming the original task.`
  const investigation = text.match(/^Demo plan: continue investigating this server error independently\. Compare the error, inspect which process owns the port, and record the next check in this session\. Keep the original task, “([\s\S]+)”, in scope\. No finding has been copied or execution performed\.$/)
  if (investigation) return `Plan: continue investigating this server error independently. Compare the error, inspect which process owns the port, and record the next check in this session. Keep the original task, “${investigation[1]}”, in scope.`
  return text
}

export function findRelatedWork(prompt: string, sessions: WorkspaceSession[]): WorkspaceSession[] {
  const topic = taskTopic(prompt)
  return topic === "general" ? [] : sessions.filter((session) => session.topic === topic)
}

export function findSolvedProblem(prompt: string, sessions: WorkspaceSession[]): { session: WorkspaceSession; finding: NonNullable<WorkspaceSession["findings"]>[number] } | undefined {
  if (!matchesStartupProblem(prompt)) return undefined
  const session = sessions.find((session) => session.topic === "dev-server" && session.status === "complete" && session.findings?.some((finding) => finding.id === "server-port"))
  const finding = session?.findings?.find((finding) => finding.id === "server-port")
  return session && finding ? { session, finding } : undefined
}

export function matchesStartupProblem(prompt: string): boolean {
  const text = prompt.toLowerCase().replace(/[’‘]/g, "'")
  // A different explicit port or database/socket conflict does not establish
  // a match for the frontend's recorded port 3000 startup problem.
  if (/\b(?:database|postgres(?:ql)?|mysql|redis|mongo(?:db)?|sqlite)\b/.test(text)) return false
  const endpoints = /(?:\bport["']?\s*[:=]?\s*|(?:\d{1,3}\.){3}\d{1,3}\s*:|localhost\s*:|\[[0-9a-f:]+\]\s*:|:{2,3})(\d{2,5})\b/g
  if ([...text.matchAll(endpoints)].some((match) => match[1] !== "3000")) return false
  const portFailure = /\beaddrinuse\b/.test(text) || /\b(?:port(?:\s+\d+)?\s+(?:(?:is|was|already|still|has|a)\s+)*(?:in use|busy|occupied|conflict|collision)|(?:conflict|collision)\s+(?:on|with)\s+(?:the\s+)?port)\b/.test(text)
  // A generic startup phrase can suggest reviewing this source. A named, different
  // server failure must not become a claimed match to the fixture's port conflict.
  const serverStartupFailure = /\b(?:server\s+(?:(?:keeps|is|still|just)\s+)*(?:fails?|failing|won't start|can't start|cannot start|doesn't start|does not start|failed to start|fails to start|not starting)|(?:failing|failed)\s+(?:(?:dev|development)\s+)?server)\s*[.!?]?\s*$/.test(text)
  return portFailure || serverStartupFailure
}

export function createTaskSession(prompt: string, owner: string, project: WorkspaceProject, mode: "independent" | "complementary" = "independent", related?: WorkspaceSession): WorkspaceSession {
  const requested = prompt.trim() || "Describe the next project task"
  const name = owner.trim() || "You"
  const member = project.members.find((member) => member.name === name)
  const reference = related ? `${related.owner} · ${related.title}` : undefined
  const complementary = mode === "complementary" && related
  const complementaryScope = related?.topic === "navigation"
    ? { task: "Check navigation accessibility and project switching", detail: "keyboard accessibility checks and project-switching tests" }
    : related?.topic === "backend"
      ? { task: "Check API contracts and access rules", detail: "API contract tests and access-rule review" }
      : related?.topic === "dev-server"
        ? { task: "Verify server startup configuration and reproduction", detail: "startup configuration review and reproduction verification" }
        : { task: "Review independent edge cases", detail: "independent edge-case checks and review" }
  const task = complementary ? complementaryScope.task : requested
  const plan = complementary
    ? `Plan for ${project.name}: review ${reference} as source context, then consider this proposed complementary scope: ${complementaryScope.detail}. Keep a separate approach and record your own findings.`
    : `Plan for ${project.name}: clarify the outcome for “${task}”, inspect the relevant project context, and propose a small first step.${reference ? ` ${reference} is related work; keep this task independent and compare scope before implementing.` : ""}`
  return {
    id: `demo-task-${crypto.randomUUID()}`,
    title: task.length > 72 ? `${task.slice(0, 69)}…` : task,
    owner: name,
    initials: member?.initials ?? name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
    color: member?.color ?? "orange",
    status: "waiting",
    summary: complementary ? `Proposed complementary scope: ${complementaryScope.detail}.` : "The first step is ready to review.",
    updatedAt: new Date().toISOString(),
    messages: [{ role: "user", text: requested }, { role: "assistant", text: plan }],
    task,
    scope: "project",
    topic: complementary ? related.topic : taskTopic(task),
    ...(related ? { relation: `${complementary ? "Complements" : "Independent alongside"} ${reference}`, relatedSessionId: related.id } : {}),
  }
}

function taskTopic(prompt: string): string {
  if (/\b(?:server|eaddrinuse|port)\b/i.test(prompt)) return "dev-server"
  if (/\b(?:navigation|front[ -]?end|sidebar|drawer|project switcher)\b/i.test(prompt)) return "navigation"
  if (/\b(?:back[ -]?end|apis?|auth|authentication)\b/i.test(prompt)) return "backend"
  return "general"
}
