"use client"

import { useEffect, useRef, useState } from "react"
import type { LiveFinding, LiveReceipt, LiveSource, LiveThread, LiveWorkspace } from "../lib/connected-types"
import "./connected-workspace.css"

const statusLabels = { running: "Running", waiting: "Waiting", complete: "Reported complete", blocked: "Blocked", unknown: "No active run" }
const pendingMessagesKey = "puff-live-pending-messages-v1"

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const body: unknown = await response.json()
  if (!response.ok) {
    const failure = body && typeof body === "object" ? body as Record<string, unknown> : {}
    throw new Error(typeof failure.error === "string" ? failure.error : typeof failure.detail === "string" ? failure.detail : `Request failed (${response.status}).`)
  }
  return body as T
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed."
}

function time(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

export function ConnectedWorkspace() {
  const [workspace, setWorkspace] = useState<LiveWorkspace | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [thread, setThread] = useState<LiveThread | null>(null)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [dockOpen, setDockOpen] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [messageError, setMessageError] = useState<string | null>(null)
  const [receipts, setReceipts] = useState<Record<string, LiveReceipt>>({})
  const [findings, setFindings] = useState<LiveFinding[] | null>(null)
  const [findingError, setFindingError] = useState<string | null>(null)
  const [findingLoading, setFindingLoading] = useState(false)
  const [inspection, setInspection] = useState<{ targetId: string; finding: LiveFinding } | null>(null)
  const [source, setSource] = useState<LiveSource | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [reusing, setReusing] = useState(false)
  const [reused, setReused] = useState<Record<string, LiveReceipt>>({})
  const currentSelection = useRef<string | null>(null)
  const findingGeneration = useRef(0)
  const sourceGeneration = useRef(0)
  const findingController = useRef<AbortController | null>(null)
  const sourceController = useRef<AbortController | null>(null)
  const messageRequests = useRef<Record<string, { requestId: string; text: string }>>({})
  const messageLocks = useRef(new Set<string>())
  const reuseLocks = useRef(new Set<string>())
  const lastErrors = useRef<Record<string, string>>({})
  const closeSourceButton = useRef<HTMLButtonElement>(null)
  const inspectionTrigger = useRef<HTMLElement | null>(null)
  const active = thread?.thread.id === selected ? thread : null
  const draft = selected ? drafts[selected] ?? "" : ""
  const receipt = selected ? receipts[selected] : undefined
  const reuseKey = inspection ? `reuse:${inspection.targetId}:${inspection.finding.eventId}:${inspection.finding.seq}` : ""
  const reuseReceipt = reused[reuseKey]
  const reusePending = reusing || reuseLocks.current.has(reuseKey)
  const connected = Boolean(workspace && !workspaceError)
  const pendingMessage = selected ? messageRequests.current[selected] : undefined
  const canWrite = Boolean(workspace && active && active.thread.ownerId === workspace.viewer.id)
  const myThreadId = workspace?.threads.find(item => item.id === workspace.defaultThreadId && item.ownerId === workspace.viewer.id)?.id
    ?? workspace?.threads.find(item => item.ownerId === workspace.viewer.id)?.id
  const runnerLabel = workspace?.runnerAvailability === "model_configuration_missing"
    ? "Connect a coding model to run this session. Your messages and source context are saved in your session."
    : workspace?.runnerAvailability === "provider_auth_failed"
      ? "Your coding model rejected its credential. Update the provider key to run this session."
    : workspace?.runnerAvailability && ["configured", "model_configured"].includes(workspace.runnerAvailability)
      ? "Coding model configured. Run status shows whether it can execute."
      : workspace?.runnerAvailability && ["ready", "available"].includes(workspace.runnerAvailability)
        ? "Coding model available. Run status shows execution progress."
        : workspace?.runnerAvailability ? "Coding model availability has not been confirmed yet." : undefined

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(pendingMessagesKey) ?? "{}")
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return
      messageRequests.current = Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, { requestId: string; text: string }] => {
        const value: unknown = entry[1]
        return Boolean(value && typeof value === "object" && "requestId" in value && typeof value.requestId === "string" && "text" in value && typeof value.text === "string")
      }))
    } catch { /* The backend remains authoritative when browser storage is unavailable. */ }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let ignore = false
    let busy = false
    async function load() {
      if (busy) return
      busy = true
      try {
        const result = await request<LiveWorkspace>("/api/live/workspace", { signal: controller.signal })
        if (!ignore) { setWorkspace(result); setWorkspaceError(null) }
      } catch (error) {
        if (!ignore && !controller.signal.aborted) setWorkspaceError(readableError(error))
      } finally {
        busy = false
        if (!ignore) setWorkspaceLoading(false)
      }
    }
    void load()
    const timer = setInterval(() => { void load() }, 4000)
    return () => { ignore = true; controller.abort(); clearInterval(timer) }
  }, [refresh])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    let ignore = false
    let busy = false
    setThreadLoading(true)
    async function load() {
      if (busy) return
      busy = true
      try {
        const result = await request<LiveThread>(`/api/live/threads/${encodeURIComponent(selected!)}`, { signal: controller.signal })
        if (!ignore && currentSelection.current === selected) { setThread(result); setThreadError(null) }
      } catch (error) {
        if (!ignore && !controller.signal.aborted && currentSelection.current === selected) setThreadError(readableError(error))
      } finally {
        busy = false
        if (!ignore && currentSelection.current === selected) setThreadLoading(false)
      }
    }
    void load()
    const timer = setInterval(() => { void load() }, 2000)
    return () => { ignore = true; controller.abort(); clearInterval(timer) }
  }, [selected, refresh])

  useEffect(() => {
    if (!inspection) return
    closeSourceButton.current?.focus()
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Escape") closeSource() }
    window.addEventListener("keydown", keyboard)
    return () => window.removeEventListener("keydown", keyboard)
  }, [inspection])

  useEffect(() => () => { findingController.current?.abort(); sourceController.current?.abort() }, [])

  function closeSource(restoreFocus = true) {
    sourceGeneration.current += 1
    sourceController.current?.abort()
    setInspection(null); setSource(null); setSourceError(null); setSourceLoading(false); setReusing(false)
    if (restoreFocus) requestAnimationFrame(() => { if (inspectionTrigger.current?.isConnected) inspectionTrigger.current.focus() })
  }

  function selectThread(id: string | null) {
    currentSelection.current = id
    findingGeneration.current += 1
    findingController.current?.abort()
    closeSource(false)
    setSelected(id); setThread(null); setThreadLoading(Boolean(id)); setThreadError(null); setMessageError(null)
    setFindings(null); setFindingError(null); setFindingLoading(false); setSending(Boolean(id && messageLocks.current.has(id)))
    if (id && messageRequests.current[id]) setDrafts(previous => ({ ...previous, [id]: previous[id] || messageRequests.current[id].text }))
    setSidebarOpen(false)
  }

  async function checkFindings(targetId: string, text: string) {
    if (!text.trim() || currentSelection.current !== targetId) return
    const generation = ++findingGeneration.current
    findingController.current?.abort()
    const controller = new AbortController()
    findingController.current = controller
    setFindingLoading(true); setFindingError(null); setFindings(null)
    try {
      const result = await request<LiveFinding[]>(`/api/live/threads/${encodeURIComponent(targetId)}/findings?q=${encodeURIComponent(text)}`, { signal: controller.signal })
      if (generation === findingGeneration.current && currentSelection.current === targetId) setFindings(result)
    } catch (error) {
      if (!controller.signal.aborted && generation === findingGeneration.current && currentSelection.current === targetId) setFindingError(readableError(error))
    } finally {
      if (generation === findingGeneration.current && currentSelection.current === targetId) setFindingLoading(false)
    }
  }

  async function sendMessage(textOverride?: string) {
    const targetId = selected
    const text = (textOverride ?? draft).trim()
    if (!targetId || !text || !connected || !canWrite || messageLocks.current.has(targetId)) return
    const saved = messageRequests.current[targetId]
    if (saved && saved.text !== text) {
      setDrafts(previous => ({ ...previous, [targetId]: saved.text }))
      setMessageError("Confirm your previous message before submitting a different one. Retry sends that same message.")
      return
    }
    const pending = saved ?? { requestId: crypto.randomUUID(), text }
    messageRequests.current[targetId] = pending
    try { sessionStorage.setItem(pendingMessagesKey, JSON.stringify(messageRequests.current)) } catch { /* A transport retry still keeps the in-memory request identity. */ }
    messageLocks.current.add(targetId)
    lastErrors.current[targetId] = text
    setSending(true); setMessageError(null)
    try {
      const result = await request<LiveReceipt>(`/api/live/threads/${encodeURIComponent(targetId)}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending),
      })
      delete messageRequests.current[targetId]
      try { sessionStorage.setItem(pendingMessagesKey, JSON.stringify(messageRequests.current)) } catch { /* No local data is used to invent backend progress. */ }
      if (currentSelection.current !== targetId) return
      setReceipts(previous => ({ ...previous, [targetId]: result }))
      setDrafts(previous => previous[targetId]?.trim() === text ? { ...previous, [targetId]: "" } : previous)
      setRefresh(previous => previous + 1)
      void checkFindings(targetId, text)
    } catch (error) {
      if (currentSelection.current === targetId) setMessageError(readableError(error))
    } finally {
      messageLocks.current.delete(targetId)
      if (currentSelection.current === targetId) setSending(false)
    }
  }

  async function inspectFinding(finding: LiveFinding) {
    if (!selected) return
    const targetId = selected
    if (!inspection && document.activeElement instanceof HTMLElement) inspectionTrigger.current = document.activeElement
    const generation = ++sourceGeneration.current
    sourceController.current?.abort()
    const controller = new AbortController()
    sourceController.current = controller
    setInspection({ targetId, finding }); setSource(null); setSourceError(null); setSourceLoading(true); setReusing(false)
    try {
      const params = new URLSearchParams({ eventId: finding.eventId, seq: String(finding.seq), targetThreadId: targetId, targetActivitySeq: String(finding.targetActivitySeq), targetInstructionId: finding.targetInstructionId })
      const result = await request<LiveSource>(`/api/live/threads/${encodeURIComponent(finding.sourceThreadId)}/source?${params}`, { signal: controller.signal })
      if (result.event.id !== finding.eventId || result.event.seq !== finding.seq || result.thread.id !== finding.sourceThreadId || result.finding.eventId !== finding.eventId || result.finding.seq !== finding.seq || result.finding.sourceThreadId !== finding.sourceThreadId) throw new Error("The returned source does not match the selected finding. Refresh the findings before continuing.")
      if (generation === sourceGeneration.current && currentSelection.current === targetId) setSource(result)
    } catch (error) {
      if (!controller.signal.aborted && generation === sourceGeneration.current && currentSelection.current === targetId) setSourceError(readableError(error))
    } finally {
      if (generation === sourceGeneration.current && currentSelection.current === targetId) setSourceLoading(false)
    }
  }

  async function reuseFinding() {
    if (!inspection || !source || !connected || !canWrite || currentSelection.current !== inspection.targetId || reuseReceipt || reuseLocks.current.has(reuseKey)) return
    const targetId = inspection.targetId
    const finding = source.finding
    const key = reuseKey
    const generation = sourceGeneration.current
    reuseLocks.current.add(key)
    setReusing(true); setSourceError(null)
    try {
      const result = await request<LiveReceipt>(`/api/live/threads/${encodeURIComponent(targetId)}/reuse`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceThreadId: finding.sourceThreadId, eventId: finding.eventId, seq: finding.seq, cardVersion: finding.cardVersion, sourceActivitySeq: finding.sourceActivitySeq, targetActivitySeq: finding.targetActivitySeq, targetInstructionId: finding.targetInstructionId, requestId: key }),
      })
      if (currentSelection.current !== targetId || generation !== sourceGeneration.current) return
      setReused(previous => ({ ...previous, [key]: result }))
      setReceipts(previous => ({ ...previous, [targetId]: result }))
      setRefresh(previous => previous + 1)
    } catch (error) {
      if (currentSelection.current === targetId && generation === sourceGeneration.current) setSourceError(readableError(error))
    } finally {
      reuseLocks.current.delete(key)
      if (generation === sourceGeneration.current) setReusing(false)
    }
  }

  const viewer = workspace?.members.find(member => member.id === workspace.viewer.id)
  const owner = workspace?.members.find(member => member.id === active?.thread.ownerId)
  const executionFailed = active?.executions.some(execution => /fail|error|reject/i.test(execution.status))
  const retryText = selected ? lastErrors.current[selected] || active?.messages.filter(message => message.role === "user").at(-1)?.text : undefined

  return <div className="shell workflow-shell connected-shell">
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="brand"><img className="workflow-brand-logo" src="/puff-logo.png" alt="" /><span>Puff</span><span className="brand-tag">collaborative</span></div>
      <button className="workspace-switch" onClick={() => selectThread(null)}><span className="workspace-icon">{workspace?.project.name[0] ?? "P"}</span><span>{workspace?.project.name ?? "Workspace"}<small>Connected project</small></span></button>
      <button className={`nav-button ${selected ? "" : "active"}`} onClick={() => selectThread(null)}><span>◈</span><span className="nav-label">Project overview</span></button>
      <div className="sidebar-section session-list connected-sidebar-list">
        <div className="sidebar-heading"><span>PEOPLE &amp; SESSIONS</span><span>{workspace?.threads.length ?? 0}</span></div>
        {workspace?.members.map(member => {
          const owned = workspace.threads.filter(item => item.ownerId === member.id)
          const totalWork = owned.map(item => item.summary || item.originalTask || item.title).join(" · ")
          return <div className="workflow-sidebar-person" key={member.id}><div className="workflow-sidebar-owner"><span className={`avatar ${member.color}`}>{member.initials}</span>{member.name}</div><p className="workflow-sidebar-total" title={totalWork}>{totalWork || "No shared work returned."}</p>{owned.map(item => <button className={`session-item ${selected === item.id ? "active" : ""}`} key={item.id} title={`${item.title} · ${statusLabels[item.status]}`} aria-label={`Open ${item.title}, ${member.name}, ${statusLabels[item.status]}`} onClick={() => selectThread(item.id)}><span className={`status-dot ${item.status}`} /><span className="session-item-content"><span className="session-item-title">{item.title}</span><span className="workflow-sidebar-session-summary" title={item.summary || item.originalTask}>{item.summary || item.originalTask}</span></span></button>)}</div>
        })}
        {!workspace && <p className="sidebar-empty">Sessions appear when your workspace connects.</p>}
      </div>
      <div className="sidebar-footer"><span className={`avatar ${viewer?.color ?? "green"}`}>{viewer?.initials ?? "P"}</span><div><strong>{workspace?.viewer.name ?? "Puff workspace"}</strong><small>Project sessions</small></div></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}>☰</button><button onClick={() => selectThread(null)}>{workspace?.project.name ?? "Puff"}</button><span className="breadcrumb-separator">/</span><span>{selected ? "Session" : "Overview"}</span></div><div className="topbar-actions"><span className={`connected-status ${connected ? "" : "offline"}`}>{connected ? "Connected" : workspaceLoading ? "Connecting" : "Workspace not connected"}</span><button className="connected-refresh" onClick={() => setRefresh(previous => previous + 1)}>Refresh</button></div></header>
      <section className="content connected-content">
        {!workspace && <div className="connected-empty"><img src="/puff-logo.png" alt="Puff" />{workspaceLoading ? <><span className="connected-spinner" /><h1>Connecting your workspace</h1><p>Loading your project sessions.</p></> : <><h1>Workspace not connected</h1><p>Connect your project, then reconnect. Your existing sessions will appear here.</p>{workspaceError && <div className="connected-error" role="alert">{workspaceError}</div>}<button className="workflow-primary-button" onClick={() => { setWorkspaceLoading(true); setRefresh(previous => previous + 1) }}>Reconnect</button></>}</div>}
        {workspace && workspaceError && <div className="connected-error" role="alert">Connection lost. The last received state is shown below. {workspaceError}</div>}
        {workspace && !selected && <div className="connected-overview"><header className="connected-heading"><div><div className="eyebrow">YOUR PROJECT, IN VIEW</div><h1>People &amp; their work</h1><p>{workspace.project.goal ?? "Open a session to see its original task, conversation, and execution state."}</p></div>{myThreadId && <button className="workflow-primary-button" onClick={() => selectThread(myThreadId)}>Open my session</button>}</header>{runnerLabel && <div className="connected-receipt">{runnerLabel}</div>}<h2 className="connected-section-label">Project sessions</h2><div className="connected-people">{workspace.members.map(member => {
          const owned = workspace.threads.filter(item => item.ownerId === member.id)
          const running = owned.filter(item => item.status === "running").length
          const completed = owned.filter(item => item.status === "complete").length
          return <article className="connected-person" key={member.id}><header><span className={`avatar ${member.color}`}>{member.initials}</span><h2>{member.name}</h2><span>{owned.length} sessions</span></header><p className="connected-person-summary">{owned.map(item => item.summary || item.originalTask || item.title).join(" · ") || "No shared sessions."}</p><div className="connected-person-counts"><span>{running} running</span><span>{owned.filter(item => item.status === "waiting").length} waiting</span><span>{completed} reported complete</span>{owned.some(item => item.status === "blocked") && <span>{owned.filter(item => item.status === "blocked").length} blocked</span>}</div><div className="connected-person-threads">{owned.map(item => <button className="connected-thread-card" key={item.id} aria-label={`Open ${item.title}`} onClick={() => selectThread(item.id)}><span><i className={`status-dot ${item.status}`} />{item.title}</span><p>{item.summary || item.originalTask}</p><small>{statusLabels[item.status]}</small></button>)}</div></article>
        })}</div></div>}
        {selected && !active && <div className="connected-empty">{threadLoading ? <><span className="connected-spinner" /><p>Loading this session…</p></> : <><h1>Session unavailable</h1><p>{threadError ?? "This session could not be loaded."}</p><button className="workflow-primary-button" onClick={() => setRefresh(previous => previous + 1)}>Retry</button></>}</div>}
        {active && <div className="connected-thread"><header className="connected-heading"><div><div className="eyebrow">SESSION</div><h1>{active.thread.title}</h1><div className="message-meta"><span className={`avatar ${owner?.color ?? "green"}`}>{owner?.initials ?? "P"}</span><span>{owner?.name ?? active.thread.ownerId}</span><span className={`status-dot ${active.thread.status}`} /><span>{statusLabels[active.thread.status]}</span></div></div></header>{threadError && <div className="connected-error" role="alert">Could not refresh this session. {threadError}</div>}<div className="connected-original-task"><strong>Original task</strong><p>{active.thread.originalTask || "No original task is recorded for this session."}</p></div>{active.instructions.length > 0 && <details className="connected-instructions"><summary>Session instructions · {active.instructions.length}</summary>{active.instructions.map((instruction, index) => <p key={index}>{instruction}</p>)}</details>}{canWrite && runnerLabel && <div className="connected-receipt">{runnerLabel}</div>}<div className="connected-executions" aria-label="Run status">{active.executions.map(execution => <div className="connected-execution" key={execution.id}><span>Run: {execution.status.replaceAll("_", " ")}</span>{execution.detail && <small>{execution.detail}</small>}</div>)}</div>
          {active.messages.map(message => <article className={`message ${message.role}`} key={message.id}><div className="message-label">{message.role === "assistant" && <img className="workflow-message-logo" src="/puff-logo.png" alt="" />}<span>{message.author}</span><span className="connected-message-time">{time(message.createdAt)}</span></div><div className="message-body">{message.text}</div></article>)}
          {!active.messages.length && <p className="connected-person-summary">No conversation messages have been returned yet.</p>}
          <details className="connected-events"><summary>Session activity · {active.events.length} events</summary>{active.events.map(event => <article className="connected-event" key={event.id}><strong>{event.author} · {event.kind} · {time(event.createdAt)}</strong><p>{event.text}</p></article>)}</details>
          {!canWrite && <div className="connected-receipt connected-read-only">Shared session · read only here. Open your session to use this finding.{myThreadId && <button className="connected-find-button" onClick={() => selectThread(myThreadId)}>Open my session</button>}</div>}
          {canWrite && <div className="connected-composer composer-wrap"><div className="composer"><div className="composer-context">{workspace?.project.name} / {owner?.name ?? "Session"}</div><textarea value={draft} rows={3} aria-label="Server error message" placeholder="Describe the server error in this session…" disabled={sending || Boolean(pendingMessage)} onChange={event => { const text = event.target.value; setDrafts(previous => ({ ...previous, [active.thread.id]: text })) }} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage() } }} /><div className="composer-toolbar"><span className="composer-options">Queue a message in this session</span><div className="connected-message-actions"><button className="connected-find-button" disabled={!connected || findingLoading || (!draft.trim() && !lastErrors.current[active.thread.id])} onClick={() => { void checkFindings(active.thread.id, draft.trim() || lastErrors.current[active.thread.id]) }}>{findingLoading ? "Checking findings…" : "Check related findings"}</button><button className="workflow-submit-session" disabled={!connected || sending || !draft.trim()} onClick={() => { void sendMessage(pendingMessage?.text) }}>{sending ? "Submitting…" : pendingMessage ? "Retry message" : "Send error"}<span aria-hidden="true">↑</span></button></div></div></div></div>}
          {pendingMessage && !sending && <div className="connected-receipt">Your previous message still needs confirmation. Retry it before starting a different message.</div>}
          {messageError && <div className="connected-error" role="alert">{messageError} Retry confirms the same message.</div>}
          {receipt && <div className="connected-receipt" role="status">Session status: {receipt.status.replaceAll("_", " ")}{receipt.detail && <p>{receipt.detail}</p>}</div>}
          {executionFailed && <div className="connected-error" role="alert">A run failed. Review its details above.{canWrite && retryText && <button disabled={sending || !connected} onClick={() => { void sendMessage(retryText) }}>Queue last message again</button>}</div>}
          {findingError && <div className="connected-error" role="alert">Could not check shared findings. {findingError}</div>}
          {findings && <section className="connected-findings" aria-label="Related shared findings"><h2 className="connected-section-label">Related source context</h2>{!findings.length && <p className="connected-person-summary">No shared finding was returned for this error.</p>}{findings.map(finding => <article className="connected-finding" key={`${finding.sourceThreadId}:${finding.eventId}:${finding.seq}`}><span>{finding.ownerName} · {finding.threadTitle}</span><h3>{finding.ownerName} recorded a fix for this error</h3><p>{finding.title}<br />{finding.problem}</p><button className="workflow-primary-button" onClick={() => { void inspectFinding(finding) }}>Inspect {finding.ownerName}&apos;s solution</button></article>)}</section>}
        </div>}
      </section>
      {active && workspace && <section className={`workflow-dock ${dockOpen ? "" : "is-collapsed"}`} aria-label="Across this project"><div className="workflow-dock-header"><span>Across this project</span><button className="icon-button" aria-label={dockOpen ? "Collapse project summaries" : "Expand project summaries"} aria-expanded={dockOpen} onClick={() => setDockOpen(previous => !previous)}>{dockOpen ? "⌄" : "⌃"}</button></div>{dockOpen && <div className="workflow-dock-people connected-dock-people">{workspace.members.map(member => {
        const owned = workspace.threads.filter(item => item.ownerId === member.id)
        const totalWork = owned.map(item => item.summary || item.originalTask || item.title).join(" · ")
        return <article className="workflow-dock-person" key={member.id}><header><span className={`avatar ${member.color}`}>{member.initials}</span><strong>{member.name}</strong><span>{owned.length} sessions</span></header><p className="workflow-dock-total" title={totalWork}>{totalWork || "No shared work returned."}</p><div className="workflow-dock-sessions">{owned.map(item => <button className={selected === item.id ? "selected" : ""} key={item.id} aria-label={`Open project summary ${item.title}`} title={statusLabels[item.status]} onClick={() => selectThread(item.id)}><span><i className={`status-dot ${item.status}`} />{item.title}</span><p title={item.summary || item.originalTask}>{item.summary || item.originalTask}</p></button>)}</div></article>
      })}</div>}</section>}
    </main>
    {inspection && <div className="modal-backdrop" onClick={() => closeSource()}><section className="modal connected-source-dialog" role="dialog" aria-modal="true" aria-labelledby="connected-source-title" onClick={event => event.stopPropagation()}><div className="modal-header"><h2 id="connected-source-title">{inspection.finding.ownerName}&apos;s source solution</h2><button ref={closeSourceButton} className="modal-close" aria-label="Close source inspection" onClick={() => closeSource()}>×</button></div><p>{inspection.finding.threadTitle}</p>{sourceLoading && <p><span className="connected-spinner" /> Loading the exact source event…</p>}{sourceError && <div className="connected-error" role="alert">{sourceError}<button onClick={() => { void inspectFinding(inspection.finding) }}>Retry source</button></div>}{source && <><div className="connected-source-meta">{source.event.author} · source event {source.event.seq} · {time(source.event.createdAt)}<br />Original task: {source.thread.originalTask}</div><div className="connected-source-solution"><h3>{source.finding.title}</h3></div><div className="connected-source-body"><article><strong>{source.event.author} · {time(source.event.createdAt)}</strong><p>{source.event.text}</p></article>{source.messages.filter((message, index, messages) => message.text.trim() !== source.event.text.trim() && messages.findIndex(item => item.text.trim() === message.text.trim()) === index).map(message => <article key={message.id}><strong>{message.author} · {time(message.createdAt)}</strong><p>{message.text}</p></article>)}</div><p>Add this attributed context to your existing session. Your original task and conversation stay in place.</p>{reuseReceipt && <div className="connected-receipt" role="status">Session status: {reuseReceipt.status.replaceAll("_", " ")}{reuseReceipt.detail && <p>{reuseReceipt.detail}</p>}</div>}<div className="connected-source-actions"><button className="workflow-primary-button" disabled={!connected || !canWrite || reusePending || Boolean(reuseReceipt)} onClick={() => { void reuseFinding() }}>{reusePending ? "Adding source context…" : reuseReceipt ? "Source context submitted" : "Add fix to this session"}</button><button onClick={() => closeSource()}>Back to my session</button></div></>}</section></div>}
  </div>
}
