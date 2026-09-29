One project. Shared conversations. Distributed agents.
Status: proposed MVP.
An open-source collaborative coding harness built on OpenCode, with Flower SuperGrid powering project-coordination agents.
Conversations belong to the project—not an individual developer. Teammates can see what everyone is building, inspect live agent threads, contribute instructions, and continue each other’s work without manually transferring context.
Core experience
- Shared threads: View conversations, tool activity, and changes in real time. Authorized teammates can contribute, continue, or fork a thread.
- Live project overview: See who is working on what, current progress, and blockers. Summaries update when the work meaningfully changes.
- Project-aware agents: Retrieve relevant decisions and activity from other threads without stuffing every conversation into every prompt.
- Distributed execution: Run coding sessions on different machines while presenting one shared project workspace.
Architecture
OpenCode provides the coding runtime, session APIs, and streamed events. We extend its interface with project membership and collaborative controls. opencode.ai
Flower SuperGrid runs a custom coordination AgentApp that summarizes work, identifies dependencies, and proposes task handoffs. Flower provides AgentApp execution, model access, run events, and persisted run-series state. Flower
Our collaboration service owns shared project state, permissions, message ordering, and worker routing. An authenticated bridge connects Flower’s coordination logic to OpenCode workers; this integration is part of what we build.
Human control
Multiple people can contribute, but each thread has one ordered execution flow. Independent threads run concurrently in separate workspaces. Sensitive actions and merges require approval, and instructions and approvals retain their author attribution.
Sharing a thread does not share credentials or grant unrestricted access to another person’s machine.
First demo
Two developers work on separate tasks across two machines. Both see live threads and summaries. A Flower coordination agent identifies a dependency between their tasks and proposes a handoff. One developer opens the other’s thread and continues the work with its existing context.
