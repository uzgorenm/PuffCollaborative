# Error fix reuse implementation plan

**Goal:** A failed shared session automatically offers an inspected, verified fix from a teammate, with person summaries above their sessions in the native desktop sidebar.

**Architecture:** Use canonical coordination events, fresh WorkCards and exact project-scoped source reads. A source `run.output` may carry `fix: {error, summary, patch, verification: {command, exitCode, output}}`. Require matching error, nonempty patch, passed verification, fresh done card and attributed actor before suggesting reuse. Approval submits a concrete source-linked instruction through the existing target worker; admission and completed application remain distinct.

**Scope:** Native Solid/Electron. Backend fixtures stay behind ordinary UI; test-data disclosure belongs in connection details. Preserve all current user previews. Root integrates to serhat without force pushes.

## Tasks

- [ ] Root: failing tests for matching error, unrelated error, stale/foreign/unattributed evidence, post-completion suppression, verification failure and instruction source identity; implement `fix-reuse.ts`.
- [ ] Root: add source lookup on meaningful failure/report change, revalidate on Apply, preserve exact retry identity, clear stale results on account/target changes; tests for actual controller flow.
- [ ] Root: add Inspect / Apply fix / No thanks within shared conversation and exact receipt states through i18n.
- [ ] Existing sidebar owner: person name -> aggregate fresh report -> individual sessions, search and accessible collapse, settings disclosure.
- [ ] Existing backend owner: error/fix fixtures, canonical idempotent instruction admission and actual isolated file/test application. Unrelated/private cases stay excluded.
- [ ] Root: verify focused tests, package typecheck/build, native walkthrough on an isolated checkpoint; record evidence, integrate concurrent serhat changes, push normally.

## Review focus

- Old or unrelated errors must not match; normalized exact signatures retain function identity.
- Source revisions and authorization are checked again before approval.
- Lost admission responses retry the same request, never create a second action.
- Admitted work is not reported as applied without diff, passing verification and completion events.
- Synthetic backend activity is disclosed in connection details and evidence, never represented as actual Flower-agent use.
