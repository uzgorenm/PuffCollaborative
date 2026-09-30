# Typed task coordination walkthrough

The New session flow accepts a task and a model, checks project context through a local Next API, and offers concrete work that complements a teammate's scope. A second option starts related but separate frontend work. Opening the source retains its identity and conversation.

Implementation is isolated to apps/web. A seeded deterministic scenario engine supplies guidance; a filesystem store owns workspace/session persistence behind POST /api/workspace. The model selection is preserved in commands, sessions, and replies for a later provider adapter. It does not invoke a paid model or modify repository files.

Validation covers natural typed tasks, scope/privacy matching, separate recommended tasks, model persistence, follow-up conversation, saved reloads, source attribution, concurrent writes, invalid commands, reset/undo, and the browser flow at port 3005. This is fixture/API evidence and does not satisfy live Flower/OpenCode integration gates.

Work split: shared command contract and UI; independent scenario engine and tests; independent storage/service/route and tests. Verify package tests, package typecheck, build, and hands-on browser actions before committing to serhat.
