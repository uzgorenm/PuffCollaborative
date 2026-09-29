# React browser workspace preview

Date: September 29, 2026. Tested application source: `b23f29418dacfe1b3e5a50c5bd2e496a2849d449` on `serhat`.

The user requested a fast React/Next.js browser redesign based on the Codex screenshot, with people working on sessions and one-line summaries at the bottom. The new independently installed `apps/web` package provides that visual layout without requiring Electron. It retains the existing desktop/runtime source. No comparative performance benchmark was run.

## Verification

- `npm run build` from `apps/web`: exit 0, production compilation and TypeScript complete; `/` prerendered and `/api/sessions` dynamic.
- Observed in the in-app browser at `http://127.0.0.1:3005`: dark workspace, project/sidebar navigation, collaborator avatars, focused composer, single horizontal bottom summary row. Reviewed screenshots at the browser's default 1280×720 viewport. Eight fixture sessions did not grow the summary dock into multiple rows after the layout correction.
- Clicked Alice's working B session from the sidebar: correct title, owner, synthetic conversation, and source marker displayed.
- Saved a local smoke-test session, reloaded, and observed it persisted in both navigation and summaries. Deleted that test draft through its UI; the row count returned to the original fixture count.
- Working filter reduced the summary row to the running fixture; collapsing and expanding the dock changed its visible state. Returning home resets content scroll to zero.
- Browser console read after these smoke interactions: no captured error/warning entries.
- Local adapter displayed eight existing synthetic coordination sessions, three synthetic owners, and one running fixture when the simulator was available. A one-second timeout returns explicitly labeled demo data if it is unavailable.

## Boundaries

The avatars and working indicators are fixture/demo state, not verified real teammate presence. Drafts remain in the local browser. The composer does not execute agents; invitation UI explains its disconnected state. This preview does not implement live authentication, consent, sharing, agent execution, active-session awareness admission/promotion/use, or real Flower coordination. WF01/WF02/WF03 and other live acceptance gates remain open. Responsive CSS is included, but a separate mobile viewport was not observed in this pass.

The package uses a separate npm lockfile under `apps/`, outside the existing Bun package workspace. Start it with `cd apps/web`, `npm ci`, and `npm run dev`; port 3005 is bound to loopback only. `PUFF_API_URL` optionally selects a loopback scenario simulator, which is verified as synthetic before reading its projects.
