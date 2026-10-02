# Puff Collab web workspace

The supported shared-project UI uses Next.js and React. Run it with the retained OpenCode backend through `bun start` at the repository root. Installation, model configuration, individual sign-in, and teammate tunneling are documented in the [main README](../../README.md).

The browser uses the authenticated `/api/connection` and `/api/coordination` proxy. Backend credentials are encrypted in a strict HttpOnly cookie. Every browser signs in separately; credentials and transcripts are not stored in localStorage. Draft text is stored locally per account/project/thread.

From the repository root:

```sh
bun run --cwd apps/web typecheck
bun run --cwd apps/web build
```

For the focused access, action-retry, and source/currentness checks:

```sh
cd apps/web
bun test lib/server-connection.test.ts lib/coordination-client.test.ts lib/live-actions.test.ts lib/live-workspace.test.ts
```

The `/live` URL redirects to the same workspace. There is one product interface; no demo backend is selected by a query parameter.
