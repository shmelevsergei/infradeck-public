"use client";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
export function Topology({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const router = useRouter();
  return (
    <div className="graph">
      <ReactFlow
        colorMode="dark"
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.15}
        onNodeDoubleClick={(_, n) => router.push(String(n.data.href))}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
