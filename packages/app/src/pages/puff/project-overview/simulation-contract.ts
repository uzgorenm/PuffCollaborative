import { Schema } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"

const Comparison = Schema.Struct({
  id: Schema.String,
  classification: Schema.String,
  threadIds: Schema.Array(Coordination.ThreadID),
  topic: Schema.optional(Schema.String),
  topics: Schema.optional(Schema.Array(Schema.String)),
  finding: Schema.optional(Schema.NullOr(Schema.String)),
})

const SourceRef = Schema.Struct({
  threadId: Coordination.ThreadID,
  eventId: Schema.String,
  seq: Schema.Int,
})

export const SimulationManifest = Schema.Struct({
  simulated: Schema.Literal(true),
  mode: Schema.Literal("synthetic"),
  label: Schema.Literal("SIMULATED"),
  selectedScenarioId: Schema.Literals(["wf01", "wf02", "wf03"]),
  scenarios: Schema.Array(Schema.Struct({
    id: Schema.Literals(["wf01", "wf02", "wf03"]),
    projectId: Coordination.ProjectID,
    title: Schema.String,
    classification: Schema.String,
    summary: Schema.String,
    threadIds: Schema.Array(Coordination.ThreadID),
    privateSessionExcluded: Schema.optional(Schema.Boolean),
    comparisons: Schema.optional(Schema.Array(Comparison)),
  })),
  actors: Schema.Array(Schema.Struct({
    username: Schema.String,
    userId: Coordination.UserID,
    displayName: Schema.String,
    role: Schema.String,
  })),
  taskStart: Schema.optional(Schema.Struct({
    projectId: Coordination.ProjectID,
    completed: Schema.Struct({
      id: Schema.String,
      task: Schema.String,
      matchPhrases: Schema.Array(Schema.String),
      threadId: Coordination.ThreadID,
      reportedBy: Coordination.UserID,
      result: Schema.String,
      sourceRef: SourceRef,
    }),
    remaining: Schema.Array(Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      rationale: Schema.String,
      sourceRef: SourceRef,
    })),
  })),
  wf02: Schema.optional(Schema.Struct({
    stage: Schema.Int,
    phase: Schema.Literals(["source", "admitted", "promoted", "used"]),
    sourceRef: SourceRef,
    targetThreadId: Coordination.ThreadID,
    milestones: Schema.Array(Schema.Struct({
      phase: Schema.Literals(["source", "admitted", "promoted", "used"]),
      state: Schema.Literals(["simulated_observed", "simulated_current", "simulated_future"]),
      receiptId: Schema.String,
      observedAt: Schema.NullOr(Schema.String),
      sourceRef: SourceRef,
      targetThreadId: Coordination.ThreadID,
    })),
  })),
})
export type SimulationManifest = typeof SimulationManifest.Type

export function scenarioForProject(manifest: SimulationManifest, projectId: string) {
  return manifest.scenarios.find((scenario) => scenario.projectId === projectId)
}

export function validSimulationManifest(value: SimulationManifest) {
  const phases = ["source", "admitted", "promoted", "used"]
  const wf01 = value.scenarios.find((scenario) => scenario.id === "wf01")
  const wf03 = value.scenarios.find((scenario) => scenario.id === "wf03")
  const comparisons = wf03?.comparisons ?? []
  const taskStart = value.taskStart
  const sameSource = (ref: { threadId: string; eventId: string; seq: number }) => !!taskStart &&
    ref.threadId === taskStart.completed.sourceRef.threadId &&
    ref.eventId === taskStart.completed.sourceRef.eventId && ref.seq === taskStart.completed.sourceRef.seq
  return value.scenarios.length > 0 &&
    new Set(value.scenarios.map((scenario) => scenario.id)).size === value.scenarios.length &&
    new Set(value.scenarios.map((scenario) => scenario.projectId)).size === value.scenarios.length &&
    value.scenarios.some((scenario) => scenario.id === value.selectedScenarioId) &&
    (!wf01 || wf01.privateSessionExcluded === true) &&
    (!wf03 || (comparisons.length === 2 &&
      comparisons.some((item) => item.classification === "likely_overlap" && !!item.finding) &&
      comparisons.some((item) => item.classification === "none" && item.finding === null))) &&
    (!taskStart || (!!wf03 && taskStart.projectId === wf03.projectId &&
      taskStart.completed.threadId === taskStart.completed.sourceRef.threadId &&
      taskStart.completed.sourceRef.seq >= 1 && taskStart.completed.result.trim().length > 0 &&
      value.actors.some((actor) => actor.userId === taskStart.completed.reportedBy) &&
      taskStart.completed.matchPhrases.length > 0 &&
      taskStart.completed.matchPhrases.every((phrase) => phrase.trim().length > 0) &&
      taskStart.remaining.length > 0 && new Set(taskStart.remaining.map((item) => item.id)).size === taskStart.remaining.length &&
      taskStart.remaining.every((item) => item.title.trim().length > 0 && item.rationale.trim().length > 0 && sameSource(item.sourceRef)))) &&
    (value.scenarios.some((scenario) => scenario.id === "wf02") === !!value.wf02) &&
    (!value.wf02 || (value.wf02.stage >= 0 && value.wf02.stage <= 3 &&
      phases[value.wf02.stage] === value.wf02.phase && value.wf02.sourceRef.seq >= 1 &&
      value.wf02.milestones.length === phases.length &&
      value.wf02.milestones.every((milestone, index) => milestone.phase === phases[index] &&
        milestone.state === (index < value.wf02!.stage ? "simulated_observed" : index === value.wf02!.stage ? "simulated_current" : "simulated_future") &&
        (index <= value.wf02!.stage ? !!milestone.observedAt : milestone.observedAt === null) &&
        milestone.sourceRef.threadId === value.wf02!.sourceRef.threadId &&
        milestone.sourceRef.eventId === value.wf02!.sourceRef.eventId &&
        milestone.sourceRef.seq === value.wf02!.sourceRef.seq)))
}
