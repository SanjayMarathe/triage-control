import { NavLink } from "react-router-dom";
import type { IntegrationStatus } from "../../shared/types";

const nav = [
  { to: "/sessions", index: "01", label: "Active sessions", note: "capture" },
  { to: "/logs", index: "02", label: "Telemetry logs", note: "select + patch" },
  { to: "/agents", index: "03", label: "Agent workflow", note: "parallel fix race" },
  { to: "/knowledge", index: "04", label: "Knowledge map", note: "muscle memory" },
];

export function AppShell({ integrations, children }: { integrations: IntegrationStatus[]; children: React.ReactNode }) {
  const degraded = integrations.filter((item) => item.status === "degraded").length;
  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="brand-mark"><span>T</span></div>
        <div className="brand-copy"><strong>TRIAGE CONTROL</strong><small>COMPOUNDING TELEMETRY</small></div>
        <div className="topbar-rule" />
        <div className="pipeline-health"><i className={degraded ? "dot warning" : "dot"} /> PIPELINE ONLINE <span>·</span> DEMO-SHOP</div>
        <div className="clock-chip">LIVE / SF</div>
      </header>
      <aside className="sidebar">
        <div className="rail-label">PIPELINE / 04 WINDOWS</div>
        <nav className="pipeline-nav" aria-label="Pipeline windows">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `rail-link ${isActive ? "active" : ""}`}>
              <span className="rail-index">{item.index}</span>
              <span><strong>{item.label}</strong><small>{item.note}</small></span>
              <b>→</b>
            </NavLink>
          ))}
        </nav>
        <div className="rail-flow" aria-hidden="true"><i /><i /><i /></div>
        <div className="sponsor-health">
          <div className="rail-label">CRITICAL PATH</div>
          {integrations.slice(0, 6).map((integration) => (
            <div className="integration-row" key={integration.name} title={integration.detail}>
              <i className={`dot ${integration.status === "degraded" ? "warning" : ""}`} />
              <span>{integration.name}</span>
              <em>{integration.mode === "simulated" ? "SIM" : "LIVE"}</em>
            </div>
          ))}
        </div>
        <div className="rail-footer">NO RAW KEYSTROKES<br />ONE SANDBOX · DRAFT PR ONLY</div>
      </aside>
      <main className="workspace">{children}</main>
    </div>
  );
}
