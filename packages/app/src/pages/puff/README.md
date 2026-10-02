# Shared thread renderer

The retained Solid route `/puff/thread/:threadId` displays real coordinator conversation/activity through `team-api.ts` and `team-state.ts`. The desktop team sidebar uses the same authenticated project and thread data.

The primary shared-project interface is [`apps/web`](../../../../../apps/web). Follow the [main setup](../../../../../README.md) to start the supported combined workspace.

Thread actions preserve actor identity, ordering, stable retry IDs, approval versions, and source references. Missing or stale data disables writes. Source review and owner checks remain necessary before coding-agent instructions or tool approval. No synthetic simulator is selected in this renderer.

From `packages/app`, run `bun typecheck`, `bun run build`, and the focused existing checks in `src/pages/puff` and `src/components/puff` for changes here.
