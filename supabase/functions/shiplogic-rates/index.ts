// Supabase Edge Function — proxies delivery rate requests to the ShipLogic API.
// Reads the workspace's ShipLogic API key + sender address from workspace_settings
// (category = 'ecommerce') so the key is never exposed to the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const {
      workspaceId,
      deliveryStreet,
      deliverySuburb,
      deliveryCity,
      deliveryPostalCode,
      totalWeightKg,
    } = body;

    if (!workspaceId || !deliveryStreet || !deliveryCity || !deliveryPostalCode) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: workspaceId, deliveryStreet, deliveryCity, deliveryPostalCode",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load ecommerce settings from workspace_settings
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: row, error: dbError } = await supabase
      .from("workspace_settings")
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("category", "ecommerce")
      .maybeSingle();

    if (dbError) {
      console.error("[shiplogic-rates] DB error:", dbError);
      return new Response(JSON.stringify({ error: "Failed to load workspace settings" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const settings = (row?.data ?? {}) as Record<string, any>;

    const shiplogicApiKey: string = settings.shiplogicApiKey ?? "";
    if (!shiplogicApiKey.trim()) {
      return new Response(JSON.stringify({ error: "ShipLogic not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const senderCompany: string =
      settings.shiplogicSenderCompany || settings.storeName || "Sender";
    const senderStreet: string = settings.shiplogicSenderStreet ?? "";
    const senderSuburb: string = settings.shiplogicSenderSuburb ?? "";
    const senderCity: string = settings.shiplogicSenderCity ?? "";
    const senderPostalCode: string = settings.shiplogicSenderPostalCode ?? "";
    // SR Components: all products are small electronics that fit in an A5 Satchel.
    // Standardised to A5 Satchel dimensions (26×19×5cm, 1kg) — matches Fastway's smallest satchel.
    const weightKg = 1;

    if (!senderStreet || !senderCity || !senderPostalCode) {
      return new Response(
        JSON.stringify({ error: "Sender address not configured. Please fill in the Courier sender address in Ecommerce Settings → Courier tab." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ratesPayload = {
      collection_address: {
        type: "business",
        company: senderCompany,
        street_address: senderStreet,
        local_area: senderSuburb,
        city: senderCity,
        code: senderPostalCode,
        country: "ZA",
      },
      delivery_address: {
        type: "residential",
        street_address: deliveryStreet,
        local_area: deliverySuburb ?? "",
        city: deliveryCity,
        code: deliveryPostalCode,
        country: "ZA",
      },
      parcels: [
        {
          submitted_length_cm: 26,
          submitted_width_cm: 19,
          submitted_height_cm: 5,
          submitted_weight_kg: weightKg,
        },
      ],
    };

    console.log("[shiplogic-rates] Requesting rates:", JSON.stringify(ratesPayload, null, 2));

    const shiplogicResp = await fetch("https://api.shiplogic.com/rates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${shiplogicApiKey.trim()}`,
      },
      body: JSON.stringify(ratesPayload),
    });

    let shiplogicData: any;
    const contentType = shiplogicResp.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      shiplogicData = await shiplogicResp.json();
    } else {
      const text = await shiplogicResp.text();
      console.error("[shiplogic-rates] Non-JSON response from ShipLogic:", shiplogicResp.status, text.slice(0, 300));
      return new Response(
        JSON.stringify({ error: `ShipLogic API error (${shiplogicResp.status}): ${text.slice(0, 200)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!shiplogicResp.ok) {
      const errMsg = shiplogicData?.error || shiplogicData?.message || JSON.stringify(shiplogicData);
      console.error("[shiplogic-rates] ShipLogic error:", shiplogicResp.status, errMsg);
      return new Response(JSON.stringify({ error: `ShipLogic: ${errMsg}` }), {
        status: shiplogicResp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // shiplogicData.rates is an array of rate objects.
    // Each rate typically has { service_level: { name }, rate: { total } } shape.
    const rates: any[] = Array.isArray(shiplogicData.rates) ? shiplogicData.rates : [];

    if (rates.length === 0) {
      return new Response(
        JSON.stringify({ error: "No rates returned by ShipLogic", raw: shiplogicData }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log first rate to diagnose field structure
    console.log("[shiplogic-rates] First rate object:", JSON.stringify(rates[0], null, 2));

    // Extract price — ShipLogic returns rate as a direct number: { rate: 69.73, ... }
    const extractPrice = (r: any): number => {
      if (typeof r?.rate === 'number') return r.rate;
      // Fallbacks for other possible structures
      const val =
        r?.rate?.total ??
        r?.rate?.price ??
        r?.total_price ??
        r?.total ??
        r?.price ??
        null;
      return val !== null ? Number(val) : 0;
    };

    // Find the cheapest rate (skip any with price 0 if others exist)
    const priced = rates.filter(r => extractPrice(r) > 0);
    const pool = priced.length > 0 ? priced : rates;
    const cheapest = pool.reduce((best: any, current: any) =>
      extractPrice(current) < extractPrice(best) ? current : best
    );

    const cheapestAmount = extractPrice(cheapest);
    const serviceName: string =
      cheapest?.service_level?.name ??
      cheapest?.service?.name ??
      cheapest?.service_level_name ??
      cheapest?.serviceName ??
      cheapest?.name ??
      "Standard";

    return new Response(
      JSON.stringify({
        rate: cheapestAmount,
        service: serviceName,
        currency: "ZAR",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[shiplogic-rates] Unhandled error:", err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
