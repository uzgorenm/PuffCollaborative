# Next.js product integration

This implements the existing MVP and team plan in an isolated copy of the current React/Next.js interface. The user requested copying that interface and combining the team's implementation into a working product. Existing demo fixtures remain available through an explicit demo mode; live mode never substitutes sample activity for failed requests.

## Scope and acceptance

Keep the Puff branding, person → total summary → individual sessions overview, parallel conversations and session dock. Connect project setup, saved project brief and personal focus, provisioned coding sessions, instructions and comments, run progress/cancellation, exact source inspection and context reuse to authenticated durable services. Show actual tool-review details before allowing a decision. Preserve session identity, drafts and reading position while inspecting another source. Private work remains server-authorized. Related-work suggestions must preserve deliberate alternatives and source attribution.

Reuse the team's coordination server, OpenCode runner harness, trusted selected export, safe-boundary target delivery, and Flower analysis/coordination modules. Maintain the fixed trusted member roster; an arbitrary display name is not an authenticated identity. Dynamic provisioning must create an isolated approved worktree and Session in the existing backend process, then adopt it as a shared Thread. No browser-provided worker identity or arbitrary filesystem path is trusted.

Real model/Flower execution requires a configured provider. Missing configuration is an explicit unavailable state. Deterministic runner integration tests and fixture scenarios do not prove live model or Flower collaboration.

## Implementation plan

1. Combine reviewed backend commits with the committed Next.js checkpoint and sidebar work in this copy. Reconcile conflicts here, preserve all active source checkouts, and verify the retained UI baseline.
2. Add a Next.js same-origin authenticated transport. Credentials belong in an HttpOnly session cookie or server configuration, never browser storage. Validate loopback backend URL, restrict routes, preserve backend errors and stable mutation identities. Add a typed projection from real project/member/thread/Run/WorkCard/event records to the existing UI; retain source IDs, revisions, approvals and delivery state. Tests exercise offline/auth failures, invalid payloads, real `done` status, exact source lookup and stale response rejection.
3. Complete server-owned dynamic Session provisioning and trusted owner selection. Add focused admission and retry tests before implementation. Complete the runtime launcher/configuration for an isolated database and workspaces. Provisioning failures remain resumable with a stable request identity.
4. Connect the React controller to the transport, preserving current styles and demo walkthrough. Add connection setup, project switching, durable brief/focus, task/session creation, live instructions/comments/cancellation, source review and reusable context, and reviewable tool decisions. Preserve drafts per Session; failed sends are retryable rather than fabricated replies.
5. Reconcile Flower analysis authorization and connect its permitted event export/result delivery to the existing safe-boundary admission. Verify privacy, target identity, source revision, retry deduplication, and revocation. Record analysis run IDs and admission/promotion/use independently.
6. Run focused server/core regressions, web tests/typecheck/build and independent browser walkthrough on a separate port. Record exact evidence and material remaining limits, then fetch/integrate incoming `serhat` commits and push normally. Leave `main` untouched.

## File ownership during execution

- Transport worker: new `apps/web/lib/coordination-client.ts`, `coordination-client.test.ts`, `live-workspace.ts`, `live-workspace.test.ts`, `server-connection.ts`, and `apps/web/app/api/coordination/[...path]/route.ts`, `app/api/connection/route.ts`.
- Backend worker: coordination provisioning/selection wiring and isolated runtime configuration, with focused server/core tests. Shared schema/protocol/client generation changes are coordinated with the root.
- React worker: `apps/web/app/page.tsx`, presentational components/styles, and a new live controller hook. Consume the transport contracts and do not duplicate backend state into localStorage.
- Root: integration commits, launcher, Flower wiring, documentation, independent verification and publication.

## Review focus

- Reconnection or actor/project changes must discard an old response and pending evidence.
- Duplicate requests must retain the original request identity; changed retries must conflict.
- No-access/offline sources must never be displayed as a successfully inspected citation.
- WorkCard freshness must stay distinct from execution state and person-stated focus.
- A decided tool approval whose delivery is pending must remain distinct from a delivered decision; work redirection is a separate authorization.

## Verification evidence

The copied workspace is `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-product`. Active teammate source checkouts were preserved. Verification used a separate private runtime and web port 3007; the deliverable runtime uses port 3006.

- Web tests: 53 pass after merging the team's latest repeatable-demo and compact-sidebar work, covering authenticated transport, actor/backend changes, durable retries, exact sources, consent, and tool-review scope. Web typecheck and production build pass.
- Product runtime tests: 9 pass / 42 assertions, covering one launcher owner, private atomic state, revocation before and after analysis, exact retries, uncertain admission, historical receipt reconciliation after activity/consent changes, and malformed receipts. A changed owner prevents historical credential reuse. Standalone runtime typecheck passes.
- Flower Python unit tests: 47 pass, including explicit instruction evidence revisions distinct from content activity. The live server's actual export was accepted by `build_product_job` with two trusted bindings and exact provenance/activity revisions. Malformed exports fail validation. This check did not submit a hosted Flower run.
- Relevant core regression: 149 tests / 569 assertions. Server HTTP/readiness tests: 2 tests / 149 assertions. Core, Server and generated Client typechecks and canonical migration check pass.
- After the team merge, the coordination suite passes 58 tests / 425 assertions and the journal suite passes 10 tests / 40 assertions. Owner instructions advance the content revision so cached analysis cannot miss a changed prompt; run status retains its separate project cursor. Fresh Core/Server typechecks, HTTP/readiness (2 / 149), and the full native runner suite (3 / 122) pass at this revision.
- Native runner fixtures: 3 tests / 122 assertions, plus the final awareness test rerun (25 assertions) after preserving indefinite human approval waits. They create real Git worktrees and OpenCode Sessions, exercise actual permission approval and a tool artifact, preserve parallel execution and restart/callback recovery, and verify informational awareness admission (sequence 2), promotion (sequence 7) and continuation output. Their model responses are deterministic fixtures.
- Merged native-app fix reuse/model tests: 15 pass / 59 assertions; app typecheck passes. Its simulator tests: 13 pass / 341 assertions, including real disposable patch/test execution. Those simulator receipts remain distinct from the live Next.js service.
- Browser walkthrough created two independent shared Sessions, submitted instructions through the embedded runner, displayed completed output, inspected an exact source, and sent reviewed context to the other Session. The receiving Session retained its identity and full conversation and completed a further fixture response. Restart retained both Sessions. A deliberate backend shutdown stopped the launcher and released its lock; the same runtime restarted successfully.

![Verification runtime after reviewed source was submitted to an independent Session](./product-verification.jpg)

The screenshot and browser conversations explicitly disclose the local fixture provider. They establish transport, persistence, target selection and runner execution, without establishing hosted model capability or actual interpretation/reuse of the source. Consent changed temporarily for export verification was restored to analysis off afterward.

## Remaining operational boundaries

No real coding-model provider was selected or supplied during this integration. The deliverable therefore reports model configuration as unavailable; a configured provider is necessary for real coding work. Flower login and its pinned Python environment must be enabled to run the hosted chain. No hosted chain was submitted from this product copy. Private Session provisioning remains unavailable and is explicitly reported as such. The legacy native app and its simulator remain separate interfaces; the live Next.js controller reads the durable coordination service.
