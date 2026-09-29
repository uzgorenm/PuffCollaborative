# Puff team interface

Open `/puff` in the existing OpenCode app. Both home layouts have a Team workspace link. The view uses the existing SolidJS app, UI Button component, theme and localization; it does not implement another coding runtime.

## Current evidence boundary

The default view is a prominently labeled synthetic preview. Its canned summaries, Flower IDs, target text and acknowledgment are presentation data, not a real session or Flower run. Preview actions stay local. A worker acknowledgment does not establish durable admission, promotion into a conversation, or use by an agent; the UI states that distinction.

The normal connection form uses individual Basic credentials and calls the registered `GET /api/coordination/v1/status` endpoint. At the inspected backend version its handler returns 503. Even a successful readiness check does not manufacture a session snapshot or enable the old API: the page remains synthetic and reports that integration is pending.

In development only, the form exposes a **Development fixture (provisional API)** option. This exercises the earlier `/puff/v1` adapter against a separately supplied synthetic service. It is not compatible with the current backend and is not a replacement contract. Production builds omit this option. `project-api.ts` and `preview.ts` remain UI-owned provisional code pending G0 reconciliation.

## Backend handoff

Serhat owns these decisions in `docs/coordination-contract.md` and `docs/hackathon/integration-gates.md`:

| Required UI evidence                                             | Current backend / remaining mapping                                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Server-validated viewer and worker ownership                     | Individual Basic auth is specified; no identity/snapshot HTTP response is registered yet. Do not derive identity from a typed username. |
| Selected sessions, topic, alternative relationship, mute/unshare | Current Thread has sessionId/workerId/createdBy/activitySeq; topic/consent/revocation need an agreed service contract.                  |
| Source-backed approach and work status                           | WorkCard/sourceActivitySeq differs from the provisional Summary/per-session revision. A project cursor is not a session revision.       |
| Awareness note and actual admission/promotion/use receipts       | No agreed HTTP representation yet. A Run/tool approval is not an awareness note or work-redirection approval.                           |
| Conversation navigation                                          | Provide a verified worker-to-OpenCode server key already configured in the viewer. Never substitute the viewer's localhost.             |
| Work redirection and accepted project knowledge                  | Wire only after their exact operations and authorization exist. The provisional controls are synthetic/development-only.                |

Missing viewer identity disables ownership-dependent fixture actions. Missing server mapping disables conversation links. Polling uses two-second intervals, disables writes on a lost/stale snapshot and never starts a coordination job. Pending request IDs survive reconnect in session storage, scoped by service/project; member credentials and shared content are never persisted there. Approvals reuse stable IDs for exact retries. Definitive submission rejection releases a pending job; ambiguous failures preserve its ID.

All text is rendered as text, including generated proposals and evidence. All UI copy uses `language.t`. Other locales explicitly fall back to the Puff English dictionary; this is not a claim of completed translations.

## Run and verify

Use Bun 1.3.14 and the repository lockfile. From `packages/app`:

```sh
bun dev -- --host 127.0.0.1 --port 4444
bun test --conditions=solid src/pages/puff src/i18n/parity.test.ts
bun typecheck
bun run build
bun run test:unit
bun run test:browser
```

The focused HTTP tests bind temporary loopback ports. This session installed Bun at `/tmp/puff-toolchain/bun-darwin-aarch64/bun`; prepend its directory to PATH if Bun is not otherwise installed. The preview runs without an OpenCode backend. Opening real conversations requires the configured original backend.

Manual checks include desktop/mobile, source inspection, edit/approve/reject, exact edited decision text, stale changes during review, missing acknowledgments, mute during a pending job, reconnect without a second job, malformed model text, connection loss and rejected submissions. See the Serdar UI evidence receipt for exact results and remaining integration gates.
