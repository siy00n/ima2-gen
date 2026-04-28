import { cloneNodeSettings, normalizeEdgeTransferData, syncEffectiveNodeSettings } from "../lib/nodeDelivery";
import type { ClientNodeId } from "../lib/graph";
import {
  normalizeGraphParentPointers,
  type GraphEdge,
  type GraphNode,
  type ImageNodeData,
} from "./nodeGraphHelpers";
import type { AppState } from "./useAppStore";

export const GRAPH_HISTORY_LIMIT = 50;

export type GraphSnapshot = {
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  selectedNodeId: ClientNodeId | null;
  selectedEdgeId: string | null;
};

function cloneGraphNodeForSnapshot(node: GraphNode): GraphNode {
  return {
    ...node,
    position: { ...node.position },
    data: {
      ...node.data,
      settings: cloneNodeSettings(node.data.settings),
    },
  };
}

function cloneGraphEdgeForSnapshot(edge: GraphEdge): GraphEdge {
  return {
    ...edge,
    data: normalizeEdgeTransferData(edge.data),
  };
}

export function takeGraphSnapshot(
  s: Pick<AppState, "graphNodes" | "graphEdges" | "selectedNodeId" | "selectedEdgeId">,
): GraphSnapshot {
  return {
    graphNodes: s.graphNodes.map(cloneGraphNodeForSnapshot),
    graphEdges: s.graphEdges.map(cloneGraphEdgeForSnapshot),
    selectedNodeId: s.selectedNodeId,
    selectedEdgeId: s.selectedEdgeId,
  };
}

export function hasPendingGraphNodes(nodes: GraphNode[]): boolean {
  return nodes.some((node) => node.data.status === "pending" || node.data.status === "reconciling");
}

export function clearGraphHistoryPatch(): Pick<
  AppState,
  "graphUndoPast" | "graphUndoFuture" | "canUndoGraph" | "canRedoGraph"
> {
  return {
    graphUndoPast: [],
    graphUndoFuture: [],
    canUndoGraph: false,
    canRedoGraph: false,
  };
}

export function graphHistoryPatch(
  graphUndoPast: GraphSnapshot[],
  graphUndoFuture: GraphSnapshot[],
): Pick<AppState, "graphUndoPast" | "graphUndoFuture" | "canUndoGraph" | "canRedoGraph"> {
  return {
    graphUndoPast,
    graphUndoFuture,
    canUndoGraph: graphUndoPast.length > 0,
    canRedoGraph: graphUndoFuture.length > 0,
  };
}

export function pushGraphUndoPatch(s: AppState): Pick<
  AppState,
  "graphUndoPast" | "graphUndoFuture" | "canUndoGraph" | "canRedoGraph"
> {
  if (hasPendingGraphNodes(s.graphNodes)) {
    return graphHistoryPatch(s.graphUndoPast, []);
  }
  const graphUndoPast = [...s.graphUndoPast, takeGraphSnapshot(s)].slice(-GRAPH_HISTORY_LIMIT);
  return graphHistoryPatch(graphUndoPast, []);
}

export function commitUserGraphChange(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
  patch: Partial<AppState>,
): void {
  set({
    ...patch,
    ...pushGraphUndoPatch(get()),
  });
  get().scheduleGraphSave();
}

const NODE_RUNTIME_DATA_KEYS: Array<keyof ImageNodeData> = [
  "serverNodeId",
  "imageUrl",
  "status",
  "pendingRequestId",
  "pendingPhase",
  "pendingStartedAt",
  "error",
  "elapsed",
  "webSearchCalls",
  "filename",
  "provider",
  "quality",
  "size",
  "format",
  "moderation",
  "model",
  "usage",
  "createdAt",
];

function mergeCurrentRuntimeData(snapshotNode: GraphNode, currentNode: GraphNode | undefined): GraphNode {
  const next = cloneGraphNodeForSnapshot(snapshotNode);
  if (!currentNode) return next;
  if (snapshotNode.data.imageReferenceDetached || currentNode.data.imageReferenceDetached) {
    return next;
  }
  if (snapshotNode.data.assetSource === "upload" || currentNode.data.assetSource === "upload") {
    return next;
  }
  const data = { ...next.data };
  for (const key of NODE_RUNTIME_DATA_KEYS) {
    (data as Record<string, unknown>)[key] = (currentNode.data as Record<string, unknown>)[key];
  }
  return {
    ...next,
    data,
  };
}

export function restoreGraphSnapshot(snapshot: GraphSnapshot, currentNodes: GraphNode[]): GraphSnapshot {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  const graphEdges = snapshot.graphEdges.map(cloneGraphEdgeForSnapshot);
  const restoredNodes = snapshot.graphNodes.map((node) =>
    mergeCurrentRuntimeData(node, currentById.get(node.id)),
  );
  const graphNodes = syncEffectiveNodeSettings(
    normalizeGraphParentPointers(restoredNodes, graphEdges),
    graphEdges,
  );
  return {
    graphNodes,
    graphEdges,
    selectedNodeId: snapshot.selectedNodeId,
    selectedEdgeId: snapshot.selectedEdgeId,
  };
}
