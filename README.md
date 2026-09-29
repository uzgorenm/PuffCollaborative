# Puff Collaborative

**One project. Shared conversations. Distributed agents.**

An open-source collaborative coding harness built on **OpenCode**, with
**Flower SuperGrid** powering project-coordination agents.

Conversations belong to the project—not an individual developer. Teammates
can follow live agent threads, contribute instructions, and continue each
other’s work without manually transferring context.

> Status: Proposed MVP. The capabilities below describe the intended design.

## Official hackathon requirements and readiness

Checked September 29, 2026 against the organizers' [Stanford hackathon brief](https://discuss.flower.ai/t/collaborative-agent-hackathon-stanford-ca-2026/1275).
Use that page and `#hackathon_stanford_2026` in [Flower Slack](https://flower.ai/join-slack)
for updates and support.

- **Challenge:** Demonstrate multiple Flower Agents collaborating through
  SuperGrid, with a result that benefits from their cooperation. The brief gives
  agent chains and context/handoffs between AgentApps as examples.
- **Judging:** Depth of Flower/SuperGrid use, impact and originality, and demo
  clarity and delivery. **Endeavor is a bonus**, not a prerequisite.
- **Schedule:** September 29, 2026, 9:30 am–7:30 pm at 389 Jane Stanford Way.
  Demo preparation starts at 4:30 pm; presentations start at 5:15 pm and last
  **3–5 minutes** per team. Submit before the demos; the post does not specify
  a separate exact submission cutoff.
- **Runtime:** SuperGrid tasks have a five-minute timeout from entering Running.
  Keep coordination bounded so coding can continue if analysis fails.

### Submission checklist

- [ ] Register the team name, members, and email addresses using the
  [team form](https://flowerlabs.typeform.com/to/rQuplUGG).
- [ ] Publish our own working AgentApp on Flower Hub and record its public link.
  Follow the [publication guide](https://flower.ai/docs/agent/how-to-guides/use-flower-hub.html#publish-your-agentapp).
- [ ] Submit a short project description and the GitHub repository link.
- [ ] Rehearse the working result and explain the problem and Flower's role
  within the presentation time.

Unchecked means not verified in this repository, including actions teammates
may already have completed elsewhere. A local build or use of an upstream Hub
template does not establish publication of our own app.

### Where Puff fits, and the remaining gap

Our live coding-session awareness idea fits the collaboration theme: one agent's
finding helps another agent adapt before a person manually transfers context.
However, the current engineering baseline is **two OpenCode agents and one Flower
AgentApp**. It uses Flower, but that alone does not demonstrate the brief's
multiple-Flower-agent collaboration. Treat the baseline as an integration
checkpoint, not a claim that the hackathon challenge is already satisfied.

The original `@flwrlabs/collaborative-agent` setup completed a real SuperGrid
greeting run, `12037878883441469089`; its `finished:completed` status was rechecked
on September 29. That test requested no tools. It proves runtime access, not
agent-to-agent cooperation or Puff integration. At this review, the shared
repository has no verified Puff-specific Flower integration or recorded
team-owned Hub publication.

**Recommended next step:** Ferit should prove a small real exchange between
Flower agents as an early integration checkpoint. For example, a session
analysis agent passes an evidence-backed finding to a coordination agent, which
relates it to another session and produces the awareness note. This is a proposed
extension, not implemented behavior. The
[organizers' collaborative-agent example](https://github.com/jafermarq/flower-collaborative-agent-hackathon)
demonstrates agents communicating across SuperNodes connected to SuperGrid.
Native Grid transport is one implementation option; the brief also permits
agent chains. Ask a mentor to confirm the fit if retaining only one Flower agent.

Protect one complete demo: permitted session evidence -> actual Flower-agent
exchange -> source-linked update -> delivery into a running coding session ->
visible adaptation. Show the participating agents and their exchanged result,
along with run status and delivery evidence. Then publish the working AgentApp.
Retain the four existing ownership areas; their interfaces still support this
flow. The [team board](docs/hackathon/README.md) tracks implementation evidence.

## Problem and product direction

AI coding sessions help people build quickly, but useful context often stays
inside one conversation. One developer can have several agents exploring the
same frontend feature in parallel without any agent knowing what the others
are trying or learning. The same person repeats explanations across sessions;
teammates independently investigate or build the same thing for the same reason.

Puff should connect that work: summarize each shared session's current objective,
progress, and blockers; notice overlaps and reusable findings; and bring relevant
context into both new and ongoing sessions while they work. Related sessions
may be deliberate alternative experiments, not redundant copies. The value is
less repeated work and less manual explanation, with sources that let people
check each suggestion.

Serdar's broader idea includes an evolving project or company wiki assembled from
session knowledge, selective retention and reuse of useful results, and eventually
suggestions about what someone should work on next. These are product directions,
not all requirements for the 5–6 hour hackathon. The proposed MVP centers on
awareness among ongoing agents; small, human-approved decision records follow
if that loop works. Full wiki generation, general result caching, and task
recommendations remain future work. Automatic context lookup at session start
is a stretch feature; ongoing awareness is the core demo.

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
- **Live agent awareness:** When a selected, related session makes meaningful
  progress, its peers receive a short source-linked update at a safe turn
  boundary after it is ready. Parallel experiments remain separate until a
  person chooses.
- **Avoid repeated work:** Flower identifies overlapping work, dependencies,
  deliberate alternatives, and opportunities to reuse a finding, with links
  to the supporting sessions.
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
cross-thread dependencies, distinguishes parallel experiments, and reports
source-linked findings to related sessions. Instructions that redirect work
remain subject to human approval.

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

One developer runs two separate sessions exploring different frontend designs
for the same feature. Each agent can see the other's stated approach and current
progress without assuming either design has been chosen. One session discovers
a shared constraint; a real Flower run cites that finding and flags it for the
other agent. At a safe turn boundary, that agent receives the update and
visibly adjusts its plan while continuing its own experiment.

The developer compares both approaches and chooses one. An instruction that
redirects work requires the target worker owner's approval; accepted findings
can then be recorded as project knowledge. The sessions keep their own
workspaces, credentials, and hosts. A new session later retrieves the decision,
showing that the team's knowledge survives the original conversations.

The interface should make worker ownership, shared evidence, the Flower run,
human approval, and actual delivery visible. The magic moment is seeing one
agent change course because another active agent found something relevant.

## Initial Scope

Prioritize current session summaries, distinguishing alternative experiments
from duplicate work, and delivering relevant updates into ongoing sessions.
An approved action and minimal project memory complete the demo if time permits.
Protect one reliable flow with four people in
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
- A separate workspace for each independently executing thread; verified
  shared repository changes still go through `main`.
- Execution of the entire agent turn, including model calls and tool use.
- Reporting of streamed output, tool activity, changed files, diffs, and final status to the server.
- Cancellation and approval handling connected to the server’s controls.
Boundary: Executes the server’s assignments; does not create a separate queue or independently decide execution order.
Demo test: Two threads edit the same filename in separate workspaces without overwriting one another. Both expose their progress and diffs.
### Serdar — Multiplayer interface and activity dashboard
Owns everything teammates see and interact with.
Build:
- A project view showing everyone’s shared threads.
- Live conversations with contributor names, running turns, queued instructions, tool activity, and diffs.
- Instruction submission, comments, stop controls, and approval controls.
- Teammate activity cards with Working now, Up next, and Last 60 minutes.
- Navigation from an activity summary directly into its source thread.
Boundary: Displays server state and generated summaries; does not determine execution order or write summaries itself.
Demo test: Two browsers can watch and contribute to the same thread. The dashboard distinguishes active work from queued work and recent completed work.
### Ferit — Activity intelligence, Jev, and Flower
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
