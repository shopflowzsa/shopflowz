// Supabase Edge Function — replaces Firebase Cloud Function pollIkhokhaTransactions
// Polls iKhokha transaction history and updates task status when collection payments are detected.
//
// Call this via an external cron (e.g. cron-job.org) every 2 minutes:
//   POST https://<project>.supabase.co/functions/v1/poll-ikhokha-transactions
//   Headers: Authorization: Bearer <SUPABASE_ANON_KEY>
//
// Or trigger from within your app manually if needed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

async function hmacSHA256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function createPayloadToSign(urlPath: string, body: string): string {
  const url = new URL(urlPath);
  const payload = url.pathname + url.search + body;
  return payload.replace(/[\\"']/g, "\\$&").replace(/\u0000/g, "\\0");
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const startDate = formatDate(yesterday);
  const endDate = formatDate(now);

  // Get all workspaces that have ikhokhaJob settings enabled
  const { data: ikRows } = await supabase
    .from("workspace_settings")
    .select("workspace_id, data")
    .eq("category", "ikhokhaJob");

  const results: Record<string, string> = {};

  for (const row of ikRows ?? []) {
    const workspaceId: string = row.workspace_id;
    const settings = row.data as { appId: string; appSecret: string; enabled: boolean; collectedStatusLabel?: string };
    if (!settings.enabled || !settings.appId || !settings.appSecret) continue;

    try {
      const collectedLabel = (settings.collectedStatusLabel || "Collected").trim().toLowerCase();
      const { appId, appSecret } = settings;

      // Call iKhokha transaction history API
      const historyUrl = `https://api.ikhokha.com/public-api/v1/api/payments/history?startDate=${startDate}&endDate=${endDate}`;
      const payloadToSign = createPayloadToSign(historyUrl, "");
      const signature = await hmacSHA256(appSecret, payloadToSign);

      const resp = await fetch(historyUrl, {
        headers: {
          "IK-APPID": appId.trim(),
          "IK-SIGN": signature.trim(),
        },
      });

      if (!resp.ok) {
        results[workspaceId] = `History API error: ${resp.status}`;
        continue;
      }

      const respData = await resp.json();
      const transactions: any[] = Array.isArray(respData) ? respData : (respData?.data ?? []);

      if (transactions.length === 0) {
        results[workspaceId] = "0 transactions";
        continue;
      }

      // Load workspace state (tasks + lists)
      const { data: stateRow } = await supabase
        .from("workspace_state")
        .select("state")
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (!stateRow?.state) {
        results[workspaceId] = "no workspace state";
        continue;
      }

      const state = stateRow.state as any;
      const tasks: any[] = state.tasks ?? [];
      const lists: any[] = state.lists ?? [];

      // Build jobNumber → task lookup
      const jobMap = new Map<string, any>();
      for (const task of tasks) {
        if (task.jobNumber) {
          jobMap.set(String(task.jobNumber).toLowerCase(), task);
          // also without the "job-" prefix
          const num = String(task.jobNumber).toLowerCase().replace(/^job[-\s]?/, "");
          jobMap.set(`job-${num}`, task);
          jobMap.set(num, task);
        }
      }

      // Load processed transaction IDs to avoid double-firing
      const { data: processedRow } = await supabase
        .from("workspace_settings")
        .select("data")
        .eq("workspace_id", workspaceId)
        .eq("category", "ikhokhaProcessed")
        .maybeSingle();
      const processedIds: string[] = processedRow?.data?.ids ?? [];
      const newProcessed: string[] = [];

      let stateChanged = false;

      for (const tx of transactions) {
        if (tx.status !== "PAID") continue;
        const txId: string = tx.paylinkID || tx.externalTransactionID;
        if (!txId || processedIds.includes(txId)) continue;

        let matchedTask: any = null;

        // 1. Match by externalTransactionID: JOB-{jobNum}-{ts}
        const extId: string = (tx.externalTransactionID || "").trim();
        if (extId.startsWith("JOB-")) {
          const parts = extId.split("-");
          const jobNum = parts[1];
          matchedTask = jobMap.get(`job-${jobNum}`) ?? jobMap.get(jobNum) ?? jobMap.get(extId.toLowerCase());
        }

        // 2. Match by description
        const desc = (tx.description || "").toLowerCase().trim();
        if (!matchedTask && desc) {
          for (const [key, task] of jobMap.entries()) {
            if (desc.includes(key)) { matchedTask = task; break; }
          }
        }

        // 3. Regex fallback
        if (!matchedTask && desc) {
          const m = desc.match(/\bjob[-\s]?(\d{3,})\b/i);
          if (m) {
            matchedTask = jobMap.get(`job-${m[1]}`) ?? jobMap.get(m[1]);
          }
        }

        newProcessed.push(txId);
        if (!matchedTask) continue;

        // Find collected status ID
        let collectedStatusId: string | null = null;
        const taskList = lists.find((l: any) => l.id === matchedTask.listId);
        const searchLists = taskList ? [taskList, ...lists.filter(l => l.id !== taskList.id)] : lists;
        for (const list of searchLists) {
          const s = (list.customStatuses ?? []).find((cs: any) => cs.label?.toLowerCase() === collectedLabel);
          if (s) { collectedStatusId = s.id; break; }
        }

        if (!collectedStatusId || matchedTask.status === collectedStatusId) continue;

        const idx = (state.tasks as any[]).findIndex((t: any) => t.id === matchedTask.id);
        if (idx >= 0) {
          state.tasks[idx] = { ...state.tasks[idx], status: collectedStatusId, updatedAt: new Date().toISOString() };
          stateChanged = true;
          console.log(`[poll-ikhokha] ✅ Workspace ${workspaceId}: task ${matchedTask.jobNumber} → ${collectedLabel}`);
        }
      }

      // Persist
      if (stateChanged) {
        await supabase
          .from("workspace_state")
          .update({ state, updated_at: new Date().toISOString() })
          .eq("workspace_id", workspaceId);
      }

      if (newProcessed.length > 0) {
        await supabase.from("workspace_settings").upsert(
          { workspace_id: workspaceId, category: "ikhokhaProcessed", data: { ids: [...processedIds, ...newProcessed] } },
          { onConflict: "workspace_id,category" }
        );
      }

      results[workspaceId] = `${transactions.length} tx, ${stateChanged ? "state updated" : "no changes"}`;
    } catch (err: any) {
      results[workspaceId] = `error: ${err?.message}`;
      console.error(`[poll-ikhokha] Workspace ${workspaceId} error:`, err);
    }
  }

  return new Response(JSON.stringify({ ok: true, polledAt: now.toISOString(), results }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
