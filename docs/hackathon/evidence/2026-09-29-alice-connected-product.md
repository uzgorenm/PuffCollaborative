# Connected Alice product slice — September 29

Source changes: `fc675a935f` and `3e41e58de3`. Publication integration checkpoint: `6ea245fbbfedb1750a163111273a0733faba74b2`, which preserves incoming `origin/serhat` activity-sidebar work. The incoming changes affect the separate Solid app and documentation; the connected Next.js slice and coordination backend remain unchanged by that merge.

## Observed behavior

`apps/web` now has `/live`, consuming the registered `/api/coordination/v1` service through server-side member authentication. The page shows person → combined work summary → sessions, compact status dots, individual conversations, the original task, actual Run states and bottom project summaries. The owner can inspect an exact source event and add it as one attributed instruction to the existing receiving Thread. Private unshared Sessions are excluded by the backend; another person's Thread is read-only in this workspace.

The source case is a human-authored isolated scenario backed by a real Bun port collision and a successful HTTP `/health` check. It is not an Alice model transcript. The current configured server measured collision on port 65515 and recovery on 65519 with HTTP 200.

Browser inspection confirmed the exact Alice event `evt_0efa2fb6b001VY2Txo5L2enYC5`, project sequence 4, preserved task and source context after reload, actual failure display, and desktop/mobile layouts. [Saved source context](assets/2026-09-29-alice-context-saved.png) and [persisted receiving session](assets/2026-09-29-alice-session-persisted.png) are browser captures cropped to the returned application's bounds; no interface content was generated or changed in the captures.

## Checks

- Next.js package: 22 tests, typecheck and production build pass.
- Isolated backend/proxy/config checks: 3 tests, 77 assertions pass. These exercise real local HTTP, SQLite and the native config loader. The no-model profile proves preparation is unavailable rather than fabricating output.
- Guardian capture/citation checks: 10 Python tests pass. The first sandbox attempt could not bind its temporary loopback server; the allowed local test run passed.
- Native configuration regression proves file-backed credentials, quotes, backslashes and dollar replacement tokens are preserved exactly, with private permissions. It makes no inference request.
- Owner-only writes, foreign-origin rejection, exact source tuple, changed WorkCard version, changed target activity/latest instruction, unrelated current task, and retry reconciliation pass. Repeated source addition returns the original instruction/Run, including after a later source correction.
- Post-integration web tests and native configuration checks were repeated successfully at `6ea245fbbf`. No additional model request was needed for that merge.

## Actual native execution and dependency

The official Flower/OpenCode Responses configuration is provisioned in an isolated private native config directory; the legacy environment variable alone did not reach the native `Config.Service`. No user-wide settings or repository credentials were changed.

The user explicitly authorized model-catalog access and the receiving-session inference test. The catalog, SuperGrid Control preflight and actual Responses model requests rejected the supplied credential with HTTP 401. The initial task and the accepted Alice context were each durably admitted and promoted into the same real receiving Session. Both produced persisted native assistant error receipts and failed Runs, with zero successful model outputs. The [sanitized native receipt](assets/2026-09-29-alice-native-model-receipt.json) records the correlated Run/message IDs and source-context presence.

Configured backend: `http://127.0.0.1:4482`. Built web preview: `http://127.0.0.1:3010/live`, bound to loopback. Checkout: `/Users/mac/Desktop/Coding/Hackathon/Puff/PuffCollaborative-alice-product`. Runtime credentials and raw receipts remain in owner-readable temporary files; the web receives no credential values. The earlier unconfigured 4478 preview was preserved during the configured test.

A valid Flower key with Endeavor access remains necessary for successful receiving-model use. The optional guardian helper is prepared, but no paid guardian run/result was observed. The web's narrow `EADDRINUSE` matching is deterministic, and source reuse requires an explicit owner action. The existing instruction endpoint has no atomic source/target revision condition, so an intervening remote mutation between the final read and POST remains a backend follow-up. This manual pipeline checkpoint closes no WF02/WF10 or live-awareness gate.
