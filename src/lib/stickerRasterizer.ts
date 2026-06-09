/**
 * Sticker Rasterizer
 *
 * Renders one or more stickers onto an off-screen canvas, then converts the
 * canvas to a 1-bit-per-pixel monochrome bitmap suitable for the ESC/POS
 * GS v 0 raster image command. This is what makes side-by-side dual-sticker
 * rolls possible — receipt printers can't print two text columns natively,
 * so we paint pixels.
 *
 * Coordinate system: width/height are calculated from physical mm values on
 * the form's stickerLayout. We use 203 DPI (8 dots/mm), the standard for
 * 80mm Xprinter / Epson-clone receipt printers.
 */

import JsBarcode from "jsbarcode";
import type { FormDefinition, StickerLine, StickerRowStyle, StickerRowSize, StickerSegment } from "@/types/crm";

const DOTS_PER_MM = 8; // 203 DPI
const PAPER_WIDTH_DOTS_80MM = 576;
const PAPER_WIDTH_DOTS_58MM = 384;

const DEFAULT_ROW_STYLE: Record<string, StickerRowStyle> = {
  jobNumber:    { align: "center", size: "huge",   bold: true },
  customerName: { align: "center", size: "large",  bold: true },
  date:         { align: "center", size: "normal", bold: false },
  extras:       { align: "left",   size: "normal", bold: false },
  footer:       { align: "center", size: "small",  bold: false },
};

function styleFor(layout: FormDefinition["stickerLayout"] | undefined, key: keyof typeof DEFAULT_ROW_STYLE): StickerRowStyle {
  return { ...DEFAULT_ROW_STYLE[key], ...(layout?.[key] || {}) };
}

const SIZE_TO_PX: Record<StickerRowSize, number> = {
  small: 16,
  normal: 22,
  large: 32,
  huge: 56,
};

export interface RasterStickerData {
  jobNumber: string;
  customerName?: string;
  dateLabel?: string;
  extras?: Array<{ label: string; value: string }>;
  footer?: string;
  // Optional: needed when form uses the new line/segment model so custom-field
  // segments can resolve by ID. Each entry: { id, name } from the workspace.
  allFields?: Array<{ id: string; name: string }>;
}

// ── Line/segment model helpers ──────────────────────────────────────────────
function resolveSegmentText(
  seg: StickerSegment,
  data: RasterStickerData,
  customFields: Array<{ id: string; name: string }>,
): string {
  let raw = "";
  switch (seg.source) {
    case "jobNumber":
      raw = data.jobNumber || "";
      break;
    case "customField":
      if (seg.customFieldId) {
        // The caller passed extras already resolved by label; rebuild lookup
        // from the original task customFields if available — but here we only
        // have label/value pairs in data.extras. Try matching by ID via the
        // custom-fields list, falling back to a label match.
        const cf = customFields.find(f => f.id === seg.customFieldId);
        if (cf) {
          const match = data.extras?.find(e => e.label === cf.name);
          raw = match?.value || "";
        }
      }
      break;
    case "date":
      raw = data.dateLabel || "";
      break;
    case "static":
      raw = seg.staticText || "";
      break;
    case "barcode":
    case "qr":
    case "blank":
      raw = "";
      break;
  }
  if (seg.prefix && raw) return `${seg.prefix} ${raw}`;
  return raw;
}

function renderLineSegments(
  ctx: CanvasRenderingContext2D,
  segments: StickerSegment[],
  originX: number,
  y: number,
  widthDots: number,
  data: RasterStickerData,
  customFields: Array<{ id: string; name: string }>,
): number {
  // Equal width split
  const segCount = Math.max(1, Math.min(3, segments.length));
  const segWidth = widthDots / segCount;

  let maxHeight = 0;
  for (let i = 0; i < segCount; i++) {
    const seg = segments[i];
    if (!seg) continue;

    const segOriginX = originX + i * segWidth;

    // Barcode / QR — render special graphics
    if (seg.source === "barcode" && data.jobNumber) {
      const off = document.createElement("canvas");
      try {
        JsBarcode(off, data.jobNumber, {
          format: "CODE128",
          width: 1.4,
          height: 30,
          displayValue: true,
          fontSize: 12,
          margin: 0,
          background: "#fff",
        });
        const bx = segOriginX + segWidth / 2 - off.width / 2;
        ctx.drawImage(off, bx, y);
        maxHeight = Math.max(maxHeight, off.height);
      } catch {
        // skip
      }
      continue;
    }
    if (seg.source === "qr") {
      // QR via canvas is heavier — leave a placeholder text; printer-side QR
      // is only available in single-segment mode (jobNumber QR). For multi-
      // segment lines, fall back to text representation.
      continue;
    }
    if (seg.source === "blank") continue;

    const text = resolveSegmentText(seg, data, customFields);
    if (!text) continue;

    const sizePx = SIZE_TO_PX[seg.size || "normal"];
    const weight = seg.bold ? "800" : "400";
    ctx.font = `${weight} ${sizePx}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = "#000";
    ctx.textBaseline = "top";

    const metrics = ctx.measureText(text);
    let tx: number;
    if (seg.align === "right") tx = segOriginX + segWidth - 4 - metrics.width;
    else if (seg.align === "left") tx = segOriginX + 4;
    else tx = segOriginX + segWidth / 2 - metrics.width / 2;

    ctx.fillText(text, tx, y);
    maxHeight = Math.max(maxHeight, sizePx);
  }
  return maxHeight;
}

/**
 * Render a sticker using the new LINE/SEGMENT model (when form.stickerUseLines).
 * Clips to the cell rectangle.
 */
function renderOneStickerLines(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  widthDots: number,
  form: FormDefinition,
  data: RasterStickerData,
  heightDots: number,
  customFields: Array<{ id: string; name: string }>,
): void {
  const layout = form.stickerLayout || {};
  const paddingTop = (layout.verticalPaddingMm ?? 1) * DOTS_PER_MM;
  const rowSpacing = Math.max(0, Math.min(10, (layout.rowSpacing ?? 0) * 6));

  ctx.save();
  ctx.beginPath();
  ctx.rect(originX, originY, widthDots, heightDots);
  ctx.clip();

  let y = originY + paddingTop;
  const lines = (form.stickerLines || []).slice(0, 6);
  for (const line of lines) {
    if (!line.segments || line.segments.length === 0) continue;
    const lineHeight = renderLineSegments(ctx, line.segments, originX, y, widthDots, data, customFields);
    y += lineHeight + 4 + rowSpacing;
  }

  ctx.restore();
}

/**
 * Render a single sticker into a context starting at (originX, originY).
 * Clips to the cell so content doesn't bleed across die-cut seams.
 * Returns the height in pixels actually used.
 */
function renderOneSticker(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  widthDots: number,
  form: FormDefinition,
  data: RasterStickerData,
  heightDots?: number,
): number {
  const layout = form.stickerLayout || {};
  const paddingTop = (layout.verticalPaddingMm ?? 1) * DOTS_PER_MM;
  const stickerH = heightDots ?? Math.round((layout.stickerHeightMm || 20) * DOTS_PER_MM);

  // Clip drawing to this cell so a too-large sticker can't paint over its
  // neighbours.
  ctx.save();
  ctx.beginPath();
  ctx.rect(originX, originY, widthDots, stickerH);
  ctx.clip();

  let y = originY + paddingTop;
  const rowSpacing = Math.max(0, Math.min(10, (layout.rowSpacing ?? 0) * 6));

  ctx.fillStyle = "#000";

  const drawRow = (text: string, style: StickerRowStyle) => {
    if (!text) return;
    const size = SIZE_TO_PX[style.size || "normal"];
    const weight = style.bold ? "800" : "400";
    ctx.font = `${weight} ${size}px "Helvetica Neue", Arial, sans-serif`;
    const metrics = ctx.measureText(text);
    let x: number;
    if (style.align === "left") x = originX + 8;
    else if (style.align === "right") x = originX + widthDots - 8 - metrics.width;
    else x = originX + widthDots / 2 - metrics.width / 2;
    ctx.textBaseline = "top";
    ctx.fillText(text, x, y);
    y += size + 4 + rowSpacing;
  };

  // Job number
  if (form.stickerShowJobNumber !== false && data.jobNumber) {
    drawRow(data.jobNumber, styleFor(layout, "jobNumber"));
  }

  // Customer name
  if (form.stickerShowCustomerName && data.customerName) {
    drawRow(data.customerName, styleFor(layout, "customerName"));
  }

  // Date
  if (form.stickerShowDate && data.dateLabel) {
    drawRow(`Received: ${data.dateLabel}`, styleFor(layout, "date"));
  }

  // Extras
  if (data.extras && data.extras.length > 0) {
    const extrasStyle = styleFor(layout, "extras");
    const size = SIZE_TO_PX[extrasStyle.size || "normal"];
    for (const ex of data.extras) {
      if (!ex.value) continue;
      // "Label: value" — bold label + normal value on the same line
      ctx.font = `800 ${size}px "Helvetica Neue", Arial, sans-serif`;
      const labelText = `${ex.label}: `;
      const labelW = ctx.measureText(labelText).width;
      ctx.font = `400 ${size}px "Helvetica Neue", Arial, sans-serif`;
      const valueW = ctx.measureText(ex.value).width;
      const totalW = labelW + valueW;
      let x: number;
      if (extrasStyle.align === "right") x = originX + widthDots - 8 - totalW;
      else if (extrasStyle.align === "center") x = originX + widthDots / 2 - totalW / 2;
      else x = originX + 8;
      ctx.textBaseline = "top";
      ctx.font = `800 ${size}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(labelText, x, y);
      ctx.font = `400 ${size}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(ex.value, x + labelW, y);
      y += size + 4;
    }
    y += rowSpacing;
  }

  // Barcode
  if (form.stickerShowBarcode && data.jobNumber) {
    const off = document.createElement("canvas");
    try {
      JsBarcode(off, data.jobNumber, {
        format: "CODE128",
        width: 1.6,
        height: 36,
        displayValue: true,
        fontSize: 14,
        margin: 0,
        background: "#fff",
      });
      const bx = originX + widthDots / 2 - off.width / 2;
      ctx.drawImage(off, bx, y);
      y += off.height + 4 + rowSpacing;
    } catch {
      // skip on render error
    }
  }

  // Footer
  if (data.footer) {
    drawRow(data.footer, styleFor(layout, "footer"));
  }

  ctx.restore();
  return y - originY;
}

/**
 * Resolve per-column bounds from the layout. If saved columnBoundsMm exists,
 * use it. Otherwise fall back to the legacy single-width fields so old forms
 * still print.
 */
function resolveColumnBounds(layout: NonNullable<FormDefinition["stickerLayout"]>): Array<{ leftMm: number; rightMm: number }> {
  const columns = Math.max(1, Math.min(4, layout.columns || 1));
  const saved = layout.columnBoundsMm;
  if (saved && saved.length >= columns) return saved.slice(0, columns);

  // Legacy fallback: derive from stickerWidthMm + columnGapMm + horizontalOffsetMm
  const w = layout.stickerWidthMm || 30;
  const gap = layout.columnGapMm ?? 2;
  const off = layout.horizontalOffsetMm ?? 0;
  const bounds: Array<{ leftMm: number; rightMm: number }> = [];
  for (let i = 0; i < columns; i++) {
    const left = off + i * (w + gap);
    bounds.push({ leftMm: left, rightMm: left + w });
  }
  return bounds;
}

/**
 * Build the full sticker raster (handles N columns × M rows in a grid).
 * Each cell prints the same content. Per-column horizontal bounds let staff
 * fine-tune so each column lands on its die-cut even when the printer isn't
 * perfectly centred on the roll.
 */
export function renderStickerRaster(
  form: FormDefinition,
  data: RasterStickerData,
): { canvas: HTMLCanvasElement; widthDots: number } {
  const layout = form.stickerLayout || {};
  const paperWidthDots = layout.paperWidth === "58mm" ? PAPER_WIDTH_DOTS_58MM : PAPER_WIDTH_DOTS_80MM;
  const columns = Math.max(1, Math.min(4, layout.columns || 1));
  const rows = Math.max(1, Math.min(4, layout.rows || 1));
  const stickerHeightMm = layout.stickerHeightMm || 20;
  const rowGapMm = layout.rowGapMm ?? 3;
  const topStartMm = layout.topStartMm ?? 0;
  const bottomEndMm = layout.bottomEndMm ?? 0;

  const bounds = resolveColumnBounds(layout);

  const stickerHeightDots = Math.round(stickerHeightMm * DOTS_PER_MM);
  const rowGapDots = Math.round(rowGapMm * DOTS_PER_MM);
  const topStartDots = Math.round(topStartMm * DOTS_PER_MM);
  const bottomEndDots = Math.round(bottomEndMm * DOTS_PER_MM);

  // Image width: widest right edge across all columns, clamped to paper width.
  const maxRightMm = bounds.reduce((m, b) => Math.max(m, b.rightMm), 0);
  let totalWidth = Math.min(paperWidthDots, Math.round(maxRightMm * DOTS_PER_MM));
  totalWidth = Math.max(8, Math.ceil(totalWidth / 8) * 8);

  // Per-row vertical offset (mm). Used when row 2 needs to be nudged
  // independently to align with its die-cut on rolls where rows aren't
  // perfectly evenly spaced.
  const rowOffsets = layout.rowOffsetsMm || [];

  const totalHeight =
    topStartDots +
    rows * stickerHeightDots +
    (rows - 1) * rowGapDots +
    Math.round(Math.max(0, ...rowOffsets) * DOTS_PER_MM) +
    bottomEndDots;

  const canvas = document.createElement("canvas");
  canvas.width = totalWidth;
  canvas.height = Math.max(1, totalHeight);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  for (let r = 0; r < rows; r++) {
    const baseOy = topStartDots + r * (stickerHeightDots + rowGapDots);
    const rowOffsetMm = rowOffsets[r] || 0;
    const oy = baseOy + Math.round(rowOffsetMm * DOTS_PER_MM);
    for (let c = 0; c < columns; c++) {
      const colBounds = bounds[c];
      if (!colBounds) continue;
      const leftDots = Math.round(colBounds.leftMm * DOTS_PER_MM);
      const colWidthDots = Math.round((colBounds.rightMm - colBounds.leftMm) * DOTS_PER_MM);
      if (colWidthDots <= 0) continue;
      if (form.stickerUseLines && form.stickerLines && form.stickerLines.length > 0) {
        renderOneStickerLines(ctx, leftDots, oy, colWidthDots, form, data, stickerHeightDots, data.allFields || []);
      } else {
        renderOneSticker(ctx, leftDots, oy, colWidthDots, form, data, stickerHeightDots);
      }
    }
  }

  return { canvas, widthDots: totalWidth };
}

/**
 * Convert a canvas into a 1-bit-per-pixel monochrome bitmap in ESC/POS
 * raster format. Each byte = 8 horizontal pixels (MSB = leftmost), threshold
 * at 128 (any luminance below = ink).
 */
export function canvasToEscPosRaster(canvas: HTMLCanvasElement): {
  data: Uint8Array;
  widthBytes: number;
  height: number;
} {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height).data;
  const widthBytes = Math.ceil(width / 8);
  const out = new Uint8Array(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = img[i], g = img[i + 1], b = img[i + 2];
      // Simple luminance + threshold
      const lum = (r * 0.299 + g * 0.587 + b * 0.114);
      if (lum < 128) {
        out[y * widthBytes + (x >> 3)] |= 1 << (7 - (x & 7));
      }
    }
  }
  return { data: out, widthBytes, height };
}

/**
 * Build the ESC/POS bytes for sending a raster image to the printer.
 * Uses GS v 0 (the "Print raster bit image" command).
 */
export function escPosRasterCommand(raster: {
  data: Uint8Array;
  widthBytes: number;
  height: number;
}): Uint8Array {
  const { data, widthBytes, height } = raster;
  // GS v 0 m xL xH yL yH d1...dk
  // m = 0 (normal scaling)
  const xL = widthBytes & 0xff;
  const xH = (widthBytes >> 8) & 0xff;
  const yL = height & 0xff;
  const yH = (height >> 8) & 0xff;
  const header = new Uint8Array([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
  const out = new Uint8Array(header.length + data.length);
  out.set(header, 0);
  out.set(data, header.length);
  return out;
}
