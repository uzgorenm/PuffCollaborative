"use client"

import { useEffect, useRef, useState } from "react"
import { ProjectOverview } from "./project-overview"
import { MessageContent } from "./message-content"
import { connectToBackend, coordinationRequest, disconnectBackend, readConnection } from "../lib/coordination-client"
import type { ConnectionState } from "../lib/coordination-client"
import { loadLiveWorkspace, readLiveSource } from "../lib/live-workspace"
import type {
  Approval,
  EvidenceRef,
  LiveSession,
  LiveWorkspace,
  SourceEvent,
  ThreadSnapshot,
} from "../lib/live-workspace"
import {
  possiblyRelatedWork,
  prepareLiveAction,
  reviewedContextText,
  sourceEventText,
  restorePendingActions,
  pendingActionsForScope,
  cooperationWrite,
  confirmedPendingInstruction,
  toolReviewForApproval,
  toolReviewFingerprint,
  preserveProvisionContinuation,
  matchesConnectionScope,
  sessionContextSource,
} from "../lib/live-actions"
import type { LiveAction, PendingLiveAction, CooperationInput } from "../lib/live-actions"
import "./live-workspace.css"

type Provisioning = { projects: { projectId: string; name: string; modelReady: boolean }[]; privateSessions: false }
type ProvisionedSession = { thread: { id: string; sessionId: string }; sessionId: string; ownerUserId: string }
type View = "overview" | "new" | "chat" | "settings" | "project" | "connection"
type Cooperation = Omit<CooperationInput, "expectedVersion"> & {
  threadId: string
  ownerId?: string
  sourceActivitySeq: number
  version: number
  updatedAt?: string
}
type FailedAction = { key: string; action: LiveAction; label: string; error: string }
const terminal = new Set(["completed", "failed", "cancelled"])
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "The request could not be completed")
const displayActor = (connection: ConnectionState | undefined) =>
  connection?.username ? connection.username[0].toUpperCase() + connection.username.slice(1) : "You"
const runLabel = (session: LiveSession) => session.execution.replaceAll("_", " ") || "No execution recorded"
const threadPath = (id: string) => `/threads/${encodeURIComponent(id)}`

export function LiveWorkspaceView() {
  const [connection, setConnection] = useState<ConnectionState>()
  const [connectionForm, setConnectionForm] = useState({
    url: "http://127.0.0.1:4096",
    username: "serdar",
    password: "",
  })
  const [live, setLive] = useState<LiveWorkspace>()
  const [provisioning, setProvisioning] = useState<Provisioning>({ projects: [], privateSessions: false })
  const [projectId, setProjectId] = useState("")
  const [view, setView] = useState<View>("overview")
  const [selected, setSelected] = useState<string>()
  const [openingThread, setOpeningThread] = useState<string>()
  const [query, setQuery] = useState("")
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [draftsReady, setDraftsReady] = useState(false)
  const [mode, setMode] = useState<"instruction" | "comment">("instruction")
  const [share, setShare] = useState(false)
  const [sessionTitle, setSessionTitle] = useState("")
  const [followTail, setFollowTail] = useState(true)
  const tail = useRef(true)
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
  const [dockOpen, setDockOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<"team" | "thread">("team")
  const [source, setSource] = useState<{ ref: EvidenceRef; event?: SourceEvent; loading: boolean; error?: string }>()
  const [sourceReviewed, setSourceReviewed] = useState(false)
  const [pendingVersion, setPendingVersion] = useState(0)
  const [cooperation, setCooperation] = useState<Cooperation>()
  const [cooperationError, setCooperationError] = useState("")
  const [reviewedTools, setReviewedTools] = useState<Record<string, { version: number; fingerprint: string }>>({})
  const [cooperationDraft, setCooperationDraft] = useState<CooperationInput & { threadId: string }>()
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
  const composerInput = useRef<HTMLTextAreaElement>(null)
  const navigationButton = useRef<HTMLButtonElement>(null)
  const activityButton = useRef<HTMLButtonElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const activity = useRef<HTMLElement>(null)
  const scrollPositions = useRef(new Map<string, number>())
  const sourceOpener = useRef<HTMLElement | null>(null)
  const sourceDialog = useRef<HTMLElement>(null)
  const ownFocus = live?.focus.find((item) => item.userId === connection?.actorId)
  const active = live?.workspace.sessions.find((session) => session.id === selected)
  const snapshot = active ? live?.snapshots[active.id] : undefined
  const identity = `${connection?.url ?? ""}|${connection?.actorId ?? ""}|${live?.projectId || projectId}`
  const draftKey = `${identity}|${view === "new" ? "new" : (selected ?? "none")}|${view === "new" ? "task" : mode}`
  const draft = drafts[draftKey] ?? ""
  const canInstruct = Boolean(active?.ownerId && active.ownerId === connection?.actorId)
  const currentRun =
    snapshot?.runs.find((run) => !terminal.has(run.state) && run.state !== "queued") ??
    snapshot?.runs.find((run) => run.state === "queued")
  const filtered =
    live?.workspace.sessions.filter((session) =>
      `${session.title} ${session.owner} ${session.summary}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? []
  const connectionKey = `${connection?.url ?? ""}|${connection?.actorId ?? ""}`

  useEffect(() => {
    restoreRoute()
    window.addEventListener("popstate", restoreRoute)
    return () => window.removeEventListener("popstate", restoreRoute)
  }, [])

  useEffect(() => {
    if (!active) return
    setMode(active.ownerId === connection?.actorId ? "instruction" : "comment")
    document.title = view === "chat" ? `${active.title} · Puff Collab` : "Puff Collab"
    return () => {
      document.title = "Puff Collab"
    }
  }, [selected, active?.ownerId, active?.title, connection?.actorId, view])

  useEffect(() => {
    if (openingThread && live?.workspace.sessions.some((session) => session.id === openingThread))
      setOpeningThread(undefined)
  }, [openingThread, live?.workspace.sessions])

  useEffect(() => {
    if (view !== "settings" || !live?.projectId) return
    setSettings({
      goal: live.brief?.goal ?? "",
      criteria: live.brief?.successCriteria.join("\n") ?? "",
      expectedVersion: live.brief?.version ?? 0,
    })
  }, [view, live?.projectId])

  useEffect(() => {
    const element = content.current
    if (!element || view !== "chat" || !tail.current) return
    element.scrollTop = element.scrollHeight
  }, [selected, active?.messages.length, active?.messages.at(-1)?.text, active?.sourceEvents.length, view])

  useEffect(() => {
    if (!sidebarOpen && !dockOpen) return
    const panel = sidebarOpen ? sidebar.current : activity.current
    const first = panel?.querySelector<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), select')
    if (sidebarOpen || window.matchMedia("(max-width: 1100px)").matches) first?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false)
        setDockOpen(false)
        ;(sidebarOpen ? navigationButton : activityButton).current?.focus()
      }
      if (event.key !== "Tab" || (!sidebarOpen && !window.matchMedia("(max-width: 1100px)").matches)) return
      const targets = Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
        ) ?? [],
      )
      const first = targets[0],
        last = targets.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener("keydown", keyboard)
    return () => window.removeEventListener("keydown", keyboard)
  }, [sidebarOpen, dockOpen])

  useEffect(() => {
    const controller = new AbortController()
    let ignore = false
    readConnection(controller.signal)
      .then((value) => {
        if (ignore) return
        setConnection(value)
        if (value.url) setConnectionForm((previous) => ({ ...previous, url: value.url ?? previous.url }))
      })
      .catch((reason) => {
        if (!ignore) {
          setConnection({ connected: false })
          setError(errorMessage(reason))
        }
      })
    return () => {
      ignore = true
      controller.abort()
    }
  }, [])

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("puff-live-drafts-v1") ?? "{}")
      if (saved && typeof saved === "object" && !Array.isArray(saved))
        setDrafts(
          Object.fromEntries(
            Object.entries(saved)
              .filter(([, value]) => typeof value === "string")
              .map(([key, value]) => [key, String(value)]),
          ),
        )
    } catch {
      /* Browser storage is optional; keep drafts in memory. */
    }
    try {
      restorePendingActions(sessionStorage.getItem("puff-live-pending-v1")).forEach((entry) => {
        pendingWrites.current.set(entry.key, entry)
        attempts.current.set(entry.key, entry.action)
        if (entry.approval) approvalAttempts.current.set(entry.key, entry.action)
        if (entry.provision) provisionTasks.current.set(entry.key, entry.provision)
      })
    } catch {
      /* Keep request identities in memory if browser storage is unavailable. */
    }
    setPendingVersion((value) => value + 1)
    setDraftsReady(true)
  }, [])
  useEffect(() => {
    if (!draftsReady) return
    try {
      localStorage.setItem("puff-live-drafts-v1", JSON.stringify(drafts))
    } catch {
      /* No transcripts or credentials are persisted. */
    }
  }, [drafts, draftsReady])

  useEffect(() => {
    if (!draftsReady || busyRef.current || failed) return
    const pending = pendingActionsForScope([...pendingWrites.current.values()], {
      url: connection?.url,
      actorId: connection?.actorId,
      projectId: live?.projectId || projectId,
    })[0]
    if (!pending) return
    const message =
      "The outcome of this saved request is unconfirmed. Retry retains its original identity and reviewed version."
    setFailed({ key: pending.key, action: pending.action, label: pending.label, error: message })
    setError(message)
  }, [connectionKey, live?.projectId, projectId, pendingVersion, draftsReady])

  useEffect(() => {
    const controller = new AbortController()
    scopeController.current = controller
    epoch.current += 1
    return () => {
      scopeController.current?.abort()
      epoch.current += 1
    }
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
      try {
        currentConnection = await readConnection(controller.signal)
      } catch (reason) {
        if (!disposed && !controller.signal.aborted && token === epoch.current) {
          setLoadError(errorMessage(reason))
          timer = setTimeout(poll, 3000)
        }
        return
      }
      if (disposed || controller.signal.aborted || token !== epoch.current) return
      if (!matchesConnectionScope(currentConnection, connection)) {
        adoptConnection(currentConnection)
        return
      }
      if (workspaceResult.status === "fulfilled" && workspaceResult.value.actorId !== currentConnection.actorId) {
        setLoadError("Activity was returned for a different authenticated account; it was discarded.")
        timer = setTimeout(poll, 3000)
        return
      }
      if (provisioningResult.status === "fulfilled") setProvisioning(provisioningResult.value)
      if (workspaceResult.status === "fulfilled") {
        const value = workspaceResult.value
        pendingActionsForScope([...pendingWrites.current.values()], {
          url: connection?.url,
          actorId: connection?.actorId,
          projectId: value.projectId,
        }).forEach((entry) => {
          const threadId = confirmedPendingInstruction(entry, value.snapshots)
          if (threadId) {
            confirmedInstructions.current.add(String(entry.action.body.requestId))
            clearAcceptedDraft(
              `${connectionKey}|${value.projectId}|${threadId}|instruction`,
              String(entry.action.body.text),
            )
            forgetPending(entry.key)
            setFailed((previous) => (previous?.key === entry.key ? undefined : previous))
            setError("")
          }
          if (!entry.approval) return
          const approvalId = entry.action.path.match(/\/approvals\/([^/]+)\/decision$/)?.[1]
          const approval = Object.values(value.snapshots)
            .flatMap((snapshot) => snapshot.approvals)
            .find(
              (item) =>
                item.id === approvalId &&
                item.decisionId === entry.action.body.decisionId &&
                item.deliveryState === "delivered",
            )
          if (approval) {
            forgetPending(entry.key)
            setFailed((previous) => (previous?.key === entry.key ? undefined : previous))
            setError("")
          }
        })
        setLive(value)
        setLoadError("")
      } else setLoadError(errorMessage(workspaceResult.reason))
      timer = setTimeout(poll, 3000)
    }
    void poll()
    return () => {
      disposed = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [connectionKey, connection?.connected, projectId, refresh])

  useEffect(() => {
    setCooperation(undefined)
    setCooperationError("")
    if (!connection?.connected || !selected || view !== "chat") return
    const controller = new AbortController(),
      token = epoch.current
    let timer: ReturnType<typeof setTimeout>
    async function pollCooperation() {
      try {
        const value = await coordinationRequest<Cooperation>(`${threadPath(selected!)}/cooperation`, {
          signal: controller.signal,
        })
        if (controller.signal.aborted || token !== epoch.current) return
        if (
          value.threadId !== selected ||
          !Number.isSafeInteger(value.version) ||
          value.version < 0 ||
          !Number.isSafeInteger(value.sourceActivitySeq) ||
          value.sourceActivitySeq < 0 ||
          typeof value.featureTopic !== "string" ||
          typeof value.analysisEnabled !== "boolean" ||
          (value.analysisTextEnabled !== undefined && typeof value.analysisTextEnabled !== "boolean") ||
          !["open", "complementary", "alternative"].includes(value.relationship) ||
          !["off", "notify"].includes(value.awarenessMode) ||
          (!value.analysisEnabled && (value.awarenessMode !== "off" || value.analysisTextEnabled === true))
        )
          throw new Error("The service returned inconsistent cooperation settings")
        setCooperation({ ...value, analysisTextEnabled: value.analysisTextEnabled === true })
        setCooperationError("")
      } catch (reason) {
        if (!controller.signal.aborted && token === epoch.current) setCooperationError(errorMessage(reason))
      }
      if (!controller.signal.aborted && token === epoch.current) timer = setTimeout(pollCooperation, 3000)
    }
    void pollCooperation()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [connectionKey, connection?.connected, projectId, selected, view, refresh])

  useEffect(() => {
    if (!content.current || view !== "chat") return
    const saved = scrollPositions.current.get(`${identity}|${selected}`)
    tail.current = saved === undefined
    setFollowTail(tail.current)
    content.current.scrollTop = saved ?? content.current.scrollHeight
  }, [selected, identity, view])

  useEffect(() => {
    if (!source) return
    sourceDialog.current?.querySelector<HTMLButtonElement>("button")?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeSource()
      }
      if (event.key !== "Tab") return
      const targets = Array.from(
        sourceDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, [tabindex="0"]') ??
          [],
      )
      const first = targets[0],
        last = targets.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener("keydown", keyboard)
    return () => window.removeEventListener("keydown", keyboard)
  }, [source?.ref.eventId])
  useEffect(() => () => sourceController.current?.abort(), [])

  function restoreRoute() {
    const params = new URLSearchParams(window.location.search)
    const project = params.get("project") ?? ""
    const thread = params.get("thread") ?? undefined
    const page = params.get("view")
    if ((project && !/^[A-Za-z0-9_-]+$/.test(project)) || (thread && !/^[A-Za-z0-9_-]+$/.test(thread))) return
    closeSource()
    setProjectId(project)
    setSelected(thread)
    setView(
      thread
        ? "chat"
        : page && ["new", "settings", "project", "connection"].includes(page)
          ? (page as View)
          : "overview",
    )
    setSidebarOpen(false)
  }

  function updateDraft(text: string) {
    setDrafts((previous) => ({ ...previous, [draftKey]: text }))
  }
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
    setOpeningThread(undefined)
    setFocusEditing(false)
    setCooperationDraft(undefined)
  }
  function adoptConnection(next: ConnectionState) {
    invalidate()
    setConnection(next)
    setProjectId("")
    setView(next.connected ? "overview" : "connection")
    route(next.connected ? "overview" : "connection", undefined, "")
    setError(
      "The authenticated account changed. Previous responses were discarded and saved requests remain with their original account.",
    )
    setConnectionForm((previous) => ({
      ...previous,
      url: next.url ?? previous.url,
      username: next.username ?? previous.username,
      password: "",
    }))
  }
  function route(next: View, thread?: string, project = live?.projectId || projectId) {
    const params = new URLSearchParams()
    if (project) params.set("project", project)
    if (thread) params.set("thread", thread)
    if (next !== "overview" && next !== "chat") params.set("view", next)
    const url = params.size ? `/?${params}` : "/"
    if (window.location.pathname + window.location.search !== url) window.history.pushState(null, "", url)
  }
  function showView(next: View) {
    closeSource()
    setView(next)
    setSidebarOpen(false)
    route(next)
    setError("")
  }
  function changeProject(id: string) {
    invalidate()
    setRefresh((value) => value + 1)
    setProjectId(id)
    setView("overview")
    setShare(false)
    route("overview", undefined, id)
  }
  function openSession(id: string) {
    if (view === "chat" && content.current && selected)
      scrollPositions.current.set(`${identity}|${selected}`, content.current.scrollTop)
    closeSource()
    route("chat", id)
    tail.current = !scrollPositions.current.has(`${identity}|${id}`)
    setSelected(id)
    setCooperationDraft(undefined)
    setView("chat")
    setSidebarOpen(false)
    setError("")
    const session = live?.workspace.sessions.find((item) => item.id === id)
    if (!session?.ownerId || session.ownerId !== connection?.actorId) setMode("comment")
    else setMode("instruction")
  }
  function openNew() {
    showView("new")
    setShare(false)
    setSessionTitle("")
    requestAnimationFrame(() => composerInput.current?.focus())
  }
  function openSettings() {
    setSettings({
      goal: live?.brief?.goal ?? "",
      criteria: live?.brief?.successCriteria.join("\n") ?? "",
      expectedVersion: live?.brief?.version ?? 0,
    })
    showView("settings")
  }

  async function connect(event: React.FormEvent) {
    event.preventDefault()
    invalidate()
    setConnection({ connected: false })
    setBusy("connect")
    try {
      const next = await connectToBackend(connectionForm)
      setConnection(next)
      setConnectionForm((previous) => ({ ...previous, password: "" }))
      restoreRoute()
      if (new URLSearchParams(window.location.search).get("view") === "connection") showView("overview")
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy("")
    }
  }
  async function disconnect() {
    invalidate()
    setBusy("disconnect")
    try {
      await disconnectBackend()
      setConnection({ connected: false })
      setView("connection")
      route("connection", undefined, "")
    } catch (reason) {
      setError(errorMessage(reason))
      setRefresh((value) => value + 1)
    } finally {
      setBusy("")
    }
  }

  function persistPending() {
    try {
      sessionStorage.setItem("puff-live-pending-v1", JSON.stringify([...pendingWrites.current.values()]))
    } catch {
      setError("Could not save the request retry identity in this browser. The new request was not sent.")
      return false
    }
    setPendingVersion((value) => value + 1)
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
    setFailed(undefined)
    setError("")
    setNotice(
      "The previous request may still exist on the service. Review recorded activity before sending a new request.",
    )
  }
  function clearAcceptedDraft(key: string, text: string) {
    setDrafts((previous) => (previous[key]?.trim() === text.trim() ? { ...previous, [key]: "" } : previous))
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("puff-live-drafts-v1") ?? "{}")
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        const stored = saved as Record<string, unknown>
        if (typeof stored[key] === "string" && stored[key].trim() === text.trim()) {
          stored[key] = ""
          localStorage.setItem("puff-live-drafts-v1", JSON.stringify(stored))
        }
      }
    } catch {
      /* The in-memory draft still reflects the confirmed result. */
    }
  }

  async function execute(
    action: LiveAction,
    key: string,
    label: string,
    options: { refresh?: boolean; held?: boolean } = {},
  ) {
    if (
      loadError ||
      !key.startsWith(`${connectionKey}|${action.projectId}|`) ||
      action.actorId !== connection?.actorId ||
      !connection?.connected ||
      (!options.held && busyRef.current)
    )
      return undefined
    busyRef.current = key
    const token = epoch.current
    setBusy(key)
    setError("")
    setNotice("")
    try {
      const authenticated = await readConnection(scopeController.current?.signal)
      if (token !== epoch.current) return undefined
      if (!matchesConnectionScope(authenticated, { url: connection?.url, actorId: action.actorId })) {
        adoptConnection(authenticated)
        return undefined
      }
      const result = await coordinationRequest<unknown>(action.path, {
        method: action.method,
        body: action.body,
        signal: scopeController.current?.signal,
        expectedActorId: action.actorId,
      })
      if (token !== epoch.current) return undefined
      const target = action.path.match(/^\/threads\/([^/]+)\/(instructions|comments)$/)
      const acceptedText = target?.[2] === "comments" ? action.body.body : action.body.text
      if (target && typeof acceptedText === "string") {
        const acceptedDraft = `${connectionKey}|${action.projectId}|${decodeURIComponent(target[1])}|${target[2] === "comments" ? "comment" : "instruction"}`
        clearAcceptedDraft(acceptedDraft, acceptedText)
      }
      const forwarding =
        pendingWrites.current.get(key)?.approval && result && typeof result === "object" && "deliveryState" in result
          ? String(result.deliveryState)
          : undefined
      if (label !== "Shared Session" && (!forwarding || forwarding === "delivered")) forgetPending(key)
      setFailed((previous) => (previous?.key === key ? undefined : previous))
      setNotice(forwarding ? `Tool decision saved. Delivery: ${forwarding}.` : `${label} saved.`)
      if (options.refresh !== false) setRefresh((value) => value + 1)
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
    } finally {
      if (token === epoch.current) {
        busyRef.current = ""
        setBusy("")
      }
    }
  }
  async function act(
    key: string,
    path: string,
    body: Record<string, unknown>,
    label: string,
    method: "POST" | "PUT" = "POST",
    identityField: "requestId" | "decisionId" | "none" = "requestId",
    actionProject = live?.projectId || projectId,
    options: { refresh?: boolean } = {},
  ) {
    if (!connection?.actorId || !actionProject || busyRef.current) return undefined
    const scopedKey = `${connectionKey}|${actionProject}|${key}`
    const action = prepareLiveAction(
      { actorId: connection.actorId, projectId: actionProject, path, method, body, identityField },
      attempts.current.get(scopedKey),
    )
    const previous = attempts.current.get(scopedKey)
    if (previous && previous !== action) {
      const saved = pendingWrites.current.get(scopedKey)
      const message =
        "An earlier request is still unconfirmed. Retry that request or explicitly start a new one before sending edited content."
      setFailed({ key: scopedKey, action: previous, label: saved?.label ?? label, error: message })
      setError(message)
      return undefined
    }
    if (typeof action.body.requestId === "string") confirmedInstructions.current.delete(action.body.requestId)
    attempts.current.set(scopedKey, action)
    pendingWrites.current.set(scopedKey, {
      key: scopedKey,
      action,
      label,
      provision: provisionTasks.current.get(scopedKey),
    })
    if (!persistPending()) return undefined
    return execute(action, scopedKey, label, options)
  }

  async function sendDraft() {
    if (!active || !draft.trim() || (mode === "instruction" && !canInstruct)) return
    const text = draft.trim(),
      key = draftKey
    const result = await act(
      `${active.id}:${mode}`,
      `${threadPath(active.id)}/${mode === "instruction" ? "instructions" : "comments"}`,
      mode === "instruction" ? { text } : { body: text },
      mode === "instruction" ? "Instruction" : "Comment",
    )
    if (result !== undefined)
      setDrafts((previous) =>
        previous[key] === text || previous[key]?.trim() === text ? { ...previous, [key]: "" } : previous,
      )
  }
  async function createSession(
    choice: "independent" | "complementary" | "alternative" = "independent",
    related?: LiveSession,
  ) {
    if (!live || !connection?.actorId || !share || !draft.trim() || !modelReady) return
    const text = draft.trim(),
      draftAtStart = draftKey
    const task = related
      ? `${choice === "complementary" ? "Review compatibility and edge cases as a complementary task" : "Explore an independent alternative approach"} for: ${text}\n\nPossibly related shared session: ${related.id} (${related.title}). This relationship is a suggestion from shared task text, not an analysis verdict. Preserve the original session and its approach.`
      : text
    const title =
      sessionTitle.trim() || `${choice === "independent" ? "" : `${choice}: `}${text.split("\n")[0]}`.slice(0, 120)
    const key = `provision:${text}:${choice}`
    const scopedKey = `${connectionKey}|${live.projectId}|${key}`
    const existing = pendingWrites.current.get(scopedKey)
    try {
      const continuation = preserveProvisionContinuation(existing?.provision ?? provisionTasks.current.get(scopedKey), {
        task,
        draftKey: draftAtStart,
        draftText: text,
      })
      provisionTasks.current.set(scopedKey, continuation)
    } catch (reason) {
      if (existing)
        setFailed({ key: scopedKey, action: existing.action, label: existing.label, error: errorMessage(reason) })
      setError(errorMessage(reason))
      return
    }
    const result = (await act(
      key,
      `/projects/${encodeURIComponent(live.projectId)}/sessions`,
      { title },
      "Shared Session",
      "POST",
      "requestId",
      live.projectId,
      { refresh: false },
    )) as ProvisionedSession | undefined
    if (result) await startProvisionedSession(result, scopedKey)
  }
  async function startProvisionedSession(result: ProvisionedSession, key: string) {
    const pending = pendingWrites.current.get(key)?.provision ?? provisionTasks.current.get(key)
    if (!pending || !live || !connection?.actorId) return
    if (
      !result.thread?.id ||
      result.thread.sessionId !== result.sessionId ||
      result.ownerUserId !== connection.actorId
    ) {
      setError("The service returned an inconsistent Session identity; no instruction was sent.")
      setRefresh((value) => value + 1)
      return
    }
    const instructionDraftKey = `${connectionKey}|${live.projectId}|${result.thread.id}|instruction`
    if (pending.draftText) clearAcceptedDraft(pending.draftKey, pending.draftText)
    setDrafts((previous) => ({ ...previous, [instructionDraftKey]: pending.task }))
    provisionTasks.current.delete(key)
    route("chat", result.thread.id)
    tail.current = true
    setSelected(result.thread.id)
    setOpeningThread(result.thread.id)
    setView("chat")
    setMode("instruction")
    setShare(false)
    const initial = act(
      `${result.thread.id}:instruction`,
      `${threadPath(result.thread.id)}/instructions`,
      { text: pending.task },
      "Initial instruction",
    )
    forgetPending(key)
    await initial
    setRefresh((value) => value + 1)
  }
  async function retryFailed() {
    if (!failed || busyRef.current) return
    const remembered = failed
    const result = await execute(remembered.action, remembered.key, remembered.label, {
      refresh: remembered.label !== "Shared Session",
    })
    if (result !== undefined && remembered.label === "Shared Session")
      await startProvisionedSession(result as ProvisionedSession, remembered.key)
  }
  async function createProject(event: React.FormEvent) {
    event.preventDefault()
    if (!newProject.projectId || !newProject.name.trim()) return
    const result = await act(
      "create-project",
      "/projects",
      { projectId: newProject.projectId, name: newProject.name.trim() },
      "Shared project",
      "POST",
      "requestId",
      newProject.projectId,
    )
    if (result !== undefined) changeProject(newProject.projectId)
  }
  async function saveBrief(event: React.FormEvent) {
    event.preventDefault()
    if (!live) return
    const criteria = settings.criteria
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    if (!settings.goal.trim() || criteria.length < 1 || criteria.length > 10) {
      setError("Add a goal and between one and ten success criteria.")
      return
    }
    const result = await act(
      "brief",
      `/projects/${encodeURIComponent(live.projectId)}/brief`,
      {
        expectedVersion: settings.expectedVersion,
        content: {
          goal: settings.goal.trim(),
          successCriteria: criteria,
          roles: live.brief?.roles ?? [],
          tools: live.brief?.tools ?? [],
          sharingDefault: "private",
          suggestedAwarenessMode: "off",
        },
      },
      "Project brief",
      "PUT",
    )
    if (result !== undefined) showView("overview")
  }
  async function saveFocus(event: React.FormEvent) {
    event.preventDefault()
    if (!live) return
    const result = await act(
      "focus",
      `/projects/${encodeURIComponent(live.projectId)}/focus/me`,
      { expectedVersion: focusVersion, text: focusDraft.trim() || null },
      "Personal focus",
      "PUT",
    )
    if (result !== undefined) setFocusEditing(false)
  }
  function editCooperation() {
    if (
      !cooperation ||
      !active ||
      cooperation.threadId !== active.id ||
      !canInstruct ||
      (cooperation.ownerId && cooperation.ownerId !== connection?.actorId)
    )
      return
    setCooperationDraft({
      threadId: active.id,
      expectedVersion: cooperation.version,
      featureTopic: cooperation.featureTopic,
      relationship: cooperation.relationship,
      analysisEnabled: cooperation.analysisEnabled,
      analysisTextEnabled: cooperation.analysisTextEnabled === true,
      awarenessMode: cooperation.awarenessMode,
    })
  }
  async function saveCooperation(event: React.FormEvent) {
    event.preventDefault()
    if (!active || !canInstruct || cooperationDraft?.threadId !== active.id) return
    try {
      const { threadId, ...input } = cooperationDraft
      const result = await act(
        `cooperation:${threadId}`,
        `${threadPath(threadId)}/cooperation`,
        cooperationWrite(input),
        "Cooperation settings",
        "PUT",
      )
      if (result !== undefined) setCooperationDraft(undefined)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  async function cancelRun() {
    if (!active || !currentRun || !canInstruct) return
    await act(
      `cancel:${currentRun.instructionId}`,
      `${threadPath(active.id)}/instructions/${encodeURIComponent(currentRun.instructionId)}/cancel`,
      {},
      "Cancellation request",
      "POST",
      "none",
    )
  }
  async function decideTool(approval: Approval, decision: "approve" | "reject") {
    if (!active || !canInstruct || !connection?.actorId || busyRef.current) return
    const key = `${identity}|${active.id}|${approval.id}:${decision}`
    const remembered = approvalAttempts.current.get(key)
    if (remembered) {
      await execute(remembered, key, decision === "approve" ? "Tool approval" : "Tool rejection")
      return
    }
    const reviewed = toolReviewForApproval(approval, active.sessionId)
    const fingerprint = reviewed ? toolReviewFingerprint(reviewed) : ""
    if (
      decision === "approve" &&
      (!reviewed ||
        reviewedTools[approval.id]?.version !== approval.version ||
        reviewedTools[approval.id]?.fingerprint !== fingerprint)
    ) {
      setError("Review the complete current tool request before allowing it.")
      return
    }
    const token = epoch.current
    busyRef.current = key
    setBusy(key)
    setError("")
    try {
      const authenticated = await readConnection(scopeController.current?.signal)
      if (token !== epoch.current) return
      if (!matchesConnectionScope(authenticated, connection)) {
        adoptConnection(authenticated)
        return
      }
      const claimed = await coordinationRequest<Approval>(
        `${threadPath(active.id)}/approvals/${encodeURIComponent(approval.id)}/claim`,
        {
          method: "POST",
          body: { expectedVersion: approval.version },
          signal: scopeController.current?.signal,
          expectedActorId: connection.actorId,
        },
      )
      if (token !== epoch.current) return
      if (
        claimed.id !== approval.id ||
        claimed.threadId !== active.id ||
        claimed.toolCallId !== approval.toolCallId ||
        claimed.claimedBy !== connection.actorId ||
        claimed.state !== "claimed"
      )
        throw new Error("The service returned an inconsistent tool claim")
      if (decision === "approve") {
        const current = await coordinationRequest<ThreadSnapshot>(threadPath(active.id), {
          signal: scopeController.current?.signal,
        })
        if (token !== epoch.current) return
        const currentApproval = current.approvals.find((item) => item.id === approval.id)
        const currentReview = currentApproval && toolReviewForApproval(currentApproval, active.sessionId)
        if (
          current.thread.id !== active.id ||
          current.thread.sessionId !== active.sessionId ||
          currentApproval?.version !== claimed.version ||
          currentApproval.claimedBy !== connection.actorId ||
          currentApproval.state !== "claimed" ||
          !currentReview ||
          toolReviewFingerprint(currentReview) !== fingerprint
        )
          throw new Error("The tool permission scope changed after review. Reload and review the current request.")
      }
      const action = prepareLiveAction({
        actorId: connection.actorId,
        projectId: live!.projectId,
        path: `${threadPath(active.id)}/approvals/${encodeURIComponent(approval.id)}/decision`,
        body: { expectedVersion: claimed.version, decision },
        identityField: "decisionId",
      })
      approvalAttempts.current.set(key, action)
      pendingWrites.current.set(key, {
        key,
        action,
        label: decision === "approve" ? "Tool approval" : "Tool rejection",
        approval: true,
      })
      if (!persistPending()) return
      await execute(action, key, decision === "approve" ? "Tool approval" : "Tool rejection", { held: true })
    } catch (reason) {
      if (token === epoch.current) {
        setError(errorMessage(reason))
        setRefresh((value) => value + 1)
      }
    } finally {
      if (token === epoch.current) {
        busyRef.current = ""
        setBusy("")
      }
    }
  }
  async function inspect(ref: EvidenceRef) {
    if (!live) return
    sourceOpener.current = document.activeElement as HTMLElement
    sourceController.current?.abort()
    const controller = new AbortController(),
      token = ++sourceEpoch.current
    sourceController.current = controller
    setSource({ ref, loading: true })
    setSourceReviewed(false)
    try {
      const event = await readLiveSource(live.projectId, ref, controller.signal)
      if (token === sourceEpoch.current && !controller.signal.aborted) setSource({ ref, event, loading: false })
    } catch (reason) {
      if (token === sourceEpoch.current && !controller.signal.aborted)
        setSource({ ref, loading: false, error: errorMessage(reason) })
    }
  }
  async function sendContext() {
    if (!source?.event || !live || !active || !canInstruct || !sourceReviewed) return
    try {
      const text = reviewedContextText(live.projectId, active.id, source.event)
      const result = await act(
        `context:${active.id}:${source.event.id}:${source.event.seq}`,
        `${threadPath(active.id)}/instructions`,
        { text },
        "Reviewed context instruction",
      )
      if (result !== undefined) closeSource()
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  const connected = connection?.connected === true
  const showConnection = !connected || view === "connection"
  const actorName = displayActor(connection)
  const activeCooperation = cooperation?.threadId === active?.id ? cooperation : undefined
  const editingCooperation = cooperationDraft?.threadId === active?.id ? cooperationDraft : undefined
  const sharedContextSources = (live?.workspace.sessions ?? [])
    .filter((session) => session.id !== active?.id)
    .flatMap((session) => {
      const context = sessionContextSource(live!.projectId, session)
      return context ? [{ session, context }] : []
    })
    .slice(0, 4)
  const sessionDetails = Object.fromEntries(
    (live?.workspace.sessions ?? []).map((session) => [
      session.id,
      `${session.owner === "You" ? actorName : session.owner} · ${runLabel(session)}`,
    ]),
  )
  const availableProjects = provisioning.projects.filter(
    (project) => !live?.projects.some((shared) => shared.id === project.projectId),
  )
  const modelReady = provisioning.projects.find((project) => project.projectId === live?.projectId)?.modelReady === true
  const readOnly = Boolean(busy || loadError)
  const queued = snapshot?.runs.filter((run) => run.state === "queued") ?? []
  const contributor = (id?: string) =>
    id === connection?.actorId
      ? actorName
      : id
        ? id
            .replace(/^usr_/, "")
            .replace(/[_-]/g, " ")
            .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
        : "Member"
  const timeline = [
    ...(active?.messages ?? []).map((message) => ({
      seq: message.seq,
      time: message.occurredAt ?? "",
      message,
      event: undefined,
    })),
    ...(active?.sourceEvents ?? [])
      .filter((event) => ["run.tool", "run.diff", "run.workspace"].includes(event.kind))
      .map((event) => ({ seq: event.seq, time: event.occurredAt, message: undefined, event })),
  ].toSorted((a, b) => a.time.localeCompare(b.time) || (a.seq ?? 0) - (b.seq ?? 0))

  return (
    <div className="shell live-shell">
      {sidebarOpen && (
        <button
          className="panel-scrim"
          aria-label="Close navigation"
          onClick={() => {
            setSidebarOpen(false)
            navigationButton.current?.focus()
          }}
        />
      )}
      <aside
        id="workspace-navigation"
        ref={sidebar}
        className={`sidebar ${sidebarOpen ? "open" : ""}`}
        role={sidebarOpen ? "dialog" : "complementary"}
        aria-modal={sidebarOpen || undefined}
        aria-label="Workspace navigation"
      >
        <div className="brand">
          <img src="/puff-collab.svg" alt="" />
          <span>Puff Collab</span>
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => {
              setSidebarOpen(false)
              navigationButton.current?.focus()
            }}
          >
            ×
          </button>
        </div>
        {connected && (
          <label className="project-picker">
            <span>Project</span>
            <select
              aria-label="Project"
              value={projectId || live?.projectId || ""}
              onChange={(event) => changeProject(event.target.value)}
            >
              <option value="" disabled>
                Choose a project
              </option>
              {live?.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <nav aria-label="Project actions">
          <button
            className={`nav-button ${view === "overview" ? "active" : ""}`}
            aria-current={view === "overview" ? "page" : undefined}
            disabled={!connected}
            onClick={() => showView("overview")}
          >
            <span aria-hidden="true">▦</span>Team overview
          </button>
          <button className="nav-button new-thread" disabled={!live?.projectId} onClick={openNew}>
            <span aria-hidden="true">+</span>New thread
          </button>
        </nav>
        <input
          className="session-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a thread…"
          aria-label="Search shared threads"
          disabled={!live}
        />
        <div className="session-list">
          <div className="sidebar-heading">
            Threads <span>{filtered.length}</span>
          </div>
          {live?.workspace.project.members.map((member) => {
            const sessions = filtered.filter((session) => session.owner === member.name)
            if (!sessions.length) return null
            return (
              <section className="sidebar-person" key={member.name}>
                <h2>
                  <span className={`avatar ${member.color}`} aria-hidden="true">
                    {member.name === "You" ? actorName[0] : member.initials}
                  </span>
                  {member.name === "You" ? `${actorName} (you)` : member.name}
                </h2>
                {sessions.map((session) => (
                  <button
                    className={`session-item ${selected === session.id && view === "chat" ? "active" : ""}`}
                    aria-current={selected === session.id && view === "chat" ? "page" : undefined}
                    key={session.id}
                    title={session.title}
                    onClick={() => openSession(session.id)}
                  >
                    <i className={`status-dot ${session.status}`} aria-hidden="true" />
                    <span>
                      <span className="session-item-title">{session.title}</span>
                      <span className="session-item-meta">{runLabel(session)}</span>
                    </span>
                  </button>
                ))}
              </section>
            )
          })}
          {live && !filtered.length && (
            <p className="empty-inline">
              {query ? "No threads match your search." : "Shared threads will appear here."}
            </p>
          )}
        </div>
        <footer className="sidebar-footer">
          <div className="account">
            <span className="avatar green" aria-hidden="true">
              {actorName[0]}
            </span>
            <span>
              {actorName}
              <small>{connected ? "Member account" : "Not connected"}</small>
            </span>
          </div>
          <button
            className="nav-button"
            onClick={() => {
              setConnectionForm((previous) => ({
                ...previous,
                url: connection?.url ?? previous.url,
                username: connection?.username ?? previous.username,
              }))
              showView("connection")
            }}
          >
            Connection settings
          </button>
          {connected && availableProjects.length > 0 && (
            <button className="text-button" onClick={() => showView("project")}>
              Set up another project
            </button>
          )}
        </footer>
      </aside>
      <main className="main">
        <header className="topbar">
          <button
            ref={navigationButton}
            className="icon-button mobile-only"
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
            aria-controls="workspace-navigation"
            onClick={() => {
              setDockOpen(false)
              setSidebarOpen(true)
            }}
          >
            ☰
          </button>
          <div className="current-context">
            <strong>
              {view === "chat"
                ? (active?.title ?? "Shared thread")
                : view === "new"
                  ? "New thread"
                  : showConnection
                    ? "Connection settings"
                    : view === "settings"
                      ? "Project brief"
                      : view === "project"
                        ? "Project setup"
                        : (live?.workspace.project.name ?? "Workspace")}
            </strong>
            {view === "chat" && active && (
              <span>
                {active.owner === "You" ? actorName : active.owner} ·{" "}
                <span className="execution-label" data-state={active.execution}>
                  {runLabel(active)}
                </span>
              </span>
            )}
          </div>
          <div className="topbar-actions">
            <span className={`connection-state ${loadError ? "is-error" : ""}`}>
              {connected ? (loadError ? "Connection interrupted" : "Connected") : "Not connected"}
            </span>
            {currentRun && view === "chat" && canInstruct && (
              <button
                className="stop-button"
                disabled={readOnly || currentRun.state === "cancelling"}
                onClick={cancelRun}
              >
                {currentRun.state === "cancelling" ? "Stopping…" : "Stop"}
              </button>
            )}
            {live?.projectId && (
              <button
                ref={activityButton}
                className="activity-toggle"
                aria-label="Team activity and thread details"
                aria-controls="team-activity"
                aria-expanded={dockOpen}
                onClick={() => {
                  setSidebarOpen(false)
                  setDockOpen((value) => !value)
                }}
              >
                Team<span aria-hidden="true"> ◫</span>
              </button>
            )}
          </div>
        </header>
        {(error || loadError || notice) && (
          <div
            className={`live-notice ${error || loadError ? "is-error" : ""}`}
            role={error || loadError ? "alert" : "status"}
          >
            <span>{error || loadError || notice}</span>
            {loadError && (
              <>
                <small>Showing the last observation. Sending is paused until the connection recovers.</small>
                <button onClick={() => setRefresh((value) => value + 1)}>Retry connection</button>
              </>
            )}
            {failed && (
              <div className="live-retry">
                <button disabled={readOnly} onClick={retryFailed}>
                  Retry saved request
                </button>
                <span>The original request identity is retained.</span>
                <button disabled={readOnly} onClick={startNewRequest}>
                  Start a new request
                </button>
              </div>
            )}
            {!error && !loadError && notice && (
              <button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice("")}>
                ×
              </button>
            )}
          </div>
        )}
        <div className="workspace-body">
          <div className="workspace-column">
            <section
              className="content"
              ref={content}
              aria-label="Workspace content"
              onScroll={() => {
                const element = content.current
                if (view !== "chat" || !selected || !element) return
                tail.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
                setFollowTail(tail.current)
                scrollPositions.current.set(`${identity}|${selected}`, element.scrollTop)
              }}
            >
              {connection === undefined && (
                <div className="live-empty" role="status">
                  <h1>Opening your workspace</h1>
                  <p>Checking the connection…</p>
                </div>
              )}
              {connection !== undefined && showConnection && (
                <form className="live-form" onSubmit={connect}>
                  <span className="eyebrow">Puff Collab</span>
                  <h1>{connected ? "Connection settings" : "Connect to your workspace"}</h1>
                  <p className="muted">
                    Sign in with your individual member account. Use the account provided by your workspace operator.
                  </p>
                  <label className="field">
                    Backend URL
                    <input
                      required
                      type="url"
                      value={connectionForm.url}
                      onChange={(event) => setConnectionForm((previous) => ({ ...previous, url: event.target.value }))}
                      placeholder="http://127.0.0.1:4096"
                    />
                  </label>
                  <label className="field">
                    Member username
                    <input
                      required
                      autoComplete="username"
                      value={connectionForm.username}
                      onChange={(event) =>
                        setConnectionForm((previous) => ({ ...previous, username: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    Password
                    <input
                      required
                      type="password"
                      autoComplete="current-password"
                      value={connectionForm.password}
                      onChange={(event) =>
                        setConnectionForm((previous) => ({ ...previous, password: event.target.value }))
                      }
                    />
                  </label>
                  <div className="form-actions">
                    <button className="primary-button" disabled={Boolean(busy)}>
                      {busy === "connect" ? "Connecting…" : "Connect"}
                    </button>
                    {connected && (
                      <button type="button" disabled={Boolean(busy)} onClick={disconnect}>
                        Disconnect
                      </button>
                    )}
                  </div>
                  {connected && (
                    <button type="button" className="text-button" onClick={() => showView("overview")}>
                      Back to workspace
                    </button>
                  )}
                </form>
              )}
              {connected && !showConnection && view === "project" && (
                <form className="live-form" onSubmit={createProject}>
                  <span className="eyebrow">Project setup</span>
                  <h1>Share a coding project</h1>
                  <p className="muted">
                    Choose a repository available to your account. Project access comes from the configured member
                    roster.
                  </p>
                  <label className="field">
                    Coding project
                    <select
                      required
                      value={newProject.projectId}
                      onChange={(event) => {
                        const project = provisioning.projects.find((item) => item.projectId === event.target.value)
                        setNewProject({ projectId: event.target.value, name: project?.name ?? "" })
                      }}
                    >
                      <option value="">Choose a project</option>
                      {availableProjects.map((project) => (
                        <option key={project.projectId} value={project.projectId}>
                          {project.name}
                          {project.modelReady ? "" : " (model unavailable)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Project name
                    <input
                      required
                      value={newProject.name}
                      onChange={(event) => setNewProject((previous) => ({ ...previous, name: event.target.value }))}
                    />
                  </label>
                  {!availableProjects.length && (
                    <p>
                      No additional coding project is available. The workspace operator needs to configure another
                      repository.
                    </p>
                  )}
                  <div className="form-actions">
                    <button type="button" onClick={() => showView("overview")}>
                      Back
                    </button>
                    <button className="primary-button" disabled={readOnly || !newProject.projectId}>
                      Create shared project
                    </button>
                  </div>
                </form>
              )}
              {connected && !showConnection && !live && view !== "project" && (
                <div className="live-empty" role="status">
                  <h1>{loadError ? "Workspace unavailable" : "Loading your projects"}</h1>
                  <p>{loadError || "Reading shared threads and team activity…"}</p>
                </div>
              )}
              {live && !showConnection && !live.projectId && view !== "project" && (
                <div className="live-empty">
                  <h1>Your shared workspace</h1>
                  <p>Set up a project to start conversations with your team.</p>
                  <button className="primary-button" onClick={() => showView("project")}>
                    Set up a project
                  </button>
                </div>
              )}
              {live?.projectId && !showConnection && view === "overview" && (
                <>
                  <ProjectOverview
                    actorName={actorName}
                    project={live.workspace.project}
                    sessions={live.workspace.sessions}
                    onOpenSession={openSession}
                    onNewSession={openNew}
                    onSetup={openSettings}
                  />
                  <form className="live-focus-form" onSubmit={saveFocus}>
                    <label>
                      Your focus
                      {focusEditing ? (
                        <input
                          aria-label="Your focus"
                          value={focusDraft}
                          maxLength={2000}
                          onChange={(event) => setFocusDraft(event.target.value)}
                        />
                      ) : (
                        <span>{ownFocus?.text || "What are you working on?"}</span>
                      )}
                    </label>
                    {focusEditing ? (
                      <>
                        <button disabled={readOnly}>Save</button>
                        <button type="button" onClick={() => setFocusEditing(false)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setFocusDraft(ownFocus?.text ?? "")
                          setFocusVersion(ownFocus?.version ?? 0)
                          setFocusEditing(true)
                        }}
                      >
                        Edit focus
                      </button>
                    )}
                  </form>
                </>
              )}
              {live?.projectId && !showConnection && view === "settings" && (
                <form className="live-form" onSubmit={saveBrief}>
                  <span className="eyebrow">Shared context</span>
                  <h1>Project brief</h1>
                  <p className="muted">Give teammates a common goal and a clear definition of done.</p>
                  <label className="field">
                    Goal
                    <textarea
                      required
                      value={settings.goal}
                      onChange={(event) => setSettings((previous) => ({ ...previous, goal: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Success criteria (one per line)
                    <textarea
                      required
                      value={settings.criteria}
                      onChange={(event) => setSettings((previous) => ({ ...previous, criteria: event.target.value }))}
                    />
                  </label>
                  <div className="form-actions">
                    <button type="button" onClick={() => showView("overview")}>
                      Back
                    </button>
                    <button className="primary-button" disabled={readOnly}>
                      Save brief
                    </button>
                  </div>
                </form>
              )}
              {live?.projectId && !showConnection && view === "new" && (
                <div className="live-new-session">
                  <span className="eyebrow">New shared thread</span>
                  <h1>What are you working on?</h1>
                  <p className="muted">
                    Start a conversation with your coding agent. Each thread uses a separate repository worktree.
                  </p>
                  <label className="field">
                    Title (optional)
                    <input
                      value={sessionTitle}
                      onChange={(event) => setSessionTitle(event.target.value)}
                      placeholder="Use the first line of your task"
                      maxLength={120}
                    />
                  </label>
                  <label className="live-share-consent">
                    <input type="checkbox" checked={share} onChange={(event) => setShare(event.target.checked)} />
                    <span>Share this conversation and its recorded activity with project members.</span>
                  </label>
                  <p className="field-help">
                    Threads created here are shared. Leave sharing unchecked to keep your task as a draft. Only you can
                    instruct this agent; teammates can comment.
                  </p>
                  {!modelReady && (
                    <div className="live-notice is-error" role="status">
                      A coding model is not configured for this project. The workspace operator needs to configure a
                      provider before you can start a thread.
                    </div>
                  )}
                  {possiblyRelatedWork(draft, live.workspace.sessions).map((match) => {
                    const related = live.workspace.sessions.find((item) => item.id === match.id)!
                    return (
                      <article className="live-related" key={match.id}>
                        <span className="eyebrow">Possibly related work</span>
                        <h3>{match.title}</h3>
                        <p>{match.summary}</p>
                        <small>{sessionDetails[match.id]}</small>
                        <div>
                          <button onClick={() => openSession(match.id)}>Open thread</button>
                          <button
                            disabled={!share || readOnly || !modelReady}
                            onClick={() => createSession("complementary", related)}
                          >
                            Complement this work
                          </button>
                          <button
                            disabled={!share || readOnly || !modelReady}
                            onClick={() => createSession("alternative", related)}
                          >
                            Try another approach
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
              {live && !showConnection && view === "chat" && !active && (
                <div className="live-empty">
                  {openingThread === selected ? (
                    <>
                      <h1>Opening your thread</h1>
                      <p>Reading its shared conversation…</p>
                    </>
                  ) : (
                    <>
                      <h1>Thread unavailable</h1>
                      <p>This thread is not shared in the selected project, or your account no longer has access.</p>
                      <button onClick={() => showView("overview")}>Back to team overview</button>
                    </>
                  )}
                </div>
              )}
              {live && !showConnection && view === "chat" && active && (
                <div className="conversation">
                  <div className="thread-intro">
                    <span className="avatar agent-avatar" aria-hidden="true">
                      ✳
                    </span>
                    <span>
                      Shared conversation{" "}
                      <small>
                        {active.owner === "You"
                          ? "Your agent. Teammates can follow along and comment."
                          : `${active.owner}'s agent. Add a comment to contribute.`}
                      </small>
                    </span>
                    <button
                      className="text-button"
                      onClick={() => {
                        setDrawerTab("thread")
                        setDockOpen(true)
                      }}
                    >
                      Thread details
                    </button>
                  </div>
                  <div className="messages">
                    {timeline.map((item, index) => {
                      if (item.event) {
                        const event = item.event
                        return (
                          <details className="tool-activity" key={event.id}>
                            <summary>
                              <span aria-hidden="true">◇</span>
                              {event.kind === "run.tool"
                                ? String(event.payload.toolName ?? "Tool activity")
                                : event.kind === "run.diff"
                                  ? "File changes"
                                  : "Workspace activity"}
                              <span>
                                {typeof event.payload.toolStatus === "string" ? event.payload.toolStatus : "Recorded"}
                              </span>
                            </summary>
                            <pre>{sourceEventText(event) || "No additional detail was recorded."}</pre>
                            <button
                              className="text-button"
                              onClick={() => inspect({ threadId: active.id, eventId: event.id, seq: event.seq })}
                            >
                              Inspect source
                            </button>
                          </details>
                        )
                      }
                      const message = item.message!
                      const run = snapshot?.runs.find((run) => run.id === message.runId)
                      const waiting =
                        message.role === "user" && message.kind !== "comment.created" && run?.state === "queued"
                      return (
                        <article
                          className={`message ${message.role} ${message.kind === "comment.created" ? "comment" : ""}`}
                          key={message.eventId ?? `${message.instructionId ?? "record"}:${index}`}
                        >
                          <header>
                            <span
                              className={`avatar ${message.role === "assistant" ? "agent-avatar" : "human-avatar"}`}
                              aria-hidden="true"
                            >
                              {message.role === "assistant" ? "✳" : contributor(message.actorId)[0]}
                            </span>
                            <strong>
                              {message.role === "assistant" ? "Coding agent" : contributor(message.actorId)}
                            </strong>
                            {message.kind === "comment.created" && <span className="message-kind">Comment</span>}
                            {waiting && <span className="message-kind queued">Queued</span>}
                            {message.occurredAt && (
                              <time dateTime={message.occurredAt}>
                                {new Date(message.occurredAt).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>
                            )}
                            {message.eventId && message.seq !== undefined && (
                              <button
                                className="message-source"
                                aria-label={`Inspect source for ${message.role === "assistant" ? "agent output" : "message"}`}
                                onClick={() =>
                                  inspect({ threadId: active.id, eventId: message.eventId!, seq: message.seq! })
                                }
                              >
                                Source
                              </button>
                            )}
                          </header>
                          <MessageContent text={message.text} />
                        </article>
                      )
                    })}
                    {!active.messages.length && (
                      <div className="empty-transcript">
                        <h2>This conversation is ready</h2>
                        <p>
                          {canInstruct
                            ? "Give your agent a task below. Its output and tool activity will appear here."
                            : "Recorded messages will appear here. You can add a comment below."}
                        </p>
                      </div>
                    )}
                  </div>
                  {active.sourceEvents
                    .filter((event) => ["run.failed", "run.recovery.required"].includes(event.kind))
                    .slice(-3)
                    .map((event) => (
                      <div className="live-notice is-error" key={event.id}>
                        <strong>{event.kind === "run.failed" ? "Agent run failed" : "Run needs recovery"}</strong>
                        <p>{sourceEventText(event) || "The service did not report further details."}</p>
                      </div>
                    ))}
                  {snapshot?.approvals.map((approval) => {
                    const review = toolReviewForApproval(approval, active.sessionId)
                    const fingerprint = review ? toolReviewFingerprint(review) : ""
                    const checked = Boolean(
                      review &&
                        reviewedTools[approval.id]?.version === approval.version &&
                        reviewedTools[approval.id]?.fingerprint === fingerprint,
                    )
                    const decision = approval.decision ?? (approval.state === "approved" ? "approve" : "reject")
                    return (
                      <article className="live-approval" key={approval.id}>
                        <strong>Permission request · {review?.permission ?? approval.toolCallId}</strong>
                        <p>
                          {approval.state} · forwarding {approval.deliveryState}
                          {approval.claimedBy && ` · claimed by ${approval.claimedBy}`}
                        </p>
                        {["pending", "claimed"].includes(approval.state) && (
                          <>
                            {review ? (
                              <>
                                <p>{review.summary}</p>
                                <dl className="live-tool-details">
                                  <dt>Permission</dt>
                                  <dd>{review.permission}</dd>
                                  <dt>Requested resources</dt>
                                  <dd>{review.patterns.join("\n") || "No resource patterns supplied"}</dd>
                                  <dt>Saved permission patterns</dt>
                                  <dd>{review.savePatterns.join("\n") || "None · Allow applies once"}</dd>
                                  <dt>Source message</dt>
                                  <dd>{review.sourceMessageId}</dd>
                                  <dt>Permission request</dt>
                                  <dd>{review.permissionRequestId}</dd>
                                </dl>
                                {review.inputJson && (
                                  <>
                                    <h4>Tool arguments · {review.toolName}</h4>
                                    <pre className="live-source-text">{review.inputJson}</pre>
                                  </>
                                )}
                                {review.metadataJson && (
                                  <>
                                    <h4>Permission metadata</h4>
                                    <pre className="live-source-text">{review.metadataJson}</pre>
                                  </>
                                )}
                                {!review.inputJson && !review.metadataJson && (
                                  <p>
                                    Tool arguments were not recorded for this permission request. Allow remains
                                    disabled.
                                  </p>
                                )}
                                <label className="live-share-consent">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={!canInstruct || Boolean(busy)}
                                    onChange={(event) =>
                                      setReviewedTools((previous) => ({
                                        ...previous,
                                        [approval.id]: event.target.checked
                                          ? { version: approval.version, fingerprint }
                                          : { version: -1, fingerprint: "" },
                                      }))
                                    }
                                  />
                                  <span>
                                    I reviewed this tool’s recorded arguments, permission action and requested
                                    resources. Allow this request once.
                                  </span>
                                </label>
                              </>
                            ) : (
                              <p>
                                Complete tool arguments and permission scope are unavailable. Allow remains disabled.
                              </p>
                            )}
                            <button
                              disabled={!canInstruct || !checked || readOnly}
                              onClick={() => decideTool(approval, "approve")}
                            >
                              Allow tool once
                            </button>
                            <button disabled={!canInstruct || readOnly} onClick={() => decideTool(approval, "reject")}>
                              Reject tool request
                            </button>
                          </>
                        )}
                        {["approved", "rejected"].includes(approval.state) &&
                          ["pending", "failed"].includes(approval.deliveryState) &&
                          approvalAttempts.current.has(`${identity}|${active.id}|${approval.id}:${decision}`) && (
                            <button disabled={!canInstruct || readOnly} onClick={() => decideTool(approval, decision)}>
                              Retry decision forwarding
                            </button>
                          )}
                      </article>
                    )
                  })}
                  {currentRun && (
                    <div className="run-progress" role="status">
                      <span className={`status-dot ${active.status}`} aria-hidden="true" />
                      <span>{currentRun.state === "running" ? "Agent is working…" : runLabel(active)}</span>
                      {queued.length > 0 && (
                        <span>
                          · {queued.length} queued {queued.length === 1 ? "instruction" : "instructions"}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
            {live && !showConnection && (view === "new" || (view === "chat" && active)) && (
              <div className="composer-wrap">
                {view === "chat" && !followTail && (
                  <button
                    className="jump-latest"
                    onClick={() => {
                      tail.current = true
                      setFollowTail(true)
                      if (content.current) content.current.scrollTop = content.current.scrollHeight
                    }}
                  >
                    Jump to latest ↓
                  </button>
                )}
                <div className="composer">
                  {view === "chat" && (
                    <div className="composer-mode">
                      <label>
                        Send as
                        <select
                          aria-label="Message type"
                          value={mode}
                          onChange={(event) => setMode(event.target.value as "instruction" | "comment")}
                        >
                          <option value="instruction" disabled={!canInstruct}>
                            Agent instruction
                          </option>
                          <option value="comment">Team comment</option>
                        </select>
                      </label>
                      {queued.length > 0 && <span>{queued.length} queued</span>}
                    </div>
                  )}
                  <textarea
                    ref={composerInput}
                    aria-label={view === "new" ? "Task prompt" : "Thread prompt"}
                    rows={3}
                    value={draft}
                    onChange={(event) => updateDraft(event.target.value)}
                    placeholder={
                      view === "new"
                        ? "Describe your coding task…"
                        : mode === "comment"
                          ? "Add to the conversation…"
                          : currentRun
                            ? "Add the next instruction…"
                            : "Give your agent a task…"
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        if (!readOnly) void (view === "new" ? createSession() : sendDraft())
                      }
                    }}
                  />
                  <div className="composer-toolbar">
                    <span>
                      {view === "new"
                        ? "Shared with your project"
                        : mode === "comment"
                          ? "Visible to teammates; does not run the agent"
                          : currentRun
                            ? "Runs after the current turn"
                            : "Runs in this thread's workspace"}
                    </span>
                    <button
                      className="primary-button"
                      disabled={
                        !draft.trim() ||
                        readOnly ||
                        (view === "new" && (!share || !modelReady)) ||
                        (view === "chat" && mode === "instruction" && !canInstruct)
                      }
                      onClick={() => (view === "new" ? createSession() : sendDraft())}
                    >
                      {busy
                        ? "Sending…"
                        : view === "new"
                          ? "Start thread"
                          : mode === "comment"
                            ? "Post comment"
                            : currentRun
                              ? "Queue instruction"
                              : "Send"}
                      <span aria-hidden="true">↑</span>
                    </button>
                  </div>
                </div>
                <p className="keyboard-hint">Enter to send · Shift + Enter for a new line</p>
              </div>
            )}
          </div>
          {live?.projectId && !showConnection && dockOpen && (
            <>
              <button
                className="activity-scrim"
                aria-label="Close team activity"
                onClick={() => {
                  setDockOpen(false)
                  activityButton.current?.focus()
                }}
              />
              <aside
                ref={activity}
                id="team-activity"
                className="activity-panel"
                role={window.matchMedia("(max-width: 1100px)").matches ? "dialog" : "complementary"}
                aria-modal={window.matchMedia("(max-width: 1100px)").matches || undefined}
                aria-label="Team activity"
              >
                <header className="activity-header">
                  <div
                    role="tablist"
                    aria-label="Activity panels"
                    onKeyDown={(event) => {
                      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
                      event.preventDefault()
                      const next =
                        active &&
                        view === "chat" &&
                        (event.key === "End" || (event.key !== "Home" && drawerTab === "team"))
                          ? "thread"
                          : "team"
                      setDrawerTab(next)
                      event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus()
                    }}
                  >
                    <button
                      role="tab"
                      data-tab="team"
                      tabIndex={drawerTab === "team" ? 0 : -1}
                      aria-selected={drawerTab === "team"}
                      onClick={() => setDrawerTab("team")}
                    >
                      Team
                    </button>
                    {active && view === "chat" && (
                      <button
                        role="tab"
                        data-tab="thread"
                        tabIndex={drawerTab === "thread" ? 0 : -1}
                        aria-selected={drawerTab === "thread"}
                        onClick={() => setDrawerTab("thread")}
                      >
                        Thread
                      </button>
                    )}
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Close team activity"
                    onClick={() => {
                      setDockOpen(false)
                      activityButton.current?.focus()
                    }}
                  >
                    ×
                  </button>
                </header>
                <div className="activity-content" role="tabpanel">
                  {(drawerTab === "team" || !active || view !== "chat") && (
                    <>
                      <p className="field-help">
                        Recorded work across this project. Activity is not an online presence indicator.
                      </p>
                      {live.workspace.project.members.map((member) => (
                        <section className="activity-person" key={member.name}>
                          <h2>
                            <span className={`avatar ${member.color}`} aria-hidden="true">
                              {member.name === "You" ? actorName[0] : member.initials}
                            </span>
                            {member.name === "You" ? `${actorName} (you)` : member.name}
                          </h2>
                          {member.focus !== "No stated focus." && <p className="member-focus">Focus: {member.focus}</p>}
                          {live.workspace.sessions
                            .filter((session) => session.owner === member.name)
                            .map((session) => (
                              <button
                                className="activity-thread"
                                aria-current={selected === session.id && view === "chat" ? "page" : undefined}
                                key={session.id}
                                onClick={() => openSession(session.id)}
                              >
                                <strong>{session.title}</strong>
                                <span className="execution-label" data-state={session.execution}>
                                  {runLabel(session)}
                                </span>
                                <p>{session.freshness === "missing" ? "No summary yet." : session.summary}</p>
                                {session.freshness === "stale" && <small>Summary may be out of date</small>}
                              </button>
                            ))}
                          {!live.workspace.sessions.some((session) => session.owner === member.name) && (
                            <p className="empty-inline">No shared threads.</p>
                          )}
                        </section>
                      ))}
                    </>
                  )}
                  {drawerTab === "thread" && active && view === "chat" && (
                    <>
                      <h2>Thread details</h2>
                      <p className="field-help">
                        {active.owner === "You" ? actorName : active.owner}{" "}
                        {active.ownership === "owner"
                          ? "owns this coding agent."
                          : "shared this conversation. Verified ownership is unavailable."}
                      </p>
                      <section className="live-cooperation" aria-label="Session cooperation settings">
                        <header>
                          <strong>Session cooperation</strong>
                          {activeCooperation && (
                            <span>
                              {activeCooperation.analysisEnabled ? "Analysis selected" : "Analysis off"} ·{" "}
                              {activeCooperation.analysisTextEnabled
                                ? "instruction/output text selected"
                                : "instruction/output text excluded"}{" "}
                              · {activeCooperation.relationship}
                            </span>
                          )}
                        </header>
                        {cooperationError && <p role="alert">{cooperationError}</p>}
                        {!activeCooperation && !cooperationError && <p>Loading saved settings…</p>}
                        {activeCooperation && !editingCooperation && (
                          <>
                            <p>
                              Feature topic: {activeCooperation.featureTopic || "Not selected"} · Awareness:{" "}
                              {activeCooperation.awarenessMode}
                            </p>
                            <small>
                              Selection does not establish that the analysis agent is configured or running. Findings are
                              informational; work redirection requires your approval.
                            </small>
                            {canInstruct &&
                            (!activeCooperation.ownerId || activeCooperation.ownerId === connection?.actorId) ? (
                              <button onClick={editCooperation}>Edit cooperation</button>
                            ) : (
                              <small>Only this Session’s verified owner can change these settings.</small>
                            )}
                          </>
                        )}
                        {editingCooperation && (
                          <form onSubmit={saveCooperation}>
                            <label className="field">
                              Feature topic
                              <input
                                value={editingCooperation.featureTopic}
                                maxLength={80}
                                onChange={(event) =>
                                  setCooperationDraft({ ...editingCooperation, featureTopic: event.target.value })
                                }
                                placeholder="For example: project navigation"
                              />
                            </label>
                            <label className="field">
                              Relationship
                              <select
                                value={editingCooperation.relationship}
                                onChange={(event) =>
                                  setCooperationDraft({
                                    ...editingCooperation,
                                    relationship: event.target.value as CooperationInput["relationship"],
                                  })
                                }
                              >
                                <option value="open">Open to related work</option>
                                <option value="complementary">Complementary task</option>
                                <option value="alternative">Deliberate alternative approach</option>
                              </select>
                            </label>
                            <label className="live-share-consent">
                              <input
                                type="checkbox"
                                checked={editingCooperation.analysisEnabled}
                                onChange={(event) =>
                                  setCooperationDraft({
                                    ...editingCooperation,
                                    analysisEnabled: event.target.checked,
                                    analysisTextEnabled: event.target.checked
                                      ? editingCooperation.analysisTextEnabled === true
                                      : false,
                                    awarenessMode: event.target.checked ? editingCooperation.awarenessMode : "off",
                                  })
                                }
                              />
                              <span>
                                Allow analysis of this selected Session. Only bounded, redacted selected event metadata is
                                sent to the configured OpenCode analysis agent and its model provider. Instruction and output
                                text require the separate permission below.
                              </span>
                            </label>
                            <label className="live-share-consent">
                              <input
                                type="checkbox"
                                disabled={!editingCooperation.analysisEnabled}
                                checked={editingCooperation.analysisTextEnabled === true}
                                onChange={(event) =>
                                  setCooperationDraft({
                                    ...editingCooperation,
                                    analysisTextEnabled: event.target.checked,
                                  })
                                }
                              />
                              <span>
                                Also permit bounded, redacted owner instruction and runner output text to be sent to the
                                configured OpenCode analysis agent for source-grounded reuse. Leave this off for
                                metadata-only analysis.
                              </span>
                            </label>
                            <label className="live-share-consent">
                              <input
                                type="checkbox"
                                disabled={!editingCooperation.analysisEnabled}
                                checked={editingCooperation.awarenessMode === "notify"}
                                onChange={(event) =>
                                  setCooperationDraft({
                                    ...editingCooperation,
                                    awarenessMode: event.target.checked ? "notify" : "off",
                                  })
                                }
                              />
                              <span>
                                Show informational findings from related selected work. This does not authorize task
                                redirection or tool use.
                              </span>
                            </label>
                            <small>Analysis starts only when a coding model is configured. Default: off.</small>
                            <div>
                              <button className="workflow-primary-button" disabled={readOnly}>
                                Save cooperation
                              </button>
                              <button type="button" onClick={() => setCooperationDraft(undefined)}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}
                      </section>
                      <details className="thread-sources">
                        <summary>Summary sources ({active.evidenceRefs.length})</summary>
                        <p className="field-help">
                          {active.freshness === "missing"
                            ? "No activity summary is recorded yet."
                            : `Summary is ${active.freshness}.`}
                        </p>
                        {active.evidenceRefs.map((ref) => (
                          <button
                            className="text-button"
                            key={`${ref.eventId}:${ref.seq}`}
                            onClick={() => inspect(ref)}
                          >
                            Inspect event {ref.seq}
                          </button>
                        ))}
                      </details>
                      <details className="thread-sources">
                        <summary>Context from other threads</summary>
                        {sharedContextSources.map(({ session, context }) => (
                          <article className="live-related" key={session.id}>
                            <h3>{session.title}</h3>
                            <p>
                              {context.kind === "summary_citation"
                                ? session.summary
                                : sourceEventText(context.event).slice(0, 300)}
                            </p>
                            <small>{sessionDetails[session.id]}</small>
                            <button onClick={() => inspect(context.ref)}>Review source</button>
                          </article>
                        ))}
                        {!sharedContextSources.length && (
                          <p className="field-help">No other reviewable sources are available.</p>
                        )}
                      </details>
                      <details className="live-session-identity">
                        <summary>Technical details</summary>
                        <dl>
                          <dt>Session</dt>
                          <dd>{active.sessionId}</dd>
                          <dt>Worker</dt>
                          <dd>{active.workerId}</dd>
                          <dt>Thread</dt>
                          <dd>{active.id}</dd>
                          <dt>Shared by</dt>
                          <dd>{contributor(active.sharedBy)}</dd>
                        </dl>
                      </details>
                    </>
                  )}
                </div>
              </aside>
            </>
          )}
        </div>
      </main>
      {source && (
        <div className="modal-backdrop" onClick={closeSource}>
          <section
            ref={sourceDialog}
            className="modal source-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="live-source-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="live-source-title">Inspect exact source</h2>
              <button className="icon-button" aria-label="Close source" onClick={closeSource}>
                ×
              </button>
            </div>
            <p className="source-attribution">
              {source.ref.threadId} / {source.ref.eventId} @ {source.ref.seq}
            </p>
            {source.loading && <p role="status">Loading this exact event…</p>}
            {source.error && (
              <p role="alert" className="form-error">
                Source unavailable: {source.error}
              </p>
            )}
            {source.event && (
              <>
                <p>
                  {source.event.kind} · {source.event.occurredAt}
                </p>
                <pre className="live-source-text">
                  {sourceEventText(source.event) || "No reviewable text is present in this event."}
                </pre>
                <p className="muted">
                  Sending context submits a user instruction to the selected target. Admission, execution and actual use
                  are separate records.
                </p>
                <label className="live-share-consent">
                  <input
                    type="checkbox"
                    checked={sourceReviewed}
                    onChange={(event) => setSourceReviewed(event.target.checked)}
                  />
                  <span>I reviewed this source and want to send it to my current Session.</span>
                </label>
                {failed?.label === "Reviewed context instruction" && (
                  <p className="form-error" role="alert">
                    {failed.error}
                  </p>
                )}
                <button
                  className="primary-button"
                  disabled={
                    !sourceReviewed ||
                    !canInstruct ||
                    Boolean(busy) ||
                    Boolean(loadError) ||
                    source.event.threadId === active?.id ||
                    !sourceEventText(source.event)
                  }
                  onClick={sendContext}
                >
                  {failed?.label === "Reviewed context instruction"
                    ? "Retry reviewed context"
                    : "Send reviewed context"}
                </button>
                {!canInstruct && <p>Select a Session with verified ownership for this account to send context.</p>}
              </>
            )}
            <button className="text-button" onClick={closeSource}>
              Close source
            </button>
          </section>
        </div>
      )}
    </div>
  )
}
