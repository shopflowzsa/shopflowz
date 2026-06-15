import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft, Calendar, User, RefreshCw, Download, Search, Filter,
  LogIn, LogOut, Plus, CheckCircle2, Edit3, MessageSquare, FileText,
  DollarSign, Package, UserPlus, UserMinus, ArrowRightLeft, Receipt,
  Clock, Shield, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityRecord, ActivityType, getWorkspaceActivities } from "@/lib/activityTrackingService";
import { useAuth } from "@/contexts/AuthContext";
import { format, startOfDay, endOfDay } from "date-fns";

interface Props {
  onClose: () => void;
}

type ActionFilter = ActivityType | "all";

const ACTION_META: Record<ActivityType, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  user_logged_in:      { label: "Logged In",        color: "text-emerald-400", bg: "bg-emerald-400/10", icon: <LogIn className="h-3.5 w-3.5" /> },
  user_logged_out:     { label: "Logged Out",        color: "text-slate-400",   bg: "bg-slate-400/10",   icon: <LogOut className="h-3.5 w-3.5" /> },
  task_created:        { label: "Task Created",      color: "text-indigo-400",  bg: "bg-indigo-400/10",  icon: <Plus className="h-3.5 w-3.5" /> },
  task_updated:        { label: "Task Updated",      color: "text-blue-400",    bg: "bg-blue-400/10",    icon: <Edit3 className="h-3.5 w-3.5" /> },
  task_completed:      { label: "Task Completed",    color: "text-green-400",   bg: "bg-green-400/10",   icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  task_status_changed: { label: "Status Changed",    color: "text-violet-400",  bg: "bg-violet-400/10",  icon: <ArrowRightLeft className="h-3.5 w-3.5" /> },
  comment_added:       { label: "Comment Added",     color: "text-gray-400",    bg: "bg-gray-400/10",    icon: <MessageSquare className="h-3.5 w-3.5" /> },
  invoice_created:     { label: "Invoice Created",   color: "text-rose-400",    bg: "bg-rose-400/10",    icon: <Receipt className="h-3.5 w-3.5" /> },
  invoice_updated:     { label: "Invoice Updated",   color: "text-orange-400",  bg: "bg-orange-400/10",  icon: <Edit3 className="h-3.5 w-3.5" /> },
  invoice_paid:        { label: "Invoice Paid",      color: "text-green-500",   bg: "bg-green-500/10",   icon: <DollarSign className="h-3.5 w-3.5" /> },
  payment_recorded:    { label: "Payment Recorded",  color: "text-teal-400",    bg: "bg-teal-400/10",    icon: <DollarSign className="h-3.5 w-3.5" /> },
  quote_created:       { label: "Quote Created",     color: "text-cyan-400",    bg: "bg-cyan-400/10",    icon: <FileText className="h-3.5 w-3.5" /> },
  quote_updated:       { label: "Quote Updated",     color: "text-sky-400",     bg: "bg-sky-400/10",     icon: <Edit3 className="h-3.5 w-3.5" /> },
  quote_approved:      { label: "Quote Approved",    color: "text-teal-400",    bg: "bg-teal-400/10",    icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  quote_status_changed:{ label: "Quote Status",      color: "text-sky-400",     bg: "bg-sky-400/10",     icon: <ArrowRightLeft className="h-3.5 w-3.5" /> },
  inventory_updated:   { label: "Inventory Updated", color: "text-pink-400",    bg: "bg-pink-400/10",    icon: <Package className="h-3.5 w-3.5" /> },
  customer_created:    { label: "Customer Created",  color: "text-teal-400",    bg: "bg-teal-400/10",    icon: <UserPlus className="h-3.5 w-3.5" /> },
  customer_updated:    { label: "Customer Updated",  color: "text-teal-300",    bg: "bg-teal-300/10",    icon: <Edit3 className="h-3.5 w-3.5" /> },
  customer_deleted:    { label: "Customer Deleted",  color: "text-red-400",     bg: "bg-red-400/10",     icon: <UserMinus className="h-3.5 w-3.5" /> },
  form_submitted:      { label: "Form Submitted",    color: "text-amber-400",   bg: "bg-amber-400/10",   icon: <FileText className="h-3.5 w-3.5" /> },
};

function getMeta(type: ActivityType) {
  return ACTION_META[type] ?? { label: type.replace(/_/g, " "), color: "text-muted-foreground", bg: "bg-muted", icon: <Clock className="h-3.5 w-3.5" /> };
}

function ActionBadge({ type }: { type: ActivityType }) {
  const m = getMeta(type);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${m.color} ${m.bg}`}>
      {m.icon}
      {m.label}
    </span>
  );
}

interface StaffSummary {
  userId: string;
  name: string;
  total: number;
  tasksCreated: number;
  tasksCompleted: number;
  loggedIn: boolean;
  loginTime?: string;
}

export function AuditLogPage({ onClose }: Props) {
  const { workspaceId, members } = useAuth();

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [staffFilter, setStaffFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [search, setSearch] = useState("");
  const [expandedStaff, setExpandedStaff] = useState<Set<string>>(new Set());

  const load = useCallback(async (showRefreshing = false) => {
    if (!workspaceId) return;
    if (showRefreshing) setRefreshing(true); else setLoading(true);
    const day = new Date(selectedDate + "T00:00:00");
    const start = startOfDay(day).toISOString();
    const end = endOfDay(day).toISOString();
    const data = await getWorkspaceActivities(workspaceId, start, end, undefined, 1000);
    setRecords(data);
    if (showRefreshing) setRefreshing(false); else setLoading(false);
  }, [workspaceId, selectedDate]);

  useEffect(() => { load(); }, [load]);

  // Build per-staff summaries
  const staffSummaries: StaffSummary[] = (() => {
    const map = new Map<string, StaffSummary>();
    for (const r of records) {
      if (!map.has(r.userId)) {
        map.set(r.userId, {
          userId: r.userId,
          name: r.userName,
          total: 0,
          tasksCreated: 0,
          tasksCompleted: 0,
          loggedIn: false,
        });
      }
      const s = map.get(r.userId)!;
      s.total++;
      if (r.activityType === "task_created") s.tasksCreated++;
      if (r.activityType === "task_completed") s.tasksCompleted++;
      if (r.activityType === "user_logged_in") {
        s.loggedIn = true;
        if (!s.loginTime || r.activityDate < s.loginTime) s.loginTime = r.activityDate;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  })();

  // Filter records
  const filtered = records.filter(r => {
    if (staffFilter !== "all" && r.userId !== staffFilter) return false;
    if (actionFilter !== "all" && r.activityType !== actionFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        r.userName.toLowerCase().includes(q) ||
        (r.entityTitle ?? "").toLowerCase().includes(q) ||
        getMeta(r.activityType).label.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group by staff for the grouped view
  const groupedByStaff = filtered.reduce((acc, r) => {
    if (!acc[r.userId]) acc[r.userId] = { name: r.userName, items: [] };
    acc[r.userId].items.push(r);
    return acc;
  }, {} as Record<string, { name: string; items: ActivityRecord[] }>);

  const toggleStaff = (uid: string) => {
    setExpandedStaff(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  function exportCsv() {
    const rows = [
      ["Time", "Staff", "Action", "Item", "Entity Type", "Entity ID"],
      ...filtered.map(r => [
        format(new Date(r.activityDate), "HH:mm:ss"),
        r.userName,
        getMeta(r.activityType).label,
        r.entityTitle ?? "",
        r.entityType,
        r.entityId ?? "",
      ]),
    ];
    const csv = rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isToday = selectedDate === todayStr;

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-card border-b border-border shrink-0">
        <Button variant="ghost" size="icon" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Shield className="h-5 w-5 text-indigo-400" />
        <span className="text-lg font-semibold text-foreground">Staff Audit Log</span>
        {isToday && (
          <Badge className="ml-1 bg-green-500/20 text-green-400 border-green-500/30 text-xs">Live — Today</Badge>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Date picker */}
          <div className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={selectedDate}
              max={todayStr}
              onChange={e => setSelectedDate(e.target.value)}
              className="h-8 px-2 text-sm bg-card border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => load(true)}
            disabled={refreshing}
            className="text-muted-foreground hover:text-foreground"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            className="gap-1.5 border-border text-muted-foreground hover:text-foreground"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 text-indigo-400 animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {/* Staff Summary Cards */}
          {staffSummaries.length > 0 && (
            <div className="px-6 pt-5 pb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Staff Activity — {format(new Date(selectedDate + "T12:00:00"), "EEEE, d MMMM yyyy")}
              </p>
              <div className="flex flex-wrap gap-3">
                {staffSummaries.map(s => (
                  <Card
                    key={s.userId}
                    className={`bg-card border-border cursor-pointer hover:border-indigo-400/40 transition-colors min-w-[180px] ${staffFilter === s.userId ? "border-indigo-400/60" : ""}`}
                    onClick={() => setStaffFilter(staffFilter === s.userId ? "all" : s.userId)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="h-7 w-7 rounded-full bg-indigo-400/20 flex items-center justify-center text-indigo-400 text-xs font-bold shrink-0">
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-foreground truncate">{s.name}</span>
                        {s.loggedIn && (
                          <span className="ml-auto text-emerald-400" title={`First login: ${s.loginTime ? format(new Date(s.loginTime), "HH:mm") : ""}`}>
                            <LogIn className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-center">
                        <div>
                          <div className="text-lg font-bold text-foreground">{s.total}</div>
                          <div className="text-[10px] text-muted-foreground">Actions</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-indigo-400">{s.tasksCreated}</div>
                          <div className="text-[10px] text-muted-foreground">Created</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-green-400">{s.tasksCompleted}</div>
                          <div className="text-[10px] text-muted-foreground">Done</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="px-6 pb-3 flex flex-wrap gap-2 items-center border-b border-border">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Filter className="h-4 w-4" />
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 pl-7 w-44 bg-card border-border text-sm"
              />
            </div>

            <Select value={staffFilter} onValueChange={setStaffFilter}>
              <SelectTrigger className="h-8 w-44 bg-card border-border text-sm">
                <User className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                <SelectValue placeholder="All staff" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Staff</SelectItem>
                {members.map(m => (
                  <SelectItem key={m.uid} value={m.uid}>{m.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={actionFilter} onValueChange={v => setActionFilter(v as ActionFilter)}>
              <SelectTrigger className="h-8 w-48 bg-card border-border text-sm">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {(Object.keys(ACTION_META) as ActivityType[]).map(type => (
                  <SelectItem key={type} value={type}>{ACTION_META[type].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="ml-auto text-xs text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
            </span>
          </div>

          {/* Log Table */}
          <div className="px-6 py-4">
            {filtered.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">
                <Shield className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-lg">No activity recorded</p>
                <p className="text-sm mt-1">
                  {records.length === 0
                    ? "No staff activity was logged for this date."
                    : "No results match your current filters."}
                </p>
              </div>
            ) : staffFilter === "all" && actionFilter === "all" && !search ? (
              /* Grouped by staff */
              <div className="space-y-4">
                {Object.entries(groupedByStaff).map(([uid, group]) => {
                  const isExpanded = expandedStaff.has(uid);
                  const shown = isExpanded ? group.items : group.items.slice(0, 5);
                  return (
                    <div key={uid} className="rounded-lg border border-border overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-2.5 bg-card/50">
                        <div className="h-6 w-6 rounded-full bg-indigo-400/20 flex items-center justify-center text-indigo-400 text-xs font-bold shrink-0">
                          {group.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-semibold text-foreground">{group.name}</span>
                        <Badge variant="secondary" className="text-xs ml-1">{group.items.length} actions</Badge>
                        <button
                          className="ml-auto text-muted-foreground hover:text-foreground"
                          onClick={() => toggleStaff(uid)}
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </div>
                      <div className="divide-y divide-border">
                        {shown.map(r => (
                          <LogRow key={r.id} record={r} />
                        ))}
                        {!isExpanded && group.items.length > 5 && (
                          <button
                            onClick={() => toggleStaff(uid)}
                            className="w-full px-4 py-2 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-indigo-400/5 transition-colors text-left"
                          >
                            Show {group.items.length - 5} more actions…
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Flat list when filtering */
              <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
                {filtered.map(r => <LogRow key={r.id} record={r} showUser />)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LogRow({ record, showUser }: { record: ActivityRecord; showUser?: boolean }) {
  const timeStr = format(new Date(record.activityDate), "HH:mm");
  const m = getMeta(record.activityType);
  const detail = buildDetail(record);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-card/40 transition-colors">
      <span className="text-xs text-muted-foreground font-mono w-11 shrink-0">{timeStr}</span>
      {showUser && (
        <span className="text-xs font-medium text-foreground w-28 truncate shrink-0">{record.userName}</span>
      )}
      <ActionBadge type={record.activityType} />
      {record.entityTitle ? (
        <span className="text-sm text-foreground truncate flex-1">"{record.entityTitle}"</span>
      ) : (
        <span className="flex-1" />
      )}
      {detail && (
        <span className="text-xs text-muted-foreground truncate max-w-[200px] shrink-0">{detail}</span>
      )}
    </div>
  );
}

function buildDetail(record: ActivityRecord): string {
  const m = record.metadata ?? {};
  if (record.activityType === "task_status_changed") {
    if (m.oldStatus && m.newStatus) return `${m.oldStatus} → ${m.newStatus}`;
  }
  if (record.activityType === "user_logged_in" && m.email) return m.email;
  if (record.activityType === "invoice_paid" && m.amount) return `R${m.amount}`;
  if (record.activityType === "payment_recorded" && m.amount) return `R${m.amount}`;
  if (record.activityType === "comment_added" && m.taskTitle) return `on "${m.taskTitle}"`;
  if (record.activityType === "customer_deleted" && m.customerName) return m.customerName;
  return "";
}
