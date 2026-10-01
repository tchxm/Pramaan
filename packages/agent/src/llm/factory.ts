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
 * Builds the default `LLMClient` for live mode: Anthropic primary, Groq
 * fallback, wired through `createFallbackClient`. Safe to call with no
 * keys configured — it returns a client whose calls fail loudly and
 * clearly, rather than throwing at construction time.
 */
export function createDefaultLLMClient(): LLMClient {
  const anthropicKey = resolveAnthropicKey();
  const groqKey = resolveGroqKey();

  const primary = anthropicKey ? new AnthropicLLMClient({ apiKey: anthropicKey }) : null;
  const secondary = groqKey ? new GroqLLMClient({ apiKey: groqKey }) : null;

  if (primary && secondary) {
    return createFallbackClient(primary, secondary, { primary: "anthropic", secondary: "groq" });
  }
  if (primary) {
    return createFallbackClient(primary, null, { primary: "anthropic" });
  }
  if (secondary) {
    // Groq as the sole configured provider: it is "primary" from the
    // caller's perspective since it's the only one that will ever run.
    return createFallbackClient(secondary, null, { primary: "groq" });
  }
  return new UnconfiguredLLMClient();
}
