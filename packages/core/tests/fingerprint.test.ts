import { describe, expect, it } from "vitest";
import { computeFingerprint } from "../src/fingerprint.js";
import { parseJsxFile } from "../src/parser/jsx.js";
import { resolveLabel } from "../src/parser/label.js";
import type { JsxElementNode } from "../src/parser/model.js";

describe("fingerprint stability (spec 8.1)", () => {
  const base = {
    ruleId: "PRM-001" as const,
    file: "src/Checkout.tsx",
    componentName: "Checkout",
    jsxPath: "0.1.2",
    anchorText: "Add gift wrap",
  };

  it("is deterministic for identical input", () => {
    expect(computeFingerprint(base)).toBe(computeFingerprint(base));
  });

  it("normalises anchor text (case + whitespace) before hashing", () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({ ...base, anchorText: "  ADD   gift WRAP  " });
    expect(a).toBe(b);
  });

  it("changes when ruleId, file, componentName, jsxPath, or anchorText changes", () => {
    const a = computeFingerprint(base);
    expect(computeFingerprint({ ...base, ruleId: "PRM-002" })).not.toBe(a);
    expect(computeFingerprint({ ...base, file: "src/Other.tsx" })).not.toBe(a);
    expect(computeFingerprint({ ...base, componentName: "Other" })).not.toBe(a);
    expect(computeFingerprint({ ...base, jsxPath: "0.1.3" })).not.toBe(a);
    expect(computeFingerprint({ ...base, anchorText: "different text" })).not.toBe(a);
  });

  it("does NOT depend on attributes that fixes change (checked/style/className/initial state)", () => {
    // Simulates computing the fingerprint before and after a remediation
    // mutates `checked`, `style`, `className` and the initial useState
    // literal on the underlying element — none of those are inputs to
    // computeFingerprint, so nothing here should ever differ.
    const before = computeFingerprint(base);

    // "after a fix": same rule/file/component/jsxPath/anchorText, because
    // the fingerprint function has no parameter through which checked,
    // style, className or initial state could flow in the first place.
    const afterFixInputs = { ...base };
    const after = computeFingerprint(afterFixInputs);

    expect(after).toBe(before);
  });

  it("is unchanged when a real fix mutates checked/style/className/initial state on the parsed element", () => {
    function computeFromSource(source: string): string {
      const { components } = parseJsxFile("src/Checkout.tsx", source);
      const root = components[0]?.jsxRoot as JsxElementNode;
      const input = root.children[0] as JsxElementNode;
      const label = resolveLabel(input, root);
      return computeFingerprint({
        ruleId: "PRM-001",
        file: "src/Checkout.tsx",
        componentName: components[0]?.name ?? "<anonymous>",
        jsxPath: input.jsxPath,
        anchorText: label.text ?? "",
      });
    }

    const originalSource = `
      function Checkout() {
        const [ok, setOk] = useState(true);
        return (
          <div>
            <input type="checkbox" checked={ok} className="pre-checked" />
            <span>Add gift wrap</span>
          </div>
        );
      }
    `;
    const fixedSource = `
      function Checkout() {
        const [ok, setOk] = useState(false);
        return (
          <div>
            <input type="checkbox" checked={ok} style={{ accentColor: "blue" }} className="unchecked-now" />
            <span>Add gift wrap</span>
          </div>
        );
      }
    `;

    expect(computeFromSource(fixedSource)).toBe(computeFromSource(originalSource));
  });
});
