import { describe, expect, it } from "vitest";
import { createFallbackClient } from "../src/llm/fallback.js";
import { LLMUnavailableError } from "../src/llm/client.js";
import { MockLLMClient } from "../src/llm/mock.js";
import type { LLMResponse } from "../src/llm/client.js";

const okResponse: LLMResponse = {
  text: "ok",
  toolCalls: [],
  stopReason: "end_turn",
};

describe("createFallbackClient", () => {
  it("falls back from a failing primary to a working secondary", async () => {
    const primary = new MockLLMClient({
      responder: () => {
        throw new LLMUnavailableError("primary down: missing api key");
      },
    });
    const secondary = new MockLLMClient({ responses: [okResponse] });

    const client = createFallbackClient(primary, secondary, { primary: "anthropic", secondary: "groq" });
    const result = await client.complete([], []);

    expect(result).toEqual(okResponse);
    expect(secondary.calls.length).toBe(1);
  });

  it("throws a final LLMUnavailableError naming both providers when both fail", async () => {
    const primary = new MockLLMClient({
      responder: () => {
        throw new LLMUnavailableError("anthropic: invalid api key");
      },
    });
    const secondary = new MockLLMClient({
      responder: () => {
        throw new LLMUnavailableError("groq: rate limited");
      },
    });

    const client = createFallbackClient(primary, secondary, { primary: "anthropic", secondary: "groq" });

    await expect(client.complete([], [])).rejects.toThrow(LLMUnavailableError);
    try {
      await client.complete([], []);
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(LLMUnavailableError);
      const message = (err as Error).message;
      expect(message).toContain("anthropic");
      expect(message).toContain("invalid api key");
      expect(message).toContain("groq");
      expect(message).toContain("rate limited");
    }
  });

  it("throws a diagnosable LLMUnavailableError when only an unconfigured primary exists (no secondary)", async () => {
    const primary = new MockLLMClient({
      responder: () => {
        throw new LLMUnavailableError("anthropic: missing api key");
      },
    });
    const client = createFallbackClient(primary, null, { primary: "anthropic" });

    await expect(client.complete([], [])).rejects.toThrow(LLMUnavailableError);
    await expect(client.complete([], [])).rejects.toThrow(/anthropic/);
  });

  it("does not fail over on a non-availability (content-level) error", async () => {
    class BadOutputError extends Error {}
    const primary = new MockLLMClient({
      responder: () => {
        throw new BadOutputError("model returned malformed JSON");
      },
    });
    const secondary = new MockLLMClient({ responses: [okResponse] });
    const client = createFallbackClient(primary, secondary);

    await expect(client.complete([], [])).rejects.toThrow(BadOutputError);
    expect(secondary.calls.length).toBe(0);
  });

  it("succeeds directly from primary without touching secondary", async () => {
    const primary = new MockLLMClient({ responses: [okResponse] });
    const secondary = new MockLLMClient({
      responder: () => {
        throw new Error("should never be called");
      },
    });
    const client = createFallbackClient(primary, secondary);
    const result = await client.complete([], []);
    expect(result).toEqual(okResponse);
  });

  it("round-trips completeJson through a mocked client and falls back on failure", async () => {
    const primary = new MockLLMClient({
      jsonResponder: () => {
        throw new LLMUnavailableError("primary unavailable");
      },
    });
    const secondary = new MockLLMClient({
      jsonResponses: [{ raw: '{"likely": true, "rationale": "x", "suggestedText": "y"}' }],
    });
    const client = createFallbackClient(primary, secondary);
    const result = await client.completeJson("system", "user");
    expect(JSON.parse(result.raw)).toEqual({ likely: true, rationale: "x", suggestedText: "y" });
  });
});
