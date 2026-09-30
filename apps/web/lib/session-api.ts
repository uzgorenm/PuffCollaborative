import type { WorkspaceSession, WorkspaceState } from "./workspace"

// These profiles drive the local scenario engine. A provider adapter can consume
// the same selection when the production model runner is connected.
export const models = [
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", description: "Balanced · everyday coding" },
  { id: "gpt-6-astra", name: "GPT-6 Astra", description: "Thorough · complex work" },
  { id: "gpt-6-luna", name: "GPT-6 Luna", description: "Fast · focused tasks" },
] as const
export type ModelId = typeof models[number]["id"]
export const defaultModel: ModelId = "gpt-6.1-sol"
export type TaskRequest = { prompt: string; owner: string; scope: "project" | "private"; modelId: ModelId }
export type TaskOption = { id: string; title: string; description: string; task: string; boundary: string; action: "open" | "create"; sourceSessionId?: string }
export type TaskAnalysis = { kind: "overlap" | "clear"; headline: string; explanation: string; checkedCount: number; sourceSessionId?: string; options: TaskOption[] }
export type FindingRef = { sourceSessionId: string; findingId: string; targetId: string }
export type SessionCommand =
  | { command: "bootstrap"; workspaceId?: string; initialWorkspace?: WorkspaceState }
  | { command: "replace"; workspaceId: string; workspace: WorkspaceState }
  | ({ command: "analyze"; workspaceId: string } & TaskRequest)
  | ({ command: "create"; workspaceId: string; choiceId?: string; sourceSessionId?: string } & TaskRequest)
  | { command: "message"; workspaceId: string; sessionId: string; prompt: string; modelId: ModelId }
  | { command: "add-context"; workspaceId: string; targetId: string; sourceSessionId: string; findingId: string }
export type SessionApiReply = { workspaceId: string; workspace: WorkspaceState; analysis?: TaskAnalysis; sessionId?: string; finding?: FindingRef }
export type SessionReply = { session: WorkspaceSession; finding?: FindingRef }
