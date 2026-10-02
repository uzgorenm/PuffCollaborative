# Puff Collab coordination contract

The implemented HTTP boundary is `/api/coordination/v1`. Schemas live in `packages/schema/src/coordination.ts`, service ports in `packages/core/src/coordination/contracts.ts`, and registered routes in `packages/server/src`. The TypeScript source is authoritative.

## Identity and access

Members authenticate individually through the configured Basic credential roster. Member identity comes from the server resolver; request bodies and display names cannot select an actor. Runner and analysis identities have separate scopes and credentials. Missing authentication, project admission, or a required identity adapter fails closed.

A shared project binds an existing OpenCode Project. Membership controls access. The provisioner accepts only configured repository/revision pairs and allowed users. It creates a durable reservation, isolated Git worktree, owner-bound Session, and shared Thread using a stable request identity. A Thread ID, Session ID, worker ID, and workspace ID have different roles and must not be substituted for one another.

The source launcher has a fixed four-member roster. It provides no self-service account registration or public hosting boundary. Embedded tools run as trusted local work; a permission approval is not a filesystem sandbox.

## Ordering and retries

Instruction admission assigns a thread-local queue sequence in the transaction that creates its Run. One nonterminal Run occupies a thread's execution lane; separate threads can run concurrently. The verified Session owner can instruct the native coding agent. Other project members can contribute attributed comments.

`queued → reserved → running → completed` is the normal progression. Approval waits, cancellation, failures, and recovery are explicit Run states. Acknowledging an instruction or cancellation request does not establish execution or completion. Unknown post-crash execution enters recovery rather than replaying provider work blindly.

Mutations carry stable `requestId` values. Exact retries return the original result; conflicting reuse fails. Runner message IDs and approval decision IDs also remain stable across ambiguous transport outcomes. Permissions require the reviewed tool identity, fresh approval version, and a durable authoritative decision before native reply.

## Revisions and evidence

- `Event.seq` is the durable project-wide journal sequence, sparse within one Thread.
- `Thread.activitySeq` is its latest content-changing event sequence.
- `WorkCard.version` is its own compare-and-swap version.

Content events and thread revision updates commit together. Work cards cite current source revisions and matching journal events. Their factual status and contributors come from trusted records. Writing a summary does not advance execution or prove code correctness.

Project briefs and self-authored focus use versioned writes. Event replay and subscriptions remain project-authorized, including after membership revocation. UI reads discard results returned for a different authenticated account.

## Flower consent and results

Thread sharing does not grant hosted analysis consent. Owner-selected metadata analysis and bounded instruction/output text are separate permissions. Export captures current source/target selections, Session owners, worker bindings, exact source references, and revisions.

The analysis identity registers validated candidates. The backend rechecks selection and source currentness before work-card writes or awareness admission. Informational note registration, durable Session admission, transcript promotion, and model use have distinct receipts. Task redirection remains approval-required.

The UI uses authenticated member proxy routes. Runner callbacks and analysis result registration stay on their scoped backend ports. See [Flower setup](../integrations/flower/README.md) and [runner behavior](runner-contract.md).
