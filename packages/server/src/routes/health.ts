import type { FastifyInstance } from "fastify";
import { ENGINE_VERSION } from "../store.js";

export function registerHealthRoute(app: FastifyInstance): void {
  app.get("/api/health", async () => ({
    ok: true,
    engineVersion: ENGINE_VERSION,
    llm: {
      configured: Boolean(process.env.LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY),
      model: process.env.LLM_MODEL ?? process.env.PRAMAAN_MODEL ?? null,
    },
    runtime: {
      playwrightReady: process.env.PRAMAAN_RUNTIME !== "off",
    },
    mode: process.env.PRAMAAN_AGENT_MODE ?? "live",
  }));
}
