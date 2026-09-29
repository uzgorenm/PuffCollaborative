# Coordination local demo

The in-process HTTP demonstration uses the production route handlers and a fresh SQLite database. It creates two member credentials, an unauthorized user, two OpenCode Project/Session fixture rows, a runner credential, and an analysis credential. The runner is an explicit mock that reports tool activity and waits for approval when an instruction contains `[approval]`.

Install the repository's Bun 1.3.14 dependencies, then run:

```sh
cd packages/server
bun test test/coordination.integration.test.ts
```

The test sends concurrent instructions from Alice and Bob, runs separate threads, reads live SSE and replay, resolves an approval, cancels another Run, reads activity and cards, checks a stale card update, and reads the persisted result after restarting the HTTP handler. It uses real SQLite, the registered migrations and `EventV2`. The test removes its temporary database and credentials when it finishes.

## Running a local server

Start with an existing OpenCode database containing the Project and Sessions you want to share. Set `OPENCODE_DB` if you want a specific database file. Create a local, untracked identity roster at an absolute path:

```json
{
  "identities": [
    {
      "username": "alice",
      "passwordHash": "<Bun.password.hash result>",
      "auth": { "kind": "member", "userId": "usr_alice" }
    },
    {
      "username": "bob",
      "passwordHash": "<Bun.password.hash result>",
      "auth": { "kind": "member", "userId": "usr_bob" }
    },
    {
      "username": "worker",
      "passwordHash": "<Bun.password.hash result>",
      "auth": { "kind": "runner", "workerId": "wrk_local", "instanceId": "local-mock" }
    },
    {
      "username": "analysis",
      "passwordHash": "<Bun.password.hash result>",
      "auth": { "kind": "analysis", "serviceId": "jev-local" }
    }
  ]
}
```

Generate each hash with `bun -e 'console.log(await Bun.password.hash("your-secret"))'`. Give every account its own secret. Put the Project IDs that Alice may first share in a second local, untracked file:

```json
{ "allowed": [{ "userId": "usr_alice", "projectId": "<existing-project-id>" }] }
```

From the repository root, run:

```sh
OPENCODE_COORDINATION_IDENTITIES_PATH=/absolute/path/identities.json \
OPENCODE_COORDINATION_ADMISSIONS_PATH=/absolute/path/admissions.json \
OPENCODE_COORDINATION_MOCK_RUNNER=1 \
OPENCODE_COORDINATION_MOCK_WORKER_ID=wrk_local \
OPENCODE_COORDINATION_MOCK_INSTANCE_ID=local-mock \
bun run --cwd packages/opencode src/index.ts serve --hostname 127.0.0.1 --port 4096
```

`GET /api/coordination/v1/status` returns `{"ready":true}` after these adapters load. Use each roster username and password with standard HTTP Basic authentication on coordination routes. Alice can create the shared project, admit Bob, and share an existing Session. The server checks that Session's stored Project ID and binds it to the configured local worker. The shared OpenCode instance Basic account is still used for unrelated routes and does not identify a teammate.

Without the explicit mock flag, coordination data routes stay unavailable until Teammate 2 supplies a real `RunnerPort` and `SessionBinding` through `createRoutes(..., coordinationPorts)`. The mock emits planned events and does not execute OpenCode's model, tools, or workspace operations. The HTTP demonstration therefore verifies the coordination flow with a mock runner; it does not verify real OpenCode execution or Jev/Flower analysis.
