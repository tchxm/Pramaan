// GET /api/fixtures — discovers fixtures/*/pramaan.config.json + expected.json.
// Honest-empty when fixtures/ is missing or partially built (owned by A2).
import type { FastifyInstance } from "fastify";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

interface FixtureListEntry {
  id: string;
  name: string;
  description: string;
  expected: { findings: unknown; patterns?: unknown };
}

function deriveName(dirName: string): string {
  return dirName
    .replace(/^f\d+-/, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

export function registerFixturesRoute(app: FastifyInstance): void {
  app.get("/api/fixtures", async () => {
    const fixturesRoot = path.resolve(process.cwd(), "fixtures");
    let dirNames: string[] = [];
    try {
      dirNames = (await readdir(fixturesRoot, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && e.name !== "variants" && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }

    const out: FixtureListEntry[] = [];
    for (const id of dirNames) {
      const dir = path.join(fixturesRoot, id);
      let expected: unknown = { findings: [] };
      try {
        expected = JSON.parse(await readFile(path.join(dir, "expected.json"), "utf-8"));
      } catch {
        // fixture not fully built yet — still list it, honestly empty.
      }
      let description = "";
      try {
        const cfg = JSON.parse(await readFile(path.join(dir, "pramaan.config.json"), "utf-8")) as {
          description?: string;
        };
        description = cfg.description ?? "";
      } catch {
        // config may not exist yet
      }
      const expectedObj = expected as { findings?: unknown; patterns?: unknown };
      out.push({
        id,
        name: deriveName(id),
        description: description || `Fixture ${id}`,
        expected: { findings: expectedObj.findings ?? [], patterns: expectedObj.patterns },
      });
    }
    return out;
  });
}
