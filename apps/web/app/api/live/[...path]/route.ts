import { handleLive } from "../../../../lib/connected"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) { return handleLive(request, (await context.params).path) }
export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) { return handleLive(request, (await context.params).path) }
