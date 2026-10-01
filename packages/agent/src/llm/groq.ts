/**
 * Groq adapter (fallback provider). Groq exposes an OpenAI-compatible Chat
 * Completions API with function-calling. We talk to it with a plain
 * `fetch` call rather than adding a new SDK dependency — see KNOWN RISKS
 * in the handoff for the justification.
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

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Documented-current default Groq model with tool-calling support.
 * Llama 3.3 70B Versatile is Groq's well-known tool-calling-capable model.
 * Override with `PRAMAAN_MODEL` if the user wants a different Groq model id.
 */
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

function redactKey(key: string | undefined): string {
  if (!key) return "(missing)";
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
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
    return { role: m.role, content: m.content };
  });
}

function toOpenAITools(tools: LLMToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
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

export interface GroqClientOptions {
  apiKey: string;
  model?: string;
}

export class GroqLLMClient implements LLMClient {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: GroqClientOptions) {
    if (!options.apiKey) {
      throw new LLMUnavailableError(
        "Groq adapter constructed without an API key. This should never happen — the factory must only construct this class when a key is present.",
      );
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? process.env.PRAMAAN_MODEL ?? DEFAULT_GROQ_MODEL;
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

  private async post(body: Record<string, unknown>, timeoutMs?: number): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: globalThis.Response;
    try {
      response = await fetch(GROQ_API_URL, {
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
        throw new LLMTimeoutError(`Groq request timed out (model=${this.model})`);
      }
      throw new LLMUnavailableError(
        `Groq network error (model=${this.model}): ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new LLMUnavailableError(
          `Groq authentication failed (key=${redactKey(this.apiKey)}, status=${response.status}): ${text}`,
        );
      }
      if (response.status === 429) {
        throw new LLMUnavailableError(`Groq rate limited (status=429): ${text}`);
      }
      if (response.status >= 500) {
        throw new LLMUnavailableError(`Groq server error (status=${response.status}): ${text}`);
      }
      // Other 4xx are content/request-shape errors, not provider-availability.
      throw new Error(`Groq request failed (status=${response.status}): ${text}`);
    }

    try {
      return await response.json();
    } catch (err) {
      throw new LLMUnavailableError(
        `Groq returned a non-JSON response: ${err instanceof Error ? err.message : String(err)}`,
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
        toolCalls.push({ id: tc.id, name: tc.function?.name, input });
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
