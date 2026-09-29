export * as MockRunner from "./mock"

import { Effect } from "effect"
import type { CoordinationContracts } from "../contracts"
import type { Coordination } from "@opencode-ai/schema/coordination"

export type MockStep =
  | {
      readonly kind: "activity"
      readonly activity: Coordination.RunnerActivity
      readonly delayMs?: number
      readonly duplicate?: boolean
    }
  | {
      readonly kind: "approval"
      readonly approvalId: string
      readonly toolCallId: string
      readonly delayMs?: number
      readonly duplicate?: boolean
    }
  | { readonly kind: "complete" | "fail" | "disconnect"; readonly delayMs?: number; readonly duplicate?: boolean }

type Callback = Parameters<CoordinationContracts.Runner["report"]>[0]
type Report = (input: Omit<Callback, "principal">) => Promise<void>

type PendingApproval = {
  readonly id: string
  readonly resume: (decision: "approve" | "reject") => void
}

type MockRun = {
  readonly command: CoordinationContracts.RunnerCommand
  readonly steps: ReadonlyArray<MockStep>
  done: Promise<void>
  state: "admitted" | "running" | "terminal"
  callbackSeq: number
  cancelled: boolean
  approval?: PendingApproval
  decision?: { readonly approvalId: string; readonly decisionId: string; readonly decision: "approve" | "reject" }
  error?: unknown
}

export function createMockRunner(input: {
  readonly report: Report
  readonly plan: (command: CoordinationContracts.RunnerCommand) => ReadonlyArray<MockStep>
}) {
  const runs = new Map<Coordination.RunID, MockRun>()
  const starts: CoordinationContracts.RunnerCommand[] = []
  const callbacks: Omit<Callback, "principal">[] = []
  const decisions: { readonly runId: Coordination.RunID; readonly decisionId: string }[] = []
  let connected = true
  let dropNextStartResponse = false

  const failure = (message: string, code: CoordinationContracts.ErrorCode = "unavailable") => ({ code, message })

  const emit = async (run: MockRun, callback: CoordinationContracts.RunnerCallback, duplicate = false) => {
    if (!connected) throw failure("Mock runner disconnected")
    const input = {
      runId: run.command.runId,
      callbackId: `${run.command.runId}:${++run.callbackSeq}`,
      callback,
    }
    callbacks.push(input)
    await inputReport(input)
    if (duplicate) {
      callbacks.push(input)
      await inputReport(input)
    }
  }

  const inputReport = (callback: Omit<Callback, "principal">) => input.report(callback)

  const execute = async (run: MockRun) => {
    try {
      await emit(run, { kind: "state", expectedState: "reserved", nextState: "running" })
      run.state = "running"
      for (const step of run.steps) {
        if (step.delayMs) await Bun.sleep(step.delayMs)
        if (run.cancelled) {
          await emit(run, { kind: "state", expectedState: "cancelling", nextState: "cancelled" })
          run.state = "terminal"
          return
        }
        if (step.kind === "disconnect") {
          connected = false
          return
        }
        if (step.kind === "activity") {
          await emit(run, { kind: "activity", state: "running", activity: step.activity }, step.duplicate)
          continue
        }
        if (step.kind === "approval") {
          await emit(
            run,
            {
              kind: "state",
              expectedState: "running",
              nextState: "waiting_approval",
              approvalId: step.approvalId,
              toolCallId: step.toolCallId,
            },
            step.duplicate,
          )
          await new Promise<"approve" | "reject">((resume) => {
            run.approval = { id: step.approvalId, resume }
          })
          run.approval = undefined
          if (run.cancelled) {
            await emit(run, { kind: "state", expectedState: "cancelling", nextState: "cancelled" })
            run.state = "terminal"
            return
          }
          await emit(run, { kind: "state", expectedState: "waiting_approval", nextState: "running" })
          continue
        }
        await emit(
          run,
          { kind: "state", expectedState: "running", nextState: step.kind === "fail" ? "failed" : "completed" },
          step.duplicate,
        )
        run.state = "terminal"
        return
      }
      await emit(run, { kind: "state", expectedState: "running", nextState: "completed" })
      run.state = "terminal"
    } catch (error) {
      run.error = error
    }
  }

  const port: CoordinationContracts.RunnerPort = {
    start: (command) =>
      Effect.gen(function* () {
        if (!connected) return yield* Effect.fail(failure("Mock runner disconnected"))
        const existing = runs.get(command.runId)
        if (existing) {
          if (JSON.stringify(existing.command) !== JSON.stringify(command)) {
            return yield* Effect.fail(failure("Run ID reused with a different start command", "conflict"))
          }
          return { messageId: command.runnerMessageId }
        }
        starts.push(command)
        const run: MockRun = {
          command,
          steps: input.plan(command),
          state: "admitted",
          callbackSeq: 0,
          cancelled: false,
          done: Promise.resolve(),
        }
        runs.set(command.runId, run)
        run.done = Promise.resolve().then(() => execute(run))
        if (dropNextStartResponse) {
          dropNextStartResponse = false
          return yield* Effect.fail(failure("Start response was lost"))
        }
        return { messageId: command.runnerMessageId }
      }),
    interrupt: ({ runId }) =>
      Effect.gen(function* () {
        if (!connected) return yield* Effect.fail(failure("Mock runner disconnected"))
        const run = runs.get(runId)
        if (!run) return yield* Effect.fail(failure("Run not found", "not_found"))
        run.cancelled = true
        run.approval?.resume("reject")
      }),
    resolveApproval: ({ runId, approvalId, decisionId, decision }) =>
      Effect.gen(function* () {
        if (!connected) return yield* Effect.fail(failure("Mock runner disconnected"))
        const run = runs.get(runId)
        if (!run) return yield* Effect.fail(failure("Run not found", "not_found"))
        if (run.decision) {
          if (
            run.decision.approvalId === approvalId &&
            run.decision.decisionId === decisionId &&
            run.decision.decision === decision
          )
            return
          return yield* Effect.fail(failure("Approval already decided", "conflict"))
        }
        if (run.approval?.id !== approvalId) return yield* Effect.fail(failure("Approval not pending", "conflict"))
        run.decision = { approvalId, decisionId, decision }
        decisions.push({ runId, decisionId })
        run.approval.resume(decision)
      }),
    reconcile: (runnerMessageId) =>
      Effect.gen(function* () {
        if (!connected) return yield* Effect.fail(failure("Mock runner disconnected"))
        const run = Array.from(runs.values()).find((item) => item.command.runnerMessageId === runnerMessageId)
        return run?.state ?? "missing"
      }),
  }

  return {
    port,
    starts,
    callbacks,
    decisions,
    setConnected(value: boolean) {
      connected = value
    },
    loseNextStartResponse() {
      dropNextStartResponse = true
    },
    async wait(runId: Coordination.RunID) {
      const run = runs.get(runId)
      if (!run) throw new Error(`Run not found: ${runId}`)
      await run.done
      if (run.error) throw run.error
    },
  }
}
