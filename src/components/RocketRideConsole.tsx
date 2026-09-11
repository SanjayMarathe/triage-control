import type { AgentId, AgentRun } from "../../shared/types";

function time(value: string) {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hour12: false }).format(new Date(value));
}

export function RocketRideConsole({ run, selectedAgent }: { run: AgentRun; selectedAgent: AgentId }) {
  const logs = run.logs.filter((entry) => entry.agentId === selectedAgent).sort((a, b) => a.seq - b.seq);
  const agent = run.agents[selectedAgent];
  return (
    <section className="console-panel" aria-label={`${agent.strategy} RocketRide VM console`}>
      <div className="console-toolbar">
        <div><i className="dot" /><strong>{agent.vm}</strong></div>
        <span>OUTPUT · FLOW · SSE</span>
      </div>
      <div className="console-body">
        {logs.length === 0 ? <div className="console-empty">$ waiting for RocketRide events<span className="cursor">_</span></div> : logs.map((entry) => (
          <div className={`console-line ${entry.category}`} key={entry.id}>
            <time>{time(entry.timestamp)}</time>
            <b>{entry.source}</b>
            <span>{entry.message}</span>
          </div>
        ))}
      </div>
      <footer><span>task {run.taskToken}</span><span>trace {run.traceLevel}</span></footer>
    </section>
  );
}
