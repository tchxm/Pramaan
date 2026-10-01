import { describe, expect, it } from "vitest";
import path from "node:path";
import { buildProjectModel } from "../src/parser/project.js";
import { loadConfig } from "../src/config.js";
import { runDetectors, runDetectorsWithWarnings } from "../src/detectors/index.js";
import { findConfirmShamingCandidates } from "../src/detectors/confirmShamingCandidate.js";

const FIXTURES_ROOT = path.resolve(__dirname, "..", "..", "..", "fixtures");

// Smoke test only: f07/f08 don't have machine-checkable expected.json
// finding lists in this scope, but detectors must never throw or hang on
// them (adversarial / prompt-injection fixtures, Phase 19 judge-alteration
// concern from the task brief).
describe("detectors do not throw on the remaining fixtures", () => {
  for (const name of ["f07-prompt-injection", "f08-cheat-attempts"]) {
    it(`${name} runs without throwing`, async () => {
      const root = path.join(FIXTURES_ROOT, name);
      const config = await loadConfig(path.join(root, "pramaan.config.json"));
      const model = await buildProjectModel(root, config);
      expect(() => runDetectors({ model, config })).not.toThrow();
      expect(() => runDetectorsWithWarnings({ model, config })).not.toThrow();
      expect(() => findConfirmShamingCandidates(model, config)).not.toThrow();
    });
  }
});
