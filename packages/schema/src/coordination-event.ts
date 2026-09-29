export * as CoordinationEvent from "./coordination-event"

import { Schema } from "effect"
import { Coordination } from "./coordination"
import { Event } from "./event"

export const Changed = Event.define({
  type: "coordination.changed",
  durable: { aggregate: "aggregateID", version: 1 },
  schema: {
    aggregateID: Schema.String,
    projectId: Coordination.ProjectID,
    threadId: Coordination.ThreadID,
    kind: Coordination.EventKind,
    occurredAt: Schema.String,
    actorId: Schema.optional(Coordination.UserID),
    runId: Schema.optional(Coordination.RunID),
    instructionId: Schema.optional(Coordination.InstructionID),
    payload: Schema.Record(Schema.String, Schema.Unknown),
  },
})

export const DurableDefinitions = [Changed] as const
