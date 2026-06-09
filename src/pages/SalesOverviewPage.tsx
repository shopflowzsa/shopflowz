import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ArrowLeft, TrendingUp, TrendingDown, DollarSign, Users,
  FileText, Receipt, RefreshCw, FileSpreadsheet, X, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { getInvoices } from "@/lib/invoiceService";
import { getQuotations } from "@/lib/quotationService";
import type { WorkspaceState } from "@/types/crm";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ComposedChart, Area,
} from "recharts";

interface Props {
  onClose: () => void;
  workspace: WorkspaceState;
  onGoCustomers?: () => void;
  onGoQuotations?: () => void;
  onGoInvoices?: () => void;
  onOpenInvoice?: (id: string) => void;
  onOpenQuotation?: (id: string) => void;
}

const COLORS = ["#22c55e", "#6366f1", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtR = (n: number) => `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));
const tooltipStyle = { backgroundColor: "#1e293b", border: "1px solid #334155", color: "#f1f5f9", borderRadius: 8 };

function KpiCard({ title, value, sub, icon, trend, color = "text-foreground" }: {
  title: string; value: string; sub?: string; icon: React.ReactNode;
  trend?: number; color?: string;
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
          {Math.abs(trend).toFixed(1)}% vs last month
        </div>
      )}
    </div>
  );
}

export function SalesOverviewPage({ onClose, workspace, onGoCustomers, onGoQuotations, onGoInvoices, onOpenInvoice, onOpenQuotation }: Props) {
  const { workspaceId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [range, setRange] = useState<6 | 12>(6);

  type DrillItem = { label: string; value: string; extra?: string; extra2?: string; badge?: string; badgeColor?: string };
  type DrillRow = { _id?: string; _type?: "invoice" | "quotation" | "task"; cells: DrillItem[] };
  type DrillDown = { title: string; subtitle: string; columns: string[]; rows: DrillRow[] } | null;
  const [drillDown, setDrillDown] = useState<DrillDown>(null);

  const STATUS_COLORS: Record<string, string> = {
    paid: "text-green-400", partial: "text-amber-400", overdue: "text-red-400", unpaid: "text-muted-foreground",
    accepted: "text-green-400", declined: "text-red-400", pending: "text-amber-400", draft: "text-muted-foreground",
  };

  const openInvoiceDrill = useCallback((title: string, subtitle: string, items: any[]) => {
    setDrillDown({
      title, subtitle,
      columns: ["Invoice No.", "Date", "Customer", "Total", "Paid", "Balance", "Status"],
      rows: items.map(inv => ({
        _id: inv.id,
        _type: "invoice" as const,
        cells: [
          { label: inv.invoiceNumber || inv.id?.slice(0, 8) || "—" },
          { label: inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString("en-ZA") : inv.createdAt ? new Date(inv.createdAt).toLocaleDateString("en-ZA") : "—" },
          { label: inv.customerName || "—" },
          { label: `R${(inv.total || 0).toLocaleString("en-ZA")}` },
          { label: `R${(inv.amountPaid || 0).toLocaleString("en-ZA")}` },
          { label: `R${(inv.balanceDue || 0).toLocaleString("en-ZA")}` },
          { label: inv.paymentStatus || "—", badgeColor: STATUS_COLORS[inv.paymentStatus] || "text-muted-foreground" },
        ],
      })),
    });
  }, []);

  const openQuoteDrill = useCallback((title: string, subtitle: string, items: any[]) => {
    setDrillDown({
      title, subtitle,
      columns: ["Quote No.", "Date", "Customer", "Total", "Status", "Converted"],
      rows: items.map(q => ({
        _id: q.id,
        _type: "quotation" as const,
        cells: [
          { label: q.quotationNumber || q.id?.slice(0, 8) || "—" },
          { label: q.quotationDate ? new Date(q.quotationDate).toLocaleDateString("en-ZA") : q.createdAt ? new Date(q.createdAt).toLocaleDateString("en-ZA") : "—" },
          { label: q.customerName || "—" },
          { label: `R${(q.total || 0).toLocaleString("en-ZA")}` },
          { label: q.status || "—", badgeColor: STATUS_COLORS[q.status] || "text-muted-foreground" },
          { label: q.convertedToInvoiceId ? "Yes" : "No", badgeColor: q.convertedToInvoiceId ? "text-green-400" : "text-muted-foreground" },
        ],
      })),
    });
  }, []);

  const openTaskDrill = useCallback((title: string, subtitle: string, items: any[]) => {
    setDrillDown({
      title, subtitle,
      columns: ["Job No.", "Client", "Description", "Status", "List"],
      rows: items.map(t => ({
        _id: t.id,
        _type: "task" as const,
        cells: [
          { label: t.taskNumber || t.id?.slice(0, 8) || "—" },
          { label: t.customFields?.find((f: any) => f.name?.toLowerCase().includes("client"))?.value || t.customFields?.[0]?.value || "—" },
          { label: t.title || "—" },
          { label: t.status || "—", badgeColor: "text-blue-400" },
          { label: t.listName || "—" },
        ],
      })),
    });
  }, [workspace.tasks]);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    Promise.all([getInvoices(workspaceId), getQuotations(workspaceId)])
      .then(([inv, quo]) => { setInvoices(inv); setQuotations(quo); })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const now = new Date();

  // ── Monthly invoices + quotes ─────────────────────────────────────────
  const monthlyData = useMemo(() => {
    const months = [];
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = `${MONTHS[d.getMonth()]} '${d.getFullYear().toString().slice(2)}`;
      const mi = invoices.filter(inv => {
        const id = new Date(inv.createdAt || inv.invoiceDate);
        return id.getFullYear() === d.getFullYear() && id.getMonth() === d.getMonth();
      });
      const mq = quotations.filter(q => {
        const qd = new Date(q.createdAt || q.quotationDate);
        return qd.getFullYear() === d.getFullYear() && qd.getMonth() === d.getMonth();
      });
      months.push({
        month: label,
        Revenue: Math.round(mi.reduce((s, i) => s + (i.total || 0), 0)),
        Collected: Math.round(mi.reduce((s, i) => s + (i.amountPaid || 0), 0)),
        QuotesValue: Math.round(mq.reduce((s, q) => s + (q.total || 0), 0)),
        Invoices: mi.length,
        Quotes: mq.length,
        _invoices: mi,
        _quotations: mq,
      });
    }
    return months;
  }, [invoices, quotations, range]);

  // ── Invoice status breakdown ──────────────────────────────────────────
  const invoiceStatusData = useMemo(() => {
    const paidItems = invoices.filter(i => i.paymentStatus === "paid");
    const partialItems = invoices.filter(i => i.paymentStatus === "partial");
    const overdueItems = invoices.filter(i => i.paymentStatus !== "paid" && i.dueDate && new Date(i.dueDate) < new Date());
    const unpaidItems = invoices.filter(i => i.paymentStatus === "unpaid" && !(i.dueDate && new Date(i.dueDate) < new Date()));
    return [
      { name: "Paid", value: paidItems.length, _invoices: paidItems },
      { name: "Partial", value: partialItems.length, _invoices: partialItems },
      { name: "Overdue", value: overdueItems.length, _invoices: overdueItems },
      { name: "Unpaid", value: unpaidItems.length, _invoices: unpaidItems },
    ].filter(d => d.value > 0);
  }, [invoices]);

  // ── Quote funnel / dropoff analysis ───────────────────────────────────
  const quoteFunnelData = useMemo(() => [
    { stage: "Quotes Sent", count: quotations.length, fill: "#6366f1", _quotes: quotations },
    { stage: "Accepted", count: quotations.filter(q => q.status === "accepted").length, fill: "#22c55e", _quotes: quotations.filter(q => q.status === "accepted") },
    { stage: "Converted", count: quotations.filter(q => q.convertedToInvoiceId).length, fill: "#06b6d4", _quotes: quotations.filter(q => q.convertedToInvoiceId) },
    { stage: "Declined", count: quotations.filter(q => q.status === "declined").length, fill: "#ef4444", _quotes: quotations.filter(q => q.status === "declined") },
  ], [quotations]);

  // ── Job dropoff — tasks by status ─────────────────────────────────────
  const jobDropoff = useMemo(() => {
    const map: Record<string, any[]> = {};
    workspace.tasks.filter(t => !t.archived).forEach(t => {
      const s = t.status || "unknown";
      if (!map[s]) map[s] = [];
      map[s].push(t);
    });
    return Object.entries(map)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, tasks]) => ({ name: name.length > 14 ? name.slice(0, 13) + "…" : name, fullName: name, value: tasks.length, _tasks: tasks }));
  }, [workspace.tasks]);

  // ── Top customers by revenue ──────────────────────────────────────────
  const topCustomers = useMemo(() => {
    const map: Record<string, { rev: number; items: any[] }> = {};
    invoices.forEach(inv => {
      const name = inv.customerName || "Unknown";
      if (!map[name]) map[name] = { rev: 0, items: [] };
      map[name].rev += (inv.total || 0);
      map[name].items.push(inv);
    });
    return Object.entries(map)
      .sort((a, b) => b[1].rev - a[1].rev)
      .slice(0, 8)
      .map(([name, { rev, items }]) => ({
        name: name.length > 20 ? name.slice(0, 19) + "…" : name,
        fullName: name,
        Revenue: Math.round(rev),
        _invoices: items,
      }));
  }, [invoices]);

  // ── KPIs ──────────────────────────────────────────────────────────────
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

  const thisMonthQuotes = quotations.filter(q => {
    const d = new Date(q.createdAt || q.quotationDate);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  const totalOutstanding = invoices.reduce((s, i) => s + (i.balanceDue || 0), 0);
  const conversionRate = pct(quotations.filter(q => q.convertedToInvoiceId).length, quotations.length);
  const totalRevenue = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const totalCollected = invoices.reduce((s, i) => s + (i.amountPaid || 0), 0);
  const collectionRate = pct(totalCollected, totalRevenue);

  if (loading) {
    return (
      <div className="absolute inset-0 bg-background z-30 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-green-400" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-background z-30 flex flex-col text-foreground overflow-hidden">      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-background">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onClose} className="text-muted-foreground hover:text-foreground hover:bg-muted">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <DollarSign className="h-5 w-5 text-green-400" />
          <div>
            <h1 className="text-lg font-bold text-foreground">Sales Overview</h1>
            <p className="text-xs text-muted-foreground">Revenue · Invoices · Quotes · Dropoff analysis</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Quick nav */}
          {onGoCustomers && (
            <Button size="sm" variant="ghost" onClick={onGoCustomers} className="text-blue-400 hover:text-blue-300 h-7 text-xs gap-1.5">
              <Users className="h-3.5 w-3.5" /> Customers
            </Button>
          )}
          {onGoQuotations && (
            <Button size="sm" variant="ghost" onClick={onGoQuotations} className="text-indigo-400 hover:text-indigo-300 h-7 text-xs gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Quotes
            </Button>
          )}
          {onGoInvoices && (
            <Button size="sm" variant="ghost" onClick={onGoInvoices} className="text-purple-400 hover:text-purple-300 h-7 text-xs gap-1.5">
              <Receipt className="h-3.5 w-3.5" /> Invoices
            </Button>
          )}
          <div className="w-px h-5 bg-border" />
          <span className="text-xs text-muted-foreground">Range:</span>
          {([6, 12] as const).map(r => (
            <Button key={r} size="sm" variant={range === r ? "default" : "ghost"}
              className={range === r ? "bg-green-700 text-white h-7 text-xs" : "text-muted-foreground hover:text-foreground h-7 text-xs"}
              onClick={() => setRange(r)}>
              {r}M
            </Button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard title="Revenue This Month" value={fmtR(thisMonthRevenue)} trend={revTrend}
            icon={<DollarSign className="h-4 w-4" />} color="text-green-400" />
          <KpiCard title="Invoices This Month" value={String(thisMonthInvoices.length)}
            sub={`${invoices.length} total all time`}
            icon={<Receipt className="h-4 w-4" />} color="text-purple-400" />
          <KpiCard title="Quotes This Month" value={String(thisMonthQuotes.length)}
            sub={`${quotations.length} total all time`}
            icon={<FileSpreadsheet className="h-4 w-4" />} color="text-indigo-400" />
          <KpiCard title="Quote Conversion" value={`${conversionRate}%`}
            sub={`${quotations.filter(q => q.convertedToInvoiceId).length} converted`}
            icon={<FileText className="h-4 w-4" />} color={conversionRate > 50 ? "text-green-400" : "text-amber-400"} />
          <KpiCard title="Outstanding Balance" value={fmtR(totalOutstanding)}
            sub={`${invoices.filter(i => i.paymentStatus !== "paid").length} unpaid`}
            icon={<TrendingDown className="h-4 w-4" />} color="text-amber-400" />
          <KpiCard title="Collection Rate" value={`${collectionRate}%`}
            sub={fmtR(totalCollected) + " collected"}
            icon={<TrendingUp className="h-4 w-4" />} color={collectionRate > 80 ? "text-green-400" : "text-amber-400"} />
        </div>

        {/* ── Row 1: Monthly Revenue & Quotes + Invoice Status ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Monthly Revenue vs Collected — Last {range} Months</h3>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `R${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtR(v)} />
                <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                <Bar dataKey="Revenue" fill="#22c55e" radius={[4,4,0,0]} maxBarSize={30} style={{ cursor: "pointer" }}
                  onClick={(d: any) => openInvoiceDrill(`Revenue — ${d.month}`, `${d._invoices?.length || 0} invoices · R${d.Revenue?.toLocaleString("en-ZA")}`, d._invoices || [])} />
                <Bar dataKey="Collected" fill="#6366f1" radius={[4,4,0,0]} maxBarSize={30} style={{ cursor: "pointer" }}
                  onClick={(d: any) => openInvoiceDrill(`Collected — ${d.month}`, `${d._invoices?.length || 0} invoices collected`, d._invoices || [])} />
                <Line type="monotone" dataKey="QuotesValue" stroke="#f59e0b" strokeWidth={2} dot={false} name="Quotes Value" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Invoice Status Breakdown</h3>
            {invoiceStatusData.length === 0 ? (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">No invoices yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie data={invoiceStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={50} outerRadius={80} paddingAngle={3}
                    label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={11}
                    style={{ cursor: "pointer" }}
                    onClick={(d: any) => openInvoiceDrill(`${d.name} Invoices`, `${d.value} invoice${d.value !== 1 ? 's' : ''} · ${d.name.toLowerCase()}`, d._invoices || [])}>
                    {invoiceStatusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              {invoiceStatusData.map((d, i) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs text-foreground/80">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  {d.name}: <span className="font-semibold">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Row 2: Quote Funnel + Job Dropoff ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-1">Quote Dropoff Funnel</h3>
            <p className="text-xs text-muted-foreground mb-3">{conversionRate}% quote-to-invoice conversion</p>
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={quoteFunnelData} layout="vertical" margin={{ top: 4, right: 50, left: 70, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="stage" tick={{ fill: "#94a3b8", fontSize: 11 }} width={70} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" radius={[0,4,4,0]} maxBarSize={30} style={{ cursor: "pointer" }}
                  onClick={(d: any) => openQuoteDrill(`${d.stage}`, `${d.count} quotation${d.count !== 1 ? 's' : ''}`, d._quotes || [])}
                  label={{ position: "right", fill: "#94a3b8", fontSize: 11, formatter: (v: number) => v > 0 ? v : "" }}>
                  {quoteFunnelData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-1">Job Dropoff by Status</h3>
            <p className="text-xs text-muted-foreground mb-3">Where jobs are currently sitting</p>
            {jobDropoff.length === 0 ? (
              <div className="flex items-center justify-center h-[210px] text-muted-foreground text-sm">No jobs yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={jobDropoff} layout="vertical" margin={{ top: 4, right: 50, left: 80, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} width={80} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="value" radius={[0,4,4,0]} maxBarSize={24} style={{ cursor: "pointer" }}
                    onClick={(d: any) => openTaskDrill(`Jobs — ${d.fullName || d.name}`, `${d.value} job${d.value !== 1 ? 's' : ''} with this status`, d._tasks || [])}
                    label={{ position: "right", fill: "#94a3b8", fontSize: 11, formatter: (v: number) => v > 0 ? v : "" }}>
                    {jobDropoff.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Row 3: Invoice & Quote counts per month + Top Customers ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Monthly Invoice &amp; Quote Counts</h3>
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                <Bar dataKey="Invoices" fill="#a78bfa" radius={[4,4,0,0]} maxBarSize={28} style={{ cursor: "pointer" }}
                  onClick={(d: any) => openInvoiceDrill(`Invoices — ${d.month}`, `${d.Invoices} invoice${d.Invoices !== 1 ? 's' : ''}`, d._invoices || [])} />
                <Bar dataKey="Quotes" fill="#f59e0b" radius={[4,4,0,0]} maxBarSize={28} style={{ cursor: "pointer" }}
                  onClick={(d: any) => openQuoteDrill(`Quotes — ${d.month}`, `${d.Quotes} quotation${d.Quotes !== 1 ? 's' : ''}`, d._quotations || [])} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Top Customers by Revenue</h3>
            {topCustomers.length === 0 ? (
              <div className="flex items-center justify-center h-[210px] text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={topCustomers} layout="vertical" margin={{ top: 4, right: 60, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `R${(v/1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} width={120} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtR(v)} />
                  <Bar dataKey="Revenue" fill="#22c55e" radius={[0,4,4,0]} maxBarSize={20} style={{ cursor: "pointer" }}
                    onClick={(d: any) => openInvoiceDrill(`${d.fullName || d.name}`, `${d._invoices?.length || 0} invoice${d._invoices?.length !== 1 ? 's' : ''} · R${d.Revenue?.toLocaleString("en-ZA")} revenue`, d._invoices || [])}
                    label={{ position: "right", fill: "#94a3b8", fontSize: 10, formatter: (v: number) => fmtR(v) }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="h-4" />
      </div>

      {/* ── Drill-Down Panel ── */}
      {drillDown && (
        <div className="shrink-0 border-t border-border bg-background flex flex-col" style={{ maxHeight: '45%' }}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <div>
              <span className="text-sm font-semibold text-foreground">{drillDown.title}</span>
              <span className="ml-2 text-xs text-muted-foreground">{drillDown.subtitle}</span>
            </div>
            <button onClick={() => setDrillDown(null)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="overflow-auto flex-1">
            {drillDown.rows.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">No records found</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr>
                    {drillDown.columns.map(col => (
                      <th key={col} className="text-left px-3 py-2 text-muted-foreground font-medium border-b border-border whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {drillDown.rows.map((row, ri) => {
                    const isClickable = (row._type === "invoice" && onOpenInvoice) || (row._type === "quotation" && onOpenQuotation);
                    return (
                      <tr key={ri}
                        className={`border-b border-border/50 transition-colors ${
                          isClickable ? "cursor-pointer hover:bg-indigo-950/40 hover:border-indigo-800/40" : "hover:bg-muted/40"
                        }`}
                        onClick={() => {
                          if (row._type === "invoice" && row._id && onOpenInvoice) {
                            setDrillDown(null);
                            onOpenInvoice(row._id);
                          } else if (row._type === "quotation" && row._id && onOpenQuotation) {
                            setDrillDown(null);
                            onOpenQuotation(row._id);
                          }
                        }}
                      >
                        {row.cells.map((cell, ci) => (
                          <td key={ci} className={`px-3 py-1.5 whitespace-nowrap ${cell.badgeColor || "text-foreground"}`}>
                            {cell.label}
                            {ci === 0 && isClickable && (
                              <span className="ml-1.5 text-[9px] text-indigo-400 opacity-60">↗</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
