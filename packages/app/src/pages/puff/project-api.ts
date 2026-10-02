export type ProjectTransport = (url: string, init: RequestInit) => Promise<Response>

export class ProjectApiError extends Error {
  constructor(
    public code: "connection" | "invalid" | "conflict" | "unauthorized" | "request" | "unavailable",
    public status = 0,
  ) {
    super(code)
  }
}

export function serviceUrl(baseUrl: string) {
  if (!URL.canParse(baseUrl)) throw new ProjectApiError("connection")
  const base = new URL(baseUrl)
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== "https:" &&
      !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
  )
    throw new ProjectApiError("connection")
  return base.href.replace(/\/$/, "")
}
