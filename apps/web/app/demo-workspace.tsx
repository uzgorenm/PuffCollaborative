"use client"

import { useEffect, useRef, useState } from "react"
import { ProjectOverview } from "../components/project-overview"
import { createDemoWorkspace, createTaskSession, findRelatedWork, findSolvedProblem } from "../lib/workspace"
import type { WorkspaceSession, WorkspaceState } from "../lib/workspace"
import "./workflow.css"

const icons: Record<string, string> = {
  plus: "M12 5v14M5 12h14", search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  folder: "M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  chevron: "m8 10 4 4 4-4", arrow: "M12 19V5m-6 6 6-6 6 6", layers: "m12 3 10 6-10 6L2 9Zm-10 12 10 6 10-6M2 15l10 6 10-6",
  close: "m6 6 12 12M6 18 18 6", panel: "M9 3v18M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  settings: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2", check: "m5 12 4 4L19 6",
}
function Icon(props: { name: string; size?: number }) {
  return <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[props.name] ?? icons.folder} /></svg>
}
const labels = { running: "Working", waiting: "Ready", complete: "Completed" }
const defaults = { name: "Puff workspace", goal: "Build a collaborative coding workspace", sam: "Sam", alice: "Alice", tasks: ["Build project API", "Build project navigation", "Fix failing development server"] }
type SolvedMatch = NonNullable<ReturnType<typeof findSolvedProblem>> & { targetId: string }
const displayName = (name: string) => name === "You" ? "Serdar (you)" : name
const displayRelation = (relation: string) => relation.replace(/\s*\(demo-[^)]+\)/g, "")
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)) }
function validWorkspace(value: unknown): value is WorkspaceState {
  if (!record(value) || !record(value.project) || !Array.isArray(value.project.members) || !Array.isArray(value.sessions)) return false
  if (typeof value.project.name !== "string" || !value.project.name.trim() || typeof value.project.goal !== "string") return false
  const members = value.project.members
  if (members.length !== 3 || !members.every(member => record(member) && typeof member.name === "string" && member.name.trim() && typeof member.initials === "string" && ["green", "purple", "blue", "orange"].includes(String(member.color)) && typeof member.focus === "string")) return false
  const names = members.map(member => String(member.name))
  if (!names.includes("You") || new Set(names.map(name => name.toLowerCase())).size !== names.length) return false
  if (!value.sessions.every(session => {
    if (!record(session) || !["id", "title", "owner", "initials", "summary", "updatedAt", "task", "topic"].every(key => typeof session[key] === "string")) return false
    if (!session.id || !names.includes(String(session.owner)) || !["green", "purple", "blue", "orange"].includes(String(session.color)) || !["running", "waiting", "complete"].includes(String(session.status))) return false
    if (session.scope !== "project" && session.scope !== "private") return false
    if (session.scope === "private" && session.owner !== "You") return false
    if (session.relation !== undefined && typeof session.relation !== "string") return false
    if (session.relatedSessionId !== undefined && typeof session.relatedSessionId !== "string") return false
    if (!Array.isArray(session.messages) || !session.messages.every(message => record(message) && ["user", "assistant"].includes(String(message.role)) && typeof message.text === "string")) return false
    if (session.receivedFindings !== undefined && (!Array.isArray(session.receivedFindings) || !session.receivedFindings.every(id => typeof id === "string"))) return false
    return session.findings === undefined || (Array.isArray(session.findings) && session.findings.every(finding => record(finding) && ["id", "title", "problem", "solution", "source"].every(key => typeof finding[key] === "string")))
  })) return false
  return new Set(value.sessions.map(session => session.id)).size === value.sessions.length
}

export default function Workspace() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createDemoWorkspace(defaults.name, defaults.goal))
  const [view, setView] = useState<"overview" | "new" | "chat" | "setup">("overview")
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [owner, setOwner] = useState("You")
  const [scope, setScope] = useState<"project" | "private">("project")
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [expandedPeople, setExpandedPeople] = useState<string[]>([])
  const [dockOpen, setDockOpen] = useState(true)
  const [setup, setSetup] = useState(defaults)
  const [freshSetup, setFreshSetup] = useState(false)
  const [step, setStep] = useState(0)
  const [setupError, setSetupError] = useState("")
  const [overlap, setOverlap] = useState<WorkspaceSession | null>(null)
  const [solved, setSolved] = useState<SolvedMatch | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [toast, setToast] = useState("")
  const input = useRef<HTMLTextAreaElement>(null)
  const content = useRef<HTMLElement>(null)
  const lastMessages = useRef({ id: selected, count: 0 })
  const sessions = workspace.sessions.filter(session => session.scope === "project" || session.owner === "You")
  const active = sessions.find(session => session.id === selected)
  const filtered = sessions.filter(session => `${session.title} ${session.owner} ${session.task} ${session.summary}`.toLowerCase().includes(query.toLowerCase()))
  const fixAdded = Boolean(solved && active?.receivedFindings?.includes(`${solved.session.id}:${solved.finding.id}`))

  useEffect(() => {
    try {
      const saved = localStorage.getItem("puff-workspace-v2")
      const parsed: unknown = saved ? JSON.parse(saved) : null
      if (validWorkspace(parsed)) setWorkspace(parsed)
      if (saved && !validWorkspace(parsed)) setToast("Saved demo data could not be read. A fresh walkthrough is ready.")
    } catch { setToast("Browser storage is unavailable. This demo will last for this visit.") }
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (!hydrated) return
    try { localStorage.setItem("puff-workspace-v2", JSON.stringify(workspace)) }
    catch { setToast("Browser storage is unavailable. This demo will last for this visit.") }
  }, [workspace, hydrated])
  useEffect(() => {
    content.current?.scrollTo({ top: 0 })
    if (view === "new" || view === "chat") input.current?.focus({ preventScroll: true })
  }, [selected, view])
  useEffect(() => {
    const previous = lastMessages.current
    lastMessages.current = { id: selected, count: active?.messages.length ?? 0 }
    if (view === "chat" && selected === previous.id && (active?.messages.length ?? 0) > previous.count) content.current?.scrollTo({ top: content.current.scrollHeight, behavior: "smooth" })
  }, [selected, active?.messages.length, view])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(""), 4000)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setView("new"); setSelected(null); setDraft(""); setOwner("You"); setScope("project")
        setOverlap(null); setSolved(null); setInspecting(false); setSidebarOpen(false)
      }
      if (event.key === "Escape") { setOverlap(null); setInspecting(false); setSidebarOpen(false) }
    }
    window.addEventListener("keydown", keyboard)
    return () => window.removeEventListener("keydown", keyboard)
  }, [])

  function overview() { setView("overview"); setSelected(null); setSidebarOpen(false); setOverlap(null); setInspecting(false) }
  function openSession(id: string) {
    if (!sessions.some(session => session.id === id)) return
    setView("chat"); setSelected(id); setDraft(""); setSidebarOpen(false); setOverlap(null); setInspecting(false)
  }
  function newSession(prompt = "") {
    setView("new"); setSelected(null); setDraft(prompt); setOwner("You"); setScope("project")
    setOverlap(null); setSolved(null); setInspecting(false); setSidebarOpen(false)
  }
  function beginSetup(fresh = false) {
    setFreshSetup(fresh)
    setSetup(fresh ? { ...defaults, tasks: [...defaults.tasks] } : {
      name: workspace.project.name, goal: workspace.project.goal,
      sam: workspace.project.members[1].name, alice: workspace.project.members[2].name,
      tasks: ["demo-you-api", "demo-sam-frontend", "demo-alice-server"].map((id, index) => workspace.sessions.find(session => session.id === id)?.task ?? defaults.tasks[index]),
    })
    setStep(0); setSetupError(""); setView("setup"); setSidebarOpen(false); setOverlap(null); setInspecting(false)
  }
  function advanceSetup() {
    if (step === 0 && (!setup.name.trim() || !setup.goal.trim())) { setSetupError("Add a project name and goal to continue."); return }
    const names = ["You", setup.sam.trim(), setup.alice.trim()]
    if (step === 1 && (names.some(name => !name) || new Set(names.map(name => name.toLowerCase())).size !== 3 || names.slice(1).some(name => name.toLowerCase() === "serdar"))) { setSetupError("Use two different teammate names. You and Serdar are reserved for your work."); return }
    if (step === 2 && setup.tasks.some(task => !task.trim())) { setSetupError("Give each person a first task."); return }
    setSetupError("")
    if (step < 2) { setStep(step + 1); return }
    if (!freshSetup) {
      const oldNames = workspace.project.members.map(member => member.name)
      const identity = new RegExp(oldNames.slice(1).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g")
      const rename = (text: string) => text.replace(identity, name => names[oldNames.indexOf(name)])
      const project = {
        ...workspace.project,
        name: setup.name.trim(), goal: setup.goal.trim(),
        members: workspace.project.members.map((member, index) => ({ ...member, name: names[index], initials: index === 0 ? "Y" : names[index].split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase(), focus: rename(member.focus) })),
      }
      const preserved = workspace.sessions.map(session => ({
        ...session,
        owner: names[oldNames.indexOf(session.owner)],
        initials: project.members[oldNames.indexOf(session.owner)].initials,
        relation: session.relation ? rename(session.relation) : undefined,
        findings: session.findings?.map(finding => ({ ...finding, source: rename(finding.source) })),
        messages: session.messages.map(message => message.role === "assistant" ? { ...message, text: rename(message.text) } : message),
      }))
      const added = ["demo-you-api", "demo-sam-frontend", "demo-alice-server"].flatMap((id, index) => {
        const task = setup.tasks[index].trim()
        if (workspace.sessions.find(session => session.id === id)?.task.trim() === task || preserved.some(session => session.owner === names[index] && session.task.trim() === task)) return []
        return [createTaskSession(task, names[index], project)]
      })
      setWorkspace({ project, sessions: [...added, ...preserved] })
      setSolved(null); setSelected(null); setView("overview"); setToast("Project settings saved with your existing sessions and context.")
      return
    }
    const demo = createDemoWorkspace(setup.name, setup.goal)
    const nameMap: Record<string, string> = { You: "You", Sam: names[1], Alice: names[2] }
    const firstIds = ["demo-you-api", "demo-sam-frontend", "demo-alice-server"]
    const oldTitles = firstIds.map(id => demo.sessions.find(session => session.id === id)!.title)
    const remap = (text: string) => oldTitles.reduce((result, title, index) => result.split(title).join(setup.tasks[index].trim()), text.replace(/\b(?:Sam|Alice)\b/g, name => nameMap[name]))
    const custom = firstIds.map((id, index) => {
      const seed = demo.sessions.find(session => session.id === id)!
      return ![defaults.tasks[index], seed.title, seed.task].some(task => task.trim().toLowerCase() === setup.tasks[index].trim().toLowerCase())
    })
    const project = { ...demo.project, members: demo.project.members.map((member, index) => ({
      ...member, name: names[index], initials: index === 0 ? "Y" : names[index].split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase(),
      focus: custom[index] ? `${setup.tasks[index].trim()} and a separate parallel review session.` : remap(member.focus),
    })) }
    const next: WorkspaceState = {
      project,
      sessions: demo.sessions.map(session => {
        const first = firstIds.indexOf(session.id)
        const name = nameMap[session.owner]
        const title = first >= 0 ? setup.tasks[first].trim() : session.title
        const personIndex = ["You", "Sam", "Alice"].indexOf(session.owner)
        if (custom[personIndex]) {
          const task = setup.tasks[personIndex].trim()
          const assigned = createTaskSession(first >= 0 ? task : `Review context and next steps for ${task}`, name, project)
          return { ...assigned, id: session.id, ...(first < 0 ? { relation: `Parallel to ${name} · ${task}`, relatedSessionId: firstIds[personIndex] } : {}) }
        }
        return {
          ...session, owner: name, initials: name === "You" ? "Y" : name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase(), title,
          task: first >= 0 ? setup.tasks[first].trim() : remap(session.task), summary: remap(session.summary),
          relation: session.relation ? remap(session.relation) : undefined,
          findings: session.findings?.map(finding => ({ ...finding, source: `${name} · ${title} · message 2` })),
          messages: session.messages.map((message, index) => ({ ...message, text: first >= 0 && index === 0 ? setup.tasks[first].trim() : remap(message.text) })),
        }
      }),
    }
    setWorkspace(next); setSolved(null); setSelected(null); setView("overview"); setToast("Demo project created. Sample progress is ready for your walkthrough.")
  }
  function addTask(mode: "independent" | "complementary", related?: WorkspaceSession) {
    const session = { ...createTaskSession(draft, owner, workspace.project, mode, related), scope: owner === "You" ? scope : "project" as const }
    setWorkspace(previous => ({ ...previous, sessions: [session, ...previous.sessions] }))
    setSelected(session.id); setView("chat"); setDraft(""); setOverlap(null); setSolved(null)
    setToast("Session created in this demo. Your separate task is ready to review.")
  }
  function send() {
    const text = draft.trim()
    if (!text) return
    if (view === "new") {
      const eligible = sessions.filter(session => session.scope === "project" || (owner === "You" && session.owner === "You"))
      const related = findRelatedWork(text, eligible).filter(session => session.status !== "complete")
      if (related.length) { setOverlap(related.find(session => session.status === "running") ?? related[0]); return }
      addTask("independent"); return
    }
    if (!active) return
    const match = findSolvedProblem(text, sessions.filter(session => session.id !== active.id && (session.scope === "project" || (active.owner === "You" && session.owner === "You"))))
    const already = Boolean(match && active.receivedFindings?.includes(`${match.session.id}:${match.finding.id}`))
    const response = already
      ? `Demo context check: ${match?.session.owner}'s port-conflict finding is already in this session. Reuse that attributed context: check who owns port 3000, preserve that process, use this project's port 3005, and verify this server before continuing “${active.task}”. The finding has not been added a second time.`
      : `Demo next step: keep “${active.task}” as this session's task, inspect the relevant context for “${text}”, and propose a small check. This walkthrough does not execute an agent or modify project files.`
    setWorkspace(previous => ({ ...previous, sessions: previous.sessions.map(session => session.id === active.id ? {
      ...session, updatedAt: new Date().toISOString(),
      messages: [...session.messages, { role: "user" as const, text }, ...(!match || already ? [{ role: "assistant" as const, text: response }] : [])],
      summary: match ? `Checking a server error while preserving the task: ${session.task}` : session.summary,
    } : session) }))
    setDraft(""); setSolved(match ? { ...match, targetId: active.id } : null)
  }
  function addFix() {
    if (!solved) return
    const key = `${solved.session.id}:${solved.finding.id}`
    setWorkspace(previous => ({ ...previous, sessions: previous.sessions.map(session => {
      if (session.id !== solved.targetId || session.receivedFindings?.includes(key)) return session
      return { ...session, status: "waiting", updatedAt: new Date().toISOString(), receivedFindings: [...(session.receivedFindings ?? []), key],
        summary: `Added ${solved.session.owner}'s port-conflict context; the original task remains ${session.task}`,
        messages: [...session.messages, { role: "assistant" as const, text: `Context from ${solved.finding.source}\n\nProblem: ${solved.finding.problem}\n\nFinding: ${solved.finding.solution}\n\nDemo adaptation for “${session.task}”:\n1. Check which process owns port 3000.\n2. Preserve that session and use this project's configured port, 3005.\n3. Verify this session's server starts on that port before resuming the original task.\n\nThis is a walkthrough plan, not a live execution result.` }],
      }
    }) }))
    setInspecting(false); setToast(`${solved.session.owner}'s fix added with source attribution.`)
  }
  function keepInvestigating() {
    if (!solved) return
    setWorkspace(previous => ({ ...previous, sessions: previous.sessions.map(session => session.id === solved.targetId ? {
      ...session, updatedAt: new Date().toISOString(), messages: [...session.messages, { role: "assistant" as const, text: `Demo plan: continue investigating this server error independently. Compare the error, inspect which process owns the port, and record the next check in this session. Keep the original task, “${session.task}”, in scope. No finding has been copied or execution performed.` }],
    } : session) }))
    setSolved(null); setInspecting(false)
  }
  function startScenario(scenario: "overlap" | "solution" | "solo") {
    if (scenario === "overlap") { newSession("Build project navigation frontend"); return }
    const id = scenario === "solution" ? "demo-you-api" : "demo-you-auth"
    const fallback = sessions.find(session => session.owner === "You" && (scenario === "solution" || session.id !== "demo-you-api"))
    if (!sessions.some(session => session.id === id) && !fallback) { newSession(); return }
    openSession(sessions.some(session => session.id === id) ? id : fallback!.id)
    if (scenario === "solution") setDraft("My development server is failing with EADDRINUSE on port 3000")
  }

  return <div className="shell workflow-shell">
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="brand"><img className="workflow-brand-logo" src="/puff-logo.png" alt="" /><span>Puff</span><span className="brand-tag">collaborative</span></div>
      <button className="workspace-switch" onClick={overview}><span className="workspace-icon">{workspace.project.name[0]}</span><span>{workspace.project.name}<small>Demo team workspace</small></span><Icon name="chevron" size={16} /></button>
      <button className={`nav-button ${view === "overview" ? "project-active" : ""}`} onClick={overview}><Icon name="layers" /><span>Project overview</span></button>
      <button className="nav-button" onClick={() => newSession()}><Icon name="plus" /><span>New session</span><kbd>⌘ K</kbd></button>
      <button className="nav-button" onClick={() => setSearching(previous => !previous)}><Icon name="search" /><span>Search sessions</span></button>
      {searching && <input className="session-search" autoFocus placeholder="Search people or tasks…" aria-label="Search sessions" value={query} onChange={event => setQuery(event.target.value)} />}
      <div className="sidebar-section session-list workflow-session-list">
        <div className="sidebar-heading"><span>PROJECT WORK</span><span>{sessions.filter(session => session.scope === "project").length}</span></div>
        {workspace.project.members.map(member => {
          const owned = sessions.filter(session => session.owner === member.name && session.scope === "project")
          const matches = filtered.filter(session => session.owner === member.name && session.scope === "project")
          const added = owned.filter(session => !["demo-you-api", "demo-you-auth", "demo-sam-frontend", "demo-sam-mobile", "demo-alice-server", "demo-alice-tests"].includes(session.id)).map(session => session.task)
          const total = `${member.focus}${added.length ? ` Also: ${added.join("; ")}.` : ""}`
          const expanded = expandedPeople.includes(member.name)
          const recent = owned.filter(session => {
            const age = Date.now() - new Date(session.updatedAt).getTime()
            return hydrated && age >= 0 && age <= 90 * 60 * 1000
          })
          return <div className="workflow-sidebar-person" key={member.name}>
            <div className="workflow-sidebar-owner"><span className={`avatar ${member.color}`}>{member.initials}</span><strong>{displayName(member.name)}</strong><span>{owned.length}</span></div>
            <p className="workflow-sidebar-total" title={total}>{total}</p>
            {(expanded ? matches : matches.slice(0, 5)).map(session => <button className={`session-item ${selected === session.id && view === "chat" ? "active" : ""}`} key={session.id} onClick={() => openSession(session.id)} aria-label={`Open sidebar session ${session.title}`}>
              <span className={`status-dot ${session.status}`} />
              <span className="session-item-content"><span className="session-item-title">{session.title}</span><span className="workflow-sidebar-session-summary" title={session.summary}>{session.summary}</span><span className="session-item-meta">{labels[session.status]}</span></span>
            </button>)}
            {matches.length > 5 && <button className="workflow-sidebar-more" aria-expanded={expanded} onClick={() => setExpandedPeople(previous => expanded ? previous.filter(name => name !== member.name) : [...previous, member.name])}>{expanded ? "Show fewer sessions" : `Show ${matches.length - 5} more sessions`}</button>}
            <details className="workflow-recent-updates">
              <summary>Recent updates · 90 min<span>{recent.length}</span></summary>
              {recent.length === 0 && <p>No recent updates in the last 90 minutes.</p>}
              {recent.slice(0, 3).map(session => <button key={session.id} onClick={() => openSession(session.id)}><strong>{session.title}</strong><span title={session.summary}>{session.summary}</span></button>)}
              {recent.length > 3 && <details><summary>{recent.length - 3} more updates</summary>{recent.slice(3).map(session => <button key={session.id} onClick={() => openSession(session.id)}><strong>{session.title}</strong><span title={session.summary}>{session.summary}</span></button>)}</details>}
            </details>
          </div>
        })}
        {filtered.some(session => session.scope === "private" && session.owner === "You") && <div className="workflow-private-list"><div className="sidebar-heading"><span>YOUR PRIVATE SESSIONS</span></div>{filtered.filter(session => session.scope === "private" && session.owner === "You").map(session => <button className={`session-item ${selected === session.id ? "active" : ""}`} key={session.id} onClick={() => openSession(session.id)}><span className={`status-dot ${session.status}`} /><span className="session-item-content"><span className="session-item-title">{session.title}</span><span className="session-item-meta">You · Private</span></span></button>)}</div>}
        {!filtered.length && <p className="workflow-sidebar-empty">No sessions match this search.</p>}
      </div>
      <button className="nav-button workflow-new-project" onClick={() => beginSetup(true)}><Icon name="plus" size={16} /><span>New project</span></button>
      <div className="sidebar-footer"><div className="avatar green">S</div><div><strong>Serdar</strong><small>Interactive demo</small></div><button className="icon-button" aria-label="Project setup" onClick={() => beginSetup()}><Icon name="settings" /></button></div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Toggle sidebar" onClick={() => setSidebarOpen(previous => !previous)}><Icon name="panel" /></button><Icon name="folder" size={16} /><span className="workflow-breadcrumb-project">{workspace.project.name}</span><span className="breadcrumb-divider">/</span><span className="breadcrumb-current">{view === "overview" ? "Overview" : view === "setup" ? "Setup" : view === "new" ? "New session" : "Session"}</span></div>
        <div className="topbar-actions"><div className="presence">{workspace.project.members.map(member => <div key={member.name} className={`avatar ${member.color}`} title={member.name}>{member.initials}</div>)}</div><span className="workflow-demo-label">Interactive demo</span><button className="invite-button" onClick={() => beginSetup()}><Icon name="settings" size={14} /><span>Project setup</span></button></div>
      </header>
      <section ref={content} className={`content workflow-content ${view === "setup" ? "setup-content" : ""}`}>
        {view === "overview" && <ProjectOverview project={workspace.project} sessions={sessions} onOpenSession={openSession} onNewSession={() => newSession()} onSetup={() => beginSetup()} onStartScenario={startScenario} />}
        {view === "setup" && <form className="workflow-setup" onSubmit={event => { event.preventDefault(); advanceSetup() }}>
          <div className="workflow-setup-step">PROJECT SETUP · {step + 1} OF 3</div><h1>{["Give your project a home", "Bring your people together", "Start with a task for everyone"][step]}</h1><p className="workflow-setup-intro">{freshSetup ? "A new project starts a fresh demo with sample progress for the walkthrough. Sessions and changes stay in this browser." : "Update your project details. Existing sessions and attributed context are kept; changed assignments get separate waiting sessions."}</p><div className="workflow-step-dots" aria-label={`Step ${step + 1} of 3`}>{[0, 1, 2].map(number => <span className={number <= step ? "active" : ""} key={number} />)}</div>
          {step === 0 && <><label className="field">Project name<input aria-label="Project name" value={setup.name} onChange={event => setSetup(previous => ({ ...previous, name: event.target.value }))} autoFocus /></label><label className="field">Project goal<textarea aria-label="Project goal" value={setup.goal} onChange={event => setSetup(previous => ({ ...previous, goal: event.target.value }))} rows={3} /></label></>}
          {step === 1 && <><div className="workflow-fixed-person"><span className="avatar green">S</span><strong>Serdar</strong><span>You · project owner</span></div><label className="field">First teammate name<input aria-label="First teammate name" value={setup.sam} onChange={event => setSetup(previous => ({ ...previous, sam: event.target.value }))} autoFocus /></label><label className="field">Second teammate name<input aria-label="Second teammate name" value={setup.alice} onChange={event => setSetup(previous => ({ ...previous, alice: event.target.value }))} /></label></>}
          {step === 2 && ["You", setup.sam, setup.alice].map((name, index) => <label className="field" key={index}>{name}&apos;s first task<input aria-label={`${name}'s first task`} value={setup.tasks[index]} onChange={event => setSetup(previous => ({ ...previous, tasks: previous.tasks.map((task, position) => position === index ? event.target.value : task) }))} autoFocus={index === 0} /></label>)}
          {setupError && <p className="workflow-form-error" role="alert">{setupError}</p>}
          <div className="workflow-setup-actions"><button type="button" className="workflow-secondary-button" onClick={step ? () => { setStep(step - 1); setSetupError("") } : overview}>{step ? "Back" : "Cancel"}</button><button className="workflow-primary-button" type="submit">{step === 2 ? (freshSetup ? "Create demo project" : "Save project settings") : "Continue"}<Icon name="arrow" size={14} /></button></div>
        </form>}
        {view === "new" && <div className="workflow-new-view"><img className="workflow-welcome-logo" src="/puff-logo.png" alt="Puff" /><div className="eyebrow">A LITTLE CONTEXT. A LOT LESS CATCHING UP.</div><h1>What will you work on?</h1><p>Give one task its own session. Puff will surface related work before you begin.</p><div className="workflow-new-options"><label>Assigned to<select aria-label="Session owner" value={owner} onChange={event => { setOwner(event.target.value); if (event.target.value !== "You") setScope("project") }}>{workspace.project.members.map(member => <option key={member.name} value={member.name}>{displayName(member.name)}</option>)}</select></label><label>Visibility<select aria-label="Session visibility" value={scope} onChange={event => setScope(event.target.value as "project" | "private")}><option value="project">Project · shared</option>{owner === "You" && <option value="private">Private · only you</option>}</select></label></div></div>}
        {view === "chat" && active && <div className="chat-view workflow-chat">
          <div className="workflow-chat-heading"><div className="eyebrow">{active.scope === "private" ? "PRIVATE DEMO SESSION" : "PROJECT DEMO SESSION"}</div><h1>{active.title}</h1><div className="message-meta"><span className={`avatar ${active.color}`}>{active.initials}</span><span>{displayName(active.owner)}</span><span className={`status-dot ${active.status}`} /><span>{labels[active.status]}</span>{active.scope === "private" && <span>· Private</span>}</div></div>
          {active.relation && <div className="workflow-relation"><Icon name="layers" size={14} /><span>{displayRelation(active.relation)}</span></div>}
          {active.messages.map((message, index) => <article className={`message ${message.role}`} key={`${active.id}-${index}`}><div className="message-label">{message.role === "user" ? displayName(active.owner) : <><img className="workflow-message-logo" src="/puff-logo.png" alt="" />Puff<span className="workflow-message-demo">Demo</span></>}</div><div className="message-body">{message.text}</div></article>)}
          {solved?.targetId === active.id && <section className="workflow-finding-banner" aria-label="Related solved problem"><div className="workflow-finding-kicker">{fixAdded ? "CONTEXT ADDED" : "RELATED FINDING"}</div><h2>{solved.session.owner} solved a matching server error</h2><p>{solved.finding.title}. Compare the source with your error before applying the fix.</p><div className="workflow-finding-actions"><button onClick={() => setInspecting(true)}>Inspect {solved.session.owner}&apos;s fix</button><button className="workflow-apply-fix" onClick={addFix} disabled={fixAdded}>{fixAdded ? "Fix already added" : "Add fix to this session"}</button>{!fixAdded && <button onClick={keepInvestigating}>Keep investigating</button>}</div></section>}
        </div>}
        {(view === "new" || (view === "chat" && active)) && <div className="composer-wrap workflow-composer-wrap"><div className="composer"><div className="composer-context"><Icon name="folder" size={14} /><span>{workspace.project.name}</span><span className="context-divider">/</span><span>{displayName(view === "new" ? owner : active?.owner ?? "You")}</span></div><textarea ref={input} value={draft} onChange={event => setDraft(event.target.value)} placeholder={view === "new" ? "Describe a task…" : "Add a message or describe a problem…"} rows={2} aria-label="Session prompt" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} /><div className="composer-toolbar"><span className="workflow-composer-note">{view === "new" ? "Checks related project work" : "Local demo response"}</span><button className="workflow-submit-session" disabled={!draft.trim()} onClick={send}>{view === "new" ? "Start session" : "Send message"}<Icon name="arrow" size={15} /></button></div></div><div className="keyboard-hint">Enter to {view === "new" ? "start" : "send"}<span>·</span>Shift + Enter for a new line<span>·</span>Demo, no live agent execution</div></div>}
      </section>
      {(view === "new" || view === "chat") && <section className={`workflow-dock ${dockOpen ? "" : "is-collapsed"}`} aria-label="Team work summaries"><div className="workflow-dock-header"><span><Icon name="layers" size={14} />Across this project</span><button className="icon-button" aria-label={dockOpen ? "Collapse team summaries" : "Expand team summaries"} aria-expanded={dockOpen} onClick={() => setDockOpen(previous => !previous)}><Icon name="chevron" size={14} /></button></div>{dockOpen && <div className="workflow-dock-people">{workspace.project.members.map(member => {
        const owned = sessions.filter(session => session.owner === member.name)
        const added = owned.filter(session => !["demo-you-api", "demo-you-auth", "demo-sam-frontend", "demo-sam-mobile", "demo-alice-server", "demo-alice-tests"].includes(session.id)).map(session => session.task)
        const total = `${member.focus}${added.length ? ` Also: ${added.join("; ")}.` : ""}`
        return <article className="workflow-dock-person" key={member.name}><header><span className={`avatar ${member.color}`}>{member.initials}</span><strong>{displayName(member.name)}</strong><span>{owned.length} sessions</span></header><p className="workflow-dock-total" title={total}>{total}</p><div className="workflow-dock-sessions">{owned.map(session => <button className={active?.id === session.id ? "selected" : ""} key={session.id} onClick={() => openSession(session.id)} aria-label={`Open team summary ${session.title}`}><span><i className={`status-dot ${session.status}`} />{session.title}{session.scope === "private" && <small>Private</small>}</span><p title={session.summary}>{session.summary}</p></button>)}</div></article>
      })}</div>}</section>}
    </main>
    {overlap && <div className="modal-backdrop" onClick={() => setOverlap(null)}><section className="modal workflow-modal" role="dialog" aria-modal="true" aria-labelledby="overlap-title" onClick={event => event.stopPropagation()}><div className="modal-header"><h2 id="overlap-title">{overlap.owner === "You" ? "You are" : `${overlap.owner} is`} already working on this</h2><button className="icon-button" aria-label="Close related work" onClick={() => setOverlap(null)}><Icon name="close" /></button></div><p>Your task overlaps with existing project work. Choose how you want to continue.</p><div className="workflow-source-card"><span className="workflow-source-owner"><span className={`avatar ${overlap.color}`}>{overlap.initials}</span>{displayName(overlap.owner)} · {labels[overlap.status]}</span><h3>{overlap.title}</h3><p>{overlap.summary}</p></div><div className="workflow-modal-choices"><button className="workflow-primary-button" onClick={() => openSession(overlap.id)}>Open existing session</button><button onClick={() => addTask("complementary", overlap)}>Work on a complementary task<small>{overlap.topic === "navigation" ? "Accessibility checks and project-switching tests" : overlap.topic === "backend" ? "API contract tests and access-rule review" : overlap.topic === "dev-server" ? "Startup configuration and reproduction checks" : "Edge cases and verification review"}</small></button><button onClick={() => addTask("independent", overlap)}>Explore another approach<small>Your own session, with a reference to this work</small></button></div><button className="workflow-modal-cancel" onClick={() => setOverlap(null)}>Cancel</button></section></div>}
    {inspecting && solved && <div className="modal-backdrop" onClick={() => setInspecting(false)}><section className="modal workflow-modal workflow-source-modal" role="dialog" aria-modal="true" aria-labelledby="source-title" onClick={event => event.stopPropagation()}><div className="modal-header"><h2 id="source-title">{solved.finding.title}</h2><button className="icon-button" aria-label="Close source fix" onClick={() => setInspecting(false)}><Icon name="close" /></button></div><p className="workflow-source-attribution">{solved.finding.source}</p><div className="workflow-source-conversation">{solved.session.messages.map((message, index) => <article key={index}><strong>{message.role === "user" ? solved.session.owner : "Puff · Demo"}</strong><p>{message.text}</p></article>)}</div><div className="workflow-source-finding"><strong>Recorded finding</strong><p>{solved.finding.problem}</p><p>{solved.finding.solution}</p></div><button className="workflow-primary-button" disabled={fixAdded} onClick={addFix}>{fixAdded ? "Fix already added" : "Add fix to this session"}</button><button className="workflow-modal-cancel" onClick={() => setInspecting(false)}>Back to my session</button></section></div>}
    {toast && <div className="toast workflow-toast" role="status"><Icon name="check" size={14} />{toast}</div>}
  </div>
}
