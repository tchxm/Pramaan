/** OpenRouter adapter. Thin wrapper over the shared OpenAI-compatible
 * client — see openaiCompatible.ts. OpenRouter proxies many underlying
 * models behind one OpenAI-shaped endpoint; `:free` suffixed model slugs
 * are rate-limited but require no payment method. */
import type { LLMClient } from "./client.js";
import { OpenAICompatibleLLMClient } from "./openaiCompatible.js";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * A free-tier, tool-calling-capable OpenRouter model, confirmed present in
 * GET /api/v1/models with `tools` in `supported_parameters` as of
 * 2026-10-01. OpenRouter's `:free` catalog rotates — if this one 404s,
 * re-query the live catalog rather than guessing a replacement slug.
 * Override with PRAMAAN_OPENROUTER_MODEL (or the shared PRAMAAN_MODEL).
 */
export const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

export interface OpenRouterClientOptions {
  apiKey: string;
  model?: string;
}

export class OpenRouterLLMClient implements LLMClient {
  private readonly inner: OpenAICompatibleLLMClient;

  constructor(options: OpenRouterClientOptions) {
    this.inner = new OpenAICompatibleLLMClient({
      apiKey: options.apiKey,
      model: options.model ?? process.env.PRAMAAN_OPENROUTER_MODEL,
      providerLabel: "OpenRouter",
      apiUrl: OPENROUTER_API_URL,
      defaultModel: DEFAULT_OPENROUTER_MODEL,
    });
  }

  complete: OpenAICompatibleLLMClient["complete"] = (...args) => this.inner.complete(...args);
  completeJson: OpenAICompatibleLLMClient["completeJson"] = (...args) => this.inner.completeJson(...args);
}
