import type { GraphEdge, GraphNode } from "../store/useAppStore";

export type GraphNodeMeta = {
  level: number;
  isolated: boolean;
  treeRootId: string;
  treeIndex: number;
  treeColor: string;
};

export type GraphMetaMap = Map<string, GraphNodeMeta>;

export const TREE_COLORS = [
  "#a78bfa",
  "#38bdf8",
  "#f5b84b",
  "#34d399",
  "#fb7185",
  "#60a5fa",
  "#f472b6",
  "#22d3ee",
  "#c084fc",
  "#f97316",
] as const;

const FALLBACK_TREE_COLOR = TREE_COLORS[0];

function byPositionThenId(a: GraphNode, b: GraphNode): number {
  const ax = a.position?.x ?? 0;
  const bx = b.position?.x ?? 0;
  if (ax !== bx) return ax - bx;
  const ay = a.position?.y ?? 0;
  const by = b.position?.y ?? 0;
  if (ay !== by) return ay - by;
  return a.id.localeCompare(b.id);
}

export function deriveGraphMeta(nodes: GraphNode[], edges: GraphEdge[]): GraphMetaMap {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const levels = new Map<string, number>();
  const treeRoots = new Map<string, { rootId: string; index: number; color: string }>();
  const roots = nodes.filter((node) => !incoming.has(node.id)).sort(byPositionThenId);
  const queue = roots.map((node, index) => {
    const color = TREE_COLORS[index % TREE_COLORS.length] ?? FALLBACK_TREE_COLOR;
    treeRoots.set(node.id, { rootId: node.id, index, color });
    return { id: node.id, level: 0, rootId: node.id, treeIndex: index, treeColor: color };
  });

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const previous = levels.get(item.id);
    if (previous != null && previous <= item.level) continue;
    levels.set(item.id, item.level);
    treeRoots.set(item.id, {
      rootId: item.rootId,
      index: item.treeIndex,
      color: item.treeColor,
    });

    for (const childId of outgoing.get(item.id) ?? []) {
      queue.push({
        id: childId,
        level: item.level + 1,
        rootId: item.rootId,
        treeIndex: item.treeIndex,
        treeColor: item.treeColor,
      });
    }
  }

  const meta: GraphMetaMap = new Map();
  const remainingRoots = nodes
    .filter((node) => !treeRoots.has(node.id))
    .sort(byPositionThenId);
  for (const node of remainingRoots) {
    const index = roots.length + remainingRoots.findIndex((root) => root.id === node.id);
    const color = TREE_COLORS[index % TREE_COLORS.length] ?? FALLBACK_TREE_COLOR;
    treeRoots.set(node.id, { rootId: node.id, index, color });
  }

  for (const node of nodes) {
    const hasIncoming = incoming.has(node.id);
    const hasOutgoing = outgoing.has(node.id);
    const tree = treeRoots.get(node.id) ?? {
      rootId: node.id,
      index: 0,
      color: FALLBACK_TREE_COLOR,
    };
    meta.set(node.id, {
      level: levels.get(node.id) ?? 0,
      isolated: !hasIncoming && !hasOutgoing,
      treeRootId: tree.rootId,
      treeIndex: tree.index,
      treeColor: tree.color,
    });
  }
  return meta;
}
