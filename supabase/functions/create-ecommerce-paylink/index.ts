// Supabase Edge Function — creates iKhokha PayLink for ecommerce checkout.
// Reads per-workspace iKhokha credentials from workspace_settings (category = ikhokhaEcom).
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
  const basePath = url.pathname;
  const payload = basePath + body;
  return payload.replace(/[\\"']/g, "\\$&").replace(/\u0000/g, "\\0");
}

Deno.serve(async (req: Request) => {
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
    const requestData = await req.json();
    const {
      workspaceId,
      amount,           // in cents
      description,
      externalTransactionID,
      customerName,
      customerEmail,
      customerPhone,
      deliveryAddress,
      deliveryOption,
      deliveryFee,
      orderData,
      callbackUrl,
      successPageUrl,
      failurePageUrl,
      cancelUrl
    } = requestData;

    if (!workspaceId || amount == null) {
      return new Response(JSON.stringify({ error: "Missing required fields: workspaceId, amount" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load iKhokha credentials from Supabase workspace_settings
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Try the dedicated ecommerce category first, then the main ecommerce settings,
    // then fall back to CRM iKhokha settings for older workspaces.
    let { data: row } = await supabase
      .from("workspace_settings")
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("category", "ikhokhaEcom")
      .maybeSingle();

    if (!row?.data) {
      const { data: ecommerceRow } = await supabase
        .from("workspace_settings")
        .select("data")
        .eq("workspace_id", workspaceId)
        .eq("category", "ecommerce")
        .maybeSingle();
      row = ecommerceRow;
    }

    if (!row?.data) {
      // Fall back to CRM ikhokha settings
      const { data: fallbackRow } = await supabase
        .from("workspace_settings")
        .select("data")
        .eq("workspace_id", workspaceId)
        .eq("category", "ikhokhaJob")
        .maybeSingle();
      row = fallbackRow;
    }

    if (!row?.data) {
      return new Response(JSON.stringify({ error: "iKhokha settings not configured for this workspace" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawSettings = row.data as {
      appId?: string;
      appSecret?: string;
      enabled?: boolean;
      ikhokhaAppId?: string;
      ikhokhaAppSecret?: string;
      enableCardPayments?: boolean;
    };
    const settings = {
      appId: rawSettings.appId || rawSettings.ikhokhaAppId,
      appSecret: rawSettings.appSecret || rawSettings.ikhokhaAppSecret,
      enabled: rawSettings.enabled ?? rawSettings.enableCardPayments ?? false,
    };

    if (!settings.enabled) {
      return new Response(JSON.stringify({ error: "iKhokha payments are disabled for this workspace" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { appId, appSecret } = settings;
    if (!appId || !appSecret) {
      return new Response(JSON.stringify({ error: "iKhokha API credentials are missing for this workspace" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const endpoint = "https://api.ikhokha.com/public-api/v1/api/payment";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const projectRef = supabaseUrl.replace("https://", "").replace(".supabase.co", "");
    const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/ikhokha-webhook`;

    const requestBody = {
      entityID: appId,
      externalEntityID: workspaceId,
      amount: Math.round(amount), // must be in cents
      currency: "ZAR",
      requesterUrl: "https://srcomponents.co.za",
      mode: "live",
      description: description || `Online purchase - ${customerName || 'Customer'}`,
      externalTransactionID: externalTransactionID || `ECOM-${Date.now()}`,
      urls: {
        // Always use the Supabase webhook for payment status updates. The storefront
        // origin is only for customer-facing success/failure/cancel redirects.
        callbackUrl: webhookUrl,
        successPageUrl: successPageUrl || "https://srcomponents.co.za/payment-success",
        failurePageUrl: failurePageUrl || "https://srcomponents.co.za/payment-failed",
        cancelUrl: cancelUrl || "https://srcomponents.co.za/cart",
      },
    };
    
    // Add logging for debugging
    console.log("iKhokha request body:", JSON.stringify(requestBody, null, 2));

    const requestBodyStr = JSON.stringify(requestBody);
    const payloadToSign = createPayloadToSign(endpoint, requestBodyStr);
    const signature = await hmacSHA256(appSecret, payloadToSign);

    console.log("iKhokha request headers:", {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "IK-APPID": appId.trim(),
      "IK-SIGN": signature.trim(),
    });
    
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "IK-APPID": appId.trim(),
        "IK-SIGN": signature.trim(),
      },
      body: requestBodyStr,
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error("[create-ecommerce-paylink] iKhokha error:", data);
      return new Response(JSON.stringify({ error: "Failed to create payment link", details: data }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Store a pending order for the customer's account dashboard and admin order view.
    try {
      if (orderData?.orderId) {
        const now = new Date().toISOString();
        const cartItems = Array.isArray(orderData.items) ? orderData.items : [];
        const subtotal = cartItems.reduce((sum: number, item: any) => {
          return sum + (Number(item.price || item.unitPrice || 0) * Number(item.quantity || 1));
        }, 0);
        const shippingCost = Number(orderData.deliveryFee ?? deliveryFee ?? 0);
        const totalAmount = Number(orderData.totalAmount ?? (amount / 100));
        const taxAmount = Math.max(0, totalAmount - subtotal - shippingCost);
        const orderId = String(orderData.orderId);
        const order = {
          id: orderId,
          orderNumber: orderId,
          customerId: orderData.userId || orderData.customerEmail || customerEmail || "guest",
          userId: orderData.userId,
          customerInfo: {
            name: orderData.customerName || customerName || "Customer",
            email: orderData.customerEmail || customerEmail || "",
            phone: orderData.customerPhone || customerPhone || "",
          },
          items: cartItems.map((item: any) => ({
            productId: item.productId,
            variantId: item.variantId,
            productName: item.productName || item.name || "Product",
            variantName: item.variantName || "",
            sku: item.sku || "",
            quantity: Number(item.quantity || 1),
            unitPrice: Number(item.price || item.unitPrice || 0),
            totalPrice: Number(item.totalPrice ?? ((item.price || item.unitPrice || 0) * (item.quantity || 1))),
            productImage: item.productImage,
          })),
          status: "pending",
          paymentStatus: "pending",
          ecommerceStage: "orders",
          fulfillmentStatus: "pending",
          subtotal,
          taxAmount,
          shippingCost,
          totalAmount,
          currency: "ZAR",
          shippingAddress: {
            street: orderData.address || deliveryAddress || "",
            address: orderData.address || deliveryAddress || "",
            city: "",
            state: "",
            postalCode: "",
          },
          paymentMethod: {
            type: "card",
            provider: "ikhokha",
            paylinkID: data.paylinkID,
            paylinkUrl: data.paylinkUrl,
            externalTransactionID: requestBody.externalTransactionID,
          },
          deliveryOption: orderData.deliveryOption || deliveryOption || "pickup",
          deliveryFee: shippingCost,
          notes: orderData.description || description,
          createdAt: now,
          updatedAt: now,
        };

        await supabase.from("orders").upsert(
          { id: orderId, workspace_id: workspaceId, data: order },
          { onConflict: "id" }
        );

        // Fire ecommerce notification for the new order
        try {
          const { data: feedRow } = await supabase
            .from("workspace_settings")
            .select("data")
            .eq("workspace_id", workspaceId)
            .eq("category", "ecommerce_notifications_feed")
            .maybeSingle();
          const existingItems: any[] = (feedRow?.data as any)?.items ?? [];
          const notif = {
            id: `entf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: "order",
            title: `New order ${orderId}`,
            body: `R${(Number(totalAmount)).toFixed(2)} from ${orderData?.customerName || customerName || "a customer"} · awaiting payment`,
            link: "ecommerce",
            read: false,
            createdAt: now,
          };
          await supabase.from("workspace_settings").upsert(
            { workspace_id: workspaceId, category: "ecommerce_notifications_feed", data: { items: [notif, ...existingItems].slice(0, 100) } },
            { onConflict: "workspace_id,category" }
          );
        } catch (ne) {
          console.warn("[create-ecommerce-paylink] Failed to fire order notification:", ne);
        }
      }
    } catch (e) {
      console.warn("[create-ecommerce-paylink] Failed to store pending ecommerce order:", e);
    }

    // Store pending paylink for tracking
    try {
      const existing = await supabase
        .from("workspace_settings")
        .select("data")
        .eq("workspace_id", workspaceId)
        .eq("category", "paymentLinks")
        .maybeSingle();

      const existingLinks: any[] = existing?.data?.links ?? existing?.data?.data ?? [];
      const newLink = {
        paylinkID: data.paylinkID,
        paylinkUrl: data.paylinkUrl,
        externalTransactionID: requestBody.externalTransactionID,
        amount,
        description,
        customerName,
        customerEmail,
        customerPhone,
        deliveryOption,
        deliveryFee,
        type: "ECOMMERCE",
        status: "PENDING",
        createdAt: new Date().toISOString(),
      };

      await supabase.from("workspace_settings").upsert(
        { workspace_id: workspaceId, category: "paymentLinks", data: { links: [...existingLinks, newLink] } },
        { onConflict: "workspace_id,category" }
      );
    } catch (e) {
      console.warn("[create-ecommerce-paylink] Failed to store paylink record:", e);
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[create-ecommerce-paylink] Error:", err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
