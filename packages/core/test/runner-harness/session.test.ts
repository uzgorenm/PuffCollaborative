import { describe, expect } from "bun:test"
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { RunnerHarnessSession } from "@opencode-ai/core/runner-harness/session"
import { ThreadBindingTable } from "@opencode-ai/core/runner-harness/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { testEffect } from "../lib/effect"

const projectA = ProjectV2.ID.make("prj_runner_a")
const projectB = ProjectV2.ID.make("prj_runner_b")
const worker = Coordination.WorkerID.make("wrk_runner")
const owner = Coordination.ExecutionOwner.make({ workerId: worker, instanceId: "instance_a" })
const runtime = { id: "runtime_a", workerId: worker, instanceId: owner.instanceId }
const timestamp = "2026-09-29T20:00:00.000Z"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) =>
      Effect.succeed({
        id: directory.includes("project-b") ? projectB : projectA,
        directory: AbsolutePath.make(path.dirname(directory)),
      }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)

const workspaceId = (name: string) => WorkspaceV2.ID.make(`wrk_${name}`)

function record(input: {
  threadId: string
  sessionId: SessionV2.ID
  projectId: ProjectV2.ID
  runId: string
  text: string
}) {
  const thread = Schema.decodeUnknownSync(Coordination.Thread)({
    id: input.threadId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    workerId: worker,
    title: input.threadId,
    createdBy: "usr_owner",
    createdAt: timestamp,
    activitySeq: 0,
  })
  const instruction = Schema.decodeUnknownSync(Coordination.InstructionRequest)({
    id: `ins_${input.runId}`,
    requestId: `req_${input.runId}`,
    threadId: thread.id,
    actorId: "usr_owner",
    text: input.text,
    queueSeq: 1,
    submittedAt: timestamp,
    runId: input.runId,
  })
  const run = Schema.decodeUnknownSync(Coordination.Run)({
    id: input.runId,
    threadId: thread.id,
    instructionId: instruction.id,
    state: "reserved",
    attempt: 1,
    runnerMessageId: `msg_${input.runId}`,
    executionOwner: owner,
    createdAt: timestamp,
  })
  return {
    thread,
    instruction,
    run,
    command: {
      runId: run.id,
      threadId: thread.id,
      sessionId: thread.sessionId,
      executionOwner: owner,
      runnerMessageId: run.runnerMessageId,
      text: instruction.text,
    },
  }
}

const directory = (root: string, project: string, thread: string) => path.join(root, project, thread)

const createDirectory = (root: string, project: string, thread: string) =>
  Effect.promise(async () => {
    const value = directory(root, project, thread)
    await mkdir(value, { recursive: true })
    return value
  })

const tempRoot = Effect.acquireRelease(
  Effect.promise(async () => realpath(await mkdtemp(path.join(os.tmpdir(), "runner-session-")))),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
)

function binding(
  db: Database.Interface["db"],
  session: SessionV2.Interface,
  records: ReadonlyArray<ReturnType<typeof record>>,
) {
  return RunnerHarnessSession.make({
    db,
    session,
    workerId: worker,
    access: {
      getThread: (_principal, threadId) => {
        const found = records.find((item) => item.thread.id === threadId)
        return found
          ? Effect.succeed(found.thread)
          : Effect.fail({ code: "not_found" as const, message: "Thread missing" })
      },
    },
    queue: {
      getRun: (runId) => Effect.succeed(records.find((item) => item.run.id === runId)?.run),
      instructions: (threadId) =>
        Effect.succeed(records.filter((item) => item.thread.id === threadId).map((item) => item.instruction)),
    },
  })
}

describe("runner Session binding", () => {
  it.live("reuses the bound Session and its promoted context for the next turn", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot
      const dir = yield* createDirectory(root, "project-a", "thread-one")
      const session = yield* SessionV2.Service
      const db = (yield* Database.Service).db
      const events = yield* EventV2.Service
      const id = SessionV2.ID.make("ses_runner_continuity")
      yield* session.create({
        id,
        location: Location.Ref.make({ directory: AbsolutePath.make(dir), workspaceID: workspaceId("one") }),
      })
      const first = record({ threadId: "thr_one", sessionId: id, projectId: projectA, runId: "run_one", text: "First" })
      const second = record({
        threadId: "thr_one",
        sessionId: id,
        projectId: projectA,
        runId: "run_two",
        text: "Second",
      })
      const service = binding(db, session, [first, second])
      expect(yield* service.coordinator.resolve(id)).toEqual({ projectId: projectA, workerId: worker })

      const initial = yield* service.authorize(first.command)
      const workspace = { id: workspaceId("one"), threadId: first.thread.id, projectId: projectA, directory: dir }
      expect((yield* service.attach({ run: initial, workspace, runtime })).id).toBe(id)
      const admitted = yield* session.prompt({
        id: SessionMessage.ID.make("msg_first_turn"),
        sessionID: id,
        prompt: { text: "First turn made this decision" },
        delivery: "queue",
        resume: false,
      })
      expect(yield* SessionInput.promoteNextQueued(db, events, id)).toBe(true)
      const restarted = binding(db, session, [first, second])
      const next = yield* restarted.authorize(second.command)
      const handedOff = yield* restarted.attach({ run: next, workspace, runtime })
      expect(handedOff.id).toBe(id)
      expect((yield* session.context(handedOff.id)).filter((message) => message.type === "user")).toMatchObject([
        { id: admitted.id, text: "First turn made this decision" },
      ])
      expect(
        (yield* db.select().from(ThreadBindingTable).where(eq(ThreadBindingTable.thread_id, first.thread.id)).all())
          .length,
      ).toBe(1)
    }),
  )

  it.live("isolates projects and Threads and rejects changed command or workspace metadata", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot
      const firstDir = yield* createDirectory(root, "project-a", "thread-one")
      const secondDir = yield* createDirectory(root, "project-a", "thread-two")
      const otherDir = yield* createDirectory(root, "project-b", "thread-three")
      const session = yield* SessionV2.Service
      const db = (yield* Database.Service).db
      const ids = ["ses_isolation_one", "ses_isolation_two", "ses_isolation_three"].map((value) =>
        SessionV2.ID.make(value),
      )
      yield* Effect.all(
        [firstDir, secondDir, otherDir].map((dir, index) =>
          session.create({
            id: ids[index]!,
            location: Location.Ref.make({
              directory: AbsolutePath.make(dir),
              workspaceID: workspaceId(`${index}`),
            }),
          }),
        ),
      )
      const first = record({
        threadId: "thr_one",
        sessionId: ids[0]!,
        projectId: projectA,
        runId: "run_one",
        text: "A",
      })
      const second = record({
        threadId: "thr_two",
        sessionId: ids[1]!,
        projectId: projectA,
        runId: "run_two",
        text: "B",
      })
      const wrongProject = record({
        threadId: "thr_three",
        sessionId: ids[2]!,
        projectId: projectA,
        runId: "run_three",
        text: "C",
      })
      const collision = record({
        threadId: "thr_collision",
        sessionId: ids[0]!,
        projectId: projectA,
        runId: "run_collision",
        text: "Duplicate Session",
      })
      const service = binding(db, session, [first, second, wrongProject, collision])
      expect(
        (yield* service.authorize({ ...first.command, sessionId: second.thread.sessionId }).pipe(Effect.flip)).code,
      ).toBe("conflict")
      expect((yield* service.authorize({ ...first.command, text: "Changed" }).pipe(Effect.flip)).code).toBe("conflict")
      expect((yield* service.authorize(wrongProject.command).pipe(Effect.flip)).code).toBe("conflict")
      expect(
        (yield* service
          .authorize({
            ...first.command,
            executionOwner: { workerId: Coordination.WorkerID.make("wrk_other"), instanceId: owner.instanceId },
          })
          .pipe(Effect.flip)).code,
      ).toBe("forbidden")
      expect(yield* service.coordinator.resolve(ids[2]!)).toEqual({ projectId: projectB, workerId: worker })
      const authorized = yield* service.authorize(first.command)
      expect(
        (yield* service
          .attach({
            run: authorized,
            workspace: { id: workspaceId("1"), threadId: first.thread.id, projectId: projectA, directory: secondDir },
            runtime,
          })
          .pipe(Effect.flip)).code,
      ).toBe("conflict")
      yield* service.attach({
        run: authorized,
        workspace: { id: workspaceId("0"), threadId: first.thread.id, projectId: projectA, directory: firstDir },
        runtime,
      })
      const other = yield* service.authorize(collision.command)
      expect(
        (yield* service
          .attach({
            run: other,
            workspace: {
              id: workspaceId("0"),
              threadId: collision.thread.id,
              projectId: projectA,
              directory: firstDir,
            },
            runtime,
          })
          .pipe(Effect.flip)).code,
      ).toBe("conflict")
      expect(
        (yield* service
          .attach({
            run: authorized,
            workspace: { id: workspaceId("0"), threadId: second.thread.id, projectId: projectA, directory: firstDir },
            runtime,
          })
          .pipe(Effect.flip)).code,
      ).toBe("conflict")
    }),
  )

  it.live("reconciles a lost create response, serializes concurrent binding, and detects a missing Session", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot
      const dir = yield* createDirectory(root, "project-a", "thread-one")
      const session = yield* SessionV2.Service
      const db = (yield* Database.Service).db
      const id = SessionV2.ID.make("ses_creation_ack_lost")
      yield* session.create({
        id,
        location: Location.Ref.make({ directory: AbsolutePath.make(dir), workspaceID: workspaceId("one") }),
      })
      const first = record({ threadId: "thr_one", sessionId: id, projectId: projectA, runId: "run_one", text: "First" })
      const service = binding(db, session, [first])
      const run = yield* service.authorize(first.command)
      const workspace = { id: workspaceId("one"), threadId: first.thread.id, projectId: projectA, directory: dir }
      const attached = yield* Effect.all(
        [service.attach({ run, workspace, runtime }), service.attach({ run, workspace, runtime })],
        { concurrency: "unbounded" },
      )
      expect(attached.map((info) => info.id)).toEqual([id, id])
      expect((yield* db.select().from(ThreadBindingTable).all()).length).toBe(1)
      expect((yield* db.select().from(SessionTable).where(eq(SessionTable.id, id)).all()).length).toBe(1)

      const changedDir = yield* createDirectory(root, "project-a", "moved")
      yield* db
        .update(SessionTable)
        .set({ directory: changedDir })
        .where(eq(SessionTable.id, id))
        .run()
        .pipe(Effect.orDie)
      expect((yield* service.authorize(first.command).pipe(Effect.flip)).code).toBe("conflict")

      yield* db.delete(SessionTable).where(eq(SessionTable.id, id)).run().pipe(Effect.orDie)
      expect((yield* service.authorize(first.command).pipe(Effect.flip)).code).toBe("not_found")
      expect((yield* service.coordinator.resolve(id).pipe(Effect.flip)).code).toBe("not_found")
      expect((yield* db.select().from(SessionTable).where(eq(SessionTable.id, id)).all()).length).toBe(0)
    }),
  )
})
