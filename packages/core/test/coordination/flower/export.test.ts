import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { captureSelected } from "../../../src/coordination/flower/export"

const projectId = Coordination.ProjectID.make("prj_flower_export")
const ownerId = Coordination.UserID.make("usr_owner")
const workerId = Coordination.WorkerID.make("worker_one")
const sourceId = Coordination.ThreadID.make("thr_source")
const targetId = Coordination.ThreadID.make("thr_target")
const otherId = Coordination.ThreadID.make("thr_private")
const auth = { kind: "member", userId: ownerId } as const
const future = new Date(Date.now() + 3_600_000).toISOString()
const past = new Date(Date.now() - 3_600_000).toISOString()

const thread = (id: Coordination.ThreadID, sessionId: string, activitySeq: number): Coordination.Thread => ({
  id,
  projectId,
  sessionId: Coordination.Thread.fields.sessionId.make(sessionId),
  workerId,
  title: "Private title should not leave Puff",
  createdBy: ownerId,
  createdAt: "2026-09-29T19:00:00.000Z",
  activitySeq,
})

const source = thread(sourceId, "ses_source", 4)
const target = thread(targetId, "ses_target", 8)
const privateThread = thread(otherId, "ses_private", 10)
const events: Coordination.Event[] = [
  {
    id: "evt_a",
    projectId,
    threadId: sourceId,
    seq: 4,
    kind: "run.tool",
    occurredAt: "2026-09-29T19:01:00.000Z",
    payload: { toolName: "Read", status: "completed", summary: "secret=raw-data" },
  },
  {
    id: "evt_b",
    projectId,
    threadId: targetId,
    seq: 8,
    kind: "run.output",
    occurredAt: "2026-09-29T19:02:00.000Z",
    payload: { text: "private transcript" },
  },
  {
    id: "evt_hidden",
    projectId,
    threadId: otherId,
    seq: 10,
    kind: "run.output",
    occurredAt: "2026-09-29T19:03:00.000Z",
    payload: { text: "private session" },
  },
]

const granted = (selected: Coordination.Thread) => ({
  ownerId,
  projectId,
  sessionId: selected.sessionId,
  workerId,
  featureTopic: "Frontend navigation",
  relationship: "alternative" as const,
  expiresAt: future,
  muted: false,
})

function fixture(
  options: {
    revoked?: boolean
    expired?: boolean
    changed?: boolean
    changedConsent?: boolean
    muted?: boolean
    wrongBinding?: boolean
    missingSource?: boolean
    sparseProjectSeq?: boolean
  } = {},
) {
  const threads = new Map(
    [options.sparseProjectSeq ? { ...source, activitySeq: 2 } : source, target, privateThread].map((item) => [
      item.id,
      item,
    ]),
  )
  const journal = options.sparseProjectSeq
    ? events.map((event) => (event.id === "evt_a" ? { ...event, seq: 17 } : event))
    : events
  let reads = 0
  let consentReads = 0
  return {
    auth,
    projectId,
    sourceThreadId: sourceId,
    targetThreadId: targetId,
    requestId: "req_one",
    access: {
      getThread: (_auth: Coordination.AuthContext, id: Coordination.ThreadID) => {
        reads++
        const item = threads.get(id)
        return item
          ? Effect.succeed(options.changed && reads > 2 && id === sourceId ? { ...item, activitySeq: 11 } : item)
          : Effect.fail({ code: "forbidden" as const, message: "Access denied" })
      },
    },
    binding: {
      resolve: (id: Coordination.Thread["sessionId"]) =>
        Effect.succeed({
          projectId,
          workerId:
            options.wrongBinding && id === source.sessionId ? Coordination.WorkerID.make("other_worker") : workerId,
        }),
    },
    selection: {
      current: (selected: Coordination.Thread) => {
        consentReads++
        if (options.missingSource && selected.id === sourceId) return Effect.succeed(undefined)
        if (options.revoked && consentReads > 2) return Effect.succeed(undefined)
        if (options.changedConsent && consentReads > 2)
          return Effect.succeed({ ...granted(selected), featureTopic: "Backend navigation" })
        return Effect.succeed({
          ...granted(selected),
          muted: options.muted ?? false,
          expiresAt: options.expired ? past : future,
        })
      },
    },
    events: {
      replayThread: (id: Coordination.ThreadID, after: number, limit: number) => {
        const selected = journal.filter((event) => event.threadId === id && event.seq > after)
        const page = selected.slice(0, limit)
        return Effect.succeed({ events: page, cursor: page.at(-1)?.seq ?? after, hasMore: selected.length > limit })
      },
    },
  }
}

describe("trusted Flower selected-activity export", () => {
  test("keeps exact Puff IDs and sequences while dropping transcript, summaries and private sessions", async () => {
    const capture = await Effect.runPromise(captureSelected(fixture()))
    expect(capture.snapshot.events.map((event) => [event.eventId, event.revision])).toEqual([
      ["evt_a", 4],
      ["evt_b", 8],
    ])
    expect(capture.request.evidenceRefs.map((ref) => [ref.eventId, ref.revision])).toEqual([
      ["evt_a", 4],
      ["evt_b", 8],
    ])
    expect(capture.provenance.map((ref) => [ref.threadId, ref.eventId, ref.eventSeq, ref.threadActivitySeq])).toEqual([
      [sourceId, "evt_a", 4, 4],
      [targetId, "evt_b", 8, 8],
    ])
    expect(JSON.stringify(capture)).not.toMatch(/private transcript|private session|Private title|raw-data/)
  })

  test("fails closed when current consent is expired or revoked during capture", async () => {
    expect(await Effect.runPromise(Effect.flip(captureSelected(fixture({ expired: true }))))).toMatchObject({
      code: "forbidden",
    })
    expect(await Effect.runPromise(Effect.flip(captureSelected(fixture({ revoked: true }))))).toMatchObject({
      code: "forbidden",
    })
    expect(await Effect.runPromise(Effect.flip(captureSelected(fixture({ muted: true }))))).toMatchObject({
      code: "forbidden",
    })
    expect(await Effect.runPromise(Effect.flip(captureSelected(fixture({ missingSource: true }))))).toMatchObject({
      code: "forbidden",
    })
    expect(await Effect.runPromise(Effect.flip(captureSelected(fixture({ wrongBinding: true }))))).toMatchObject({
      code: "forbidden",
    })
  })

  test("fails closed when a Thread advances after evidence capture", async () => {
    expect(await Effect.runPromise(Effect.flip(captureSelected(fixture({ changed: true }))))).toMatchObject({
      code: "conflict",
    })
  })

  test("fails closed when selection metadata changes during capture", async () => {
    expect(await Effect.runPromise(Effect.flip(captureSelected(fixture({ changedConsent: true }))))).toMatchObject({
      code: "conflict",
    })
  })

  test("keeps project event sequence distinct from captured Thread activity sequence", async () => {
    const capture = await Effect.runPromise(captureSelected(fixture({ sparseProjectSeq: true })))
    expect(capture.snapshot.sharedSessions[0].revision).toBe(17)
    expect(capture.request.evidenceRefs[0].revision).toBe(17)
    expect(capture.provenance[0]).toMatchObject({ eventId: "evt_a", eventSeq: 17, threadActivitySeq: 2 })
  })
})
