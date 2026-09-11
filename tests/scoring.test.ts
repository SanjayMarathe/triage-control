import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCandidates } from "../server/candidates";
import { rankCandidates, scoreCandidate } from "../server/scoring";

describe("deterministic A6 proposal weights", () => {
  const original = readFileSync("fixtures/demo-app/app/api/checkout/route.ts", "utf8");
  const candidates = buildCandidates(original, "fixture-base-001", {
    matched: true,
    hydraSourceId: "hydra_fixture",
    playUri: "fixture-play",
  });

  it("uses the fixed 100-point formula", () => {
    expect(scoreCandidate(candidates[2])).toBe(98);
  });

  it("proposes the verified memory-guided candidate first", () => {
    const weights = rankCandidates({ candidates, runKey: "test", revision: 1 });
    expect(weights.find((weight) => weight.proposedNext)?.agentId).toBe("A3");
    expect(weights).toHaveLength(5);
  });
});
