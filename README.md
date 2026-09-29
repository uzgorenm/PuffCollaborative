# Puff Collaborative

**One project. Shared conversations. Distributed agents.**

An open-source collaborative coding harness built on **OpenCode**, with
**Flower SuperGrid** powering project-coordination agents.

Conversations belong to the project—not an individual developer. Teammates
can follow live agent threads, contribute instructions, and continue each
other’s work without manually transferring context.

> Status: Proposed MVP. The capabilities below describe the intended design.

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
