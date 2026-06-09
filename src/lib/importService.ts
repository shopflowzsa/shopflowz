import { unzipSync, strFromU8 } from "fflate";
import { supabaseServiceRole } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImportProgress {
  phase: string;
  current: number; // 0-100
  errors: string[];
}

export interface ImportResult {
  imported: Record<string, number>;
  skipped: string[];
  errors: string[];
}

export interface ImportOptions {
  workspaceState: boolean;
  inventory:      boolean;
  sales:          boolean;
  customers:      boolean;
  orders:         boolean;
  forms:          boolean;
  settings:       boolean;
  datasheets:     boolean;
  documents:      boolean;
  photos:         boolean;
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
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

export interface ZipContents {
  hasWorkspaceState: boolean;
  hasInventory:      boolean;
  hasSales:          boolean;
  hasCustomers:      boolean;
  hasOrders:         boolean;
  hasForms:          boolean;
  hasSettings:       boolean;
  hasDatasheets:     boolean;
  hasDocuments:      boolean;
  hasPhotos:         boolean;
  exportDate?:       string;
}

export async function peekZipContents(file: File): Promise<ZipContents> {
  const buf = await file.arrayBuffer();
  const zip = unzipSync(new Uint8Array(buf));
  const keys = Object.keys(zip);
  const has = (name: string) => keys.includes(name);
  return {
    hasWorkspaceState: has("data/workspace_state.json"),
    hasInventory:      has("data/inventory.json"),
    hasSales:          has("data/invoices.json") || has("data/quotes.json"),
    hasCustomers:      has("data/customers.json"),
    hasOrders:         has("data/orders.json"),
    hasForms:          has("data/forms.json"),
    hasSettings:       has("data/workspace_settings.json"),
    hasDatasheets:     has("data/tech_datasheets.json"),
    hasDocuments:      has("data/documents.json") || has("data/whatsapp_logs.json"),
    hasPhotos:         keys.some(k => k.startsWith("photos/")),
  };
}

// ─── Table list ───────────────────────────────────────────────────────────────
// All follow the pattern: { id, workspace_id, data } with upsert on id.

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

// Which tables belong to each option section
const IMPORT_SECTION_TABLES: Record<keyof ImportOptions, readonly string[]> = {
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

function tableAllowed(table: string, options: ImportOptions): boolean {
  for (const [section, tables] of Object.entries(IMPORT_SECTION_TABLES)) {
    if ((tables as readonly string[]).includes(table)) {
      return options[section as keyof ImportOptions];
    }
  }
  return true;
}

// ─── Main import function ─────────────────────────────────────────────────────

export async function importWorkspaceFromZip(
  file: File,
  targetWorkspaceId: string,
  onProgress: (p: ImportProgress) => void,
  options: ImportOptions = DEFAULT_IMPORT_OPTIONS,
): Promise<ImportResult> {
  const errors: string[] = [];
  const skipped: string[] = [];
  const imported: Record<string, number> = {};

  // ── 1. Read & decompress ZIP ──────────────────────────────────────────────
  onProgress({ phase: "Reading ZIP file…", current: 2, errors });

  let zipFiles: Record<string, Uint8Array>;
  try {
    const buffer = await file.arrayBuffer();
    zipFiles = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error(
      "Could not read the ZIP file. Make sure you selected a valid workspace export."
    );
  }

  const fileNames = Object.keys(zipFiles);
  const dataFiles = fileNames.filter((n) => n.startsWith("data/") && n.endsWith(".json"));

  if (dataFiles.length === 0) {
    throw new Error(
      "This ZIP does not appear to be a workspace export — no data/*.json files found."
    );
  }

  onProgress({ phase: `Found ${dataFiles.length} data files…`, current: 8, errors });

  // ── 2. Import workspace_state (CRM tasks / spaces / folders / lists) ──────
  const wsStateRaw = zipFiles["data/workspace_state.json"];
  if (!options.workspaceState) {
    skipped.push("workspace_state (skipped by user)");
  } else if (wsStateRaw) {
    onProgress({ phase: "Importing CRM workspace data (tasks, lists, spaces)…", current: 15, errors });
    try {
      const wsState = JSON.parse(strFromU8(wsStateRaw));
      const { error } = await supabaseServiceRole
        .from("workspace_state")
        .upsert({ workspace_id: targetWorkspaceId, state: wsState }, { onConflict: "workspace_id" });
      if (error) errors.push(`workspace_state: ${error.message}`);
      else imported["workspace_state (tasks/lists/spaces)"] = 1;
    } catch (e) {
      errors.push(`workspace_state: ${String(e)}`);
    }
  } else {
    skipped.push("workspace_state (not in ZIP)");
  }

  // ── 3. Import each simple table ───────────────────────────────────────────
  const BATCH = 50;

  for (let ti = 0; ti < SIMPLE_TABLES.length; ti++) {
    const table = SIMPLE_TABLES[ti];
    const raw = zipFiles[`data/${table}.json`];
    const progressPct = 20 + Math.floor((ti / SIMPLE_TABLES.length) * 75);

    if (!tableAllowed(table, options)) {
      skipped.push(`${table} (skipped by user)`);
      continue;
    }

    if (!raw) {
      skipped.push(`${table} (not in ZIP)`);
      continue;
    }

    onProgress({ phase: `Importing ${table}…`, current: progressPct, errors });

    let records: Array<{ id: string; data: unknown }>;
    try {
      const parsed = JSON.parse(strFromU8(raw));
      records = Array.isArray(parsed) ? parsed : [];
    } catch {
      errors.push(`${table}: failed to parse JSON`);
      continue;
    }

    if (records.length === 0) {
      skipped.push(table);
      continue;
    }

    let count = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH).map((r) => ({
        id: r.id,
        workspace_id: targetWorkspaceId,
        data: r.data,
      }));

      const { error } = await supabaseServiceRole
        .from(table)
        .upsert(batch, { onConflict: "id" });

      if (error) {
        errors.push(`${table}: ${error.message}`);
        break;
      }
      count += batch.length;
    }

    if (count > 0) imported[table] = count;
  }

  // ── 4. Import workspace_settings (every app setting + Business Planning) ───
  // Settings live in workspace_settings as { workspace_id, category, data, … }
  // rows — one per category (printer, ecommerce, sales, … and
  // category="business_planning" which holds the Business Planning expenses /
  // income / daily targets). The original importer skipped this file entirely,
  // which is why none of these — most visibly Business Planning — ever migrated
  // from a srclickup/shopflow export. We restore every row with all its columns
  // and re-point workspace_id at the target workspace, upserting on
  // (workspace_id, category) so re-importing is safe.
  //
  // Note: deliberately NOT importing workspace_members / user_profiles here —
  // re-pointing those into a live multi-tenant platform could clobber other
  // tenants' accounts by id. Settings only.
  const settingsRaw =
    zipFiles["data/workspace_settings.json"] ?? zipFiles["data/workspace-settings.json"];
  if (!options.settings) {
    skipped.push("workspace_settings (skipped by user)");
  } else if (settingsRaw) {
    onProgress({ phase: "Importing settings & business planning…", current: 96, errors });
    try {
      const parsed = JSON.parse(strFromU8(settingsRaw));
      const records: Array<Record<string, unknown>> = Array.isArray(parsed) ? parsed : [];
      if (records.length === 0) {
        skipped.push("workspace_settings");
      } else {
        // Re-point every row at the target workspace.
        const rows = records.map((r) => ({ ...r, workspace_id: targetWorkspaceId }));
        let count = 0;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          const { error } = await supabaseServiceRole
            .from("workspace_settings")
            .upsert(batch, { onConflict: "workspace_id,category" });
          if (error) {
            errors.push(`workspace_settings: ${error.message}`);
            break;
          }
          count += batch.length;
        }
        if (count > 0) imported["workspace_settings (settings + business planning)"] = count;
      }
    } catch (e) {
      errors.push(`workspace_settings: ${String(e)}`);
    }
  } else {
    // Fallback: newer exports also drop business planning as its own file.
    const planningRaw = zipFiles["data/business_planning.json"];
    if (planningRaw) {
      onProgress({ phase: "Importing business planning…", current: 96, errors });
      try {
        const planning = JSON.parse(strFromU8(planningRaw));
        const hasData =
          planning && typeof planning === "object" && Object.keys(planning).length > 0;
        if (hasData) {
          const { error } = await supabaseServiceRole
            .from("workspace_settings")
            .upsert(
              { workspace_id: targetWorkspaceId, category: "business_planning", data: planning },
              { onConflict: "workspace_id,category" },
            );
          if (error) errors.push(`business_planning: ${error.message}`);
          else imported["business_planning"] = 1;
        } else {
          skipped.push("business_planning");
        }
      } catch (e) {
        errors.push(`business_planning: ${String(e)}`);
      }
    } else {
      skipped.push("workspace_settings");
    }
  }

  onProgress({ phase: "Import complete!", current: 100, errors });

  return { imported, skipped, errors };
}
