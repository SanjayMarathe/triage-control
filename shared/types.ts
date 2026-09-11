export type AgentId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6";

export type AgentPhase =
  | "waiting"
  | "reading"
  | "reasoning"
  | "tool_call"
  | "candidate_ready"
  | "weighting"
  | "proposing"
  | "gating"
  | "superseded"
  | "failed"
  | "completed";

export type RunState =
  | "spawning"
  | "running"
  | "gating"
  | "verifying"
  | "publishing"
  | "completed"
  | "needs_human";

export interface SessionSummary {
  id: string;
  siteKey: string;
  route: string;
  startedAt: string;
  eventCount: number;
  errorCount: number;
  eventRate: number;
  state: "live" | "incident_ready" | "patching" | "resolved";
  nextStage: string;
  privacySafe: true;
}

export interface TelemetryEvent {
  id: string;
  eventTime: string;
  incidentId?: string;
  sessionId: string;
  siteKey: string;
  type:
    | "click"
    | "input_event"
    | "console_error"
    | "network_failure"
    | "incident_ready"
    | "patch_requested"
    | "agent_activity"
    | "agent_weight_updated"
    | "candidate_proposed"
    | "stage_end"
    | "pr_created";
  target: string;
  summary: string;
  terminal?: boolean;
  severity: "debug" | "info" | "warning" | "error" | "success";
  metadata?: Record<string, unknown>;
}

export interface Incident {
  id: string;
  sessionId: string;
  siteKey: string;
  terminalEventId: string;
  errorShape: string;
  state: "incident_ready" | "patching" | "resolved" | "needs_human";
  runKey?: string;
  createdAt: string;
}

export interface CandidateFactors {
  applicability: number;
  assertionCoverage: number;
  evidenceProvenance: number;
  minimality: number;
  riskControl: number;
  confidenceCalibration: number;
}

export interface PatchCandidate {
  candidateId: string;
  agentId: Exclude<AgentId, "A6">;
  title: string;
  rootCause: string;
  baseSha: string;
  filePath: string;
  testFile: string;
  originalText: string;
  patchedText: string;
  unifiedDiff: string;
  patchHash: string;
  changedLines: number;
  assertions: string[];
  risks: string[];
  factors: CandidateFactors;
  reasonCodes: string[];
  memory?: { hydraSourceId?: string; playUri?: string };
}

export interface ProposalWeight {
  runKey: string;
  revision: number;
  agentId: Exclude<AgentId, "A6">;
  candidateId?: string;
  eligible: boolean;
  score: number;
  factors: CandidateFactors;
  reasonCodes: string[];
  proposedNext: boolean;
  timestamp: string;
}

export interface AgentState {
  id: AgentId;
  strategy: string;
  role: "fix" | "synthesis";
  phase: AgentPhase;
  progress: number;
  currentAction: string;
  candidateId?: string;
  candidateTitle?: string;
  score?: number;
  startedAt?: string;
  updatedAt: string;
  vm: string;
}

export interface ConsoleEntry {
  id: string;
  runKey: string;
  agentId: AgentId;
  timestamp: string;
  seq: number;
  source: "OUTPUT" | "FLOW" | "SSE" | "SYSTEM";
  category: "stdout" | "stderr" | "status" | "tool" | "decision";
  message: string;
  vm: string;
}

export interface DecisionRecord {
  id: string;
  runKey: string;
  revision: number;
  timestamp: string;
  step: "INGEST" | "SCORE" | "CHALLENGE" | "PROPOSE" | "OBSERVE";
  summary: string;
  reasonCodes: string[];
  candidateId?: string;
  agentId?: AgentId;
}

export interface SponsorReceipt {
  sponsor: "RocketRide" | "Cognee" | "HydraDB" | "hotdata" | "Rote" | "Snyk" | "GitHub";
  id: string;
  mode: "live" | "simulated";
  status: "pending" | "passed" | "failed";
  detail: string;
  timestamp: string;
}

export interface GateState {
  stage: "queued" | "snyk" | "sandbox" | "draft_pr" | "complete" | "failed";
  candidateId?: string;
  snykStatus?: "clean" | "blocked" | "error";
  replayStatus?: "passed" | "failed" | "error";
  assertionCount?: number;
  durationMs?: number;
  pullRequest?: {
    number: number;
    url: string;
    branch: string;
    draft: true;
  };
}

export interface AgentRun {
  runKey: string;
  taskToken: string;
  incidentId: string;
  sessionId: string;
  siteKey: string;
  errorShape: string;
  state: RunState;
  providerMode: "live" | "simulated";
  traceLevel: "summary";
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  decisionRevision: number;
  agents: Record<AgentId, AgentState>;
  candidates: PatchCandidate[];
  weights: ProposalWeight[];
  logs: ConsoleEntry[];
  decisions: DecisionRecord[];
  nextProposal?: { agentId: Exclude<AgentId, "A6">; candidateId: string; score: number };
  winner?: { agentId: Exclude<AgentId, "A6">; candidateId: string; patchHash: string };
  gate: GateState;
  receipts: SponsorReceipt[];
}

export interface IntegrationStatus {
  name: SponsorReceipt["sponsor"];
  mode: "live" | "simulated";
  configured: boolean;
  status: "connected" | "ready" | "degraded";
  detail: string;
}

export interface KnowledgeNode {
  key: string;
  kind:
    | "site"
    | "session"
    | "incident"
    | "action"
    | "component"
    | "error"
    | "cause"
    | "fix"
    | "snyk"
    | "replay"
    | "play"
    | "pull_request";
  label: string;
  status: "observed" | "verified";
  val: number;
  color: string;
  evidenceCount: number;
}

export interface KnowledgeLink {
  key: string;
  sourceKey: string;
  targetKey: string;
  relation: string;
  verified: boolean;
}

export interface KnowledgeMap {
  site: { key: string; origin: string; label: string };
  nodes: KnowledgeNode[];
  links: KnowledgeLink[];
}

export interface BootstrapPayload {
  sessions: SessionSummary[];
  events: TelemetryEvent[];
  incidents: Incident[];
  latestRun?: AgentRun;
  integrations: IntegrationStatus[];
  knowledge: KnowledgeMap;
}

export interface LiveEnvelope {
  type: "bootstrap" | "run.updated" | "telemetry.appended" | "knowledge.updated";
  runKey?: string;
  data: AgentRun | TelemetryEvent | KnowledgeMap | BootstrapPayload;
}
