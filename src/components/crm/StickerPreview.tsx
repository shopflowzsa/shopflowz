/**
 * Live on-screen preview of a thermal sticker. Mirrors thermalPrinterService's
 * row order and the StickerRowStyle (align + size + bold) settings so what you
 * see is what the printer will print.
 *
 * Renders an HTML mock — NOT a pixel-perfect raster of the thermal output —
 * but the line wrapping width, font scale and ordering match closely enough
 * to verify layout before printing real stickers.
 */

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import type { FormDefinition, StickerRowStyle, StickerRowSize, StickerRowAlign } from "@/types/crm";

const DEFAULTS: Record<string, StickerRowStyle> = {
  jobNumber:    { align: "center", size: "huge",   bold: true },
  customerName: { align: "center", size: "large",  bold: true },
  date:         { align: "center", size: "normal", bold: false },
  extras:       { align: "left",   size: "normal", bold: false },
  footer:       { align: "center", size: "small",  bold: false },
};

function styleFor(layout: FormDefinition["stickerLayout"] | undefined, key: keyof typeof DEFAULTS): StickerRowStyle {
  return { ...DEFAULTS[key], ...(layout?.[key] || {}) };
}

const SIZE_TO_PX: Record<StickerRowSize, string> = {
  small: "10px",
  normal: "13px",
  large: "18px",
  huge: "28px",
};

const ALIGN_TO_CSS: Record<StickerRowAlign, "left" | "center" | "right"> = {
  left: "left",
  center: "center",
  right: "right",
};

function rowStyle(style: StickerRowStyle): React.CSSProperties {
  return {
    textAlign: ALIGN_TO_CSS[style.align || "center"],
    fontSize: SIZE_TO_PX[style.size || "normal"],
    fontWeight: style.bold ? 800 : 400,
    lineHeight: 1.15,
  };
}

interface StickerPreviewProps {
  form: Partial<FormDefinition>;
  testValues: {
    jobNumber: string;
    customerName: string;
    dateLabel: string;
    extras: Array<{ label: string; value: string }>;
    footer: string;
  };
}

// Static (no canvas ref) copy of the sticker for the 2nd/3rd/4th column in
// dual-mode preview. Barcode rendering uses an inline SVG-ish placeholder.
function DuplicateStickerVisual({
  form,
  testValues,
  layout,
  rowSpacing,
  topMargin,
  bottomMargin,
  gap,
}: {
  form: Partial<FormDefinition>;
  testValues: StickerPreviewProps["testValues"];
  layout: FormDefinition["stickerLayout"];
  rowSpacing: number;
  topMargin: number;
  bottomMargin: number;
  gap: number;
}) {
  return (
    <>
      <div style={{ height: topMargin * 8 }} />
      {form.stickerShowJobNumber !== false && testValues.jobNumber && (
        <div style={{ ...rowStyle(styleFor(layout, "jobNumber")), marginBottom: gap }}>
          {testValues.jobNumber}
        </div>
      )}
      {form.stickerShowCustomerName && testValues.customerName && (
        <div style={{ ...rowStyle(styleFor(layout, "customerName")), marginBottom: gap }}>
          {testValues.customerName}
        </div>
      )}
      {form.stickerShowDate && testValues.dateLabel && (
        <div style={{ ...rowStyle(styleFor(layout, "date")), marginBottom: gap }}>
          Received: {testValues.dateLabel}
        </div>
      )}
      {testValues.extras.length > 0 && (
        <div style={{ marginBottom: gap }}>
          {testValues.extras.map((ex, i) => (
            <div key={i} style={rowStyle(styleFor(layout, "extras"))}>
              <span style={{ fontWeight: 800 }}>{ex.label}: </span>
              <span>{ex.value}</span>
            </div>
          ))}
        </div>
      )}
      {form.stickerShowBarcode && testValues.jobNumber && (
        <div style={{ textAlign: "center", marginBottom: gap, fontFamily: "monospace", fontSize: 9 }}>
          ║▌║║▌▌║▌║▌▌║<br />
          <span style={{ fontSize: 8 }}>{testValues.jobNumber}</span>
        </div>
      )}
      {form.stickerShowQR && testValues.jobNumber && (
        <div style={{ textAlign: "center", marginBottom: gap }}>
          <div
            style={{
              display: "inline-block",
              width: 50,
              height: 50,
              background:
                "repeating-conic-gradient(#000 0 25%, #fff 0 50%) 50% 50%/8px 8px",
              border: "2px solid #000",
            }}
          />
        </div>
      )}
      {testValues.footer && (
        <div style={rowStyle(styleFor(layout, "footer"))}>
          {testValues.footer}
        </div>
      )}
      <div style={{ height: bottomMargin * 8 }} />
    </>
  );
}

export function StickerPreview({ form, testValues }: StickerPreviewProps) {
  const layout = form.stickerLayout || {};
  const paperWidth = layout.paperWidth || "80mm";
  // Visual width in CSS pixels. 80mm at 203 dpi ≈ 640 dots but we down-scale
  // for screen — these widths feel right next to the form-builder dialog.
  const widthPx = paperWidth === "58mm" ? 220 : 300;
  const rowSpacing = Math.max(0, Math.min(3, layout.rowSpacing ?? 0));
  const topMargin = Math.max(0, Math.min(5, layout.topMargin ?? 0));
  const bottomMargin = Math.max(0, Math.min(5, layout.bottomMargin ?? 3));

  const columns = Math.max(1, Math.min(4, layout.columns || 1));
  const isDual = columns > 1;
  // On-screen px per mm — approx the scale factor that makes 80mm read about
  // as 300px wide. 80mm = 300px → 3.75 px/mm.
  const PX_PER_MM = 3.75;
  const stickerWidthMm = layout.stickerWidthMm || (paperWidth === "58mm" ? 58 : 76);
  const stickerHeightMm = layout.stickerHeightMm || 20;
  const columnGapMm = layout.columnGapMm ?? 2;
  const horizontalOffsetMm = layout.horizontalOffsetMm ?? 0;

  const gap = rowSpacing * 6; // each "line" of spacing ≈ 6px on screen

  // Render a CODE128 barcode into a canvas when enabled
  const barcodeRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!form.stickerShowBarcode || !barcodeRef.current || !testValues.jobNumber) return;
    try {
      JsBarcode(barcodeRef.current, testValues.jobNumber, {
        format: "CODE128",
        width: 1.8,
        height: 44,
        displayValue: true,
        fontSize: 11,
        margin: 0,
      });
    } catch {
      // ignore invalid barcodes (e.g. empty test value)
    }
  }, [form.stickerShowBarcode, testValues.jobNumber]);

  // ── New line/segment model render ─────────────────────────────────────
  const SIZE_PX: Record<string, string> = { small: "10px", normal: "13px", large: "18px", huge: "28px" };
  const ALIGN_CSS: Record<string, "left" | "center" | "right"> = { left: "left", center: "center", right: "right" };

  const resolveSegmentPreview = (seg: import("@/types/crm").StickerSegment): string => {
    switch (seg.source) {
      case "jobNumber": return testValues.jobNumber || "";
      case "customField": {
        if (!seg.customFieldId) return "";
        // Caller doesn't pass full custom-fields list here, but extras carry
        // resolved label/value pairs. Match by label using the form's mapping.
        const cfField = (form as any)?.fields?.find((f: any) => f.customFieldId === seg.customFieldId);
        const label = cfField?.label;
        if (!label) return `[${seg.customFieldId.slice(0, 6)}]`;
        const found = testValues.extras.find(e => e.label === label);
        return found?.value || `[${label}]`;
      }
      case "date": return testValues.dateLabel || "";
      case "static": return seg.staticText || "";
      case "barcode": return "[barcode]";
      case "qr": return "[QR]";
      case "blank": return "";
    }
  };

  const LinesContents = (
    <>
      <div style={{ height: topMargin * 8 }} />
      {(form.stickerLines || []).slice(0, 6).map((line, li) => (
        <div key={li} style={{ display: "flex", marginBottom: gap }}>
          {(line.segments || []).slice(0, 3).map((seg, si) => {
            const text = resolveSegmentPreview(seg);
            if (seg.source === "barcode") {
              return (
                <div key={si} style={{ flex: 1, textAlign: "center", padding: "2px 0" }}>
                  <div style={{ fontFamily: "monospace", fontSize: 9 }}>║▌║║▌▌║▌║▌▌║</div>
                  <div style={{ fontSize: 8 }}>{testValues.jobNumber}</div>
                </div>
              );
            }
            if (seg.source === "qr") {
              return (
                <div key={si} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ display: "inline-block", width: 40, height: 40, background: "repeating-conic-gradient(#000 0 25%, #fff 0 50%) 50% 50%/8px 8px", border: "2px solid #000" }} />
                </div>
              );
            }
            return (
              <div
                key={si}
                style={{
                  flex: 1,
                  textAlign: ALIGN_CSS[seg.align || "center"],
                  fontSize: SIZE_PX[seg.size || "normal"],
                  fontWeight: seg.bold ? 800 : 400,
                  lineHeight: 1.15,
                  padding: "0 2px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {seg.prefix ? <span style={{ fontWeight: 800 }}>{seg.prefix} </span> : null}
                {text}
              </div>
            );
          })}
        </div>
      ))}
      <div style={{ height: bottomMargin * 8 }} />
    </>
  );

  const StickerContents = form.stickerUseLines ? LinesContents : (
    <>
      {/* Top margin */}
      <div style={{ height: topMargin * 8 }} />

      {/* Job number */}
      {form.stickerShowJobNumber !== false && testValues.jobNumber && (
        <div style={{ ...rowStyle(styleFor(layout, "jobNumber")), marginBottom: gap }}>
          {testValues.jobNumber}
        </div>
      )}

      {/* Customer name */}
      {form.stickerShowCustomerName && testValues.customerName && (
        <div style={{ ...rowStyle(styleFor(layout, "customerName")), marginBottom: gap }}>
          {testValues.customerName}
        </div>
      )}

      {/* Date */}
      {form.stickerShowDate && testValues.dateLabel && (
        <div style={{ ...rowStyle(styleFor(layout, "date")), marginBottom: gap }}>
          Received: {testValues.dateLabel}
        </div>
      )}

      {/* Extras */}
      {testValues.extras.length > 0 && (
        <div style={{ marginBottom: gap }}>
          {testValues.extras.map((ex, i) => (
            <div key={i} style={rowStyle(styleFor(layout, "extras"))}>
              <span style={{ fontWeight: 800 }}>{ex.label}: </span>
              <span>{ex.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Barcode (only render canvas in the first sticker — siblings reuse same content visually) */}
      {form.stickerShowBarcode && testValues.jobNumber && (
        <div style={{ textAlign: "center", marginBottom: gap }}>
          <canvas ref={barcodeRef} />
        </div>
      )}

      {/* QR — approximate */}
      {form.stickerShowQR && testValues.jobNumber && (
        <div style={{ textAlign: "center", marginBottom: gap }}>
          <div
            style={{
              display: "inline-block",
              width: 60,
              height: 60,
              background:
                "repeating-conic-gradient(#000 0 25%, #fff 0 50%) 50% 50%/10px 10px",
              border: "2px solid #000",
            }}
          />
          <div style={{ fontSize: 9, marginTop: 2 }}>{testValues.jobNumber}</div>
        </div>
      )}

      {/* Footer */}
      {testValues.footer && (
        <div style={rowStyle(styleFor(layout, "footer"))}>
          {testValues.footer}
        </div>
      )}

      {/* Bottom margin */}
      <div style={{ height: bottomMargin * 8 }} />
    </>
  );

  if (isDual) {
    const stickerPx = stickerWidthMm * PX_PER_MM;
    const stickerHpx = stickerHeightMm * PX_PER_MM;
    const gapPx = columnGapMm * PX_PER_MM;
    const offsetPx = horizontalOffsetMm * PX_PER_MM;

    return (
      <div className="flex flex-col items-center gap-2 select-none">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Preview — {paperWidth} · {columns}× side-by-side ({stickerWidthMm}×{stickerHeightMm}mm)
        </div>
        <div
          className="bg-gray-50 border border-dashed border-gray-300 shadow-sm font-mono"
          style={{
            width: widthPx,
            padding: "6px 4px",
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: gapPx,
              paddingLeft: offsetPx,
            }}
          >
            {Array.from({ length: columns }).map((_, i) => (
              <div
                key={i}
                className="bg-white border border-gray-400 text-black"
                style={{
                  width: stickerPx,
                  minHeight: stickerHpx,
                  padding: "4px 4px",
                  overflow: "hidden",
                  fontSize: 9,
                }}
              >
                {/* For columns >= 2, rendering the barcode <canvas> would only
                   work in the first column (ref reuse). The cloned columns
                   visually re-render as text — acceptable approximation. */}
                {i === 0 ? StickerContents : (
                  <DuplicateStickerVisual
                    form={form}
                    testValues={testValues}
                    layout={layout}
                    rowSpacing={rowSpacing}
                    topMargin={topMargin}
                    bottomMargin={bottomMargin}
                    gap={gap}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-dashed border-gray-300 mt-2 pt-0.5 text-center text-[9px] text-gray-400">
            ✂ — — — — — — feed direction — — — — — ✂
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Preview — {paperWidth}
      </div>
      <div
        className="bg-white text-black border border-gray-300 shadow-sm font-mono"
        style={{
          width: widthPx,
          padding: "10px 8px",
          minHeight: 120,
          fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
        }}
      >
        {StickerContents}

        {/* "Cut" indicator */}
        <div className="border-t border-dashed border-gray-300 mt-1 pt-0.5 text-center text-[9px] text-gray-400">
          ✂ — — — — — — — — — — — — — ✂
        </div>
      </div>
    </div>
  );
}
