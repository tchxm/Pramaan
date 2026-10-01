import type { LLMClient, LLMMessage, LLMResponse } from "./client.js";

/** Presentation scenario, not a live model. Every selected tool still runs
 * through the actual registry, policy engine, verification and evidence. */
export class MittiMartDemoClient implements LLMClient {
  private turn = 0;
  private findings = new Map<string, { findingId: string; fingerprint: string }>();
  constructor(private readonly paceMs = 400) {}

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    if (this.turn === 0) {
      const input = JSON.parse(messages.find(m => m.role === "user")?.content ?? "{}");
      for (const finding of input.findings ?? []) this.findings.set(finding.ruleId, finding);
      if (!["PRM-001", "PRM-002", "PRM-003", "PRM-004"].every(id => this.findings.has(id))) {
        throw Error("The scripted Mitti Mart demo requires the four expected engine findings.");
      }
    }
    if (this.paceMs) await new Promise(resolve => setTimeout(resolve, this.paceMs));
    const id = (rule: string) => this.findings.get(rule)!.findingId;
    const proposalId = (findingId: string) => {
      const message = [...messages].reverse().find(m => m.role === "tool" && m.toolName === "patch.propose");
      const result = JSON.parse(message?.content ?? "{}");
      if (!result.ok || result.data?.findingId !== findingId || !result.data?.proposalId) {
        throw Error("The engine did not return the expected demo proposal; stopping safely.");
      }
      return result.data.proposalId;
    };
    const call = (name: string, input: unknown, text: string): LLMResponse => ({
      text, toolCalls: [{ id: `mitti-demo-${this.turn++}`, name, input }], stopReason: "tool_use",
      raw: { scriptedDemo: "mixed-outcomes" },
    });
    switch (this.turn) {
      case 0: return call("css.cascade", { fingerprint: this.findings.get("PRM-003")!.fingerprint }, "Scripted demo: investigate unequal choices. This branch will have no fix proposal.");
      case 1: return call("finding.escalate", { findingId: id("PRM-003"), summary: "Demo review branch: unequal choices need human design review. No fix proposal generated; no verification claimed." }, "Stop unequal choices after investigation and record the review reason.");
      case 2: return call("price_flow.inspect", {}, "Investigate where the handling fee first appears. This branch will have no fix proposal.");
      case 3: return call("finding.escalate", { findingId: id("PRM-004"), summary: "Demo review branch: fee disclosure placement is left for human review. No fix proposal generated; no verification claimed." }, "Stop late fee disclosure after investigation and record the review reason.");
      case 4: return call("patch.propose", { findingId: id("PRM-002"), strategy: "timer.remove_display" }, "Generate a real bounded proposal for the false countdown. This demo branch stops at proposal.");
      case 5:
        proposalId(id("PRM-002"));
        return call("finding.escalate", { findingId: id("PRM-002"), summary: "Demo midpoint: a timer-removal proposal was generated, but intentionally not applied. Build and verification gates were not run for this finding." }, "Keep the countdown proposal for review. Do not apply it or claim a verified fix.");
      case 6: return call("patch.propose", { findingId: id("PRM-001"), strategy: "checkbox.default_off" }, "Take preselected protection through the complete path. Ask the engine to generate the smallest patch.");
      case 7: return call("patch.apply", { proposalId: proposalId(id("PRM-001")) }, "Apply the engine-generated checkbox patch to the isolated workspace after policy checks.");
      case 8: return call("detector.verify", { findingId: id("PRM-001") }, "Run the real detector, preservation, build, browser, and regression gates. Only the engine can return a verdict.");
      default: return call("finding.escalate", { findingId: id("PRM-001"), summary: "The complete demo path could not pass the actual engine checks. Review the gate failures; no successful verdict is fabricated." }, "The actual check did not finish successfully; record that outcome for review.");
    }
  }
  async completeJson(): Promise<{ raw: string }> {
    throw Error("Semantic model calls are not part of this scripted demo.");
  }
}
