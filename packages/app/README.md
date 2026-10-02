# Puff Collab application foundation

The Solid application supplies the Electron renderer and the retained individual coding workspace. The shared-project web product lives in [`apps/web`](../../apps/web); its combined startup is described in the [main README](../../README.md).

From the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd packages/app typecheck
bun run --cwd packages/app build
```

To develop this renderer, run the backend from `packages/opencode` with `bun run src/index.ts serve --port 4096`, and run `bun dev -- --port 4444` from this directory. Open `http://localhost:4444` and configure the backend connection there. Keep this path separate from the combined team launcher.

Existing Playwright checks use `test:e2e:local` and a disposable backend. Existing unit checks run from this package with `bun run test:unit`; do not run tests from the repository root.
