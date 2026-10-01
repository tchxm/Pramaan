/**
 * Transparent provider failover. The agent loop sees one `LLMClient` and
 * either gets a response or a single, diagnosable `LLMUnavailableError` —
 * it never needs to know two providers exist.
 */
import type {
  LLMClient,
  LLMCompleteOptions,
  LLMMessage,
  LLMResponse,
  LLMToolDefinition,
} from "./client.js";
import { LLMTimeoutError, LLMUnavailableError } from "./client.js";

/**
 * Timeouts DO trigger failover to the secondary provider.
 *
 * Rationale: a timeout against Anthropic (network congestion, an overloaded
 * region, etc.) is indistinguishable in effect from a 5xx — the primary
 * simply isn't answering within budget. Since the whole point of the
 * fallback is demo resilience ("the moment both keys are set, this must
 * work"), treating a timeout as fatal instead of failing over would mean a
 * single slow Anthropic response fails the whole audit even though Groq is
 * sitting there healthy. The budget cost is bounded: `createFallbackClient`
 * never extends the per-call timeout, it just spends it once against each
 * provider in sequence.
 */
function isFailoverEligible(err: unknown): boolean {
  return err instanceof LLMUnavailableError || err instanceof LLMTimeoutError;
}

function describeFailure(providerName: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `${providerName}: ${message}`;
}

class FallbackLLMClient implements LLMClient {
  constructor(
    private readonly primary: LLMClient,
    private readonly primaryName: string,
    private readonly secondary: LLMClient | null,
    private readonly secondaryName: string,
  ) {}

  async complete(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    options?: LLMCompleteOptions,
  ): Promise<LLMResponse> {
    try {
      const result = await this.primary.complete(messages, tools, options);
      console.error(`[pramaan/llm] served by ${this.primaryName}`);
      return result;
    } catch (primaryErr) {
      if (!isFailoverEligible(primaryErr) || !this.secondary) {
        if (!this.secondary) {
          throw new LLMUnavailableError(
            `LLM request failed and no fallback provider is configured. ${describeFailure(this.primaryName, primaryErr)}`,
          );
        }
        throw primaryErr;
      }
      console.error(
        `[pramaan/llm] ${this.primaryName} failed (${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}), falling over to ${this.secondaryName}`,
      );
      try {
        const result = await this.secondary.complete(messages, tools, options);
        console.error(`[pramaan/llm] served by ${this.secondaryName} (after ${this.primaryName} failed)`);
        return result;
      } catch (secondaryErr) {
        throw new LLMUnavailableError(
          `All configured LLM providers failed. ${describeFailure(this.primaryName, primaryErr)} | ${describeFailure(this.secondaryName, secondaryErr)}`,
        );
      }
    }
  }

  async completeJson(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMCompleteOptions,
  ): Promise<{ raw: string }> {
    try {
      const result = await this.primary.completeJson(systemPrompt, userPrompt, options);
      console.error(`[pramaan/llm] completeJson served by ${this.primaryName}`);
      return result;
    } catch (primaryErr) {
      if (!isFailoverEligible(primaryErr) || !this.secondary) {
        if (!this.secondary) {
          throw new LLMUnavailableError(
            `LLM request failed and no fallback provider is configured. ${describeFailure(this.primaryName, primaryErr)}`,
          );
        }
        throw primaryErr;
      }
      console.error(
        `[pramaan/llm] ${this.primaryName} failed (${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}), falling over to ${this.secondaryName}`,
      );
      try {
        const result = await this.secondary.completeJson(systemPrompt, userPrompt, options);
        console.error(`[pramaan/llm] completeJson served by ${this.secondaryName} (after ${this.primaryName} failed)`);
        return result;
      } catch (secondaryErr) {
        throw new LLMUnavailableError(
          `All configured LLM providers failed. ${describeFailure(this.primaryName, primaryErr)} | ${describeFailure(this.secondaryName, secondaryErr)}`,
        );
      }
    }
  }
}

/**
 * Wraps a primary client with transparent failover to a secondary client.
 * If `primary.complete`/`completeJson` throws `LLMUnavailableError` or
 * `LLMTimeoutError`, the same logical request is retried against
 * `secondary` (if provided). If both fail, throws a final
 * `LLMUnavailableError` naming both providers and their failure reasons.
 * Any other error from primary (a content-level error, e.g. a 400) is
 * NOT retried against secondary — it is rethrown as-is, since retrying a
 * malformed request against a different provider would not help and would
 * hide the real bug.
 */
export function createFallbackClient(
  primary: LLMClient,
  secondary: LLMClient | null,
  names?: { primary?: string; secondary?: string },
): LLMClient {
  return new FallbackLLMClient(
    primary,
    names?.primary ?? "primary",
    secondary,
    names?.secondary ?? "secondary",
  );
}
