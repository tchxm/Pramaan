/**
 * Default `LLMClient` construction for `live` mode (spec 14.10, 6.1).
 * Reads env vars and wires Anthropic (primary) + Groq (fallback) through
 * `createFallbackClient`.
 *
 * Construction always succeeds, even with zero keys configured — commands
 * like `scan` never touch the LLM and must not be blocked by its absence.
 * The `LLMUnavailableError` only fires when something actually calls
 * `.complete()`/`.completeJson()`.
 */
import { AnthropicLLMClient } from "./anthropic.js";
import type { LLMClient, LLMCompleteOptions, LLMMessage, LLMResponse, LLMToolDefinition } from "./client.js";
import { LLMUnavailableError } from "./client.js";
import { createFallbackClient } from "./fallback.js";
import { GeminiLLMClient } from "./gemini.js";
import { GroqLLMClient } from "./groq.js";

/**
 * Resolves the Anthropic API key. Spec 6.1 names the env var
 * `LLM_API_KEY`; the Anthropic SDK and most tooling conventionally reads
 * `ANTHROPIC_API_KEY`. We support both, preferring the spec's explicit
 * `LLM_API_KEY` when both are set.
 */
function resolveAnthropicKey(): string | undefined {
  return process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || undefined;
}

function resolveGroqKey(): string | undefined {
  return process.env.GROQ_API_KEY || undefined;
}

/** Free-tier, no-credit-card provider. Spec 6.1 doesn't name this env var
 * (added after the spec was written, as a genuinely free fallback option);
 * `GEMINI_API_KEY` is the conventional name, `GOOGLE_API_KEY` also accepted. */
function resolveGeminiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

/** Placeholder client used when neither provider is configured. Constructing
 * it never throws; calling it always does, with a clear, diagnosable message. */
class UnconfiguredLLMClient implements LLMClient {
  async complete(
    _messages: LLMMessage[],
    _tools: LLMToolDefinition[],
    _options?: LLMCompleteOptions,
  ): Promise<LLMResponse> {
    throw new LLMUnavailableError(
      "No LLM provider is configured. Set LLM_API_KEY (or ANTHROPIC_API_KEY) and/or GROQ_API_KEY to run in live mode.",
    );
  }

  async completeJson(): Promise<{ raw: string }> {
    throw new LLMUnavailableError(
      "No LLM provider is configured. Set LLM_API_KEY (or ANTHROPIC_API_KEY) and/or GROQ_API_KEY to run in live mode.",
    );
  }
}

/**
 * Builds the default `LLMClient` for live mode: tries each configured
 * provider in priority order — Anthropic, then Gemini (free tier), then
 * Groq (free tier) — wired through nested `createFallbackClient` calls.
 * Any subset of keys may be set; unset providers are simply skipped. Safe
 * to call with no keys configured — it returns a client whose calls fail
 * loudly and clearly, rather than throwing at construction time.
 */
export function createDefaultLLMClient(): LLMClient {
  const providers: Array<{ name: string; client: LLMClient }> = [];

  const anthropicKey = resolveAnthropicKey();
  if (anthropicKey) providers.push({ name: "anthropic", client: new AnthropicLLMClient({ apiKey: anthropicKey }) });

  const geminiKey = resolveGeminiKey();
  if (geminiKey) providers.push({ name: "gemini", client: new GeminiLLMClient({ apiKey: geminiKey }) });

  const groqKey = resolveGroqKey();
  if (groqKey) providers.push({ name: "groq", client: new GroqLLMClient({ apiKey: groqKey }) });

  if (providers.length === 0) return new UnconfiguredLLMClient();

  // Fold right-to-left: the last provider stands alone, each one before it
  // becomes the primary of a fallback pair wrapping everything after it.
  let chain = providers[providers.length - 1]!.client;
  let chainName = providers[providers.length - 1]!.name;
  for (let i = providers.length - 2; i >= 0; i -= 1) {
    chain = createFallbackClient(providers[i]!.client, chain, { primary: providers[i]!.name, secondary: chainName });
    chainName = `${providers[i]!.name}->${chainName}`;
  }
  return chain;
}
