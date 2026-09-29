# Puff web workspace

A browser interface built with React 19 and Next.js 16. It follows the Codex-style workspace layout: project/session sidebar, central conversation and composer, teammate avatars, and a compact bottom row of one-line session summaries.

## Run

```sh
cd apps/web
npm ci
npm run dev
```

Open http://127.0.0.1:3005. For a production preview, run `npm run build` and then `npm start`.

This package installs independently with its own npm lockfile under `apps/`, outside the existing Bun `packages/*` workspace. The separate `/puff` overview routes in `packages/app` have been removed; the shared thread route remains.

## Data and interactions

- `/api/sessions` reads the existing local scenario simulator at `http://127.0.0.1:4187`, or a loopback URL supplied through `PUFF_API_URL`.
- Simulator data is explicitly marked **simulated**. If unavailable, ten illustrative sessions are explicitly marked **demo**. The adapter performs read-only requests with a one-second timeout; the browser refreshes every ten seconds.
- The main sidebar groups up to five personal threads under the Stanford Hackathon project. Each teammate section shows work updated in the past 90 minutes, with additional updates behind an expandable row, followed by up to five threads. Search matches session title, owner, or summary.
- Session cards and sidebar rows open the selected conversation. Filters show all, personal, or working sessions in the bottom summary row, which can collapse.
- New prompts save as local drafts in this browser, persist across reloads, and can be deleted. Enter saves, Shift+Enter adds a line, and Cmd/Ctrl+K returns to a new session.
- Agent execution, real teammate presence, invites, authentication, sharing consent, work redirection, and cross-session awareness delivery are not connected. The interface makes these limits visible; saving a draft does not start an agent.
- The sidebar derives teammates from the available session owners. Someone with no returned sessions does not appear yet. Demo timestamps are refreshed so the 90 minute view can be inspected; they are sample data, not observed teammate activity.

The existing hackathon workflow acceptance gates remain open. This preview establishes browser layout and navigation, not a completed live collaboration system.
