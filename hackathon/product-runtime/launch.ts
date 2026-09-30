import { spawn, execFileSync } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { createWriteStream } from "node:fs"
import { mkdir, readFile, access, chmod } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { initializeSettings, runtimeEnvironment } from "./config"
import { acquireRuntimeLock } from "./lock"
import { flowerCycle, runFlower } from "./flower"
import { atomicPrivateFile, atomicPrivateJson } from "./private-json"

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const runtimeDirectory = resolve(process.env.PUFF_PRODUCT_STATE ?? join(repository, "../.puff-product-runtime"))
const executable = process.execPath
const children: ChildProcess[] = []
const groups = new Set<ChildProcess>()
let stopped = false
let releaseLock: (() => Promise<void>) | undefined

function port() {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const value = probe.port
  probe.stop(true)
  if (!value) throw new Error("Could not allocate a local port")
  return value
}

async function privateJson(name: string, value: unknown) {
  await atomicPrivateJson(join(runtimeDirectory, name), value)
}

function child(
  name: string,
  command: string,
  args: string[],
  environment: Record<string, string | undefined>,
  cwd: string,
) {
  if (stopped) throw new Error("Runtime is stopping")
  const output = createWriteStream(join(runtimeDirectory, `${name}.log`), { flags: "a", mode: 0o600 })
  const running = spawn(command, args, {
    cwd,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  })
  running.stdout?.pipe(output)
  running.stderr?.pipe(output)
  running.on("error", (error) => {
    console.error(`${name} could not start: ${error.message}`)
    stop(1)
  })
  children.push(running)
  return running
}

async function waitFor(url: string, running: ChildProcess, headers?: Record<string, string>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (stopped) throw new Error("Runtime is stopping")
    if (running.exitCode !== null || running.signalCode !== null)
      throw new Error("Local service exited; inspect its private runtime log")
    if (
      await fetch(url, { headers, signal: AbortSignal.timeout(1000) })
        .then((response) => response.ok)
        .catch(() => false)
    )
      return
    await Bun.sleep(200)
  }
  throw new Error(`Local service did not become ready at ${url}`)
}

async function terminate(running: ChildProcess) {
  if (running.exitCode !== null || running.signalCode !== null) return
  if (groups.has(running) && running.pid) {
    try {
      process.kill(-running.pid, "SIGTERM")
    } catch {}
  } else running.kill("SIGTERM")
  await Promise.race([new Promise<void>((done) => running.once("exit", () => done())), Bun.sleep(5000)])
  if (running.exitCode === null && running.signalCode === null) {
    if (groups.has(running) && running.pid) {
      try {
        process.kill(-running.pid, "SIGKILL")
      } catch {}
    } else running.kill("SIGKILL")
  }
}

async function stop(code = 0) {
  if (stopped) return
  stopped = true
  await Promise.all(children.map(terminate))
  await releaseLock?.()
  process.exit(code)
}

process.on("SIGINT", () => {
  void stop()
})
process.on("SIGTERM", () => {
  void stop()
})

async function main() {
  releaseLock = await acquireRuntimeLock(runtimeDirectory)
  const settings = await initializeSettings(runtimeDirectory)
  const environment = runtimeEnvironment(runtimeDirectory, settings)
  const operator = settings.members.find((member) => member.username === (process.env.PUFF_PRODUCT_MEMBER ?? "serdar"))
  if (!operator) throw new Error("PUFF_PRODUCT_MEMBER must name an approved local member")
  environment.PUFF_MEMBER_USERNAME = operator.username
  environment.PUFF_MEMBER_PASSWORD = operator.password
  const savedPorts = (await readFile(join(runtimeDirectory, "ports.json"), "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error.code !== "ENOENT") throw error
      return undefined
    })) as { backendPort: number } | undefined
  const previous = !savedPorts
    ? await readFile(join(runtimeDirectory, "running.json"), "utf8")
        .then(JSON.parse)
        .catch(() => undefined)
    : undefined
  const backendPort = Number(
    process.env.PUFF_BACKEND_PORT ??
      savedPorts?.backendPort ??
      (previous?.backendUrl ? new URL(previous.backendUrl).port : undefined) ??
      port(),
  )
  if (!Number.isInteger(backendPort) || backendPort < 1024 || backendPort > 65535)
    throw new Error("Invalid product backend port")
  if (savedPorts && process.env.PUFF_BACKEND_PORT && backendPort !== savedPorts.backendPort)
    throw new Error(
      "Changing an existing backend port requires a new PUFF_PRODUCT_STATE to preserve saved connection identities",
    )
  await privateJson("ports.json", { backendPort })
  const backendUrl = `http://127.0.0.1:${backendPort}`
  const webPort = Number(process.env.PUFF_WEB_PORT ?? 3006)
  if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535) throw new Error("Invalid PUFF_WEB_PORT")
  const workspaceRoot = join(runtimeDirectory, "workspaces")
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 })
  const approved = (await readFile(join(runtimeDirectory, "project.json"), "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })) as { baseRevision: string; repositoryRoot: string; projectId: string } | undefined
  const baseRevision =
    approved?.baseRevision ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim()
  if (approved && approved.repositoryRoot !== repository)
    throw new Error("Runtime belongs to a different repository; choose a new PUFF_PRODUCT_STATE")
  const bootstrap = join(workspaceRoot, "bootstrap")
  if (
    !(await access(bootstrap)
      .then(() => true)
      .catch(() => false))
  ) {
    execFileSync(
      "git",
      ["worktree", "add", "-b", `puff/product-bootstrap-${Date.now().toString(36)}`, bootstrap, baseRevision],
      { cwd: repository, stdio: "pipe" },
    )
  }
  const providerConfigPath = process.env.PUFF_PROVIDER_CONFIG ? resolve(process.env.PUFF_PROVIDER_CONFIG) : undefined
  if (providerConfigPath) {
    await mkdir(join(environment.XDG_CONFIG_HOME, "opencode"), { recursive: true, mode: 0o700 })
    const globalProvider = join(environment.XDG_CONFIG_HOME, "opencode/opencode.json")
    const providerBytes = await readFile(providerConfigPath)
    await atomicPrivateFile(globalProvider, providerBytes)
    await chmod(globalProvider, 0o600)
  }
  const normal = child(
    "bootstrap",
    executable,
    ["run", "src/index.ts", "serve", "--hostname", "127.0.0.1", "--port", String(backendPort)],
    { ...environment, OPENCODE_RUNNER_CONFIG_PATH: "", OPENCODE_COORDINATION_PROVISIONING_PATH: "" },
    join(repository, "packages/opencode"),
  )
  const runtimeAuth = `Basic ${Buffer.from(`opencode:${settings.runtimePassword}`).toString("base64")}`
  await waitFor(`${backendUrl}/api/health`, normal, { Authorization: runtimeAuth })
  let projectId = approved?.projectId
  if (!projectId) {
    const response = await fetch(`${backendUrl}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: runtimeAuth },
      body: JSON.stringify({ location: { directory: bootstrap, workspaceID: "wrk_product_bootstrap" } }),
    })
    if (!response.ok) throw new Error(`OpenCode bootstrap returned HTTP ${response.status}`)
    const result = (await response.json()) as { data?: { projectID?: string } }
    projectId = result.data?.projectID
    if (!projectId) throw new Error("OpenCode bootstrap did not return a Project identity")
    await privateJson("project.json", { projectId, baseRevision, repositoryRoot: repository })
  }
  await terminate(normal)
  const identities = await Promise.all([
    ...settings.members.map(async (member) => ({
      username: member.username,
      passwordHash: await Bun.password.hash(member.password),
      auth: { kind: "member", userId: member.userId },
    })),
    (async () => ({
      username: "worker",
      passwordHash: await Bun.password.hash(settings.workerPassword),
      auth: { kind: "runner", workerId: settings.workerId, instanceId: settings.instanceId },
    }))(),
    (async () => ({
      username: "flower",
      passwordHash: await Bun.password.hash(settings.analysisPassword),
      auth: { kind: "analysis", serviceId: "product-flower" },
    }))(),
  ])
  await privateJson("identities.json", { identities })
  await privateJson("admissions.json", {
    allowed: settings.members.map((member) => ({ userId: member.userId, projectId })),
  })
  await privateJson("runner.json", {
    owner: { workerId: settings.workerId, instanceId: settings.instanceId },
    username: "worker",
    workspaceRoot,
    projects: [{ projectId, repositoryRoot: repository, baseRevision }],
    toolPath: `${dirname(executable)}:/opt/homebrew/bin:/usr/bin:/bin`,
  })
  const model =
    process.env.PUFF_MODEL_PROVIDER && process.env.PUFF_MODEL_ID
      ? { providerID: process.env.PUFF_MODEL_PROVIDER, id: process.env.PUFF_MODEL_ID }
      : undefined
  await privateJson("provisioning.json", {
    workspaceRoot,
    worker: { workerId: settings.workerId, instanceId: settings.instanceId },
    model,
    projects: [
      {
        name: "Puff Collaborative",
        repositoryRoot: repository,
        baseRevision,
        allowedUsers: settings.members.map((member) => member.userId),
      },
    ],
  })
  const backend = child(
    "backend",
    executable,
    ["run", "src/index.ts", "serve", "--hostname", "127.0.0.1", "--port", String(backendPort)],
    { ...environment, OPENCODE_RUNNER_CONFIG_PATH: join(runtimeDirectory, "runner.json") },
    join(repository, "packages/opencode"),
  )
  await waitFor(`${backendUrl}/api/coordination/v1/status`, backend)
  const memberHeaders = {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(`${settings.members[0].username}:${settings.members[0].password}`).toString("base64")}`,
  }
  const request = async (path: string, body?: unknown, auth = memberHeaders, method?: "GET" | "POST" | "PUT") => {
    if (stopped) throw new Error("Runtime is stopping")
    const response = await fetch(`${backendUrl}/api/coordination/v1${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: auth,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`Coordinator returned HTTP ${response.status} for ${path}`)
    return response.json()
  }
  await request("/projects", { projectId, name: "Puff Collaborative", requestId: "product-project-bootstrap-v1" })
  for (const member of settings.members.slice(1))
    await request(`/projects/${encodeURIComponent(projectId)}/members`, {
      targetUserId: member.userId,
      requestId: `product-member-${member.userId}-v1`,
    })
  const node = process.env.PUFF_NODE ?? "/opt/homebrew/bin/node"
  const web = child(
    "web",
    node,
    [
      join(repository, "apps/web/node_modules/next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(webPort),
    ],
    {
      ...environment,
      PUFF_API_URL: backendUrl,
      PUFF_BACKEND_MEMBER_PATH: "",
      PUFF_BACKEND_URL: "",
      PUFF_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
      PUFF_RUNTIME_DIR: join(runtimeDirectory, "web-connection"),
      PUFF_CONNECTION_SCOPE: createHash("sha256").update(runtimeDirectory).digest("hex").slice(0, 16),
    },
    join(repository, "apps/web"),
  )
  await waitFor(`http://127.0.0.1:${webPort}/api/connection`, web)
  await privateJson("running.json", {
    launcherPid: process.pid,
    backendPid: backend.pid,
    webPid: web.pid,
    backendUrl,
    webUrl: `http://127.0.0.1:${webPort}`,
    projectId,
    modelConfigured: !!model,
    startedAt: new Date().toISOString(),
  })
  console.log(`Puff product: http://127.0.0.1:${webPort}`)
  console.log(`Persistent data: ${runtimeDirectory}`)
  console.log(
    model
      ? "Coding model configured. New sessions use isolated worktrees."
      : "Configure PUFF_MODEL_PROVIDER, PUFF_MODEL_ID and PUFF_PROVIDER_CONFIG to enable coding-agent execution.",
  )
  const flowerPython = process.env.PUFF_FLOWER_PYTHON
  if (flowerPython) {
    const flowerApi = async (path: string, body?: unknown, credential?: string, method?: "GET" | "POST" | "PUT") => {
      if (stopped) throw new Error("Runtime is stopping")
      const member =
        credential && credential !== "analysis"
          ? settings.members.find((member) => member.userId === credential)
          : undefined
      if (credential && credential !== "analysis" && !member) throw new Error("Unknown Session owner")
      const auth = credential === "analysis" ? { username: "flower", password: settings.analysisPassword } : member
      const headers = auth
        ? {
            "Content-Type": "application/json",
            Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`,
          }
        : memberHeaders
      return request(path, body, headers, method)
    }
    void (async () => {
      while (!stopped) {
        await flowerCycle({
          projectId,
          stateDirectory: runtimeDirectory,
          api: flowerApi,
          analyze: (envelope) => {
            if (stopped) throw new Error("Runtime is stopping")
            return runFlower(
              flowerPython,
              join(repository, "hackathon/flower/product_export.py"),
              join(runtimeDirectory, "flower-chain"),
              envelope,
              (running) => {
                if (stopped && running.pid) {
                  try {
                    process.kill(-running.pid, "SIGKILL")
                  } catch {}
                } else {
                  children.push(running)
                  groups.add(running)
                }
              },
            )
          },
        }).catch(() => undefined)
        await Bun.sleep(15000)
      }
    })()
    console.log(
      "Flower background analysis enabled for explicitly selected Sessions; hosted run results are recorded separately from delivery.",
    )
  }
  const workerHeaders = {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(`worker:${settings.workerPassword}`).toString("base64")}`,
  }
  while (!stopped) {
    if (backend.exitCode !== null || backend.signalCode !== null || web.exitCode !== null || web.signalCode !== null)
      throw new Error("Product service exited; inspect its private runtime log")
    const threads = (await request(`/projects/${encodeURIComponent(projectId)}/threads`).catch(() => [])) as {
      id: string
    }[]
    for (const thread of threads) {
      const snapshot = (await request(`/threads/${encodeURIComponent(thread.id)}`).catch(() => undefined)) as
        | { runs?: { state: string }[] }
        | undefined
      if (snapshot?.runs?.some((run) => run.state === "queued"))
        await request(`/runner/threads/${encodeURIComponent(thread.id)}/reserve`, {}, workerHeaders).catch(
          () => undefined,
        )
    }
    await Bun.sleep(500)
  }
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Product runtime failed")
    void stop(1)
  })
