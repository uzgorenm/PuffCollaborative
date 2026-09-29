export * as RunnerArtifacts from "./artifacts"

import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { Coordination } from "@opencode-ai/schema/coordination"
import { Git } from "../git"
import { AppProcess } from "../process"
import { AbsolutePath } from "../schema"
import { Hash } from "../util/hash"
import type { Failure, LocalExecution, SecurityPolicy } from "./contracts"

const maxFiles = 200
const maxMetadataBytes = 1024 * 1024
const maxUntrackedBytes = 2 * 1024 * 1024
const maxPatchBytes = 64 * 1024
const maxReportPatchBytes = 256 * 1024

/** The private Git tree is captured after workspace binding and before prompt admission. */
export interface Baseline {
  readonly revision?: string
  /** Policy-approved paths with uncommitted work already present at capture time. */
  readonly dirtyPaths: ReadonlyArray<string>
  readonly projectId: Coordination.ProjectID
  readonly threadId: Coordination.ThreadID
  readonly runId: Coordination.RunID
  readonly workspaceId: string
  readonly directoryHash: string
  readonly head?: string
  readonly branchBase?: string
  readonly branchBaseKind: "origin/main" | "head" | "unavailable"
  readonly untrackedPaths: ReadonlyArray<string>
  readonly skipped: ReadonlyArray<{ readonly path: string; readonly size?: number; readonly modified?: number }>
  readonly skippedTruncated: boolean
  readonly excludedCount: number
  readonly state: "complete" | "truncated" | "unavailable"
}

export interface Change {
  /** Always relative to this Thread's Git worktree. */
  readonly path: string
  readonly previousPath?: string
  readonly status: "added" | "modified" | "deleted" | "renamed" | "untracked" | "binary" | "oversized"
  readonly change: "added" | "modified" | "deleted" | "renamed" | "untracked" | "unsupported"
  readonly content: "complete" | "truncated" | "unavailable" | "binary" | "oversized" | "redacted"
  readonly patch?: string
  readonly bytesBefore?: number
  readonly bytesAfter?: number
  readonly dirtyBeforeRun: boolean
  readonly ref?: string
}

/** Complete means every allowed text patch fit; omitted, redacted, binary, or large content makes it truncated. */
export interface ScopeReport {
  readonly from?: string
  readonly to?: string
  readonly state: "complete" | "truncated" | "unavailable"
  readonly changed: ReadonlyArray<Change>
  readonly excludedCount: number
  readonly omittedCount: number
}

export interface Report {
  readonly state: "complete" | "truncated" | "unavailable"
  readonly changed: ReadonlyArray<Change>
  readonly activity: ReadonlyArray<Coordination.RunnerActivity>
  readonly projectId: Coordination.ProjectID
  readonly threadId: Coordination.ThreadID
  readonly runId: Coordination.RunID
  readonly sessionId: string
  readonly workspaceId: string
  readonly baseline: string | undefined
  readonly final: string | undefined
  readonly head: string | undefined
  readonly branchBase: string | undefined
  readonly branchBaseKind: Baseline["branchBaseKind"]
  readonly excludedCount: number
  readonly scopes: {
    /** Baseline tree to final tree: changes observed during this Run. */
    readonly run: ScopeReport
    /** Merge base (or HEAD fallback) to baseline tree: prior commits and dirty work. */
    readonly beforeRun: ScopeReport
    /** Merge base (or HEAD fallback) to final tree: the branch and workspace as a whole. */
    readonly overall: ScopeReport
  }
}

export interface Dependencies {
  readonly git: Git.Interface
  readonly process: AppProcess.Interface
  readonly policy: SecurityPolicy
  /** OpenCode's private data directory. Snapshot objects remain local to the runner. */
  readonly dataDirectory: string
}

export interface Interface {
  readonly baseline: (execution: LocalExecution) => Effect.Effect<Baseline, Failure>
  readonly collect: (input: {
    readonly execution: LocalExecution
    readonly baseline: { readonly revision?: string; readonly dirtyPaths: ReadonlyArray<string> }
  }) => Effect.Effect<Report, Failure>
}

export function make(input: Dependencies): Interface {
  const baseline: Interface["baseline"] = (execution) =>
    Effect.gen(function* () {
      const workspace = yield* requireWorkspace(execution, input.policy)
      const source = yield* input.git.repo.discover(AbsolutePath.make(workspace.directory))
      const identity = {
        projectId: execution.run.projectId,
        threadId: execution.run.command.threadId,
        runId: execution.run.command.runId,
        workspaceId: workspace.id,
        directoryHash: Hash.sha256(workspace.directory),
      }
      if (!source || path.resolve(source.worktree) !== workspace.directory)
        return {
          ...identity,
          dirtyPaths: [],
          branchBaseKind: "unavailable" as const,
          untrackedPaths: [],
          skipped: [],
          skippedTruncated: false,
          excludedCount: 0,
          state: "unavailable" as const,
        }

      const head = yield* input.git.history.head(source)
      const merge = yield* gitCommand(input.process, source, ["merge-base", "HEAD", "origin/main"]).pipe(Effect.option)
      const branchBase =
        merge._tag === "Some" && merge.value.exitCode === 0 ? merge.value.stdout.toString().trim() : head
      const branchBaseKind =
        merge._tag === "Some" && merge.value.exitCode === 0 ? "origin/main" : head ? "head" : "unavailable"
      const dirty = yield* gitCommand(input.process, source, ["diff", "--name-only", "-z", "HEAD"]).pipe(Effect.option)
      const untracked = yield* gitCommand(input.process, source, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]).pipe(Effect.option)
      const dirtyPaths = yield* permittedPaths(
        execution,
        workspace.directory,
        [...paths(dirty), ...paths(untracked)],
        input.policy,
      )
      const safeUntracked = yield* permittedPaths(execution, workspace.directory, paths(untracked), input.policy)
      const captured = yield* capture(input, source, workspace.directory, execution).pipe(Effect.option)
      const safeSkipped =
        captured._tag === "Some"
          ? yield* Effect.forEach(captured.value.skipped, (item) =>
              allowPath(execution, workspace.directory, item.path, input.policy).pipe(
                Effect.map((allowed) => (allowed ? item : undefined)),
              ),
            )
          : []
      const skipped = safeSkipped.filter((item): item is NonNullable<typeof item> => item !== undefined)

      return {
        ...identity,
        revision: captured._tag === "Some" ? captured.value.revision : undefined,
        dirtyPaths: dirtyPaths.paths,
        head,
        branchBase,
        branchBaseKind,
        untrackedPaths: safeUntracked.paths,
        skipped,
        skippedTruncated: captured._tag === "Some" && captured.value.skippedTruncated,
        excludedCount: captured._tag === "Some" ? captured.value.excludedCount : 0,
        state:
          captured._tag === "None"
            ? ("unavailable" as const)
            : dirtyPaths.truncated ||
                safeUntracked.truncated ||
                safeSkipped.length !== skipped.length ||
                captured.value.skippedTruncated ||
                captured.value.excludedCount > 0 ||
                dirty._tag === "None" ||
                untracked._tag === "None" ||
                (dirty._tag === "Some" && dirty.value.stdoutTruncated) ||
                (untracked._tag === "Some" && untracked.value.stdoutTruncated) ||
                branchBaseKind !== "origin/main"
              ? ("truncated" as const)
              : ("complete" as const),
      }
    })

  const collect: Interface["collect"] = ({ execution, baseline }) =>
    Effect.gen(function* () {
      const workspace = yield* requireWorkspace(execution, input.policy)
      const previous = baseline as Partial<Baseline>
      if (
        previous.projectId !== execution.run.projectId ||
        previous.threadId !== execution.run.command.threadId ||
        previous.runId !== execution.run.command.runId ||
        previous.workspaceId !== workspace.id ||
        previous.directoryHash !== Hash.sha256(workspace.directory)
      )
        return yield* Effect.fail(failure("forbidden", "Artifact baseline belongs to another Run or workspace"))

      const source = yield* input.git.repo.discover(AbsolutePath.make(workspace.directory))
      const base = {
        projectId: execution.run.projectId,
        threadId: execution.run.command.threadId,
        runId: execution.run.command.runId,
        sessionId: execution.run.command.sessionId,
        workspaceId: workspace.id,
        baseline: previous.revision,
        head: previous.head,
        branchBase: previous.branchBase,
        branchBaseKind: previous.branchBaseKind ?? ("unavailable" as const),
        excludedCount: previous.excludedCount ?? 0,
      }
      if (!source || path.resolve(source.worktree) !== workspace.directory || !previous.revision) {
        const unavailable = emptyScope("unavailable")
        return {
          ...base,
          state: "unavailable" as const,
          final: undefined,
          changed: [],
          activity: [],
          scopes: { run: unavailable, beforeRun: unavailable, overall: unavailable },
        }
      }

      const captured = yield* capture(input, source, workspace.directory, execution).pipe(Effect.option)
      if (captured._tag === "None") {
        const unavailable = emptyScope("unavailable")
        return {
          ...base,
          state: "unavailable" as const,
          final: undefined,
          changed: [],
          activity: [],
          scopes: { run: unavailable, beforeRun: unavailable, overall: unavailable },
        }
      }

      const untracked = yield* gitCommand(input.process, source, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]).pipe(Effect.option)
      const currentUntracked = new Set(paths(untracked))
      const beforeUntracked = new Set(previous.untrackedPaths ?? [])
      const priorDirty = new Set(previous.dirtyPaths ?? [])
      const run = yield* scope(input, {
        execution,
        workspace: workspace.directory,
        repository: captured.value.repository,
        from: previous.revision,
        to: captured.value.revision,
        untracked: currentUntracked,
        priorDirty,
        skipped: captured.value.skipped.filter((item) => {
          const before = previous.skipped?.find((candidate) => candidate.path === item.path)
          return !before || before.size !== item.size || before.modified !== item.modified
        }),
      })
      const beforeRun = yield* scope(input, {
        execution,
        workspace: workspace.directory,
        repository: captured.value.repository,
        from: previous.branchBase,
        to: previous.revision,
        untracked: beforeUntracked,
        priorDirty,
        skipped: previous.skipped ?? [],
      })
      const overall = yield* scope(input, {
        execution,
        workspace: workspace.directory,
        repository: captured.value.repository,
        from: previous.branchBase,
        to: captured.value.revision,
        untracked: currentUntracked,
        priorDirty,
        skipped: captured.value.skipped,
      })
      const state = [run.state, beforeRun.state, overall.state].includes("unavailable")
        ? ("unavailable" as const)
        : [run.state, beforeRun.state, overall.state].includes("truncated") ||
            previous.state !== "complete" ||
            captured.value.skippedTruncated ||
            captured.value.excludedCount > 0 ||
            (untracked._tag === "Some" && untracked.value.stdoutTruncated)
          ? ("truncated" as const)
          : ("complete" as const)
      return {
        ...base,
        state,
        excludedCount: Math.max(previous.excludedCount ?? 0, captured.value.excludedCount),
        final: captured.value.revision,
        changed: run.changed,
        // R7 must only publish run.diff after an existing OpenCode surface can resolve its ref.
        activity: [],
        scopes: { run, beforeRun, overall },
      }
    })

  return { baseline, collect }
}

function requireWorkspace(execution: LocalExecution, policy: SecurityPolicy) {
  return Effect.gen(function* () {
    const workspace = execution.workspace
    if (!workspace) return yield* Effect.fail(failure("invalid", "Run has no bound workspace"))
    if (workspace.threadId !== execution.run.command.threadId || workspace.projectId !== execution.run.projectId)
      return yield* Effect.fail(failure("forbidden", "Run and workspace binding differ"))
    yield* policy.workspace({ run: execution.run, workspace })
    const directory = yield* Effect.tryPromise({
      try: () => fs.realpath(workspace.directory),
      catch: () => failure("unavailable", "Workspace directory is unavailable"),
    })
    if (directory !== path.resolve(workspace.directory))
      return yield* Effect.fail(failure("forbidden", "Workspace directory is not canonical"))
    return { ...workspace, directory }
  })
}

function capture(input: Dependencies, source: Git.Repository, directory: string, execution: LocalExecution) {
  return Effect.gen(function* () {
    const gitDirectory = AbsolutePath.make(
      path.join(
        input.dataDirectory,
        "runner-harness",
        "artifacts",
        Hash.sha256(`${execution.run.projectId}:${execution.run.command.threadId}:${directory}`),
      ),
    )
    const repository = (yield* Effect.promise(() => Bun.file(path.join(gitDirectory, "HEAD")).exists()))
      ? new Git.Repository({ worktree: AbsolutePath.make(directory), gitDirectory, commonDirectory: gitDirectory })
      : yield* input.git.repo.create({ worktree: AbsolutePath.make(directory), gitDirectory, seed: source })
    const tracked = yield* gitCommand(input.process, source, ["ls-files", "--cached", "-z"])
    const untracked = yield* gitCommand(input.process, source, ["ls-files", "--others", "--exclude-standard", "-z"])
    if (tracked.exitCode !== 0 || untracked.exitCode !== 0 || tracked.stdoutTruncated || untracked.stdoutTruncated)
      return yield* Effect.fail(failure("unavailable", "Workspace path inventory is incomplete"))
    const untrackedPaths = new Set(paths({ _tag: "Some", value: untracked }))
    const candidates = [...new Set([...paths({ _tag: "Some", value: tracked }), ...untrackedPaths])]
    let excludedCount = 0
    const checked = yield* Effect.forEach(
      candidates,
      (file) =>
        Effect.gen(function* () {
          if (!(yield* allowPath(execution, directory, file, input.policy))) {
            excludedCount += 1
            return undefined
          }
          const stat = yield* Effect.tryPromise({
            try: () => fs.lstat(path.join(directory, file)),
            catch: () => failure("unavailable", "File metadata is unavailable"),
          }).pipe(Effect.option)
          if (stat._tag === "None") return undefined
          if (untrackedPaths.has(file) && stat.value.size > maxUntrackedBytes)
            return { path: file, size: stat.value.size, modified: stat.value.mtimeMs, skipped: true as const }
          return { path: file, skipped: false as const }
        }),
      { concurrency: 8 },
    )
    const included = checked.filter(
      (item): item is { readonly path: string; readonly skipped: false } => item !== undefined && !item.skipped,
    )
    const skipped = checked.filter(
      (
        item,
      ): item is {
        readonly path: string
        readonly size: number
        readonly modified: number
        readonly skipped: true
      } => item !== undefined && item.skipped,
    )
    // Rebuild only the private index from approved paths; the user's repository index is untouched.
    const cleared = yield* gitCommand(input.process, repository, ["read-tree", "--empty"], 4096)
    if (cleared.exitCode !== 0) return yield* Effect.fail(failure("unavailable", "Artifact index is unavailable"))
    if (included.length) {
      const staged = yield* gitCommand(
        input.process,
        repository,
        ["add", "--all", "--force", "--pathspec-from-file=-", "--pathspec-file-nul"],
        4096,
        included.map((item) => literal(item.path)).join("\0") + "\0",
      )
      if (staged.exitCode !== 0)
        return yield* Effect.fail(failure("unavailable", "Artifact files could not be captured"))
    }
    return {
      repository,
      revision: yield* input.git.tree.write(repository),
      skipped: skipped.slice(0, maxFiles),
      skippedTruncated: skipped.length > maxFiles,
      excludedCount,
    }
  })
}

function scope(
  input: Dependencies,
  request: {
    readonly execution: LocalExecution
    readonly workspace: string
    readonly repository: Git.Repository
    readonly from?: string
    readonly to?: string
    readonly untracked: ReadonlySet<string>
    readonly priorDirty: ReadonlySet<string>
    readonly skipped: Baseline["skipped"]
  },
) {
  return Effect.gen(function* () {
    if (!request.from || !request.to) return emptyScope("unavailable")
    const names = yield* gitCommand(input.process, request.repository, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames=50%",
      "--name-status",
      "-z",
      request.from,
      request.to,
    ]).pipe(Effect.option)
    if (names._tag === "None" || names.value.exitCode !== 0) return emptyScope("unavailable")
    const entries = parseNames(names.value.stdout.toString("utf8"))
    const selected = entries.slice(0, maxFiles)
    const skipped = request.skipped.filter((item) => !selected.some((entry) => entry.path === item.path))
    let excludedCount = 0
    let remaining = maxReportPatchBytes
    let incomplete = names.value.stdoutTruncated || entries.length > maxFiles || request.skipped.length > skipped.length
    const changed = yield* Effect.forEach(
      [...selected, ...skipped.slice(0, Math.max(0, maxFiles - selected.length))],
      (entry) =>
        Effect.gen(function* () {
          const current = yield* allowPath(request.execution, request.workspace, entry.path, input.policy)
          const previous =
            "previousPath" in entry && entry.previousPath
              ? yield* allowPath(request.execution, request.workspace, entry.previousPath, input.policy)
              : undefined
          if (!current || ("previousPath" in entry && entry.previousPath && !previous)) {
            excludedCount += 1
            incomplete = true
            return undefined
          }
          const change = "code" in entry ? kind(entry.code) : ("untracked" as const)
          const untracked = request.untracked.has(entry.path)
          const before = "previousPath" in entry && entry.previousPath ? entry.previousPath : entry.path
          const bytesBefore = yield* blobSize(input.process, request.repository, request.from!, before)
          const bytesAfter = yield* blobSize(input.process, request.repository, request.to!, entry.path)
          const dirtyBeforeRun = request.priorDirty.has(entry.path) || request.priorDirty.has(before)
          const common = {
            path: entry.path,
            previousPath: "previousPath" in entry ? entry.previousPath : undefined,
            change,
            bytesBefore,
            bytesAfter,
            dirtyBeforeRun,
            ref: current.ref,
          }
          if (!("code" in entry) || Math.max(bytesBefore ?? 0, bytesAfter ?? 0) > maxUntrackedBytes) {
            incomplete = true
            return { ...common, status: "oversized" as const, content: "oversized" as const }
          }
          if (change === "unsupported") {
            incomplete = true
            return { ...common, status: "modified" as const, content: "unavailable" as const }
          }
          const numstat = yield* gitCommand(input.process, request.repository, [
            "diff",
            "--numstat",
            "-z",
            "--no-renames",
            request.from!,
            request.to!,
            "--",
            literal(before),
            literal(entry.path),
          ]).pipe(Effect.option)
          if (numstat._tag === "None" || numstat.value.exitCode !== 0 || numstat.value.stdoutTruncated) {
            incomplete = true
            return { ...common, status: status(change, untracked), content: "unavailable" as const }
          }
          if (numstat.value.stdout.toString("utf8").includes("-\t-\t")) {
            incomplete = true
            return { ...common, status: "binary" as const, content: "binary" as const }
          }
          if (remaining <= 0) {
            incomplete = true
            return { ...common, status: status(change, untracked), content: "truncated" as const }
          }
          const patch = yield* gitCommand(
            input.process,
            request.repository,
            [
              "diff",
              "--no-ext-diff",
              "--no-textconv",
              "--find-renames=50%",
              "--no-color",
              "--unified=3",
              request.from!,
              request.to!,
              "--",
              literal(before),
              literal(entry.path),
            ],
            Math.min(maxPatchBytes, remaining),
          ).pipe(Effect.option)
          if (patch._tag === "None" || patch.value.exitCode !== 0) {
            incomplete = true
            return { ...common, status: status(change, untracked), content: "unavailable" as const }
          }
          // A cut-off secret may no longer match the redactor, so never expose a partial raw patch.
          if (patch.value.stdoutTruncated) {
            incomplete = true
            return { ...common, status: status(change, untracked), content: "truncated" as const }
          }
          const text = patch.value.stdout.toString("utf8")
          const redacted = input.policy.redact(text)
          const encoded = Buffer.from(redacted)
          if (encoded.byteLength > remaining || encoded.byteLength > maxPatchBytes) {
            incomplete = true
            return { ...common, status: status(change, untracked), content: "truncated" as const }
          }
          remaining -= encoded.byteLength
          if (redacted !== text) incomplete = true
          return {
            ...common,
            status: status(change, untracked),
            content: redacted !== text ? ("redacted" as const) : ("complete" as const),
            patch: redacted,
          }
        }),
      { concurrency: 1 },
    )
    return {
      from: request.from,
      to: request.to,
      state:
        incomplete || excludedCount > 0 || skipped.length > maxFiles - selected.length
          ? ("truncated" as const)
          : ("complete" as const),
      changed: changed.filter((item): item is NonNullable<typeof item> => item !== undefined),
      excludedCount,
      omittedCount: Math.max(0, entries.length + skipped.length - maxFiles),
    }
  })
}

function gitCommand(
  process: AppProcess.Interface,
  repository: Git.Repository,
  args: ReadonlyArray<string>,
  limit = maxMetadataBytes,
  stdin?: string,
) {
  return process
    .run(
      ChildProcess.make(
        "git",
        ["--no-optional-locks", "--git-dir", repository.gitDirectory, "--work-tree", repository.worktree, ...args],
        {
          cwd: repository.worktree,
          extendEnv: true,
        },
      ),
      { maxOutputBytes: limit, maxErrorBytes: 4096, timeout: "30 seconds", stdin },
    )
    .pipe(Effect.mapError(() => failure("unavailable", "Git metadata is unavailable")))
}

function blobSize(process: AppProcess.Interface, repository: Git.Repository, revision: string, file: string) {
  return gitCommand(process, repository, ["cat-file", "-s", `${revision}:${file}`], 64).pipe(
    Effect.map((result) => (result.exitCode === 0 ? Number(result.stdout.toString("utf8").trim()) : undefined)),
    Effect.catch(() => Effect.succeed(undefined)),
  )
}

function paths(result: { readonly _tag: "None" } | { readonly _tag: "Some"; readonly value: AppProcess.RunResult }) {
  return result._tag === "Some" && result.value.exitCode === 0
    ? completeRecords(result.value.stdout.toString("utf8")).split("\0").filter(Boolean)
    : []
}

function parseNames(output: string) {
  const parts = completeRecords(output).split("\0").filter(Boolean)
  const entries: Array<{ readonly code: string; readonly path: string; readonly previousPath?: string }> = []
  for (let index = 0; index < parts.length; ) {
    const code = parts[index++]
    const first = parts[index++]
    if (!first) break
    if (code.startsWith("R") || code.startsWith("C")) {
      const second = parts[index++]
      if (!second) break
      entries.push({ code, path: second, previousPath: first })
      continue
    }
    entries.push({ code, path: first })
  }
  return entries
}

function completeRecords(output: string) {
  return output.endsWith("\0") ? output : output.slice(0, output.lastIndexOf("\0") + 1)
}

function kind(code: string): Change["change"] {
  if (code.startsWith("A")) return "added"
  if (code.startsWith("M") || code.startsWith("T")) return "modified"
  if (code.startsWith("D")) return "deleted"
  if (code.startsWith("R")) return "renamed"
  return "unsupported"
}

function status(change: Change["change"], untracked: boolean): Change["status"] {
  if (change === "renamed") return "renamed"
  if (untracked) return "untracked"
  if (change === "added" || change === "deleted") return change
  return "modified"
}

function literal(file: string) {
  return `:(top,literal)${file}`
}

function allowPath(execution: LocalExecution, root: string, file: string, policy: SecurityPolicy) {
  return Effect.gen(function* () {
    if (!file || file.length > 4096 || path.isAbsolute(file) || file.split("/").includes("..")) return undefined
    const absolute = path.resolve(root, file)
    if (!contains(root, absolute)) return undefined
    const canonical = yield* Effect.tryPromise({
      try: () => fs.realpath(absolute),
      catch: () => failure("unavailable", "Path is unavailable"),
    }).pipe(
      Effect.catch(() =>
        Effect.tryPromise({
          try: () => fs.realpath(path.dirname(absolute)),
          catch: () => failure("unavailable", "Parent path is unavailable"),
        }).pipe(
          Effect.map((parent) => path.join(parent, path.basename(absolute))),
          Effect.catch(() => Effect.succeed(absolute)),
        ),
      ),
    )
    if (!contains(root, canonical)) return undefined
    return yield* policy.artifact({ execution, path: canonical })
  })
}

function permittedPaths(execution: LocalExecution, root: string, files: ReadonlyArray<string>, policy: SecurityPolicy) {
  return Effect.gen(function* () {
    const distinct = [...new Set(files)]
    const allowed = yield* Effect.forEach(distinct.slice(0, maxFiles), (file) =>
      allowPath(execution, root, file, policy).pipe(Effect.map((result) => (result ? file : undefined))),
    )
    return {
      paths: allowed.filter((file): file is string => file !== undefined),
      truncated: distinct.length > maxFiles || allowed.some((file) => file === undefined),
    }
  })
}

function contains(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function emptyScope(state: ScopeReport["state"]): ScopeReport {
  return { state, changed: [], excludedCount: 0, omittedCount: 0 }
}

function failure(code: Failure["code"], message: string): Failure {
  return { code, message }
}
