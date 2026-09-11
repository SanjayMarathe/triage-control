import type { BootstrapPayload } from "../../shared/types";
import { StatusPill } from "../components/StatusPill";

const fmt = (value: string) => new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));

export function ActiveSessions({ data }: { data: BootstrapPayload }) {
  const live = data.sessions.filter((session) => session.state === "live" || session.state === "incident_ready").length;
  const rate = data.sessions.reduce((sum, session) => sum + session.eventRate, 0).toFixed(1);
  const failures = data.sessions.reduce((sum, session) => sum + session.errorCount, 0);
  return (
    <div className="window-page">
      <div className="window-kicker"><span>PIPELINE 01</span><i /> CAPTURE + MEMORY</div>
      <div className="window-title-row">
        <div><h1>Active telemetry sessions</h1><p>Privacy-safe browser sessions arriving from the demo-shop app.</p></div>
        <StatusPill tone={data.sessions.length > 0 ? "good" : "warn"}>{data.sessions.length > 0 ? "STREAMING" : "WAITING FOR EXTENSION"}</StatusPill>
      </div>
      <section className="metric-strip">
        <div><span>ACTIVE SESSIONS</span><strong>{String(live).padStart(2, "0")}</strong><small>live now</small></div>
        <div><span>EVENT RATE</span><strong>{rate}</strong><small>events / sec</small></div>
        <div><span>TERMINAL FAILURES</span><strong className="bad-text">{String(failures).padStart(2, "0")}</strong><small>needs triage</small></div>
        <div><span>PRIVACY CONTRACT</span><strong className="good-text">SAFE</strong><small>content redacted</small></div>
      </section>
      <section className="data-section">
        <div className="section-heading"><div><span>LIVE SESSION FEED</span><small>{data.sessions.length} sessions / last 20 min</small></div><button className="ghost-button">FILTER · ALL</button></div>
        <div className="session-table table-grid">
          <div className="table-head"><span>SESSION</span><span>ROUTE</span><span>START</span><span>EVENTS</span><span>ERRORS</span><span>STATE</span><span>NEXT PIPELINE STAGE</span></div>
          {data.sessions.map((session) => (
            <div className={`table-row ${session.state === "incident_ready" ? "selected" : ""}`} key={session.id}>
              <span className="mono key-cell"><i className={session.state === "live" || session.state === "incident_ready" ? "dot" : "dot muted"} />{session.id}</span>
              <span className="mono">{session.route}</span>
              <span className="mono muted-text">{fmt(session.startedAt)}</span>
              <span className="mono">{session.eventCount}</span>
              <span className={session.errorCount ? "bad-text mono" : "mono muted-text"}>{session.errorCount}</span>
              <span><StatusPill tone={session.state === "incident_ready" ? "bad" : session.state === "live" ? "good" : "neutral"}>{session.state.replaceAll("_", " ")}</StatusPill></span>
              <span className="next-stage">{session.nextStage}<b>→</b></span>
            </div>
          ))}
          {data.sessions.length === 0 && <div className="table-empty">Capture backend is connected. Load <span className="mono">capture-memory/extension</span> in Chrome, then use demo-shop.</div>}
        </div>
      </section>
      <section className="pipeline-callout">
        <div className="callout-number">01</div>
        <div><span>CAPTURE CONTRACT</span><strong>click · field · timing · character count</strong><p>No raw text leaves the browser. Every terminal event is joined to its preceding interaction shape.</p></div>
        <div className="callout-flow"><b>EXTENSION</b><i>→</i><b>COGNEE</b><i>→</i><b>HYDRADB</b></div>
      </section>
    </div>
  );
}
