import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import {
  canAttachImageToNodeData,
  canUseNodeAsBranchParent,
  useAppStore,
  type ImageNodeData,
  type GraphNode,
} from "../store/useAppStore";
import { useI18n } from "../i18n";

function ImageNodeImpl({ id, data, selected }: NodeProps<GraphNode>) {
  const { t } = useI18n();
  const d = data as ImageNodeData;
  const updateNodePrompt = useAppStore((s) => s.updateNodePrompt);
  const generateNode = useAppStore((s) => s.generateNode);
  const cancelNodeGeneration = useAppStore((s) => s.cancelNodeGeneration);
  const addChildNode = useAppStore((s) => s.addChildNode);
  const duplicateBranchRoot = useAppStore((s) => s.duplicateBranchRoot);
  const deleteNode = useAppStore((s) => s.deleteNode);
  const attachImageToNode = useAppStore((s) => s.attachImageToNode);
  const hasParentEdge = useAppStore((s) => s.graphEdges.some((edge) => edge.target === id));
  const updateNodeInternals = useUpdateNodeInternals();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [attachingImage, setAttachingImage] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const onPromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => updateNodePrompt(id, e.target.value),
    [id, updateNodePrompt],
  );

  const onGenerate = useCallback(() => {
    if (d.status === "pending" || d.status === "reconciling") {
      void cancelNodeGeneration(id);
      return;
    }
    void generateNode(id);
  }, [id, d.status, generateNode, cancelNodeGeneration]);

  const onBranch = useCallback(() => {
    if (!canUseNodeAsBranchParent(d)) return;
    addChildNode(id);
  }, [id, d.status, addChildNode]);

  const onDuplicateBranch = useCallback(() => {
    duplicateBranchRoot(id);
  }, [id, duplicateBranchRoot]);

  const onDelete = useCallback(() => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteNode(id);
  }, [id, confirmDelete, deleteNode]);

  const isBusy = d.status === "pending" || d.status === "reconciling";
  const canBranch = canUseNodeAsBranchParent(d);
  const canAttachImage = canAttachImageToNodeData(d);
  const onAttachImage = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.currentTarget.files?.[0];
      e.currentTarget.value = "";
      if (!file) return;
      setAttachingImage(true);
      try {
        await attachImageToNode(id, file);
      } finally {
        setAttachingImage(false);
      }
    },
    [attachImageToNode, id],
  );
  const graphLevel = d.graphLevel ?? 0;
  const graphTreeColor = d.graphTreeColor ?? "#a78bfa";
  const nodeName = d.name?.trim() || t("node.untitledName");
  const settingsMeta = [
    d.provider ?? "OAuth",
    d.settings?.sizePreset === "custom"
      ? `${d.settings.customW}x${d.settings.customH}`
      : (d.size ?? d.settings?.sizePreset),
    d.settings?.quality ?? d.quality,
    d.settings?.format ?? d.format,
  ].filter((v): v is string => Boolean(v));

  const computeStatusLabel = (): string => {
    switch (d.status) {
      case "empty":
        return t("node.empty");
      case "pending":
        return t("node.pending");
      case "reconciling":
        return d.pendingPhase
          ? t("node.reconcilingPhase", { phase: d.pendingPhase })
          : t("node.reconciling");
      case "ready":
        if (d.assetSource === "upload") return t("node.attached");
        if (d.elapsed == null && !d.webSearchCalls) return t("node.readySimple");
        return d.webSearchCalls
          ? t("node.readyWithSearch", {
              elapsed: d.elapsed ?? "?",
              searches: d.webSearchCalls,
          })
          : t("node.ready", { elapsed: d.elapsed ?? "?" });
      case "canceled":
        return t("node.canceled");
      case "stale":
        return d.error
          ? t("node.staleWithError", { error: d.error })
          : t("node.stale");
      case "asset-missing":
        return d.error
          ? t("node.assetMissingWithError", { error: d.error })
          : t("node.assetMissing");
      case "error":
        return t("node.error", { error: d.error ?? t("node.errorUnknown") });
      default:
        return "";
    }
  };
  const statusLabel = computeStatusLabel();

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, updateNodeInternals, d.status, d.serverNodeId]);

  useEffect(() => {
    if (!selected) setConfirmDelete(false);
  }, [id, selected]);

  return (
    <div
      className={`image-node image-node--${d.status}${selected ? " image-node--selected" : ""}`}
      style={{ "--node-tree-color": graphTreeColor } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="image-node__handle" />
      <div className="image-node__header">
        <div className="image-node__title">
          <span className="image-node__level">L{graphLevel}</span>
          <span className="image-node__name">{nodeName}</span>
        </div>
        <div className="image-node__header-actions nodrag">
          <span className={`image-node__status-pill image-node__status-pill--${d.status}`}>
            {statusLabel}
          </span>
          <span className="image-node__menu">...</span>
        </div>
      </div>
      <div className="image-node__preview">
        {d.imageUrl && d.status !== "asset-missing" ? (
          <img src={d.imageUrl} alt={t("node.nodeImageAlt")} />
        ) : isBusy || d.status === "error" ? (
          <div className="image-node__skeleton">{statusLabel}</div>
        ) : d.status === "asset-missing" ? (
          <div className="image-node__placeholder">{t("node.noAsset")}</div>
        ) : d.status === "stale" ? (
          <div className="image-node__placeholder">{t("node.stateStale")}</div>
        ) : (
          <div className="image-node__placeholder">{t("node.noImage")}</div>
        )}
      </div>
      <div className="image-node__body">
        <textarea
          className="image-node__prompt nodrag"
          value={d.prompt}
          onChange={onPromptChange}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={hasParentEdge ? t("node.editPromptPlaceholder") : t("node.promptPlaceholder")}
          rows={1}
          disabled={isBusy}
        />
        <div className="image-node__meta">
          {settingsMeta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div className={`image-node__actions nodrag${canAttachImage ? " image-node__actions--with-attach" : ""}`}>
          <input
            ref={attachInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onAttachImage}
            className="image-node__file-input"
            aria-hidden="true"
            tabIndex={-1}
          />
          <button
            type="button"
            className={isBusy ? "image-node__cancel" : "image-node__primary"}
            onClick={onGenerate}
            disabled={isBusy ? !d.pendingRequestId : false}
          >
            {isBusy
              ? t("node.cancel")
              : d.status === "ready"
                ? t("node.regenerate")
                : t("node.generate")}
          </button>
          {canAttachImage ? (
            <button
              type="button"
              onClick={() => attachInputRef.current?.click()}
              disabled={attachingImage || isBusy}
              title={t("node.attachImageTitle")}
              aria-label={t("node.attachImage")}
            >
              {attachingImage ? "..." : t("node.attachImageShort")}
            </button>
          ) : null}
          <button type="button" onClick={onBranch} disabled={!canBranch} title={t("node.addChild")}>
            +
          </button>
          <button
            type="button"
            onClick={onDuplicateBranch}
            disabled={!canBranch}
            title={t("node.duplicateBranchTitle")}
          >
            D
          </button>
          <button
            type="button"
            onClick={onDelete}
            onBlur={() => setConfirmDelete(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setConfirmDelete(false);
            }}
            className={`image-node__del${confirmDelete ? " is-confirming" : ""}`}
            title={confirmDelete ? t("node.confirmDeleteTitle") : t("node.deleteTitle")}
            aria-label={confirmDelete ? t("node.confirmDeleteTitle") : t("node.deleteTitle")}
          >
            {confirmDelete ? t("node.confirmDeleteShort") : "×"}
          </button>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className={`image-node__handle image-node__handle--source${canBranch ? "" : " image-node__handle--disabled"}`}
        isConnectable={canBranch}
        aria-disabled={!canBranch}
      />
    </div>
  );
}

export const ImageNode = memo(ImageNodeImpl);
