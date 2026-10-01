import { describe, expect, it } from "vitest";
import { parseCssFile } from "../src/parser/css.js";

describe("CSS parsing (spec 9.4 inputs)", () => {
  it("builds rules with declarations, important flags, and source order", () => {
    const source = `
      :root { --brand: #336699; }
      .decline { opacity: 1; }
      .decline { opacity: 0.35 !important; }
      .checkout .accept { color: white; }
    `;
    const { model, parseError } = parseCssFile("src/styles.css", source);
    expect(parseError).toBeUndefined();
    expect(model.rootVars["--brand"]).toBe("#336699");
    expect(model.rules).toHaveLength(4);
    expect(model.rules[0]?.selector).toBe(":root");
    expect(model.rules[1]?.selector).toBe(".decline");
    expect(model.rules[1]?.sourceOrder).toBe(1);
    expect(model.rules[2]?.sourceOrder).toBe(2);
    expect(model.rules[2]?.declarations[0]?.important).toBe(true);
    expect(model.rules[3]?.selector).toBe(".checkout .accept");
  });

  it("splits comma selector lists into independent rule entries", () => {
    const source = `.a, .b { color: red; }`;
    const { model } = parseCssFile("src/x.css", source);
    expect(model.rules.map((r) => r.selector)).toEqual([".a", ".b"]);
  });

  it("marks rules nested in @media as unsupportedAtRule", () => {
    const source = `@media (min-width: 600px) { .a { color: red; } }`;
    const { model } = parseCssFile("src/x.css", source);
    expect(model.rules[0]?.unsupportedAtRule).toBe("media");
  });

  it("reports a parse error for invalid CSS without throwing", () => {
    const source = `.a { color: red; `; // unclosed block
    const { parseError } = parseCssFile("src/bad.css", source);
    expect(parseError).toBeDefined();
  });
});
