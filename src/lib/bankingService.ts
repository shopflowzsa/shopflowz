/**
 * Banking & Matching Service
 *
 * Manages iKhokha card-machine transactions stored in Supabase.
 * Transactions can be:
 *  - Imported manually by pasting / uploading an iKhokha CSV export
 *  - Matched to invoices (manually or auto-matched by amount + date)
 */

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────────────────

export type MatchStatus = "unmatched" | "matched" | "ignored";

export interface BankingTransaction {
  id: string;
  workspaceId: string;
  transactionDate: string; // ISO date yyyy-MM-dd
  amount: number;          // Rands (positive = credit)
  reference?: string;
  cardType?: string;
  terminalId?: string;
  description?: string;
  matchedInvoiceId?: string | null;
  matchStatus: MatchStatus;
  rawData: Record<string, unknown>;
  createdAt: string;
}

export interface BankingSettings {
  terminalId: string;
  terminalLabel: string;
  autoMatchEnabled: boolean;
  autoMatchDaysTolerance: number; // days within which to match by date
  autoMatchAmountTolerance: number; // Rand tolerance for fuzzy amount match
  // iKhokha live API credentials (stored server-side)
  ikAppId: string;
  ikAppSecret: string;
}

const defaultBankingSettings: BankingSettings = {
  terminalId: "",
  terminalLabel: "",
  autoMatchEnabled: true,
  autoMatchDaysTolerance: 3,
  autoMatchAmountTolerance: 0,
  ikAppId: "",
  ikAppSecret: "",
};

// ── Settings ──────────────────────────────────────────────────────────────

export async function loadBankingSettings(
  workspaceId: string
): Promise<BankingSettings> {
  try {
    const { data: row } = await supabase
      .from("workspace_settings")
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("category", "banking")
      .maybeSingle();
    if (!row?.data) return { ...defaultBankingSettings };
    return { ...defaultBankingSettings, ...(row.data as Partial<BankingSettings>) };
  } catch (err) {
    console.error("[Banking] Failed to load settings:", err);
    return { ...defaultBankingSettings };
  }
}

export async function saveBankingSettings(
  workspaceId: string,
  settings: BankingSettings
): Promise<void> {
  await supabase
    .from("workspace_settings")
    .upsert(
      { workspace_id: workspaceId, category: "banking", data: settings },
      { onConflict: "workspace_id,category" }
    );
}

// ── CRUD ──────────────────────────────────────────────────────────────────

function rowToTransaction(row: Record<string, unknown>): BankingTransaction {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    transactionDate: row.transaction_date as string,
    amount: Number(row.amount),
    reference: row.reference as string | undefined,
    cardType: row.card_type as string | undefined,
    terminalId: row.terminal_id as string | undefined,
    description: row.description as string | undefined,
    matchedInvoiceId: (row.matched_invoice_id as string | null) ?? null,
    matchStatus: (row.match_status as MatchStatus) ?? "unmatched",
    rawData: (row.raw_data as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
  };
}

export async function getBankingTransactions(
  workspaceId: string
): Promise<BankingTransaction[]> {
  const { data, error } = await supabase
    .from("banking_transactions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("transaction_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToTransaction);
}

/**
 * Import a batch of transactions, deduplicating client-side before inserting.
 *
 * We avoid relying on a DB unique constraint for dedup because:
 *   - `reference` can be NULL, and PostgreSQL treats NULLs as distinct
 *   - A constraint on (workspace_id, transaction_date, amount) would
 *     incorrectly block legitimate different transactions on the same day
 *     for the same amount (e.g. multiple R550 iKhokha payments).
 *
 * Instead we do a two-pass client-side dedup:
 *   1. Remove exact duplicates within the input array
 *   2. Check which rows already exist in the DB and skip them
 */
export async function importTransactions(
  workspaceId: string,
  transactions: Omit<BankingTransaction, "id" | "workspaceId" | "createdAt" | "matchStatus" | "matchedInvoiceId">[]
): Promise<number> {
  if (!transactions.length) return 0;

  // ── Dedup key helper ──────────────────────────────────────────────────
  // When a transaction has a non-empty reference, use (date|amount|ref) as the
  // unique key.  When reference is null/empty we fall back to
  // (date|amount|desc[:20]) so that two legitimate R550 payments on the same
  // day — each with no reference — are NOT incorrectly collapsed into one.
  function dedupKey(
    date: string,
    amount: number,
    reference: string | null | undefined,
    description: string | null | undefined
  ): string {
    const ref = reference?.trim() ?? "";
    if (ref) return `ref|${date}|${amount}|${ref}`;
    const descSnippet = (description?.trim() ?? "").slice(0, 20);
    return `desc|${date}|${amount}|${descSnippet}`;
  }

  // ── Pass 1: Remove exact duplicates within the input array ────────────
  const seen = new Set<string>();
  const deduped: typeof transactions = [];
  for (const t of transactions) {
    const key = dedupKey(t.transactionDate, t.amount, t.reference, t.description);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(t);
  }

  // ── Pass 2: Check which rows already exist in the DB ──────────────────
  // Build a set of existing dedup keys for this workspace.
  const { data: existing } = await supabase
    .from("banking_transactions")
    .select("transaction_date,amount,reference,description")
    .eq("workspace_id", workspaceId);

  const existingSet = new Set<string>();
  if (existing) {
    for (const row of existing) {
      existingSet.add(
        dedupKey(
          row.transaction_date as string,
          row.amount as number,
          row.reference as string | null,
          row.description as string | null
        )
      );
    }
  }

  const newRows: typeof transactions = [];
  for (const t of deduped) {
    const key = dedupKey(t.transactionDate, t.amount, t.reference, t.description);
    if (existingSet.has(key)) continue;
    newRows.push(t);
  }

  if (!newRows.length) return 0;

  const rows = newRows.map((t) => ({
    workspace_id: workspaceId,
    transaction_date: t.transactionDate,
    amount: t.amount,
    reference: t.reference ?? null,
    card_type: t.cardType ?? null,
    terminal_id: t.terminalId ?? null,
    description: t.description ?? null,
    match_status: "unmatched",
    raw_data: t.rawData ?? {},
  }));

  // Insert without onConflict — client-side dedup handles everything.
  const { data, error } = await supabase
    .from("banking_transactions")
    .insert(rows)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function updateMatchStatus(
  transactionId: string,
  matchStatus: MatchStatus,
  matchedInvoiceId: string | null = null
): Promise<void> {
  const { error } = await supabase
    .from("banking_transactions")
    .update({ match_status: matchStatus, matched_invoice_id: matchedInvoiceId })
    .eq("id", transactionId);
  if (error) throw error;
}

export async function deleteTransaction(transactionId: string): Promise<void> {
  const { error } = await supabase
    .from("banking_transactions")
    .delete()
    .eq("id", transactionId);
  if (error) throw error;
}

// ── Live API fetch (via Edge Function) ──────────────────────────────────────

/**
 * Fetches transaction history from the iKhokha API via the
 * `ikhokha-fetch-history` Supabase Edge Function, then imports them.
 * Returns the number of new rows inserted.
 */
export async function fetchAndImportFromAPI(
  workspaceId: string,
  startDate: string,
  endDate: string
): Promise<{ imported: number; total: number }> {
  const fnUrl = `${SUPABASE_URL}/functions/v1/ikhokha-fetch-history`;

  const resp = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ workspaceId, startDate, endDate }),
  });

  const json = await resp.json();
  if (!json.ok) throw new Error(json.error ?? "Fetch failed");

  const rows: ParsedRow[] = (json.transactions ?? []).map((tx: any) => ({
    transactionDate: tx.transactionDate,
    amount: tx.amount,
    reference: tx.reference ?? undefined,
    description: tx.description ?? undefined,
    cardType: tx.cardType ?? undefined,
  }));

  if (!rows.length) return { imported: 0, total: 0 };
  const imported = await importTransactions(workspaceId, rows);
  return { imported, total: json.count };
}

// ── CSV Parser (iKhokha export format) ────────────────────────────────────

export interface ParsedRow {
  transactionDate: string;
  amount: number;
  reference?: string;
  cardType?: string;
  terminalId?: string;
  description?: string;
  rawData: Record<string, unknown>;
}

/**
 * Parse an iKhokha CSV export. The format is:
 *   Date,Amount,Card Type,Reference,Terminal ID,Description
 * (or similar — we do flexible header detection)
 */
export function parseIkhokhaCSV(csv: string): ParsedRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);

  const dateIdx    = col("date") !== -1 ? col("date") : col("transaction date");
  const amountIdx  = col("amount") !== -1 ? col("amount") : col("total");
  const refIdx     = col("reference") !== -1 ? col("reference") : col("ref");
  const cardIdx    = col("card type") !== -1 ? col("card type") : col("cardtype");
  const termIdx    = col("terminal id") !== -1 ? col("terminal id") : col("terminal");
  const descIdx    = col("description") !== -1 ? col("description") : col("desc");

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 2) continue;

    const rawAmount = cells[amountIdx]?.replace(/[^0-9.\-]/g, "") ?? "0";
    const amount = parseFloat(rawAmount);
    if (isNaN(amount)) continue;

    // Parse date — try dd/MM/yyyy, yyyy-MM-dd, MM/dd/yyyy
    let dateStr = cells[dateIdx] ?? "";
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
      const [d, m, y] = dateStr.split("/");
      dateStr = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    } else if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
      const [d, m, y] = dateStr.split("-");
      dateStr = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }

    const rawData: Record<string, unknown> = {};
    header.forEach((h, idx) => { rawData[h] = cells[idx]; });

    rows.push({
      transactionDate: dateStr,
      amount,
      reference: refIdx !== -1 ? cells[refIdx] || undefined : undefined,
      cardType:  cardIdx !== -1 ? cells[cardIdx] || undefined : undefined,
      terminalId: termIdx !== -1 ? cells[termIdx] || undefined : undefined,
      description: descIdx !== -1 ? cells[descIdx] || undefined : undefined,
      rawData,
    });
  }
  return rows;
}

// ── Auto-match ────────────────────────────────────────────────────────────

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  total: number;
  invoiceDate: string;
  customerName: string;
}

/**
 * Auto-match unmatched transactions against unpaid invoices.
 * Returns array of { transactionId, invoiceId } pairs to confirm.
 */
export function autoMatch(
  transactions: BankingTransaction[],
  invoices: InvoiceSummary[],
  settings: BankingSettings
): Array<{ transactionId: string; invoiceId: string; confidence: "exact" | "fuzzy" }> {
  const results: Array<{ transactionId: string; invoiceId: string; confidence: "exact" | "fuzzy" }> = [];
  const usedInvoiceIds = new Set<string>();

  for (const tx of transactions) {
    if (tx.matchStatus !== "unmatched") continue;

    const txDate = new Date(tx.transactionDate).getTime();

    let best: { inv: InvoiceSummary; confidence: "exact" | "fuzzy" } | null = null;

    for (const inv of invoices) {
      if (usedInvoiceIds.has(inv.id)) continue;

      const amountDiff = Math.abs(tx.amount - inv.total);
      if (amountDiff > settings.autoMatchAmountTolerance) continue;

      const invDate = new Date(inv.invoiceDate).getTime();
      const daysDiff = Math.abs((txDate - invDate) / 86_400_000);
      if (daysDiff > settings.autoMatchDaysTolerance) continue;

      const conf: "exact" | "fuzzy" = amountDiff === 0 && daysDiff === 0 ? "exact" : "fuzzy";
      if (!best || conf === "exact") best = { inv, confidence: conf };
    }

    if (best) {
      results.push({ transactionId: tx.id, invoiceId: best.inv.id, confidence: best.confidence });
      usedInvoiceIds.add(best.inv.id);
    }
  }

  return results;
}
