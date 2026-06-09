// Creates a real Fastway/ShipLogic shipment when an order is marked
// "Ready for Collection". Returns a waybill number that is saved on the order.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const { workspaceId, order } = await req.json() as {
      workspaceId: string;
      order: {
        id: string;
        orderNumber?: string;
        customerInfo?: { name?: string; email?: string; phone?: string };
        shippingAddress?: { street?: string; address?: string; suburb?: string; city?: string; state?: string; postalCode?: string };
        items?: Array<{ productName?: string; quantity?: number }>;
        shippingCost?: number;
      };
    };

    if (!workspaceId || !order?.id) {
      return json({ error: "Missing workspaceId or order" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load ecommerce settings (ShipLogic API key + sender address)
    const { data: row } = await supabase
      .from("workspace_settings")
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("category", "ecommerce")
      .maybeSingle();

    const settings = (row?.data ?? {}) as Record<string, any>;
    const apiKey: string = settings.shiplogicApiKey ?? "";

    if (!apiKey.trim()) return json({ error: "ShipLogic not configured — add your API key in Ecommerce Settings → Courier tab." }, 400);

    const senderStreet: string = settings.shiplogicSenderStreet ?? "";
    const senderSuburb: string = settings.shiplogicSenderSuburb ?? "";
    const senderCity: string   = settings.shiplogicSenderCity ?? "";
    const senderPostal: string = settings.shiplogicSenderPostalCode ?? "";
    const senderCompany: string = settings.shiplogicSenderCompany || settings.storeName || "Sender";

    if (!senderStreet || !senderCity || !senderPostal) {
      return json({ error: "Sender address not configured. Fill in Ecommerce Settings → Courier → Collection Address." }, 400);
    }

    const addr = order.shippingAddress ?? {};
    const deliveryStreet = addr.street || addr.address || "";
    const deliverySuburb = addr.suburb || addr.state || "";
    const deliveryCity   = addr.city || "";
    const deliveryPostal = addr.postalCode || "";
    const recipientName  = order.customerInfo?.name || "Customer";
    const recipientPhone = order.customerInfo?.phone || "";

    if (!deliveryStreet || !deliveryCity || !deliveryPostal) {
      return json({ error: "Delivery address is incomplete — street, city and postal code are required." }, 400);
    }

    // Next business day for collection
    const collectionDate = nextBusinessDay();

    const itemDesc = (order.items ?? [])
      .map(i => `${i.quantity ?? 1}x ${i.productName ?? "Item"}`)
      .join(", ")
      .slice(0, 120);

    const payload = {
      service_level_code: "ECO",
      parcel_description: itemDesc || "Electronics Components",
      special_instructions_collection: "Please ring bell / call ahead",
      special_instructions_delivery: "Handle with care",
      collection_address: {
        type: "business",
        company: senderCompany,
        street_address: senderStreet,
        local_area: senderSuburb,
        city: senderCity,
        code: senderPostal,
        country: "ZA",
      },
      delivery_address: {
        type: "residential",
        company: recipientName,
        street_address: deliveryStreet,
        local_area: deliverySuburb,
        city: deliveryCity,
        code: deliveryPostal,
        country: "ZA",
        phone: recipientPhone,
      },
      parcels: [{
        submitted_length_cm: 26,
        submitted_width_cm: 19,
        submitted_height_cm: 5,
        submitted_weight_kg: 1,
      }],
      collection_date: collectionDate,
      customer_reference: order.orderNumber || order.id,
    };

    console.log("[create-fastway-shipment] Creating shipment:", JSON.stringify(payload));

    const resp = await fetch("https://api.shiplogic.com/shipments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(payload),
    });

    const ct = resp.headers.get("content-type") ?? "";
    const data = ct.includes("application/json") ? await resp.json() : await resp.text();

    if (!resp.ok) {
      const msg = typeof data === "object" ? (data.error || data.message || JSON.stringify(data)) : String(data).slice(0, 300);
      console.error("[create-fastway-shipment] ShipLogic error:", resp.status, msg);
      return json({ error: `ShipLogic: ${msg}` }, resp.status);
    }

    const waybill: string =
      data?.waybill_number ??
      data?.waybillNumber ??
      data?.tracking_number ??
      data?.id ??
      "";

    console.log("[create-fastway-shipment] ✅ Shipment created, waybill:", waybill, "raw:", JSON.stringify(data));

    return json({
      success: true,
      waybillNumber: waybill,
      collectionDate,
      shipmentId: data?.id ?? "",
      service: data?.service_level?.name ?? "Economy",
    });
  } catch (err: any) {
    console.error("[create-fastway-shipment] Error:", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function nextBusinessDay(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  // Skip Saturday (6) and Sunday (0)
  if (d.getDay() === 6) d.setDate(d.getDate() + 2);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}
