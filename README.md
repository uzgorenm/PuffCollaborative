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

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and API generation. `dev` is the default development branch. Temporary feature branches target `dev` and are deleted after merge.

## License

This fork retains OpenCode's [MIT license](LICENSE) and copyright notice.
