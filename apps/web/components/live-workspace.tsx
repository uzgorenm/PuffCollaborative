"use client"

import { useEffect, useRef, useState } from "react"
import { ProjectOverview } from "./project-overview"
import { connectToBackend, coordinationRequest, disconnectBackend, readConnection } from "../lib/coordination-client"
import type { ConnectionState } from "../lib/coordination-client"
import { loadLiveWorkspace, readLiveSource } from "../lib/live-workspace"
import type { Approval, EvidenceRef, LiveSession, LiveWorkspace, SourceEvent, ThreadSnapshot } from "../lib/live-workspace"
import { possiblyRelatedWork, prepareLiveAction, reviewedContextText, sourceEventText, restorePendingActions, pendingActionsForScope, cooperationWrite, confirmedPendingInstruction, toolReviewForApproval, toolReviewFingerprint, preserveProvisionContinuation, matchesConnectionScope, sessionContextSource, sessionTaskPreview } from "../lib/live-actions"
import type { LiveAction, PendingLiveAction, CooperationInput } from "../lib/live-actions"
import "../app/workflow.css"
import "./live-workspace.css"

type Provisioning = { projects: { projectId: string; name: string; modelReady: boolean }[]; privateSessions: false }
type ProvisionedSession = { thread: { id: string; sessionId: string }; sessionId: string; ownerUserId: string }
type View = "overview" | "new" | "chat" | "settings" | "project" | "connection"
type Cooperation = Omit<CooperationInput, "expectedVersion"> & { threadId: string; ownerId?: string; sourceActivitySeq: number; version: number; updatedAt?: string }
type FailedAction = { key: string; action: LiveAction; label: string; error: string }
const terminal = new Set(["completed", "failed", "cancelled"])
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed"
const displayActor = (connection: ConnectionState | undefined) => connection?.username ? connection.username[0].toUpperCase() + connection.username.slice(1) : "You"
const runLabel = (session: LiveSession) => session.execution.replaceAll("_", " ") || "No execution recorded"
const threadPath = (id: string) => `/threads/${encodeURIComponent(id)}`

export function LiveWorkspaceView(props: { onTryDemo: () => void }) {
  const [connection, setConnection] = useState<ConnectionState>()
  const [connectionForm, setConnectionForm] = useState({ url: "http://127.0.0.1:4096", username: "serdar", password: "" })
  const [live, setLive] = useState<LiveWorkspace>()
  const [provisioning, setProvisioning] = useState<Provisioning>({ projects: [], privateSessions: false })
  const [projectId, setProjectId] = useState("")
  const [view, setView] = useState<View>("overview")
  const [selected, setSelected] = useState<string>()
  const [query, setQuery] = useState("")
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [draftsReady, setDraftsReady] = useState(false)
  const [mode, setMode] = useState<"instruction" | "comment">("instruction")
  const [share, setShare] = useState(false)
  const [sessionTitle, setSessionTitle] = useState("")
  const [focusDraft, setFocusDraft] = useState("")
  const [focusEditing, setFocusEditing] = useState(false)
  const [focusVersion, setFocusVersion] = useState(0)
  const [settings, setSettings] = useState({ goal: "", criteria: "", expectedVersion: 0 })
  const [newProject, setNewProject] = useState({ projectId: "", name: "" })
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [loadError, setLoadError] = useState("")
  const [notice, setNotice] = useState("")
  const [failed, setFailed] = useState<FailedAction>()
  const [refresh, setRefresh] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [dockOpen, setDockOpen] = useState(true)
  const [source, setSource] = useState<{ ref: EvidenceRef; event?: SourceEvent; loading: boolean; error?: string }>()
  const [sourceReviewed, setSourceReviewed] = useState(false)
  const [pendingVersion, setPendingVersion] = useState(0)
  const [cooperation, setCooperation] = useState<Cooperation>()
  const [cooperationError, setCooperationError] = useState("")
  const [reviewedTools, setReviewedTools] = useState<Record<string, { version: number; fingerprint: string }>>({})
  const [cooperationDraft, setCooperationDraft] = useState<(CooperationInput & { threadId: string })>()
  const epoch = useRef(0)
  const scopeController = useRef<AbortController | undefined>(undefined)
  const sourceController = useRef<AbortController | undefined>(undefined)
  const sourceEpoch = useRef(0)
  const busyRef = useRef("")
  const confirmedInstructions = useRef(new Set<string>())
  const pendingWrites = useRef(new Map<string, PendingLiveAction>())
  const attempts = useRef(new Map<string, LiveAction>())
  const approvalAttempts = useRef(new Map<string, LiveAction>())
  const provisionTasks = useRef(new Map<string, { task: string; draftKey: string; draftText?: string }>())
  const content = useRef<HTMLElement>(null)
  const scrollPositions = useRef(new Map<string, number>())
  const sourceOpener = useRef<HTMLElement | null>(null)
  const sourceDialog = useRef<HTMLElement>(null)
  const ownFocus = live?.focus.find(item => item.userId === connection?.actorId)
  const active = live?.workspace.sessions.find(session => session.id === selected)
  const snapshot = active ? live?.snapshots[active.id] : undefined
  const identity = `${connection?.url ?? ""}|${connection?.actorId ?? ""}|${live?.projectId || projectId}`
  const draftKey = `${identity}|${view === "new" ? "new" : selected ?? "none"}|${view === "new" ? "task" : mode}`
  const draft = drafts[draftKey] ?? ""
  const canInstruct = Boolean(active?.ownerId && active.ownerId === connection?.actorId)
  const currentRun = snapshot?.runs.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)).findLast(run => !terminal.has(run.state))
  const filtered = live?.workspace.sessions.filter(session => `${session.title} ${session.owner} ${session.summary}`.toLowerCase().includes(query.toLowerCase())) ?? []
  const connectionKey = `${connection?.url ?? ""}|${connection?.actorId ?? ""}`

  useEffect(() => {
    const controller = new AbortController()
    let ignore = false
    readConnection(controller.signal).then(value => { if (!ignore) setConnection(value) }).catch(reason => {
      if (!ignore) { setConnection({ connected: false }); setError(errorMessage(reason)) }
    })
    return () => { ignore = true; controller.abort() }
  }, [])

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("puff-live-drafts-v1") ?? "{}")
      if (saved && typeof saved === "object" && !Array.isArray(saved)) setDrafts(Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value)])))
    } catch { /* Browser storage is optional; keep drafts in memory. */ }
    try {
      restorePendingActions(sessionStorage.getItem("puff-live-pending-v1")).forEach(entry => {
        pendingWrites.current.set(entry.key, entry)
        attempts.current.set(entry.key, entry.action)
        if (entry.approval) approvalAttempts.current.set(entry.key, entry.action)
        if (entry.provision) provisionTasks.current.set(entry.key, entry.provision)
      })
    } catch { /* Keep request identities in memory if browser storage is unavailable. */ }
    setPendingVersion(value => value + 1)
    setDraftsReady(true)
  }, [])
  useEffect(() => {
    if (!draftsReady) return
    try { localStorage.setItem("puff-live-drafts-v1", JSON.stringify(drafts)) } catch { /* No transcripts or credentials are persisted. */ }
  }, [drafts, draftsReady])

  useEffect(() => {
    if (!draftsReady || busyRef.current || failed) return
    const pending = pendingActionsForScope([...pendingWrites.current.values()], { url: connection?.url, actorId: connection?.actorId, projectId: live?.projectId || projectId })[0]
    if (!pending) return
    const message = "The outcome of this saved request is unconfirmed. Retry retains its original identity and reviewed version."
    setFailed({ key: pending.key, action: pending.action, label: pending.label, error: message })
    setError(message)
  }, [connectionKey, live?.projectId, projectId, pendingVersion, draftsReady])

  useEffect(() => {
    const controller = new AbortController()
    scopeController.current = controller
    epoch.current += 1
    return () => { scopeController.current?.abort(); epoch.current += 1 }
  }, [connectionKey, connection?.connected, projectId])

  useEffect(() => {
    if (!connection?.connected) return
    const controller = new AbortController()
    const token = epoch.current
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      const [workspaceResult, provisioningResult] = await Promise.allSettled([
        loadLiveWorkspace(projectId || undefined, controller.signal),
        coordinationRequest<Provisioning>("/provisioning", { signal: controller.signal }),
      ])
      if (disposed || controller.signal.aborted || token !== epoch.current) return
      let currentConnection: ConnectionState
      try { currentConnection = await readConnection(controller.signal) }
      catch (reason) {
        if (!disposed && !controller.signal.aborted && token === epoch.current) { setLoadError(errorMessage(reason)); timer = setTimeout(poll, 3000) }
        return
      }
      if (disposed || controller.signal.aborted || token !== epoch.current) return
      if (!matchesConnectionScope(currentConnection, connection)) { adoptConnection(currentConnection); return }
      if (workspaceResult.status === "fulfilled" && workspaceResult.value.actorId !== currentConnection.actorId) {
        setLoadError("Activity was returned for a different authenticated account; it was discarded.")
        timer = setTimeout(poll, 3000)
        return
      }
      if (provisioningResult.status === "fulfilled") setProvisioning(provisioningResult.value)
      if (workspaceResult.status === "fulfilled") {
        const value = workspaceResult.value
        pendingActionsForScope([...pendingWrites.current.values()], { url: connection?.url, actorId: connection?.actorId, projectId: value.projectId }).forEach(entry => {
          const threadId = confirmedPendingInstruction(entry, value.snapshots)
          if (threadId) {
            confirmedInstructions.current.add(String(entry.action.body.requestId))
            clearAcceptedDraft(`${connectionKey}|${value.projectId}|${threadId}|instruction`, String(entry.action.body.text))
            forgetPending(entry.key)
            setFailed(previous => previous?.key === entry.key ? undefined : previous)
            setError("")
          }
          if (!entry.approval) return
          const approvalId = entry.action.path.match(/\/approvals\/([^/]+)\/decision$/)?.[1]
          const approval = Object.values(value.snapshots).flatMap(snapshot => snapshot.approvals).find(item => item.id === approvalId && item.decisionId === entry.action.body.decisionId && item.deliveryState === "delivered")
          if (approval) { forgetPending(entry.key); setFailed(previous => previous?.key === entry.key ? undefined : previous); setError("") }
        })
        setLive(value)
        setLoadError("")
      } else setLoadError(errorMessage(workspaceResult.reason))
      timer = setTimeout(poll, 3000)
    }
    void poll()
    return () => { disposed = true; controller.abort(); clearTimeout(timer) }
  }, [connectionKey, connection?.connected, projectId, refresh])

  useEffect(() => {
    setCooperation(undefined); setCooperationError("")
    if (!connection?.connected || !selected || view !== "chat") return
    const controller = new AbortController(), token = epoch.current
    let timer: ReturnType<typeof setTimeout>
    async function pollCooperation() {
      try {
        const value = await coordinationRequest<Cooperation>(`${threadPath(selected!)}/cooperation`, { signal: controller.signal })
        if (controller.signal.aborted || token !== epoch.current) return
        if (value.threadId !== selected || !Number.isSafeInteger(value.version) || value.version < 0 || !Number.isSafeInteger(value.sourceActivitySeq) || value.sourceActivitySeq < 0 || typeof value.featureTopic !== "string" || typeof value.analysisEnabled !== "boolean" || value.analysisTextEnabled !== undefined && typeof value.analysisTextEnabled !== "boolean" || !["open", "complementary", "alternative"].includes(value.relationship) || !["off", "notify"].includes(value.awarenessMode) || !value.analysisEnabled && (value.awarenessMode !== "off" || value.analysisTextEnabled === true)) throw new Error("The service returned inconsistent cooperation settings")
        setCooperation({ ...value, analysisTextEnabled: value.analysisTextEnabled === true }); setCooperationError("")
      } catch (reason) { if (!controller.signal.aborted && token === epoch.current) setCooperationError(errorMessage(reason)) }
      if (!controller.signal.aborted && token === epoch.current) timer = setTimeout(pollCooperation, 3000)
    }
    void pollCooperation()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [connectionKey, connection?.connected, projectId, selected, view, refresh])

  useEffect(() => {
    if (!content.current || view !== "chat") return
    content.current.scrollTop = scrollPositions.current.get(`${identity}|${selected}`) ?? 0
  }, [selected, identity, view])

  useEffect(() => {
    if (!source) return
    sourceDialog.current?.querySelector<HTMLButtonElement>("button")?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeSource() }
      if (event.key !== "Tab") return
      const targets = Array.from(sourceDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, [tabindex="0"]') ?? [])
      const first = targets[0], last = targets.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener("keydown", keyboard)
    return () => window.removeEventListener("keydown", keyboard)
  }, [source?.ref.eventId])
  useEffect(() => () => sourceController.current?.abort(), [])

  function updateDraft(text: string) { setDrafts(previous => ({ ...previous, [draftKey]: text })) }
  function closeSource() {
    sourceEpoch.current += 1
    sourceController.current?.abort()
    setSource(undefined)
    setSourceReviewed(false)
    sourceOpener.current?.focus({ preventScroll: true })
  }
  function invalidate() {
    epoch.current += 1
    scopeController.current?.abort()
    scopeController.current = new AbortController()
    closeSource()
    setLive(undefined)
    setProvisioning({ projects: [], privateSessions: false })
    setLoadError("")
    setError("")
    setFailed(undefined)
    busyRef.current = ""
    setBusy("")
    setNotice("")
    setSelected(undefined)
    setFocusEditing(false)
    setCooperationDraft(undefined)
  }
  function adoptConnection(next: ConnectionState) {
    invalidate()
    setConnection(next)
    setProjectId("")
    setView(next.connected ? "overview" : "connection")
    setError("The authenticated account changed. Previous responses were discarded and saved requests remain with their original account.")
    setConnectionForm(previous => ({ ...previous, url: next.url ?? previous.url, username: next.username ?? previous.username, password: "" }))
  }
  function changeProject(id: string) { invalidate(); setRefresh(value => value + 1); setProjectId(id); setView("overview"); setShare(false) }
  function openSession(id: string) {
    if (view === "chat" && content.current && selected) scrollPositions.current.set(`${identity}|${selected}`, content.current.scrollTop)
    closeSource()
    setSelected(id)
    setCooperationDraft(undefined)
    setView("chat")
    setSidebarOpen(false)
    setError("")
    const session = live?.workspace.sessions.find(item => item.id === id)
    if (!session?.ownerId || session.ownerId !== connection?.actorId) setMode("comment")
    else setMode("instruction")
  }
  function openNew() { closeSource(); setView("new"); setShare(false); setSessionTitle(""); setSidebarOpen(false); setError("") }
  function openSettings() { setSettings({ goal: live?.brief?.goal ?? "", criteria: live?.brief?.successCriteria.join("\n") ?? "", expectedVersion: live?.brief?.version ?? 0 }); setView("settings"); setError("") }

  async function connect(event: React.FormEvent) {
    event.preventDefault()
    invalidate()
    setConnection({ connected: false })
    setBusy("connect")
    try {
      const next = await connectToBackend(connectionForm)
      setConnection(next)
      setConnectionForm(previous => ({ ...previous, password: "" }))
      setProjectId("")
      setView("overview")
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setBusy("") }
  }
  async function disconnect() {
    invalidate()
    setBusy("disconnect")
    try { await disconnectBackend(); setConnection({ connected: false }); setView("connection") }
    catch (reason) { setError(errorMessage(reason)); setRefresh(value => value + 1) }
    finally { setBusy("") }
  }

  function persistPending() {
    try { sessionStorage.setItem("puff-live-pending-v1", JSON.stringify([...pendingWrites.current.values()])) }
    catch { setError("Could not save the request retry identity in this browser. The new request was not sent."); return false }
    setPendingVersion(value => value + 1)
    return true
  }
  function forgetPending(key: string) {
    pendingWrites.current.delete(key)
    attempts.current.delete(key)
    persistPending()
  }
  function startNewRequest() {
    if (!failed) return
    forgetPending(failed.key)
    approvalAttempts.current.delete(failed.key)
    provisionTasks.current.delete(failed.key)
    setFailed(undefined); setError("")
    setNotice("The previous request may still exist on the service. Review recorded activity before sending a new request.")
  }
  function clearAcceptedDraft(key: string, text: string) {
    setDrafts(previous => previous[key]?.trim() === text.trim() ? { ...previous, [key]: "" } : previous)
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("puff-live-drafts-v1") ?? "{}")
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        const stored = saved as Record<string, unknown>
        if (typeof stored[key] === "string" && stored[key].trim() === text.trim()) {
          stored[key] = ""
          localStorage.setItem("puff-live-drafts-v1", JSON.stringify(stored))
        }
      }
    } catch { /* The in-memory draft still reflects the confirmed result. */ }
  }

  async function execute(action: LiveAction, key: string, label: string, options: { refresh?: boolean; held?: boolean } = {}) {
    if (!key.startsWith(`${connectionKey}|${action.projectId}|`) || action.actorId !== connection?.actorId || !connection?.connected || !options.held && busyRef.current) return undefined
    busyRef.current = key
    const token = epoch.current
    setBusy(key); setError(""); setNotice("")
    try {
      const authenticated = await readConnection(scopeController.current?.signal)
      if (token !== epoch.current) return undefined
      if (!matchesConnectionScope(authenticated, { url: connection?.url, actorId: action.actorId })) { adoptConnection(authenticated); return undefined }
      const result = await coordinationRequest<unknown>(action.path, { method: action.method, body: action.body, signal: scopeController.current?.signal, expectedActorId: action.actorId })
      if (token !== epoch.current) return undefined
      const target = action.path.match(/^\/threads\/([^/]+)\/(instructions|comments)$/)
      const acceptedText = target?.[2] === "comments" ? action.body.body : action.body.text
      if (target && typeof acceptedText === "string") {
        const acceptedDraft = `${connectionKey}|${action.projectId}|${decodeURIComponent(target[1])}|${target[2] === "comments" ? "comment" : "instruction"}`
        clearAcceptedDraft(acceptedDraft, acceptedText)
      }
      const forwarding = pendingWrites.current.get(key)?.approval && result && typeof result === "object" && "deliveryState" in result ? String(result.deliveryState) : undefined
      if (label !== "Shared Session" && (!forwarding || forwarding === "delivered")) forgetPending(key)
      setFailed(previous => previous?.key === key ? undefined : previous)
      setNotice(forwarding ? `Tool decision saved. Forwarding: ${forwarding}.` : `${label} accepted by the service. Execution and source use are recorded separately.`)
      if (options.refresh !== false) setRefresh(value => value + 1)
      return result
    } catch (reason) {
      if (token !== epoch.current) return undefined
      if (typeof action.body.requestId === "string" && confirmedInstructions.current.has(action.body.requestId)) {
        setNotice("The matching instruction is recorded by the service.")
        return { reconciled: true }
      }
      setFailed({ key, action, label, error: errorMessage(reason) })
      setError(errorMessage(reason))
      return undefined
    } finally { if (token === epoch.current) { busyRef.current = ""; setBusy("") } }
  }
  async function act(key: string, path: string, body: Record<string, unknown>, label: string, method: "POST" | "PUT" = "POST", identityField: "requestId" | "decisionId" | "none" = "requestId", actionProject = live?.projectId || projectId, options: { refresh?: boolean } = {}) {
    if (!connection?.actorId || !actionProject || busyRef.current) return undefined
    const scopedKey = `${connectionKey}|${actionProject}|${key}`
    const action = prepareLiveAction({ actorId: connection.actorId, projectId: actionProject, path, method, body, identityField }, attempts.current.get(scopedKey))
    const previous = attempts.current.get(scopedKey)
    if (previous && previous !== action) {
      const saved = pendingWrites.current.get(scopedKey)
      const message = "An earlier request is still unconfirmed. Retry that request or explicitly start a new one before sending edited content."
      setFailed({ key: scopedKey, action: previous, label: saved?.label ?? label, error: message }); setError(message)
      return undefined
    }
    if (typeof action.body.requestId === "string") confirmedInstructions.current.delete(action.body.requestId)
    attempts.current.set(scopedKey, action)
    pendingWrites.current.set(scopedKey, { key: scopedKey, action, label, provision: provisionTasks.current.get(scopedKey) })
    if (!persistPending()) return undefined
    return execute(action, scopedKey, label, options)
  }

  async function sendDraft() {
    if (!active || !draft.trim() || (mode === "instruction" && !canInstruct)) return
    const text = draft.trim(), key = draftKey
    const result = await act(`${active.id}:${mode}`, `${threadPath(active.id)}/${mode === "instruction" ? "instructions" : "comments"}`, mode === "instruction" ? { text } : { body: text }, mode === "instruction" ? "Instruction" : "Comment")
    if (result !== undefined) setDrafts(previous => previous[key] === text || previous[key]?.trim() === text ? { ...previous, [key]: "" } : previous)
  }
  async function createSession(choice: "independent" | "complementary" | "alternative" = "independent", related?: LiveSession) {
    if (!live || !connection?.actorId || !share || !draft.trim()) return
    const text = draft.trim(), draftAtStart = draftKey
    const task = related ? `${choice === "complementary" ? "Review compatibility and edge cases as a complementary task" : "Explore an independent alternative approach"} for: ${text}\n\nPossibly related shared session: ${related.id} (${related.title}). This relationship is a suggestion from shared task text, not a Flower verdict. Preserve the original session and its approach.` : text
    const title = sessionTitle.trim() || `${choice === "independent" ? "" : `${choice}: `}${text.split("\n")[0]}`.slice(0, 120)
    const key = `provision:${text}:${choice}`
    const scopedKey = `${connectionKey}|${live.projectId}|${key}`
    const existing = pendingWrites.current.get(scopedKey)
    try {
      const continuation = preserveProvisionContinuation(existing?.provision ?? provisionTasks.current.get(scopedKey), { task, draftKey: draftAtStart, draftText: text })
      provisionTasks.current.set(scopedKey, continuation)
    } catch (reason) {
      if (existing) setFailed({ key: scopedKey, action: existing.action, label: existing.label, error: errorMessage(reason) })
      setError(errorMessage(reason))
      return
    }
    const result = await act(key, `/projects/${encodeURIComponent(live.projectId)}/sessions`, { title }, "Shared Session", "POST", "requestId", live.projectId, { refresh: false }) as ProvisionedSession | undefined
    if (result) await startProvisionedSession(result, scopedKey)
  }
  async function startProvisionedSession(result: ProvisionedSession, key: string) {
    const pending = pendingWrites.current.get(key)?.provision ?? provisionTasks.current.get(key)
    if (!pending || !live || !connection?.actorId) return
    if (!result.thread?.id || result.thread.sessionId !== result.sessionId || result.ownerUserId !== connection.actorId) {
      setError("The service returned an inconsistent Session identity; no instruction was sent.")
      setRefresh(value => value + 1)
      return
    }
    const instructionDraftKey = `${connectionKey}|${live.projectId}|${result.thread.id}|instruction`
    if (pending.draftText) clearAcceptedDraft(pending.draftKey, pending.draftText)
    setDrafts(previous => ({ ...previous, [instructionDraftKey]: pending.task }))
    provisionTasks.current.delete(key)
    setSelected(result.thread.id); setView("chat"); setMode("instruction"); setShare(false)
    const initial = act(`${result.thread.id}:instruction`, `${threadPath(result.thread.id)}/instructions`, { text: pending.task }, "Initial instruction")
    forgetPending(key)
    await initial
    setRefresh(value => value + 1)
  }
  async function retryFailed() {
    if (!failed || busyRef.current) return
    const remembered = failed
    const result = await execute(remembered.action, remembered.key, remembered.label, { refresh: remembered.label !== "Shared Session" })
    if (result !== undefined && remembered.label === "Shared Session") await startProvisionedSession(result as ProvisionedSession, remembered.key)
  }
  async function createProject(event: React.FormEvent) {
    event.preventDefault()
    if (!newProject.projectId || !newProject.name.trim()) return
    const result = await act("create-project", "/projects", { projectId: newProject.projectId, name: newProject.name.trim() }, "Shared project", "POST", "requestId", newProject.projectId)
    if (result !== undefined) changeProject(newProject.projectId)
  }
  async function saveBrief(event: React.FormEvent) {
    event.preventDefault()
    if (!live) return
    const criteria = settings.criteria.split("\n").map(line => line.trim()).filter(Boolean)
    if (!settings.goal.trim() || criteria.length < 1 || criteria.length > 10) { setError("Add a goal and between one and ten success criteria."); return }
    const result = await act("brief", `/projects/${encodeURIComponent(live.projectId)}/brief`, { expectedVersion: settings.expectedVersion, content: { goal: settings.goal.trim(), successCriteria: criteria, roles: live.brief?.roles ?? [], tools: live.brief?.tools ?? [], sharingDefault: "private", suggestedAwarenessMode: "off" } }, "Project brief", "PUT")
    if (result !== undefined) setView("overview")
  }
  async function saveFocus(event: React.FormEvent) {
    event.preventDefault()
    if (!live) return
    const result = await act("focus", `/projects/${encodeURIComponent(live.projectId)}/focus/me`, { expectedVersion: focusVersion, text: focusDraft.trim() || null }, "Personal focus", "PUT")
    if (result !== undefined) setFocusEditing(false)
  }
  function editCooperation() {
    if (!cooperation || !active || cooperation.threadId !== active.id || !canInstruct || cooperation.ownerId && cooperation.ownerId !== connection?.actorId) return
    setCooperationDraft({ threadId: active.id, expectedVersion: cooperation.version, featureTopic: cooperation.featureTopic, relationship: cooperation.relationship, analysisEnabled: cooperation.analysisEnabled, analysisTextEnabled: cooperation.analysisTextEnabled === true, awarenessMode: cooperation.awarenessMode })
  }
  async function saveCooperation(event: React.FormEvent) {
    event.preventDefault()
    if (!active || !canInstruct || cooperationDraft?.threadId !== active.id) return
    try {
      const { threadId, ...input } = cooperationDraft
      const result = await act(`cooperation:${threadId}`, `${threadPath(threadId)}/cooperation`, cooperationWrite(input), "Cooperation settings", "PUT")
      if (result !== undefined) setCooperationDraft(undefined)
    } catch (reason) { setError(errorMessage(reason)) }
  }

  async function cancelRun() {
    if (!active || !currentRun || !canInstruct) return
    await act(`cancel:${currentRun.instructionId}`, `${threadPath(active.id)}/instructions/${encodeURIComponent(currentRun.instructionId)}/cancel`, {}, "Cancellation request", "POST", "none")
  }
  async function decideTool(approval: Approval, decision: "approve" | "reject") {
    if (!active || !canInstruct || !connection?.actorId || busyRef.current) return
    const key = `${identity}|${active.id}|${approval.id}:${decision}`
    const remembered = approvalAttempts.current.get(key)
    if (remembered) { await execute(remembered, key, decision === "approve" ? "Tool approval" : "Tool rejection"); return }
    const reviewed = toolReviewForApproval(approval, active.sessionId)
    const fingerprint = reviewed ? toolReviewFingerprint(reviewed) : ""
    if (decision === "approve" && (!reviewed || reviewedTools[approval.id]?.version !== approval.version || reviewedTools[approval.id]?.fingerprint !== fingerprint)) {
      setError("Review the complete current tool request before allowing it.")
      return
    }
    const token = epoch.current
    busyRef.current = key
    setBusy(key); setError("")
    try {
      const authenticated = await readConnection(scopeController.current?.signal)
      if (token !== epoch.current) return
      if (!matchesConnectionScope(authenticated, connection)) { adoptConnection(authenticated); return }
      const claimed = await coordinationRequest<Approval>(`${threadPath(active.id)}/approvals/${encodeURIComponent(approval.id)}/claim`, { method: "POST", body: { expectedVersion: approval.version }, signal: scopeController.current?.signal, expectedActorId: connection.actorId })
      if (token !== epoch.current) return
      if (claimed.id !== approval.id || claimed.threadId !== active.id || claimed.toolCallId !== approval.toolCallId || claimed.claimedBy !== connection.actorId || claimed.state !== "claimed") throw new Error("The service returned an inconsistent tool claim")
      if (decision === "approve") {
        const current = await coordinationRequest<ThreadSnapshot>(threadPath(active.id), { signal: scopeController.current?.signal })
        if (token !== epoch.current) return
        const currentApproval = current.approvals.find(item => item.id === approval.id)
        const currentReview = currentApproval && toolReviewForApproval(currentApproval, active.sessionId)
        if (current.thread.id !== active.id || current.thread.sessionId !== active.sessionId || currentApproval?.version !== claimed.version || currentApproval.claimedBy !== connection.actorId || currentApproval.state !== "claimed" || !currentReview || toolReviewFingerprint(currentReview) !== fingerprint) throw new Error("The tool permission scope changed after review. Reload and review the current request.")
      }
      const action = prepareLiveAction({ actorId: connection.actorId, projectId: live!.projectId, path: `${threadPath(active.id)}/approvals/${encodeURIComponent(approval.id)}/decision`, body: { expectedVersion: claimed.version, decision }, identityField: "decisionId" })
      approvalAttempts.current.set(key, action)
      pendingWrites.current.set(key, { key, action, label: decision === "approve" ? "Tool approval" : "Tool rejection", approval: true })
      if (!persistPending()) return
      await execute(action, key, decision === "approve" ? "Tool approval" : "Tool rejection", { held: true })
    } catch (reason) { if (token === epoch.current) { setError(errorMessage(reason)); setRefresh(value => value + 1) } }
    finally { if (token === epoch.current) { busyRef.current = ""; setBusy("") } }
  }
  async function inspect(ref: EvidenceRef) {
    if (!live) return
    sourceOpener.current = document.activeElement as HTMLElement
    sourceController.current?.abort()
    const controller = new AbortController(), token = ++sourceEpoch.current
    sourceController.current = controller
    setSource({ ref, loading: true }); setSourceReviewed(false)
    try {
      const event = await readLiveSource(live.projectId, ref, controller.signal)
      if (token === sourceEpoch.current && !controller.signal.aborted) setSource({ ref, event, loading: false })
    } catch (reason) { if (token === sourceEpoch.current && !controller.signal.aborted) setSource({ ref, loading: false, error: errorMessage(reason) }) }
  }
  async function sendContext() {
    if (!source?.event || !live || !active || !canInstruct || !sourceReviewed) return
    try {
      const text = reviewedContextText(live.projectId, active.id, source.event)
      const result = await act(`context:${active.id}:${source.event.id}:${source.event.seq}`, `${threadPath(active.id)}/instructions`, { text }, "Reviewed context instruction")
      if (result !== undefined) closeSource()
    } catch (reason) { setError(errorMessage(reason)) }
  }

  const connected = connection?.connected === true
  const showConnection = !connected || view === "connection"
  const actorName = displayActor(connection)
  const activeCooperation = cooperation?.threadId === active?.id ? cooperation : undefined
  const editingCooperation = cooperationDraft?.threadId === active?.id ? cooperationDraft : undefined
  const personWorkSummaries = Object.fromEntries((live?.workspace.project.members ?? []).map(member => {
    const sessions = live?.workspace.sessions.filter(session => session.owner === member.name) ?? []
    const reports = sessions.map(session => {
      const task = session.freshness === "missing" ? sessionTaskPreview(session.task) : session.task
      return `${session.title}: ${task}${task.endsWith(".") || task.endsWith("…") ? "" : "."} ${session.freshness === "missing" ? "No summary yet." : `${session.summary} (summary ${session.freshness}).`}`
    })
    return [member.name, reports.join(" ") || "No shared Session work is recorded."]
  }))
  const sharedContextSources = (live?.workspace.sessions ?? []).filter(session => session.id !== active?.id).flatMap(session => {
    const context = sessionContextSource(live!.projectId, session)
    return context ? [{ session, context }] : []
  }).slice(0, 4)
  const sessionLabels = Object.fromEntries((live?.workspace.sessions ?? []).map(session => [session.id, runLabel(session)]))
  const sessionDetails = Object.fromEntries((live?.workspace.sessions ?? []).map(session => [session.id, `${session.ownership === "owner" ? "Owner" : "Shared by"}: ${session.owner === "You" ? actorName : session.owner} · ${session.sessionId} · Summary ${session.freshness}`]))

  return <div className="shell workflow-shell live-shell">
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="brand"><img className="workflow-brand-logo" src="/puff-logo.png" alt="" /><span>Puff</span><span className="brand-tag">collaborative</span></div>
      {connected && <label className="live-project-picker"><span>Project</span><select aria-label="Project" value={projectId || live?.projectId || ""} onChange={event => changeProject(event.target.value)}><option value="" disabled>Choose a shared project</option>{live?.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
      <button className={`nav-button ${view === "overview" ? "active" : ""}`} disabled={!connected} onClick={() => { closeSource(); setView("overview"); setSidebarOpen(false) }}>▦ <span>Project overview</span></button>
      <button className="nav-button" disabled={!live?.projectId} onClick={openNew}>＋ <span>New session</span></button>
      <button className="nav-button" disabled={!connected} onClick={() => { setView("project"); setSidebarOpen(false) }}>＋ <span>Set up project</span></button>
      <input className="session-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search sessions…" aria-label="Search shared sessions" disabled={!live} />
      <div className="session-list workflow-session-list">
        <div className="sidebar-heading"><span>SHARED PROJECT WORK</span><span>{filtered.length}</span></div>
        {live?.workspace.project.members.map(member => <section className="workflow-sidebar-person" key={member.name}><div className="workflow-sidebar-owner"><span className={`avatar ${member.color}`}>{member.initials}</span>{member.name === "You" ? `${actorName} (you)` : member.name}</div><p className="workflow-sidebar-total" title={personWorkSummaries[member.name]}>{personWorkSummaries[member.name]}</p><small className="live-person-focus">Stated focus: {member.focus}</small>{filtered.filter(session => session.owner === member.name).map(session => <button className={`session-item ${selected === session.id && view === "chat" ? "active" : ""}`} key={session.id} title={sessionDetails[session.id]} onClick={() => openSession(session.id)}><i className={`status-dot ${session.status}`} /><span className="session-item-content"><span className="session-item-title">{session.title}</span><span className="workflow-sidebar-session-summary" title={session.summary}>{session.summary}</span><span className="session-item-meta">{runLabel(session)} · {session.freshness}</span></span></button>)}</section>)}
        {connected && !filtered.length && <p className="workflow-sidebar-empty">No shared sessions in this view.</p>}
      </div>
      <div className="sidebar-footer"><span className="avatar green">{actorName.slice(0, 1)}</span><div><strong>{connected ? actorName : "Not connected"}</strong><small>{connected ? "Authenticated member" : "Live workspace"}</small></div><button className="icon-button" aria-label="Connection settings" onClick={() => { setView("connection"); setConnectionForm(previous => ({ ...previous, url: connection?.url ?? previous.url, username: connection?.username ?? previous.username })) }}>⚙</button></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Toggle sidebar" onClick={() => setSidebarOpen(value => !value)}>☰</button><span>{live?.workspace.project.name || "Puff workspace"}</span><span>/</span><strong>{view === "chat" ? "Session" : view === "new" ? "New session" : showConnection ? "Connection" : "Overview"}</strong></div><div className="topbar-actions"><span className="live-state-label">{connected ? loadError ? "Connection needs attention" : "Live service" : "Not connected"}</span><button className="invite-button" onClick={props.onTryDemo}>Try demo</button></div></header>
      {(error || loadError || notice) && <div className={`live-notice ${error || loadError ? "is-error" : ""}`} role={error || loadError ? "alert" : "status"}>{error || loadError || notice}{loadError && live && <small>Last observed data is shown. New activity could not be loaded.</small>}{failed && <div className="live-retry"><button disabled={Boolean(busy)} onClick={retryFailed}>Retry exact {failed.label.toLowerCase()}</button><span>Original request and captured version are retained.</span><button onClick={startNewRequest} disabled={Boolean(busy)}>Start a new request</button></div>}{failed && error && <button className="live-link" onClick={() => { setFailed(undefined); setError(""); setFocusEditing(false); setView("overview"); setRefresh(value => value + 1) }}>Review current state</button>}</div>}
      <section className="content workflow-content" ref={content} onScroll={() => { if (view === "chat" && selected && content.current) scrollPositions.current.set(`${identity}|${selected}`, content.current.scrollTop) }}>
        {connection === undefined && <div className="live-empty"><img src="/puff-logo.png" alt="" /><h1>Opening your workspace</h1><p>Checking the local connection…</p></div>}
        {connection !== undefined && showConnection && <form className="workflow-setup live-form" onSubmit={connect}><div className="eyebrow">LIVE WORKSPACE</div><h1>{connected ? "Connection settings" : "Connect to your team"}</h1><p className="workflow-setup-intro">Use a configured local Puff backend and your individual member account. Credentials stay in the server-managed connection.</p><label className="field">Backend URL<input required type="url" value={connectionForm.url} onChange={event => setConnectionForm(previous => ({ ...previous, url: event.target.value }))} placeholder="http://127.0.0.1:4096" /></label><label className="field">Member username<input required autoComplete="username" value={connectionForm.username} onChange={event => setConnectionForm(previous => ({ ...previous, username: event.target.value }))} /></label><label className="field">Password<input required type="password" autoComplete="current-password" value={connectionForm.password} onChange={event => setConnectionForm(previous => ({ ...previous, password: event.target.value }))} /></label><div className="workflow-setup-actions"><button className="workflow-primary-button" disabled={Boolean(busy)}>{busy === "connect" ? "Connecting…" : "Connect"}</button>{connected && <button type="button" className="workflow-secondary-button" disabled={Boolean(busy)} onClick={disconnect}>Disconnect</button>}</div>{connected && <button type="button" className="live-link" onClick={() => setView("overview")}>Back to workspace</button>}</form>}
        {connected && !showConnection && view === "project" && <form className="workflow-setup live-form" onSubmit={createProject}><div className="eyebrow">PROJECT SETUP</div><h1>Share a coding project</h1><p className="workflow-setup-intro">Choose a project authorized for your account. Team identities come from the configured roster.</p><label className="field">Coding project<select required value={newProject.projectId} onChange={event => { const project = provisioning.projects.find(item => item.projectId === event.target.value); setNewProject({ projectId: event.target.value, name: project?.name ?? "" }) }}><option value="">Choose a project</option>{provisioning.projects.map(project => <option key={project.projectId} value={project.projectId}>{project.name}{project.modelReady ? "" : " (model unavailable)"}</option>)}</select></label><label className="field">Shared project name<input required value={newProject.name} onChange={event => setNewProject(previous => ({ ...previous, name: event.target.value }))} /></label>{!provisioning.projects.length && <p>No authorized coding project is configured. Ask the workspace coordinator to provision one.</p>}<div className="workflow-setup-actions"><button type="button" className="workflow-secondary-button" onClick={() => setView("overview")}>Back</button><button className="workflow-primary-button" disabled={Boolean(busy) || !newProject.projectId}>Create shared project</button></div></form>}
        {connected && !showConnection && (!live || !live.projectId) && view !== "project" && <div className="live-empty"><img src="/puff-logo.png" alt="" /><h1>Your live workspace</h1><p>{loadError || (live ? "No shared project is set up for this account yet." : "Loading authorized projects and shared sessions…")}</p><button className="workflow-primary-button" onClick={() => setView("project")}>Set up a project</button></div>}
        {live?.projectId && !showConnection && view === "overview" && <><ProjectOverview mode="live" actorName={actorName} project={live.workspace.project} sessions={live.workspace.sessions} sessionLabels={sessionLabels} sessionDetails={sessionDetails} personWorkSummaries={personWorkSummaries} onOpenSession={openSession} onNewSession={openNew} onSetup={openSettings} onStartScenario={() => {}} /><form className="live-focus-form" onSubmit={saveFocus}><label>Your stated focus{focusEditing ? <input aria-label="Your focus" value={focusDraft} maxLength={2000} onChange={event => setFocusDraft(event.target.value)} /> : <span>{ownFocus?.text || "No personal focus saved."}</span>}</label>{focusEditing ? <><button disabled={Boolean(busy)}>Save focus</button><button type="button" onClick={() => setFocusEditing(false)}>Cancel</button></> : <button type="button" onClick={() => { setFocusDraft(ownFocus?.text ?? ""); setFocusVersion(ownFocus?.version ?? 0); setFocusEditing(true) }}>Edit my focus</button>}</form></>}
        {live?.projectId && !showConnection && view === "settings" && <form className="workflow-setup live-form" onSubmit={saveBrief}><div className="eyebrow">VERSIONED PROJECT BRIEF</div><h1>Project settings</h1><label className="field">Goal<textarea required value={settings.goal} onChange={event => setSettings(previous => ({ ...previous, goal: event.target.value }))} /></label><label className="field">Success criteria · one per line<textarea required value={settings.criteria} onChange={event => setSettings(previous => ({ ...previous, criteria: event.target.value }))} /></label><p className="workflow-setup-intro">The project sharing default is private. This interface creates Sessions only after you explicitly select sharing. Awareness remains off.</p><div className="workflow-setup-actions"><button type="button" className="workflow-secondary-button" onClick={() => setView("overview")}>Back</button><button className="workflow-primary-button" disabled={Boolean(busy)}>Save brief</button></div></form>}
        {live?.projectId && !showConnection && view === "new" && <div className="live-new-session"><img className="workflow-welcome-logo" src="/puff-logo.png" alt="" /><div className="eyebrow">YOUR SEPARATE CODING SESSION</div><h1>What will you work on?</h1><p>Create an isolated workspace for {actorName}. Your other conversations continue separately.</p><label className="field">Session title<input value={sessionTitle} onChange={event => setSessionTitle(event.target.value)} placeholder="Use the first line of the task" maxLength={120} /></label><label className="live-share-consent"><input type="checkbox" checked={share} onChange={event => setShare(event.target.checked)} /><span>I select this Session for sharing with this project. Its selected activity will be visible to project members.</span></label><small>Private Session provisioning is unavailable here. Leave this unchecked to keep the task as a draft.</small>{possiblyRelatedWork(draft, live.workspace.sessions).map(match => { const related = live.workspace.sessions.find(item => item.id === match.id)!; return <article className="live-related" key={match.id}><div className="eyebrow">POSSIBLY RELATED · TASK TEXT</div><h3>{match.title}</h3><p>{match.summary}</p><small>{sessionDetails[match.id]}</small><div><button onClick={() => openSession(match.id)}>Open existing session</button><button disabled={!share || Boolean(busy)} onClick={() => createSession("complementary", related)}>Create complementary task</button><button disabled={!share || Boolean(busy)} onClick={() => createSession("alternative", related)}>Explore another approach</button></div></article> })}</div>}
        {live && !showConnection && view === "chat" && active && <div className="workflow-chat"><header className="workflow-chat-heading"><div className="eyebrow">{active.ownership === "owner" ? "OWNER" : "SHARED BY"} · {active.owner === "You" ? actorName : active.owner}</div><h1>{active.title}</h1><p>{runLabel(active)} · Summary {active.freshness}</p><details className="live-session-identity"><summary>Session identity</summary><dl><dt>Session</dt><dd>{active.sessionId}</dd><dt>Worker</dt><dd>{active.workerId}</dd><dt>Thread</dt><dd>{active.id}</dd><dt>Sharing member</dt><dd>{active.sharedBy}</dd></dl></details>{currentRun && <div className="live-run"><span>Run {currentRun.id} · {currentRun.state.replaceAll("_", " ")}</span><button disabled={!canInstruct || Boolean(busy) || currentRun.state === "cancelling"} onClick={cancelRun}>Request cancellation</button></div>}</header><section className="live-cooperation" aria-label="Session cooperation settings"><header><strong>Session cooperation</strong>{activeCooperation && <span>{activeCooperation.analysisEnabled ? "Analysis selected" : "Analysis off"} · {activeCooperation.analysisTextEnabled ? "instruction/output text selected" : "instruction/output text excluded"} · {activeCooperation.relationship}</span>}</header>{cooperationError && <p role="alert">{cooperationError}</p>}{!activeCooperation && !cooperationError && <p>Loading saved settings…</p>}{activeCooperation && !editingCooperation && <><p>Feature topic: {activeCooperation.featureTopic || "Not selected"} · Awareness: {activeCooperation.awarenessMode}</p><small>Selection does not establish that Flower is configured or running. Findings are informational; work redirection requires your approval.</small>{canInstruct && (!activeCooperation.ownerId || activeCooperation.ownerId === connection?.actorId) ? <button onClick={editCooperation}>Edit cooperation</button> : <small>Only this Session’s verified owner can change these settings.</small>}</>}{editingCooperation && <form onSubmit={saveCooperation}><label className="field">Feature topic<input value={editingCooperation.featureTopic} maxLength={80} onChange={event => setCooperationDraft({ ...editingCooperation, featureTopic: event.target.value })} placeholder="For example: project navigation" /></label><label className="field">Relationship<select value={editingCooperation.relationship} onChange={event => setCooperationDraft({ ...editingCooperation, relationship: event.target.value as CooperationInput["relationship"] })}><option value="open">Open to related work</option><option value="complementary">Complementary task</option><option value="alternative">Deliberate alternative approach</option></select></label><label className="live-share-consent"><input type="checkbox" checked={editingCooperation.analysisEnabled} onChange={event => setCooperationDraft({ ...editingCooperation, analysisEnabled: event.target.checked, analysisTextEnabled: event.target.checked ? editingCooperation.analysisTextEnabled === true : false, awarenessMode: event.target.checked ? editingCooperation.awarenessMode : "off" })} /><span>Allow Flower metadata analysis of this selected Session. Only bounded, redacted selected event metadata is sent to the configured hosted Flower service. Instruction and output text require the separate permission below.</span></label><label className="live-share-consent"><input type="checkbox" disabled={!editingCooperation.analysisEnabled} checked={editingCooperation.analysisTextEnabled === true} onChange={event => setCooperationDraft({ ...editingCooperation, analysisTextEnabled: event.target.checked })} /><span>Also permit bounded, redacted owner instruction and runner output text to be sent to the configured hosted Flower service for source-grounded reuse. Leave this off for metadata-only analysis.</span></label><label className="live-share-consent"><input type="checkbox" disabled={!editingCooperation.analysisEnabled} checked={editingCooperation.awarenessMode === "notify"} onChange={event => setCooperationDraft({ ...editingCooperation, awarenessMode: event.target.checked ? "notify" : "off" })} /><span>Show informational findings from related selected work. This does not authorize task redirection or tool use.</span></label><small>Analysis starts only when the Flower runtime is configured. Default: off.</small><div><button className="workflow-primary-button" disabled={Boolean(busy)}>Save cooperation</button><button type="button" onClick={() => setCooperationDraft(undefined)}>Cancel</button></div></form>}</section><div className="workflow-messages">{active.messages.map((message, index) => <article className={`workflow-message ${message.role}`} key={message.eventId ?? `${message.instructionId ?? "record"}:${index}`}><strong>{message.role === "assistant" ? "Agent output" : message.kind === "comment.created" ? `Comment · ${message.actorId ?? "Member"}` : `Instruction · ${message.actorId ?? "Member"}`}</strong><p>{message.text}</p>{message.eventId && message.seq !== undefined && <button className="live-link" onClick={() => inspect({ threadId: active.id, eventId: message.eventId!, seq: message.seq! })}>Inspect source · {message.kind}</button>}</article>)}{!active.messages.length && <p className="live-empty-transcript">No conversation output is recorded yet. The agent’s recorded output will appear here.</p>}</div>{active.sourceEvents.filter(event => ["run.failed", "run.recovery.required"].includes(event.kind)).slice(-3).map(event => <div className="live-notice is-error" key={event.id}><strong>{event.kind.replaceAll(".", " ")}</strong><p>{sourceEventText(event) || "The service did not report further details."}</p></div>)}{snapshot?.approvals.map(approval => {
            const review = toolReviewForApproval(approval, active.sessionId)
            const fingerprint = review ? toolReviewFingerprint(review) : ""
            const checked = Boolean(review && reviewedTools[approval.id]?.version === approval.version && reviewedTools[approval.id]?.fingerprint === fingerprint)
            const decision = approval.decision ?? (approval.state === "approved" ? "approve" : "reject")
            return <article className="live-approval" key={approval.id}><strong>Permission request · {review?.permission ?? approval.toolCallId}</strong><p>{approval.state} · forwarding {approval.deliveryState}{approval.claimedBy && ` · claimed by ${approval.claimedBy}`}</p>{["pending", "claimed"].includes(approval.state) && <>{review ? <><p>{review.summary}</p><dl className="live-tool-details"><dt>Permission</dt><dd>{review.permission}</dd><dt>Requested resources</dt><dd>{review.patterns.join("\n") || "No resource patterns supplied"}</dd><dt>Saved permission patterns</dt><dd>{review.savePatterns.join("\n") || "None · Allow applies once"}</dd><dt>Source message</dt><dd>{review.sourceMessageId}</dd><dt>Permission request</dt><dd>{review.permissionRequestId}</dd></dl>{review.inputJson && <><h4>Tool arguments · {review.toolName}</h4><pre className="live-source-text">{review.inputJson}</pre></>}{review.metadataJson && <><h4>Permission metadata</h4><pre className="live-source-text">{review.metadataJson}</pre></>}{!review.inputJson && !review.metadataJson && <p>Tool arguments were not recorded for this permission request. Allow remains disabled.</p>}<label className="live-share-consent"><input type="checkbox" checked={checked} disabled={!canInstruct || Boolean(busy)} onChange={event => setReviewedTools(previous => ({ ...previous, [approval.id]: event.target.checked ? { version: approval.version, fingerprint } : { version: -1, fingerprint: "" } }))} /><span>I reviewed this tool’s recorded arguments, permission action and requested resources. Allow this request once.</span></label></> : <p>Complete tool arguments and permission scope are unavailable. Allow remains disabled.</p>}<button disabled={!canInstruct || !checked || Boolean(busy)} onClick={() => decideTool(approval, "approve")}>Allow tool once</button><button disabled={!canInstruct || Boolean(busy)} onClick={() => decideTool(approval, "reject")}>Reject tool request</button></>}{["approved", "rejected"].includes(approval.state) && ["pending", "failed"].includes(approval.deliveryState) && approvalAttempts.current.has(`${identity}|${active.id}|${approval.id}:${decision}`) && <button disabled={!canInstruct || Boolean(busy)} onClick={() => decideTool(approval, decision)}>Retry decision forwarding</button>}</article>
          })}{active.evidenceRefs.length > 0 && <div className="live-evidence"><h2>Summary sources · {active.freshness}</h2>{active.evidenceRefs.map(ref => <button key={`${ref.eventId}:${ref.seq}`} onClick={() => inspect(ref)}>{ref.eventId} @ {ref.seq} · Inspect</button>)}</div>}<section className="live-shared-sources"><h2>Project context to review</h2>{sharedContextSources.map(({ session, context }) => <article className="live-related" key={session.id}><div className="eyebrow">{context.kind === "summary_citation" ? "SUMMARY CITATION" : "RECORDED SOURCE · NO SUMMARY CITATION"}</div><h3>{session.title}</h3><p>{context.kind === "summary_citation" ? session.summary : `Recorded activity preview: ${sourceEventText(context.event).slice(0, 300)}`}</p><small>{sessionDetails[session.id]}{context.kind === "recorded_event" && ` · ${context.event.kind} · event ${context.ref.seq}`}</small><button onClick={() => inspect(context.ref)}>{context.kind === "summary_citation" ? "Inspect cited source" : "Inspect recorded source"}</button></article>)}{!sharedContextSources.length && <p>No other summary citations or reviewable recorded sources are available.</p>}</section></div>}
        {live && !showConnection && (view === "new" || view === "chat" && active) && <div className="composer-wrap workflow-composer-wrap live-composer"><div className="composer"><div className="composer-context">{live.workspace.project.name} / {view === "new" ? actorName : active?.owner === "You" ? actorName : active?.owner}</div>{view === "chat" && <div className="live-composer-mode"><label>Send as<select value={mode} onChange={event => setMode(event.target.value as "instruction" | "comment")}><option value="instruction" disabled={!canInstruct}>Instruction to coding agent</option><option value="comment">Shared comment</option></select></label>{!canInstruct && <small>This Session’s owner has not authorized instructions from this account. Comments remain separate from execution.</small>}</div>}<textarea aria-label={view === "new" ? "Task prompt" : "Session prompt"} rows={3} value={draft} onChange={event => updateDraft(event.target.value)} placeholder={view === "new" ? "Describe your coding task…" : mode === "comment" ? "Write a shared comment…" : "Give your coding Session an instruction…"} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy) void (view === "new" ? createSession() : sendDraft()) } }} /><div className="composer-toolbar"><span className="workflow-composer-note">{view === "new" ? "Creates your separate workspace" : mode === "comment" ? "Comments do not execute work" : "Durable instruction; execution may wait"}</span><button className="workflow-submit-session" disabled={!draft.trim() || Boolean(busy) || view === "new" && !share || view === "chat" && mode === "instruction" && !canInstruct} onClick={() => view === "new" ? createSession() : sendDraft()}>{busy ? "Sending…" : view === "new" ? "Start shared Session" : mode === "comment" ? "Post comment" : "Send instruction"} ↑</button></div></div><div className="keyboard-hint">Drafts stay with their Session. Enter to send · Shift + Enter for a new line.</div></div>}
      </section>
      {live && !showConnection && (view === "chat" || view === "new") && <section className={`workflow-dock ${dockOpen ? "" : "is-collapsed"}`} aria-label="Team work summaries"><div className="workflow-dock-header"><span>▦ Across this project · last service observation</span><button className="icon-button" aria-label={dockOpen ? "Collapse team summaries" : "Expand team summaries"} aria-expanded={dockOpen} onClick={() => setDockOpen(value => !value)}>⌄</button></div>{dockOpen && <div className="workflow-dock-people">{live.workspace.project.members.map(member => <article className="workflow-dock-person" key={member.name}><header><span className={`avatar ${member.color}`}>{member.initials}</span><strong>{member.name === "You" ? `${actorName} (you)` : member.name}</strong><span>{live.workspace.sessions.filter(session => session.owner === member.name).length} sessions</span></header><p className="workflow-dock-total" title={personWorkSummaries[member.name]}>{personWorkSummaries[member.name]}</p><small className="live-person-focus">Stated focus: {member.focus}</small><div className="workflow-dock-sessions">{live.workspace.sessions.filter(session => session.owner === member.name).map(session => <button className={active?.id === session.id ? "selected" : ""} key={session.id} onClick={() => openSession(session.id)} title={sessionDetails[session.id]}><span><i className={`status-dot ${session.status}`} />{session.title}<small>{runLabel(session)}</small></span><p>{session.summary}</p></button>)}</div></article>)}</div>}</section>}
    </main>
    {source && <div className="modal-backdrop" onClick={closeSource}><section ref={sourceDialog} className="modal workflow-modal workflow-source-modal" role="dialog" aria-modal="true" aria-labelledby="live-source-title" onClick={event => event.stopPropagation()}><div className="modal-header"><h2 id="live-source-title">Inspect exact source</h2><button className="icon-button" aria-label="Close source" onClick={closeSource}>×</button></div><p className="workflow-source-attribution">{source.ref.threadId} / {source.ref.eventId} @ {source.ref.seq}</p>{source.loading && <p role="status">Loading this exact event…</p>}{source.error && <p role="alert" className="workflow-form-error">Source unavailable: {source.error}</p>}{source.event && <><p>{source.event.kind} · {source.event.occurredAt}</p><pre className="live-source-text">{sourceEventText(source.event) || "No reviewable text is present in this event."}</pre><p className="workflow-setup-intro">Sending context submits a user instruction to the selected target. Admission, execution and actual use are separate records.</p><label className="live-share-consent"><input type="checkbox" checked={sourceReviewed} onChange={event => setSourceReviewed(event.target.checked)} /><span>I reviewed this source and want to send it to my current Session.</span></label>{failed?.label === "Reviewed context instruction" && <p className="workflow-form-error" role="alert">{failed.error}</p>}<button className="workflow-primary-button" disabled={!sourceReviewed || !canInstruct || Boolean(busy) || source.event.threadId === active?.id || !sourceEventText(source.event)} onClick={sendContext}>{failed?.label === "Reviewed context instruction" ? "Retry reviewed context" : "Send reviewed context"}</button>{!canInstruct && <p>Select a Session with verified ownership for this account to send context.</p>}</>}<button className="workflow-modal-cancel" onClick={closeSource}>Back to my Session</button></section></div>}
  </div>
}
