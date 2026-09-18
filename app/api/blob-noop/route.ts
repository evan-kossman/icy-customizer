import { NextResponse } from "next/server";
// Vercel Blob's generateClientTokenFromReadWriteToken requires a callbackUrl.
// We use a real endpoint to satisfy the SDK even though we handle completion
// client-side. This route intentionally does nothing.
export async function POST() {
  return NextResponse.json({ ok: true });
}
