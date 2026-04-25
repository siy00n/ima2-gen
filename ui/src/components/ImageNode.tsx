import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useAppStore, type ImageNodeData, type GraphNode } from "../store/useAppStore";
import { useI18n } from "../i18n";

function ImageNodeImpl({ id, data, selected }: NodeProps<GraphNode>) {
  const { t } = useI18n();
  const d = data as ImageNodeData;
  const updateNodePrompt = useAppStore((s) => s.updateNodePrompt);
  const generateNode = useAppStore((s) => s.generateNode);
  const addChildNode = useAppStore((s) => s.addChildNode);
  const duplicateBranchRoot = useAppStore((s) => s.duplicateBranchRoot);
  const deleteNode = useAppStore((s) => s.deleteNode);

  const onPromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => updateNodePrompt(id, e.target.value),
    [id, updateNodePrompt],
  );

  const onGenerate = useCallback(() => {
    void generateNode(id);
  }, [id, generateNode]);

  const onBranch = useCallback(() => {
    if (d.status !== "ready") return;
    addChildNode(id);
  }, [id, d.status, addChildNode]);

  const onDuplicateBranch = useCallback(() => {
    duplicateBranchRoot(id);
  }, [id, duplicateBranchRoot]);

  const onDelete = useCallback(() => deleteNode(id), [id, deleteNode]);

  const isBusy = d.status === "pending" || d.status === "reconciling";
  const canBranch = d.status === "ready" && !!d.serverNodeId;
  const shortId = (d.serverNodeId ?? id).replace(/^n_/, "").slice(0, 5);
  const graphLevel = d.graphLevel ?? 0;
  const graphIsolated = d.graphIsolated === true;
  const promptSummary = d.prompt.trim() || t("node.promptPlaceholder");
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
        return d.webSearchCalls
          ? t("node.readyWithSearch", {
              elapsed: d.elapsed ?? "?",
              searches: d.webSearchCalls,
            })
          : t("node.ready", { elapsed: d.elapsed ?? "?" });
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

  return (
    <div
      className={`image-node image-node--${d.status}${graphIsolated ? " image-node--isolated" : ""}${selected ? " image-node--selected" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="image-node__handle" />
      <div className="image-node__header">
        <div className="image-node__title">
          <span className="image-node__id">{shortId}</span>
          <span className="image-node__level">L{graphLevel}</span>
          <span className="image-node__name">{promptSummary}</span>
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
          placeholder={d.parentServerNodeId ? t("node.editPromptPlaceholder") : t("node.promptPlaceholder")}
          rows={1}
          disabled={isBusy}
        />
        <div className="image-node__meta">
          {settingsMeta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div className="image-node__actions nodrag">
          <button type="button" className="image-node__primary" onClick={onGenerate} disabled={isBusy}>
            {d.status === "ready" ? t("node.regenerate") : t("node.generate")}
          </button>
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
          <button type="button" onClick={onDelete} className="image-node__del" title={t("node.deleteTitle")}>
            ×
          </button>
        </div>
      </div>
      {d.status === "ready" && d.serverNodeId ? (
        <Handle type="source" position={Position.Right} className="image-node__handle image-node__handle--source" />
      ) : null}
    </div>
  );
}

export const ImageNode = memo(ImageNodeImpl);
