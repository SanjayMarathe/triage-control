import type { AgentRun } from "../../shared/types";

const loop = ["INGEST", "SCORE", "CHALLENGE", "PROPOSE", "OBSERVE"];

export function ReasoningLoop({ run }: { run: AgentRun }) {
  const latest = [...run.decisions].sort((a, b) => b.revision - a.revision)[0];
  const latestWeights = run.weights.filter((weight) => weight.revision === run.decisionRevision || weight.revision === Math.max(...run.weights.map((item) => item.revision), 0));
  return (
    <div className="reasoning-panel">
      <div className="reasoning-head">
        <div><span className="eyebrow">A6 / EVENT-DRIVEN LOOP</span><strong>Decision revision {String(run.decisionRevision).padStart(2, "0")}</strong></div>
        <span className="pulse-ring" />
      </div>
      <div className="loop-steps">
        {loop.map((step, index) => <div className={latest?.step === step ? "current" : ""} key={step}><b>{index + 1}</b><span>{step}</span></div>)}
      </div>
      <div className="bounded-note">Bounded, auditable summaries only — no hidden chain-of-thought.</div>
      <div className="weights-title"><span>PROPOSAL WEIGHT</span><em>0—100 PRIORITY</em></div>
      <div className="weight-list">
        {(["A1", "A2", "A3", "A4", "A5"] as const).map((id) => {
          const weight = latestWeights.find((item) => item.agentId === id);
          const score = weight?.score ?? run.agents[id].score ?? 0;
          return (
            <div className={`weight-row ${weight?.proposedNext ? "leader" : ""}`} key={id}>
              <div><b>{id}</b><span>{run.agents[id].strategy}</span><strong>{score}</strong></div>
              <div className="weight-track"><i style={{ width: `${score}%` }} /></div>
              {weight?.proposedNext && <small>NEXT FIX TO GATE</small>}
            </div>
          );
        })}
      </div>
      <div className="next-fix">
        <span>NEXT / CURRENT FIX</span>
        <strong>{run.nextProposal ? `${run.nextProposal.agentId} · ${run.nextProposal.candidateId}` : run.winner ? `${run.winner.agentId} · ${run.winner.candidateId}` : "Waiting for candidates"}</strong>
        <p>{latest?.summary || "A6 will recompute on every candidate or gate event."}</p>
        <div className="reason-codes">{latest?.reasonCodes.map((code) => <em key={code}>{code.replaceAll("_", " ")}</em>)}</div>
      </div>
      <div className="decision-history">
        {[...run.decisions].slice(-4).reverse().map((decision) => (
          <div key={decision.id}><b>R{String(decision.revision).padStart(2, "0")}</b><span>{decision.step}</span><p>{decision.summary}</p></div>
        ))}
      </div>
    </div>
  );
}
