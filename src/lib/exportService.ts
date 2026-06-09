import { zipSync, strToU8 } from "fflate";
import { supabaseServiceRole } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExportProgress {
  phase: string;
  current: number; // 0-100
}

// ─── Export options ───────────────────────────────────────────────────────────

export interface ExportOptions {
  workspaceState: boolean; // Tasks, spaces, lists, CRM
  inventory:      boolean; // Products + stock movements
  sales:          boolean; // Invoices, quotes, payments
  customers:      boolean; // Customers + ecommerce customers
  orders:         boolean; // Store orders
  forms:          boolean; // Forms + submissions
  settings:       boolean; // Store/app settings (API keys etc.)
  datasheets:     boolean; // Tech data sheets metadata
  documents:      boolean; // Documents, WhatsApp logs, expenses, banking
  photos:         boolean; // Task/product photos (slow — off by default)
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  workspaceState: true,
  inventory:      true,
  sales:          true,
  customers:      true,
  orders:         true,
  forms:          true,
  settings:       true,
  datasheets:     true,
  documents:      true,
  photos:         false,
};

export const EXPORT_SECTIONS: Array<{ key: keyof ExportOptions; label: string; description: string }> = [
  { key: "workspaceState", label: "Tasks & CRM",        description: "All tasks, jobs, spaces, lists and folders" },
  { key: "inventory",      label: "Inventory",          description: "Products, stock levels and movements" },
  { key: "sales",          label: "Sales & Invoices",   description: "Invoices, quotes and payments" },
  { key: "customers",      label: "Customers",          description: "Customer records and ecommerce accounts" },
  { key: "orders",         label: "Store Orders",       description: "Online store orders" },
  { key: "forms",          label: "Forms",              description: "Form templates and submissions" },
  { key: "settings",       label: "Settings",           description: "Store config, API keys, ecommerce settings" },
  { key: "datasheets",     label: "Tech Data Sheets",   description: "Datasheet file metadata" },
  { key: "documents",      label: "Documents & Logs",   description: "Documents, WhatsApp logs, expenses, banking" },
  { key: "photos",         label: "Photos",             description: "Task/product photos — large, takes longer" },
];

// ─── Config ───────────────────────────────────────────────────────────────────

const SIMPLE_TABLES = [
  "customers",
  "invoices",
  "sales_invoices",
  "quotes",
  "payments",
  "inventory",
  "stock_movements",
  "orders",
  "ecommerce_customers",
  "forms",
  "form_submissions",
  "documents",
  "whatsapp_logs",
  "expense_slips",
  "banking_transactions",
  "tech_datasheets",
] as const;

const PHOTO_BATCH = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cloudinaryFilename(url: string): string {
  // e.g. https://res.cloudinary.com/cloud/image/upload/v123/folder/file.jpg → file.jpg
  try {
    const parts = new URL(url).pathname.split("/");
    return parts[parts.length - 1] || `photo_${Date.now()}`;
  } catch {
    return `photo_${Date.now()}`;
  }
}

async function fetchPhotoAsUint8(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function downloadInBatches(
  urls: Array<{ url: string; path: string }>,
  files: Record<string, Uint8Array>,
  onBatch: (done: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < urls.length; i += PHOTO_BATCH) {
    const batch = urls.slice(i, i + PHOTO_BATCH);
    await Promise.all(
      batch.map(async ({ url, path }) => {
        const data = await fetchPhotoAsUint8(url);
        if (data) files[path] = data;
      })
    );
    onBatch(Math.min(i + PHOTO_BATCH, urls.length), urls.length);
  }
}

// ─── Photo URL extraction ─────────────────────────────────────────────────────

function extractPhotoUrls(
  wsState: Record<string, unknown> | null,
  tableData: Record<string, Array<{ id: string; data: Record<string, unknown> }>>,
): Array<{ url: string; path: string }> {
  const result: Array<{ url: string; path: string }> = [];
  const seen = new Set<string>();

  function add(url: string, folder: string) {
    if (!url || seen.has(url)) return;
    seen.add(url);
    result.push({ url, path: `photos/${folder}/${cloudinaryFilename(url)}` });
  }

  // Task photos from workspace_state
  const tasks = (wsState?.tasks as Array<{ photos?: string[] }>) ?? [];
  for (const task of tasks) {
    for (const p of task.photos ?? []) add(p, "tasks");
  }

  // Inventory images
  for (const row of tableData["inventory"] ?? []) {
    const d = row.data as { images?: Array<{ url: string }> };
    for (const img of d?.images ?? []) add(img?.url, "inventory");
  }

  // Expense slip images
  for (const row of tableData["expense_slips"] ?? []) {
    const d = row.data as { imageUrl?: string };
    if (d?.imageUrl) add(d.imageUrl, "expense_slips");
  }

  return result;
}

// ─── Main export function ─────────────────────────────────────────────────────

// Which tables belong to each option section
const SECTION_TABLES: Record<keyof ExportOptions, readonly string[]> = {
  workspaceState: [],
  inventory:      ["inventory", "stock_movements"],
  sales:          ["invoices", "sales_invoices", "quotes", "payments"],
  customers:      ["customers", "ecommerce_customers"],
  orders:         ["orders"],
  forms:          ["forms", "form_submissions"],
  settings:       [],
  datasheets:     ["tech_datasheets"],
  documents:      ["documents", "whatsapp_logs", "expense_slips", "banking_transactions"],
  photos:         [],
};

export async function exportWorkspaceToZip(
  workspaceId: string,
  workspaceName: string,
  onProgress: (p: ExportProgress) => void,
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
): Promise<void> {
  const files: Record<string, Uint8Array> = {};

  // ── 1. workspace_state ────────────────────────────────────────────────────
  let wsState: Record<string, unknown> | null = null;
  if (options.workspaceState) {
    onProgress({ phase: "Exporting CRM data (tasks, spaces, lists)…", current: 5 });
    const { data } = await supabaseServiceRole
      .from("workspace_state")
      .select("state")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    wsState = (data?.state as Record<string, unknown>) ?? null;
    files["data/workspace_state.json"] = strToU8(JSON.stringify(wsState ?? {}, null, 2));
  }

  // ── 2. workspace_settings ─────────────────────────────────────────────────
  if (options.settings) {
    onProgress({ phase: "Exporting settings…", current: 8 });
    const { data, error } = await supabaseServiceRole
      .from("workspace_settings")
      .select("*")
      .eq("workspace_id", workspaceId);
    if (error) console.error("[export] workspace_settings query failed:", error);
    if (!data || data.length === 0) console.warn("[export] workspace_settings returned 0 rows for workspace_id:", workspaceId);
    files["data/workspace_settings.json"] = strToU8(JSON.stringify(data ?? [], null, 2));
  }

  // ── 3. Simple tables ──────────────────────────────────────────────────────
  const tableData: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {};

  // Build list of tables to export based on options
  const tablesToExport = SIMPLE_TABLES.filter(t => {
    for (const [section, tables] of Object.entries(SECTION_TABLES)) {
      if ((tables as readonly string[]).includes(t) && options[section as keyof ExportOptions]) return true;
    }
    return false;
  });

  for (let ti = 0; ti < tablesToExport.length; ti++) {
    const table = tablesToExport[ti];
    onProgress({
      phase: `Exporting ${table}…`,
      current: 10 + Math.floor((ti / Math.max(tablesToExport.length, 1)) * 40),
    });

    let allRows: Array<{ id: string; data: Record<string, unknown> }> = [];
    let from = 0;
    const PAGE = 500;
    while (true) {
      const { data, error } = await supabaseServiceRole
        .from(table)
        .select("id, data")
        .eq("workspace_id", workspaceId)
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      allRows = allRows.concat(data as typeof allRows);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    tableData[table] = allRows;
    files[`data/${table}.json`] = strToU8(JSON.stringify(allRows, null, 2));
  }

  // ── 4. Download photos ────────────────────────────────────────────────────
  if (options.photos) {
    const photoUrls = extractPhotoUrls(wsState, tableData);
    if (photoUrls.length > 0) {
      onProgress({ phase: `Downloading ${photoUrls.length} photos…`, current: 55 });
      let photoDone = 0;
      await downloadInBatches(photoUrls, files, (done, total) => {
        photoDone = done;
        onProgress({ phase: `Downloading photos (${done}/${total})…`, current: 55 + Math.floor((done / total) * 35) });
      });
      void photoDone;
    } else {
      onProgress({ phase: "No photos to download.", current: 90 });
    }
  } else {
    onProgress({ phase: "Skipping photos…", current: 90 });
  }

  // ── 4. README ─────────────────────────────────────────────────────────────
  const tablesSummary = SIMPLE_TABLES.map((t) => `  ${t}.json  (${tableData[t]?.length ?? 0} records)`).join("\n");
  files["README.txt"] = strToU8(
    `Workspace Data Export
=====================
Workspace : ${workspaceName}
Exported  : ${new Date().toLocaleString()}

DATA FILES
----------
  workspace_state.json  (all CRM tasks, spaces, folders, lists)
${tablesSummary}

PHOTOS
------
  photos/tasks/          Task & job photos
  photos/inventory/      Product images
  photos/expense_slips/  Expense slip scans

HOW TO IMPORT
-------------
In ShopFlowz, go to Settings → Import from ZIP and select this file.
The import will restore all tables into the target workspace.

Note: Photo files in this ZIP are included for reference.
The import restores data from the JSON files; original Cloudinary
URLs embedded in the data remain valid and will continue to load.
`
  );

  // ── 5. Pack & download ────────────────────────────────────────────────────
  onProgress({ phase: "Packaging ZIP…", current: 96 });
  const zipData = zipSync(files, { level: 6 });

  const date = new Date().toISOString().split("T")[0];
  const safeName = workspaceName.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const filename = `workspace-export-${safeName}-${date}.zip`;

  const blob = new Blob([zipData], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  onProgress({ phase: "Download started!", current: 100 });
}
