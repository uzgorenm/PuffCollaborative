# Project overview integration handoff

This is the expanded solo-to-team product slice requested after the hackathon MVP. It is separate from the current WF02/WF10 live-awareness gates. The isolated app checkpoint `2a7d8bba76` is based on `d1ec774099`; the coordinator integrated it with the published ownership-label correction as `6aadf49887`. See the [publication receipt](evidence/2026-09-29-project-overview.md).

## Exclusive UI boundary

The implementation chat owns new files under `packages/app/src/pages/puff/project-overview/`. After the frontend lead released the host paths, it also integrated the overview into `team-shell.tsx`, `team-thread.tsx`, `team-api.ts`, `team-state.ts`, the English dictionary and team CSS. It has not edited the shared schema, server, context panel, or native QA checkout. R6 owns kickoff and approval UX; the context-panel owner owns its source peek. The integration coordinator alone writes/pushes `main`.

## Available authoritative inputs today

- `GET /api/coordination/v1/projects`: project ID, name, creator, creation time for authorized members.
- `GET /api/coordination/v1/projects/:projectId`: project plus authorized member identities and roles.
- `GET /api/coordination/v1/projects/:projectId/threads`: selected shared thread IDs, Session/worker IDs, title, creator, creation time, activity sequence. The endpoint does not enumerate private sessions.
- `GET /api/coordination/v1/projects/:projectId/work-cards`: per-thread analyst-reported task, progress, blocker, status, recent outcome, evidence refs, source activity sequence and generation/update times. A card may be absent or stale. It is not the owner's stated focus.
- `GET /api/coordination/v1/threads/:threadId`: current run and tool-approval state. Tool approval is separate from approval to redirect another agent's work. A run state is not a delivery/use receipt.

The overview only joins records by exact project/thread IDs. An absent or stale card stays visibly unknown/stale. It will label a source-linked outcome as reported until the cited event and actual outcome are inspected. Personal unshared sessions stay in the private rail; their content is not included in the project overview or Flower input.
`Thread.createdBy` is a creator, not a verified Session/worker owner. The person grid attributes an agent report only when the server supplies an exact authorized Thread/Session/worker/owner binding; otherwise the work card says who started the shared Thread and leaves agent ownership unknown.

## Needed for the full requested workflow

1. **Durable kickoff:** versioned project brief with goal, success criteria, people and roles, selected tools, sharing defaults and approval preferences. Store an actor and timestamp for each revision. A starter context document or project record must be retrievable after restart and in a new Session. The overview can show the latest authorized version; it cannot silently create shared context from a local draft.
2. **Person focus:** an owner-stated focus with author/time, distinct from agent-inferred work. A teammate's running agent does not prove that person is present or working now.
3. **Explicit session intent:** project-selected sharing, topic/work item, and `alternative`/`related`/`unspecified` relationship, with an owner-set label and revision. Similar text alone is only a tentative related-work suggestion. Private sessions remain outside project/Flower reads.
4. **Related-work decisions:** source-linked candidate referencing ongoing or completed exact sessions and evidence; recorded human choice to inspect, continue, reuse, or keep a separate approach. Continuing or reusing must route through the existing Session/worker and normal permissions; no silent duplicate task, automatic merge, or agent redirection.
5. **Delivery and authority:** separate pending, admitted, promoted, and observed-use receipts tied to source revision and exact target Session. A work-redirection proposal needs owner identity, exact text/version/target/evidence and one-person approval; subsequent tool permissions remain separate. Approval firmness is a project preference, not blanket permission for shell commands, code merges or future redirections.
6. **Human review requests:** a targeted, attributed request to inspect context can be deferred, declined or submitted. A request appearing in a viewer's UI is not a decision. This needs a durable target/actor/state record and exact idempotent response, separate from tool approval and work redirection.

Until a route/service exists for these records, kickoff, preference, relatedness and use controls must stay disabled or explicitly local draft-only. Do not serialize credentials or private Session text in the brief. Confirm contract names and auth with Serhat before host/client wiring.

### First durable vertical slice requested by the coordinator

Implement an authenticated project brief and self-authored person focus before adding more inferred overview fields. The brief writes goal, success criteria, roles, tools and sharing/approval preferences to one versioned project record with actor/time, read back after restart by authorized members. The focus writes a person's own statement, version and time; another member can read it but cannot edit it. A project owner may manage the brief, while ordinary members may update only their own focus. Read and write routes must reject outsiders and stale versions. This is a statement/preferences store: it does not grant Session access, share a private Session, approve a tool, redirect work, or claim a target agent used context.

R1 owns proposing exact new migration, schema, service, protocol, handler, registration and tests in `docs/hackathon/project-overview-backend-handoff.md`; the coordinator reconciles those paths with Serhat's current project model before implementation. The UI can consume the confirmed brief/focus version and actor after those endpoints exist. Selected Session intent and topic must have a separate trusted owner/worker producer and revocation policy. No project member may assert another worker's Session ownership by supplying IDs in a client payload.

## Integration and acceptance

The frontend lead should pass the authorized project, members, selected threads, cards, snapshots and freshness state into the overview. Load only exact source refs through the current authenticated service, retaining the target conversation and any unsent draft. Match the latest state before enabling actions. On narrow screens, all essential status and inspect actions must work by tap and keyboard, with hover as an optional convenience.

Verify: one person's two sessions, four members with distinct stated/inferred focus, absent/stale cards, a private session excluded from shared reads, a deliberate alternative, an ongoing possible overlap, completed source-backed work, project restart/new-Session brief retrieval, owner-approved exact redirection, wrong-owner rejection, and actual target admission/promotion/use. Record source tests, UI observation, and live Flower/OpenCode evidence separately; a fixture or build alone does not satisfy the final cases.

## Mounted read-only checkpoint

The `/puff` route now mounts the source-backed overview. The sidebar has a Project overview link and current-report summaries. The client reads authorized project membership, selected Threads, work cards and exact Thread snapshots. It rejects a mixed activity revision rather than calling a stale card current. It distinguishes a Thread creator from a verified Session owner, so person-owned agent reports remain unattributed until the server supplies that owner binding. It lists local Sessions outside the current selected project separately; listing them does not share their content. Source inspection uses the authenticated exact-event lookup in a local peek, including event kinds omitted from the conversation timeline, and does not navigate away from the current Session or erase a draft.

The mounted route currently passes no durable person-stated focus, selected topic/relationship, or trusted Session owner binding because their producers are not registered. It therefore shows no inferred related-work choices and no automated redirection. The kickoff brief, per-target approval mode, admission/promotion/use receipts and human review decisions remain separate backend/UX work. The backend overview service and proposed brief/focus migration in this checkout are R1's untracked work and are not part of the app checkpoint.

Local verification for the app checkpoint: 63 focused API/controller/model/SSR view tests passed; `packages/app` typecheck passed. The isolated web preview on `/puff` displayed the disconnected Project work sidebar, overview entry, and Connect team action. Connected multi-member and native walkthrough evidence is pending QA's separate profile with the synthetic coordination service. A build pass and source inspection do not establish live Flower target use.
