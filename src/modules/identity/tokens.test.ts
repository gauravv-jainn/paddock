import { afterEach, describe, expect, it } from "vitest";
import { generateSessionToken, hashIpAddress, hashSessionToken } from "./tokens";

const ORIGINAL_PEPPER = process.env["SESSION_IP_PEPPER"];

afterEach(() => {
  if (ORIGINAL_PEPPER === undefined) {
    delete process.env["SESSION_IP_PEPPER"];
  } else {
    process.env["SESSION_IP_PEPPER"] = ORIGINAL_PEPPER;
  }
});

describe("generateSessionToken", () => {
  it("produces 256 bits, url-safe", () => {
    const token = generateSessionToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not repeat", () => {
    const tokens = new Set(
      Array.from({ length: 1000 }, () => generateSessionToken()),
    );
    expect(tokens.size).toBe(1000);
  });
});

describe("hashSessionToken", () => {
  it("is deterministic and does not contain the token", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toBe(hashSessionToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // No `not.toContain(token)` here: the hex assertion above already makes it
    // unfalsifiable, since a base64url token is not a substring of hex.
  });

  it("differs for different tokens", () => {
    expect(hashSessionToken("a")).not.toBe(hashSessionToken("b"));
  });
});

describe("hashIpAddress", () => {
  it("returns null when no pepper is configured", () => {
    delete process.env["SESSION_IP_PEPPER"];
    expect(hashIpAddress("203.0.113.4")).toBeNull();
  });

  it("returns null for a missing address", () => {
    process.env["SESSION_IP_PEPPER"] = "pepper";
    expect(hashIpAddress(undefined)).toBeNull();
  });

  it("is peppered, so the same address hashes differently under a new pepper", () => {
    process.env["SESSION_IP_PEPPER"] = "pepper-a";
    const a = hashIpAddress("203.0.113.4");
    process.env["SESSION_IP_PEPPER"] = "pepper-b";
    expect(hashIpAddress("203.0.113.4")).not.toBe(a);
  });
});
