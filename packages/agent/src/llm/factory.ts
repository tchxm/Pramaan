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
import { CloudflareLLMClient } from "./cloudflare.js";
import { createFallbackClient } from "./fallback.js";
import { GeminiLLMClient } from "./gemini.js";
import { GroqLLMClient } from "./groq.js";
import { OpenRouterLLMClient } from "./openrouter.js";

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

function resolveOpenRouterKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || undefined;
}

function resolveCloudflare(): { token: string; accountId: string } | undefined {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) return undefined;
  return { token, accountId };
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

type ProviderName = "anthropic" | "gemini" | "groq" | "openrouter" | "cloudflare";

const DEFAULT_PROVIDER_ORDER: ProviderName[] = ["anthropic", "gemini", "groq", "openrouter", "cloudflare"];

function resolveProviderOrder(): ProviderName[] {
  const raw = process.env.PRAMAAN_LLM_PROVIDERS;
  if (!raw) return DEFAULT_PROVIDER_ORDER;
  const requested = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderName => (DEFAULT_PROVIDER_ORDER as string[]).includes(s));
  if (requested.length === 0) return DEFAULT_PROVIDER_ORDER;
  // Anything configured but not named in PRAMAAN_LLM_PROVIDERS still gets
  // tried, after the explicitly-ordered ones — an unset env var should
  // never silently disable a provider the user has a key for.
  const remainder = DEFAULT_PROVIDER_ORDER.filter((p) => !requested.includes(p));
  return [...requested, ...remainder];
}

function buildProvider(name: ProviderName): LLMClient | undefined {
  switch (name) {
    case "anthropic": {
      const key = resolveAnthropicKey();
      return key ? new AnthropicLLMClient({ apiKey: key }) : undefined;
    }
    case "gemini": {
      const key = resolveGeminiKey();
      return key ? new GeminiLLMClient({ apiKey: key }) : undefined;
    }
    case "groq": {
      const key = resolveGroqKey();
      return key ? new GroqLLMClient({ apiKey: key }) : undefined;
    }
    case "openrouter": {
      const key = resolveOpenRouterKey();
      return key ? new OpenRouterLLMClient({ apiKey: key }) : undefined;
    }
    case "cloudflare": {
      const cf = resolveCloudflare();
      return cf ? new CloudflareLLMClient({ apiKey: cf.token, accountId: cf.accountId }) : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Builds the default `LLMClient` for live mode: tries each configured
 * provider in priority order, wired through nested `createFallbackClient`
 * calls. Order defaults to anthropic, gemini, groq, openrouter, cloudflare
 * — overridable via `PRAMAAN_LLM_PROVIDERS` (comma-separated provider
 * names; any configured provider not named there is still tried, after the
 * named ones). Any subset of keys may be set; unset providers are simply
 * skipped. Safe to call with no keys configured — it returns a client
 * whose calls fail loudly and clearly, rather than throwing at
 * construction time.
 */
export function createDefaultLLMClient(): LLMClient {
  const providers: Array<{ name: string; client: LLMClient }> = [];

  for (const name of resolveProviderOrder()) {
    const client = buildProvider(name);
    if (client) providers.push({ name, client });
  }

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
