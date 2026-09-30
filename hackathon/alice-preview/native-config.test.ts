import { expect, test } from "bun:test"
import { mkdtemp, realpath, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "../../packages/core/node_modules/effect/dist/index.js"
import { Config } from "../../packages/core/src/config"
import { AppNodeBuilder } from "../../packages/core/src/effect/app-node-builder"
import { LayerNode } from "../../packages/core/src/effect/layer-node"
import { Global } from "../../packages/core/src/global"
import { Location } from "../../packages/core/src/location"
import { Policy } from "../../packages/core/src/policy"
import { Project } from "../../packages/core/src/project"
import { AbsolutePath } from "../../packages/core/src/schema"
import { provisionNativeConfig } from "./native-config"

test("configured provider is visible to the native Config service without an inference request", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "puff-native-config-test-")))
  try {
    const fixtureKey = 'test-only-key-$&-$$-"quote"-\\slash'
    await Bun.write(join(directory, "test-key"), `${fixtureKey}\n`)
    const config = {
      model: "flower-labs/flwrlabs/endeavor-1.0",
      provider: {
        "flower-labs": {
          npm: "@ai-sdk/openai",
          options: { baseURL: "https://api.flower.ai/v1", apiKey: "{file:test-key}" },
          models: { "flwrlabs/endeavor-1.0": { name: "Endeavor", tool_call: true } },
        },
      },
    }
    const native = await provisionNativeConfig(directory, config, join(directory, "original.json"))
    expect((await stat(native.path)).mode & 0o777).toBe(0o600)
    expect((await stat(native.directory)).mode & 0o777).toBe(0o700)
    const location = Layer.succeed(
      Location.Service,
      Location.Service.of({
        directory: AbsolutePath.make(directory),
        project: { id: Project.ID.global, directory: AbsolutePath.make(directory) },
      }),
    )
    const layer = AppNodeBuilder.build(LayerNode.group([Config.node, Policy.node]), [
      [Location.node, location],
      [Global.node, Global.layerWith({ config: native.directory })],
    ])
    const documents = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Config.Service
          return (yield* service.entries()).filter((entry) => entry.type === "document")
        }).pipe(Effect.provide(layer)),
      ),
    )
    expect(documents).toHaveLength(1)
    expect(documents[0].info.model).toBe(config.model)
    const provider = documents[0].info.providers!["flower-labs"]
    expect(provider.api).toMatchObject({ type: "aisdk", package: "@ai-sdk/openai", url: "https://api.flower.ai/v1" })
    expect(provider.request?.headers?.Authorization).toBe(`Bearer ${fixtureKey}`)
    expect(provider.models["flwrlabs/endeavor-1.0"].capabilities?.tools).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
