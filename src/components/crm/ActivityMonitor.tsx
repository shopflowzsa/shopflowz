import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Clock, Plus, Edit, Trash2, RotateCcw,
  Search, RefreshCw, Loader2
} from "lucide-react";
import { Task, WorkspaceState } from "@/types/crm";
import { useAuth } from "@/contexts/AuthContext";

interface ActivityMonitorProps {
  open: boolean;
  onClose: () => void;
  workspace: WorkspaceState;
}

interface AuditEntry {
  id: string;
  taskId: string;
  taskData: Task;
  action: "create" | "update" | "delete" | "restore";
  timestamp: string;
  userId?: string;
  metadata?: {
    previousData?: Partial<Task>;
    reason?: string;
    source?: string;
  };
}

interface TaskAuditRow {
  id: string;
  data: Omit<AuditEntry, "id">;
}

// ─── Diff helpers ────────────────────────────────────────────────────────────

function describeChanges(current: Task, previous: Partial<Task>, workspace: WorkspaceState): string[] {
  const changes: string[] = [];

  if (previous.status !== undefined && previous.status !== current.status) {
    const listStatuses = workspace.lists.find(l => l.id === current.listId)?.customStatuses;
    const label = (id: string) => (listStatuses ?? []).find(s => s.id === id)?.label ?? id;
    changes.push(`Status → "${label(current.status)}"`);
  }

  if (previous.listId !== undefined && previous.listId !== current.listId) {
    const fromList = workspace.lists.find(l => l.id === previous.listId)?.name ?? previous.listId;
    const toList   = workspace.lists.find(l => l.id === current.listId)?.name  ?? current.listId;
    changes.push(`Moved: "${fromList}" → "${toList}"`);
  }

  if (previous.title !== undefined && previous.title !== current.title) {
    changes.push(`Title → "${current.title}"`);
  }

  if (previous.priority !== undefined && previous.priority !== current.priority) {
    changes.push(`Priority → ${current.priority}`);
  }

  if (previous.assignee !== undefined && previous.assignee !== current.assignee) {
    changes.push(`Assignee → ${current.assignee || "unassigned"}`);
  }

  if (previous.dueDate !== undefined && previous.dueDate !== current.dueDate) {
    changes.push(`Due date → ${current.dueDate || "cleared"}`);
  }

  const prevPhotos = (previous.photos ?? []).length;
  const curPhotos  = (current.photos  ?? []).length;
  if (curPhotos > prevPhotos) {
    const n = curPhotos - prevPhotos;
    changes.push(`${n} photo${n > 1 ? "s" : ""} added`);
  }

  const prevComments = (previous.comments ?? []).length;
  const curComments  = (current.comments  ?? []).length;
  if (curComments > prevComments) {
    const n = curComments - prevComments;
    changes.push(`${n} comment${n > 1 ? "s" : ""} added`);
  }

  const prevCfv = previous.customFieldValues ?? [];
  const curCfv  = current.customFieldValues  ?? [];
  const changedFields: string[] = [];
  curCfv.forEach(cv => {
    const old = prevCfv.find(o => o.fieldId === cv.fieldId);
    if (!old || String(old.value) !== String(cv.value)) {
      const def = workspace.customFields.find(f => f.id === cv.fieldId);
      if (def) changedFields.push(def.name);
    }
  });
  if (changedFields.length > 0) changes.push(`Fields: ${changedFields.join(", ")}`);

  return changes;
}

function buildMessage(entry: AuditEntry, workspace: WorkspaceState): { text: string; detail?: string } {
  const task = entry.taskData;
  const label = `${task.jobNumber ? task.jobNumber + " — " : ""}"${task.title}"`;

  switch (entry.action) {
    case "create": {
      const src = entry.metadata?.source;
      const prefix = src === "Form Submission System" ? "📋 Form booked in" : "✅ Task created";
      return { text: `${prefix}: ${label}` };
    }
    case "delete":
      return { text: `🗑️ Deleted: ${label}`, detail: entry.metadata?.reason };
    case "restore":
      return { text: `♻️ Restored: ${label}` };
    case "update": {
      const prev = entry.metadata?.previousData as Partial<Task> | undefined;
      if (prev) {
        const changes = describeChanges(task, prev, workspace);
        if (changes.length > 0) return { text: `✏️ Updated: ${label}`, detail: changes.join(" · ") };
      }
      return { text: `✏️ Updated: ${label}` };
    }
    default:
      return { text: label };
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs  = Math.floor(diff / 1000);
  const mins  = Math.floor(secs  / 60);
  const hours = Math.floor(mins  / 60);
  const days  = Math.floor(hours / 24);
  if (secs  < 60)  return "Just now";
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function actionIcon(action: AuditEntry["action"]) {
  switch (action) {
    case "create":  return <Plus      className="h-3.5 w-3.5" />;
    case "update":  return <Edit      className="h-3.5 w-3.5" />;
    case "delete":  return <Trash2    className="h-3.5 w-3.5" />;
    case "restore": return <RotateCcw className="h-3.5 w-3.5" />;
    default:        return <Clock     className="h-3.5 w-3.5" />;
  }
}

function actionColor(action: AuditEntry["action"]) {
  switch (action) {
    case "create":  return "bg-green-50  text-green-800  border-green-200";
    case "update":  return "bg-blue-50   text-blue-800   border-blue-200";
    case "delete":  return "bg-red-50    text-red-800    border-red-200";
    case "restore": return "bg-amber-50  text-amber-800  border-amber-200";
    default:        return "bg-slate-50  text-slate-700  border-slate-200";
  }
}

const FILTER_OPTIONS = [
  { value: "all",     label: "All" },
  { value: "create",  label: "Created" },
  { value: "update",  label: "Updated" },
  { value: "delete",  label: "Deleted" },
  { value: "restore", label: "Restored" },
] as const;

// ─── Component ───────────────────────────────────────────────────────────────

export function ActivityMonitor({ open, onClose, workspace }: ActivityMonitorProps) {
  const { workspaceId } = useAuth();
  const [entries,   setEntries]   = useState<AuditEntry[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [search,    setSearch]    = useState("");
  const [filter,    setFilter]    = useState<"all" | "create" | "update" | "delete" | "restore">("all");
  const [loadCount, setLoadCount] = useState(60);

  const fetchEntries = useCallback(async (showLoading = false) => {
    if (!workspaceId) return;
    if (showLoading) setLoading(true);
    const { data } = await supabase
      .from("task_audit")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(loadCount);
    setEntries(((data || []) as TaskAuditRow[]).map(r => ({ id: r.id, ...r.data })));
    setLoading(false);
  }, [workspaceId, loadCount]);

  const prependEntry = useCallback((row: TaskAuditRow) => {
    const entry = { id: row.id, ...row.data };
    setEntries(prev => {
      const withoutDuplicate = prev.filter(existing => existing.id !== entry.id);
      return [entry, ...withoutDuplicate].slice(0, loadCount);
    });
  }, [loadCount]);

  // Supabase realtime plus short polling fallback. Realtime can lag on some
  // networks/tabs, so polling keeps the log fresh without waiting a minute.
  useEffect(() => {
    if (!open || !workspaceId) return;

    fetchEntries(true);
    const pollInterval = setInterval(() => fetchEntries(false), 60_000);

    const channel = supabase
      .channel(`task_audit_${workspaceId}_${loadCount}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_audit", filter: `workspace_id=eq.${workspaceId}` }, (payload) => {
        prependEntry(payload.new);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "task_audit", filter: `workspace_id=eq.${workspaceId}` }, () => {
        fetchEntries(false);
      })
      .subscribe();

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [open, workspaceId, loadCount, fetchEntries, prependEntry]);

  const visible = entries.filter(e => {
    if (filter !== "all" && e.action !== filter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (e.taskData?.title ?? "").toLowerCase().includes(q) ||
      (e.taskData?.jobNumber ?? "").toLowerCase().includes(q) ||
      (e.userId ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" /> Activity Log
          </DialogTitle>
          <DialogDescription className="text-xs">
            Live feed of every task event — creates, status changes, moves, deletes, photos, comments.
          </DialogDescription>
        </DialogHeader>

        {/* Controls */}
        <div className="px-5 pb-3 flex flex-col gap-2 border-b shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search job number, title or user…"
              className="pl-8 h-8 text-xs"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1.5 flex-wrap items-center">
            {FILTER_OPTIONS.map(opt => (
              <Button
                key={opt.value}
                variant={filter === opt.value ? "default" : "outline"}
                size="sm"
                className="h-6 px-2.5 text-xs"
                onClick={() => setFilter(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">
              {visible.length} event{visible.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Feed */}
        <ScrollArea className="flex-1 min-h-0 px-5 py-3">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading activity…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Clock className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">{search || filter !== "all" ? "No matching activity" : "No activity recorded yet"}</p>
              <p className="text-xs mt-1 opacity-60">Events will appear here automatically as work happens</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {visible.map(entry => {
                const { text, detail } = buildMessage(entry, workspace);
                return (
                  <div
                    key={entry.id}
                    className={`flex gap-3 p-3 rounded-lg border text-sm ${actionColor(entry.action)}`}
                  >
                    <div className="mt-0.5 shrink-0 opacity-70">{actionIcon(entry.action)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium leading-snug">{text}</span>
                        <span className="text-xs opacity-60 shrink-0 mt-0.5 tabular-nums">
                          {relativeTime(entry.timestamp)}
                        </span>
                      </div>
                      {detail && (
                        <p className="text-xs mt-0.5 opacity-75 leading-snug">{detail}</p>
                      )}
                      {entry.userId && (
                        <p className="text-xs mt-1 opacity-50">by {entry.userId}</p>
                      )}
                    </div>
                  </div>
                );
              })}

              {entries.length >= loadCount && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs mt-2"
                  onClick={() => setLoadCount(c => c + 60)}
                  disabled={loading}
                >
                  {loading
                    ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" /> Loading…</>
                    : <><RefreshCw className="h-3 w-3 mr-1.5" /> Load older entries</>
                  }
                </Button>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
