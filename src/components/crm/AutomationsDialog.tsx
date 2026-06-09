import { useState } from "react";
import { Zap, Plus, Trash2, ChevronDown, Pencil, Play, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Automation, AutomationTriggerType, AutomationActionType,
  List, StatusConfig, DEFAULT_STATUSES, PRIORITIES,
} from "@/types/crm";
import { WorkspaceMember } from "@/types/auth";

// ── Label helpers ─────────────────────────────────────────────────────────────
const TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  task_created:        "Task is created",
  status_changed_to:   "Status changes to…",
  task_moved_here:     "Task is moved to this list",
  task_in_list:        "Task is in list…",
  task_always_in_list: "Task exists in list… (enforced)",
  start_date_overdue:  "Start date is overdue by…",
};
const ACTION_LABELS: Record<AutomationActionType, string> = {
  set_status:      "Set status to…",
  assign_members:  "Assign to members",
  set_priority:    "Set priority to…",
  flag_task:       "Flag task",
  move_to_list:    "Move to list…",
};

function triggerSummary(a: Automation, statuses: StatusConfig[], listName: string, allLists: List[]) {
  switch (a.trigger.type) {
    case "task_created":      return `Task created in "${listName}"`;
    case "task_moved_here":   return `Task moved into "${listName}"`;
    case "status_changed_to": {
      const s = statuses.find(s => s.id === a.trigger.toStatus);
      return `Status → ${s?.label ?? a.trigger.toStatus ?? "?"}`;
    }
    case "task_in_list": {
      const l = allLists.find(l => l.id === a.trigger.targetListId);
      return `Task enters "${l?.name ?? "?"}"`;
    }
    case "task_always_in_list": {
      const l = allLists.find(l => l.id === a.trigger.targetListId);
      return `Always in "${l?.name ?? "?"}" (enforced)`;
    }
    case "start_date_overdue": {
      const days = a.trigger.offsetDays ?? 0;
      const display = days % 30 === 0 ? `${days / 30} month(s)` : days % 7 === 0 ? `${days / 7} week(s)` : `${days} day(s)`;
      const l = allLists.find(l => l.id === a.trigger.targetListId);
      return `Start date ${display} overdue${l ? ` in "${l.name}"` : ''}`;
    }
  }
}
function actionSummary(a: Automation, statuses: StatusConfig[], members: WorkspaceMember[], allLists: List[]) {
  switch (a.action.type) {
    case "set_status": {
      const s = statuses.find(s => s.id === a.action.status);
      return `Set status: ${s?.label ?? a.action.status ?? "?"}`;
    }
    case "assign_members": {
      const names = (a.action.assigneeUids ?? []).map(uid => {
        const m = members.find(m => m.uid === uid);
        return m?.displayName || m?.email || uid;
      });
      return names.length ? `Assign: ${names.join(", ")}` : "Assign (no one set)";
    }
    case "set_priority": {
      const p = PRIORITIES.find(p => p.value === a.action.priority);
      return `Priority: ${p?.label ?? a.action.priority ?? "?"}`;
    }
    case "flag_task":
      return `Flag: ${a.action.flagReason || "(no reason)"}`;
    case "move_to_list": {
      const l = allLists.find(l => l.id === a.action.listId);
      return `Move to list: "${l?.name ?? "not set"}"`;
    }
  }
}

// ── Empty form state ──────────────────────────────────────────────────────────
const EMPTY_TRIGGER = { type: "task_created" as AutomationTriggerType, toStatus: "", targetListId: "", offsetValue: 1, offsetUnit: "days" as "days" | "weeks" | "months" };
const EMPTY_ACTION  = { type: "set_status"   as AutomationActionType,  status: "", assigneeUids: [] as string[], priority: "", flagReason: "", listId: "" };

interface Props {
  list: List;
  allLists: List[];
  members: WorkspaceMember[];
  onSave: (updatedList: List) => void;
  onApplyToExisting: (auto: Automation) => number;
  onClose: () => void;
}

export function AutomationsDialog({ list, allLists, members, onSave, onClose, onApplyToExisting }: Props) {
  const statuses = list.customStatuses?.length ? list.customStatuses : DEFAULT_STATUSES;
  const [appliedCounts, setAppliedCounts] = useState<Record<string, number>>({});
  const [automations, setAutomations] = useState<Automation[]>(list.automations ?? []);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [trigger, setTrigger] = useState({ ...EMPTY_TRIGGER });
  const [action, setAction] = useState({ ...EMPTY_ACTION });
  const [dirty, setDirty] = useState(false);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormName("");
    setTrigger({ ...EMPTY_TRIGGER });
    setAction({ ...EMPTY_ACTION });
  };

  const loadForEdit = (a: Automation) => {
    setEditingId(a.id);
    setFormName(a.name);
    const rawDays = a.trigger.offsetDays ?? 7;
    let offsetValue = rawDays;
    let offsetUnit: "days" | "weeks" | "months" = "days";
    if (rawDays % 30 === 0) { offsetValue = rawDays / 30; offsetUnit = "months"; }
    else if (rawDays % 7 === 0) { offsetValue = rawDays / 7; offsetUnit = "weeks"; }
    setTrigger({ type: a.trigger.type, toStatus: a.trigger.toStatus ?? "", targetListId: a.trigger.targetListId ?? "", offsetValue, offsetUnit });
    setAction({
      type: a.action.type,
      status: a.action.status ?? "",
      assigneeUids: a.action.assigneeUids ?? [],
      priority: a.action.priority ?? "",
      flagReason: a.action.flagReason ?? "",
      listId: a.action.listId ?? "",
    });
    setShowForm(true);
  };

  const handleSaveForm = () => {
    const unitMult = trigger.offsetUnit === "months" ? 30 : trigger.offsetUnit === "weeks" ? 7 : 1;
    const offsetDays = (trigger.offsetValue || 1) * unitMult;
    const built: Automation = {
      id: editingId ?? `auto_${Date.now()}`,
      name: formName || `${TRIGGER_LABELS[trigger.type]} → ${ACTION_LABELS[action.type]}`,
      enabled: editingId ? (automations.find(a => a.id === editingId)?.enabled ?? true) : true,
      trigger: { type: trigger.type, toStatus: trigger.toStatus || undefined, targetListId: trigger.targetListId || undefined, offsetDays: trigger.type === "start_date_overdue" ? offsetDays : undefined },
      action: {
        type: action.type,
        status: action.status || undefined,
        assigneeUids: action.assigneeUids.length ? action.assigneeUids : undefined,
        priority: action.priority || undefined,
        flagReason: action.flagReason || undefined,
        listId: action.listId || undefined,
      },
      createdAt: editingId ? (automations.find(a => a.id === editingId)?.createdAt ?? new Date().toISOString()) : new Date().toISOString(),
    };
    const next = editingId
      ? automations.map(a => a.id === editingId ? built : a)
      : [...automations, built];
    setAutomations(next);
    setDirty(true);
    resetForm();
  };

  const toggleEnabled = (id: string) => {
    const next = automations.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a);
    setAutomations(next);
    setDirty(true);
  };

  const deleteAutomation = (id: string) => {
    const next = automations.filter(a => a.id !== id);
    setAutomations(next);
    setDirty(true);
  };

  const handleClose = () => {
    if (dirty) onSave({ ...list, automations });
    onClose();
  };

  const toggleAssignee = (uid: string) => {
    setAction(prev => ({
      ...prev,
      assigneeUids: prev.assigneeUids.includes(uid)
        ? prev.assigneeUids.filter(id => id !== uid)
        : [...prev.assigneeUids, uid],
    }));
  };

  const formValid = (() => {
    if (trigger.type === "status_changed_to" && !trigger.toStatus) return false;
    if ((trigger.type === "task_in_list" || trigger.type === "task_always_in_list") && !trigger.targetListId) return false;
    if (trigger.type === "start_date_overdue" && (!trigger.offsetValue || trigger.offsetValue < 1)) return false;
    if (action.type === "set_status"   && !action.status)   return false;
    if (action.type === "set_priority" && !action.priority) return false;
    if (action.type === "move_to_list" && !action.listId)   return false;
    if (action.type === "assign_members" && action.assigneeUids.length === 0) return false;
    return true;
  })();

  return (
    <Dialog open onOpenChange={open => { if (!open) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Automations — {list.name}
          </DialogTitle>
        </DialogHeader>

        {/* Existing automations */}
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {automations.length === 0 && !showForm && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No automations yet. Add one to automate repetitive tasks.
            </p>
          )}
          {automations.map(a => (
            <div key={a.id} className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <Switch
                checked={a.enabled}
                onCheckedChange={() => toggleEnabled(a.id)}
                className="mt-0.5 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{a.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  <span className="text-amber-600 font-medium">When</span>{" "}
                  {triggerSummary(a, statuses, list.name, allLists)}
                  <span className="mx-1.5 text-muted-foreground">→</span>
                  <span className="text-blue-600 font-medium">Then</span>{" "}
                  {actionSummary(a, statuses, members, allLists)}
                </p>
              </div>
              <button
                onClick={() => {
                  const count = onApplyToExisting(a);
                  setAppliedCounts(prev => ({ ...prev, [a.id]: count }));
                  setTimeout(() => setAppliedCounts(prev => { const n = { ...prev }; delete n[a.id]; return n; }), 3000);
                }}
                className="shrink-0 text-muted-foreground hover:text-green-500 transition-colors"
                title="Apply to all existing tasks in this list now"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
              {appliedCounts[a.id] !== undefined && (
                <span className="text-[10px] text-green-600 font-semibold shrink-0">+{appliedCounts[a.id]}</span>
              )}
              <button
                onClick={() => loadForEdit(a)}
                className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                title="Edit automation"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => deleteAutomation(a.id)}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                title="Delete automation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Add form */}
        {showForm ? (
          <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/20">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{editingId ? "Edit Automation" : "New Automation"}</p>

            <Input
              placeholder="Name (optional)"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              className="h-8 text-xs"
            />

            {/* Trigger */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide">When…</label>
              <Select value={trigger.type} onValueChange={v => setTrigger({ ...EMPTY_TRIGGER, type: v as AutomationTriggerType })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="task_created" className="text-xs">Task is created in "{list.name}"</SelectItem>
                  <SelectItem value="status_changed_to" className="text-xs">Status changes to…</SelectItem>
                  <SelectItem value="task_moved_here" className="text-xs">Task is moved into "{list.name}"</SelectItem>
                  <SelectItem value="task_in_list" className="text-xs">Task enters list… (once)</SelectItem>
                  <SelectItem value="task_always_in_list" className="text-xs">Task exists in list… (enforced on every save)</SelectItem>
                  <SelectItem value="start_date_overdue" className="text-xs">Start date is overdue by…</SelectItem>
                </SelectContent>
              </Select>
              {trigger.type === "status_changed_to" && (
                <Select value={trigger.toStatus} onValueChange={v => setTrigger(t => ({ ...t, toStatus: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select status…" /></SelectTrigger>
                  <SelectContent>
                    {statuses.map(s => <SelectItem key={s.id} value={s.id} className="text-xs">{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {(trigger.type === "task_in_list" || trigger.type === "task_always_in_list") && (
                <Select value={trigger.targetListId} onValueChange={v => setTrigger(t => ({ ...t, targetListId: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select list…" /></SelectTrigger>
                  <SelectContent>
                    {allLists.map(l => (
                      <SelectItem key={l.id} value={l.id} className="text-xs">{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {trigger.type === "start_date_overdue" && (
                <>
                  <div className="flex gap-2 items-center">
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={trigger.offsetValue}
                      onChange={e => setTrigger(t => ({ ...t, offsetValue: Math.max(1, parseInt(e.target.value) || 1) }))}
                      className="h-8 text-xs w-20"
                    />
                    <Select value={trigger.offsetUnit} onValueChange={v => setTrigger(t => ({ ...t, offsetUnit: v as "days" | "weeks" | "months" }))}>
                      <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="days" className="text-xs">day(s)</SelectItem>
                        <SelectItem value="weeks" className="text-xs">week(s)</SelectItem>
                        <SelectItem value="months" className="text-xs">month(s)</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">past start</span>
                  </div>
                  <Select
                    value={trigger.targetListId || "__all__"}
                    onValueChange={v => setTrigger(t => ({ ...t, targetListId: v === "__all__" ? "" : v }))}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__" className="text-xs">All lists (no filter)</SelectItem>
                      {allLists.map(l => (
                        <SelectItem key={l.id} value={l.id} className="text-xs">{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>

            {/* Action */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">Then…</label>
              <Select value={action.type} onValueChange={v => setAction({ ...EMPTY_ACTION, type: v as AutomationActionType })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(ACTION_LABELS) as [AutomationActionType, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {action.type === "set_status" && (
                <Select value={action.status} onValueChange={v => setAction(a => ({ ...a, status: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select status…" /></SelectTrigger>
                  <SelectContent>
                    {statuses.map(s => <SelectItem key={s.id} value={s.id} className="text-xs">{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {action.type === "set_priority" && (
                <Select value={action.priority} onValueChange={v => setAction(a => ({ ...a, priority: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select priority…" /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {action.type === "assign_members" && (
                <div className="flex flex-wrap gap-1.5 p-2 border border-border rounded-md bg-background">
                  {members.length === 0 && <p className="text-xs text-muted-foreground">No members in workspace</p>}
                  {members.map(m => {
                    const checked = action.assigneeUids.includes(m.uid);
                    return (
                      <button
                        key={m.uid}
                        onClick={() => toggleAssignee(m.uid)}
                        className={cn(
                          "flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors",
                          checked ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:border-primary",
                        )}
                      >
                        {m.displayName || m.email}
                        {checked && <X className="h-3 w-3 opacity-70" />}
                      </button>
                    );
                  })}
                </div>
              )}
              {action.type === "flag_task" && (
                <Input
                  placeholder="Flag reason (e.g. Waiting on part)"
                  value={action.flagReason}
                  onChange={e => setAction(a => ({ ...a, flagReason: e.target.value }))}
                  className="h-8 text-xs"
                />
              )}
              {action.type === "move_to_list" && (
                <Select value={action.listId} onValueChange={v => setAction(a => ({ ...a, listId: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select list…" /></SelectTrigger>
                  <SelectContent>
                    {allLists.filter(l => l.id !== list.id).map(l => (
                      <SelectItem key={l.id} value={l.id} className="text-xs">{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button size="sm" variant="ghost" onClick={resetForm} className="h-7 text-xs">Cancel</Button>
              <Button size="sm" onClick={handleSaveForm} disabled={!formValid} className="h-7 text-xs">
                {editingId ? "Save Changes" : "Add Automation"}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 border-dashed"
            onClick={() => setShowForm(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Create Automation
          </Button>
        )}

        <div className="flex justify-end gap-2 pt-1 border-t border-border">
          <Button size="sm" variant="ghost" onClick={handleClose}>Close</Button>
          {dirty && (
            <Button size="sm" onClick={() => { onSave({ ...list, automations }); setDirty(false); }}>
              Save Changes
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
