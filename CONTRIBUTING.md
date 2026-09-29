# Contributing to PuffCollaborative

Use Bun 1.3.14 and run `bun install` from the repository root. See [README.md](README.md) for the desktop app and local server commands.

The team works directly on `main`. Verify your changes, fetch `origin/main`, integrate incoming commits, and push normally. Never force-push. Follow the workflow and code conventions in [AGENTS.md](AGENTS.md) and any package-level instructions.

## Checks

Run type checks from the affected package directory:

```sh
cd packages/opencode
bun typecheck
```

Run the existing tests relevant to your change from their package directory. For example, from `packages/opencode`:

```sh
bun test test/server
```

The root `bun test` command deliberately fails to prevent a test run in the wrong directory. CI runs the workspace test and type-check jobs.

Build the desktop app from the repository root:

```sh
OPENCODE_CHANNEL=dev bun run --cwd packages/desktop build
```

For browser tests, see [packages/app/README.md](packages/app/README.md).

## API changes

After changing the public Protocol or Server `HttpApi`, regenerate the client:

```sh
bun run --cwd packages/client generate
```

For legacy API/SDK changes, run `bun run script/generate.ts`. Commit generated changes with the source change.
