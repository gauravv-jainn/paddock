import { NextResponse } from "next/server";
import { clearSessionCookie, readSessionToken } from "@/lib/session";
import { identityService } from "@/modules/identity";

/**
 * POST /api/auth/logout — docs/08 D9.
 *
 * Idempotent, and returns 204 whether or not a session was found. Revoking
 * deletes the row, so the token is dead server-side even if the client keeps
 * the cookie.
 */
export async function POST(): Promise<NextResponse> {
  const token = await readSessionToken();
  if (token) {
    await identityService.revokeSession(token);
  }
  await clearSessionCookie();
  return new NextResponse(null, { status: 204 });
}
