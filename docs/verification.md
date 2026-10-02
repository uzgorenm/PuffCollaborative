# Puff Collab verification

Verified source commit: [`a32de9f2d1d0919a1490b38180685b1dee2b4c53`](https://github.com/uzgorenm/PuffCollaborative/commit/a32de9f2d1d0919a1490b38180685b1dee2b4c53). Checked on macOS arm64, October 2, 2026 UTC, with Bun 1.3.14, Node 24.19.0, and Python 3.11.16.

Builds and focused checks used the source tree recorded by this commit. The complete server run and final browser restart checks ran after the commit. The following documentation-only commit adds this receipt.

## Install and build

- Root `bun install --frozen-lockfile` passed. The web app's previous npm dependency directory was removed before this check; Bun recreated the workspace links.
- `bun run build` passed in `apps/web`, `packages/app`, and `packages/desktop`. The Electron build included the embedded Node backend, compatible CLI, icons, and Solid renderer.
- `bun typecheck` passed in `apps/web`, `packages/app`, `packages/server`, and `packages/desktop`.
- `bun start` launched the authenticated backend and web app together. Restart preserved member credentials, shared threads, and recorded completed runs. Temporary web/backend ports were 3017/4497.
- `uv sync --frozen` passed in `integrations/flower`. Both documented `flwr build` commands produced local AgentApp bundles.
- Stale branding, removed-file references, and whitespace checks passed. The repository URL and compatible OpenCode identifiers remain intentionally unchanged.

## Retained checks

Run Bun tests from the indicated directory, never from the repository root.

| Directory             | Checks                                                                                                                                                         | Result                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `apps/web`            | `bun test lib`                                                                                                                                                 | 34 passed              |
| `script/runtime`      | `bun test`                                                                                                                                                     | 9 passed               |
| `packages/core`       | Existing `test/coordination` checks                                                                                                                            | 58 passed              |
| `packages/app`        | Existing Puff team/context/fix checks and locale parity, with the package's Solid/happydom setup                                                               | 60 passed              |
| `packages/server`     | `coordination.integration`, `coordination-model-readiness`, `runner-harness.integration`, `runner-harness-authorization`, and `coordination-e2e/{smoke,suite}` | 16 passed              |
| `integrations/flower` | `uv run python -m unittest discover`; `uv run ruff check .`                                                                                                    | 48 passed; lint passed |

Server process checks use fixture runners and real authenticated services, SQLite, event streams, migration, cancellation, approval, and crash/restart boundaries. The seeded queue case used four members, 20 threads, and 100 accepted instructions. Native runner checks exercise the embedded OpenCode implementation with a deterministic local model endpoint, including tools, artifacts, permission resolution, callback recovery, and Flower note admission/promotion. These checks do not verify hosted services.

## Browser observations

Chrome and a separate in-app browser authenticated as `serdar` and `serhat`. The UI used the real member proxy, coordination backend, SQLite journal, provisioner, and native coding runner. Agent replies came from an explicitly identified local model fixture; the product contains no seeded demo conversations.

- Saved the project brief and observed it in both browsers.
- Created shared threads as two different owners. A read-only database check confirmed separate Session IDs, workspace IDs, and Git worktree directories.
- Held the first provider reply, queued a follow-up, and posted a teammate comment. Both browsers showed the actual authors and queue state; two instructions completed in order in the first thread. The other owner's independent thread also completed.
- Verified owner instructions and teammate comments, code copying, exact event-source inspection, deep-link restoration, and draft persistence across reload.
- Inspected disconnected, loading, empty, and unavailable-model states. Reconnection controls remain usable during a backend interruption.
- Inspected desktop and 375 × 812 layouts, the pinned composer, mobile navigation, secondary team drawer, keyboard tab selection, Escape dismissal, and focus return.
- Restarted after the clean Bun installation and observed the same persisted threads and completed results in both browser profiles.

The main browser thread was `thr_0a183abe-a89a-4cea-807d-4f8410ffe768`; the independent owner thread was `thr_d181fe1a-ace3-42d0-8255-2e8b694eeef3`. All three recorded runs ended in `completed`, attempt 1. Screenshots were captured from the committed UI.

## Flower removal and OpenCode analysis agent

Verified source commit: [`027ae2c0f2`](https://github.com/uzgorenm/PuffCollaborative/commit/027ae2c0f2). Checked on macOS arm64, October 2, 2026 UTC, with Bun 1.3.14. This commit removes `integrations/flower`; the Flower rows above describe the earlier commit only.

- `bun typecheck` passed in `packages/schema`, `packages/protocol`, `packages/core`, `packages/server`, `packages/client`, `apps/web`, and `packages/app`. `script/runtime` typechecked through the `packages/core` configuration.
- `bun run migration --check` passed in `packages/core`; the `20261002045007_analysis_results` migration renames the result and delivery tables.
- `packages/server` `bun test`: 17 passed, including `runner-analysis-agent.integration`, which runs the `puff-analyst` agent through a real `opencode serve` and the local fixture provider and asserts that no tools reach the provider.
- `packages/core` `test/coordination` plus `session-runner`: 149 passed. `script/runtime` `bun test`: 9 passed. `apps/web` `bun test lib`: 34 passed. `packages/app` `src/components/puff`: 17 passed.

Analysis with a hosted model and a browser walkthrough of cooperation analysis were not exercised.

## Limits

Hosted coding-provider authentication and execution, hosted Flower submission/results, and the SSH connection from a separate physical computer were not exercised. No signing or installer packaging was performed, and the Electron application was built but not inspected interactively. The source web startup and two-browser collaboration path were verified locally. Flower remains optional and requires its own configured federation and credentials.
