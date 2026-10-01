/** Cloudflare Workers AI adapter. Thin wrapper over the shared
 * OpenAI-compatible client — see openaiCompatible.ts. Cloudflare's
 * OpenAI-compatible endpoint is account-scoped, so the account id is
 * interpolated into the URL rather than sent as a header. */
import type { LLMClient } from "./client.js";
import { LLMUnavailableError } from "./client.js";
import { OpenAICompatibleLLMClient } from "./openaiCompatible.js";

/**
 * A tool-calling-capable Workers AI model as of 2026-10. Override with
 * PRAMAAN_CLOUDFLARE_MODEL if this one is retired — Cloudflare marks
 * function-calling support per model in its catalog and it does change.
 */
export const DEFAULT_CLOUDFLARE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export interface CloudflareClientOptions {
  apiKey: string;
  accountId: string;
  model?: string;
}

export class CloudflareLLMClient implements LLMClient {
  private readonly inner: OpenAICompatibleLLMClient;

  constructor(options: CloudflareClientOptions) {
    if (!options.accountId) {
      throw new LLMUnavailableError(
        "Cloudflare adapter constructed without CLOUDFLARE_ACCOUNT_ID. This should never happen — the factory must only construct this class when both the token and account id are present.",
      );
    }
    const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/ai/v1/chat/completions`;
    this.inner = new OpenAICompatibleLLMClient({
      apiKey: options.apiKey,
      model: options.model ?? process.env.PRAMAAN_CLOUDFLARE_MODEL,
      providerLabel: "Cloudflare",
      apiUrl,
      defaultModel: DEFAULT_CLOUDFLARE_MODEL,
    });
  }

  complete: OpenAICompatibleLLMClient["complete"] = (...args) => this.inner.complete(...args);
  completeJson: OpenAICompatibleLLMClient["completeJson"] = (...args) => this.inner.completeJson(...args);
}
