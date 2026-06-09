import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { Task, CustomFieldDefinition } from "@/types/crm";
import {
  PrinterSettings, DEFAULT_PRINTER_SETTINGS, PrinterFieldKey, PrintTemplate, PrintLog,
  PrinterFieldMapping, PrinterConfig
} from "@/types/printer";

const SETTINGS_PATH = "printerSettings";

// ─── Firestore persistence ────────────────────────────────────────────────────

export async function loadPrinterSettings(
  workspaceId: string,
): Promise<PrinterSettings> {
  const { data } = await supabase
    .from('workspace_settings')
    .select('data')
    .eq('workspace_id', workspaceId)
    .eq('category', 'printer')
    .maybeSingle();
  return data?.data ? (data.data as PrinterSettings) : { ...DEFAULT_PRINTER_SETTINGS };
}

export async function savePrinterSettings(
  workspaceId: string,
  settings: PrinterSettings,
): Promise<void> {
  await supabaseServiceRole.from('workspace_settings').upsert(
    { workspace_id: workspaceId, category: 'printer', data: settings },
    { onConflict: 'workspace_id,category' }
  );
}

export async function loadPrintLogs(workspaceId: string, max = 50): Promise<PrintLog[]> {
  const { data } = await supabase
    .from('print_logs')
    .select('id, data')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(max);
  return (data || []).map(r => ({ id: r.id, ...(r.data as any) } as PrintLog));
}

// ─── Field resolution ─────────────────────────────────────────────────────────

function resolveFieldValue(
  fieldKey: PrinterFieldKey | `custom:${string}`,
  task: Task,
  listName: string,
  customFields: CustomFieldDefinition[],
): string {
  if (fieldKey.startsWith("custom:")) {
    const cfId = fieldKey.slice(7);
    const cfv = task.customFieldValues.find((v) => v.fieldId === cfId);
    return cfv ? String(cfv.value) : "";
  }
  switch (fieldKey as PrinterFieldKey) {
    case "title":       return task.title;
    case "status":      return task.status.replace("_", " ");
    case "priority":    return task.priority;
    case "description": return task.description ?? "";
    case "listName":    return listName;
    case "createdAt":   return task.createdAt;
    case "dueDate":     return task.dueDate ?? "";
    case "assignee":    return task.assignee ?? "";
    case "jobNumber":   return task.jobNumber ?? "";
    default:            return "";
  }
}

// ─── ESC/POS Command Generation ───────────────────────────────────────────────

/**
 * Generate ESC/POS commands for thermal printing
 */
function generateESCPOSCommands(
  template: PrintTemplate,
  task: Task,
  listName: string,
  customFields: CustomFieldDefinition[]
): Uint8Array {
  const commands: number[] = [];
  
  // Initialize printer
  commands.push(0x1B, 0x40); // ESC @ - Initialize printer
  
  // Set character set to UTF-8
  commands.push(0x1B, 0x74, 0x06); // ESC t 6 - Set character code page
  
  // Set alignment
  const alignmentCode = template.alignment === "center" ? 1 : template.alignment === "right" ? 2 : 0;
  commands.push(0x1B, 0x61, alignmentCode); // ESC a - Set alignment
  
  // Set font size
  const fontSize = template.fontSize === "small" ? 0x00 : template.fontSize === "large" ? 0x11 : 0x01;
  commands.push(0x1D, 0x21, fontSize); // GS ! - Set character size
  
  // Add header text
  if (template.headerText) {
    const headerBytes = new TextEncoder().encode(template.headerText + "\n");
    commands.push(...Array.from(headerBytes));
    commands.push(0x0A, 0x0A); // Double line feed
  }
  
  // Add separator line
  const separatorLine = "-".repeat(template.paperWidth === 58 ? 32 : 48);
  const separatorBytes = new TextEncoder().encode(separatorLine + "\n");
  commands.push(...Array.from(separatorBytes));
  
  // Reset alignment to left for fields
  commands.push(0x1B, 0x61, 0x00); // ESC a 0 - Left align
  
  // Add task fields
  for (const field of template.fields) {
    if (!field.enabled) continue;
    
    const value = resolveFieldValue(field.fieldKey, task, listName, customFields);
    if (value.trim()) {
      const fieldLine = `${field.label}: ${value}\n`;
      const fieldBytes = new TextEncoder().encode(fieldLine);
      commands.push(...Array.from(fieldBytes));
    }
  }
  
  // Add separator line before footer
  commands.push(0x0A); // Line feed
  commands.push(...Array.from(separatorBytes));
  
  // Add footer text
  if (template.footerText) {
    // Center align footer
    commands.push(0x1B, 0x61, 0x01); // ESC a 1 - Center align
    const footerBytes = new TextEncoder().encode(template.footerText + "\n");
    commands.push(...Array.from(footerBytes));
  }
  
  // Add timestamp
  const timestamp = new Date().toLocaleString();
  const timestampBytes = new TextEncoder().encode(`\nPrinted: ${timestamp}\n`);
  commands.push(...Array.from(timestampBytes));
  
  // Cut paper (partial cut)
  commands.push(0x0A, 0x0A, 0x0A); // 3 line feeds
  commands.push(0x1D, 0x56, 0x42, 0x00); // GS V B 0 - Partial cut
  
  return new Uint8Array(commands);
}

// ─── Printer Communication ────────────────────────────────────────────────────

/**
 * Print via Web Serial API (for USB printers)
 */
async function printViaWebSerial(
  printer: PrinterConfig,
  printData: Uint8Array
): Promise<void> {
  if (!("serial" in navigator)) {
    throw new Error("Web Serial API not supported in this browser");
  }
  
  try {
    // Request serial port
    const port = await (navigator as any).serial.requestPort({
      filters: [
        { usbVendorId: 0x0483 }, // XPRINTER vendor ID
        { usbVendorId: 0x04b8 }, // Epson vendor ID
        { usbVendorId: 0x0519 }, // Star vendor ID
      ]
    });
    
    // Open port
    await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" });
    
    // Send print data
    const writer = port.writable.getWriter();
    await writer.write(printData);
    writer.releaseLock();
    
    // Close port
    await port.close();
  } catch (error) {
    throw new Error(`Serial printing failed: ${error}`);
  }
}

/**
 * Print via network (TCP for network printers)
 */
async function printViaNetwork(
  printer: PrinterConfig, 
  printData: Uint8Array
): Promise<void> {
  if (!printer.address) {
    throw new Error("Network printer address not configured");
  }
  
  // Use local print API server (default: localhost:3001)
  const printApiUrl = process.env.PRINT_API_URL || "http://localhost:3001";
  
  const response = await fetch(`${printApiUrl}/api/print`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Printer-Address": printer.address,
      "X-Printer-Type": printer.type,
    },
    body: printData,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Network printing failed: ${error.error || response.status}`);
  }
}

// ─── Main Print Function ──────────────────────────────────────────────────────

export async function printBookingSlip(
  workspaceId: string,
  task: Task,
  listName: string,
  customFields: CustomFieldDefinition[],
  settings: PrinterSettings
): Promise<void> {
  if (!settings.enabled || !settings.printOnTaskCreate) {
    return;
  }
  
  const printer = settings.printers.find(p => p.id === settings.selectedPrinterId && p.enabled);
  const template = settings.templates.find(t => t.id === settings.selectedTemplateId);
  
  if (!printer || !template) {
    console.warn("Printer or template not found/configured");
    return;
  }
  
  const printLog: PrintLog = {
    timestamp: new Date().toISOString(),
    taskId: task.id,
    taskTitle: task.title,
    printerId: printer.id,
    printerName: printer.name,
    templateId: template.id,
    templateName: template.name,
    status: "sent",
  };
  
  try {
    // Generate print data
    const printData = generateESCPOSCommands(template, task, listName, customFields);
    
    // Send to printer based on connection type
    switch (printer.connectionType) {
      case "usb":
      case "serial":
        await printViaWebSerial(printer, printData);
        break;
      case "network":
        await printViaNetwork(printer, printData);
        break;
      default:
        throw new Error(`Unsupported connection type: ${printer.connectionType}`);
    }
    
    printLog.status = "sent";
  } catch (error) {
    printLog.status = "failed";
    printLog.error = error instanceof Error ? error.message : String(error);
    console.error("Print failed:", error);
  }
  
  // Log the print attempt
  try {
    const logId = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await supabaseServiceRole.from('print_logs').insert({ id: logId, workspace_id: workspaceId, data: printLog });
  } catch (logError) {
    console.error("Failed to log print attempt:", logError);
  }
}

// ─── Printer Detection & Setup ────────────────────────────────────────────────

/**
 * Open the browser Serial port picker so the user can grant access to their
 * USB/serial thermal printer. Returns the selected port as a PrinterConfig.
 * Uses requestPort() (not getPorts()) so it always opens the chooser dialog.
 */
export async function detectUSBPrinters(): Promise<Partial<PrinterConfig>[]> {
  if (!("serial" in navigator)) {
    return [];
  }

  try {
    const port = await (navigator as any).serial.requestPort({ filters: [] });
    const info = port.getInfo?.() as { usbVendorId?: number; usbProductId?: number } | undefined;
    const vId = info?.usbVendorId;
    const pId = info?.usbProductId;
    const idStr = vId != null
      ? ` (${vId.toString(16).padStart(4, "0")}:${(pId ?? 0).toString(16).padStart(4, "0")})`
      : "";
    return [{
      id: `usb-printer-${Date.now()}`,
      name: `Thermal Printer${idStr}`,
      type: "generic" as const,
      connectionType: "serial" as const,
      enabled: true,
    }];
  } catch (error: any) {
    if (error?.name !== "NotFoundError") {
      console.error("Failed to detect USB printers:", error);
    }
    return [];
  }
}

/**
 * Test printer connection
 */
export async function testPrinter(printer: PrinterConfig): Promise<boolean> {
  try {
    const testData = new TextEncoder().encode("Test Print\n\n\n");
    const escPosData = new Uint8Array([
      0x1B, 0x40, // Initialize
      ...Array.from(testData),
      0x1D, 0x56, 0x42, 0x00 // Cut paper
    ]);
    
    switch (printer.connectionType) {
      case "usb":
      case "serial":
        await printViaWebSerial(printer, escPosData);
        break;
      case "network":
        await printViaNetwork(printer, escPosData);
        break;
      default:
        return false;
    }
    
    return true;
  } catch (error) {
    console.error("Printer test failed:", error);
    return false;
  }
}