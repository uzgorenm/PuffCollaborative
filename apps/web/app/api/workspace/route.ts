import { models } from "../../../lib/session-api.ts"
import { getWorkspaceService, parseWorkspaceRequest, WorkspaceApiError } from "../../../lib/session-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json({ service: "local-workspace", models, localDemo: true })
}

export async function POST(request: Request) {
  try {
    const result = await getWorkspaceService().execute(await parseWorkspaceRequest(request))
    return Response.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json({ error: error instanceof WorkspaceApiError ? error.message : "The local workspace request failed" }, { status: error instanceof WorkspaceApiError ? error.status : 500 })
  }
}
