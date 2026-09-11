import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { HydraDBClient } from "@hydradb/sdk";
import type { AgentRun, PatchCandidate, SponsorReceipt, TelemetryEvent } from "../shared/types";
import { recallCapturedMemory } from "./capture-memory";
import { publishHotdataBatch } from "./hotdata";
import { sponsorMode, sponsorsAreLive } from "./runtime";

const execFileAsync = promisify(execFile);
function receipt(
  sponsor: SponsorReceipt["sponsor"],
  id: string,
  detail: string,
  status: SponsorReceipt["status"] = "passed",
): SponsorReceipt {
  return { sponsor, id, detail, status, mode: sponsorMode(), timestamp: new Date().toISOString() };
}

async function jsonFetch(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${body.slice(0, 240)}`);
  return body ? JSON.parse(body) : {};
}

function hydraClient() {
  const token = process.env.HYDRA_API_KEY;
  if (!token) throw new Error("HYDRA_API_KEY is required in live mode");
  return new HydraDBClient({
    token,
    baseUrl: process.env.HYDRA_API_URL || "https://api.hydradb.com",
    apiVersion: "2",
    timeoutInSeconds: 30,
    maxRetries: 1,
  });
}

function hydraDatabase() {
  return process.env.HYDRA_DATABASE || "default-tenant";
}

export interface HydraRecallResult {
  receipt: SponsorReceipt;
  matchedVerifiedIncident: boolean;
  sourceId?: string;
  snippets: string[];
  observedSessionChunks: number;
}

export async function loadGitHubSource(filePath: string): Promise<{ text: string; baseSha: string }> {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const base = process.env.GITHUB_BASE_BRANCH || "main";
  const expectedSha = process.env.GITHUB_BASE_SHA;
  if (!token || !owner || !repo || !expectedSha) throw new Error("GitHub source configuration is incomplete");
  if (filePath.includes("..") || filePath.startsWith("/")) throw new Error("GitHub source path is not repository-relative");

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const root = `https://api.github.com/repos/${owner}/${repo}`;
  const baseRef = await jsonFetch(`${root}/git/ref/heads/${encodeURIComponent(base)}`, { headers });
  if (baseRef.object?.sha !== expectedSha) {
    throw new Error("Configured GitHub base SHA is stale; refresh the snapshot before generating patches");
  }
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const source = await jsonFetch(`${root}/contents/${encodedPath}?ref=${encodeURIComponent(expectedSha)}`, { headers });
  if (source.type !== "file" || source.encoding !== "base64" || typeof source.content !== "string") {
    throw new Error(`GitHub source is not a base64 file: ${filePath}`);
  }
  return { text: Buffer.from(source.content.replaceAll("\n", ""), "base64").toString("utf8"), baseSha: expectedSha };
}

export async function recallHydra(incidentId: string, sessionId: string, errorShape: string): Promise<HydraRecallResult> {
  if (!sponsorsAreLive()) {
    return {
      receipt: receipt("HydraDB", `hydra_recall_${incidentId}`, `exact match for ${errorShape} · verified + Snyk-clean`),
      matchedVerifiedIncident: true,
      sourceId: "hydra_src_prior_missing_receipt",
      snippets: ["Verified missing-service-result remediation memory"],
      observedSessionChunks: 3,
    };
  }
  const client = hydraClient();
  const database = hydraDatabase();
  const resolvedCollection = process.env.HYDRA_RESOLVED_COLLECTION || "resolved-incidents";
  const query = `${errorShape.replaceAll("_", " ")} checkout error user action root cause fix`;
  const exact = await client.query({
    query,
    database,
    collection: resolvedCollection,
    type: "memory",
    queryBy: "text",
    operator: "and",
    maxResults: 5,
    graphContext: true,
    metadataFilters: { additional_metadata: { schema_version: 1, verified: true, snyk_clean: true } },
  });
  let result = exact;
  let chunks = result.data?.chunks || [];
  if (chunks.length === 0) {
    result = await client.query({
      query,
      database,
      collection: resolvedCollection,
      type: "memory",
      queryBy: "hybrid",
      mode: "fast",
      maxResults: 5,
      graphContext: true,
      metadataFilters: { additional_metadata: { schema_version: 1, verified: true, snyk_clean: true } },
    });
    chunks = result.data?.chunks || [];
  }

  const observed = await recallCapturedMemory(sessionId, query);
  const observedChunks = observed.chunks || [];
  const sourceId = chunks[0]?.id || result.data?.sources?.[0]?.id;
  const snippets = [
    ...chunks.map((chunk) => chunk.chunkContent),
    ...observedChunks.map((chunk) => JSON.stringify(chunk.entity || {})),
  ]
    .map((value) => value?.slice(0, 500))
    .filter((value): value is string => Boolean(value));
  const requestId = result.meta?.requestId || `hydra_recall_${incidentId}`;
  const detail = chunks.length > 0
    ? `${chunks.length} verified incident memories matched; ${observedChunks.length} current-session chunks loaded`
    : `no verified prior incident; ${observedChunks.length} current-session chunks loaded for scratch diagnosis`;
  return {
    receipt: receipt("HydraDB", sourceId || requestId, detail),
    matchedVerifiedIncident: chunks.length > 0,
    sourceId,
    snippets,
    observedSessionChunks: observedChunks.length,
  };
}

export async function runRotePlay(incidentId: string): Promise<SponsorReceipt> {
  const playUri = process.env.ROTE_PLAY_URI;
  if (!sponsorsAreLive()) return receipt("Rote", `rote_run_${incidentId}`, `adapted pinned Play ${playUri || "test/triage-remediation@1"}`);
  if (!playUri) throw new Error("ROTE_PLAY_URI is required and must name a released local or registry Play");
  const cli = process.env.ROTE_CLI || "rote";
  const localPath = playUri.endsWith(".ts") || playUri.startsWith(".") || playUri.startsWith("/");
  const localName = !localPath && !playUri.startsWith("https://") && !playUri.includes("/");
  const args = localPath
    ? ["play", "info", basename(dirname(resolve(playUri))), "--json", "-d", dirname(resolve(playUri))]
    : localName
      ? ["play", "info", playUri, "--json"]
      : ["play", "inspect", playUri, "--json"];
  const { stdout } = await execFileAsync(cli, args, {
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  const parsed = JSON.parse(stdout || "{}");
  if (String(parsed.status || "").toLowerCase() !== "released") {
    throw new Error(`Rote Play is not released: ${playUri}`);
  }
  return receipt("Rote", parsed.id || parsed.name || `rote_run_${incidentId}`, `validated released Play ${playUri}`);
}

export async function crystallizeRote(run: AgentRun): Promise<SponsorReceipt> {
  const playUri = process.env.ROTE_PLAY_URI;
  if (!sponsorsAreLive()) return receipt("Rote", `rote_play_${run.incidentId}_v2`, `successful method crystallized as ${playUri || "test/triage-remediation@1"}`);
  if (!playUri) throw new Error("ROTE_PLAY_URI is required and must name a real released Play");
  if (!run.winner?.patchHash || run.gate.snykStatus !== "clean" || run.gate.replayStatus !== "passed") {
    throw new Error("Rote Play requires an exact patch hash plus clean Snyk and passed replay receipts");
  }
  const cli = process.env.ROTE_CLI || "rote";
  const { stdout } = await execFileAsync(cli, [
    "play",
    "run",
    playUri,
    `incident_id=${run.incidentId}`,
    `error_shape=${run.errorShape}`,
    `patch_hash=${run.winner.patchHash}`,
    "snyk_status=clean",
    "replay_status=passed",
    "--output=json",
  ], {
    timeout: 45_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout || "{}");
  if (parsed.safe_to_surface !== true || parsed.patch_hash !== run.winner.patchHash) {
    throw new Error("Rote Play did not return matching safe-to-surface evidence");
  }
  return receipt("Rote", parsed.run_id || `rote_play_${run.incidentId}`, `released Play verified ${parsed.patch_hash.slice(0, 12)}`);
}

export async function enrichCognee(run: AgentRun): Promise<SponsorReceipt> {
  if (!sponsorsAreLive()) return receipt("Cognee", `cognee_${run.incidentId}`, "phase B added RootCause · Fix · Play · PullRequest");
  const api = process.env.COGNEE_API_URL?.replace(/\/$/, "");
  const apiKey = process.env.COGNEE_API_KEY;
  const tenantId = process.env.COGNEE_TENANT_ID;
  if (api) {
    if (!apiKey || !tenantId) throw new Error("Cognee hosted API requires COGNEE_API_KEY and COGNEE_TENANT_ID");
    const dataset = "triage-control-resolved";
    const headers = { "X-Api-Key": apiKey, "X-Tenant-Id": tenantId, "Content-Type": "application/json" };
    const canonical = {
      schemaVersion: 1,
      siteKey: run.siteKey,
      incidentId: run.incidentId,
      rootCause: run.candidates.find((candidate) => candidate.candidateId === run.winner?.candidateId)?.rootCause,
      fix: run.winner,
      verification: run.gate,
      pullRequest: run.gate.pullRequest,
      relationships: ["ERROR CAUSED_BY ROOT_CAUSE", "ROOT_CAUSE FIXED_BY FIX", "FIX VERIFIED_BY REPLAY", "FIX PROPOSED_IN PULL_REQUEST"],
    };
    const added = await jsonFetch(`${api}/api/v1/add_text`, {
      method: "POST",
      headers,
      body: JSON.stringify({ textData: [JSON.stringify(canonical)], datasetName: dataset, nodeSet: [run.siteKey, run.incidentId] }),
    });
    const cognified = await jsonFetch(`${api}/api/v1/cognify`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        datasets: [dataset],
        runInBackground: false,
        customPrompt: "Extract Error, UIComponent, UserAction, RootCause, Fix, Verification, Play, and PullRequest entities. Preserve CAUSED_BY, PRECEDES, FIXED_BY, VERIFIED_BY, CRYSTALLIZED_AS, and PROPOSED_IN relationships. Treat only replay-verified facts as verified.",
      }),
    });
    const runId = Object.values(cognified || {}).find((value) => typeof value === "object" && value && "pipeline_run_id" in value);
    const id = typeof runId === "object" && runId && "pipeline_run_id" in runId ? String(runId.pipeline_run_id) : String(added.pipeline_run_id || added.id || `cognee_${run.incidentId}`);
    return receipt("Cognee", id, `hosted add_text + blocking cognify completed for ${dataset}`);
  }
  const python = process.env.COGNEE_PYTHON || "python3";
  const { stdout } = await execFileAsync(
    python,
    [resolve("scripts/cognee_ingest.py"), JSON.stringify({ runKey: run.runKey, incidentId: run.incidentId, winner: run.winner, gate: run.gate })],
    { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout || "{}");
  return receipt("Cognee", parsed.run_id || `cognee_${run.incidentId}`, "Cognee phase-B cognify completed");
}

export async function storeHydra(run: AgentRun): Promise<SponsorReceipt> {
  if (!sponsorsAreLive()) return receipt("HydraDB", `hydra_src_${run.incidentId}`, "verified canonical incident indexed durably");
  const client = hydraClient();
  const canonical = {
    schemaVersion: 1,
    siteKey: run.siteKey,
    incidentId: run.incidentId,
    winner: run.winner,
    rootCause: run.candidates.find((candidate) => candidate.candidateId === run.winner?.candidateId)?.rootCause,
    gate: run.gate,
    relationships: ["ERROR CAUSED_BY ROOT_CAUSE", "ROOT_CAUSE FIXED_BY FIX", "FIX VERIFIED_BY REPLAY", "FIX PROPOSED_IN PULL_REQUEST"],
  };
  const result = await client.context.ingest({
    database: hydraDatabase(),
    collection: process.env.HYDRA_RESOLVED_COLLECTION || "resolved-incidents",
    type: "memory",
    upsert: "true",
    memories: JSON.stringify([{
      text: JSON.stringify(canonical),
      title: `verified remediation ${run.incidentId}`,
      metadata: { site_key: run.siteKey },
      additional_metadata: {
        schema_version: 1,
        incident_id: run.incidentId,
        site_key: run.siteKey,
        verified: true,
        snyk_clean: run.gate.snykStatus === "clean",
        replay_passed: run.gate.replayStatus === "passed",
      },
    }]),
  });
  const item = result.data?.results?.[0];
  if (!result.success || !item?.id || (item.status && item.status.toLowerCase().includes("fail"))) {
    throw new Error(`HydraDB rejected resolved incident memory: ${item?.error || result.data?.message || "missing source receipt"}`);
  }
  return receipt("HydraDB", item.id, "verified remediation queued in resolved-incidents memory");
}

export async function publishHotdata(events: TelemetryEvent[], run: AgentRun): Promise<SponsorReceipt> {
  if (!sponsorsAreLive()) return receipt("hotdata", `hot_trace_${run.runKey}`, `${events.length} immutable events appended to triage_events`);
  const result = await publishHotdataBatch(events, run);
  const id = result.loadIds[0] || result.traceIds.at(-1) || `hot_trace_${run.runKey}`;
  return receipt(
    "hotdata",
    id,
    `${result.rowCount} immutable events accepted in ${result.batchCount} ${result.batchCount === 1 ? "batch" : "batches"} (${result.firstMode})`,
  );
}

export async function publishDraftPullRequest(run: AgentRun, candidate: PatchCandidate) {
  const recomputedHash = createHash("sha256").update(candidate.unifiedDiff).digest("hex");
  if (recomputedHash !== candidate.patchHash) throw new Error("Publisher rejected a mutated patch contract");
  const branch = `triage/inc-${run.incidentId.toLowerCase()}-${candidate.patchHash.slice(0, 8)}`;
  if (!sponsorsAreLive()) {
    return {
      receipt: receipt("GitHub", `github_pr_${run.incidentId}`, "Draft PR created from exact verified patch"),
      pullRequest: { number: 43, url: "https://github.com/triage-control/demo/pull/43", branch, draft: true as const },
    };
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const base = process.env.GITHUB_BASE_BRANCH || "main";
  if (!token || !owner || !repo) throw new Error("GitHub App credentials are incomplete");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
  const root = `https://api.github.com/repos/${owner}/${repo}`;
  const baseRef = await jsonFetch(`${root}/git/ref/heads/${encodeURIComponent(base)}`, { headers });
  if (!process.env.GITHUB_BASE_SHA) throw new Error("GITHUB_BASE_SHA is required for live base-drift protection");
  if (baseRef.object.sha !== candidate.baseSha || baseRef.object.sha !== process.env.GITHUB_BASE_SHA) {
    throw new Error("Base branch drifted after verification; fresh Snyk and replay gates are required");
  }
  try {
    await jsonFetch(`${root}/git/refs`, { method: "POST", headers, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }) });
  } catch (error) {
    if (String(error).includes("403")) {
      throw new Error(`GitHub token cannot create a branch in ${owner}/${repo}; grant Contents: Read and write and Pull requests: Read and write`);
    }
    if (!String(error).includes("422")) throw error;
  }
  const existing = await jsonFetch(`${root}/contents/${candidate.filePath}?ref=${encodeURIComponent(branch)}`, { headers });
  await jsonFetch(`${root}/contents/${candidate.filePath}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ message: `fix(${run.incidentId}): ${candidate.title}`, content: Buffer.from(candidate.patchedText).toString("base64"), branch, sha: existing.sha }),
  });
  const pr = await jsonFetch(`${root}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: `[Triage] ${candidate.title}`,
      head: branch,
      base,
      draft: true,
      body: `AI-generated; human review required.\n\nIncident: ${run.incidentId}\nRocketRide: ${run.runKey}\nCandidate: ${candidate.candidateId}\nPatch: ${candidate.patchHash}\nSnyk: clean\nReplay: passed`,
    }),
  });
  return {
    receipt: receipt("GitHub", String(pr.id), `Draft PR #${pr.number} created`),
    pullRequest: { number: pr.number, url: pr.html_url, branch, draft: true as const },
  };
}
