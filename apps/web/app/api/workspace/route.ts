import { models } from "../../../lib/session-api.ts"
import { workspaceOrigin } from "../../../lib/connected-protocol.ts"
import { getWorkspaceService, parseWorkspaceRequest, WorkspaceApiError } from "../../../lib/session-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json({ service: "local-workspace", models, localDemo: true })
}

export async function POST(request: Request) {
  if (!workspaceOrigin(request, { webOrigin: process.env.PUFF_WEB_ORIGIN })) return Response.json({ error: "Same-origin loopback request required" }, { status: 403, headers: { "Cache-Control": "no-store" } })
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return Response.json({ error: "Workspace requests require application/json" }, { status: 415, headers: { "Cache-Control": "no-store" } })
  try {
    const result = await getWorkspaceService().execute(await parseWorkspaceRequest(request))
    return Response.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json({ error: error instanceof WorkspaceApiError ? error.message : "The local workspace request failed" }, { status: error instanceof WorkspaceApiError ? error.status : 500 })
  }
}
