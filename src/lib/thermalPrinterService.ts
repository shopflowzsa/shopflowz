/**
 * Thermal Sticker Printer Service — WebUSB → ESC/POS
 *
 * Talks directly to an Xprinter (and most ESC/POS-compatible 80mm thermal
 * printers) over USB. First print prompts the browser to pick the device;
 * after that the choice is remembered for the origin.
 *
 * Supported environment:
 *   - Desktop Chrome / Edge / Opera
 *   - Printer connected via USB
 *
 * NOT supported:
 *   - Safari, Firefox (no WebUSB)
 *   - iOS / Android (Chrome on Android supports WebUSB but most thermal
 *     printers don't expose a USB interface to mobile)
 *
 * On any unsupported platform `isThermalPrintSupported()` returns false and
 * the caller can fall back to the browser print dialog.
 */

import type { FormDefinition, CustomFieldDefinition, StickerRowAlign, StickerRowSize, StickerRowStyle } from "@/types/crm";

// We deliberately do NOT filter by vendorId — Xprinter rebrands ship under
// many vendor IDs and excluding any of them leaves staff with an empty list.
// Browsers will show every USB device the user is allowed to grant access to.
// Staff pick the right one in the picker the first time; we then remember the
// identity (vendorId + productId) per form.

// ── ESC/POS command bytes ───────────────────────────────────────────────────
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const CMD_INIT = new Uint8Array([ESC, 0x40]); // ESC @ — initialize
const CMD_CENTER = new Uint8Array([ESC, 0x61, 0x01]);
const CMD_LEFT = new Uint8Array([ESC, 0x61, 0x00]);
const CMD_RIGHT = new Uint8Array([ESC, 0x61, 0x02]);
const CMD_BOLD_ON = new Uint8Array([ESC, 0x45, 0x01]);
const CMD_BOLD_OFF = new Uint8Array([ESC, 0x45, 0x00]);
// GS ! n — character size. n=0x00 normal, 0x11 = 2x width + 2x height, 0x22 = 3x.
const CMD_SIZE_SMALL = new Uint8Array([GS, 0x21, 0x00]); // 1x — small uses ESC M 0x01 below for tiny font
const CMD_SIZE_NORMAL = new Uint8Array([GS, 0x21, 0x00]);
const CMD_SIZE_DOUBLE = new Uint8Array([GS, 0x21, 0x11]);
const CMD_SIZE_HUGE = new Uint8Array([GS, 0x21, 0x33]); // 4x width + 4x height
const CMD_FONT_A = new Uint8Array([ESC, 0x4d, 0x00]); // normal font (12 cols on 80mm)
const CMD_FONT_B = new Uint8Array([ESC, 0x4d, 0x01]); // compressed font (smaller)

function alignCmd(align?: StickerRowAlign): Uint8Array {
  if (align === "right") return CMD_RIGHT;
  if (align === "left") return CMD_LEFT;
  return CMD_CENTER; // default
}

function sizeCmd(size?: StickerRowSize): Uint8Array {
  if (size === "huge") return CMD_SIZE_HUGE;
  if (size === "large") return CMD_SIZE_DOUBLE;
  if (size === "small") return CMD_SIZE_SMALL;
  return CMD_SIZE_NORMAL;
}

function smallFontPrefix(size?: StickerRowSize): Uint8Array | null {
  return size === "small" ? CMD_FONT_B : null;
}

function smallFontReset(size?: StickerRowSize): Uint8Array | null {
  return size === "small" ? CMD_FONT_A : null;
}

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
const CMD_FEED_LINES = (n: number) => new Uint8Array([ESC, 0x64, Math.max(0, Math.min(255, n))]);
const CMD_CUT_PARTIAL = new Uint8Array([GS, 0x56, 0x01]);
// GS k m d1...dk NUL — barcode. m=73 (CODE128).
function cmdBarcode(value: string): Uint8Array {
  const data = new TextEncoder().encode(value);
  const out = new Uint8Array(4 + data.length + 1);
  out[0] = GS; out[1] = 0x6b; out[2] = 73; out[3] = data.length;
  out.set(data, 4);
  out[out.length - 1] = 0;
  return out;
}
// QR code via GS ( k function 167/180 — model 2, error correction L
function cmdQRCode(value: string): Uint8Array {
  const data = new TextEncoder().encode(value);
  const len = data.length + 3;
  const pL = len & 0xff;
  const pH = (len >> 8) & 0xff;
  return concat([
    // Select model 2
    new Uint8Array([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    // Module size = 6 dots (readable on 80mm without taking too much room)
    new Uint8Array([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]),
    // Error correction level L (lowest, fastest)
    new Uint8Array([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30]),
    // Store the data
    new Uint8Array([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
    data,
    // Print
    new Uint8Array([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
  ]);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const c of chunks) { out.set(c, i); i += c.length; }
  return out;
}

function encodeText(text: string): Uint8Array {
  // CP437 / ASCII works for plain English. For more reliable accented chars
  // we send raw UTF-8 bytes — most modern Xprinters tolerate this in receipts.
  return new TextEncoder().encode(text);
}

// ── Device picker ───────────────────────────────────────────────────────────
export function isThermalPrintSupported(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as any).usb;
}

export interface ConnectedPrinter {
  device: USBDevice;
  endpointOut: number;
  interfaceNumber: number;
  configurationValue: number;
}

export interface PrinterIdentity {
  vendorId: number;
  productId: number;
  label: string; // user-facing name e.g. "Xprinter XP-Q200"
}

// Remember which devices have been granted so we can skip the picker on reuse.
// We no longer keep devices open between jobs — claim/release/close on every print.
const grantedKeys = new Set<string>();
const keyFor = (vId: number, pId: number) => `${vId.toString(16)}:${pId.toString(16)}`;

// Kept for the resetThermalPrinter() public API.
const printerCache = new Map<string, ConnectedPrinter>();

function buildLabel(device: USBDevice): string {
  return device.productName
    || device.manufacturerName
    || `USB device ${device.vendorId.toString(16)}:${device.productId.toString(16)}`;
}

/**
 * Open the browser's USB picker and let the user choose any device. Returns
 * the picked printer's identity so the caller can save it on the form.
 */
export async function pickPrinter(): Promise<PrinterIdentity> {
  if (!isThermalPrintSupported()) {
    throw new Error("WebUSB is not available in this browser. Use Chrome or Edge on a desktop plugged into the printer.");
  }
  const usb = (navigator as any).usb;
  // No filters — show every USB device the OS exposes. Staff picks the right one.
  const device: USBDevice = await usb.requestDevice({ filters: [] });
  if (!device) throw new Error("No printer selected.");
  return {
    vendorId: device.vendorId,
    productId: device.productId,
    label: buildLabel(device),
  };
}

async function openDevice(device: USBDevice): Promise<ConnectedPrinter> {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);

  let endpointOut: number | undefined;
  let interfaceNumber: number | undefined;
  const config = device.configuration!;
  for (const iface of config.interfaces) {
    for (const alt of iface.alternates) {
      for (const ep of alt.endpoints) {
        if (ep.direction === "out" && ep.type === "bulk") {
          endpointOut = ep.endpointNumber;
          interfaceNumber = iface.interfaceNumber;
          break;
        }
      }
      if (endpointOut !== undefined) break;
    }
    if (endpointOut !== undefined) break;
  }
  if (endpointOut === undefined || interfaceNumber === undefined) {
    throw new Error("Selected device doesn't expose a bulk OUT endpoint — not a compatible printer.");
  }
  await device.claimInterface(interfaceNumber);
  return { device, endpointOut, interfaceNumber, configurationValue: config.configurationValue };
}

async function closeDevice(printer: ConnectedPrinter): Promise<void> {
  try { await printer.device.releaseInterface(printer.interfaceNumber); } catch { /* ignore */ }
  try { await printer.device.close(); } catch { /* ignore */ }
}

/**
 * Resolve the USBDevice for the given saved identity. If not yet granted,
 * opens the picker. Does NOT open or claim — callers do that per-job.
 */
async function resolveDevice(target?: { vendorId?: number; productId?: number }): Promise<USBDevice> {
  if (!isThermalPrintSupported()) {
    throw new Error("WebUSB is not available in this browser. Use Chrome or Edge on a desktop plugged into the printer.");
  }
  const usb = (navigator as any).usb;

  if (target?.vendorId != null && target?.productId != null) {
    const granted: USBDevice[] = await usb.getDevices();
    const match = granted.find(d => d.vendorId === target.vendorId && d.productId === target.productId);
    if (match) return match;
    // Not yet granted on this browser — fall through to picker.
  }

  const granted: USBDevice[] = await usb.getDevices();
  if (granted[0]) return granted[0];
  const picked = await usb.requestDevice({ filters: [] });
  if (!picked) throw new Error("No printer selected.");
  return picked;
}

async function sendBytes(bytes: Uint8Array, target?: { vendorId?: number; productId?: number }): Promise<void> {
  // Open fresh every time so we never fight with another tab over a claimed interface.
  const device = await resolveDevice(target);
  const printer = await openDevice(device);
  try {
    await printer.device.transferOut(printer.endpointOut, bytes);
  } finally {
    await closeDevice(printer);
  }
}

// ── High-level: print a job sticker ─────────────────────────────────────────
export interface StickerData {
  jobNumber: string;
  customerName?: string;
  dateLabel?: string; // already-formatted date (e.g. "17 May 2026")
  extras?: Array<{ label: string; value: string }>;
  footer?: string;
  // Needed for the new line/segment model so custom-field segments can be
  // resolved by ID. Each entry: { id, name } from the workspace.
  allFields?: Array<{ id: string; name: string }>;
}

function pushRow(chunks: Uint8Array[], style: StickerRowStyle, text: string) {
  chunks.push(alignCmd(style.align));
  chunks.push(sizeCmd(style.size));
  const smallOn = smallFontPrefix(style.size);
  if (smallOn) chunks.push(smallOn);
  if (style.bold) chunks.push(CMD_BOLD_ON);
  chunks.push(encodeText(text));
  if (style.bold) chunks.push(CMD_BOLD_OFF);
  const smallOff = smallFontReset(style.size);
  if (smallOff) chunks.push(smallOff);
  chunks.push(new Uint8Array([LF]));
  chunks.push(CMD_SIZE_NORMAL);
}

async function buildStickerEscPosRaster(form: FormDefinition, data: StickerData): Promise<Uint8Array> {
  // Lazy-load the rasterizer to keep the main bundle small.
  const { renderStickerRaster, canvasToEscPosRaster, escPosRasterCommand } =
    await import("@/lib/stickerRasterizer");
  const { canvas } = renderStickerRaster(form, {
    jobNumber: data.jobNumber,
    customerName: data.customerName,
    dateLabel: data.dateLabel,
    extras: data.extras,
    footer: data.footer,
  });
  const raster = canvasToEscPosRaster(canvas);
  const imgCmd = escPosRasterCommand(raster);

  const chunks: Uint8Array[] = [];
  chunks.push(CMD_INIT);
  chunks.push(CMD_LEFT); // raster X-offset is encoded in the image itself
  chunks.push(imgCmd);
  // Feed the paper past the last sticker so reception can tear it on the bar.
  // No auto-cut — die-cut sticker rolls don't need it.
  const bottomMargin = Math.max(0, Math.min(5, form.stickerLayout?.bottomMargin ?? 3));
  chunks.push(CMD_FEED_LINES(bottomMargin + 2));
  return concat(chunks);
}

function buildStickerEscPos(form: FormDefinition, data: StickerData): Uint8Array {
  const chunks: Uint8Array[] = [];
  const layout = form.stickerLayout || {};
  const rowSpacing = Math.max(0, Math.min(3, layout.rowSpacing ?? 0));
  const topMargin = Math.max(0, Math.min(5, layout.topMargin ?? 0));
  const bottomMargin = Math.max(0, Math.min(5, layout.bottomMargin ?? 3));

  chunks.push(CMD_INIT);
  if (topMargin > 0) chunks.push(CMD_FEED_LINES(topMargin));

  const pushGap = () => {
    if (rowSpacing > 0) chunks.push(CMD_FEED_LINES(rowSpacing));
  };

  // Job number
  if (form.stickerShowJobNumber !== false && data.jobNumber) {
    pushRow(chunks, styleFor(layout, "jobNumber"), data.jobNumber);
    pushGap();
  }

  // Customer name
  if (form.stickerShowCustomerName && data.customerName) {
    pushRow(chunks, styleFor(layout, "customerName"), data.customerName);
    pushGap();
  }

  // Date received
  if (form.stickerShowDate && data.dateLabel) {
    pushRow(chunks, styleFor(layout, "date"), `Received: ${data.dateLabel}`);
    pushGap();
  }

  // Extra fields (label: value)
  if (data.extras && data.extras.length > 0) {
    const extrasStyle = styleFor(layout, "extras");
    for (const ex of data.extras) {
      if (!ex.value) continue;
      // label bold + value normal on the same physical line.
      chunks.push(alignCmd(extrasStyle.align));
      chunks.push(sizeCmd(extrasStyle.size));
      const smallOn = smallFontPrefix(extrasStyle.size);
      if (smallOn) chunks.push(smallOn);
      chunks.push(CMD_BOLD_ON);
      chunks.push(encodeText(`${ex.label}: `));
      chunks.push(CMD_BOLD_OFF);
      chunks.push(encodeText(ex.value));
      const smallOff = smallFontReset(extrasStyle.size);
      if (smallOff) chunks.push(smallOff);
      chunks.push(new Uint8Array([LF]));
      chunks.push(CMD_SIZE_NORMAL);
    }
    pushGap();
  }

  // Barcode of the job number
  if (form.stickerShowBarcode && data.jobNumber) {
    chunks.push(CMD_CENTER);
    chunks.push(new Uint8Array([GS, 0x68, 60])); // height = 60 dots
    chunks.push(new Uint8Array([GS, 0x77, 2]));  // module width = 2
    chunks.push(new Uint8Array([GS, 0x48, 0x02])); // print HRI below
    chunks.push(cmdBarcode(data.jobNumber));
    chunks.push(new Uint8Array([LF]));
    chunks.push(CMD_LEFT);
    pushGap();
  }

  // QR code
  if (form.stickerShowQR && data.jobNumber) {
    chunks.push(CMD_CENTER);
    chunks.push(cmdQRCode(data.jobNumber));
    chunks.push(new Uint8Array([LF]));
    chunks.push(CMD_LEFT);
    pushGap();
  }

  // Footer
  if (data.footer) {
    pushRow(chunks, styleFor(layout, "footer"), data.footer);
  }

  // Feed only — no auto-cut (die-cut sticker rolls are peeled, not cut).
  chunks.push(CMD_FEED_LINES(bottomMargin));

  return concat(chunks);
}

/**
 * Print one or more stickers based on the form's sticker config.
 * Resolves with the number of stickers printed. Rejects if the user cancels
 * the device picker or if WebUSB isn't supported.
 */
export async function printJobStickers(
  form: FormDefinition,
  data: StickerData,
  copies: number = 1,
): Promise<number> {
  if (!form.stickerEnabled) return 0;
  if (!isThermalPrintSupported()) {
    throw new Error("Sticker printing needs Chrome or Edge on the desktop plugged into the printer.");
  }
  const target = {
    vendorId: form.stickerPrinterVendorId,
    productId: form.stickerPrinterProductId,
  };

  // Side-by-side dual stickers AND the new line/segment model both need
  // RASTER mode (ESC/POS text can't do columns or multiple segments per line).
  const columns = form.stickerLayout?.columns || 1;
  const needsRaster = columns > 1 || (form.stickerUseLines && (form.stickerLines?.length || 0) > 0);
  const bytes = needsRaster
    ? await buildStickerEscPosRaster(form, data)
    : buildStickerEscPos(form, data);

  const total = Math.max(1, Math.min(10, copies || form.stickerCount || 1));
  for (let i = 0; i < total; i++) {
    await sendBytes(bytes, target);
  }
  return total;
}

/**
 * Print an already-rendered label image (HTMLCanvasElement) straight to a USB
 * thermal printer at its native resolution. Used for custom-size inventory
 * stickers where the caller controls the exact mm dimensions of the canvas.
 */
export async function printRasterImage(
  target: { vendorId?: number; productId?: number },
  canvas: HTMLCanvasElement,
  copies = 1,
  feedLines = 2,
): Promise<number> {
  if (!isThermalPrintSupported()) {
    throw new Error("Sticker printing needs Chrome or Edge on the desktop plugged into the printer.");
  }
  const { canvasToEscPosRaster, escPosRasterCommand } = await import("@/lib/stickerRasterizer");
  const raster = canvasToEscPosRaster(canvas);
  const imgCmd = escPosRasterCommand(raster);
  const bytes = concat([CMD_INIT, CMD_LEFT, imgCmd, CMD_FEED_LINES(Math.max(0, Math.min(10, feedLines)))]);
  const total = Math.max(1, Math.min(50, copies || 1));
  for (let i = 0; i < total; i++) await sendBytes(bytes, target);
  return total;
}

/**
 * Helper for callers: pull StickerData out of a freshly-submitted task using
 * the form's configured field IDs.
 */
export function buildStickerDataFromTask(
  form: FormDefinition,
  task: {
    jobNumber?: string | number;
    customFields?: Record<string, any>;
    createdAt?: string | Date;
  },
  customFields: CustomFieldDefinition[],
): StickerData {
  const jobNumber = task.jobNumber != null ? String(task.jobNumber) : "";

  let customerName: string | undefined;
  if (form.stickerShowCustomerName && form.stickerCustomerNameFieldId && task.customFields) {
    const v = task.customFields[form.stickerCustomerNameFieldId];
    if (v != null && v !== "") customerName = String(v);
  }

  // Always compute the date if it's enabled via legacy flag OR referenced
  // by a stickerLines segment, since the new model uses dateLabel too.
  const linesUseDate = !!form.stickerUseLines &&
    form.stickerLines?.some(l => l.segments?.some(s => s.source === "date"));
  let dateLabel: string | undefined;
  if (form.stickerShowDate || linesUseDate) {
    const d = task.createdAt ? new Date(task.createdAt) : new Date();
    dateLabel = d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  }

  const extras: Array<{ label: string; value: string }> = [];
  // Legacy stickerExtraFieldIds[]
  if (form.stickerExtraFieldIds && task.customFields) {
    for (const fid of form.stickerExtraFieldIds) {
      const def = customFields.find(cf => cf.id === fid);
      const val = task.customFields[fid];
      if (def && val != null && val !== "") {
        extras.push({ label: def.name, value: String(val) });
      }
    }
  }
  // New stickerLines[] — append values for every custom-field segment so the
  // rasterizer can resolve them by label match.
  if (form.stickerUseLines && form.stickerLines && task.customFields) {
    for (const line of form.stickerLines) {
      for (const seg of line.segments || []) {
        if (seg.source !== "customField" || !seg.customFieldId) continue;
        if (extras.some(e => {
          const def = customFields.find(cf => cf.id === seg.customFieldId);
          return def && e.label === def.name;
        })) continue;
        const def = customFields.find(cf => cf.id === seg.customFieldId);
        const val = task.customFields[seg.customFieldId];
        if (def && val != null && val !== "") {
          extras.push({ label: def.name, value: String(val) });
        }
      }
    }
  }

  return {
    jobNumber,
    customerName,
    dateLabel,
    extras,
    footer: form.stickerFooterText,
    allFields: customFields.map(f => ({ id: f.id, name: f.name })),
  };
}

/**
 * Forget all cached printer connections. Useful when a device was unplugged
 * or the user wants to pick a different one.
 */
export function resetThermalPrinter(): void {
  printerCache.clear();
}

// ── Per-PC printer identity stored in localStorage ──────────────────────────
// Each PC/browser remembers its own printer independently so multi-PC setups
// don't clobber each other's printer selection in shared workspace settings.

export function getLocalPrinter(key: string): PrinterIdentity | null {
  try {
    const raw = localStorage.getItem(`thermal_printer_${key}`);
    return raw ? (JSON.parse(raw) as PrinterIdentity) : null;
  } catch {
    return null;
  }
}

export function setLocalPrinter(key: string, identity: PrinterIdentity | null): void {
  if (identity) {
    localStorage.setItem(`thermal_printer_${key}`, JSON.stringify(identity));
  } else {
    localStorage.removeItem(`thermal_printer_${key}`);
  }
}
