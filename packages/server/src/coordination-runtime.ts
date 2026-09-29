import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"
import type { CoordinationActivity } from "@opencode-ai/core/coordination/activity/activity"
import { Context } from "effect"

export interface CoordinationServices {
  readonly access: CoordinationContracts.Access
  readonly projects: CoordinationContracts.Projects
  readonly comments: CoordinationContracts.Comments
  readonly snapshot: CoordinationContracts.Snapshot
  readonly events: CoordinationContracts.Events
  readonly queue: CoordinationContracts.Queue
  readonly runner: CoordinationContracts.Runner
  readonly workCards: CoordinationContracts.WorkCards
  readonly activity: CoordinationActivity.Interface
}

export interface CoordinationRuntimeValue {
  readonly missing: ReadonlyArray<string>
  readonly authentication?: CoordinationContracts.Authentication
  readonly services?: CoordinationServices
}

export class CoordinationRuntime extends Context.Service<CoordinationRuntime, CoordinationRuntimeValue>()(
  "@opencode/CoordinationRuntime",
) {}
