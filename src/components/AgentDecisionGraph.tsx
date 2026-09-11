import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import type { AgentId, AgentRun } from "../../shared/types";

const positions: Record<AgentId, [number, number, number]> = {
  A1: [-140, 100, -10],
  A2: [-140, 50, 10],
  A3: [-140, 0, -10],
  A4: [-140, -50, 10],
  A5: [-140, -100, -10],
  A6: [92, 0, 0],
};

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function AgentDecisionGraph({ run, selected, onSelect }: { run: AgentRun; selected: AgentId; onSelect: (id: AgentId) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const [webgl] = useState(supportsWebGL);
  const graphData = useMemo(() => {
    const nodes = (Object.keys(run.agents) as AgentId[]).map((id) => {
      const [fx, fy, fz] = positions[id];
      return { key: `agent:${run.runKey}:${id}`, agentId: id, label: run.agents[id].strategy, status: run.agents[id].phase, fx, fy, fz };
    });
    const links = (["A1", "A2", "A3", "A4", "A5"] as const).map((id) => {
      const weight = [...run.weights].reverse().find((item) => item.agentId === id);
      return { key: `decision:${run.runKey}:${id}:A6`, sourceKey: `agent:${run.runKey}:${id}`, targetKey: `agent:${run.runKey}:A6`, score: weight?.score ?? run.agents[id].score ?? 0, proposedNext: weight?.proposedNext ?? false };
    });
    return { nodes, links };
  }, [run]);

  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(320, entry.contentRect.width), height: Math.max(400, entry.contentRect.height) }));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    graphRef.current?.cameraPosition?.({ x: 0, y: 0, z: 420 }, { x: -10, y: 0, z: 0 }, 0);
  }, [size]);

  const nodeObject = (node: any) => {
    const id = node.agentId as AgentId;
    const isCenter = id === "A6";
    const isSelected = id === selected;
    const active = ["reasoning", "weighting", "proposing", "gating", "completed", "candidate_ready"].includes(node.status);
    const group = new THREE.Group();
    const geometry = new THREE.IcosahedronGeometry(isCenter ? 13 : isSelected ? 9 : 7, 2);
    const material = new THREE.MeshPhongMaterial({
      color: isCenter ? "#f5a623" : isSelected ? "#f7c86a" : active ? "#62d5a0" : "#576267",
      emissive: isCenter ? "#6a3d08" : isSelected ? "#493819" : "#10251e",
      shininess: 70,
      transparent: true,
      opacity: node.status === "superseded" ? 0.45 : 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    const halo = new THREE.Mesh(new THREE.RingGeometry(isCenter ? 17 : 11, isCenter ? 18 : 12, 48), new THREE.MeshBasicMaterial({ color: isCenter ? "#f5a623" : "#62d5a0", transparent: true, opacity: isSelected || isCenter ? 0.55 : 0.14, side: THREE.DoubleSide }));
    group.add(halo);
    const label = new SpriteText(`${id}  ${node.label}`);
    label.color = id === "A6" ? "#ffd78e" : "#e8ecea";
    label.textHeight = isCenter ? 6.5 : 5;
    label.position.set(0, isCenter ? 23 : 16, 0);
    label.backgroundColor = "rgba(9,12,13,.78)";
    label.padding = 2;
    group.add(label);
    const status = new SpriteText(String(node.status).toUpperCase().replaceAll("_", " "));
    status.color = "#8c969c";
    status.textHeight = 3.2;
    status.position.set(0, isCenter ? -22 : -15, 0);
    group.add(status);
    return group;
  };

  return (
    <div className="agent-graph-host" ref={host}>
      <div className="graph-caption"><span>FIVE PARALLEL FIX VMS</span><i /> <span>A6 SYNTHESIS + PR</span></div>
      {webgl ? (
        <ForceGraph3D
          ref={graphRef}
          width={size.width}
          height={size.height}
          graphData={graphData}
          nodeId="key"
          linkSource="sourceKey"
          linkTarget="targetKey"
          nodeThreeObject={nodeObject}
          nodeThreeObjectExtend={false}
          nodeLabel={(node: any) => `${node.agentId} · ${node.label} · ${node.status}`}
          linkWidth={(link: any) => 0.8 + (link.score / 100) * 3}
          linkColor={(link: any) => link.proposedNext ? "#f5a623" : "#40504d"}
          linkOpacity={0.75}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={0.9}
          linkDirectionalParticles={(link: any) => link.proposedNext ? 3 : 0}
          linkDirectionalParticleWidth={2.5}
          linkDirectionalParticleColor={() => "#f5a623"}
          backgroundColor="#0b0e0f"
          showNavInfo={false}
          enableNodeDrag={false}
          cooldownTicks={0}
          onNodeClick={(node: any) => onSelect(node.agentId)}
        />
      ) : (
        <div className="graph-fallback" role="img" aria-label="Five fix agents connect to the A6 synthesis agent">
          <svg viewBox="0 0 700 560" aria-hidden="true">
            {[90,185,280,375,470].map((y, index) => <line key={y} x1="155" y1={y} x2="515" y2="280" className={run.nextProposal?.agentId === `A${index + 1}` ? "leading" : ""} />)}
          </svg>
          {(["A1", "A2", "A3", "A4", "A5", "A6"] as AgentId[]).map((id, index) => <button key={id} className={`${id === "A6" ? "center" : ""} ${id === selected ? "selected" : ""}`} style={id === "A6" ? undefined : { top: `${7 + index * 17}%` }} onClick={() => onSelect(id)}><b>{id}</b><span>{run.agents[id].strategy}</span></button>)}
        </div>
      )}
      <div className="graph-legend"><span><i className="good" /> candidate ready</span><span><i className="lead" /> proposed next</span><span>click a node to inspect</span></div>
    </div>
  );
}
