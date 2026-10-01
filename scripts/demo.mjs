#!/usr/bin/env node
// One-command local demo: builds core+server, starts the API server and the
// web dev server, waits for both to come up, then prints the URL to open.
// `npm run demo` is the command the README/judges are told to run — it must
// not silently fail.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SERVER_PORT = Number(process.env.PORT ?? 8787);

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
}

function runCapture(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    ...opts,
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  return child;
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  return false;
}

function buildStep(label, cmd, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n[demo] ${label}...`);
    const child = run(cmd, args);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (exit ${code})`));
    });
  });
}

async function main() {
  await buildStep("building core", "npm", ["run", "build", "--workspace=packages/core"]);
  await buildStep("building server", "npm", ["run", "build", "--workspace=packages/server"]);

  console.log("\n[demo] starting API server on port " + SERVER_PORT + "...");
  const server = runCapture("node", ["packages/server/dist/app.js"], {
    env: { ...process.env, PORT: String(SERVER_PORT) },
  });

  const serverUp = await waitFor(`http://localhost:${SERVER_PORT}/api/health`, 15000);
  if (!serverUp) {
    console.error(`\n[demo] server did not become healthy within 15s — check the log above.`);
    server.kill();
    process.exit(1);
  }
  console.log(`[demo] server is up: http://localhost:${SERVER_PORT}/api/health`);

  console.log("\n[demo] starting web dev server (watch the terminal below for the Local: URL)...");
  const web = runCapture("npm", ["run", "dev", "--workspace=packages/web"], {
    env: { ...process.env, VITE_API_BASE_URL: `http://localhost:${SERVER_PORT}` },
  });

  function shutdown() {
    server.kill();
    web.kill();
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.on("exit", (code) => {
    console.error(`\n[demo] server process exited (code ${code}) — shutting down.`);
    web.kill();
    process.exit(code ?? 1);
  });
  web.on("exit", (code) => {
    console.error(`\n[demo] web process exited (code ${code}) — shutting down.`);
    server.kill();
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error("\n[demo] failed:", err.message);
  process.exit(1);
});
