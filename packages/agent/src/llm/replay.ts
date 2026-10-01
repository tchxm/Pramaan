/**
 * Replay-mode LLM client (spec 14.10). Drives a recorded sequence of tool
 * calls through the real tool registry and engine, with no network access.
 * Replay results come from the real engine, so verdicts are real — only
 * the "which tool to call next" decision is replayed instead of reasoned
 * about live.
 *
 * Shape note for A6b (who owns `fixtures/**\/replay.json` loading in
 * runAudit.ts): `ReplayStep` below is deliberately minimal — one step per
 * tool call. `ReplayLLMClient` turns each step into one `LLMResponse` with
 * exactly that single tool call and `stopReason: "tool_use"`. Once the
 * script is exhausted, every subsequent `complete()` call returns a final
 * `LLMResponse` with `stopReason: "end_turn"`, empty `text`, and no tool
 * calls — the loop's normal "nothing left to do" signal. If your fixture
 * format carries more per-step data (e.g. expected reasoning text), parse
 * your JSON into this shape before constructing the client; this class
 * does not read files itself (agent package never touches the filesystem
 * directly).
 */
import type {
  LLMClient,
  LLMCompleteOptions,
  LLMMessage,
  LLMResponse,
  LLMToolDefinition,
} from "./client.js";

/** One recorded tool call to drive through the real registry. */
export interface ReplayStep {
  toolName: string;
  input: unknown;
  /** Optional: natural-language text to attach to this turn's LLMResponse
   * (shown in the trace as `agent.reason`). Defaults to "". */
  text?: string;
}

let replayIdCounter = 0;
function nextReplayId(): string {
  replayIdCounter += 1;
  return `replay-${replayIdCounter}`;
}

export class ReplayLLMClient implements LLMClient {
  private cursor = 0;

  constructor(private readonly steps: ReplayStep[]) {}

  async complete(
    _messages: LLMMessage[],
    _tools: LLMToolDefinition[],
    _options?: LLMCompleteOptions,
  ): Promise<LLMResponse> {
    if (this.cursor >= this.steps.length) {
      return {
        text: "",
        toolCalls: [],
        stopReason: "end_turn",
        raw: { replay: "exhausted" },
      };
    }
    const step = this.steps[this.cursor];
    this.cursor += 1;
    if (!step) {
      return { text: "", toolCalls: [], stopReason: "end_turn", raw: { replay: "exhausted" } };
    }
    return {
      text: step.text ?? "",
      toolCalls: [{ id: nextReplayId(), name: step.toolName, input: step.input }],
      stopReason: "tool_use",
      raw: { replay: step },
    };
  }

  /**
   * Replay mode has no meaningful semantic sub-call script in this minimal
   * shape (semantic.inspect results should be recorded as a regular
   * ReplayStep calling the semantic.inspect tool, not via this method).
   * Included only so `ReplayLLMClient` satisfies `LLMClient`; callers that
   * reach this in replay mode are calling it directly rather than through
   * the tool registry, which replay mode does not support.
   */
  async completeJson(
    _systemPrompt: string,
    _userPrompt: string,
    _options?: LLMCompleteOptions,
  ): Promise<{ raw: string }> {
    throw new Error(
      "ReplayLLMClient.completeJson is not supported — semantic.inspect results must be recorded as a ReplayStep through the tool registry in replay mode.",
    );
  }
}
