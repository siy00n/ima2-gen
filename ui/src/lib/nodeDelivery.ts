import type { Format, ImageModel, Moderation, Quality, SizePreset } from "../types";
import type { NodeGenerateRequest, NodeVisualContextItem } from "./api";

export type NodeSettings = {
  model: ImageModel;
  quality: Quality;
  sizePreset: SizePreset;
  customW: number;
  customH: number;
  format: Format;
  moderation: Moderation;
};

export type ImageTransferMode = "off" | "parent" | "ancestor";

export const DEFAULT_IMAGE_MODEL: ImageModel = "gpt-5.4-mini";
export const ANCESTOR_IMAGE_COUNT_OPTIONS = [1, 3, 5, 8] as const;
export type AncestorImageCount = (typeof ANCESTOR_IMAGE_COUNT_OPTIONS)[number];

export type EdgeTransferData = {
  transferContext: boolean;
  transferSettings: boolean;
  imageTransfer: ImageTransferMode;
  maxAncestorImages: AncestorImageCount;
  transferAncestorImages?: boolean;
};

export const DEFAULT_EDGE_TRANSFER: EdgeTransferData = {
  transferContext: true,
  transferSettings: true,
  imageTransfer: "parent",
  maxAncestorImages: 3,
};

export const TEXT_ONLY_EDGE_TRANSFER: EdgeTransferData = {
  ...DEFAULT_EDGE_TRANSFER,
  imageTransfer: "off",
};

export const FALLBACK_NODE_SETTINGS: NodeSettings = {
  model: DEFAULT_IMAGE_MODEL,
  quality: "low",
  sizePreset: "1024x1024",
  customW: 1920,
  customH: 1088,
  format: "png",
  moderation: "low",
};

export type NodeDeliveryNodeData = {
  serverNodeId?: string | null;
  name?: string | null;
  prompt: string;
  settings: NodeSettings;
};

export type NodeDeliveryNode = {
  id: string;
  data: NodeDeliveryNodeData;
};

export type NodeDeliveryEdge = {
  id: string;
  source: string;
  target: string;
  data?: unknown;
};

export type NodeGenerateDeliveryIssue = {
  code: "missing-prompt" | "missing-parent-image";
  message: string;
  blocking: boolean;
};

export type NodeGenerateDelivery<NodeT extends NodeDeliveryNode = NodeDeliveryNode> = {
  node: NodeT;
  mode: "generate" | "edit";
  imageTransfer: ImageTransferMode;
  parentNode: NodeT | null;
  parentNodeId: string | null;
  ancestorNodeIds: string[];
  visualContext: NodeVisualContextItem[];
  displayPrompt: string;
  effectivePrompt: string;
  nodeSettings: NodeSettings;
  size: string;
  payload: NodeGenerateRequest;
  issues: NodeGenerateDeliveryIssue[];
};

export type NodeGenerateDeliveryOptions = {
  requestId?: string;
  sessionId?: string | null;
  promptRequiredMessage?: string;
  parentRequiredMessage?: string;
};

export type EdgeVisualState =
  | "none"
  | "image"
  | "context"
  | "settings"
  | "both"
  | "text"
  | "text-settings"
  | "ancestor"
  | "ancestor-context"
  | "ancestor-settings"
  | "ancestor-both";

function isImageTransferMode(value: unknown): value is ImageTransferMode {
  return value === "off" || value === "parent" || value === "ancestor";
}

function isAncestorImageCount(value: unknown): value is AncestorImageCount {
  return (
    typeof value === "number" &&
    ANCESTOR_IMAGE_COUNT_OPTIONS.includes(value as AncestorImageCount)
  );
}

function findIncomingEdgeFor<EdgeT extends NodeDeliveryEdge>(
  edges: EdgeT[],
  clientId: string,
): EdgeT | null {
  return edges.find((e) => e.target === clientId) ?? null;
}

function shortVisualNodeId(value: string | null | undefined): string {
  return value ? value.replace(/^n_/, "").slice(0, 8) : "-";
}

function nodeVisualContextItem<NodeT extends NodeDeliveryNode>(
  node: NodeT,
  relation: NodeVisualContextItem["relation"],
): NodeVisualContextItem | null {
  if (!node.data.serverNodeId) return null;
  const name = node.data.name?.trim() || null;
  const currentPrompt = node.data.prompt.trim() || null;
  return {
    relation,
    nodeId: node.data.serverNodeId,
    clientNodeId: node.id,
    name,
    currentPrompt,
  };
}

function visualContextPromptLines(visualContext: NodeVisualContextItem[]): string[] {
  if (visualContext.length === 0) return [];
  return [
    "Attached visual references:",
    ...visualContext.map((item, index) => {
      const relation =
        item.relation === "parent"
          ? "direct parent, primary visual source"
          : "ancestor continuity reference";
      const label = item.name?.trim() || shortVisualNodeId(item.nodeId);
      const prompt = item.currentPrompt?.trim() || "(no current prompt)";
      return `${index + 1}. ${relation}: ${label} (${shortVisualNodeId(item.nodeId)}). Current prompt: ${prompt}`;
    }),
    "",
  ];
}

export function cloneNodeSettings(settings: NodeSettings = FALLBACK_NODE_SETTINGS): NodeSettings {
  return { ...settings };
}

export function sameNodeSettings(a: NodeSettings, b: NodeSettings): boolean {
  return (
    a.model === b.model &&
    a.quality === b.quality &&
    a.sizePreset === b.sizePreset &&
    a.customW === b.customW &&
    a.customH === b.customH &&
    a.format === b.format &&
    a.moderation === b.moderation
  );
}

export function normalizeEdgeTransferData(raw: unknown): EdgeTransferData {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const transferContext =
    typeof obj.transferContext === "boolean"
      ? obj.transferContext
      : DEFAULT_EDGE_TRANSFER.transferContext;
  const legacyAncestorImages = obj.transferAncestorImages;
  const imageTransfer = isImageTransferMode(obj.imageTransfer)
    ? obj.imageTransfer
    : typeof legacyAncestorImages === "boolean"
      ? legacyAncestorImages
        ? "ancestor"
        : "parent"
      : DEFAULT_EDGE_TRANSFER.imageTransfer;
  return {
    transferContext,
    transferSettings:
      typeof obj.transferSettings === "boolean"
        ? obj.transferSettings
        : DEFAULT_EDGE_TRANSFER.transferSettings,
    imageTransfer,
    maxAncestorImages: isAncestorImageCount(obj.maxAncestorImages)
      ? obj.maxAncestorImages
      : DEFAULT_EDGE_TRANSFER.maxAncestorImages,
  };
}

export function getEdgeVisualState(raw: unknown): EdgeVisualState {
  const data = normalizeEdgeTransferData(raw);
  if (data.imageTransfer === "ancestor") {
    if (data.transferContext && data.transferSettings) return "ancestor-both";
    if (data.transferContext) return "ancestor-context";
    if (data.transferSettings) return "ancestor-settings";
    return "ancestor";
  }
  if (data.imageTransfer === "off") {
    if (data.transferContext && data.transferSettings) return "text-settings";
    if (data.transferContext) return "text";
    if (data.transferSettings) return "settings";
    return "none";
  }
  if (data.transferContext && data.transferSettings) return "both";
  if (data.transferContext) return "context";
  if (data.transferSettings) return "settings";
  return "image";
}

export function nextImageTransferMode(mode: ImageTransferMode): ImageTransferMode {
  if (mode === "parent") return "ancestor";
  if (mode === "ancestor") return "off";
  return "parent";
}

function snap16(value: number): number {
  return Math.round(value / 16) * 16;
}

export function resolveNodeSize(settings: NodeSettings): string {
  return settings.sizePreset === "custom"
    ? `${snap16(settings.customW)}x${snap16(settings.customH)}`
    : settings.sizePreset;
}

export function resolveEffectiveNodeSettings<
  NodeT extends NodeDeliveryNode,
  EdgeT extends NodeDeliveryEdge,
>(nodes: NodeT[], edges: EdgeT[], clientId: string): NodeSettings {
  let current = nodes.find((n) => n.id === clientId);
  if (!current) return cloneNodeSettings(FALLBACK_NODE_SETTINGS);
  let settings = cloneNodeSettings(current.data.settings);
  let currentId = clientId;

  while (true) {
    const edge = findIncomingEdgeFor(edges, currentId);
    if (!edge || !normalizeEdgeTransferData(edge.data).transferSettings) break;
    const parent = nodes.find((n) => n.id === edge.source);
    if (!parent) break;
    settings = cloneNodeSettings(parent.data.settings);
    current = parent;
    currentId = current.id;
  }

  return settings;
}

export function syncEffectiveNodeSettings<
  NodeT extends NodeDeliveryNode,
  EdgeT extends NodeDeliveryEdge,
>(nodes: NodeT[], edges: EdgeT[]): NodeT[] {
  return nodes.map((node) => {
    const settings = resolveEffectiveNodeSettings(nodes, edges, node.id);
    if (sameNodeSettings(node.data.settings, settings)) return node;
    return {
      ...node,
      data: {
        ...node.data,
        settings,
      },
    };
  });
}

function buildEffectivePrompt<NodeT extends NodeDeliveryNode, EdgeT extends NodeDeliveryEdge>(
  nodes: NodeT[],
  edges: EdgeT[],
  clientId: string,
  visualContext: NodeVisualContextItem[] = [],
): string {
  const node = nodes.find((n) => n.id === clientId);
  const displayPrompt = node?.data.prompt.trim() ?? "";
  if (!node) return displayPrompt;

  const contextNodes: NodeT[] = [];
  let currentId = clientId;
  while (true) {
    const edge = findIncomingEdgeFor(edges, currentId);
    if (!edge || !normalizeEdgeTransferData(edge.data).transferContext) break;
    const parent = nodes.find((n) => n.id === edge.source);
    if (!parent) break;
    contextNodes.push(parent);
    currentId = parent.id;
  }

  const contextLines = contextNodes
    .reverse()
    .map((n, index) => {
      const prompt = n.data.prompt.trim();
      if (!prompt) return null;
      const label = n.data.serverNodeId?.slice(0, 8) ?? n.id;
      return `${index + 1}. ${label}: ${prompt}`;
    })
    .filter((line): line is string => Boolean(line));

  if (contextLines.length === 0 && visualContext.length === 0) return displayPrompt;
  const incomingData = normalizeEdgeTransferData(findIncomingEdgeFor(edges, clientId)?.data);
  const imageGuidance =
    incomingData.imageTransfer === "off"
      ? "No parent image is attached for this step."
      : incomingData.imageTransfer === "ancestor"
        ? "Use the attached parent and ancestor images as visual source material."
        : "Use the attached parent image as the visual source.";
  return [
    `Previous workflow context. Use this text as continuity guidance. ${imageGuidance}`,
    ...visualContextPromptLines(visualContext),
    ...contextLines,
    "",
    "Current node instruction:",
    displayPrompt,
  ].join("\n");
}

function resolveNodeImageInputs<NodeT extends NodeDeliveryNode, EdgeT extends NodeDeliveryEdge>(
  nodes: NodeT[],
  edges: EdgeT[],
  clientId: string,
): {
  parentNode: NodeT | null;
  parentServerNodeId: string | null;
  ancestorNodeIds: string[];
  visualContext: NodeVisualContextItem[];
  imageTransfer: ImageTransferMode;
} {
  const incoming = findIncomingEdgeFor(edges, clientId);
  const incomingData = incoming ? normalizeEdgeTransferData(incoming.data) : null;
  const parentNode = incoming ? nodes.find((n) => n.id === incoming.source) ?? null : null;
  const imageTransfer = parentNode && incomingData ? incomingData.imageTransfer : "off";
  const parentServerNodeId =
    imageTransfer === "off" ? null : parentNode?.data.serverNodeId ?? null;
  if (!parentNode || imageTransfer !== "ancestor") {
    const parentContext =
      parentNode && imageTransfer === "parent"
        ? nodeVisualContextItem(parentNode, "parent")
        : null;
    return {
      parentNode,
      parentServerNodeId,
      ancestorNodeIds: [],
      visualContext: parentContext ? [parentContext] : [],
      imageTransfer,
    };
  }

  const ancestorNodes: NodeT[] = [];
  const seen = new Set<string>();
  let currentId = parentNode.id;
  while (true) {
    if (seen.has(currentId)) break;
    seen.add(currentId);
    const edge = findIncomingEdgeFor(edges, currentId);
    if (!edge || normalizeEdgeTransferData(edge.data).imageTransfer === "off") break;
    const parent = nodes.find((n) => n.id === edge.source);
    if (!parent) break;
    if (parent.data.serverNodeId) ancestorNodes.push(parent);
    currentId = parent.id;
  }

  const maxAncestorImages =
    incomingData?.maxAncestorImages ?? DEFAULT_EDGE_TRANSFER.maxAncestorImages;
  const orderedAncestors = ancestorNodes.reverse().slice(-maxAncestorImages);
  const ancestorContext = orderedAncestors
    .map((ancestor) => nodeVisualContextItem(ancestor, "ancestor"))
    .filter((item): item is NodeVisualContextItem => Boolean(item));
  const parentContext = nodeVisualContextItem(parentNode, "parent");
  const visualContext = parentContext ? [...ancestorContext, parentContext] : ancestorContext;

  return {
    parentNode,
    parentServerNodeId,
    ancestorNodeIds: ancestorContext.map((item) => item.nodeId),
    visualContext,
    imageTransfer,
  };
}

export function buildNodeGenerateDelivery<
  NodeT extends NodeDeliveryNode,
  EdgeT extends NodeDeliveryEdge,
>(
  nodes: NodeT[],
  edges: EdgeT[],
  clientId: string,
  options: NodeGenerateDeliveryOptions = {},
): NodeGenerateDelivery<NodeT> | null {
  const node = nodes.find((n) => n.id === clientId);
  if (!node) return null;

  const displayPrompt = node.data.prompt;
  const nodeSettings = resolveEffectiveNodeSettings(nodes, edges, clientId);
  const size = resolveNodeSize(nodeSettings);
  const {
    parentNode,
    parentServerNodeId,
    ancestorNodeIds,
    visualContext,
    imageTransfer,
  } = resolveNodeImageInputs(nodes, edges, clientId);
  const effectivePrompt = buildEffectivePrompt(nodes, edges, clientId, visualContext);
  const issues: NodeGenerateDeliveryIssue[] = [];

  if (!displayPrompt.trim()) {
    issues.push({
      code: "missing-prompt",
      message: options.promptRequiredMessage ?? "Prompt required",
      blocking: true,
    });
  }
  if (parentNode && imageTransfer !== "off" && !parentServerNodeId) {
    issues.push({
      code: "missing-parent-image",
      message: options.parentRequiredMessage ?? "Parent image required",
      blocking: true,
    });
  }

  const payload: NodeGenerateRequest = {
    parentNodeId: parentServerNodeId,
    ancestorNodeIds,
    visualContext,
    prompt: effectivePrompt,
    displayPrompt,
    effectivePrompt,
    quality: nodeSettings.quality,
    size,
    format: nodeSettings.format,
    moderation: nodeSettings.moderation,
    model: nodeSettings.model,
    requestId: options.requestId,
    sessionId: options.sessionId,
    clientNodeId: clientId,
  };

  return {
    node,
    mode: parentServerNodeId ? "edit" : "generate",
    imageTransfer,
    parentNode,
    parentNodeId: parentServerNodeId,
    ancestorNodeIds,
    visualContext,
    displayPrompt,
    effectivePrompt,
    nodeSettings,
    size,
    payload,
    issues,
  };
}
