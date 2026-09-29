"use client"

import { useEffect, useRef, useState } from "react"
import { demoSessions } from "../lib/sessions"
import type { Session } from "../lib/sessions"

const paths: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  chat: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z",
  folder: "M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  chevron: "m8 10 4 4 4-4",
  arrow: "M12 19V5m-6 6 6-6 6 6",
  diagonal: "M7 17 17 7M7 7h10v10",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  terminal: "m5 7 5 5-5 5m8 0h6",
  layers: "m12 3 10 6-10 6L2 9Zm-10 12 10 6 10-6M2 15l10 6 10-6",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  panel: "M9 3v18M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  settings: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  clock: "M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.chat} /></svg>
}

function Puff({ small = false }: { small?: boolean }) {
  return <svg className={small ? "brand-mark" : "puff-logo"} width={small ? 28 : 64} height={small ? 28 : 64} viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M18 17C20 6 35 5 42 14c11-2 20 9 16 19 6 10-1 22-13 22-8 9-23 6-26-4C6 53 1 39 8 30 4 22 10 15 18 17Z" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round"/><path d="m21 27 6 8-6 8m14 0h10" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

const labels = { running: "Working", waiting: "Ready", complete: "Completed" }

function updatedLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : `Updated ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
}
const suggestions = [
  { icon: "layers", title: "Catch me up", text: "What is everyone working on?" },
  { icon: "people", title: "Find related work", text: "Which sessions are exploring the same problem?" },
  { icon: "terminal", title: "Start something new", text: "Help me plan my next task." },
]

export default function Workspace() {
  const [sessions, setSessions] = useState<Session[]>(demoSessions)
  const [localSessions, setLocalSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [source, setSource] = useState("demo")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [filter, setFilter] = useState("All sessions")
  const [dockOpen, setDockOpen] = useState(true)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [toast, setToast] = useState("")
  const [hydrated, setHydrated] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const allSessions = [...localSessions, ...sessions]
  const active = allSessions.find(session => session.id === selected)
  const activeIsLocal = Boolean(active && localSessions.some(session => session.id === active.id))
  const people = Array.from(new Map(sessions.map(session => [session.owner, session])).values())
  const filtered = allSessions.filter(session => (!query || `${session.title} ${session.owner} ${session.summary}`.toLowerCase().includes(query.toLowerCase())) && (filter !== "My sessions" || session.owner === "You") && (filter !== "Working" || session.status === "running"))

  useEffect(() => {
    try {
      const saved = localStorage.getItem("puff-web-sessions")
      const parsed: unknown = saved ? JSON.parse(saved) : []
      if (Array.isArray(parsed)) setLocalSessions(parsed.filter((entry): entry is Session => Boolean(entry && typeof entry === "object" && typeof entry.id === "string" && entry.id.startsWith("local-") && typeof entry.title === "string" && entry.owner === "You" && typeof entry.summary === "string" && typeof entry.updatedAt === "string" && typeof entry.initials === "string" && ["green", "blue", "purple", "orange"].includes(entry.color) && ["running", "waiting", "complete"].includes(entry.status) && Array.isArray(entry.messages) && entry.messages.every((message: { role?: string; text?: string }) => message && ["user", "assistant"].includes(message.role || "") && typeof message.text === "string"))))
    } catch { setToast("Browser storage is unavailable. Drafts will last for this visit.") }
    setHydrated(true)
    const controller = new AbortController()
    const refresh = () => fetch("/api/sessions", { signal: controller.signal }).then(response => response.json()).then(data => { if (Array.isArray(data.sessions)) { setSessions(data.sessions); setSource(data.source) } }).catch(() => {})
    refresh()
    const interval = setInterval(refresh, 10000)
    return () => { controller.abort(); clearInterval(interval) }
  }, [])

  useEffect(() => { if (!hydrated) return; try { localStorage.setItem("puff-web-sessions", JSON.stringify(localSessions)) } catch { setToast("Browser storage is unavailable. Drafts will last for this visit.") } }, [localSessions, hydrated])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 3500); return () => clearTimeout(timer) }, [toast])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSelected(null); setDraft(""); input.current?.focus() }
      if (event.key === "Escape") { setInviteOpen(false); setSidebarOpen(false) }
    }
    window.addEventListener("keydown", keyboard)
    return () => window.removeEventListener("keydown", keyboard)
  }, [])

  function openSession(id: string) { setSelected(id); setSidebarOpen(false); setDraft("") }
  function newChat() { setSelected(null); setDraft(""); setSidebarOpen(false); input.current?.focus() }

  function send() {
    const text = draft.trim()
    if (!text) return
    const id = active && activeIsLocal ? active.id : `local-${Date.now()}`
    const next: Session = active && activeIsLocal ? { ...active, messages: [...active.messages, { role: "user", text }], summary: text, status: "waiting", updatedAt: new Date().toISOString() } : { id, title: text.slice(0, 48), owner: "You", initials: "S", color: "green", status: "waiting", summary: text, updatedAt: new Date().toISOString(), messages: [{ role: "user", text }] }
    setLocalSessions(previous => [next, ...previous.filter(session => session.id !== id)])
    setSelected(id)
    setDraft("")
    setToast("Draft saved on this browser. Agent execution is not connected.")
  }

  return <div className="shell">
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="brand"><Puff small /><span>Puff</span><span className="brand-tag">collaborative</span></div>
      <button className="workspace-switch" onClick={newChat}><span className="workspace-icon">H</span><span>Hackathon<small>Team workspace</small></span><Icon name="chevron" size={16} /></button>
      <button className="nav-button" onClick={newChat}><Icon name="plus" /><span>New session</span><kbd>⌘ K</kbd></button>
      <button className="nav-button" onClick={() => setSearching(previous => !previous)}><Icon name="search" /><span>Search sessions</span></button>
      {searching && <input className="session-search" autoFocus placeholder="Search title, person, or task…" aria-label="Search sessions" value={query} onChange={event => setQuery(event.target.value)} />}
      <div className="sidebar-section"><div className="sidebar-heading"><span>PROJECTS</span><button className="icon-button" aria-label="Open project home" onClick={newChat}><Icon name="plus" size={14} /></button></div>
        <button className="nav-button project-active" onClick={newChat}><Icon name="folder" /><span>Hackathon</span><Icon name="chevron" size={14} /></button>
      </div>
      <div className="sidebar-section session-list"><div className="sidebar-heading"><span>SESSIONS</span><span>{allSessions.length}</span></div>
        {filtered.map(session => <button className={`session-item ${selected === session.id ? "active" : ""}`} key={session.id} onClick={() => openSession(session.id)}><span className={`status-dot ${session.status}`} /><span className="session-item-content"><span className="session-item-title">{session.title}</span><span className="session-item-meta">{session.owner} <span>·</span> {labels[session.status]}</span></span></button>)}
        {!filtered.length && <p className="empty-state">No matching sessions.</p>}
      </div>
      <div className="sidebar-footer"><div className="avatar green">S</div><div><strong>Serdar</strong><small>Personal workspace</small></div><button className="icon-button" aria-label="Workspace information" onClick={() => setToast("Your drafts are stored in this browser. Team sessions come from the configured simulator.")}><Icon name="settings" /></button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Toggle sidebar" onClick={() => setSidebarOpen(previous => !previous)}><Icon name="panel" /></button><Icon name="folder" size={16} /><span>Hackathon</span><span className="breadcrumb-divider">/</span><span className="breadcrumb-current">{active ? "Session" : "Workspace"}</span></div><div className="topbar-actions"><div className="presence">{people.slice(0, 3).map(person => <div key={person.owner} className={`avatar ${person.color}`} title={`${person.owner} · ${labels[person.status]}`}>{person.initials}</div>)}<span className="presence-label">{people.length} people <span className="presence-source">· {source === "simulator" ? "simulated" : "demo"}</span></span></div><button className="invite-button" onClick={() => setInviteOpen(true)}><Icon name="people" size={15} /> Invite</button></div></header>
      <section className={`content ${active ? "has-chat" : ""}`}>
        {!active ? <div className="welcome"><Puff /><div className="eyebrow">A LITTLE CONTEXT. A LOT LESS CATCHING UP.</div><h1>What are we working on?</h1><p>Your space to build. Your team's work, in view.</p><div className="suggestions">{suggestions.map(suggestion => <button key={suggestion.title} className="suggestion" onClick={() => { setDraft(suggestion.text); input.current?.focus() }}><span className="suggestion-icon"><Icon name={suggestion.icon} size={19} /></span><span>{suggestion.title}</span><Icon name="diagonal" size={14} /></button>)}</div></div> : <div className="chat-view"><div className="chat-heading"><div className="eyebrow">{activeIsLocal ? "LOCAL DRAFT" : source === "simulator" ? "SIMULATED SESSION" : "DEMO SESSION"}</div><h1>{active.title}</h1><div className="message-meta"><div className={`avatar ${active.color}`}>{active.initials}</div><span>{active.owner}</span><span className={`status-dot ${active.status}`} /><span>{labels[active.status]}</span><span>· {updatedLabel(active.updatedAt)}</span></div></div>{active.messages.map((message, index) => <article className={`message ${message.role}`} key={`${active.id}-${index}`}><div className="message-label">{message.role === "user" ? active.owner : "Puff"}</div><div className="message-body">{message.text}</div></article>)}{activeIsLocal && <div className="draft-notice"><Icon name="clock" size={15} /> Saved locally. Connect an execution backend to run this task.</div>}</div>}
        <div className="composer-wrap"><div className="composer"><div className="composer-context"><Icon name="folder" size={15} /><span>Hackathon</span><span className="context-divider">/</span><span>{activeIsLocal ? "Your draft" : "New session"}</span></div><textarea ref={input} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask Puff, or describe a task…" rows={2} aria-label="Session prompt" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} /><div className="composer-toolbar"><div className="composer-options"><span className="composer-local"><span className="status-dot waiting" /> Local draft</span>{activeIsLocal && <button aria-label="Delete local draft" onClick={() => { setLocalSessions(previous => previous.filter(session => session.id !== active?.id)); setSelected(null) }}><Icon name="close" size={14} /> Delete draft</button>}</div><button className="send-button" aria-label="Save session draft" disabled={!draft.trim()} onClick={send}><Icon name="arrow" size={20} /></button></div></div><div className="keyboard-hint">Enter to save a draft <span>·</span> Shift + Enter for a new line</div></div>
      </section>
      <section className={`activity-dock ${dockOpen ? "" : "collapsed"}`} aria-label="Team session summaries"><div className="dock-header"><div className="dock-title"><Icon name="layers" size={17} /><span>Across your workspace</span><span className="live-pill"><span className="status-dot running" />{sessions.filter(session => session.status === "running").length} working <span className="presence-source">· {source === "simulator" ? "simulated" : "demo"}</span></span></div><div className="dock-controls"><select aria-label="Filter sessions" value={filter} onChange={event => setFilter(event.target.value)}><option>All sessions</option><option>My sessions</option><option>Working</option></select><button className="icon-button collapse-button" onClick={() => setDockOpen(previous => !previous)} aria-label={dockOpen ? "Collapse summaries" : "Expand summaries"} aria-expanded={dockOpen}><Icon name="chevron" size={16} /></button></div></div>{dockOpen && <div className="session-grid">{filtered.map(session => <button className={`session-card ${selected === session.id ? "selected" : ""}`} key={session.id} onClick={() => openSession(session.id)}><div className="card-top"><div className="person"><div className={`avatar ${session.color}`}>{session.initials}</div><span>{session.owner}</span></div><span className={`card-status ${session.status}`}><span className={`status-dot ${session.status}`} />{labels[session.status]}</span></div><div className="card-title">{session.title}</div><p className="card-summary" title={session.summary}>{session.summary}</p><div className="card-footer"><span>{updatedLabel(session.updatedAt)}</span><span>Open session <Icon name="diagonal" size={13} /></span></div></button>)}{!filtered.length && <div className="empty-state">{filter === "My sessions" ? "Start a session above to see your work here." : "No sessions match this filter."}</div>}</div>}</section>
    </main>
    {inviteOpen && <div className="modal-backdrop" onClick={() => setInviteOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-label="Invite your team" onClick={event => event.stopPropagation()}><div className="modal-header"><h2>Your team, in the loop</h2><button className="icon-button" aria-label="Close invite" onClick={() => setInviteOpen(false)}><Icon name="close" /></button></div><p>This preview uses sample collaborators. To see real teammates, connect this interface to your shared Puff service.</p><p className="invite-detail">Open session cards to inspect each person's work. Your own new sessions stay on this browser.</p><button className="primary-button" onClick={() => setInviteOpen(false)}>Got it</button></section></div>}
    {toast && <div className="toast" role="status"><Icon name="check" size={16} />{toast}</div>}
  </div>
}
