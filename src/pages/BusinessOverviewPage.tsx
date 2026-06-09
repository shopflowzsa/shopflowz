import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, TrendingUp, TrendingDown, DollarSign, Users, FileText, Package, BarChart2, RefreshCw, X, Wrench, SlidersHorizontal, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { getInvoices } from "@/lib/invoiceService";
import { getQuotations } from "@/lib/quotationService";
import { loadSalesSettings } from "@/lib/salesSettingsService";
import { inventoryService } from "@/lib/inventoryService";
import type { WorkspaceState } from "@/types/crm";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ComposedChart, Area,
} from "recharts";

interface Props {
  onClose: () => void;
  workspace: WorkspaceState;
  onOpenTask?: (taskId: string) => void;
  onOpenInvoice?: (invoiceId: string) => void;
  onOpenQuotation?: (quotationId: string) => void;
}

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function KpiCard({
  title, value, sub, icon, trend, trendLabel, color = "text-foreground",
}: {
  title: string; value: string; sub?: string; icon: React.ReactNode;
  trend?: number; trendLabel?: string; color?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">{title}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      {trend !== undefined && (
        <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-green-400" : "text-red-400"}`}>
          {trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {Math.abs(trend).toFixed(1)}% {trendLabel || "vs last month"}
        </div>
      )}
    </div>
  );
}

const fmtR = (n: number) => `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));

export function BusinessOverviewPage({ onClose, workspace, onOpenTask, onOpenInvoice, onOpenQuotation }: Props) {
  const { workspaceId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [range, setRange] = useState<6 | 12>(12);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedInvStatus, setSelectedInvStatus] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [selectedJobStatus, setSelectedJobStatus] = useState<string | null>(null);
  const [selectedFunnelStage, setSelectedFunnelStage] = useState<string | null>(null);

  const ALL_KPIS = [
    { key: "revenue", label: "This Month Revenue" },
    { key: "outstanding", label: "Total Outstanding" },
    { key: "jobs", label: "Jobs This Month" },
    { key: "collection", label: "Collection Rate" },
    { key: "avgInvoice", label: "Avg Invoice Value" },
    { key: "conversion", label: "Quote Conversion" },
    { key: "stock", label: "Stock Value" },
    { key: "mom", label: "MoM Revenue" },
  ] as const;

  const ALL_SECTIONS = [
    { key: "revenueChart", label: "Revenue vs Collections" },
    { key: "invoiceStatus", label: "Invoice Status Breakdown" },
    { key: "dailyBookings", label: "Daily Job Bookings" },
    { key: "quoteFunnel", label: "Quote Funnel" },
    { key: "topCustomers", label: "Top Customers" },
    { key: "jobsByStatus", label: "Jobs by Status" },
    { key: "revenueTrend", label: "Revenue Trend" },
    { key: "taskCreationList", label: "Task Creation List" },
  ] as const;

  type KpiKey = typeof ALL_KPIS[number]["key"];
  type SectionKey = typeof ALL_SECTIONS[number]["key"];

  const [visibleKpis, setVisibleKpis] = useState<Set<KpiKey>>(() => {
    try {
      const saved = localStorage.getItem("dash_kpis");
      return saved ? new Set(JSON.parse(saved)) : new Set(ALL_KPIS.map(k => k.key));
    } catch { return new Set(ALL_KPIS.map(k => k.key)); }
  });

  const [visibleSections, setVisibleSections] = useState<Set<SectionKey>>(() => {
    try {
      const saved = localStorage.getItem("dash_sections");
      return saved ? new Set(JSON.parse(saved)) : new Set(ALL_SECTIONS.map(s => s.key));
    } catch { return new Set(ALL_SECTIONS.map(s => s.key)); }
  });

  const toggleKpi = (key: KpiKey) => {
    setVisibleKpis(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem("dash_kpis", JSON.stringify([...next]));
      return next;
    });
  };

  const toggleSection = (key: SectionKey) => {
    setVisibleSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem("dash_sections", JSON.stringify([...next]));
      return next;
    });
  };

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    Promise.all([
      getInvoices(workspaceId),
      getQuotations(workspaceId),
      loadSalesSettings(workspaceId),
      inventoryService.getAll(workspaceId).catch(() => []),
    ]).then(([inv, quo, settings, stock]) => {
      setInvoices(inv);
      setQuotations(quo);
      // currency not in SalesSettings; default stays "R"
      setInventory(stock);
    }).finally(() => setLoading(false));
  }, [workspaceId]);

  // ── Monthly revenue/collections (last N months) ───────────────────────
  const monthlyData = useMemo(() => {
    const now = new Date();
    const months: { month: string; Revenue: number; Collected: number; Outstanding: number }[] = [];
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = `${MONTHS[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`;
      const monthInvs = invoices.filter(inv => {
        const id = new Date(inv.createdAt || inv.invoiceDate);
        return id.getFullYear() === d.getFullYear() && id.getMonth() === d.getMonth();
      });
      months.push({
        month: label,
        Revenue: Math.round(monthInvs.reduce((s, i) => s + (i.total || 0), 0)),
        Collected: Math.round(monthInvs.reduce((s, i) => s + (i.amountPaid || 0), 0)),
        Outstanding: Math.round(monthInvs.reduce((s, i) => s + (i.balanceDue || 0), 0)),
      });
    }
    return months;
  }, [invoices, range]);

  // ── Daily bookings — current month ────────────────────────────────────
  const dailyBookings = useMemo(() => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const days: { day: string; Jobs: number }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const count = workspace.tasks.filter(t => {
        if (!t.createdAt) return false;
        const td = new Date(t.createdAt);
        return td.getFullYear() === now.getFullYear() && td.getMonth() === now.getMonth() && td.getDate() === d;
      }).length;
      days.push({ day: String(d), Jobs: count });
    }
    return days;
  }, [workspace.tasks]);

  // ── Drill-down computed lists ────────────────────────────────────────
  const selectedMonthInvoices = useMemo(() => {
    if (!selectedMonth) return [];
    return invoices.filter(inv => {
      const d = new Date(inv.createdAt || inv.invoiceDate);
      return `${MONTHS[d.getMonth()]} ${d.getFullYear().toString().slice(2)}` === selectedMonth;
    });
  }, [selectedMonth, invoices]);

  const selectedStatusInvoices = useMemo(() => {
    if (!selectedInvStatus) return [];
    const now2 = new Date();
    return invoices.filter(inv => {
      if (selectedInvStatus === "Paid") return inv.paymentStatus === "paid";
      if (selectedInvStatus === "Partial") return inv.paymentStatus === "partial";
      if (selectedInvStatus === "Overdue") return inv.paymentStatus !== "paid" && inv.dueDate && new Date(inv.dueDate) < now2;
      if (selectedInvStatus === "Unpaid") return inv.paymentStatus === "unpaid" && !(inv.dueDate && new Date(inv.dueDate) < now2);
      return false;
    });
  }, [selectedInvStatus, invoices]);

  const selectedCustomerInvoices = useMemo(() => {
    if (!selectedCustomer) return [];
    return invoices.filter(inv => (inv.customerName || "Unknown").startsWith(selectedCustomer.replace("…", "")));
  }, [selectedCustomer, invoices]);

  const selectedJobStatusTasks = useMemo(() => {
    if (!selectedJobStatus) return [];
    return workspace.tasks.filter(t => !t.archived && t.status === selectedJobStatus);
  }, [selectedJobStatus, workspace.tasks]);

  const selectedFunnelQuotations = useMemo(() => {
    if (!selectedFunnelStage) return [];
    if (selectedFunnelStage === "Quotes Sent") return quotations;
    if (selectedFunnelStage === "Accepted") return quotations.filter(q => q.status === "accepted");
    if (selectedFunnelStage === "Converted") return quotations.filter(q => q.convertedToInvoiceId);
    if (selectedFunnelStage === "Declined") return quotations.filter(q => q.status === "declined");
    return [];
  }, [selectedFunnelStage, quotations]);

  // ── Jobs for selected day ─────────────────────────────────────────────
  const selectedDayJobs = useMemo(() => {
    if (selectedDay === null) return [];
    const now = new Date();
    return workspace.tasks.filter(t => {
      if (!t.createdAt) return false;
      const td = new Date(t.createdAt);
      return td.getFullYear() === now.getFullYear() && td.getMonth() === now.getMonth() && td.getDate() === selectedDay;
    });
  }, [selectedDay, workspace.tasks]);

  // ── Invoice status breakdown ──────────────────────────────────────────
  const invoiceStatusData = useMemo(() => {
    const paid = invoices.filter(i => i.paymentStatus === "paid").length;
    const partial = invoices.filter(i => i.paymentStatus === "partial").length;
    const overdue = invoices.filter(i => i.paymentStatus !== "paid" && i.dueDate && new Date(i.dueDate) < new Date()).length;
    const unpaid = invoices.filter(i => i.paymentStatus === "unpaid" && !(i.dueDate && new Date(i.dueDate) < new Date())).length;
    return [
      { name: "Paid", value: paid },
      { name: "Partial", value: partial },
      { name: "Overdue", value: overdue },
      { name: "Unpaid", value: unpaid },
    ].filter(d => d.value > 0);
  }, [invoices]);

  // ── Quote funnel ──────────────────────────────────────────────────────
  const quoteFunnelData = useMemo(() => [
    { stage: "Quotes Sent", count: quotations.length },
    { stage: "Accepted", count: quotations.filter(q => q.status === "accepted").length },
    { stage: "Converted", count: quotations.filter(q => q.convertedToInvoiceId).length },
    { stage: "Declined", count: quotations.filter(q => q.status === "declined").length },
  ], [quotations]);

  // ── Top customers by revenue ──────────────────────────────────────────
  const topCustomers = useMemo(() => {
    const map: Record<string, number> = {};
    invoices.forEach(inv => {
      const name = inv.customerName || "Unknown";
      map[name] = (map[name] || 0) + (inv.total || 0);
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([name, Revenue]) => ({ name: name.length > 18 ? name.slice(0, 17) + "…" : name, Revenue: Math.round(Revenue) }));
  }, [invoices]);

  // ── Jobs by status (current) ──────────────────────────────────────────
  const jobsByStatus = useMemo(() => {
    const map: Record<string, number> = {};
    workspace.tasks.filter(t => !t.archived).forEach(t => {
      map[t.status] = (map[t.status] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [workspace.tasks]);

  // ── Month-over-month revenue change ──────────────────────────────────
  const momChange = useMemo(() => {
    if (monthlyData.length < 2) return 0;
    const curr = monthlyData[monthlyData.length - 1].Revenue;
    const prev = monthlyData[monthlyData.length - 2].Revenue;
    return prev === 0 ? 0 : ((curr - prev) / prev) * 100;
  }, [monthlyData]);

  // ── KPI values ────────────────────────────────────────────────────────
  const now = new Date();
  const thisMonthInvoices = invoices.filter(inv => {
    const d = new Date(inv.createdAt || inv.invoiceDate);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const lastMonthInvoices = invoices.filter(inv => {
    const d = new Date(inv.createdAt || inv.invoiceDate);
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
  });

  const thisMonthRevenue = thisMonthInvoices.reduce((s, i) => s + (i.total || 0), 0);
  const lastMonthRevenue = lastMonthInvoices.reduce((s, i) => s + (i.total || 0), 0);
  const revTrend = lastMonthRevenue === 0 ? 0 : ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;

  const totalOutstanding = invoices.reduce((s, i) => s + (i.balanceDue || 0), 0);
  const totalCollected = invoices.reduce((s, i) => s + (i.amountPaid || 0), 0);
  const totalRevenue = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const collectionRate = pct(totalCollected, totalRevenue);

  const thisMonthJobs = workspace.tasks.filter(t => {
    if (!t.createdAt) return false;
    const d = new Date(t.createdAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const lastMonthJobs = workspace.tasks.filter(t => {
    if (!t.createdAt) return false;
    const d = new Date(t.createdAt);
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
  }).length;
  const jobTrend = lastMonthJobs === 0 ? 0 : ((thisMonthJobs - lastMonthJobs) / lastMonthJobs) * 100;

  const conversionRate = pct(quotations.filter(q => q.convertedToInvoiceId).length, quotations.length);
  const avgInvoiceValue = invoices.length > 0 ? totalRevenue / invoices.length : 0;
  const stockValue = inventory.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const avgJobsPerDay = thisMonthJobs > 0 ? (thisMonthJobs / now.getDate()).toFixed(1) : "0";

  const tooltipStyle = { backgroundColor: "#1e293b", border: "1px solid #334155", color: "#f1f5f9", borderRadius: 8 };

  // ── Reusable drill-down row components ───────────────────────────────
  const InvoiceDrillRow = ({ inv }: { inv: any }) => (
    <div onClick={() => onOpenInvoice?.(inv.id)}
      className={`flex items-center gap-3 rounded-lg p-2.5 border border-border hover:border-indigo-500 transition-colors ${onOpenInvoice ? 'cursor-pointer' : ''}`}>
      <div className="h-7 w-7 rounded-lg bg-indigo-900 flex items-center justify-center shrink-0">
        <FileText className="h-3.5 w-3.5 text-indigo-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">{inv.invoiceNumber || inv.id?.slice(0,8)}</p>
        <p className="text-xs text-foreground/80 truncate">{inv.customerName || "Unknown"}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-semibold text-green-400">{fmtR(inv.total || 0)}</p>
        <p className="text-xs text-muted-foreground capitalize">{inv.paymentStatus || inv.status}</p>
      </div>
    </div>
  );

  const QuoteDrillRow = ({ q }: { q: any }) => (
    <div onClick={() => onOpenQuotation?.(q.id)}
      className={`flex items-center gap-3 rounded-lg p-2.5 border border-border hover:border-indigo-500 transition-colors ${onOpenQuotation ? 'cursor-pointer' : ''}`}>
      <div className="h-7 w-7 rounded-lg bg-amber-900 flex items-center justify-center shrink-0">
        <FileText className="h-3.5 w-3.5 text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">{q.quotationNumber || q.id?.slice(0,8)}</p>
        <p className="text-xs text-foreground/80 truncate">{q.customerName || "Unknown"}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-semibold text-green-400">{fmtR(q.total || 0)}</p>
        <p className="text-xs text-muted-foreground capitalize">{q.status}</p>
      </div>
    </div>
  );

  const JobDrillRow = ({ task }: { task: any }) => {
    const cfv = task.customFieldValues || [];
    const customerName = cfv.find((cf: any) => cf.fieldId === "cf1774254755047")?.value || "";
    const phone = cfv.find((cf: any) => cf.fieldId === "cf1774253802878")?.value || "";
    const repairCost = cfv.find((cf: any) => cf.fieldId === "cf1774449426556")?.value;
    const brand = cfv.find((cf: any) => cf.fieldId === "cf1774304257238")?.value || "";
    const model = cfv.find((cf: any) => cf.fieldId === "cf1774305032046")?.value || "";
    return (
      <div onClick={() => onOpenTask?.(task.id)}
        className={`flex items-start gap-3 rounded-lg p-2.5 border border-border hover:border-indigo-500 transition-colors ${onOpenTask ? 'cursor-pointer' : ''}`}>
        <div className="h-7 w-7 rounded-lg bg-indigo-900 flex items-center justify-center shrink-0">
          <Wrench className="h-3.5 w-3.5 text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{task.title || task.jobNumber || "(no title)"}</p>
          {customerName && <p className="text-xs text-foreground/80">{customerName}{phone ? ` · ${phone}` : ""}</p>}
          {(brand || model) && <p className="text-xs text-muted-foreground">{[brand, model].filter(Boolean).join(" ")}</p>}
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-foreground/80 capitalize">{task.status}</span>
            {repairCost && <span className="text-xs text-green-400">R{repairCost}</span>}
          </div>
        </div>
      </div>
    );
  };

  function DrillPanel({ title, count, onClose: closeDrill, children }: { title: string; count: number; onClose: () => void; children: React.ReactNode }) {
    return (
      <div className="mt-4 border-t border-border pt-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-amber-400">{title} — {count} item{count !== 1 ? "s" : ""}</span>
          <button onClick={closeDrill} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {count === 0 ? (
          <p className="text-xs text-muted-foreground">No items found.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">{children}</div>
        )}
      </div>
    );
  }

  // helper: card header row with hide button
  const CardHeader = ({ title, sub, sectionKey }: { title: string; sub?: string; sectionKey: SectionKey }) => (
    <div className="flex items-start justify-between mb-1 gap-2">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <button onClick={() => toggleSection(sectionKey)}
        title="Hide this card"
        className="shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted rounded p-0.5 transition-colors mt-0.5">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="absolute inset-0 bg-background z-30 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-background z-30 flex flex-col text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-background">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onClose} className="text-muted-foreground hover:text-foreground hover:bg-muted">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <BarChart2 className="h-5 w-5 text-indigo-400" />
          <div>
            <h1 className="text-lg font-bold text-foreground">Business Overview</h1>
            <p className="text-xs text-muted-foreground">Live performance dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Revenue range:</span>
          {([6, 12] as const).map(r => (
            <Button key={r} size="sm" variant={range === r ? "default" : "ghost"}
              className={range === r ? "bg-indigo-600 text-white h-7 text-xs" : "text-muted-foreground hover:text-foreground h-7 text-xs"}
              onClick={() => setRange(r)}>
              {r}M
            </Button>
          ))}
          <Button size="sm" variant="ghost"
            className={`h-7 text-xs gap-1.5 ${showSettings ? "text-indigo-400 bg-muted" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setShowSettings(s => !s)}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Configure
          </Button>
        </div>
      </div>

      {/* ── Settings Panel (restore hidden cards) ── */}
      {showSettings && (
        <div className="shrink-0 border-b border-border bg-card px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-foreground">Dashboard Configuration — toggle cards on/off</p>
            <button onClick={() => setShowSettings(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">KPI Cards</p>
              <div className="grid grid-cols-2 gap-1.5">
                {ALL_KPIS.map(({ key, label }) => (
                  <button key={key} onClick={() => toggleKpi(key)}
                    className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                      visibleKpis.has(key)
                        ? "border-indigo-500 bg-indigo-950 text-indigo-300"
                        : "border-border bg-card text-muted-foreground hover:border-border/80"
                    }`}>
                    <div className={`h-3.5 w-3.5 rounded flex items-center justify-center shrink-0 ${
                      visibleKpis.has(key) ? "bg-indigo-500" : "border border-border"
                    }`}>
                      {visibleKpis.has(key) && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Chart Sections</p>
              <div className="grid grid-cols-2 gap-1.5">
                {ALL_SECTIONS.map(({ key, label }) => (
                  <button key={key} onClick={() => toggleSection(key)}
                    className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                      visibleSections.has(key)
                        ? "border-indigo-500 bg-indigo-950 text-indigo-300"
                        : "border-border bg-card text-muted-foreground hover:border-border/80"
                    }`}>
                    <div className={`h-3.5 w-3.5 rounded flex items-center justify-center shrink-0 ${
                      visibleSections.has(key) ? "bg-indigo-500" : "border border-border"
                    }`}>
                      {visibleSections.has(key) && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* ── KPI Cards ── */}
        {visibleKpis.size > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
            {visibleKpis.has("revenue") && (
              <KpiCard title="This Month Revenue" value={fmtR(thisMonthRevenue)} trend={revTrend}
                icon={<DollarSign className="h-4 w-4" />} color="text-green-400" />
            )}
            {visibleKpis.has("outstanding") && (
              <KpiCard title="Total Outstanding" value={fmtR(totalOutstanding)}
                sub={`${invoices.filter(i => i.paymentStatus !== "paid").length} unpaid invoices`}
                icon={<FileText className="h-4 w-4" />} color="text-amber-400" />
            )}
            {visibleKpis.has("jobs") && (
              <KpiCard title="Jobs This Month" value={String(thisMonthJobs)} trend={jobTrend}
                sub={`${avgJobsPerDay} avg/day`}
                icon={<Package className="h-4 w-4" />} color="text-indigo-400" />
            )}
            {visibleKpis.has("collection") && (
              <KpiCard title="Collection Rate" value={`${collectionRate}%`}
                sub={`${fmtR(totalCollected)} of ${fmtR(totalRevenue)}`}
                icon={<TrendingUp className="h-4 w-4" />} color={collectionRate > 80 ? "text-green-400" : "text-amber-400"} />
            )}
            {visibleKpis.has("avgInvoice") && (
              <KpiCard title="Avg Invoice Value" value={fmtR(avgInvoiceValue)}
                sub={`${invoices.length} total invoices`}
                icon={<DollarSign className="h-4 w-4" />} />
            )}
            {visibleKpis.has("conversion") && (
              <KpiCard title="Quote Conversion" value={`${conversionRate}%`}
                sub={`${quotations.filter(q => q.convertedToInvoiceId).length} of ${quotations.length} quotes`}
                icon={<FileText className="h-4 w-4" />} color={conversionRate > 50 ? "text-green-400" : "text-amber-400"} />
            )}
            {visibleKpis.has("stock") && (
              <KpiCard title="Stock Value" value={fmtR(stockValue)}
                sub={`${inventory.length} products`}
                icon={<Package className="h-4 w-4" />} />
            )}
            {visibleKpis.has("mom") && (
              <KpiCard title="MoM Revenue" value={`${momChange >= 0 ? "+" : ""}${momChange.toFixed(1)}%`}
                trend={momChange} trendLabel="change"
                icon={<TrendingUp className="h-4 w-4" />} color={momChange >= 0 ? "text-green-400" : "text-red-400"} />
            )}
          </div>
        )}

        {/* ── Row 1: Revenue Chart + Invoice Status ── */}
        {(visibleSections.has("revenueChart") || visibleSections.has("invoiceStatus")) && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {visibleSections.has("revenueChart") && (
              <div className="lg:col-span-2 bg-card border border-border rounded-xl p-4">
                <CardHeader title={`Revenue vs Collections — Last ${range} Months`} sectionKey="revenueChart" />
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `R${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtR(v)} />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Bar dataKey="Revenue" fill="#6366f1" radius={[4,4,0,0]} maxBarSize={32}
                      onClick={(d: any) => setSelectedMonth(prev => prev === d.month ? null : d.month)} style={{ cursor: "pointer" }} />
                    <Bar dataKey="Collected" fill="#22c55e" radius={[4,4,0,0]} maxBarSize={32} />
                    <Line type="monotone" dataKey="Outstanding" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                {selectedMonth && (
                  <DrillPanel title={selectedMonth} count={selectedMonthInvoices.length} onClose={() => setSelectedMonth(null)}>
                    {selectedMonthInvoices.map(inv => <InvoiceDrillRow key={inv.id} inv={inv} />)}
                  </DrillPanel>
                )}
              </div>
            )}
            {visibleSections.has("invoiceStatus") && (
              <div className="bg-card border border-border rounded-xl p-4">
                <CardHeader title="Invoice Status Breakdown" sectionKey="invoiceStatus" />
                {invoiceStatusData.length === 0 ? (
                  <div className="flex items-center justify-center h-[240px] text-muted-foreground text-sm">No invoices yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={invoiceStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                        innerRadius={55} outerRadius={85} paddingAngle={3}
                        label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}
                        labelLine={false} fontSize={11}
                        onClick={(d: any) => setSelectedInvStatus(prev => prev === d.name ? null : d.name)}
                        style={{ cursor: "pointer" }}>
                        {invoiceStatusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  {invoiceStatusData.map((d, i) => (
                    <button key={d.name} onClick={() => setSelectedInvStatus(prev => prev === d.name ? null : d.name)}
                      className={`flex items-center gap-1.5 text-xs rounded px-1.5 py-0.5 transition-colors ${selectedInvStatus === d.name ? 'bg-muted text-foreground' : 'text-foreground/80 hover:bg-muted'}`}>
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      {d.name}: <span className="font-semibold">{d.value}</span>
                    </button>
                  ))}
                </div>
                {selectedInvStatus && (
                  <DrillPanel title={selectedInvStatus} count={selectedStatusInvoices.length} onClose={() => setSelectedInvStatus(null)}>
                    {selectedStatusInvoices.map(inv => <InvoiceDrillRow key={inv.id} inv={inv} />)}
                  </DrillPanel>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Row 2: Daily Bookings + Quote Funnel ── */}
        {(visibleSections.has("dailyBookings") || visibleSections.has("quoteFunnel")) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {visibleSections.has("dailyBookings") && (
              <div className="bg-card border border-border rounded-xl p-4">
                <CardHeader
                  title={`Daily Job Bookings — ${MONTHS[now.getMonth()]} ${now.getFullYear()}`}
                  sub={`${daysInMonth} days · ${thisMonthJobs} total · ${avgJobsPerDay}/day avg · click a bar to see jobs`}
                  sectionKey="dailyBookings"
                />
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dailyBookings} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                    onClick={(data) => {
                      if (data?.activePayload?.[0]) {
                        const day = Number(data.activeLabel);
                        setSelectedDay(prev => prev === day ? null : day);
                      }
                    }}
                    style={{ cursor: "pointer" }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={1} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="Jobs" radius={[3,3,0,0]} maxBarSize={20}>
                      {dailyBookings.map((entry, index) => (
                        <Cell key={index} fill={selectedDay === Number(entry.day) ? "#f59e0b" : "#6366f1"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {selectedDay !== null && (
                  <div className="mt-4 border-t border-border pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold text-amber-400">
                        {MONTHS[now.getMonth()]} {selectedDay} — {selectedDayJobs.length} job{selectedDayJobs.length !== 1 ? "s" : ""}
                      </span>
                      <button onClick={() => setSelectedDay(null)} className="text-muted-foreground hover:text-foreground">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {selectedDayJobs.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No jobs booked on this day.</p>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {selectedDayJobs.map(task => <JobDrillRow key={task.id} task={task} />)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {visibleSections.has("quoteFunnel") && (
              <div className="bg-card border border-border rounded-xl p-4">
                <CardHeader title="Quote to Invoice Funnel" sub={`${conversionRate}% conversion rate`} sectionKey="quoteFunnel" />
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={quoteFunnelData} layout="vertical" margin={{ top: 4, right: 40, left: 60, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="stage" tick={{ fill: "#94a3b8", fontSize: 11 }} width={60} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" radius={[0,4,4,0]} maxBarSize={28}
                      onClick={(d: any) => setSelectedFunnelStage(prev => prev === d.stage ? null : d.stage)} style={{ cursor: "pointer" }}>
                      {quoteFunnelData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {selectedFunnelStage && (
                  <DrillPanel title={selectedFunnelStage} count={selectedFunnelQuotations.length} onClose={() => setSelectedFunnelStage(null)}>
                    {selectedFunnelQuotations.map(q => <QuoteDrillRow key={q.id} q={q} />)}
                  </DrillPanel>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Row 3: Top Customers + Jobs by Status ── */}
        {(visibleSections.has("topCustomers") || visibleSections.has("jobsByStatus")) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {visibleSections.has("topCustomers") && (
              <div className="bg-card border border-border rounded-xl p-4">
                <CardHeader title="Top Customers by Revenue" sectionKey="topCustomers" />
                {topCustomers.length === 0 ? (
                  <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">No data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={topCustomers} layout="vertical" margin={{ top: 4, right: 50, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                      <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `R${(v/1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} width={110} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtR(v)} />
                      <Bar dataKey="Revenue" fill="#22c55e" radius={[0,4,4,0]} maxBarSize={22}
                        label={{ position: "right", fill: "#94a3b8", fontSize: 10, formatter: (v: any) => fmtR(v) }}
                        onClick={(d: any) => setSelectedCustomer(prev => prev === d.name ? null : d.name)} style={{ cursor: "pointer" }} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {selectedCustomer && (
                  <DrillPanel title={selectedCustomer} count={selectedCustomerInvoices.length} onClose={() => setSelectedCustomer(null)}>
                    {selectedCustomerInvoices.map(inv => <InvoiceDrillRow key={inv.id} inv={inv} />)}
                  </DrillPanel>
                )}
              </div>
            )}
            {visibleSections.has("jobsByStatus") && (
              <div className="bg-card border border-border rounded-xl p-4">
                <CardHeader title="Active Jobs by Status" sectionKey="jobsByStatus" />
                {jobsByStatus.length === 0 ? (
                  <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">No jobs yet</div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={jobsByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%"
                          outerRadius={80} paddingAngle={2}
                          onClick={(d: any) => setSelectedJobStatus(prev => prev === d.name ? null : d.name)}
                          style={{ cursor: "pointer" }}>
                          {jobsByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {jobsByStatus.map((d, i) => (
                        <button key={d.name} onClick={() => setSelectedJobStatus(prev => prev === d.name ? null : d.name)}
                          className={`flex items-center gap-1.5 text-xs rounded px-1.5 py-0.5 transition-colors ${selectedJobStatus === d.name ? 'bg-muted text-foreground' : 'text-foreground/80 hover:bg-muted'}`}>
                          <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="capitalize">{d.name}</span>: <span className="font-semibold">{d.value}</span>
                        </button>
                      ))}
                    </div>
                    {selectedJobStatus && (
                      <DrillPanel title={selectedJobStatus} count={selectedJobStatusTasks.length} onClose={() => setSelectedJobStatus(null)}>
                        {selectedJobStatusTasks.map(t => <JobDrillRow key={t.id} task={t} />)}
                      </DrillPanel>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Row 4: Revenue Trend ── */}
        {visibleSections.has("revenueTrend") && (
          <div className="bg-card border border-border rounded-xl p-4">
            <CardHeader
              title={`Revenue Trend — ${range}-Month Area`}
              sub="Cumulative view of invoiced amounts over time"
              sectionKey="revenueTrend"
            />
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `R${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtR(v)} />
                <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                <Area type="monotone" dataKey="Revenue" stroke="#6366f1" strokeWidth={2} fill="url(#revGrad)" />
                <Area type="monotone" dataKey="Collected" stroke="#22c55e" strokeWidth={2} fill="url(#colGrad)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Task Creation List ── */}
        {visibleSections.has("taskCreationList") && (() => {
          const allTasks = [...(workspace.tasks || [])]
            .filter(t => t.createdAt)
            .sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());
          const noDateTasks = (workspace.tasks || []).filter(t => !t.createdAt);
          const sortedTasks = [...allTasks, ...noDateTasks];
          return (
            <div className="bg-card border border-border rounded-xl p-4">
              <CardHeader title="Task Creation List" sub={`${sortedTasks.length} job${sortedTasks.length !== 1 ? 's' : ''} — oldest to newest`} sectionKey="taskCreationList" />
              {sortedTasks.length === 0 ? (
                <div className="flex items-center justify-center h-[80px] text-muted-foreground text-sm">No jobs yet</div>
              ) : (
                <div className="space-y-1.5 mt-3 max-h-[520px] overflow-y-auto pr-1">
                  {sortedTasks.map((task, idx) => {
                    const cfv = task.customFieldValues || [];
                    const customerName = (cfv as any[]).find((cf: any) => cf.fieldId === "cf1774254755047")?.value || "";
                    const brand = (cfv as any[]).find((cf: any) => cf.fieldId === "cf1774304257238")?.value || "";
                    const model = (cfv as any[]).find((cf: any) => cf.fieldId === "cf1774305032046")?.value || "";
                    const repairCost = (cfv as any[]).find((cf: any) => cf.fieldId === "cf1774449426556")?.value;
                    const createdLabel = task.createdAt
                      ? new Date(task.createdAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })
                      : "";
                    return (
                      <div key={task.id}
                        onClick={() => onOpenTask?.(task.id)}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 border border-border hover:border-indigo-500 hover:bg-muted transition-colors ${onOpenTask ? 'cursor-pointer' : ''}`}>
                        <span className="text-[11px] font-mono text-muted-foreground w-7 shrink-0 text-right">{idx + 1}</span>
                        <div className="h-6 w-6 rounded bg-indigo-900 flex items-center justify-center shrink-0">
                          <Wrench className="h-3 w-3 text-indigo-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{task.title || (task as any).jobNumber || "(no title)"}</p>
                          {(customerName || brand || model) && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              {[customerName, brand, model].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {repairCost && <span className="text-[11px] text-green-400">R{repairCost}</span>}
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-foreground/80 capitalize">{task.status}</span>
                          {createdLabel && <span className="text-[10px] text-muted-foreground hidden sm:block">{createdLabel}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        <div className="h-4" />
      </div>
    </div>
  );
}
