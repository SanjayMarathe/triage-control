import { createHash } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import type { CandidateFactors, PatchCandidate } from "../shared/types";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const targetPath = "app/api/checkout/route.ts";

interface CandidateSeed {
  agentId: PatchCandidate["agentId"];
  title: string;
  rootCause: string;
  patchedText: string;
  changedLines: number;
  assertions: string[];
  risks: string[];
  factors: CandidateFactors;
  reasonCodes: string[];
  memory?: PatchCandidate["memory"];
}

export interface CandidateMemoryEvidence {
  matched: boolean;
  hydraSourceId?: string;
  playUri?: string;
}

export function buildCandidates(
  originalText: string,
  baseSha: string,
  memoryEvidence: CandidateMemoryEvidence = { matched: false },
): PatchCandidate[] {
  const unsafeUse = `    const receipt = getReceipt(total);\n    confirmation = { code: receipt.code };`;
  const receiptFunction = `function getReceipt(total: number) {\n  const receipts: Record<string, { code: string }> = {};\n  return receipts[total];\n}`;
  const assertions = [
    "large order returns 200 with a confirmation code",
    "ordinary order behavior remains successful",
    "invalid email still returns 400",
  ];
  const seeds: CandidateSeed[] = [
    {
      agentId: "A1",
      title: "Fall back when receipt lookup misses",
      rootCause: "The large-order path dereferences receipt.code even when the receipt lookup returns undefined.",
      patchedText: originalText.replace(
        unsafeUse,
        `    const receipt = getReceipt(total);\n    confirmation = { code: receipt?.code ?? \`ORD-\${Date.now()}\` };`,
      ),
      changedLines: 1,
      assertions,
      risks: ["The fallback bypasses the external receipt path when no receipt exists"],
      factors: {
        applicability: 1,
        assertionCoverage: 0.9,
        evidenceProvenance: 0.58,
        minimality: 1,
        riskControl: 0.86,
        confidenceCalibration: 0.8,
      },
      reasonCodes: ["MINIMAL_DIFF", "TRACE_MATCH", "FALLBACK_PRESERVES_RESPONSE"],
    },
    {
      agentId: "A2",
      title: "Normalize receipt service output",
      rootCause: "The receipt boundary has an optional return shape while its only caller assumes a receipt is always present.",
      patchedText: originalText.replace(
        receiptFunction,
        `function getReceipt(total: number) {\n  const receipts: Record<string, { code: string }> = {};\n  return receipts[total] ?? { code: \`ORD-\${Date.now()}\` };\n}`,
      ),
      changedLines: 1,
      assertions,
      risks: ["Boundary fallback behavior applies to every future getReceipt caller"],
      factors: {
        applicability: 1,
        assertionCoverage: 0.9,
        evidenceProvenance: 0.64,
        minimality: 0.94,
        riskControl: 0.9,
        confidenceCalibration: 0.84,
      },
      reasonCodes: ["BOUNDARY_NORMALIZATION", "CALLER_CONTRACT", "LOCAL_CHANGE"],
    },
    {
      agentId: "A3",
      title: memoryEvidence.matched
        ? "Replay the verified missing-receipt Play"
        : "Apply the missing-result remediation pattern",
      rootCause: memoryEvidence.matched
        ? "This matches the prior verified shape: an optional service result is dereferenced on a conditional checkout path."
        : "No verified prior incident matched; the trace still indicates an optional service result was dereferenced on the checkout path.",
      patchedText: originalText.replace(
        unsafeUse,
        `    const receipt = getReceipt(total) ?? { code: \`ORD-\${Date.now()}\` };\n    confirmation = { code: receipt.code };`,
      ),
      changedLines: 1,
      assertions,
      risks: [memoryEvidence.matched
        ? "The pinned Play still requires current Snyk and exact-session replay gates"
        : "No verified Hydra memory matched; treat this as a fresh hypothesis and require both gates"],
      factors: {
        applicability: 1,
        assertionCoverage: 0.96,
        evidenceProvenance: memoryEvidence.matched ? 1 : 0.35,
        minimality: 1,
        riskControl: 0.96,
        confidenceCalibration: memoryEvidence.matched ? 0.9 : 0.74,
      },
      reasonCodes: memoryEvidence.matched
        ? ["VERIFIED_PLAY", "HYDRA_EXACT_SHAPE", "CAPTURED_ASSERTION", "SMALLEST_DIFF"]
        : ["NO_VERIFIED_MEMORY", "TRACE_HYPOTHESIS", "CAPTURED_ASSERTION", "SMALLEST_DIFF"],
      memory: memoryEvidence.matched ? {
        hydraSourceId: memoryEvidence.hydraSourceId,
        playUri: memoryEvidence.playUri,
      } : undefined,
    },
    {
      agentId: "A4",
      title: "Guard the missing receipt explicitly",
      rootCause: "There is no regression contract or control-flow guard for a receipt-service miss on orders over $500.",
      patchedText: originalText.replace(
        unsafeUse,
        `    const receipt = getReceipt(total);\n    if (receipt) {\n      confirmation = { code: receipt.code };\n    } else {\n      confirmation = { code: \`ORD-\${Date.now()}\` };\n    }`,
      ),
      changedLines: 6,
      assertions,
      risks: ["More control-flow lines than the equivalent nullish fallback"],
      factors: {
        applicability: 1,
        assertionCoverage: 1,
        evidenceProvenance: 0.72,
        minimality: 0.74,
        riskControl: 0.94,
        confidenceCalibration: 0.86,
      },
      reasonCodes: ["TEST_FIRST", "EXACT_REPLAY", "EXPLICIT_BRANCH"],
    },
    {
      agentId: "A5",
      title: "Make the receipt contract total",
      rootCause: "Type inference exposes an optional receipt, but the function contract does not prevent callers from receiving undefined.",
      patchedText: originalText.replace(
        receiptFunction,
        `function getReceipt(total: number): { code: string } {\n  const receipts: Record<string, { code: string }> = {};\n  return receipts[total] ?? { code: \`ORD-\${Date.now()}\` };\n}`,
      ),
      changedLines: 2,
      assertions,
      risks: ["The non-optional contract commits the service boundary to a local fallback"],
      factors: {
        applicability: 1,
        assertionCoverage: 0.94,
        evidenceProvenance: 0.62,
        minimality: 0.86,
        riskControl: 0.98,
        confidenceCalibration: 0.84,
      },
      reasonCodes: ["TYPE_CONTRACT", "INVALID_STATE_BLOCKED", "LOCAL_CHANGE"],
    },
  ];

  return seeds.map((seed, index) => {
    if (seed.patchedText === originalText) {
      throw new Error(`Candidate ${seed.agentId} did not apply to ${targetPath}; repository base may have drifted`);
    }
    const unifiedDiff = createTwoFilesPatch(
      targetPath,
      targetPath,
      originalText,
      seed.patchedText,
      baseSha,
      `${seed.agentId}-candidate`,
      { context: 3 },
    );

    return {
      ...seed,
      candidateId: `cand_${String(index + 1).padStart(2, "0")}`,
      baseSha,
      filePath: targetPath,
      testFile: "test/checkout-large-order.test.js",
      originalText,
      unifiedDiff,
      patchHash: hash(unifiedDiff),
    };
  });
}
