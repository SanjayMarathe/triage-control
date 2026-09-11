import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRun, TelemetryEvent } from "../shared/types";
import { probeHotdata, publishHotdataBatch } from "../server/hotdata";

const run = {
  incidentId: "INC-1",
  runKey: "rr-1",
  decisionRevision: 2,
} as AgentRun;

const event = {
  id: "evt-1",
  eventTime: "2026-09-11T20:00:00.000Z",
  sessionId: "session-1",
  siteKey: "site:demo",
  type: "network_failure",
  target: "POST /checkout",
  summary: "HTTP 500",
  severity: "error",
  metadata: { shape: "checkout-v1" },
} satisfies TelemetryEvent;

function configure() {
  vi.stubEnv("HOTDATA_API_URL", "https://hotdata.test/v1");
  vi.stubEnv("HOTDATA_API_KEY", "secret-token");
  vi.stubEnv("HOTDATA_WORKSPACE_ID", "ws-test");
  vi.stubEnv("HOTDATA_DATABASE_ID", "db-test");
  vi.stubEnv("HOTDATA_SCHEMA", "public");
}

function response(body: unknown, status = 200, trace = "trace-test") {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "X-Trace-Id": trace } });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Hotdata publishing", () => {
  it("uses replace exactly for the first load into an absent table", async () => {
    configure();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ rows: [[0]] }))
      .mockResolvedValueOnce(response({ load_id: "load-1" }));

    const result = await publishHotdataBatch([event], run);

    expect(result).toMatchObject({ rowCount: 1, batchCount: 1, firstMode: "replace", loadIds: ["load-1"] });
    const load = fetchMock.mock.calls[1];
    expect(load[0]).toBe("https://hotdata.test/v1/databases/db-test/schemas/public/tables/triage_events/loads");
    const body = JSON.parse(String((load[1] as RequestInit).body));
    expect(body.mode).toBe("replace");
    expect(body.idempotency_key).toMatch(/^telemetry:rr-1:2:0:[a-f0-9]{20}$/);
    expect(body.columns).toMatchObject({ event_time: "TIMESTAMPTZ", metadata_json: "JSON" });
  });

  it("appends when the telemetry table already exists", async () => {
    configure();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ rows: [[1]] }))
      .mockResolvedValueOnce(response({ result_id: "result-1" }));

    const result = await publishHotdataBatch([event], run);

    expect(result.firstMode).toBe("append");
    const body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(body.mode).toBe("append");
  });

  it("reports reachability separately from table initialization", async () => {
    configure();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ id: "db-test" }))
      .mockResolvedValueOnce(response({ rows: [[0]] }));

    await expect(probeHotdata()).resolves.toMatchObject({ reachable: true, tableExists: false });
  });
});
