import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import type { AgentId, AgentRun, BootstrapPayload, LiveEnvelope } from "../../shared/types";
import { api, subscribeToRun } from "../api";
import { AgentDecisionGraph } from "../components/AgentDecisionGraph";
import { ReasoningLoop } from "../components/ReasoningLoop";
import { RocketRideConsole } from "../components/RocketRideConsole";
import { StatusPill } from "../components/StatusPill";

const phaseTone = (phase: string) => phase === "completed" || phase === "candidate_ready" ? "good" : phase === "failed" ? "bad" : phase === "superseded" ? "neutral" : "accent";

export function AgentWorkflow({ data }: { data: BootstrapPayload }) {
  const [params] = useSearchParams();
  const requested = params.get("run");
  const requestedAgent = params.get("agent");
  const initialAgent = (["A1", "A2", "A3", "A4", "A5", "A6"] as string[]).includes(requestedAgent || "") ? requestedAgent as AgentId : "A3";
  const [run, setRun] = useState<AgentRun | undefined>(requested === data.latestRun?.runKey || !requested ? data.latestRun : undefined);
  const [selected, setSelected] = useState<AgentId>(initialAgent);
  const [tab, setTab] = useState<"console" | "reasoning">(params.get("tab") === "reasoning" || initialAgent === "A6" ? "reasoning" : "console");
  const [connection, setConnection] = useState<"live" | "reconnecting">("live");
  useEffect(() => {
    if (requested && requested !== run?.runKey) void api.run(requested).then(setRun);
  }, [requested, run?.runKey]);
  useEffect(() => {
    if (!run?.runKey) return;
    return subscribeToRun(run.runKey, (envelope: LiveEnvelope) => {
      if (envelope.type === "run.updated" && envelope.runKey === run.runKey) setRun(envelope.data as AgentRun);
    }, setConnection);
  }, [run?.runKey]);

  if (!run && requested) return <div className="window-page loading-window"><span className="spinner" /> Loading RocketRide run…</div>;
  if (!run) return <div className="window-page empty-run"><span>PIPELINE 03</span><h1>No RocketRide run yet</h1><p>Select the terminal failure and dispatch the mandatory live sponsor pipeline.</p><Link to="/logs">OPEN TELEMETRY LOGS →</Link></div>;
  const candidate = run.candidates.find((item) => item.agentId === selected);
  const selectedAgent = run.agents[selected];
  const receipts = run.receipts;
  const selectAgent = (id: AgentId) => {
    setSelected(id);
    setTab(id === "A6" ? "reasoning" : "console");
  };

  return (
    <div className="window-page agent-page">
      <div className="window-kicker"><span>PIPELINE 03</span><i /> ORCHESTRATE + ACT + VERIFY</div>
      <div className="window-title-row agent-title">
        <div><h1>Parallel agent decision graph</h1><p>{run.incidentId} · five fixes race into one continuously weighted synthesis node.</p></div>
        <div className="title-actions"><StatusPill tone={connection === "live" ? "good" : "warn"}>{connection === "live" ? "ROCKETRIDE LIVE" : "RECONNECTING"}</StatusPill><span className="run-key mono">{run.runKey}</span></div>
      </div>
      <section className="agent-status-strip">
        <div><strong>06</strong><span>AGENTS</span></div>
        <div><strong>05</strong><span>PARALLEL FIX VMS</span></div>
        <div><strong>{String(run.candidates.length).padStart(2, "0")}</strong><span>CANDIDATES</span></div>
        <div><strong>01</strong><span>SERIAL SANDBOX</span></div>
        <div className="run-state"><i className="dot" /><span>{run.state.replaceAll("_", " ")}</span><em>REV {String(run.decisionRevision).padStart(2, "0")}</em></div>
      </section>
      <div className="agent-workbench">
        <aside className="worker-inspector">
          <div className="pane-label">SELECTED NODE / LIVE STATE</div>
          <div className={`agent-badge ${selected === "A6" ? "center" : ""}`}>{selected}</div>
          <span className="agent-strategy">{selectedAgent.strategy}</span>
          <StatusPill tone={phaseTone(selectedAgent.phase) as any}>{selectedAgent.phase.replaceAll("_", " ")}</StatusPill>
          <div className="agent-progress"><i style={{ width: `${selectedAgent.progress}%` }} /></div>
          <p className="current-action">{selectedAgent.currentAction}</p>
          <dl className="property-grid compact">
            <div><dt>ROCKETRIDE VM</dt><dd>{selectedAgent.vm}</dd></div>
            <div><dt>STARTED</dt><dd>{selectedAgent.startedAt ? new Date(selectedAgent.startedAt).toLocaleTimeString() : "queued"}</dd></div>
            <div><dt>CANDIDATE</dt><dd>{selectedAgent.candidateId || "—"}</dd></div>
            <div><dt>A6 WEIGHT</dt><dd>{selectedAgent.score !== undefined ? `${selectedAgent.score} / 100` : "pending"}</dd></div>
          </dl>
          {candidate && <div className="candidate-card"><span>PATCH CANDIDATE</span><strong>{candidate.title}</strong><p>{candidate.rootCause}</p><div><em>{candidate.changedLines} LINE{candidate.changedLines === 1 ? "" : "S"}</em><em>{candidate.assertions.length} ASSERTIONS</em></div></div>}
          <div className="node-list">
            <span>SELECT AGENT</span>
            {(Object.keys(run.agents) as AgentId[]).map((id) => <button className={selected === id ? "active" : ""} onClick={() => selectAgent(id)} key={id}><b>{id}</b><span>{run.agents[id].strategy}</span><i className={`phase-dot ${run.agents[id].phase}`} /></button>)}
          </div>
        </aside>
        <section className="graph-pane"><AgentDecisionGraph run={run} selected={selected} onSelect={selectAgent} /></section>
        <aside className="agent-right-pane">
          <div className="right-tabs">
            <button className={tab === "console" ? "active" : ""} onClick={() => setTab("console")}>VM CONSOLE <small>{selected}</small></button>
            <button className={tab === "reasoning" ? "active" : ""} onClick={() => setTab("reasoning")}>A6 REASONING <small>R{run.decisionRevision}</small></button>
          </div>
          {tab === "console" ? <RocketRideConsole run={run} selectedAgent={selected} /> : <ReasoningLoop run={run} />}
        </aside>
      </div>
      <section className="gate-rail">
        <div className={run.gate.snykStatus === "clean" ? "done" : run.gate.stage === "snyk" ? "active" : ""}><span>01</span><p>SNYK CODE<strong>{run.gate.snykStatus || "queued"}</strong></p></div>
        <i>→</i>
        <div className={run.gate.replayStatus === "passed" ? "done" : run.gate.stage === "sandbox" ? "active" : ""}><span>02</span><p>ONE SANDBOX<strong>{run.gate.replayStatus || "queued"}</strong></p></div>
        <i>→</i>
        <div className={run.gate.pullRequest ? "done" : run.gate.stage === "draft_pr" ? "active" : ""}><span>03</span><p>DRAFT PR<strong>{run.gate.pullRequest ? `#${run.gate.pullRequest.number}` : "queued"}</strong></p></div>
        {run.gate.pullRequest && <a href={run.gate.pullRequest.url} target="_blank" rel="noreferrer">OPEN DRAFT PR ↗</a>}
        <div className="receipt-ticker">{receipts.slice(-4).map((receipt) => <span key={`${receipt.sponsor}-${receipt.id}`}><i className="dot" />{receipt.sponsor} · {receipt.status}</span>)}</div>
      </section>
    </div>
  );
}
