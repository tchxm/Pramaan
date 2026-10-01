import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildProjectModel } from "../src/parser/project.js";
import type { PramaanConfig } from "../src/config.js";

describe("file discovery + buildProjectModel (spec 9.1)", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pramaan-discover-"));
    await mkdir(path.join(root, "src", "components"), { recursive: true });
    await mkdir(path.join(root, "src", "__tests__"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(path.join(root, "dist"), { recursive: true });

    await writeFile(
      path.join(root, "src", "App.tsx"),
      `function App() { return <div className="app">Hi</div>; }`,
    );
    await writeFile(path.join(root, "src", "styles.css"), `.app { color: red; }`);
    await writeFile(path.join(root, "src", "App.test.tsx"), `test content should be excluded`);
    await writeFile(path.join(root, "src", "components", "Btn.spec.ts"), `spec content should be excluded`);
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), `excluded`);
    await writeFile(path.join(root, "dist", "bundle.js"), `excluded`);
    await writeFile(path.join(root, "src", "notes.md"), `not an included extension`);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("includes .tsx/.css, excludes node_modules/dist/test files/non-matching extensions", async () => {
    const config: PramaanConfig = {
      srcRoot: "src",
      entry: "src/App.tsx",
      checkboxComponents: ["Checkbox"],
      buttonComponents: [],
      runtime: { buildCommand: "npm run build", outDir: "dist" },
      configHash: "test",
    };
    const model = await buildProjectModel(root, config);
    const paths = model.files.map((f) => f.path).concat(model.cssFiles.map((f) => f.path));
    expect(paths).toContain("src/App.tsx");
    expect(paths).toContain("src/styles.css");
    expect(paths.some((p) => p.includes("test"))).toBe(false);
    expect(paths.some((p) => p.includes("spec"))).toBe(false);
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(paths.some((p) => p.includes("dist"))).toBe(false);
    expect(paths.some((p) => p.endsWith(".md"))).toBe(false);

    const appFile = model.files.find((f) => f.path === "src/App.tsx");
    expect(appFile?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(appFile?.components[0]?.name).toBe("App");
  });
});
