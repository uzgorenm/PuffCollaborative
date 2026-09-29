import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Coordination } from "@opencode-ai/schema/coordination"
import { Project } from "@opencode-ai/schema/project"
import { Session } from "@opencode-ai/schema/session"
import { Effect, Redacted } from "effect"
import { PermissionV2 } from "../../../src/permission"
import type { RunnerHarnessContracts } from "../../../src/runner-harness/contracts"
import { RunnerEnvironment } from "../../../src/runner-harness/security/environment"
import { RunnerSecurityPolicy } from "../../../src/runner-harness/security/policy"

test("configured repository and canonical workspace root reject path escape and scope mismatch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "runner-security-fixture-"))
  try {
    const repository = path.join(root, "repository")
    const workspaces = path.join(root, "workspaces")
    const workspaceDirectory = path.join(workspaces, "thread-one")
    const outside = path.join(root, "outside")
    await Promise.all([mkdir(repository), mkdir(workspaceDirectory, { recursive: true }), mkdir(outside)])
    await symlink(outside, path.join(workspaces, "escape"))
    await writeFile(path.join(outside, "fixture.txt"), "harmless fixture")
    await symlink(path.join(outside, "fixture.txt"), path.join(workspaceDirectory, "linked.txt"))

    const projectId = Project.ID.make("prj_runner_fixture")
    const threadId = Coordination.ThreadID.make("thread-fixture")
    const sessionId = Session.ID.make("ses_runner_fixture")
    const owner = { workerId: Coordination.WorkerID.make("worker-fixture"), instanceId: "instance-fixture" }
    const credentials: RunnerHarnessContracts.Credentials = {
      verify: (value) =>
        value.workerId === owner.workerId && value.instanceId === owner.instanceId
          ? Effect.void
          : Effect.fail({ code: "forbidden", message: "Synthetic scope mismatch" }),
      principal: (value) =>
        value.workerId === owner.workerId && value.instanceId === owner.instanceId
          ? Effect.succeed({ kind: "runner", ...owner })
          : Effect.fail({ code: "forbidden", message: "Synthetic scope mismatch" }),
    }
    const run = {
      projectId,
      command: { threadId, sessionId, executionOwner: owner },
      session: { id: sessionId, projectID: projectId, location: { directory: workspaceDirectory } },
    } as RunnerHarnessContracts.AuthorizedRun
    const policy = await Effect.runPromise(
      RunnerSecurityPolicy.make({
        credentials,
        projects: [{ projectId, repositoryRoot: repository, workspaceRoot: workspaces }],
        sessionScope: () => Effect.succeed({ owner, projectId, directory: workspaceDirectory }),
        destinations: { coordinator: "https://coordination.example.test/api" },
        allowedDestinationHosts: ["coordination.example.test"],
        toolPath: "/usr/bin:/bin",
        secrets: [Redacted.make("synthetic-service-secret")],
      }),
    )
    const workspace = { id: "workspace-fixture", projectId, threadId, directory: workspaceDirectory }
    await Effect.runPromise(policy.workspace({ run, workspace }))
    expect(
      await Effect.runPromise(
        Effect.flip(policy.workspace({ run, workspace: { ...workspace, directory: path.join(workspaces, "escape") } })),
      ),
    ).toMatchObject({ code: "forbidden" })
    expect(
      await Effect.runPromise(
        Effect.flip(
          policy.workspace({ run, workspace: { ...workspace, threadId: Coordination.ThreadID.make("other") } }),
        ),
      ),
    ).toMatchObject({ code: "forbidden" })
    expect(
      await Effect.runPromise(
        Effect.flip(
          policy.runtimeAccess({
            principal: { kind: "member", userId: Coordination.UserID.make("viewer") },
            sessionId,
            action: "prompt",
          }),
        ),
      ),
    ).toMatchObject({ code: "forbidden" })
    await Effect.runPromise(
      policy.runtimeAccess({ principal: { kind: "runner", ...owner }, sessionId, action: "prompt" }),
    )

    const environment = await Effect.runPromise(policy.toolEnvironment({ run, phase: "prepared", workspace }))
    expect(Object.values(environment).join(" ")).not.toContain("synthetic-service-secret")
    expect(environment).not.toHaveProperty("OPENCODE_COORDINATION_IDENTITIES_PATH")
    expect(RunnerEnvironment.rejectsInheritedSecrets(environment)).toBe(true)
    expect(policy.redact("Authorization: Bearer synthetic-service-secret")).not.toContain("synthetic-service-secret")
    expect(policy.redact('{"authorization":"Basic c3ludGhldGljLWJhc2lj"}')).not.toContain("c3ludGhldGljLWJhc2lj")
    expect(
      await Effect.runPromise(
        policy.artifact({
          execution: { run, phase: "prepared", workspace },
          path: path.join(workspaceDirectory, ".env"),
        }),
      ),
    ).toBeUndefined()
    expect(
      await Effect.runPromise(
        policy.artifact({
          execution: { run, phase: "prepared", workspace },
          path: path.join(workspaceDirectory, ".runner-home", "cache"),
        }),
      ),
    ).toBeUndefined()
    expect(
      await Effect.runPromise(
        Effect.flip(
          policy.artifact({
            execution: { run, phase: "prepared", workspace },
            path: path.join(workspaceDirectory, "linked.txt"),
          }),
        ),
      ),
    ).toMatchObject({ code: "invalid" })
    expect(
      await Effect.runPromise(
        Effect.flip(
          policy.artifact({
            execution: { run, phase: "prepared", workspace },
            path: path.join(workspaces, "escape", "file.txt"),
          }),
        ),
      ),
    ).toMatchObject({ code: "forbidden" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("tool rules and service destinations fail closed", () => {
  const rules = RunnerSecurityPolicy.permissionRules()
  expect(PermissionV2.evaluate("read", "src/file.ts", rules).effect).toBe("allow")
  expect(PermissionV2.evaluate("edit", "src/file.ts", rules).effect).toBe("ask")
  expect(PermissionV2.evaluate("bash", "git status", rules).effect).toBe("deny")
  expect(PermissionV2.evaluate("external_directory", "/tmp/*", rules).effect).toBe("deny")
  expect(PermissionV2.evaluate("webfetch", "http://127.0.0.1", rules).effect).toBe("deny")
  expect(
    PermissionV2.evaluate("bash", "git status", RunnerSecurityPolicy.permissionRules({ trustedLocalShell: true }))
      .effect,
  ).toBe("ask")
  expect(
    RunnerSecurityPolicy.validDestination("https://coordination.example.test/api", ["coordination.example.test"]),
  ).toBe(true)
  expect(RunnerSecurityPolicy.validDestination("http://127.0.0.1/admin", ["127.0.0.1"])).toBe(false)
  expect(RunnerSecurityPolicy.validDestination("https://other.example.test", ["coordination.example.test"])).toBe(false)
  expect(
    RunnerSecurityPolicy.validDestination("https://user:secret@coordination.example.test", [
      "coordination.example.test",
    ]),
  ).toBe(false)
})
