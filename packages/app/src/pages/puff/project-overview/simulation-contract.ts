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
  return value.scenarios.length > 0 &&
    new Set(value.scenarios.map((scenario) => scenario.id)).size === value.scenarios.length &&
    new Set(value.scenarios.map((scenario) => scenario.projectId)).size === value.scenarios.length &&
    value.scenarios.some((scenario) => scenario.id === value.selectedScenarioId) &&
    (!wf01 || wf01.privateSessionExcluded === true) &&
    (!wf03 || (comparisons.length === 2 &&
      comparisons.some((item) => item.classification === "likely_overlap" && !!item.finding) &&
      comparisons.some((item) => item.classification === "none" && item.finding === null))) &&
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
