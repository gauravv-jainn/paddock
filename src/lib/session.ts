import { cookies } from "next/headers";
import { identityService, SESSION_TTL_MS, type PublicUser } from "@/modules/identity";

/**
 * Session cookie handling — docs/08 D9.
 *
 * The cookie carries the raw session token. Only its SHA-256 hash is persisted
 * (`src/modules/identity/tokens.ts`), so a database disclosure does not hand
 * out live sessions.
 */

export const SESSION_COOKIE = "ph_session";

/**
 * D9: HttpOnly, Secure, SameSite=Lax.
 *
 * - `httpOnly` — script cannot read it, so an XSS cannot exfiltrate a session.
 * - `secure` — never sent over plaintext HTTP. Relaxed on localhost only,
 *   because a dev server has no TLS and the cookie would be dropped entirely.
 * - `sameSite: "lax"` — a cross-site POST carries no cookie, which is what
 *   stops a third-party page placing a bet on the user's behalf. Lax rather
 *   than Strict so that following a link into the app stays signed in.
 * - `path: "/"` so logout can clear exactly what login set.
 */
function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function clearSessionCookie(): Promise<void> {
  // Overwritten with an expiry in the past rather than only deleted, so a
  // client that ignores the delete still discards it.
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", cookieOptions(new Date(0)));
  jar.delete(SESSION_COOKIE);
}

export async function readSessionToken(): Promise<string | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value && value.length > 0 ? value : null;
}

/** The signed-in user, or null. Never throws on an absent or stale cookie. */
export async function getCurrentUser(): Promise<PublicUser | null> {
  const token = await readSessionToken();
  if (!token) return null;
  const resolved = await identityService.validateSession(token);
  return resolved?.user ?? null;
}

/**
 * The auth middleware, in the form App Router actually supports.
 *
 * Next 15 middleware runs on the edge runtime and cannot open a database
 * connection, so session validation has to happen in the route or page that
 * needs it. This is that check, in one place, rather than a `middleware.ts`
 * that could only inspect the cookie's presence and would report a revoked or
 * expired session as signed in.
 */
export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("authentication required");
    this.name = "UnauthenticatedError";
  }
}

export { SESSION_TTL_MS };
