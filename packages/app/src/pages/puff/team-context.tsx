import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore } from "solid-js/store"
import { onCleanup } from "solid-js"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { createTeamApi, type TeamThread } from "./team-api"
import { mergeTeamEvents, submissionAttempt, type Submission } from "./team-state"
import { ProjectApiError } from "./project-api"

export const { use: useTeam, provider: TeamProvider } = createSimpleContext({
  name: "Team",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const server = useServer()
    const [state, set] = createStore({
      connected: false,
      connecting: false,
      sidebar: true,
      context: true,
      projects: [] as readonly Coordination.SharedProject[],
      threads: [] as readonly Coordination.Thread[],
      projectId: "",
      threadId: "",
      snapshot: undefined as TeamThread | undefined,
      events: [] as Coordination.Event[],
      cursor: 0,
      loading: false,
      error: "" as "" | ProjectApiError["code"],
      lastSuccess: 0,
      now: Date.now(),
      drafts: {} as Record<string, { text: string; kind: "instruction" | "comment" }>,
      pending: {} as Record<string, Submission | undefined>,
      action: "",
      approvalIds: {} as Record<string, string>,
    })
    let api: ReturnType<typeof createTeamApi> | undefined
    let connection = 0
    let selection = 0
    let reading = false
    const fail = (error: unknown) => set("error", error instanceof ProjectApiError ? error.code : "connection")
    const writable = () => state.connected && !state.error && state.now - state.lastSuccess < 8_000 && !state.loading

    async function loadProject(id: string) {
      if (!api) return
      const current = api
      const ticket = ++selection
      set({ projectId: id, threads: [], error: "" })
      try {
        const threads = await current.threads(id)
        if (current !== api || ticket !== selection) return
        if (threads.some((thread) => thread.projectId !== id)) throw new ProjectApiError("invalid")
        set("threads", threads)
      } catch (error) {
        if (current === api && ticket === selection) fail(error)
      }
    }

    async function connect(baseUrl: string, username: string, password: string) {
      if (state.connecting || state.action || state.connected) return false
      const ticket = ++connection
      set({ connecting: true, error: "" })
      try {
        const client = createTeamApi({ baseUrl, username, password, transport: platform.fetch })
        const projects = await client.projects()
        if (ticket !== connection) return false
        api = client
        set({ connected: true, projects, lastSuccess: Date.now() })
        if (projects[0]) await loadProject(projects[0].id)
        void refresh()
        return true
      } catch (error) {
        if (ticket === connection) fail(error)
        return false
      } finally {
        if (ticket === connection) set("connecting", false)
      }
    }

    function disconnect() {
      if (state.action || Object.values(state.pending).some(Boolean)) return
      connection++
      selection++
      api = undefined
      set({
        connected: false,
        connecting: false,
        projects: [],
        threads: [],
        projectId: "",
        snapshot: undefined,
        events: [],
        cursor: 0,
        error: "",
        lastSuccess: 0,
      })
      // Unresolved submissions must be reconciled before switching identities.
      set({ drafts: {}, pending: {}, approvalIds: {} })
    }

    function selectThread(id: string) {
      if (state.threadId === id) return
      set({ threadId: id, snapshot: undefined, events: [], cursor: 0, error: "", lastSuccess: 0, loading: !!id })
      void refresh()
    }

    async function refresh() {
      if (!api || reading || state.action) return
      const current = api
      const id = state.threadId
      const ticket = connection
      reading = true
      try {
        if (!id) {
          if (state.projectId) {
            const projectId = state.projectId
            const threads = await current.threads(projectId)
            if (ticket !== connection || projectId !== state.projectId) return
            set("threads", threads)
          }
          if (ticket === connection) set({ error: "", lastSuccess: Date.now() })
          return
        }
        const snapshot = await current.thread(id)
        if (snapshot.thread.id !== id) throw new ProjectApiError("invalid")
        let cursor = state.threadId === id ? state.cursor : 0
        let events = state.threadId === id ? [...state.events] : []
        for (let page = 0; page < 25; page++) {
          const replay = await current.events(id, cursor)
          if (replay.events.some((event) => event.threadId !== id || event.projectId !== snapshot.thread.projectId))
            throw new ProjectApiError("invalid")
          events = mergeTeamEvents(events, replay.events, id)
          if (replay.hasMore && replay.cursor <= cursor) throw new ProjectApiError("invalid")
          cursor = replay.cursor
          if (!replay.hasMore) break
        }
        if (ticket !== connection || id !== state.threadId) return
        set({ snapshot, events, cursor, error: "", lastSuccess: Date.now(), loading: false })
      } catch (error) {
        if (ticket === connection && id === state.threadId) {
          fail(error)
          set("loading", false)
        }
      } finally {
        reading = false
      }
    }

    async function send() {
      const id = state.threadId
      const draft = state.drafts[id]
      if (!api || !writable() || state.action || !draft?.text.trim()) return
      const ticket = connection
      const attempt = submissionAttempt(state.pending[id], { threadId: id, kind: draft.kind, text: draft.text.trim() })
      set("pending", id, attempt)
      set("action", id)
      try {
        if (attempt.kind === "comment") await api.comment(id, attempt.text, attempt.requestId)
        else await api.submit(id, attempt.text, attempt.requestId)
        if (ticket !== connection) return
        set("pending", id, undefined)
        set("drafts", id, { text: "", kind: draft.kind })
      } catch (error) {
        if (ticket !== connection) return
        if (error instanceof ProjectApiError && error.status && [400, 401, 403, 404, 422].includes(error.status))
          set("pending", id, undefined)
        fail(error)
      } finally {
        set("action", "")
        if (ticket === connection) void refresh()
      }
    }

    async function control(kind: "cancel" | "approve" | "reject", value: Coordination.Run | Coordination.Approval) {
      if (!api || !writable() || state.action) return
      const id = state.threadId
      const ticket = connection
      set("action", value.id)
      try {
        if (kind === "cancel" && "instructionId" in value) await api.cancel(id, value.instructionId)
        if (kind !== "cancel" && "toolCallId" in value) {
          const approval = await api.claim(id, value)
          const key = `${value.id}:${approval.version}:${kind}`
          const decisionId = state.approvalIds[key] ?? crypto.randomUUID()
          set("approvalIds", key, decisionId)
          await api.decide(id, approval, kind, decisionId)
        }
      } catch (error) {
        if (ticket === connection) fail(error)
      } finally {
        set("action", "")
        if (ticket === connection) void refresh()
      }
    }

    const interval = setInterval(() => {
      set("now", Date.now())
      void refresh()
    }, 2_000)
    onCleanup(() => {
      connection++
      api = undefined
      clearInterval(interval)
    })
    return {
      state,
      set,
      connect,
      disconnect,
      loadProject,
      selectThread,
      refresh,
      send,
      control,
      writable,
      defaultUrl: () => server.current?.http.url ?? "",
    }
  },
})
