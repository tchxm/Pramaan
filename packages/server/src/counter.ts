// Audit id allocation. Spec Section 15.7: PRM-<year>-<6-digit counter>,
// counter persisted in <pramaanDir>/counter.json and incremented atomically.
// Concurrency within this process is serialized with a promise chain; cross
// process safety is best-effort (single server process owns this file).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

let chain: Promise<unknown> = Promise.resolve();

export function nextAuditId(pramaanDir: string): Promise<string> {
  const task = chain.then(() => computeNext(pramaanDir));
  chain = task.catch(() => undefined);
  return task;
}

async function computeNext(pramaanDir: string): Promise<string> {
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
