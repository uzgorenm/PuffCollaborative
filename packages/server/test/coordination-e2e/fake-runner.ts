import type { CoordinationContracts } from "@opencode-ai/core/coordination/contracts"

if (process.env.PUFF_COORDINATION_E2E !== "1") throw new Error("Test entry point is disabled")

type Command = CoordinationContracts.RunnerCommand
type Callback = CoordinationContracts.RunnerCallback
type FakeRun = {
  command: Command
  status: "admitted" | "running" | "terminal"
  decision?: { approvalId: string; decisionId: string; decision: "approve" | "reject" }
}

const coordinatorUrl = process.env.PUFF_E2E_COORDINATOR_URL!
const credential = `Basic ${Buffer.from(`${process.env.PUFF_E2E_RUNNER_USER}:${process.env.PUFF_E2E_RUNNER_PASSWORD}`).toString("base64")}`
const runs = new Map<string, FakeRun>()
const attempts: Command[] = []
const starts: Command[] = []
const executions: string[] = []
const callbacks: Array<{ runId: string; callbackId: string; status: number }> = []
const interrupts: Array<{ runId: string; sessionId: string }> = []
const decisions: Array<{ runId: string; decisionId: string; decision: string }> = []
const polls: Array<{ threadId: string; status: number; runId?: string }> = []
let connected = true
let dropStartAck = false
let dropCallbackAck = false
let rejectStart = false
let startAckDelayMs = 0
let autoStart = false
let autoPoll = false

const json = (value: unknown, status = 200) => Response.json(value, { status })
const body = (request: Request) => request.json() as Promise<Record<string, unknown>>

async function report(runId: string, callbackId: string, callback: Callback) {
  const response = await fetch(`${coordinatorUrl}/api/coordination/v1/runner/runs/${runId}/events`, {
    method: "POST",
    headers: { authorization: credential, "content-type": "application/json" },
    body: JSON.stringify({ callbackId, callback }),
  })
  callbacks.push({ runId, callbackId, status: response.status })
  if (response.ok) {
    const run = runs.get(runId)
    if (run && callback.kind === "state") {
      if (callback.nextState === "running") {
        if (run.status === "admitted") executions.push(runId)
        run.status = "running"
      }
      if (["completed", "failed", "cancelled"].includes(callback.nextState)) run.status = "terminal"
      if (autoPoll && run.status === "terminal") queueMicrotask(() => void poll(run.command.threadId))
    }
  }
  return { status: response.status, data: await response.json().catch(() => undefined) }
}

async function poll(threadId: string) {
  const response = await fetch(`${coordinatorUrl}/api/coordination/v1/runner/threads/${threadId}/reserve`, {
    method: "POST",
    headers: { authorization: credential },
  })
  const data = (await response.json().catch(() => undefined)) as { run?: { id: string } } | undefined
  polls.push({ threadId, status: response.status, runId: data?.run?.id })
  return { status: response.status, data }
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PUFF_E2E_RUNNER_PORT),
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/health") return json({ ready: true })
    if (path === "/admin/state")
      return json({
        attempts,
        starts,
        executions,
        callbacks,
        interrupts,
        decisions,
        polls,
        runs: [...runs.entries()].map(([id, run]) => ({ id, status: run.status, command: run.command })),
      })
    if (path === "/admin/options") {
      const options = await body(request)
      if (typeof options.connected === "boolean") connected = options.connected
      if (typeof options.autoStart === "boolean") autoStart = options.autoStart
      if (typeof options.autoPoll === "boolean") autoPoll = options.autoPoll
      if (options.dropStartAck === true) dropStartAck = true
      if (options.dropCallbackAck === true) dropCallbackAck = true
      if (options.rejectStart === true) rejectStart = true
      if (typeof options.startAckDelayMs === "number") startAckDelayMs = options.startAckDelayMs
      return json({ connected, autoStart, autoPoll })
    }
    if (path === "/admin/poll") return json(await poll(String((await body(request)).threadId)))
    if (path === "/admin/callback") {
      const input = await body(request)
      const runId = String(input.runId)
      const callbackId = String(input.callbackId)
      const callback = input.callback as Callback
      const first = await report(runId, callbackId, callback)
      if (dropCallbackAck) {
        dropCallbackAck = false
        return json({ first: { status: 503, data: { error: "callback acknowledgment lost" } }, delivered: first })
      }
      const second = input.duplicate === true ? await report(runId, callbackId, callback) : undefined
      return json({ first, second })
    }
    if (!connected) return json({ error: "fake runner disconnected" }, 503)
    if (path === "/start") {
      const command = (await request.json()) as Command
      attempts.push(command)
      if (rejectStart) {
        rejectStart = false
        return json({ error: "start rejected before admission" }, 503)
      }
      const prior = runs.get(command.runId)
      if (prior && JSON.stringify(prior.command) !== JSON.stringify(command))
        return json({ error: "run ID reused with a different command" }, 409)
      if (!prior) {
        starts.push(command)
        runs.set(command.runId, { command, status: "admitted" })
        if (autoStart)
          queueMicrotask(
            () =>
              void report(command.runId, `${command.runId}:start`, {
                kind: "state",
                expectedState: "reserved",
                nextState: "running",
              }),
          )
      }
      if (dropStartAck) {
        dropStartAck = false
        return json({ error: "start accepted, acknowledgment lost" }, 503)
      }
      if (startAckDelayMs > 0) {
        const delay = startAckDelayMs
        startAckDelayMs = 0
        await Bun.sleep(delay)
      }
      return json({ messageId: command.runnerMessageId })
    }
    if (path === "/reconcile") {
      const input = await body(request)
      return json(
        [...runs.values()].find((run) => run.command.runnerMessageId === input.runnerMessageId)?.status ?? "missing",
      )
    }
    if (path === "/interrupt") {
      const input = (await request.json()) as { runId: string; sessionId: string }
      interrupts.push(input)
      return json({ accepted: true })
    }
    if (path === "/decision") {
      const input = (await request.json()) as {
        runId: string
        approvalId: string
        decisionId: string
        decision: "approve" | "reject"
      }
      const run = runs.get(input.runId)
      if (!run) return json({ error: "run missing" }, 404)
      if (
        run.decision &&
        (run.decision.approvalId !== input.approvalId ||
          run.decision.decisionId !== input.decisionId ||
          run.decision.decision !== input.decision)
      )
        return json({ error: "decision conflict" }, 409)
      if (!run.decision) {
        run.decision = { approvalId: input.approvalId, decisionId: input.decisionId, decision: input.decision }
        decisions.push(input)
      }
      return json({ accepted: true })
    }
    return json({ error: "not found" }, 404)
  },
})

console.log(`fake runner ready ${server.port}`)
