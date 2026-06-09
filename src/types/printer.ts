// Task fields available for printer templates
export type PrinterFieldKey =
  | "title"
  | "status"
  | "priority"
  | "description"
  | "listName"
  | "createdAt"
  | "dueDate"
  | "assignee"
  | "jobNumber";

export const PRINTER_FIELD_LABELS: Record<PrinterFieldKey, string> = {
  title: "Task Title",
  status: "Status",
  priority: "Priority", 
  description: "Description",
  listName: "List Name",
  createdAt: "Created Date",
  dueDate: "Due Date",
  assignee: "Assignee",
  jobNumber: "Job Number",
};

// Printer types supported
export type PrinterType = "xprinter" | "epson" | "star" | "generic";

export const PRINTER_TYPES: Record<PrinterType, string> = {
  xprinter: "XPRINTER Thermal Receipt Printer",
  epson: "Epson TM Series",
  star: "Star Micronics",
  generic: "Generic ESC/POS Thermal Printer",
};

// Field mapping for printer templates
export interface PrinterFieldMapping {
  fieldKey: PrinterFieldKey | `custom:${string}`;
  label: string; // Display label on receipt
  enabled: boolean;
}

// Printer configuration
export interface PrinterConfig {
  id: string;
  name: string;
  type: PrinterType;
  connectionType: "usb" | "network" | "bluetooth" | "serial";
  address?: string; // IP address for network, COM port for serial, etc.
  enabled: boolean;
}

// Print template configuration
export interface PrintTemplate {
  id: string;
  name: string;
  headerText: string;
  footerText: string;
  fields: PrinterFieldMapping[];
  printLogo: boolean;
  paperWidth: 58 | 80; // mm
  fontSize: "small" | "normal" | "large";
  alignment: "left" | "center" | "right";
}

// Printer automation settings
export interface PrinterSettings {
  enabled: boolean;
  printOnTaskCreate: boolean;
  selectedPrinterId?: string;
  selectedTemplateId?: string;
  printers: PrinterConfig[];
  templates: PrintTemplate[];
}

// Print job log entry
export interface PrintLog {
  id?: string;
  timestamp: string;
  taskId: string;
  taskTitle: string;
  printerId: string;
  printerName: string;
  templateId: string;
  templateName: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
}

// Default settings
export const DEFAULT_PRINT_TEMPLATE: PrintTemplate = {
  id: "default",
  name: "Default Booking Slip",
  headerText: "BOOKING SLIP",
  footerText: "Thank you for your business!",
  paperWidth: 80,
  fontSize: "normal",
  alignment: "center",
  printLogo: false,
  fields: [
    { fieldKey: "title", label: "Task", enabled: true },
    { fieldKey: "jobNumber", label: "Job #", enabled: true },
    { fieldKey: "status", label: "Status", enabled: true },
    { fieldKey: "priority", label: "Priority", enabled: true },
    { fieldKey: "listName", label: "List", enabled: true },
    { fieldKey: "createdAt", label: "Created", enabled: true },
    { fieldKey: "assignee", label: "Assignee", enabled: false },
    { fieldKey: "dueDate", label: "Due Date", enabled: false },
    { fieldKey: "description", label: "Description", enabled: false },
  ],
};

export const DEFAULT_XPRINTER_CONFIG: PrinterConfig = {
  id: "xprinter-1",
  name: "XPRINTER XP-58IIH",
  type: "xprinter",
  connectionType: "usb",
  enabled: false,
};

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  enabled: false,
  printOnTaskCreate: false,
  printers: [DEFAULT_XPRINTER_CONFIG],
  templates: [DEFAULT_PRINT_TEMPLATE],
};