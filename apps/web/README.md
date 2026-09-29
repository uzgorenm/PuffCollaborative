# Puff web workspace

A browser interface built with React 19 and Next.js 16. It follows the Codex-style workspace layout: project/session sidebar, central conversation and composer, teammate avatars, and a compact bottom row of one-line session summaries.

## Run

```sh
cd apps/web
npm ci
npm run dev
```

Open http://127.0.0.1:3005. For a production preview, run `npm run build` and then `npm start`.

This package installs independently with its own npm lockfile under `apps/`, outside the existing Bun `packages/*` workspace. It does not change the desktop app or its dependency lockfile.

## Data and interactions

- `/api/sessions` reads the existing local scenario simulator at `http://127.0.0.1:4187`, or a loopback URL supplied through `PUFF_API_URL`.
- Simulator data is explicitly marked **simulated**. If unavailable, four illustrative sessions are explicitly marked **demo**. The adapter performs read-only requests with a one-second timeout; the browser refreshes every ten seconds.
- Session cards and sidebar rows open the selected conversation. Search matches session title, owner, or summary. Filters show all, personal, or working sessions. The summary row can collapse.
- New prompts save as local drafts in this browser, persist across reloads, and can be deleted. Enter saves, Shift+Enter adds a line, and Cmd/Ctrl+K returns to a new session.
- Agent execution, real teammate presence, invites, authentication, sharing consent, work redirection, and cross-session awareness delivery are not connected. The interface makes these limits visible; saving a draft does not start an agent.

The existing hackathon workflow acceptance gates remain open. This preview establishes browser layout and navigation, not a completed live collaboration system.
