import { expect, test } from "bun:test"
import { nativeProviderStatus } from "./native-provider-status"

test("only the observed provider credit-limit error changes public availability", () => {
  const actualShape = {
    type: "Unknown",
    message: 'HTTP 429 response: {"detail":{"code":"secret_key_credit_limit_reached"}}',
  }
  expect(nativeProviderStatus(true, actualShape)).toEqual({
    runnerAvailability: "provider_credit_limit_reached",
    providerHttpStatus: 429,
    providerErrorCode: "secret_key_credit_limit_reached",
  })
  expect(
    nativeProviderStatus(true, { message: 'HTTP 429 response: {"error":{"code":"rate_limit_exceeded"}}' })
      .runnerAvailability,
  ).toBe("configured")
  expect(nativeProviderStatus(true, { message: "HTTP 429 secret_key_credit_limit_reached" }).runnerAvailability).toBe(
    "configured",
  )
  expect(
    nativeProviderStatus(true, { message: 'HTTP 500 response: {"error":{"code":"secret_key_credit_limit_reached"}}' })
      .runnerAvailability,
  ).toBe("configured")
  expect(nativeProviderStatus(true, { message: "HTTP 401 rejected" }).runnerAvailability).toBe("provider_auth_failed")
  expect(nativeProviderStatus(true, { message: "HTTP 403 rejected" }).runnerAvailability).toBe("provider_auth_failed")
  expect(nativeProviderStatus(true, undefined).runnerAvailability).toBe("configured")
  expect(nativeProviderStatus(false, undefined).runnerAvailability).toBe("model_configuration_missing")
})
