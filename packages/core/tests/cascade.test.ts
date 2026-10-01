import { describe, expect, it } from "vitest";
import { parseJsxFile } from "../src/parser/jsx.js";
import { parseCssFile } from "../src/parser/css.js";
import { resolveStyle, resolveBackgroundColor, type CascadeContext } from "../src/style/cascade.js";
import type { JsxElementNode, ProjectModel, FileModel } from "../src/parser/model.js";
import type { PramaanConfig } from "../src/config.js";

function makeConfig(entry: string): PramaanConfig {
  return {
    srcRoot: "src",
    entry,
    checkboxComponents: ["Checkbox"],
    buttonComponents: [],
    runtime: { buildCommand: "npm run build", outDir: "dist" },
    configHash: "test",
  };
}

function findByTag(root: JsxElementNode, tag: string, nth = 0): JsxElementNode {
  const matches: JsxElementNode[] = [];
  function walk(el: JsxElementNode): void {
    if (el.tag === tag) matches.push(el);
    for (const c of el.children) walk(c);
  }
  walk(root);
  const match = matches[nth];
  if (!match) throw new Error(`tag ${tag}[${nth}] not found`);
  return match;
}

function buildModel(jsxFiles: Record<string, string>, cssFiles: Record<string, string>): ProjectModel {
  const files: FileModel[] = Object.entries(jsxFiles).map(([path, source]) => {
    const { components, parseError } = parseJsxFile(path, source);
    return { path, sha256: "x", source, components, ...(parseError ? { parseError } : {}) };
  });
  const cssModels = Object.entries(cssFiles).map(([path, source]) => {
    const { model } = parseCssFile(path, source);
    return { ...model, sha256: "x" };
  });
  return { srcRoot: "src", files, cssFiles: cssModels, warnings: [] };
}

describe("T-ST-03 specificity ordering (ids, classes, types)", () => {
  it("id beats class beats type", () => {
    const jsx = {
      "src/App.tsx": `
        function App() {
          return <div id="hero" className="box">hi</div>;
        }
      `,
    };
    const css = {
      "src/styles.css": `
        div { color: black; }
        .box { color: blue; }
        #hero { color: red; }
      `,
    };
    const model = buildModel(jsx, css);
    const root = model.files[0]?.components[0]?.jsxRoot as JsxElementNode;
    const ctx: CascadeContext = { projectModel: model, config: makeConfig("src/App.tsx"), filePath: "src/App.tsx" };
    const { result } = resolveStyle(root, ctx);
    expect(result.color?.value).toBe("red");
    expect(result.color?.winnerEntry.specificity).toEqual([1, 0, 0]);
  });
});

describe("T-ST-04 !important beats normal", () => {
  it("important wins regardless of specificity/order", () => {
    const jsx = { "src/App.tsx": `function App() { return <div id="x" className="y">hi</div>; }` };
    const css = {
      "src/styles.css": `
        #x { color: red; }
        .y { color: blue !important; }
      `,
    };
    const model = buildModel(jsx, css);
    const root = model.files[0]?.components[0]?.jsxRoot as JsxElementNode;
    const ctx: CascadeContext = { projectModel: model, config: makeConfig("src/App.tsx"), filePath: "src/App.tsx" };
    const { result } = resolveStyle(root, ctx);
    expect(result.color?.value).toBe("blue");
    expect(result.color?.important).toBe(true);
  });
});

describe("T-ST-05 inline beats stylesheet for equal importance", () => {
  it("inline style wins over a stylesheet rule of any specificity", () => {
    const jsx = {
      "src/App.tsx": `function App() { return <div id="x" style={{ color: "green" }}>hi</div>; }`,
    };
    const css = { "src/styles.css": `#x { color: red; }` };
    const model = buildModel(jsx, css);
    const root = model.files[0]?.components[0]?.jsxRoot as JsxElementNode;
    const ctx: CascadeContext = { projectModel: model, config: makeConfig("src/App.tsx"), filePath: "src/App.tsx" };
    const { result } = resolveStyle(root, ctx);
    expect(result.color?.value).toBe("green");
    expect(result.color?.winnerEntry.origin).toBe("inline");
  });
});

describe("T-ST-06 source-order tiebreak", () => {
  it("later rule of equal specificity wins", () => {
    const jsx = { "src/App.tsx": `function App() { return <div className="x">hi</div>; }` };
    const css = {
      "src/styles.css": `
        .x { color: red; }
        .x { color: blue; }
      `,
    };
    const model = buildModel(jsx, css);
    const root = model.files[0]?.components[0]?.jsxRoot as JsxElementNode;
    const ctx: CascadeContext = { projectModel: model, config: makeConfig("src/App.tsx"), filePath: "src/App.tsx" };
    const { result } = resolveStyle(root, ctx);
    expect(result.color?.value).toBe("blue");
  });

  it("descendant/child combinators match ancestors within the same file", () => {
    const jsx = {
      "src/App.tsx": `
        function App() {
          return (
            <div className="checkout">
              <button className="accept">Yes</button>
            </div>
          );
        }
      `,
    };
    const css = { "src/styles.css": `.checkout > .accept { color: lime; } .checkout .accept { font-weight: bold; }` };
    const model = buildModel(jsx, css);
    const root = model.files[0]?.components[0]?.jsxRoot as JsxElementNode;
    const button = findByTag(root, "button");
    const ctx: CascadeContext = { projectModel: model, config: makeConfig("src/App.tsx"), filePath: "src/App.tsx" };
    const { result } = resolveStyle(button, ctx);
    expect(result.color?.value).toBe("lime");
    expect(result["font-weight"]?.value).toBe("bold");
  });
});

describe("T-ST-07 unsupported selector warning", () => {
  it("attribute selectors and :not() never match and produce UNSUPPORTED_SELECTOR", () => {
    const jsx = { "src/App.tsx": `function App() { return <input type="checkbox" className="x" />; }` };
    const css = {
      "src/styles.css": `
        input[type="checkbox"] { opacity: 0; }
        .x:not(.y) { opacity: 0.5; }
      `,
    };
    const model = buildModel(jsx, css);
    const root = model.files[0]?.components[0]?.jsxRoot as JsxElementNode;
    const ctx: CascadeContext = { projectModel: model, config: makeConfig("src/App.tsx"), filePath: "src/App.tsx" };
    const { result, warnings } = resolveStyle(root, ctx);
    expect(result.opacity).toBeUndefined();
    expect(warnings.filter((w) => w.code === "UNSUPPORTED_SELECTOR")).toHaveLength(2);
  });

  it("descendant selectors needing ancestors outside the file emit ANCESTOR_CONTEXT_UNKNOWN", () => {
    const jsx = { "src/App.tsx": `function App() { return <button className="accept">Yes</button>; }` };
    const css = { "src/styles.css": `.modal .accept { color: lime; }` };
    const model = buildModel(jsx, css);
    const root = model.files[0]?.components[0]?.jsxRoot as JsxElementNode;
    const ctx: CascadeContext = { projectModel: model, config: makeConfig("src/App.tsx"), filePath: "src/App.tsx" };
    const { result, warnings } = resolveStyle(root, ctx);
    expect(result.color).toBeUndefined();
    expect(warnings.some((w) => w.code === "ANCESTOR_CONTEXT_UNKNOWN")).toBe(true);
  });
});

describe("T-ST-09 background resolution", () => {
  it("uses the element's own background-color when present", () => {
    const jsx = { "src/App.tsx": `function App() { return <div className="card">hi</div>; }` };
    const css = { "src/styles.css": `.card { background-color: #eeeeee; }` };
    const model = buildModel(jsx, css);
    const root = model.files[0]?.components[0]?.jsxRoot as JsxElementNode;
    const ctx: CascadeContext = { projectModel: model, config: makeConfig("src/App.tsx"), filePath: "src/App.tsx" };
    const { color, warnings } = resolveBackgroundColor(root, ctx);
    expect(color).toEqual({ r: 0xee, g: 0xee, b: 0xee, a: 1 });
    expect(warnings.some((w) => w.code === "BACKGROUND_ASSUMED_WHITE")).toBe(false);
  });

  it("falls back to the nearest ancestor's background-color", () => {
    const jsx = {
      "src/App.tsx": `
        function App() {
          return (
            <div className="card">
              <span className="label">hi</span>
            </div>
          );
        }
      `,
    };
    const css = { "src/styles.css": `.card { background-color: #112233; }` };
    const model = buildModel(jsx, css);
    const root = model.files[0]?.components[0]?.jsxRoot as JsxElementNode;
    const span = findByTag(root, "span");
    const ctx: CascadeContext = { projectModel: model, config: makeConfig("src/App.tsx"), filePath: "src/App.tsx" };
    const { color } = resolveBackgroundColor(span, ctx);
    expect(color).toEqual({ r: 0x11, g: 0x22, b: 0x33, a: 1 });
  });

  it("assumes #ffffff with BACKGROUND_ASSUMED_WHITE when nothing resolves", () => {
    const jsx = { "src/App.tsx": `function App() { return <div>hi</div>; }` };
    const model = buildModel(jsx, {});
    const root = model.files[0]?.components[0]?.jsxRoot as JsxElementNode;
    const ctx: CascadeContext = { projectModel: model, config: makeConfig("src/App.tsx"), filePath: "src/App.tsx" };
    const { color, warnings } = resolveBackgroundColor(root, ctx);
    expect(color).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(warnings.some((w) => w.code === "BACKGROUND_ASSUMED_WHITE")).toBe(true);
  });
});
