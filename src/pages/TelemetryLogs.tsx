import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BootstrapPayload, TelemetryEvent } from "../../shared/types";
import { api } from "../api";
import { StatusPill } from "../components/StatusPill";

const fmt = (value: string) => new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hour12: false }).format(new Date(value));

export function TelemetryLogs({ data }: { data: BootstrapPayload }) {
  const terminal = data.events.find((event) => event.terminal) || data.events[0];
  const [selectedId, setSelectedId] = useState(terminal?.id);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const requestKey = useRef(crypto.randomUUID());
  const navigate = useNavigate();
  const selected = useMemo(() => data.events.find((event) => event.id === selectedId), [data.events, selectedId]);
  const preceding = useMemo(() => {
    if (!selected) return [];
    return data.events
      .filter((event) => event.sessionId === selected.sessionId && event.eventTime < selected.eventTime)
      .sort((left, right) => left.eventTime.localeCompare(right.eventTime))
      .slice(-4);
  }, [data.events, selected]);
  const hotdata = data.integrations.find((integration) => integration.name === "hotdata");
  useEffect(() => {
    if (!selectedId || !data.events.some((event) => event.id === selectedId)) setSelectedId(terminal?.id);
  }, [data.events, selectedId, terminal?.id]);
  const canPatch = Boolean(selected?.terminal && selected.incidentId && ["console_error", "network_failure"].includes(selected.type));

  async function patch(event: TelemetryEvent) {
    if (!event.incidentId || pending) return;
    setPending(true);
    setError("");
    try {
      const result = await api.patch(event.incidentId, event.id, requestKey.current);
      navigate(`/agents?run=${encodeURIComponent(result.rocketrideRunKey)}&incident=${encodeURIComponent(event.incidentId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  }

  return (
    <div className="window-page logs-page">
      <div className="window-kicker"><span>PIPELINE 02</span><i /> SELECT + PATCH</div>
      <div className="window-title-row">
        <div><h1>Telemetry logs</h1><p>Select a terminal failure, inspect its safe context, then dispatch the parallel fix race.</p></div>
        <div className="title-actions"><StatusPill tone={hotdata?.status === "connected" ? "good" : "warn"}>HOTDATA {hotdata?.status || "CHECKING"}</StatusPill><button className="ghost-button">EXPORT CSV</button></div>
      </div>
      <div className="logs-layout">
        <section className="event-ledger">
          <div className="section-heading"><div><span>NORMALIZED EVENT STREAM</span><small>{selected?.sessionId || "waiting for Chrome capture"} · ordered by event time</small></div><span className="live-tick"><i className="dot" /> LIVE</span></div>
          <div className="event-table table-grid">
            <div className="table-head"><span>TIME</span><span>TYPE</span><span>TARGET</span><span>SUMMARY</span><span>SEVERITY</span></div>
            {data.events.map((event) => (
              <button className={`table-row ${selectedId === event.id ? "selected" : ""} ${event.terminal ? "terminal" : ""}`} key={event.id} onClick={() => setSelectedId(event.id)}>
                <span className="mono muted-text">{fmt(event.eventTime)}</span>
                <span className="event-type mono">{event.type}</span>
                <span className="mono">{event.target}</span>
                <span>{event.summary}</span>
                <span><StatusPill tone={event.severity === "error" ? "bad" : event.severity === "warning" ? "warn" : event.severity === "success" ? "good" : "neutral"}>{event.severity}</StatusPill></span>
              </button>
            ))}
            {data.events.length === 0 && <div className="table-empty">No browser events yet. Load the Capture + Memory extension and use demo-shop.</div>}
          </div>
          <div className="stream-footer"><span>privacy scrub: PASS</span><span>raw content: 0 bytes</span><span>hotdata: {hotdata?.status || "checking"}</span></div>
        </section>
        <aside className="event-inspector">
          <div className="inspector-head"><span>SELECTED EVENT</span><b>{selected?.terminal ? "TERMINAL" : "CONTEXT"}</b></div>
          {selected && <>
            <div className="event-symbol">{["console_error", "network_failure"].includes(selected.type) ? "!" : selected.type === "click" ? "↗" : "·"}</div>
            <h2>{selected.summary}</h2>
            <p className="mono event-id">{selected.id}</p>
            <dl className="property-grid">
              <div><dt>TYPE</dt><dd>{selected.type}</dd></div>
              <div><dt>TARGET</dt><dd>{selected.target}</dd></div>
              <div><dt>SESSION</dt><dd>{selected.sessionId}</dd></div>
              <div><dt>INCIDENT</dt><dd>{selected.incidentId || "—"}</dd></div>
              <div><dt>ERROR SHAPE</dt><dd>{String(selected.metadata?.errorShape || selected.metadata?.shape || "—")}</dd></div>
              <div><dt>RAW CONTENT</dt><dd className="good-text">NOT CAPTURED</dd></div>
            </dl>
            <div className="trace-context">
              <span>PRECEDING ACTION SHAPE</span>
              {preceding.map((event, index) => <div key={event.id}><b>{String(index + 1).padStart(2, "0")}</b><p>{event.type} · {event.target} · {event.summary}</p></div>)}
              {preceding.length === 0 && <p className="muted-text">No preceding events in this bounded session window.</p>}
            </div>
            <div className="patch-contract"><i className={canPatch ? "dot" : "dot muted"} /><div><strong>{canPatch ? "READY FOR AGENT PATCH" : "NOT A TERMINAL FAILURE"}</strong><p>{canPatch ? "Starts A1–A5 in parallel; A6 gates the winner." : "Choose the red console error row to continue."}</p></div></div>
            <button className="primary-button" disabled={!canPatch || pending} onClick={() => selected && void patch(selected)}>{pending ? <><span className="spinner" /> DISPATCHING ROCKETRIDE</> : <>PATCH WITH AGENTS <b>→</b></>}</button>
            {error && <p className="inline-error">{error}</p>}
          </>}
          {!selected && <div className="empty-inspector"><strong>WAITING FOR TELEMETRY</strong><p>The patch action appears only for a real terminal browser event.</p></div>}
          <div className="hotdata-receipt"><span>HOTDATA LIVE TARGET</span><strong>public.triage_events</strong><p>{hotdata?.detail || "checking database readiness"}</p></div>
        </aside>
      </div>
    </div>
  );
}
