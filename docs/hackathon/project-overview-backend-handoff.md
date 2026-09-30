# Project overview backend handoff

## Implemented in this checkout

The source-level overview reader in `packages/core/src/coordination/overview/index.ts` joins only selected project Threads with their WorkCards, Runs, tool approvals, and exact EventV2 evidence. It labels missing, stale, and invalid analyst cards. Related-work candidates require a trusted server-side intent reader with exact project, Thread, Session, worker, owner, selected-topic, and revision binding; there is no durable intent producer or overview route yet. `Thread.createdBy` is a creator, not proof of Session ownership. Neither a WorkCard nor a tool approval authorizes work redirection, agent use, or a claim of completion.

The first durable slice is an owner-managed project brief and self-authored person focus:

| Layer                          | R1-owned file                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| Append-only revision migration | `packages/core/src/database/migration/20260929210000_coordination_project_context.ts` |
| Drizzle tables                 | `packages/core/src/coordination/overview/context.sql.ts`                              |
| Read/write service             | `packages/core/src/coordination/overview/context.ts`                                  |
| Public shapes and event kinds  | `packages/schema/src/coordination.ts`                                                 |
| Service interface              | `packages/core/src/coordination/contracts.ts`                                         |
| Four routes                    | `packages/protocol/src/groups/coordination.ts`                                        |
| Authenticated data handlers    | `packages/server/src/handlers/coordination-data.ts`                                   |
| SQLite/EventV2 tests           | `packages/core/test/coordination/overview/context.test.ts`                            |

The brief stores a goal, one to ten success criteria, role labels for current project members, selected tool names, `sharingDefault: "private"`, and `suggestedAwarenessMode: "off" | "review-each-note" | "allow-validated-topic-notes"`. The awareness field is starter guidance only. It is never an active target-Session permission or permission to redirect work. The owner writes the brief; any project member may read it. Members write only their own focus, including `null` to clear it; other project members may read current focus revisions. Writes carry a request ID and expected version. Exact retries return the original revision even after later writes or member changes; changed-payload retries and stale new writes conflict. Both revisions include authenticated identity and time. Event payloads contain revision metadata, not the brief or focus text.

The routes are `GET`/`PUT /api/coordination/v1/projects/:projectId/brief`, `GET /api/coordination/v1/projects/:projectId/focus`, and `PUT /api/coordination/v1/projects/:projectId/focus/me`. The focus author comes from the existing Basic-auth principal; no author ID is accepted in that write payload. The handlers return typed unavailable while `CoordinationRuntime.services` lacks `projectContext`.

## Backend candidate's held-file wiring

R1 did not edit `packages/server/src/coordination-composition.ts`, `packages/server/src/coordination-runtime.ts`, `packages/core/src/database/migration.gen.ts`, `packages/core/src/database/schema.gen.ts`, `packages/core/src/database/schema.json`, or generated clients. The backend candidate owns these integration steps after its freeze:

1. Register `import("./migration/20260929210000_coordination_project_context")` after the existing coordination migrations in `packages/core/src/database/migration.gen.ts`. Reconcile the generated schema snapshot and client using the repository's normal generation workflow; do not hand-edit generated client output.
2. Add `readonly projectContext: CoordinationContracts.ProjectContext` to `CoordinationServices` in `packages/server/src/coordination-runtime.ts`.
3. In `packages/server/src/coordination-composition.ts`, import `ProjectContext` from `@opencode-ai/core/coordination/overview/context`, then construct `const projectContext = ProjectContext.make({ db: database.db, access, events })` after those three dependencies exist. Include `projectContext` in the returned `services` object. This is the exact projection registration needed by the four handlers. The new EventKinds are already in `Coordination.EventKind`, so the existing `CoordinationEvents` journal can publish and replay them.
4. Run real authenticated HTTP checks after composition: owner brief write/read after restart; member focus write and cross-member read; outsider and non-owner denial; exact retry without another event; stale write 409. Generated client and overview UI consumption follow only after those checks.

The local service and routes alone do not prove an HTTP or native workflow. The overview reader still needs a server-owned, versioned Session-intent producer before related-work candidates can be trusted. Session selection, private-session sharing, target awareness policy, delivery/promotion/use receipts, and exact owner approval for each work-redirection instruction remain separate work.

## Verification

The brief/focus tests use real SQLite and EventV2, including replay after reopening the database and an aborted projection that leaves neither a revision nor an event. The overview reader has its own SQLite/EventV2 source test with a fixture-supplied trusted intent reader. At this handoff, the focused and adjacent core checks passed (13 tests, 151 assertions); the existing server coordination integration test passed (1 test, 51 assertions); schema, protocol, core, and server typechecks passed; and Prettier and `git diff --check` passed. Tests used repository-pinned Bun 1.3.14. No brief/focus HTTP or native result is claimed here.
