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
}: EdgeProps<GraphEdge>) {
  const { t } = useI18n();
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);
  const selectEdge = useAppStore((s) => s.selectEdge);
  const toggleEdgeTransfer = useAppStore((s) => s.toggleEdgeTransfer);
  const edgeData = normalizeEdgeData(data);
  const active = selected || selectedEdgeId === id;

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

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={28}
        className={`workflow-edge__path${active ? " workflow-edge__path--active" : ""}`}
      />
      <EdgeLabelRenderer>
        <div
          className={`workflow-edge-badge nodrag nopan${active ? " workflow-edge-badge--active" : ""}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onClick={select}
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
      </EdgeLabelRenderer>
    </>
  );
}

export const WorkflowEdge = memo(WorkflowEdgeImpl);
