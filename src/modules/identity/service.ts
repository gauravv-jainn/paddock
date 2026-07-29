import { randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb, type Database } from "@/db/client";
import { OPENING_BALANCE_MINOR, walletService } from "@/modules/wallet";
import { hashPassword, verifyPassword } from "./password";
import { sessions, users, type Session, type User } from "./schema";
import { generateSessionToken, hashIpAddress, hashSessionToken } from "./tokens";

export type Executor =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Never leaves the module with password_hash attached. */
export type PublicUser = Omit<User, "passwordHash">;

/** docs/04 §2 has no session lifetime; 30 days is this project's choice. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
  handle?: string;
}

export interface LoginInput {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface IssuedSession {
  /** Returned once. Only its hash is persisted. */
  token: string;
  expiresAt: Date;
  session: Session;
}

export class EmailAlreadyRegisteredError extends Error {
  constructor(readonly email: string) {
    super(`email already registered`);
    this.name = "EmailAlreadyRegisteredError";
  }
}

export class HandleUnavailableError extends Error {
  constructor(readonly handle: string) {
    super(`handle unavailable: ${handle}`);
    this.name = "HandleUnavailableError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    // Deliberately does not distinguish unknown-email from wrong-password.
    super("invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

function exec(tx?: Executor): Executor {
  return tx ?? getDb();
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

function constraintOf(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "constraint_name" in error &&
    typeof (error as { constraint_name: unknown }).constraint_name === "string"
  ) {
    return (error as { constraint_name: string }).constraint_name;
  }
  return "";
}

function normaliseEmail(email: string): string {
  return email.trim().normalize("NFKC");
}

/** Local part of the email, reduced to a handle-safe slug. */
function deriveHandle(email: string): string {
  const local = normaliseEmail(email).split("@")[0] ?? "user";
  const slug = local.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 24);
  return slug.replace(/^_+|_+$/g, "") || "user";
}

function stripPassword(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

async function insertUser(
  tx: Executor,
  values: {
    email: string;
    displayName: string;
    passwordHash: string;
    explicitHandle: string | undefined;
    baseHandle: string;
  },
): Promise<User> {
  const { email, displayName, passwordHash, explicitHandle, baseHandle } = values;

  // A supplied handle is taken or it is not. A derived one may collide with a
  // handle we chose for someone else, so it gets a suffix and another go.
  //
  // Each attempt runs in its own SAVEPOINT. A unique violation aborts the
  // enclosing transaction, so without one the first collision would poison the
  // wallet writes that follow.
  const attempts = explicitHandle ? 1 : 5;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const handle = attempt === 0 ? baseHandle : `${baseHandle}_${attempt + 1}`;
    try {
      return await tx.transaction(async (savepoint) => {
        const rows = await savepoint
          .insert(users)
          .values({ email, handle, displayName, passwordHash })
          .returning();
        const user = rows[0];
        if (!user) {
          throw new Error("register inserted no row");
        }
        return user;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      if (constraintOf(error).includes("email")) {
        throw new EmailAlreadyRegisteredError(email);
      }
      if (attempt === attempts - 1) {
        throw new HandleUnavailableError(handle);
      }
    }
  }

  throw new HandleUnavailableError(baseHandle);
}

/**
 * Creates the user, their wallet, and their opening balance — all three in one
 * transaction (docs/08 D8). A user without a wallet is not representable.
 *
 * The opening balance is a balanced pair: £100,000 credited to the new user,
 * the same amount debited from the house wallet. Virtual money is never created
 * from nothing, even at registration.
 */
async function register(
  input: RegisterInput,
  tx?: Executor,
): Promise<PublicUser> {
  const email = normaliseEmail(input.email);
  if (!email.includes("@")) {
    throw new InvalidCredentialsError();
  }

  // Hashing is deliberately outside the transaction: scrypt takes ~100ms and
  // holding a write transaction open for it would be pure lock contention.
  const passwordHash = await hashPassword(input.password);
  const displayName = input.displayName?.trim() || deriveHandle(email);
  const explicitHandle = input.handle?.trim();

  const run = async (t: Executor): Promise<PublicUser> => {
    const user = await insertUser(t, {
      email,
      displayName,
      passwordHash,
      explicitHandle,
      baseHandle: explicitHandle ?? deriveHandle(email),
    });

    const wallet = await walletService.createWallet(
      { kind: "user", userId: user.id },
      t,
    );
    const house = await walletService.getHouseWallet(t);

    await walletService.postTransaction(
      {
        txnId: randomUUID(),
        lines: [
          {
            walletId: house.id,
            amountMinor: -OPENING_BALANCE_MINOR,
            entryType: "OPENING_BALANCE",
            memo: `opening balance for ${user.id}`,
          },
          {
            walletId: wallet.id,
            amountMinor: OPENING_BALANCE_MINOR,
            entryType: "OPENING_BALANCE",
          },
        ],
      },
      t,
    );

    return stripPassword(user);
  };

  return tx ? run(tx) : getDb().transaction(run);
}

/**
 * Verifies credentials. Returns null for every failure mode — unknown email,
 * wrong password, suspended or deleted account — so the caller cannot leak
 * which one it was.
 */
async function authenticate(
  email: string,
  password: string,
  tx?: Executor,
): Promise<PublicUser | null> {
  const rows = await exec(tx)
    .select()
    .from(users)
    .where(eq(users.email, normaliseEmail(email)))
    .limit(1);

  const user = rows[0];
  if (!user?.passwordHash) {
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return null;
  }
  if (user.status !== "active") {
    return null;
  }
  return stripPassword(user);
}

async function createSession(
  input: { userId: string; userAgent?: string; ipAddress?: string; now?: Date },
  tx?: Executor,
): Promise<IssuedSession> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const token = generateSessionToken();

  const rows = await exec(tx)
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: hashSessionToken(token),
      userAgent: input.userAgent ?? null,
      ipHash: hashIpAddress(input.ipAddress),
      expiresAt,
    })
    .returning();

  const session = rows[0];
  if (!session) {
    throw new Error("createSession inserted no row");
  }
  return { token, expiresAt, session };
}

/** Authenticate then issue a session. Throws on bad credentials. */
async function login(input: LoginInput, tx?: Executor): Promise<{
  user: PublicUser;
  session: IssuedSession;
}> {
  const user = await authenticate(input.email, input.password, tx);
  if (!user) {
    throw new InvalidCredentialsError();
  }
  const session = await createSession(
    {
      userId: user.id,
      ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
      ...(input.ipAddress === undefined ? {} : { ipAddress: input.ipAddress }),
    },
    tx,
  );
  return { user, session };
}

/**
 * Resolves a raw session token to its user. Expired sessions and non-active
 * users resolve to null. The token is hashed before it touches a query.
 */
async function validateSession(
  token: string,
  options?: { now?: Date },
  tx?: Executor,
): Promise<{ user: PublicUser; session: Session } | null> {
  const now = options?.now ?? new Date();

  const rows = await exec(tx)
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || row.user.status !== "active") {
    return null;
  }
  return { user: stripPassword(row.user), session: row.session };
}

/** Logout. Idempotent: an unknown or already-revoked token is not an error. */
async function revokeSession(token: string, tx?: Executor): Promise<void> {
  await exec(tx)
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashSessionToken(token)));
}

async function revokeAllSessions(userId: string, tx?: Executor): Promise<void> {
  await exec(tx).delete(sessions).where(eq(sessions.userId, userId));
}

export interface IdentityService {
  register(input: RegisterInput, tx?: Executor): Promise<PublicUser>;
  authenticate(
    email: string,
    password: string,
    tx?: Executor,
  ): Promise<PublicUser | null>;
  login(
    input: LoginInput,
    tx?: Executor,
  ): Promise<{ user: PublicUser; session: IssuedSession }>;
  createSession(
    input: { userId: string; userAgent?: string; ipAddress?: string; now?: Date },
    tx?: Executor,
  ): Promise<IssuedSession>;
  validateSession(
    token: string,
    options?: { now?: Date },
    tx?: Executor,
  ): Promise<{ user: PublicUser; session: Session } | null>;
  revokeSession(token: string, tx?: Executor): Promise<void>;
  revokeAllSessions(userId: string, tx?: Executor): Promise<void>;
}

export const identityService: IdentityService = {
  register,
  authenticate,
  login,
  createSession,
  validateSession,
  revokeSession,
  revokeAllSessions,
};
