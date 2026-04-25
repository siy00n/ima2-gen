import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  ReactFlowProvider,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type OnConnectEnd,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAppStore, type GraphNode, type GraphEdge } from "../store/useAppStore";
import { ImageNode } from "./ImageNode";
import { WorkflowEdge } from "./WorkflowEdge";
import { WorkflowMiniMap } from "./WorkflowMiniMap";
import { deriveGraphMeta } from "../lib/graphMeta";
import { useI18n } from "../i18n";

function NodeCanvasInner() {
  const { t } = useI18n();
  const nodes = useAppStore((s) => s.graphNodes);
  const edges = useAppStore((s) => s.graphEdges);
  const setGraphNodes = useAppStore((s) => s.setGraphNodes);
  const setGraphEdges = useAppStore((s) => s.setGraphEdges);
  const addRootNode = useAppStore((s) => s.addRootNode);
  const addChildNodeAt = useAppStore((s) => s.addChildNodeAt);
  const connectNodes = useAppStore((s) => s.connectNodes);
  const deleteNodes = useAppStore((s) => s.deleteNodes);
  const selectNode = useAppStore((s) => s.selectNode);
  const selectEdge = useAppStore((s) => s.selectEdge);
  const detachNodeFromParent = useAppStore((s) => s.detachNodeFromParent);
  const sessionLoading = useAppStore((s) => s.sessionLoading);

  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const nodeTypes = useMemo(() => ({ imageNode: ImageNode }), []);
  const edgeTypes = useMemo(() => ({ workflowEdge: WorkflowEdge }), []);
  const graphMeta = useMemo(() => deriveGraphMeta(nodes, edges), [nodes, edges]);
  const displayNodes = useMemo(
    () =>
      nodes.map((node) => {
        const meta = graphMeta.get(node.id) ?? { level: 0, isolated: true };
        return {
          ...node,
          data: {
            ...node.data,
            graphLevel: meta.level,
            graphIsolated: meta.isolated,
          },
        };
      }),
    [nodes, graphMeta],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setGraphNodes(applyNodeChanges(changes, nodes) as GraphNode[]),
    [nodes, setGraphNodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setGraphEdges(applyEdgeChanges(changes, edges) as GraphEdge[]),
    [edges, setGraphEdges],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (params.source && params.target) connectNodes(params.source, params.target);
    },
    [connectNodes],
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (connectionState.isValid) return;
      const fromNodeId = connectionState.fromNode?.id;
      if (!fromNodeId) return;
      const clientX =
        "touches" in event ? event.changedTouches[0].clientX : (event as MouseEvent).clientX;
      const clientY =
        "touches" in event ? event.changedTouches[0].clientY : (event as MouseEvent).clientY;
      const pos = screenToFlowPosition({ x: clientX, y: clientY });
      addChildNodeAt(fromNodeId, pos);
    },
    [addChildNodeAt, screenToFlowPosition],
  );

  const onNodesDelete = useCallback(
    (deleted: GraphNode[]) => deleteNodes(deleted.map((n) => n.id)),
    [deleteNodes],
  );
  const onEdgesDelete = useCallback(
    (deleted: GraphEdge[]) => {
      for (const edge of deleted) detachNodeFromParent(edge.target);
    },
    [detachNodeFromParent],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") selectNode(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectNode]);

  return (
    <main className="node-canvas" ref={wrapperRef}>
      {sessionLoading && <div className="node-canvas__loading">{t("nodeCanvas.loading")}</div>}
      {nodes.length === 0 ? (
        <button type="button" className="node-canvas__plus" onClick={() => addRootNode()}>
          {t("nodeCanvas.addFirst")}
        </button>
      ) : (
        <>
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            onNodeClick={(_, node) => selectNode(node.id)}
            onEdgeClick={(_, edge) => selectEdge(edge.id)}
            onPaneClick={() => selectNode(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            deleteKeyCode={["Delete", "Backspace"]}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} color="#2a2a2a" />
            <Controls className="node-canvas__controls" />
            <WorkflowMiniMap nodes={displayNodes} edges={edges} graphMeta={graphMeta} />
          </ReactFlow>
          <button
            type="button"
            className="node-canvas__add-root"
            onClick={() => addRootNode()}
            title={t("nodeCanvas.addRootTitle")}
          >
            +
          </button>
          <div className="node-canvas__hint">
            {t("nodeCanvas.hint")}
          </div>
        </>
      )}
    </main>
  );
}

export function NodeCanvas() {
  return (
    <ReactFlowProvider>
      <NodeCanvasInner />
    </ReactFlowProvider>
  );
}
