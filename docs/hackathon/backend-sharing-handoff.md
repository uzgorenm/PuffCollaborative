# Source Session sharing authorization handoff

`POST /api/coordination/v1/projects/:projectId/threads` now requires a trusted Session selection decision for the authenticated member. Project membership, a Session ID, a title, and the existing project/worker binding are insufficient. Without a selection source, new Thread creation returns `403` and stores no Thread or event. An exact retry of an already-created Thread still returns that Thread, and current project members can still read existing shared Threads.

The core port is `SessionSelection.canShareSession(userId, projectId, sessionId, workerId) -> Effect<boolean, Failure>` in `packages/core/src/coordination/access/selection.ts`. `Projects.createThread` calls it only after checking current member access, the Session's database project, and `SessionBinding.resolve`. The port is supplied through `CoordinationPorts.sessionSelection` at server composition. It must use authoritative server-side evidence that this authenticated user selected this exact Session for sharing with this project and worker. A UI field, title, project membership, or possession of a Session ID is not evidence. The Session table has no owner field, so the present database cannot infer this decision.

The current V2 and legacy Session records contain a project and optional workspace, but no authenticated member owner or coordination selection. Legacy `share_url` is a separate public sharing mechanism that can be enabled automatically; it does not prove a member selected a Session for a team Thread. The mock binding assigns its configured worker to every Session in the fixture. No production owner/worker/selection producer exists in this checkout.

Talha needs to provide an authoritative Session-to-member owner and worker registration source, plus an explicit selection/revocation action tied to the authenticated member, exact project, Session, worker and a durable selection revision. Serhat needs to inject a real `SessionBinding` and `CoordinationPorts.sessionSelection` from that source. A production grant must be revalidated at the durable Thread creation boundary: the current `canShareSession` call occurs before `EventV2.append` opens its insertion transaction, so an in-flight revocation could race with a create. The producer and Thread projection need a shared transaction or equivalent fencing rule before claiming revocation safety. No title, arbitrary Session metadata, member request field or legacy share URL can fill this gap. Until a real producer is wired, production Thread creation stays closed. Existing shared Thread reads remain governed by project membership; there is no unshare endpoint or downstream admission revocation in this slice.

The minimum producer record is an immutable `sessionId → projectId, workerId, ownerUserId` registration plus a durable, versioned coordination selection for that Session. Registration must originate from an authenticated Session creation/adoption path; the current instance-wide OpenCode credential alone cannot name `ownerUserId`. The selection action must resolve that same owner from trusted credentials, record its active or revoked state and revision, and reject a different member. At create, the consumer compares all four IDs against the authenticated principal and server-resolved binding, and must reject a missing, revoked or stale record. For revocation racing with creation, Serhat and Talha must define a serialized commit/fencing rule and the exact outcome of an already-committed request retry. The current port establishes the deny-by-default boundary but does not provide that atomicity by itself.

`GET /api/coordination/v1/status` reports readiness of the constructed coordination data service, including existing shared Thread reads. It does not certify that a particular member may share a new Session. This distinction preserves the current client connection flow: its status consumer treats 503 or `ready:false` as a complete service outage, while an existing shared Thread remains readable when selection is absent. In that state `/status` remains 200 with `{ "ready": true }`, an existing authorized Thread read remains 200, and a new share is 403. A separate sharing capability in the status schema would require a coordinated protocol and client change; consumers must use the create result as the current capability check.

This change does not establish that any particular historical Session was private, nor does it prove a real user selection flow.

For synthetic local demos only, mock-runner mode can load an explicit grant file from `OPENCODE_COORDINATION_DEV_SESSION_SELECTIONS_PATH`. The path is read only when the mock worker is active; a real runner cannot use this file path. Keep the file outside source control. Its shape is:

```json
{
  "allowed": [
    {
      "userId": "usr_alice",
      "projectId": "prj_demo",
      "sessionId": "ses_demo",
      "workerId": "wrk_demo"
    }
  ]
}
```

All four IDs must match the authenticated member and server-resolved binding. Missing, unreadable, or invalid files provide no grants. The file is loaded at service construction, so changing it requires rebuilding or restarting the handler. The fixture in `packages/server/test/coordination.integration.test.ts` writes this file beside its temporary roster and admission files, then deletes the directory after the test. Any other local mock setup that creates Threads must supply its own explicitly scoped synthetic grants.

Verification at this branch: the core sharing test rejected Bob's unselected same-project Session, a different same-project Session, a Session stored in another project and creation with no selection port; denied attempts stored no Thread or `thread.created` event. The HTTP test rejected Bob's forged selection fields and Alice's wrong-worker grant, accepted Alice's exact synthetic grants, and read an existing Thread after removing the grant source. It also checked that `/status` still reports data-service readiness while new sharing is denied. These are synthetic authorization tests, not evidence of a real OpenCode owner/selection adapter, user consent UI, revocation race protection, or private-event export filtering.
