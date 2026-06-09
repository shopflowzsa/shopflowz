// Description Search Edge Function
//
// 1. Tries DuckDuckGo Instant Answer (good for common/Wikipedia topics)
// 2. Falls back to the workspace's configured AI model (for part numbers,
//    electronics components, SKUs — things DDG knows nothing about)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey    = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Server misconfigured" }, 500);

    // Auth check
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json() as { query?: string; workspaceId?: string };
    const query = (body?.query || "").trim();
    if (!query) return json({ error: "query is required" }, 400);

    // ── 1. Try DuckDuckGo Instant Answer ─────────────────────────────────────
    try {
      const ddgRes = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        { headers: { "User-Agent": UA, "Accept": "application/json" } },
      );
      if (ddgRes.ok) {
        const data = await ddgRes.json();
        const description: string =
          data.AbstractText ||
          data.Answer ||
          (data.RelatedTopics?.[0]?.Text ?? "");
        if (description) return json({ description, query, source: "ddg" });
      }
    } catch { /* fall through to AI */ }

    // ── 2. Fall back to workspace AI model ────────────────────────────────────
    const workspaceId = body?.workspaceId;
    if (!workspaceId) return json({ description: null, query });

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: settings } = await adminClient
      .from("sr_bot_settings")
      .select("base_url, api_key, model")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!settings?.api_key || !settings?.base_url) {
      return json({ description: null, query });
    }

    const aiResp = await fetch(`${settings.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.api_key}`,
      },
      body: JSON.stringify({
        model: settings.model || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a product description assistant for an electronics parts store. When given a part number or product name, provide a concise 1-2 sentence technical description suitable for an inventory catalogue. Only describe the component — no marketing language. If you are not confident what the part is, say so briefly.",
          },
          {
            role: "user",
            content: `Describe this electronics component for an inventory catalogue: "${query}"`,
          },
        ],
        max_tokens: 120,
        temperature: 0.3,
      }),
    });

    if (!aiResp.ok) return json({ description: null, query });
    const aiData = await aiResp.json() as { choices?: { message?: { content?: string } }[] };
    const description = aiData.choices?.[0]?.message?.content?.trim() || null;
    return json({ description, query, source: "ai" });

  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
