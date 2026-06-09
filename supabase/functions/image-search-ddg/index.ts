// DuckDuckGo Images Edge Function
//
// Browser can't scrape DuckDuckGo directly (CORS). This function does it
// server-side. Returns up to 20 image candidates per query.
//
// Protocol (unofficial but stable for years):
//   1. GET duckduckgo.com/?q=... → response HTML contains a `vqd` token
//   2. GET duckduckgo.com/i.js?q=...&vqd=...&o=json → JSON list of images

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
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) return json({ error: "Server misconfigured" }, 500);

    // Auth check — only logged-in users
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json() as { query?: string };
    const query = (body?.query || "").trim();
    if (!query) return json({ error: "query is required" }, 400);

    // Step 1: fetch the HTML page to get the vqd token
    const initRes = await fetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
      { headers: { "User-Agent": UA, "Accept": "text/html" } },
    );
    if (!initRes.ok) {
      return json({ error: `DDG init failed: ${initRes.status}` }, 502);
    }
    const initHtml = await initRes.text();
    const vqdMatch = initHtml.match(/vqd=["']?([\d-]+)["']?/);
    const vqd = vqdMatch?.[1];
    if (!vqd) return json({ error: "Could not extract DDG token" }, 502);

    // Step 2: fetch the JSON results
    const jsonUrl =
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}` +
      `&vqd=${vqd}&f=,,,,,&p=1&v7exp=a`;
    const jsonRes = await fetch(jsonUrl, {
      headers: {
        "User-Agent": UA,
        "Accept": "application/json",
        "Referer": "https://duckduckgo.com/",
      },
    });
    if (!jsonRes.ok) {
      return json({ error: `DDG results failed: ${jsonRes.status}` }, 502);
    }
    const data = await jsonRes.json();
    const results = (data.results || []).slice(0, 20).map((r: any) => ({
      url: r.image,
      thumb: r.thumbnail,
      title: r.title,
      source: r.url,
      width: r.width,
      height: r.height,
    }));

    return json({ provider: "ddg", query, count: results.length, results });
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
