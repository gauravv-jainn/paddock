import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Colour contrast, computed rather than claimed.
 *
 * axe reports `color-contrast` as INCOMPLETE under jsdom — it needs a layout
 * engine to know what is painted over what, and jsdom has none. So the
 * accessibility suite cannot verify contrast, and the ratios written in the
 * stylesheet's comments would otherwise be unchecked assertions by the author.
 *
 * This computes the WCAG 2.x relative-luminance ratio for every foreground and
 * background pair the stylesheet actually uses, in both colour schemes.
 *
 * WCAG 2.2 SC 1.4.3 (AA): 4.5:1 for body text, 3:1 for large text.
 * WCAG 2.2 SC 1.4.11 (AA): 3:1 for UI component boundaries.
 */

const css = readFileSync("src/app/globals.css", "utf8");

/** Custom properties from one `:root { ... }` block. */
function readBlock(afterMarker: string): Record<string, string> {
  const start = css.indexOf(afterMarker);
  if (start === -1) throw new Error(`marker not found: ${afterMarker}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);

  const vars: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const match = /^\s*(--[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/.exec(line);
    if (match) vars[match[1] as string] = match[2] as string;
  }
  return vars;
}

const light = readBlock(":root {");
const dark = readBlock("@media (prefers-color-scheme: dark)");

function channel(component: number): number {
  const c = component / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every pair the stylesheet genuinely paints, with its required ratio. */
const PAIRS: Array<{ fg: string; bg: string; min: number; what: string }> = [
  { fg: "--ink", bg: "--paper", min: 4.5, what: "body text on the page" },
  { fg: "--ink", bg: "--surface", min: 4.5, what: "body text on a panel" },
  { fg: "--ink-muted", bg: "--paper", min: 4.5, what: "muted text on the page" },
  { fg: "--ink-muted", bg: "--surface", min: 4.5, what: "muted text on a panel" },
  { fg: "--accent", bg: "--paper", min: 4.5, what: "links on the page" },
  { fg: "--accent", bg: "--surface", min: 4.5, what: "links in the header" },
  { fg: "--accent-ink", bg: "--accent", min: 4.5, what: "button label on the accent" },
  { fg: "--negative", bg: "--paper", min: 4.5, what: "a loss figure" },
  { fg: "--negative", bg: "--surface", min: 4.5, what: "a loss figure on a panel" },
  { fg: "--positive", bg: "--surface", min: 4.5, what: "a profit figure on a panel" },
  { fg: "--focus", bg: "--paper", min: 3, what: "the focus ring (SC 1.4.11)" },
  { fg: "--line", bg: "--surface", min: 1.2, what: "a table rule — decorative" },
];

describe.each([
  ["light", light],
  ["dark", dark],
])("colour contrast in the %s scheme", (schemeName, scheme) => {
  it("defines every colour the pairs below reference", () => {
    const needed = new Set(PAIRS.flatMap((p) => [p.fg, p.bg]));
    for (const name of needed) {
      // Non-vacuous: a typo in a variable name would otherwise make every
      // ratio below silently unevaluated.
      expect(scheme[name], `${name} missing from the ${schemeName} scheme`).toMatch(
        /^#[0-9a-fA-F]{6}$/,
      );
    }
  });

  it.each(PAIRS)("$what meets $min:1", ({ fg, bg, min }) => {
    const ratio = contrast(scheme[fg] as string, scheme[bg] as string);
    expect(
      Number(ratio.toFixed(2)),
      `${fg} on ${bg} in ${schemeName} is ${ratio.toFixed(2)}:1, needs ${min}:1`,
    ).toBeGreaterThanOrEqual(min);
  });
});

describe("the contrast maths itself", () => {
  it("agrees with the two ratios everyone knows", () => {
    // Black on white is exactly 21:1; a colour on itself is exactly 1:1.
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
    // #767676 on white is the canonical 4.5:1 boundary case from the WCAG
    // materials — if this drifts, the implementation is wrong.
    expect(contrast("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#777777", "#ffffff")).toBeLessThan(4.5);
  });
});
