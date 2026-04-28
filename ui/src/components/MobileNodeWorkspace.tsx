import { useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
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
import { deriveGraphMeta } from "../lib/graphMeta";
import {
  SIZE_PRESETS_ROW1,
  SIZE_PRESETS_ROW2,
  SIZE_PRESETS_ROW3,
  SIZE_PRESETS_ROW4,
  getSizePresetsRow5,
  snap16,
} from "../lib/size";
import type { Format, ImageModel, Moderation, Quality, SizePreset } from "../types";

type MobileNodeView = "node" | "branches" | "map" | "connection";

const IMAGE_TRANSFER_OPTIONS: ImageTransferMode[] = ["off", "parent", "ancestor"];

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

function edgeTransferText(t: (key: string) => string, edge: GraphEdge): string {
  const data = normalizeEdgeTransferData(edge.data);
  return [
    t(imageTransferLabelKey(data.imageTransfer)),
    data.transferContext ? t("edgeBadge.contextOn") : t("edgeBadge.contextOff"),
    data.transferSettings ? t("edgeBadge.settingsOn") : t("edgeBadge.settingsOff"),
  ].join(" · ");
}

function EdgeChips({ edge }: { edge: GraphEdge }) {
  const { t } = useI18n();
  const edgeData = normalizeEdgeTransferData(edge.data);
  const edgeState = getEdgeVisualState(edge.data);
  return (
    <div className="mobile-node-edge-chips" data-state={edgeState}>
      <span
        className={`mobile-node-edge-chip mobile-node-edge-chip--image${edgeData.imageTransfer !== "off" ? " is-on" : ""}`}
        data-image-transfer={edgeData.imageTransfer}
      >
        {t(imageTransferLabelKey(edgeData.imageTransfer))}
      </span>
      <span className={`mobile-node-edge-chip mobile-node-edge-chip--context${edgeData.transferContext ? " is-on" : ""}`}>
        {t("edgeBadge.context")}
      </span>
      <span className={`mobile-node-edge-chip mobile-node-edge-chip--settings${edgeData.transferSettings ? " is-on" : ""}`}>
        {t("edgeBadge.settings")}
      </span>
    </div>
  );
}

export function MobileNodeWorkspace() {
  const { t } = useI18n();
  const [activeView, setActiveView] = useState<MobileNodeView>("node");
  const [connectionEdgeId, setConnectionEdgeId] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const settingsRef = useRef<HTMLDetailsElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const nodes = useAppStore((s) => s.graphNodes);
  const edges = useAppStore((s) => s.graphEdges);
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const currentImage = useAppStore((s) => s.currentImage);
  const branchGenerationRootId = useAppStore((s) => s.branchGenerationRootId);
  const attachingNodeIds = useAppStore((s) => s.attachingNodeIds);
  const canUndoGraph = useAppStore((s) => s.canUndoGraph);
  const canRedoGraph = useAppStore((s) => s.canRedoGraph);
  const setUIMode = useAppStore((s) => s.setUIMode);
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
  const mapLevels = useMemo(() => {
    const grouped = new Map<number, GraphNode[]>();
    for (const node of nodes) {
      const level = graphMeta.get(node.id)?.level ?? 0;
      grouped.set(level, [...(grouped.get(level) ?? []), node]);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => a - b)
      .map(([level, levelNodes]) => ({
        level,
        nodes: levelNodes.sort((a, b) => {
          const ma = graphMeta.get(a.id);
          const mb = graphMeta.get(b.id);
          if ((ma?.treeIndex ?? 0) !== (mb?.treeIndex ?? 0)) {
            return (ma?.treeIndex ?? 0) - (mb?.treeIndex ?? 0);
          }
          return (a.position?.x ?? 0) - (b.position?.x ?? 0);
        }),
      }));
  }, [graphMeta, nodes]);
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

  const openConnection = (edgeId: string) => {
    setConnectionEdgeId(edgeId);
    setActiveView("connection");
  };

  const addRoot = () => {
    selectNode(addRootNode());
    setActiveView("node");
  };

  const importCurrent = () => {
    void importCurrentImageAsNode().then(() => setActiveView("node"));
  };

  const selectAndOpenNode = (nodeId: string) => {
    selectNode(nodeId);
    setActiveView("node");
  };

  const jumpToSettings = () => {
    setActiveView("node");
    window.setTimeout(() => {
      settingsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 50);
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

  const renderSelectedNode = () => {
    if (!selected || !data) {
      return (
        <section className="mobile-node-empty">
          <div className="mobile-node-empty__mark">NODE</div>
          <h1>{nodes.length ? t("mobileNode.noSelectionTitle") : t("mobileNode.startTitle")}</h1>
          <p>{nodes.length ? t("mobileNode.noSelectionDescription") : t("mobileNode.startDescription")}</p>
          <div className="mobile-node-empty__actions">
            <button type="button" className="mobile-node-primary" onClick={addRoot}>
              {nodes.length ? t("nodeCanvas.addRootTitle") : t("mobileNode.addFirst")}
            </button>
            <button
              type="button"
              className="mobile-node-button"
              onClick={importCurrent}
              disabled={!currentImage?.filename}
            >
              {t("nodeInspector.importCurrent")}
            </button>
          </div>
          {nodes.length ? (
            <div className="mobile-node-pick-list">
              {nodes.slice(0, 5).map((node) => (
                <button
                  type="button"
                  key={node.id}
                  className="mobile-node-list-card"
                  onClick={() => selectAndOpenNode(node.id)}
                >
                  <span>{nodeLabel(node)}</span>
                  <small>{getStatusLabel(t, node.data.status)} · {shortNodeId(node.id)}</small>
                </button>
              ))}
            </div>
          ) : (
            <small className="mobile-node-empty__hint">{t("mobileNode.sessionHint")}</small>
          )}
        </section>
      );
    }

    const busy = isBusy(data);
    const canGenerate = !busy && data.prompt.trim().length > 0;
    const canAttachImage = canAttachImageToNodeData(data);
    const canRemoveImageReference = canRemoveNodeImageReference(data);
    const attachingImage = attachingNodeIds.includes(selected.id);
    const canBranch = canUseNodeAsBranchParent(data);
    const hasChildren = children.length > 0;
    const hasImageReference = !!data.serverNodeId || !!data.imageUrl;
    const isBranchGenerating = branchGenerationRootId === selected.id;
    const canRegenerateBranch = canGenerate && hasImageReference && hasChildren;
    const selectedMeta = graphMeta.get(selected.id) ?? {
      level: 0,
      isolated: true,
      treeRootId: selected.id,
      treeIndex: 0,
      treeColor: "#a78bfa",
    };
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
          <div className="mobile-node-focus__header">
            <label className="mobile-node-name-field">
              <span>{t("nodeInspector.nodeName")}</span>
              <input
                type="text"
                value={data.name ?? ""}
                onChange={(event) => updateNodeName(selected.id, event.target.value)}
                placeholder={t("node.untitledName")}
              />
            </label>
            <div className="mobile-node-id-meta">
              <span>L{selectedMeta.level}</span>
              <span>{shortNodeId(selected.id)}</span>
              {data.serverNodeId ? <span>{shortNodeId(data.serverNodeId)}</span> : null}
            </div>
          </div>

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

          <div className="mobile-node-pills" aria-label={t("nodeInspector.statusMeta")}>
            <span className={`mobile-node-pill mobile-node-pill--${statusTone(data.status)}`}>
              {getStatusLabel(t, data.status)}
            </span>
            <span className="mobile-node-pill">{data.settings.quality}</span>
            <span className="mobile-node-pill">{resolvedSize}</span>
            {data.elapsed != null ? <span className="mobile-node-pill">{data.elapsed}s</span> : null}
            {parent ? <span className="mobile-node-pill">{t("nodeInspector.parentNode")}: {nodeLabel(parent)}</span> : null}
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
              rows={6}
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

          {incomingEdge ? (
            <button
              type="button"
              className="mobile-node-connection-summary"
              onClick={() => openConnection(incomingEdge.id)}
            >
              <span>
                {t("nodeInspector.connectionTitle")}
                {parent ? <small>{nodeLabel(parent)} -&gt; {nodeLabel(selected)}</small> : null}
              </span>
              <EdgeChips edge={incomingEdge} />
            </button>
          ) : null}

          <details ref={settingsRef} className="mobile-node-settings" open>
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
          <div className="mobile-node-action-grid">
            <button
              type="button"
              className="mobile-node-button"
              onClick={() =>
                isBranchGenerating
                  ? void cancelBranchGeneration(selected.id)
                  : void regenerateBranch(selected.id)
              }
              disabled={isBranchGenerating ? false : !canRegenerateBranch}
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
          <button type="button" className="mobile-node-primary" onClick={() => setActiveView("map")}>
            {t("mobileNode.openMap")}
          </button>
        </section>
      );
    }

    const busy = isBusy(data);
    const canBranch = canUseNodeAsBranchParent(data);
    const hasImageReference = !!data.serverNodeId || !!data.imageUrl;
    const canGenerate = !busy && data.prompt.trim().length > 0;
    const canRegenerateBranch = canGenerate && hasImageReference && children.length > 0;
    const isBranchGenerating = branchGenerationRootId === selected.id;

    return (
      <section className="mobile-node-panel mobile-node-panel--branches">
        <div className="mobile-node-panel__header">
          <div>
            <h2>{t("mobileNode.branchesTitle")}</h2>
            <p>{t("mobileNode.branchesSubtitle")}</p>
          </div>
          <span>{children.length}</span>
        </div>
        {parent && incomingEdge ? (
          <button
            type="button"
            className="mobile-node-lineage-card"
            onClick={() => selectAndOpenNode(parent.id)}
          >
            <span>{t("nodeInspector.parentNode")}</span>
            <strong>{nodeLabel(parent)}</strong>
            <small>{edgeTransferText(t, incomingEdge)}</small>
          </button>
        ) : (
          <div className="mobile-node-lineage-card mobile-node-lineage-card--muted">
            <span>{t("nodeInspector.parentNode")}</span>
            <strong>{t("mobileNode.rootNode")}</strong>
            <small>{t("mobileNode.rootNodeHelp")}</small>
          </div>
        )}
        <div className="mobile-node-lineage-card mobile-node-lineage-card--current">
          <span>{t("mobileNode.currentNode")}</span>
          <strong>{nodeLabel(selected)}</strong>
          <small>{getStatusLabel(t, data.status)} · {shortNodeId(selected.id)}</small>
        </div>
        <div className="mobile-node-action-grid">
          <button
            type="button"
            className="mobile-node-primary"
            onClick={() => {
              selectNode(addChildNode(selected.id));
              setActiveView("node");
            }}
            disabled={!canBranch}
          >
            {t("node.addChild")}
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
            className={isBranchGenerating ? "mobile-node-danger" : "mobile-node-button"}
            onClick={() =>
              isBranchGenerating
                ? void cancelBranchGeneration(selected.id)
                : void regenerateBranch(selected.id)
            }
            disabled={isBranchGenerating ? false : !canRegenerateBranch}
          >
            {isBranchGenerating ? t("node.cancelBranch") : t("node.regenerateBranch")}
          </button>
          <button
            type="button"
            className="mobile-node-danger"
            onClick={() => detachNodeFromParent(selected.id)}
            disabled={!incomingEdge || busy}
          >
            {t("nodeInspector.detachConnection")}
          </button>
          {incomingEdge ? (
            <button
              type="button"
              className="mobile-node-button"
              onClick={() => openConnection(incomingEdge.id)}
            >
              {t("mobileNode.openConnection")}
            </button>
          ) : null}
        </div>
        <div className="mobile-node-children">
          <div className="mobile-node-action-title">{t("mobileNode.children")}</div>
          {children.length ? (
            children.map(({ edge, node }) => (
              <div key={edge.id} className="mobile-node-child-card">
                <button type="button" onClick={() => selectAndOpenNode(node.id)}>
                  <strong>{nodeLabel(node)}</strong>
                  <small>{getStatusLabel(t, node.data.status)} · {shortNodeId(node.id)}</small>
                </button>
                <button type="button" onClick={() => openConnection(edge.id)}>
                  <EdgeChips edge={edge} />
                </button>
              </div>
            ))
          ) : (
            <p className="mobile-node-muted">{t("mobileNode.noChildren")}</p>
          )}
        </div>
      </section>
    );
  };

  const renderMap = () => {
    return (
      <section className="mobile-node-panel mobile-node-panel--map">
        <div className="mobile-node-panel__header">
          <div>
            <h2>{t("mobileNode.mapTitle")}</h2>
            <p>{t("mobileNode.mapSubtitle")}</p>
          </div>
          <span>{nodes.length}</span>
        </div>
        {nodes.length ? (
          <div className="mobile-node-map">
            {mapLevels.map(({ level, nodes: levelNodes }) => (
              <div key={level} className="mobile-node-map-level">
                <div className="mobile-node-map-level__label">L{level}</div>
                <div className="mobile-node-map-level__nodes">
                  {levelNodes.map((node) => {
                    const meta = graphMeta.get(node.id);
                    const parentEdge = edges.find((edge) => edge.target === node.id) ?? null;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        className={`mobile-node-map-node${selectedNodeId === node.id ? " is-selected" : ""}`}
                        style={{ "--node-tree-color": meta?.treeColor ?? "#a78bfa" } as CSSProperties}
                        onClick={() => selectAndOpenNode(node.id)}
                      >
                        <span>{nodeLabel(node)}</span>
                        <small>{getStatusLabel(t, node.data.status)} · {shortNodeId(node.id)}</small>
                        {parentEdge ? <em>{edgeTransferText(t, parentEdge)}</em> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
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
          <button type="button" className="mobile-node-button" onClick={() => setActiveView("branches")}>
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
          <button type="button" onClick={() => setActiveView("branches")}>
            {t("mobileNode.done")}
          </button>
        </div>
        <EdgeChips edge={activeConnectionEdge} />
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
        <div className="mobile-node-connection-control">
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
            setActiveView("branches");
          }}
          disabled={childBusy}
        >
          {t("nodeInspector.detachConnection")}
        </button>
      </section>
    );
  };

  const activeViewContent =
    activeView === "branches"
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
          <span>
            {activeSession?.title ?? t("session.loading")} · {nodes.length} {t("uiMode.node")}
          </span>
        </div>
        <div className="mobile-node-topbar__actions">
          <button type="button" onClick={() => setUIMode("classic")}>
            {t("uiMode.classic")}
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
      <div className="mobile-node-view">{activeViewContent}</div>
      <nav className="mobile-node-tabs" aria-label={t("mobileNode.tabsLabel")}>
        {(["node", "branches", "map"] as const).map((view) => (
          <button
            key={view}
            type="button"
            className={activeView === view || (view === "branches" && activeView === "connection") ? "is-active" : ""}
            onClick={() => setActiveView(view)}
          >
            {t(`mobileNode.tabs.${view}`)}
          </button>
        ))}
      </nav>
    </main>
  );
}
