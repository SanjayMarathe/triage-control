import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AgentId,
  AgentRun,
  AgentState,
  BootstrapPayload,
  Incident,
  IntegrationStatus,
  KnowledgeMap,
  LiveEnvelope,
  SessionSummary,
  SponsorReceipt,
  TelemetryEvent,
} from "../shared/types";
import type { CaptureSnapshot } from "./capture-memory";
import { buildCandidates } from "./candidates";
import { sponsorMode } from "./runtime";
import { rankCandidates } from "./scoring";

export const AGENT_STRATEGIES: Record<AgentId, string> = {
  A1: "Agent 1",
  A2: "Agent 2",
  A3: "Agent 3",
  A4: "Agent 4",
  A5: "Agent 5",
  A6: "Synthesizer",
};

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

export function createAgents(timestamp = new Date().toISOString()): Record<AgentId, AgentState> {
  return Object.fromEntries(
    (Object.keys(AGENT_STRATEGIES) as AgentId[]).map((id, index) => [
      id,
      {
        id,
        strategy: AGENT_STRATEGIES[id],
        role: id === "A6" ? "synthesis" : "fix",
        phase: "waiting",
        progress: 0,
        currentAction: id === "A6" ? "Waiting for candidate evidence" : "Waiting for the root Wave",
        updatedAt: timestamp,
        vm: `rr-vm-${id.toLowerCase()}-${index + 1}`,
      } satisfies AgentState,
    ]),
  ) as Record<AgentId, AgentState>;
}

function receipt(
  sponsor: SponsorReceipt["sponsor"],
  id: string,
  detail: string,
  status: SponsorReceipt["status"] = "passed",
): SponsorReceipt {
  return {
    sponsor,
    id,
    detail,
    status,
    mode: sponsorMode(),
    timestamp: new Date().toISOString(),
  };
}

function seedKnowledge(): KnowledgeMap {
  const siteKey = "site:demoshop";
  const nodes: KnowledgeMap["nodes"] = [
    { key: siteKey, kind: "site", label: "demo-shop", status: "verified", val: 14, color: "#f5a623", evidenceCount: 12 },
    { key: "session:784", kind: "session", label: "session_784", status: "observed", val: 7, color: "#8c969c", evidenceCount: 6 },
    { key: "incident:238", kind: "incident", label: "INC-0238", status: "verified", val: 8, color: "#de7b5c", evidenceCount: 8 },
    { key: "action:large-order", kind: "action", label: "large cart → place order", status: "observed", val: 5, color: "#8c969c", evidenceCount: 3 },
    { key: "component:checkout-route", kind: "component", label: "POST /api/checkout", status: "verified", val: 7, color: "#d8ad5c", evidenceCount: 7 },
    { key: "error:missing-receipt", kind: "error", label: "receipt is undefined", status: "verified", val: 9, color: "#de7b5c", evidenceCount: 9 },
    { key: "cause:unchecked-miss", kind: "cause", label: "unchecked receipt miss", status: "verified", val: 8, color: "#a885d8", evidenceCount: 5 },
    { key: "fix:receipt-fallback", kind: "fix", label: "receipt fallback", status: "verified", val: 10, color: "#62d5a0", evidenceCount: 6 },
    { key: "snyk:9f0c", kind: "snyk", label: "Snyk clean", status: "verified", val: 6, color: "#62d5a0", evidenceCount: 1 },
    { key: "replay:9f0c", kind: "replay", label: "2/2 replay assertions", status: "verified", val: 6, color: "#62d5a0", evidenceCount: 2 },
    { key: "play:missing-service-v1", kind: "play", label: "Rote Play v1.0", status: "verified", val: 8, color: "#5e8fdc", evidenceCount: 2 },
    { key: "pr:42", kind: "pull_request", label: "Draft PR #42", status: "verified", val: 7, color: "#f5a623", evidenceCount: 4 },
  ];

  const edge = (sourceKey: string, targetKey: string, relation: string): KnowledgeMap["links"][number] => ({
    key: `edge:${relation}:${sourceKey}:${targetKey}`,
    sourceKey,
    targetKey,
    relation,
    verified: relation !== "OCCURRED_IN",
  });

  return {
    site: { key: siteKey, origin: "http://localhost:3001", label: "demo-shop" },
    nodes,
    links: [
      edge("session:784", siteKey, "OCCURRED_IN"),
      edge("incident:238", "session:784", "OCCURRED_IN"),
      edge("action:large-order", "error:missing-receipt", "TRIGGERED"),
      edge("error:missing-receipt", "component:checkout-route", "OCCURRED_IN"),
      edge("error:missing-receipt", "cause:unchecked-miss", "CAUSED_BY"),
      edge("cause:unchecked-miss", "fix:receipt-fallback", "FIXED_BY"),
      edge("fix:receipt-fallback", "snyk:9f0c", "VERIFIED_BY"),
      edge("fix:receipt-fallback", "replay:9f0c", "VERIFIED_BY"),
      edge("fix:receipt-fallback", "play:missing-service-v1", "CRYSTALLIZED_AS"),
      edge("fix:receipt-fallback", "pr:42", "PROPOSED_IN"),
      edge(siteKey, "incident:238", "CONTAINS"),
    ],
  };
}

export class TriageStore extends EventEmitter {
  readonly sessions: SessionSummary[];
  readonly events: TelemetryEvent[];
  readonly incidents = new Map<string, Incident>();
  readonly runs = new Map<string, AgentRun>();
  readonly idempotency = new Map<string, string>();
  knowledge: KnowledgeMap;
  readonly integrations: IntegrationStatus[];

  constructor() {
    const shouldSeed = sponsorMode() === "simulated" || process.env.DEMO_SEED_DATA === "true";
    super();
    this.sessions = [
      {
        id: "session_784",
        siteKey: "site:demoshop",
        route: "/checkout",
        startedAt: secondsAgo(92),
        eventCount: 186,
        errorCount: 1,
        eventRate: 12.4,
        state: "incident_ready",
        nextStage: "Patch selected terminal event",
        privacySafe: true,
      },
      {
        id: "session_768",
        siteKey: "site:demoshop",
        route: "/cart",
        startedAt: secondsAgo(312),
        eventCount: 94,
        errorCount: 0,
        eventRate: 3.2,
        state: "live",
        nextStage: "Capture",
        privacySafe: true,
      },
      {
        id: "session_751",
        siteKey: "site:demoshop",
        route: "/checkout",
        startedAt: secondsAgo(812),
        eventCount: 143,
        errorCount: 0,
        eventRate: 0,
        state: "resolved",
        nextStage: "Draft PR #42",
        privacySafe: true,
      },
      {
        id: "session_742",
        siteKey: "site:demoshop",
        route: "/cart",
        startedAt: secondsAgo(1102),
        eventCount: 61,
        errorCount: 0,
        eventRate: 0,
        state: "resolved",
        nextStage: "Memory indexed",
        privacySafe: true,
      },
    ];

    this.events = [
      { id: "evt-1", eventTime: secondsAgo(10.418), sessionId: "session_784", siteKey: "site:demoshop", type: "click", target: "button[data-product='4k-monitor']", summary: "Add 4K Monitor", severity: "info" },
      { id: "evt-2", eventTime: secondsAgo(9.122), sessionId: "session_784", siteKey: "site:demoshop", type: "click", target: "button[data-product='ergonomic-chair']", summary: "Add Ergonomic Chair", severity: "info" },
      { id: "evt-3", eventTime: secondsAgo(7.972), sessionId: "session_784", siteKey: "site:demoshop", type: "input_event", target: "input[name='email']", summary: "+17 chars · redacted", severity: "info", metadata: { characterCountDelta: 17, content: null } },
      { id: "evt-4", eventTime: secondsAgo(4.732), sessionId: "session_784", siteKey: "site:demoshop", type: "click", target: "button[type='submit']", summary: "Place Order · total $599.98", severity: "warning" },
      { id: "evt-terminal-0241", eventTime: secondsAgo(4.701), incidentId: "INC-0241", sessionId: "session_784", siteKey: "site:demoshop", type: "network_failure", target: "POST /api/checkout", summary: "HTTP 500 · Cannot read properties of undefined (reading 'code')", terminal: true, severity: "error", metadata: { shape: "checkout_receipt_undefined_v1", status: 500, contentCaptured: false } },
      { id: "evt-ready-0241", eventTime: secondsAgo(4.61), incidentId: "INC-0241", sessionId: "session_784", siteKey: "site:demoshop", type: "incident_ready", target: "RocketRide", summary: "awaiting patch action", severity: "success" },
      { id: "evt-6", eventTime: secondsAgo(31), sessionId: "session_768", siteKey: "site:demoshop", type: "network_failure", target: "POST /api/save-cart", summary: "HTTP 404 · non-terminal", severity: "warning" },
    ];

    const incident: Incident = {
      id: "INC-0241",
      sessionId: "session_784",
      siteKey: "site:demoshop",
      terminalEventId: "evt-terminal-0241",
      errorShape: "checkout_receipt_undefined_v1",
      state: "incident_ready",
      createdAt: secondsAgo(4.7),
    };
    this.incidents.set(incident.id, incident);
    this.knowledge = seedKnowledge();
    if (!shouldSeed) {
      this.sessions.splice(0);
      this.events.splice(0);
      this.incidents.clear();
      this.knowledge = {
        site: { key: "site:unobserved", origin: "http://localhost:3001", label: "waiting for capture" },
        nodes: [],
        links: [],
      };
    }
    this.integrations = this.buildIntegrationStatuses();
    if (sponsorMode() === "simulated") this.seedRun();
  }

  private buildIntegrationStatuses(): IntegrationStatus[] {
    const live = sponsorMode() === "live";
    const rows: Array<[IntegrationStatus["name"], boolean, string]> = [
      ["RocketRide", Boolean(process.env.ROCKETRIDE_APIKEY && process.env.ROCKETRIDE_URI), "TASK · SUMMARY · FLOW · OUTPUT · SSE"],
      ["Cognee", Boolean(
        process.env.COGNEE_API_URL
          ? process.env.COGNEE_API_KEY && process.env.COGNEE_TENANT_ID
          : process.env.COGNEE_LLM_API_KEY || process.env.OPENAI_API_KEY,
      ), process.env.COGNEE_API_URL ? "hosted add_text + cognify graph" : "Python two-phase semantic graph"],
      ["HydraDB", Boolean(process.env.HYDRA_API_KEY), "exact + hybrid incident recall"],
      ["hotdata", Boolean(process.env.HOTDATA_API_KEY && process.env.HOTDATA_DATABASE_ID && process.env.HOTDATA_WORKSPACE_ID), "triage_events microbatches"],
      ["Rote", Boolean(process.env.ROTE_PLAY_URI), "pinned Play execution"],
      ["Snyk", Boolean(process.env.SNYK_TOKEN && process.env.SNYK_ORG_ID), "fail-closed Code scan"],
      ["GitHub", Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER && process.env.GITHUB_REPO && process.env.GITHUB_BASE_SHA), "automatic draft PR"],
    ];

    return rows.map(([name, configured, detail]) => ({
      name,
      configured,
      mode: live ? "live" : "simulated",
      status: live && !configured ? "degraded" : "ready",
      detail,
    }));
  }

  private seedRun() {
    const runKey = "rr_7A91";
    const startedAt = secondsAgo(19);
    const original = readFileSync(resolve("fixtures/demo-app/app/api/checkout/route.ts"), "utf8");
    const candidates = buildCandidates(original, "fixture-base-001", {
      matched: true,
      hydraSourceId: "hydra_src_prior_missing_receipt",
      playUri: process.env.ROTE_PLAY_URI || "local fixture Play",
    });
    const weights = rankCandidates({ candidates, runKey, revision: 7, timestamp: secondsAgo(2.2) });
    const agents = createAgents(startedAt);

    for (const candidate of candidates) {
      agents[candidate.agentId] = {
        ...agents[candidate.agentId],
        phase: "candidate_ready",
        progress: 100,
        currentAction: "Candidate contract emitted to A6",
        candidateId: candidate.candidateId,
        candidateTitle: candidate.title,
        score: weights.find((weight) => weight.agentId === candidate.agentId)?.score,
        startedAt,
        updatedAt: secondsAgo(3),
      };
    }
    agents.A3.currentAction = "Verified Rote Play adapted to current fixture";
    agents.A6 = {
      ...agents.A6,
      phase: "proposing",
      progress: 68,
      currentAction: "Proposing A3 · cand_03 to the Snyk gate",
      startedAt,
      updatedAt: secondsAgo(1.8),
    };

    let seq = 0;
    const log = (agentId: AgentId, source: "OUTPUT" | "FLOW" | "SSE" | "SYSTEM", category: "stdout" | "status" | "tool" | "decision", message: string, ago: number) => ({
      id: `seed-log-${++seq}`,
      runKey,
      agentId,
      timestamp: secondsAgo(ago),
      seq,
      source,
      category,
      message,
      vm: agents[agentId].vm,
    } as const);

    const logs = [
      log("A1", "OUTPUT", "stdout", "[worker] parsed checkout route and failing large-order branch", 13),
      log("A1", "FLOW", "status", "leave code_context · app/api/checkout/route.ts", 11.8),
      log("A1", "SSE", "tool", "candidate cand_01 · 1 changed line", 8.8),
      log("A2", "OUTPUT", "stdout", "[worker] normalizing optional result at receipt boundary", 12.6),
      log("A2", "SSE", "tool", "candidate cand_02 · boundary guard ready", 8.2),
      log("A3", "FLOW", "status", "enter hydra_full_recall · shape checkout_receipt_undefined_v1", 12.3),
      log("A3", "OUTPUT", "stdout", "[rote] inspected triage-remediation@1.0.0", 10.7),
      log("A3", "SSE", "tool", "candidate cand_03 · verified Play adapted", 6.9),
      log("A4", "OUTPUT", "stdout", "[test] encoded $599.98 checkout regression assertion", 11.9),
      log("A4", "FLOW", "status", "leave assertions · 3 checks", 7.4),
      log("A5", "OUTPUT", "stdout", "[types] optional receipt violates caller contract", 10.9),
      log("A5", "SSE", "tool", "candidate cand_05 · runtime guard ready", 6.2),
      log("A6", "SSE", "decision", "decision revision 07 · A3 leads at 97/100", 2.2),
      log("A6", "SSE", "decision", "next candidate: A3 cand_03 · Snyk queue ready", 1.8),
    ];

    const run: AgentRun = {
      runKey,
      taskToken: "task_demo_7A91",
      incidentId: "INC-0238",
      sessionId: "session_784",
      siteKey: "site:demoshop",
      errorShape: "checkout_receipt_undefined_v1",
      state: "gating",
      providerMode: sponsorMode(),
      traceLevel: "summary",
      startedAt,
      updatedAt: secondsAgo(1.8),
      decisionRevision: 7,
      agents,
      candidates,
      weights,
      logs,
      decisions: [
        { id: "decision-5", runKey, revision: 5, timestamp: secondsAgo(6), step: "INGEST", summary: "Five complete candidate contracts available", reasonCodes: ["CONTRACTS_VALID"] },
        { id: "decision-6", runKey, revision: 6, timestamp: secondsAgo(4), step: "SCORE", summary: "A3 gains verified Play provenance and smallest-diff weight", reasonCodes: ["VERIFIED_PLAY", "SMALLEST_DIFF"], candidateId: "cand_03", agentId: "A3" },
        { id: "decision-7", runKey, revision: 7, timestamp: secondsAgo(1.8), step: "PROPOSE", summary: "Send A3 cand_03 through deterministic gates next", reasonCodes: ["TOP_ELIGIBLE", "CAPTURED_ASSERTION"], candidateId: "cand_03", agentId: "A3" },
      ],
      nextProposal: { agentId: "A3", candidateId: "cand_03", score: weights.find((weight) => weight.agentId === "A3")?.score ?? 0 },
      gate: { stage: "queued", candidateId: "cand_03" },
      receipts: [
        receipt("RocketRide", "rr_7A91", "summary trace + six component map"),
        receipt("HydraDB", "hydra_recall_0238", "verified exact-shape recall"),
        receipt("Rote", "rote_run_0238", "pinned Play inspected and adapted"),
      ],
    };
    this.runs.set(run.runKey, run);
  }

  get latestRun(): AgentRun | undefined {
    return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  }

  bootstrap(): BootstrapPayload {
    return {
      sessions: this.sessions,
      events: [...this.events].sort((a, b) => b.eventTime.localeCompare(a.eventTime)),
      incidents: [...this.incidents.values()],
      latestRun: this.latestRun,
      integrations: this.integrations,
      knowledge: this.knowledge,
    };
  }

  addRun(run: AgentRun) {
    this.runs.set(run.runKey, run);
    this.broadcast({ type: "run.updated", runKey: run.runKey, data: run });
  }

  mutateRun(runKey: string, mutator: (run: AgentRun) => void): AgentRun {
    const run = this.runs.get(runKey);
    if (!run) throw new Error(`Unknown run ${runKey}`);
    mutator(run);
    run.updatedAt = new Date().toISOString();
    this.broadcast({ type: "run.updated", runKey, data: run });
    return run;
  }

  appendTelemetry(event: TelemetryEvent) {
    this.events.push(event);
    this.broadcast({ type: "telemetry.appended", data: event });
  }

  setIntegrationStatuses(statuses: IntegrationStatus[]) {
    if (statuses.length === 0) return;
    this.integrations.splice(0, this.integrations.length, ...statuses);
  }

  replaceCaptureSnapshot(snapshot: CaptureSnapshot) {
    const previousSessions = new Map(this.sessions.map((session) => [session.id, session]));
    const operationalEvents = this.events.filter((event) => event.metadata?.source !== "capture-memory");
    const priorIncidents = new Map(this.incidents);

    this.sessions.splice(0, this.sessions.length, ...snapshot.sessions.map((session) => {
      const previous = previousSessions.get(session.id);
      return previous && previous.state !== "live" && previous.state !== "incident_ready"
        ? { ...session, state: previous.state, nextStage: previous.nextStage }
        : session;
    }));
    this.events.splice(0, this.events.length, ...snapshot.events, ...operationalEvents);
    this.incidents.clear();
    for (const incident of snapshot.incidents) {
      const previous = priorIncidents.get(incident.id);
      this.incidents.set(incident.id, previous ? { ...incident, state: previous.state, runKey: previous.runKey } : incident);
    }
    for (const [id, incident] of priorIncidents) {
      if (incident.runKey && !this.incidents.has(id)) this.incidents.set(id, incident);
    }

    const verifiedNodes = this.knowledge.nodes.filter((node) => node.status === "verified");
    const verifiedLinks = this.knowledge.links.filter((link) => link.verified);
    const nodeMap = new Map([...snapshot.knowledge.nodes, ...verifiedNodes].map((node) => [node.key, node]));
    const linkMap = new Map([...snapshot.knowledge.links, ...verifiedLinks].map((link) => [link.key, link]));
    this.knowledge = { ...snapshot.knowledge, nodes: [...nodeMap.values()], links: [...linkMap.values()] };
  }

  resolveIncident(incidentId: string, runKey: string) {
    const incident = this.incidents.get(incidentId);
    if (incident) {
      incident.state = "resolved";
      incident.runKey = runKey;
    }
    const session = this.sessions.find((item) => item.id === incident?.sessionId);
    if (session) {
      session.state = "resolved";
      session.nextStage = "Draft PR created";
    }
  }

  addVerifiedKnowledge(run: AgentRun) {
    if (!run.winner || !run.gate.pullRequest) return;
    const incidentKey = `incident:${run.incidentId}`;
    const fixKey = `fix:${run.winner.patchHash.slice(0, 8)}`;
    const prKey = `pr:${run.gate.pullRequest.number}`;
    const additions: KnowledgeMap["nodes"] = [
      { key: incidentKey, kind: "incident", label: run.incidentId, status: "verified", val: 8, color: "#de7b5c", evidenceCount: 6 },
      { key: fixKey, kind: "fix", label: "verified receipt fallback", status: "verified", val: 10, color: "#62d5a0", evidenceCount: 4 },
      { key: prKey, kind: "pull_request", label: `Draft PR #${run.gate.pullRequest.number}`, status: "verified", val: 7, color: "#f5a623", evidenceCount: 3 },
    ];
    for (const node of additions) {
      if (!this.knowledge.nodes.some((existing) => existing.key === node.key)) this.knowledge.nodes.push(node);
    }
    const links: KnowledgeMap["links"] = [
      { key: `edge:SIMILAR_TO:${incidentKey}:error:missing-receipt`, sourceKey: incidentKey, targetKey: "error:missing-receipt", relation: "SIMILAR_TO", verified: true },
      { key: `edge:FIXED_BY:${incidentKey}:${fixKey}`, sourceKey: incidentKey, targetKey: fixKey, relation: "FIXED_BY", verified: true },
      { key: `edge:PROPOSED_IN:${fixKey}:${prKey}`, sourceKey: fixKey, targetKey: prKey, relation: "PROPOSED_IN", verified: true },
    ];
    for (const link of links) {
      if (!this.knowledge.links.some((existing) => existing.key === link.key)) this.knowledge.links.push(link);
    }
    this.broadcast({ type: "knowledge.updated", data: this.knowledge });
  }

  broadcast(envelope: LiveEnvelope) {
    this.emit("live", envelope);
  }
}
