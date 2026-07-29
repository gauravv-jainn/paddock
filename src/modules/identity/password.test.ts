import { describe, expect, it } from "vitest";
import {
  hashPassword,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
  WeakPasswordError,
} from "./password";

const PASSWORD = "correct horse battery staple";

describe("hashPassword", () => {
  it("never returns the password", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).not.toContain(PASSWORD);
  });

  it("records its parameters so they can be raised later", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.split("$").slice(0, 4)).toEqual(["scrypt", "32768", "8", "1"]);
  });

  it("salts, so the same password hashes differently each time", async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it("rejects a password below the minimum length", async () => {
    await expect(hashPassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).rejects.toThrow(
      WeakPasswordError,
    );
  });

  it("rejects an unbounded password", async () => {
    await expect(hashPassword("a".repeat(257))).rejects.toThrow(WeakPasswordError);
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", async () => {
    expect(await verifyPassword(PASSWORD, await hashPassword(PASSWORD))).toBe(true);
  });

  it("rejects a wrong password", async () => {
    expect(await verifyPassword("wrong password here", await hashPassword(PASSWORD))).toBe(
      false,
    );
  });

  it("treats unicode-equivalent passwords as equal", async () => {
    // The same password typed on two keyboards: NFD is 'e' + U+0301
    // combining acute; NFC is the single codepoint U+00E9. Written as
    // escapes on purpose — as literal characters this test is one editor
    // "format on save" away from comparing two identical strings and
    // proving nothing.
    const nfd = "passwordcafe\u0301xx";
    const nfc = "passwordcaf\u00e9xx";
    expect(nfd).not.toBe(nfc);

    expect(await verifyPassword(nfc, await hashPassword(nfd))).toBe(true);
    expect(await verifyPassword(nfd, await hashPassword(nfc))).toBe(true);
  });

  it("returns false rather than throwing on a malformed stored hash", async () => {
    for (const bad of ["", "nonsense", "scrypt$$$$", "bcrypt$1$2$3$4$5"]) {
      expect(await verifyPassword(PASSWORD, bad)).toBe(false);
    }
  });
});
