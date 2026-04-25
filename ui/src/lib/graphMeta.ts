import type { GraphEdge, GraphNode } from "../store/useAppStore";

export type GraphNodeMeta = {
  level: number;
  isolated: boolean;
};

export type GraphMetaMap = Map<string, GraphNodeMeta>;

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
  const roots = nodes.filter((node) => !incoming.has(node.id));
  const queue = roots.map((node) => ({ id: node.id, level: 0 }));

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const previous = levels.get(item.id);
    if (previous != null && previous <= item.level) continue;
    levels.set(item.id, item.level);

    for (const childId of outgoing.get(item.id) ?? []) {
      queue.push({ id: childId, level: item.level + 1 });
    }
  }

  const meta: GraphMetaMap = new Map();
  for (const node of nodes) {
    const hasIncoming = incoming.has(node.id);
    const hasOutgoing = outgoing.has(node.id);
    meta.set(node.id, {
      level: levels.get(node.id) ?? 0,
      isolated: !hasIncoming && !hasOutgoing,
    });
  }
  return meta;
}
