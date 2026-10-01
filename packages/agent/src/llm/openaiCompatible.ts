/**
 * Shared implementation for OpenAI-compatible Chat Completions providers
 * (Groq, Gemini's OpenAI-compat endpoint, and any future one). Talk to them
 * with a plain `fetch` call rather than adding a new SDK dependency per
 * provider — see KNOWN RISKS in the handoff for the justification.
 *
 * Network-only module: never touches the filesystem.
 */
import type {
  LLMClient,
  LLMCompleteOptions,
  LLMMessage,
  LLMResponse,
  LLMToolCall,
  LLMToolDefinition,
} from "./client.js";
import { LLMTimeoutError, LLMUnavailableError } from "./client.js";
import { toApiToolName, fromApiToolName } from "./toolName.js";

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_TIMEOUT_MS = 30000;

function redactKey(key: string | undefined): string {
  if (!key) return "(missing)";
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** Always a string, never `null` — most providers accept null for an
   * assistant message that only carries tool_calls, but Cloudflare's
   * OpenAI-compat endpoint rejects it outright (confirmed live: "Type
   * mismatch of '/messages/N/content', 'string' not in 'null'"). An empty
   * string is accepted everywhere null would have been. */
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    /** Gemini-specific: carries `google.thought_signature`, which must be
     * echoed back verbatim on the next turn (see LLMToolCall.providerExtra). */
    extra_content?: unknown;
  }>;
}

function toOpenAIMessages(messages: LLMMessage[]): OpenAIChatMessage[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        content: m.content,
        tool_call_id: m.toolCallId ?? "unknown",
        name: m.toolName,
      };
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      // Reconstruct the tool_calls the model actually emitted, so a later
      // role:"tool" message has a matching call id to attach to.
      return {
        role: "assistant",
        content: m.content || "",
        tool_calls: m.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: toApiToolName(call.name), arguments: JSON.stringify(call.input ?? {}) },
          ...(call.providerExtra !== undefined ? { extra_content: call.providerExtra } : {}),
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function toOpenAITools(tools: LLMToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: toApiToolName(t.name),
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

function mapFinishReason(reason: string | null | undefined): LLMResponse["stopReason"] {
  switch (reason) {
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "stop":
      return "end_turn";
    default:
      return "error";
  }
}

export interface OpenAICompatibleClientOptions {
  apiKey: string;
  model?: string;
  /** e.g. "Groq", "Gemini" — used only in error messages. */
  providerLabel: string;
  apiUrl: string;
  defaultModel: string;
}

export class OpenAICompatibleLLMClient implements LLMClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly providerLabel: string;
  private readonly apiUrl: string;

  constructor(options: OpenAICompatibleClientOptions) {
    if (!options.apiKey) {
      throw new LLMUnavailableError(
        `${options.providerLabel} adapter constructed without an API key. This should never happen — the factory must only construct this class when a key is present.`,
      );
    }
    this.apiKey = options.apiKey;
    this.providerLabel = options.providerLabel;
    this.apiUrl = options.apiUrl;
    this.model = options.model ?? process.env.PRAMAAN_MODEL ?? options.defaultModel;
  }

  async complete(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    options?: LLMCompleteOptions,
  ): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOpenAIMessages(messages),
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (tools.length > 0) {
      body.tools = toOpenAITools(tools);
    }
    const json = await this.post(body, options?.timeoutMs);
    return this.toLLMResponse(json);
  }

  async completeJson(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMCompleteOptions,
  ): Promise<{ raw: string }> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    const json = await this.post(body, options?.timeoutMs);
    const raw: string = json?.choices?.[0]?.message?.content ?? "";
    return { raw };
  }

  /** Transient-error retries (429/503) before giving up and letting the
   * fallback chain fail over to the next provider. Free-tier Groq/Gemini
   * both surface short-lived capacity blips regularly enough that failing
   * over immediately (burning the one-shot fallback and then having
   * nothing left) wastes a recoverable request. Bounded and short so it
   * never meaningfully eats into the per-call budget. */
  private static readonly MAX_RETRIES = 2;
  private static readonly RETRY_DELAY_MS = [2000, 5000];

  private async post(body: Record<string, unknown>, timeoutMs?: number, attempt = 0): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: globalThis.Response;
    try {
      response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new LLMTimeoutError(`${this.providerLabel} request timed out (model=${this.model})`);
      }
      throw new LLMUnavailableError(
        `${this.providerLabel} network error (model=${this.model}): ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new LLMUnavailableError(
          `${this.providerLabel} authentication failed (key=${redactKey(this.apiKey)}, status=${response.status}): ${text}`,
        );
      }
      const isTransient = response.status === 429 || response.status >= 500;
      if (isTransient && attempt < OpenAICompatibleLLMClient.MAX_RETRIES) {
        const delayMs = OpenAICompatibleLLMClient.RETRY_DELAY_MS[attempt] ?? 5000;
        console.error(`[pramaan/llm] ${this.providerLabel} transient ${response.status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${OpenAICompatibleLLMClient.MAX_RETRIES})`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.post(body, timeoutMs, attempt + 1);
      }
      if (response.status === 429) {
        throw new LLMUnavailableError(`${this.providerLabel} rate limited (status=429): ${text}`);
      }
      if (response.status >= 500) {
        throw new LLMUnavailableError(`${this.providerLabel} server error (status=${response.status}): ${text}`);
      }
      // Other 4xx are content/request-shape errors, not provider-availability.
      throw new Error(`${this.providerLabel} request failed (status=${response.status}): ${text}`);
    }

    try {
      return await response.json();
    } catch (err) {
      throw new LLMUnavailableError(
        `${this.providerLabel} returned a non-JSON response: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private toLLMResponse(json: any): LLMResponse {
    const choice = json?.choices?.[0];
    const message = choice?.message ?? {};
    const text: string = typeof message.content === "string" ? message.content : "";
    const toolCalls: LLMToolCall[] = [];
    if (Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls) {
        let input: unknown = {};
        try {
          input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          // Leave input as the raw string if it fails to parse — the
          // caller's schema validation (I-?) will reject it with
          // E_BAD_INPUT, which is the correct, caller-owned failure mode.
          input = tc.function?.arguments;
        }
        toolCalls.push({
          id: tc.id,
          name: fromApiToolName(tc.function?.name ?? ""),
          input,
          ...(tc.extra_content !== undefined ? { providerExtra: tc.extra_content } : {}),
        });
      }
    }
    return {
      text,
      toolCalls,
      stopReason: mapFinishReason(choice?.finish_reason),
      raw: json,
    };
  }
}
