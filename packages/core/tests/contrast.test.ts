import { describe, expect, it } from "vitest";
import { contrastRatioFromStrings } from "../src/style/contrast.js";

describe("T-ST-08 WCAG contrast reference vectors (spec 9.5, tolerance +-0.02)", () => {
  const vectors: [string, string, number][] = [
    ["#000000", "#ffffff", 21.0],
    ["#ffffff", "#ffffff", 1.0],
    ["#767676", "#ffffff", 4.54],
    ["#777777", "#ffffff", 4.48],
    ["#999999", "#ffffff", 2.85],
  ];

  it.each(vectors)("contrast(%s, %s) ~= %f", (fg, bg, expected) => {
    const ratio = contrastRatioFromStrings(fg, bg);
    expect(ratio).not.toBeNull();
    expect(ratio as number).toBeGreaterThanOrEqual(expected - 0.02);
    expect(ratio as number).toBeLessThanOrEqual(expected + 0.02);
  });
});
