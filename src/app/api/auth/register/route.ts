import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { fail, parseBody } from "@/lib/http";
import { setSessionCookie } from "@/lib/session";
import {
  EmailAlreadyRegisteredError,
  HandleUnavailableError,
  identityService,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  WeakPasswordError,
} from "@/modules/identity";

const bodySchema = z.object({
  email: z.email().max(320),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  displayName: z.string().min(1).max(80).optional(),
  handle: z.string().min(2).max(30).optional(),
});

/**
 * POST /api/auth/register — docs/08 D9.
 *
 * Registration is one transaction (D8): user, wallet and opening balance
 * together, or none of them. The session is issued afterwards, outside that
 * transaction, so a cookie can never be handed out for a user whose wallet
 * failed to create.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const parsed = await parseBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;

  try {
    // Spread rather than pass through: `exactOptionalPropertyTypes` treats an
    // explicit `displayName: undefined` as different from an absent key, and
    // Zod's `.optional()` produces the former.
    const { email, password, displayName, handle } = parsed.data;
    const user = await getDb().transaction((tx) =>
      identityService.register(
        {
          email,
          password,
          ...(displayName === undefined ? {} : { displayName }),
          ...(handle === undefined ? {} : { handle }),
        },
        tx,
      ),
    );
    const session = await identityService.createSession({ userId: user.id });
    await setSessionCookie(session.token, session.expiresAt);

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof EmailAlreadyRegisteredError) {
      return fail(409, "EMAIL_TAKEN", "that email is already registered");
    }
    if (error instanceof HandleUnavailableError) {
      return fail(409, "HANDLE_TAKEN", "that handle is taken");
    }
    if (error instanceof WeakPasswordError) {
      return fail(400, "WEAK_PASSWORD", error.message);
    }
    throw error;
  }
}
