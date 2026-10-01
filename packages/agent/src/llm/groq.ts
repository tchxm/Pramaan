/** Groq adapter (fallback provider). Thin wrapper over the shared
 * OpenAI-compatible client — see openaiCompatible.ts. */
import type { LLMClient } from "./client.js";
import { OpenAICompatibleLLMClient } from "./openaiCompatible.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Documented-current default Groq model with tool-calling support.
 * Llama 3.3 70B Versatile was retired from Groq's catalog; GPT-OSS 120B is
 * the current tool-calling-capable model available on this key as of
 * 2026-10-01 (verified via GET /openai/v1/models).
 * Override with `PRAMAAN_MODEL` if the user wants a different Groq model id.
 */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

export interface GroqClientOptions {
  apiKey: string;
  model?: string;
}

export class GroqLLMClient implements LLMClient {
  private readonly inner: OpenAICompatibleLLMClient;

  constructor(options: GroqClientOptions) {
    this.inner = new OpenAICompatibleLLMClient({
      apiKey: options.apiKey,
      model: options.model,
      providerLabel: "Groq",
      apiUrl: GROQ_API_URL,
      defaultModel: DEFAULT_GROQ_MODEL,
    });
  }

  complete: OpenAICompatibleLLMClient["complete"] = (...args) => this.inner.complete(...args);
  completeJson: OpenAICompatibleLLMClient["completeJson"] = (...args) => this.inner.completeJson(...args);
}
