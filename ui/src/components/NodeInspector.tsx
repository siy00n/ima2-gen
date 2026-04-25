import { useAppStore, type ImageNodeData } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { copyImageToClipboard, copyTextToClipboard } from "../lib/clipboard";
import { OptionGroup, type OptionItem } from "./OptionGroup";
import type { Format, Moderation, Quality, SizePreset } from "../types";
import {
  SIZE_PRESETS_ROW1,
  SIZE_PRESETS_ROW2,
  SIZE_PRESETS_ROW3,
  SIZE_PRESETS_ROW4,
  getSizePresetsRow5,
  snap16,
} from "../lib/size";

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

export function NodeInspector() {
  const { t } = useI18n();
  const nodes = useAppStore((s) => s.graphNodes);
  const edges = useAppStore((s) => s.graphEdges);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);
  const selectNode = useAppStore((s) => s.selectNode);
  const addRootNode = useAppStore((s) => s.addRootNode);
  const addChildNode = useAppStore((s) => s.addChildNode);
  const duplicateBranchRoot = useAppStore((s) => s.duplicateBranchRoot);
  const updateNodePrompt = useAppStore((s) => s.updateNodePrompt);
  const updateNodeSettings = useAppStore((s) => s.updateNodeSettings);
  const updateEdgeTransfer = useAppStore((s) => s.updateEdgeTransfer);
  const copyParentPromptToNode = useAppStore((s) => s.copyParentPromptToNode);
  const copyParentSettingsToNode = useAppStore((s) => s.copyParentSettingsToNode);
  const detachNodeFromParent = useAppStore((s) => s.detachNodeFromParent);
  const detachSelectedEdge = useAppStore((s) => s.detachSelectedEdge);
  const addChildFromSelectedEdge = useAppStore((s) => s.addChildFromSelectedEdge);
  const generateNode = useAppStore((s) => s.generateNode);
  const deleteNode = useAppStore((s) => s.deleteNode);
  const importCurrentImageAsNode = useAppStore((s) => s.importCurrentImageAsNode);
  const currentImage = useAppStore((s) => s.currentImage);
  const showToast = useAppStore((s) => s.showToast);

  const selected = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;
  const data = selected?.data;
  const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) : null;
  const edgeParent = selectedEdge ? nodes.find((n) => n.id === selectedEdge.source) : null;
  const edgeChild = selectedEdge ? nodes.find((n) => n.id === selectedEdge.target) : null;

  const importCurrent = () => {
    void importCurrentImageAsNode();
  };

  if (selectedEdge && edgeParent && edgeChild) {
    const edgeData = {
      transferContext: selectedEdge.data?.transferContext ?? true,
      transferSettings: selectedEdge.data?.transferSettings ?? true,
    };
    const edgeState =
      edgeData.transferContext && edgeData.transferSettings
        ? "both"
        : edgeData.transferContext
          ? "context"
          : edgeData.transferSettings
            ? "settings"
            : "image";
    return (
      <div className="node-inspector node-inspector--edge">
        <div className="section-title">{t("nodeInspector.connectionTitle")}</div>
        <div className="node-inspector__edge-state" data-state={edgeState}>
          <span className="node-inspector__edge-chip node-inspector__edge-chip--image">
            {t("edgeBadge.image")}
          </span>
          <span className={`node-inspector__edge-chip node-inspector__edge-chip--context${edgeData.transferContext ? " is-on" : ""}`}>
            {t(edgeData.transferContext ? "edgeBadge.contextOn" : "edgeBadge.contextOff")}
          </span>
          <span className={`node-inspector__edge-chip node-inspector__edge-chip--settings${edgeData.transferSettings ? " is-on" : ""}`}>
            {t(edgeData.transferSettings ? "edgeBadge.settingsOn" : "edgeBadge.settingsOff")}
          </span>
        </div>
        <div className="node-inspector__connection">
          <button type="button" onClick={() => selectNode(edgeParent.id)}>
            {t("nodeInspector.parentNode")}
            <span>{edgeParent.data.prompt || edgeParent.data.serverNodeId || edgeParent.id}</span>
          </button>
          <button type="button" onClick={() => selectNode(edgeChild.id)}>
            {t("nodeInspector.childNode")}
            <span>{edgeChild.data.prompt || edgeChild.data.serverNodeId || edgeChild.id}</span>
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
            disabled={edgeParent.data.status !== "ready" || !edgeParent.data.serverNodeId}
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
  const canBranch = data.status === "ready" && !!data.serverNodeId;
  const canGenerate = !busy && data.prompt.trim().length > 0;
  const imageSrc = data.imageUrl ?? null;
  const parent = selected ? nodes.find((n) => edges.some((e) => e.source === n.id && e.target === selected.id)) : null;
  const hasParent = !!parent;

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
      ? t("nodeInspector.createVariation")
      : data.status === "error" || data.status === "stale" || data.status === "asset-missing"
        ? t("node.retry")
        : t("node.generate");

  const meta = [
    data.status ? t("nodeInspector.statusValue", { value: data.status }) : null,
    data.elapsed != null ? `${data.elapsed}s` : null,
    data.quality ?? null,
    data.size ?? null,
    data.provider ?? null,
  ].filter((v): v is string => Boolean(v));

  return (
    <div className="node-inspector">
      <div className="section-title">{t("nodeInspector.title")}</div>
      <div className="node-inspector__preview">
        {imageSrc ? (
          <img src={imageSrc} alt={t("node.nodeImageAlt")} />
        ) : (
          <div className="node-inspector__placeholder">{t("node.noImage")}</div>
        )}
      </div>
      <textarea
        className="node-inspector__prompt"
        value={data.prompt}
        disabled={busy}
        onChange={(e) => updateNodePrompt(selected.id, e.target.value)}
        placeholder={data.parentServerNodeId ? t("node.editPromptPlaceholder") : t("node.promptPlaceholder")}
        rows={5}
      />
      {data.error ? <div className="node-inspector__error">{data.error}</div> : null}
      <div className="node-inspector__meta">{meta.join(" · ")}</div>
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
      <div className="node-inspector__settings">
        <div className="section-title">{t("nodeInspector.nodeSettings")}</div>
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
      <div className="node-inspector__actions">
        <button
          type="button"
          className="node-inspector__primary"
          onClick={() => void generateNode(selected.id)}
          disabled={!canGenerate}
        >
          {generateLabel}
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
        <button type="button" className="node-inspector__button" onClick={download} disabled={!imageSrc}>
          {t("result.download")}
        </button>
        <button type="button" className="node-inspector__button" onClick={() => void copyImage()} disabled={!imageSrc}>
          {t("result.copyImage")}
        </button>
        <button type="button" className="node-inspector__button" onClick={() => void copyPrompt()} disabled={!data.prompt}>
          {t("result.copyPrompt")}
        </button>
        <button
          type="button"
          className="node-inspector__danger"
          onClick={() => {
            deleteNode(selected.id);
            selectNode(null);
          }}
        >
          {t("common.delete")}
        </button>
      </div>
    </div>
  );
}
