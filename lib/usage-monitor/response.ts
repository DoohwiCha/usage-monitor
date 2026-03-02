import { NextResponse } from "next/server";

export function secureJson(data: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Pragma", "no-cache");
  return NextResponse.json(data, { ...init, headers });
}
