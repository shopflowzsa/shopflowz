import { Fragment, useMemo, useState, useEffect } from "react";
import {
  ArrowLeft, Users, CheckCircle, AlertTriangle,
  Clock, UserX, ChevronDown, ChevronUp, X, ExternalLink,
  Trophy, Flame, Layers, Zap, Timer, TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import type { WorkspaceState, Task } from "@/types/crm";
import {
  BarChart, Bar,
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";
import { startOfWeek, isAfter, isBefore, parseISO, differenceInDays, format } from "date-fns";

interface Props {
  onClose: () => void;
  workspace: WorkspaceState;
  onOpenTask?: (taskId: string) => void;
}

const DONE_STATUSES = new Set(["done", "complete", "invoiced", "paid", "completed"]);
const ACTIVE_STATUSES = new Set(["to_do", "in_progress", "review", "quoted"]);

const STATUS_COLORS: Record<string, string> = {
  to_do: "#94a3b8",
  in_progress: "#38bdf8",
  review: "#f59e0b",
  quoted: "#a78bfa",
  done: "#22c55e",
  complete: "#16a34a",
  invoiced: "#06b6d4",
  paid: "#0ea5e9",
};

const STATUS_LABELS: Record<string, string> = {
  to_do: "To Do",
  in_progress: "In Progress",
  review: "Review",
  quoted: "Quoted",
  done: "Done",
  complete: "Complete",
  invoiced: "Invoiced",
  paid: "Paid",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#ef4444",
  high: "#f97316",
  normal: "#6366f1",
  low: "#94a3b8",
};

const BAR_COLORS = {
  overdue: "#ef4444",
  in_progress: "#38bdf8",
  to_do: "#94a3b8",
  review: "#f59e0b",
  done_week: "#22c55e",
};

const MEMBER_COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#10b981", "#e11d48", "#0284c7",
];

function KpiCard({
  title, value, sub, icon, color = "", alert = false,
}: {
  title: string; value: string | number; sub?: string;
  icon: React.ReactNode; color?: string; alert?: boolean;
}) {
  return (
    <div className={`bg-card border rounded-xl p-4 flex flex-col gap-2 ${alert ? "border-red-500/50" : "border-border"}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">{title}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function getMemberName(uid: string, members: ReturnType<typeof useAuth>["members"]): string {
  const m = members?.find(m => m.uid === uid);
  if (m) return m.displayName || m.email?.split("@")[0] || uid;
  return uid;
}

function getTaskAssignees(task: Task): string[] {
  if (task.assignees && task.assignees.length > 0) return task.assignees;
  if (task.assignee) return [task.assignee];
  return [];
}

function getInitials(name: string): string {
  return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

// ── Assessment helpers ─────────────────────────────────────────────────────

interface AwardConfig {
  icon: string;
  title: string;
  subtitle: string;
  color: string;
  getValue: (s: ReturnType<typeof buildStats>[number]) => number;
  winner?: 'high' | 'low'; // high = most is "winning", low = least is "winning"
}

function buildStats(staffStats: { uid: string; name: string; overdue: number; inProgress: number; toDo: number; review: number; doneWeek: number; urgent: number; oldestOverdueDays: number }[]) {
  return staffStats;
}

const AWARDS: AwardConfig[] = [
  { icon: "🏆", title: "Star of the Week",   subtitle: "most done this week",           color: "text-yellow-500 bg-yellow-500/10 border-yellow-500/30",  getValue: s => s.doneWeek,           winner: 'high' },
  { icon: "⚡", title: "Most Urgent Focus",  subtitle: "tackling the toughest jobs",    color: "text-orange-500 bg-orange-500/10 border-orange-500/30",  getValue: s => s.urgent + s.overdue, winner: 'high' },
  { icon: "🎯", title: "Needs a Push",       subtitle: "overdue — time to clear them",  color: "text-red-500 bg-red-500/10 border-red-500/30",           getValue: s => s.overdue,            winner: 'high' },
  { icon: "💪", title: "Heavy Lifter",       subtitle: "biggest open workload",         color: "text-blue-500 bg-blue-500/10 border-blue-500/30",        getValue: s => s.toDo + s.review,    winner: 'high' },
  { icon: "🕐", title: "Longest Pending",    subtitle: "oldest job — let's close it",   color: "text-violet-500 bg-violet-500/10 border-violet-500/30",  getValue: s => s.oldestOverdueDays,  winner: 'high' },
];

// Rotating motivational messages shown when someone has the most pending work
const ROTATING_MOTIVATION = [
  "every job you close is a happy customer who comes back — let's get it done!",
  "you've got this — tackle one job at a time and watch the list shrink",
  "customers are counting on you — finishing strong today makes tomorrow easier",
  "great technicians don't just fix devices, they build trust — close that job!",
  "one more job done means one more 5-star review for the team",
  "you're the reason customers choose to come back — keep pushing!",
  "clear that backlog and feel the difference — progress beats perfection",
  "the best feeling is a job marked done — go create that feeling",
  "every repair you complete puts money in everyone's pocket",
  "small steps every hour add up to a big day — what's next on the bench?",
  "the team has your back — let's all finish strong today",
  "customers waiting = opportunity to impress — go make their day",
  "your skills are what keep this shop running — use them!",
  "done is better than perfect — get it closed and move forward",
  "each completed job is proof of what you're capable of",
];

interface BarRowData { name: string; value: number; i: number }

function AssessmentBars({ title, icon, data, unit, barColor, emptyMsg }: {
  title: string; icon: React.ReactNode; data: BarRowData[];
  unit: string; barColor: string; emptyMsg?: string;
}) {
  const active = data.filter(d => d.value > 0);
  const max = Math.max(...active.map(d => d.value), 1);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {icon}{title}
      </div>
      {active.length === 0 ? (
        <p className="text-xs text-muted-foreground italic pl-1">{emptyMsg || "None"}</p>
      ) : (
        active.map(d => (
          <div key={d.name} className="space-y-0.5">
            <div className="flex justify-between items-center text-xs">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                  style={{ background: MEMBER_COLORS[d.i % MEMBER_COLORS.length] }}>
                  {getInitials(d.name)}
                </div>
                <span className="font-semibold text-sm truncate max-w-[120px]">{d.name.split(" ")[0]}</span>
              </div>
              <span className="tabular-nums font-bold text-sm text-foreground">{d.value} <span className="font-normal text-muted-foreground text-xs">{unit}</span></span>
            </div>
            <div className="w-full bg-muted rounded-full h-3">
              <div className={`h-3 rounded-full transition-all ${barColor}`} style={{ width: `${(d.value / max) * 100}%` }} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export function StaffDashboardPage({ onClose, workspace, onOpenTask }: Props) {
  const { members } = useAuth();
  const [sortField, setSortField] = useState<"name" | "overdue" | "inProgress" | "doneWeek" | "urgent">("overdue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [motivationIdx, setMotivationIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setMotivationIdx(i => (i + 1) % ROTATING_MOTIVATION.length), 4000);
    return () => clearInterval(t);
  }, []);

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday

  const activeTasks = useMemo(
    () => workspace.tasks.filter(t => !t.archived),
    [workspace.tasks]
  );

  // Resolve all unique staff UIDs across active tasks (include completedBy so recently-done staff appear)
  const allStaffUids = useMemo(() => {
    const seen = new Set<string>();
    for (const t of activeTasks) {
      for (const uid of getTaskAssignees(t)) seen.add(uid);
      if (DONE_STATUSES.has(t.status) && t.completedBy?.length) {
        for (const uid of t.completedBy) seen.add(uid);
      }
    }
    return [...seen];
  }, [activeTasks]);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    let open = 0, overdue = 0, doneWeek = 0, unassigned = 0;
    for (const t of activeTasks) {
      const isDone = DONE_STATUSES.has(t.status);
      const hasAssignee = getTaskAssignees(t).length > 0;
      if (!isDone) {
        open++;
        if (!hasAssignee) unassigned++;
        if (t.dueDate && isBefore(parseISO(t.dueDate), now)) overdue++;
      }
      if (isDone && t.updatedAt && isAfter(parseISO(t.updatedAt), weekStart)) doneWeek++;
    }
    return { open, overdue, doneWeek, unassigned };
  }, [activeTasks, now, weekStart]);


  // ── Per-staff stats ────────────────────────────────────────────────────────
  const staffStats = useMemo(() => {
    const stats: Record<string, {
      uid: string; name: string;
      overdue: number; inProgress: number; toDo: number;
      review: number; doneWeek: number; urgent: number;
      oldestOverdueDays: number; tasks: Task[];
    }> = {};

    const init = (uid: string) => {
      if (!stats[uid]) {
        stats[uid] = {
          uid,
          name: getMemberName(uid, members),
          overdue: 0, inProgress: 0, toDo: 0,
          review: 0, doneWeek: 0, urgent: 0,
          oldestOverdueDays: 0, tasks: [],
        };
      }
    };

    for (const t of activeTasks) {
      const isDone = DONE_STATUSES.has(t.status);
      const currentUids = getTaskAssignees(t);

      if (!isDone) {
        // Open tasks — use current assignees for all live counts
        if (currentUids.length === 0) continue;
        for (const uid of currentUids) {
          init(uid);
          stats[uid].tasks.push(t);
          if (t.status === "in_progress") stats[uid].inProgress++;
          else if (t.status === "review" || t.status === "quoted") stats[uid].review++;
          else stats[uid].toDo++;

          if (t.dueDate && isBefore(parseISO(t.dueDate), now)) {
            stats[uid].overdue++;
            const days = differenceInDays(now, parseISO(t.dueDate));
            if (days > stats[uid].oldestOverdueDays) stats[uid].oldestOverdueDays = days;
          }
          if (t.priority === "urgent") stats[uid].urgent++;
        }
      } else {
        // Done tasks — credit whoever did the work (completedBy > current assignees)
        if (!t.updatedAt || !isAfter(parseISO(t.updatedAt), weekStart)) continue;
        const doneUids = t.completedBy?.length ? t.completedBy : currentUids;
        if (doneUids.length === 0) continue;
        for (const uid of doneUids) {
          init(uid);
          stats[uid].doneWeek++;
        }
      }
    }

    return Object.values(stats);
  }, [activeTasks, members, now, weekStart]);

  // ── Bar chart data ─────────────────────────────────────────────────────────
  const barData = useMemo(
    () =>
      staffStats
        .filter(s => s.inProgress + s.toDo + s.review + s.overdue + s.doneWeek > 0)
        .sort((a, b) => b.overdue - a.overdue)
        .map(s => ({
          name: s.name.split(" ")[0],
          fullName: s.name,
          uid: s.uid,
          Overdue: s.overdue,
          "In Progress": s.inProgress,
          "To Do": s.toDo,
          Review: s.review,
          "Done This Week": s.doneWeek,
        })),
    [staffStats]
  );

  // ── Sorted who's-behind table ──────────────────────────────────────────────
  const sortedStaff = useMemo(() => {
    const arr = [...staffStats].filter(
      s => s.inProgress + s.toDo + s.review + s.overdue + s.doneWeek > 0
    );
    arr.sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortField === "name") return mul * a.name.localeCompare(b.name);
      return mul * (a[sortField] - b[sortField]);
    });
    return arr;
  }, [staffStats, sortField, sortDir]);

  // Tasks for selected staff drill-down (open/active only, sorted by status urgency)
  const drillTasks = useMemo(() => {
    if (!selectedStaff) return [];
    return activeTasks
      .filter(t => getTaskAssignees(t).includes(selectedStaff) && !DONE_STATUSES.has(t.status))
      .sort((a, b) => {
        const urgency: Record<string, number> = { in_progress: 0, review: 1, to_do: 2 };
        return (urgency[a.status] ?? 3) - (urgency[b.status] ?? 3);
      });
  }, [activeTasks, selectedStaff]);

  const drillStaffName = useMemo(() => {
    if (!selectedStaff) return "";
    return getMemberName(selectedStaff, members);
  }, [selectedStaff, members]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const SortIcon = ({ field }: { field: typeof sortField }) =>
    sortField === field
      ? (sortDir === "desc" ? <ChevronDown className="h-3 w-3 ml-0.5" /> : <ChevronUp className="h-3 w-3 ml-0.5" />)
      : null;

  return (
    <div className="h-full bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 rounded hover:bg-accent transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold">Staff Dashboard</h1>
            <p className="text-xs text-muted-foreground">
              Live overview — {format(now, "EEEE, d MMMM yyyy")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Week of {format(weekStart, "d MMM")}
          </Badge>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            title="Open Tasks"
            value={kpis.open}
            sub="not yet completed"
            icon={<Clock className="h-4 w-4" />}
            color="text-foreground"
          />
          <KpiCard
            title="Overdue"
            value={kpis.overdue}
            sub="past due date"
            icon={<AlertTriangle className="h-4 w-4 text-red-400" />}
            color={kpis.overdue > 0 ? "text-red-500" : "text-foreground"}
            alert={kpis.overdue > 0}
          />
          <KpiCard
            title="Completed This Week"
            value={kpis.doneWeek}
            sub={`since ${format(weekStart, "EEE d MMM")}`}
            icon={<CheckCircle className="h-4 w-4 text-green-400" />}
            color="text-green-500"
          />
          <KpiCard
            title="Unassigned"
            value={kpis.unassigned}
            sub="no staff assigned"
            icon={<UserX className="h-4 w-4 text-amber-400" />}
            color={kpis.unassigned > 0 ? "text-amber-500" : "text-foreground"}
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-4">
          {/* Bubble chart — staff task breakdown */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Tasks by Staff Member
            </h2>
            <p className="text-[11px] text-muted-foreground mb-3">Click a column to see that person's tasks</p>
            {barData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                No assigned tasks found
              </div>
            ) : (
              <>
                {/* Legend */}
                <div className="flex flex-wrap gap-3 mb-4">
                  {[
                    { key: "Overdue", color: BAR_COLORS.overdue },
                    { key: "In Progress", color: BAR_COLORS.in_progress },
                    { key: "Review", color: BAR_COLORS.review },
                    { key: "To Do", color: BAR_COLORS.to_do },
                    { key: "Done This Week", color: BAR_COLORS.done_week },
                  ].map(({ key, color }) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                      <span className="text-[11px] text-muted-foreground">{key}</span>
                    </div>
                  ))}
                </div>
                {/* Bubble columns */}
                <div className="flex items-end justify-around gap-2">
                  {barData.map((d) => {
                    const segments = [
                      { key: "Overdue",        count: d["Overdue"],         color: BAR_COLORS.overdue },
                      { key: "In Progress",    count: d["In Progress"],     color: BAR_COLORS.in_progress },
                      { key: "Review",         count: d["Review"],          color: BAR_COLORS.review },
                      { key: "To Do",          count: d["To Do"],           color: BAR_COLORS.to_do },
                      { key: "Done This Week", count: d["Done This Week"],  color: BAR_COLORS.done_week },
                    ];
                    const total = segments.reduce((s, sg) => s + sg.count, 0);
                    const isSelected = selectedStaff === d.uid;
                    return (
                      <button
                        key={d.uid}
                        onClick={() => setSelectedStaff(prev => prev === d.uid ? null : d.uid)}
                        className={`flex flex-col items-center gap-1 flex-1 min-w-0 transition-opacity ${isSelected ? "opacity-100" : "opacity-80 hover:opacity-100"}`}
                      >
                        {/* Stacked balls — bottom to top */}
                        <div className="flex flex-col-reverse items-center gap-1 pb-1">
                          {segments.map(({ key, count, color }) =>
                            Array.from({ length: count }).map((_, i) => (
                              <span
                                key={`${key}-${i}`}
                                title={`${key}: ${count}`}
                                className="block rounded-full shadow-sm flex-shrink-0"
                                style={{
                                  width: 28,
                                  height: 28,
                                  background: color,
                                  boxShadow: isSelected ? `0 0 0 2px white, 0 0 0 3px ${color}` : undefined,
                                }}
                              />
                            ))
                          )}
                        </div>
                        {/* Name + total */}
                        <span className={`text-[11px] font-medium truncate max-w-full ${isSelected ? "text-primary" : "text-muted-foreground"}`}>
                          {d.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{total} open</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Drilldown panel */}
            {selectedStaff && (
              <div className="mt-4 border-t border-border pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">
                    {drillStaffName}'s open tasks
                    <span className="ml-2 text-xs font-normal text-muted-foreground">({drillTasks.length})</span>
                  </h3>
                  <button onClick={() => setSelectedStaff(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {drillTasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No open tasks</p>
                ) : (
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {drillTasks.map(task => {
                      const listName = workspace.lists.find(l => l.id === task.listId)?.name ?? task.listId;
                      return (
                        <button
                          key={task.id}
                          onClick={() => onOpenTask?.(task.id)}
                          className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-accent text-left transition-colors group"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-mono font-bold text-primary shrink-0">
                              {task.jobNumber || task.id.slice(0, 8)}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">{listName}</span>
                          </div>
                          <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Staff Assessment — full width */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-base font-bold mb-4 flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" /> Staff Assessment
          </h2>

          {staffStats.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No staff data yet</p>
          ) : (
            <>
              {/* Award badges */}
              <div className="flex flex-wrap gap-2 mb-4">
                {AWARDS.map(award => {
                  const sorted = [...staffStats].sort((a, b) => award.getValue(b) - award.getValue(a));
                  const top = sorted[0];
                  if (!top || award.getValue(top) === 0) return null;
                  const isNegative = award.title !== "Top Dog";
                  return (
                    <div key={award.title} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-semibold ${award.color}`}>
                      <span className="text-base">{award.icon}</span>
                      <span>{award.title}:</span>
                      <span className="font-extrabold">{top.name.split(" ")[0]}</span>
                      <span className="font-normal opacity-70 text-xs">({award.getValue(top)} {award.subtitle.split(" ")[0]})</span>
                    </div>
                  );
                })}
              </div>

              {/* Rotating motivational nudge for whoever has the most pending work */}
              {(() => {
                const mostPending = [...staffStats].sort((a, b) =>
                  (b.overdue + b.toDo + b.urgent) - (a.overdue + a.toDo + a.urgent)
                )[0];
                if (!mostPending || (mostPending.overdue + mostPending.toDo + mostPending.urgent) === 0) return null;
                return (
                  <div className="mb-6 px-4 py-3 rounded-xl border border-amber-400/30 bg-amber-400/5 flex items-start gap-2">
                    <span className="text-lg shrink-0">💬</span>
                    <div>
                      <span className="text-xs font-bold text-amber-600 uppercase tracking-wide">{mostPending.name.split(" ")[0]}: </span>
                      <span
                        key={motivationIdx}
                        className="text-xs text-amber-700 italic font-medium animate-in fade-in duration-500"
                      >
                        {ROTATING_MOTIVATION[motivationIdx]}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Three bar charts side by side */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <AssessmentBars
                  title="Done This Week"
                  icon={<Trophy className="h-3.5 w-3.5 text-yellow-500" />}
                  data={[...staffStats].sort((a, b) => b.doneWeek - a.doneWeek).map(s => ({ name: s.name, value: s.doneWeek, i: staffStats.indexOf(s) }))}
                  unit="tasks"
                  barColor="bg-green-500"
                  emptyMsg="Nothing closed yet this week — let's change that!"
                />
                <AssessmentBars
                  title="Overdue — Needs Attention"
                  icon={<TrendingDown className="h-3.5 w-3.5 text-red-500" />}
                  data={[...staffStats].sort((a, b) => b.overdue - a.overdue).map(s => ({ name: s.name, value: s.overdue, i: staffStats.indexOf(s) }))}
                  unit="tasks"
                  barColor="bg-red-500"
                  emptyMsg="No one overdue 🎉"
                />
                <AssessmentBars
                  title="Open Workload"
                  icon={<Layers className="h-3.5 w-3.5 text-blue-500" />}
                  data={[...staffStats].sort((a, b) => (b.inProgress + b.toDo + b.review) - (a.inProgress + a.toDo + a.review)).map(s => ({ name: s.name, value: s.inProgress + s.toDo + s.review, i: staffStats.indexOf(s) }))}
                  unit="open"
                  barColor="bg-blue-500"
                  emptyMsg="No open tasks"
                />
              </div>
            </>
          )}
        </div>

        {/* Who's Behind table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold">Team Workload Overview</h2>
            <span className="text-xs text-muted-foreground ml-auto">Click a name to drill down into tasks</span>
          </div>
          {sortedStaff.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No assigned staff found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => handleSort("name")}>
                        Staff <SortIcon field="name" />
                      </button>
                    </th>
                    <th className="text-center px-4 py-2 font-medium">
                      <button className="flex items-center gap-1 hover:text-foreground mx-auto text-red-400" onClick={() => handleSort("overdue")}>
                        Overdue <SortIcon field="overdue" />
                      </button>
                    </th>
                    <th className="text-center px-4 py-2 font-medium text-muted-foreground">
                      <button className="flex items-center gap-1 hover:text-foreground mx-auto" onClick={() => handleSort("inProgress")}>
                        In Progress <SortIcon field="inProgress" />
                      </button>
                    </th>
                    <th className="text-center px-4 py-2 font-medium text-muted-foreground">
                      <button className="flex items-center gap-1 hover:text-foreground mx-auto" onClick={() => handleSort("urgent")}>
                        Urgent <SortIcon field="urgent" />
                      </button>
                    </th>
                    <th className="text-center px-4 py-2 font-medium text-green-500">
                      <button className="flex items-center gap-1 hover:text-green-400 mx-auto" onClick={() => handleSort("doneWeek")}>
                        Done This Week <SortIcon field="doneWeek" />
                      </button>
                    </th>
                    <th className="text-center px-4 py-2 font-medium text-muted-foreground">Oldest Overdue</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {sortedStaff.map((s, i) => {
                    const isExpanded = selectedStaff === s.uid;
                    return (
                      <Fragment key={s.uid}>
                        <tr
                          className={`border-b border-border cursor-pointer transition-colors select-none
                            ${isExpanded ? "bg-accent/60" : "hover:bg-muted/30"}
                            ${s.overdue > 0 ? "border-l-2 border-l-red-500" : ""}
                          `}
                          onClick={() => setSelectedStaff(isExpanded ? null : s.uid)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div
                                className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                                style={{ background: MEMBER_COLORS[i % MEMBER_COLORS.length] }}
                              >
                                {getInitials(s.name)}
                              </div>
                              <span className="font-medium">{s.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {s.overdue > 0 ? (
                              <Badge variant="destructive" className="text-xs tabular-nums">{s.overdue}</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`tabular-nums font-medium ${s.inProgress > 0 ? "text-sky-400" : "text-muted-foreground"}`}>
                              {s.inProgress || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {s.urgent > 0 ? (
                              <Badge className="text-xs tabular-nums bg-red-500/20 text-red-400 border-0">{s.urgent}</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`tabular-nums font-medium ${s.doneWeek > 0 ? "text-green-500" : "text-muted-foreground"}`}>
                              {s.doneWeek || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center text-xs text-muted-foreground">
                            {s.oldestOverdueDays > 0 ? (
                              <span className="text-red-400 font-medium">{s.oldestOverdueDays}d ago</span>
                            ) : "—"}
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {isExpanded
                              ? <ChevronUp className="h-4 w-4" />
                              : <ChevronDown className="h-4 w-4" />}
                          </td>
                        </tr>
                        {/* Drill-down row */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={7} className="bg-muted/20 border-b border-border px-4 py-3">
                              {drillTasks.length === 0 ? (
                                <p className="text-xs text-muted-foreground py-1">No open tasks for {s.name}.</p>
                              ) : (
                                <div className="space-y-1.5">
                                  <p className="text-xs text-muted-foreground font-medium mb-2">
                                    Open tasks for {s.name} — {drillTasks.length} total
                                  </p>
                                  {drillTasks.map(t => {
                                    const isOverdue = t.dueDate && isBefore(parseISO(t.dueDate), now);
                                    return (
                                      <div
                                        key={t.id}
                                        className="flex items-center gap-2 text-xs p-2 rounded-lg bg-card border border-border cursor-pointer hover:bg-accent transition-colors group"
                                        onClick={(e) => { e.stopPropagation(); onOpenTask?.(t.id); }}
                                      >
                                        <div
                                          className="h-2 w-2 rounded-full flex-shrink-0"
                                          style={{ background: STATUS_COLORS[t.status] || "#6b7280" }}
                                        />
                                        <span className={`flex-1 truncate font-medium ${isOverdue ? "text-red-400" : ""}`}>
                                          {t.jobNumber ? `#${t.jobNumber} — ` : ""}{t.title}
                                        </span>
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                          {t.priority === "urgent" && (
                                            <Badge variant="destructive" className="text-[10px] px-1 py-0">Urgent</Badge>
                                          )}
                                          {t.dueDate && (
                                            <span className={isOverdue ? "text-red-400" : "text-muted-foreground"}>
                                              {isOverdue
                                                ? `${differenceInDays(now, parseISO(t.dueDate))}d overdue`
                                                : `due ${format(parseISO(t.dueDate), "d MMM")}`
                                              }
                                            </span>
                                          )}
                                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                                            {STATUS_LABELS[t.status] || t.status}
                                          </Badge>
                                          <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Priority breakdown bar */}
        {staffStats.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-4">Open Task Priority by Staff</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={staffStats
                  .filter(s => s.inProgress + s.toDo + s.review + s.overdue > 0)
                  .map(s => {
                    const tasks = activeTasks.filter(
                      t => getTaskAssignees(t).includes(s.uid) && !DONE_STATUSES.has(t.status)
                    );
                    const urgent = tasks.filter(t => t.priority === "urgent").length;
                    const high = tasks.filter(t => t.priority === "high").length;
                    const normal = tasks.filter(t => t.priority === "normal" || !t.priority).length;
                    const low = tasks.filter(t => t.priority === "low").length;
                    return { name: s.name.split(" ")[0], Urgent: urgent, High: high, Normal: normal, Low: low };
                  })}
                margin={{ top: 4, right: 8, bottom: 4, left: -16 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Urgent" stackId="p" fill={PRIORITY_COLORS.urgent} />
                <Bar dataKey="High" stackId="p" fill={PRIORITY_COLORS.high} />
                <Bar dataKey="Normal" stackId="p" fill={PRIORITY_COLORS.normal} />
                <Bar dataKey="Low" stackId="p" fill={PRIORITY_COLORS.low} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

      </div>
    </div>
  );
}
