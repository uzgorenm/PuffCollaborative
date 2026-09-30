import { expect, test } from "bun:test"
import { Effect } from "../../packages/core/node_modules/effect/dist/index.js"
import { ModelV2 } from "../../packages/core/src/model"
import { ProviderV2 } from "../../packages/core/src/provider"
import { fromCatalogModel } from "../../packages/core/src/session/runner/model"
import { LLM } from "../../packages/llm/src"
import { dynamicResponse } from "../../packages/llm/test/lib/http"
import { sseEvents } from "../../packages/llm/test/lib/sse"
import { boundedReceiverConfig } from "./native-config"

test("bounded native receiver serializes a text-only Responses request without external network", async () => {
  // Config migration is checked separately by native-config.test.ts. Here the
  // actual native model resolver and transport consume the migrated V2 shape.
  const config = boundedReceiverConfig({
    model: "flower-labs/flwrlabs/endeavor-1.0",
    providers: {
      "flower-labs": {
        models: { "flwrlabs/endeavor-1.0": { request: { body: {} } } },
      },
    },
  })
  const catalogModel = ModelV2.Info.empty(
    ProviderV2.ID.make("flower-labs"),
    ModelV2.ID.make("flwrlabs/endeavor-1.0"),
  )
  const model = await Effect.runPromise(fromCatalogModel({
    ...catalogModel,
    api: { id: catalogModel.id, type: "aisdk", package: "@ai-sdk/openai", url: "https://api.flower.ai/v1" },
    // A larger catalog limit deliberately cannot substitute for the request cap.
    limit: { context: 128_000, output: 16_384 },
    request: { headers: {}, body: config.providers["flower-labs"].models[catalogModel.id].request.body },
  }))
  let serializedRequests = 0
  const transport = dynamicResponse(({ request, text, respond }) => Effect.sync(() => {
    serializedRequests++
    expect(request.method).toBe("POST")
    expect(request.url).toBe("https://api.flower.ai/v1/responses")
    const body = JSON.parse(text)
    expect(body.model).toBe("flwrlabs/endeavor-1.0")
    expect(body.max_output_tokens).toBe(1024)
    expect(body.tool_choice).toBe("none")
    expect(body.tools ?? []).toEqual([])
    expect(body.input.some((message: any) => message.role === "user")).toBe(true)
    // This in-memory HttpClient replaces the executor's network dependency.
    return respond(sseEvents({ type: "response.completed", response: {
      id: "test-response", status: "completed", output: [],
      usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
    } }), { headers: { "content-type": "text/event-stream" } })
  }))
  const response = await Effect.runPromise(LLM.generate(LLM.request({
    model,
    prompt: "Review the quoted source context and explain its relevance in one sentence.",
    tools: [],
    toolChoice: "none",
    // Even a conflicting generation default must not override the configured
    // native provider request-body limit at HTTP serialization.
    generation: { maxTokens: 8192 },
  })).pipe(Effect.provide(transport)))
  expect(serializedRequests).toBe(1)
  expect(response.finishReason).toBe("stop")
})
