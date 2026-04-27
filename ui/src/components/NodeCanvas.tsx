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
import { useIsMobile } from "../hooks/useIsMobile";

type GraphHistorySurface = {
  undoGraph?: () => void;
  redoGraph?: () => void;
  canUndoGraph?: boolean | (() => boolean);
  canRedoGraph?: boolean | (() => boolean);
  graphHistoryPending?: boolean;
  isGraphHistoryPending?: boolean;
  pendingGraphOperation?: boolean;
};

function readBooleanFlag(value: boolean | (() => boolean) | undefined): boolean {
  return typeof value === "function" ? value() : Boolean(value);
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function NodeCanvasInner() {
  const { t } = useI18n();
  const isMobile = useIsMobile();
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
  const openEdgePopover = useAppStore((s) => s.openEdgePopover);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const detachNodeFromParent = useAppStore((s) => s.detachNodeFromParent);
  const sessionLoading = useAppStore((s) => s.sessionLoading);
  const undoGraph = useAppStore((s) => (s as typeof s & GraphHistorySurface).undoGraph);
  const redoGraph = useAppStore((s) => (s as typeof s & GraphHistorySurface).redoGraph);
  const canUndoGraph = useAppStore((s) =>
    readBooleanFlag((s as typeof s & GraphHistorySurface).canUndoGraph),
  );
  const canRedoGraph = useAppStore((s) =>
    readBooleanFlag((s as typeof s & GraphHistorySurface).canRedoGraph),
  );
  const graphHistoryPending = useAppStore((s) => {
    const history = s as typeof s & GraphHistorySurface;
    return Boolean(
      history.graphHistoryPending ||
        history.isGraphHistoryPending ||
        history.pendingGraphOperation,
    );
  });
  const hasPendingNode = useMemo(
    () => nodes.some((node) => node.data.status === "pending" || node.data.status === "reconciling"),
    [nodes],
  );

  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const nodeTypes = useMemo(() => ({ imageNode: ImageNode }), []);
  const edgeTypes = useMemo(() => ({ workflowEdge: WorkflowEdge }), []);
  const graphMeta = useMemo(() => deriveGraphMeta(nodes, edges), [nodes, edges]);
  const displayNodes = useMemo(
    () =>
      nodes.map((node) => {
        const meta = graphMeta.get(node.id) ?? {
          level: 0,
          isolated: true,
          treeRootId: node.id,
          treeIndex: 0,
          treeColor: "#a78bfa",
        };
        return {
          ...node,
          selected: node.id === selectedNodeId,
          data: {
            ...node.data,
            graphLevel: meta.level,
            graphIsolated: meta.isolated,
            graphTreeRootId: meta.treeRootId,
            graphTreeIndex: meta.treeIndex,
            graphTreeColor: meta.treeColor,
          },
        };
      }),
    [nodes, graphMeta, selectedNodeId],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (changes.every((change) => change.type === "select")) return;
      setGraphNodes(applyNodeChanges(changes, nodes) as GraphNode[]);
    },
    [nodes, setGraphNodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (changes.every((change) => change.type === "select")) return;
      setGraphEdges(applyEdgeChanges(changes, edges) as GraphEdge[]);
    },
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
      if (event.key === "Escape") {
        selectNode(null);
        return;
      }
      if (isEditableShortcutTarget(event.target) || graphHistoryPending || hasPendingNode || sessionLoading) return;
      const key = event.key.toLowerCase();
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod) return;
      if (key === "z" && event.shiftKey) {
        if (!canRedoGraph || !redoGraph) return;
        event.preventDefault();
        redoGraph();
        return;
      }
      if (key === "z") {
        if (!canUndoGraph || !undoGraph) return;
        event.preventDefault();
        undoGraph();
        return;
      }
      if (key === "y") {
        if (!canRedoGraph || !redoGraph) return;
        event.preventDefault();
        redoGraph();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    canRedoGraph,
    canUndoGraph,
    graphHistoryPending,
    hasPendingNode,
    redoGraph,
    selectNode,
    sessionLoading,
    undoGraph,
  ]);

  const historyControlsDisabled = graphHistoryPending || hasPendingNode || sessionLoading;

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
            onEdgeClick={(_, edge) => {
              if (isMobile) selectEdge(edge.id);
              else openEdgePopover(edge.id);
            }}
            onPaneClick={() => selectNode(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionRadius={isMobile ? 20 : 48}
            connectionDragThreshold={isMobile ? 1 : 3}
            fitView
            deleteKeyCode={["Delete", "Backspace"]}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} color="#2a2a2a" />
            <Controls className="node-canvas__controls" />
            <WorkflowMiniMap nodes={displayNodes} edges={edges} graphMeta={graphMeta} />
          </ReactFlow>
          <div className="node-canvas__top-actions">
            <div className="node-canvas__history-toolbar" role="group" aria-label={t("nodeCanvas.historyToolbar")}>
              <button
                type="button"
                onClick={() => undoGraph?.()}
                disabled={historyControlsDisabled || !canUndoGraph || !undoGraph}
                title={t("nodeCanvas.undoTitle")}
                aria-label={t("nodeCanvas.undo")}
              >
                ↶
              </button>
              <button
                type="button"
                onClick={() => redoGraph?.()}
                disabled={historyControlsDisabled || !canRedoGraph || !redoGraph}
                title={t("nodeCanvas.redoTitle")}
                aria-label={t("nodeCanvas.redo")}
              >
                ↷
              </button>
            </div>
            <button
              type="button"
              className="node-canvas__add-root"
              onClick={() => addRootNode()}
              title={t("nodeCanvas.addRootTitle")}
            >
              +
            </button>
          </div>
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
