import { describe, expect, test } from "bun:test"
import { initializationData, initializationReady } from "./initialization"

describe("desktop renderer initialization", () => {
  test("throws the original initialization error before rendering server providers", () => {
    const error = new Error("sidecar startup failed")

    try {
      initializationData(Object.assign(() => undefined, { error }))
      throw new Error("expected initialization to fail")
    } catch (failure) {
      expect(failure).toBe(error)
      expect((failure as Error & { localServerStartup?: boolean }).localServerStartup).toBe(true)
    }
  })

  test("removes Electron's remote invocation wrapper from startup errors", () => {
    const error = new Error(
      "Error invoking remote method 'await-initialization': Error: Cannot migrate session_message projections",
    )

    try {
      initializationData(Object.assign(() => undefined, { error }))
      throw new Error("expected initialization to fail")
    } catch (failure) {
      expect(failure).toBe(error)
      expect((failure as Error).message).toBe("Cannot migrate session_message projections")
    }
  })

  test("returns initialized sidecar data", () => {
    const sidecar = { url: "http://127.0.0.1:1234", username: "opencode", password: "secret" }

    expect(initializationData(Object.assign(() => sidecar, { error: undefined }))).toBe(sidecar)
  })

  test("preserves healthy sidecar data when an external server is selected", () => {
    const sidecar = { url: "http://127.0.0.1:1234", username: "opencode", password: "secret" }

    expect(
      initializationData(
        Object.assign(() => sidecar, { error: undefined }),
        "https://server.example",
      ),
    ).toBe(sidecar)
  })

  test.each(["http://127.0.0.1:4096", "https://server.example", " HTTPS://Server.Example:443/ "])(
    "allows the selected external server %s after sidecar failure without reading failed data",
    (url) => {
      const error = new Error("sidecar startup failed")
      const state = Object.assign(
        () => {
          throw error
        },
        { error, loading: false },
      )

      expect(initializationData(state, url)).toBeUndefined()
      expect(initializationReady(state, url)).toBe(true)
    },
  )

  test.each([
    undefined,
    null,
    "",
    "sidecar",
    "wsl:Ubuntu",
    "localhost:4096",
    "/api",
    "file:///tmp/server",
    "javascript:alert(1)",
    "http://",
    "https:///server.example",
    "https://server.example:invalid",
    "https://server.example\\path",
    "https://server.example/path with spaces",
    "https://user:secret@server.example",
    "https://server.example?token=secret",
    "https://server.example#fragment",
  ])("keeps startup failures visible for invalid external default %s", (url) => {
    const error = new Error("sidecar startup failed")
    const state = Object.assign(() => undefined, { error, loading: false })

    expect(() => initializationData(state, url)).toThrow(error)
    expect(() => initializationReady(state, url)).toThrow(error)
  })

  test("does not discard falsy initialization errors", () => {
    let caught: unknown
    try {
      initializationData(Object.assign(() => undefined, { error: "" }))
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    if (!(caught instanceof Error)) return
    expect(caught.message).toBe("")
    expect((caught as Error & { localServerStartup?: boolean }).localServerStartup).toBe(true)
  })

  test("checks initialization errors before rendering server providers", () => {
    const error = new Error("sidecar startup failed")

    expect(() => initializationReady(Object.assign(() => undefined, { error, loading: false }))).toThrow(error)
  })

  test("waits for pending initialization without reading it", () => {
    let reads = 0

    expect(
      initializationReady(
        Object.assign(
          () => {
            reads++
            return undefined
          },
          { error: undefined, loading: true },
        ),
      ),
    ).toBe(false)
    expect(reads).toBe(0)
  })
})
