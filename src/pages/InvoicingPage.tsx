import { useState, useEffect, useMemo } from "react";
import {
  Receipt, Plus, Search, Trash2, DollarSign, Eye, X, RefreshCw,
  CheckCircle, Clock, AlertCircle, XCircle, FileText, Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { invoicingService, SalesInvoice, InvoiceLineItem } from "@/lib/invoicingService";
import { inventoryService, InventoryItem } from "@/lib/inventoryService";
import { cn } from "@/lib/utils";

const VAT_RATE = 15; // 15% VAT (South Africa)

function newLineItem(): InvoiceLineItem {
  return {
    id: crypto.randomUUID(),
    description: "",
    quantity: 1,
    unitPrice: 0,
    total: 0,
  };
}

function defaultDueDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

function toDateInput(d: Date): string {
  return d.toISOString().split("T")[0];
}

const STATUS_CONFIG: Record<SalesInvoice["status"], { label: string; className: string; icon: any }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-700 hover:bg-gray-100", icon: FileText },
  sent: { label: "Sent", className: "bg-blue-100 text-blue-700 hover:bg-blue-100", icon: Clock },
  paid: { label: "Paid", className: "bg-green-100 text-green-700 hover:bg-green-100", icon: CheckCircle },
  partial: { label: "Partial", className: "bg-amber-100 text-amber-700 hover:bg-amber-100", icon: DollarSign },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-700 hover:bg-red-100", icon: AlertCircle },
  cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-400 hover:bg-gray-100", icon: XCircle },
};

interface InvoicingPageProps {
  onClose: () => void;
}

export function InvoicingPage({ onClose }: InvoicingPageProps) {
  const { user, workspaceId } = useAuth();

  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | SalesInvoice["status"]>("all");

  // create/view dialog
  const [showCreate, setShowCreate] = useState(false);
  const [viewInvoice, setViewInvoice] = useState<SalesInvoice | null>(null);
  const [showPayment, setShowPayment] = useState<SalesInvoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<SalesInvoice | null>(null);

  // form state
  const [formCustomer, setFormCustomer] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formLines, setFormLines] = useState<InvoiceLineItem[]>([newLineItem()]);
  const [formDueDate, setFormDueDate] = useState(toDateInput(defaultDueDate()));
  const [formNotes, setFormNotes] = useState("");
  const [formStatus, setFormStatus] = useState<SalesInvoice["status"]>("draft");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    load();
  }, [workspaceId]);

  async function load() {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [invs, inv] = await Promise.all([
        invoicingService.getAll(workspaceId),
        inventoryService.getAll(workspaceId),
      ]);
      setInvoices(invs);
      setInventory(inv);
    } finally {
      setLoading(false);
    }
  }

  const totals = useMemo(() => {
    const sub = formLines.reduce((s, l) => s + l.total, 0);
    const vatAmt = sub * (VAT_RATE / 100);
    return { subtotal: sub, vatAmount: vatAmt, total: sub + vatAmt };
  }, [formLines]);

  function updateLine(idx: number, field: keyof InvoiceLineItem, val: any) {
    setFormLines((prev) => {
      const lines = [...prev];
      const line = { ...lines[idx], [field]: val };
      if (field === "quantity" || field === "unitPrice") {
        line.total = (field === "quantity" ? val : line.quantity) * (field === "unitPrice" ? val : line.unitPrice);
      }
      lines[idx] = line;
      return lines;
    });
  }
  function addLine() { setFormLines((p) => [...p, newLineItem()]); }
  function removeLine(idx: number) { setFormLines((p) => p.filter((_, i) => i !== idx)); }
  function fillFromInventory(idx: number, productId: string) {
    const item = inventory.find((i) => i.id === productId);
    if (!item) return;
    setFormLines((prev) => {
      const lines = [...prev];
      lines[idx] = {
        ...lines[idx],
        productId: item.id,
        description: item.name,
        unitPrice: item.price,
        total: lines[idx].quantity * item.price,
      };
      return lines;
    });
  }

  function resetForm() {
    setFormCustomer(""); setFormEmail(""); setFormPhone("");
    setFormLines([newLineItem()]); setFormDueDate(toDateInput(defaultDueDate()));
    setFormNotes(""); setFormStatus("draft");
  }
  function openCreate() { resetForm(); setShowCreate(true); }

  async function saveInvoice() {
    if (!workspaceId || !user || !formCustomer) return;
    setSaving(true);
    try {
      const newInvoice = await invoicingService.create(workspaceId, {
        customerName: formCustomer,
        customerEmail: formEmail,
        customerPhone: formPhone,
        items: formLines,
        subtotal: totals.subtotal,
        vatRate: VAT_RATE,
        vatAmount: totals.vatAmount,
        total: totals.total,
        amountPaid: 0,
        balanceDue: totals.total,
        status: formStatus,
        dueDate: new Date(formDueDate),
        notes: formNotes,
        createdBy: user.uid,
      });
      setInvoices((prev) => [newInvoice, ...prev]);
      setShowCreate(false);
    } finally {
      setSaving(false);
    }
  }

  async function savePayment() {
    if (!workspaceId || !showPayment || !paymentAmount) return;
    await invoicingService.recordPayment(workspaceId, showPayment, parseFloat(paymentAmount));
    setShowPayment(null);
    setPaymentAmount("");
    await load();
  }

  async function deleteInvoice(inv: SalesInvoice) {
    if (!workspaceId) return;
    await invoicingService.delete(workspaceId, inv.id);
    setShowDeleteConfirm(null);
    await load();
  }

  async function updateStatus(inv: SalesInvoice, status: SalesInvoice["status"]) {
    if (!workspaceId) return;
    await invoicingService.update(workspaceId, inv.id, { status });
    await load();
  }

  const filtered = useMemo(() => {
    let list = invoices;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      list = list.filter((i) =>
        i.customerName.toLowerCase().includes(s) ||
        i.invoiceNumber.toLowerCase().includes(s) ||
        (i.customerEmail || "").toLowerCase().includes(s)
      );
    }
    if (filterStatus !== "all") list = list.filter((i) => i.status === filterStatus);
    return list;
  }, [invoices, searchTerm, filterStatus]);

  const summaryStats = useMemo(() => ({
    total: invoices.length,
    outstanding: invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled").reduce((s, i) => s + i.balanceDue, 0),
    paid: invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.total, 0),
    overdue: invoices.filter((i) => i.status === "overdue").length,
  }), [invoices]);

  function StatusBadge({ status }: { status: SalesInvoice["status"] }) {
    const cfg = STATUS_CONFIG[status];
    return <Badge className={cfg.className}>{cfg.label}</Badge>;
  }

  return (
    <div className="fixed inset-0 bg-background z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background shrink-0">
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Invoicing</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> New Invoice
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 bg-muted/40 border-b shrink-0">
        {[
          { label: "Total Invoices", value: summaryStats.total, className: "text-blue-600" },
          { label: "Outstanding", value: `R${summaryStats.outstanding.toFixed(2)}`, className: "text-amber-600" },
          { label: "Total Paid", value: `R${summaryStats.paid.toFixed(2)}`, className: "text-green-600" },
          { label: "Overdue", value: summaryStats.overdue, className: "text-red-600" },
        ].map(({ label, value, className }) => (
          <div key={label} className="bg-background rounded-lg p-3 border">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={cn("font-semibold text-sm mt-0.5", className)}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b shrink-0">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customer, invoice #…"
            className="pl-8 h-8 text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
          <SelectTrigger className="h-8 text-sm w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_CONFIG) as SalesInvoice["status"][]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} invoices</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {loading ? (
          <div className="text-center py-16 text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Receipt className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>No invoices found</p>
            <Button size="sm" className="mt-3" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Create first invoice</Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Invoice #</th>
                  <th className="text-left px-3 py-2 font-medium">Customer</th>
                  <th className="text-right px-3 py-2 font-medium">Total</th>
                  <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Paid</th>
                  <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Balance</th>
                  <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Status</th>
                  <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">Due</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((inv) => (
                  <tr key={inv.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{inv.invoiceNumber}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{inv.customerName}</div>
                      {inv.customerEmail && <div className="text-xs text-muted-foreground">{inv.customerEmail}</div>}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">R{inv.total.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-green-700 hidden sm:table-cell">R{inv.amountPaid.toFixed(2)}</td>
                    <td className={cn("px-3 py-2 text-right font-semibold hidden sm:table-cell", inv.balanceDue > 0 ? "text-red-600" : "text-green-700")}>
                      R{inv.balanceDue.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell"><StatusBadge status={inv.status} /></td>
                    <td className="px-3 py-2 text-muted-foreground text-xs hidden lg:table-cell">
                      {inv.dueDate.toLocaleDateString("en-ZA")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="View" onClick={() => setViewInvoice(inv)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {inv.status !== "paid" && inv.status !== "cancelled" && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-green-700 hover:text-green-700 text-xs" title="Record payment" onClick={() => { setShowPayment(inv); setPaymentAmount(inv.balanceDue.toFixed(2)); }}>
                            <DollarSign className="h-3.5 w-3.5 mr-0.5" />Pay
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Delete" onClick={() => setShowDeleteConfirm(inv)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Invoice Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Invoice</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            {/* Customer info */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <Label className="text-xs">Customer Name *</Label>
                <Input value={formCustomer} onChange={(e) => setFormCustomer(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Phone</Label>
                <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} className="mt-1" />
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">Line Items</Label>
                <Button variant="outline" size="sm" className="h-6 text-xs" onClick={addLine}><Plus className="h-3 w-3 mr-1" />Add line</Button>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium text-xs">Description</th>
                      <th className="text-right px-2 py-1.5 font-medium text-xs w-16">Qty</th>
                      <th className="text-right px-2 py-1.5 font-medium text-xs w-24">Unit Price</th>
                      <th className="text-right px-2 py-1.5 font-medium text-xs w-24">Total</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {formLines.map((line, idx) => (
                      <tr key={line.id}>
                        <td className="px-2 py-1">
                          <div className="flex gap-1">
                            {inventory.length > 0 && (
                              <Select onValueChange={(v) => fillFromInventory(idx, v)}>
                                <SelectTrigger className="h-7 text-xs w-9 px-1 shrink-0">
                                  <Package className="h-3 w-3" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="_none">— from inventory —</SelectItem>
                                  {inventory.filter((i) => i.status === "active").map((i) => (
                                    <SelectItem key={i.id} value={i.id}>{i.name} (R{i.price.toFixed(2)})</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                            <Input
                              className="h-7 text-xs"
                              value={line.description}
                              onChange={(e) => updateLine(idx, "description", e.target.value)}
                              placeholder="Description"
                            />
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number" min="1" className="h-7 text-xs text-right w-full"
                            value={line.quantity}
                            onChange={(e) => updateLine(idx, "quantity", parseInt(e.target.value) || 1)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number" min="0" step="0.01" className="h-7 text-xs text-right w-full"
                            value={line.unitPrice}
                            onChange={(e) => updateLine(idx, "unitPrice", parseFloat(e.target.value) || 0)}
                          />
                        </td>
                        <td className="px-2 py-1 text-right font-medium text-xs">R{line.total.toFixed(2)}</td>
                        <td className="px-2 py-1">
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={() => removeLine(idx)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Totals */}
              <div className="mt-1 text-sm text-right space-y-0.5 pr-8">
                <div className="text-muted-foreground">Subtotal: <span className="font-medium">R{totals.subtotal.toFixed(2)}</span></div>
                <div className="text-muted-foreground">VAT ({VAT_RATE}%): <span className="font-medium">R{totals.vatAmount.toFixed(2)}</span></div>
                <div className="font-semibold">Total: R{totals.total.toFixed(2)}</div>
              </div>
            </div>

            {/* Other fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Due Date</Label>
                <Input type="date" value={formDueDate} onChange={(e) => setFormDueDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={formStatus} onValueChange={(v) => setFormStatus(v as any)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className="mt-1 h-16 text-sm" placeholder="Payment terms, thank you message…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={saveInvoice} disabled={saving || !formCustomer || formLines.length === 0}>
              {saving ? "Creating…" : "Create Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Invoice Dialog */}
      {viewInvoice && (
        <Dialog open={!!viewInvoice} onOpenChange={() => setViewInvoice(null)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span>{viewInvoice.invoiceNumber}</span>
                <StatusBadge status={viewInvoice.status} />
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1 text-sm">
              <div>
                <div className="font-semibold">{viewInvoice.customerName}</div>
                {viewInvoice.customerEmail && <div className="text-muted-foreground">{viewInvoice.customerEmail}</div>}
                {viewInvoice.customerPhone && <div className="text-muted-foreground">{viewInvoice.customerPhone}</div>}
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium text-xs">Description</th>
                      <th className="text-right px-3 py-1.5 font-medium text-xs">Qty</th>
                      <th className="text-right px-3 py-1.5 font-medium text-xs">Unit</th>
                      <th className="text-right px-3 py-1.5 font-medium text-xs">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {viewInvoice.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-1.5">{item.description}</td>
                        <td className="px-3 py-1.5 text-right">{item.quantity}</td>
                        <td className="px-3 py-1.5 text-right">R{item.unitPrice.toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right font-medium">R{item.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-right space-y-0.5 text-sm pr-3">
                <div className="text-muted-foreground">Subtotal: R{viewInvoice.subtotal.toFixed(2)}</div>
                <div className="text-muted-foreground">VAT ({viewInvoice.vatRate}%): R{viewInvoice.vatAmount.toFixed(2)}</div>
                <div className="font-semibold">Total: R{viewInvoice.total.toFixed(2)}</div>
                {viewInvoice.amountPaid > 0 && <div className="text-green-700">Paid: R{viewInvoice.amountPaid.toFixed(2)}</div>}
                {viewInvoice.balanceDue > 0 && <div className="font-semibold text-red-600">Balance Due: R{viewInvoice.balanceDue.toFixed(2)}</div>}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
                <span>Due: {viewInvoice.dueDate.toLocaleDateString("en-ZA")}</span>
                <span>Created: {viewInvoice.createdAt.toLocaleDateString("en-ZA")}</span>
              </div>
              {viewInvoice.notes && <div className="text-xs text-muted-foreground italic">{viewInvoice.notes}</div>}
              {/* Status actions */}
              <div className="flex flex-wrap gap-2 pt-1">
                {viewInvoice.status === "draft" && <Button size="sm" variant="outline" onClick={() => { updateStatus(viewInvoice, "sent"); setViewInvoice({ ...viewInvoice, status: "sent" }); }}>Mark as Sent</Button>}
                {viewInvoice.status !== "paid" && viewInvoice.status !== "cancelled" && (
                  <Button size="sm" variant="outline" className="text-green-700 border-green-300" onClick={() => { setViewInvoice(null); setShowPayment(viewInvoice); setPaymentAmount(viewInvoice.balanceDue.toFixed(2)); }}>
                    <DollarSign className="h-3.5 w-3.5 mr-1" />Record Payment
                  </Button>
                )}
                {viewInvoice.status !== "cancelled" && <Button size="sm" variant="outline" className="text-destructive border-red-200" onClick={() => { updateStatus(viewInvoice, "cancelled"); setViewInvoice({ ...viewInvoice, status: "cancelled" }); }}>Cancel Invoice</Button>}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Record Payment Dialog */}
      <Dialog open={!!showPayment} onOpenChange={() => setShowPayment(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Payment — {showPayment?.invoiceNumber}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="text-sm text-muted-foreground">Balance due: <span className="font-semibold text-foreground">R{showPayment?.balanceDue.toFixed(2)}</span></div>
            <div>
              <Label className="text-xs">Amount Received (R)</Label>
              <Input type="number" min="0" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayment(null)}>Cancel</Button>
            <Button onClick={savePayment} disabled={!paymentAmount || parseFloat(paymentAmount) <= 0} className="text-green-700">
              <DollarSign className="h-4 w-4 mr-1" />Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!showDeleteConfirm} onOpenChange={() => setShowDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {showDeleteConfirm?.invoiceNumber}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">This permanently deletes the invoice.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => showDeleteConfirm && deleteInvoice(showDeleteConfirm)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
