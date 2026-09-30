export type LiveStatus = "running" | "waiting" | "complete" | "blocked" | "unknown"
export type LiveThreadSummary = {
  id: string; title: string; ownerId: string; status: LiveStatus; summary: string; originalTask: string; updatedAt: string
}
export type LiveWorkspace = {
  project: { id: string; name: string; goal?: string }
  viewer: { id: string; name: string }
  members: { id: string; name: string; initials: string; color: "green" | "purple" | "blue" | "orange" }[]
  threads: LiveThreadSummary[]
  defaultThreadId?: string
  runnerAvailability?: string
}
export type LiveMessage = { id: string; role: "user" | "assistant" | "system"; author: string; text: string; createdAt: string }
export type LiveEvent = { id: string; seq: number; kind: string; text: string; createdAt: string; author: string }
export type LiveThread = {
  thread: LiveThreadSummary; instructions: string[]; messages: LiveMessage[]; events: LiveEvent[]
  executions: { id: string; status: string; detail?: string }[]
}
export type LiveFinding = {
  sourceThreadId: string; eventId: string; seq: number; ownerName: string; threadTitle: string
  title: string; problem: string; solution: string; cardVersion: number; sourceActivitySeq: number
  targetActivitySeq: number; targetInstructionId: string
}
export type LiveSource = { finding: LiveFinding; thread: LiveThreadSummary; event: LiveEvent; messages: LiveMessage[] }
export type LiveReceipt = { requestId: string; status: string; executionId: string; instructionId: string; detail?: string }
