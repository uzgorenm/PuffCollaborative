# Puff Collaborative

**One project. Shared conversations. Distributed agents.**

An open-source collaborative coding harness built on **OpenCode**, with
**Flower SuperGrid** powering project-coordination agents.

Conversations belong to the project—not an individual developer. Teammates
can follow live agent threads, contribute instructions, and continue each
other’s work without manually transferring context.

> Status: Proposed MVP. The capabilities below describe the intended design.

## Team workspace

**Start here: [Team task board and feature status](docs/hackathon/README.md).**

- [Your assigned task and implementation checklist](docs/hackathon/team-plan.md)
- [Feature scope, acceptance criteria, and shared contracts](docs/hackathon/mvp-spec.md)
- [README review against the original idea](docs/hackathon/README-review.md)

Everyone works on **`main`**, the default branch. Commit and push verified work
directly to `main`; **no PRs or feature branches**. Each person uses a separate
local clone and integrates incoming commits before pushing. Never force-push.

## Features

- **Shared threads:** View conversations, tool activity, and changes in real
  time. Authorized teammates can contribute, continue, or fork a thread.
- **Live project overview:** See who is working on what, current progress,
  and blockers. Summaries refresh when the work meaningfully changes.
- **Shared context:** Agents retrieve relevant decisions and activity from
  other threads without loading every conversation into every prompt.
- **Distributed execution:** Run coding sessions across different machines
  within one shared project workspace.

## Architecture

### OpenCode

Provides the coding runtime, session APIs, and streamed events. We extend
its interface with shared projects, live activity, and collaborative controls.

### Flower SuperGrid

Runs a custom coordination AgentApp that summarizes ongoing work, identifies
cross-thread dependencies, and proposes handoffs for human approval.

### Collaboration Service

Owns project membership, permissions, shared thread identity, message
ordering, and worker routing. Connects Flower coordination agents to
OpenCode workers through an authenticated bridge.

## Human Control

Multiple teammates can contribute, but each thread has one ordered execution
flow. Independent threads run concurrently in separate workspaces.

Instructions and approvals retain their author attribution. Sensitive
actions and merges require approval. Sharing a thread does not share
credentials or grant unrestricted access to another person’s machine.

## MVP Demo

Two developers work on separate tasks across two machines. Both can see
each other’s live threads and project summaries.

A Flower coordination agent identifies a dependency between their tasks
and proposes a handoff. One developer opens the other’s thread and
continues the work using its existing context.

## Initial Scope

Prioritize shared visibility, collaborative input, context retrieval,
and explicit human handoffs.

Defer automatic task assignment, automatic merging, and migration of
running sessions between machines.

## Task Delegation

Use the [team board](docs/hackathon/README.md) for ownership and status, and the
[MVP spec](docs/hackathon/mvp-spec.md) for the scoped acceptance criteria. The
workstream descriptions below are preserved as the team's implementation direction.

### Serhat — Shared server and request coordination
Owns the source of truth: projects, threads, messages, request ordering, and execution state.
Build:
- Shared projects and threads, with contributor attribution and basic access control.
- A persistent queue per thread: one active agent turn per thread, different threads run concurrently.
- Duplicate-submission protection, live event broadcasting, and reconnect replay.
- Stop and approval controls that bypass the instruction queue.
Boundary: Decides what runs next, but does not implement agent execution or summaries.
Demo test: Two teammates submit to the same thread. Both see the same queue, the second turn waits, and another thread continues independently.
### Talha Aydn — OpenCode execution and workspaces
Owns turning an authorized run into actual coding work.
Build:
- The adapter connecting each shared thread to its OpenCode session.
- A separate worktree and branch for each independently executing thread.
- Execution of the entire agent turn, including model calls and tool use.
- Reporting of streamed output, tool activity, changed files, diffs, and final status to the server.
- Cancellation and approval handling connected to the server’s controls.
Boundary: Executes the server’s assignments; does not create a separate queue or independently decide execution order.
Demo test: Two threads edit the same filename in separate workspaces without overwriting one another. Both expose their progress and diffs.
### Talha — Multiplayer interface and activity dashboard
Owns everything teammates see and interact with.
Build:
- A project view showing everyone’s shared threads.
- Live conversations with contributor names, running turns, queued instructions, tool activity, and diffs.
- Instruction submission, comments, stop controls, and approval controls.
- Teammate activity cards with Working now, Up next, and Last 60 minutes.
- Navigation from an activity summary directly into its source thread.
Boundary: Displays server state and generated summaries; does not determine execution order or write summaries itself.
Demo test: Two browsers can watch and contribute to the same thread. The dashboard distinguishes active work from queued work and recent completed work.
### Serdar — Activity intelligence, Jev, and Flower
Owns understanding what everyone is working on and keeping summaries current.
Build:
- Event processing that produces a compact work card for each thread: objective, current step, blocker, recent outcome, and contributors.
- Jev classification for continuation, added scope, pivot, meaningful progress, and blocker changes.
- Summary generation, debouncing, and a fallback refresh when classification fails.
- Version checks so older summary results cannot overwrite newer ones.
- The Flower job adapter for executing the analysis workflow, starting with an early end-to-end integration test.
Keep factual execution statuses deterministic. Classification should affect summary refreshes—not permissions, locks, or whether coding can proceed.
Boundary: Returns versioned work cards to the server; does not own thread execution or the dashboard.
Demo test: Adding another feature expands the summary; abandoning the current objective changes it. Queued instructions remain “up next” until they start.
### How the four pieces connect
Handoff	Contract
Server → Runner	Start, cancel, or approve a specific run.
Runner → Server	Output, tool events, workspace changes, and execution status.
Server → Intelligence	Meaningful events with authoritative sequence numbers.
Intelligence → Server	Updated work card with the source event sequence it covers.
UI ↔ Server	User actions in; shared events and activity cards out.
