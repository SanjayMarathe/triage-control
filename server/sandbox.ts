import { execFile } from "node:child_process";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { PatchCandidate, SponsorReceipt } from "../shared/types";
import { sponsorMode } from "./runtime";

const execFileAsync = promisify(execFile);

export interface VerificationResult {
  patchHash: string;
  clean: boolean;
  passed: boolean;
  durationMs: number;
  assertionCount: number;
  output: string;
  snyk: SponsorReceipt;
  replay: SponsorReceipt;
}

function stamp(
  sponsor: SponsorReceipt["sponsor"],
  id: string,
  status: SponsorReceipt["status"],
  detail: string,
): SponsorReceipt {
  return {
    sponsor,
    id,
    status,
    detail,
    mode: sponsorMode(),
    timestamp: new Date().toISOString(),
  };
}

function validateCandidate(candidate: PatchCandidate) {
  if (candidate.filePath.includes("..") || candidate.filePath.startsWith(sep)) {
    throw new Error("Candidate path escapes the sandbox");
  }
  if (candidate.filePath !== "app/api/checkout/route.ts") {
    throw new Error(`Candidate path is not allowlisted: ${candidate.filePath}`);
  }
  if (candidate.testFile !== "test/checkout-large-order.test.js") {
    throw new Error(`Replay test is not allowlisted: ${candidate.testFile}`);
  }
  if (candidate.changedLines > 30 || candidate.unifiedDiff.includes("GIT binary patch")) {
    throw new Error("Candidate exceeds the bounded patch contract");
  }
  if (candidate.patchedText === candidate.originalText) {
    throw new Error("Candidate patch made no change");
  }
}

async function runSnyk(worktree: string, patchHash: string): Promise<SponsorReceipt> {
  if (sponsorMode() === "simulated") {
    return stamp(
      "Snyk",
      `snyk_sim_${patchHash.slice(0, 10)}`,
      "passed",
      "Simulated clean Code scan · demo fixture only",
    );
  }

  const cli = process.env.SNYK_CLI || "snyk";
  const args = ["code", "test", worktree, "--severity-threshold=high", "--json"];
  if (process.env.SNYK_ORG_ID) args.push(`--org=${process.env.SNYK_ORG_ID}`);
  try {
    const result = await execFileAsync(
      cli,
      args,
      { cwd: worktree, timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const parsed = JSON.parse(result.stdout || "{}");
    return stamp(
      "Snyk",
      parsed.scanId || `snyk_${patchHash.slice(0, 10)}`,
      "passed",
      "Snyk Code scan clean · exit 0",
    );
  } catch (error) {
    const exitCode = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
    throw new Error(`Snyk failed closed (exit ${exitCode})`);
  }
}

export async function verifyCandidate(candidate: PatchCandidate): Promise<VerificationResult> {
  validateCandidate(candidate);
  const started = Date.now();
  const worktree = await mkdtemp(resolve(tmpdir(), "triage-control-"));
  const fixture = resolve("fixtures/demo-app");

  try {
    await cp(fixture, worktree, { recursive: true, force: false });
    const target = resolve(worktree, candidate.filePath);
    const current = await readFile(target, "utf8");
    if (current !== candidate.originalText) {
      throw new Error("Base drift detected; candidate was not applied");
    }
    await writeFile(target, candidate.patchedText, "utf8");

    const snyk = await runSnyk(worktree, candidate.patchHash);
    const result = await execFileAsync(
      process.execPath,
      ["--test", candidate.testFile],
      { cwd: worktree, timeout: 20_000, maxBuffer: 1024 * 1024 },
    );
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const assertionCount = candidate.assertions.length;
    const replay = stamp(
      "RocketRide",
      `replay_${candidate.patchHash.slice(0, 10)}`,
      "passed",
      `${assertionCount}/${assertionCount} captured-session assertions passed in isolated sandbox`,
    );

    return {
      patchHash: candidate.patchHash,
      clean: snyk.status === "passed",
      passed: true,
      durationMs: Date.now() - started,
      assertionCount,
      output,
      snyk,
      replay,
    };
  } finally {
    await rm(worktree, { recursive: true, force: true });
  }
}
