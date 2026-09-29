# Work-card integration request for Agent 1

The feature services live in `work-card/work-card.ts` and `activity/activity.ts`. They use the shared `Database.Service` and `Events` journal. Register their layers with the same database instance as the other coordination services.

1. Add `20260929190020_coordination_work_card` to the generated migration list and fresh database schema. The feature test applies this migration directly until registration lands.
2. Extend the shared `Coordination.WorkCard`, `CoordinationContracts.WorkCards`, and protocol work-card payload and responses with `recentVerifiedOutcome`, `contributors`, `evidenceRefs`, `generatedAt`, `projectId`, and `submittedBy`. Keep `expectedVersion` and `sourceActivitySeq` on the update request. The work-card service also exposes authorized `read` and `list` methods.
3. Supply `projectMembers(projectId)` from Agent 2's membership storage when composing `WorkCard.make`. This is a trusted internal lookup called after `Access.getThread` authorizes the analysis credential for `update_work_card`. `Projects.get` cannot serve this lookup because it requires member read access.
4. Bind the reserved GET, PUT, list, and activity routes to these services. Pass the authenticated `Coordination.AuthContext` from the coordination middleware; do not take identity from the request body. Map the service's `Failure.code` to the declared HTTP errors. Publish the activity response shape from `CoordinationActivity.View` in the protocol instead of `Schema.Unknown`.

`WorkCard.status` is analysis text metadata. The activity service derives execution status from Runs and approvals. Queue and runner services should never wait for a card or an analysis job.
