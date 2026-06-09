// OCR Extract Edge Function
//
// Takes a base64 image of a receipt/slip, sends it to NVIDIA's vision model
// using the workspace's existing sr_bot_settings credentials, and returns
// structured JSON: vendor, slip number, date, subtotal, VAT, total, line items.
//
// Why server-side: NVIDIA API key lives in sr_bot_settings.api_key — must
// never reach the browser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

// NVIDIA's strongest vision model on integrate.api.nvidia.com.
// Falls back to 11b if 90b is unavailable for the account.
const VISION_MODELS = [
  "meta/llama-3.2-90b-vision-instruct",
  "meta/llama-3.2-11b-vision-instruct",
];

const EXTRACT_PROMPT = `You are an expert receipt/invoice data extractor for South African businesses.
The user will provide a photograph of a paper slip (till slip, invoice, or receipt). Read it carefully and extract the structured data below.

Return ONLY a single JSON object — no commentary, no markdown fences. The JSON must follow this exact shape:

{
  "vendorName": "string",            // Company / shop name printed at the top of the slip
  "slipNumber": "string",            // Invoice / receipt / till slip number, or "" if none
  "date": "YYYY-MM-DD",              // The transaction date in ISO format, or "" if unreadable
  "subtotal": number,                // Pre-VAT amount in ZAR. If only the total is shown, set to 0.
  "vatAmount": number,               // VAT/tax in ZAR. If not shown, set to 0.
  "totalAmount": number,             // Grand total in ZAR (subtotal + VAT). REQUIRED — try hard to find this.
  "paymentMethod": "cash" | "card" | "eft" | "other",
  "lineItems": [
    { "description": "string", "quantity": number, "unitPrice": number, "amount": number }
  ],
  "confidence": number               // Your confidence 0-100 in how accurate the extraction is
}

Rules:
- Currency symbols (R, ZAR, $) must be stripped from numbers. Use plain decimals.
- South African slips often show VAT as "VAT @ 15%" — extract the VAT *amount* (ZAR), not the rate.
- If the slip is unreadable, return the JSON with empty strings/zeros and confidence 0.
- Do not invent values you cannot read. Empty/zero is better than wrong.
- Output JSON ONLY. No prose before or after.`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callNvidiaVision(baseUrl: string, apiKey: string, model: string, imageDataUrl: string) {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACT_PROMPT },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      temperature: 0.0,
      top_p: 0.95,
      max_tokens: 1500,
      stream: false,
    }),
  });
}

function extractJsonFromText(text: string): any {
  // Strip code fences and prose if any
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  // Find first { and matching last }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model output");
  const jsonStr = s.slice(start, end + 1);
  return JSON.parse(jsonStr);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return jsonResponse({ error: "Missing authorization" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json() as { workspace_id?: string; image_data_url?: string };
    const { workspace_id, image_data_url } = body;
    if (!workspace_id) return jsonResponse({ error: "workspace_id required" }, 400);
    if (!image_data_url || !image_data_url.startsWith("data:image/")) {
      return jsonResponse({ error: "image_data_url must be a data:image/... URL" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: membership } = await admin
      .from("workspace_members")
      .select("uid")
      .eq("workspace_id", workspace_id)
      .eq("uid", userId)
      .maybeSingle();
    if (!membership) return jsonResponse({ error: "Not a member of this workspace" }, 403);

    const { data: settings } = await admin
      .from("sr_bot_settings")
      .select("base_url, api_key, is_enabled")
      .eq("workspace_id", workspace_id)
      .maybeSingle();
    if (!settings) return jsonResponse({ error: "AI settings not configured for this workspace" }, 404);
    if (!settings.is_enabled) return jsonResponse({ error: "AI assistant is disabled" }, 403);
    if (!settings.api_key) return jsonResponse({ error: "AI API key not configured" }, 400);

    // Try the strongest model first, fall back to 11b on auth/404 errors
    let lastErr: string | null = null;
    for (const model of VISION_MODELS) {
      const resp = await callNvidiaVision(settings.base_url, settings.api_key, model, image_data_url);
      if (resp.ok) {
        const json = await resp.json();
        const content = json?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) {
          lastErr = `Model ${model} returned empty content`;
          continue;
        }
        try {
          const extracted = extractJsonFromText(content);
          return jsonResponse({ data: extracted, model_used: model, raw: content });
        } catch (e) {
          lastErr = `Model ${model} returned unparseable JSON: ${(e as Error).message}. Raw: ${content.slice(0, 400)}`;
          continue;
        }
      } else {
        const text = await resp.text();
        lastErr = `Model ${model} failed (${resp.status}): ${text.slice(0, 400)}`;
        // 401/403/404 = config issue, no point trying fallback models
        if (resp.status === 401 || resp.status === 403) {
          return jsonResponse({ error: lastErr }, 502);
        }
      }
    }

    return jsonResponse({ error: lastErr || "All vision models failed" }, 502);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
