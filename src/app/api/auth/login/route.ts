import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, parseBody } from "@/lib/http";
import { setSessionCookie } from "@/lib/session";
import { identityService, InvalidCredentialsError } from "@/modules/identity";

const bodySchema = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1),
});

/**
 * POST /api/auth/login — docs/08 D9.
 *
 * The password is not length-validated here: rejecting a short password at
 * login would tell an attacker the stored one is longer than that. Only
 * registration enforces the policy.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = await parseBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  const userAgent = request.headers.get("user-agent");

  try {
    const { user, session } = await identityService.login({
      email: parsed.data.email,
      password: parsed.data.password,
      ...(userAgent ? { userAgent } : {}),
    });
    await setSessionCookie(session.token, session.expiresAt);
    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      // Same message for an unknown email and a wrong password — the identity
      // service refuses to distinguish them and the route must not undo that.
      return fail(401, "INVALID_CREDENTIALS", "invalid email or password");
    }
    throw error;
  }
}
