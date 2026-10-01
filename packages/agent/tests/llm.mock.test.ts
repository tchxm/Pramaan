import { describe, expect, it } from "vitest";
import { MockLLMClient } from "../src/llm/mock.js";
import type { LLMResponse } from "../src/llm/client.js";

describe("MockLLMClient", () => {
  it("returns scripted responses in order", async () => {
    const r1: LLMResponse = { text: "a", toolCalls: [], stopReason: "end_turn" };
    const r2: LLMResponse = { text: "b", toolCalls: [], stopReason: "end_turn" };
    const client = new MockLLMClient({ responses: [r1, r2] });

    expect(await client.complete([], [])).toEqual(r1);
    expect(await client.complete([], [])).toEqual(r2);
    await expect(client.complete([], [])).rejects.toThrow();
  });

  it("supports a responder function keyed by call index", async () => {
    const client = new MockLLMClient({
      responder: (_messages, _tools, callIndex) => ({
        text: `call-${callIndex}`,
        toolCalls: [],
        stopReason: "end_turn",
      }),
    });
    expect((await client.complete([], [])).text).toBe("call-0");
    expect((await client.complete([], [])).text).toBe("call-1");
  });

  it("round-trips completeJson through a scripted mock", async () => {
    const payload = { likely: false, rationale: "neutral wording", suggestedText: "Continue" };
    const client = new MockLLMClient({ jsonResponses: [{ raw: JSON.stringify(payload) }] });
    const { raw } = await client.completeJson("system prompt", "user prompt");
    expect(JSON.parse(raw)).toEqual(payload);
  });

  it("records calls for assertions", async () => {
    const client = new MockLLMClient({ responses: [{ text: "", toolCalls: [], stopReason: "end_turn" }] });
    await client.complete([{ role: "user", content: "hi" }], [{ name: "t", description: "d", inputSchema: {} }]);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].messages[0].content).toBe("hi");
    expect(client.calls[0].tools[0].name).toBe("t");
  });
});
