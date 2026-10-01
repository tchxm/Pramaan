import Fastify from "fastify";
import cors from "@fastify/cors";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AuditStore } from "./store.js";
import { registerErrorHandler } from "./errorHandler.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerFixturesRoute } from "./routes/fixtures.js";
import { registerAuditRoutes } from "./routes/audits.js";
import { registerEvidenceVerifyRoute } from "./routes/evidence.js";

export interface BuildAppOptions {
  store?: AuditStore;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: true });
  // Vite picks the next free port when 5173 is taken (5174, 5175, ...), so
  // pinning to one origin breaks the whole app with an opaque CORS failure
  // the moment a stray dev server is already running on 5173 — any
  // localhost/127.0.0.1 origin is safe to allow for local dev. A deployed
  // frontend origin is added via PRAMAAN_ALLOWED_ORIGIN (comma-separated).
  const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;
  const extraOrigins = (process.env.PRAMAAN_ALLOWED_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || localOrigin.test(origin) || extraOrigins.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error("Not allowed by CORS"), false);
    },
  });

  registerErrorHandler(app);

  const store = options.store ?? new AuditStore(process.cwd());
  await store.init();

  registerHealthRoute(app);
  registerFixturesRoute(app);
  registerAuditRoutes(app, store);
  registerEvidenceVerifyRoute(app);

  return app;
}

async function main() {
  // npm workspace scripts run from packages/server. Fixtures, audit storage,
  // and relative project paths must use the same repository root as root demo.
  process.chdir(fileURLToPath(new URL("../../..", import.meta.url)));
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 8787);
  await app.listen({ port, host: "0.0.0.0" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
