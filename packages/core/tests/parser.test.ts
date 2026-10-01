import { describe, expect, it } from "vitest";
import { parseJsxFile } from "../src/parser/jsx.js";
import type { JsxElementNode } from "../src/parser/model.js";

function findByTag(root: JsxElementNode | null, tag: string): JsxElementNode | null {
  if (!root) return null;
  if (root.tag === tag) return root;
  for (const c of root.children) {
    const found = findByTag(c, tag);
    if (found) return found;
  }
  return null;
}

describe("T-PA-01 component detection", () => {
  it("finds a named function component and its JSX root", () => {
    const source = `
      function Widget() {
        return <div className="wrap"><span>hello</span></div>;
      }
    `;
    const { components, parseError } = parseJsxFile("src/Widget.tsx", source);
    expect(parseError).toBeUndefined();
    expect(components).toHaveLength(1);
    expect(components[0]?.name).toBe("Widget");
    expect(components[0]?.jsxRoot?.tag).toBe("div");
  });

  it("finds an arrow-function component assigned to a const", () => {
    const source = `
      const Panel = () => {
        return <section>ok</section>;
      };
    `;
    const { components } = parseJsxFile("src/Panel.tsx", source);
    expect(components).toHaveLength(1);
    expect(components[0]?.name).toBe("Panel");
    expect(components[0]?.jsxRoot?.tag).toBe("section");
  });
});

describe("T-PA-02 useState / useEffect extraction", () => {
  it("extracts useState initial literal and detects setInterval in useEffect", () => {
    const source = `
      function Countdown() {
        const [seconds, setSeconds] = useState(30);
        useEffect(() => {
          const id = setInterval(() => setSeconds((s) => s - 1), 1000);
          return () => clearInterval(id);
        }, []);
        return <div>{seconds}</div>;
      }
    `;
    const { components } = parseJsxFile("src/Countdown.tsx", source);
    const comp = components[0];
    expect(comp?.useState).toHaveLength(1);
    expect(comp?.useState[0]).toMatchObject({ getter: "seconds", setter: "setSeconds", initialLiteral: 30 });
    expect(comp?.useEffects).toHaveLength(1);
    expect(comp?.useEffects[0]?.hasIntervalOrTimeout).toBe(true);
  });

  it("records a non-literal initial value as expressionSource", () => {
    const source = `
      function Foo(props) {
        const [x, setX] = useState(props.initial);
        return <div>{x}</div>;
      }
    `;
    const { components } = parseJsxFile("src/Foo.tsx", source);
    const hook = components[0]?.useState[0];
    expect(hook?.initialLiteral).toBeUndefined();
    expect(hook?.initialExpressionSource).toBe("props.initial");
  });
});

describe("T-PA-03 JSX tree jsxPath", () => {
  it("assigns dot-joined child-index jsxPaths from the component's JSX root", () => {
    const source = `
      function Tree() {
        return (
          <div>
            <span>a</span>
            <p>
              <b>bold</b>
            </p>
          </div>
        );
      }
    `;
    const { components } = parseJsxFile("src/Tree.tsx", source);
    const root = components[0]?.jsxRoot as JsxElementNode;
    expect(root.jsxPath).toBe("");
    expect(root.children[0]?.tag).toBe("span");
    expect(root.children[0]?.jsxPath).toBe("0");
    expect(root.children[1]?.tag).toBe("p");
    expect(root.children[1]?.jsxPath).toBe("1");
    const bold = root.children[1]?.children[0];
    expect(bold?.tag).toBe("b");
    expect(bold?.jsxPath).toBe("1.0");
    expect(bold?.parent).toBe(root.children[1]);
  });
});

describe("T-PA-04 parse-error handling", () => {
  it("returns a parseError and empty components for invalid syntax, never throws", () => {
    const source = `function Broken() { return <div><span></div>; `; // mismatched tags + unterminated
    const result = parseJsxFile("src/Broken.tsx", source);
    expect(result.parseError).toBeDefined();
    expect(result.components).toHaveLength(0);
  });
});

describe("T-PA-05 attributes and text children", () => {
  it("captures literal attributes, expression attributes, and normalised text", () => {
    const source = `
      function Row() {
        const label = "dyn";
        return (
          <input type="checkbox" checked={true} defaultChecked data-x={label} />
        );
      }
    `;
    const { components } = parseJsxFile("src/Row.tsx", source);
    const root = components[0]?.jsxRoot as JsxElementNode;
    expect(root.tag).toBe("input");
    const attrByName = Object.fromEntries(root.attributes.map((a) => [a.name, a]));
    expect(attrByName.type?.literalValue).toBe("checkbox");
    expect(attrByName.checked?.literalValue).toBe(true);
    expect(attrByName.defaultChecked?.isBare).toBe(true);
    expect(attrByName["data-x"]?.expressionSource).toBe("label");
  });
});

describe("T-PA-06 whitespace-normalised text children", () => {
  it("collapses whitespace in JSX text children", () => {
    const source = `
      function Label() {
        return <span>  hello \n   world  </span>;
      }
    `;
    const { components } = parseJsxFile("src/Label.tsx", source);
    const root = components[0]?.jsxRoot as JsxElementNode;
    expect(root.textChildren).toEqual(["hello world"]);
  });
});
