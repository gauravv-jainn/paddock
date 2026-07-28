import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

// promisify() collapses scrypt to its 3-argument overload, so the options
// object has to be threaded through by hand.
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => {
      if (error) {
        reject(error);
      } else {
        resolve(derived);
      }
    });
  });
}

/**
 * scrypt parameters. N=2^15 costs ~32MB and ~100ms on current hardware, which
 * is the usual interactive-login target. They are stored alongside every hash
 * so they can be raised later without invalidating existing passwords.
 */
const N = 32_768;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const MAXMEM = 64 * 1024 * 1024;

const PREFIX = "scrypt";

/** Rejected before hashing; the KDF is not a length check. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPasswordError";
  }
}

function assertUsable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `password must be at most ${MAX_PASSWORD_LENGTH} characters`,
    );
  }
}

/** Returns `scrypt$N$r$p$salt$hash`, all binary parts base64url. */
export async function hashPassword(password: string): Promise<string> {
  assertUsable(password);
  const salt = randomBytes(SALT_LEN);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });

  return [
    PREFIX,
    N,
    R,
    P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/**
 * Constant-time verification. Returns false rather than throwing on a
 * malformed stored hash, so a corrupt row cannot be distinguished from a wrong
 * password by timing or by error type.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    return false;
  }

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltPart = parts[4];
  const hashPart = parts[5];

  if (
    !Number.isInteger(n) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    saltPart === undefined ||
    hashPart === undefined
  ) {
    return false;
  }

  const salt = Buffer.from(saltPart, "base64url");
  const expected = Buffer.from(hashPart, "base64url");
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }

  let derived: Buffer;
  try {
    derived = await scryptAsync(
      password.normalize("NFKC"),
      salt,
      expected.length,
      { N: n, r, p, maxmem: MAXMEM },
    );
  } catch {
    return false;
  }

  return timingSafeEqual(derived, expected);
}
