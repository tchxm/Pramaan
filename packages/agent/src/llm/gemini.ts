/** Google Gemini adapter, via Gemini's OpenAI-compatible endpoint (no
 * credit card required for a free-tier key from aistudio.google.com/apikey).
 * Thin wrapper over the shared OpenAI-compatible client — see
 * openaiCompatible.ts. */
import type { LLMClient } from "./client.js";
import { OpenAICompatibleLLMClient } from "./openaiCompatible.js";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

/**
 * Current free-tier Gemini model with function-calling support, verified
 * live against the API on 2026-10-01. `gemini-2.0-flash`/`2.5-flash` are
 * retired; `gemini-3.8-flash`/`gemini-flash-latest` returned 503 (overloaded)
 * at verification time, so this pins to a sibling in the same generation
 * that responded cleanly. Override with `PRAMAAN_MODEL` if needed.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

export interface GeminiClientOptions {
  apiKey: string;
  model?: string;
}

export class GeminiLLMClient implements LLMClient {
  private readonly inner: OpenAICompatibleLLMClient;

  constructor(options: GeminiClientOptions) {
    this.inner = new OpenAICompatibleLLMClient({
      apiKey: options.apiKey,
      model: options.model,
      providerLabel: "Gemini",
      apiUrl: GEMINI_API_URL,
      defaultModel: DEFAULT_GEMINI_MODEL,
    });
  }

  complete: OpenAICompatibleLLMClient["complete"] = (...args) => this.inner.complete(...args);
  completeJson: OpenAICompatibleLLMClient["completeJson"] = (...args) => this.inner.completeJson(...args);
}
