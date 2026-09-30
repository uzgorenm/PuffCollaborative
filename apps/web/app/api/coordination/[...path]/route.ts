import { proxyCoordination } from "../../../../lib/server-connection"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) { return proxyCoordination(request) }
export async function POST(request: Request) { return proxyCoordination(request) }
export async function PUT(request: Request) { return proxyCoordination(request) }
export async function DELETE(request: Request) { return proxyCoordination(request) }
