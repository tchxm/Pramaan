import { describe, expect, it } from "vitest";
import { parseJsxFile } from "../src/parser/jsx.js";
import { resolveLabel } from "../src/parser/label.js";
import type { JsxElementNode } from "../src/parser/model.js";

function findByTag(root: JsxElementNode, tag: string): JsxElementNode {
  if (root.tag === tag) return root;
  for (const c of root.children) {
    try {
      return findByTag(c, tag);
    } catch {
      // keep searching
    }
  }
  throw new Error(`tag ${tag} not found`);
}

function findAllByTag(root: JsxElementNode, tag: string): JsxElementNode[] {
  const out: JsxElementNode[] = [];
  function walk(el: JsxElementNode): void {
    if (el.tag === tag) out.push(el);
    for (const c of el.children) walk(c);
  }
  walk(root);
  return out;
}

describe("T-PA label association (spec 9.3)", () => {
  it("method 1: enclosing <label>", () => {
    const source = `
      function Form() {
        return (
          <label>
            Gift wrap this order
            <input type="checkbox" />
          </label>
        );
      }
    `;
    const { components } = parseJsxFile("src/Form.tsx", source);
    const root = components[0]?.jsxRoot as JsxElementNode;
    const input = findByTag(root, "input");
    const result = resolveLabel(input, root);
    expect(result.method).toBe("enclosing_label");
    expect(result.text).toBe("Gift wrap this order");
  });

  it("method 2: <label htmlFor=id>", () => {
    const source = `
      function Form() {
        return (
          <div>
            <label htmlFor="tip">Add a tip</label>
            <input id="tip" type="checkbox" />
          </div>
        );
      }
    `;
    const { components } = parseJsxFile("src/Form.tsx", source);
    const root = components[0]?.jsxRoot as JsxElementNode;
    const input = findByTag(root, "input");
    const result = resolveLabel(input, root);
    expect(result.method).toBe("label_for");
    expect(result.text).toBe("Add a tip");
  });

  it("method 3: aria-label literal", () => {
    const source = `
      function Form() {
        return <input type="checkbox" aria-label="Priority handling" />;
      }
    `;
    const { components } = parseJsxFile("src/Form.tsx", source);
    const root = components[0]?.jsxRoot as JsxElementNode;
    const result = resolveLabel(root, root);
    expect(result.method).toBe("aria_label");
    expect(result.text).toBe("Priority handling");
  });

  it("method 4: following sibling <span>", () => {
    const source = `
      function Form() {
        return (
          <div>
            <input type="checkbox" />
            <span>Extended warranty</span>
          </div>
        );
      }
    `;
    const { components } = parseJsxFile("src/Form.tsx", source);
    const root = components[0]?.jsxRoot as JsxElementNode;
    const input = findByTag(root, "input");
    const result = resolveLabel(input, root);
    expect(result.method).toBe("sibling_text");
    expect(result.text).toBe("Extended warranty");
  });

  it("LABEL_NOT_FOUND: no label reachable by any method", () => {
    const source = `
      function Form() {
        return (
          <div>
            <input type="checkbox" />
          </div>
        );
      }
    `;
    const { components } = parseJsxFile("src/Form.tsx", source);
    const root = components[0]?.jsxRoot as JsxElementNode;
    const input = findByTag(root, "input");
    const result = resolveLabel(input, root);
    expect(result.method).toBeNull();
    expect(result.text).toBeNull();
  });
});
