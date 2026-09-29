export * as RunnerHarnessSession from "./session"

import { realpath } from "node:fs/promises"
import path from "node:path"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { SessionV2 } from "../session"
import type { Database } from "../database/database"
import type { CoordinationContracts } from "../coordination/contracts"
import type { RunnerHarnessContracts } from "./contracts"
import { ThreadBindingTable } from "./sql"

export interface Dependencies {
  readonly db: Database.Interface["db"]
  readonly access: Pick<CoordinationContracts.Access, "getThread">
  readonly queue: Pick<CoordinationContracts.Queue, "getRun" | "instructions">
  readonly session: SessionV2.Interface
  readonly workerId: Coordination.WorkerID
}

export function make(input: Dependencies): RunnerHarnessContracts.SessionBinding {
  const missingSession: CoordinationContracts.Failure = { code: "not_found", message: "OpenCode session not found" }
  const incompatible: CoordinationContracts.Failure = { code: "conflict", message: "Session binding is incompatible" }
  const missingRun: CoordinationContracts.Failure = { code: "not_found", message: "Coordinator Run not found" }
  const wrongCommand: CoordinationContracts.Failure = {
    code: "conflict",
    message: "Runner command does not match the coordinator Run",
  }
  const wrongWorker: CoordinationContracts.Failure = { code: "forbidden", message: "Run belongs to another worker" }

  const session = (sessionId: Parameters<SessionV2.Interface["get"]>[0]) =>
    input.session.get(sessionId).pipe(Effect.mapError(() => missingSession))

  const canonical = (directory: string) =>
    Effect.tryPromise({
      try: () => realpath(directory),
      catch: () => ({ code: "not_found" as const, message: "Session workspace directory is missing" }),
    })

  const validateStored = (binding: typeof ThreadBindingTable.$inferSelect, info: SessionV2.Info) =>
    binding.project_id === info.projectID &&
    binding.session_id === info.id &&
    binding.workspace_id === info.location.workspaceID &&
    binding.directory === info.location.directory

  const authorize: RunnerHarnessContracts.SessionBinding["authorize"] = Effect.fn("RunnerHarnessSession.authorize")(
    function* (command) {
      if (command.executionOwner.workerId !== input.workerId) return yield* Effect.fail(wrongWorker)
      const run = yield* input.queue.getRun(command.runId)
      if (!run) return yield* Effect.fail(missingRun)
      // Recovery may inspect a terminal Run, but a queued Run has never been delivered to this worker.
      if (
        run.threadId !== command.threadId ||
        run.runnerMessageId !== command.runnerMessageId ||
        run.executionOwner?.workerId !== command.executionOwner.workerId ||
        run.executionOwner.instanceId !== command.executionOwner.instanceId ||
        run.state === "queued"
      )
        return yield* Effect.fail(wrongCommand)
      const thread = yield* input.access.getThread(
        { kind: "runner", workerId: input.workerId, instanceId: command.executionOwner.instanceId },
        command.threadId,
        "runner",
      )
      if (thread.sessionId !== command.sessionId || thread.workerId !== input.workerId)
        return yield* Effect.fail(wrongCommand)
      const instruction = (yield* input.queue.instructions(thread.id)).find((item) => item.id === run.instructionId)
      if (
        !instruction ||
        instruction.runId !== run.id ||
        instruction.threadId !== thread.id ||
        instruction.text !== command.text
      )
        return yield* Effect.fail(wrongCommand)
      const info = yield* session(thread.sessionId)
      if (info.projectID !== thread.projectId || info.time.archived) return yield* Effect.fail(incompatible)
      const binding = yield* input.db
        .select()
        .from(ThreadBindingTable)
        .where(eq(ThreadBindingTable.thread_id, thread.id))
        .get()
        .pipe(Effect.orDie)
      if (binding && (!validateStored(binding, info) || binding.worker_id !== thread.workerId))
        return yield* Effect.fail(incompatible)
      return { command, projectId: thread.projectId, attempt: run.attempt, session: info }
    },
  )

  const attach: RunnerHarnessContracts.SessionBinding["attach"] = Effect.fn("RunnerHarnessSession.attach")(
    function* (request) {
      const run = yield* authorize(request.run.command)
      if (request.run.projectId !== run.projectId || request.run.session.id !== run.session.id)
        return yield* Effect.fail(incompatible)
      if (
        request.workspace.threadId !== run.command.threadId ||
        request.workspace.projectId !== run.projectId ||
        request.runtime.workerId !== run.command.executionOwner.workerId ||
        request.runtime.instanceId !== run.command.executionOwner.instanceId ||
        !request.runtime.id ||
        !path.isAbsolute(request.workspace.directory)
      )
        return yield* Effect.fail(incompatible)
      const directory = yield* canonical(request.workspace.directory)
      const sessionDirectory = yield* canonical(run.session.location.directory)
      if (
        directory !== request.workspace.directory ||
        directory !== sessionDirectory ||
        request.workspace.id !== run.session.location.workspaceID
      )
        return yield* Effect.fail(incompatible)

      const now = Date.now()
      yield* input.db
        .insert(ThreadBindingTable)
        .values({
          thread_id: run.command.threadId,
          project_id: run.projectId,
          session_id: run.session.id,
          worker_id: run.command.executionOwner.workerId,
          workspace_id: request.workspace.id,
          directory,
          created_at: now,
          updated_at: now,
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      const binding = yield* input.db
        .select()
        .from(ThreadBindingTable)
        .where(eq(ThreadBindingTable.thread_id, run.command.threadId))
        .get()
        .pipe(Effect.orDie)
      if (
        !binding ||
        !validateStored(binding, run.session) ||
        binding.worker_id !== run.command.executionOwner.workerId ||
        binding.directory !== directory
      )
        return yield* Effect.fail(incompatible)
      return run.session
    },
  )

  const coordinator: CoordinationContracts.SessionBinding = {
    resolve: Effect.fn("RunnerHarnessSession.resolve")(function* (sessionId) {
      // createThread resolves the Session before its Thread binding row can exist.
      const info = yield* session(sessionId)
      if (!info.location.workspaceID || info.time.archived) return yield* Effect.fail(incompatible)
      const directory = yield* canonical(info.location.directory)
      const binding = yield* input.db
        .select()
        .from(ThreadBindingTable)
        .where(eq(ThreadBindingTable.session_id, sessionId))
        .get()
        .pipe(Effect.orDie)
      if (
        binding &&
        (!validateStored(binding, info) || binding.directory !== directory || binding.worker_id !== input.workerId)
      )
        return yield* Effect.fail(incompatible)
      return { projectId: info.projectID, workerId: binding?.worker_id ?? input.workerId }
    }),
  }

  return { authorize, attach, coordinator }
}
