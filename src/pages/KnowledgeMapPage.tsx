import { useEffect, useState } from "react";
import type { BootstrapPayload } from "../../shared/types";
import { KnowledgeGraph } from "../components/KnowledgeGraph";
import { StatusPill } from "../components/StatusPill";

export function KnowledgeMapPage({ data }: { data: BootstrapPayload }) {
  const [selectedKey, setSelectedKey] = useState<string | undefined>(data.knowledge.nodes[0]?.key);
  const selected = data.knowledge.nodes.find((node) => node.key === selectedKey) || data.knowledge.nodes[0];
  const related = selected ? data.knowledge.links.filter((link) => link.sourceKey === selected.key || link.targetKey === selected.key) : [];
  useEffect(() => {
    if (!selectedKey || !data.knowledge.nodes.some((node) => node.key === selectedKey)) setSelectedKey(data.knowledge.nodes[0]?.key);
  }, [data.knowledge.nodes, selectedKey]);
  return (
    <div className="window-page knowledge-page">
      <div className="window-kicker"><span>PIPELINE 04</span><i /> COMPOUNDING MEMORY</div>
      <div className="window-title-row">
        <div><h1>Site knowledge map</h1><p>Verified telemetry → cause → fix → replay → Play → draft PR for one site.</p></div>
        <div className="title-actions"><StatusPill tone="good">HYDRADB DURABLE</StatusPill><span className="run-key mono">{data.knowledge.site.label}</span></div>
      </div>
      <div className="knowledge-layout">
        <section className="knowledge-canvas">
          <div className="knowledge-topline"><span>REACT 3D FORCE GRAPH</span><em>{data.knowledge.nodes.length} NODES · {data.knowledge.links.length} RELATIONSHIPS</em></div>
          <KnowledgeGraph map={data.knowledge} onSelect={(node) => setSelectedKey(node.key)} />
          <div className="knowledge-legend"><span><i style={{ background: "#de7b5c" }} /> error / incident</span><span><i style={{ background: "#62d5a0" }} /> verified fix</span><span><i style={{ background: "#5e8fdc" }} /> Rote Play</span><span><i style={{ background: "#f5a623" }} /> site / PR</span></div>
        </section>
        <aside className="knowledge-inspector">
          {selected ? <>
            <div className="inspector-head"><span>NODE EVIDENCE</span><b>{selected.status.toUpperCase()}</b></div>
            <div className="knowledge-node-icon" style={{ borderColor: selected.color, color: selected.color }}>{selected.kind.slice(0, 2).toUpperCase()}</div>
            <h2>{selected.label}</h2>
            <span className="node-kind">{selected.kind.replaceAll("_", " ")}</span>
            <dl className="property-grid">
              <div><dt>CANONICAL KEY</dt><dd className="wrap-key">{selected.key}</dd></div>
              <div><dt>EVIDENCE COUNT</dt><dd>{selected.evidenceCount}</dd></div>
              <div><dt>SITE SCOPE</dt><dd>{data.knowledge.site.key}</dd></div>
              <div><dt>PROVENANCE</dt><dd>Cognee → HydraDB</dd></div>
            </dl>
            <div className="relationship-list"><span>RELATIONSHIPS</span>{related.map((link) => <div key={link.key}><b>{link.relation}</b><p>{link.sourceKey === selected.key ? link.targetKey : link.sourceKey}</p><i className={link.verified ? "dot" : "dot muted"} /></div>)}</div>
          </> : <div className="empty-inspector"><strong>WAITING FOR SITE MEMORY</strong><p>Captured sessions and incidents will populate this React 3D force graph.</p></div>}
          <div className="memory-proof"><span>MUSCLE MEMORY</span><strong>Run 2 reuses the method,<br />not the old patch.</strong><p>Every adapted Play is rescanned by Snyk and replayed in the sandbox.</p></div>
        </aside>
      </div>
    </div>
  );
}
