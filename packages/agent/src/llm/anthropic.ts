/**
 * Anthropic Messages API adapter (spec Section 6, 14.2). Uses the
 * `@anthropic-ai/sdk` dependency already in packages/agent/package.json.
 *
 * Network-only module: never touches the filesystem.
 */
import Anthropic from "@anthropic-ai/sdk";
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

/**
 * Documented-current default model id. Overridable via `PRAMAAN_MODEL`.
 * Picked as the current-generation Sonnet tier at the time this adapter was
 * written (see KNOWN RISKS in the handoff for the agent for how to change
 * this if the model is retired).
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

function redactKey(key: string | undefined): string {
  if (!key) return "(missing)";
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/** Maps our provider-agnostic messages into Anthropic's `system` + `messages` shape.
 * Anthropic has no "tool" role: a prior tool result must be represented as a
 * `user` message containing a `tool_result` content block, and a tool call the
 * assistant made is represented as an `assistant` message containing a
 * `tool_use` content block. We reconstruct that from our flat `LLMMessage[]`. */
function toAnthropicRequest(messages: LLMMessage[]): {
  system: string | undefined;
  anthropicMessages: Anthropic.MessageParam[];
} {
  const systemParts: string[] = [];
  const anthropicMessages: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      // Represent as a user message carrying a tool_result block.
      anthropicMessages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId ?? "unknown",
            content: m.content,
          },
        ],
      });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      // Reconstruct the tool_use blocks the model actually emitted, so a
      // later tool_result has a matching block to attach to (Anthropic
      // rejects an orphaned tool_result otherwise).
      const content: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const call of m.toolCalls) {
        content.push({ type: "tool_use", id: call.id, name: toApiToolName(call.name), input: call.input as Record<string, unknown> });
      }
      anthropicMessages.push({ role: "assistant", content });
      continue;
    }
    anthropicMessages.push({ role: m.role, content: m.content });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    anthropicMessages,
  };
}

function toAnthropicTools(tools: LLMToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: toApiToolName(t.name),
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

function mapStopReason(
  stopReason: Anthropic.Message["stop_reason"],
): LLMResponse["stopReason"] {
  switch (stopReason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    default:
      return "error";
  }
}

function toLLMResponse(message: Anthropic.Message): LLMResponse {
  let text = "";
  const toolCalls: LLMToolCall[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, name: fromApiToolName(block.name), input: block.input });
    }
  }
  return {
    text,
    toolCalls,
    stopReason: mapStopReason(message.stop_reason),
    raw: message,
  };
}

export interface AnthropicClientOptions {
  apiKey: string;
  model?: string;
}

export class AnthropicLLMClient implements LLMClient {
  private readonly client: Anthropic;
  private readonly model: string;

  /** See the matching comment in openaiCompatible.ts — short, bounded
   * retries for transient rate-limit/server errors before burning the
   * fallback chain's one-shot failover on something that would likely have
   * cleared on its own within a few seconds. */
  private static readonly MAX_RETRIES = 2;
  private static readonly RETRY_DELAY_MS = [2000, 5000];

  constructor(options: AnthropicClientOptions) {
    if (!options.apiKey) {
      throw new LLMUnavailableError(
        "Anthropic adapter constructed without an API key. This should never happen — the factory must only construct this class when a key is present.",
      );
    }
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model ?? process.env.PRAMAAN_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  }

  private isTransient(err: unknown): boolean {
    return err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError;
  }

  async complete(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    options?: LLMCompleteOptions,
    attempt = 0,
  ): Promise<LLMResponse> {
    const { system, anthropicMessages } = toAnthropicRequest(messages);
    const anthropicTools = toAnthropicTools(tools);
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const message = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
          system,
          messages: anthropicMessages,
          tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        },
        { signal: controller.signal },
      );
      return toLLMResponse(message);
    } catch (err) {
      if (this.isTransient(err) && attempt < AnthropicLLMClient.MAX_RETRIES) {
        const delayMs = AnthropicLLMClient.RETRY_DELAY_MS[attempt] ?? 5000;
        console.error(`[pramaan/llm] Anthropic transient error, retrying in ${delayMs}ms (attempt ${attempt + 1}/${AnthropicLLMClient.MAX_RETRIES})`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.complete(messages, tools, options, attempt + 1);
      }
      throw this.mapError(err, controller.signal.aborted);
    } finally {
      clearTimeout(timer);
    }
  }

  async completeJson(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMCompleteOptions,
  ): Promise<{ raw: string }> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const message = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        },
        { signal: controller.signal },
      );
      let raw = "";
      for (const block of message.content) {
        if (block.type === "text") raw += block.text;
      }
      return { raw };
    } catch (err) {
      throw this.mapError(err, controller.signal.aborted);
    } finally {
      clearTimeout(timer);
    }
  }

  private mapError(err: unknown, aborted: boolean): Error {
    if (aborted) {
      return new LLMTimeoutError(
        `Anthropic request timed out (model=${this.model})`,
      );
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      return new LLMUnavailableError(
        `Anthropic authentication failed (key=${redactKey(process.env.ANTHROPIC_API_KEY ?? process.env.LLM_API_KEY)}): ${err.message}`,
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      return new LLMUnavailableError(`Anthropic rate limited: ${err.message}`);
    }
    if (err instanceof Anthropic.InternalServerError) {
      return new LLMUnavailableError(`Anthropic server error: ${err.message}`);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return new LLMUnavailableError(`Anthropic network/connection error: ${err.message}`);
    }
    if (err instanceof Anthropic.APIError) {
      // Other 4xx (bad request etc.) are a content-level problem, not a
      // provider-availability problem — surface as-is so it does not
      // trigger a silent failover to Groq that would just repeat the bug.
      return err;
    }
    if (err instanceof Error) return err;
    return new Error(String(err));
  }
}
