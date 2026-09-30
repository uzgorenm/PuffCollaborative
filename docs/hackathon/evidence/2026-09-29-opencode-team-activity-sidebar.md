# OpenCode Team Activity sidebar — September 29

Source commit: `dac982301277871c5371f0e2dda02747bcb7e5ea`.

Result: The standard OpenCode shell shows a Team Activity panel beside the app content. The classic project sidebar shows the same panel. It reads the coordination project's activity API and opens listed items in their OpenCode sessions. Credentials stay in the panel's in-memory state.

Evidence kind: SOURCE, BUILD, BROWSER. This is not integration or live-workflow evidence.

- From `packages/app`, `npx --yes bun@1.3.14 typecheck` passed.
- From `packages/app`, `npx --yes bun@1.3.14 run build` passed. Vite reported mixed-import and large-chunk warnings.
- After merging incoming `origin/serhat` changes, the same typecheck and build passed again at `401f70958ae4846775d6227348189c824e96acc7`.
- The normal app at `http://127.0.0.1:4444/` rendered with the activity panel. Reloading the earlier `/puff` tab returned to the regular OpenCode app instead of retaining the old sample screen.

Limit: The coordination API was unavailable in the browser check: `/api/coordination/v1/status` returned the Vite app shell instead of a JSON status. No sample users, credentials, or live activity response were verified. No acceptance workflow or gate is closed by this receipt.
