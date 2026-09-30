import { connectionResponse } from "../../../lib/server-connection"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) { return connectionResponse(request) }
export async function POST(request: Request) { return connectionResponse(request) }
export async function DELETE(request: Request) { return connectionResponse(request) }
