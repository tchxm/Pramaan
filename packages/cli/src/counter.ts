// Same convention as packages/server/src/counter.ts (Spec 15.7), duplicated
// here because the CLI runs as its own process against an arbitrary project
// root, not against the server's .pramaan directory.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function nextAuditId(pramaanDir: string): Promise<string> {
  await mkdir(pramaanDir, { recursive: true });
  const counterPath = path.join(pramaanDir, "counter.json");
  const year = new Date().getUTCFullYear();
  let counter = 0;
  try {
    const raw = await readFile(counterPath, "utf-8");
    const data = JSON.parse(raw) as { year: number; counter: number };
    if (data.year === year) counter = data.counter;
  } catch {
    // no counter file yet, or corrupt: start fresh for this year
  }
  counter += 1;
  await writeFile(counterPath, JSON.stringify({ year, counter }, null, 2), "utf-8");
  return `PRM-${year}-${String(counter).padStart(6, "0")}`;
}
