// Supabase Edge Function — ikhokha-fetch-history
// Fetches iKhokha payment terminal history for a date range.
// Credentials (appId + appSecret) are read from workspace_settings (category='banking').
//
// POST body: { workspaceId: string, startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }
// Returns: { ok: true, transactions: Array<{ transactionDate, amount, reference, description, cardType, externalId }> }

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
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function createPayloadToSign(urlPath: string, body: string): string {
  const url = new URL(urlPath);
  const payload = url.pathname + url.search + body;
  return payload.replace(/[\\"']/g, "\\$&").replace(/\u0000/g, "\\0");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { workspaceId, startDate, endDate } = await req.json();

    if (!workspaceId || !startDate || !endDate) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing workspaceId, startDate, or endDate" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load API credentials from banking settings
    const { data: row } = await supabase
      .from("workspace_settings")
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("category", "banking")
      .maybeSingle();

    const settings = row?.data as Record<string, string> | null;
    const appId = settings?.ikAppId?.trim();
    const appSecret = settings?.ikAppSecret?.trim();

    if (!appId || !appSecret) {
      return new Response(
        JSON.stringify({ ok: false, error: "iKhokha API credentials not configured. Add Application Key ID and Secret in Banking → Settings." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call iKhokha terminal transaction history API
    const historyUrl = `https://api.ikhokha.com/public-api/v1/api/terminal/transactions?startDate=${startDate}&endDate=${endDate}`;
    const payloadToSign = createPayloadToSign(historyUrl, "");
    const signature = await hmacSHA256(appSecret, payloadToSign);

    const resp = await fetch(historyUrl, {
      headers: {
        "IK-APPID": appId.trim(),
        "IK-SIGN": signature.trim(),
      },
    });

    if (!resp.ok) {
      const body = await resp.text();
      const isAuthErr = resp.status === 422 || body.toLowerCase().includes("signature") || body.toLowerCase().includes("invalid");
      return new Response(
        JSON.stringify({
          ok: false,
          error: isAuthErr
            ? `Invalid iKhokha credentials (${resp.status}). Check your Application Key ID and Secret in Banking → Settings → iKhokha Merchant Portal → My Account → Your secure key.`
            : `iKhokha API error ${resp.status}: ${body}`,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const raw = await resp.json();
    const items: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);

    // Normalise terminal transaction response into the shape bankingService.importTransactions expects
    // Terminal transactions have different field names than PayLink transactions
    const transactions = items.map((tx: any) => ({
      transactionDate: tx.transactionDate ?? tx.createdAt
        ? (tx.transactionDate ?? tx.createdAt).split("T")[0]
        : startDate,
      // Terminal amounts may be in cents or rands depending on API response format
      amount: typeof tx.amount === "number"
        ? (tx.amount < 1000 ? tx.amount : tx.amount / 100) // heuristic: if < 1000, assume rands; else cents
        : parseFloat(tx.amount ?? "0"),
      reference: tx.reference ?? tx.terminalId ?? null,
      description: tx.description ?? tx.merchantName ?? null,
      cardType: tx.cardType ?? tx.cardTypeName ?? null,
      terminalId: tx.terminalId ?? null,
    }));

    return new Response(
      JSON.stringify({ ok: true, count: transactions.length, transactions }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[ikhokha-fetch-history]", err);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
