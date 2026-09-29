# Main browser sidebar and team-page removal

Date: September 29, 2026. Tested application source: `790518a2c9688e9fc1d09f3b6b02a29b965c7a03` on the local feature checkout for `serhat`.

The main React website at `apps/web` now places the Stanford Hackathon project in its left rail. It lists up to five personal threads, then a section for each teammate found in the returned sessions. Each teammate section shows the work updated in the past 90 minutes, with extra summaries expandable, followed by up to five threads. Search filters thread rows by title, owner, or summary. The separate `/puff` overview and preview routes and their page files were removed from `packages/app`; `/puff/thread/:threadId` remains.

## Verification at the tested source

- `npm run build` in `apps/web`: exit 0. Next.js production compilation, TypeScript, and static prerender completed; `/api/sessions` remains dynamic.
- `bun typecheck` in `packages/app`: exit 0.
- `bun run test:browser` in `packages/app`: 47 passed, 0 failed, including the shared thread route's focus checks.
- `bun run build` in `packages/app`: exit 0. Vite reported chunk-size and import warnings, with no build failure.
- In the in-app browser at `http://127.0.0.1:3005`, inspected the main page at desktop and 390×844 phone widths. The desktop rail showed four personal sample threads and three threads each for Alice and Bob. On the phone, the menu opened the drawer and the backdrop closed it. Opening Alice's thread showed the selected conversation; expanding the extra-update row revealed the remaining recent summary; searching for “keyboard” narrowed the visible thread rows. The browser error/warning log was empty after these interactions.

## Evidence boundary

The browser observations use illustrative demo sessions. If the optional local scenario simulator responds, its sessions are labeled simulated. Neither source proves real teammate presence or work. The 90-minute window uses returned session timestamps, refreshed every ten seconds; a teammate with no returned session cannot appear because the interface has no roster or signed-in identity. Local prompts remain browser drafts and do not execute an agent. This change does not close WF01/WF02, G5, or the other live coordination gates.
