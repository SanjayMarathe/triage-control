import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import type { KnowledgeMap, KnowledgeNode } from "../../shared/types";

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function KnowledgeGraph({ map, onSelect }: { map: KnowledgeMap; onSelect: (node: KnowledgeNode) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [size, setSize] = useState({ width: 800, height: 660 });
  const [webgl] = useState(supportsWebGL);
  const data = useMemo(() => {
    const byKind: Record<string, Array<[number, number, number]>> = {
      site: [[-175, 0, 0]],
      session: [[-128, 78, 12]],
      action: [[-125, -82, -8]],
      incident: [[-70, 62, -8], [-78, 105, 16]],
      component: [[-62, -88, 12]],
      error: [[-60, -22, 0]],
      cause: [[12, -22, -10]],
      fix: [[78, -16, 0], [82, 42, 13]],
      snyk: [[152, -86, -8]],
      replay: [[165, -36, 10]],
      play: [[162, 22, -8]],
      pull_request: [[155, 80, 10], [188, 105, -10]],
    };
    const counts: Record<string, number> = {};
    const nodes = map.nodes.map((node) => {
      const occurrence = counts[node.kind] || 0;
      counts[node.kind] = occurrence + 1;
      const slots = byKind[node.kind] || [[occurrence * 25, occurrence * 20, 0]];
      const [fx, fy, fz] = slots[Math.min(occurrence, slots.length - 1)];
      const x = fx + (occurrence >= slots.length ? occurrence * 14 : 0);
      return { ...node, x, y: fy, z: fz, fx: x, fy, fz };
    });
    return { nodes, links: map.links.map((link) => ({ ...link })) };
  }, [map]);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { graphRef.current?.cameraPosition?.({ x: 0, y: 0, z: 440 }, { x: 0, y: 0, z: 0 }, 0); }, [size]);
  return (
    <div className="knowledge-graph" ref={host}>
      {webgl ? <ForceGraph3D
        ref={graphRef}
        width={size.width}
        height={size.height}
        graphData={data}
        nodeId="key"
        linkSource="sourceKey"
        linkTarget="targetKey"
        nodeVal="val"
        nodeColor="color"
        nodeOpacity={0.95}
        nodeThreeObject={(node: any) => {
          const group = new THREE.Group();
          group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(Math.max(4, node.val / 1.3), 1), new THREE.MeshPhongMaterial({ color: node.color, emissive: node.color, emissiveIntensity: 0.15 })));
          const label = new SpriteText(node.label);
          label.color = "#e8ecea";
          label.textHeight = 4;
          label.position.y = Math.max(10, node.val + 5);
          label.backgroundColor = "rgba(9,12,13,.7)";
          label.padding = 1.5;
          group.add(label);
          return group;
        }}
        linkLabel="relation"
        linkColor={(link: any) => link.verified ? "#62d5a0" : "#3f494c"}
        linkWidth={(link: any) => link.verified ? 1.4 : 0.6}
        linkDirectionalArrowLength={3}
        linkDirectionalParticles={(link: any) => link.verified ? 1 : 0}
        linkDirectionalParticleWidth={1.7}
        backgroundColor="#0b0e0f"
        showNavInfo={false}
        enableNodeDrag={false}
        onNodeClick={(node: any) => onSelect(node)}
      /> : <div className="knowledge-fallback" role="img" aria-label="Site knowledge graph fallback">
        <div className="fallback-path" aria-hidden="true">TELEMETRY <i>→</i> ERROR <i>→</i> CAUSE <i>→</i> FIX <i>→</i> EVIDENCE <i>→</i> PR</div>
        {map.nodes.map((node) => <button key={node.key} style={{ borderColor: node.color }} onClick={() => onSelect(node)}><i style={{ background: node.color }} /><span>{node.kind}</span><strong>{node.label}</strong></button>)}
      </div>}
    </div>
  );
}
