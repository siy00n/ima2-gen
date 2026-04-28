import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";
import type { Format, GenerateItem, ImageModel, Moderation, Quality, SizePreset } from "../types";
import type { HistoryItem, SessionFull } from "../lib/api";
import { snap16 } from "../lib/size";
import { type ClientNodeId } from "../lib/graph";
import {
  DEFAULT_EDGE_TRANSFER,
  FALLBACK_NODE_SETTINGS,
  TEXT_ONLY_EDGE_TRANSFER,
  buildNodeGenerateDelivery as buildNodeGenerateDeliveryCore,
  normalizeEdgeTransferData,
  sameNodeSettings,
  syncEffectiveNodeSettings,
  type EdgeTransferData,
  type NodeGenerateDelivery,
  type NodeSettings,
} from "../lib/nodeDelivery";
import { t } from "../i18n";

export const QUALITY_VALUES: Quality[] = ["low", "medium", "high"];
export const FORMAT_VALUES: Format[] = ["png", "jpeg", "webp"];
export const MODERATION_VALUES: Moderation[] = ["low", "auto"];
export const SIZE_PRESET_VALUES: SizePreset[] = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "1360x1024",
  "1024x1360",
  "1824x1024",
  "1024x1824",
  "2048x2048",
  "2048x1152",
  "1152x2048",
  "3824x2160",
  "2160x3824",
  "auto",
  "custom",
];
export const IMAGE_MODEL_VALUES: ImageModel[] = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"];

function hasStringValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function parseSizeSetting(size: unknown): Pick<NodeSettings, "sizePreset" | "customW" | "customH"> | null {
  if (hasStringValue(SIZE_PRESET_VALUES, size)) {
    return {
      sizePreset: size,
      customW: FALLBACK_NODE_SETTINGS.customW,
      customH: FALLBACK_NODE_SETTINGS.customH,
    };
  }
  if (typeof size !== "string") return null;
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  return {
    sizePreset: "custom",
    customW: snap16(Number(match[1])),
    customH: snap16(Number(match[2])),
  };
}

export type ImageNodeStatus =
  | "empty"
  | "pending"
  | "reconciling"
  | "ready"
  | "canceled"
  | "stale"
  | "asset-missing"
  | "error";

export type ImageNodeData = {
  clientId: ClientNodeId;
  serverNodeId: string | null;
  parentServerNodeId: string | null;
  name?: string;
  prompt: string;
  imageUrl: string | null;
  status: ImageNodeStatus;
  pendingRequestId: string | null;
  pendingPhase?: string | null;
  pendingStartedAt?: number | null;
  error?: string;
  elapsed?: number;
  webSearchCalls?: number;
  filename?: string;
  provider?: string;
  quality?: string;
  size?: string;
  format?: string;
  moderation?: string;
  model?: string;
  assetSource?: "upload";
  imageReferenceDetached?: true;
  settings: NodeSettings;
  usage?: GenerateItem["usage"];
  createdAt?: number;
  graphLevel?: number;
  graphIsolated?: boolean;
  graphTreeRootId?: string;
  graphTreeIndex?: number;
  graphTreeColor?: string;
};

export type GraphNode = FlowNode<ImageNodeData>;
export type GraphEdge = FlowEdge<EdgeTransferData>;

export function createGraphEdge(
  source: ClientNodeId,
  target: ClientNodeId,
  data: Partial<EdgeTransferData> = DEFAULT_EDGE_TRANSFER,
): GraphEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    type: "workflowEdge",
    data: normalizeEdgeTransferData(data),
  };
}

export function currentNodeSettings(
  s: Pick<AppLikeSettings, "model" | "quality" | "sizePreset" | "customW" | "customH" | "format" | "moderation">,
): NodeSettings {
  return {
    model: s.model,
    quality: s.quality,
    sizePreset: s.sizePreset,
    customW: s.customW,
    customH: s.customH,
    format: s.format,
    moderation: s.moderation,
  };
}

type AppLikeSettings = {
  model: ImageModel;
  quality: Quality;
  sizePreset: SizePreset;
  customW: number;
  customH: number;
  format: Format;
  moderation: Moderation;
};

export function normalizeNodeSettings(raw: unknown, fallback: NodeSettings = FALLBACK_NODE_SETTINGS): NodeSettings {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    model: hasStringValue(IMAGE_MODEL_VALUES, obj.model) ? obj.model : fallback.model,
    quality: hasStringValue(QUALITY_VALUES, obj.quality) ? obj.quality : fallback.quality,
    sizePreset: hasStringValue(SIZE_PRESET_VALUES, obj.sizePreset)
      ? obj.sizePreset
      : fallback.sizePreset,
    customW: typeof obj.customW === "number" ? snap16(obj.customW) : fallback.customW,
    customH: typeof obj.customH === "number" ? snap16(obj.customH) : fallback.customH,
    format: hasStringValue(FORMAT_VALUES, obj.format) ? obj.format : fallback.format,
    moderation: hasStringValue(MODERATION_VALUES, obj.moderation)
      ? obj.moderation
      : fallback.moderation,
  };
}

function settingsFromNodeData(d: Partial<ImageNodeData>): NodeSettings {
  const legacySize = parseSizeSetting(d.size);
  const legacyFallback: NodeSettings = {
    model: hasStringValue(IMAGE_MODEL_VALUES, d.model) ? d.model : FALLBACK_NODE_SETTINGS.model,
    quality: hasStringValue(QUALITY_VALUES, d.quality) ? d.quality : FALLBACK_NODE_SETTINGS.quality,
    sizePreset: legacySize?.sizePreset ?? FALLBACK_NODE_SETTINGS.sizePreset,
    customW: legacySize?.customW ?? FALLBACK_NODE_SETTINGS.customW,
    customH: legacySize?.customH ?? FALLBACK_NODE_SETTINGS.customH,
    format: hasStringValue(FORMAT_VALUES, d.format) ? d.format : FALLBACK_NODE_SETTINGS.format,
    moderation: hasStringValue(MODERATION_VALUES, d.moderation)
      ? d.moderation
      : FALLBACK_NODE_SETTINGS.moderation,
  };
  return normalizeNodeSettings(d.settings, legacyFallback);
}

export function nextNodeName(nodes: GraphNode[]): string {
  const used = new Set(
    nodes
      .map((node) => node.data.name?.trim())
      .filter((name): name is string => Boolean(name)),
  );
  for (let index = 1; ; index += 1) {
    const name = `Node ${index}`;
    if (!used.has(name)) return name;
  }
}

export function canUseNodeAsBranchParent(data: Pick<ImageNodeData, "status">): boolean {
  return data.status !== "pending" && data.status !== "reconciling";
}

export function canAttachImageToNodeData(
  data: Pick<ImageNodeData, "status" | "serverNodeId" | "imageUrl">,
): boolean {
  return data.status === "empty" && !data.serverNodeId && !data.imageUrl;
}

export function canRemoveNodeImageReference(
  data: Pick<ImageNodeData, "status" | "serverNodeId" | "imageUrl" | "filename">,
): boolean {
  if (data.status === "pending" || data.status === "reconciling") return false;
  return !!data.serverNodeId || !!data.imageUrl || !!data.filename;
}

function hasReadyNodeImage(data: Pick<ImageNodeData, "status" | "serverNodeId">): boolean {
  return data.status === "ready" && !!data.serverNodeId;
}

function edgeTransferForParent(parent: GraphNode): EdgeTransferData {
  return hasReadyNodeImage(parent.data) ? DEFAULT_EDGE_TRANSFER : TEXT_ONLY_EDGE_TRANSFER;
}

export function createChildEdge(parent: GraphNode, target: ClientNodeId): GraphEdge {
  return createGraphEdge(parent.id as ClientNodeId, target, edgeTransferForParent(parent));
}

export const SUPPORTED_NODE_ATTACH_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function nodeAttachMimeForFile(file: File): string | null {
  if (SUPPORTED_NODE_ATTACH_TYPES.has(file.type)) return file.type;
  if (/\.png$/i.test(file.name)) return "image/png";
  if (/\.jpe?g$/i.test(file.name)) return "image/jpeg";
  if (/\.webp$/i.test(file.name)) return "image/webp";
  return null;
}

export function isSupportedNodeAttachFile(file: File): boolean {
  return nodeAttachMimeForFile(file) !== null;
}

export function normalizeNodeAttachDataUrl(file: File, dataUrl: string): string {
  const mime = nodeAttachMimeForFile(file);
  if (!mime) return dataUrl;
  return dataUrl.replace(/^data:[^;]*;base64,/i, `data:${mime};base64,`);
}

export function nodeSettingsFromEmbeddedMetadata(
  metadata: Record<string, unknown> | null | undefined,
  fallback: NodeSettings,
): NodeSettings | null {
  if (!metadata) return null;
  const parsedSize = parseSizeSetting(metadata.size);
  const settings = normalizeNodeSettings(
    {
      model: metadata.model,
      quality: metadata.quality,
      sizePreset: parsedSize?.sizePreset,
      customW: parsedSize?.customW,
      customH: parsedSize?.customH,
      format: metadata.format,
      moderation: metadata.moderation,
    },
    fallback,
  );
  return sameNodeSettings(settings, fallback) ? null : settings;
}

export function promptFromEmbeddedMetadata(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  for (const key of ["userPrompt", "prompt"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("File read failed"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

export type NodePosition = { x: number; y: number };
export type GenerateNodeOptions = { selectOnComplete?: boolean; branchRootId?: ClientNodeId };

const NODE_PLACEMENT_WIDTH = 282;
const NODE_PLACEMENT_HEIGHT = 260;
const NODE_PLACEMENT_MARGIN = 24;
const NODE_CHILD_X_OFFSET = NODE_PLACEMENT_WIDTH + NODE_PLACEMENT_MARGIN * 2 + 8;
const NODE_PLACEMENT_ROW_STEP = NODE_PLACEMENT_HEIGHT + NODE_PLACEMENT_MARGIN * 2;
const NODE_PLACEMENT_COL_STEP = NODE_CHILD_X_OFFSET;

function placementRect(position: NodePosition) {
  return {
    left: position.x - NODE_PLACEMENT_MARGIN,
    top: position.y - NODE_PLACEMENT_MARGIN,
    right: position.x + NODE_PLACEMENT_WIDTH + NODE_PLACEMENT_MARGIN,
    bottom: position.y + NODE_PLACEMENT_HEIGHT + NODE_PLACEMENT_MARGIN,
  };
}

function rectsOverlap(a: ReturnType<typeof placementRect>, b: ReturnType<typeof placementRect>): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function isNodePositionFree(position: NodePosition, nodes: GraphNode[]): boolean {
  const candidate = placementRect(position);
  return !nodes.some((node) => rectsOverlap(candidate, placementRect(node.position)));
}

export function findNearbyFreeNodePosition(preferred: NodePosition, nodes: GraphNode[]): NodePosition {
  const rowOffsets = [0];
  for (let row = 1; row <= 10; row += 1) {
    rowOffsets.push(row * NODE_PLACEMENT_ROW_STEP, -row * NODE_PLACEMENT_ROW_STEP);
  }

  for (let col = 0; col <= 10; col += 1) {
    for (const yOffset of rowOffsets) {
      const candidate = {
        x: preferred.x + col * NODE_PLACEMENT_COL_STEP,
        y: preferred.y + yOffset,
      };
      if (isNodePositionFree(candidate, nodes)) return candidate;
    }
  }

  return {
    x: preferred.x + NODE_PLACEMENT_COL_STEP * 11,
    y: preferred.y,
  };
}

export function preferredChildPosition(parent: GraphNode): NodePosition {
  return {
    x: parent.position.x + NODE_CHILD_X_OFFSET,
    y: parent.position.y,
  };
}

export function normalizeGraphParentPointers(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map(edges.map((edge) => [edge.target, edge]));

  return nodes.map((node) => {
    const incoming = incomingByTarget.get(node.id);
    const parent = incoming ? nodeById.get(incoming.source) : null;
    const incomingData = incoming ? normalizeEdgeTransferData(incoming.data) : null;
    const nextParentServerNodeId =
      incomingData?.imageTransfer === "off" ? null : parent?.data.serverNodeId ?? null;
    if (node.data.parentServerNodeId === nextParentServerNodeId) return node;
    return {
      ...node,
      data: {
        ...node.data,
        parentServerNodeId: nextParentServerNodeId,
      },
    };
  });
}

export function findNodeHistoryResult(
  items: HistoryItem[],
  sessionId: string,
  node: GraphNode,
  canceledRequestIds: string[] = [],
): HistoryItem | null {
  const startedAt = node.data.pendingStartedAt ?? 0;
  if (!startedAt) return null;
  const canceled = new Set(canceledRequestIds);
  return (
    items.find(
      (item) =>
        (item.sessionId ?? null) === sessionId &&
        (item.clientNodeId ?? null) === node.id &&
        !canceled.has(item.requestId ?? "") &&
        (item.createdAt ?? 0) >= startedAt &&
        !!item.nodeId &&
        !!item.url,
    ) ?? null
  );
}

export function applyNodeHistoryResult(node: GraphNode, item: HistoryItem): GraphNode {
  const importedSize = parseSizeSetting(item.size);
  return {
    ...node,
    data: {
      ...node.data,
      serverNodeId: item.nodeId ?? node.data.serverNodeId,
      imageUrl: item.url,
      status: "ready" as const,
      pendingRequestId: null,
      pendingPhase: null,
      pendingStartedAt: null,
      filename: item.filename,
      provider: item.provider,
      quality: item.quality ?? node.data.quality,
      size: item.size ?? node.data.size,
      format: item.format ?? node.data.format,
      moderation: item.moderation ?? node.data.moderation,
      model: item.model ?? node.data.model,
      settings: normalizeNodeSettings(
        {
          quality: item.quality,
          sizePreset: importedSize?.sizePreset,
          customW: importedSize?.customW,
          customH: importedSize?.customH,
          format: item.format,
          moderation: item.moderation,
          model: item.model,
        },
        node.data.settings,
      ),
      createdAt: item.createdAt,
      imageReferenceDetached: undefined,
      error: undefined,
    },
  };
}

export function mapSessionToGraph(session: SessionFull): {
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  graphVersion: number;
} {
  const graphNodes: GraphNode[] = session.nodes.map((n) => {
    const d = (n.data ?? {}) as Partial<ImageNodeData>;
    const explicitImageUrl =
      typeof d.imageUrl === "string" && d.imageUrl.length > 0 ? d.imageUrl : null;
    const fallbackImageUrl =
      typeof d.serverNodeId === "string" && d.serverNodeId.length > 0
        ? `/generated/${d.serverNodeId}.png`
        : null;
    const imageUrl = explicitImageUrl ?? fallbackImageUrl;
    const data: ImageNodeData = {
      clientId: n.id as ClientNodeId,
      serverNodeId: (d.serverNodeId ?? null) as string | null,
      parentServerNodeId: (d.parentServerNodeId ?? null) as string | null,
      name: typeof d.name === "string" ? d.name : undefined,
      prompt: typeof d.prompt === "string" ? d.prompt : "",
      imageUrl,
      status: (d.status ?? (imageUrl ? "ready" : "empty")) as ImageNodeStatus,
      pendingRequestId: (d.pendingRequestId ?? null) as string | null,
      pendingPhase: (d.pendingPhase ?? null) as string | null,
      pendingStartedAt:
        typeof d.pendingStartedAt === "number" ? d.pendingStartedAt : null,
      error: d.error as string | undefined,
      elapsed: d.elapsed as number | undefined,
      webSearchCalls: d.webSearchCalls as number | undefined,
      filename: d.filename as string | undefined,
      provider: d.provider as string | undefined,
      quality: d.quality as string | undefined,
      size: d.size as string | undefined,
      format: d.format as string | undefined,
      moderation: d.moderation as string | undefined,
      model: d.model as string | undefined,
      assetSource: d.assetSource === "upload" ? "upload" : undefined,
      imageReferenceDetached: d.imageReferenceDetached === true ? true : undefined,
      settings: settingsFromNodeData(d),
      usage: d.usage as GenerateItem["usage"] | undefined,
      createdAt: d.createdAt as number | undefined,
    };
    return {
      id: n.id,
      type: "imageNode",
      position: { x: n.x, y: n.y },
      data,
    };
  });
  const graphEdges: GraphEdge[] = session.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "workflowEdge",
    data: normalizeEdgeTransferData(e.data),
  }));
  const normalizedNodes = normalizeGraphParentPointers(graphNodes, graphEdges);
  return {
    graphNodes: syncEffectiveNodeSettings(normalizedNodes, graphEdges),
    graphEdges,
    graphVersion: session.graphVersion,
  };
}

export function findParentNodeFor(
  nodes: GraphNode[],
  edges: GraphEdge[],
  clientId: ClientNodeId,
): GraphNode | null {
  const incoming = edges.find((e) => e.target === clientId);
  if (!incoming) return null;
  return nodes.find((n) => n.id === incoming.source) ?? null;
}

export function buildNodeGenerateDelivery(
  nodes: GraphNode[],
  edges: GraphEdge[],
  clientId: ClientNodeId,
  options: { requestId?: string; sessionId?: string | null } = {},
): NodeGenerateDelivery<GraphNode> | null {
  return buildNodeGenerateDeliveryCore(nodes, edges, clientId, {
    ...options,
    promptRequiredMessage: t("toast.promptRequired"),
    parentRequiredMessage: t("toast.nodeParentRequired"),
  });
}

export function applyEdgeTransferPatch(
  nodes: GraphNode[],
  edges: GraphEdge[],
  edgeId: string,
  patch: Partial<EdgeTransferData>,
): { graphNodes: GraphNode[]; graphEdges: GraphEdge[] } | null {
  const edge = edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  const nextEdges = edges.map((e) =>
    e.id === edgeId
      ? {
          ...e,
          data: normalizeEdgeTransferData({ ...e.data, ...patch }),
        }
      : e,
  );
  const nextNodes =
    typeof patch.transferSettings === "boolean"
      ? syncEffectiveNodeSettings(nodes, nextEdges)
      : nodes;
  return {
    graphNodes: normalizeGraphParentPointers(nextNodes, nextEdges),
    graphEdges: nextEdges,
  };
}

export function wouldCreateCycle(
  edges: GraphEdge[],
  sourceClientId: ClientNodeId,
  targetClientId: ClientNodeId,
): boolean {
  if (sourceClientId === targetClientId) return true;
  const stack = [targetClientId];
  const seen = new Set<ClientNodeId>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    if (current === sourceClientId) return true;
    seen.add(current);
    for (const edge of edges) {
      if (edge.source === current) stack.push(edge.target as ClientNodeId);
    }
  }
  return false;
}

export function collectBranchNodeLevels(edges: GraphEdge[], rootId: ClientNodeId): ClientNodeId[][] {
  const levels: ClientNodeId[][] = [];
  const queue: Array<{ id: ClientNodeId; depth: number }> = [{ id: rootId, depth: 0 }];
  const seen = new Set<ClientNodeId>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    if (!levels[current.depth]) levels[current.depth] = [];
    levels[current.depth].push(current.id);
    for (const edge of edges) {
      if (edge.source === current.id) queue.push({ id: edge.target as ClientNodeId, depth: current.depth + 1 });
    }
  }
  return levels;
}

export function joinParentPrompt(parentPrompt: string, childPrompt: string): string {
  const parent = parentPrompt.trim();
  const child = childPrompt.trim();
  if (!parent) return childPrompt;
  if (!child) return parent;
  if (child.startsWith(parent)) return childPrompt;
  return `${parent}\n\n${child}`;
}
