import { SUPABASE_URL, supabase, supabaseServiceRole } from "@/lib/supabase";
import { generateInvoiceNumber } from "@/lib/counterService";
import { loadSalesSettings } from "@/lib/salesSettingsService";
import { generateInvoiceHTML, generateInvoicePDFBlob } from "@/lib/pdfService";
import type { Invoice, InvoiceLineItem } from "@/types/invoice";

const SEND_EMAIL_URL = `${SUPABASE_URL}/functions/v1/send-email`;

type EcommerceOrder = {
  id: string;
  orderNumber?: string;
  customerId?: string;
  userId?: string;
  customerInfo?: { name?: string; email?: string; phone?: string };
  items?: Array<{
    productId?: string;
    productName?: string;
    variantName?: string;
    sku?: string;
    quantity?: number;
    unitPrice?: number;
    totalPrice?: number;
  }>;
  subtotal?: number;
  taxAmount?: number;
  shippingCost?: number;
  totalAmount?: number;
  deliveryOption?: "pickup" | "delivery";
  paidAt?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceEmailSentAt?: string;
};

function orderItemsToInvoiceItems(order: EcommerceOrder): InvoiceLineItem[] {
  return (order.items || []).map((item, index) => {
    const quantity = Number(item.quantity || 1);
    const price = Number(item.unitPrice || 0);
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

function makeInvoicePayload(userId: string, order: EcommerceOrder, invoiceNumber: string): Invoice {
  const now = new Date().toISOString();
  const invoiceDate = now.split("T")[0];
  const items = orderItemsToInvoiceItems(order);
  const subtotal = Number(order.subtotal ?? items.reduce((sum, item) => sum + item.total, 0));
  const tax = Number(order.taxAmount || 0);
  const shippingCost = Number(order.shippingCost || 0);
  const total = Number(order.totalAmount ?? subtotal + tax + shippingCost);

  return {
    id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    invoiceNumber,
    customerId: order.userId || order.customerId || order.customerInfo?.email || "ecommerce_customer",
    customerName: order.customerInfo?.name || "Customer",
    customerEmail: order.customerInfo?.email,
    customerPhone: order.customerInfo?.phone,
    invoiceDate,
    dueDate: invoiceDate,
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
    createdBy: userId,
    class: "ecommerce",
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export async function sendEcommerceInvoiceEmail(workspaceId: string, invoice: Invoice): Promise<void> {
  if (!invoice.customerEmail) return;

  const { data: ecommerceRow } = await supabase
    .from("workspace_settings")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("category", "ecommerce")
    .maybeSingle();

  if ((ecommerceRow?.data as any)?.sendOrderConfirmationEmail === false) return;

  const { data: emailRow } = await supabase
    .from("workspace_settings")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("category", "email")
    .maybeSingle();

  const es = emailRow?.data as any;
  if (!es?.enabled) return;

  const salesSettings = await loadSalesSettings(workspaceId);
  const invoiceHtml = generateInvoiceHTML(invoice, salesSettings);
  const fromName = es.fromName || salesSettings.companyName || "ShopFlowz";
  const fromEmail = es.fromEmail || es.smtpUser || "";
  const host = es.provider === "gmail" ? "smtp.gmail.com" : (es.smtpHost ?? "");
  const port = es.provider === "gmail" ? 587 : (es.smtpPort ?? 465);
  const secure = es.provider === "gmail" ? false : (es.smtpSecure ?? port === 465);
  const pdfBase64 = await blobToBase64(await generateInvoicePDFBlob(invoice, salesSettings));

  const resp = await fetch(SEND_EMAIL_URL, {
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
        text: `Please find your paid invoice ${invoice.invoiceNumber} attached.\nTotal: R${invoice.total.toFixed(2)}`,
        html: invoiceHtml,
        attachments: [
          {
            filename: `${invoice.invoiceNumber}.pdf`,
            content: pdfBase64,
            contentType: "application/pdf",
          },
        ],
      },
    }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.success) throw new Error(json.error || `Email failed (${resp.status})`);
}

export async function ensurePaidInvoiceForEcommerceOrder(
  workspaceId: string,
  userId: string,
  order: EcommerceOrder,
  sendEmail = true
): Promise<EcommerceOrder> {
  if (order.invoiceId) {
    return order;
  }

  const invoiceNumber = await generateInvoiceNumber(workspaceId);
  const invoice = makeInvoicePayload(userId, order, invoiceNumber);

  await supabaseServiceRole
    .from("invoices")
    .insert({ id: invoice.id, workspace_id: workspaceId, data: invoice });

  const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await supabaseServiceRole.from("payments").insert({
    id: paymentId,
    workspace_id: workspaceId,
    data: {
      id: paymentId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      amount: invoice.total,
      paymentMethod: "card",
      reference: order.orderNumber || order.id,
      notes: "Ecommerce iKhokha payment",
      paymentDate: new Date().toISOString().split("T")[0],
      createdBy: userId,
      createdAt: new Date().toISOString(),
    },
  });

  const updatedOrder = {
    ...order,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceCreatedAt: new Date().toISOString(),
  };

  if (sendEmail) {
    try {
      await sendEcommerceInvoiceEmail(workspaceId, invoice);
      return { ...updatedOrder, invoiceEmailSentAt: new Date().toISOString() };
    } catch (error) {
      console.error("Could not send ecommerce invoice email:", error);
      return { ...updatedOrder, invoiceEmailError: error instanceof Error ? error.message : String(error) };
    }
  }

  return updatedOrder;
}
