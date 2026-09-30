/** Reduce private native provider errors to a small public availability category. */
export function nativeProviderStatus(configured: boolean, error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? error.message : undefined
  const providerHttpStatus =
    typeof message === "string" ? Number(/HTTP (\d{3})\b/.exec(message)?.[1]) || undefined : undefined
  let providerErrorCode: "secret_key_credit_limit_reached" | undefined
  if (providerHttpStatus === 429 && typeof message === "string") {
    try {
      const body = JSON.parse(message.slice(message.indexOf("{")))
      const code = body?.detail?.code ?? body?.error?.code
      if (code === "secret_key_credit_limit_reached") providerErrorCode = code
    } catch {
      // A generic rate limit or unstructured message is not evidence of an exhausted key budget.
    }
  }
  return {
    runnerAvailability: !configured
      ? "model_configuration_missing"
      : [401, 403].includes(providerHttpStatus ?? 0)
        ? "provider_auth_failed"
        : providerErrorCode
          ? "provider_credit_limit_reached"
          : "configured",
    providerHttpStatus,
    providerErrorCode,
  }
}
