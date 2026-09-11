import { createHash } from "node:crypto";
import type { AgentRun, TelemetryEvent } from "../shared/types";

const INLINE_LIMIT_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_BATCH_BYTES = 1800 * 1024;
const MAX_ATTEMPTS = 3;

const columns = {
  event_time: "TIMESTAMPTZ",
  incident_id: "VARCHAR",
  run_key: "VARCHAR",
  event_type: "VARCHAR",
  stage: "VARCHAR",
  status: "VARCHAR",
  metadata_json: "JSON",
} as const;

const csvHeader = Object.keys(columns).join(",");

export class HotdataError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "HotdataError";
  }
}

type HotdataConfig = {
  api: string;
  token: string;
  workspace: string;
  database: string;
  schema: string;
};

type HotdataResponse = {
  body: Record<string, unknown>;
  traceId?: string;
};

export type HotdataPublishResult = {
  rowCount: number;
  batchCount: number;
  firstMode: "replace" | "append";
  traceIds: string[];
  loadIds: string[];
};

export type HotdataHealth = {
  reachable: boolean;
  tableExists: boolean;
  traceId?: string;
  errorCode?: string;
};

let publishQueue: Promise<void> = Promise.resolve();

function configFromEnv(): HotdataConfig {
  const token = process.env.HOTDATA_API_KEY;
  const workspace = process.env.HOTDATA_WORKSPACE_ID;
  const database = process.env.HOTDATA_DATABASE_ID;
  if (!token || !workspace || !database) throw new HotdataError("Hotdata credentials are incomplete");
  const schema = process.env.HOTDATA_SCHEMA || "public";
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new HotdataError("HOTDATA_SCHEMA is not a valid SQL identifier");
  return {
    api: (process.env.HOTDATA_API_URL || "https://api.hotdata.dev/v1").replace(/\/$/, ""),
    token,
    workspace,
    database,
    schema,
  };
}

function authHeaders(config: HotdataConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token}`,
    "X-Workspace-Id": config.workspace,
    "X-Database-Id": config.database,
  };
}

function escapeCsv(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function eventRow(event: TelemetryEvent, run: AgentRun): string {
  return [
    event.eventTime,
    run.incidentId,
    run.runKey,
    event.type,
    event.target,
    event.severity,
    JSON.stringify(event.metadata || {}),
  ].map(escapeCsv).join(",");
}

function chunkRows(rows: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentBytes = Buffer.byteLength(`${csvHeader}\n`);
  for (const row of rows) {
    const rowBytes = Buffer.byteLength(`${row}\n`);
    if (rowBytes + Buffer.byteLength(`${csvHeader}\n`) > MAX_INLINE_BATCH_BYTES) {
      throw new HotdataError("A telemetry row exceeds Hotdata's safe inline batch size");
    }
    if (current.length && currentBytes + rowBytes > MAX_INLINE_BATCH_BYTES) {
      chunks.push(current);
      current = [];
      currentBytes = Buffer.byteLength(`${csvHeader}\n`);
    }
    current.push(row);
    currentBytes += rowBytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, 5_000);
  return 150 * 2 ** attempt;
}

function isRetryable(status: number): boolean {
  return status === 409 || status === 429 || status >= 500;
}

async function request(
  config: HotdataConfig,
  path: string,
  init: RequestInit = {},
): Promise<HotdataResponse> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${config.api}${path}`, {
        ...init,
        headers: { ...authHeaders(config), ...(init.headers || {}) },
      });
    } catch (cause) {
      if (attempt + 1 < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
        continue;
      }
      throw new HotdataError(`Hotdata transport failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }

    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      if (response.ok) throw new HotdataError("Hotdata returned invalid JSON", response.status, undefined, response.headers.get("x-trace-id") || undefined);
    }
    const traceId = response.headers.get("x-trace-id") || undefined;
    if (response.ok) return { body, traceId };
    if (isRetryable(response.status) && attempt + 1 < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      continue;
    }
    const nested = body.error;
    const code = typeof nested === "object" && nested && "code" in nested
      ? String(nested.code)
      : typeof nested === "string" ? nested : undefined;
    throw new HotdataError(`Hotdata request failed (${response.status}${code ? ` ${code}` : ""})`, response.status, code, traceId);
  }
  throw new HotdataError("Hotdata request exhausted retries");
}

async function tableExists(config: HotdataConfig): Promise<{ exists: boolean; traceId?: string }> {
  // The information_schema listing API contains declared tables only on some
  // deployments. Querying SQL information_schema also sees auto-created tables.
  const result = await request(config, "/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sql: `SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_catalog = 'default' AND table_schema = '${config.schema}' AND table_name = 'triage_events'`,
    }),
  });
  const rows = Array.isArray(result.body.rows) ? result.body.rows : [];
  const count = Array.isArray(rows[0]) ? Number(rows[0][0]) : 0;
  return { exists: Number.isFinite(count) && count > 0, traceId: result.traceId };
}

async function publishLocked(events: TelemetryEvent[], run: AgentRun): Promise<HotdataPublishResult> {
  if (events.length === 0) return { rowCount: 0, batchCount: 0, firstMode: "append", traceIds: [], loadIds: [] };
  const config = configFromEnv();
  const rows = events.map((event) => eventRow(event, run));
  const chunks = chunkRows(rows);
  const target = `/databases/${encodeURIComponent(config.database)}/schemas/${encodeURIComponent(config.schema)}/tables/triage_events/loads`;
  const present = await tableExists(config);
  const firstMode = present.exists ? "append" : "replace";
  const traceIds = present.traceId ? [present.traceId] : [];
  const loadIds: string[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const data = [csvHeader, ...chunks[index]].join("\n");
    if (Buffer.byteLength(data) > INLINE_LIMIT_BYTES) throw new HotdataError("Hotdata inline payload exceeds 2 MiB");
    const mode = index === 0 ? firstMode : "append";
    const digest = createHash("sha256").update(data).digest("hex").slice(0, 20);
    const result = await request(config, target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        data,
        columns,
        idempotency_key: `telemetry:${run.runKey}:${run.decisionRevision}:${index}:${digest}`,
      }),
    });
    if (result.traceId) traceIds.push(result.traceId);
    const loadId = result.body.load_id ?? result.body.job_id ?? result.body.result_id;
    if (loadId) loadIds.push(String(loadId));
  }

  return { rowCount: events.length, batchCount: chunks.length, firstMode, traceIds, loadIds };
}

export async function publishHotdataBatch(events: TelemetryEvent[], run: AgentRun): Promise<HotdataPublishResult> {
  const previous = publishQueue;
  let release!: () => void;
  publishQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await publishLocked(events, run);
  } finally {
    release();
  }
}

export async function probeHotdata(): Promise<HotdataHealth> {
  try {
    const config = configFromEnv();
    const database = await request(config, `/databases/${encodeURIComponent(config.database)}`);
    const table = await tableExists(config);
    return { reachable: true, tableExists: table.exists, traceId: table.traceId || database.traceId };
  } catch (error) {
    if (error instanceof HotdataError) return { reachable: false, tableExists: false, traceId: error.traceId, errorCode: error.code || String(error.status || "transport") };
    return { reachable: false, tableExists: false, errorCode: "unknown" };
  }
}
