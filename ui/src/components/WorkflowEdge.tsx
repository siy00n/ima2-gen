import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import {
  useAppStore,
  type EdgeTransferData,
  type GraphEdge,
} from "../store/useAppStore";
import { useI18n } from "../i18n";
import { useIsMobile } from "../hooks/useIsMobile";

function normalizeEdgeData(data: EdgeTransferData | undefined): EdgeTransferData {
  return {
    transferContext: data?.transferContext ?? true,
    transferSettings: data?.transferSettings ?? true,
  };
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
  const toggleEdgeTransfer = useAppStore((s) => s.toggleEdgeTransfer);
  const detachSelectedEdge = useAppStore((s) => s.detachSelectedEdge);
  const edgeData = normalizeEdgeData(data);
  const active = selected || selectedEdgeId === id;
  const edgeState =
    edgeData.transferContext && edgeData.transferSettings
      ? "both"
      : edgeData.transferContext
        ? "context"
        : edgeData.transferSettings
          ? "settings"
          : "image";
  const parent = nodes.find((n) => n.id === source);
  const child = nodes.find((n) => n.id === target);
  const parentLabel = parent?.data.prompt.trim() || parent?.data.serverNodeId?.slice(0, 8) || source;
  const childLabel = child?.data.prompt.trim() || child?.data.serverNodeId?.slice(0, 8) || target;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const toggle = (key: keyof EdgeTransferData, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    selectEdge(id);
    toggleEdgeTransfer(id, key);
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
          <span className="workflow-edge-badge__chip workflow-edge-badge__chip--image">
            {t("edgeBadge.image")}
          </span>
          <button
            type="button"
            className={`workflow-edge-badge__chip${edgeData.transferContext ? " is-on" : ""}`}
            onClick={(event) => toggle("transferContext", event)}
            title={t("edgeBadge.contextTitle")}
          >
            {t(edgeData.transferContext ? "edgeBadge.contextOn" : "edgeBadge.contextOff")}
          </button>
          <button
            type="button"
            className={`workflow-edge-badge__chip${edgeData.transferSettings ? " is-on" : ""}`}
            onClick={(event) => toggle("transferSettings", event)}
            title={t("edgeBadge.settingsTitle")}
          >
            {t(edgeData.transferSettings ? "edgeBadge.settingsOn" : "edgeBadge.settingsOff")}
          </button>
        </div>
        {active && !isMobile ? (
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
          </div>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
}

export const WorkflowEdge = memo(WorkflowEdgeImpl);
