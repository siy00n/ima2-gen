import { create } from "zustand";
import type {
  Count,
  Format,
  GenerateItem,
  GenerateResponse,
  ImageModel,
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
  toggleHistoryFavorite,
  readImageMetadata,
  postNodeGenerate,
  postNodeAttach,
  postNodeImport,
  listSessions as apiListSessions,
  createSession as apiCreateSession,
  getSession as apiGetSession,
  renameSession as apiRenameSession,
  deleteSession as apiDeleteSession,
  saveSessionGraph,
  type HistoryItem,
  type SessionGraphEdge,
  type SessionGraphNode,
  type SessionSummary,
} from "../lib/api";
import type {
  PromptCreatePayload,
  PromptItem,
  PromptLibraryImportPayload,
  PromptUpdatePayload,
} from "../lib/promptLibrary";
import { compressImage } from "../lib/image";
import { compressToBase64, hasAlphaChannel, isHeic } from "../lib/compress";
import { snap16 } from "../lib/size";
import { newClientNodeId, initialPos, type ClientNodeId } from "../lib/graph";
import {
  applyEdgeTransferPatch,
  applyNodeHistoryResult,
  buildNodeGenerateDelivery,
  canAttachImageToNodeData,
  canRemoveNodeImageReference,
  canUseNodeAsBranchParent,
  collectBranchNodeLevels,
  createChildEdge,
  createGraphEdge,
  currentNodeSettings,
  findNearbyFreeNodePosition,
  findNodeHistoryResult,
  findParentNodeFor,
  isSupportedNodeAttachFile,
  joinParentPrompt,
  mapSessionToGraph,
  nextNodeName,
  nodeSettingsFromEmbeddedMetadata,
  normalizeGraphParentPointers,
  normalizeNodeAttachDataUrl,
  normalizeNodeSettings,
  parseSizeSetting,
  preferredChildPosition,
  promptFromEmbeddedMetadata,
  readFileAsDataUrl,
  wouldCreateCycle,
  type GenerateNodeOptions,
  type GraphEdge,
  type GraphNode,
  type ImageNodeData,
  type ImageNodeStatus,
} from "./nodeGraphHelpers";
import {
  HISTORY_LIMIT,
  currentHistoryIndex,
  currentImageFromHistory,
  isNodeOwnedImport,
  narrowGenerateKind,
  normalizeGenerateItem,
  selectHistoryItem,
  sameGenerateItem,
  upsertHistoryItems,
} from "./historyHelpers";
import {
  GRAPH_HISTORY_LIMIT,
  clearGraphHistoryPatch,
  commitUserGraphChange,
  graphHistoryPatch,
  hasPendingGraphNodes,
  restoreGraphSnapshot,
  takeGraphSnapshot,
  type GraphSnapshot,
} from "./graphHistoryHelpers";
import { createPromptLibrarySlice } from "./promptLibrarySlice";
import {
  INFLIGHT_TTL_MS,
  loadInFlight,
  loadRightPanelOpen,
  loadSelectedFilename,
  loadUIMode,
  saveInFlight as saveInFlightToStorage,
  saveRightPanelOpen,
  saveSelectedFilename,
  saveUIMode,
  type PersistedInFlight,
} from "./storage";
import {
  DEFAULT_IMAGE_MODEL,
  cloneNodeSettings,
  nextImageTransferMode,
  normalizeEdgeTransferData,
  syncEffectiveNodeSettings,
  type EdgeTransferData,
  type ImageTransferMode,
  type NodeGenerateDelivery,
  type NodeSettings,
} from "../lib/nodeDelivery";
import { t, loadLocale, saveLocale, type Locale } from "../i18n";

export {
  ANCESTOR_IMAGE_COUNT_OPTIONS,
  getEdgeVisualState,
  normalizeEdgeTransferData,
} from "../lib/nodeDelivery";
export type {
  AncestorImageCount,
  EdgeTransferData,
  EdgeVisualState,
  ImageTransferMode,
  NodeGenerateDelivery,
  NodeGenerateDeliveryIssue,
  NodeSettings,
} from "../lib/nodeDelivery";
export {
  IMAGE_MODEL_VALUES,
  canAttachImageToNodeData,
  canRemoveNodeImageReference,
  canUseNodeAsBranchParent,
} from "./nodeGraphHelpers";
export type {
  GraphEdge,
  GraphNode,
  ImageNodeData,
  ImageNodeStatus,
} from "./nodeGraphHelpers";

function saveInFlight(list: PersistedInFlight[]): void {
  saveInFlightToStorage(list, (err) => {
    // Quota exceeded or storage disabled. Notify the user once per tab.
    const w = window as unknown as { __ima2QuotaWarned?: boolean };
    if (!w.__ima2QuotaWarned) {
      w.__ima2QuotaWarned = true;
      console.warn("[ima2] localStorage write failed:", err);
      try {
        useAppStore.getState().showToast(t("toast.localStorageFull"), true);
      } catch {}
    }
  });
}

type ToastState = { message: string; error: boolean; id: number } | null;

export type AppState = {
  provider: Provider;
  model: ImageModel;
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
  historyTombstones: string[];
  toggleGalleryFavorite: (filename: string) => Promise<void>;
  promptLibraryOpen: boolean;
  promptLibraryItems: PromptItem[];
  promptLibraryLoading: boolean;
  promptLibrarySaving: boolean;
  promptLibraryError: string | null;
  promptLibraryLastSavedId: string | null;
  openPromptLibrary: () => Promise<void>;
  closePromptLibrary: () => void;
  refreshPromptLibrary: () => Promise<void>;
  createPromptLibraryItem: (payload: PromptCreatePayload) => Promise<void>;
  updatePromptLibraryItem: (id: string, payload: PromptUpdatePayload) => Promise<void>;
  deletePromptLibraryItem: (id: string) => Promise<void>;
  togglePromptLibraryFavorite: (id: string) => Promise<void>;
  importPromptLibraryItems: (payload: PromptLibraryImportPayload) => Promise<void>;
  usePromptLibraryItem: (item: PromptItem) => void;
  insertPromptLibraryItem: (item: PromptItem) => void;
  toast: ToastState;
  rightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  classicComposerExpanded: boolean;
  setClassicComposerExpanded: (open: boolean) => void;
  classicRailDrawer: "library" | "activity" | null;
  setClassicRailDrawer: (drawer: "library" | "activity" | null) => void;
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
  canceledRequestIds: string[];
  branchGenerationRootId: ClientNodeId | null;
  branchGenerationRequestIds: string[];
  attachingNodeIds: ClientNodeId[];
  selectedNodeId: ClientNodeId | null;
  selectedEdgeId: string | null;
  edgePopoverId: string | null;
  selectNode: (clientId: ClientNodeId | null) => void;
  selectEdge: (edgeId: string | null) => void;
  openEdgePopover: (edgeId: string) => void;
  closeEdgePopover: () => void;
  undoGraph: () => void;
  redoGraph: () => void;
  resetGraphHistory: () => void;
  buildNodeGeneratePreview: (clientId: ClientNodeId) => NodeGenerateDelivery<GraphNode> | null;
  setGraphNodes: (n: GraphNode[]) => void;
  setGraphEdges: (e: GraphEdge[]) => void;
  addRootNode: () => ClientNodeId;
  addChildNode: (parentClientId: ClientNodeId) => ClientNodeId;
  addSiblingNode: (sourceClientId: ClientNodeId) => ClientNodeId;
  duplicateBranchRoot: (sourceClientId: ClientNodeId) => ClientNodeId;
  addChildNodeAt: (parentClientId: ClientNodeId, position: { x: number; y: number }) => ClientNodeId;
  connectNodes: (sourceClientId: ClientNodeId, targetClientId: ClientNodeId) => void;
  updateEdgeTransfer: (edgeId: string, patch: Partial<EdgeTransferData>) => void;
  updateEdgeTransferQuiet: (edgeId: string, patch: Partial<EdgeTransferData>) => void;
  setEdgeImageTransfer: (edgeId: string, mode: ImageTransferMode) => void;
  setEdgeImageTransferQuiet: (edgeId: string, mode: ImageTransferMode) => void;
  cycleEdgeImageTransferQuiet: (edgeId: string) => void;
  toggleEdgeTransfer: (edgeId: string, key: "transferContext" | "transferSettings") => void;
  toggleEdgeTransferQuiet: (edgeId: string, key: "transferContext" | "transferSettings") => void;
  updateNodeName: (clientId: ClientNodeId, name: string) => void;
  updateNodePrompt: (clientId: ClientNodeId, prompt: string) => void;
  updateNodeSettings: (clientId: ClientNodeId, patch: Partial<NodeSettings>) => void;
  copyParentPromptToNode: (clientId: ClientNodeId) => void;
  copyParentSettingsToNode: (clientId: ClientNodeId) => void;
  detachNodeFromParent: (clientId: ClientNodeId) => void;
  detachEdge: (edgeId: string) => void;
  detachSelectedEdge: () => void;
  addChildFromSelectedEdge: () => ClientNodeId | null;
  generateNode: (clientId: ClientNodeId, options?: GenerateNodeOptions) => Promise<boolean>;
  regenerateBranch: (clientId: ClientNodeId) => Promise<void>;
  cancelNodeGeneration: (clientId: ClientNodeId) => Promise<void>;
  cancelBranchGeneration: (rootId: ClientNodeId) => Promise<void>;
  deleteNode: (clientId: ClientNodeId) => void;
  deleteNodes: (clientIds: ClientNodeId[]) => void;
  removeNodeImageReference: (clientId: ClientNodeId) => void;
  attachImageToNode: (clientId: ClientNodeId, file: File) => Promise<void>;
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
  setModel: (m: ImageModel) => void;
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

function isNodeGeneratingStatus(status: ImageNodeStatus): boolean {
  return status === "pending" || status === "reconciling";
}

function addUniqueRequestIds(existing: string[], ids: string[]): string[] {
  const merged = [...existing];
  for (const id of ids) {
    if (id && !merged.includes(id)) merged.push(id);
  }
  return merged.slice(-100);
}

function canceledNodeData(data: ImageNodeData): ImageNodeData {
  const hasImage = !!data.serverNodeId || !!data.imageUrl;
  return {
    ...data,
    status: hasImage ? "canceled" : "empty",
    pendingRequestId: null,
    pendingPhase: null,
    pendingStartedAt: null,
    error: hasImage ? t("node.canceledMessage") : undefined,
  };
}

function removeImageReferenceFromNodeData(data: ImageNodeData): ImageNodeData {
  return {
    ...data,
    serverNodeId: null,
    imageUrl: null,
    status: "empty",
    pendingRequestId: null,
    pendingPhase: null,
    pendingStartedAt: null,
    error: undefined,
    elapsed: undefined,
    webSearchCalls: undefined,
    filename: undefined,
    provider: undefined,
    quality: undefined,
    size: undefined,
    format: undefined,
    moderation: undefined,
    model: undefined,
    assetSource: undefined,
    usage: undefined,
    createdAt: undefined,
    imageReferenceDetached: true,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  provider: "oauth",
  model: DEFAULT_IMAGE_MODEL,
  quality: "low",
  sizePreset: "auto",
  customW: 1920,
  customH: 1088,
  format: "png",
  moderation: "low",
  count: 1,
  prompt: "",
  referenceImages: [],
  addReferences: async (files) => {
    const allowed = 5 - get().referenceImages.length;
    const toAdd = files
      .filter((file) => {
        if (!isHeic(file)) return true;
        get().showToast(t("toast.refUnsupported"), true);
        return false;
      })
      .slice(0, Math.max(0, allowed));
    const dataUrls = await Promise.all(
      toAdd.map(async (file) => {
        try {
          return await compressToBase64(file, {
            preserveTransparency: hasAlphaChannel(file),
          });
        } catch (err) {
          console.warn("[refs] compression failed", err);
          return await readFileAsDataUrl(file).catch(() => null);
        }
      }),
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
        const canceled = new Set(get().canceledRequestIds);
        const arr: GenerateItem[] = items
          .filter((it) => !canceled.has(it.requestId ?? ""))
          .map((it) => ({
            image: it.url,
            url: it.url,
            filename: it.filename,
            thumb: it.url,
            prompt: it.prompt ?? undefined,
            size: it.size ?? undefined,
            quality: it.quality ?? undefined,
            format: it.format as Format | undefined,
            model: it.model ?? undefined,
            createdAt: it.createdAt,
            sessionId: it.sessionId ?? null,
            nodeId: it.nodeId ?? null,
            clientNodeId: it.clientNodeId ?? null,
            kind: narrowGenerateKind(it.kind),
            isFavorite: it.isFavorite ?? false,
          }));
        if (arr.length > 0) {
          set((s) => {
            const history = upsertHistoryItems(s.history, arr, s.historyTombstones);
            const currentImage = currentImageFromHistory(history, s.currentImage);
            if (!s.currentImage && currentImage?.filename) {
              saveSelectedFilename(currentImage.filename);
            }
            return { history, currentImage };
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
  historyTombstones: [],
  ...createPromptLibrarySlice(set, get),
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
  classicComposerExpanded: false,
  setClassicComposerExpanded: (classicComposerExpanded) => set({ classicComposerExpanded }),
  classicRailDrawer: null,
  setClassicRailDrawer: (classicRailDrawer) => set({ classicRailDrawer }),
  galleryOpen: false,
  openGallery: () => set({ galleryOpen: true }),
  closeGallery: () => set({ galleryOpen: false }),

  uiMode: loadUIMode(),
  setUIMode: (m) => {
    saveUIMode(m);
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
  canceledRequestIds: [],
  branchGenerationRootId: null,
  branchGenerationRequestIds: [],
  attachingNodeIds: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  edgePopoverId: null,
  selectNode: (selectedNodeId) => set({ selectedNodeId, selectedEdgeId: null, edgePopoverId: null }),
  selectEdge: (selectedEdgeId) =>
    set((s) => ({
      selectedEdgeId,
      selectedNodeId: null,
      edgePopoverId: null,
      rightPanelOpen: selectedEdgeId ? true : s.rightPanelOpen,
    })),
  openEdgePopover: (edgePopoverId) =>
    set({ edgePopoverId, selectedEdgeId: null }),
  closeEdgePopover: () => set({ edgePopoverId: null }),
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
        canceledRequestIds: [],
        branchGenerationRootId: null,
        branchGenerationRequestIds: [],
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
        const recovered = findNodeHistoryResult(historyItems, sid, n, get().canceledRequestIds);
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
        canceledRequestIds: [],
        branchGenerationRootId: null,
        branchGenerationRequestIds: [],
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
          canceledRequestIds: [],
          branchGenerationRootId: null,
          branchGenerationRequestIds: [],
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
    const nextEdges = [...get().graphEdges, edge];
    const nextNodes = [...get().graphNodes, node];
    commitUserGraphChange(get, set, {
      graphNodes: normalizeGraphParentPointers(nextNodes, nextEdges),
      graphEdges: nextEdges,
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
    const nextEdges = [...get().graphEdges, edge];
    const nextNodes = [...get().graphNodes, node];
    commitUserGraphChange(get, set, {
      graphNodes: normalizeGraphParentPointers(nextNodes, nextEdges),
      graphEdges: nextEdges,
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
      edgePopoverId: null,
    });
  },

  updateEdgeTransferQuiet: (edgeId, patch) => {
    const next = applyEdgeTransferPatch(get().graphNodes, get().graphEdges, edgeId, patch);
    if (!next) return;
    commitUserGraphChange(get, set, {
      graphNodes: next.graphNodes,
      graphEdges: next.graphEdges,
      selectedEdgeId: null,
      edgePopoverId: get().edgePopoverId === edgeId ? edgeId : get().edgePopoverId,
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
      edgePopoverId: null,
    });
  },

  setEdgeImageTransferQuiet: (edgeId, mode) => {
    const next = applyEdgeTransferPatch(get().graphNodes, get().graphEdges, edgeId, {
      imageTransfer: mode,
    });
    if (!next) return;
    commitUserGraphChange(get, set, {
      graphNodes: next.graphNodes,
      graphEdges: next.graphEdges,
      selectedEdgeId: null,
      edgePopoverId: get().edgePopoverId === edgeId ? edgeId : get().edgePopoverId,
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
      edgePopoverId: null,
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
      edgePopoverId: null,
    });
  },

  updateNodeSettings: (clientId, patch) => {
    const nodes = get().graphNodes;
    const edges = get().graphEdges;
    const node = nodes.find((n) => n.id === clientId);
    if (!node) return;
    const incomingEdge = edges.find((e) => e.target === clientId);
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
    const branchRootId = options?.branchRootId ?? null;
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
      ...(branchRootId
        ? {
            branchGenerationRequestIds: addUniqueRequestIds(
              get().branchGenerationRequestIds,
              [flightId],
            ),
          }
        : {}),
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
      if (get().canceledRequestIds.includes(flightId)) {
        succeeded = false;
      } else if (get().activeSessionId === requestSessionId) {
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
                  model: res.model ?? nodeSettings.model,
                  assetSource: undefined,
                  usage: res.usage,
                  createdAt: Date.now(),
                  imageReferenceDetached: undefined,
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
          model: res.model ?? nodeSettings.model,
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
      const isCanceled =
        (err as Error & { code?: string })?.code === "NODE_GEN_CANCELED" ||
        get().canceledRequestIds.includes(flightId);
      const msg = err instanceof Error ? err.message : t("toast.nodeCreateFailed");
      if (get().activeSessionId === requestSessionId) {
        set({
          graphNodes: get().graphNodes.map((n) =>
            n.id === targetClientId
              ? {
                  ...n,
                  data: isCanceled
                    ? canceledNodeData(n.data)
                    : {
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
        if (!isCanceled) get().showToast(msg, true);
      }
      // cross-session: silent — user is on a different graph
    } finally {
      // Global state cleanup must always run regardless of active session,
      // otherwise the spinner/counter leaks.
      const remaining = get().inFlight.filter((f) => f.id !== flightId);
      saveInFlight(remaining);
      set({
        activeGenerations: remaining.length,
        inFlight: remaining,
        branchGenerationRequestIds: get().branchGenerationRequestIds.filter((id) => id !== flightId),
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

    set({ branchGenerationRootId: clientId, branchGenerationRequestIds: [] });
    for (const level of branchLevels) {
      if (get().branchGenerationRootId !== clientId) {
        set({ selectedNodeId: clientId, selectedEdgeId: null });
        return;
      }
      const results = await Promise.all(
        level.map((id) => get().generateNode(id, { selectOnComplete: false, branchRootId: clientId })),
      );
      if (get().branchGenerationRootId !== clientId) {
        set({ selectedNodeId: clientId, selectedEdgeId: null });
        return;
      }
      if (results.some((ok) => !ok)) {
        get().showToast(t("toast.nodeBranchStopped"), true);
        set({
          selectedNodeId: clientId,
          selectedEdgeId: null,
          branchGenerationRootId: null,
          branchGenerationRequestIds: [],
        });
        return;
      }
    }
    set({
      selectedNodeId: clientId,
      selectedEdgeId: null,
      branchGenerationRootId: null,
      branchGenerationRequestIds: [],
    });
    get().showToast(t("toast.nodeBranchComplete", { count: branchIds.length }));
  },

  async cancelNodeGeneration(clientId) {
    const node = get().graphNodes.find((n) => n.id === clientId);
    const requestId = node?.data.pendingRequestId;
    if (!node || !requestId || !isNodeGeneratingStatus(node.data.status)) return;
    void cancelInflight(requestId);

    const remaining = get().inFlight.filter((f) => f.id !== requestId);
    saveInFlight(remaining);
    set({
      canceledRequestIds: addUniqueRequestIds(get().canceledRequestIds, [requestId]),
      graphNodes: get().graphNodes.map((n) =>
        n.id === clientId ? { ...n, data: canceledNodeData(n.data) } : n,
      ),
      inFlight: remaining,
      activeGenerations: remaining.length,
      branchGenerationRequestIds: get().branchGenerationRequestIds.filter((id) => id !== requestId),
    });
    get().scheduleGraphSave();
    get().showToast(t("toast.nodeGenerationCanceled"));
  },

  async cancelBranchGeneration(rootId) {
    const branchIds = collectBranchNodeLevels(get().graphEdges, rootId).flat();
    const branchIdSet = new Set(branchIds);
    const requestIds = [
      ...get().branchGenerationRequestIds,
      ...get().graphNodes
        .filter((node) => branchIdSet.has(node.id as ClientNodeId))
        .map((node) => node.data.pendingRequestId)
        .filter((id): id is string => Boolean(id)),
    ];
    const uniqueRequestIds = [...new Set(requestIds)];
    if (uniqueRequestIds.length === 0) {
      set({
        branchGenerationRootId: null,
        branchGenerationRequestIds: [],
        selectedNodeId: rootId,
        selectedEdgeId: null,
      });
      return;
    }
    for (const requestId of uniqueRequestIds) {
      void cancelInflight(requestId);
    }
    const requestIdSet = new Set(uniqueRequestIds);
    const remaining = get().inFlight.filter((f) => !requestIdSet.has(f.id));
    saveInFlight(remaining);
    set({
      canceledRequestIds: addUniqueRequestIds(get().canceledRequestIds, uniqueRequestIds),
      graphNodes: get().graphNodes.map((node) =>
        branchIdSet.has(node.id as ClientNodeId) &&
        node.data.pendingRequestId &&
        requestIdSet.has(node.data.pendingRequestId)
          ? { ...node, data: canceledNodeData(node.data) }
          : node,
      ),
      inFlight: remaining,
      activeGenerations: remaining.length,
      branchGenerationRootId: null,
      branchGenerationRequestIds: [],
      selectedNodeId: rootId,
      selectedEdgeId: null,
    });
    get().scheduleGraphSave();
    get().showToast(t("toast.nodeBranchCanceled"));
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

  removeNodeImageReference: (clientId) => {
    const node = get().graphNodes.find((n) => n.id === clientId);
    if (!node || !canRemoveNodeImageReference(node.data)) return;

    const nextEdges = get().graphEdges.map((edge) => {
      const edgeData = normalizeEdgeTransferData(edge.data);
      if (edge.source !== clientId || edgeData.imageTransfer === "off") return edge;
      return {
        ...edge,
        data: {
          ...edgeData,
          imageTransfer: "off" as const,
        },
      };
    });
    const nextNodes = get().graphNodes.map((n) =>
      n.id === clientId
        ? {
            ...n,
            data: removeImageReferenceFromNodeData(n.data),
          }
        : n,
    );

    commitUserGraphChange(get, set, {
      graphNodes: normalizeGraphParentPointers(nextNodes, nextEdges),
      graphEdges: nextEdges,
      selectedNodeId: clientId,
      selectedEdgeId: null,
    });
    get().showToast(t("toast.nodeImageReferenceRemoved"));
  },

  async attachImageToNode(clientId, file) {
    const node = get().graphNodes.find((n) => n.id === clientId);
    if (!node || !canAttachImageToNodeData(node.data)) {
      get().showToast(t("toast.nodeAttachUnavailable"), true);
      return;
    }
    if (!isSupportedNodeAttachFile(file)) {
      get().showToast(t("toast.nodeAttachUnsupported"), true);
      return;
    }

    let sessionId = get().activeSessionId;
    if (!sessionId) {
      await get().createAndSwitchSession(t("session.firstGraph"));
      sessionId = get().activeSessionId;
    }
    if (!sessionId) {
      get().showToast(t("toast.nodeAttachFailed"), true);
      return;
    }

    set((s) => ({
      attachingNodeIds: addUniqueRequestIds(s.attachingNodeIds, [clientId]),
    }));
    try {
      const image = normalizeNodeAttachDataUrl(file, await readFileAsDataUrl(file));
      let restoredPrompt: string | null = null;
      let restoredSettings: NodeSettings | null = null;
      try {
        const metadataResult = await readImageMetadata(image);
        if (metadataResult.metadata) {
          restoredPrompt = promptFromEmbeddedMetadata(metadataResult.metadata);
          restoredSettings = nodeSettingsFromEmbeddedMetadata(metadataResult.metadata, node.data.settings);
          const shouldRestore =
            (restoredPrompt || restoredSettings) &&
            (typeof window === "undefined" || window.confirm(t("metadata.restoreConfirm")));
          if (!shouldRestore) {
            restoredPrompt = null;
            restoredSettings = null;
          }
        }
      } catch {
        // Metadata restore is best-effort. Attach should still work.
      }
      const promptForAttach = restoredPrompt ?? node.data.prompt;
      const res = await postNodeAttach({
        image,
        prompt: promptForAttach,
        sessionId,
        clientNodeId: clientId,
      });
      if (get().activeSessionId !== sessionId) return;

      const currentNode = get().graphNodes.find((n) => n.id === clientId);
      if (!currentNode || !canAttachImageToNodeData(currentNode.data)) {
        get().showToast(t("toast.nodeAttachUnavailable"), true);
        return;
      }

      const importedSize = parseSizeSetting(res.size);
      const nextNodes = get().graphNodes.map((n) =>
        n.id === clientId
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
                error: undefined,
                elapsed: undefined,
                webSearchCalls: res.webSearchCalls ?? 0,
                filename: res.filename,
                provider: res.provider,
                quality: res.quality ?? undefined,
                size: res.size ?? undefined,
                format: res.format ?? n.data.settings.format,
                moderation: res.moderation ?? undefined,
                model: res.model ?? undefined,
                assetSource: "upload" as const,
                imageReferenceDetached: undefined,
                prompt: promptForAttach,
                settings: restoredSettings ?? normalizeNodeSettings(
                    {
                      quality: res.quality,
                      sizePreset: importedSize?.sizePreset,
                      customW: importedSize?.customW,
                      customH: importedSize?.customH,
                      format: res.format,
                      moderation: res.moderation,
                      model: res.model,
                    },
                    n.data.settings,
                  ),
                usage: undefined,
                createdAt: res.createdAt,
              },
            }
          : n,
      );
      commitUserGraphChange(get, set, {
        graphNodes: normalizeGraphParentPointers(nextNodes, get().graphEdges),
        selectedNodeId: clientId,
        selectedEdgeId: null,
      });
      get().showToast(t("toast.nodeImageAttached"));
    } catch (err) {
      console.warn("[node] attach failed:", err);
      get().showToast(t("toast.nodeAttachFailed"), true);
    } finally {
      set((s) => ({
        attachingNodeIds: s.attachingNodeIds.filter((id) => id !== clientId),
      }));
    }
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
    const nextEdges = [...get().graphEdges, edge];
    const nextNodes = [...get().graphNodes, node];
    commitUserGraphChange(get, set, {
      graphNodes: normalizeGraphParentPointers(nextNodes, nextEdges),
      graphEdges: nextEdges,
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
    const syncedNodes = syncEffectiveNodeSettings(nextNodes, nextEdges);
    commitUserGraphChange(get, set, {
      graphNodes: normalizeGraphParentPointers(syncedNodes, nextEdges),
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
      edgePopoverId: null,
    });
  },

  detachEdge: (edgeId) => {
    const edge = get().graphEdges.find((e) => e.id === edgeId);
    if (!edge) return;
    get().detachNodeFromParent(edge.target as ClientNodeId);
  },

  detachSelectedEdge: () => {
    const edgeId = get().selectedEdgeId ?? get().edgePopoverId;
    if (!edgeId) return;
    get().detachEdge(edgeId);
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
          model: res.model ?? item.model,
          settings: normalizeNodeSettings(
            {
              quality: res.quality ?? item.quality,
              sizePreset: importedSize?.sizePreset,
              customW: importedSize?.customW,
              customH: importedSize?.customH,
              format: res.format ?? item.format,
              moderation: res.moderation ?? item.moderation,
              model: res.model ?? item.model,
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
      saveRightPanelOpen(true);
      saveUIMode("node");
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
  setModel: (model) => set({ model }),
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
    set((s) => {
      const historyTombstones = s.historyTombstones.includes(filename)
        ? s.historyTombstones
        : [...s.historyTombstones, filename].slice(-100);
      const history = s.history.filter((h) => h.filename !== filename);
      const currentImage =
        s.currentImage?.filename === filename ? history[0] ?? null : s.currentImage;
      saveSelectedFilename(currentImage?.filename ?? null);
      return { history, historyTombstones, currentImage };
    });
  },

  addHistoryItem: (item) => {
    const normalized = normalizeGenerateItem(item);
    if (isNodeOwnedImport(normalized)) return;
    set((s) => {
      const historyTombstones = normalized.filename
        ? s.historyTombstones.filter((filename) => filename !== normalized.filename)
        : s.historyTombstones;
      const history = upsertHistoryItems(s.history, [normalized], historyTombstones, {
        ignoreTombstones: true,
      });
      return {
        history,
        historyTombstones,
        currentImage: currentImageFromHistory(history, s.currentImage),
      };
    });
  },

  toggleGalleryFavorite: async (filename) => {
    if (get().historyTombstones.includes(filename)) return;
    const current = get().history.find((item) => item.filename === filename);
    if (!current) return;
    const nextFavorite = !(current?.isFavorite ?? false);
    const applyFavorite = (favorite: boolean) =>
      set((s) => ({
        history: s.history.map((item) =>
          item.filename === filename ? { ...item, isFavorite: favorite } : item,
        ),
        currentImage:
          s.currentImage?.filename === filename
            ? { ...s.currentImage, isFavorite: favorite }
            : s.currentImage,
      }));

    applyFavorite(nextFavorite);
    try {
      const result = await toggleHistoryFavorite(filename, nextFavorite);
      applyFavorite(result.isFavorite);
    } catch (err) {
      applyFavorite(!nextFavorite);
      get().showToast(err instanceof Error ? err.message : t("toast.generateFailed"), true);
    }
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
        model: s.model,
        provider: s.provider,
        n: s.count,
        requestId: flightId,
        ...(s.referenceImages.length
          ? { references: s.referenceImages }
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
            model: res.model ?? s.model,
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
            model: res.model ?? s.model,
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
            model: res.model ?? s.model,
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
        const historyItems: GenerateItem[] = res.items.map((it) => ({
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
          isFavorite: it.isFavorite ?? false,
        }));
        const history = upsertHistoryItems([], historyItems, get().historyTombstones);
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
  delete persisted.imageReferenceDetached;
  return persisted;
}

// Recover nodes whose asset lives on disk (via /api/history) but whose
// client-side asset pointer was lost (older save, reload, HMR, conflict reload).
// Candidate = non-empty node with neither imageUrl nor serverNodeId. Empty
// nodes may be intentionally detached from their history asset. The matching
// key is (sessionId, clientNodeId); when pendingStartedAt is known we require
// createdAt >= pendingStartedAt to avoid picking an older retry's asset.
async function recoverGraphNodesFromHistory(
  get: () => AppState,
  set: (patch: Partial<AppState>) => void,
): Promise<void> {
  const sid = get().activeSessionId;
  if (!sid) return;
  const candidates = get().graphNodes.filter(
    (n) =>
      n.data.status !== "empty" &&
      !n.data.imageReferenceDetached &&
      !n.data.imageUrl &&
      !n.data.serverNodeId,
  );
  if (candidates.length === 0) return;

  let items: Array<{
    url: string;
    createdAt: number;
    sessionId?: string | null;
    nodeId?: string | null;
    clientNodeId?: string | null;
    requestId?: string | null;
  }> = [];
  try {
    const res = await getHistory({ sessionId: sid, limit: HISTORY_LIMIT });
    items = res.items;
  } catch {
    // History fetch failure is non-fatal — leave nodes as they are.
    return;
  }

  const canceled = new Set(get().canceledRequestIds);
  let changed = false;
  const next = get().graphNodes.map((n) => {
    if (n.data.imageUrl || n.data.serverNodeId) return n;
    if (n.data.status === "empty" || n.data.imageReferenceDetached) return n;
    const startedAt = n.data.pendingStartedAt ?? 0;
    const recovered = items.find(
      (h) =>
        (h.sessionId ?? null) === sid &&
        (h.clientNodeId ?? null) === n.id &&
        !canceled.has(h.requestId ?? "") &&
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
  const s = get();
  const historyTombstones = withThumb.filename
    ? s.historyTombstones.filter((filename) => filename !== withThumb.filename)
    : s.historyTombstones;
  const history = upsertHistoryItems(s.history, [withThumb], historyTombstones, {
    ignoreTombstones: true,
  });
  const currentImage = history.find((candidate) => sameGenerateItem(candidate, withThumb)) ?? withThumb;
  saveSelectedFilename(currentImage.filename ?? null);
  set({ history, historyTombstones, currentImage });
}
