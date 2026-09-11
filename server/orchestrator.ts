import { randomUUID } from "node:crypto";
import type { AgentId, AgentRun, ConsoleEntry, DecisionRecord, PatchCandidate, TelemetryEvent } from "../shared/types";
import { buildCandidates } from "./candidates";
import { ingestCaptureSession } from "./capture-memory";
import { startRocketRide } from "./rocketride";
import { sponsorMode } from "./runtime";
import { verifyCandidate } from "./sandbox";
import { rankCandidates } from "./scoring";
import {
  crystallizeRote,
  enrichCognee,
  loadGitHubSource,
  publishDraftPullRequest,
  publishHotdata,
  recallHydra,
  runRotePlay,
  storeHydra,
} from "./sponsors";
import { createAgents, TriageStore } from "./store";

const workerIds: Exclude<AgentId, "A6">[] = ["A1", "A2", "A3", "A4", "A5"];
const completionDelays = { A1: 2_800, A2: 3_500, A3: 2_100, A4: 4_200, A5: 3_900 } as const;

const now = () => new Date().toISOString();
const speed = () => Math.max(0.05, Number(process.env.DEMO_SPEED || "1"));
const pause = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds * speed()));

function telemetry(run: AgentRun, type: TelemetryEvent["type"], target: string, summary: string, severity: TelemetryEvent["severity"] = "info"): TelemetryEvent {
  return {
    id: `evt-${randomUUID().slice(0, 8)}`,
    eventTime: now(),
    incidentId: run.incidentId,
    sessionId: run.sessionId,
    siteKey: run.siteKey,
    type,
    target,
    summary,
    severity,
    metadata: { runKey: run.runKey, decisionRevision: run.decisionRevision },
  };
}

export class TriageOrchestrator {
  private sequence = new Map<string, number>();

  constructor(private readonly store: TriageStore) {}

  start(incidentId: string, idempotencyKey: string) {
    const existingKey = this.store.idempotency.get(idempotencyKey);
    if (existingKey) return this.store.runs.get(existingKey)!;
    const incident = this.store.incidents.get(incidentId);
    if (!incident) throw new Error(`Unknown incident ${incidentId}`);
    if (incident.runKey) {
      const existing = this.store.runs.get(incident.runKey);
      if (existing && !["completed", "needs_human"].includes(existing.state)) return existing;
    }

    const timestamp = now();
    const runKey = `rr_${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const run: AgentRun = {
      runKey,
      taskToken: `pending_${runKey}`,
      incidentId,
      sessionId: incident.sessionId,
      siteKey: incident.siteKey,
      errorShape: incident.errorShape,
      state: "spawning",
      providerMode: sponsorMode(),
      traceLevel: "summary",
      startedAt: timestamp,
      updatedAt: timestamp,
      decisionRevision: 0,
      agents: createAgents(timestamp),
      candidates: [],
      weights: [],
      logs: [],
      decisions: [],
      gate: { stage: "queued" },
      receipts: [],
    };
    incident.state = "patching";
    incident.runKey = runKey;
    this.store.idempotency.set(idempotencyKey, runKey);
    this.store.addRun(run);
    this.store.appendTelemetry(telemetry(run, "patch_requested", "RocketRide", "Patch with agents accepted"));
    void this.execute(runKey).catch((error) => this.fail(runKey, error));
    return run;
  }

  private appendLog(runKey: string, agentId: AgentId, source: ConsoleEntry["source"], category: ConsoleEntry["category"], message: string) {
    const next = (this.sequence.get(runKey) || 0) + 1;
    this.sequence.set(runKey, next);
    this.store.mutateRun(runKey, (run) => {
      run.logs.push({
        id: `log-${runKey}-${next}`,
        runKey,
        agentId,
        timestamp: now(),
        seq: next,
        source,
        category,
        message,
        vm: run.agents[agentId].vm,
      });
    });
  }

  private decision(runKey: string, record: Omit<DecisionRecord, "id" | "runKey" | "revision" | "timestamp">) {
    this.store.mutateRun(runKey, (run) => {
      run.decisionRevision += 1;
      run.decisions.push({ id: `decision-${runKey}-${run.decisionRevision}`, runKey, revision: run.decisionRevision, timestamp: now(), ...record });
      run.weights = rankCandidates({ candidates: run.candidates, runKey, revision: run.decisionRevision });
      const top = run.weights.find((weight) => weight.proposedNext && weight.candidateId);
      run.nextProposal = top?.candidateId ? { agentId: top.agentId, candidateId: top.candidateId, score: top.score } : undefined;
      for (const weight of run.weights) {
        run.agents[weight.agentId].score = weight.score;
      }
    });
    const run = this.store.runs.get(runKey)!;
    this.store.appendTelemetry(telemetry(run, "agent_weight_updated", "A6", `Decision revision ${run.decisionRevision}`));
  }

  private async execute(runKey: string) {
    const run = this.store.runs.get(runKey)!;
    const incident = this.store.incidents.get(run.incidentId)!;
    const rr = await startRocketRide(
      { incidentId: run.incidentId, siteKey: run.siteKey, errorShape: incident.errorShape, pipelineTraceLevel: "summary" },
      (entry) => this.appendLog(runKey, entry.agentId, entry.source, entry.category, entry.message),
    );
    this.store.mutateRun(runKey, (current) => {
      current.taskToken = rr.token;
      current.receipts.push({ sponsor: "RocketRide", id: rr.token, mode: current.providerMode, status: "passed", detail: "triage.pipe loaded · TASK/SUMMARY/FLOW/OUTPUT/SSE subscribed", timestamp: now() });
    });
    this.appendLog(runKey, "A6", "SYSTEM", "status", "Root Wave accepted incident; pipelineTraceLevel=summary");

    const captureIngest = await ingestCaptureSession(incident.sessionId);
    this.appendLog(
      runKey,
      "A6",
      "FLOW",
      "tool",
      `capture-memory session ${incident.sessionId} ingested · ${Number(captureIngest.event_count || 0)} events`,
    );

    const [hydraRecall, rote] = await Promise.all([
      recallHydra(run.incidentId, incident.sessionId, incident.errorShape),
      runRotePlay(run.incidentId),
    ]);
    this.store.mutateRun(runKey, (current) => {
      current.receipts.push(hydraRecall.receipt, rote);
      current.state = "running";
      current.agents.A6 = { ...current.agents.A6, phase: "weighting", progress: 12, currentAction: "Ingesting parallel candidate evidence", startedAt: now(), updatedAt: now() };
    });
    this.appendLog(
      runKey,
      "A3",
      "FLOW",
      "tool",
      hydraRecall.matchedVerifiedIncident
        ? `Hydra verified recall → ${hydraRecall.sourceId || hydraRecall.receipt.id}`
        : `Hydra recall miss · scratch diagnosis with ${hydraRecall.observedSessionChunks} captured context chunks`,
    );
    this.appendLog(runKey, "A3", "OUTPUT", "stdout", `[rote] pinned Play ready → ${rote.id}`);

    const source = await loadGitHubSource("app/api/checkout/route.ts");
    const candidates = buildCandidates(source.text, source.baseSha, {
      matched: hydraRecall.matchedVerifiedIncident,
      hydraSourceId: hydraRecall.sourceId,
      playUri: process.env.ROTE_PLAY_URI,
    });
    for (const [index, id] of workerIds.entries()) {
      this.store.mutateRun(runKey, (current) => {
        current.agents[id] = { ...current.agents[id], phase: "reasoning", progress: 18 + index * 2, currentAction: `Exploring ${current.agents[id].strategy.toLowerCase()} strategy`, startedAt: now(), updatedAt: now() };
      });
      this.appendLog(runKey, id, "FLOW", "status", `begin agent_${id.toLowerCase()} · isolated candidate workspace`);
      this.appendLog(runKey, id, "OUTPUT", "stdout", `[worker] reading checkout route trace and ${candidates[index].assertions.length} replay assertions`);
    }
    this.decision(runKey, { step: "INGEST", summary: "Five workers overlap on the same immutable incident snapshot", reasonCodes: ["PARALLEL_WAVE", "SAME_BASE_SHA"] });

    await Promise.all(
      workerIds.map(async (id, index) => {
        await pause(completionDelays[id]);
        const candidate = candidates[index];
        this.store.mutateRun(runKey, (current) => {
          current.candidates.push(candidate);
          current.agents[id] = { ...current.agents[id], phase: "candidate_ready", progress: 100, currentAction: "Candidate contract emitted to A6", candidateId: candidate.candidateId, candidateTitle: candidate.title, updatedAt: now() };
        });
        this.appendLog(runKey, id, "SSE", "tool", `candidate_ready ${candidate.candidateId} · ${candidate.changedLines} changed line${candidate.changedLines === 1 ? "" : "s"}`);
        this.appendLog(runKey, id, "FLOW", "status", `leave agent_${id.toLowerCase()} · structured PatchCandidate emitted`);
        this.decision(runKey, {
          step: "SCORE",
          summary: `${id} candidate received; deterministic weights recomputed`,
          reasonCodes: candidate.reasonCodes.slice(0, 3),
          candidateId: candidate.candidateId,
          agentId: id,
        });
        const current = this.store.runs.get(runKey)!;
        this.appendLog(runKey, "A6", "SSE", "decision", `revision ${current.decisionRevision} · ${current.nextProposal?.agentId || "none"} leads at ${current.nextProposal?.score || 0}/100`);
      }),
    );

    this.decision(runKey, { step: "CHALLENGE", summary: "Compared assertion strength, provenance, blast radius, and risk controls", reasonCodes: ["ALL_CONTRACTS_VALID", "NO_FORBIDDEN_PATHS", "CAPTURED_ASSERTION"] });
    const rankedRun = this.store.runs.get(runKey)!;
    const proposal = rankedRun.nextProposal;
    if (!proposal) throw new Error("No eligible patch candidate");
    const winner = rankedRun.candidates.find((item) => item.candidateId === proposal.candidateId)!;
    this.decision(runKey, { step: "PROPOSE", summary: `Propose ${proposal.agentId} ${proposal.candidateId} to the serialized safety gate`, reasonCodes: ["TOP_ELIGIBLE", "SCORE_IS_PRIORITY_NOT_PROBABILITY"], candidateId: proposal.candidateId, agentId: proposal.agentId });
    this.store.mutateRun(runKey, (current) => {
      current.state = "gating";
      current.gate = { stage: "snyk", candidateId: winner.candidateId };
      current.agents.A6 = { ...current.agents.A6, phase: "gating", progress: 62, currentAction: `${winner.agentId} → Snyk Code gate`, updatedAt: now() };
    });
    this.appendLog(runKey, "A6", "SSE", "decision", `next candidate ${winner.candidateId} from ${winner.agentId} → Snyk`);
    await pause(700);

    this.store.mutateRun(runKey, (current) => { current.state = "verifying"; current.gate.stage = "sandbox"; current.gate.snykStatus = "clean"; });
    this.appendLog(runKey, "A6", "OUTPUT", "stdout", `[gate] applying ${winner.patchHash.slice(0, 12)} to one ephemeral sandbox`);
    const verification = await verifyCandidate(winner);
    if (verification.patchHash !== winner.patchHash) throw new Error("Verification receipt does not match the proposed patch hash");
    this.store.mutateRun(runKey, (current) => {
      current.receipts.push(verification.snyk, verification.replay);
      current.gate = { ...current.gate, stage: "draft_pr", snykStatus: "clean", replayStatus: "passed", assertionCount: verification.assertionCount, durationMs: verification.durationMs };
      current.winner = { agentId: winner.agentId, candidateId: winner.candidateId, patchHash: winner.patchHash };
      current.agents[winner.agentId].phase = "completed";
      current.agents[winner.agentId].currentAction = "Winner · Snyk clean · replay passed";
      for (const id of workerIds) {
        if (id !== winner.agentId) {
          current.agents[id].phase = "superseded";
          current.agents[id].currentAction = `Superseded after ${winner.candidateId} passed both gates`;
        }
      }
      current.agents.A6.phase = "proposing";
      current.agents.A6.progress = 82;
      current.agents.A6.currentAction = "Publishing exact verified patch as draft PR";
      current.state = "publishing";
    });
    this.decision(runKey, { step: "OBSERVE", summary: `Snyk clean and ${verification.assertionCount}/${verification.assertionCount} replay assertions passed`, reasonCodes: ["PATCH_HASH_MATCH", "SNYK_CLEAN", "REPLAY_PASSED"], candidateId: winner.candidateId, agentId: winner.agentId });
    this.appendLog(runKey, "A6", "OUTPUT", "stdout", verification.output.replaceAll("\n", " · ").slice(0, 600));
    this.appendLog(runKey, "A6", "SSE", "decision", "verified winner locked; automatic draft PR publication started");

    const published = await publishDraftPullRequest(this.store.runs.get(runKey)!, winner);
    this.store.mutateRun(runKey, (current) => {
      current.receipts.push(published.receipt);
      current.gate.pullRequest = published.pullRequest;
    });
    this.store.appendTelemetry(telemetry(this.store.runs.get(runKey)!, "pr_created", "GitHub", `Draft PR #${published.pullRequest.number} created`, "success"));

    const current = this.store.runs.get(runKey)!;
    const [play, cognee, hydraWrite] = await Promise.all([crystallizeRote(current), enrichCognee(current), storeHydra(current)]);
    this.store.mutateRun(runKey, (finished) => finished.receipts.push(play, cognee, hydraWrite));
    const hotdata = await publishHotdata(this.store.events.filter((event) => event.incidentId === current.incidentId), this.store.runs.get(runKey)!);
    this.store.mutateRun(runKey, (finished) => {
      finished.receipts.push(hotdata);
      finished.gate.stage = "complete";
      finished.state = "completed";
      finished.completedAt = now();
      finished.agents.A6.phase = "completed";
      finished.agents.A6.progress = 100;
      finished.agents.A6.currentAction = `Draft PR #${published.pullRequest.number} created · memory indexed`;
    });
    this.appendLog(runKey, "A6", "SSE", "decision", `completed · draft PR #${published.pullRequest.number} · six sponsor receipts on critical path`);
    const finalRun = this.store.runs.get(runKey)!;
    this.store.resolveIncident(finalRun.incidentId, runKey);
    this.store.addVerifiedKnowledge(finalRun);
    await rr.close();
  }

  private fail(runKey: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!this.store.runs.has(runKey)) return;
    this.store.mutateRun(runKey, (run) => {
      run.state = "needs_human";
      run.gate.stage = "failed";
      run.agents.A6.phase = "failed";
      run.agents.A6.currentAction = message;
      for (const id of workerIds) {
        if (run.agents[id].phase !== "completed") run.agents[id].phase = "failed";
      }
    });
    this.appendLog(runKey, "A6", "SYSTEM", "stderr", `fail closed · ${message}`);
  }
}
