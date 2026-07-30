import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalise, sha256OfPayload } from "./payloads";

/**
 * Payload hashing — docs/03 §5 step 1.
 *
 * The hash is the link between a settlement and the bytes it was derived from.
 * If two identical payloads can hash differently, every re-fetch looks like an
 * amendment; if two different payloads can hash the same, a settlement points
 * at the wrong evidence. Both directions are asserted.
 */
describe("canonicalise", () => {
  it("is insensitive to key order", () => {
    expect(canonicalise({ a: 1, b: 2 })).toBe(canonicalise({ b: 2, a: 1 }));
    expect(sha256OfPayload({ a: 1, b: 2 })).toBe(sha256OfPayload({ b: 2, a: 1 }));
  });

  it("sorts nested keys too, not just the top level", () => {
    const one = { outer: { z: 1, a: { y: 2, b: 3 } } };
    const two = { outer: { a: { b: 3, y: 2 }, z: 1 } };
    expect(sha256OfPayload(one)).toBe(sha256OfPayload(two));
  });

  it("PRESERVES array order — a finishing order is content, not a set", () => {
    // The whole point. If [1st, 2nd] and [2nd, 1st] hashed alike, an amended
    // result would be indistinguishable from the original.
    expect(sha256OfPayload([1, 2, 3])).not.toBe(sha256OfPayload([3, 2, 1]));
    expect(sha256OfPayload({ finish: ["a", "b"] })).not.toBe(
      sha256OfPayload({ finish: ["b", "a"] }),
    );
  });

  it("distinguishes values that differ", () => {
    expect(sha256OfPayload({ pos: 1 })).not.toBe(sha256OfPayload({ pos: 2 }));
    expect(sha256OfPayload({ pos: 1 })).not.toBe(sha256OfPayload({ pos: "1" }));
    expect(sha256OfPayload({ a: null })).not.toBe(sha256OfPayload({ a: 0 }));
    // An absent key and a null one are different statements about a runner.
    expect(sha256OfPayload({})).not.toBe(sha256OfPayload({ a: null }));
  });

  it("drops undefined, which JSON cannot carry anyway", () => {
    expect(sha256OfPayload({ a: 1, b: undefined })).toBe(sha256OfPayload({ a: 1 }));
  });

  it("handles null and primitives at the root", () => {
    expect(canonicalise(null)).toBe("null");
    expect(canonicalise(42)).toBe("42");
    expect(canonicalise("x")).toBe('"x"');
    expect(canonicalise(true)).toBe("true");
  });

  it("produces a real sha256 of the canonical string, not of something else", () => {
    const body = { b: 2, a: 1 };
    const expected = createHash("sha256")
      .update('{"a":1,"b":2}', "utf8")
      .digest("hex");
    expect(sha256OfPayload(body)).toBe(expected);
    expect(sha256OfPayload(body)).toMatch(/^[0-9a-f]{64}$/);
  });
});
