import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const flawedSource = "export const names = (projects?: string[]) => projects.map(x => x.toUpperCase())\n"
const fixedSource = "export const names = (projects: string[] = []) => projects.map(x => x.toUpperCase())\n"
const testSource = `import { test, expect } from "bun:test"
import { names } from "./project-list"
test("an absent projects list is empty", () => expect(names()).toEqual([]))
test("project names are uppercased", () => expect(names(["Puff"])).toEqual(["PUFF"]))
`

export const fixPatch = `--- a/project-list.ts
+++ b/project-list.ts
@@ -1 +1 @@
-export const names = (projects?: string[]) => projects.map(x => x.toUpperCase())
+export const names = (projects: string[] = []) => projects.map(x => x.toUpperCase())`

export const fixError = "TypeError: Cannot read properties of undefined (reading 'map') at ProjectList"
export const fixSummary = "Default an absent projects list to an empty array."
export const fixCommand = "bun test project-list.test.ts"

type TestReceipt = { exitCode: number; output: string }

async function runTest(workspacePath: string): Promise<TestReceipt> {
  // Fixed argument array and fixed source files: no request text reaches a shell or a user checkout.
  const child = Bun.spawn([process.execPath, "test", "project-list.test.ts"], {
    cwd: workspacePath,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
    },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { exitCode, output: `${stdout}\n${stderr}`.trim().replaceAll(workspacePath, "[disposable workspace]").slice(0, 12_000) }
}

export async function applyFixInDisposableWorkspace(options: { forcePostTestFailure?: boolean } = {}) {
  const workspacePath = await mkdtemp(join(tmpdir(), "puff-sim-fix-"))
  let receipt: {
    workspacePath: string
    before: TestReceipt
    after: TestReceipt
    patch: string
    cleaned: boolean
  } | undefined
  try {
    const sourcePath = join(workspacePath, "project-list.ts")
    const testPath = join(workspacePath, "project-list.test.ts")
    await writeFile(sourcePath, flawedSource, { mode: 0o600 })
    await writeFile(testPath, testSource, { mode: 0o600 })
    const before = await runTest(workspacePath)
    if (before.exitCode === 0) throw new Error("The synthetic failing baseline unexpectedly passed")
    if (await readFile(sourcePath, "utf8") !== flawedSource) throw new Error("Synthetic patch base changed")
    await writeFile(sourcePath, fixedSource)
    if (options.forcePostTestFailure)
      await writeFile(testPath, testSource + 'test("injected verification failure", () => expect(1).toBe(2))\n')
    const after = await runTest(workspacePath)
    receipt = { workspacePath, before, after, patch: fixPatch, cleaned: true }
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
  if (!receipt) throw new Error("Synthetic fix receipt was not produced")
  // Developer-only stdout receipt. The temporary path is never sent in a normal UI response.
  console.info("[Puff SIMULATED fix developer receipt]", JSON.stringify({
    workspacePath: receipt.workspacePath,
    baselineExitCode: receipt.before.exitCode,
    verificationExitCode: receipt.after.exitCode,
    cleaned: receipt.cleaned,
  }))
  return receipt
}
