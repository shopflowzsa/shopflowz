import { useState, useMemo, useRef, useEffect } from "react";
import {
  ArrowLeft, Search, ChevronUp, ChevronDown, ChevronsUpDown,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getInvoices } from "@/lib/invoiceService";
import type { Invoice } from "@/types/invoice";
import { formatCurrency } from "@/lib/accountsService";

interface Props {
  onClose: () => void;
  workspaceId: string;
  onOpenInvoice?: (id: string) => void;
}

const STATUS_COLOR: Record<string, string> = {
  draft:     "bg-slate-600 text-foreground",
  sent:      "bg-blue-700 text-blue-100",
  viewed:    "bg-cyan-700 text-cyan-100",
  partial:   "bg-yellow-700 text-yellow-100",
  paid:      "bg-green-700 text-green-100",
  overdue:   "bg-red-700 text-red-100",
  cancelled: "bg-slate-700 text-muted-foreground",
};

type SortField = "idx" | "number" | "date" | "due" | "customer" | "phone" | "total" | "paid" | "balance" | "status";

const COLUMNS: { key: SortField; label: string; defaultW: number; minW: number; align?: string }[] = [
  { key: "idx",      label: "#",           defaultW: 40,  minW: 36 },
  { key: "number",   label: "Invoice No.", defaultW: 110, minW: 80 },
  { key: "date",     label: "Date",        defaultW: 100, minW: 80 },
  { key: "due",      label: "Due",         defaultW: 100, minW: 80 },
  { key: "customer", label: "Customer",    defaultW: 160, minW: 80 },
  { key: "phone",    label: "Phone",       defaultW: 115, minW: 70 },
  { key: "total",    label: "Total",       defaultW: 90,  minW: 60, align: "text-right" },
  { key: "paid",     label: "Paid",        defaultW: 90,  minW: 60, align: "text-right" },
  { key: "balance",  label: "Balance Due", defaultW: 100, minW: 70, align: "text-right" },
  { key: "status",   label: "Status",      defaultW: 100, minW: 70 },
];

function fmt(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}
function currency(n: number) {
  return "R" + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function Dash() { return <span className="text-muted-foreground/40">&mdash;</span>; }

export function InvoiceRegisterPage({ onClose, workspaceId, onOpenInvoice }: Props) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [colWidths, setColWidths] = useState(() => COLUMNS.map(c => c.defaultW));
  const resizeState = useRef<{ colIdx: number; startX: number; startW: number } | null>(null);

  useEffect(() => {
    setLoading(true);
    getInvoices(workspaceId)
      .then(setInvoices)
      .catch(e => setError(e?.message || "Failed to load invoices"))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeState.current) return;
      const { colIdx, startX, startW } = resizeState.current;
      const delta = e.clientX - startX;
      setColWidths(prev => {
        const next = [...prev];
        next[colIdx] = Math.max(COLUMNS[colIdx].minW, startW + delta);
        return next;
      });
    };
    const onUp = () => { resizeState.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  function startResize(e: React.MouseEvent, colIdx: number) {
    e.preventDefault(); e.stopPropagation();
    resizeState.current = { colIdx, startX: e.clientX, startW: colWidths[colIdx] };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  const statuses = useMemo(() => Array.from(new Set(invoices.map(i => i.status))).sort(), [invoices]);

  const filtered = useMemo(() => {
    let rows = invoices;
    if (statusFilter !== "all") rows = rows.filter(i => i.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(i =>
        [i.invoiceNumber, i.customerName, i.customerPhone, i.status, String(i.total), String(i.balanceDue)]
          .some(v => String(v || "").toLowerCase().includes(q))
      );
    }
    const sorted = [...rows].sort((a, b) => {
      const mul = sortAsc ? 1 : -1;
      switch (sortField) {
        case "number":   return mul * a.invoiceNumber.localeCompare(b.invoiceNumber);
        case "date":     return mul * (new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime());
        case "due":      return mul * (new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
        case "customer": return mul * a.customerName.localeCompare(b.customerName);
        case "phone":    return mul * (a.customerPhone || "").localeCompare(b.customerPhone || "");
        case "total":    return mul * (a.total - b.total);
        case "paid":     return mul * (a.amountPaid - b.amountPaid);
        case "balance":  return mul * (a.balanceDue - b.balanceDue);
        case "status":   return mul * a.status.localeCompare(b.status);
        default:         return 0;
      }
    });
    return sorted;
  }, [invoices, search, statusFilter, sortField, sortAsc]);

  const totalRevenue = useMemo(() => filtered.reduce((s, { total }) => s + total, 0), [filtered]);
  const totalBalance = useMemo(() => filtered.reduce((s, { balanceDue }) => s + balanceDue, 0), [filtered]);

  function getInvoiceStatusBadge(status: Invoice["status"]) {
    const variants = {
      draft: { variant: "secondary" as const, icon: "Clock" as const, className: undefined },
      sent: { variant: "default" as const, icon: "Send" as const, className: undefined },
      viewed: { variant: "default" as const, icon: "Eye" as const, className: undefined },
      partial: { variant: "default" as const, icon: "Clock" as const, className: "bg-yellow-600" },
      paid: { variant: "default" as const, icon: "CheckCircle2" as const, className: "bg-green-600" },
      overdue: { variant: "destructive" as const, icon: "Clock" as const, className: undefined },
      cancelled: { variant: "secondary" as const, icon: "X" as const, className: undefined },
    };
    const config = variants[status];
    
    // Dynamically import lucide icons
    let Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    switch (config.icon) {
      case "Clock": Icon = () => <span className="h-3 w-3">⏰</span>; break;
      case "Send": Icon = () => <span className="h-3 w-3">📤</span>; break;
      case "Eye": Icon = () => <span className="h-3 w-3">👁️</span>; break;
      case "CheckCircle2": Icon = () => <span className="h-3 w-3">✅</span>; break;
      case "X": Icon = () => <span className="h-3 w-3">❌</span>; break;
      default: Icon = () => <span className="h-3 w-3">?</span>;
    }
    
    return (
      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize whitespace-nowrap ${STATUS_COLOR[status] || "bg-muted text-foreground/80"} flex items-center gap-1`}>
        <Icon className="h-3 w-3" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  }

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0 flex-wrap gap-y-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 text-muted-foreground hover:text-foreground px-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-purple-400" />
          <span className="font-semibold text-foreground text-base">Invoice Register</span>
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            {filtered.length} / {invoices.length}
          </span>
        </div>

        {/* Status filters */}
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setStatusFilter("all")}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${statusFilter === "all" ? "bg-purple-600 border-purple-500 text-white" : "border-border text-muted-foreground hover:border-border/60"}`}>
            All
          </button>
          {statuses.map(s => (
            <button key={s} onClick={() => setStatusFilter(p => p === s ? "all" : s)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors capitalize ${statusFilter === s ? "bg-purple-600 border-purple-500 text-white" : "border-border text-muted-foreground hover:border-border/60"}`}>
              {s}
            </button>
          ))}
        </div>

        <div className="ml-auto relative w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoices..."
            className="pl-8 h-8 text-sm bg-card border-border text-foreground placeholder:text-muted-foreground" />
        </div>
      </div>

      {/* Table - now using clean list format like Accounts.tsx */}
      <div className="flex-1 overflow-auto">
        {loading && <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading invoices…</div>}
        {error && <div className="p-6 text-red-400 text-sm">{error}</div>}
        {!loading && !error && (
          <div className="space-y-1">
            {filtered.length === 0 ? (
              <div className="text-center py-12">
                <Receipt className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-4">No invoices found</p>
              </div>
            ) : (
              <div className="space-y-1">
                {filtered.map((invoice) => (
                  <div key={invoice.id} className="flex items-center gap-4 p-3 border rounded-lg hover:bg-muted/50">
                    <div className="w-20 font-mono text-sm font-semibold">{invoice.invoiceNumber}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{invoice.customerName}</div>
                    </div>
                    <div className="w-20 text-right font-semibold">{formatCurrency(invoice.total)}</div>
                    <div className="w-20 text-right text-green-600">{formatCurrency(invoice.amountPaid)}</div>
                    <div className="w-20 text-right font-semibold">{formatCurrency(invoice.balanceDue)}</div>
                    <div className="w-28">{getInvoiceStatusBadge(invoice.status)}</div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenInvoice?.(invoice.id)}
                        title="View"
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {/* Preview logic would go here */}}
                        title="Preview"
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {/* Print logic would go here */}}
                        title="Print"
                      >
                        <Printer className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {/* Download logic would go here */}}
                        title="Download"
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {/* WhatsApp logic would go here */}}
                        title="WhatsApp"
                      >
                        <MessageSquare className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-2 flex items-center gap-6 text-[11px] text-muted-foreground">
        <span><span className="text-foreground/80 font-semibold">{filtered.length}</span> invoices shown</span>
        {totalRevenue > 0 && (
          <span>Total: <span className="text-foreground font-semibold">{currency(totalRevenue)}</span></span>
        )}
        {totalBalance > 0 && (
          <span>Outstanding: <span className="text-orange-400 font-semibold">{currency(totalBalance)}</span></span>
        )}
        {onOpenInvoice && <span className="ml-auto text-muted-foreground/50">Click any row to open the invoice</span>}
      </div>
    </div>
  );
}