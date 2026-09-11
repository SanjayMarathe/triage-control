import type { PatchCandidate, ProposalWeight } from "../shared/types";

export const SCORE_WEIGHTS = {
  applicability: 20,
  assertionCoverage: 20,
  evidenceProvenance: 20,
  minimality: 15,
  riskControl: 15,
  confidenceCalibration: 10,
} as const;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function scoreCandidate(candidate: PatchCandidate): number {
  const factors = candidate.factors;
  const score =
    clamp01(factors.applicability) * SCORE_WEIGHTS.applicability +
    clamp01(factors.assertionCoverage) * SCORE_WEIGHTS.assertionCoverage +
    clamp01(factors.evidenceProvenance) * SCORE_WEIGHTS.evidenceProvenance +
    clamp01(factors.minimality) * SCORE_WEIGHTS.minimality +
    clamp01(factors.riskControl) * SCORE_WEIGHTS.riskControl +
    clamp01(factors.confidenceCalibration) * SCORE_WEIGHTS.confidenceCalibration;

  return Math.round(score);
}

export function rankCandidates(options: {
  candidates: PatchCandidate[];
  rejected?: Set<string>;
  runKey: string;
  revision: number;
  timestamp?: string;
}): ProposalWeight[] {
  const rejected = options.rejected ?? new Set<string>();
  const timestamp = options.timestamp ?? new Date().toISOString();

  const ranked = options.candidates
    .map((candidate) => {
      const eligible =
        !rejected.has(candidate.candidateId) &&
        candidate.factors.applicability > 0 &&
        candidate.risks.every((risk) => !risk.startsWith("BLOCK:"));

      return {
        candidate,
        eligible,
        score: eligible ? scoreCandidate(candidate) : 0,
      };
    })
    .sort((left, right) => {
      if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
      if (left.score !== right.score) return right.score - left.score;
      if (left.candidate.changedLines !== right.candidate.changedLines) {
        return left.candidate.changedLines - right.candidate.changedLines;
      }
      return left.candidate.candidateId.localeCompare(right.candidate.candidateId);
    });

  const proposedId = ranked.find((item) => item.eligible)?.candidate.candidateId;

  return ranked.map(({ candidate, eligible, score }) => ({
    runKey: options.runKey,
    revision: options.revision,
    agentId: candidate.agentId,
    candidateId: candidate.candidateId,
    eligible,
    score,
    factors: candidate.factors,
    reasonCodes: candidate.reasonCodes,
    proposedNext: candidate.candidateId === proposedId,
    timestamp,
  }));
}
