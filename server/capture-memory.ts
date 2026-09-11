import { createHash } from "node:crypto";
import type { Incident, KnowledgeMap, SessionSummary, TelemetryEvent } from "../shared/types";

type CaptureEvent = Record<string, unknown> & {
  kind?: string;
  t?: number;
  url?: string;
  sessionId?: string;
  target?: Record<string, unknown> | null;
};

interface CaptureSessionResponse {
  session_id: string;
  event_count: number;
  events: CaptureEvent[];
}

export interface CaptureSnapshot {
  sessions: SessionSummary[];
  events: TelemetryEvent[];
  incidents: Incident[];
  knowledge: KnowledgeMap;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function captureBaseUrl() {
  return (process.env.CAPTURE_MEMORY_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
}

async function captureFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${captureBaseUrl()}${path}`, { ...init, signal: controller.signal });
    const body = await response.text();
    if (!response.ok) throw new Error(`capture-memory ${response.status}: ${body.slice(0, 240)}`);
    return (body ? JSON.parse(body) : {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

function safeUrl(raw: unknown) {
  try {
    return new URL(String(raw || "http://localhost:3001"));
  } catch {
    return new URL("http://localhost:3001");
  }
}

function siteKeyFor(rawUrl: unknown) {
  const origin = safeUrl(rawUrl).origin.toLowerCase();
  return `site:${hash(origin).slice(0, 16)}`;
}

function targetLabel(event: CaptureEvent) {
  const target = event.target || {};
  const parts = [target.tag, target.id && `#${target.id}`, target.name && `[name=${target.name}]`, target.testId && `[data-testid=${target.testId}]`]
    .filter(Boolean)
    .map(String);
  if (parts.length > 0) return parts.join("");
  if (event.kind === "network_failure") return `${String(event.method || "GET")} ${safeUrl(event.url).pathname}`;
  return String(event.source || event.kind || "browser");
}

function normalizedErrorShape(event: CaptureEvent) {
  const url = safeUrl(event.url);
  const message = String(event.message || event.statusText || "")
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "<uuid>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .slice(0, 240);
  return `shape:${hash([event.kind, event.method, url.pathname, event.status, message].join("|")).slice(0, 20)}`;
}

function isFailure(event: CaptureEvent) {
  return ["console_error", "runtime_error", "unhandled_rejection", "network_failure"].includes(String(event.kind));
}

function isTerminal(event: CaptureEvent) {
  if (!isFailure(event)) return false;
  if (event.kind !== "network_failure") return true;
  const status = Number(event.status || 0);
  return status === 0 || status >= 500;
}

function toTelemetry(sessionId: string, event: CaptureEvent, index: number): TelemetryEvent {
  const kind = String(event.kind || "console_error");
  const type: TelemetryEvent["type"] = kind === "click"
    ? "click"
    : kind === "keystroke"
      ? "input_event"
      : kind === "network_failure"
        ? "network_failure"
        : "console_error";
  const terminal = isTerminal(event);
  const stable = `${sessionId}|${event.t || 0}|${index}|${kind}`;
  const incidentId = terminal ? `INC-${hash(stable).slice(0, 8).toUpperCase()}` : undefined;
  const status = typeof event.status === "number" ? `HTTP ${event.status}` : "";
  const summary = kind === "keystroke"
    ? `${String(event.keyCategory || "key")} event · content redacted`
    : [status, String(event.message || event.statusText || kind)].filter(Boolean).join(" · ").slice(0, 500);
  return {
    id: `cm:${hash(stable).slice(0, 20)}`,
    eventTime: new Date(Number(event.t || Date.now())).toISOString(),
    incidentId,
    sessionId,
    siteKey: siteKeyFor(event.url),
    type,
    target: targetLabel(event),
    summary,
    terminal,
    severity: terminal ? "error" : isFailure(event) ? "warning" : "info",
    metadata: {
      source: "capture-memory",
      errorShape: terminal ? normalizedErrorShape(event) : undefined,
      method: event.method,
      status: event.status,
      durationMs: event.durationMs,
      keyCategory: kind === "keystroke" ? event.keyCategory : undefined,
      characterCount: kind === "keystroke" && event.keyCategory === "char" ? 1 : 0,
      contentCaptured: false,
    },
  };
}

function buildKnowledge(sessions: SessionSummary[], events: TelemetryEvent[], incidents: Incident[]): KnowledgeMap {
  const firstEvent = events[0];
  const origin = firstEvent ? safeUrl((firstEvent.metadata?.url as string | undefined) || "http://localhost:3001").origin : "http://localhost:3001";
  const siteKey = firstEvent?.siteKey || "site:unobserved";
  const nodes: KnowledgeMap["nodes"] = [{ key: siteKey, kind: "site", label: safeUrl(origin).host, status: "observed", val: 14, color: "#f5a623", evidenceCount: events.length }];
  const links: KnowledgeMap["links"] = [];
  for (const session of sessions) {
    const key = `session:${session.siteKey}:${session.id}`;
    nodes.push({ key, kind: "session", label: session.id, status: "observed", val: 7, color: "#8c969c", evidenceCount: session.eventCount });
    links.push({ key: `edge:OCCURRED_IN:${key}:${session.siteKey}`, sourceKey: key, targetKey: session.siteKey, relation: "OCCURRED_IN", verified: false });
  }
  for (const incident of incidents) {
    const incidentKey = `incident:${incident.siteKey}:${incident.id}`;
    const errorKey = `error:${incident.siteKey}:${incident.errorShape}`;
    const sessionKey = `session:${incident.siteKey}:${incident.sessionId}`;
    nodes.push({ key: incidentKey, kind: "incident", label: incident.id, status: "observed", val: 8, color: "#de7b5c", evidenceCount: 1 });
    nodes.push({ key: errorKey, kind: "error", label: incident.errorShape, status: "observed", val: 9, color: "#de7b5c", evidenceCount: 1 });
    links.push({ key: `edge:OCCURRED_IN:${incidentKey}:${sessionKey}`, sourceKey: incidentKey, targetKey: sessionKey, relation: "OCCURRED_IN", verified: false });
    links.push({ key: `edge:OBSERVED_AS:${incidentKey}:${errorKey}`, sourceKey: incidentKey, targetKey: errorKey, relation: "OBSERVED_AS", verified: false });
  }
  return { site: { key: siteKey, origin, label: safeUrl(origin).host }, nodes, links };
}

export async function fetchCaptureSnapshot(): Promise<CaptureSnapshot> {
  const counts = await captureFetch<Record<string, number>>("/sessions");
  const ids = Object.keys(counts).slice(-25);
  const details = await Promise.all(ids.map((id) => captureFetch<CaptureSessionResponse>(`/sessions/${encodeURIComponent(id)}`)));
  const sessions: SessionSummary[] = [];
  const events: TelemetryEvent[] = [];
  const incidents: Incident[] = [];

  for (const detail of details) {
    const normalized = detail.events.map((event, index) => toTelemetry(detail.session_id, event, index));
    const failures = normalized.filter((event) => event.severity === "warning" || event.severity === "error");
    const terminal = normalized.filter((event) => event.terminal);
    events.push(...normalized);
    for (const event of terminal) {
      incidents.push({
        id: event.incidentId!,
        sessionId: detail.session_id,
        siteKey: event.siteKey,
        terminalEventId: event.id,
        errorShape: String(event.metadata?.errorShape),
        state: "incident_ready",
        createdAt: event.eventTime,
      });
    }
    const first = normalized.at(0);
    const last = normalized.at(-1);
    const elapsedSeconds = first && last ? Math.max(1, (Date.parse(last.eventTime) - Date.parse(first.eventTime)) / 1000) : 1;
    sessions.push({
      id: detail.session_id,
      siteKey: first?.siteKey || "site:unobserved",
      route: safeUrl(detail.events.at(-1)?.url).pathname,
      startedAt: first?.eventTime || new Date().toISOString(),
      eventCount: detail.event_count,
      errorCount: failures.length,
      eventRate: Number((normalized.length / elapsedSeconds).toFixed(1)),
      state: terminal.length > 0 ? "incident_ready" : "live",
      nextStage: terminal.length > 0 ? "Patch selected terminal event" : "Capture",
      privacySafe: true,
    });
  }

  sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  events.sort((a, b) => a.eventTime.localeCompare(b.eventTime));
  return { sessions, events, incidents, knowledge: buildKnowledge(sessions, events, incidents) };
}

export async function ingestCaptureSession(sessionId: string) {
  return captureFetch<Record<string, unknown>>(`/sessions/${encodeURIComponent(sessionId)}/ingest`, { method: "POST" });
}

export interface CaptureMemoryRecall {
  count: number;
  chunks: Array<{
    source_id?: string;
    entity?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>;
  graph_context_present?: boolean;
}

export async function recallCapturedMemory(sessionId: string, query: string) {
  return captureFetch<CaptureMemoryRecall>("/memory/recall", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, session_id: sessionId, max_results: 8 }),
  });
}

export async function probeCaptureMemory() {
  const health = await captureFetch<{ status?: string }>("/health");
  if (health.status !== "ok") throw new Error("capture-memory returned an unhealthy status");
  return { ok: true, baseUrl: captureBaseUrl() };
}
