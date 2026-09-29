# Puff web workspace

A browser demo built with React 19 and Next.js 16. The project overview groups work by person: **name → total work summary → individual sessions**. Opening a session shows its own conversation, task, status, and related context. One person can keep several sessions in parallel.

The interactive demo uses local sample `WorkspaceState` data from `lib/workspace.ts`. You, Sam, and Alice illustrate a team scenario. Their conversations and work statuses are examples; the demo does not execute agents or represent real teammate presence.

## Run

```sh
cd apps/web
npm ci
npm run dev
```

Open <http://127.0.0.1:3005>. For a production preview, run `npm run build` and then `npm start`.

This package installs independently with its own npm lockfile under `apps/`, outside the existing Bun `packages/*` workspace. It does not change the desktop app or its dependency lockfile.

## Interactive workflows

1. **Set up a project.** Enter its name and goal, review the people, and assign a task to a person. Assignment creates a separate local demo session with the supplied task and an illustrative first-step plan.
2. **Review the team.** The overview and main sidebar show each person's combined work before listing their sessions. The sidebar shows five session rows initially, with an expandable overflow and a collapsed 90-minute recent-update view. Open a session to read its conversation, then return to the overview. Filtering to My work keeps your own parallel workstreams together.
3. **Review overlapping work.** A frontend/navigation task can surface Sam's existing navigation sessions. Open the source conversation, create complementary work, or continue with an independent alternative. Complementary work proposes a separate scope such as keyboard accessibility and project-switching checks, with a reference to the source. It preserves both conversations and approaches.
4. **Reuse a finding with its source.** An `EADDRINUSE` or port-in-use prompt can surface Alice's completed development-server session. Review the original conversation, then add the finding as context to your own session. The reference retains the source session and message, and the same finding is deduplicated within the receiving session. The example adaptation checks the process that owns port 3000 and uses this project's configured development port, 3005; compare the actual error before applying that advice. An unrelated server error is not treated as a solved port conflict.
5. **Keep parallel and private work distinct.** Each sample person starts with two sessions. Creating another session does not replace that person's earlier work. Private sessions are shown only for You and are excluded from other people's visible work and matching context. This is local demo visibility behavior; production authentication and access control are not implemented here.

These actions update the browser's demo state. Assignment, complementary plans, and context adaptation do not start model execution, deliver a task to a teammate, stop another agent, or prove live collaboration. The existing hackathon workflow acceptance gates remain open.

The original generated Puff logo is `public/puff-logo.png`; the interface uses this asset for its brand mark.

## Separate simulator adapter

The existing read-only `/api/sessions` adapter remains available separately from the interactive workspace. It reads the local scenario simulator at `http://127.0.0.1:4187`, or a loopback URL supplied through `PUFF_API_URL`, with a one-second timeout. Successful simulator data is marked `simulator` and explicitly described as simulated; unavailable or invalid simulator data falls back to illustrative `demo` sessions. The interactive `WorkspaceState` view does not poll this adapter.

## Verify

Run these commands from `apps/web`:

```sh
npm test
bun typecheck
npm run build
```

The workspace tests cover independent sample data, parallel sessions, overlap matching, source-specific server findings, caller-visible source scope, and independent/complementary task creation. Type checking and the production build are separate checks; browser workflows and the resulting video require their own visual review.

## Render the walkthrough video

`scripts/render_walkthrough.py` turns screenshots captured from the running interface into one MP4. It retains the captured application UI, adds a bottom caption band, and overlays an animated mouse cursor and click rings. This is a screenshot-based walkthrough of browser interactions, with cursor animation added during encoding; it is not a continuous screen recording or evidence of live agent execution.

Requires a Python runtime with Pillow and an `ffmpeg` executable. For this machine:

```sh
/opt/homebrew/bin/python3 scripts/render_walkthrough.py /absolute/path/to/manifest.json --ffmpeg /opt/homebrew/bin/ffmpeg
```

Example manifest:

```json
{
  "title": "Puff • Interactive demo walkthrough",
  "output": "puff-walkthrough.mp4",
  "steps": [
    {
      "image": "frames/01-project-overview.png",
      "caption": "Review each person's total work and open a session.",
      "duration": 4.5,
      "cursor": [420, 260],
      "click": true
    }
  ]
}
```

Image and output paths are relative to the manifest unless absolute. Cursor coordinates use the original screenshot's pixels. `duration` defaults to 4.5 seconds; `cursor` and `click` are optional. The encoder preserves screenshot proportions inside a 1280 × 720 area, adds a 90-pixel caption band, and streams H.264 video at 24 fps to a 1280 × 810 MP4. No audio track is added.
