import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { BootstrapPayload } from "../shared/types";
import { api } from "./api";
import { AppShell } from "./components/AppShell";
import { ActiveSessions } from "./pages/ActiveSessions";
import { AgentWorkflow } from "./pages/AgentWorkflow";
import { KnowledgeMapPage } from "./pages/KnowledgeMapPage";
import { TelemetryLogs } from "./pages/TelemetryLogs";

export default function App() {
  const [data, setData] = useState<BootstrapPayload>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let loaded = false;
    const refresh = () => void api.bootstrap()
      .then((payload) => { loaded = true; if (active) { setData(payload); setError(""); } })
      .catch((cause) => { if (active && !loaded) setError(cause instanceof Error ? cause.message : String(cause)); });
    refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  if (error) return <div className="boot-screen error"><strong>API unavailable</strong><span>{error}</span><code>npm run dev</code></div>;
  if (!data) return <div className="boot-screen"><span className="spinner" /><strong>CONNECTING TELEMETRY PIPELINE</strong></div>;
  return (
    <AppShell integrations={data.integrations}>
      <Routes>
        <Route path="/sessions" element={<ActiveSessions data={data} />} />
        <Route path="/logs" element={<TelemetryLogs data={data} />} />
        <Route path="/agents" element={<AgentWorkflow data={data} />} />
        <Route path="/knowledge" element={<KnowledgeMapPage data={data} />} />
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Routes>
    </AppShell>
  );
}
