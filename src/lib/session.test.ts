import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The docs/08 D9 cookie policy: HttpOnly, Secure, SameSite=Lax.
 *
 * These three flags are the whole client-side security posture of the session,
 * and nothing else in the suite would notice if one were dropped — a missing
 * `httpOnly` still logs in fine. So they are asserted directly.
 */

const jar = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(jar) }));

describe("session cookie", () => {
  beforeEach(() => {
    jar.set.mockClear();
    jar.get.mockClear();
    jar.delete.mockClear();
  });

  afterEach(() => {
    // NODE_ENV is read-only to TypeScript, so restoring it by assignment does
    // not compile. unstubAllEnvs is the supported undo for stubEnv.
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sets HttpOnly and SameSite=Lax, and carries the token and expiry", async () => {
    const { setSessionCookie, SESSION_COOKIE } = await import("./session");
    const expires = new Date("2026-09-01T00:00:00.000Z");

    await setSessionCookie("raw-token-value", expires);

    expect(jar.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = jar.set.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(name).toBe(SESSION_COOKIE);
    expect(value).toBe("raw-token-value");
    expect(options["httpOnly"]).toBe(true);
    expect(options["sameSite"]).toBe("lax");
    expect(options["path"]).toBe("/");
    expect(options["expires"]).toEqual(expires);
  });

  it("sets Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { setSessionCookie } = await import("./session");

    await setSessionCookie("t", new Date("2026-09-01T00:00:00.000Z"));

    const [, , options] = jar.set.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(options["secure"]).toBe(true);
  });

  it("omits Secure outside production, or the dev server would drop it", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();
    const { setSessionCookie } = await import("./session");

    await setSessionCookie("t", new Date("2026-09-01T00:00:00.000Z"));

    const [, , options] = jar.set.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(options["secure"]).toBe(false);
  });

  it("clears with an expiry in the past AND a delete", async () => {
    vi.resetModules();
    const { clearSessionCookie } = await import("./session");

    await clearSessionCookie();

    const [, value, options] = jar.set.mock.calls[0] as [
      string,
      string,
      { expires: Date },
    ];
    expect(value).toBe("");
    expect(options.expires.getTime()).toBe(0);
    expect(jar.delete).toHaveBeenCalledTimes(1);
  });

  it("treats an absent or empty cookie as no session", async () => {
    vi.resetModules();
    const { readSessionToken } = await import("./session");

    jar.get.mockReturnValueOnce(undefined);
    expect(await readSessionToken()).toBeNull();

    // An empty string is a present-but-worthless cookie. Passing it to
    // validateSession would hash "" and query for it.
    jar.get.mockReturnValueOnce({ value: "" });
    expect(await readSessionToken()).toBeNull();

    jar.get.mockReturnValueOnce({ value: "abc" });
    expect(await readSessionToken()).toBe("abc");
  });

  it("requireUser throws UnauthenticatedError when there is no cookie", async () => {
    vi.resetModules();
    const { requireUser, UnauthenticatedError } = await import("./session");

    jar.get.mockReturnValue(undefined);
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
