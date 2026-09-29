# Puff Collaborative

**One project. Shared conversations. Distributed agents.**

An open-source collaborative coding harness built on **OpenCode**, with
**Flower SuperGrid** powering project-coordination agents.

Conversations belong to the project—not an individual developer. Teammates
can follow live agent threads, contribute instructions, and continue each
other’s work without manually transferring context.

> Status: Proposed MVP. The capabilities below describe the intended design.

## Problem and product direction

AI coding sessions help people build quickly, but useful context often stays
inside one conversation. The same person repeats explanations across sessions;
teammates independently investigate or build the same thing because their agents
do not know what others are doing or have already learned.

Puff should connect that work: summarize each shared session's current objective,
progress, and blockers; notice overlaps and reusable findings; and bring relevant
context into both new and ongoing sessions. The value is less repeated work and
less manual explanation, with sources that let people check each suggestion.

Serdar's broader idea includes an evolving project or company wiki assembled from
session knowledge, selective retention and reuse of useful results, and eventually
suggestions about what someone should work on next. These are product directions,
not all requirements for the 5–6 hour hackathon. The proposed MVP starts with small,
human-approved decision records; full wiki generation, general result caching,
and task recommendations remain future work. Automatic context lookup at session
start is a stretch feature; explicit lookup must work first.

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
- **Avoid repeated work:** Flower identifies overlapping work, dependencies,
  and opportunities to reuse a finding, with links to the supporting sessions.
- **Lasting project memory:** People approve useful findings as project decisions.
  New and ongoing sessions can retrieve them; outdated decisions can be superseded.
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

### Why these agents are separate

Each coding agent owns a different session history and executes against its own
workspace, tools, and credentials. The Flower coordinator compares explicitly
shared evidence across those boundaries and proposes useful context to exchange.
The workers retain execution control; the coordinator does not need unrestricted
access to everyone's files or machines. The proposed baseline is two OpenCode
agents and one Flower AgentApp, not three copies of the same chat agent.

### What is shared

Sharing is explicit and project-scoped. The MVP uses selected synthetic demo
sessions, not automatic collection of everyone's conversations. Only permitted
session content and activity are exported; unrelated sessions, credentials,
arbitrary files, and full tool payloads are excluded from the export contract.

Exported content is visible to the collaboration service and authorized project
viewers. Content submitted to Flower/SuperGrid and its hosted model leaves the
worker machine. Local execution does not make those requests private or local;
the demo must show what crosses each boundary. Summaries are observations, while
accepted project knowledge requires a human decision.

## Human Control

Multiple teammates can contribute, but each thread has one ordered execution
flow. Independent threads run concurrently in separate workspaces.

Instructions and approvals retain their author attribution. Sensitive
actions and merges require approval. Sharing a thread does not share
credentials or grant unrestricted access to another person’s machine.

## MVP Demo

Two developers work in separate sessions across two machines. One has already
found an answer or built something that the other is about to repeat. A real
Flower run detects the overlap or dependency, cites both sessions, and proposes
the useful context to share.

The target worker's owner reviews, edits, approves, or rejects the proposal.
Approval delivers one attributed instruction to that session on its existing
host, and the session visibly uses the finding. Its credentials, workspace, and
host do not move. A new session then retrieves an accepted decision, showing
that the team's knowledge survives the original conversation.

The interface should make worker ownership, shared evidence, the Flower run,
human approval, and actual delivery visible. The magic moment is seeing one
session avoid repeating work because another session's finding reached it.

## Initial Scope

Prioritize current session summaries, overlap/reuse detection, approved context
delivery, and a minimal durable project memory. Shared visibility and collaborative
input support this complete flow. Protect one reliable demo with four people in
5–6 hours; the [MVP spec](docs/hackathon/mvp-spec.md) defines the acceptance criteria.

Defer full company-wiki generation, automatic task assignment, general result
caching, automatic merging, and migration of running sessions between machines.

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
###       — Multiplayer interface and activity dashboard
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

## Run locally

The desktop app is the main interface for this fork.

Install Bun 1.3.14, the version pinned in `package.json`, then install dependencies:

```sh
bun install
```

Start the desktop app:

```sh
bun dev:desktop
```

The desktop development script builds the local server and prepares the Electron resources. See [packages/desktop/README.md](packages/desktop/README.md) for packaging commands.

## Browser and CLI development

To work on the shared UI in a browser, start the API server:

```sh
bun dev serve --hostname 127.0.0.1 --port 4096
```

In a second terminal, start the web app:

```sh
bun dev:web
```

Open [localhost:3000](http://localhost:3000) and connect to the local server at `http://127.0.0.1:4096`.

To use the terminal interface instead:

```sh
bun dev /absolute/path/to/your/project
```

## Repository layout

| Path                                                                      | Purpose                                       |
| ------------------------------------------------------------------------- | --------------------------------------------- |
| `packages/desktop`                                                        | Electron desktop app                          |
| `packages/opencode`                                                       | Main CLI and server entry point               |
| `packages/core`, `packages/llm`                                           | Sessions, tools, storage, and model execution |
| `packages/server`, `packages/protocol`, `packages/schema`                 | Server implementation and API contracts       |
| `packages/app`, `packages/ui`, `packages/session-ui`                      | Web app and shared interface components       |
| `packages/cli`, `packages/tui`                                            | V2 CLI and terminal components                |
| `packages/client`, `packages/sdk`, `packages/sdk-next`, `packages/plugin` | Clients, embedded SDK, and plugin interfaces  |

The other workspace packages support these components. Existing runtime and app tests remain alongside their source.

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and API generation.

## License

This fork retains OpenCode's [MIT license](LICENSE) and copyright notice.
