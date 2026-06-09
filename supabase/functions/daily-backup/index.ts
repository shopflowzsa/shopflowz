import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BACKUP_BUCKET = "workspace-backups";
const NUM_SLOTS = 5;

// All tables from the ZIP export + tech_datasheets
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
];

Deno.serve(async (req) => {
  // Verify caller — must present the service role key as Bearer token
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (authHeader !== `Bearer ${serviceKey}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // Optional POST body: { workspace_id: "..." } to back up a single workspace
  let targetWorkspaceId: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      targetWorkspaceId = body.workspace_id ?? null;
    } catch { /* no body — back up all workspaces */ }
  }

  const { data: workspaces, error: wsErr } = await supabase
    .from("workspaces")
    .select("id, name");

  if (wsErr) {
    return new Response(JSON.stringify({ error: wsErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const targets = targetWorkspaceId
    ? (workspaces ?? []).filter((w) => w.id === targetWorkspaceId)
    : (workspaces ?? []);

  const results = [];
  for (const ws of targets) {
    results.push(await backupWorkspace(supabase, ws.id, ws.name ?? ws.id));
  }

  return new Response(
    JSON.stringify({ success: true, backed_up: results.length, results }),
    { headers: { "Content-Type": "application/json" } },
  );
});

// ─── Back up one workspace ─────────────────────────────────────────────────────

async function backupWorkspace(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  workspaceName: string,
) {
  try {
    const backupDate = new Date().toISOString();

    const backup: Record<string, unknown> = {
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      backup_date: backupDate,
      workspace_state: null,
      workspace_settings: null,
      tables: {} as Record<string, unknown[]>,
    };

    // workspace_state — single JSONB row
    const { data: stateRow } = await supabase
      .from("workspace_state")
      .select("state")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    backup.workspace_state = stateRow?.state ?? null;

    // workspace_settings — single row (may not exist on all projects)
    const { data: settingsRow } = await supabase
      .from("workspace_settings")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    backup.workspace_settings = settingsRow ?? null;

    // All simple tables — paginated to handle large datasets
    const tables = backup.tables as Record<string, unknown[]>;
    for (const table of SIMPLE_TABLES) {
      const rows: unknown[] = [];
      let offset = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from(table)
          .select("*")
          .eq("workspace_id", workspaceId)
          .range(offset, offset + PAGE - 1);
        if (error || !data || data.length === 0) break;
        rows.push(...data);
        if (data.length < PAGE) break;
        offset += PAGE;
      }
      tables[table] = rows;
    }

    // Choose the slot to write (oldest or next empty)
    const slotNumber = await getNextSlot(supabase, workspaceId);
    const filename = `${workspaceId}/slot-${slotNumber}.json`;
    const content = JSON.stringify(backup);
    const bytes = new TextEncoder().encode(content);

    // Write to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BACKUP_BUCKET)
      .upload(filename, bytes, { contentType: "application/json", upsert: true });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    // Record slot metadata
    await supabase.from("backup_slots").upsert(
      {
        workspace_id: workspaceId,
        slot_number: slotNumber,
        backup_date: backupDate,
        filename,
        size_bytes: bytes.byteLength,
        workspace_name: workspaceName,
      },
      { onConflict: "workspace_id,slot_number" },
    );

    const sizeMb = (bytes.byteLength / 1024 / 1024).toFixed(2);
    console.log(`[Backup] ✅ ${workspaceName} → slot ${slotNumber} (${sizeMb} MB)`);

    return {
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      slot: slotNumber,
      size_bytes: bytes.byteLength,
      backup_date: backupDate,
      success: true,
    };
  } catch (err) {
    console.error(`[Backup] ❌ ${workspaceId}:`, err);
    return { workspace_id: workspaceId, error: String(err), success: false };
  }
}

// ─── Slot rotation ─────────────────────────────────────────────────────────────

async function getNextSlot(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
): Promise<number> {
  const { data: slots } = await supabase
    .from("backup_slots")
    .select("slot_number, backup_date")
    .eq("workspace_id", workspaceId)
    .order("backup_date", { ascending: true }); // oldest first

  if (!slots || slots.length < NUM_SLOTS) {
    // Still filling slots 1–5
    return (slots?.length ?? 0) + 1;
  }

  // All 5 slots used — overwrite the oldest
  return (slots[0] as { slot_number: number }).slot_number;
}
