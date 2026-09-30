# Repeatable React walkthrough — September 29

Tested source: `a5624203accdd65d61e1a14ca5c9d14c21184853`.

## Change

The app presents product copy without scripted/demo labels in its controls, setup, session headings, assistant labels, messages, or source inspection. Task replies remain proposed plans; context reuse adds an attributed finding rather than claiming code execution. A narrow migration refreshes known old generated templates and summaries without changing raw user messages, tasks, identities, source references, or arbitrary prose.

Project overview adds **Reset workspace**, with a confirmation and **Undo reset**. Reset saves the previous workspace before replacing it. The restore point persists across reloads; current and backup storage reads are independent, and undo clears transient search/draft/expanded-person state. Storage errors prevent reset from replacing unsaved work. The README includes exact click-by-click instructions for setup and the three prepared workflows.

## Evidence

- `npm test`: 19/19 tests pass, including migration preservation of user quotations, multiline attributed context, source objects, finding deduplication identity, and both prior generated task-plan branches.
- Package `bun typecheck` and production `npm run build`: pass. `git diff --check`: pass.
- Browser: reset from nine sessions to six, reload, undo back to nine; reset and reload retain Undo. Three-step new-project setup creates six sessions with the default tasks.
- Browser: prepared frontend task warns about Sam's existing work; complementary work creates a separate scoped session with neutral plan copy.
- Browser: prepared EADDRINUSE prompt surfaces Alice's source, source message 2 is inspectable, **Add context to this session** retains the original API task, and repeating the error retains exactly one attributed context.
- Browser: **Find my context** opens the parallel access-review session. A fresh starting overview contains no demo/scripted/simulated/sample/mock/scenario/walkthrough words in rendered body text.
- The user-facing tab is left on the starting six-session overview with its previous workspace retained behind Undo. Local screenshots: `artifacts/puff-walkthrough/product-workspace.png` and `product-workspace-mobile.png` (ignored artifacts).
- Independent source review verified storage-read isolation, backup-before-replacement order, cleared transient state on undo, and no remaining visible generated fixture labels.

## Boundary

This is a scripted browser-local interactive scenario. No live backend polling, agent execution, teammate task delivery, production presence, or authentication/access-control gate is closed by this presentation change. The separate simulator API preserves its provenance. See `apps/web/README.md` for test instructions and integration boundaries. The existing MP4 records the earlier interface; these screenshots and this receipt describe the current source.
