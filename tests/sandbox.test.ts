import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCandidates } from "../server/candidates";
import { verifyCandidate } from "../server/sandbox";

describe("single verification sandbox", () => {
  it("applies the winner and passes the exact regression assertions", async () => {
    const original = readFileSync("fixtures/demo-app/app/api/checkout/route.ts", "utf8");
    const winner = buildCandidates(original, "fixture-base-001")[2];
    const result = await verifyCandidate(winner);
    expect(result.clean).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.assertionCount).toBe(3);
    expect(result.output).toContain("pass 3");
  });
});
