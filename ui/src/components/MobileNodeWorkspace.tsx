import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import {
  ANCESTOR_IMAGE_COUNT_OPTIONS,
  canAttachImageToNodeData,
  canRemoveNodeImageReference,
  canUseNodeAsBranchParent,
  getEdgeVisualState,
  normalizeEdgeTransferData,
  useAppStore,
  type AncestorImageCount,
  type GraphEdge,
  type GraphNode,
  type ImageNodeData,
  type ImageNodeStatus,
  type ImageTransferMode,
} from "../store/useAppStore";
import { useI18n } from "../i18n";
import { OptionGroup, type OptionItem } from "./OptionGroup";
import { ImageLightbox } from "./ImageLightbox";
import { LanguageToggle } from "./LanguageToggle";
import { copyImageToClipboard, copyTextToClipboard } from "../lib/clipboard";
import { deriveGraphMeta, type GraphNodeMeta } from "../lib/graphMeta";
import {
  SIZE_PRESETS_ROW1,
  SIZE_PRESETS_ROW2,
  SIZE_PRESETS_ROW3,
  SIZE_PRESETS_ROW4,
  getSizePresetsRow5,
  snap16,
} from "../lib/size";
import type { Format, ImageModel, Moderation, Quality, SizePreset } from "../types";

type MobileNodeView = "all" | "node" | "branches" | "map" | "connection";
type MobileNodeTab = "all" | "node" | "branches";
type ConnectionReturnView = "node" | "branches";
type NodeListSort = "graphAsc" | "graphDesc";
type NodeStatusFilter = "all" | ReturnType<typeof statusTone>;
type LaneStatusCounts = Record<ReturnType<typeof statusTone>, number>;
type BranchTreeItem = {
  node: GraphNode;
  meta: GraphNodeMeta;
  parent: GraphNode | null;
  childNodes: GraphNode[];
  children: BranchTreeItem[];
};
type VisibleBranchTreeItem = Omit<BranchTreeItem, "children"> & {
  children: VisibleBranchTreeItem[];
  filterMatched?: boolean;
  filterContext?: boolean;
};
type BranchLane = {
  rootId: string;
  root: GraphNode;
  treeColor: string;
  treeIndex: number;
  tree: BranchTreeItem | null;
  itemCount: number;
  leafCount: number;
  statusCounts: LaneStatusCounts;
};
type VisibleBranchLane = Omit<BranchLane, "tree"> & {
  tree: VisibleBranchTreeItem | null;
  matchCount: number;
};

const IMAGE_TRANSFER_OPTIONS: ImageTransferMode[] = ["off", "parent", "ancestor"];
const NODE_STATUS_FILTERS: NodeStatusFilter[] = ["all", "ready", "empty", "busy", "stale", "error"];

const FORMAT_ITEMS = [
  { value: "png" as const, label: "PNG" },
  { value: "jpeg" as const, label: "JPEG" },
  { value: "webp" as const, label: "WebP" },
];

function isBusy(data: ImageNodeData): boolean {
  return data.status === "pending" || data.status === "reconciling";
}

function shortNodeId(value: string | null | undefined): string {
  return value ? value.replace(/^n_/, "").slice(0, 8) : "-";
}

function nodeLabel(node: GraphNode): string {
  return (
    node.data.name?.trim() ||
    (node.data.serverNodeId ? shortNodeId(node.data.serverNodeId) : shortNodeId(node.id))
  );
}

function sizeItems(row: ReadonlyArray<{ value: string; label: string; sub: string }>) {
  return row.map((it) => ({
    value: it.value as SizePreset,
    label: it.label,
    sub: it.sub,
  })) as ReadonlyArray<OptionItem<SizePreset>>;
}

function statusTone(status: ImageNodeStatus) {
  if (status === "ready") return "ready";
  if (status === "pending" || status === "reconciling") return "busy";
  if (status === "error" || status === "asset-missing") return "error";
  if (status === "stale" || status === "canceled") return "stale";
  return "empty";
}

function imageTransferLabelKey(mode: ImageTransferMode) {
  if (mode === "ancestor") return "edgeBadge.imageAncestor";
  if (mode === "off") return "edgeBadge.imageOff";
  return "edgeBadge.imageParent";
}

function nextImageTransferMode(mode: ImageTransferMode): ImageTransferMode {
  if (mode === "off") return "parent";
  if (mode === "parent") return "ancestor";
  return "off";
}

function getStatusLabel(t: (key: string) => string, status: ImageNodeStatus): string {
  if (status === "ready") return t("nodeInspector.statusReady");
  if (status === "pending") return t("nodeInspector.statusGenerating");
  if (status === "reconciling") return t("nodeInspector.statusSyncing");
  if (status === "stale") return t("nodeInspector.statusStale");
  if (status === "canceled") return t("nodeInspector.statusCanceled");
  if (status === "asset-missing") return t("nodeInspector.statusMissing");
  if (status === "error") return t("nodeInspector.statusError");
  return t("nodeInspector.statusEmpty");
}

function getStatusFilterLabel(t: (key: string) => string, filter: NodeStatusFilter): string {
  if (filter === "all") return t("mobileNode.filterAll");
  if (filter === "ready") return t("mobileNode.filterReady");
  if (filter === "empty") return t("mobileNode.filterEmpty");
  if (filter === "busy") return t("mobileNode.filterBusy");
  if (filter === "stale") return t("mobileNode.filterStale");
  return t("mobileNode.filterError");
}

function compareGraphNodes(
  a: GraphNode,
  b: GraphNode,
  graphMeta: ReturnType<typeof deriveGraphMeta>,
): number {
  const ma = graphMeta.get(a.id);
  const mb = graphMeta.get(b.id);
  if ((ma?.level ?? 0) !== (mb?.level ?? 0)) return (ma?.level ?? 0) - (mb?.level ?? 0);
  if ((ma?.treeIndex ?? 0) !== (mb?.treeIndex ?? 0)) {
    return (ma?.treeIndex ?? 0) - (mb?.treeIndex ?? 0);
  }
  const ax = a.position?.x ?? 0;
  const bx = b.position?.x ?? 0;
  if (ax !== bx) return ax - bx;
  const ay = a.position?.y ?? 0;
  const by = b.position?.y ?? 0;
  if (ay !== by) return ay - by;
  return a.id.localeCompare(b.id);
}

function laneStatusSummary(t: (key: string, vars?: Record<string, string | number>) => string, counts: LaneStatusCounts): string {
  return [
    counts.ready ? t("mobileNode.laneStatusReady", { count: counts.ready }) : "",
    counts.busy ? t("mobileNode.laneStatusBusy", { count: counts.busy }) : "",
    counts.stale ? t("mobileNode.laneStatusStale", { count: counts.stale }) : "",
    counts.error ? t("mobileNode.laneStatusError", { count: counts.error }) : "",
    counts.empty ? t("mobileNode.laneStatusEmpty", { count: counts.empty }) : "",
  ]
    .filter(Boolean)
    .slice(0, 3)
    .join(" · ");
}

function EdgeChips({
  edge,
  onCycleImage,
  onToggleContext,
  onToggleSettings,
}: {
  edge: GraphEdge;
  onCycleImage?: (edge: GraphEdge) => void;
  onToggleContext?: (edge: GraphEdge) => void;
  onToggleSettings?: (edge: GraphEdge) => void;
}) {
  const { t } = useI18n();
  const edgeData = normalizeEdgeTransferData(edge.data);
  const edgeState = getEdgeVisualState(edge.data);
  const handleChip = (event: MouseEvent<HTMLButtonElement>, action?: (edge: GraphEdge) => void) => {
    event.stopPropagation();
    action?.(edge);
  };
  return (
    <div className="mobile-node-edge-chips" data-state={edgeState}>
      <button
        type="button"
        className={`mobile-node-edge-chip mobile-node-edge-chip--image${edgeData.imageTransfer !== "off" ? " is-on" : ""}`}
        data-image-transfer={edgeData.imageTransfer}
        onClick={(event) => handleChip(event, onCycleImage)}
        disabled={!onCycleImage}
      >
        {t(imageTransferLabelKey(edgeData.imageTransfer))}
      </button>
      <button
        type="button"
        className={`mobile-node-edge-chip mobile-node-edge-chip--context${edgeData.transferContext ? " is-on" : ""}`}
        onClick={(event) => handleChip(event, onToggleContext)}
        disabled={!onToggleContext}
      >
        {t("edgeBadge.context")}
      </button>
      <button
        type="button"
        className={`mobile-node-edge-chip mobile-node-edge-chip--settings${edgeData.transferSettings ? " is-on" : ""}`}
        onClick={(event) => handleChip(event, onToggleSettings)}
        disabled={!onToggleSettings}
      >
        {t("edgeBadge.settings")}
      </button>
    </div>
  );
}

export function MobileNodeWorkspace() {
  const { t } = useI18n();
  const [activeView, setActiveView] = useState<MobileNodeView>("all");
  const [connectionEdgeId, setConnectionEdgeId] = useState<string | null>(null);
  const [connectionReturnView, setConnectionReturnView] = useState<ConnectionReturnView>("branches");
  const [sessionSheetOpen, setSessionSheetOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [nodeListSort, setNodeListSort] = useState<NodeListSort>("graphAsc");
  const [nodeSearchQuery, setNodeSearchQuery] = useState("");
  const [nodeStatusFilter, setNodeStatusFilter] = useState<NodeStatusFilter>("all");
  const [lastFocusedNodeId, setLastFocusedNodeId] = useState<string | null>(null);
  const [collapsedLaneIds, setCollapsedLaneIds] = useState<Set<string>>(() => new Set());
  const [collapsedTreeNodeIds, setCollapsedTreeNodeIds] = useState<Set<string>>(() => new Set());
  const laneCollapseSessionRef = useRef<string | null>(null);
  const knownLaneRootIdsRef = useRef<Set<string>>(new Set());
  const settingsRef = useRef<HTMLDetailsElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  const nodes = useAppStore((s) => s.graphNodes);
  const edges = useAppStore((s) => s.graphEdges);
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessionLoading = useAppStore((s) => s.sessionLoading);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const currentImage = useAppStore((s) => s.currentImage);
  const branchGenerationRootId = useAppStore((s) => s.branchGenerationRootId);
  const attachingNodeIds = useAppStore((s) => s.attachingNodeIds);
  const canUndoGraph = useAppStore((s) => s.canUndoGraph);
  const canRedoGraph = useAppStore((s) => s.canRedoGraph);
  const setUIMode = useAppStore((s) => s.setUIMode);
  const switchSession = useAppStore((s) => s.switchSession);
  const createAndSwitchSession = useAppStore((s) => s.createAndSwitchSession);
  const renameCurrentSession = useAppStore((s) => s.renameCurrentSession);
  const deleteSessionById = useAppStore((s) => s.deleteSessionById);
  const undoGraph = useAppStore((s) => s.undoGraph);
  const redoGraph = useAppStore((s) => s.redoGraph);
  const addRootNode = useAppStore((s) => s.addRootNode);
  const addChildNode = useAppStore((s) => s.addChildNode);
  const addSiblingNode = useAppStore((s) => s.addSiblingNode);
  const duplicateBranchRoot = useAppStore((s) => s.duplicateBranchRoot);
  const selectNode = useAppStore((s) => s.selectNode);
  const updateNodeName = useAppStore((s) => s.updateNodeName);
  const updateNodePrompt = useAppStore((s) => s.updateNodePrompt);
  const updateNodeSettings = useAppStore((s) => s.updateNodeSettings);
  const generateNode = useAppStore((s) => s.generateNode);
  const cancelNodeGeneration = useAppStore((s) => s.cancelNodeGeneration);
  const regenerateBranch = useAppStore((s) => s.regenerateBranch);
  const cancelBranchGeneration = useAppStore((s) => s.cancelBranchGeneration);
  const deleteNode = useAppStore((s) => s.deleteNode);
  const detachNodeFromParent = useAppStore((s) => s.detachNodeFromParent);
  const detachEdge = useAppStore((s) => s.detachEdge);
  const removeNodeImageReference = useAppStore((s) => s.removeNodeImageReference);
  const attachImageToNode = useAppStore((s) => s.attachImageToNode);
  const importCurrentImageAsNode = useAppStore((s) => s.importCurrentImageAsNode);
  const openGallery = useAppStore((s) => s.openGallery);
  const openPromptLibrary = useAppStore((s) => s.openPromptLibrary);
  const createPromptLibraryItem = useAppStore((s) => s.createPromptLibraryItem);
  const showToast = useAppStore((s) => s.showToast);
  const buildNodeGeneratePreview = useAppStore((s) => s.buildNodeGeneratePreview);
  const updateEdgeTransferQuiet = useAppStore((s) => s.updateEdgeTransferQuiet);
  const setEdgeImageTransferQuiet = useAppStore((s) => s.setEdgeImageTransferQuiet);

  const selected = selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) ?? null : null;
  const data = selected?.data ?? null;
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const graphMeta = useMemo(() => deriveGraphMeta(nodes, edges), [nodes, edges]);
  const childCountByNodeId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    }
    return counts;
  }, [edges]);
  const incomingEdge = selected ? edges.find((edge) => edge.target === selected.id) ?? null : null;
  const parent = incomingEdge ? nodes.find((node) => node.id === incomingEdge.source) ?? null : null;
  const children = selected
    ? edges
        .filter((edge) => edge.source === selected.id)
        .map((edge) => ({
          edge,
          node: nodes.find((candidate) => candidate.id === edge.target) ?? null,
        }))
        .filter((item): item is { edge: GraphEdge; node: GraphNode } => !!item.node)
    : [];
  const activeConnectionEdge =
    (connectionEdgeId ? edges.find((edge) => edge.id === connectionEdgeId) : null) ??
    incomingEdge;
  const connectionParent = activeConnectionEdge
    ? nodes.find((node) => node.id === activeConnectionEdge.source) ?? null
    : null;
  const connectionChild = activeConnectionEdge
    ? nodes.find((node) => node.id === activeConnectionEdge.target) ?? null
    : null;
  const branchLanes = useMemo<BranchLane[]>(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const childrenBySource = new Map<string, GraphNode[]>();
    for (const edge of edges) {
      const child = nodeById.get(edge.target);
      if (!child || !nodeById.has(edge.source)) continue;
      childrenBySource.set(edge.source, [...(childrenBySource.get(edge.source) ?? []), child]);
    }
    for (const [source, childNodes] of childrenBySource) {
      const sorted = [...childNodes].sort((a, b) => compareGraphNodes(a, b, graphMeta));
      if (nodeListSort === "graphDesc") sorted.reverse();
      childrenBySource.set(source, sorted);
    }
    const lanes = new Map<string, Omit<BranchLane, "tree">>();
    for (const node of nodes) {
      const meta = graphMeta.get(node.id);
      const rootId = meta?.treeRootId ?? node.id;
      const root = nodeById.get(rootId) ?? node;
      const childNodes = childrenBySource.get(node.id) ?? [];
      const lane = lanes.get(rootId) ?? {
        rootId,
        root,
        treeColor: meta?.treeColor ?? "#a78bfa",
        treeIndex: meta?.treeIndex ?? 0,
        itemCount: 0,
        leafCount: 0,
        statusCounts: { ready: 0, busy: 0, error: 0, stale: 0, empty: 0 },
      };
      lane.itemCount += 1;
      if (childNodes.length === 0) lane.leafCount += 1;
      lane.statusCounts[statusTone(node.data.status)] += 1;
      lanes.set(rootId, lane);
    }

    const buildTreeItem = (
      node: GraphNode,
      parent: GraphNode | null,
      lane: Omit<BranchLane, "tree">,
      visited: Set<string>,
    ): BranchTreeItem => {
      const nextVisited = new Set(visited);
      nextVisited.add(node.id);
      const childNodes = (childrenBySource.get(node.id) ?? []).filter((child) => !nextVisited.has(child.id));
      const meta = graphMeta.get(node.id) ?? {
        level: parent ? (graphMeta.get(parent.id)?.level ?? 0) + 1 : 0,
        isolated: !parent && childNodes.length === 0,
        treeRootId: lane.rootId,
        treeIndex: lane.treeIndex,
        treeColor: lane.treeColor,
      };
      return {
        node,
        meta,
        parent,
        childNodes,
        children: childNodes.map((child) => buildTreeItem(child, node, lane, nextVisited)),
      };
    };

    return [...lanes.values()]
      .sort((a, b) => a.treeIndex - b.treeIndex || nodeLabel(a.root).localeCompare(nodeLabel(b.root)))
      .map((lane) => ({
        ...lane,
        tree: nodeById.has(lane.rootId) ? buildTreeItem(lane.root, null, lane, new Set()) : null,
      }));
  }, [edges, graphMeta, nodeListSort, nodes]);

  useEffect(() => {
    const sessionKey = activeSessionId ?? "__no_session__";
    const currentRootIds = branchLanes.map((lane) => lane.rootId);
    const currentRootIdSet = new Set(currentRootIds);

    if (laneCollapseSessionRef.current !== sessionKey) {
      laneCollapseSessionRef.current = sessionKey;
      knownLaneRootIdsRef.current = currentRootIdSet;
      setCollapsedLaneIds(new Set(currentRootIds));
      return;
    }

    const knownRootIds = knownLaneRootIdsRef.current;
    knownLaneRootIdsRef.current = currentRootIdSet;
    setCollapsedLaneIds((current) => {
      let changed = false;
      const next = new Set<string>();

      for (const rootId of current) {
        if (currentRootIdSet.has(rootId)) {
          next.add(rootId);
        } else {
          changed = true;
        }
      }

      for (const rootId of currentRootIds) {
        if (!knownRootIds.has(rootId)) {
          next.add(rootId);
          changed = true;
        }
      }

      return changed || next.size !== current.size ? next : current;
    });
  }, [activeSessionId, branchLanes]);

  useEffect(() => {
    viewRef.current?.scrollTo({ top: 0, left: 0 });
  }, [activeView, connectionEdgeId, selectedNodeId]);

  const nodeFiltersActive = nodeSearchQuery.trim().length > 0 || nodeStatusFilter !== "all";
  const visibleBranchLanes = useMemo<VisibleBranchLane[]>(() => {
    const search = nodeSearchQuery.trim().toLocaleLowerCase();
    const matchesNode = (node: GraphNode) => {
      const searchTarget = [node.data.name ?? "", node.data.prompt ?? ""].join(" ").toLocaleLowerCase();
      const searchMatches = !search || searchTarget.includes(search);
      const statusMatches = nodeStatusFilter === "all" || statusTone(node.data.status) === nodeStatusFilter;
      return searchMatches && statusMatches;
    };
    const toVisibleTree = (item: BranchTreeItem): VisibleBranchTreeItem => ({
      ...item,
      children: item.children.map(toVisibleTree),
    });
    const filterTree = (
      item: BranchTreeItem,
    ): { tree: VisibleBranchTreeItem; matchCount: number } | null => {
      const childResults = item.children
        .map(filterTree)
        .filter((result): result is { tree: VisibleBranchTreeItem; matchCount: number } => !!result);
      const directMatch = matchesNode(item.node);
      const matchCount = (directMatch ? 1 : 0) + childResults.reduce((sum, result) => sum + result.matchCount, 0);
      if (!directMatch && childResults.length === 0) return null;
      return {
        tree: {
          ...item,
          children: childResults.map((result) => result.tree),
          filterMatched: directMatch,
          filterContext: !directMatch,
        },
        matchCount,
      };
    };

    if (!nodeFiltersActive) {
      return branchLanes.map((lane) => ({
        ...lane,
        tree: lane.tree ? toVisibleTree(lane.tree) : null,
        matchCount: lane.itemCount,
      }));
    }

    return branchLanes.flatMap((lane) => {
      if (!lane.tree) return [];
      const result = filterTree(lane.tree);
      if (!result) return [];
      return [{ ...lane, tree: result.tree, matchCount: result.matchCount }];
    });
  }, [branchLanes, nodeFiltersActive, nodeSearchQuery, nodeStatusFilter]);
  const clientPreview = useMemo(() => {
    if (!selectedNodeId) return null;
    return buildNodeGeneratePreview(selectedNodeId);
  }, [buildNodeGeneratePreview, selectedNodeId, nodes, edges]);

  const QUALITY_ITEMS = [
    { value: "low" as const, label: t("quality.lowLabel"), sub: t("quality.lowSub") },
    { value: "medium" as const, label: t("quality.mediumLabel"), sub: t("quality.mediumSub") },
    { value: "high" as const, label: t("quality.highLabel"), sub: t("quality.highSub") },
  ];
  const MODEL_ITEMS = [
    { value: "gpt-5.4-mini" as const, label: "5.4 Mini", sub: t("model.fast") },
    { value: "gpt-5.4" as const, label: "5.4", sub: t("model.balanced") },
    { value: "gpt-5.5" as const, label: "5.5", sub: t("model.best") },
  ];
  const MOD_ITEMS = [
    { value: "auto" as const, label: t("moderation.autoLabel"), sub: t("moderation.autoSub") },
    {
      value: "low" as const,
      label: t("moderation.lowLabel"),
      sub: t("moderation.lowSub"),
      color: "var(--amber)",
    },
  ];

  const openConnection = (edgeId: string, returnView: ConnectionReturnView) => {
    setConnectionEdgeId(edgeId);
    setConnectionReturnView(returnView);
    setActiveView("connection");
  };

  const addRoot = () => {
    const nodeId = addRootNode();
    setLastFocusedNodeId(nodeId);
    selectNode(nodeId);
    setActiveView("node");
  };

  const importCurrent = () => {
    void importCurrentImageAsNode().then(() => setActiveView("node"));
  };

  const selectAndOpenNode = (nodeId: string) => {
    setLastFocusedNodeId(nodeId);
    selectNode(nodeId);
    setActiveView("node");
  };

  const selectInBranches = (nodeId: string) => {
    setLastFocusedNodeId(nodeId);
    selectNode(nodeId);
    setActiveView("branches");
  };

  const showAllNodes = () => {
    setLastFocusedNodeId(selectedNodeId ?? lastFocusedNodeId);
    setActiveView("all");
  };

  const toggleLaneCollapsed = (rootId: string) => {
    setCollapsedLaneIds((current) => {
      const next = new Set(current);
      if (next.has(rootId)) next.delete(rootId);
      else next.add(rootId);
      return next;
    });
  };

  const toggleTreeNodeCollapsed = (event: MouseEvent<HTMLButtonElement>, nodeId: string) => {
    event.stopPropagation();
    setCollapsedTreeNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const renderBranchTreeItem = (item: VisibleBranchTreeItem, lane: VisibleBranchLane) => {
    const level = item.meta.level ?? 0;
    const hasChildren = item.childNodes.length > 0;
    const collapsed = hasChildren && !nodeFiltersActive && collapsedTreeNodeIds.has(item.node.id);
    const cardTone = item.meta.treeColor ?? lane.treeColor;
    const nodeName = item.node.data.name?.trim();
    const promptText = item.node.data.prompt.trim();
    const titleText = nodeName || promptText || t("mobileNode.noPromptYet");
    const showPromptPreview = Boolean(nodeName && promptText);
    const thumbnailSrc = item.node.data.imageUrl;
    const isCurrent = item.node.id === (selectedNodeId ?? lastFocusedNodeId);
    return (
      <div
        key={item.node.id}
        className="mobile-node-tree-row"
        style={{
          "--node-tree-color": cardTone,
          "--node-tree-depth": Math.min(level, 2),
        } as CSSProperties}
      >
        <div
          className={`mobile-node-list-card mobile-node-list-card--tree${selectedNodeId === item.node.id ? " is-selected" : ""}${isCurrent ? " is-current" : ""}${item.filterContext ? " is-filter-context" : ""}`}
        >
          <button
            type="button"
            className={`mobile-node-list-card__body${thumbnailSrc ? " has-thumbnail" : ""}`}
            onClick={() => selectAndOpenNode(item.node.id)}
            aria-current={isCurrent ? "true" : undefined}
          >
            <span className="mobile-node-list-card__content">
              <span className="mobile-node-list-card__title-row">
                <strong>{titleText}</strong>
              </span>
              {showPromptPreview ? (
                <span className="mobile-node-list-card__prompt">{promptText}</span>
              ) : !promptText ? (
                <span className="mobile-node-list-card__prompt mobile-node-list-card__prompt--muted">
                  {t("mobileNode.noPromptYet")}
                </span>
              ) : null}
              {hasChildren ? (
                <span className="mobile-node-list-card__meta">
                  {t("mobileNode.nodeChildShort", { count: item.childNodes.length })}
                </span>
              ) : null}
            </span>
            {thumbnailSrc ? (
              <span className="mobile-node-list-card__thumb" aria-hidden="true">
                <img src={thumbnailSrc} alt="" />
              </span>
            ) : null}
          </button>
          <div className="mobile-node-list-card__meta-cluster">
            <span className="mobile-node-list-card__level">L{level}</span>
            <span className={`mobile-node-list-card__status mobile-node-list-card__status--${statusTone(item.node.data.status)}`}>
              {getStatusLabel(t, item.node.data.status)}
            </span>
            {hasChildren ? (
              <button
                type="button"
                className="mobile-node-list-card__tree-toggle"
                onClick={(event) => toggleTreeNodeCollapsed(event, item.node.id)}
                aria-expanded={!collapsed}
                aria-label={t(collapsed ? "mobileNode.expandNode" : "mobileNode.collapseNode", {
                  name: nodeLabel(item.node),
                })}
              >
                {collapsed ? "▸" : "▾"}
              </button>
            ) : null}
          </div>
        </div>
        {hasChildren && !collapsed ? (
          <div className="mobile-node-tree-children">
            {item.children.map((child) => renderBranchTreeItem(child, lane))}
          </div>
        ) : null}
      </div>
    );
  };

  const handleRenameSession = () => {
    const next = window.prompt(
      t("session.renamePrompt"),
      activeSession?.title ?? t("session.newSession"),
    );
    if (next?.trim()) void renameCurrentSession(next.trim());
  };

  const handleDeleteSession = (id: string, title: string) => {
    if (!window.confirm(t("session.deleteConfirm", { title }))) return;
    void deleteSessionById(id);
  };

  const cycleEdgeImageTransfer = (edge: GraphEdge) => {
    const edgeData = normalizeEdgeTransferData(edge.data);
    setEdgeImageTransferQuiet(edge.id, nextImageTransferMode(edgeData.imageTransfer));
  };

  const toggleEdgeContext = (edge: GraphEdge) => {
    const edgeData = normalizeEdgeTransferData(edge.data);
    updateEdgeTransferQuiet(edge.id, { transferContext: !edgeData.transferContext });
  };

  const toggleEdgeSettings = (edge: GraphEdge) => {
    const edgeData = normalizeEdgeTransferData(edge.data);
    updateEdgeTransferQuiet(edge.id, { transferSettings: !edgeData.transferSettings });
  };

  const edgeChipActions = {
    onCycleImage: cycleEdgeImageTransfer,
    onToggleContext: toggleEdgeContext,
    onToggleSettings: toggleEdgeSettings,
  };

  const jumpToSettings = () => {
    setActiveView("node");
    window.setTimeout(() => {
      if (settingsRef.current) settingsRef.current.open = true;
      settingsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 50);
  };

  const handleTabChange = (view: MobileNodeTab) => {
    setSessionSheetOpen(false);
    setLightboxOpen(false);
    setActiveView(view);
  };

  const attachImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !selected) return;
    await attachImageToNode(selected.id, file);
  };

  const copyImage = async () => {
    if (!data?.imageUrl) return;
    try {
      await copyImageToClipboard(data.imageUrl);
      showToast(t("toast.imageCopied"));
    } catch (err) {
      const key =
        err instanceof Error && err.message === "image-copy-requires-https"
          ? "toast.imageCopyNeedsHttps"
          : "toast.copyFailed";
      showToast(t(key), true);
    }
  };

  const copyPrompt = async () => {
    if (!data?.prompt) return;
    try {
      await copyTextToClipboard(data.prompt);
      showToast(t("toast.promptCopied"));
    } catch {
      showToast(t("toast.copyFailed"), true);
    }
  };

  const download = () => {
    if (!selected || !data?.imageUrl) return;
    const link = document.createElement("a");
    link.href = data.imageUrl;
    link.download = data.filename || `${data.serverNodeId ?? selected.id}.png`;
    link.click();
  };

  const renderAllNodes = () => {
    if (nodes.length) {
      return (
        <section className="mobile-node-empty mobile-node-empty--navigator">
          <div className="mobile-node-list-heading">
            <div>
              <span>{t("mobileNode.nodeListTitle")}</span>
              <div className="mobile-node-list-heading__actions">
                <button
                  type="button"
                  className="mobile-node-sort-toggle"
                  onClick={() => setNodeListSort((sort) => (sort === "graphAsc" ? "graphDesc" : "graphAsc"))}
                  aria-label={t("mobileNode.nodeSortToggle")}
                >
                  {nodeListSort === "graphAsc" ? t("mobileNode.nodeSortAsc") : t("mobileNode.nodeSortDesc")}
                </button>
                <button type="button" className="mobile-node-sort-toggle" onClick={() => setActiveView("map")}>
                  {t("mobileNode.openMapShort")}
                </button>
              </div>
            </div>
            <small>{t("mobileNode.nodeListHelp")}</small>
          </div>
          <div className="mobile-node-node-filters" role="search">
            <input
              type="search"
              className="mobile-node-node-search"
              value={nodeSearchQuery}
              onChange={(event) => setNodeSearchQuery(event.currentTarget.value)}
              placeholder={t("mobileNode.nodeSearchPlaceholder")}
              aria-label={t("mobileNode.nodeSearchLabel")}
            />
            <div className="mobile-node-status-filters" aria-label={t("mobileNode.statusFilterLabel")}>
              {NODE_STATUS_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`mobile-node-status-filter${nodeStatusFilter === filter ? " is-active" : ""}`}
                  onClick={() => setNodeStatusFilter(filter)}
                  aria-pressed={nodeStatusFilter === filter}
                >
                  {getStatusFilterLabel(t, filter)}
                </button>
              ))}
            </div>
          </div>
          <div className="mobile-node-branch-lanes">
            {visibleBranchLanes.length === 0 ? (
              <div className="mobile-node-no-results">{t("mobileNode.nodeNoResults")}</div>
            ) : null}
            {visibleBranchLanes.map((lane) => {
              const collapsed = !nodeFiltersActive && collapsedLaneIds.has(lane.rootId);
              const summary = laneStatusSummary(t, lane.statusCounts);
              return (
                <section
                  key={lane.rootId}
                  className={`mobile-node-branch-lane${collapsed ? " is-collapsed" : ""}`}
                  style={{ "--node-tree-color": lane.treeColor } as CSSProperties}
                >
                  <button
                    type="button"
                    className="mobile-node-branch-lane__header"
                    onClick={() => toggleLaneCollapsed(lane.rootId)}
                    aria-expanded={!collapsed}
                    aria-label={t(collapsed ? "mobileNode.laneExpand" : "mobileNode.laneCollapse", {
                      name: nodeLabel(lane.root),
                    })}
                  >
                    <span className="mobile-node-branch-lane__marker" aria-hidden="true" />
                    <span className="mobile-node-branch-lane__title">
                      <strong>{nodeLabel(lane.root)}</strong>
                      <small>
                        {nodeFiltersActive
                          ? t("mobileNode.laneMatches", { count: lane.matchCount })
                          : `${t("mobileNode.laneNodes", { count: lane.itemCount })} · ${t("mobileNode.laneLeaves", { count: lane.leafCount })}`}
                      </small>
                    </span>
                    {summary ? <span className="mobile-node-branch-lane__summary">{summary}</span> : null}
                    <span className="mobile-node-branch-lane__chevron" aria-hidden="true">
                      {collapsed ? "▸" : "▾"}
                    </span>
                  </button>
                  {!collapsed ? (
                    <div className="mobile-node-branch-lane__body">
                      {lane.tree ? renderBranchTreeItem(lane.tree, lane) : null}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </section>
      );
    }

    return (
      <section className="mobile-node-empty">
        <div className="mobile-node-empty__mark">NODE</div>
        <h1>{t("mobileNode.startTitle")}</h1>
        <p>{t("mobileNode.startDescription")}</p>
        <div className="mobile-node-empty__actions">
          <button type="button" className="mobile-node-primary" onClick={addRoot}>
            {t("mobileNode.addFirst")}
          </button>
          <button
            type="button"
            className="mobile-node-button"
            onClick={importCurrent}
            disabled={!currentImage?.filename}
          >
            {t("mobileNode.importCurrentResult")}
          </button>
        </div>
        <small className="mobile-node-empty__hint">{t("mobileNode.importCurrentHelp")}</small>
        <small className="mobile-node-empty__hint">{t("mobileNode.sessionHint")}</small>
      </section>
    );
  };

  const getNodeMeta = (node: GraphNode): GraphNodeMeta =>
    graphMeta.get(node.id) ?? {
      level: 0,
      isolated: true,
      treeRootId: node.id,
      treeIndex: 0,
      treeColor: "#a78bfa",
    };

  const getBranchRegenerateState = (
    nodeData: ImageNodeData,
    childCount: number,
    running: boolean,
  ) => {
    const nodeBusy = isBusy(nodeData);
    const hasReference = !!nodeData.serverNodeId || !!nodeData.imageUrl;
    const canRegenerate = !nodeBusy && nodeData.prompt.trim().length > 0 && hasReference && childCount > 0;
    const reason = running
      ? t("mobileNode.branchRunning")
      : nodeBusy
        ? t("mobileNode.branchReasonBusy")
        : !nodeData.prompt.trim()
          ? t("mobileNode.branchReasonPrompt")
          : !hasReference
            ? t("mobileNode.branchReasonImage")
            : childCount === 0
              ? t("mobileNode.branchReasonChildren")
              : "";
    return { canRegenerate, reason };
  };

  const renderEndpointSummary = (node: GraphNode, label: string) => {
    const meta = getNodeMeta(node);
    const promptText = node.data.prompt.trim();
    const titleText = node.data.name?.trim() || promptText || t("mobileNode.noPromptYet");
    return (
      <div
        className={`mobile-node-connection-endpoint${node.data.imageUrl ? " has-thumbnail" : ""}`}
        style={{ "--node-tree-color": meta.treeColor ?? "#a78bfa" } as CSSProperties}
      >
        {node.data.imageUrl ? (
          <span className="mobile-node-connection-endpoint__thumb" aria-hidden="true">
            <img src={node.data.imageUrl} alt="" />
          </span>
        ) : null}
        <span className="mobile-node-connection-endpoint__content">
          <span>{label}</span>
          <strong>{titleText}</strong>
          {promptText && node.data.name?.trim() ? <small>{promptText}</small> : null}
        </span>
        <span className="mobile-node-connection-endpoint__badges">
          <span className="mobile-node-list-card__level">L{meta.level}</span>
          <span className={`mobile-node-list-card__status mobile-node-list-card__status--${statusTone(node.data.status)}`}>
            {getStatusLabel(t, node.data.status)}
          </span>
        </span>
      </div>
    );
  };

  const renderSelectedNode = () => {
    if (!selected || !data) {
      return (
        <section className="mobile-node-empty mobile-node-empty--compact">
          <h2>{t("mobileNode.noSelectionTitle")}</h2>
          <p>{t("mobileNode.noSelectionDescription")}</p>
          <div className="mobile-node-empty__actions">
            <button type="button" className="mobile-node-primary" onClick={addRoot}>
              {t(nodes.length ? "mobileNode.addRootShort" : "mobileNode.addFirst")}
            </button>
            {nodes.length ? (
              <button type="button" className="mobile-node-button" onClick={showAllNodes}>
                {t("mobileNode.allNodes")}
              </button>
            ) : null}
          </div>
        </section>
      );
    }

    const busy = isBusy(data);
    const canGenerate = !busy && data.prompt.trim().length > 0;
    const canAttachImage = canAttachImageToNodeData(data);
    const canRemoveImageReference = canRemoveNodeImageReference(data);
    const attachingImage = attachingNodeIds.includes(selected.id);
    const canBranch = canUseNodeAsBranchParent(data);
    const isBranchGenerating = branchGenerationRootId === selected.id;
    const branchRegenerateState = getBranchRegenerateState(data, children.length, isBranchGenerating);
    const selectedMeta = getNodeMeta(selected);
    const rootNode = nodes.find((node) => node.id === selectedMeta.treeRootId) ?? selected;
    const resolvedSize =
      data.settings.sizePreset === "custom"
        ? `${snap16(data.settings.customW)}x${snap16(data.settings.customH)}`
        : data.settings.sizePreset;
    const lightboxMeta = [
      data.quality ?? data.settings.quality,
      data.size ?? resolvedSize,
      data.format ?? data.settings.format,
      data.model ?? data.settings.model,
      data.provider,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" · ");
    const generateLabel = busy
      ? t("node.cancel")
      : data.status === "ready"
        ? t("node.regenerate")
        : data.status === "error" ||
            data.status === "stale" ||
            data.status === "canceled" ||
            data.status === "asset-missing"
          ? t("node.retry")
          : t("node.generate");
    const settingsSummary = [
      data.settings.model,
      data.settings.quality,
      resolvedSize,
      data.settings.format,
    ].join(" · ");
    const previewJson =
      clientPreview == null
        ? t("nodeInspector.apiPreviewEmpty")
        : JSON.stringify(
            {
              summary: {
                mode: clientPreview.mode,
                imageTransfer: clientPreview.imageTransfer,
                parentNodeId: clientPreview.parentNodeId,
                ancestorCount: clientPreview.ancestorNodeIds.length,
                model: clientPreview.nodeSettings.model,
                quality: clientPreview.nodeSettings.quality,
                size: clientPreview.size,
                format: clientPreview.nodeSettings.format,
                moderation: clientPreview.nodeSettings.moderation,
              },
              issues: clientPreview.issues,
              images: clientPreview.visualContext.map((item, index) => ({
                order: index + 1,
                relation: item.relation,
                nodeId: item.nodeId,
                clientNodeId: item.clientNodeId ?? null,
                name: item.name ?? null,
              })),
              effectivePrompt: clientPreview.effectivePrompt,
              payload: clientPreview.payload,
            },
            null,
            2,
          );

    return (
      <>
        <section className="mobile-node-focus">
          <div
            className={`mobile-node-context-card mobile-node-edit-card${data.imageUrl ? " has-thumbnail" : ""}${parent ? " has-action" : ""}`}
            style={{ "--node-tree-color": selectedMeta.treeColor ?? "#a78bfa" } as CSSProperties}
          >
            <span className="mobile-node-edit-card__main">
              <label className="mobile-node-name-field mobile-node-name-field--compact">
                <span>{t("nodeInspector.nodeName")}</span>
                <input
                  type="text"
                  value={data.name ?? ""}
                  onChange={(event) => updateNodeName(selected.id, event.target.value)}
                  placeholder={t("node.untitledName")}
                />
              </label>
              <span className="mobile-node-context-card__main">
                <span className="mobile-node-context-card__eyebrow">{t("mobileNode.nodeContextTitle")}</span>
                <strong>
                  {parent
                    ? `${nodeLabel(parent)} -> ${nodeLabel(selected)}`
                    : `${t("mobileNode.rootLane")}: ${nodeLabel(rootNode)}`}
                </strong>
                <span className="mobile-node-context-card__meta">
                  <span className="mobile-node-list-card__level">L{selectedMeta.level}</span>
                  <span className={`mobile-node-list-card__status mobile-node-list-card__status--${statusTone(data.status)}`}>
                    {getStatusLabel(t, data.status)}
                  </span>
                  <span>{t("mobileNode.nodeChildShort", { count: children.length })}</span>
                </span>
              </span>
            </span>
            {data.imageUrl ? (
              <span className="mobile-node-context-card__thumb" aria-hidden="true">
                <img src={data.imageUrl} alt="" />
              </span>
            ) : null}
            {parent ? (
              <button type="button" className="mobile-node-context-card__action" onClick={() => setActiveView("branches")}>
                {t("mobileNode.openBranches")}
              </button>
            ) : null}
          </div>

          <div className="mobile-node-pills" aria-label={t("nodeInspector.statusMeta")}>
            <span className="mobile-node-pill">{data.settings.quality}</span>
            <span className="mobile-node-pill">{resolvedSize}</span>
            {data.elapsed != null ? <span className="mobile-node-pill">{data.elapsed}s</span> : null}
          </div>

          <label className="mobile-node-prompt">
            <span className="mobile-node-section-heading">
              <span>{t("nodeInspector.prompt")}</span>
              <span className="mobile-node-section-actions">
                <button type="button" onClick={() => void openPromptLibrary()}>
                  {t("promptLibrary.short")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void createPromptLibraryItem({
                      name: (data.name || data.prompt).trim().slice(0, 40) || t("promptLibrary.untitled"),
                      text: data.prompt,
                      mode: "auto",
                    })
                  }
                  disabled={!data.prompt.trim()}
                >
                  {t("promptLibrary.saveShort")}
                </button>
              </span>
            </span>
            <textarea
              value={data.prompt}
              disabled={busy}
              onChange={(event) => updateNodePrompt(selected.id, event.target.value)}
              placeholder={parent ? t("node.editPromptPlaceholder") : t("node.promptPlaceholder")}
              rows={5}
            />
          </label>

          {data.error ? <div className="mobile-node-error">{data.error}</div> : null}

          <div className="mobile-node-action-grid mobile-node-action-grid--primary">
            <button
              type="button"
              className={busy ? "mobile-node-danger" : "mobile-node-primary"}
              onClick={() =>
                busy ? void cancelNodeGeneration(selected.id) : void generateNode(selected.id)
              }
              disabled={busy ? !data.pendingRequestId : !canGenerate}
            >
              {generateLabel}
            </button>
            <button
              type="button"
              className="mobile-node-button"
              onClick={() => {
                selectNode(addChildNode(selected.id));
                setActiveView("node");
              }}
              disabled={!canBranch}
            >
              {t("node.addChild")}
            </button>
          </div>

          {canAttachImage ? (
            <>
              <input
                ref={attachInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={attachImage}
                className="mobile-node-file-input"
                aria-hidden="true"
                tabIndex={-1}
              />
              <button
                type="button"
                className="mobile-node-button mobile-node-button--wide"
                onClick={() => attachInputRef.current?.click()}
                disabled={attachingImage || busy}
              >
                {attachingImage ? t("nodeInspector.attachImageBusy") : t("nodeInspector.attachImage")}
              </button>
            </>
          ) : null}

          {data.imageUrl ? (
            <button
              type="button"
              className="mobile-node-preview mobile-node-preview--button"
              onClick={() => setLightboxOpen(true)}
              aria-label={t("nodeInspector.openImagePreview")}
            >
              <img src={data.imageUrl} alt={t("node.nodeImageAlt")} />
            </button>
          ) : (
            <div className="mobile-node-preview mobile-node-preview--empty">
              <span>{t("node.noImage")}</span>
            </div>
          )}

          {incomingEdge ? (
            <div className="mobile-node-connection-summary">
              <button
                type="button"
                className="mobile-node-connection-summary__main"
                onClick={() => openConnection(incomingEdge.id, "node")}
              >
                <span>
                  {t("nodeInspector.connectionTitle")}
                  {parent ? <small>{nodeLabel(parent)} -&gt; {nodeLabel(selected)}</small> : null}
                </span>
              </button>
              <EdgeChips edge={incomingEdge} {...edgeChipActions} />
            </div>
          ) : null}

          <details ref={settingsRef} className="mobile-node-settings">
            <summary>
              <span>{t("nodeInspector.nodeSettings")}</span>
              <small>{settingsSummary}</small>
            </summary>
            <div className="mobile-node-settings__body">
              <OptionGroup<ImageModel>
                title={t("model.title")}
                items={MODEL_ITEMS}
                value={data.settings.model}
                onChange={(model) => updateNodeSettings(selected.id, { model })}
              />
              <OptionGroup<Quality>
                title={t("quality.title")}
                items={QUALITY_ITEMS}
                value={data.settings.quality}
                onChange={(quality) => updateNodeSettings(selected.id, { quality })}
              />
              <div className="option-group">
                <div className="section-title">{t("size.title")}</div>
                <OptionGroup<SizePreset>
                  items={sizeItems(SIZE_PRESETS_ROW1)}
                  value={data.settings.sizePreset}
                  onChange={(sizePreset) => updateNodeSettings(selected.id, { sizePreset })}
                />
                <OptionGroup<SizePreset>
                  items={sizeItems(SIZE_PRESETS_ROW2)}
                  value={data.settings.sizePreset}
                  onChange={(sizePreset) => updateNodeSettings(selected.id, { sizePreset })}
                />
                <OptionGroup<SizePreset>
                  items={sizeItems(SIZE_PRESETS_ROW3)}
                  value={data.settings.sizePreset}
                  onChange={(sizePreset) => updateNodeSettings(selected.id, { sizePreset })}
                />
                <OptionGroup<SizePreset>
                  items={sizeItems(SIZE_PRESETS_ROW4)}
                  value={data.settings.sizePreset}
                  onChange={(sizePreset) => updateNodeSettings(selected.id, { sizePreset })}
                />
                <OptionGroup<SizePreset>
                  items={sizeItems(getSizePresetsRow5())}
                  value={data.settings.sizePreset}
                  onChange={(sizePreset) => updateNodeSettings(selected.id, { sizePreset })}
                />
                {data.settings.sizePreset === "custom" ? (
                  <>
                    <div className="mobile-node-custom-size">
                      <input
                        type="number"
                        min={1024}
                        max={3824}
                        step={16}
                        value={data.settings.customW}
                        onChange={(event) =>
                          updateNodeSettings(selected.id, {
                            customW: snap16(parseInt(event.target.value) || 1024),
                          })
                        }
                        placeholder={t("size.width")}
                      />
                      <span>x</span>
                      <input
                        type="number"
                        min={1024}
                        max={3824}
                        step={16}
                        value={data.settings.customH}
                        onChange={(event) =>
                          updateNodeSettings(selected.id, {
                            customH: snap16(parseInt(event.target.value) || 1024),
                          })
                        }
                        placeholder={t("size.height")}
                      />
                    </div>
                    <div className="mobile-node-size-hint">{t("size.hint")}</div>
                  </>
                ) : null}
              </div>
              <OptionGroup<Format>
                title={t("format.title")}
                items={FORMAT_ITEMS}
                value={data.settings.format}
                onChange={(format) => updateNodeSettings(selected.id, { format })}
              />
              <OptionGroup<Moderation>
                title={t("moderation.title")}
                items={MOD_ITEMS}
                value={data.settings.moderation}
                onChange={(moderation) => updateNodeSettings(selected.id, { moderation })}
              />
            </div>
          </details>

          <details className="mobile-node-api-preview">
            <summary>
              <span>{t("nodeInspector.apiPreviewTitle")}</span>
              <small>{t("nodeInspector.apiPreviewHint")}</small>
            </summary>
            {clientPreview?.issues.length ? (
              <div className="mobile-node-api-preview__issues">
                {clientPreview.issues.map((issue) => (
                  <div key={issue.code} data-blocking={issue.blocking ? "true" : "false"}>
                    {issue.message}
                  </div>
                ))}
              </div>
            ) : null}
            <pre>{previewJson}</pre>
          </details>

          <details className="mobile-node-actions-details">
            <summary>
              <span>{t("mobileNode.actionsTitle")}</span>
              <small>{t("mobileNode.actionsSummary")}</small>
            </summary>
            <div className="mobile-node-actions-details__body">
              <div className="mobile-node-action-title">{t("nodeInspector.exportActions")}</div>
              <div className="mobile-node-action-grid">
                <button type="button" className="mobile-node-button" onClick={download} disabled={!data.imageUrl}>
                  {t("result.download")}
                </button>
                <button type="button" className="mobile-node-button" onClick={() => void copyImage()} disabled={!data.imageUrl}>
                  {t("result.copyImage")}
                </button>
                <button type="button" className="mobile-node-button" onClick={() => void copyPrompt()} disabled={!data.prompt}>
                  {t("result.copyPrompt")}
                </button>
                {canRemoveImageReference ? (
                  <button
                    type="button"
                    className="mobile-node-danger"
                    onClick={() => removeNodeImageReference(selected.id)}
                    disabled={busy}
                  >
                    {t("nodeInspector.removeImage")}
                  </button>
                ) : null}
              </div>

              <div className="mobile-node-action-title">{t("nodeInspector.workflowActions")}</div>
              <div className={`mobile-node-branch-inline-hint${isBranchGenerating ? " is-running" : ""}`}>
                {isBranchGenerating
                  ? t("mobileNode.branchImpact", { count: children.length })
                  : branchRegenerateState.reason || t("mobileNode.branchReady", { count: children.length })}
              </div>
              <div className="mobile-node-action-grid">
                <button
                  type="button"
                  className="mobile-node-button"
                  onClick={() =>
                    isBranchGenerating
                      ? void cancelBranchGeneration(selected.id)
                      : void regenerateBranch(selected.id)
                  }
                  disabled={isBranchGenerating ? false : !branchRegenerateState.canRegenerate}
                >
                  {isBranchGenerating ? t("node.cancelBranch") : t("node.regenerateBranch")}
                </button>
                <button
                  type="button"
                  className="mobile-node-button"
                  onClick={() => {
                    selectNode(addSiblingNode(selected.id));
                    setActiveView("node");
                  }}
                >
                  {t("mobileNode.addSibling")}
                </button>
                <button
                  type="button"
                  className="mobile-node-button"
                  onClick={() => {
                    selectNode(duplicateBranchRoot(selected.id));
                    setActiveView("node");
                  }}
                >
                  {t("mobileNode.duplicateRoot")}
                </button>
                <button
                  type="button"
                  className="mobile-node-danger"
                  onClick={() => {
                    deleteNode(selected.id);
                    selectNode(null);
                  }}
                >
                  {t("common.delete")}
                </button>
              </div>
            </div>
          </details>
        </section>
        <ImageLightbox
          open={lightboxOpen && !!data.imageUrl}
          imageSrc={data.imageUrl}
          title={data.name?.trim() || t("node.untitledName")}
          meta={lightboxMeta}
          onClose={() => setLightboxOpen(false)}
        />
      </>
    );
  };

  const renderBranches = () => {
    if (!selected || !data) {
      return (
        <section className="mobile-node-panel">
          <h2>{t("mobileNode.branchesTitle")}</h2>
          <p>{t("mobileNode.noSelectionDescription")}</p>
          <div className="mobile-node-action-grid mobile-node-action-grid--primary">
            <button type="button" className="mobile-node-primary" onClick={showAllNodes}>
              {t("mobileNode.allNodes")}
            </button>
            <button type="button" className="mobile-node-button" onClick={addRoot}>
              {t("mobileNode.addRootShort")}
            </button>
          </div>
        </section>
      );
    }

    const busy = isBusy(data);
    const canBranch = canUseNodeAsBranchParent(data);
    const isBranchGenerating = branchGenerationRootId === selected.id;
    const branchRegenerateState = getBranchRegenerateState(data, children.length, isBranchGenerating);
    const createChild = () => {
      const nodeId = addChildNode(selected.id);
      setLastFocusedNodeId(nodeId);
      selectNode(nodeId);
      setActiveView("node");
    };
    const createSibling = () => {
      const nodeId = addSiblingNode(selected.id);
      setLastFocusedNodeId(nodeId);
      selectNode(nodeId);
      setActiveView("node");
    };
    const createDuplicateRoot = () => {
      const nodeId = duplicateBranchRoot(selected.id);
      setLastFocusedNodeId(nodeId);
      selectNode(nodeId);
      setActiveView("node");
    };
    const renderBranchNodeCard = (
      node: GraphNode,
      variant: "current" | "parent" | "child",
      onSelect?: () => void,
    ) => {
      const nodeMeta = getNodeMeta(node);
      const promptText = node.data.prompt.trim();
      const titleText = node.data.name?.trim() || promptText || t("mobileNode.noPromptYet");
      const showPromptPreview = Boolean(node.data.name?.trim() && promptText);
      const descendantCount = childCountByNodeId.get(node.id) ?? 0;
      const content = (
        <>
          <span className="mobile-node-branch-node-card__content">
            <span className="mobile-node-branch-node-card__title">
              <strong>{titleText}</strong>
            </span>
            {showPromptPreview ? (
              <span className="mobile-node-branch-node-card__prompt">{promptText}</span>
            ) : !promptText ? (
              <span className="mobile-node-branch-node-card__prompt mobile-node-branch-node-card__prompt--muted">
                {t("mobileNode.noPromptYet")}
              </span>
            ) : null}
            {descendantCount ? (
              <span className="mobile-node-branch-node-card__meta">
                {t("mobileNode.nodeChildShort", { count: descendantCount })}
              </span>
            ) : null}
          </span>
          {node.data.imageUrl ? (
            <span className="mobile-node-branch-node-card__thumb" aria-hidden="true">
              <img src={node.data.imageUrl} alt="" />
            </span>
          ) : null}
          <span className="mobile-node-branch-node-card__badges">
            <span className="mobile-node-list-card__level">L{nodeMeta.level ?? 0}</span>
            <span className={`mobile-node-list-card__status mobile-node-list-card__status--${statusTone(node.data.status)}`}>
              {getStatusLabel(t, node.data.status)}
            </span>
          </span>
        </>
      );
      const className = `mobile-node-branch-node-card mobile-node-branch-node-card--${variant}${node.data.imageUrl ? " has-thumbnail" : ""}`;
      const style = { "--node-tree-color": nodeMeta.treeColor ?? "#a78bfa" } as CSSProperties;

      if (onSelect) {
        return (
          <button type="button" className={className} style={style} onClick={onSelect}>
            {content}
          </button>
        );
      }

      return (
        <div className={className} style={style}>
          {content}
        </div>
      );
    };

    return (
      <section className="mobile-node-panel mobile-node-panel--branches">
        <div className="mobile-node-panel__header">
          <div>
            <h2>{t("mobileNode.branchesTitle")}</h2>
            <p>{t("mobileNode.branchesSubtitle")}</p>
          </div>
        </div>
        <section className="mobile-node-branch-section">
          <div className="mobile-node-action-title">{t("mobileNode.currentSummaryTitle")}</div>
          {renderBranchNodeCard(selected, "current")}
        </section>
        <section className="mobile-node-branch-section">
          <div className="mobile-node-action-title">{t("mobileNode.inputConnectionTitle")}</div>
        {parent && incomingEdge ? (
          <div className="mobile-node-branch-connection-card">
            {renderBranchNodeCard(parent, "parent", () => selectInBranches(parent.id))}
            <div className="mobile-node-branch-connection-row">
              <button type="button" onClick={() => openConnection(incomingEdge.id, "branches")}>
                {t("mobileNode.openConnection")}
              </button>
              <EdgeChips edge={incomingEdge} {...edgeChipActions} />
            </div>
          </div>
        ) : (
          <div className="mobile-node-branch-root-card">
            <strong>{t("mobileNode.rootNode")}</strong>
            <small>{t("mobileNode.rootNodeBranchesHelp")}</small>
          </div>
        )}
        </section>
        <section className="mobile-node-branch-section">
          <div className="mobile-node-action-title">{t("mobileNode.branchCreateTitle")}</div>
          <div className="mobile-node-action-grid mobile-node-action-grid--branch-create">
            <button type="button" className="mobile-node-primary" onClick={createChild} disabled={!canBranch}>
              {t("node.addChild")}
            </button>
            <button type="button" className="mobile-node-button" onClick={createSibling}>
              {t("mobileNode.addSibling")}
            </button>
            <button
              type="button"
              className="mobile-node-button"
              onClick={createDuplicateRoot}
            >
              {t("mobileNode.duplicateRoot")}
            </button>
          </div>
        </section>
        <section className="mobile-node-branch-section">
          <div className="mobile-node-action-title">{t("mobileNode.branchGenerateTitle")}</div>
          <div className={`mobile-node-branch-generate-card${isBranchGenerating ? " is-running" : ""}`}>
            <div>
              <strong>{isBranchGenerating ? t("mobileNode.branchRunning") : t("node.regenerateBranch")}</strong>
              <small>
                {isBranchGenerating
                  ? t("mobileNode.branchImpact", { count: children.length })
                  : branchRegenerateState.reason || t("mobileNode.branchReady", { count: children.length })}
              </small>
            </div>
            <button
              type="button"
              className={isBranchGenerating ? "mobile-node-danger" : "mobile-node-button"}
              onClick={() =>
                isBranchGenerating
                  ? void cancelBranchGeneration(selected.id)
                  : void regenerateBranch(selected.id)
              }
              disabled={isBranchGenerating ? false : !branchRegenerateState.canRegenerate}
            >
              {isBranchGenerating ? t("node.cancelBranch") : t("node.regenerateBranch")}
            </button>
          </div>
        </section>
        <section className="mobile-node-branch-section mobile-node-children">
          <div className="mobile-node-action-title">{t("mobileNode.outputBranchesTitle")}</div>
          {children.length ? (
            children.map(({ edge, node }) => (
              <div key={edge.id} className="mobile-node-child-card">
                {renderBranchNodeCard(node, "child", () => selectInBranches(node.id))}
                <div className="mobile-node-branch-connection-row">
                  <button type="button" onClick={() => openConnection(edge.id, "branches")}>
                    {t("mobileNode.openConnection")}
                  </button>
                  <EdgeChips edge={edge} {...edgeChipActions} />
                </div>
              </div>
            ))
          ) : (
            <p className="mobile-node-muted">{t("mobileNode.noChildren")}</p>
          )}
        </section>
        {incomingEdge ? (
          <section className="mobile-node-branch-section">
            <div className="mobile-node-action-title">{t("mobileNode.branchStructureTitle")}</div>
            <button
              type="button"
              className="mobile-node-danger mobile-node-button--wide"
              onClick={() => detachNodeFromParent(selected.id)}
              disabled={busy}
            >
              {t("nodeInspector.detachConnection")}
            </button>
          </section>
        ) : null}
      </section>
    );
  };

  const renderMap = () => {
    const totalStatusCounts = branchLanes.reduce<LaneStatusCounts>(
      (counts, lane) => ({
        ready: counts.ready + lane.statusCounts.ready,
        busy: counts.busy + lane.statusCounts.busy,
        error: counts.error + lane.statusCounts.error,
        stale: counts.stale + lane.statusCounts.stale,
        empty: counts.empty + lane.statusCounts.empty,
      }),
      { ready: 0, busy: 0, error: 0, stale: 0, empty: 0 },
    );
    const selectedMeta = selected ? getNodeMeta(selected) : null;
    const selectedRoot = selectedMeta
      ? branchLanes.find((lane) => lane.rootId === selectedMeta.treeRootId)?.root ?? selected
      : null;
    const statusSummary = [
      totalStatusCounts.ready ? t("mobileNode.laneStatusReady", { count: totalStatusCounts.ready }) : "",
      totalStatusCounts.busy ? t("mobileNode.laneStatusBusy", { count: totalStatusCounts.busy }) : "",
      totalStatusCounts.stale ? t("mobileNode.laneStatusStale", { count: totalStatusCounts.stale }) : "",
      totalStatusCounts.error ? t("mobileNode.laneStatusError", { count: totalStatusCounts.error }) : "",
      totalStatusCounts.empty ? t("mobileNode.laneStatusEmpty", { count: totalStatusCounts.empty }) : "",
    ].filter(Boolean);
    const renderMapNode = (item: BranchTreeItem) => {
      const depth = Math.min(item.meta.level ?? 0, 5);
      const hasChildren = item.children.length > 0;
      const thumbnailSrc = item.node.data.status === "ready" ? item.node.data.imageUrl : null;
      const isSelected = selectedNodeId === item.node.id;
      const isCurrent = item.node.id === lastFocusedNodeId && !isSelected;
      return (
        <div
          key={item.node.id}
          className={`mobile-node-map-tree-row${item.parent ? " has-parent" : ""}`}
          style={{ "--map-depth": depth } as CSSProperties}
        >
          <button
            type="button"
            className={`mobile-node-map-node${isSelected ? " is-selected" : ""}${isCurrent ? " is-current" : ""}${thumbnailSrc ? " has-thumbnail" : ""}`}
            style={{ "--node-tree-color": item.meta.treeColor ?? "#a78bfa" } as CSSProperties}
            onClick={() => selectAndOpenNode(item.node.id)}
            aria-current={isSelected ? "true" : undefined}
          >
            <span className="mobile-node-map-node__level">L{item.meta.level ?? 0}</span>
            {thumbnailSrc ? (
              <span className="mobile-node-map-node__thumb" aria-hidden="true">
                <img src={thumbnailSrc} alt="" />
              </span>
            ) : null}
            <span className="mobile-node-map-node__text">
              <strong>{nodeLabel(item.node)}</strong>
              <small>{getStatusLabel(t, item.node.data.status)}</small>
            </span>
            {hasChildren ? (
              <span className="mobile-node-map-node__child-count">
                {t("mobileNode.nodeChildShort", { count: item.children.length })}
              </span>
            ) : null}
          </button>
          {hasChildren ? (
            <div className="mobile-node-map-tree-children">
              {item.children.map(renderMapNode)}
            </div>
          ) : null}
        </div>
      );
    };

    return (
      <section className="mobile-node-panel mobile-node-panel--map">
        <div className="mobile-node-panel__header">
          <div>
            <h2>{t("mobileNode.mapTitle")}</h2>
            <p>{t("mobileNode.mapSubtitle")}</p>
          </div>
          <div className="mobile-node-map-actions">
            <button type="button" onClick={showAllNodes}>
              {t("mobileNode.tabs.all")}
            </button>
            {selected ? (
              <button type="button" onClick={() => setActiveView("branches")}>
                {t("mobileNode.openBranches")}
              </button>
            ) : null}
          </div>
        </div>
        {nodes.length ? (
          <>
            <div className="mobile-node-map-summary">
              <div>
                <strong>{t("mobileNode.mapOverview")}</strong>
                <span>{t("mobileNode.mapTotals", { roots: branchLanes.length, nodes: nodes.length })}</span>
              </div>
              <small>{statusSummary.length ? statusSummary.join(" · ") : t("mobileNode.nodeNoResults")}</small>
              <em>
                {selected && selectedMeta && selectedRoot
                  ? t("mobileNode.mapCurrentLocation", {
                      root: nodeLabel(selectedRoot),
                      level: selectedMeta.level,
                    })
                  : t("mobileNode.mapNoCurrent")}
              </em>
            </div>
            <div className="mobile-node-map">
              {branchLanes.map((lane) => (
                <section
                  key={lane.rootId}
                  className="mobile-node-map-lane"
                  style={{ "--node-tree-color": lane.treeColor } as CSSProperties}
                >
                  <div className="mobile-node-map-lane__header">
                    <div>
                      <strong>{nodeLabel(lane.root)}</strong>
                      <small>
                        {t("mobileNode.laneNodes", { count: lane.itemCount })} · {t("mobileNode.laneLeaves", { count: lane.leafCount })}
                      </small>
                    </div>
                    <span>{t("mobileNode.nodeChildShort", { count: childCountByNodeId.get(lane.rootId) ?? 0 })}</span>
                  </div>
                  <div className="mobile-node-map-lane__scroll">
                    <div className="mobile-node-map-tree">
                      {lane.tree ? renderMapNode(lane.tree) : null}
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </>
        ) : (
          <div className="mobile-node-empty mobile-node-empty--compact">
            <h2>{t("mobileNode.startTitle")}</h2>
            <p>{t("mobileNode.startDescription")}</p>
            <button type="button" className="mobile-node-primary" onClick={addRoot}>
              {t("mobileNode.addFirst")}
            </button>
          </div>
        )}
      </section>
    );
  };

  const renderConnection = () => {
    if (!activeConnectionEdge || !connectionParent || !connectionChild) {
      return (
        <section className="mobile-node-panel">
          <h2>{t("nodeInspector.connectionTitle")}</h2>
          <p>{t("mobileNode.noConnection")}</p>
          <button type="button" className="mobile-node-button" onClick={() => setActiveView(connectionReturnView)}>
            {t("mobileNode.backToBranches")}
          </button>
        </section>
      );
    }

    const edgeData = normalizeEdgeTransferData(activeConnectionEdge.data);
    const childBusy = isBusy(connectionChild.data);
    return (
      <section className="mobile-node-panel mobile-node-panel--connection">
        <div className="mobile-node-panel__header">
          <div>
            <h2>{t("nodeInspector.connectionTitle")}</h2>
            <p>{nodeLabel(connectionParent)} -&gt; {nodeLabel(connectionChild)}</p>
          </div>
          <button type="button" onClick={() => setActiveView(connectionReturnView)}>
            {t("mobileNode.done")}
          </button>
        </div>
        <div className="mobile-node-connection-context">
          <div className="mobile-node-connection-context__summary">
            <strong>{t("mobileNode.deliverySummary")}</strong>
            <EdgeChips edge={activeConnectionEdge} {...edgeChipActions} />
          </div>
          <div className="mobile-node-connection-context__flow">
            {renderEndpointSummary(connectionParent, t("mobileNode.connectionParent"))}
            <span className="mobile-node-connection-context__arrow" aria-hidden="true">-&gt;</span>
            {renderEndpointSummary(connectionChild, t("mobileNode.connectionChild"))}
          </div>
        </div>
        <div className="mobile-node-connection-control">
          <span>
            {t("nodeInspector.imageTransfer")}
            <small>{t(`nodeInspector.imageTransfer${edgeData.imageTransfer[0].toUpperCase()}${edgeData.imageTransfer.slice(1)}`)}</small>
          </span>
          <div className="mobile-node-segmented" role="group" aria-label={t("nodeInspector.imageTransfer")}>
            {IMAGE_TRANSFER_OPTIONS.map((mode) => (
              <button
                key={mode}
                type="button"
                className={edgeData.imageTransfer === mode ? "is-selected" : ""}
                onClick={() => setEdgeImageTransferQuiet(activeConnectionEdge.id, mode)}
              >
                {t(imageTransferLabelKey(mode))}
              </button>
            ))}
          </div>
        </div>
        <div className={`mobile-node-connection-control${edgeData.imageTransfer !== "ancestor" ? " is-muted" : ""}`}>
          <span>
            {t("nodeInspector.maxAncestorImages")}
            <small>
              {edgeData.imageTransfer === "ancestor"
                ? t("nodeInspector.maxAncestorImagesHelp")
                : t("nodeInspector.maxAncestorImagesDisabled")}
            </small>
          </span>
          <div className="mobile-node-segmented mobile-node-segmented--four" role="group" aria-label={t("nodeInspector.maxAncestorImages")}>
            {ANCESTOR_IMAGE_COUNT_OPTIONS.map((count) => (
              <button
                key={count}
                type="button"
                disabled={edgeData.imageTransfer !== "ancestor"}
                className={edgeData.maxAncestorImages === count ? "is-selected" : ""}
                onClick={() =>
                  updateEdgeTransferQuiet(activeConnectionEdge.id, {
                    maxAncestorImages: count as AncestorImageCount,
                  })
                }
              >
                {count}
              </button>
            ))}
          </div>
        </div>
        <label className="mobile-node-toggle-row">
          <span>
            {t("nodeInspector.transferContext")}
            <small>
              {t(edgeData.transferContext ? "nodeInspector.transferContextOn" : "nodeInspector.transferContextOff")}
            </small>
          </span>
          <input
            type="checkbox"
            checked={edgeData.transferContext}
            onChange={(event) =>
              updateEdgeTransferQuiet(activeConnectionEdge.id, {
                transferContext: event.target.checked,
              })
            }
          />
        </label>
        <label className="mobile-node-toggle-row">
          <span>
            {t("nodeInspector.transferSettings")}
            <small>
              {t(edgeData.transferSettings ? "nodeInspector.transferSettingsOn" : "nodeInspector.transferSettingsOff")}
            </small>
          </span>
          <input
            type="checkbox"
            checked={edgeData.transferSettings}
            onChange={(event) =>
              updateEdgeTransferQuiet(activeConnectionEdge.id, {
                transferSettings: event.target.checked,
              })
            }
          />
        </label>
        <button
          type="button"
          className="mobile-node-danger mobile-node-button--wide"
          onClick={() => {
            detachEdge(activeConnectionEdge.id);
            setActiveView(connectionReturnView);
          }}
          disabled={childBusy}
        >
          {t("nodeInspector.detachConnection")}
        </button>
      </section>
    );
  };

  const activeViewContent =
    activeView === "all"
      ? renderAllNodes()
      : activeView === "branches"
      ? renderBranches()
      : activeView === "map"
        ? renderMap()
        : activeView === "connection"
          ? renderConnection()
          : renderSelectedNode();

  return (
    <main className="mobile-node-workspace">
      <header className="mobile-node-topbar">
        <div className="mobile-node-brand">
          <strong>{t("mobileNode.title")}</strong>
          <button type="button" className="mobile-node-brand__session" onClick={() => setSessionSheetOpen(true)}>
            <span>{activeSession?.title ?? t("session.loading")}</span>
            <small>{nodes.length} {t("uiMode.node")}</small>
          </button>
        </div>
        <div className="mobile-node-topbar__actions">
          <button type="button" onClick={() => setUIMode("classic")}>
            {t("uiMode.classic")}
          </button>
          <button type="button" onClick={addRoot}>
            {t("mobileNode.addRootShort")}
          </button>
          <button type="button" onClick={undoGraph} disabled={!canUndoGraph} aria-label={t("nodeCanvas.undo")}>
            ↶
          </button>
          <button type="button" onClick={redoGraph} disabled={!canRedoGraph} aria-label={t("nodeCanvas.redo")}>
            ↷
          </button>
          <button type="button" onClick={() => void openPromptLibrary()}>
            {t("promptLibrary.short")}
          </button>
          <button type="button" onClick={openGallery}>
            {t("gallery.title")}
          </button>
          <button type="button" onClick={jumpToSettings} disabled={!selected}>
            {t("panel.settings")}
          </button>
          <LanguageToggle />
        </div>
      </header>
      {sessionSheetOpen ? (
        <div className="mobile-node-session-sheet" role="dialog" aria-modal="true" aria-label={t("mobileNode.sessionSheetTitle")}>
          <button
            type="button"
            className="mobile-node-session-sheet__backdrop"
            onClick={() => setSessionSheetOpen(false)}
            aria-label={t("common.close")}
          />
          <section className="mobile-node-session-sheet__panel">
            <div className="mobile-node-session-sheet__grabber" aria-hidden="true" />
            <div className="mobile-node-session-sheet__header">
              <div>
                <h2>{t("mobileNode.sessionSheetTitle")}</h2>
                <p>{t("mobileNode.sessionSheetHelp")}</p>
              </div>
              <button type="button" onClick={() => setSessionSheetOpen(false)}>
                {t("common.close")}
              </button>
            </div>
            <div className="mobile-node-session-sheet__actions">
              <button
                type="button"
                className="mobile-node-primary"
                onClick={() => {
                  setSessionSheetOpen(false);
                  void createAndSwitchSession(t("session.newSession"));
                }}
              >
                {t("session.newSessionTitle")}
              </button>
              <button
                type="button"
                className="mobile-node-button"
                onClick={handleRenameSession}
                disabled={!activeSession}
              >
                {t("session.renameTitle")}
              </button>
            </div>
            <div className="mobile-node-session-list">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`mobile-node-session-row${session.id === activeSessionId ? " is-active" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSessionSheetOpen(false);
                      if (session.id !== activeSessionId) void switchSession(session.id);
                    }}
                    disabled={sessionLoading}
                  >
                    <span>{session.title}</span>
                    <small>{t("mobileNode.sessionNodeCount", { count: session.nodeCount })}</small>
                  </button>
                  <button
                    type="button"
                    className="mobile-node-session-row__delete"
                    onClick={() => handleDeleteSession(session.id, session.title)}
                    disabled={sessionLoading}
                    aria-label={t("session.deleteTitle")}
                    title={t("session.deleteTitle")}
                  >
                    ×
                  </button>
                </div>
              ))}
              {sessions.length === 0 ? (
                <div className="mobile-node-session-empty">{t("session.empty")}</div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
      <div ref={viewRef} className="mobile-node-view">{activeViewContent}</div>
      <nav className="mobile-node-tabs" aria-label={t("mobileNode.tabsLabel")}>
        {(["all", "node", "branches"] as const).map((view) => (
          <button
            key={view}
            type="button"
            className={
              activeView === view ||
              (view === "all" && activeView === "map") ||
              (activeView === "connection" && connectionReturnView === view)
                ? "is-active"
                : ""
            }
            onClick={() => handleTabChange(view)}
          >
            {t(`mobileNode.tabs.${view}`)}
          </button>
        ))}
      </nav>
    </main>
  );
}
