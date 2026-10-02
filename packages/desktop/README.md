# Puff Collab desktop

The retained Electron application uses the Solid renderer and embeds the OpenCode coding runtime. The supported shared-project setup is the web launcher in the [main README](../../README.md).

## Develop

Install the root Bun workspace, then run:

```sh
bun dev:desktop
```

The predevelopment step installs Electron, copies the application icons, builds the embedded Node server, and obtains the compatible upstream CLI used by the terminal integration. This requires network access. Native helper builds may require the platform's C/C++ tools and Rust.

## Build

From the repository root:

```sh
bun run --cwd packages/desktop typecheck
bun run --cwd packages/desktop build
```

From `packages/desktop`, `bun run package:mac`, `package:win`, or `package:linux` packages built assets for that platform. Signing and installer distribution require your own platform configuration. Puff Collab has no configured automatic update feed.
