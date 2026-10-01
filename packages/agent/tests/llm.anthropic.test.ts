import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
  const RealAnthropic = actual.default;

  class FakeAnthropic {
    apiKey: string;
    messages = { create: createMock };
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
    }
  }
  // Preserve the real error classes as static members so `instanceof`
  // checks in anthropic.ts (Anthropic.AuthenticationError, etc.) still work.
  for (const key of Object.getOwnPropertyNames(RealAnthropic)) {
    if (typeof (RealAnthropic as any)[key] === "function" && key !== "length" && key !== "name" && key !== "prototype") {
      (FakeAnthropic as any)[key] = (RealAnthropic as any)[key];
    }
  }

  return { ...actual, default: FakeAnthropic };
});

// Imported AFTER vi.mock so the mocked module is used.
const { AnthropicLLMClient } = await import("../src/llm/anthropic.js");
const { LLMTimeoutError, LLMUnavailableError } = await import("../src/llm/client.js");
const Anthropic = (await import("@anthropic-ai/sdk")).default as any;

describe("AnthropicLLMClient", () => {
  beforeEach(() => {
    createMock.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps tools, sends temperature 0 by default, and uses the model from options/env", async () => {
    createMock.mockResolvedValue({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "tool_use",
      stop_sequence: null,
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "tool_1", name: "css.cascade", input: { fingerprint: "abc" } },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const client = new AnthropicLLMClient({ apiKey: "sk-ant-test-key" });
    const result = await client.complete(
      [
        { role: "system", content: "You are the agent." },
        { role: "user", content: "Investigate finding PRM-001." },
      ],
      [{ name: "css.cascade", description: "Cascade trace", inputSchema: { type: "object" } }],
    );

    expect(createMock).toHaveBeenCalledTimes(1);
    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.temperature).toBe(0);
    expect(callArgs.system).toBe("You are the agent.");
    expect(callArgs.tools).toEqual([
      { name: "css.cascade", description: "Cascade trace", input_schema: { type: "object" } },
    ]);
    expect(callArgs.messages).toEqual([{ role: "user", content: "Investigate finding PRM-001." }]);

    expect(result.text).toBe("Let me check.");
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toEqual([{ id: "tool_1", name: "css.cascade", input: { fingerprint: "abc" } }]);
  });

  it("maps a plain end_turn response with no tool calls", async () => {
    createMock.mockResolvedValue({
      id: "msg_2",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      stop_sequence: null,
      content: [{ type: "text", text: "Done." }],
      usage: { input_tokens: 3, output_tokens: 2 },
    });
    const client = new AnthropicLLMClient({ apiKey: "sk-ant-test-key" });
    const result = await client.complete([{ role: "user", content: "hi" }], []);
    expect(result.toolCalls).toEqual([]);
    expect(result.stopReason).toBe("end_turn");
    expect(result.text).toBe("Done.");
  });

  it("throws LLMUnavailableError on authentication failure", async () => {
    const Errors = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
    createMock.mockRejectedValue(new Errors.AuthenticationError(401, { message: "invalid x-api-key" }, "invalid x-api-key", new Headers()));

    const client = new AnthropicLLMClient({ apiKey: "sk-ant-bad-key" });
    await expect(client.complete([{ role: "user", content: "hi" }], [])).rejects.toThrow(LLMUnavailableError);
  });

  it("throws LLMTimeoutError when the request aborts via the timeout", async () => {
    createMock.mockImplementation((_body: unknown, opts: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const client = new AnthropicLLMClient({ apiKey: "sk-ant-test-key" });
    await expect(
      client.complete([{ role: "user", content: "hi" }], [], { timeoutMs: 10 }),
    ).rejects.toThrow(LLMTimeoutError);
  });

  it("completeJson sends no tools and returns the raw text", async () => {
    createMock.mockResolvedValue({
      id: "msg_3",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      stop_sequence: null,
      content: [{ type: "text", text: '{"likely": true, "rationale": "r", "suggestedText": "s"}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const client = new AnthropicLLMClient({ apiKey: "sk-ant-test-key" });
    const { raw } = await client.completeJson("system", "user prompt");
    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.tools).toBeUndefined();
    expect(JSON.parse(raw)).toEqual({ likely: true, rationale: "r", suggestedText: "s" });
  });

  it("uses PRAMAAN_MODEL env var when no explicit model option is given", async () => {
    const prev = process.env.PRAMAAN_MODEL;
    process.env.PRAMAAN_MODEL = "claude-test-model";
    try {
      createMock.mockResolvedValue({
        id: "msg_4",
        type: "message",
        role: "assistant",
        model: "claude-test-model",
        stop_reason: "end_turn",
        stop_sequence: null,
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
      const client = new AnthropicLLMClient({ apiKey: "sk-ant-test-key" });
      await client.complete([{ role: "user", content: "hi" }], []);
      const callArgs = createMock.mock.calls[0][0];
      expect(callArgs.model).toBe("claude-test-model");
    } finally {
      if (prev === undefined) delete process.env.PRAMAAN_MODEL;
      else process.env.PRAMAAN_MODEL = prev;
    }
  });
});
