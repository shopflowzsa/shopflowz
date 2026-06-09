/**
 * Visual sticker layout editor.
 *
 * Renders an SVG mock of the paper as it'll come out of the printer (top-down)
 * with draggable handles for:
 *   - Top start (where the first row begins)
 *   - Bottom end (where printing stops before the cut)
 *   - For each column: left edge + right edge
 *
 * All values are stored in mm on the form's stickerLayout. The editor is
 * intentionally simple: drag handles, see live mm readouts, no precision
 * snapping — staff calibrates by eye against a real test print.
 */

import { useEffect, useRef, useState } from "react";
import type { FormDefinition } from "@/types/crm";

const DOTS_PER_MM = 8; // print resolution — only used for nominal paper width
const PAPER_WIDTH_MM_80 = 72; // usable print width on an 80mm head
const PAPER_WIDTH_MM_58 = 48;

interface Props {
  layout: NonNullable<FormDefinition["stickerLayout"]>;
  onChange: (patch: Partial<NonNullable<FormDefinition["stickerLayout"]>>) => void;
}

type DragKind =
  | { kind: "top" }
  | { kind: "bottom" }
  | { kind: "colLeft"; column: number }
  | { kind: "colRight"; column: number }
  | { kind: "rowGap" }
  | { kind: "rowOffset"; row: number }; // drag individual row vertically

export function StickerLayoutEditor({ layout, onChange }: Props) {
  const paperWidthMm = layout.paperWidth === "58mm" ? PAPER_WIDTH_MM_58 : PAPER_WIDTH_MM_80;
  const columns = Math.max(1, Math.min(4, layout.columns || 1));
  const rows = Math.max(1, Math.min(4, layout.rows || 1));
  const stickerHeightMm = layout.stickerHeightMm ?? 20;
  const rowGapMm = layout.rowGapMm ?? 3;
  const topStartMm = layout.topStartMm ?? 0;
  const bottomEndMm = layout.bottomEndMm ?? 0;

  // Sensible default bounds if none stored: evenly distribute columns
  const initialBounds = (() => {
    if (layout.columnBoundsMm && layout.columnBoundsMm.length === columns) {
      return layout.columnBoundsMm;
    }
    const widthEach = layout.stickerWidthMm ?? 30;
    const gap = layout.columnGapMm ?? 2;
    const off = layout.horizontalOffsetMm ?? 0;
    return Array.from({ length: columns }, (_, i) => {
      const left = off + i * (widthEach + gap);
      return { leftMm: left, rightMm: left + widthEach };
    });
  })();

  // Local bounds for drag preview (committed on mouseup)
  const [bounds, setBounds] = useState(initialBounds);
  useEffect(() => {
    if (!layout.columnBoundsMm) return;
    setBounds(layout.columnBoundsMm);
  }, [layout.columnBoundsMm, columns]);

  // Container dimensions
  const totalHeightMm = topStartMm + rows * stickerHeightMm + (rows - 1) * rowGapMm + bottomEndMm + 4;
  const PX_PER_MM = 4; // editor zoom
  const widthPx = paperWidthMm * PX_PER_MM;
  const heightPx = totalHeightMm * PX_PER_MM;

  // ── Drag state ──
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragKind | null>(null);

  const mmFromClient = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { xMm: 0, yMm: 0 };
    return {
      xMm: Math.max(0, Math.min(paperWidthMm, (clientX - rect.left) / PX_PER_MM)),
      yMm: Math.max(0, (clientY - rect.top) / PX_PER_MM),
    };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { xMm, yMm } = mmFromClient(e.clientX, e.clientY);

    if (drag.kind === "top") {
      onChange({ topStartMm: Math.round(yMm * 10) / 10 });
    } else if (drag.kind === "bottom") {
      const maxContent = topStartMm + rows * stickerHeightMm + (rows - 1) * rowGapMm;
      onChange({ bottomEndMm: Math.max(0, Math.round((yMm - maxContent) * 10) / 10) });
    } else if (drag.kind === "rowGap" && rows > 1) {
      // distance between row 1's bottom and row 2's top
      const row1Bottom = topStartMm + stickerHeightMm;
      onChange({ rowGapMm: Math.max(0, Math.round((yMm - row1Bottom) * 10) / 10) });
    } else if (drag.kind === "rowOffset") {
      const r = drag.row;
      // Base Y for this row if no offset
      const baseY = topStartMm + r * (stickerHeightMm + rowGapMm);
      const offsetMm = Math.round((yMm - baseY) * 10) / 10;
      const offsets = [...(layout.rowOffsetsMm || [])];
      while (offsets.length <= r) offsets.push(0);
      offsets[r] = Math.max(-stickerHeightMm, Math.min(stickerHeightMm, offsetMm));
      onChange({ rowOffsetsMm: offsets });
    } else if (drag.kind === "colLeft") {
      const cur = bounds[drag.column];
      const next = bounds.map((b, i) => i === drag.column ? { ...b, leftMm: Math.min(Math.round(xMm * 10) / 10, cur.rightMm - 5) } : b);
      setBounds(next);
      onChange({ columnBoundsMm: next });
    } else if (drag.kind === "colRight") {
      const cur = bounds[drag.column];
      const next = bounds.map((b, i) => i === drag.column ? { ...b, rightMm: Math.max(Math.round(xMm * 10) / 10, cur.leftMm + 5) } : b);
      setBounds(next);
      onChange({ columnBoundsMm: next });
    }
  };

  const startDrag = (kind: DragKind) => (e: React.PointerEvent<SVGRectElement | SVGLineElement | SVGCircleElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = kind;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    try { (e.target as Element).releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    dragRef.current = null;
  };

  // ── Render helpers ──
  const HANDLE_R = 6;
  const rowOffsets = layout.rowOffsetsMm || [];
  const rowYFor = (r: number) =>
    (topStartMm + r * (stickerHeightMm + rowGapMm) + (rowOffsets[r] || 0)) * PX_PER_MM;

  const renderColumn = (c: number, b: { leftMm: number; rightMm: number }) => {
    const leftX = b.leftMm * PX_PER_MM;
    const rightX = b.rightMm * PX_PER_MM;
    const rowYs = Array.from({ length: rows }, (_, r) => rowYFor(r));
    return (
      <g key={c}>
        {/* Sticker rectangles — each row independently positioned */}
        {rowYs.map((y, r) => (
          <rect
            key={r}
            x={leftX}
            y={y}
            width={rightX - leftX}
            height={stickerHeightMm * PX_PER_MM}
            fill="rgba(245, 158, 11, 0.15)"
            stroke="rgb(217, 119, 6)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            style={{ cursor: "grab" }}
            onPointerDown={startDrag({ kind: "rowOffset", row: r })}
          />
        ))}

        {/* Per-row left/right edge handles — independent per row so each
            sticker on a row can be aligned to its own die */}
        {rowYs.map((y, r) => (
          <g key={`handles-${r}`}>
            <line
              x1={leftX} x2={leftX}
              y1={y} y2={y + stickerHeightMm * PX_PER_MM}
              stroke="rgb(8, 145, 178)" strokeWidth="2"
              style={{ cursor: "ew-resize" }}
              onPointerDown={startDrag({ kind: "colLeft", column: c })}
            />
            <circle
              cx={leftX} cy={y + (stickerHeightMm * PX_PER_MM) / 2}
              r={HANDLE_R} fill="rgb(8, 145, 178)"
              style={{ cursor: "ew-resize" }}
              onPointerDown={startDrag({ kind: "colLeft", column: c })}
            />
            <line
              x1={rightX} x2={rightX}
              y1={y} y2={y + stickerHeightMm * PX_PER_MM}
              stroke="rgb(190, 24, 93)" strokeWidth="2"
              style={{ cursor: "ew-resize" }}
              onPointerDown={startDrag({ kind: "colRight", column: c })}
            />
            <circle
              cx={rightX} cy={y + (stickerHeightMm * PX_PER_MM) / 2}
              r={HANDLE_R} fill="rgb(190, 24, 93)"
              style={{ cursor: "ew-resize" }}
              onPointerDown={startDrag({ kind: "colRight", column: c })}
            />
            {/* Row up/down nudge handle (small badge in top-left corner) */}
            <rect
              x={leftX + 2} y={y + 2}
              width={28} height={14}
              rx={3}
              fill="rgba(168, 85, 247, 0.85)"
              style={{ cursor: "ns-resize" }}
              onPointerDown={startDrag({ kind: "rowOffset", row: r })}
            />
            <text
              x={leftX + 16} y={y + 13}
              textAnchor="middle" fontSize="9"
              fill="#fff" fontWeight="700"
              pointerEvents="none"
            >
              R{r + 1} ↕
            </text>
          </g>
        ))}

        {/* Column label centred on first row */}
        <text
          x={(leftX + rightX) / 2}
          y={rowYs[0] + (stickerHeightMm * PX_PER_MM) / 2 + 4}
          textAnchor="middle"
          fontSize="11"
          fill="rgb(120, 53, 15)"
          fontWeight="700"
        >
          Col {c + 1}
        </text>
        <text
          x={leftX} y={(topStartMm - 1) * PX_PER_MM}
          textAnchor="middle" fontSize="9" fill="rgb(8, 145, 178)"
        >
          {b.leftMm.toFixed(1)}mm
        </text>
        <text
          x={rightX} y={(topStartMm - 1) * PX_PER_MM}
          textAnchor="middle" fontSize="9" fill="rgb(190, 24, 93)"
        >
          {b.rightMm.toFixed(1)}mm
        </text>
        {/* Per-row offset readouts */}
        {rowOffsets.map((off, r) =>
          off ? (
            <text
              key={`ro-${r}`}
              x={rightX + 4}
              y={rowYs[r] + (stickerHeightMm * PX_PER_MM) / 2 + 3}
              fontSize="9" fill="rgb(126, 34, 206)"
            >
              R{r + 1} {off > 0 ? "+" : ""}{off.toFixed(1)}mm
            </text>
          ) : null
        )}
      </g>
    );
  };

  const topY = topStartMm * PX_PER_MM;
  // Bottom = last row's bottom edge + offset for that row + bottomEndMm
  const lastRowIdx = rows - 1;
  const lastRowOffset = rowOffsets[lastRowIdx] || 0;
  const bottomY = ((topStartMm + rows * stickerHeightMm + (rows - 1) * rowGapMm) + lastRowOffset + bottomEndMm) * PX_PER_MM;
  const row1BottomY = (topStartMm + stickerHeightMm + (rowOffsets[0] || 0)) * PX_PER_MM;
  const row2TopY = (topStartMm + stickerHeightMm + rowGapMm + (rowOffsets[1] || 0)) * PX_PER_MM;

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Visual layout editor — drag handles to align ({rows}×{columns} grid)
      </div>
      <div className="overflow-auto border border-gray-300 bg-gray-50" style={{ maxHeight: 420 }}>
        <svg
          ref={svgRef}
          width={widthPx + 40}
          height={heightPx + 20}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          style={{ display: "block" }}
        >
          {/* Paper background */}
          <rect x={20} y={10} width={widthPx} height={heightPx} fill="#fff" stroke="#ccc" />

          <g transform={`translate(20, 10)`}>
            {/* Top start handle (horizontal line) */}
            <line
              x1={0} x2={widthPx} y1={topY} y2={topY}
              stroke="rgb(34, 197, 94)" strokeWidth="2"
              style={{ cursor: "ns-resize" }}
              onPointerDown={startDrag({ kind: "top" })}
            />
            <circle
              cx={widthPx / 2} cy={topY} r={HANDLE_R}
              fill="rgb(34, 197, 94)"
              style={{ cursor: "ns-resize" }}
              onPointerDown={startDrag({ kind: "top" })}
            />
            <text x={4} y={topY - 3} fontSize="9" fill="rgb(22, 101, 52)">
              Top start: {topStartMm.toFixed(1)}mm
            </text>

            {/* Row gap handle (if 2+ rows) */}
            {rows > 1 && (
              <>
                <rect
                  x={0} y={row1BottomY} width={widthPx} height={row2TopY - row1BottomY}
                  fill="rgba(168, 85, 247, 0.15)"
                  stroke="rgb(168, 85, 247)" strokeWidth="1" strokeDasharray="3 2"
                  style={{ cursor: "ns-resize" }}
                  onPointerDown={startDrag({ kind: "rowGap" })}
                />
                <text
                  x={widthPx / 2} y={(row1BottomY + row2TopY) / 2 + 3}
                  textAnchor="middle" fontSize="10" fill="rgb(126, 34, 206)" fontWeight="600"
                >
                  Row gap: {rowGapMm.toFixed(1)}mm
                </text>
              </>
            )}

            {/* Render each column's stickers + handles */}
            {bounds.map((b, c) => renderColumn(c, b))}

            {/* Bottom end handle */}
            <line
              x1={0} x2={widthPx} y1={bottomY} y2={bottomY}
              stroke="rgb(239, 68, 68)" strokeWidth="2"
              style={{ cursor: "ns-resize" }}
              onPointerDown={startDrag({ kind: "bottom" })}
            />
            <circle
              cx={widthPx / 2} cy={bottomY} r={HANDLE_R}
              fill="rgb(239, 68, 68)"
              style={{ cursor: "ns-resize" }}
              onPointerDown={startDrag({ kind: "bottom" })}
            />
            <text x={4} y={bottomY + 12} fontSize="9" fill="rgb(153, 27, 27)">
              Bottom feed: {bottomEndMm.toFixed(1)}mm
            </text>
          </g>
        </svg>
      </div>
      <div className="text-[10px] text-muted-foreground italic max-w-[480px] text-center">
        Green = top · Red = bottom feed · Cyan = column left · Pink = column right · Purple band = row gap · Purple R# badge = drag that row up/down independently. Each row can be nudged on its own when die-cuts aren't evenly spaced.
      </div>
    </div>
  );
}
