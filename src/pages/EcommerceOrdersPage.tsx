import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  LayoutGrid,
  List as ListIcon,
  Mail,
  PackageCheck,
  Printer,
  RefreshCw,
  Search,
  ShoppingBag,
  Truck,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SUPABASE_URL,  supabase, supabaseServiceRole } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { verifySupervisorPassword } from "@/lib/supervisorSecurityService";
import { ensurePaidInvoiceForEcommerceOrder } from "@/lib/ecommerceInvoiceService";
import { getEffectiveSmtp } from "@/lib/emailAccountService";

const SMTP_URL = `${SUPABASE_URL}/functions/v1/send-email`;

type EcommerceStage = "orders" | "picking_slip" | "ready_for_collection" | "fastway_booked" | "collected";

type EcommerceOrder = {
  id: string;
  orderNumber?: string;
  customerId?: string;
  userId?: string;
  customerInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  items?: Array<{
    productId?: string;
    productName?: string;
    variantName?: string;
    sku?: string;
    location?: string;
    shelf?: string;
    bin?: string;
    rack?: string;
    aisle?: string;
    drawer?: string;
    storageLocation?: string;
    quantity?: number;
    unitPrice?: number;
    totalPrice?: number;
    productImage?: string;
  }>;
  subtotal?: number;
  taxAmount?: number;
  shippingCost?: number;
  totalAmount?: number;
  currency?: string;
  status?: string;
  paymentStatus?: string;
  ecommerceStage?: EcommerceStage;
  deliveryOption?: "pickup" | "delivery";
  shippingAddress?: {
    street?: string;
    address?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
  paymentMethod?: {
    type?: string;
    provider?: string;
    paylinkID?: string;
    externalTransactionID?: string;
  };
  paidAt?: string;
  stockDeductedAt?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceCreatedAt?: string;
  invoiceEmailSentAt?: string;
  invoiceEmailError?: string;
  createdAt?: string;
  updatedAt?: string;
  // Soft-cancel metadata
  cancelledAt?: string;
  cancelledReason?: string;
  cancelledNote?: string;
  cancelledBy?: string;
  // Origin flag - "walk_in" for counter sales, undefined for website orders
  source?: string;
  // Fastway / ShipLogic shipment fields
  waybillNumber?: string;
  fastwayBookedAt?: string;
  fastwayShipmentId?: string;
};

type TabId = "clients" | EcommerceStage | "cancelled";

// Reasons offered in the Cancel Order dialog. Admin-editable later if needed.
const CANCEL_REASONS = [
  "Customer changed mind",
  "Out of stock",
  "Duplicate order",
  "Payment dispute / chargeback",
  "Fraudulent / suspicious",
  "Customer no-show",
  "Other",
] as const;
type CancelReason = (typeof CANCEL_REASONS)[number];

const STAGES: Array<{ id: EcommerceStage; label: string; icon: ReactNode; next?: EcommerceStage; action?: string }> = [
  { id: "orders", label: "Orders", icon: <ShoppingBag className="h-4 w-4" />, next: "picking_slip", action: "Create Picking Slip" },
  { id: "picking_slip", label: "Picking Slips", icon: <ClipboardList className="h-4 w-4" />, next: "ready_for_collection", action: "Mark Ready" },
  { id: "ready_for_collection", label: "Ready for Collection", icon: <PackageCheck className="h-4 w-4" />, next: "fastway_booked", action: "Book Fastway" },
  { id: "fastway_booked", label: "Fastway Booked", icon: <Truck className="h-4 w-4" />, next: "collected", action: "Mark Collected" },
  { id: "collected", label: "Collected", icon: <CheckCircle2 className="h-4 w-4" /> },
];

const formatMoney = (value = 0, currency = "ZAR") =>
  `${currency === "ZAR" ? "R" : `${currency} `}${Number(value || 0).toFixed(2)}`;

const stageFor = (order: EcommerceOrder): EcommerceStage => order.ecommerceStage || "orders";
const isPaid = (order: EcommerceOrder) => order.paymentStatus === "paid";
const canFulfil = (order: EcommerceOrder) =>
  isPaid(order) || ["cash_on_collection", "cash_on_delivery"].includes(order.paymentMethod?.type || "");
const paymentBadgeClass = (status?: string) => {
  switch (status) {
    case "paid":
      return "bg-green-600 text-white";
    case "failed":
    case "cancelled":
    case "canceled":
      return "bg-red-600 text-white";
    case "refunded":
      return "bg-slate-600 text-white";
    default:
      return "bg-amber-600 text-white";
  }
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const itemLocation = (item: EcommerceOrder["items"][number] | any) =>
  item?.location ||
  item?.storageLocation ||
  item?.shelf ||
  item?.bin ||
  item?.rack ||
  item?.aisle ||
  item?.drawer ||
  "";

export function EcommerceOrdersPage({ onClose }: { onClose: () => void }) {
  const { workspaceId, user } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<EcommerceOrder[]>([]);
  const [registeredClients, setRegisteredClients] = useState<{ id: string; name: string; email: string; phone: string; registeredAt?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("orders");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [bookingFastwayId, setBookingFastwayId] = useState<string | null>(null);
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null);
  const [pendingUndoOrder, setPendingUndoOrder] = useState<EcommerceOrder | null>(null);
  const [undoPassword, setUndoPassword] = useState("");
  const [undoError, setUndoError] = useState("");
  const [showRevenueDetails, setShowRevenueDetails] = useState(false);

  // Cancel-order dialog state
  const [pendingCancelOrder, setPendingCancelOrder] = useState<EcommerceOrder | null>(null);
  const [cancelReason, setCancelReason] = useState<CancelReason>("Customer changed mind");
  const [cancelNote, setCancelNote] = useState("");
  const [cancelError, setCancelError] = useState("");

  // Per-tab view mode (card vs list). Collected / cancelled default to list
  // since those are archive tabs; the active workflow tabs default to card.
  type ViewMode = "card" | "list";
  const DEFAULT_VIEW_MODES: Record<TabId, ViewMode> = {
    clients: "list",
    orders: "card",
    picking_slip: "card",
    ready_for_collection: "card",
    collected: "list",
    cancelled: "list",
  };
  const [viewModes, setViewModes] = useState<Record<TabId, ViewMode>>(() => {
    if (typeof window === "undefined") return DEFAULT_VIEW_MODES;
    try {
      const saved = window.localStorage.getItem("ecomViewModes");
      if (saved) return { ...DEFAULT_VIEW_MODES, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return DEFAULT_VIEW_MODES;
  });
  useEffect(() => {
    try { window.localStorage.setItem("ecomViewModes", JSON.stringify(viewModes)); } catch { /* ignore */ }
  }, [viewModes]);
  const currentView: ViewMode = viewModes[activeTab] || "card";
  const setCurrentView = (mode: ViewMode) =>
    setViewModes((prev) => ({ ...prev, [activeTab]: mode }));

  // Click-to-expand modal
  const [expandedOrder, setExpandedOrder] = useState<EcommerceOrder | null>(null);

  useEffect(() => {
    loadOrders();
  }, [workspaceId]);

  const sendReminder = async (order: EcommerceOrder) => {
    const email = order.customerInfo?.email;
    if (!email || !workspaceId) return;
    setSendingReminderId(order.id);
    try {
      // Prefer the logged-in user's own SMTP, fall back to workspace SMTP
      let smtpConfig: any;
      let fromName: string;
      let fromEmail: string;
      const userSmtp = user ? await getEffectiveSmtp(workspaceId, user.uid) : null;
      if (userSmtp) {
        smtpConfig = userSmtp;
        fromName = userSmtp.fromName;
        fromEmail = userSmtp.fromEmail;
      } else {
        const { data: emailRow } = await supabase.from("workspace_settings").select("data").eq("workspace_id", workspaceId).eq("category", "email").maybeSingle();
        if (!emailRow?.data) throw new Error("Email not configured in Settings.");
        const es = emailRow.data as any;
        fromName = es.fromName || "ShopFlowz";
        fromEmail = es.fromEmail || es.smtpUser;
        smtpConfig = { host: es.smtpHost, port: es.smtpPort ?? 465, secure: es.smtpSecure ?? true, user: es.smtpUser, pass: es.smtpPassword };
      }

      const orderNum = order.orderNumber || order.id;
      const total = formatMoney(order.totalAmount || 0, order.currency);
      const itemRows = (order.items || []).map(i =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${escapeHtml(i.productName)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${formatMoney(i.totalPrice || 0, order.currency)}</td></tr>`
      ).join("");

      const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
  <h2 style="color:#d97706">⏳ Payment Reminder — ${escapeHtml(orderNum)}</h2>
  <p>Hi ${escapeHtml(order.customerInfo?.name || "there")},</p>
  <p>We noticed your order <strong>${escapeHtml(orderNum)}</strong> is still awaiting payment. Here's a quick summary:</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <thead><tr style="background:#f3f4f6"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px;text-align:center">Qty</th><th style="padding:8px;text-align:right">Price</th></tr></thead>
    <tbody>${itemRows}</tbody>
    <tfoot><tr><td colspan="2" style="padding:8px;font-weight:bold;text-align:right">Total</td><td style="padding:8px;font-weight:bold;text-align:right">${escapeHtml(total)}</td></tr></tfoot>
  </table>
  <p>Please complete your payment at your earliest convenience. If you've already paid or have any questions, reply to this email or call us directly.</p>
  <p style="color:#666;font-size:13px">Thank you for shopping with us!<br/><strong>${escapeHtml(fromName)}</strong></p>
</div>`;

      const res = await fetch(SMTP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smtpConfig,
          email: {
            from: `${fromName} <${fromEmail}>`,
            to: email,
            subject: `Payment Reminder — Order ${orderNum}`,
            text: `Hi ${order.customerInfo?.name || "there"},\n\nYour order ${orderNum} for ${total} is still awaiting payment. Please complete your payment at your earliest convenience.\n\nThank you,\n${fromName}`,
            html,
          },
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Send failed");
      toast({ title: "Reminder sent", description: `Email sent to ${email}` });
    } catch (e: any) {
      toast({ title: "Failed to send reminder", description: e.message, variant: "destructive" });
    } finally {
      setSendingReminderId(null);
    }
  };

  const loadOrders = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("id, data, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setOrders((data || []).map((row: any) => ({
        id: row.id,
        createdAt: row.created_at,
        ...(row.data || {}),
      })));

      // Load store-registered customers (source = store_registration in customers table)
      const { data: custData } = await supabaseServiceRole
        .from("customers")
        .select("id, data, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      const fromCustTable = (custData || [])
        .filter((row: any) => (row.data as any)?.source === 'store_registration')
        .map((row: any) => ({
          id: row.id,
          name: (row.data as any)?.contactPerson || (row.data as any)?.name || "",
          email: (row.data as any)?.email || "",
          phone: (row.data as any)?.phone || "",
          registeredAt: row.created_at,
        }));

      setRegisteredClients(fromCustTable);
    } catch (error) {
      console.error("Error loading ecommerce orders:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter(order => {
      if (!term) return true;
      const haystack = [
        order.orderNumber,
        order.customerInfo?.name,
        order.customerInfo?.email,
        order.customerInfo?.phone,
        ...(order.items || []).map(item => `${item.productName} ${item.sku}`),
      ].join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [orders, search]);

  const byStage = useMemo(() => {
    const map: Record<EcommerceStage, EcommerceOrder[]> = {
      orders: [],
      picking_slip: [],
      ready_for_collection: [],
      fastway_booked: [],
      collected: [],
    };
    filteredOrders.forEach((order) => {
      if (order.status === "cancelled") return; // hide from active tabs
      map[stageFor(order)].push(order);
    });
    return map;
  }, [filteredOrders]);

  const cancelledOrders = useMemo(
    () => filteredOrders.filter((o) => o.status === "cancelled"),
    [filteredOrders],
  );

  const clients = useMemo(() => {
    const map = new Map<string, { name: string; email: string; phone: string; orderCount: number; totalSpent: number; lastOrder?: string }>();
    // Use ALL orders (not filtered) so search doesn't hide clients
    orders.forEach(order => {
      const email = order.customerInfo?.email || "";
      const name = order.customerInfo?.name || "";
      const phone = order.customerInfo?.phone || "";
      // Key by email if present, otherwise by name+phone, otherwise skip
      const key = email || (name && phone ? `${name}__${phone}` : name) || null;
      if (!key) return;
      const existing = map.get(key) || { name, email, phone, orderCount: 0, totalSpent: 0, lastOrder: undefined };
      existing.orderCount += 1;
      if (isPaid(order)) existing.totalSpent += Number(order.totalAmount || 0);
      existing.lastOrder = existing.lastOrder || order.createdAt;
      map.set(key, existing);
    });
    // Merge in registered store customers who haven't ordered yet
    registeredClients.forEach(rc => {
      const key = rc.email || rc.id;
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, { name: rc.name, email: rc.email, phone: rc.phone, orderCount: 0, totalSpent: 0, lastOrder: rc.registeredAt });
      } else {
        // Fill in missing name/phone from registration record
        const existing = map.get(key)!;
        if (!existing.name || existing.name === "Customer") existing.name = rc.name || existing.name;
        if (!existing.phone) existing.phone = rc.phone;
      }
    });
    const term = search.trim().toLowerCase();
    const all = [...map.values()].sort((a, b) => b.orderCount - a.orderCount);
    if (!term || activeTab !== "clients") return all;
    return all.filter(c => [c.name, c.email, c.phone].join(" ").toLowerCase().includes(term));
  }, [orders, registeredClients, search, activeTab]);

  const updateStage = async (order: EcommerceOrder, stage: EcommerceStage) => {
    if (!canFulfil(order)) {
      alert("This order is not paid yet. Confirm the payment first before creating a picking slip.");
      return;
    }

    setUpdatingId(order.id);
    try {
      const stockAdjustedOrder = await deductStockIfNeeded(order);
      const nextOrder = {
        ...stockAdjustedOrder,
        ecommerceStage: stage,
        fulfillmentStatus: stage === "collected" ? "fulfilled" : stage === "orders" ? "pending" : "partial",
        status: stage === "collected" ? "completed" : stockAdjustedOrder.status || "processing",
        updatedAt: new Date().toISOString(),
      };

      // Save immediately so a reload mid-flight doesn't revert the stage.
      const { error } = await supabaseServiceRole
        .from("orders")
        .update({ data: nextOrder, updated_at: new Date().toISOString() })
        .eq("id", order.id);

      if (error) throw error;
      setOrders(prev => prev.map(o => o.id === order.id ? nextOrder : o));
    } catch (error) {
      console.error("Error updating ecommerce order:", error);
      alert("Could not update order stage.");
    } finally {
      setUpdatingId(null);
    }
  };

  const bookFastway = async (order: EcommerceOrder) => {
    if (!workspaceId) return;
    setBookingFastwayId(order.id);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-fastway-shipment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`,
          "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        },
        body: JSON.stringify({ workspaceId, order }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || "Fastway booking failed");

      const now = new Date().toISOString();
      const nextOrder: EcommerceOrder = {
        ...order,
        ecommerceStage: "fastway_booked",
        waybillNumber: data.waybillNumber,
        fastwayBookedAt: now,
        fastwayShipmentId: data.shipmentId,
        updatedAt: now,
      };

      const { error } = await supabaseServiceRole
        .from("orders")
        .update({ data: nextOrder, updated_at: now })
        .eq("id", order.id);
      if (error) throw error;

      setOrders(prev => prev.map(o => o.id === order.id ? nextOrder : o));
      toast({ title: "✅ Fastway booked!", description: `Waybill: ${data.waybillNumber} · Collection: ${data.collectionDate}` });
    } catch (err: any) {
      console.error("[bookFastway]", err);
      toast({ title: "Fastway booking failed", description: err?.message || "Could not create shipment. Try again.", variant: "destructive" });
    } finally {
      setBookingFastwayId(null);
    }
  };

  const deductStockIfNeeded = async (order: EcommerceOrder): Promise<EcommerceOrder> => {
    if (order.stockDeductedAt) return order;

    const now = new Date().toISOString();
    for (const item of order.items || []) {
      if (!item.productId) continue;
      const qty = Number(item.quantity || 1);
      if (qty <= 0) continue;

      const { data: invRow, error } = await supabase
        .from("inventory")
        .select("data")
        .eq("workspace_id", workspaceId)
        .eq("id", item.productId)
        .maybeSingle();

      if (error || !invRow?.data) {
        console.warn("Could not find inventory item for ecommerce stock deduction:", item.productId, error);
        continue;
      }

      const inv = invRow.data as any;
      const currentQty = Number(inv.quantity ?? inv.currentStock ?? 0);
      const nextQty = Math.max(0, currentQty - qty);
      await supabase
        .from("inventory")
        .update({
          data: {
            ...inv,
            quantity: nextQty,
            currentStock: nextQty,
            lastStockUpdate: now,
            updatedAt: now,
          },
        })
        .eq("workspace_id", workspaceId)
        .eq("id", item.productId);
    }

    return { ...order, stockDeductedAt: now };
  };

  const markPaid = async (order: EcommerceOrder) => {
    if (!window.confirm("Only mark this paid after confirming the payment in iKhokha. Continue?")) return;

    setUpdatingId(order.id);
    try {
      const stockAdjustedOrder = await deductStockIfNeeded(order);
      const paidOrder = {
        ...stockAdjustedOrder,
        paymentStatus: "paid",
        status: stockAdjustedOrder.status === "pending" ? "processing" : stockAdjustedOrder.status || "processing",
        paidAt: stockAdjustedOrder.paidAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Save paid status to Supabase immediately so a reload mid-flight doesn't revert it.
      const { error: saveError } = await supabaseServiceRole
        .from("orders")
        .update({ data: paidOrder, updated_at: new Date().toISOString() })
        .eq("id", order.id);
      if (saveError) throw saveError;
      setOrders(prev => prev.map(o => o.id === order.id ? paidOrder : o));

      // Now create invoice + send email (slow — runs after paid is already saved).
      const nextOrder = await ensurePaidInvoiceForEcommerceOrder(
        workspaceId,
        user?.uid || "system",
        paidOrder,
        true
      );

      // If the invoice step added new fields (invoiceId, invoiceNumber, etc.), persist them.
      if (nextOrder.invoiceId && nextOrder.invoiceId !== paidOrder.invoiceId) {
        const { error } = await supabaseServiceRole
          .from("orders")
          .update({ data: nextOrder, updated_at: new Date().toISOString() })
          .eq("id", order.id);
        if (error) throw error;
        setOrders(prev => prev.map(o => o.id === order.id ? nextOrder : o));
      }
    } catch (error) {
      console.error("Error marking ecommerce order paid:", error);
      alert("Could not mark order as paid.");
    } finally {
      setUpdatingId(null);
    }
  };

  const reinsertStockIfNeeded = async (order: EcommerceOrder): Promise<EcommerceOrder> => {
    if (!order.stockDeductedAt) return order;

    const now = new Date().toISOString();
    for (const item of order.items || []) {
      if (!item.productId) continue;
      const qty = Number(item.quantity || 1);
      if (qty <= 0) continue;

      const { data: invRow, error } = await supabase
        .from("inventory")
        .select("data")
        .eq("workspace_id", workspaceId)
        .eq("id", item.productId)
        .maybeSingle();

      if (error || !invRow?.data) {
        console.warn("Could not find inventory item for ecommerce stock reinsert:", item.productId, error);
        continue;
      }

      const inv = invRow.data as any;
      const currentQty = Number(inv.quantity ?? inv.currentStock ?? 0);
      const nextQty = currentQty + qty;
      await supabase
        .from("inventory")
        .update({
          data: {
            ...inv,
            quantity: nextQty,
            currentStock: nextQty,
            lastStockUpdate: now,
            updatedAt: now,
          },
        })
        .eq("workspace_id", workspaceId)
        .eq("id", item.productId);
    }

    const { stockDeductedAt, ...rest } = order as any;
    return {
      ...rest,
      stockReinsertedAt: now,
    } as EcommerceOrder;
  };

  const requestUndoPaid = (order: EcommerceOrder) => {
    setPendingUndoOrder(order);
    setUndoPassword("");
    setUndoError("");
  };

  const closeUndoDialog = () => {
    setPendingUndoOrder(null);
    setUndoPassword("");
    setUndoError("");
  };

  // ── Cancel order ─────────────────────────────────────────────────────────
  // Soft-cancel: order stays in the DB with status='cancelled'. Disappears
  // from the active tabs (Orders/Picking/Ready/Collected) but is visible in
  // the Cancelled tab. If the order was paid we also restock its items and
  // cancel the linked invoice so the books stay consistent.
  const closeCancelDialog = () => {
    setPendingCancelOrder(null);
    setCancelReason("Customer changed mind");
    setCancelNote("");
    setCancelError("");
  };

  const submitCancelOrder = async () => {
    if (!workspaceId || !user) return;
    const order = pendingCancelOrder;
    if (!order) return;

    const reason = cancelReason;
    const note = cancelNote.trim();
    if (!reason) {
      setCancelError("Please pick a reason.");
      return;
    }

    setUpdatingId(order.id);
    setCancelError("");
    try {
      const now = new Date().toISOString();

      // Save cancelled status immediately so a reload cannot revert it.
      const cancelledOrder: EcommerceOrder = {
        ...order,
        status: "cancelled",
        cancelledAt: now,
        cancelledReason: reason,
        cancelledNote: note || undefined,
        cancelledBy: user.uid,
        updatedAt: now,
      } as EcommerceOrder;

      const { error } = await supabaseServiceRole
        .from("orders")
        .update({ data: cancelledOrder, updated_at: now })
        .eq("id", order.id);
      if (error) throw error;
      setOrders((prev) => prev.map((o) => (o.id === order.id ? cancelledOrder : o)));
      setActiveTab("cancelled");
      closeCancelDialog();

      // Side effects after the cancel is already saved: restock + cancel invoice.
      const stockAdjustedOrder = await reinsertStockIfNeeded(cancelledOrder);
      if (stockAdjustedOrder !== cancelledOrder) {
        await supabaseServiceRole.from("orders").update({ data: stockAdjustedOrder, updated_at: now }).eq("id", order.id);
        setOrders((prev) => prev.map((o) => (o.id === order.id ? stockAdjustedOrder : o)));
      }

      if (stockAdjustedOrder.invoiceId) {
        const { data: invoiceRow } = await supabase
          .from("invoices")
          .select("data")
          .eq("id", stockAdjustedOrder.invoiceId)
          .maybeSingle();
        if (invoiceRow?.data) {
          await supabase
            .from("invoices")
            .update({
              data: {
                ...(invoiceRow.data as any),
                status: "cancelled",
                paymentStatus: (invoiceRow.data as any).paymentStatus === "paid" ? "paid" : "unpaid",
                cancelledAt: now,
                cancelledReason: `Order cancelled: ${reason}${note ? ` — ${note}` : ""}`,
                updatedAt: now,
              },
            })
            .eq("id", stockAdjustedOrder.invoiceId);
        }
      }

      // Activity log.
      try {
        await supabaseServiceRole.from("user_activities").insert({
          workspace_id: workspaceId,
          user_id: user.uid,
          activity_type: "task_updated",
          activity_date: now,
          entity_type: "task",
          entity_id: order.id,
          entity_title: order.orderNumber || order.id,
          metadata: {
            kind: "ecommerce_order_cancelled",
            reason,
            note: note || null,
            was_paid: isPaid(order),
            total: order.totalAmount,
          },
        });
      } catch (logErr) {
        console.warn("[cancelOrder] activity log failed:", logErr);
      }
    } catch (err) {
      console.error("[cancelOrder] failed:", err);
      setCancelError(err instanceof Error ? err.message : "Cancel failed. Try again.");
    } finally {
      setUpdatingId(null);
    }
  };

  const restoreCancelledOrder = async (order: EcommerceOrder) => {
    if (!workspaceId) return;
    setUpdatingId(order.id);
    try {
      const now = new Date().toISOString();
      const restored = {
        ...order,
        status: "pending",
        paymentStatus: order.paymentStatus === "paid" ? "paid" : "pending",
        cancelledAt: undefined,
        cancelledReason: undefined,
        cancelledNote: undefined,
        cancelledBy: undefined,
        updatedAt: now,
      } as EcommerceOrder;
      const { error } = await supabaseServiceRole
        .from("orders")
        .update({ data: restored, updated_at: now })
        .eq("id", order.id);
      if (error) throw error;
      setOrders((prev) => prev.map((o) => (o.id === order.id ? restored : o)));
    } catch (err) {
      console.error("[restoreCancelledOrder] failed:", err);
    } finally {
      setUpdatingId(null);
    }
  };

  const undoPaid = async () => {
    if (!workspaceId) return;
    const order = pendingUndoOrder;
    const password = undoPassword.trim();
    if (!order || !password) {
      setUndoError("Enter the supervisor password.");
      return;
    }

    setUpdatingId(order.id);
    setUndoError("");
    try {
      const verified = await verifySupervisorPassword(workspaceId, password);
      if (!verified) {
        setUndoError("Incorrect supervisor password. If no password is set yet, set it in Settings > Supervisor Password.");
        return;
      }

      const now = new Date().toISOString();
      const nextOrder = {
        ...order,
        paymentStatus: "pending",
        status: "pending",
        ecommerceStage: "orders" as EcommerceStage,
        fulfillmentStatus: "pending",
        paymentRevertedAt: now,
        updatedAt: now,
      };

      // Save immediately so a reload cannot revert back to paid.
      const { error } = await supabaseServiceRole
        .from("orders")
        .update({ data: nextOrder, updated_at: now })
        .eq("id", order.id);
      if (error) throw error;
      setOrders(prev => prev.map(o => o.id === order.id ? nextOrder : o));
      setActiveTab("orders");
      closeUndoDialog();

      // Side effects after save: restock + cancel invoice.
      const stockAdjustedOrder = await reinsertStockIfNeeded(nextOrder);
      if (stockAdjustedOrder !== nextOrder) {
        await supabaseServiceRole.from("orders").update({ data: stockAdjustedOrder, updated_at: now }).eq("id", order.id);
        setOrders(prev => prev.map(o => o.id === order.id ? stockAdjustedOrder : o));
      }

      if (order.invoiceId) {
        const { data: invoiceRow } = await supabase
          .from("invoices")
          .select("data")
          .eq("id", order.invoiceId)
          .maybeSingle();
        if (invoiceRow?.data) {
          await supabase
            .from("invoices")
            .update({
              data: {
                ...(invoiceRow.data as any),
                status: "cancelled",
                paymentStatus: "unpaid",
                amountPaid: 0,
                balanceDue: Number((invoiceRow.data as any).total || 0),
                cancelledAt: now,
                cancelledReason: "Ecommerce payment reverted",
                updatedAt: now,
              },
            })
            .eq("id", order.invoiceId);
        }
      }
    } catch (error) {
      console.error("Error undoing paid ecommerce order:", error);
      setUndoError("Could not undo paid order.");
    } finally {
      setUpdatingId(null);
    }
  };

  const printPickingSlip = async (order: EcommerceOrder) => {
    const locationByProductId = new Map<string, string>();
    const productIds = [...new Set((order.items || []).map(item => item.productId).filter(Boolean))] as string[];

    if (productIds.length > 0) {
      const { data, error } = await supabase
        .from("inventory")
        .select("id, data")
        .eq("workspace_id", workspaceId)
        .in("id", productIds);

      if (!error) {
        (data || []).forEach((row: any) => {
          const location = itemLocation(row.data);
          if (location) locationByProductId.set(row.id, location);
        });
      }
    }

    const items = (order.items || []).map(item => {
      const location = itemLocation(item) || (item.productId ? locationByProductId.get(item.productId) : "") || "No location";
      return `
      <tr>
        <td class="check-cell"><span class="check-box"></span></td>
        <td>${escapeHtml(item.sku || "")}</td>
        <td>${escapeHtml(location)}</td>
        <td>${escapeHtml(item.productName || "Product")}${item.variantName ? `<br><small>${escapeHtml(item.variantName)}</small>` : ""}</td>
        <td>${item.quantity || 1}</td>
        <td>${formatMoney(item.unitPrice || 0, order.currency)}</td>
        <td>${formatMoney(item.totalPrice || 0, order.currency)}</td>
      </tr>
    `;
    }).join("");

    const html = `
      <html>
        <head>
          <title>Picking Slip ${escapeHtml(order.orderNumber || order.id)}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
            h1 { margin: 0 0 8px; }
            .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0; }
            .box { border: 1px solid #d1d5db; padding: 12px; border-radius: 6px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border-bottom: 1px solid #e5e7eb; text-align: left; padding: 10px; font-size: 13px; }
            th { background: #f3f4f6; }
            .check-cell { width: 34px; text-align: center; }
            .check-box { display: inline-block; width: 16px; height: 16px; border: 2px solid #000; vertical-align: middle; }
            .total { text-align: right; margin-top: 18px; font-weight: 700; font-size: 18px; }
            @media print { button { display: none; } }
          </style>
        </head>
        <body>
          <h1>Picking Slip</h1>
          <div>Order: <strong>${escapeHtml(order.orderNumber || order.id)}</strong></div>
          <div class="meta">
            <div class="box">
              <strong>Customer</strong><br>
              ${escapeHtml(order.customerInfo?.name || "Customer")}<br>
              ${escapeHtml(order.customerInfo?.email || "")}<br>
              ${escapeHtml(order.customerInfo?.phone || "")}
            </div>
            <div class="box">
              <strong>Fulfilment</strong><br>
              ${escapeHtml((order.deliveryOption || "pickup").toUpperCase())}<br>
              ${escapeHtml(order.shippingAddress?.address || order.shippingAddress?.street || "")}
            </div>
          </div>
          <table>
            <thead><tr><th class="check-cell">✓</th><th>SKU</th><th>Location</th><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
            <tbody>${items}</tbody>
          </table>
          <div class="total">Order Total: ${formatMoney(order.totalAmount || 0, order.currency)}</div>
        </body>
      </html>
    `;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      alert("Could not open the print window. Please allow printing/popups for this site.");
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 1000);
    }, 250);
  };

  const paidCount = orders.filter(order => order.paymentStatus === "paid").length;
  const totalRevenue = orders
    .filter(order => order.paymentStatus === "paid")
    .reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);

  // ── 12-month paid revenue breakdown + sold items ─────────────────────────
  const revenueAnalytics = useMemo(() => {
    const paidOrders = orders.filter(o => o.paymentStatus === "paid");

    // Build 12 month buckets ending with current month (oldest first).
    const now = new Date();
    const months: { key: string; label: string; revenue: number; orderCount: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
      months.push({ key, label, revenue: 0, orderCount: 0 });
    }
    const monthIndex = new Map(months.map((m, idx) => [m.key, idx]));

    for (const order of paidOrders) {
      const created = new Date(order.createdAt || "");
      if (Number.isNaN(created.getTime())) continue;
      const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
      const idx = monthIndex.get(key);
      if (idx === undefined) continue;
      months[idx].revenue += Number(order.totalAmount || 0);
      months[idx].orderCount += 1;
    }

    const maxRevenue = months.reduce((m, x) => Math.max(m, x.revenue), 0);
    const totalSoldRevenue = months.reduce((s, m) => s + m.revenue, 0);

    // Aggregate items across the same 12-month window.
    const itemMap = new Map<string, {
      key: string;
      productName: string;
      sku: string;
      quantity: number;
      revenue: number;
    }>();
    for (const order of paidOrders) {
      const created = new Date(order.createdAt || "");
      if (Number.isNaN(created.getTime())) continue;
      const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
      if (!monthIndex.has(key)) continue;

      for (const item of order.items || []) {
        const itemKey = item.sku || item.productId || item.productName || "—";
        const existing = itemMap.get(itemKey) || {
          key: itemKey,
          productName: item.productName || "Unknown",
          sku: item.sku || "—",
          quantity: 0,
          revenue: 0,
        };
        existing.quantity += Number(item.quantity || 0);
        existing.revenue += Number(item.totalPrice || (Number(item.unitPrice || 0) * Number(item.quantity || 0)));
        itemMap.set(itemKey, existing);
      }
    }
    const items = [...itemMap.values()].sort((a, b) => b.quantity - a.quantity);

    return { months, maxRevenue, totalSoldRevenue, items };
  }, [orders]);

  return (
    <div className="absolute inset-0 z-30 bg-background text-foreground overflow-hidden flex flex-col">
      <div className="shrink-0 border-b border-border bg-background/95 px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-foreground/80 hover:text-foreground hover:bg-muted">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Ecommerce</h1>
            <p className="text-sm text-muted-foreground">Store orders from checkout to collection.</p>
          </div>
        </div>
        <Button onClick={loadOrders} disabled={loading} className="bg-blue-600 hover:bg-blue-700">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="shrink-0 border-b border-border p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Kpi title="Orders" value={orders.length} icon={<ShoppingBag className="h-4 w-4" />} />
          <Kpi title="Paid Orders" value={paidCount} icon={<CheckCircle2 className="h-4 w-4" />} />
          <Kpi title="Ready" value={byStage.ready_for_collection.length} icon={<PackageCheck className="h-4 w-4" />} />
          <Kpi
            title="Paid Revenue"
            value={formatMoney(totalRevenue)}
            icon={<Truck className="h-4 w-4" />}
            onClick={() => setShowRevenueDetails(v => !v)}
            active={showRevenueDetails}
          />
        </div>
        {showRevenueDetails && (
          <PaidRevenueDetails analytics={revenueAnalytics} />
        )}
      </div>

      <div className="shrink-0 px-4 py-3 border-b border-border flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <TabButton active={activeTab === "clients"} onClick={() => setActiveTab("clients")} icon={<Users className="h-4 w-4" />} label="Clients" count={clients.length} />
          {STAGES.map(stage => (
            <TabButton key={stage.id} active={activeTab === stage.id} onClick={() => setActiveTab(stage.id)} icon={stage.icon} label={stage.label} count={byStage[stage.id].length} />
          ))}
          {cancelledOrders.length > 0 && (
            <TabButton active={activeTab === "cancelled"} onClick={() => setActiveTab("cancelled")} icon={<X className="h-4 w-4" />} label="Cancelled" count={cancelledOrders.length} />
          )}
        </div>
        <div className="flex items-center gap-2 w-full lg:w-auto">
          <div className="relative flex-1 lg:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search orders, clients, SKU..."
              className="pl-9 bg-card border-border text-foreground"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {activeTab !== "clients" && (
            <div className="flex rounded-md border border-border bg-card overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => setCurrentView("card")}
                aria-label="Card view"
                title="Card view"
                className={`px-2.5 py-2 text-xs flex items-center gap-1 ${currentView === "card" ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentView("list")}
                aria-label="List view"
                title="List view"
                className={`px-2.5 py-2 text-xs flex items-center gap-1 ${currentView === "list" ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ListIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "clients" ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden sm:table-cell">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Phone</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Orders</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Spent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clients.map(client => (
                  <tr key={client.email} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{client.name || "—"}</div>
                      <div className="text-xs text-muted-foreground sm:hidden">{client.email}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{client.email}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{client.phone || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded text-xs font-semibold ${client.orderCount > 0 ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"}`}>
                        {client.orderCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{client.totalSpent > 0 ? formatMoney(client.totalSpent) : <span className="text-muted-foreground font-normal">R0.00</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {clients.length === 0 && <EmptyState label="No ecommerce clients yet." />}
          </div>
        ) : activeTab === "cancelled" ? (
          currentView === "list" ? (
            <div className="space-y-1.5">
              {cancelledOrders.map((order) => (
                <OrderRow key={order.id} order={order} onOpen={() => setExpandedOrder(order)} />
              ))}
              {cancelledOrders.length === 0 && <EmptyState label="No cancelled orders." />}
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {cancelledOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  updating={updatingId === order.id}
                  onPrint={() => printPickingSlip(order)}
                  onRestore={() => restoreCancelledOrder(order)}
                  onSendReminder={() => sendReminder(order)}
                  sendingReminder={sendingReminderId === order.id}
                />
              ))}
              {cancelledOrders.length === 0 && <EmptyState label="No cancelled orders." />}
            </div>
          )
        ) : currentView === "list" ? (
          <div className="space-y-1.5">
            {byStage[activeTab as EcommerceStage].map((order) => (
              <OrderRow key={order.id} order={order} onOpen={() => setExpandedOrder(order)} />
            ))}
            {byStage[activeTab as EcommerceStage].length === 0 && (
              <EmptyState label={`No ${STAGES.find((s) => s.id === activeTab)?.label.toLowerCase()} yet.`} />
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {byStage[activeTab as EcommerceStage].map(order => {
              const stage = STAGES.find(s => s.id === activeTab);
              const isDelivery = order.deliveryOption === "delivery";
              const isReadyTab = activeTab === "ready_for_collection";
              // Delivery orders in "ready_for_collection" → Book Fastway
              // Pickup orders in "ready_for_collection" → Mark Collected directly
              const nextFn = isReadyTab
                ? (isDelivery ? () => bookFastway(order) : () => updateStage(order, "collected"))
                : stage?.next ? () => updateStage(order, stage.next!) : undefined;
              const nextLbl = isReadyTab
                ? (isDelivery ? "🚚 Book Fastway Collection" : "Mark Collected")
                : stage?.action;
              return (
                <OrderCard
                  key={order.id}
                  order={order}
                  nextLabel={nextLbl}
                  updating={updatingId === order.id || bookingFastwayId === order.id}
                  onNext={nextFn}
                  onInStoreCollect={isReadyTab && isDelivery ? () => updateStage(order, "collected") : undefined}
                  onMarkPaid={!isPaid(order) ? () => markPaid(order) : undefined}
                  onUndoPaid={isPaid(order) ? () => requestUndoPaid(order) : undefined}
                  onPrint={() => printPickingSlip(order)}
                  onCancel={() => setPendingCancelOrder(order)}
                  onSendReminder={() => sendReminder(order)}
                  sendingReminder={sendingReminderId === order.id}
                />
              );
            })}
            {byStage[activeTab as EcommerceStage].length === 0 && <EmptyState label={`No ${STAGES.find(s => s.id === activeTab)?.label.toLowerCase()} yet.`} />}
          </div>
        )}
      </div>

      {/* Click-to-expand modal — shows the full OrderCard for the row that was clicked */}
      <Dialog open={!!expandedOrder} onOpenChange={(open) => { if (!open) setExpandedOrder(null); }}>
        <DialogContent className="max-w-2xl p-0 bg-transparent border-0 shadow-none">
          {expandedOrder && (() => {
            // Always read the latest copy of the order from state in case it changed
            const fresh = orders.find((o) => o.id === expandedOrder.id) || expandedOrder;
            const stageHere = STAGES.find((s) => s.id === stageFor(fresh));
            const isCancelled = fresh.status === "cancelled";
            return (
              <OrderCard
                order={fresh}
                nextLabel={stageHere?.id === "ready_for_collection" ? (fresh.deliveryOption === "delivery" ? "🚚 Book Fastway Collection" : "Mark Collected") : stageHere?.action}
                updating={updatingId === fresh.id || bookingFastwayId === fresh.id}
                onNext={!isCancelled && stageHere?.id === "ready_for_collection"
                  ? (fresh.deliveryOption === "delivery" ? () => bookFastway(fresh) : () => updateStage(fresh, "collected"))
                  : (!isCancelled && stageHere?.next ? () => updateStage(fresh, stageHere.next!) : undefined)}
                onInStoreCollect={!isCancelled && stageHere?.id === "ready_for_collection" && fresh.deliveryOption === "delivery"
                  ? () => { updateStage(fresh, "collected"); setExpandedOrder(null); }
                  : undefined}
                onMarkPaid={!isCancelled && !isPaid(fresh) ? () => markPaid(fresh) : undefined}
                onUndoPaid={!isCancelled && isPaid(fresh) ? () => requestUndoPaid(fresh) : undefined}
                onPrint={() => printPickingSlip(fresh)}
                onCancel={!isCancelled ? () => { setPendingCancelOrder(fresh); setExpandedOrder(null); } : undefined}
                onRestore={isCancelled ? () => { restoreCancelledOrder(fresh); setExpandedOrder(null); } : undefined}
                onSendReminder={() => sendReminder(fresh)}
                sendingReminder={sendingReminderId === fresh.id}
              />
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingUndoOrder} onOpenChange={(open) => { if (!open) closeUndoDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Undo Paid Order</DialogTitle>
            <DialogDescription>
              Enter the supervisor password to move this order back to awaiting payment and reinsert deducted stock.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              Only continue if this order was marked paid by mistake.
            </div>
            <div className="space-y-2">
              <Label htmlFor="supervisorUndoPassword">Supervisor Password</Label>
              <Input
                id="supervisorUndoPassword"
                type="password"
                value={undoPassword}
                onChange={(event) => {
                  setUndoPassword(event.target.value);
                  setUndoError("");
                }}
                autoComplete="off"
                autoFocus
              />
            </div>
            {undoError && <p className="text-sm text-red-600">{undoError}</p>}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={closeUndoDialog}>Cancel</Button>
            <Button
              onClick={undoPaid}
              disabled={!pendingUndoOrder || updatingId === pendingUndoOrder.id}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {pendingUndoOrder && updatingId === pendingUndoOrder.id ? "Undoing..." : "Undo Paid"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel-order dialog */}
      <Dialog open={!!pendingCancelOrder} onOpenChange={(open) => { if (!open) closeCancelDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Order</DialogTitle>
            <DialogDescription>
              {pendingCancelOrder?.orderNumber || pendingCancelOrder?.id}
              {pendingCancelOrder && isPaid(pendingCancelOrder) && " · was PAID — restock will be triggered"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              The order will be removed from the active tabs and moved to <strong>Cancelled</strong>.
              {pendingCancelOrder && isPaid(pendingCancelOrder) && (
                <> Stock from this order will be put back into inventory, and the linked invoice will be marked cancelled.</>
              )}
            </div>

            <div className="space-y-2">
              <Label>Reason</Label>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value as CancelReason)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {CANCEL_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cancelNote">Note (optional)</Label>
              <textarea
                id="cancelNote"
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                placeholder="Anything else worth recording"
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            {cancelError && <p className="text-sm text-red-600">{cancelError}</p>}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={closeCancelDialog}>Back</Button>
            <Button
              onClick={submitCancelOrder}
              disabled={!pendingCancelOrder || updatingId === pendingCancelOrder.id}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {pendingCancelOrder && updatingId === pendingCancelOrder.id ? "Cancelling…" : "Cancel Order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ title, value, icon, onClick, active }: {
  title: string;
  value: string | number;
  icon: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      type={onClick ? "button" : undefined}
      className={`rounded-lg border p-4 w-full text-left transition-colors ${
        onClick ? "cursor-pointer hover:border-blue-500/60" : ""
      } ${active ? "border-blue-500 bg-card" : "border-border bg-card"}`}
    >
      <div className="flex items-center justify-between text-muted-foreground text-xs uppercase tracking-wider">
        <span>{title}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-bold text-foreground">{value}</div>
      {onClick && (
        <div className="mt-1 text-[10px] text-blue-400">
          {active ? "Hide details ▴" : "Click for details ▾"}
        </div>
      )}
    </Tag>
  );
}

function PaidRevenueDetails({ analytics }: {
  analytics: {
    months: { key: string; label: string; revenue: number; orderCount: number }[];
    maxRevenue: number;
    totalSoldRevenue: number;
    items: { key: string; productName: string; sku: string; quantity: number; revenue: number }[];
  };
}) {
  const { months, maxRevenue, totalSoldRevenue, items } = analytics;
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
      {/* Monthly bar chart */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">Paid Revenue · Last 12 months</h3>
          <span className="text-xs text-muted-foreground">Total: {formatMoney(totalSoldRevenue)}</span>
        </div>
        <div className="flex items-end gap-1.5 h-32">
          {months.map(m => {
            const pct = maxRevenue > 0 ? (m.revenue / maxRevenue) * 100 : 0;
            return (
              <div key={m.key} className="flex-1 flex flex-col items-center gap-1" title={`${m.label}: ${formatMoney(m.revenue)} · ${m.orderCount} orders`}>
                <div className="w-full flex items-end h-full">
                  <div
                    className="w-full bg-gradient-to-t from-blue-600 to-blue-400 rounded-t transition-all"
                    style={{ height: `${pct}%`, minHeight: m.revenue > 0 ? 2 : 0 }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground leading-none">{m.label}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-12 gap-1.5 text-[10px] text-muted-foreground">
          {months.map(m => (
            <div key={m.key} className="text-center truncate">
              {m.revenue > 0 ? formatMoney(m.revenue) : "—"}
            </div>
          ))}
        </div>
      </div>

      {/* Sold items table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">Items sold · Restock candidates</h3>
          <span className="text-xs text-muted-foreground">{items.length} SKUs</span>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">No paid orders in the last 12 months.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-muted-foreground text-xs uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Product</th>
                  <th className="text-left px-3 py-2 font-medium">SKU</th>
                  <th className="text-right px-3 py-2 font-medium">Qty sold</th>
                  <th className="text-right px-3 py-2 font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.key} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 text-foreground">{it.productName}</td>
                    <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{it.sku}</td>
                    <td className="px-3 py-2 text-right text-foreground font-semibold">{it.quantity}</td>
                    <td className="px-3 py-2 text-right text-foreground/80">{formatMoney(it.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, count }: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
        active ? "bg-blue-600 border-blue-500 text-white" : "bg-card border-border text-foreground/80 hover:bg-muted"
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/20" : "bg-muted"}`}>{count}</span>
    </button>
  );
}

function OrderCard({ order, nextLabel, updating, sendingReminder, onNext, onInStoreCollect, onMarkPaid, onUndoPaid, onPrint, onCancel, onRestore, onSendReminder }: {
  order: EcommerceOrder;
  nextLabel?: string;
  updating: boolean;
  sendingReminder?: boolean;
  onNext?: () => void;
  onInStoreCollect?: () => void;
  onMarkPaid?: () => void;
  onUndoPaid?: () => void;
  onPrint: () => void;
  onCancel?: () => void;
  onRestore?: () => void;
  onSendReminder?: () => void;
}) {
  const paid = isPaid(order);
  const readyForOps = canFulfil(order);

  return (
    <div className={`rounded-lg border bg-card p-3 space-y-2.5 ${order.deliveryOption === "delivery" ? "border-green-500/60" : "border-border"}`}>

      {/* ── Big delivery indicator ─────────────────────────────────── */}
      {order.deliveryOption === "delivery" && (
        <div className="flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-white font-bold text-sm">
          <Truck className="h-4 w-4 shrink-0" />
          <span>DELIVERY ORDER</span>
          {order.shippingAddress && (
            <span className="ml-auto font-normal text-xs text-green-100 truncate max-w-[180px]">
              {[order.shippingAddress.street || order.shippingAddress.address, order.shippingAddress.city].filter(Boolean).join(", ")}
            </span>
          )}
        </div>
      )}

      {/* ── Waybill banner (shown once Fastway is booked) ─────────── */}
      {order.waybillNumber && (
        <div className="flex items-center gap-3 rounded-md bg-blue-950 border border-blue-600 px-3 py-2">
          <Truck className="h-4 w-4 text-blue-300 shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] text-blue-400 uppercase tracking-wide">Fastway Waybill</div>
            <div className="text-sm font-bold text-white font-mono">{order.waybillNumber}</div>
            {order.fastwayBookedAt && (
              <div className="text-[10px] text-blue-300">{new Date(order.fastwayBookedAt).toLocaleString()}</div>
            )}
          </div>
          <a
            href={`https://tracking.fastway.co.za/Home/Trace?l=${order.waybillNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-blue-300 underline hover:text-white shrink-0"
          >
            Track →
          </a>
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-xs text-foreground/60">{order.orderNumber || order.id}</div>
          <h3 className="text-sm font-bold leading-tight">{order.customerInfo?.name || "Customer"}</h3>
          <div className="text-xs text-muted-foreground">{order.customerInfo?.email}</div>
          <div className="text-xs text-muted-foreground">{order.customerInfo?.phone}</div>
        </div>
        <div className="text-right">
          <div className="text-base font-bold">{formatMoney(order.totalAmount || 0, order.currency)}</div>
          <div className="mt-1 flex justify-end gap-1 flex-wrap">
            {order.source === "walk_in" && (
              <Badge className="bg-emerald-950 border border-emerald-700 text-emerald-200 text-[10px] px-1.5 py-0">
                Walk-in
              </Badge>
            )}
            <Badge className={paymentBadgeClass(order.paymentStatus) + " text-[10px] px-1.5 py-0"}>
              {paid ? "paid" : order.paymentStatus === "failed" ? "failed" : "awaiting payment"}
            </Badge>
            {order.deliveryOption === "pickup" && (
              <Badge variant="outline" className="border-border text-foreground/80 text-[10px] px-1.5 py-0">
                pickup
              </Badge>
            )}
          </div>
          {order.stockDeductedAt && (
            <div className="mt-1 text-[10px] text-green-400">Stock deducted</div>
          )}
          {order.invoiceNumber && (
            <div className="text-[10px] text-blue-300">Invoice {order.invoiceNumber}</div>
          )}
          {order.invoiceEmailSentAt && (
            <div className="text-[10px] text-emerald-300">Invoice emailed</div>
          )}
          {order.invoiceEmailError && (
            <div className="text-[10px] text-amber-300">Invoice email failed</div>
          )}
        </div>
      </div>

      {!readyForOps && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200">
          Payment not confirmed yet. Keep this in Orders until iKhokha confirms payment, or mark it paid after checking the iKhokha dashboard.
        </div>
      )}

      <div className="rounded-md bg-background border border-border divide-y divide-border">
        {(order.items || []).map((item, index) => (
          <div key={`${order.id}-${index}`} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
            <div className="min-w-0">
              <div className="font-medium truncate">{item.productName || "Product"}</div>
              <div className="text-[10px] text-muted-foreground">{item.sku || item.variantName || "No SKU"}</div>
            </div>
            <div className="text-right shrink-0">
              <div>x {item.quantity || 1}</div>
              <div className="text-[10px] text-muted-foreground">{formatMoney(item.totalPrice || 0, order.currency)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={onPrint} className="h-7 text-xs px-2 border-border bg-background text-foreground hover:bg-muted">
          <Printer className="h-3 w-3 mr-1" />
          Print Slip
        </Button>
        {onSendReminder && !isPaid(order) && order.customerInfo?.email && (
          <Button size="sm" variant="outline" onClick={onSendReminder} disabled={sendingReminder} className="h-7 text-xs px-2 border-amber-700 bg-amber-950 text-amber-100 hover:bg-amber-900">
            <Mail className="h-3 w-3 mr-1" />
            {sendingReminder ? "Sending…" : "Send Reminder"}
          </Button>
        )}
        {onNext && (
          <Button
            size="sm"
            onClick={onNext}
            disabled={updating || !readyForOps}
            className={`h-7 text-xs px-2 disabled:opacity-50 ${
              nextLabel?.includes("Fastway")
                ? "bg-green-600 hover:bg-green-700 text-white font-bold"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {updating
              ? (nextLabel?.includes("Fastway") ? "Booking..." : "Updating...")
              : readyForOps ? nextLabel : "Waiting for Payment"}
          </Button>
        )}
        {onInStoreCollect && (
          <Button
            size="sm"
            onClick={onInStoreCollect}
            disabled={updating || !readyForOps}
            className="h-7 text-xs px-2 bg-orange-600 hover:bg-orange-700 text-white font-bold disabled:opacity-50"
          >
            🏪 In-Store Collected
          </Button>
        )}
        {onMarkPaid && (
          <Button size="sm" variant="outline" onClick={onMarkPaid} disabled={updating} className="h-7 text-xs px-2 border-green-700 bg-green-950 text-green-100 hover:bg-green-900">
            Mark Paid
          </Button>
        )}
        {onUndoPaid && (
          <Button size="sm" variant="outline" onClick={onUndoPaid} disabled={updating} className="h-7 text-xs px-2 border-red-700 bg-red-950 text-red-100 hover:bg-red-900">
            Undo Paid
          </Button>
        )}
        {onCancel && (
          <Button size="sm" variant="outline" onClick={onCancel} disabled={updating} className="h-7 text-xs px-2 border-red-700 bg-red-950 text-red-100 hover:bg-red-900 ml-auto">
            <X className="h-3 w-3 mr-1" />
            Cancel Order
          </Button>
        )}
        {onRestore && (
          <Button size="sm" variant="outline" onClick={onRestore} disabled={updating} className="h-7 text-xs px-2 border-emerald-700 bg-emerald-950 text-emerald-100 hover:bg-emerald-900">
            Restore Order
          </Button>
        )}
      </div>

      {order.status === "cancelled" && (
        <div className="rounded-md border border-red-900 bg-red-950/40 text-red-200 px-2.5 py-1.5 text-[10px]">
          <strong>Cancelled</strong>
          {order.cancelledAt && ` · ${new Date(order.cancelledAt).toLocaleString()}`}
          {order.cancelledReason && ` · ${order.cancelledReason}`}
          {order.cancelledNote && (
            <div className="mt-0.5 text-red-300/80 italic">"{order.cancelledNote}"</div>
          )}
        </div>
      )}
    </div>
  );
}

function OrderRow({ order, onOpen }: {
  order: EcommerceOrder;
  onOpen: () => void;
}) {
  const itemCount = (order.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0);
  const dateStr = order.createdAt
    ? new Date(order.createdAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" })
    : "—";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-md border border-border bg-card hover:bg-muted hover:border-border transition-colors px-3 py-2.5 flex items-center gap-3"
    >
      <div className="font-mono text-xs text-muted-foreground shrink-0 w-32 truncate">
        {order.orderNumber || order.id}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-foreground truncate">
          {order.customerInfo?.name || "Customer"}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {order.customerInfo?.email || order.customerInfo?.phone || ""}
        </div>
      </div>
      <div className="text-xs text-muted-foreground shrink-0 w-24 text-right">{dateStr}</div>
      <div className="text-xs text-muted-foreground shrink-0 w-16 text-right tabular-nums">
        {itemCount} item{itemCount === 1 ? "" : "s"}
      </div>
      <div className="text-sm font-bold text-foreground shrink-0 w-24 text-right">
        {formatMoney(order.totalAmount || 0, order.currency)}
      </div>
      <div className="flex gap-1 shrink-0">
        {order.source === "walk_in" && (
          <Badge className="bg-emerald-950 border border-emerald-700 text-emerald-200">walk-in</Badge>
        )}
        {order.status !== "cancelled" && (
          <Badge className={paymentBadgeClass(order.paymentStatus)}>
            {order.paymentStatus || "pending"}
          </Badge>
        )}
        {order.status === "cancelled" && (
          <Badge className="bg-red-950 border border-red-700 text-red-200">cancelled</Badge>
        )}
      </div>
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="col-span-full rounded-lg border border-dashed border-border bg-card/60 p-10 text-center text-muted-foreground">
      {label}
    </div>
  );
}
