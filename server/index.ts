import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fetchCaptureSnapshot, probeCaptureMemory } from "./capture-memory";
import { probeIntegrations } from "./health";
import { TriageOrchestrator } from "./orchestrator";
import { sponsorMode } from "./runtime";
import { TriageStore } from "./store";

const app = express();
const store = new TriageStore();
const orchestrator = new TriageOrchestrator(store);
let lastCaptureSync = 0;
let lastIntegrationProbe = 0;
let captureStatus: { status: "connected" | "degraded"; detail: string; checkedAt: string } = {
  status: "degraded",
  detail: "not checked",
  checkedAt: new Date(0).toISOString(),
};

async function syncCapture(force = false) {
  if (!force && Date.now() - lastCaptureSync < 1_500) return;
  try {
    await probeCaptureMemory();
    const snapshot = await fetchCaptureSnapshot();
    store.replaceCaptureSnapshot(snapshot);
    lastCaptureSync = Date.now();
    captureStatus = { status: "connected", detail: `${snapshot.sessions.length} live session snapshots`, checkedAt: new Date().toISOString() };
  } catch (error) {
    captureStatus = { status: "degraded", detail: error instanceof Error ? error.message : String(error), checkedAt: new Date().toISOString() };
  }
}

async function refreshIntegrations(force = false) {
  if (!force && Date.now() - lastIntegrationProbe < 30_000) return;
  const statuses = await probeIntegrations();
  store.setIntegrationStatuses(statuses);
  lastIntegrationProbe = Date.now();
}

app.use(express.json({ limit: "256kb" }));

app.get("/api/health", async (_request, response) => {
  await Promise.all([syncCapture(true), refreshIntegrations(true)]);
  response.json({
    ok: captureStatus.status === "connected" && store.integrations.every((integration) => integration.status === "connected"),
    sponsorMode: sponsorMode(),
    sponsorsReady: store.integrations.every((integration) => integration.status === "connected"),
    captureMemory: captureStatus,
    integrations: store.integrations,
  });
});
app.get("/api/bootstrap", async (_request, response) => {
  await Promise.all([syncCapture(), refreshIntegrations()]);
  response.json(store.bootstrap());
});
app.post("/api/capture/sync", async (_request, response) => {
  await syncCapture(true);
  if (captureStatus.status !== "connected") return response.status(503).json(captureStatus);
  return response.json({ ...captureStatus, ...store.bootstrap() });
});
app.get("/api/runs/:runKey", (request, response) => {
  const run = store.runs.get(request.params.runKey);
  if (!run) return response.status(404).json({ error: "run_not_found" });
  response.json(run);
});
app.get("/api/runs/:runKey/logs", (request, response) => {
  const run = store.runs.get(request.params.runKey);
  if (!run) return response.status(404).json({ error: "run_not_found" });
  const agentId = typeof request.query.agentId === "string" ? request.query.agentId : undefined;
  response.json(agentId ? run.logs.filter((entry) => entry.agentId === agentId) : run.logs);
});
app.post("/api/incidents/:incidentId/patch", (request, response) => {
  try {
    const key = String(request.header("Idempotency-Key") || request.body?.idempotencyKey || "");
    if (!key) return response.status(400).json({ error: "idempotency_key_required" });
    const incident = store.incidents.get(request.params.incidentId);
    if (!incident) return response.status(404).json({ error: "incident_not_found" });
    if (request.body?.terminalEventId && request.body.terminalEventId !== incident.terminalEventId) {
      return response.status(409).json({ error: "terminal_event_mismatch" });
    }
    const run = orchestrator.start(request.params.incidentId, key);
    return response.status(202).location(`/api/runs/${run.runKey}`).json({ rocketrideRunKey: run.runKey, taskToken: run.taskToken, location: `/agents?run=${run.runKey}&incident=${run.incidentId}` });
  } catch (error) {
    return response.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
app.get("/api/incidents/:incidentId/agent-graph", (request, response) => {
  const runKey = String(request.query.runKey || store.incidents.get(request.params.incidentId)?.runKey || "");
  const run = store.runs.get(runKey);
  if (!run || run.incidentId !== request.params.incidentId) return response.status(404).json({ error: "graph_not_found" });
  response.json(run);
});
app.get("/api/knowledge-map", (_request, response) => response.json(store.knowledge));
app.get("/api/stream", (request, response) => {
  const runKey = typeof request.query.runKey === "string" ? request.query.runKey : undefined;
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  response.write(`event: connected\ndata: ${JSON.stringify({ runKey, timestamp: new Date().toISOString() })}\n\n`);
  const listener = (envelope: { runKey?: string }) => {
    if (!runKey || !envelope.runKey || envelope.runKey === runKey) response.write(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`);
  };
  store.on("live", listener);
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
  request.on("close", () => { clearInterval(heartbeat); store.off("live", listener); });
});

const dist = resolve("dist");
if (process.env.NODE_ENV === "production" && existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_request, response) => response.sendFile(resolve(dist, "index.html")));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, "127.0.0.1", () => {
  const configured = store.integrations.filter((integration) => integration.configured).length;
  console.log(`Triage Control API · http://127.0.0.1:${port} · mandatory live sponsors (${configured}/${store.integrations.length} configured)`);
});
