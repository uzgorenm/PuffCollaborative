import { expect, test } from "bun:test"
import { Option } from "effect"
import { runtimeAuthorized } from "../src/runner-harness-authorization"

const runtime = { username: "runtime", password: Option.some("synthetic-runtime-secret") }
const basic = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`

test("direct runtime access requires its own credential", () => {
  expect(runtimeAuthorized(undefined, runtime)).toBe(false)
  expect(runtimeAuthorized(basic("browser", "synthetic-browser-secret"), runtime)).toBe(false)
  expect(runtimeAuthorized(basic("worker", "synthetic-service-secret"), runtime)).toBe(false)
  expect(runtimeAuthorized(basic("runtime", "wrong-secret"), runtime)).toBe(false)
  expect(runtimeAuthorized(basic("runtime", "synthetic-runtime-secret"), runtime)).toBe(true)
  expect(
    runtimeAuthorized(basic("runtime", "synthetic-runtime-secret"), { username: "runtime", password: Option.none() }),
  ).toBe(false)
  expect(runtimeAuthorized("Bearer synthetic-runtime-secret", runtime)).toBe(false)
})
