import { describe, expect, it } from "vitest";
import { resolveLength, resolveFontWeight, resolveColorValue, expandValue } from "../src/style/values.js";

describe("T-ST-01 length resolution", () => {
  it("resolves px as-is", () => {
    expect(resolveLength("12px")).toMatchObject({ value: 12 });
  });
  it("resolves rem * 16", () => {
    expect(resolveLength("1.5rem")).toMatchObject({ value: 24 });
  });
  it("resolves em * 16 with EM_APPROXIMATED warning", () => {
    const result = resolveLength("2em");
    expect(result?.value).toBe(32);
    expect(result?.warnings[0]?.code).toBe("EM_APPROXIMATED");
  });
  it("resolves unitless 0", () => {
    expect(resolveLength("0")).toMatchObject({ value: 0 });
  });
  it("leaves other units unresolved", () => {
    expect(resolveLength("5vh")).toBeNull();
    expect(resolveLength("50%")).toBeNull();
  });
});

describe("T-ST-02 font-weight resolution", () => {
  it("resolves normal/bold keywords and numbers", () => {
    expect(resolveFontWeight("normal")).toBe(400);
    expect(resolveFontWeight("bold")).toBe(700);
    expect(resolveFontWeight("600")).toBe(600);
  });
});

describe("T-ST-01b var(--x) resolution", () => {
  it("resolves var(--x) only from :root declarations", () => {
    const rootVars = { "--brand": "#336699" };
    expect(expandValue("var(--brand)", rootVars)).toBe("#336699");
    expect(expandValue("var(--missing)", rootVars)).toBeNull();
  });

  it("resolves colors through var(--x)", () => {
    const rootVars = { "--brand": "#336699" };
    const resolved = resolveColorValue("var(--brand)", rootVars);
    expect(resolved?.value).toEqual({ r: 0x33, g: 0x66, b: 0x99, a: 1 });
  });
});

describe("T-ST-01c color parsing", () => {
  it("parses #rgb #rrggbb #rrggbbaa and rgb()/rgba()", () => {
    expect(resolveColorValue("#fff", {})?.value).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(resolveColorValue("#336699", {})?.value).toEqual({ r: 0x33, g: 0x66, b: 0x99, a: 1 });
    expect(resolveColorValue("#33669980", {})?.value.a).toBeCloseTo(0x80 / 255, 5);
    expect(resolveColorValue("rgb(10, 20, 30)", {})?.value).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(resolveColorValue("rgba(10, 20, 30, 0.5)", {})?.value).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it("parses keywords white/black/transparent", () => {
    expect(resolveColorValue("white", {})?.value).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(resolveColorValue("black", {})?.value).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(resolveColorValue("transparent", {})?.value).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("leaves unknown color formats unresolved", () => {
    expect(resolveColorValue("hsl(200, 50%, 50%)", {})).toBeNull();
    expect(resolveColorValue("papayawhip-ish", {})).toBeNull();
  });
});
