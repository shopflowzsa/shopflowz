export type CustomFieldType = "text" | "number" | "dropdown" | "date" | "checkbox" | "email" | "phone" | "url";

export interface CustomFieldDefinition {
  id: string;
  name: string;
  type: CustomFieldType;
  options?: string[];
}

export interface CustomFieldValue {
  fieldId: string;
  value: string | number | boolean;
}

export type TaskStatus = "to_do" | "in_progress" | "review" | "done" | "quoted" | "invoiced" | "paid" | "complete";
export type TaskPriority = "urgent" | "high" | "normal" | "low";

export interface StatusConfig {
  id: TaskStatus;
  label: string;
  color: string;
}

// Bright, ClickUp-style status palette. The text colour also drives the status
// dot (rendered with bg-current), so each tint is paired with a vivid text shade.
export const DEFAULT_STATUSES: StatusConfig[] = [
  { id: "to_do", label: "To Do", color: "bg-slate-100 text-slate-600" },
  { id: "in_progress", label: "In Progress", color: "bg-sky-100 text-sky-700" },
  { id: "review", label: "Review", color: "bg-amber-100 text-amber-700" },
  { id: "done", label: "Done", color: "bg-emerald-100 text-emerald-700" },
  { id: "quoted", label: "Quoted", color: "bg-blue-100 text-blue-700" },
  { id: "invoiced", label: "Invoiced", color: "bg-violet-100 text-violet-700" },
  { id: "paid", label: "Paid", color: "bg-green-100 text-green-700" },
  { id: "complete", label: "Complete", color: "bg-teal-100 text-teal-700" },
];

export const PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: "urgent", label: "Urgent", color: "bg-destructive" },
  { value: "high", label: "High", color: "bg-warning" },
  { value: "normal", label: "Normal", color: "bg-info" },
  { value: "low", label: "Low", color: "bg-muted-foreground" },
];

// Special space for tasks without photos
export const JOBS_WITH_ISSUES_SPACE_ID = "jobs-with-issues-special";

export interface TaskComment {
  id: string;
  text: string;
  author: string;
  createdAt: string;
  isSystem?: boolean; // system-generated activity entry (not a manual comment)

  // Optional structured metadata for system entries. Used by the activity
  // panel to render ClickUp-style diff rows. `text` remains the plain-language
  // fallback for legacy entries that don't have these fields.
  action?:
    | 'status'
    | 'list_move'
    | 'priority'
    | 'title'
    | 'due_date'
    | 'start_date'
    | 'technician'
    | 'assignee'
    | 'is_paid'
    | 'custom_field'
    | 'spare_part_added'
    | 'spare_part_removed';
  field?: string;
  oldValue?: string | null;
  newValue?: string | null;
}

export interface SparePartUsage {
  id: string;
  productVariantId: string;
  productName: string;
  variantName?: string;
  sku: string;
  quantity: number;
  unitCost: number;
  addedBy: string;
  addedAt: string;
  stockMovementId?: string; // Reference to the stock movement created
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  listId: string;
  customFieldValues: CustomFieldValue[];
  createdAt: string;
  updatedAt?: string;
  startDate?: string;
  dueDate?: string;
  assignee?: string;
  assignees?: string[];
  comments?: TaskComment[];
  jobNumber?: string;
  photos?: string[];
  photoThumbnails?: string[]; // small compressed versions used in board card thumbnails
  archived?: boolean;
  linkedQuotationId?: string; // Quotation created from this task
  sparePartsUsed?: SparePartUsage[]; // Track spare parts used in this repair
  technician?: string; // Assigned technician name
  isPaid?: boolean; // Whether the job has been paid for
  adminFlag?: { flagged: boolean; reason: string; flaggedBy: string; flaggedAt: string };
}

// Permission level for a specific user on a specific item.
// "inherit" = follow the user's workspace-level role.
// "none"    = hidden from that user entirely.
export type ItemPermission = "inherit" | "editor" | "viewer" | "none";

export type AutomationTriggerType = 'task_created' | 'status_changed_to' | 'task_moved_here' | 'task_in_list' | 'task_always_in_list' | 'start_date_overdue';
export type AutomationActionType  = 'set_status' | 'assign_members' | 'set_priority' | 'flag_task' | 'move_to_list';

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { type: AutomationTriggerType; toStatus?: string; targetListId?: string; offsetDays?: number; };
  action: { type: AutomationActionType; status?: string; assigneeUids?: string[]; priority?: string; flagReason?: string; listId?: string; };
  createdAt: string;
}

export interface List {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  parentId: string;
  parentType: "folder" | "space";
  visibleFieldIds: string[];
  taskOrder: string[];
  customStatuses?: StatusConfig[];
  permissions?: Record<string, ItemPermission>;
  automations?: Automation[];
}

export interface Folder {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  spaceId: string;
  visibleFieldIds: string[];
  permissions?: Record<string, ItemPermission>;
}

export interface Space {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  visibleFieldIds: string[];
  permissions?: Record<string, ItemPermission>;
}

export type ViewMode = "board" | "list";

export interface FormFieldMapping {
  id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  mapTo: "title" | "description" | "customField";
  customFieldId?: string;
  options?: string[];
}

export interface FormDefinition {
  id: string;
  name: string;
  targetListId: string;
  defaultStatus: TaskStatus;
  defaultPriority: TaskPriority;
  fields: FormFieldMapping[];
  createdAt: string;
  prefixJobNumber?: boolean;
  titleTemplate?: string; // e.g. "Repair: {fieldId1} – {fieldId2} | ref {fieldId3}"
  mapJobNumberToFieldId?: string; // custom field to also store the job number in
  depositAmountFieldId?: string; // custom field holding the deposit amount — triggers iKhokha payment on submission

  // ── Thermal sticker printing on form submit (Xprinter via WebUSB) ─────────
  // When enabled, after the task is created the browser prompts the user to
  // pick the connected Xprinter (only the first time) and prints the sticker.
  stickerEnabled?: boolean;
  // When true, render using stickerLines[] (new line/segment model). When
  // false or absent, fall back to the legacy fixed-slot toggles below.
  stickerUseLines?: boolean;
  stickerLines?: StickerLine[]; // up to 6 lines, each with 1-3 segments
  stickerCount?: number; // default sticker copies per submission (1-10)
  stickerShowJobNumber?: boolean; // big bold job number
  stickerShowCustomerName?: boolean; // pull from a custom field
  stickerCustomerNameFieldId?: string; // which custom field holds the customer name
  stickerShowDate?: boolean; // date received
  stickerShowBarcode?: boolean; // CODE128 barcode of job number
  stickerShowQR?: boolean; // QR code of job number
  stickerExtraFieldIds?: string[]; // additional custom fields to render below the header
  stickerFooterText?: string; // free-text footer e.g. "Your Business · 074 000 0000"
  // Saved printer identity — vendorId + productId of the Xprinter / ESC-POS device the user picked
  // for THIS form. Different forms can use different printers. Browser USB permissions are
  // matched by vendorId+productId so this is enough to re-acquire silently next print.
  stickerPrinterVendorId?: number;
  stickerPrinterProductId?: number;
  stickerPrinterLabel?: string; // human-readable name shown in the form settings ("Xprinter XP-Q200")

  // ── Sticker layout / template ───────────────────────────────────────────
  // Layout is "vertical rows" — exactly what ESC/POS thermal prints. The user
  // can't drag rows freely, but can set per-row alignment + size for each
  // logical section. Keep it deliberately small to match ESC/POS reality.
  stickerLayout?: {
    paperWidth?: "58mm" | "80mm";      // print head width
    topMargin?: number;                // blank lines before the first row (0–5)
    bottomMargin?: number;             // blank lines after the cut (0–5)
    rowSpacing?: number;               // blank lines between rows (0–3)
    jobNumber?: StickerRowStyle;       // big number at top
    customerName?: StickerRowStyle;    // customer line
    date?: StickerRowStyle;            // "Received: …"
    extras?: StickerRowStyle;          // label: value lines
    footer?: StickerRowStyle;          // shop name / phone
    // ── Grid sticker support ──────────────────────────────────────────────
    // When columns × rows > 1, the sticker is rendered as a RASTER image with
    // the same content duplicated in N columns and M rows. Required for
    // split-label rolls (e.g. a 2×2 grid of 30×20mm stickers).
    //
    // Per-column horizontal bounds (leftMm / rightMm) are stored individually
    // so each column can be independently aligned to its die-cut — useful
    // when the printer isn't perfectly centred or the die-cuts aren't even.
    columns?: number;                  // 1..4 — number of stickers across
    rows?: number;                     // 1..4 — number of stickers down per repeat
    stickerHeightMm?: number;          // physical height of ONE sticker die in mm (e.g. 20)
    rowGapMm?: number;                 // vertical gap between rows in mm (e.g. 3mm seam)
    topStartMm?: number;               // top blank before the FIRST row starts (mm)
    bottomEndMm?: number;              // extra feed after the LAST row (mm)
    // Per-column horizontal bounds. Each entry: { leftMm, rightMm } in absolute
    // distance from the paper's left edge. Index 0 = first column.
    columnBoundsMm?: Array<{ leftMm: number; rightMm: number }>;
    verticalPaddingMm?: number;        // top padding INSIDE each sticker in mm
    // Per-row vertical fine-tune (mm). Index 0 = top row, index 1 = second
    // row, etc. Lets staff nudge row 2 down or up independently when the
    // die-cuts on a roll aren't perfectly evenly spaced. 0 = no nudge.
    rowOffsetsMm?: number[];
    // Legacy single-row fields — kept so old saved forms still render.
    stickerWidthMm?: number;
    columnGapMm?: number;
    horizontalOffsetMm?: number;
  };
}

export type StickerRowAlign = "left" | "center" | "right";
export type StickerRowSize = "small" | "normal" | "large" | "huge";
export interface StickerRowStyle {
  align?: StickerRowAlign;
  size?: StickerRowSize;
  bold?: boolean;
}

// ── Line/segment-based sticker layout (new model) ──────────────────────────
// A sticker is a vertical stack of LINES. Each line is 1-3 SEGMENTS arranged
// side-by-side, auto-split into equal widths. Each segment renders one piece
// of data (job#, a custom field, the date, a barcode, etc.) with its own
// alignment / size / boldness.
export type StickerSegmentSource =
  | "jobNumber"        // auto JOB-####
  | "customField"      // pick a custom field on the form
  | "date"             // today's date
  | "static"           // free-form text
  | "barcode"          // CODE128 of the job number
  | "qr"               // QR code of the job number
  | "blank";           // empty placeholder (useful for layout spacing)

export interface StickerSegment {
  source: StickerSegmentSource;
  customFieldId?: string; // when source === "customField"
  staticText?: string;    // when source === "static"
  prefix?: string;        // optional label printed before the value, e.g. "Fault:"
  align?: StickerRowAlign;
  size?: StickerRowSize;
  bold?: boolean;
}

export interface StickerLine {
  id: string;
  segments: StickerSegment[]; // 1-3 segments, auto-split equally
}

export interface WorkspaceState {
  spaces: Space[];
  folders: Folder[];
  lists: List[];
  tasks: Task[];
  customFields: CustomFieldDefinition[];
  forms: FormDefinition[];
  jobCounter?: number;
  quotes?: Quote[];
  invoices?: Invoice[];
  quoteCounter?: number;
  invoiceCounter?: number;
  /** Tombstone: IDs of tasks that have been explicitly deleted. Prevents stale
   *  saves from other tabs/users from resurrecting a deleted task via the merge. */
  deletedTaskIds?: string[];
}

// ─── Accounts / Invoicing Types ─────────────────────────────────────────────

export interface QuoteLineItem {
  id: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  productId?: string; // Optional product/inventory ID for stock tracking
  sku?: string; // Optional SKU
}

export type QuoteStatus = "draft" | "sent" | "approved" | "accepted" | "rejected" | "expired";

export interface Quote {
  id: string;
  quoteNumber: string;
  taskId?: string; // Reference to original task if converted
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  lineItems: QuoteLineItem[];
  subtotal: number;
  taxRate: number; // e.g. 0.15 for 15%
  taxAmount: number;
  total: number;
  notes?: string;
  status: QuoteStatus;
  validUntil?: string; // ISO date string
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  invoiceId?: string; // If converted to invoice
}

export type InvoiceStatus = "draft" | "sent" | "viewed" | "partial" | "paid" | "overdue" | "cancelled";
export type PaymentStatus = "unpaid" | "partial" | "paid";

export interface Payment {
  id: string;
  amount: number;
  method: string; // "cash" | "card" | "bank_transfer" | "other"
  notes?: string;
  paidAt: string;
  recordedBy: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  quoteId?: string; // Reference to original quote if converted
  taskId?: string; // Reference to original task
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  lineItems: QuoteLineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  payments?: Payment[];
  notes?: string;
  status: InvoiceStatus;
  paymentStatus: PaymentStatus;
  dueDate?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  paidAt?: string;
}
