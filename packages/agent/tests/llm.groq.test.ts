import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroqLLMClient } from "../src/llm/groq.js";
import { LLMTimeoutError, LLMUnavailableError } from "../src/llm/client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GroqLLMClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("maps tools to OpenAI function-calling shape, sends temperature 0, and parses tool_calls", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "chatcmpl_1",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "css__cascade", arguments: JSON.stringify({ fingerprint: "abc" }) },
                },
              ],
            },
          },
        ],
      }),
    );

    const client = new GroqLLMClient({ apiKey: "gsk_test_key" });
    const result = await client.complete(
      [{ role: "user", content: "Investigate." }],
      [{ name: "css.cascade", description: "Cascade trace", inputSchema: { type: "object" } }],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.temperature).toBe(0);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: { name: "css__cascade", description: "Cascade trace", parameters: { type: "object" } },
      },
    ]);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer gsk_test_key" });

    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toEqual([{ id: "call_1", name: "css.cascade", input: { fingerprint: "abc" } }]);
  });

  it("maps a plain stop finish_reason with text content", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "All done." } }],
      }),
    );
    const client = new GroqLLMClient({ apiKey: "gsk_test_key" });
    const result = await client.complete([{ role: "user", content: "hi" }], []);
    expect(result.text).toBe("All done.");
    expect(result.stopReason).toBe("end_turn");
    expect(result.toolCalls).toEqual([]);
  });

  it("throws LLMUnavailableError on 401", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response("invalid api key", { status: 401 }));
    const client = new GroqLLMClient({ apiKey: "gsk_bad_key" });
    await expect(client.complete([{ role: "user", content: "hi" }], [])).rejects.toThrow(LLMUnavailableError);
  });

  it("throws LLMUnavailableError on 500 after exhausting transient-error retries", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response("server error", { status: 503 }));
    const client = new GroqLLMClient({ apiKey: "gsk_test_key" });
    await expect(client.complete([{ role: "user", content: "hi" }], [])).rejects.toThrow(LLMUnavailableError);
    // 3 attempts total: the initial call plus 2 bounded retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 15000);

  it("throws LLMTimeoutError when fetch aborts", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const client = new GroqLLMClient({ apiKey: "gsk_test_key" });
    await expect(
      client.complete([{ role: "user", content: "hi" }], [], { timeoutMs: 10 }),
    ).rejects.toThrow(LLMTimeoutError);
  });

  it("completeJson sends system+user messages and returns raw content", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: '{"likely": false, "rationale": "r", "suggestedText": "s"}' },
          },
        ],
      }),
    );
    const client = new GroqLLMClient({ apiKey: "gsk_test_key" });
    const { raw } = await client.completeJson("system prompt", "user prompt");
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "user prompt" },
    ]);
    expect(JSON.parse(raw)).toEqual({ likely: false, rationale: "r", suggestedText: "s" });
  });

  it("honors a bounded Retry-After delay for 429 without leaking the API key", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "9" } }));
      fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ finish_reason: "stop", message: { content: "ready" } }] }));
      const result = new GroqLLMClient({ apiKey: "gsk_test_key" }).complete([{ role: "user", content: "hi" }], []);
      await vi.advanceTimersByTimeAsync(9249);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await result).text).toBe("ready");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it("rejects malformed completion shapes and classifies a missing model as unavailable", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [] }));
    const client = new GroqLLMClient({ apiKey: "gsk_test_key" });
    await expect(client.complete([{ role: "user", content: "hi" }], [])).rejects.toThrow("malformed completion");
    fetchMock.mockResolvedValueOnce(new Response("model not found", { status: 404 }));
    await expect(client.complete([{ role: "user", content: "hi" }], [])).rejects.toThrow(LLMUnavailableError);
  });
});
