import type { AgentId, ConsoleEntry } from "../shared/types";
import { sponsorsAreLive } from "./runtime";

export interface RocketRideHandle {
  token: string;
  close: () => Promise<void>;
}

type EventSink = (entry: Omit<ConsoleEntry, "id" | "seq" | "timestamp" | "runKey" | "vm">) => void;

type JsonRecord = Record<string, unknown>;

const agentLabel = (id: AgentId) => id === "A6" ? "Synthesizer" : `Agent ${id.slice(1)}`;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function redact(text: string) {
  return text
    .replace(/\b(?:rr|tk|pk)_[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/\bsk_live_[A-Za-z0-9._-]+\b/g, "[redacted]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[redacted]")
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/([?&](?:token|key|api_key|apikey)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/("(?:token|key|api_key|apikey|authorization)"\s*:\s*")[^"]+/gi, "$1[redacted]");
}

function title(value: string) {
  return value
    .replace(/^apaevt_/, "")
    .replaceAll(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function agentIdIn(value: unknown): AgentId | undefined {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const match = text.match(/(?:agent[_\s-]*)?a([1-6])\b/i);
  return match ? `A${match[1]}` as AgentId : undefined;
}

function agentFromEvent(event: unknown): AgentId {
  const payload = record(event) ?? {};
  const body = record(parseJson(payload.data ?? payload.body)) ?? payload;
  const output = record(parseJson(body.output));
  return agentIdIn(body.component)
    ?? agentIdIn(body.pipes)
    ?? agentIdIn(body.tool)
    ?? agentIdIn(body.name)
    ?? agentIdIn(output?.name)
    ?? agentIdIn(output?.tool)
    ?? agentIdIn(typeof body.output === "string" ? body.output.slice(0, 240) : undefined)
    ?? "A6";
}

function humanizeConsoleOutput(output: string, id: AgentId) {
  let clean = output.replaceAll(/\x1b\[[0-9;]*m/g, "").trim();
  const memory = clean.match(/^\[(\d+)MB\]\s*/i)?.[1];
  clean = clean.replace(/^\[\d+MB\]\s*/i, "");

  const structured = record(parseJson(clean));
  if (structured) {
    const toolId = agentIdIn(structured.name) ?? agentIdIn(structured.tool) ?? id;
    if (structured.name || structured.tool) return `${agentLabel(toolId)} · Candidate tool ready${memory ? ` · ${memory} MB` : ""}`;
    if (typeof structured.message === "string") clean = structured.message;
    else if (typeof structured.status === "string") clean = structured.status;
    else return `${agentLabel(toolId)} · Runtime event received${memory ? ` · ${memory} MB` : ""}`;
  }

  const serviceMatch = clean.match(/^\[([A-Z0-9_-]+)\]:?\s*/);
  const service = serviceMatch?.[1];
  if (serviceMatch) clean = clean.slice(serviceMatch[0].length);
  const mentionedAgent = agentIdIn(clean) ?? id;

  if (/rocketride\s+wave\s+execute\s+tool/i.test(clean)) {
    return `${agentLabel(mentionedAgent)} · Started parallel candidate run${memory ? ` · ${memory} MB` : ""}`;
  }
  if (/^you are\s+a[1-5]\b/i.test(clean)) {
    return `${agentLabel(mentionedAgent)} · Received incident context and began reasoning${memory ? ` · ${memory} MB` : ""}`;
  }
  if (/agent_a[1-5]\.run_agent/i.test(clean)) {
    return `${agentLabel(mentionedAgent)} · Candidate tool invoked${memory ? ` · ${memory} MB` : ""}`;
  }

  const prefix = service ? title(service) : undefined;
  const message = redact(clean).replaceAll(/\s+/g, " ").slice(0, 320);
  return [prefix, message || "Console update", memory ? `${memory} MB` : undefined].filter(Boolean).join(" · ");
}

export function humanizeRocketRideEvent(event: unknown) {
  const payload = record(event) ?? {};
  const rawBody = parseJson(payload.data ?? payload.body ?? payload);
  const body = record(rawBody) ?? payload;
  const id = agentFromEvent(payload);
  if (typeof body.output === "string") return humanizeConsoleOutput(body.output, id);

  if (body.component || body.op) {
    const trace = record(body.trace) ?? {};
    const operation = String(body.op ?? "update").toLowerCase();
    const activity = trace.invoke === "tool" || trace.lane === "invoke" ? "Tool invocation" : title(String(body.component ?? "Pipeline step"));
    const result = String(trace.result ?? "").toLowerCase();
    const state = result === "error"
      ? "failed"
      : operation === "enter" || operation === "begin"
        ? "started"
        : operation === "leave" || operation === "end"
          ? "completed"
          : title(operation).toLowerCase();
    return `${agentLabel(id)} · ${activity} ${state}`;
  }

  const eventType = String(payload.event ?? payload.command ?? payload.type ?? "runtime update");
  if (eventType.toLowerCase().includes("sse")) {
    const detail = typeof body.type === "string" ? title(body.type) : "Progress update";
    const data = record(body.data);
    const message = typeof data?.message === "string" ? ` · ${redact(data.message).slice(0, 220)}` : "";
    return `${agentLabel(id)} · ${detail}${message}`;
  }

  const status = typeof body.status === "string" ? body.status : typeof body.state === "string" ? body.state : undefined;
  return status ? `${agentLabel(id)} · ${title(status)}` : `${title(eventType)} · Update received`;
}

function normalizeEvent(event: unknown, sink: EventSink) {
  const payload = record(event) ?? {};
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
    message: humanizeRocketRideEvent(payload),
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
  const modelKey = process.env.ROCKETRIDE_OPENAI_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey || !uri || !modelKey) throw new Error("RocketRide URI, runtime key, and OpenAI model key are required in live mode");

  const sdk = (await import("rocketride")) as unknown as {
    Question: new (options?: { expectJson?: boolean }) => {
      addContext: (context: unknown) => void;
      addQuestion: (question: string) => void;
    };
    RocketRideClient: new (options: Record<string, unknown>) => {
      connect: (credential?: string, options?: { timeout?: number }) => Promise<void>;
      use: (options: Record<string, unknown>) => Promise<Record<string, unknown> & { token: string }>;
      chat: (options: { token: string; question: unknown; onSSE?: (type: string, data: Record<string, unknown>) => Promise<void> }) => Promise<unknown>;
      setEvents: (token: string, types: string[]) => Promise<unknown>;
      addMonitor?: (key: { token: string }, types: string[]) => Promise<unknown>;
      terminate: (token: string) => Promise<void>;
      disconnect: () => Promise<void>;
    };
  };
  const seenMessages = new Set<string>();
  const readableSink: EventSink = (entry) => {
    const key = `${entry.agentId}:${entry.source}:${entry.category}:${entry.message}`;
    if (seenMessages.has(key)) return;
    seenMessages.add(key);
    if (seenMessages.size > 500) seenMessages.delete(seenMessages.values().next().value as string);
    sink(entry);
  };
  const client = new sdk.RocketRideClient({
    auth: apiKey,
    uri,
    env: { ROCKETRIDE_OPENAI_KEY: modelKey },
    persist: true,
    maxRetryTime: 30_000,
    requestTimeout: 30_000,
    onEvent: async (event: unknown) => normalizeEvent(event, readableSink),
  });
  await client.connect(apiKey, { timeout: 20_000 });
  const response = await client.use({
    filepath: process.env.ROCKETRIDE_PIPELINE_PATH || "./pipeline/triage.pipe",
    ttl: 3600,
    threads: 6,
    pipelineTraceLevel: "summary",
    name: "Triage Control · Agents 1–5 → Synthesizer",
    env: { ROCKETRIDE_OPENAI_KEY: modelKey },
  });
  const token = String(response.token ?? "");
  if (!token) {
    await client.disconnect();
    throw new Error("RocketRide did not return a task token");
  }
  if (client.addMonitor) {
    await client.addMonitor({ token }, ["TASK", "SUMMARY", "FLOW", "OUTPUT", "SSE"]);
  } else {
    await client.setEvents(token, ["TASK", "SUMMARY", "FLOW", "OUTPUT", "SSE"]);
  }
  const question = new sdk.Question({ expectJson: true });
  question.addContext(input);
  question.addQuestion("Run the five specialist agents in parallel, synthesize their evidence, and return the proposed remediation contract as JSON.");
  void client
    .chat({
      token,
      question,
      onSSE: async (type, data) => normalizeEvent({ event: "apaevt_sse", body: { type, data } }, readableSink),
    })
    .catch((error) => sink({ agentId: "A6", source: "SYSTEM", category: "stderr", message: `RocketRide send failed: ${error instanceof Error ? error.message : String(error)}` }));
  return {
    token,
    close: async () => {
      await client.terminate(token).catch(() => undefined);
      await client.disconnect();
    },
  };
}
