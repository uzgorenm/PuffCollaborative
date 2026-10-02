import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import type { CoordinationActivity } from "@opencode-ai/core/coordination/activity/activity"
import { Context } from "effect"
import type { CoordinationProvisioning } from "@opencode-ai/core/coordination/provisioning/index"
import type { CoordinationCooperation } from "@opencode-ai/core/coordination/cooperation/index"
import type { CoordinationAnalysisResults } from "@opencode-ai/core/coordination/analysis/results"

export interface CoordinationServices {
  readonly access: CoordinationContracts.Access
  readonly projects: CoordinationContracts.Projects
  readonly comments: CoordinationContracts.Comments
  readonly snapshot: CoordinationContracts.Snapshot
  readonly events: CoordinationContracts.Events
  readonly queue: CoordinationContracts.Queue
  readonly runner: CoordinationContracts.Runner
  readonly approvalReview?: import("@opencode-ai/core/runner-harness/contracts").RunnerHarnessContracts.Approvals["review"]
  readonly workCards: CoordinationContracts.WorkCards
  readonly activity: CoordinationActivity.Interface
  readonly projectContext: CoordinationContracts.ProjectContext
  readonly provisioning?: CoordinationProvisioning.Interface
  readonly cooperation: CoordinationCooperation.Interface
  readonly sessionBinding: CoordinationContracts.SessionBinding
  readonly analysisResults: ReturnType<typeof CoordinationAnalysisResults.make>
}

export interface CoordinationRuntimeValue {
  readonly missing: ReadonlyArray<string>
  readonly authentication?: CoordinationContracts.Authentication
  readonly services?: CoordinationServices
}

export class CoordinationRuntime extends Context.Service<CoordinationRuntime, CoordinationRuntimeValue>()(
  "@opencode/CoordinationRuntime",
) {}
