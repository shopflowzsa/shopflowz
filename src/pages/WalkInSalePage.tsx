import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  X, Search, Plus, Minus, Trash2, ShoppingCart, User, UserPlus,
  ChevronRight, Package, CheckCircle2, ArrowLeft, Clock, ShoppingBag,
  AlertCircle, Printer, Banknote, CreditCard, FileEdit,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getCustomers } from "@/lib/customerService";
import { inventoryService, InventoryItem } from "@/lib/inventoryService";
import { createOrder, getOrder, getOrders } from "@/lib/orderService";
import { createStockMovement } from "@/lib/stockMovementService";
import { Customer } from "@/types/invoice";
import { Order } from "@/types/ecommerce";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CartLine {
  item: InventoryItem;
  qty: number;
  unitPrice: number;
}

interface CompletedSale {
  orderId: string;
  orderNumber: string;
  items: CartLine[];
  total: number;
  label: string;
  payMethod: "cash" | "card";
  tendered: number;
  change: number;
  timestamp: string;
}

type SessionStep = "client" | "history" | "sale";

interface WalkInSession {
  id: string;
  label: string;
  step: SessionStep;
  clientMode: "existing" | "new" | "edit_order" | null;
  selectedCustomer: Customer | null;
  newName: string;
  newPhone: string;
  newEmail: string;
  editingOrderId?: string;
  cart: CartLine[];
  createdAt: string;
  completed?: CompletedSale;
}

interface WalkInSalePageProps {
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(order: Order) {
  if (order.paymentStatus === "paid")
    return <span className="text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Paid</span>;
  if (order.status === "cancelled")
    return <span className="text-[10px] font-semibold bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Cancelled</span>;
  return <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Unpaid</span>;
}

function groupByMonth(orders: Order[]): { label: string; orders: Order[] }[] {
  const map = new Map<string, Order[]>();
  for (const o of orders) {
    const d = new Date(o.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(o);
  }
  return Array.from(map.entries()).map(([key, orders]) => {
    const [year, month] = key.split("-");
    const label = new Date(Number(year), Number(month) - 1).toLocaleString("en-ZA", { month: "long", year: "numeric" });
    return { label, orders };
  });
}

function printSlip(sale: CompletedSale, storeName: string) {
  const rows = sale.items.map((l) => `
    <tr>
      <td style="padding:3px 6px">${l.item.name}${l.item.sku ? `<br><span style="color:#888;font-size:10px">${l.item.sku}</span>` : ""}</td>
      <td style="padding:3px 6px;text-align:center">×${l.qty}</td>
      <td style="padding:3px 6px;text-align:right">R${l.unitPrice.toFixed(2)}</td>
      <td style="padding:3px 6px;text-align:right">R${(l.unitPrice * l.qty).toFixed(2)}</td>
    </tr>`).join("");
  const cashRows = sale.payMethod === "cash" && sale.tendered > 0 ? `
    <tr><td colspan="3" style="text-align:right;padding:3px 6px">Cash tendered:</td>
        <td style="text-align:right;padding:3px 6px">R${sale.tendered.toFixed(2)}</td></tr>
    <tr><td colspan="3" style="text-align:right;padding:3px 6px;font-weight:bold">Change:</td>
        <td style="text-align:right;padding:3px 6px;font-weight:bold;color:#16a34a">R${sale.change.toFixed(2)}</td></tr>` : "";
  const html = `<!DOCTYPE html><html><head><title>Receipt ${sale.orderNumber}</title>
  <style>
    @page { margin: 10mm; }
    body { font-family: monospace; max-width: 300px; margin: 0 auto; font-size: 12px; }
    h2 { text-align:center; margin:4px 0; font-size:16px; }
    .sub { text-align:center; font-size:11px; color:#555; margin:2px 0; }
    hr { border:none; border-top:1px dashed #000; margin:6px 0; }
    table { width:100%; border-collapse:collapse; }
    th { font-size:10px; text-align:left; border-bottom:1px solid #000; padding:2px 6px; }
    .total-row td { font-weight:bold; font-size:14px; }
    .footer { text-align:center; font-size:11px; color:#555; margin-top:8px; }
  </style></head><body>
  <h2>${storeName}</h2><p class="sub">Counter Sale</p><hr>
  <p style="margin:2px 0;font-size:11px"><b>Order:</b> #${sale.orderNumber}</p>
  <p style="margin:2px 0;font-size:11px"><b>Customer:</b> ${sale.label}</p>
  <p style="margin:2px 0;font-size:11px"><b>Date:</b> ${new Date(sale.timestamp).toLocaleString("en-ZA")}</p><hr>
  <table><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr></thead>
  <tbody>${rows}</tbody></table><hr>
  <table>
    <tr class="total-row"><td colspan="3" style="text-align:right;padding:3px 6px">TOTAL:</td><td style="text-align:right;padding:3px 6px">R${sale.total.toFixed(2)}</td></tr>
    <tr><td colspan="3" style="text-align:right;padding:3px 6px">Payment:</td><td style="text-align:right;padding:3px 6px">${sale.payMethod === "cash" ? "Cash" : "Card"}</td></tr>
    ${cashRows}
  </table><hr>
  <p class="footer">Thank you for your business!</p>
  <script>window.onload=function(){setTimeout(function(){window.print();},200);}</script>
  </body></html>`;
  const w = window.open("", "_blank", "width=380,height=650,resizable=yes");
  if (w) { w.document.write(html); w.document.close(); }
}

function newSession(n: number): WalkInSession {
  return {
    id: `ws_${Date.now()}_${n}`,
    label: `Customer ${n}`,
    step: "client",
    clientMode: null,
    selectedCustomer: null,
    newName: "", newPhone: "", newEmail: "",
    cart: [],
    createdAt: new Date().toISOString(),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WalkInSalePage({ onClose }: WalkInSalePageProps) {
  const { workspace, user } = useAuth();
  const workspaceId = workspace?.id ?? "";
  const storeName = workspace?.name || "Counter Sale";

  // Sessions — persisted to localStorage so navigation away doesn't lose them
  const [sessions, setSessions] = useState<WalkInSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [storageLoaded, setStorageLoaded] = useState(false);

  // Customers (shared, loaded once)
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  // Order history (for active existing-client session)
  const [history, setHistory] = useState<Order[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  // Edit existing order
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [allOrdersLoading, setAllOrdersLoading] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");
  const orderSearchRef = useRef<HTMLInputElement>(null);

  // Products (shared, loaded once)
  const [products, setProducts] = useState<InventoryItem[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productFilter, setProductFilter] = useState<"active" | "inactive" | "both">("active");
  const productSearchRef = useRef<HTMLInputElement>(null);
  const customerSearchRef = useRef<HTMLInputElement>(null);

  // Checkout dialog
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<"cash" | "card">("cash");
  const [tendered, setTendered] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Restore sessions from localStorage when workspace is ready
  useEffect(() => {
    if (!workspaceId) return;
    try {
      const raw = localStorage.getItem(`walkin_sessions_${workspaceId}`);
      if (raw) {
        const parsed: WalkInSession[] = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSessions(parsed);
          const savedActiveId = localStorage.getItem(`walkin_active_${workspaceId}`);
          const validId = parsed.find((s) => s.id === savedActiveId)?.id ?? parsed[0].id;
          setActiveId(validId);
        }
      }
    } catch { /* ignore corrupt storage */ }
    setStorageLoaded(true);
  }, [workspaceId]);

  // Persist sessions to localStorage whenever they change (after initial load)
  useEffect(() => {
    if (!workspaceId || !storageLoaded) return;
    try {
      localStorage.setItem(`walkin_sessions_${workspaceId}`, JSON.stringify(sessions));
    } catch { /* storage full — ignore */ }
  }, [sessions, workspaceId, storageLoaded]);

  // Persist activeId
  useEffect(() => {
    if (!workspaceId || !storageLoaded) return;
    try {
      if (activeId) {
        localStorage.setItem(`walkin_active_${workspaceId}`, activeId);
      } else {
        localStorage.removeItem(`walkin_active_${workspaceId}`);
      }
    } catch {}
  }, [activeId, workspaceId, storageLoaded]);

  // Load customers once
  useEffect(() => {
    if (!workspaceId) return;
    setCustomersLoading(true);
    getCustomers(workspaceId)
      .then(setCustomers)
      .catch(() => toast.error("Failed to load customers"))
      .finally(() => setCustomersLoading(false));
  }, [workspaceId]);

  // Load products once
  useEffect(() => {
    if (!workspaceId) return;
    setProductsLoading(true);
    inventoryService.getAll(workspaceId)
      .then(setProducts)
      .catch(() => toast.error("Failed to load inventory"))
      .finally(() => setProductsLoading(false));
  }, [workspaceId]);

  // Load order history when active session has an existing customer in history step
  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  useEffect(() => {
    if (!activeSession?.selectedCustomer || activeSession.step !== "history") {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    getOrders(workspaceId, { customerId: activeSession.selectedCustomer.id })
      .then(setHistory)
      .catch(() => toast.error("Failed to load order history"))
      .finally(() => setHistoryLoading(false));
  }, [activeSession?.id, activeSession?.step, activeSession?.selectedCustomer?.id, workspaceId]);

  // Load all orders when edit_order mode is selected
  useEffect(() => {
    if (activeSession?.clientMode !== "edit_order" || allOrders.length > 0) return;
    setAllOrdersLoading(true);
    getOrders(workspaceId, { limit: 200 })
      .then(setAllOrders)
      .catch(() => toast.error("Failed to load orders"))
      .finally(() => setAllOrdersLoading(false));
  }, [activeSession?.clientMode, workspaceId]);

  // Focus search inputs when mode changes
  useEffect(() => {
    if (activeSession?.step === "sale") {
      setTimeout(() => productSearchRef.current?.focus(), 100);
    }
    if (activeSession?.step === "client" && activeSession?.clientMode === "existing") {
      setTimeout(() => customerSearchRef.current?.focus(), 100);
    }
    if (activeSession?.step === "client" && activeSession?.clientMode === "edit_order") {
      setTimeout(() => orderSearchRef.current?.focus(), 100);
    }
  }, [activeSession?.step, activeSession?.clientMode]);

  // Derived data
  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers;
    const q = customerSearch.toLowerCase();
    return customers.filter((c) =>
      c.contactPerson?.toLowerCase().includes(q) ||
      c.companyName?.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  }, [customers, customerSearch]);

  const filteredProducts = useMemo(() => {
    const byStatus = products.filter((p) => {
      if (productFilter === "active") return p.status === "active";
      if (productFilter === "inactive") return p.status === "inactive";
      return true;
    });
    if (!productSearch) return byStatus.slice(0, 40);
    const words = productSearch.toLowerCase().split(/\s+/).filter(Boolean);
    return byStatus.filter((p) => {
      const hay = [p.name, p.sku, p.category, p.description, p.barcode]
        .map((v) => (v || "").toLowerCase()).join(" ");
      return words.every((w) => hay.includes(w));
    });
  }, [products, productSearch, productFilter]);

  const monthGroups = useMemo(() => groupByMonth(history), [history]);

  const filteredOrders = useMemo(() => {
    const list = allOrders.slice(0, 100);
    if (!orderSearch) return list;
    const q = orderSearch.toLowerCase();
    return allOrders.filter((o) =>
      o.orderNumber?.toLowerCase().includes(q) ||
      o.customerInfo?.name?.toLowerCase().includes(q) ||
      o.customerInfo?.phone?.includes(q) ||
      o.customerInfo?.email?.toLowerCase().includes(q)
    );
  }, [allOrders, orderSearch]);

  const activeCart = activeSession?.cart ?? [];
  const cartTotal = useMemo(() => activeCart.reduce((s, l) => s + l.unitPrice * l.qty, 0), [activeCart]);
  const cartCount = useMemo(() => activeCart.reduce((s, l) => s + l.qty, 0), [activeCart]);

  // Checkout
  const checkoutSession = checkoutId ? sessions.find((s) => s.id === checkoutId) : null;
  const checkoutTotal = checkoutSession?.cart.reduce((s, l) => s + l.unitPrice * l.qty, 0) ?? 0;
  const tenderedNum = parseFloat(tendered) || 0;
  const change = Math.max(0, tenderedNum - checkoutTotal);

  // Session helpers
  function updateSession(id: string, patch: Partial<WalkInSession>) {
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
  }

  function createNewSession() {
    const openCount = sessions.filter((s) => !s.completed).length;
    const s = newSession(openCount + 1);
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setCustomerSearch("");
    setHistory([]);
  }

  function addToCart(item: InventoryItem) {
    if (!activeId || activeSession?.step !== "sale" || activeSession?.completed) return;
    setSessions((prev) => prev.map((s) => {
      if (s.id !== activeId) return s;
      const idx = s.cart.findIndex((l) => l.item.id === item.id);
      if (idx >= 0) {
        const cart = [...s.cart];
        cart[idx] = { ...cart[idx], qty: cart[idx].qty + 1 };
        return { ...s, cart };
      }
      return { ...s, cart: [...s.cart, { item, qty: 1, unitPrice: item.salePrice ?? item.price ?? 0 }] };
    }));
  }

  function setQty(itemId: string, qty: number) {
    if (!activeId) return;
    setSessions((prev) => prev.map((s) => {
      if (s.id !== activeId) return s;
      return { ...s, cart: qty < 1 ? s.cart.filter((l) => l.item.id !== itemId) : s.cart.map((l) => l.item.id === itemId ? { ...l, qty } : l) };
    }));
  }

  function setLinePrice(itemId: string, price: number) {
    if (!activeId) return;
    setSessions((prev) => prev.map((s) => {
      if (s.id !== activeId) return s;
      return { ...s, cart: s.cart.map((l) => l.item.id === itemId ? { ...l, unitPrice: price } : l) };
    }));
  }

  function removeFromCart(itemId: string) {
    if (!activeId) return;
    setSessions((prev) => prev.map((s) => s.id !== activeId ? s : { ...s, cart: s.cart.filter((l) => l.item.id !== itemId) }));
  }

  function closeSession(id: string) {
    const next = sessions.find((s) => s.id !== id && !s.completed);
    setSessions((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      if (updated.length === 0 && workspaceId) {
        localStorage.removeItem(`walkin_sessions_${workspaceId}`);
        localStorage.removeItem(`walkin_active_${workspaceId}`);
      }
      return updated;
    });
    if (activeId === id) setActiveId(next?.id ?? null);
  }

  function loadOrderIntoSession(order: Order) {
    if (!activeId) return;
    // Map order items back to CartLine using product ids
    const cart: CartLine[] = (order.items ?? []).map((oi) => {
      const found = products.find((p) => p.id === oi.productId);
      const stub: InventoryItem = found ?? ({
        id: oi.productId,
        name: oi.productName,
        sku: oi.sku ?? "",
        description: "",
        category: "",
        price: oi.unitPrice,
        costPrice: 0,
        quantity: 999,
        reorderLevel: 0,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as InventoryItem);
      return { item: stub, qty: oi.quantity, unitPrice: oi.unitPrice };
    });
    const label = `${order.customerInfo?.name ?? "Customer"} – #${order.orderNumber}`;
    updateSession(activeId, {
      label,
      editingOrderId: order.id,
      cart,
      step: "sale",
    });
    setOrderSearch("");
  }

  async function handleCheckout() {
    if (!checkoutSession || checkoutSession.cart.length === 0) return;
    if (payMethod === "cash" && tenderedNum > 0 && tenderedNum < checkoutTotal)
      return toast.error(`Amount tendered (R${tenderedNum.toFixed(2)}) is less than total (R${checkoutTotal.toFixed(2)})`);
    setSubmitting(true);
    try {
      const label = checkoutSession.label;
      const orderId = await createOrder(workspaceId, {
        customer: { id: checkoutSession.selectedCustomer?.id ?? `walkin_${Date.now()}`, name: label, email: checkoutSession.selectedCustomer?.email ?? checkoutSession.newEmail, phone: checkoutSession.selectedCustomer?.phone ?? checkoutSession.newPhone } as any,
        items: checkoutSession.cart.map((l) => ({ productId: l.item.id, variantId: l.item.id, productName: l.item.name, variantName: "", sku: l.item.sku, quantity: l.qty, price: l.unitPrice, productImage: l.item.imageUrl })),
        shippingAddress: { firstName: label, lastName: "", street: "Counter pickup", city: "Walk-in", province: "", postalCode: "", country: "ZA" } as any,
        paymentMethod: { id: payMethod, type: payMethod, name: payMethod === "cash" ? "Cash" : "Card" } as any,
        source: "walk_in",
        status: "confirmed",
        paymentStatus: "paid",
        notes: `Counter sale — ${payMethod === "cash" ? `Cash, tendered R${tenderedNum.toFixed(2)}, change R${change.toFixed(2)}` : "Card payment"}`,
      });
      let orderNumber: string;
      try {
        const created = await getOrder(workspaceId, orderId);
        orderNumber = created?.orderNumber ?? orderId.replace("order_", "").slice(0, 8).toUpperCase();
      } catch { orderNumber = orderId.replace("order_", "").slice(0, 8).toUpperCase(); }

      // Deduct sold stock and record a 'sale' movement per line — counter
      // sales previously left inventory untouched entirely.
      const userId = user?.uid ?? "unknown";
      const userName = user?.displayName || user?.email || "Staff";
      for (const line of checkoutSession.cart) {
        try {
          await createStockMovement(workspaceId, userId, userName, {
            productId: line.item.id,
            productName: line.item.name,
            sku: line.item.sku,
            type: "sale",
            quantity: -line.qty,
            unitCost: line.item.costPrice,
            referenceType: "manual",
            referenceId: orderId,
            referenceNumber: orderNumber,
            notes: `Counter sale — ${label}`,
          });
        } catch (stockErr) {
          console.error(`Failed to deduct stock for ${line.item.name}:`, stockErr);
          // Don't block the completed sale on a stock-sync failure — the order
          // itself already succeeded and the customer has paid.
        }
      }

      const sale: CompletedSale = { orderId, orderNumber, items: [...checkoutSession.cart], total: checkoutTotal, label, payMethod, tendered: tenderedNum, change, timestamp: new Date().toISOString() };
      setSessions((prev) => prev.map((s) => s.id === checkoutId ? { ...s, completed: sale } : s));
      setCheckoutId(null);
      setTendered("");
      toast.success(`Sale complete — Order #${orderNumber}`);
      printSlip(sale, storeName);
    } catch (e) {
      console.error(e);
      toast.error("Failed to create order");
    } finally {
      setSubmitting(false);
    }
  }

  const openSessions = sessions.filter((s) => !s.completed);
  const completedSessions = sessions.filter((s) => s.completed);

  const stepLabel = activeSession
    ? activeSession.step === "history" ? `${activeSession.label} — Order History`
    : activeSession.step === "sale" ? activeSession.label
    : ""
    : "";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="absolute inset-0 z-30 bg-gray-50 flex flex-col overflow-hidden">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
        {activeSession && (activeSession.step === "history" || activeSession.step === "sale") && (
          <button
            onClick={() => {
              if (activeSession.step === "sale") {
                updateSession(activeSession.id, { step: activeSession.selectedCustomer ? "history" : "client", clientMode: null });
              } else {
                updateSession(activeSession.id, { step: "client", clientMode: null, selectedCustomer: null });
                setHistory([]);
              }
            }}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <ShoppingCart className="h-5 w-5 text-orange-500" />
        <h1 className="text-lg font-bold text-gray-900">Counter Sale</h1>
        {stepLabel && <span className="text-sm text-gray-400 font-medium truncate">{stepLabel}</span>}
        <div className="ml-auto">
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: Sessions panel ────────────────────────────────────── */}
        <div className="w-44 shrink-0 flex flex-col bg-white border-r border-gray-200">
          <div className="p-3 border-b border-gray-100">
            <button
              onClick={createNewSession}
              className="w-full flex items-center justify-center gap-1.5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold rounded-lg transition-colors"
            >
              <Plus className="h-4 w-4" /> New Sale
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {sessions.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-300 p-4">
                <ShoppingBag className="h-8 w-8" />
                <p className="text-xs text-center text-gray-400">Tap "New Sale" to start</p>
              </div>
            )}

            {openSessions.map((s) => (
              <button
                key={s.id}
                onClick={() => { setActiveId(s.id); setCustomerSearch(""); }}
                className={`w-full text-left flex items-center gap-2 px-3 py-2.5 border-l-2 transition-all ${
                  activeId === s.id ? "border-orange-400 bg-orange-50" : "border-transparent hover:bg-gray-50"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-gray-800 truncate">{s.label}</p>
                  <p className="text-[10px] text-gray-400">
                    {s.step === "client" ? "Selecting client…"
                    : s.step === "history" ? "Order history"
                    : s.cart.length === 0 ? "Empty cart"
                    : `${s.cart.reduce((n, l) => n + l.qty, 0)} items · R${s.cart.reduce((n, l) => n + l.unitPrice * l.qty, 0).toFixed(2)}`}
                  </p>
                </div>
                <ShoppingCart className="h-3.5 w-3.5 text-orange-400 shrink-0" />
              </button>
            ))}

            {completedSessions.length > 0 && (
              <>
                <div className="px-3 pt-3 pb-1">
                  <p className="text-[10px] font-bold text-gray-300 uppercase tracking-wide">Completed</p>
                </div>
                {completedSessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    className={`w-full text-left flex items-center gap-2 px-3 py-2.5 border-l-2 transition-all ${
                      activeId === s.id ? "border-green-400 bg-green-50" : "border-transparent hover:bg-gray-50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-500 truncate">{s.label}</p>
                      <p className="text-[10px] text-green-600 font-semibold">✓ R{s.completed!.total.toFixed(2)}</p>
                    </div>
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        {/* ── Right side: step content ─────────────────────────────────── */}
        <div className="flex-1 flex overflow-hidden">

          {/* No session */}
          {!activeSession && (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300 gap-3">
              <ShoppingCart className="h-16 w-16 opacity-30" />
              <p className="text-sm font-medium text-gray-400">Tap "New Sale" to begin</p>
            </div>
          )}

          {/* Completed session — receipt */}
          {activeSession?.completed && (
            <div className="flex-1 flex flex-col items-center justify-start overflow-y-auto px-6 py-6">
              <div className="w-full max-w-sm">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                  <h2 className="text-lg font-bold text-gray-900">Sale Complete</h2>
                  <button onClick={() => closeSession(activeSession.id)} className="ml-auto text-gray-300 hover:text-red-400">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 font-mono text-xs space-y-3">
                  <div className="text-center">
                    <p className="font-bold text-sm text-gray-900">{storeName}</p>
                    <p className="text-gray-500 text-[10px]">Counter Sale</p>
                  </div>
                  <div className="border-t border-dashed border-gray-300 pt-2 space-y-1 text-[11px]">
                    <div className="flex justify-between"><span className="text-gray-500">Order:</span><span className="font-bold">#{activeSession.completed.orderNumber}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Customer:</span><span className="font-semibold">{activeSession.completed.label}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Date:</span><span>{new Date(activeSession.completed.timestamp).toLocaleString("en-ZA")}</span></div>
                  </div>
                  <div className="border-t border-dashed border-gray-300 pt-2 space-y-1.5">
                    {activeSession.completed.items.map((l, i) => (
                      <div key={i} className="flex items-start gap-1">
                        <span className="text-gray-400 w-5 shrink-0">×{l.qty}</span>
                        <span className="flex-1 min-w-0 text-gray-700 leading-tight">{l.item.name}</span>
                        <span className="font-semibold shrink-0 ml-1">R{(l.unitPrice * l.qty).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-dashed border-gray-300 pt-2 space-y-1 text-[11px]">
                    <div className="flex justify-between font-bold text-sm"><span>TOTAL</span><span>R{activeSession.completed.total.toFixed(2)}</span></div>
                    <div className="flex justify-between text-gray-500"><span>Payment</span><span className="capitalize">{activeSession.completed.payMethod}</span></div>
                    {activeSession.completed.payMethod === "cash" && activeSession.completed.tendered > 0 && (
                      <>
                        <div className="flex justify-between text-gray-500"><span>Tendered</span><span>R{activeSession.completed.tendered.toFixed(2)}</span></div>
                        <div className="flex justify-between font-semibold text-green-700"><span>Change</span><span>R{activeSession.completed.change.toFixed(2)}</span></div>
                      </>
                    )}
                  </div>
                  <p className="text-center text-[10px] text-gray-400 border-t border-dashed border-gray-300 pt-2">Thank you for your business!</p>
                </div>
                <div className="mt-4 space-y-2">
                  <button
                    onClick={() => printSlip(activeSession.completed!, storeName)}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2"
                  >
                    <Printer className="h-4 w-4" /> Print Slip
                  </button>
                  <button
                    onClick={() => { const next = sessions.find((s) => s.id !== activeSession.id && !s.completed); setSessions((prev) => prev.filter((s) => s.id !== activeSession.id)); setActiveId(next?.id ?? null); }}
                    className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP: Client Selection ────────────────────────────────── */}
          {activeSession && !activeSession.completed && activeSession.step === "client" && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
              <div className="w-full max-w-2xl">
                <h2 className="text-2xl font-bold text-gray-800 mb-1 text-center">Who is this sale for?</h2>
                <p className="text-gray-400 text-sm text-center mb-8">Select an existing client or capture a new one</p>

                {!activeSession.clientMode && (
                  <div className="grid grid-cols-3 gap-5">
                    <button
                      onClick={() => updateSession(activeSession.id, { clientMode: "existing" })}
                      className="flex flex-col items-center gap-4 py-8 px-4 bg-white border-2 border-gray-200 rounded-2xl hover:border-orange-400 hover:shadow-lg active:scale-95 transition-all group cursor-pointer"
                    >
                      <div className="h-16 w-16 rounded-full bg-orange-50 flex items-center justify-center group-hover:bg-orange-100 transition-colors">
                        <User className="h-8 w-8 text-orange-500" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-800 text-center">Existing Client</p>
                        <p className="text-xs text-gray-400 text-center mt-1">Search your client list</p>
                      </div>
                    </button>
                    <button
                      onClick={() => updateSession(activeSession.id, { clientMode: "new" })}
                      className="flex flex-col items-center gap-4 py-8 px-4 bg-white border-2 border-gray-200 rounded-2xl hover:border-orange-400 hover:shadow-lg active:scale-95 transition-all group cursor-pointer"
                    >
                      <div className="h-16 w-16 rounded-full bg-orange-50 flex items-center justify-center group-hover:bg-orange-100 transition-colors">
                        <UserPlus className="h-8 w-8 text-orange-500" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-800 text-center">New / Walk-in</p>
                        <p className="text-xs text-gray-400 text-center mt-1">Quick details or anonymous</p>
                      </div>
                    </button>
                    <button
                      onClick={() => { updateSession(activeSession.id, { clientMode: "edit_order" }); setOrderSearch(""); }}
                      className="flex flex-col items-center gap-4 py-8 px-4 bg-white border-2 border-gray-200 rounded-2xl hover:border-orange-400 hover:shadow-lg active:scale-95 transition-all group cursor-pointer"
                    >
                      <div className="h-16 w-16 rounded-full bg-orange-50 flex items-center justify-center group-hover:bg-orange-100 transition-colors">
                        <FileEdit className="h-8 w-8 text-orange-500" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-800 text-center">Edit Existing Order</p>
                        <p className="text-xs text-gray-400 text-center mt-1">Load &amp; modify an order</p>
                      </div>
                    </button>
                  </div>
                )}

                {activeSession.clientMode === "existing" && (
                  <div className="bg-white border border-gray-200 rounded-xl p-5">
                    <button onClick={() => updateSession(activeSession.id, { clientMode: null })} className="text-xs text-gray-400 hover:text-gray-600 mb-3 flex items-center gap-1">
                      <ArrowLeft className="h-3 w-3" /> Change
                    </button>
                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        ref={customerSearchRef}
                        autoFocus
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        placeholder="Search by name, phone or email…"
                        className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                      />
                    </div>
                    {customersLoading ? (
                      <div className="text-center py-6 text-sm text-gray-400">Loading clients…</div>
                    ) : (
                      <div className="max-h-96 overflow-y-auto space-y-1">
                        {filteredCustomers.length === 0 && <div className="text-center py-6 text-sm text-gray-400">No clients found</div>}
                        {filteredCustomers.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => {
                              const name = c.companyName || c.contactPerson || "Client";
                              updateSession(activeSession.id, { selectedCustomer: c, label: name, step: "history" });
                              setCustomerSearch("");
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-orange-50 border border-transparent hover:border-orange-200 transition-colors"
                          >
                            <div className="h-9 w-9 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-sm shrink-0">
                              {(c.companyName || c.contactPerson || "?")[0].toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-gray-800 truncate">{c.companyName || c.contactPerson}</p>
                              <p className="text-xs text-gray-400 truncate">{c.phone || c.email}</p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeSession.clientMode === "new" && (
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <button onClick={() => updateSession(activeSession.id, { clientMode: null })} className="text-xs text-gray-400 hover:text-gray-600 mb-3 flex items-center gap-1">
                      <ArrowLeft className="h-3 w-3" /> Change
                    </button>
                    <div className="space-y-3">
                      <input
                        autoFocus
                        value={activeSession.newName}
                        onChange={(e) => updateSession(activeSession.id, { newName: e.target.value, label: e.target.value.trim() || `Customer ${openSessions.length}` })}
                        placeholder="Customer name (optional)"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                      />
                      <input
                        value={activeSession.newPhone}
                        onChange={(e) => updateSession(activeSession.id, { newPhone: e.target.value })}
                        placeholder="Phone number (optional)"
                        type="tel"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                      />
                      <input
                        value={activeSession.newEmail}
                        onChange={(e) => updateSession(activeSession.id, { newEmail: e.target.value })}
                        placeholder="Email (optional)"
                        type="email"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                      />
                      <p className="text-xs text-gray-400">Leave all blank for anonymous walk-in</p>
                    </div>
                    <button
                      onClick={() => updateSession(activeSession.id, { step: "sale" })}
                      className="mt-5 w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
                    >
                      Continue to Sale <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>
                )}

                {activeSession.clientMode === "edit_order" && (
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <button onClick={() => updateSession(activeSession.id, { clientMode: null })} className="text-xs text-gray-400 hover:text-gray-600 mb-3 flex items-center gap-1">
                      <ArrowLeft className="h-3 w-3" /> Change
                    </button>
                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        ref={orderSearchRef}
                        value={orderSearch}
                        onChange={(e) => setOrderSearch(e.target.value)}
                        placeholder="Search by order number or customer…"
                        className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                      />
                    </div>
                    {allOrdersLoading ? (
                      <div className="text-center py-6 text-sm text-gray-400">Loading orders…</div>
                    ) : (
                      <div className="max-h-80 overflow-y-auto space-y-1">
                        {filteredOrders.length === 0 && <div className="text-center py-6 text-sm text-gray-400">No orders found</div>}
                        {filteredOrders.map((o) => {
                          const d = new Date(o.createdAt);
                          const dateStr = d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
                          return (
                            <button
                              key={o.id}
                              onClick={() => loadOrderIntoSession(o)}
                              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-orange-50 border border-transparent hover:border-orange-200 transition-colors"
                            >
                              <div className="h-9 w-9 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                                <FileEdit className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-gray-800 font-mono">#{o.orderNumber}</span>
                                  {statusBadge(o)}
                                </div>
                                <p className="text-xs text-gray-400 truncate">{o.customerInfo?.name ?? "Walk-in"} · {dateStr}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-sm font-bold text-gray-800">R{(o.totalAmount ?? 0).toFixed(2)}</p>
                                <p className="text-[10px] text-gray-400">{o.items?.length ?? 0} item{(o.items?.length ?? 0) !== 1 ? "s" : ""}</p>
                              </div>
                              <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STEP: Order History ──────────────────────────────────── */}
          {activeSession && !activeSession.completed && activeSession.step === "history" && activeSession.selectedCustomer && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Client summary bar */}
              <div className="bg-white border-b border-gray-100 px-5 py-3 flex items-center gap-4 shrink-0">
                <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold shrink-0">
                  {(activeSession.selectedCustomer.companyName || activeSession.selectedCustomer.contactPerson || "?")[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-900 text-sm">{activeSession.selectedCustomer.companyName || activeSession.selectedCustomer.contactPerson}</p>
                  <p className="text-xs text-gray-400">{[activeSession.selectedCustomer.phone, activeSession.selectedCustomer.email].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="hidden sm:flex items-center gap-4 text-right shrink-0">
                  <div><p className="text-xs text-gray-400">Total orders</p><p className="text-sm font-bold text-gray-700">{history.length}</p></div>
                  <div><p className="text-xs text-gray-400">Total spent</p><p className="text-sm font-bold text-gray-700">R{history.reduce((s, o) => s + (o.totalAmount ?? 0), 0).toFixed(2)}</p></div>
                </div>
              </div>

              {/* New order CTA */}
              <div className="px-5 py-3 bg-orange-50 border-b border-orange-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 text-orange-700">
                  <ShoppingBag className="h-4 w-4" />
                  <span className="text-sm font-semibold">Place a new order for this client</span>
                </div>
                <button
                  onClick={() => updateSession(activeSession.id, { step: "sale" })}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  New Order <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* History list */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {historyLoading ? (
                  <div className="flex flex-col gap-3">{[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
                ) : history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-300 gap-3">
                    <Clock className="h-12 w-12" />
                    <p className="text-sm font-medium text-gray-400">No previous orders</p>
                    <p className="text-xs text-gray-300">This will be their first order</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {monthGroups.map(({ label, orders }) => (
                      <div key={label}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">{label}</span>
                          <span className="text-xs text-gray-300">· {orders.length} order{orders.length !== 1 ? "s" : ""} · R{orders.reduce((s, o) => s + (o.totalAmount ?? 0), 0).toFixed(2)}</span>
                        </div>
                        <div className="space-y-2">
                          {orders.map((order) => {
                            const isExpanded = expandedOrder === order.id;
                            const d = new Date(order.createdAt);
                            const dateStr = d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
                            return (
                              <div key={order.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                                <button
                                  onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <span className="text-xs font-bold text-gray-700 font-mono">#{order.orderNumber}</span>
                                      {statusBadge(order)}
                                      {(order as any).source === "walk_in" && <span className="text-[10px] bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded font-semibold">Counter</span>}
                                    </div>
                                    <p className="text-xs text-gray-400">{dateStr}</p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-sm font-bold text-gray-800">R{(order.totalAmount ?? 0).toFixed(2)}</p>
                                    <p className="text-[10px] text-gray-400">{order.items?.length ?? 0} item{(order.items?.length ?? 0) !== 1 ? "s" : ""}</p>
                                  </div>
                                  <ChevronRight className={`h-4 w-4 text-gray-300 transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`} />
                                </button>
                                {isExpanded && (
                                  <div className="border-t border-gray-50 px-4 py-3 bg-gray-50 space-y-2">
                                    {(order.items ?? []).map((item, idx) => (
                                      <div key={idx} className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <span className="text-xs text-gray-400 shrink-0">×{item.quantity}</span>
                                          <span className="text-xs font-medium text-gray-700 truncate">{item.productName}</span>
                                          {item.sku && <span className="text-[10px] text-gray-300 shrink-0">{item.sku}</span>}
                                        </div>
                                        <span className="text-xs font-semibold text-gray-700 shrink-0">R{(item.totalPrice ?? item.unitPrice * item.quantity).toFixed(2)}</span>
                                      </div>
                                    ))}
                                    {order.notes && <p className="text-[10px] text-gray-400 pt-1 border-t border-gray-100 italic">{order.notes}</p>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STEP: Sale (product grid + cart) ────────────────────── */}
          {activeSession && !activeSession.completed && activeSession.step === "sale" && (
            <>
              {/* Product search panel */}
              <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-200 bg-white">
                <div className="px-4 py-3 border-b border-gray-100 space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      ref={productSearchRef}
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Search products, SKU, barcode…"
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 bg-gray-50"
                    />
                  </div>
                  <div className="flex gap-1">
                    {(["active", "inactive", "both"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setProductFilter(f)}
                        className={`flex-1 py-1 rounded-md text-xs font-semibold border transition-all capitalize ${
                          productFilter === f
                            ? f === "active" ? "bg-green-50 border-green-400 text-green-700"
                            : f === "inactive" ? "bg-red-50 border-red-400 text-red-700"
                            : "bg-orange-50 border-orange-400 text-orange-700"
                            : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  {productsLoading && <p className="text-xs text-gray-400">Loading inventory…</p>}
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  {filteredProducts.length === 0 && !productsLoading && (
                    <div className="text-center py-12 text-gray-400">
                      <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No products found</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2">
                    {filteredProducts.map((item) => {
                      const inCart = activeCart.find((l) => l.item.id === item.id);
                      const inStock = item.quantity > 0 || item.itemType === "service";
                      return (
                        <button
                          key={item.id}
                          onClick={() => inStock && addToCart(item)}
                          disabled={!inStock}
                          className={`relative flex flex-col items-center text-center p-3 rounded-xl border-2 transition-all ${
                            inCart ? "border-orange-400 bg-orange-50 shadow-sm"
                            : inStock ? "border-gray-100 bg-white hover:border-orange-200 hover:shadow-sm"
                            : "border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed"
                          }`}
                        >
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.name} className="h-16 w-16 object-contain mb-2 rounded" />
                          ) : (
                            <div className="h-16 w-16 bg-gray-100 rounded flex items-center justify-center mb-2">
                              <Package className="h-7 w-7 text-gray-300" />
                            </div>
                          )}
                          <p className="text-xs font-semibold text-gray-800 line-clamp-2 leading-tight mb-1">{item.name}</p>
                          <p className="text-[10px] text-gray-400 mb-1">{item.sku}</p>
                          <p className="text-sm font-bold text-gray-900">R{(item.salePrice ?? item.price ?? 0).toFixed(2)}</p>
                          {item.itemType === "service" ? (
                            <span className="text-[9px] bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded mt-1 font-semibold">Service</span>
                          ) : !inStock ? (
                            <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded mt-1 font-semibold uppercase">Out of stock</span>
                          ) : (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded mt-1 font-semibold ${
                              item.quantity <= item.reorderLevel
                                ? "bg-amber-50 text-amber-600"
                                : "bg-green-50 text-green-600"
                            }`}>
                              {item.quantity} in stock
                            </span>
                          )}
                          {item.status === "inactive" && <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded mt-1 font-semibold uppercase">Inactive</span>}
                          {inCart && <span className="absolute top-1.5 right-1.5 h-5 w-5 bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{inCart.qty}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Cart panel */}
              <div className="w-80 shrink-0 flex flex-col bg-white">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-orange-500" />
                  <span className="font-semibold text-gray-800 text-sm">{activeSession.label}</span>
                  {cartCount > 0 && <span className="ml-auto text-xs bg-orange-100 text-orange-700 font-bold px-2 py-0.5 rounded-full">{cartCount} item{cartCount !== 1 ? "s" : ""}</span>}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {activeCart.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-2 py-12">
                      <ShoppingCart className="h-10 w-10" />
                      <p className="text-sm">Tap a product to add it</p>
                    </div>
                  )}
                  {activeCart.map((line) => (
                    <div key={line.item.id} className="px-4 py-3 border-b border-gray-50 flex flex-col gap-1.5">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 line-clamp-2 leading-tight">{line.item.name}</p>
                          <p className="text-[10px] text-gray-400">{line.item.sku}</p>
                        </div>
                        <button onClick={() => removeFromCart(line.item.id)} className="text-gray-300 hover:text-red-400 mt-0.5 shrink-0"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                          <button onClick={() => setQty(line.item.id, line.qty - 1)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-white text-gray-600"><Minus className="h-3 w-3" /></button>
                          <span className="text-sm font-bold text-gray-800 w-6 text-center">{line.qty}</span>
                          <button onClick={() => setQty(line.item.id, line.qty + 1)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-white text-gray-600"><Plus className="h-3 w-3" /></button>
                        </div>
                        <div className="flex items-center gap-1 flex-1">
                          <span className="text-xs text-gray-400">R</span>
                          <input
                            type="number"
                            value={line.unitPrice}
                            onChange={(e) => setLinePrice(line.item.id, parseFloat(e.target.value) || 0)}
                            className="w-full text-sm font-semibold text-gray-800 border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-300"
                            min={0} step={0.01}
                          />
                        </div>
                        <span className="text-sm font-bold text-gray-800 w-16 text-right shrink-0">R{(line.unitPrice * line.qty).toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-gray-200 p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-base font-semibold text-gray-700">Total</span>
                    <span className="text-xl font-bold text-gray-900">R{cartTotal.toFixed(2)}</span>
                  </div>
                  <button
                    onClick={() => { setCheckoutId(activeId); setPayMethod("cash"); setTendered(""); }}
                    disabled={activeCart.length === 0}
                    className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 text-base"
                  >
                    <CheckCircle2 className="h-5 w-5" /> Checkout
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Checkout Dialog ──────────────────────────────────────────────── */}
      {checkoutId && checkoutSession && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Checkout</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {checkoutSession.label} · {checkoutSession.cart.reduce((n, l) => n + l.qty, 0)} item{checkoutSession.cart.reduce((n, l) => n + l.qty, 0) !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div className="flex justify-between items-center bg-gray-50 rounded-xl px-4 py-3">
                <span className="text-gray-600 font-medium">Total</span>
                <span className="text-2xl font-bold text-gray-900">R{checkoutTotal.toFixed(2)}</span>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Payment Method</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setPayMethod("cash")} className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold transition-all ${payMethod === "cash" ? "border-green-400 bg-green-50 text-green-700" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                    <Banknote className="h-4 w-4" /> Cash
                  </button>
                  <button onClick={() => setPayMethod("card")} className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold transition-all ${payMethod === "card" ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                    <CreditCard className="h-4 w-4" /> Card
                  </button>
                </div>
              </div>
              {payMethod === "cash" && (
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Amount Tendered</p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">R</span>
                    <input
                      autoFocus
                      type="number"
                      value={tendered}
                      onChange={(e) => setTendered(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-7 pr-4 py-3 text-lg font-bold border-2 border-gray-200 rounded-xl focus:outline-none focus:border-orange-400"
                      min={0} step={0.01}
                    />
                  </div>
                  {tenderedNum >= checkoutTotal && tenderedNum > 0 && (
                    <div className="mt-2 flex justify-between items-center bg-green-50 border border-green-200 rounded-xl px-4 py-2">
                      <span className="text-sm font-semibold text-green-700">Change</span>
                      <span className="text-lg font-bold text-green-700">R{change.toFixed(2)}</span>
                    </div>
                  )}
                  {tenderedNum > 0 && tenderedNum < checkoutTotal && (
                    <div className="mt-2 flex items-center gap-2 text-red-500 text-xs px-1">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>Amount is R{(checkoutTotal - tenderedNum).toFixed(2)} short</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => { setCheckoutId(null); setTendered(""); }} className="flex-1 py-3 border border-gray-200 text-gray-600 rounded-xl font-semibold hover:bg-gray-50">Cancel</button>
              <button
                onClick={handleCheckout}
                disabled={submitting || (payMethod === "cash" && tenderedNum > 0 && tenderedNum < checkoutTotal)}
                className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {submitting ? <span className="animate-pulse">Processing…</span> : <><CheckCircle2 className="h-4 w-4" /> Process Sale</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
