import { beforeAll, expect, mock, test } from "bun:test"
import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router"
import { createComponent, render } from "solid-js/web"
import solidPlugin from "vite-plugin-solid"
import type { ProjectTransport } from "@/pages/puff/project-api"
import { createTeamController } from "@/pages/puff/team-state"

const timestamp = "2026-09-29T20:00:00Z"
const project = { id: "prj_focus", name: "Focus fixture", createdBy: "alice", createdAt: timestamp }
const thread = (id: string) => ({
  id,
  projectId: project.id,
  sessionId: `ses_${id}`,
  workerId: "worker-focus",
  title: `Focus thread ${id}`,
  createdBy: "alice",
  createdAt: timestamp,
  activitySeq: 1,
})
const event = (id: string) => ({
  id: `event-${id}`,
  projectId: project.id,
  threadId: id,
  seq: 1,
  kind: "run.output",
  occurredAt: timestamp,
  payload: { text: `Output for ${id}` },
})
const snapshot = (id: string) => ({
  thread: thread(id),
  instructions: [],
  runs: [],
  approvals: [],
  workCard: {
    id: `card-${id}`,
    projectId: project.id,
    threadId: id,
    version: 1,
    sourceActivitySeq: 1,
    currentTask: "Check keyboard focus",
    progress: "Reading existing evidence",
    blockers: [],
    status: "active",
    recentVerifiedOutcome: null,
    contributors: ["alice"],
    evidenceRefs: [{ threadId: id, eventId: `event-${id}`, seq: 1 }],
    generatedAt: timestamp,
    submittedBy: "alice",
    updatedAt: timestamp,
    summaryJobId: `job-${id}`,
  },
  cursor: 1,
})
const sourceRequests: string[] = []

// Only the external HTTP boundary is synthetic; the real client, controller,
// routed thread and context panel still run and decode these full responses.
const transport: ProjectTransport = async (url) => {
  const request = new URL(url)
  const path = request.pathname.replace("/api/coordination/v1", "")
  if (path === "/projects") return Response.json([project])
  if (path === `/projects/${project.id}/threads`) return Response.json([thread("a"), thread("b")])
  if (path === `/projects/${project.id}/events`) {
    sourceRequests.push(`${request.pathname}${request.search}`)
    return Response.json({ events: [event("a")], cursor: 1, hasMore: false })
  }
  const id = /^\/threads\/([ab])$/.exec(path)?.[1]
  if (id) return Response.json(snapshot(id))
  const replay = /^\/threads\/([ab])\/events$/.exec(path)?.[1]
  if (replay) {
    const after = Number(request.searchParams.get("after") ?? 0)
    return Response.json({ events: after ? [] : [event(replay)], cursor: 1, hasMore: false })
  }
  throw new Error(`Unexpected isolated focus fixture request: ${path}`)
}

let TeamThreadPage: typeof import("@/pages/puff/team-thread").default
let activeTeam: ReturnType<typeof createTeamController>

beforeAll(async () => {
  // Bun's test loader otherwise treats this package's preserved TSX as React.
  // Use the same Solid JSX transform that compiles the production app.
  const transform = solidPlugin({ hot: false }).transform as (
    source: string,
    path: string,
    options: { ssr: boolean },
  ) => Promise<{ code: string } | null>
  Bun.plugin({
    name: "solid-dom-focus-test",
    setup(builder) {
      builder.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
        const result = await transform(await Bun.file(args.path).text(), args.path, { ssr: false })
        if (!result) throw new Error(`Solid JSX transform skipped ${args.path}`)
        return { contents: result.code, loader: "tsx" }
      })
    },
  })
  mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
  // Other browser tests may have loaded this TSX design primitive before our
  // local Solid transform. It is not the focus target in these cases.
  mock.module("@opencode-ai/ui/button", () => ({
    Button: (props: { children?: unknown; disabled?: boolean; type?: "button" | "submit" }) => {
      const button = document.createElement("button")
      button.type = props.type ?? "button"
      button.disabled = !!props.disabled
      button.textContent = typeof props.children === "string" ? props.children : ""
      return button
    },
  }))
  // The provider only supplies this controller. Keep the real controller and
  // avoid loading a TSX context helper cached by earlier browser-suite files.
  mock.module("@/pages/puff/team-context", () => ({ useTeam: () => activeTeam }))
  TeamThreadPage = (await import("@/pages/puff/team-thread")).default
})

async function settle() {
  for (let index = 0; index < 50; index++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function mountThread() {
  const host = document.createElement("div")
  document.body.append(host)
  const history = createMemoryHistory()
  history.set({ value: "/puff/thread/a", replace: true, scroll: false })
  const team = (activeTeam = createTeamController(transport))
  const dispose = render(
    () =>
      createComponent(MemoryRouter, {
        history,
        get children() {
          return createComponent(Route, { path: "/puff/thread/:threadId", component: TeamThreadPage })
        },
      }),
    host,
  )
  if (!(await team.connect("https://focus.example", "alice", "synthetic-only"))) {
    dispose()
    host.remove()
    throw new Error("Isolated focus fixture did not connect")
  }
  await team.refresh()
  await settle()
  expect(String(team.state.snapshot?.thread.id)).toBe("a")
  return { host, history, team, cleanup: () => { dispose(); team.dispose(); host.remove() } }
}

test("reduced-motion media rules disable shell and panel movement", async () => {
  const rules = async (path: string) => {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(await Bun.file(new URL(path, import.meta.url)).text())
    const media = Array.from(sheet.cssRules).find((rule): rule is CSSMediaRule =>
      rule instanceof CSSMediaRule && rule.conditionText === "(prefers-reduced-motion: reduce)")
    return Array.from(media?.cssRules ?? []).filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
  }
  const shell = (await rules("../src/components/puff/team.css")).find((rule) =>
    rule.selectorText.includes(".team-shell *"))
  expect(shell?.style.getPropertyValue("animation")).toBe("none")
  expect(shell?.style.getPropertyValue("transition")).toBe("none")
  expect(shell?.style.getPropertyValue("scroll-behavior")).toBe("auto")
  expect(shell?.style.getPropertyPriority("animation")).toBe("important")

  const panel = (await rules("../src/components/puff/context-panel/context-panel.css")).find((rule) =>
    rule.selectorText.includes(".puff-context *"))
  expect(panel?.style.getPropertyValue("animation-duration")).toBe("0ms")
  expect(panel?.style.getPropertyValue("transition-duration")).toBe("0ms")
  expect(panel?.style.getPropertyValue("scroll-behavior")).toBe("auto")
  expect(panel?.style.getPropertyPriority("animation-duration")).toBe("important")
})

test("a shared Thread creator is not presented as the Session owner", async () => {
  const view = await mountThread()
  try {
    const identity = view.host.querySelector<HTMLElement>(".puff-session-identity")!
    expect(identity.getAttribute("aria-label")).toContain("ses_a")
    expect(identity.getAttribute("aria-label")).not.toContain("puff.owner alice")
  } finally {
    view.cleanup()
  }
})

test("closing context removes its controls from the active focus region", async () => {
  const view = await mountThread()
  try {
    const toggle = view.host.querySelector<HTMLButtonElement>(".team-context-toggle")!
    const panel = view.host.querySelector<HTMLElement>("#shared-team-context")!
    expect(panel.querySelector(".puff-context-sources summary")).not.toBeNull()
    expect(toggle.getAttribute("aria-expanded")).toBe("true")

    toggle.click()

    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(panel.hasAttribute("inert")).toBe(true)
    expect(panel.querySelector(".puff-context-sources summary")?.closest("[inert]")).toBe(panel)
  } finally {
    view.cleanup()
  }
})

test("Escape from an open context action returns keyboard focus to its toggle", async () => {
  const view = await mountThread()
  try {
    const toggle = view.host.querySelector<HTMLButtonElement>(".team-context-toggle")!
    const panel = view.host.querySelector<HTMLElement>("#shared-team-context")!
    const source = panel.querySelector<HTMLElement>(".puff-context-sources summary")!
    source.focus()
    expect(document.activeElement === source).toBe(true)

    source.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))

    expect(document.activeElement === toggle).toBe(true)
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(panel.hasAttribute("inert")).toBe(true)
  } finally {
    view.cleanup()
  }
})

test("opening and closing context preserves the real shared composer draft", async () => {
  const view = await mountThread()
  try {
    const toggle = view.host.querySelector<HTMLButtonElement>(".team-context-toggle")!
    const composer = view.host.querySelector<HTMLTextAreaElement>(".team-composer textarea")!
    composer.value = "Unsent keyboard finding"
    composer.dispatchEvent(new Event("input", { bubbles: true }))
    expect(view.team.state.drafts.a?.text).toBe("Unsent keyboard finding")

    toggle.click()
    toggle.click()

    expect(view.host.querySelector(".team-composer textarea")).toBe(composer)
    expect(composer.value).toBe("Unsent keyboard finding")
    expect(view.team.state.drafts.a?.text).toBe("Unsent keyboard finding")
  } finally {
    view.cleanup()
  }
})

test("polling preserves Inspect and inline peek focus, then Escape returns to the same control", async () => {
  sourceRequests.length = 0
  const view = await mountThread()
  try {
    const panel = view.host.querySelector<HTMLElement>("#shared-team-context")!
    const toggle = view.host.querySelector<HTMLButtonElement>(".team-context-toggle")!
    const composer = view.host.querySelector<HTMLTextAreaElement>(".team-composer textarea")!
    const messages = view.host.querySelector<HTMLElement>(".team-messages")!
    const originalMessage = view.host.querySelector<HTMLElement>("#event-event-a")!
    composer.value = "Keep B's unsent draft"
    composer.dispatchEvent(new Event("input", { bubbles: true }))
    Object.defineProperties(messages, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 100 },
    })
    messages.scrollTop = 37
    messages.dispatchEvent(new Event("scroll", { bubbles: true }))

    const details = panel.querySelector<HTMLDetailsElement>(".puff-context-sources")!
    details.open = true
    const inspect = details.querySelector<HTMLButtonElement>(".puff-context-source-row button")!
    if (!inspect) throw new Error("Thread host did not enable Inspect through its controller resolver")
    inspect.focus()
    await view.team.refresh()
    await settle()
    expect(details.querySelector(".puff-context-source-row button") === inspect).toBe(true)
    expect(document.activeElement === inspect).toBe(true)
    expect(sourceRequests).toEqual([])

    inspect.click()
    await settle()

    expect(sourceRequests).toEqual(["/api/coordination/v1/projects/prj_focus/events?after=0&limit=1"])
    const close = panel.querySelector<HTMLButtonElement>(".puff-context-peek-close")
    if (!close) throw new Error(`Inspect expanded=${inspect.getAttribute("aria-expanded")}, but inline source peek was absent`)
    expect(document.activeElement === close).toBe(true)
    expect(panel.querySelector(".puff-context-source-detail")?.textContent).toContain("event-a")

    await view.team.refresh()
    await settle()
    expect(details.querySelector(".puff-context-source-row button") === inspect).toBe(true)
    expect(panel.querySelector(".puff-context-peek-close") === close).toBe(true)
    expect(document.activeElement === close).toBe(true)
    expect(panel.querySelector(".puff-context-source-detail")?.textContent).toContain("event-a")
    expect(sourceRequests).toHaveLength(1)

    close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))

    expect(panel.querySelector(".puff-context-peek")).toBeNull()
    expect(document.activeElement === inspect).toBe(true)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(panel.hasAttribute("inert")).toBe(false)
    expect(view.host.querySelector(".team-composer textarea")).toBe(composer)
    expect(view.team.state.drafts.a?.text).toBe("Keep B's unsent draft")
    expect(messages.scrollTop).toBe(37)
    expect(view.host.querySelector("#event-event-a")).toBe(originalMessage)
  } finally {
    view.cleanup()
  }
})
