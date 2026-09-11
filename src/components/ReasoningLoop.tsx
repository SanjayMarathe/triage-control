import type { AgentRun } from "../../shared/types";

const loop = ["INGEST", "SCORE", "CHALLENGE", "PROPOSE", "OBSERVE"];
const agentText = (text: string) => text.replace(/\bA([1-5])\b/g, "Agent $1").replace(/\bA6\b/g, "Synthesizer");

export function ReasoningLoop({ run }: { run: AgentRun }) {
  const latest = [...run.decisions].sort((a, b) => b.revision - a.revision)[0];
  const latestWeights = run.weights.filter((weight) => weight.revision === run.decisionRevision || weight.revision === Math.max(...run.weights.map((item) => item.revision), 0));
  return (
    <div className="reasoning-panel">
      <div className="reasoning-head">
        <div><span className="eyebrow">SYNTHESIZER / EVENT-DRIVEN LOOP</span><strong>Decision revision {String(run.decisionRevision).padStart(2, "0")}</strong></div>
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
              <div><b>{run.agents[id].strategy}</b><span>{run.agents[id].phase.replaceAll("_", " ")}</span><strong>{score}</strong></div>
              <div className="weight-track"><i style={{ width: `${score}%` }} /></div>
              {weight?.proposedNext && <small>NEXT FIX TO GATE</small>}
            </div>
          );
        })}
      </div>
      <div className="next-fix">
        <span>NEXT / CURRENT FIX</span>
        <strong>{run.nextProposal ? `${run.agents[run.nextProposal.agentId].strategy} · ${run.nextProposal.candidateId}` : run.winner ? `${run.agents[run.winner.agentId].strategy} · ${run.winner.candidateId}` : "Waiting for candidates"}</strong>
        <p>{latest ? agentText(latest.summary) : "The Synthesizer will recompute on every candidate or gate event."}</p>
        <div className="reason-codes">{latest?.reasonCodes.map((code) => <em key={code}>{code.replaceAll("_", " ")}</em>)}</div>
      </div>
      <div className="decision-history">
        {[...run.decisions].slice(-4).reverse().map((decision) => (
          <div key={decision.id}><b>R{String(decision.revision).padStart(2, "0")}</b><span>{decision.step}</span><p>{agentText(decision.summary)}</p></div>
        ))}
      </div>
    </div>
  );
}
