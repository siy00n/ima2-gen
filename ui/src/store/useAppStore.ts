import { create } from "zustand";
import type {
  Count,
  Format,
  GenerateItem,
  GenerateResponse,
  Moderation,
  Provider,
  Quality,
  SizePreset,
  UIMode,
} from "../types";
import { isMultiResponse } from "../types";
import {
  postGenerate,
  getHistory,
  getInflight,
  cancelInflight,
  postNodeGenerate,
  postNodeImport,
  listSessions as apiListSessions,
  createSession as apiCreateSession,
  getSession as apiGetSession,
  renameSession as apiRenameSession,
  deleteSession as apiDeleteSession,
  saveSessionGraph,
  type HistoryItem,
  type NodeGenerateRequest,
  type NodeVisualContextItem,
  type SessionGraphEdge,
  type SessionGraphNode,
  type SessionSummary,
  type SessionFull,
} from "../lib/api";
import { compressImage } from "../lib/image";
import { snap16 } from "../lib/size";
import { newClientNodeId, initialPos, type ClientNodeId } from "../lib/graph";
import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import { t, loadLocale, saveLocale, type Locale } from "../i18n";

function loadRightPanelOpen(): boolean {
  try {
    const raw = localStorage.getItem("ima2.rightPanelOpen");
    if (raw === null) {
      if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        return !window.matchMedia("(max-width: 800px)").matches;
      }
      return true;
    }
    return JSON.parse(raw) === true;
  } catch {
    return true;
  }
}

function saveRightPanelOpen(open: boolean): void {
  try {
    localStorage.setItem("ima2.rightPanelOpen", JSON.stringify(open));
  } catch {}
}

function loadUIMode(): UIMode {
  try {
    const raw = localStorage.getItem("ima2.uiMode");
    if (raw === "node" || raw === "classic") return raw;
  } catch {}
  return "classic";
}

type PersistedInFlight = {
  id: string;
  prompt: string;
  startedAt: number;
  phase?: string;
  sessionId?: string | null;
  clientNodeId?: string | null;
  kind?: "classic" | "node";
};
const INFLIGHT_TTL_MS = 180_000;

function loadInFlight(): PersistedInFlight[] {
  try {
    const raw = localStorage.getItem("ima2.inFlight");
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return arr
      .filter(
        (x) =>
          x && typeof x.id === "string" && typeof x.prompt === "string" &&
          typeof x.startedAt === "number" && now - x.startedAt < INFLIGHT_TTL_MS,
      )
      .map((x) => ({
        id: x.id,
        prompt: x.prompt,
        startedAt: x.startedAt,
        phase: typeof x.phase === "string" ? x.phase : undefined,
        sessionId: typeof x.sessionId === "string" ? x.sessionId : null,
        clientNodeId: typeof x.clientNodeId === "string" ? x.clientNodeId : null,
        kind: x.kind === "classic" || x.kind === "node" ? x.kind : undefined,
      }));
  } catch {
    return [];
  }
}

function saveInFlight(list: PersistedInFlight[]): void {
  try {
    localStorage.setItem("ima2.inFlight", JSON.stringify(list));
  } catch (err) {
    // Quota exceeded or storage disabled. Notify the user once per tab.
    const w = window as unknown as { __ima2QuotaWarned?: boolean };
    if (!w.__ima2QuotaWarned) {
      w.__ima2QuotaWarned = true;
      console.warn("[ima2] localStorage write failed:", err);
      try {
        useAppStore.getState().showToast(t("toast.localStorageFull"), true);
      } catch {}
    }
  }
}

function loadSelectedFilename(): string | null {
  try {
    const raw = localStorage.getItem("ima2.selectedFilename");
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function saveSelectedFilename(filename: string | null): void {
  try {
    if (filename) localStorage.setItem("ima2.selectedFilename", filename);
    else localStorage.removeItem("ima2.selectedFilename");
  } catch {}
}

const HISTORY_LIMIT = 500;

function narrowGenerateKind(k?: string | null): GenerateItem["kind"] {
  return k === "classic" || k === "edit" || k === "generate" || k === "import" ? k : null;
}

const QUALITY_VALUES: Quality[] = ["low", "medium", "high"];
const FORMAT_VALUES: Format[] = ["png", "jpeg", "webp"];
const MODERATION_VALUES: Moderation[] = ["low", "auto"];
const SIZE_PRESET_VALUES: SizePreset[] = [
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

export type NodeSettings = {
  quality: Quality;
  sizePreset: SizePreset;
  customW: number;
  customH: number;
  format: Format;
  moderation: Moderation;
};

export type ImageTransferMode = "off" | "parent" | "ancestor";

export const ANCESTOR_IMAGE_COUNT_OPTIONS = [1, 3, 5, 8] as const;
export type AncestorImageCount = (typeof ANCESTOR_IMAGE_COUNT_OPTIONS)[number];

export type EdgeTransferData = {
  transferContext: boolean;
  transferSettings: boolean;
  imageTransfer: ImageTransferMode;
  maxAncestorImages: AncestorImageCount;
  transferAncestorImages?: boolean;
};

const DEFAULT_EDGE_TRANSFER: EdgeTransferData = {
  transferContext: true,
  transferSettings: true,
  imageTransfer: "parent",
  maxAncestorImages: 3,
};

const TEXT_ONLY_EDGE_TRANSFER: EdgeTransferData = {
  ...DEFAULT_EDGE_TRANSFER,
  imageTransfer: "off",
};

const FALLBACK_NODE_SETTINGS: NodeSettings = {
  quality: "low",
  sizePreset: "1024x1024",
  customW: 1920,
  customH: 1088,
  format: "png",
  moderation: "low",
};

function hasStringValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function parseSizeSetting(size: unknown): Pick<NodeSettings, "sizePreset" | "customW" | "customH"> | null {
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

function cloneNodeSettings(settings: NodeSettings): NodeSettings {
  return { ...settings };
}

function sameNodeSettings(a: NodeSettings, b: NodeSettings): boolean {
  return (
    a.quality === b.quality &&
    a.sizePreset === b.sizePreset &&
    a.customW === b.customW &&
    a.customH === b.customH &&
    a.format === b.format &&
    a.moderation === b.moderation
  );
}

function isImageTransferMode(value: unknown): value is ImageTransferMode {
  return value === "off" || value === "parent" || value === "ancestor";
}

function isAncestorImageCount(value: unknown): value is AncestorImageCount {
  return (
    typeof value === "number" &&
    ANCESTOR_IMAGE_COUNT_OPTIONS.includes(value as AncestorImageCount)
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

function createGraphEdge(
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

function currentNodeSettings(s: AppState): NodeSettings {
  return {
    quality: s.quality,
    sizePreset: s.sizePreset,
    customW: s.customW,
    customH: s.customH,
    format: s.format,
    moderation: s.moderation,
  };
}

function normalizeNodeSettings(raw: unknown, fallback: NodeSettings = FALLBACK_NODE_SETTINGS): NodeSettings {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
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

function resolveNodeSize(settings: NodeSettings): string {
  return settings.sizePreset === "custom"
    ? `${snap16(settings.customW)}x${snap16(settings.customH)}`
    : settings.sizePreset;
}

function nextNodeName(nodes: GraphNode[]): string {
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

export type ImageNodeStatus =
  | "empty"
  | "pending"
  | "reconciling"
  | "ready"
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

export function canUseNodeAsBranchParent(data: Pick<ImageNodeData, "status">): boolean {
  return data.status !== "pending" && data.status !== "reconciling";
}

function hasReadyNodeImage(data: Pick<ImageNodeData, "status" | "serverNodeId">): boolean {
  return data.status === "ready" && !!data.serverNodeId;
}

function edgeTransferForParent(parent: GraphNode): EdgeTransferData {
  return hasReadyNodeImage(parent.data) ? DEFAULT_EDGE_TRANSFER : TEXT_ONLY_EDGE_TRANSFER;
}

function createChildEdge(parent: GraphNode, target: ClientNodeId): GraphEdge {
  return createGraphEdge(parent.id as ClientNodeId, target, edgeTransferForParent(parent));
}

type NodePosition = { x: number; y: number };
type GenerateNodeOptions = { selectOnComplete?: boolean };

export type NodeGenerateDeliveryIssue = {
  code: "missing-prompt" | "missing-parent-image";
  message: string;
  blocking: boolean;
};

export type NodeGenerateDelivery = {
  node: GraphNode;
  mode: "generate" | "edit";
  imageTransfer: ImageTransferMode;
  parentNode: GraphNode | null;
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

function findNearbyFreeNodePosition(preferred: NodePosition, nodes: GraphNode[]): NodePosition {
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

function preferredChildPosition(parent: GraphNode): NodePosition {
  return {
    x: parent.position.x + NODE_CHILD_X_OFFSET,
    y: parent.position.y,
  };
}

function normalizeGraphParentPointers(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map(edges.map((edge) => [edge.target, edge]));

  return nodes.map((node) => {
    const incoming = incomingByTarget.get(node.id);
    const parent = incoming ? nodeById.get(incoming.source) : null;
    const nextParentServerNodeId = parent?.data.serverNodeId ?? null;
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

function findNodeHistoryResult(
  items: HistoryItem[],
  sessionId: string,
  node: GraphNode,
): HistoryItem | null {
  const startedAt = node.data.pendingStartedAt ?? 0;
  if (!startedAt) return null;
  return (
    items.find(
      (item) =>
        (item.sessionId ?? null) === sessionId &&
        (item.clientNodeId ?? null) === node.id &&
        (item.createdAt ?? 0) >= startedAt &&
        !!item.nodeId &&
        !!item.url,
    ) ?? null
  );
}

function applyNodeHistoryResult(node: GraphNode, item: HistoryItem): GraphNode {
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
      settings: normalizeNodeSettings(
        {
          quality: item.quality,
          sizePreset: importedSize?.sizePreset,
          customW: importedSize?.customW,
          customH: importedSize?.customH,
          format: item.format,
          moderation: item.moderation,
        },
        node.data.settings,
      ),
      createdAt: item.createdAt,
      error: undefined,
    },
  };
}

function mapSessionToGraph(session: SessionFull): {
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

type ToastState = { message: string; error: boolean; id: number } | null;

function sameGenerateItem(a: GenerateItem | null | undefined, b: GenerateItem | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.filename && b.filename) return a.filename === b.filename;
  return a.image === b.image;
}

function currentHistoryIndex(history: GenerateItem[], currentImage: GenerateItem | null): number {
  if (!currentImage) return -1;
  return history.findIndex((item) => sameGenerateItem(item, currentImage));
}

function selectHistoryItem(item: GenerateItem, set: (patch: Partial<AppState>) => void): void {
  saveSelectedFilename(item.filename ?? null);
  set({ currentImage: item });
}

type AppState = {
  provider: Provider;
  quality: Quality;
  sizePreset: SizePreset;
  customW: number;
  customH: number;
  format: Format;
  moderation: Moderation;
  count: Count;
  prompt: string;
  referenceImages: string[];
  addReferences: (files: File[]) => Promise<void>;
  addReferenceDataUrl: (dataUrl: string) => void;
  removeReference: (index: number) => void;
  clearReferences: () => void;
  useCurrentAsReference: () => Promise<void>;
  activeGenerations: number;
  inFlight: PersistedInFlight[];
  startInFlightPolling: () => void;
  reconcileInflight: () => Promise<void>;
  reconcileGraphPending: () => Promise<void>;
  syncFromStorage: () => void;
  currentImage: GenerateItem | null;
  history: GenerateItem[];
  toast: ToastState;
  rightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  galleryOpen: boolean;
  openGallery: () => void;
  closeGallery: () => void;

  uiMode: UIMode;
  setUIMode: (m: UIMode) => void;

  locale: Locale;
  setLocale: (l: Locale) => void;

  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  graphUndoPast: GraphSnapshot[];
  graphUndoFuture: GraphSnapshot[];
  canUndoGraph: boolean;
  canRedoGraph: boolean;
  selectedNodeId: ClientNodeId | null;
  selectedEdgeId: string | null;
  selectNode: (clientId: ClientNodeId | null) => void;
  selectEdge: (edgeId: string | null) => void;
  undoGraph: () => void;
  redoGraph: () => void;
  resetGraphHistory: () => void;
  buildNodeGeneratePreview: (clientId: ClientNodeId) => NodeGenerateDelivery | null;
  setGraphNodes: (n: GraphNode[]) => void;
  setGraphEdges: (e: GraphEdge[]) => void;
  addRootNode: () => ClientNodeId;
  addChildNode: (parentClientId: ClientNodeId) => ClientNodeId;
  addSiblingNode: (sourceClientId: ClientNodeId) => ClientNodeId;
  duplicateBranchRoot: (sourceClientId: ClientNodeId) => ClientNodeId;
  addChildNodeAt: (parentClientId: ClientNodeId, position: { x: number; y: number }) => ClientNodeId;
  connectNodes: (sourceClientId: ClientNodeId, targetClientId: ClientNodeId) => void;
  updateEdgeTransfer: (edgeId: string, patch: Partial<EdgeTransferData>) => void;
  setEdgeImageTransfer: (edgeId: string, mode: ImageTransferMode) => void;
  cycleEdgeImageTransferQuiet: (edgeId: string) => void;
  toggleEdgeTransfer: (edgeId: string, key: "transferContext" | "transferSettings") => void;
  toggleEdgeTransferQuiet: (edgeId: string, key: "transferContext" | "transferSettings") => void;
  updateNodeName: (clientId: ClientNodeId, name: string) => void;
  updateNodePrompt: (clientId: ClientNodeId, prompt: string) => void;
  updateNodeSettings: (clientId: ClientNodeId, patch: Partial<NodeSettings>) => void;
  copyParentPromptToNode: (clientId: ClientNodeId) => void;
  copyParentSettingsToNode: (clientId: ClientNodeId) => void;
  detachNodeFromParent: (clientId: ClientNodeId) => void;
  detachSelectedEdge: () => void;
  addChildFromSelectedEdge: () => ClientNodeId | null;
  generateNode: (clientId: ClientNodeId, options?: GenerateNodeOptions) => Promise<boolean>;
  regenerateBranch: (clientId: ClientNodeId) => Promise<void>;
  deleteNode: (clientId: ClientNodeId) => void;
  deleteNodes: (clientIds: ClientNodeId[]) => void;
  importHistoryItemAsNode: (item: GenerateItem) => Promise<void>;
  importCurrentImageAsNode: () => Promise<void>;

  // Sessions (0.06)
  sessions: SessionSummary[];
  activeSessionId: string | null;
  activeSessionGraphVersion: number | null;
  sessionLoading: boolean;
  loadSessions: () => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  createAndSwitchSession: (title?: string) => Promise<void>;
  renameCurrentSession: (title: string) => Promise<void>;
  deleteSessionById: (id: string) => Promise<void>;
  scheduleGraphSave: () => void;
  flushGraphSave: () => Promise<void>;

  setProvider: (p: Provider) => void;
  setQuality: (q: Quality) => void;
  setSizePreset: (s: SizePreset) => void;
  setCustomSize: (w: number, h: number) => void;
  setFormat: (f: Format) => void;
  setModeration: (m: Moderation) => void;
  setCount: (c: Count) => void;
  setPrompt: (p: string) => void;
  selectHistory: (item: GenerateItem) => void;
  selectPreviousImage: () => void;
  selectNextImage: () => void;
  removeFromHistory: (filename: string) => void;
  addHistoryItem: (item: GenerateItem) => void;
  generate: () => Promise<void>;
  hydrateHistory: () => void;
  showToast: (message: string, error?: boolean) => void;
  getResolvedSize: () => string;
};

const GRAPH_HISTORY_LIMIT = 50;

type GraphSnapshot = {
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

function takeGraphSnapshot(s: Pick<AppState, "graphNodes" | "graphEdges" | "selectedNodeId" | "selectedEdgeId">): GraphSnapshot {
  return {
    graphNodes: s.graphNodes.map(cloneGraphNodeForSnapshot),
    graphEdges: s.graphEdges.map(cloneGraphEdgeForSnapshot),
    selectedNodeId: s.selectedNodeId,
    selectedEdgeId: s.selectedEdgeId,
  };
}

function hasPendingGraphNodes(nodes: GraphNode[]): boolean {
  return nodes.some((node) => node.data.status === "pending" || node.data.status === "reconciling");
}

function clearGraphHistoryPatch(): Pick<
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

function graphHistoryPatch(
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

function pushGraphUndoPatch(s: AppState): Pick<
  AppState,
  "graphUndoPast" | "graphUndoFuture" | "canUndoGraph" | "canRedoGraph"
> {
  if (hasPendingGraphNodes(s.graphNodes)) {
    return graphHistoryPatch(s.graphUndoPast, []);
  }
  const graphUndoPast = [...s.graphUndoPast, takeGraphSnapshot(s)].slice(-GRAPH_HISTORY_LIMIT);
  return graphHistoryPatch(graphUndoPast, []);
}

function commitUserGraphChange(
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
  "usage",
  "createdAt",
];

function mergeCurrentRuntimeData(snapshotNode: GraphNode, currentNode: GraphNode | undefined): GraphNode {
  const next = cloneGraphNodeForSnapshot(snapshotNode);
  if (!currentNode) return next;
  const data = { ...next.data };
  for (const key of NODE_RUNTIME_DATA_KEYS) {
    (data as Record<string, unknown>)[key] = (currentNode.data as Record<string, unknown>)[key];
  }
  return {
    ...next,
    data,
  };
}

function restoreGraphSnapshot(snapshot: GraphSnapshot, currentNodes: GraphNode[]): GraphSnapshot {
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

function findParentNodeFor(
  nodes: GraphNode[],
  edges: GraphEdge[],
  clientId: ClientNodeId,
): GraphNode | null {
  const incoming = edges.find((e) => e.target === clientId);
  if (!incoming) return null;
  return nodes.find((n) => n.id === incoming.source) ?? null;
}

function findIncomingEdgeFor(edges: GraphEdge[], clientId: ClientNodeId): GraphEdge | null {
  return edges.find((e) => e.target === clientId) ?? null;
}

function shortVisualNodeId(value: string | null | undefined): string {
  return value ? value.replace(/^n_/, "").slice(0, 8) : "-";
}

function nodeVisualContextItem(
  node: GraphNode,
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

function buildEffectivePrompt(
  nodes: GraphNode[],
  edges: GraphEdge[],
  clientId: ClientNodeId,
  visualContext: NodeVisualContextItem[] = [],
): string {
  const node = nodes.find((n) => n.id === clientId);
  const displayPrompt = node?.data.prompt.trim() ?? "";
  if (!node) return displayPrompt;

  const contextNodes: GraphNode[] = [];
  let currentId = clientId;
  while (true) {
    const edge = findIncomingEdgeFor(edges, currentId);
    if (!edge || !normalizeEdgeTransferData(edge.data).transferContext) break;
    const parent = nodes.find((n) => n.id === edge.source);
    if (!parent) break;
    contextNodes.push(parent);
    currentId = parent.id as ClientNodeId;
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

function resolveNodeImageInputs(
  nodes: GraphNode[],
  edges: GraphEdge[],
  clientId: ClientNodeId,
): {
  parentNode: GraphNode | null;
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

  const ancestorNodes: GraphNode[] = [];
  const seen = new Set<ClientNodeId>();
  let currentId = parentNode.id as ClientNodeId;
  while (true) {
    if (seen.has(currentId)) break;
    seen.add(currentId);
    const edge = findIncomingEdgeFor(edges, currentId);
    if (!edge || normalizeEdgeTransferData(edge.data).imageTransfer === "off") break;
    const parent = nodes.find((n) => n.id === edge.source);
    if (!parent) break;
    if (parent.data.serverNodeId) ancestorNodes.push(parent);
    currentId = parent.id as ClientNodeId;
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

export function buildNodeGenerateDelivery(
  nodes: GraphNode[],
  edges: GraphEdge[],
  clientId: ClientNodeId,
  options: { requestId?: string; sessionId?: string | null } = {},
): NodeGenerateDelivery | null {
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
      message: t("toast.promptRequired"),
      blocking: true,
    });
  }
  if (parentNode && imageTransfer !== "off" && !parentServerNodeId) {
    issues.push({
      code: "missing-parent-image",
      message: t("toast.nodeParentRequired"),
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

function resolveEffectiveNodeSettings(
  nodes: GraphNode[],
  edges: GraphEdge[],
  clientId: ClientNodeId,
): NodeSettings {
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
    currentId = current.id as ClientNodeId;
  }

  return settings;
}

function syncEffectiveNodeSettings(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  return nodes.map((node) => {
    const settings = resolveEffectiveNodeSettings(nodes, edges, node.id as ClientNodeId);
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

function applyEdgeTransferPatch(
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
  return { graphNodes: nextNodes, graphEdges: nextEdges };
}

function wouldCreateCycle(
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

function collectBranchNodeLevels(edges: GraphEdge[], rootId: ClientNodeId): ClientNodeId[][] {
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

function joinParentPrompt(parentPrompt: string, childPrompt: string): string {
  const parent = parentPrompt.trim();
  const child = childPrompt.trim();
  if (!parent) return childPrompt;
  if (!child) return parent;
  if (child.startsWith(parent)) return childPrompt;
  return `${parent}\n\n${child}`;
}

export const useAppStore = create<AppState>((set, get) => ({
  provider: "oauth",
  quality: "low",
  sizePreset: "1024x1024",
  customW: 1920,
  customH: 1088,
  format: "png",
  moderation: "low",
  count: 1,
  prompt: "",
  referenceImages: [],
  addReferences: async (files) => {
    const allowed = 5 - get().referenceImages.length;
    const toAdd = files.slice(0, Math.max(0, allowed));
    const dataUrls = await Promise.all(
      toAdd.map(
        (f) =>
          new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve(typeof reader.result === "string" ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(f);
          }),
      ),
    );
    const valid = dataUrls.filter((x): x is string => !!x);
    set((s) => ({ referenceImages: [...s.referenceImages, ...valid].slice(0, 5) }));
    if (files.length > allowed) {
      get().showToast(t("toast.refLimitExceeded"), true);
    }
  },
  addReferenceDataUrl: (dataUrl) => {
    set((s) =>
      s.referenceImages.length >= 5
        ? s
        : { referenceImages: [...s.referenceImages, dataUrl] },
    );
  },
  removeReference: (index) => {
    set((s) => ({
      referenceImages: s.referenceImages.filter((_, i) => i !== index),
    }));
  },
  clearReferences: () => set({ referenceImages: [] }),
  useCurrentAsReference: async () => {
    const cur = get().currentImage;
    if (!cur) {
      get().showToast(t("toast.noCurrentImageForRef"), true);
      return;
    }
    if (get().referenceImages.length >= 5) {
      get().showToast(t("toast.refSlotFull"), true);
      return;
    }
    let dataUrl = cur.image;
    if (!dataUrl.startsWith("data:")) {
      try {
        const resp = await fetch(dataUrl);
        const blob = await resp.blob();
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            typeof reader.result === "string"
              ? resolve(reader.result)
              : reject(new Error("read failed"));
          reader.onerror = () => reject(reader.error ?? new Error("read failed"));
          reader.readAsDataURL(blob);
        });
      } catch {
        get().showToast(t("toast.currentImageLoadFailed"), true);
        return;
      }
    }
    set((s) => ({ referenceImages: [...s.referenceImages, dataUrl] }));
    get().showToast(t("toast.addedCurrentAsRef"));
  },
  activeGenerations: loadInFlight().length,
  inFlight: loadInFlight(),
  startInFlightPolling: () => {
    if (typeof window === "undefined") return;
    const w = window as unknown as { __ima2InflightTimer?: number };
    if (w.__ima2InflightTimer) return;
    const tick = async () => {
      const cur = get().inFlight;
      if (cur.length === 0) {
        if (w.__ima2InflightTimer) {
          clearInterval(w.__ima2InflightTimer);
          w.__ima2InflightTimer = undefined;
        }
        return;
      }
      // Merge server-side phase info so the spinner label reflects real progress
      try {
        const inflightKind: "classic" | "node" = get().uiMode === "node" ? "node" : "classic";
        const inflightSessionId =
          inflightKind === "node" ? get().activeSessionId ?? undefined : undefined;
        const { jobs } = await getInflight({
          kind: inflightKind,
          sessionId: inflightSessionId,
        });
        const byId = new Map(jobs.map((j) => [j.requestId, j.phase] as const));
        let changed = false;
        const now0 = Date.now();
        const GRACE_MS = 5000;
        const nextInflight: typeof cur = [];
        for (const f of get().inFlight) {
          // Out-of-scope entries (different kind/session) must not be dropped
          // based on this tick's byId — the server wasn't asked about them.
          const fKind = f.kind ?? "classic";
          const matchesScope =
            fKind === inflightKind &&
            (inflightKind !== "node" ||
              (f.sessionId ?? null) === (inflightSessionId ?? null));
          if (!matchesScope) {
            nextInflight.push(f);
            continue;
          }
          // If server no longer knows this job and enough time has passed,
          // drop it locally so the spinner does not linger after completion.
          if (!byId.has(f.id) && now0 - f.startedAt > GRACE_MS) {
            changed = true;
            continue;
          }
          const p = byId.get(f.id);
          if (p && p !== f.phase) {
            changed = true;
            nextInflight.push({ ...f, phase: p });
          } else {
            nextInflight.push(f);
          }
        }
        if (changed) {
          saveInFlight(nextInflight);
          set({ inFlight: nextInflight, activeGenerations: nextInflight.length });
        }
      } catch {}
      try {
        const lastKnown = get().history.reduce(
          (max, it) => (it.createdAt && it.createdAt > max ? it.createdAt : max),
          0,
        );
        const { items } = await getHistory({ limit: HISTORY_LIMIT, since: lastKnown });
        const arr: GenerateItem[] = items.map((it) => ({
          image: it.url,
          url: it.url,
          filename: it.filename,
          thumb: it.url,
          prompt: it.prompt ?? undefined,
          size: it.size ?? undefined,
          quality: it.quality ?? undefined,
          format: it.format as Format | undefined,
          createdAt: it.createdAt,
          sessionId: it.sessionId ?? null,
          nodeId: it.nodeId ?? null,
          clientNodeId: it.clientNodeId ?? null,
          kind: narrowGenerateKind(it.kind),
        }));
        const existing = get().history;
        const fresh = arr.filter(
          (a) => !existing.some((e) => e.filename === a.filename),
        );
        if (fresh.length > 0) {
          set((s) => {
            const nextCurrent = s.currentImage ?? fresh[0];
            if (!s.currentImage && fresh[0]?.filename) {
              saveSelectedFilename(fresh[0].filename);
            }
            return {
              history: [...fresh, ...s.history].slice(0, HISTORY_LIMIT),
              currentImage: nextCurrent,
            };
          });
        }
        // Prune strategy: TTL-based only. Do not attempt to correlate
        // history items with inFlight entries — backend ordering may differ
        // from local generation order under concurrency. Matching by prompt
        // is also unreliable when the same prompt is queued twice.
        const now = Date.now();
        const remaining = get().inFlight.filter(
          (f) => now - f.startedAt < INFLIGHT_TTL_MS,
        );
        if (remaining.length !== get().inFlight.length) {
          saveInFlight(remaining);
          set({ inFlight: remaining, activeGenerations: remaining.length });
        }
      } catch {}
    };
    w.__ima2InflightTimer = window.setInterval(tick, 1500) as unknown as number;
  },
  reconcileInflight: async () => {
    try {
      const inflightKind = get().uiMode === "node" ? "node" : "classic";
      const inflightSessionId =
        inflightKind === "node" ? get().activeSessionId ?? undefined : undefined;
      const { jobs } = await getInflight({
        kind: inflightKind,
        sessionId: inflightSessionId,
      });
      const serverIds = new Set(jobs.map((j) => j.requestId));
      const now = Date.now();
      const local = get().inFlight;
      // Keep local entries that are either still known to the server,
      // or started very recently (<10s — request may be in-flight before
      // /api/inflight registered). Drop anything else as stale.
      const merged = local.filter(
        (f) => serverIds.has(f.id) || now - f.startedAt < 10_000,
      );
      // Bring in server-only jobs (started from another tab / process)
      const localIds = new Set(merged.map((f) => f.id));
      for (const j of jobs) {
        if (!localIds.has(j.requestId)) {
          merged.push({ id: j.requestId, prompt: j.prompt || "", startedAt: j.startedAt });
        }
      }
      saveInFlight(merged);
      set({ inFlight: merged, activeGenerations: merged.length });
      if (merged.length > 0) get().startInFlightPolling();
    } catch {
      // Silent — endpoint may not exist on older servers.
    }
  },
  syncFromStorage: () => {
    // Triggered by `storage` events (another tab changed localStorage).
    const nextInflight = loadInFlight();
    const nextSelected = loadSelectedFilename();
    set((s) => ({
      inFlight: nextInflight,
      activeGenerations: nextInflight.length,
      currentImage:
        nextSelected && s.currentImage?.filename !== nextSelected
          ? s.history.find((h) => h.filename === nextSelected) ?? s.currentImage
          : s.currentImage,
    }));
    if (nextInflight.length > 0) get().startInFlightPolling();
  },
  currentImage: null,
  history: [],
  toast: null,
  rightPanelOpen: loadRightPanelOpen(),
  setRightPanelOpen: (rightPanelOpen) => {
    saveRightPanelOpen(rightPanelOpen);
    set({ rightPanelOpen });
  },
  toggleRightPanel: () =>
    set((s) => {
      const next = !s.rightPanelOpen;
      saveRightPanelOpen(next);
      return { rightPanelOpen: next };
    }),
  galleryOpen: false,
  openGallery: () => set({ galleryOpen: true }),
  closeGallery: () => set({ galleryOpen: false }),

  uiMode: loadUIMode(),
  setUIMode: (m) => {
    try { localStorage.setItem("ima2.uiMode", m); } catch {}
    set({ uiMode: m });
  },

  locale: loadLocale(),
  setLocale: (l) => {
    saveLocale(l);
    set({ locale: l });
  },

  graphNodes: [],
  graphEdges: [],
  graphUndoPast: [],
  graphUndoFuture: [],
  canUndoGraph: false,
  canRedoGraph: false,
  selectedNodeId: null,
  selectedEdgeId: null,
  selectNode: (selectedNodeId) => set({ selectedNodeId, selectedEdgeId: null }),
  selectEdge: (selectedEdgeId) =>
    set((s) => ({
      selectedEdgeId,
      selectedNodeId: null,
      rightPanelOpen: selectedEdgeId ? true : s.rightPanelOpen,
    })),
  undoGraph: () => {
    const s = get();
    if (hasPendingGraphNodes(s.graphNodes)) return;
    const previous = s.graphUndoPast.at(-1);
    if (!previous) return;
    const current = takeGraphSnapshot(s);
    const restored = restoreGraphSnapshot(previous, s.graphNodes);
    const graphUndoPast = s.graphUndoPast.slice(0, -1);
    const graphUndoFuture = [current, ...s.graphUndoFuture].slice(0, GRAPH_HISTORY_LIMIT);
    set({
      ...restored,
      ...graphHistoryPatch(graphUndoPast, graphUndoFuture),
    });
    get().scheduleGraphSave();
  },
  redoGraph: () => {
    const s = get();
    if (hasPendingGraphNodes(s.graphNodes)) return;
    const next = s.graphUndoFuture[0];
    if (!next) return;
    const current = takeGraphSnapshot(s);
    const restored = restoreGraphSnapshot(next, s.graphNodes);
    const graphUndoPast = [...s.graphUndoPast, current].slice(-GRAPH_HISTORY_LIMIT);
    const graphUndoFuture = s.graphUndoFuture.slice(1);
    set({
      ...restored,
      ...graphHistoryPatch(graphUndoPast, graphUndoFuture),
    });
    get().scheduleGraphSave();
  },
  resetGraphHistory: () => {
    set(clearGraphHistoryPatch());
  },
  buildNodeGeneratePreview: (clientId) =>
    buildNodeGenerateDelivery(get().graphNodes, get().graphEdges, clientId, {
      sessionId: get().activeSessionId,
    }),
  setGraphNodes: (graphNodes) => {
    commitUserGraphChange(get, set, { graphNodes });
  },
  setGraphEdges: (graphEdges) => {
    const nextEdges = graphEdges.map((e) => ({
      ...e,
      type: "workflowEdge",
      data: normalizeEdgeTransferData(e.data),
    }));
    commitUserGraphChange(get, set, {
      graphNodes: normalizeGraphParentPointers(get().graphNodes, nextEdges),
      graphEdges: nextEdges,
    });
  },

  sessions: [],
  activeSessionId: null,
  activeSessionGraphVersion: null,
  sessionLoading: false,

  async loadSessions() {
    try {
      const { sessions } = await apiListSessions();
      set({ sessions });
      const current = get().activeSessionId;
      if (!current && sessions.length > 0) {
        await get().switchSession(sessions[0].id);
      } else if (!current && sessions.length === 0) {
        await get().createAndSwitchSession(t("session.firstGraph"));
      }
    } catch (err) {
      console.warn("[sessions] load failed:", err);
    }
  },

  async switchSession(id) {
    set({ sessionLoading: true });
    await get().flushGraphSave();
    try {
      const { session } = await apiGetSession(id);
      const { graphNodes, graphEdges, graphVersion } = mapSessionToGraph(session);
      set({
        activeSessionId: id,
        activeSessionGraphVersion: graphVersion,
        graphNodes,
        graphEdges,
        selectedNodeId: null,
        selectedEdgeId: null,
        sessionLoading: false,
        ...clearGraphHistoryPatch(),
      });
      // Serialize reconcile and recovery so the two async writers don't race.
      // reconcileGraphPending already calls recoverGraphNodesFromHistory at the
      // end, but we await it explicitly here so any subsequent tick sees the
      // recovered state.
      await get().reconcileGraphPending().catch(() => {});
    } catch (err) {
      console.warn("[sessions] switch failed:", err);
      set({ sessionLoading: false });
      get().showToast(t("toast.sessionLoadFailed"), true);
    }
  },

  async reconcileGraphPending() {
    const sid = get().activeSessionId;
    if (!sid) return;
    const pendingNodes = get().graphNodes.filter(
      (n) => n.data?.pendingRequestId && (n.data.status === "pending" || n.data.status === "reconciling"),
    );
    if (pendingNodes.length > 0) {
      let jobs: Array<{ requestId: string; phase?: string }> = [];
      try {
        const res = await getInflight({ kind: "node", sessionId: sid });
        jobs = res.jobs;
      } catch {
        // If inflight cannot be queried, skip pending transition but still
        // attempt orphan recovery below.
        jobs = [];
      }
      const byId = new Map(jobs.map((j) => [j.requestId, j.phase] as const));
      const now = Date.now();
      const GRACE_MS = 10_000;
      const needsHistoryCheck = pendingNodes.some((n) => {
        const reqId = n.data.pendingRequestId;
        const startedAt = n.data.pendingStartedAt ?? 0;
        return !!reqId && !byId.has(reqId) && (!startedAt || now - startedAt >= GRACE_MS);
      });
      let historyItems: HistoryItem[] = [];
      if (needsHistoryCheck) {
        try {
          const res = await getHistory({ sessionId: sid, limit: HISTORY_LIMIT });
          historyItems = res.items;
        } catch {
          historyItems = [];
        }
      }
      let shouldSave = false;
      const next = get().graphNodes.map((n) => {
        const reqId = n.data?.pendingRequestId;
        if (!reqId) return n;
        if (n.data.status !== "pending" && n.data.status !== "reconciling") return n;
        if (byId.has(reqId)) {
          const phase = byId.get(reqId) ?? null;
          return {
            ...n,
            data: { ...n.data, status: "reconciling" as const, pendingPhase: phase },
          };
        }
        // Not in-flight anymore. Apply B grace window if we know when it started —
        // the server may have just finished and the response is still en route.
        const startedAt = n.data.pendingStartedAt ?? 0;
        if (startedAt && now - startedAt < GRACE_MS) {
          return {
            ...n,
            data: { ...n.data, status: "reconciling" as const },
          };
        }
        const recovered = findNodeHistoryResult(historyItems, sid, n);
        if (recovered) {
          shouldSave = true;
          return applyNodeHistoryResult(n, recovered);
        }

        // The old image may still be visible, but this request did not produce
        // a confirmed new result. Do not show Done for an unresolved regenerate.
        shouldSave = true;
        return {
          ...n,
          data: {
            ...n.data,
            pendingRequestId: null,
            pendingPhase: null,
            pendingStartedAt: null,
            status: "stale" as const,
            error: t("session.assetAbortedError"),
          },
        };
      });
      set({ graphNodes: next });
      if (shouldSave) scheduleGraphSaveImpl(get, set);
    }
    // Always attempt orphan recovery: covers older saved graphs and
    // cross-session completions that never landed in this graph.
    await recoverGraphNodesFromHistory(get, set).catch(() => {});
  },

  async createAndSwitchSession(title?: string) {
    if (title == null) title = t("session.untitled");
    try {
      const { session } = await apiCreateSession(title);
      set({
        sessions: [session as SessionSummary, ...get().sessions],
        activeSessionId: session.id,
        activeSessionGraphVersion: session.graphVersion,
        graphNodes: [],
        graphEdges: [],
        selectedNodeId: null,
        selectedEdgeId: null,
        ...clearGraphHistoryPatch(),
      });
    } catch (err) {
      console.warn("[sessions] create failed:", err);
      get().showToast(t("toast.sessionCreateFailed"), true);
    }
  },

  async renameCurrentSession(title) {
    const id = get().activeSessionId;
    if (!id) return;
    try {
      await apiRenameSession(id, title);
      set({
        sessions: get().sessions.map((s) =>
          s.id === id ? { ...s, title, updatedAt: Date.now() } : s,
        ),
      });
    } catch (err) {
      get().showToast(t("toast.sessionRenameFailed"), true);
    }
  },

  async deleteSessionById(id) {
    try {
      await apiDeleteSession(id);
      const remaining = get().sessions.filter((s) => s.id !== id);
      set({ sessions: remaining });
      if (get().activeSessionId === id) {
        set({
          activeSessionId: null,
          activeSessionGraphVersion: null,
          graphNodes: [],
          graphEdges: [],
          selectedNodeId: null,
          selectedEdgeId: null,
          ...clearGraphHistoryPatch(),
        });
        if (remaining.length > 0) {
          await get().switchSession(remaining[0].id);
        } else {
          await get().createAndSwitchSession(t("session.firstGraph"));
        }
      }
    } catch (err) {
      get().showToast(t("toast.sessionDeleteFailed"), true);
    }
  },

  scheduleGraphSave() {
    scheduleGraphSaveImpl(get, set);
  },

  async flushGraphSave() {
    await flushGraphSaveImpl(get, set);
  },

  addRootNode: () => {
    const clientId = newClientNodeId();
    const depth = 0;
    const siblings = get().graphNodes.filter((n) => !n.data.parentServerNodeId).length;
    const settings = currentNodeSettings(get());
    const name = nextNodeName(get().graphNodes);
    const node: GraphNode = {
      id: clientId,
      type: "imageNode",
      position: initialPos(depth, siblings),
      data: {
        clientId,
        serverNodeId: null,
        parentServerNodeId: null,
        name,
        prompt: "",
        imageUrl: null,
        status: "empty",
        pendingRequestId: null,
        pendingPhase: null,
        settings,
      },
    };
    commitUserGraphChange(get, set, {
      graphNodes: [...get().graphNodes, node],
      selectedNodeId: clientId,
      selectedEdgeId: null,
    });
    return clientId;
  },

  addChildNode: (parentClientId) => {
    const parent = get().graphNodes.find((n) => n.id === parentClientId);
    if (!parent) return parentClientId;
    if (!canUseNodeAsBranchParent(parent.data)) {
      get().showToast(t("toast.nodeBranchParentBusy"), true);
      return parentClientId;
    }
    const clientId = newClientNodeId();
    const settings = cloneNodeSettings(parent.data.settings);
    const name = nextNodeName(get().graphNodes);
    const position = findNearbyFreeNodePosition(preferredChildPosition(parent), get().graphNodes);
    const node: GraphNode = {
      id: clientId,
      type: "imageNode",
      position,
      data: {
        clientId,
        serverNodeId: null,
        parentServerNodeId: parent.data.serverNodeId,
        name,
        prompt: "",
        imageUrl: null,
        status: "empty",
        pendingRequestId: null,
        pendingPhase: null,
        settings,
      },
    };
    const edge = createChildEdge(parent, clientId);
    commitUserGraphChange(get, set, {
      graphNodes: [...get().graphNodes, node],
      graphEdges: [...get().graphEdges, edge],
      selectedNodeId: clientId,
      selectedEdgeId: null,
    });
    return clientId;
  },

  addSiblingNode: (sourceClientId) => {
    const source = get().graphNodes.find((n) => n.id === sourceClientId);
    if (!source) return sourceClientId;

    const incomingEdge = get().graphEdges.find((e) => e.target === sourceClientId);
    if (!incomingEdge) {
      const clientId = newClientNodeId();
      const depth = 0;
      const siblings = get().graphNodes.filter((n) => !n.data.parentServerNodeId).length;
      const name = nextNodeName(get().graphNodes);
      const node: GraphNode = {
        id: clientId,
        type: "imageNode",
        position: initialPos(depth, siblings),
        data: {
          clientId,
          serverNodeId: null,
          parentServerNodeId: null,
          name,
          prompt: source.data.prompt,
          imageUrl: null,
          status: "empty",
          pendingRequestId: null,
          pendingPhase: null,
          settings: cloneNodeSettings(source.data.settings),
        },
      };
      commitUserGraphChange(get, set, {
        graphNodes: [...get().graphNodes, node],
        selectedNodeId: clientId,
        selectedEdgeId: null,
      });
      return clientId;
    }

    const parentClientId = incomingEdge.source;
    const parent = get().graphNodes.find((n) => n.id === parentClientId);
    if (!parent) return sourceClientId;

    const clientId = newClientNodeId();
    const name = nextNodeName(get().graphNodes);
    const position = findNearbyFreeNodePosition(preferredChildPosition(parent), get().graphNodes);
    const node: GraphNode = {
      id: clientId,
      type: "imageNode",
      position,
      data: {
        clientId,
        serverNodeId: null,
        parentServerNodeId: parent.data.serverNodeId,
        name,
        prompt: source.data.prompt,
        imageUrl: null,
        status: "empty",
        pendingRequestId: null,
        pendingPhase: null,
        settings: cloneNodeSettings(source.data.settings),
      },
    };
    const edge = createGraphEdge(parentClientId, clientId, incomingEdge.data);
    commitUserGraphChange(get, set, {
      graphNodes: [...get().graphNodes, node],
      graphEdges: [...get().graphEdges, edge],
      selectedNodeId: clientId,
      selectedEdgeId: null,
    });
    return clientId;
  },

  updateNodeName: (clientId, name) => {
    commitUserGraphChange(get, set, {
      graphNodes: get().graphNodes.map((n) =>
        n.id === clientId ? { ...n, data: { ...n.data, name } } : n,
      ),
    });
  },

  updateNodePrompt: (clientId, prompt) => {
    commitUserGraphChange(get, set, {
      graphNodes: get().graphNodes.map((n) =>
        n.id === clientId ? { ...n, data: { ...n.data, prompt } } : n,
      ),
    });
  },

  updateEdgeTransfer: (edgeId, patch) => {
    const next = applyEdgeTransferPatch(get().graphNodes, get().graphEdges, edgeId, patch);
    if (!next) return;
    commitUserGraphChange(get, set, {
      graphNodes: next.graphNodes,
      graphEdges: next.graphEdges,
      selectedEdgeId: edgeId,
      selectedNodeId: null,
    });
  },

  setEdgeImageTransfer: (edgeId, mode) => {
    const next = applyEdgeTransferPatch(get().graphNodes, get().graphEdges, edgeId, {
      imageTransfer: mode,
    });
    if (!next) return;
    commitUserGraphChange(get, set, {
      graphNodes: next.graphNodes,
      graphEdges: next.graphEdges,
      selectedEdgeId: edgeId,
      selectedNodeId: null,
    });
  },

  cycleEdgeImageTransferQuiet: (edgeId) => {
    const edge = get().graphEdges.find((e) => e.id === edgeId);
    if (!edge) return;
    const current = normalizeEdgeTransferData(edge.data);
    const next = applyEdgeTransferPatch(get().graphNodes, get().graphEdges, edgeId, {
      imageTransfer: nextImageTransferMode(current.imageTransfer),
    });
    if (!next) return;
    commitUserGraphChange(get, set, {
      graphNodes: next.graphNodes,
      graphEdges: next.graphEdges,
      selectedEdgeId: null,
    });
  },

  toggleEdgeTransfer: (edgeId, key) => {
    const edge = get().graphEdges.find((e) => e.id === edgeId);
    if (!edge) return;
    const current = normalizeEdgeTransferData(edge.data);
    get().updateEdgeTransfer(edgeId, { [key]: !current[key] });
  },

  toggleEdgeTransferQuiet: (edgeId, key) => {
    const edge = get().graphEdges.find((e) => e.id === edgeId);
    if (!edge) return;
    const current = normalizeEdgeTransferData(edge.data);
    const next = applyEdgeTransferPatch(get().graphNodes, get().graphEdges, edgeId, {
      [key]: !current[key],
    });
    if (!next) return;
    commitUserGraphChange(get, set, {
      graphNodes: next.graphNodes,
      graphEdges: next.graphEdges,
      selectedEdgeId: null,
    });
  },

  updateNodeSettings: (clientId, patch) => {
    const nodes = get().graphNodes;
    const edges = get().graphEdges;
    const node = nodes.find((n) => n.id === clientId);
    if (!node) return;
    const incomingEdge = findIncomingEdgeFor(edges, clientId);
    const shouldDisableIncomingSettings =
      !!incomingEdge && normalizeEdgeTransferData(incomingEdge.data).transferSettings;
    const nextEdges = shouldDisableIncomingSettings
      ? edges.map((e) =>
          e.id === incomingEdge.id
            ? {
                ...e,
                data: normalizeEdgeTransferData({ ...e.data, transferSettings: false }),
              }
            : e,
        )
      : edges;
    const nextSettings = normalizeNodeSettings({ ...node.data.settings, ...patch }, node.data.settings);
    const nextNodes = nodes.map((n) =>
      n.id === clientId
        ? {
            ...n,
            data: {
              ...n.data,
              settings: nextSettings,
            },
          }
        : n,
    );
    commitUserGraphChange(get, set, {
      graphNodes: syncEffectiveNodeSettings(nextNodes, nextEdges),
      graphEdges: nextEdges,
    });
  },

  copyParentPromptToNode: (clientId) => {
    const nodes = get().graphNodes;
    const node = nodes.find((n) => n.id === clientId);
    const parent = findParentNodeFor(nodes, get().graphEdges, clientId);
    if (!node || !parent) return;
    commitUserGraphChange(get, set, {
      graphNodes: nodes.map((n) =>
        n.id === clientId
          ? {
              ...n,
              data: {
                ...n.data,
                prompt: joinParentPrompt(parent.data.prompt, node.data.prompt),
              },
            }
          : n,
      ),
    });
  },

  copyParentSettingsToNode: (clientId) => {
    const nodes = get().graphNodes;
    const edges = get().graphEdges;
    const parent = findParentNodeFor(nodes, edges, clientId);
    if (!parent) return;
    const nextNodes = nodes.map((n) =>
      n.id === clientId
        ? { ...n, data: { ...n.data, settings: cloneNodeSettings(parent.data.settings) } }
        : n,
    );
    commitUserGraphChange(get, set, { graphNodes: syncEffectiveNodeSettings(nextNodes, edges) });
  },

  duplicateBranchRoot: (sourceClientId) => {
    const source = get().graphNodes.find((n) => n.id === sourceClientId);
    if (!source) return sourceClientId;
    const clientId = newClientNodeId();
    const rootSiblings = get().graphNodes.filter((n) => !n.data.parentServerNodeId).length;
    const name = nextNodeName(get().graphNodes);
    const node: GraphNode = {
      id: clientId,
      type: "imageNode",
      position: { x: source.position.x + 420, y: source.position.y + 40 },
      data: {
        clientId,
        serverNodeId: null,
        parentServerNodeId: null,
        name,
        prompt: source.data.prompt,
        imageUrl: null,
        status: "empty",
        pendingRequestId: null,
        pendingPhase: null,
        settings: cloneNodeSettings(source.data.settings),
      },
    };
    // no parent edge — becomes a new branch root at root layer
    void rootSiblings;
    commitUserGraphChange(get, set, {
      graphNodes: [...get().graphNodes, node],
      selectedNodeId: clientId,
      selectedEdgeId: null,
    });
    return clientId;
  },

  async generateNode(clientId, options) {
    const targetClientId = clientId;
    const selectOnComplete = options?.selectOnComplete ?? true;
    const graphNodes = get().graphNodes;
    const graphEdges = get().graphEdges;
    const delivery = buildNodeGenerateDelivery(graphNodes, graphEdges, targetClientId);
    if (!delivery) return false;
    const { node, displayPrompt, nodeSettings, parentNodeId, payload } = delivery;
    const hadGeneratedImage = !!node.data.serverNodeId || !!node.data.imageUrl;
    const blockingIssue = delivery.issues.find((issue) => issue.blocking);
    if (blockingIssue) {
      get().showToast(blockingIssue.message, true);
      return false;
    }
    const s = get();

    // Capture request session so a later session switch does not corrupt graph B.
    const requestSessionId = s.activeSessionId;
    // mark pending — request-unique flightId so retries on the same node don't collide.
    const startedAt = Date.now();
    const randSuffix = Math.random().toString(36).slice(2, 6);
    const flightId = `fn_${targetClientId}_${startedAt}_${randSuffix}`;
    const nextInFlight: PersistedInFlight[] = [
      ...s.inFlight,
      {
        id: flightId,
        prompt: displayPrompt,
        startedAt,
        kind: "node",
        sessionId: requestSessionId,
        clientNodeId: targetClientId,
      },
    ];
    saveInFlight(nextInFlight);
    set({
      graphNodes: get().graphNodes.map((n) =>
        n.id === targetClientId
          ? {
              ...n,
              data: {
                ...n.data,
                status: "pending",
                pendingRequestId: flightId,
                pendingPhase: "queued",
                pendingStartedAt: startedAt,
                error: undefined,
              },
            }
          : n,
      ),
      activeGenerations: s.activeGenerations + 1,
      inFlight: nextInFlight,
    });
    get().startInFlightPolling();
    get().scheduleGraphSave();

    let graphMutated = true; // pending set above already mutated the graph if same-session
    let succeeded = false;

    try {
      const res = await postNodeGenerate({
        ...payload,
        requestId: flightId,
        sessionId: requestSessionId,
        clientNodeId: targetClientId,
      });
      succeeded = true;
      if (get().activeSessionId === requestSessionId) {
        const nextNodes = get().graphNodes.map((n) =>
          n.id === targetClientId
            ? {
                ...n,
                data: {
                  ...n.data,
                  serverNodeId: res.nodeId,
                  imageUrl: res.url,
                  status: "ready" as const,
                  pendingRequestId: null,
                  pendingPhase: null,
                  pendingStartedAt: null,
                  elapsed: res.elapsed,
                  webSearchCalls: res.webSearchCalls,
                  filename: res.filename,
                  provider: res.provider,
                  quality: nodeSettings.quality,
                  size: payload.size,
                  format: nodeSettings.format,
                  moderation: res.moderation ?? nodeSettings.moderation,
                  usage: res.usage,
                  createdAt: Date.now(),
                  error: undefined,
                },
              }
            : n,
        );
        set({
          graphNodes: normalizeGraphParentPointers(nextNodes, get().graphEdges),
          ...(selectOnComplete ? { selectedNodeId: targetClientId } : {}),
        });
        get().addHistoryItem({
          image: res.url,
          url: res.url,
          filename: res.filename,
          prompt: displayPrompt,
          provider: res.provider,
          quality: nodeSettings.quality,
          size: payload.size,
          format: nodeSettings.format,
          moderation: res.moderation ?? nodeSettings.moderation,
          usage: res.usage,
          thumb: res.url,
          createdAt: Date.now(),
          sessionId: requestSessionId,
          nodeId: res.nodeId,
          clientNodeId: targetClientId,
          kind: parentNodeId ? "edit" : "generate",
        });
        graphMutated = true;
        get().showToast(t("toast.nodeCreated", { id: res.nodeId.slice(0, 8), elapsed: res.elapsed }));
      }
      // cross-session: result will be restored via recoverGraphNodesFromHistory
      // when the user returns to the originating session.
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("toast.nodeCreateFailed");
      if (get().activeSessionId === requestSessionId) {
        set({
          graphNodes: get().graphNodes.map((n) =>
            n.id === targetClientId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: hadGeneratedImage ? ("stale" as const) : ("error" as const),
                    pendingRequestId: null,
                    pendingPhase: null,
                    pendingStartedAt: null,
                    error: msg,
                  },
                }
              : n,
          ),
        });
        graphMutated = true;
        get().showToast(msg, true);
      }
      // cross-session: silent — user is on a different graph
    } finally {
      // Global state cleanup must always run regardless of active session,
      // otherwise the spinner/counter leaks.
      const remaining = get().inFlight.filter((f) => f.id !== flightId);
      saveInFlight(remaining);
      set({
        activeGenerations: Math.max(0, get().activeGenerations - 1),
        inFlight: remaining,
      });
      // Persist the graph only if we actually mutated it AND we are still on
      // the originating session.
      if (get().activeSessionId === requestSessionId && graphMutated) {
        get().scheduleGraphSave();
      }
    }
    return succeeded;
  },

  async regenerateBranch(clientId) {
    const nodes = get().graphNodes;
    const edges = get().graphEdges;
    const branchLevels = collectBranchNodeLevels(edges, clientId);
    const branchIds = branchLevels.flat();
    const branchNodes = branchIds
      .map((id) => nodes.find((n) => n.id === id))
      .filter((node): node is GraphNode => Boolean(node));
    if (branchNodes.length === 0) return;
    if (branchNodes.some((node) => node.data.status === "pending" || node.data.status === "reconciling")) {
      get().showToast(t("toast.nodeBranchBusy"), true);
      return;
    }
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(t("node.branchRegenerateConfirm", { count: branchNodes.length }));
    if (!confirmed) return;

    for (const level of branchLevels) {
      const results = await Promise.all(
        level.map((id) => get().generateNode(id, { selectOnComplete: false })),
      );
      if (results.some((ok) => !ok)) {
        get().showToast(t("toast.nodeBranchStopped"), true);
        set({ selectedNodeId: clientId, selectedEdgeId: null });
        return;
      }
    }
    set({ selectedNodeId: clientId, selectedEdgeId: null });
    get().showToast(t("toast.nodeBranchComplete", { count: branchIds.length }));
  },

  deleteNode: (clientId) => {
    const doomed = get().graphNodes.find((n) => n.id === clientId);
    const reqId = doomed?.data?.pendingRequestId;
    if (reqId) void cancelInflight(reqId);
    const nextEdges = get().graphEdges.filter((e) => e.source !== clientId && e.target !== clientId);
    const nextNodes = get().graphNodes.filter((n) => n.id !== clientId);
    commitUserGraphChange(get, set, {
      graphNodes: normalizeGraphParentPointers(nextNodes, nextEdges),
      graphEdges: nextEdges,
      selectedNodeId: get().selectedNodeId === clientId ? null : get().selectedNodeId,
      selectedEdgeId: null,
    });
  },

  deleteNodes: (clientIds) => {
    const set_ = new Set(clientIds);
    const selectedNodeId = get().selectedNodeId;
    for (const n of get().graphNodes) {
      if (set_.has(n.id) && n.data?.pendingRequestId) {
        void cancelInflight(n.data.pendingRequestId);
      }
    }
    const nextEdges = get().graphEdges.filter((e) => !set_.has(e.source) && !set_.has(e.target));
    const nextNodes = get().graphNodes.filter((n) => !set_.has(n.id));
    commitUserGraphChange(get, set, {
      graphNodes: normalizeGraphParentPointers(nextNodes, nextEdges),
      graphEdges: nextEdges,
      selectedNodeId: selectedNodeId && set_.has(selectedNodeId) ? null : selectedNodeId,
      selectedEdgeId: null,
    });
  },

  addChildNodeAt: (parentClientId, position) => {
    const parent = get().graphNodes.find((n) => n.id === parentClientId);
    if (!parent) return parentClientId;
    if (!canUseNodeAsBranchParent(parent.data)) {
      get().showToast(t("toast.nodeBranchParentBusy"), true);
      return parentClientId;
    }
    const clientId = newClientNodeId();
    const settings = cloneNodeSettings(parent.data.settings);
    const name = nextNodeName(get().graphNodes);
    const safePosition = findNearbyFreeNodePosition(position, get().graphNodes);
    const node: GraphNode = {
      id: clientId,
      type: "imageNode",
      position: safePosition,
      data: {
        clientId,
        serverNodeId: null,
        parentServerNodeId: parent.data.serverNodeId,
        name,
        prompt: "",
        imageUrl: null,
        status: "empty",
        pendingRequestId: null,
        pendingPhase: null,
        settings,
      },
    };
    const edge = createChildEdge(parent, clientId);
    commitUserGraphChange(get, set, {
      graphNodes: [...get().graphNodes, node],
      graphEdges: [...get().graphEdges, edge],
      selectedNodeId: clientId,
      selectedEdgeId: null,
    });
    return clientId;
  },

  connectNodes: (sourceClientId, targetClientId) => {
    if (sourceClientId === targetClientId) return;
    const existing = get().graphEdges.find(
      (e) => e.source === sourceClientId && e.target === targetClientId,
    );
    if (existing) return;
    const source = get().graphNodes.find((n) => n.id === sourceClientId);
    const target = get().graphNodes.find((n) => n.id === targetClientId);
    if (!source) return;
    if (!target) return;
    if (!canUseNodeAsBranchParent(source.data)) {
      get().showToast(t("toast.nodeBranchParentBusy"), true);
      return;
    }
    if (target.data.status === "pending" || target.data.status === "reconciling") {
      get().showToast(t("toast.nodeTargetBusy"), true);
      return;
    }
    if (wouldCreateCycle(get().graphEdges, sourceClientId, targetClientId)) {
      get().showToast(t("toast.nodeCycleRejected"), true);
      return;
    }
    const edge = createChildEdge(source, targetClientId);
    const edgeData = normalizeEdgeTransferData(edge.data);
    const nextTargetData =
      target.data.status === "empty" && !target.data.serverNodeId && !target.data.imageUrl
        ? {
            ...target.data,
            parentServerNodeId: source.data.serverNodeId,
            settings: edgeData.transferSettings
              ? cloneNodeSettings(source.data.settings)
              : target.data.settings,
          }
        : {
            ...target.data,
            parentServerNodeId: source.data.serverNodeId,
            settings: edgeData.transferSettings
              ? cloneNodeSettings(source.data.settings)
              : target.data.settings,
          };
    const nextEdges = [
      ...get().graphEdges.filter((e) => e.target !== targetClientId),
      edge,
    ];
    const nextNodes = get().graphNodes.map((n) =>
      n.id === targetClientId ? { ...n, data: nextTargetData } : n,
    );
    commitUserGraphChange(get, set, {
      graphNodes: syncEffectiveNodeSettings(nextNodes, nextEdges),
      graphEdges: nextEdges,
      selectedNodeId: targetClientId,
      selectedEdgeId: null,
    });
  },

  detachNodeFromParent: (clientId) => {
    const target = get().graphNodes.find((n) => n.id === clientId);
    if (!target) return;
    commitUserGraphChange(get, set, {
      graphNodes: get().graphNodes.map((n) =>
        n.id === clientId ? { ...n, data: { ...n.data, parentServerNodeId: null } } : n,
      ),
      graphEdges: get().graphEdges.filter((e) => e.target !== clientId),
      selectedEdgeId: null,
    });
  },

  detachSelectedEdge: () => {
    const edge = get().graphEdges.find((e) => e.id === get().selectedEdgeId);
    if (!edge) return;
    get().detachNodeFromParent(edge.target as ClientNodeId);
  },

  addChildFromSelectedEdge: () => {
    const edge = get().graphEdges.find((e) => e.id === get().selectedEdgeId);
    if (!edge) return null;
    return get().addChildNode(edge.source as ClientNodeId);
  },

  async importHistoryItemAsNode(item) {
    if (!item.filename) {
      get().showToast(t("toast.nodeImportNeedsFile"), true);
      return;
    }
    let sessionId = get().activeSessionId;
    if (!sessionId) {
      await get().createAndSwitchSession(t("session.firstGraph"));
      sessionId = get().activeSessionId;
    }
    if (!sessionId) {
      get().showToast(t("toast.nodeImportFailed"), true);
      return;
    }
    const clientId = newClientNodeId();
    const name = nextNodeName(get().graphNodes);
    const currentSettings = currentNodeSettings(get());
    try {
      const res = await postNodeImport({
        filename: item.filename,
        prompt: item.prompt,
        sessionId,
        clientNodeId: clientId,
      });
      const importedSize = parseSizeSetting(res.size ?? item.size);
      const rootCount = get().graphNodes.filter((n) => !n.data.parentServerNodeId).length;
      const node: GraphNode = {
        id: clientId,
        type: "imageNode",
        position: initialPos(0, rootCount),
        data: {
          clientId,
          serverNodeId: res.nodeId,
          parentServerNodeId: null,
          name,
          prompt: res.prompt,
          imageUrl: res.url,
          status: "ready",
          pendingRequestId: null,
          pendingPhase: null,
          filename: res.filename,
          provider: res.provider,
          quality: res.quality ?? item.quality,
          size: res.size ?? item.size,
          format: res.format ?? item.format,
          moderation: res.moderation ?? item.moderation,
          settings: normalizeNodeSettings(
            {
              quality: res.quality ?? item.quality,
              sizePreset: importedSize?.sizePreset,
              customW: importedSize?.customW,
              customH: importedSize?.customH,
              format: res.format ?? item.format,
              moderation: res.moderation ?? item.moderation,
            },
            currentSettings,
          ),
          webSearchCalls: res.webSearchCalls ?? 0,
          createdAt: res.createdAt,
        },
      };
      set({
        uiMode: "node",
        graphNodes: [...get().graphNodes, node],
        selectedNodeId: clientId,
        selectedEdgeId: null,
        rightPanelOpen: true,
      });
      get().addHistoryItem({
        image: res.url,
        url: res.url,
        filename: res.filename,
        prompt: res.prompt,
        provider: res.provider,
        quality: res.quality ?? item.quality,
        size: res.size ?? item.size,
        format: res.format ?? item.format,
        moderation: res.moderation ?? item.moderation,
        thumb: res.url,
        createdAt: res.createdAt,
        sessionId,
        nodeId: res.nodeId,
        clientNodeId: clientId,
        kind: "import",
      });
      saveRightPanelOpen(true);
      try { localStorage.setItem("ima2.uiMode", "node"); } catch {}
      get().scheduleGraphSave();
      get().showToast(t("toast.nodeImported"));
    } catch (err) {
      console.warn("[node] import failed:", err);
      get().showToast(t("toast.nodeImportFailed"), true);
    }
  },

  async importCurrentImageAsNode() {
    const item = get().currentImage;
    if (!item) {
      get().showToast(t("toast.noCurrentImageForRef"), true);
      return;
    }
    await get().importHistoryItemAsNode(item);
  },

  setProvider: (provider) => set({ provider }),
  setQuality: (quality) => set({ quality }),
  setSizePreset: (sizePreset) => set({ sizePreset }),
  setCustomSize: (w, h) => set({ customW: snap16(w), customH: snap16(h) }),
  setFormat: (format) => set({ format }),
  setModeration: (moderation) => set({ moderation }),
  setCount: (count) => set({ count }),
  setPrompt: (prompt) => set({ prompt }),

  selectHistory: (item) => {
    selectHistoryItem(item, set);
  },

  selectPreviousImage: () => {
    const s = get();
    const idx = currentHistoryIndex(s.history, s.currentImage);
    if (idx <= 0) return;
    selectHistoryItem(s.history[idx - 1], set);
  },

  selectNextImage: () => {
    const s = get();
    const idx = currentHistoryIndex(s.history, s.currentImage);
    if (idx < 0 || idx >= s.history.length - 1) return;
    selectHistoryItem(s.history[idx + 1], set);
  },

  removeFromHistory: (filename) => {
    const s = get();
    const history = s.history.filter((h) => h.filename !== filename);
    const stillCurrent =
      s.currentImage && s.currentImage.filename === filename ? null : s.currentImage;
    set({ history, currentImage: stillCurrent });
    if (stillCurrent === null) saveSelectedFilename(null);
  },

  addHistoryItem: (item) => {
    const s = get();
    const exists = s.history.some(
      (h) => item.filename && h.filename === item.filename,
    );
    if (exists) return;
    const withDefaults: GenerateItem = {
      ...item,
      image: item.image || item.url || "",
      url: item.url ?? item.image,
      thumb: item.thumb ?? item.url ?? item.image,
      createdAt: item.createdAt || Date.now(),
    };
    set({ history: [withDefaults, ...s.history].slice(0, HISTORY_LIMIT) });
  },

  getResolvedSize: () => {
    const { sizePreset, customW, customH } = get();
    return sizePreset === "custom" ? `${customW}x${customH}` : sizePreset;
  },

  async generate() {
    const s = get();
    const prompt = s.prompt.trim();
    if (!prompt) return;

    const size = s.getResolvedSize();

    const flightId = `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = Date.now();
    const nextInFlight: PersistedInFlight[] = [
      ...s.inFlight,
      { id: flightId, prompt, startedAt },
    ];
    saveInFlight(nextInFlight);
    set({
      activeGenerations: s.activeGenerations + 1,
      inFlight: nextInFlight,
    });
    get().startInFlightPolling();

    try {
      const payload = {
        prompt,
        quality: s.quality,
        size,
        format: s.format,
        moderation: s.moderation,
        provider: s.provider,
        n: s.count,
        requestId: flightId,
        ...(s.referenceImages.length
          ? { references: s.referenceImages.map((d) => d.replace(/^data:[^;]+;base64,/, "")) }
          : {}),
      };

      const res: GenerateResponse = await postGenerate(payload);

      if (isMultiResponse(res) && res.images.length > 1) {
        for (const img of res.images) {
          const item: GenerateItem = {
            image: img.image,
            filename: img.filename,
            prompt,
            elapsed: res.elapsed,
            provider: res.provider,
            usage: res.usage,
            quality: res.quality ?? s.quality,
            size: res.size ?? size,
          };
          await addHistory(item, set, get);
        }
        get().showToast(t("toast.generatedBatch", { count: res.images.length, elapsed: res.elapsed }));
      } else {
        let item: GenerateItem;
        if (isMultiResponse(res)) {
          const first = res.images[0];
          item = {
            image: first.image,
            filename: first.filename,
            prompt,
            elapsed: res.elapsed,
            provider: res.provider,
            usage: res.usage,
            quality: res.quality ?? s.quality,
            size: res.size ?? size,
          };
        } else {
          item = {
            image: res.image,
            filename: res.filename,
            prompt,
            elapsed: res.elapsed,
            provider: res.provider,
            usage: res.usage,
            quality: res.quality ?? s.quality,
            size: res.size ?? size,
          };
        }
        await addHistory(item, set, get);
        get().showToast(t("toast.generatedSingle", { elapsed: res.elapsed }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("toast.generateFailed");
      get().showToast(msg, true);
    } finally {
      const remaining = get().inFlight.filter((f) => f.id !== flightId);
      saveInFlight(remaining);
      set({
        activeGenerations: Math.max(0, get().activeGenerations - 1),
        inFlight: remaining,
      });
    }
  },

  hydrateHistory() {
    void (async () => {
      try {
        const res = await getHistory({ limit: HISTORY_LIMIT });
        const history: GenerateItem[] = res.items.map((it) => ({
          image: it.url,
          url: it.url,
          filename: it.filename,
          prompt: it.prompt || undefined,
          provider: it.provider,
          quality: it.quality || undefined,
          size: it.size || undefined,
          usage: (it.usage as GenerateItem["usage"]) ?? undefined,
          thumb: it.url,
          createdAt: it.createdAt,
          sessionId: it.sessionId ?? null,
          nodeId: it.nodeId ?? null,
          clientNodeId: it.clientNodeId ?? null,
          kind: narrowGenerateKind(it.kind),
        }));
        if (history.length > 0) {
          const selected = loadSelectedFilename();
          const matched = selected
            ? history.find((it) => it.filename === selected)
            : null;
          set({ history, currentImage: matched ?? history[0] });
          if (!matched) saveSelectedFilename(history[0]?.filename ?? null);
        }
      } catch (err) {
        console.warn("[history] load failed:", err);
      }
    })();
  },

  showToast(message, error = false) {
    set({ toast: { message, error, id: Date.now() + Math.random() } });
  },
}));

// ── Graph autosave (module-level debounce) ──
const SAVE_DEBOUNCE_MS = 800;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveGraphPromise: Promise<void> | null = null;
let saveDirty = false;

// Sanitize a node's data for PUT /api/sessions/:id/graph payload.
// Pending/reconciling is intentionally persisted so reload/session-switch
// recovery can match the active request against inflight jobs or history.
// This function is payload-only: the in-memory `graphNodes` is NOT touched.
function sanitizeForSave(d: ImageNodeData): Record<string, unknown> {
  const persisted = { ...(d as unknown as Record<string, unknown>) };
  delete persisted.graphLevel;
  delete persisted.graphIsolated;
  delete persisted.graphTreeRootId;
  delete persisted.graphTreeIndex;
  delete persisted.graphTreeColor;
  return persisted;
}

// Recover nodes whose asset lives on disk (via /api/history) but whose
// client-side asset pointer was lost (older save, reload, HMR, conflict reload).
// Candidate = node with neither imageUrl nor serverNodeId. The matching key
// is (sessionId, clientNodeId); when pendingStartedAt is known we require
// createdAt >= pendingStartedAt to avoid picking an older retry's asset.
async function recoverGraphNodesFromHistory(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
): Promise<void> {
  const sid = get().activeSessionId;
  if (!sid) return;
  const candidates = get().graphNodes.filter(
    (n) => !n.data.imageUrl && !n.data.serverNodeId,
  );
  if (candidates.length === 0) return;

  let items: Array<{
    url: string;
    createdAt: number;
    sessionId?: string | null;
    nodeId?: string | null;
    clientNodeId?: string | null;
  }> = [];
  try {
    const res = await getHistory({ sessionId: sid, limit: HISTORY_LIMIT });
    items = res.items;
  } catch {
    // History fetch failure is non-fatal — leave nodes as they are.
    return;
  }

  let changed = false;
  const next = get().graphNodes.map((n) => {
    if (n.data.imageUrl || n.data.serverNodeId) return n;
    const startedAt = n.data.pendingStartedAt ?? 0;
    const recovered = items.find(
      (h) =>
        (h.sessionId ?? null) === sid &&
        (h.clientNodeId ?? null) === n.id &&
        (!startedAt || (h.createdAt ?? 0) >= startedAt),
    );
    if (!recovered) return n;
    changed = true;
    return {
      ...n,
      data: {
        ...n.data,
        status: "ready" as const,
        imageUrl: recovered.url, // canonical — jpeg/webp all covered
        serverNodeId: recovered.nodeId ?? n.data.serverNodeId,
        pendingRequestId: null,
        pendingPhase: null,
        pendingStartedAt: null,
        error: undefined,
      },
    };
  });

  if (!changed) return;
  set({ graphNodes: next });
  // Persist the recovered imageUrl so future reloads don't need to re-recover.
  scheduleGraphSaveImpl(get, set);
}

async function reloadSessionAfterConflict(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
): Promise<void> {
  const id = get().activeSessionId;
  if (!id) return;
  const { session } = await apiGetSession(id);
  const { graphNodes, graphEdges, graphVersion } = mapSessionToGraph(session);
  set({
    graphNodes,
    graphEdges,
    activeSessionGraphVersion: graphVersion,
    selectedEdgeId: null,
    ...clearGraphHistoryPatch(),
  });
  get().showToast(t("toast.sessionReloadedElsewhere"), true);
  // After a server-driven reload, try to restore any nodes that lost their
  // client-side asset pointer.
  await recoverGraphNodesFromHistory(get, set).catch(() => {});
}

type GraphSaveResult = "saved" | "skipped" | "conflict" | "failed";

function graphSavePayload(s: AppState): {
  id: string;
  graphVersion: number;
  nodes: SessionGraphNode[];
  edges: SessionGraphEdge[];
} | null {
  const id = s.activeSessionId;
  const graphVersion = s.activeSessionGraphVersion;
  if (!id) return null;
  if (graphVersion == null) return null;
  const nodes = s.graphNodes.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    data: sanitizeForSave(n.data),
  }));
  const edges = s.graphEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: normalizeEdgeTransferData(e.data),
  }));
  return { id, graphVersion, nodes, edges };
}

function doSave(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
): Promise<GraphSaveResult> {
  const payload = graphSavePayload(get());
  if (!payload) return Promise.resolve("skipped");
  const { id, graphVersion, nodes, edges } = payload;
  return saveSessionGraph(id, graphVersion, nodes, edges)
    .then((res) => {
      if (get().activeSessionId === id) {
        set({ activeSessionGraphVersion: res.graphVersion });
      }
      return "saved" as const;
    })
    .catch(async (err) => {
      if ((err as { status?: number }).status === 409) {
        await reloadSessionAfterConflict(get, set);
        return "conflict" as const;
      }
      console.warn("[sessions] save failed:", err);
      return "failed" as const;
    });
}

function ensureSaveLoop(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
): Promise<void> {
  if (saveGraphPromise) return saveGraphPromise;
  saveGraphPromise = (async () => {
    while (saveDirty) {
      saveDirty = false;
      const result = await doSave(get, set);
      if (result === "conflict") {
        saveDirty = false;
        break;
      }
    }
  })().finally(() => {
    saveGraphPromise = null;
    if (saveDirty) {
      void ensureSaveLoop(get, set);
    }
  });
  return saveGraphPromise;
}

function scheduleGraphSaveImpl(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
) {
  const s = get();
  if (!s.activeSessionId) return;
  if (s.sessionLoading) return;
  saveDirty = true;
  if (saveGraphPromise) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void ensureSaveLoop(get, set);
  }, SAVE_DEBOUNCE_MS);
}

async function flushGraphSaveImpl(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (saveDirty || saveGraphPromise) await ensureSaveLoop(get, set);
}

// Synchronous-ish save on page unload via sendBeacon
// (fetch in beforeunload is not reliable in modern browsers).
export function flushGraphSaveBeacon(get: () => AppState): void {
  const s = get();
  if (!s.activeSessionId) return;
  if (s.activeSessionGraphVersion == null) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const nodes = s.graphNodes.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    data: sanitizeForSave(n.data),
  }));
  const edges = s.graphEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: normalizeEdgeTransferData(e.data),
  }));
  const url = `/api/sessions/${encodeURIComponent(s.activeSessionId)}/graph`;
  const body = JSON.stringify({ nodes, edges });
  try {
    void fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": String(s.activeSessionGraphVersion),
      },
      body,
      keepalive: true,
    });
  } catch {}
}

async function addHistory(
  item: GenerateItem,
  set: (p: Partial<AppState>) => void,
  get: () => AppState,
): Promise<void> {
  const thumb = await compressImage(item.image).catch(() => item.image);
  const url = item.filename ? `/generated/${item.filename}` : item.image;
  const withThumb: GenerateItem = {
    ...item,
    thumb,
    url,
    createdAt: item.createdAt || Date.now(),
  };
  const history = [withThumb, ...get().history].slice(0, HISTORY_LIMIT);
  saveSelectedFilename(withThumb.filename ?? null);
  set({ history, currentImage: withThumb });
}
