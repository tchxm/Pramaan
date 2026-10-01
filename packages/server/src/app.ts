import Fastify from "fastify";
import cors from "@fastify/cors";
import { pathToFileURL } from "node:url";
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
  await app.register(cors, { origin: ["http://localhost:5173"] });

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
