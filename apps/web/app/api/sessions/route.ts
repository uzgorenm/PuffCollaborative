import { readSessions } from "../../../lib/sessions"

export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json(await readSessions(), {
    headers: { "Cache-Control": "no-store" },
  })
}
