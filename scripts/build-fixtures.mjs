#!/usr/bin/env node
// Builds every fixtures/f*/ app (and any fixture with its own package.json
// under fixtures/variants/) by running `npm run build` in each directory,
// then prints a pass/fail summary and exits non-zero if anything failed.
//
// This is what `npm run fixtures:build` invokes (see root package.json).

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const fixturesRoot = path.join(repoRoot, "fixtures");

function isBuildableDir(dir) {
  return existsSync(path.join(dir, "package.json"));
}

function findFixtureDirs() {
  const dirs = [];

  // Top-level fixtures/f01-... .. f08-... apps.
  for (const name of readdirSync(fixturesRoot)) {
    const full = path.join(fixturesRoot, name);
    if (!statSync(full).isDirectory()) continue;
    if (!/^f\d\d-/.test(name)) continue;
    if (isBuildableDir(full)) dirs.push(full);

    // F01 has a variant/ subfolder that is its own standalone app.
    const nestedVariant = path.join(full, "variant");
    if (existsSync(nestedVariant) && isBuildableDir(nestedVariant)) {
      dirs.push(nestedVariant);
    }
  }

  // fixtures/variants/<name>/ generated mutation-test copies.
  const variantsDir = path.join(fixturesRoot, "variants");
  if (existsSync(variantsDir)) {
    for (const name of readdirSync(variantsDir)) {
      const full = path.join(variantsDir, name);
      if (!statSync(full).isDirectory()) continue;
      if (isBuildableDir(full)) dirs.push(full);
    }
  }

  return dirs;
}

function relName(dir) {
  return path.relative(repoRoot, dir).split(path.sep).join("/");
}

const targets = findFixtureDirs();
if (targets.length === 0) {
  console.error("No buildable fixtures found under fixtures/.");
  process.exit(1);
}

const results = [];
for (const dir of targets) {
  const name = relName(dir);
  process.stdout.write(`\n=== building ${name} ===\n`);
  try {
    execSync("npm run build", {
      cwd: dir,
      stdio: "inherit",
      env: process.env,
    });
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

const passed = results.filter((r) => r.ok);
const failed = results.filter((r) => !r.ok);

console.log("\n\n=== fixtures:build summary ===");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
}
console.log(`\n${passed.length}/${results.length} fixtures built successfully.`);

if (failed.length > 0) {
  console.error(`\n${failed.length} fixture(s) failed to build:`);
  for (const r of failed) {
    console.error(`  - ${r.name}`);
  }
  process.exit(1);
}

process.exit(0);
