/**
 * Deterministic `LLMClient` for tests. Used by this package's own tests and
 * by A6b's agent-loop tests.
 */
import type {
  LLMClient,
  LLMCompleteOptions,
  LLMMessage,
  LLMResponse,
  LLMToolDefinition,
} from "./client.js";

export type MockLLMResponder = (
  messages: LLMMessage[],
  tools: LLMToolDefinition[],
  callIndex: number,
) => LLMResponse;

export type MockLLMJsonResponder = (
  systemPrompt: string,
  userPrompt: string,
  callIndex: number,
) => { raw: string };

export interface MockLLMClientOptions {
  /** A fixed, in-order script of responses for `complete`. Exhausting the
   * script throws (to catch tests that call more times than scripted). */
  responses?: LLMResponse[];
  /** Alternative to `responses`: compute the response from the call. If
   * both are given, `responder` wins. */
  responder?: MockLLMResponder;
  /** Script / function for `completeJson`, independent of `complete`'s. */
  jsonResponses?: Array<{ raw: string }>;
  jsonResponder?: MockLLMJsonResponder;
}

/**
 * Deterministic, network-free `LLMClient` driven by a scripted list of
 * responses (returned in order) or a responder function of
 * `(messages, tools, callIndex) => LLMResponse`.
 */
export class MockLLMClient implements LLMClient {
  private callIndex = 0;
  private jsonCallIndex = 0;
  readonly calls: Array<{ messages: LLMMessage[]; tools: LLMToolDefinition[] }> = [];
  readonly jsonCalls: Array<{ systemPrompt: string; userPrompt: string }> = [];

  constructor(private readonly options: MockLLMClientOptions = {}) {}

  async complete(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    _options?: LLMCompleteOptions,
  ): Promise<LLMResponse> {
    this.calls.push({ messages, tools });
    const index = this.callIndex++;
    if (this.options.responder) {
      return this.options.responder(messages, tools, index);
    }
    const scripted = this.options.responses?.[index];
    if (!scripted) {
      throw new Error(
        `MockLLMClient.complete called ${index + 1} times but only ${this.options.responses?.length ?? 0} responses were scripted.`,
      );
    }
    return scripted;
  }

  async completeJson(
    systemPrompt: string,
    userPrompt: string,
    _options?: LLMCompleteOptions,
  ): Promise<{ raw: string }> {
    this.jsonCalls.push({ systemPrompt, userPrompt });
    const index = this.jsonCallIndex++;
    if (this.options.jsonResponder) {
      return this.options.jsonResponder(systemPrompt, userPrompt, index);
    }
    const scripted = this.options.jsonResponses?.[index];
    if (!scripted) {
      throw new Error(
        `MockLLMClient.completeJson called ${index + 1} times but only ${this.options.jsonResponses?.length ?? 0} responses were scripted.`,
      );
    }
    return scripted;
  }
}
