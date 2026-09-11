import type { AgentRun, BootstrapPayload, LiveEnvelope } from "../shared/types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error((await response.text()) || `${response.status}`);
  return response.json() as Promise<T>;
}

export const api = {
  bootstrap: () => json<BootstrapPayload>("/api/bootstrap"),
  run: (runKey: string) => json<AgentRun>(`/api/runs/${encodeURIComponent(runKey)}`),
  patch: (incidentId: string, terminalEventId: string, idempotencyKey: string) =>
    json<{ rocketrideRunKey: string; taskToken: string; location: string }>(`/api/incidents/${encodeURIComponent(incidentId)}/patch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ terminalEventId }),
    }),
};

export function subscribeToRun(runKey: string, onEnvelope: (envelope: LiveEnvelope) => void, onState?: (state: "live" | "reconnecting") => void) {
  const source = new EventSource(`/api/stream?runKey=${encodeURIComponent(runKey)}`);
  source.onopen = () => onState?.("live");
  source.onerror = () => onState?.("reconnecting");
  source.addEventListener("message", (event) => onEnvelope(JSON.parse((event as MessageEvent).data) as LiveEnvelope));
  return () => source.close();
}
