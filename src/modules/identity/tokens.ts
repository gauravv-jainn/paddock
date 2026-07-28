import { createHash, createHmac, randomBytes } from "node:crypto";

/** 256 bits of entropy, url-safe. Returned to the caller exactly once. */
const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * What goes in sessions.token_hash. The raw token is never stored, so a
 * database dump does not yield usable sessions.
 *
 * Plain SHA-256 is correct here and not a password-hashing mistake: the input
 * is 256 random bits, so there is no dictionary to run.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * sessions.ip_hash. HMAC, not a bare hash: the IPv4 space is 2^32, which a
 * plain SHA-256 column would not protect at all.
 *
 * Returns null when SESSION_IP_PEPPER is unset — storing a reversible hash is
 * worse than storing nothing.
 */
export function hashIpAddress(ip: string | undefined): string | null {
  const pepper = process.env["SESSION_IP_PEPPER"];
  if (!ip || !pepper) {
    return null;
  }
  return createHmac("sha256", pepper).update(ip, "utf8").digest("hex");
}
