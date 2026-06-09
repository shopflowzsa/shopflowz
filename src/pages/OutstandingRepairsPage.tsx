import { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft, Settings, BarChart2, AlertCircle, DollarSign,
  ClipboardList, TrendingUp, RefreshCw, CheckCircle,
  ChevronDown, ChevronUp, Search, Clock, Tag, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  loadOutstandingRepairsSettings,
  saveOutstandingRepairsSettings,
  OutstandingRepairsSettings,
  DEFAULT_OUTSTANDING_SETTINGS,
} from "@/lib/outstandingRepairsService";
import type { WorkspaceState, Task } from "@/types/crm";

interface Props {
  onClose: () => void;
  workspace: WorkspaceState;
  onOpenTask?: (task: Task) => void;
}

// ── Age bucket helpers ────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;

function ageMs(task: Task): number {
  if (!task.createdAt) return 0;
  const d = new Date(task.createdAt).getTime();
  return isNaN(d) ? 0 : Date.now() - d;
}

type AgeBucket = "fresh" | "week" | "month" | "old";

function ageBucket(ms: number): AgeBucket {
  if (ms < DAY_MS * 7)  return "fresh";
  if (ms < DAY_MS * 30) return "week";
  if (ms < DAY_MS * 90) return "month";
  return "old";
}

const AGE_COLORS: Record<AgeBucket, string> = {
  fresh: "#22c55e",
  week:  "#f59e0b",
  month: "#f97316",
  old:   "#ef4444",
};

const AGE_BUCKET_META: { id: AgeBucket; label: string }[] = [
  { id: "fresh", label: "< 1 Week" },
  { id: "week",  label: "1–4 Weeks" },
  { id: "month", label: "1–3 Months" },
  { id: "old",   label: "3+ Months" },
];

function fmtAge(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  if (days < 7)  return `${days} days`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} wk${weeks > 1 ? "s" : ""}`;
  const months = Math.floor(days / 30);
  return `${months} mo${months > 1 ? "s" : ""}`;
}

// ── Misc ──────────────────────────────────────────────────────────────────────
const STATUS_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#06b6d4", "#6366f1", "#8b5cf6", "#ec4899",
];

const fmtR = (n: number) =>
  `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type FilterTab = "all" | "no_price" | AgeBucket;

const FILTER_TABS: { id: FilterTab; label: string; color: string }[] = [
  { id: "all",      label: "All",        color: "text-foreground/80" },
  { id: "no_price", label: "No Price",   color: "text-red-400" },
  { id: "fresh",    label: "< 1 Week",   color: "text-green-400" },
  { id: "week",     label: "1–4 Weeks",  color: "text-yellow-400" },
  { id: "month",    label: "1–3 Months", color: "text-orange-400" },
  { id: "old",      label: "3+ Months",  color: "text-red-400" },
];

function KpiCard({ title, value, sub, icon, accent }: {
  title: string; value: string; sub?: string; icon: React.ReactNode; accent?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">{title}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className={`text-2xl font-bold ${accent ?? "text-foreground"}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function OutstandingRepairsPage({ onClose, workspace, onOpenTask }: Props) {
  const { workspaceId } = useAuth();
  const { toast } = useToast();

  const [tab, setTab]           = useState<"dashboard" | "settings">("dashboard");
  const [filter, setFilter]     = useState<FilterTab>("all");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [settings, setSettings] = useState<OutstandingRepairsSettings>(DEFAULT_OUTSTANDING_SETTINGS);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [search, setSearch]     = useState("");
  const [sortKey, setSortKey]   = useState<"value" | "title" | "status" | "age">("age");
  const [sortAsc, setSortAsc]   = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    loadOutstandingRepairsSettings(workspaceId).then(s => {
      setSettings(s);
      setLoading(false);
    });
  }, [workspaceId]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const selectedList = useMemo(
    () => workspace.lists.find(l => l.id === settings.listId),
    [workspace.lists, settings.listId]
  );

  const valueField = useMemo(
    () => workspace.customFields.find(f => f.id === settings.valueFieldId),
    [workspace.customFields, settings.valueFieldId]
  );

  const getTaskValue = (task: Task): number => {
    if (!settings.valueFieldId) return 0;
    const cfv = task.customFieldValues?.find(v => v.fieldId === settings.valueFieldId);
    const raw = cfv?.value;
    if (raw === undefined || raw === null || raw === "") return 0;
    const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
    return isNaN(n) ? 0 : n;
  };

  const listStatuses = useMemo(() => {
    // 1. Prefer the list's declared customStatuses
    if (selectedList?.customStatuses && selectedList.customStatuses.length > 0) {
      return selectedList.customStatuses as { id: string; label: string }[];
    }
    // 2. Derive from actual task status values found in the selected list
    const tasksInList = workspace.tasks.filter(t => t.listId === settings.listId);
    if (tasksInList.length > 0) {
      const seen = new Map<string, string>();
      tasksInList.forEach(t => {
        if (t.status && !seen.has(t.status)) {
          // Format the ID as a readable label
          const label = t.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          seen.set(t.status, label);
        }
      });
      return [...seen.entries()].map(([id, label]) => ({ id, label }));
    }
    // 3. Fall back to workspace-level default statuses
    return [
      { id: "to_do",       label: "To Do" },
      { id: "in_progress", label: "In Progress" },
      { id: "review",      label: "Review" },
      { id: "done",        label: "Done" },
      { id: "quoted",      label: "Quoted" },
      { id: "invoiced",    label: "Invoiced" },
      { id: "paid",        label: "Paid" },
      { id: "complete",    label: "Complete" },
    ];
  }, [selectedList, workspace.tasks, settings.listId]);

  const outstandingTasks = useMemo(() => {
    if (!settings.listId) return [];
    const completedSet = new Set(settings.completedStatusIds);
    return workspace.tasks.filter(t =>
      t.listId === settings.listId && !t.archived && !completedSet.has(t.status)
    );
  }, [workspace.tasks, settings.listId, settings.completedStatusIds]);

  // All (including collected) — for the audit summary bar
  const allTasksInList = useMemo(() => {
    if (!settings.listId) return [];
    return workspace.tasks.filter(t => t.listId === settings.listId && !t.archived);
  }, [workspace.tasks, settings.listId]);

  const excludedTasks = useMemo(() => {
    const completedSet = new Set(settings.completedStatusIds);
    return allTasksInList.filter(t => completedSet.has(t.status));
  }, [allTasksInList, settings.completedStatusIds]);

  const noPriceTasks   = useMemo(() => outstandingTasks.filter(t => getTaskValue(t) === 0), [outstandingTasks, settings.valueFieldId]);
  const withPriceTasks = useMemo(() => outstandingTasks.filter(t => getTaskValue(t) > 0),  [outstandingTasks, settings.valueFieldId]);
  const totalValue     = useMemo(() => withPriceTasks.reduce((s, t) => s + getTaskValue(t), 0), [withPriceTasks, settings.valueFieldId]);

  const ageBucketStats = useMemo(() => {
    return AGE_BUCKET_META.map(({ id, label }) => {
      const matching = outstandingTasks.filter(t => ageBucket(ageMs(t)) === id);
      return {
        id, label,
        count: matching.length,
        value: matching.reduce((s, t) => s + getTaskValue(t), 0),
        color: AGE_COLORS[id],
      };
    });
  }, [outstandingTasks, settings.valueFieldId]);

  // Full breakdown including EXCLUDED statuses (for the breakdown table)
  const fullStatusBreakdown = useMemo(() => {
    const completedSet = new Set(settings.completedStatusIds);
    const map: Record<string, { label: string; count: number; value: number; excluded: boolean }> = {};
    allTasksInList.forEach(t => {
      const statusObj = listStatuses.find(s => s.id === t.status);
      const label = statusObj?.label ?? t.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      if (!map[t.status]) map[t.status] = { label, count: 0, value: 0, excluded: completedSet.has(t.status) };
      map[t.status].count++;
      map[t.status].value += getTaskValue(t);
    });
    return Object.entries(map)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => (a.excluded ? 1 : 0) - (b.excluded ? 1 : 0) || b.value - a.value);
  }, [allTasksInList, listStatuses, settings.completedStatusIds, settings.valueFieldId]);

  const statusBreakdown = useMemo(() => {
    const map: Record<string, { label: string; count: number; value: number }> = {};
    outstandingTasks.forEach(t => {
      const statusObj = listStatuses.find(s => s.id === t.status);
      const label = statusObj?.label ?? t.status;
      if (!map[t.status]) map[t.status] = { label, count: 0, value: 0 };
      map[t.status].count++;
      map[t.status].value += getTaskValue(t);
    });
    return Object.entries(map).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.value - a.value);
  }, [outstandingTasks, listStatuses, settings.valueFieldId]);

  const filteredTasks = useMemo(() => {
    let tasks = outstandingTasks;
    if (filter === "no_price") tasks = tasks.filter(t => getTaskValue(t) === 0);
    else if (filter !== "all") tasks = tasks.filter(t => ageBucket(ageMs(t)) === filter);
    if (statusFilter) tasks = tasks.filter(t => t.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      tasks = tasks.filter(t =>
        t.title.toLowerCase().includes(q) || (t.jobNumber ?? "").toLowerCase().includes(q)
      );
    }
    return [...tasks].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "value")  cmp = getTaskValue(a) - getTaskValue(b);
      else if (sortKey === "title")  cmp = a.title.localeCompare(b.title);
      else if (sortKey === "status") cmp = a.status.localeCompare(b.status);
      else if (sortKey === "age")    cmp = ageMs(a) - ageMs(b);
      return sortAsc ? cmp : -cmp;
    });
    }, [outstandingTasks, filter, statusFilter, search, sortKey, sortAsc, settings.valueFieldId]);

  const getStatusLabel = (id: string) => listStatuses.find(s => s.id === id)?.label ?? id;

  const toggleSortCol = (col: typeof sortKey) => {
    if (sortKey === col) setSortAsc(x => !x);
    else { setSortKey(col); setSortAsc(false); }
  };

  const SortIcon = ({ col }: { col: typeof sortKey }) =>
    sortKey === col
      ? sortAsc ? <ChevronUp className="h-3 w-3 inline ml-1" /> : <ChevronDown className="h-3 w-3 inline ml-1" />
      : null;

  const handleSave = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      await saveOutstandingRepairsSettings(workspaceId, settings);
      toast({ title: "Settings saved", description: "Outstanding repairs settings updated." });
      setTab("dashboard");
    } catch {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="absolute inset-0 z-30 bg-background flex items-center justify-center">
        <RefreshCw className="h-6 w-6 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 bg-background text-foreground flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <AlertCircle className="h-5 w-5 text-orange-400" />
        <h1 className="text-base font-semibold">Outstanding Tasks Assessment</h1>
        <div className="flex-1" />
        <button
          onClick={() => setTab(tab === "dashboard" ? "settings" : "dashboard")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            tab === "settings" ? "bg-indigo-600 text-white" : "bg-card text-foreground/80 hover:bg-muted"
          }`}
        >
          <Settings className="h-3.5 w-3.5" /> Settings
        </button>
      </div>

      {/* ── No completed statuses configured warning ── */}
      {settings.listId && settings.completedStatusIds.length === 0 && tab === "dashboard" && (
        <div className="mx-4 mt-3 p-3 bg-yellow-950/40 border border-yellow-700 rounded-lg flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-yellow-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-300">Collected statuses not configured</p>
            <p className="text-xs text-yellow-500 mt-0.5">All jobs are shown, including collected ones. Open Settings and tick which statuses mean "Collected / Done" to exclude them.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setTab("settings")} className="shrink-0 border-yellow-700 text-yellow-300 hover:bg-yellow-900">
            Fix
          </Button>
        </div>
      )}

      {/* ── No list configured ── */}
      {!settings.listId && tab === "dashboard" && (
        <div className="m-4 p-4 bg-orange-950/40 border border-orange-700 rounded-lg flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-orange-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-orange-300">No list configured</p>
            <p className="text-xs text-orange-400 mt-0.5">Open Settings to map a list and a value field.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setTab("settings")} className="ml-auto shrink-0 border-orange-700 text-orange-300 hover:bg-orange-900">
            Configure
          </Button>
        </div>
      )}

      {/* ══════════════ DASHBOARD ══════════════ */}
      {tab === "dashboard" && settings.listId && (
        <div className="flex-1 overflow-auto p-4 space-y-5">

          {/* Audit summary bar — always visible when a list is configured */}
          <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <span className="text-muted-foreground">List total: <strong className="text-foreground">{allTasksInList.length} jobs</strong></span>
            <span className="text-green-400">Excluded (collected): <strong>{excludedTasks.length}</strong></span>
            <span className="text-orange-400">Outstanding (in shelf): <strong>{outstandingTasks.length}</strong></span>
            <span className="text-yellow-400">With price: <strong>{withPriceTasks.length}</strong></span>
            <span className="text-red-400">No price: <strong>{noPriceTasks.length}</strong></span>
            <span className="text-foreground/80 ml-auto font-bold">Total: {fmtR(totalValue)}</span>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              title="Outstanding Value"
              value={fmtR(totalValue)}
              sub={`${outstandingTasks.length} jobs`}
              icon={<DollarSign className="h-4 w-4" />}
              accent="text-orange-400"
            />
            <KpiCard
              title="Missing Price"
              value={String(noPriceTasks.length)}
              sub="need pricing"
              icon={<Tag className="h-4 w-4" />}
              accent={noPriceTasks.length > 0 ? "text-red-400" : "text-foreground"}
            />
            <KpiCard
              title="1+ Month Old"
              value={String(
                ageBucketStats.filter(b => b.id === "month" || b.id === "old").reduce((s, b) => s + b.count, 0)
              )}
              sub="sitting > 30 days"
              icon={<Clock className="h-4 w-4" />}
              accent="text-yellow-400"
            />
            <KpiCard
              title="Avg. Repair Value"
              value={withPriceTasks.length ? fmtR(totalValue / withPriceTasks.length) : "R0"}
              sub="priced jobs only"
              icon={<TrendingUp className="h-4 w-4" />}
            />
          </div>

          {/* Age overview cards — clickable to filter */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {ageBucketStats.map(b => (
              <div
                key={b.id}
                onClick={() => { setFilter(b.id as FilterTab); setStatusFilter(null); }}
                className={`bg-card border rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:bg-muted/70 transition-colors ${
                  filter === b.id ? "border-white/20" : "border-border"
                }`}
              >
                <div className="w-2 h-10 rounded-full flex-shrink-0" style={{ background: b.color }} />
                <div>
                  <div className="text-xs text-muted-foreground">{b.label}</div>
                  <div className="text-xl font-bold text-foreground">{b.count} <span className="text-xs font-normal text-muted-foreground">jobs</span></div>
                  <div className="text-xs font-medium" style={{ color: b.color }}>{fmtR(b.value)}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Missing-price alert banner */}
          {noPriceTasks.length > 0 && (
            <div
              onClick={() => { setFilter("no_price"); setStatusFilter(null); }}
              className={`p-3 bg-red-950/40 border border-red-700 rounded-lg flex items-center gap-3 cursor-pointer hover:bg-red-950/60 ${
                filter === "no_price" ? "ring-1 ring-red-500" : ""
              }`}
            >
              <Tag className="h-5 w-5 text-red-400 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-300">
                  {noPriceTasks.length} job{noPriceTasks.length !== 1 ? "s" : ""} have no price set — not counted in the total
                </p>
                <p className="text-xs text-red-400">Click to view and add missing prices.</p>
              </div>
              <ChevronDown className="h-4 w-4 text-red-400 -rotate-90" />
            </div>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-xl p-4">
              <h2 className="text-sm font-semibold text-foreground/80 mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-yellow-400" /> Jobs by Age
                <span className="text-xs text-muted-foreground font-normal ml-1">· click bar to filter</span>
              </h2>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={ageBucketStats} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                    formatter={(v: any, name: any) => [name === "count" ? `${v} jobs` : fmtR(Number(v)), name === "count" ? "Jobs" : "Value"]}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} name="count"
                    onClick={(d: any) => { const match = ageBucketStats.find(b => b.label === d.label); if (match) { setFilter(match.id as FilterTab); setStatusFilter(null); } }}
                    style={{ cursor: "pointer" }}>
                    {ageBucketStats.map((b, i) => <Cell key={i} fill={b.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-card border border-border rounded-xl p-4">
              <h2 className="text-sm font-semibold text-foreground/80 mb-3 flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-orange-400" /> Breakdown by Status
                <span className="text-xs text-muted-foreground font-normal ml-1">· click row to filter</span>
              </h2>
              <div className="space-y-1.5">
                {fullStatusBreakdown.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No tasks yet.</p>
                ) : fullStatusBreakdown.map((s, i) => {
                  const barPct = allTasksInList.length > 0 ? Math.round((s.count / allTasksInList.length) * 100) : 0;
                  const color = s.excluded ? "#64748b" : STATUS_COLORS[i % STATUS_COLORS.length];
                  return (
                    <div key={s.id}
                      onClick={() => !s.excluded && setStatusFilter(prev => prev === s.id ? null : s.id)}
                      className={`rounded-lg px-3 py-2 ${s.excluded ? "opacity-50" : "cursor-pointer hover:brightness-110 transition-all"} ${statusFilter === s.id ? "ring-1 ring-white/30" : ""}`}
                      style={{ background: `${color}18`, border: `1px solid ${color}44` }}>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                        <span className="text-xs font-medium text-foreground flex-1 truncate">{s.label}</span>
                        {s.excluded && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const next = { ...settings, completedStatusIds: settings.completedStatusIds.filter(x => x !== s.id) };
                              setSettings(next);
                              if (workspaceId) {
                                await saveOutstandingRepairsSettings(workspaceId, next);
                                toast({ title: `"${s.label}" is no longer excluded`, description: "Jobs with this status are now counted as outstanding." });
                              }
                            }}
                            title="This status is marked as Collected — click to unmark and include these jobs in the total"
                            className="text-[10px] text-red-300 bg-red-950/60 border border-red-700 px-1.5 py-0.5 rounded font-semibold hover:bg-red-800 transition-colors flex items-center gap-1"
                          >
                            ✕ EXCLUDED — click to unmark
                          </button>
                        )}
                        <span className="text-xs text-muted-foreground">{s.count} job{s.count !== 1 ? "s" : ""}</span>
                        <span className="text-xs font-bold" style={{ color: s.excluded ? "#64748b" : color }}>{fmtR(s.value)}</span>
                      </div>
                      <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, background: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {fullStatusBreakdown.length > 0 && (
                <div className="mt-3 pt-2 border-t border-border flex justify-between text-xs">
                  <span className="text-muted-foreground">Outstanding total</span>
                  <span className="font-bold text-orange-400">{fmtR(totalValue)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Job list */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">

            {/* Filter tabs + search bar */}
            <div className="px-4 pt-3 border-b border-border">
              <div className="flex items-center gap-1.5 flex-wrap pb-2">
                {FILTER_TABS.map(ft => {
                  const count =
                    ft.id === "all"      ? outstandingTasks.length :
                    ft.id === "no_price" ? noPriceTasks.length :
                    ageBucketStats.find(b => b.id === ft.id)?.count ?? 0;
                  return (
                    <button
                      key={ft.id}
                      onClick={() => { setFilter(ft.id); setStatusFilter(null); }}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                        filter === ft.id
                          ? "bg-muted text-foreground shadow"
                          : `${ft.color} bg-muted/50 hover:bg-muted`
                      }`}
                    >
                      {ft.label}
                      <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${
                        filter === ft.id ? "bg-white/20" : "bg-muted"
                      }`}>{count}</span>
                    </button>
                  );
                })}
                {statusFilter && (
                  <button
                    onClick={() => setStatusFilter(null)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-indigo-700 text-white font-medium">
                    Status: {getStatusLabel(statusFilter)}
                    <X className="h-3 w-3" />
                  </button>
                )}
                <div className="flex-1" />
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search…"
                    className="pl-8 h-7 text-xs bg-card border-border text-foreground placeholder-muted-foreground w-36"
                  />
                </div>
              </div>
            </div>

            {filteredTasks.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">No jobs match this filter.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                    <th className="text-left px-4 py-2">
                      <button onClick={() => toggleSortCol("title")} className="hover:text-foreground">Job <SortIcon col="title" /></button>
                      {onOpenTask && <span className="text-[10px] text-muted-foreground/50 font-normal ml-1 normal-case">· click row to open</span>}
                    </th>
                    <th className="text-left px-4 py-2 hidden sm:table-cell">
                      <button onClick={() => toggleSortCol("status")} className="hover:text-foreground">Status <SortIcon col="status" /></button>
                    </th>
                    <th className="text-left px-4 py-2 hidden md:table-cell">
                      <button onClick={() => toggleSortCol("age")} className="hover:text-foreground">Age <SortIcon col="age" /></button>
                    </th>
                    <th className="text-right px-4 py-2">
                      <button onClick={() => toggleSortCol("value")} className="hover:text-foreground">
                        {valueField?.name ?? "Value"} <SortIcon col="value" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map(task => {
                    const val      = getTaskValue(task);
                    const ms       = ageMs(task);
                    const bucket   = ageBucket(ms);
                    const ageColor = AGE_COLORS[bucket];
                    const statusIdx = statusBreakdown.findIndex(s => s.id === task.status);
                    return (
                      <tr key={task.id}
                        onClick={() => onOpenTask?.(task)}
                        className={`border-b border-border/50 ${onOpenTask ? 'cursor-pointer' : ''} hover:bg-muted/30 ${val === 0 ? "bg-red-950/10" : ""}`}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {val === 0 && <span title="No price set" className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
                            <div>
                              <div className="font-medium text-foreground truncate max-w-[180px]" title={task.title}>{task.title}</div>
                              {task.jobNumber && <div className="text-xs text-muted-foreground">{task.jobNumber}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 hidden sm:table-cell">
                          <Badge
                            variant="outline"
                            className="text-xs border-border"
                            style={{
                              color: STATUS_COLORS[statusIdx >= 0 ? statusIdx % STATUS_COLORS.length : 0],
                              borderColor: STATUS_COLORS[statusIdx >= 0 ? statusIdx % STATUS_COLORS.length : 0] + "55",
                            }}
                          >
                            {getStatusLabel(task.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 hidden md:table-cell">
                          <span className="text-xs font-medium" style={{ color: ageColor }}>{fmtAge(ms)}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {val > 0
                            ? <span className="font-semibold text-orange-400">{fmtR(val)}</span>
                            : <span className="text-xs text-red-400 font-medium">No price</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 text-xs">
                    <td className="px-4 py-2 text-muted-foreground" colSpan={2}>
                      {filteredTasks.length} job{filteredTasks.length !== 1 ? "s" : ""} shown
                    </td>
                    <td className="hidden md:table-cell" />
                    <td className="px-4 py-2 text-right font-bold text-orange-400">
                      {fmtR(filteredTasks.reduce((s, t) => s + getTaskValue(t), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════════ SETTINGS ══════════════ */}
      {tab === "settings" && (
        <div className="flex-1 overflow-auto p-4 max-w-xl space-y-6">
          <div className="bg-card border border-border rounded-xl p-4 space-y-4">
            <h2 className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-orange-400" /> Data Mapping
            </h2>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">List to monitor</Label>
              <Select
                value={settings.listId || "__none__"}
                onValueChange={v => setSettings(s => ({ ...s, listId: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger className="bg-card border-border text-foreground">
                  <SelectValue placeholder="Select a list…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Select list —</SelectItem>
                  {workspace.lists.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Only tasks from this list are included.</p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Value / price field</Label>
              <Select
                value={settings.valueFieldId || "__none__"}
                onValueChange={v => setSettings(s => ({ ...s, valueFieldId: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger className="bg-card border-border text-foreground">
                  <SelectValue placeholder="Select a field…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Select field —</SelectItem>
                  {workspace.customFields
                    .filter(f => f.type === "number" || f.type === "currency" || f.type === "text")
                    .map(f => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name} <span className="text-muted-foreground text-xs">({f.type})</span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Jobs with no value in this field are flagged as needing a price.</p>
            </div>
          </div>

          {settings.listId && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <h2 className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-400" /> Completed / Collected Statuses
              </h2>
              <p className="text-xs text-muted-foreground">
                Check statuses that mean a job is <strong className="text-foreground/80">collected / closed</strong> — these are excluded from the outstanding total.
              </p>
              {listStatuses.length === 0 ? (
                <p className="text-xs text-muted-foreground/50 italic">No statuses found for this list.</p>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {listStatuses.map(s => {
                    const checked = settings.completedStatusIds.includes(s.id);
                    const tasksInStatus = allTasksInList.filter(t => t.status === s.id);
                    const statusValue = tasksInStatus.reduce((acc, t) => acc + getTaskValue(t), 0);
                    return (
                      <label
                        key={s.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                          checked
                            ? "bg-green-900/30 border-green-700 text-green-300"
                            : "bg-muted/50 border-border text-foreground/80 hover:bg-muted"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSettings(s2 => {
                            const arr = s2.completedStatusIds;
                            return { ...s2, completedStatusIds: arr.includes(s.id) ? arr.filter(x => x !== s.id) : [...arr, s.id] };
                          })}
                          className="accent-green-500"
                        />
                        <span className="text-sm flex-1">{s.label}</span>
                        <span className="text-xs text-muted-foreground">{tasksInStatus.length} jobs</span>
                        {statusValue > 0 && (
                          <span className="text-xs font-medium text-orange-400">{fmtR(statusValue)}</span>
                        )}
                        {checked && <span className="text-xs text-green-500 font-semibold">EXCLUDED</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <Button
            onClick={handleSave}
            disabled={saving || !settings.listId || !settings.valueFieldId}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white"
          >
            {saving ? "Saving…" : "Save Settings"}
          </Button>
        </div>
      )}
    </div>
  );
}
