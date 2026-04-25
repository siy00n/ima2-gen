import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import {
  getEdgeVisualState,
  normalizeEdgeTransferData,
  type ImageTransferMode,
  useAppStore,
  type GraphEdge,
} from "../store/useAppStore";
import { useI18n } from "../i18n";
import { useIsMobile } from "../hooks/useIsMobile";

const IMAGE_TRANSFER_OPTIONS: ImageTransferMode[] = ["off", "parent", "ancestor"];

function imageTransferLabelKey(mode: ImageTransferMode) {
  if (mode === "ancestor") return "edgeBadge.imageAncestor";
  if (mode === "off") return "edgeBadge.imageOff";
  return "edgeBadge.imageParent";
}

function WorkflowEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
  source,
  target,
}: EdgeProps<GraphEdge>) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const nodes = useAppStore((s) => s.graphNodes);
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);
  const selectEdge = useAppStore((s) => s.selectEdge);
  const updateEdgeTransfer = useAppStore((s) => s.updateEdgeTransfer);
  const setEdgeImageTransfer = useAppStore((s) => s.setEdgeImageTransfer);
  const cycleEdgeImageTransferQuiet = useAppStore((s) => s.cycleEdgeImageTransferQuiet);
  const toggleEdgeTransferQuiet = useAppStore((s) => s.toggleEdgeTransferQuiet);
  const detachSelectedEdge = useAppStore((s) => s.detachSelectedEdge);
  const edgeData = normalizeEdgeTransferData(data);
  const popoverOpen = selectedEdgeId === id;
  const active = selected || popoverOpen;
  const edgeState = getEdgeVisualState(edgeData);
  const parent = nodes.find((n) => n.id === source);
  const child = nodes.find((n) => n.id === target);
  const shortNodeId = (value: string | null | undefined) =>
    value ? value.replace(/^n_/, "").slice(0, 8) : "-";
  const parentLabel =
    parent?.data.name?.trim() ||
    (parent?.data.serverNodeId ? shortNodeId(parent.data.serverNodeId) : shortNodeId(source));
  const childLabel =
    child?.data.name?.trim() ||
    (child?.data.serverNodeId ? shortNodeId(child.data.serverNodeId) : shortNodeId(target));

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const toggle = (
    key: "transferContext" | "transferSettings",
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    toggleEdgeTransferQuiet(id, key);
  };

  const cycleImageTransfer = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    cycleEdgeImageTransferQuiet(id);
  };

  const select = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    selectEdge(id);
  };

  const selectWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectEdge(id);
  };

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={28}
        className={`workflow-edge__path workflow-edge__path--${edgeState}${active ? " workflow-edge__path--active" : ""}`}
      />
      <EdgeLabelRenderer>
        <div
          className={`workflow-edge-badge nodrag nopan${active ? " workflow-edge-badge--active" : ""}`}
          data-state={edgeState}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onClick={select}
          onKeyDown={selectWithKeyboard}
          role="button"
          tabIndex={0}
        >
          <button
            type="button"
            className={`workflow-edge-badge__chip workflow-edge-badge__chip--image${edgeData.imageTransfer !== "off" ? " is-on" : ""}`}
            data-image-transfer={edgeData.imageTransfer}
            onClick={cycleImageTransfer}
            title={t("edgeBadge.imageTitle")}
          >
            {t(imageTransferLabelKey(edgeData.imageTransfer))}
          </button>
          <button
            type="button"
            className={`workflow-edge-badge__chip workflow-edge-badge__chip--context${edgeData.transferContext ? " is-on" : ""}`}
            onClick={(event) => toggle("transferContext", event)}
            title={t("edgeBadge.contextTitle")}
          >
            {t("edgeBadge.context")}
          </button>
          <button
            type="button"
            className={`workflow-edge-badge__chip workflow-edge-badge__chip--settings${edgeData.transferSettings ? " is-on" : ""}`}
            onClick={(event) => toggle("transferSettings", event)}
            title={t("edgeBadge.settingsTitle")}
          >
            {t("edgeBadge.settings")}
          </button>
        </div>
        {popoverOpen && !isMobile ? (
          <div
            className="workflow-edge-popover nodrag nopan"
            style={{
              transform: `translate(-50%, calc(-100% - 18px)) translate(${labelX}px, ${labelY}px)`,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="workflow-edge-popover__header">
              <strong>{t("nodeInspector.connectionTitle")}</strong>
              <span>{parentLabel} -&gt; {childLabel}</span>
            </div>
            <p>{t("nodeInspector.connectionNotice")}</p>
            <label className="workflow-edge-popover__toggle">
              <span>{t("nodeInspector.transferContext")}</span>
              <input
                type="checkbox"
                checked={edgeData.transferContext}
                onChange={(event) =>
                  updateEdgeTransfer(id, { transferContext: event.target.checked })
                }
              />
            </label>
            <div className="workflow-edge-popover__field">
              <span>{t("nodeInspector.imageTransfer")}</span>
              <div className="workflow-edge-popover__segmented" role="group" aria-label={t("nodeInspector.imageTransfer")}>
                {IMAGE_TRANSFER_OPTIONS.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={edgeData.imageTransfer === mode ? "is-selected" : ""}
                    onClick={() => setEdgeImageTransfer(id, mode)}
                  >
                    {t(imageTransferLabelKey(mode))}
                  </button>
                ))}
              </div>
            </div>
            <label className="workflow-edge-popover__toggle">
              <span>{t("nodeInspector.transferSettings")}</span>
              <input
                type="checkbox"
                checked={edgeData.transferSettings}
                onChange={(event) =>
                  updateEdgeTransfer(id, { transferSettings: event.target.checked })
                }
              />
            </label>
            <div className="workflow-edge-popover__footer">
              <button
                type="button"
                className="workflow-edge-popover__danger"
                onClick={() => {
                  selectEdge(id);
                  detachSelectedEdge();
                }}
              >
                {t("nodeInspector.detachConnection")}
              </button>
              <button
                type="button"
                className="workflow-edge-popover__confirm"
                onClick={() => selectEdge(null)}
              >
                {t("common.ok")}
              </button>
            </div>
          </div>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
}

export const WorkflowEdge = memo(WorkflowEdgeImpl);
