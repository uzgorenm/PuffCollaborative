# Two-user MiniMax M3 integration

- Tested commit: `09c625fe2f846ae16777f0d4638b594714c43a1c`.
- Result: PASS for the isolated OpenCode task and connected web path described below. This receipt does not close an acceptance gate.
- Evidence kinds: source/configuration, unit, integration, and live local service/browser.

## Live run

Alice and Bob shared one disposable project and received separate OpenCode Sessions and Git worktrees. The MiniMax-M3 runner completed both initial tasks: Alice added compact project navigation; Bob added a top-bar alternative. Each worktree changed only `src/app.ts`, kept its own approach, passed `git diff --check`, and rendered both projects with the current project marked when executed with Bun.

Two production Next.js instances used separate Alice and Bob member profiles against the same coordination service. Both `/live` pages showed both Sessions. Each user could submit to their own Session, while the other user's Session opened read-only. Alice and Bob submitted follow-up messages concurrently from the UI; both requests returned HTTP 200, both second Runs completed, and both pages displayed assistant replies.

The provider configuration used the local MiniMax-compatible Token Factory endpoint and the ignored `hackathon/flower/.env` file. No credential was added to tracked files or this receipt. Model output was limited to disposable worktrees.

## Checks

- `apps/web`: 51 tests passed; typecheck and production build passed.
- `packages/app`: 839 unit tests and 48 browser tests passed; typecheck and production build passed. Vite reported existing chunk-splitting and duplicate source-map warnings.
- `packages/server`: 11 coordination integration/E2E tests passed with 1,162 assertions; typecheck passed.
- `hackathon/simulated-coordination`: 13 tests passed with 341 assertions.
- `hackathon/alice-preview`: 3 tests passed with 77 assertions; its Python Guardian suite passed 10 tests.
- `hackathon/flower`: 38 Python tests passed; targeted Ruff checks passed; `session`, `coordination`, and `guardian` Flower apps built with `MiniMaxAI/MiniMax-M3` selected.

## Limits

This run verifies two-user Session execution and the connected UI. The disposable task fixture has no broader package test suite; its two render functions received smoke checks. It does not test transferring a new finding from Alice into Bob's already-running Session, so WF02 remains open. The Flower worker was disabled for this OpenCode run; no live SuperGrid cooperation was exercised, so G2/WF10 remain open. The UI check did not exercise private Sessions or outsider access, so it does not close WF01.
