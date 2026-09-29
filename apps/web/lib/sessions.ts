export type Session = {
  id: string
  title: string
  owner: string
  initials: string
  color: "purple" | "blue" | "orange" | "green"
  status: "running" | "waiting" | "complete"
  summary: string
  updatedAt: string
  messages: { role: "user" | "assistant"; text: string }[]
}

// Illustrative conversations for the prototype, not live agent output.
export const demoSessions: Session[] = [
  {
    id: "demo-serdar-navigation",
    title: "Build the collaborative workspace",
    owner: "Serdar",
    initials: "S",
    color: "purple",
    status: "running",
    summary: "Exploring a shared view of team sessions, decisions, and progress.",
    updatedAt: "2026-09-29T19:06:00.000Z",
    messages: [
      { role: "user", text: "Help the team see what everyone is working on, with enough context to collaborate." },
      { role: "assistant", text: "I’m exploring a workspace that brings shared sessions together. Each session keeps its owner and conversation, while teammates can review context before contributing." },
    ],
  },
  {
    id: "demo-alice-focus",
    title: "Fix focus after switching projects",
    owner: "Alice",
    initials: "A",
    color: "blue",
    status: "waiting",
    summary: "Found a keyboard focus issue; the proposed regression check is ready for review.",
    updatedAt: "2026-09-29T19:04:00.000Z",
    messages: [
      { role: "user", text: "Investigate why switching projects interrupts keyboard navigation." },
      { role: "assistant", text: "The project switcher should receive focus after a switch. I’ve drafted a regression check and would like the team to review the expected behavior before implementation." },
    ],
  },
  {
    id: "demo-bob-labels",
    title: "Explore persistent navigation labels",
    owner: "Bob",
    initials: "B",
    color: "orange",
    status: "running",
    summary: "Testing an expanded navigation alternative with persistent project labels.",
    updatedAt: "2026-09-29T19:02:00.000Z",
    messages: [
      { role: "user", text: "Explore navigation with persistent labels so the current project is always clear." },
      { role: "assistant", text: "I’m comparing an expanded drawer with the compact approach. Alice’s focus finding is useful context for both alternatives; no design decision has been made." },
    ],
  },
  {
    id: "demo-you-review",
    title: "Review shared session boundaries",
    owner: "You",
    initials: "Y",
    color: "green",
    status: "complete",
    summary: "Documented the prototype’s distinction between shared and private sessions.",
    updatedAt: "2026-09-29T18:58:00.000Z",
    messages: [
      { role: "user", text: "Write down how this prototype should distinguish shared sessions from private work." },
      { role: "assistant", text: "The review notes are ready: the shared workspace should show only explicitly shared sessions. These sample conversations illustrate the experience; production access controls still need separate validation." },
    ],
  },
]

export type SessionsResult = {
  sessions: Session[]
  source: "simulator" | "demo"
  detail?: string
}

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function list(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : []
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

export async function readSessions(): Promise<SessionsResult> {
  const base = process.env.PUFF_API_URL ?? "http://127.0.0.1:4187"
  const url = URL.parse(base)
  if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    return { sessions: demoSessions, source: "demo", detail: "Illustrative demo data. PUFF_API_URL must point to the local scenario simulator." }
  }
  const prefix = `${url.origin}${url.pathname.replace(/\/$/, "").endsWith("/api/coordination/v1") ? url.pathname.replace(/\/$/, "") : "/api/coordination/v1"}`
  const signal = AbortSignal.timeout(1000)
  const request = async (path: string, authenticated = true): Promise<unknown> => {
    const response = await fetch(`${prefix}${path}`, {
      cache: "no-store",
      signal,
      headers: authenticated ? { Authorization: "Basic YWxpY2U6ZGVtby1hbGljZQ==" } : {},
    })
    if (!response.ok) throw new Error(`Simulator returned ${response.status}`)
    return response.json()
  }

  try {
    const status = record(await request("/status", false))
    if (status.simulated !== true) throw new Error("Endpoint is not the scenario simulator")
    const projects = list(await request("/projects"))
    const groups = await Promise.all(projects.map(async (project) => {
      const id = encodeURIComponent(string(project.id))
      const [threads, events] = await Promise.all([
        request(`/projects/${id}/threads`),
        request(`/projects/${id}/events?after=0&limit=100`),
      ])
      return Promise.all(list(threads).map(async (thread): Promise<Session> => {
        const snapshot = record(await request(`/threads/${encodeURIComponent(string(thread.id))}`))
        const card = record(snapshot.workCard)
        const ownerId = string(thread.createdBy).replace(/^usr_/, "")
        const owner = ownerId ? ownerId[0].toUpperCase() + ownerId.slice(1) : "Teammate"
        const colors: Session["color"][] = ["purple", "blue", "orange", "green"]
        const owners = ["alice", "bob", "cara", "drew"]
        const runs = list(snapshot.runs)
        return {
          id: string(thread.id),
          title: string(thread.title, "Shared session"),
          owner,
          initials: owner.slice(0, 1),
          color: colors[Math.max(0, owners.indexOf(ownerId))],
          status: runs.some((run) => run.state === "running") ? "running" : card.status === "complete" ? "complete" : "waiting",
          summary: string(card.progress, "SIMULATED scenario session."),
          updatedAt: string(card.updatedAt, string(thread.createdAt)),
          messages: list(record(events).events)
            .filter((event) => event.threadId === thread.id)
            .map((event) => ({
              role: event.kind === "thread.created" ? "user" as const : "assistant" as const,
              text: string(record(event.payload).text, string(record(event.payload).summary)),
            }))
            .filter((message) => message.text.length > 0),
        }
      }))
    }))
    const sessions = groups.flat()
    if (!sessions.length) throw new Error("Simulator has no shared sessions")
    return { sessions, source: "simulator", detail: "SIMULATED coordination fixtures. This is synthetic scenario data, not live model output." }
  } catch {
    return { sessions: demoSessions, source: "demo", detail: "Illustrative demo conversations. The local scenario simulator is unavailable or could not be read within one second." }
  }
}
