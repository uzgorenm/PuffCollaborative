import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { WorkspaceState } from "./workspace.ts"

export class WorkspaceApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "WorkspaceApiError"
    this.status = status
  }
}

export function validateWorkspaceId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new WorkspaceApiError(400, "workspaceId must be a UUID")
  }
  return value.toLowerCase()
}

// Sharing the queue across instances prevents overlapping requests from loading
// the same old snapshot before either mutation has been committed.
const mutations = new Map<string, Promise<unknown>>()

export class WorkspaceStore {
  readonly directory: string

  constructor(directory?: string) {
    // Run the web dev/start commands from apps/web so the default store stays
    // alongside this app. Tests and other callers can provide a directory.
    this.directory = directory ?? join(process.cwd(), ".puff-workspaces")
  }

  async create(workspace: WorkspaceState): Promise<string> {
    const id = randomUUID()
    await this.save(id, workspace)
    return id
  }

  async transaction<T>(id: string, operation: (workspace: unknown) => Promise<{ result: T; workspace?: WorkspaceState }> | { result: T; workspace?: WorkspaceState }): Promise<T> {
    const path = join(this.directory, `${validateWorkspaceId(id)}.json`)
    const previous = mutations.get(path) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(async () => {
      const text = await readFile(path, "utf8").catch((error: unknown) => {
        if (isMissingFile(error)) throw new WorkspaceApiError(404, "Workspace not found")
        throw new WorkspaceApiError(500, "Workspace could not be loaded")
      })
      const parsed: unknown = JSON.parse(text)
      const next = await operation(parsed)
      if (next.workspace) await this.save(id, next.workspace)
      return next.result
    })
    mutations.set(path, current)
    try {
      return await current
    } finally {
      if (mutations.get(path) === current) mutations.delete(path)
    }
  }

  private async save(id: string, workspace: WorkspaceState) {
    const path = join(this.directory, `${validateWorkspaceId(id)}.json`)
    const temporary = `${path}.${randomUUID()}.tmp`
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      await writeFile(temporary, JSON.stringify(workspace), { flag: "wx", mode: 0o600 })
      await rename(temporary, path)
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!isMissingFile(error)) throw error
      })
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
