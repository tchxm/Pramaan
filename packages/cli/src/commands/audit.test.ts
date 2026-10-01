import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAuditCommand } from "./audit.js";
import { loadState } from "../localStore.js";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

describe("pramaan audit <path>", () => {
  it("exits 3 and records an error-status audit while runAudit() is unimplemented", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "pramaan-cli-audit-"));
    await writeFile(
      path.join(tmpDir, "pramaan.config.json"),
      JSON.stringify({ srcRoot: "src", entry: "src/main.tsx" }),
      "utf-8",
    );

    const code = await runAuditCommand(tmpDir, { json: true });
    expect(code).toBe(3);

    // The most recent audit id is deterministic here (first run => 000001).
    const state = await loadState(tmpDir, "PRM-2026-000001");
    expect(state?.audit.status).toBe("error");
  });
});
