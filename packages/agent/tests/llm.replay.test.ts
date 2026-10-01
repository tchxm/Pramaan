import { describe, expect, it } from "vitest";
import { ReplayLLMClient } from "../src/llm/replay.js";

describe("ReplayLLMClient", () => {
  it("plays back a scripted sequence of tool calls in order, then ends cleanly", async () => {
    const client = new ReplayLLMClient([
      { toolName: "detector.scan", input: {} },
      { toolName: "css.cascade", input: { fingerprint: "abc" }, text: "inspecting cascade" },
    ]);

    const first = await client.complete([], []);
    expect(first.stopReason).toBe("tool_use");
    expect(first.toolCalls).toHaveLength(1);
    expect(first.toolCalls[0].name).toBe("detector.scan");
    expect(first.toolCalls[0].input).toEqual({});

    const second = await client.complete([], []);
    expect(second.stopReason).toBe("tool_use");
    expect(second.toolCalls[0].name).toBe("css.cascade");
    expect(second.toolCalls[0].input).toEqual({ fingerprint: "abc" });
    expect(second.text).toBe("inspecting cascade");

    const third = await client.complete([], []);
    expect(third.stopReason).toBe("end_turn");
    expect(third.toolCalls).toEqual([]);

    // Further calls keep returning the same clean "done" response.
    const fourth = await client.complete([], []);
    expect(fourth.stopReason).toBe("end_turn");
    expect(fourth.toolCalls).toEqual([]);
  });

  it("assigns unique ids to each replayed tool call", async () => {
    const client = new ReplayLLMClient([
      { toolName: "a", input: 1 },
      { toolName: "b", input: 2 },
    ]);
    const r1 = await client.complete([], []);
    const r2 = await client.complete([], []);
    expect(r1.toolCalls[0].id).not.toBe(r2.toolCalls[0].id);
  });

  it("handles an empty script by ending immediately", async () => {
    const client = new ReplayLLMClient([]);
    const result = await client.complete([], []);
    expect(result.stopReason).toBe("end_turn");
    expect(result.toolCalls).toEqual([]);
  });

  it("completeJson is explicitly unsupported in replay mode", async () => {
    const client = new ReplayLLMClient([]);
    await expect(client.completeJson("sys", "user")).rejects.toThrow();
  });
});
