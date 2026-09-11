import type { AgentId, ConsoleEntry } from "../shared/types";
import { sponsorsAreLive } from "./runtime";

export interface RocketRideHandle {
  token: string;
  close: () => Promise<void>;
}

type EventSink = (entry: Omit<ConsoleEntry, "id" | "seq" | "timestamp" | "runKey" | "vm">) => void;

function agentFromEvent(event: unknown): AgentId {
  const text = JSON.stringify(event).toLowerCase();
  for (const id of ["A1", "A2", "A3", "A4", "A5", "A6"] as AgentId[]) {
    if (text.includes(id.toLowerCase()) || text.includes(`agent_${id.toLowerCase()}`)) return id;
  }
  return "A6";
}

function normalizeEvent(event: unknown, sink: EventSink) {
  const payload = event as Record<string, unknown>;
  const text = JSON.stringify(payload.data ?? payload.body ?? payload);
  const name = String(payload.event ?? payload.command ?? payload.type ?? "").toLowerCase();
  const source: ConsoleEntry["source"] = name.includes("output")
    ? "OUTPUT"
    : name.includes("flow")
      ? "FLOW"
      : name.includes("sse")
        ? "SSE"
        : "SYSTEM";
  sink({
    agentId: agentFromEvent(payload),
    source,
    category: source === "OUTPUT" ? "stdout" : source === "SSE" ? "tool" : "status",
    message: text.slice(0, 900),
  });
}

/**
 * Starts the official RocketRide TypeScript client in live mode. The deterministic
 * sandbox and publisher stay server-owned tools; this client supplies task identity
 * and native FLOW/OUTPUT/SSE visibility.
 */
export async function startRocketRide(input: unknown, sink: EventSink): Promise<RocketRideHandle> {
  if (!sponsorsAreLive()) {
    return { token: `task_sim_${Date.now().toString(36)}`, close: async () => undefined };
  }

  const apiKey = process.env.ROCKETRIDE_APIKEY;
  const uri = process.env.ROCKETRIDE_URI;
  if (!apiKey || !uri) throw new Error("RocketRide URI and API key are required in live mode");

  const sdk = (await import("rocketride")) as unknown as {
    RocketRideClient: new (options: Record<string, unknown>) => {
      connect: () => Promise<void>;
      use: (options: Record<string, unknown>) => Promise<Record<string, unknown> & { token: string }>;
      send: (token: string, data: string, objinfo?: Record<string, unknown>, mimetype?: string) => Promise<unknown>;
      setEvents: (token: string, types: string[]) => Promise<unknown>;
      addMonitor?: (key: { token: string }, types: string[]) => Promise<unknown>;
      terminate: (token: string) => Promise<void>;
      disconnect: () => Promise<void>;
    };
  };
  const client = new sdk.RocketRideClient({
    auth: apiKey,
    uri,
    persist: true,
    maxRetryTime: 30_000,
    requestTimeout: 30_000,
    onEvent: async (event: unknown) => normalizeEvent(event, sink),
  });
  await client.connect();
  const response = await client.use({ filepath: process.env.ROCKETRIDE_PIPELINE_PATH || "./pipeline/triage.pipe", ttl: 3600 });
  const token = String(response.token ?? "");
  if (!token) {
    await client.disconnect();
    throw new Error("RocketRide did not return a task token");
  }
  if (client.addMonitor) {
    await client.addMonitor({ token }, ["task", "summary", "flow", "output", "sse"]);
  } else {
    await client.setEvents(token, ["TASK", "SUMMARY", "FLOW", "OUTPUT", "SSE"]);
  }
  void client
    .send(token, JSON.stringify(input), { name: "incident.json", pipelineTraceLevel: "summary" }, "application/json")
    .catch((error) => sink({ agentId: "A6", source: "SYSTEM", category: "stderr", message: `RocketRide send failed: ${error instanceof Error ? error.message : String(error)}` }));
  return {
    token,
    close: async () => {
      await client.terminate(token).catch(() => undefined);
      await client.disconnect();
    },
  };
}
