// Supabase Edge Function — replaces Firebase Cloud Function ikhokhaWebhook
// Receives payment notifications from iKhokha and updates task status in Supabase workspace_state.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, IK-APPID, IK-SIGN",
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
  const payload = url.pathname + body;
  return payload.replace(/[\\"']/g, "\\$&").replace(/\u0000/g, "\\0");
}

function paymentWasSuccessful(payload: any): boolean {
  const values = [
    payload.status,
    payload.paymentStatus,
    payload.transactionStatus,
    payload.result,
    payload.event,
    payload.responseCode,
  ].map((value) => String(value ?? "").toUpperCase());

  return values.some((value) =>
    ["SUCCESS", "SUCCESSFUL", "PAID", "APPROVED", "COMPLETE", "COMPLETED", "00"].includes(value)
  );
}

function paymentFailed(payload: any): boolean {
  const values = [
    payload.status,
    payload.paymentStatus,
    payload.transactionStatus,
    payload.result,
    payload.event,
  ].map((value) => String(value ?? "").toUpperCase());

  return values.some((value) =>
    ["FAILED", "FAILURE", "CANCELLED", "CANCELED", "DECLINED", "EXPIRED"].includes(value)
  );
}

async function loadIkhokhaSettings(supabase: any, workspaceId: string) {
  const categories = ["ikhokhaEcom", "ecommerce", "ikhokhaJob"];

  for (const category of categories) {
    const { data: row } = await supabase
      .from("workspace_settings")
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("category", category)
      .maybeSingle();

    if (row?.data) {
      const raw = row.data as any;
      const appId = raw.appId || raw.ikhokhaAppId;
      const appSecret = raw.appSecret || raw.ikhokhaAppSecret;
      if (appId && appSecret) return { appId, appSecret };
    }
  }

  return null;
}

async function deductStockForOrder(supabase: any, workspaceId: string, order: any) {
  if (order.stockDeductedAt) return order;

  const now = new Date().toISOString();
  for (const item of order.items || []) {
    const productId = item.productId;
    const quantity = Number(item.quantity || 1);
    if (!productId || quantity <= 0) continue;

    const { data: inventoryRow, error } = await supabase
      .from("inventory")
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("id", productId)
      .maybeSingle();

    if (error || !inventoryRow?.data) {
      console.warn("[ikhokha-webhook] Inventory item not found for stock deduction:", productId, error);
      continue;
    }

    const inventoryItem = inventoryRow.data as any;
    const currentQuantity = Number(inventoryItem.quantity ?? inventoryItem.currentStock ?? 0);
    const nextQuantity = Math.max(0, currentQuantity - quantity);
    const updatedInventory = {
      ...inventoryItem,
      quantity: nextQuantity,
      currentStock: nextQuantity,
      lastStockUpdate: now,
      updatedAt: now,
    };

    await supabase
      .from("inventory")
      .update({ data: updatedInventory })
      .eq("workspace_id", workspaceId)
      .eq("id", productId);
  }

  return {
    ...order,
    stockDeductedAt: now,
  };
}

async function generateInvoiceNumber(supabase: any, workspaceId: string): Promise<string> {
  const { data: row } = await supabase
    .from("workspace_settings")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("category", "counters")
    .maybeSingle();

  const counters = row?.data || {};
  const nextValue = Number(counters.invoice || 0) + 1;
  await supabase
    .from("workspace_settings")
    .upsert(
      { workspace_id: workspaceId, category: "counters", data: { ...counters, invoice: nextValue } },
      { onConflict: "workspace_id,category" }
    );

  return `INV${String(nextValue).padStart(5, "0")}`;
}

function orderItemsToInvoiceItems(order: any) {
  return (order.items || []).map((item: any, index: number) => {
    const quantity = Number(item.quantity || 1);
    const price = Number(item.unitPrice || item.price || 0);
    const total = Number(item.totalPrice ?? price * quantity);
    return {
      id: `item_${Date.now()}_${index}`,
      productId: item.productId,
      productName: item.productName || "Product",
      sku: item.sku,
      description: item.variantName || item.productName || "Product",
      quantity,
      price,
      total,
    };
  });
}

function makeInvoiceEmailHtml(invoice: any): string {
  const rows = (invoice.items || []).map((item: any) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.productName || "Product"}<br><small>${item.sku || ""}</small></td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${item.quantity || 1}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">R${Number(item.price || 0).toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">R${Number(item.total || 0).toFixed(2)}</td>
    </tr>
  `).join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;max-width:720px;margin:0 auto;">
      <h2 style="margin-bottom:4px;">Paid Invoice ${invoice.invoiceNumber}</h2>
      <p style="margin-top:0;color:#6b7280;">Thank you for your payment.</p>
      <p><strong>Customer:</strong> ${invoice.customerName || "Customer"}</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px;text-align:left;">Item</th>
            <th style="padding:8px;text-align:right;">Qty</th>
            <th style="padding:8px;text-align:right;">Unit</th>
            <th style="padding:8px;text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="text-align:right;font-size:16px;">
        <div>Subtotal: R${Number(invoice.subtotal || 0).toFixed(2)}</div>
        <div>VAT: R${Number(invoice.tax || 0).toFixed(2)}</div>
        ${invoice.shippingCost ? `<div>Delivery: R${Number(invoice.shippingCost).toFixed(2)}</div>` : ""}
        <div style="font-size:20px;font-weight:bold;margin-top:8px;">Paid: R${Number(invoice.total || 0).toFixed(2)}</div>
      </div>
    </div>
  `;
}

function escapePdfText(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function wrapPdfLine(text: string, maxLength = 92): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function createInvoicePdfBase64(invoice: any): string {
  const fmt = (value: number) => `R${Number(value || 0).toFixed(2)}`;
  const rawLines = [
    "TAX INVOICE",
    `Invoice Number: ${invoice.invoiceNumber}`,
    `Invoice Date: ${invoice.invoiceDate}`,
    `Paid Date: ${invoice.paidDate || invoice.invoiceDate}`,
    "",
    "Bill To:",
    invoice.customerName || "Customer",
    invoice.customerEmail || "",
    invoice.customerPhone || "",
    "",
    "Items:",
    ...(invoice.items || []).flatMap((item: any) => {
      const product = item.productName || item.description || "Product";
      const sku = item.sku ? ` SKU: ${item.sku}` : "";
      return wrapPdfLine(`${product}${sku} | Qty ${item.quantity || 1} | Unit ${fmt(item.price)} | Total ${fmt(item.total)}`);
    }),
    "",
    `Subtotal: ${fmt(invoice.subtotal)}`,
    `VAT: ${fmt(invoice.tax)}`,
    invoice.shippingCost ? `Delivery: ${fmt(invoice.shippingCost)}` : "",
    `Total: ${fmt(invoice.total)}`,
    `Amount Paid: ${fmt(invoice.amountPaid)}`,
    `Balance Due: ${fmt(invoice.balanceDue)}`,
    "",
    "Payment Status: PAID",
    invoice.notes || "",
  ].filter((line) => line !== undefined);

  const contentLines: string[] = ["BT", "/F1 11 Tf", "50 792 Td", "14 TL"];
  let lineCount = 0;
  for (const rawLine of rawLines) {
    for (const line of wrapPdfLine(String(rawLine), 88)) {
      if (lineCount > 0) contentLines.push("T*");
      contentLines.push(`(${escapePdfText(line)}) Tj`);
      lineCount += 1;
      if (lineCount >= 52) break;
    }
    if (lineCount >= 52) break;
  }
  contentLines.push("ET");
  const stream = contentLines.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return btoa(pdf);
}

async function sendInvoiceEmail(supabase: any, workspaceId: string, invoice: any): Promise<string | null> {
  if (!invoice.customerEmail) return null;

  const { data: ecommerceSettingsRow } = await supabase
    .from("workspace_settings")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("category", "ecommerce")
    .maybeSingle();

  if (ecommerceSettingsRow?.data?.sendOrderConfirmationEmail === false) return null;

  const { data: emailRow } = await supabase
    .from("workspace_settings")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("category", "email")
    .maybeSingle();

  const es = emailRow?.data;
  if (!es?.enabled) return null;

  const { data: salesRow } = await supabase
    .from("workspace_settings")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("category", "sales")
    .maybeSingle();

  const fromName = es.fromName || salesRow?.data?.companyName || "SR Components";
  const fromEmail = es.fromEmail || es.smtpUser || "";
  const host = es.provider === "gmail" ? "smtp.gmail.com" : (es.smtpHost ?? "");
  const port = es.provider === "gmail" ? 587 : (es.smtpPort ?? 465);
  const secure = es.provider === "gmail" ? false : (es.smtpSecure ?? port === 465);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const resp = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      smtpConfig: {
        host,
        port,
        secure,
        user: es.smtpUser,
        pass: es.smtpPassword,
        fromName,
        fromEmail,
      },
      email: {
        from: `${fromName} <${fromEmail}>`,
        to: invoice.customerEmail,
        subject: `${invoice.invoiceNumber} from ${fromName}`,
        text: `Thank you for your payment. Invoice ${invoice.invoiceNumber} total: R${Number(invoice.total || 0).toFixed(2)}. A PDF copy is attached.`,
        html: makeInvoiceEmailHtml(invoice),
        attachments: [
          {
            filename: `${invoice.invoiceNumber}.pdf`,
            content: createInvoicePdfBase64(invoice),
            contentType: "application/pdf",
          },
        ],
      },
    }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.success) throw new Error(json.error || `Email failed (${resp.status})`);
  return new Date().toISOString();
}

async function ensurePaidInvoiceForOrder(supabase: any, workspaceId: string, order: any) {
  if (order.invoiceId) return order;

  const now = new Date().toISOString();
  const invoiceNumber = await generateInvoiceNumber(supabase, workspaceId);
  const items = orderItemsToInvoiceItems(order);
  const subtotal = Number(order.subtotal ?? items.reduce((sum: number, item: any) => sum + Number(item.total || 0), 0));
  const tax = Number(order.taxAmount || 0);
  const shippingCost = Number(order.shippingCost || 0);
  const total = Number(order.totalAmount ?? subtotal + tax + shippingCost);
  const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const invoice = {
    id: invoiceId,
    invoiceNumber,
    customerId: order.userId || order.customerId || order.customerInfo?.email || "ecommerce_customer",
    customerName: order.customerInfo?.name || "Customer",
    customerEmail: order.customerInfo?.email,
    customerPhone: order.customerInfo?.phone,
    invoiceDate: now.split("T")[0],
    dueDate: now.split("T")[0],
    terms: "due-on-receipt",
    purchaseOrder: order.orderNumber || order.id,
    items,
    subtotal,
    discountPercent: 0,
    discountAmount: 0,
    shippingCost,
    tax,
    taxRate: subtotal > 0 ? (tax / subtotal) * 100 : 0,
    total,
    amountPaid: total,
    balanceDue: 0,
    notes: `Ecommerce order ${order.orderNumber || order.id}. Delivery option: ${order.deliveryOption || "pickup"}.`,
    status: "paid",
    paymentStatus: "paid",
    paidDate: order.paidAt || now,
    createdAt: now,
    updatedAt: now,
    createdBy: "system",
    class: "ecommerce",
  };

  await supabase.from("invoices").insert({ id: invoiceId, workspace_id: workspaceId, data: invoice });

  const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await supabase.from("payments").insert({
    id: paymentId,
    workspace_id: workspaceId,
    data: {
      id: paymentId,
      invoiceId,
      invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      amount: total,
      paymentMethod: "card",
      reference: order.orderNumber || order.id,
      notes: "Ecommerce iKhokha payment",
      paymentDate: now.split("T")[0],
      createdBy: "system",
      createdAt: now,
    },
  });

  const updatedOrder = {
    ...order,
    invoiceId,
    invoiceNumber,
    invoiceCreatedAt: now,
  };

  try {
    const invoiceEmailSentAt = await sendInvoiceEmail(supabase, workspaceId, invoice);
    return invoiceEmailSentAt ? { ...updatedOrder, invoiceEmailSentAt } : updatedOrder;
  } catch (error) {
    console.error("[ikhokha-webhook] Failed to email ecommerce invoice:", error);
    return { ...updatedOrder, invoiceEmailError: error instanceof Error ? error.message : String(error) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const bodyText = await req.text();
    const payload = JSON.parse(bodyText);

    const receivedAppId = req.headers.get("ik-appid") ?? req.headers.get("IK-APPID");
    const receivedSignature = req.headers.get("ik-sign") ?? req.headers.get("IK-SIGN");

    // Determine workspace from externalTransactionID prefix
    const extId: string = payload.externalTransactionID || "";
    let workspaceId: string | null = null;

    // SUB-{workspaceId}-{plan} — workspace ID is encoded directly
    if (extId.startsWith("SUB-")) {
      workspaceId = extId.split("-")[1] ?? null;
    }

    // JOB/ORDER/other — scan paymentLinks records
    if (!workspaceId) {
      const { data: allLinks } = await supabase
        .from("workspace_settings")
        .select("workspace_id, data")
        .eq("category", "paymentLinks");

      for (const row of allLinks ?? []) {
        const links: any[] = row.data?.links ?? [];
        if (links.some((l: any) => l.externalTransactionID === extId || l.paylinkID === payload.paylinkID)) {
          workspaceId = row.workspace_id;
          break;
        }
      }
    }

    if (!workspaceId) {
      console.error("[ikhokha-webhook] Could not find workspace for transaction:", extId);
      return new Response(JSON.stringify({ error: "Workspace not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load iKhokha settings to verify signature
    const settings = await loadIkhokhaSettings(supabase, workspaceId);

    if (settings) {
      // Verify App ID
      if (receivedAppId && receivedAppId !== settings.appId) {
        console.error("[ikhokha-webhook] App ID mismatch");
        return new Response("Unauthorized: Invalid App ID", { status: 401 });
      }
      // Verify signature
      if (receivedSignature) {
        const fullUrl = req.url;
        const payloadToSign = createPayloadToSign(fullUrl, bodyText);
        const expectedSig = await hmacSHA256(settings.appSecret, payloadToSign);
        if (receivedSignature !== expectedSig) {
          console.error("[ikhokha-webhook] Signature mismatch");
          return new Response("Unauthorized: Invalid Signature", { status: 401 });
        }
      }
    }

    // Update paylink status in paymentLinks record
    const { data: linksRow } = await supabase
      .from("workspace_settings")
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("category", "paymentLinks")
      .maybeSingle();

    if (linksRow?.data) {
      const links: any[] = linksRow.data?.links ?? [];
      const updated = links.map((l: any) =>
        l.externalTransactionID === extId
          ? { ...l, status: payload.status, paylinkID: payload.paylinkID, updatedAt: new Date().toISOString() }
          : l
      );
      await supabase
        .from("workspace_settings")
        .update({ data: { links: updated } })
        .eq("workspace_id", workspaceId)
        .eq("category", "paymentLinks");
    }

    // If payment succeeded and this is a job deposit, update task status
    if (payload.status === "SUCCESS" && extId.startsWith("JOB-")) {
      const parts = extId.split("-"); // ['JOB', '0206', timestamp]
      const jobNumber = parts[1];

      // Load workspace state
      const { data: stateRow } = await supabase
        .from("workspace_state")
        .select("state")
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (stateRow?.state) {
        const state = stateRow.state as any;
        const tasks: any[] = state.tasks ?? [];
        const lists: any[] = state.lists ?? [];

        // Load collected status label from settings
        const { data: ikRow } = await supabase
          .from("workspace_settings")
          .select("data")
          .eq("workspace_id", workspaceId)
          .eq("category", "ikhokhaJob")
          .maybeSingle();

        const collectedLabel = ((ikRow?.data as any)?.collectedStatusLabel || "Collected").toLowerCase();

        // Find the task
        const task = tasks.find((t: any) =>
          String(t.jobNumber).toLowerCase() === jobNumber.toLowerCase() ||
          String(t.jobNumber).toLowerCase() === `job-${jobNumber}`.toLowerCase()
        );

        if (task) {
          // Find the collected status ID
          let collectedStatusId: string | null = null;
          for (const list of lists) {
            const s = (list.customStatuses ?? []).find((cs: any) => cs.label?.toLowerCase() === collectedLabel);
            if (s) { collectedStatusId = s.id; break; }
          }

          if (collectedStatusId && task.status !== collectedStatusId) {
            const updatedTasks = tasks.map((t: any) =>
              t.id === task.id ? { ...t, status: collectedStatusId, updatedAt: new Date().toISOString() } : t
            );
            await supabase
              .from("workspace_state")
              .update({ state: { ...state, tasks: updatedTasks }, updated_at: new Date().toISOString() })
              .eq("workspace_id", workspaceId);

            console.log(`[ikhokha-webhook] Task ${task.id} (${task.jobNumber}) moved to "${collectedLabel}"`);
          }
        }
      }
    }

    // If payment succeeded for an ecommerce order, mark the order as paid.
    if (extId.startsWith("ORDER-")) {
      const orderId = extId.replace(/^ORDER-/, "");
      const paymentSucceeded = paymentWasSuccessful(payload);
      const didPaymentFail = paymentFailed(payload);

      const { data: orderRow } = await supabase
        .from("orders")
        .select("data")
        .eq("id", orderId)
        .maybeSingle();

      if (orderRow?.data) {
        const order = orderRow.data as any;
        const stockAdjustedOrder = paymentSucceeded
          ? await deductStockForOrder(supabase, workspaceId, order)
          : order;
        const paidOrder = paymentSucceeded
          ? await ensurePaidInvoiceForOrder(supabase, workspaceId, {
              ...stockAdjustedOrder,
              paymentStatus: "paid",
              status: "processing",
              paidAt: new Date().toISOString(),
            })
          : stockAdjustedOrder;
        const updatedOrder = {
          ...paidOrder,
          paymentStatus: paymentSucceeded ? "paid" : didPaymentFail ? "failed" : paidOrder.paymentStatus || "pending",
          status: paymentSucceeded ? "processing" : didPaymentFail ? "payment_failed" : paidOrder.status || "pending",
          ecommerceStage: paidOrder.ecommerceStage || "orders",
          paidAt: paymentSucceeded ? new Date().toISOString() : paidOrder.paidAt,
          paymentData: {
            ...(paidOrder.paymentData || {}),
            status: payload.status,
            paymentStatus: payload.paymentStatus,
            transactionStatus: payload.transactionStatus,
            responseCode: payload.responseCode,
            paylinkID: payload.paylinkID,
            externalTransactionID: extId,
            updatedAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        };

        await supabase
          .from("orders")
          .update({ data: updatedOrder, updated_at: new Date().toISOString() })
          .eq("id", orderId);

        // Fire ecommerce notification when payment is confirmed
        if (paymentSucceeded) {
          try {
            const who = updatedOrder.customerInfo?.name || "a customer";
            const total = Number(updatedOrder.totalAmount || 0).toFixed(2);
            const { data: feedRow } = await supabase
              .from("workspace_settings")
              .select("data")
              .eq("workspace_id", workspaceId)
              .eq("category", "ecommerce_notifications_feed")
              .maybeSingle();
            const existingItems: any[] = (feedRow?.data as any)?.items ?? [];
            // Update existing pending notification to paid, or add new one
            const now = new Date().toISOString();
            const updated = existingItems.map((n: any) =>
              n.title?.includes(orderId)
                ? { ...n, title: `Order paid ${orderId}`, body: `R${total} from ${who} · paid`, read: false }
                : n
            );
            if (!updated.some((n: any) => n.title?.includes(orderId))) {
              updated.unshift({
                id: `entf_${Date.now()}_paid`,
                type: "order",
                title: `Order paid ${orderId}`,
                body: `R${total} from ${who} · paid`,
                link: "ecommerce",
                read: false,
                createdAt: now,
              });
            }
            await supabase.from("workspace_settings").upsert(
              { workspace_id: workspaceId, category: "ecommerce_notifications_feed", data: { items: updated.slice(0, 100) } },
              { onConflict: "workspace_id,category" }
            );
          } catch (ne) {
            console.warn("[ikhokha-webhook] Failed to fire payment notification:", ne);
          }
        }
      }
    }

    // Handle subscription payments: SUB-{workspaceId}-{plan}
    if (extId.startsWith("SUB-")) {
      const parts = extId.split("-"); // ['SUB', workspaceId, plan]
      const subWorkspaceId = parts[1];
      const subPlan = parts[2];

      if (paymentWasSuccessful(payload) && subWorkspaceId && subPlan) {
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        // Load plan price from platform_settings for the receipt
        const { data: settingsRow } = await supabase
          .from("platform_settings")
          .select("value")
          .eq("key", "subscription_billing")
          .maybeSingle();
        const planPrices: Record<string, number> = {
          starter: 299, growth: 799, pro: 1499,
          ...(settingsRow?.value?.prices ?? {}),
        };
        const amountRands = planPrices[subPlan] ?? 0;

        await supabase.from("workspaces").update({
          plan: subPlan,
          subscription_status: "active",
          subscription_expires_at: expiresAt,
        }).eq("id", subWorkspaceId);

        await supabase.from("subscription_payments").insert({
          id: `subpay_${Date.now()}`,
          workspace_id: subWorkspaceId,
          plan: subPlan,
          amount_rands: amountRands,
          expires_at: expiresAt,
          ikhokha_transaction_id: payload.externalTransactionID || payload.paylinkID || extId,
          created_at: new Date().toISOString(),
        });

        console.log(`[ikhokha-webhook] Subscription activated: workspace=${subWorkspaceId} plan=${subPlan} expires=${expiresAt}`);
      } else if (paymentFailed(payload)) {
        console.log(`[ikhokha-webhook] Subscription payment failed: workspace=${subWorkspaceId}`);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[ikhokha-webhook] Error:", err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
