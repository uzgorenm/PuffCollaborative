# Puff Collab

Puff Collab is a collaborative AI coding workspace. Teammates share projects and conversation threads, follow recorded agent activity, and contribute comments. Each coding thread has its own repository worktree. The thread owner sends instructions, queues follow-up work, and handles tool approvals.

## Install from source

You need Git, **Bun 1.3.14 or newer**, **Node.js 22.12 or newer**, and a browser. The setup below runs on macOS or Linux. There is no Puff Collab binary release or hosted service configured in this repository.

```sh
git clone --branch serhat https://github.com/uzgorenm/PuffCollaborative.git puff-collab
cd puff-collab
bun install --frozen-lockfile
bun start
```

Keep that terminal open. The launcher starts the web app and the OpenCode backend together, prints the web address (normally `http://127.0.0.1:3006`), and creates a private state directory beside your checkout. It preserves the database, member credentials, logs, and coding worktrees there between runs.

Open the printed web address. The backend address is filled in automatically. Open `settings.json` in the printed state directory locally and sign in with your member username and password. The current roster contains `serdar`, `serhat`, `talha`, and `ferit`, with separate generated passwords. Give each teammate only their own credentials; keep the state directory private.

## Configure a coding model

Browsing the workspace does not need model credentials. Starting a coding thread requires a configured, tool-capable model. Keep the provider configuration outside the repository. For an OpenAI-compatible endpoint, create a JSON file like this and replace the endpoint, key, model ID, and limits with your provider's values:

```json
{
  "provider": {
    "my-provider": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://YOUR_PROVIDER_ENDPOINT/v1",
        "apiKey": "YOUR_API_KEY"
      },
      "models": {
        "my-model": {
          "name": "My coding model",
          "tool_call": true,
          "limit": { "context": 100000, "output": 10000 }
        }
      }
    }
  }
}
```

Start the launcher with the matching provider and model IDs:

```sh
PUFF_MODEL_PROVIDER=my-provider \
PUFF_MODEL_ID=my-model \
PUFF_PROVIDER_CONFIG=/absolute/path/model.json \
bun start
```

Use those settings each time you start the workspace. The launcher copies the configuration into its private runtime directory. An unavailable model leaves **Start thread** disabled; provider authentication, quota, or execution failures appear as recorded run failures.

## Work with your team

1. Open **Team overview** and set the project brief and your focus.
2. Choose **New thread**, describe the task, and explicitly check the sharing option before starting. This interface creates shared threads; unchecked tasks remain drafts.
3. Read the conversation and recorded tool activity. The owner can send more instructions while the agent runs; those instructions enter the thread's queue. **Stop** requests cancellation of the active run.
4. Teammates open the same thread and select **Comment** to contribute without instructing its agent. To work independently, create another thread; related-work suggestions can link complementary or alternative approaches.
5. Open **Team** for other threads, summary sources, and the active thread's cooperation settings. Inspect tool details before approving a permission request. Execution status comes from recorded runs; a summary is not evidence that a teammate is online or that changes have merged.

The source setup shares this repository at the revision captured on first launch. It does not offer an arbitrary repository picker or account-management service. Instructions remain restricted to the verified thread owner.

## Connect a second teammate

Both services bind to loopback. On the teammate's computer, forward the web port from the machine running Puff Collab:

```sh
ssh -N -L 3006:127.0.0.1:3006 user@workspace-host
```

Open `http://127.0.0.1:3006` locally and sign in with that teammate's member credentials. Use the same web port on both ends; the backend stays on the workspace host and needs no separate tunnel. SSH access must already be configured. Each browser authenticates separately. This setup is for trusted teammates and is not a public hosting configuration.

## Troubleshooting and optional integrations

- **Port in use:** choose another web port with `PUFF_WEB_PORT=3010 bun start`. Match it in the tunnel. Run one launcher per checkout.
- **Separate workspace data:** set `PUFF_PRODUCT_STATE=/absolute/private/directory`. Keep existing state if you want to retain threads. An existing backend port is pinned to preserve saved connections.
- **Startup or connection error:** inspect `bootstrap.log`, `backend.log`, and `web.log` in the printed state directory. Check that Node and Bun are on `PATH`, then check your individual credentials.
- **Unknown execution after interruption:** a run may require recovery. Acknowledged cancellation or a saved instruction does not prove model completion; check the run status before retrying.
- **Flower analysis:** optional and off by default. See [the Flower setup](integrations/flower/README.md) for its Python and hosted-service requirements. Thread sharing alone does not permit analysis or export of instruction text.
- **Development builds:** `bun run --cwd apps/web build` builds the team web app. [Desktop development](packages/desktop/README.md) retains the Electron/Solid application and native coding foundation.

Puff Collab is built on [OpenCode](https://github.com/anomalyco/opencode) and retains its MIT license and compatible API, package, and storage identifiers. See [LICENSE](LICENSE). Flower integration licenses remain alongside their source.
