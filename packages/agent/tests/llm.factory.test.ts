import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultLLMClient } from "../src/llm/factory.js";
import { LLMUnavailableError } from "../src/llm/client.js";

const ENV_KEYS = ["LLM_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY"] as const;

describe("createDefaultLLMClient", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("construction never throws even with zero keys configured", () => {
    expect(() => createDefaultLLMClient()).not.toThrow();
  });

  it("calling .complete() with zero keys configured throws a clear LLMUnavailableError", async () => {
    const client = createDefaultLLMClient();
    await expect(client.complete([], [])).rejects.toThrow(LLMUnavailableError);
    await expect(client.complete([], [])).rejects.toThrow(/No LLM provider is configured/);
  });

  it("calling .completeJson() with zero keys configured throws a clear LLMUnavailableError", async () => {
    const client = createDefaultLLMClient();
    await expect(client.completeJson("s", "u")).rejects.toThrow(LLMUnavailableError);
  });

  it("construction succeeds with only one key configured", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(() => createDefaultLLMClient()).not.toThrow();
  });
});
