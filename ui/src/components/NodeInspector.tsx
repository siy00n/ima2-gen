import { useEffect, useMemo, useState } from "react";
import {
  canUseNodeAsBranchParent,
  getEdgeVisualState,
  normalizeEdgeTransferData,
  useAppStore,
  ANCESTOR_IMAGE_COUNT_OPTIONS,
  type ImageNodeData,
  type ImageNodeStatus,
  type ImageTransferMode,
  type AncestorImageCount,
  type NodeGenerateDelivery,
} from "../store/useAppStore";
import { useI18n } from "../i18n";
import { copyImageToClipboard, copyTextToClipboard } from "../lib/clipboard";
import { OptionGroup, type OptionItem } from "./OptionGroup";
import { ImageLightbox } from "./ImageLightbox";
import { deriveGraphMeta } from "../lib/graphMeta";
import type { Format, Moderation, Quality, SizePreset } from "../types";
import {
  SIZE_PRESETS_ROW1,
  SIZE_PRESETS_ROW2,
  SIZE_PRESETS_ROW3,
  SIZE_PRESETS_ROW4,
  getSizePresetsRow5,
  snap16,
} from "../lib/size";
import {
  postNodeGeneratePreview,
  type NodeGeneratePreviewResponse,
} from "../lib/api";

function isBusy(data: ImageNodeData): boolean {
  return data.status === "pending" || data.status === "reconciling";
}

const FORMAT_ITEMS = [
  { value: "png" as const, label: "PNG" },
  { value: "jpeg" as const, label: "JPEG" },
  { value: "webp" as const, label: "WebP" },
];

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
  if (status === "stale") return "stale";
  return "empty";
}

const IMAGE_TRANSFER_OPTIONS: ImageTransferMode[] = ["off", "parent", "ancestor"];

function imageTransferLabelKey(mode: ImageTransferMode) {
  if (mode === "ancestor") return "edgeBadge.imageAncestor";
  if (mode === "off") return "edgeBadge.imageOff";
  return "edgeBadge.imageParent";
}

export function NodeInspector() {
  const { t } = useI18n();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [apiPreviewOpen, setApiPreviewOpen] = useState(false);
  const [serverPreview, setServerPreview] = useState<{
    loading: boolean;
    data: NodeGeneratePreviewResponse | null;
    error: string | null;
  }>({ loading: false, data: null, error: null });
  const nodes = useAppStore((s) => s.graphNodes);
  const edges = useAppStore((s) => s.graphEdges);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);
  const selectNode = useAppStore((s) => s.selectNode);
  const addRootNode = useAppStore((s) => s.addRootNode);
  const addChildNode = useAppStore((s) => s.addChildNode);
  const duplicateBranchRoot = useAppStore((s) => s.duplicateBranchRoot);
  const updateNodeName = useAppStore((s) => s.updateNodeName);
  const updateNodePrompt = useAppStore((s) => s.updateNodePrompt);
  const updateNodeSettings = useAppStore((s) => s.updateNodeSettings);
  const updateEdgeTransfer = useAppStore((s) => s.updateEdgeTransfer);
  const setEdgeImageTransfer = useAppStore((s) => s.setEdgeImageTransfer);
  const copyParentPromptToNode = useAppStore((s) => s.copyParentPromptToNode);
  const copyParentSettingsToNode = useAppStore((s) => s.copyParentSettingsToNode);
  const detachNodeFromParent = useAppStore((s) => s.detachNodeFromParent);
  const detachSelectedEdge = useAppStore((s) => s.detachSelectedEdge);
  const addChildFromSelectedEdge = useAppStore((s) => s.addChildFromSelectedEdge);
  const generateNode = useAppStore((s) => s.generateNode);
  const regenerateBranch = useAppStore((s) => s.regenerateBranch);
  const deleteNode = useAppStore((s) => s.deleteNode);
  const importCurrentImageAsNode = useAppStore((s) => s.importCurrentImageAsNode);
  const currentImage = useAppStore((s) => s.currentImage);
  const showToast = useAppStore((s) => s.showToast);
  const buildNodeGeneratePreview = useAppStore((s) => s.buildNodeGeneratePreview);

  const selected = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;
  const data = selected?.data;
  const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) : null;
  const edgeParent = selectedEdge ? nodes.find((n) => n.id === selectedEdge.source) : null;
  const edgeChild = selectedEdge ? nodes.find((n) => n.id === selectedEdge.target) : null;
  const graphMeta = useMemo(() => deriveGraphMeta(nodes, edges), [nodes, edges]);
  const shortNodeId = (value: string | null | undefined) =>
    value ? value.replace(/^n_/, "").slice(0, 8) : "-";
  const nodeLabel = (node: { data: ImageNodeData; id: string }) =>
    node.data.name?.trim() ||
    (node.data.serverNodeId ? shortNodeId(node.data.serverNodeId) : shortNodeId(node.id));
  const clientPreview = useMemo<NodeGenerateDelivery | null>(() => {
    if (!apiPreviewOpen || !selectedNodeId) return null;
    return buildNodeGeneratePreview(selectedNodeId);
  }, [apiPreviewOpen, buildNodeGeneratePreview, selectedNodeId, nodes, edges]);
  const apiPreviewHasBlockingIssue =
    clientPreview?.issues.some((issue) => issue.blocking) ?? false;
  const apiPreviewUnknownError = t("nodeInspector.apiPreviewErrorUnknown");

  useEffect(() => {
    if (!apiPreviewOpen || !clientPreview || apiPreviewHasBlockingIssue) {
      setServerPreview({ loading: false, data: null, error: null });
      return;
    }
    let cancelled = false;
    setServerPreview({ loading: true, data: null, error: null });
    void postNodeGeneratePreview(clientPreview.payload)
      .then((data) => {
        if (!cancelled) setServerPreview({ loading: false, data, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setServerPreview({
            loading: false,
            data: null,
            error: err instanceof Error ? err.message : apiPreviewUnknownError,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiPreviewHasBlockingIssue, apiPreviewOpen, apiPreviewUnknownError, clientPreview]);

  const importCurrent = () => {
    void importCurrentImageAsNode();
  };

  if (selectedEdge && edgeParent && edgeChild) {
    const edgeData = normalizeEdgeTransferData(selectedEdge.data);
    const edgeState = getEdgeVisualState(edgeData);
    return (
      <div className="node-inspector node-inspector--edge">
        <div className="section-title">{t("nodeInspector.connectionTitle")}</div>
        <div className="node-inspector__edge-state" data-state={edgeState}>
          <span
            className={`node-inspector__edge-chip node-inspector__edge-chip--image${edgeData.imageTransfer !== "off" ? " is-on" : ""}`}
            data-image-transfer={edgeData.imageTransfer}
            title={t("edgeBadge.imageTitle")}
          >
            {t(imageTransferLabelKey(edgeData.imageTransfer))}
          </span>
          <span className={`node-inspector__edge-chip node-inspector__edge-chip--context${edgeData.transferContext ? " is-on" : ""}`}>
            {t("edgeBadge.context")}
          </span>
          <span className={`node-inspector__edge-chip node-inspector__edge-chip--settings${edgeData.transferSettings ? " is-on" : ""}`}>
            {t("edgeBadge.settings")}
          </span>
        </div>
        <div className="node-inspector__connection">
          <button type="button" onClick={() => selectNode(edgeParent.id)}>
            {t("nodeInspector.parentNode")}
            <span>{nodeLabel(edgeParent)}</span>
          </button>
          <button type="button" onClick={() => selectNode(edgeChild.id)}>
            {t("nodeInspector.childNode")}
            <span>{nodeLabel(edgeChild)}</span>
          </button>
        </div>
        <p className="node-inspector__notice">{t("nodeInspector.connectionNotice")}</p>
        <div className="node-inspector__toggles">
          <label className="node-inspector__toggle-row">
            <span>
              {t("nodeInspector.transferContext")}
              <small>
                {t(
                  edgeData.transferContext
                    ? "nodeInspector.transferContextOn"
                    : "nodeInspector.transferContextOff",
                )}
              </small>
            </span>
            <input
              type="checkbox"
              checked={edgeData.transferContext}
              onChange={(event) =>
                updateEdgeTransfer(selectedEdge.id, { transferContext: event.target.checked })
              }
            />
          </label>
          <div className="node-inspector__toggle-row node-inspector__toggle-row--stacked">
            <span>
              {t("nodeInspector.imageTransfer")}
              <small>{t(`nodeInspector.imageTransfer${edgeData.imageTransfer[0].toUpperCase()}${edgeData.imageTransfer.slice(1)}`)}</small>
            </span>
            <div className="node-inspector__segmented" role="group" aria-label={t("nodeInspector.imageTransfer")}>
              {IMAGE_TRANSFER_OPTIONS.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={edgeData.imageTransfer === mode ? "is-selected" : ""}
                  onClick={() => setEdgeImageTransfer(selectedEdge.id, mode)}
                >
                  {t(imageTransferLabelKey(mode))}
                </button>
              ))}
            </div>
          </div>
          <div className="node-inspector__toggle-row node-inspector__toggle-row--stacked">
            <span>
              {t("nodeInspector.maxAncestorImages")}
              <small>
                {edgeData.imageTransfer === "ancestor"
                  ? t("nodeInspector.maxAncestorImagesHelp")
                  : t("nodeInspector.maxAncestorImagesDisabled")}
              </small>
            </span>
            <div
              className="node-inspector__segmented node-inspector__segmented--ancestor-count"
              role="group"
              aria-label={t("nodeInspector.maxAncestorImages")}
            >
              {ANCESTOR_IMAGE_COUNT_OPTIONS.map((count) => (
                <button
                  key={count}
                  type="button"
                  disabled={edgeData.imageTransfer !== "ancestor"}
                  className={edgeData.maxAncestorImages === count ? "is-selected" : ""}
                  onClick={() =>
                    updateEdgeTransfer(selectedEdge.id, {
                      maxAncestorImages: count as AncestorImageCount,
                    })
                  }
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
          <label className="node-inspector__toggle-row">
            <span>
              {t("nodeInspector.transferSettings")}
              <small>
                {t(
                  edgeData.transferSettings
                    ? "nodeInspector.transferSettingsOn"
                    : "nodeInspector.transferSettingsOff",
                )}
              </small>
            </span>
            <input
              type="checkbox"
              checked={edgeData.transferSettings}
              onChange={(event) =>
                updateEdgeTransfer(selectedEdge.id, { transferSettings: event.target.checked })
              }
            />
          </label>
        </div>
        <div className="node-inspector__actions">
          <button
            type="button"
            className="node-inspector__button"
            onClick={() => addChildFromSelectedEdge()}
            disabled={!canUseNodeAsBranchParent(edgeParent.data)}
          >
            {t("nodeInspector.addSiblingChild")}
          </button>
          <button
            type="button"
            className="node-inspector__danger"
            onClick={detachSelectedEdge}
            disabled={isBusy(edgeChild.data)}
          >
            {t("nodeInspector.detachConnection")}
          </button>
        </div>
      </div>
    );
  }

  if (!selected || !data) {
    return (
      <div className="node-inspector node-inspector--empty">
        <div className="section-title">{t("nodeInspector.title")}</div>
        <p className="node-inspector__empty">{t("nodeInspector.noSelection")}</p>
        <button
          type="button"
          className="node-inspector__primary"
          onClick={() => selectNode(addRootNode())}
        >
          {t("nodeCanvas.addFirst")}
        </button>
        <button
          type="button"
          className="node-inspector__button"
          onClick={importCurrent}
          disabled={!currentImage?.filename}
        >
          {t("nodeInspector.importCurrent")}
        </button>
      </div>
    );
  }

  const busy = isBusy(data);
  const canBranch = canUseNodeAsBranchParent(data);
  const canGenerate = !busy && data.prompt.trim().length > 0;
  const hasChildren = edges.some((edge) => edge.source === selected.id);
  const canRegenerateBranch = canGenerate && data.status === "ready" && !!data.serverNodeId && hasChildren;
  const imageSrc = data.imageUrl ?? null;
  const parent = selected ? nodes.find((n) => edges.some((e) => e.source === n.id && e.target === selected.id)) : null;
  const hasParent = !!parent;
  const selectedMeta = graphMeta.get(selected.id) ?? {
    level: 0,
    isolated: true,
    treeRootId: selected.id,
    treeIndex: 0,
    treeColor: "#a78bfa",
  };

  const QUALITY_ITEMS = [
    { value: "low" as const, label: t("quality.lowLabel"), sub: t("quality.lowSub") },
    { value: "medium" as const, label: t("quality.mediumLabel"), sub: t("quality.mediumSub") },
    { value: "high" as const, label: t("quality.highLabel"), sub: t("quality.highSub") },
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

  const download = () => {
    if (!imageSrc) return;
    const a = document.createElement("a");
    a.href = imageSrc;
    a.download = data.filename || `${data.serverNodeId ?? selected.id}.png`;
    a.click();
  };

  const copyImage = async () => {
    if (!imageSrc) return;
    try {
      await copyImageToClipboard(imageSrc);
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
    if (!data.prompt) return;
    try {
      await copyTextToClipboard(data.prompt);
      showToast(t("toast.promptCopied"));
    } catch {
      showToast(t("toast.copyFailed"), true);
    }
  };

  const generateLabel =
    data.status === "ready"
      ? t("node.regenerate")
      : data.status === "error" || data.status === "stale" || data.status === "asset-missing"
        ? t("node.retry")
        : t("node.generate");

  const resolvedSize =
    data.settings.sizePreset === "custom"
      ? `${snap16(data.settings.customW)}x${snap16(data.settings.customH)}`
      : data.settings.sizePreset;
  const settingsSummary = [
    data.settings.quality,
    resolvedSize,
    data.settings.format,
    data.settings.moderation,
  ].join(" · ");
  const statusLabel =
    data.status === "ready"
      ? t("nodeInspector.statusReady")
      : data.status === "pending"
        ? t("nodeInspector.statusGenerating")
        : data.status === "reconciling"
          ? t("nodeInspector.statusSyncing")
          : data.status === "stale"
            ? t("nodeInspector.statusStale")
            : data.status === "asset-missing"
              ? t("nodeInspector.statusMissing")
              : data.status === "error"
                ? t("nodeInspector.statusError")
                : t("nodeInspector.statusEmpty");
  const metaPills = [
    { label: statusLabel, tone: statusTone(data.status) },
    data.elapsed != null ? { label: `${data.elapsed}s` } : null,
    { label: data.settings.quality },
    { label: resolvedSize },
    data.provider ? { label: data.provider } : null,
  ].filter((v): v is { label: string; tone?: string } => Boolean(v));
  const lightboxTitle = data.name?.trim() || t("node.untitledName");
  const lightboxMeta = [
    data.quality ?? data.settings.quality,
    data.size ?? resolvedSize,
    data.format ?? data.settings.format,
    data.provider,
  ].filter((v): v is string => Boolean(v)).join(" · ");
  const apiPreviewSummary = clientPreview
    ? {
        mode: clientPreview.mode,
        imageTransfer: clientPreview.imageTransfer,
        parentNodeId: clientPreview.parentNodeId,
        ancestorCount: clientPreview.ancestorNodeIds.length,
        quality: clientPreview.nodeSettings.quality,
        size: clientPreview.size,
        format: clientPreview.nodeSettings.format,
        moderation: clientPreview.nodeSettings.moderation,
      }
    : null;
  const clientPreviewJson =
    clientPreview == null
      ? t("nodeInspector.apiPreviewEmpty")
      : JSON.stringify(
          {
            summary: apiPreviewSummary,
            issues: clientPreview.issues,
            images: clientPreview.visualContext.map((item, index) => ({
              order: index + 1,
              relation: item.relation,
              nodeId: item.nodeId,
              clientNodeId: item.clientNodeId ?? null,
              name: item.name ?? null,
              currentPrompt: item.currentPrompt ?? null,
            })),
            effectivePrompt: clientPreview.effectivePrompt,
            payload: clientPreview.payload,
          },
          null,
          2,
        );
  const serverPreviewJson = serverPreview.data
    ? JSON.stringify(
        {
          images: serverPreview.data.images,
          contentOrder: serverPreview.data.contentOrder,
          openAi: serverPreview.data.openAi,
        },
        null,
        2,
      )
    : null;

  return (
    <>
      <div className="node-inspector">
        <div className="node-inspector__node-header">
          <label className="node-inspector__name-field">
            <span>{t("nodeInspector.nodeName")}</span>
            <input
              type="text"
              value={data.name ?? ""}
              onChange={(e) => updateNodeName(selected.id, e.target.value)}
              placeholder={t("node.untitledName")}
            />
          </label>
          <div className="node-inspector__id-meta">
            <span>{t("nodeInspector.clientId")}: {shortNodeId(selected.id)}</span>
            <span>{t("nodeInspector.serverId")}: {shortNodeId(data.serverNodeId)}</span>
            <span>{t("nodeInspector.level")}: L{selectedMeta.level}</span>
          </div>
        </div>
        {imageSrc ? (
          <button
            type="button"
            className="node-inspector__preview node-inspector__preview--button"
            onClick={() => setLightboxOpen(true)}
            aria-label={t("nodeInspector.openImagePreview")}
            title={t("nodeInspector.openImagePreview")}
          >
            <img src={imageSrc} alt={t("node.nodeImageAlt")} />
          </button>
        ) : (
          <div className="node-inspector__preview node-inspector__preview--empty">
            <div className="node-inspector__placeholder">{t("node.noImage")}</div>
          </div>
        )}
        <div className="node-inspector__pills" aria-label={t("nodeInspector.statusMeta")}>
          {metaPills.map((pill) => (
            <span
              key={`${pill.label}-${pill.tone ?? "meta"}`}
              className={`node-inspector__pill${pill.tone ? ` node-inspector__pill--${pill.tone}` : ""}`}
            >
              {pill.label}
            </span>
          ))}
        </div>
        <label className="node-inspector__prompt-block">
          <span className="node-inspector__section-label">{t("nodeInspector.prompt")}</span>
          <textarea
            className="node-inspector__prompt"
            value={data.prompt}
            disabled={busy}
            onChange={(e) => updateNodePrompt(selected.id, e.target.value)}
            placeholder={hasParent ? t("node.editPromptPlaceholder") : t("node.promptPlaceholder")}
            rows={5}
          />
        </label>
        {data.error ? <div className="node-inspector__error">{data.error}</div> : null}
        {hasParent ? (
          <div className="node-inspector__actions node-inspector__actions--parent">
            <button
              type="button"
              className="node-inspector__button"
              onClick={() => copyParentSettingsToNode(selected.id)}
              disabled={busy}
            >
              {t("nodeInspector.copyParentSettings")}
            </button>
            <button
              type="button"
              className="node-inspector__button"
              onClick={() => copyParentPromptToNode(selected.id)}
              disabled={busy}
            >
              {t("nodeInspector.copyParentPrompt")}
            </button>
          </div>
        ) : null}
        <details className="node-inspector__settings" open>
          <summary className="node-inspector__settings-summary">
            <span>{t("nodeInspector.nodeSettings")}</span>
            <small>{settingsSummary}</small>
          </summary>
          <div className="node-inspector__settings-body">
            <OptionGroup<Quality>
              title={t("quality.title")}
              items={QUALITY_ITEMS}
              value={data.settings.quality}
              onChange={(quality) => updateNodeSettings(selected.id, { quality })}
            />
            <div className="option-group">
              <div className="section-title">{t("size.title")}</div>
              <OptionGroup<SizePreset>
                title=""
                items={sizeItems(SIZE_PRESETS_ROW1)}
                value={data.settings.sizePreset}
                onChange={(sizePreset) => updateNodeSettings(selected.id, { sizePreset })}
              />
              <OptionGroup<SizePreset>
                title=""
                items={sizeItems(SIZE_PRESETS_ROW2)}
                value={data.settings.sizePreset}
                onChange={(sizePreset) => updateNodeSettings(selected.id, { sizePreset })}
              />
              <OptionGroup<SizePreset>
                title=""
                items={sizeItems(SIZE_PRESETS_ROW3)}
                value={data.settings.sizePreset}
                onChange={(sizePreset) => updateNodeSettings(selected.id, { sizePreset })}
              />
              <OptionGroup<SizePreset>
                title=""
                items={sizeItems(SIZE_PRESETS_ROW4)}
                value={data.settings.sizePreset}
                onChange={(sizePreset) => updateNodeSettings(selected.id, { sizePreset })}
              />
              <OptionGroup<SizePreset>
                title=""
                items={sizeItems(getSizePresetsRow5())}
                value={data.settings.sizePreset}
                onChange={(sizePreset) => updateNodeSettings(selected.id, { sizePreset })}
              />
              {data.settings.sizePreset === "custom" ? (
                <>
                  <div className="option-row">
                    <input
                      type="number"
                      className="custom-size-input"
                      min={1024}
                      max={3824}
                      step={16}
                      value={data.settings.customW}
                      onChange={(e) =>
                        updateNodeSettings(selected.id, {
                          customW: snap16(parseInt(e.target.value) || 1024),
                        })
                      }
                      placeholder={t("size.width")}
                    />
                    <span className="node-inspector__size-separator">x</span>
                    <input
                      type="number"
                      className="custom-size-input"
                      min={1024}
                      max={3824}
                      step={16}
                      value={data.settings.customH}
                      onChange={(e) =>
                        updateNodeSettings(selected.id, {
                          customH: snap16(parseInt(e.target.value) || 1024),
                        })
                      }
                      placeholder={t("size.height")}
                    />
                  </div>
                  <div className="size-hint">{t("size.hint")}</div>
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
        <div className="node-inspector__action-panel">
          <button
            type="button"
            className="node-inspector__primary"
            onClick={() => void generateNode(selected.id)}
            disabled={!canGenerate}
          >
            {generateLabel}
          </button>
          <details
            className="node-inspector__api-preview"
            open={apiPreviewOpen}
            onToggle={(event) => setApiPreviewOpen(event.currentTarget.open)}
          >
            <summary className="node-inspector__api-preview-summary">
              <span>{t("nodeInspector.apiPreviewTitle")}</span>
              <small>{t("nodeInspector.apiPreviewHint")}</small>
            </summary>
            {clientPreview?.issues.length ? (
              <div className="node-inspector__api-preview-issues">
                {clientPreview.issues.map((issue) => (
                  <div key={issue.code} data-blocking={issue.blocking ? "true" : "false"}>
                    {issue.message}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="node-inspector__api-preview-label">
              {t("nodeInspector.apiPreviewClient")}
            </div>
            <pre className="node-inspector__api-preview-code">{clientPreviewJson}</pre>
            <div className="node-inspector__api-preview-label">
              {t("nodeInspector.apiPreviewServer")}
            </div>
            {serverPreview.loading ? (
              <div className="node-inspector__api-preview-status">
                {t("nodeInspector.apiPreviewLoading")}
              </div>
            ) : serverPreview.error ? (
              <div className="node-inspector__api-preview-status node-inspector__api-preview-status--error">
                {serverPreview.error}
              </div>
            ) : serverPreviewJson ? (
              <pre className="node-inspector__api-preview-code">{serverPreviewJson}</pre>
            ) : (
              <div className="node-inspector__api-preview-status">
                {apiPreviewHasBlockingIssue
                  ? t("nodeInspector.apiPreviewSkipped")
                  : t("nodeInspector.apiPreviewEmpty")}
              </div>
            )}
          </details>
          <div className="node-inspector__action-title">{t("nodeInspector.workflowActions")}</div>
          <div className="node-inspector__actions">
            <button
              type="button"
              className="node-inspector__button"
              onClick={() => void regenerateBranch(selected.id)}
              disabled={!canRegenerateBranch}
            >
              {t("node.regenerateBranch")}
            </button>
            <button type="button" className="node-inspector__button" onClick={() => addChildNode(selected.id)} disabled={!canBranch}>
              {t("node.addChild")}
            </button>
            <button type="button" className="node-inspector__button" onClick={() => duplicateBranchRoot(selected.id)}>
              {t("node.duplicateBranch")}
            </button>
            <button
              type="button"
              className="node-inspector__button"
              onClick={() => detachNodeFromParent(selected.id)}
              disabled={!hasParent}
            >
              {t("nodeInspector.detachConnection")}
            </button>
          </div>
          <div className="node-inspector__action-title">{t("nodeInspector.exportActions")}</div>
          <div className="node-inspector__actions">
            <button type="button" className="node-inspector__button" onClick={download} disabled={!imageSrc}>
              {t("result.download")}
            </button>
            <button type="button" className="node-inspector__button" onClick={() => void copyImage()} disabled={!imageSrc}>
              {t("result.copyImage")}
            </button>
            <button type="button" className="node-inspector__button" onClick={() => void copyPrompt()} disabled={!data.prompt}>
              {t("result.copyPrompt")}
            </button>
          </div>
          <button
            type="button"
            className="node-inspector__danger node-inspector__danger--wide"
            onClick={() => {
              deleteNode(selected.id);
              selectNode(null);
            }}
          >
            {t("common.delete")}
          </button>
        </div>
      </div>
      <ImageLightbox
        open={lightboxOpen && !!imageSrc}
        imageSrc={imageSrc}
        title={lightboxTitle}
        meta={lightboxMeta}
        onClose={() => setLightboxOpen(false)}
      />
    </>
  );
}
