import { useMemo, useState, type PointerEvent, type WheelEvent } from "react";
import { Panel, useReactFlow, useStore, useViewport } from "@xyflow/react";
import type { GraphEdge, GraphNode } from "../store/useAppStore";
import type { GraphMetaMap } from "../lib/graphMeta";

type WorkflowMiniMapProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  graphMeta: GraphMetaMap;
};

type MiniNode = {
  node: GraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
};

const MAP_WIDTH = 220;
const MAP_HEIGHT = 148;
const MAP_PADDING = 14;
const FALLBACK_NODE_WIDTH = 282;
const FALLBACK_NODE_HEIGHT = 240;

function edgeState(edge: GraphEdge): "image" | "context" | "settings" | "both" {
  const transferContext = edge.data?.transferContext ?? true;
  const transferSettings = edge.data?.transferSettings ?? true;
  if (transferContext && transferSettings) return "both";
  if (transferContext) return "context";
  if (transferSettings) return "settings";
  return "image";
}

function edgeColor(state: ReturnType<typeof edgeState>) {
  if (state === "both") return "var(--edge-combined)";
  if (state === "context") return "var(--edge-context)";
  if (state === "settings") return "var(--edge-settings)";
  return "var(--edge-off)";
}

function nodeSize(node: GraphNode) {
  const measured = node.measured;
  return {
    width: measured?.width ?? node.width ?? FALLBACK_NODE_WIDTH,
    height: measured?.height ?? node.height ?? FALLBACK_NODE_HEIGHT,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function WorkflowMiniMap({ nodes, edges, graphMeta }: WorkflowMiniMapProps) {
  const viewport = useViewport();
  const flow = useReactFlow<GraphNode, GraphEdge>();
  const flowSize = useStore((s) => ({
    width: s.width,
    height: s.height,
    minZoom: s.minZoom,
    maxZoom: s.maxZoom,
  }));
  const [dragging, setDragging] = useState(false);

  const layout = useMemo(() => {
    const miniNodes: MiniNode[] = nodes.map((node) => {
      const size = nodeSize(node);
      return {
        node,
        x: node.position.x,
        y: node.position.y,
        width: size.width,
        height: size.height,
        cx: node.position.x + size.width / 2,
        cy: node.position.y + size.height / 2,
      };
    });

    if (miniNodes.length === 0) return null;

    const minX = Math.min(...miniNodes.map((node) => node.x));
    const minY = Math.min(...miniNodes.map((node) => node.y));
    const maxX = Math.max(...miniNodes.map((node) => node.x + node.width));
    const maxY = Math.max(...miniNodes.map((node) => node.y + node.height));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const scale = Math.min(
      (MAP_WIDTH - MAP_PADDING * 2) / width,
      (MAP_HEIGHT - MAP_PADDING * 2) / height,
    );
    const offsetX = (MAP_WIDTH - width * scale) / 2 - minX * scale;
    const offsetY = (MAP_HEIGHT - height * scale) / 2 - minY * scale;

    const toMiniX = (x: number) => x * scale + offsetX;
    const toMiniY = (y: number) => y * scale + offsetY;
    const fromMiniX = (x: number) => (x - offsetX) / scale;
    const fromMiniY = (y: number) => (y - offsetY) / scale;

    return {
      miniNodes,
      nodeById: new Map(miniNodes.map((node) => [node.node.id, node])),
      toMiniX,
      toMiniY,
      fromMiniX,
      fromMiniY,
      scale,
    };
  }, [nodes]);

  if (!layout) return null;

  const panToPointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, MAP_WIDTH);
    const y = clamp(event.clientY - rect.top, 0, MAP_HEIGHT);
    void flow.setCenter(layout.fromMiniX(x), layout.fromMiniY(y), {
      zoom: viewport.zoom,
      duration: 0,
    });
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    panToPointer(event);
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    event.preventDefault();
    panToPointer(event);
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const factor = event.deltaY < 0 ? 1.12 : 0.88;
    const nextZoom = clamp(viewport.zoom * factor, flowSize.minZoom, flowSize.maxZoom);
    void flow.zoomTo(nextZoom, { duration: 0 });
  };

  const viewportRect =
    flowSize.width > 0 && flowSize.height > 0 && viewport.zoom > 0
      ? {
          x: layout.toMiniX(-viewport.x / viewport.zoom),
          y: layout.toMiniY(-viewport.y / viewport.zoom),
          width: (flowSize.width / viewport.zoom) * layout.scale,
          height: (flowSize.height / viewport.zoom) * layout.scale,
        }
      : null;

  return (
    <Panel position="bottom-right" className="workflow-minimap-panel">
      <svg
        className={`workflow-minimap${dragging ? " workflow-minimap--dragging" : ""}`}
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        role="img"
        aria-label="Workflow mini map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <rect className="workflow-minimap__bg" x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} rx="10" />
        <g className="workflow-minimap__edges">
          {edges.map((edge) => {
            const source = layout.nodeById.get(edge.source);
            const target = layout.nodeById.get(edge.target);
            if (!source || !target) return null;
            const state = edgeState(edge);
            return (
              <line
                key={edge.id}
                className="workflow-minimap__edge"
                data-state={state}
                x1={layout.toMiniX(source.cx)}
                y1={layout.toMiniY(source.cy)}
                x2={layout.toMiniX(target.cx)}
                y2={layout.toMiniY(target.cy)}
                stroke={edgeColor(state)}
              />
            );
          })}
        </g>
        <g className="workflow-minimap__nodes">
          {layout.miniNodes.map((miniNode) => {
            const meta = graphMeta.get(miniNode.node.id) ?? { level: 0, isolated: true };
            const width = Math.max(8, miniNode.width * layout.scale);
            const height = Math.max(6, miniNode.height * layout.scale);
            const x = layout.toMiniX(miniNode.x);
            const y = layout.toMiniY(miniNode.y);
            return (
              <g
                key={miniNode.node.id}
                className={`workflow-minimap__node${meta.isolated ? " workflow-minimap__node--isolated" : ""}`}
              >
                <rect x={x} y={y} width={width} height={height} rx="3" />
                {width >= 24 && height >= 14 ? (
                  <text x={x + 4} y={y + 11}>
                    L{meta.level}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
        {viewportRect ? (
          <rect
            className="workflow-minimap__viewport"
            x={viewportRect.x}
            y={viewportRect.y}
            width={viewportRect.width}
            height={viewportRect.height}
            rx="3"
          />
        ) : null}
      </svg>
    </Panel>
  );
}
