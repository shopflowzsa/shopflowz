import { useState, useEffect, useCallback, useRef } from "react";
import { X, Plus, Trash2, TrendingUp, TrendingDown, CheckCircle2, Circle, ClipboardList, Clock, ChevronUp, ChevronDown, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────

type IncomeStatus = 'pending' | 'ready' | 'collected';

interface Payment {
  id: string;
  amount: number;
  note?: string;
}

interface PlanItem {
  id: string;
  name: string;
  amount: number;
  collected?: boolean; // legacy
  status?: IncomeStatus;
  payments?: Payment[];
}

interface TaskItem {
  id: string;
  name: string;
  done: boolean;
  note?: string;
}

interface PlanData {
  expenses: PlanItem[];
  income: PlanItem[];
  tasks: TaskItem[];
}

const empty: PlanData = { expenses: [], income: [], tasks: [] };

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function fmt(n: number) {
  return "R " + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Supabase ──────────────────────────────────────────────────────────────

function migrateItems(items: PlanItem[]): PlanItem[] {
  return (items ?? []).map(item => ({
    ...item,
    status: item.status ?? (item.collected ? 'collected' : 'pending') as IncomeStatus,
  }));
}

async function loadPlan(workspaceId: string): Promise<PlanData> {
  const { data } = await supabase
    .from("workspace_settings")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("category", "business_planning")
    .maybeSingle();
  const saved = data?.data as Partial<PlanData> | null;
  const plan = { ...empty, ...(saved ?? {}) };
  return { ...plan, expenses: migrateItems(plan.expenses), income: migrateItems(plan.income) };
}

async function savePlan(workspaceId: string, plan: PlanData) {
  const { error } = await supabaseServiceRole
    .from("workspace_settings")
    .upsert(
      { workspace_id: workspaceId, category: "business_planning", data: plan },
      { onConflict: "workspace_id,category" }
    );
  if (error) throw error;
}

// ── AddRow (with amount) ──────────────────────────────────────────────────

function AddRow({ onAdd, placeholder }: { onAdd: (name: string, amount: number) => void; placeholder: string }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const submit = () => {
    const n = name.trim();
    const a = parseFloat(amount);
    if (!n || isNaN(a) || a < 0) return;
    onAdd(n, a);
    setName(""); setAmount("");
  };
  return (
    <div className="flex gap-2 mt-3">
      <Input placeholder={placeholder} value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === "Enter" && submit()} className="flex-1 h-8 text-sm" />
      <Input placeholder="R Amount" type="number" min={0} step={0.01} value={amount}
        onChange={e => setAmount(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()}
        className="w-28 h-8 text-sm" />
      <Button size="sm" onClick={submit} className="h-8 px-3 gap-1">
        <Plus className="h-3.5 w-3.5" />Add
      </Button>
    </div>
  );
}

// ── ItemList (expenses / income) ──────────────────────────────────────────

interface ItemListProps {
  items: PlanItem[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, name: string, amount: number) => void;
  emptyMsg: string;
  accentClass: string;
  threeState?: boolean;
  onAddPayment?: (itemId: string, amount: number, note: string) => void;
  onDeletePayment?: (itemId: string, paymentId: string) => void;
}

function StatusIcon({ status, accentClass }: { status: IncomeStatus; accentClass: string }) {
  if (status === 'collected') return <CheckCircle2 className={cn("h-4 w-4", accentClass)} />;
  if (status === 'ready') return <Clock className="h-4 w-4 text-amber-500" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

function ItemList({ items, onToggle, onDelete, onUpdate, emptyMsg, accentClass, threeState, onAddPayment, onDeletePayment }: ItemListProps) {
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  const startEdit = (item: PlanItem) => {
    committedRef.current = false;
    setEditId(item.id); setEditName(item.name); setEditAmount(String(item.amount));
  };
  const commitEdit = (id: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    const name = editName.trim();
    const amount = parseFloat(editAmount);
    if (name && !isNaN(amount) && amount >= 0) onUpdate(id, name, amount);
    setEditId(null);
  };
  const handleKey = (e: React.KeyboardEvent, id: string) => {
    if (e.key === "Enter") commitEdit(id);
    if (e.key === "Escape") { committedRef.current = true; setEditId(null); }
  };

  const togglePayments = (id: string) => {
    setExpandedPaymentId(prev => {
      const next = prev === id ? null : id;
      if (next) { setPayAmount(""); setPayNote(""); }
      return next;
    });
  };

  const submitPayment = (itemId: string) => {
    const a = parseFloat(payAmount);
    if (isNaN(a) || a <= 0) return;
    onAddPayment?.(itemId, a, payNote.trim());
    setPayAmount(""); setPayNote("");
  };

  const getStatus = (item: PlanItem): IncomeStatus => item.status ?? (item.collected ? 'collected' : 'pending');

  if (!items.length)
    return <p className="text-xs text-muted-foreground py-4 text-center">{emptyMsg}</p>;

  return (
    <ul className="space-y-1 mt-1">
      {items.map(item => {
        const status = getStatus(item);
        const isCollected = status === 'collected';
        const isReady = status === 'ready';
        const payments = item.payments ?? [];
        const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
        const remaining = item.amount - totalPaid;
        const hasPayments = payments.length > 0;
        const isExpanded = expandedPaymentId === item.id;

        return (
          <li key={item.id} className={cn("rounded-md", isReady && "bg-amber-50/50 dark:bg-amber-950/20")}>
            {/* Main row */}
            <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/30 group rounded-md">
              <button onClick={() => onToggle(item.id)}
                title={threeState ? (status === 'pending' ? 'Mark ready for collection' : status === 'ready' ? 'Mark collected' : 'Mark pending') : undefined}
                className="flex-shrink-0 transition-colors">
                <StatusIcon status={status} accentClass={accentClass} />
              </button>

              {editId === item.id ? (
                <>
                  <input autoFocus
                    className="flex-1 text-sm bg-background border rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                    value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Tab") { e.preventDefault(); amountRef.current?.focus(); } else handleKey(e, item.id); }}
                    onBlur={e => { if (e.relatedTarget !== amountRef.current) commitEdit(item.id); }} />
                  <input ref={amountRef} type="number" min={0} step={0.01}
                    className="w-24 text-sm font-semibold tabular-nums bg-background border rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring text-right"
                    value={editAmount} onChange={e => setEditAmount(e.target.value)}
                    onKeyDown={e => handleKey(e, item.id)} onBlur={() => commitEdit(item.id)} />
                </>
              ) : (
                <>
                  <span onClick={() => startEdit(item)} title="Click to edit"
                    className={cn("flex-1 text-sm cursor-pointer truncate",
                      isCollected && "line-through text-muted-foreground",
                      isReady && "font-medium text-amber-700 dark:text-amber-400"
                    )}>
                    {item.name}
                    {isReady && <span className="ml-1.5 text-xs font-normal bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full">Ready</span>}
                  </span>

                  {/* Amount — shows remaining when payments exist */}
                  {hasPayments ? (
                    <div className="text-right flex-shrink-0 cursor-pointer" onClick={() => togglePayments(item.id)}>
                      <div className={cn("text-sm font-semibold tabular-nums",
                        remaining <= 0 ? "text-emerald-600" : "text-amber-600"
                      )}>
                        {remaining <= 0 ? "Paid" : fmt(remaining)}
                      </div>
                      <div className="text-[10px] text-muted-foreground tabular-nums">of {fmt(item.amount)}</div>
                    </div>
                  ) : (
                    <span onClick={() => { startEdit(item); setTimeout(() => amountRef.current?.focus(), 0); }} title="Click to edit"
                      className={cn("text-sm font-semibold tabular-nums cursor-pointer flex-shrink-0",
                        isCollected && "text-muted-foreground line-through",
                        isReady && "text-amber-600 dark:text-amber-400"
                      )}>
                      {fmt(item.amount)}
                    </span>
                  )}
                </>
              )}

              {/* Payment toggle — always visible when expanded, hover-only otherwise */}
              {onAddPayment && (
                <button
                  onClick={() => togglePayments(item.id)}
                  title={isExpanded ? "Hide payments" : "Part payment"}
                  className={cn(
                    "flex-shrink-0 rounded p-0.5 transition-colors",
                    isExpanded
                      ? "text-blue-500 bg-blue-50 dark:bg-blue-950/40"
                      : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-blue-500"
                  )}
                >
                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <CreditCard className="h-3.5 w-3.5" />}
                </button>
              )}

              <button onClick={() => onDelete(item.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive ml-1 flex-shrink-0">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Payment panel */}
            {isExpanded && onAddPayment && (
              <div className="ml-6 mr-2 mb-2 rounded-lg border border-border bg-muted/30 p-2.5 space-y-1.5">
                {/* Header + summary */}
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground">Part Payments</span>
                  <span className={cn("font-semibold tabular-nums", remaining <= 0 ? "text-emerald-600" : "text-foreground")}>
                    {fmt(totalPaid)} paid · {remaining > 0 ? <>{fmt(remaining)} left</> : "Fully paid ✓"}
                  </span>
                </div>

                {/* Progress bar */}
                {item.amount > 0 && (
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div
                      className="bg-emerald-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (totalPaid / item.amount) * 100)}%` }}
                    />
                  </div>
                )}

                {/* Payment entries */}
                {payments.map(p => (
                  <div key={p.id} className="flex items-center gap-2 text-xs group/pay py-0.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                    <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(p.amount)}</span>
                    {p.note && <span className="text-muted-foreground truncate flex-1">{p.note}</span>}
                    <span className="flex-1" />
                    <button
                      onClick={() => onDeletePayment?.(item.id, p.id)}
                      className="opacity-0 group-hover/pay:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}

                {/* Add payment row */}
                <div className="flex gap-1.5 pt-1 border-t border-border/50">
                  <input
                    type="number" min={0} step={0.01}
                    placeholder="Amount"
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && submitPayment(item.id)}
                    className="w-24 h-7 text-xs bg-background border rounded px-2 focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
                  />
                  <input
                    placeholder="Note (optional)"
                    value={payNote}
                    onChange={e => setPayNote(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && submitPayment(item.id)}
                    className="flex-1 h-7 text-xs bg-background border rounded px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={() => submitPayment(item.id)}
                    className="h-7 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors font-medium flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" />Pay
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── TaskList (daily targets) ──────────────────────────────────────────────

interface TaskListProps {
  tasks: TaskItem[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, name: string) => void;
  onUpdateNote: (id: string, note: string) => void;
}

function TaskList({ tasks, onToggle, onDelete, onUpdate, onUpdateNote }: TaskListProps) {
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNoteId, setEditNoteId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const committedRef = useRef(false);
  const noteCommittedRef = useRef(false);

  const startEdit = (t: TaskItem) => { committedRef.current = false; setEditId(t.id); setEditName(t.name); };
  const commitEdit = (id: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    const name = editName.trim();
    if (name) onUpdate(id, name);
    setEditId(null);
  };
  const handleKey = (e: React.KeyboardEvent, id: string) => {
    if (e.key === "Enter") commitEdit(id);
    if (e.key === "Escape") { committedRef.current = true; setEditId(null); }
  };

  const startNoteEdit = (t: TaskItem) => { noteCommittedRef.current = false; setEditNoteId(t.id); setEditNote(t.note || ""); };
  const commitNoteEdit = (id: string) => {
    if (noteCommittedRef.current) return;
    noteCommittedRef.current = true;
    onUpdateNote(id, editNote.trim());
    setEditNoteId(null);
  };

  if (!tasks.length)
    return <p className="text-xs text-muted-foreground py-4 text-center">No targets added yet.</p>;

  return (
    <ul className="space-y-1 mt-1">
      {tasks.map(t => (
        <li key={t.id} className="px-2 py-1.5 rounded-md hover:bg-muted/30 group">
          <div className="flex items-center gap-2">
            <button onClick={() => onToggle(t.id)} className="flex-shrink-0 transition-colors text-blue-500">
              {t.done ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
            </button>
            {editId === t.id ? (
              <input autoFocus
                className="flex-1 text-sm bg-background border rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                value={editName} onChange={e => setEditName(e.target.value)}
                onKeyDown={e => handleKey(e, t.id)} onBlur={() => commitEdit(t.id)} />
            ) : (
              <span onClick={() => startEdit(t)} title="Click to edit"
                className={cn("flex-1 text-sm cursor-pointer", t.done && "line-through text-muted-foreground")}>
                {t.name}
              </span>
            )}
            <button onClick={() => onDelete(t.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive ml-1 flex-shrink-0">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Note section */}
          <div className="flex items-center gap-2 mt-1 ml-6">
            {editNoteId === t.id ? (
              <input autoFocus
                className="flex-1 text-xs bg-background border rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Add a note..."
                value={editNote} onChange={e => setEditNote(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") commitNoteEdit(t.id); if (e.key === "Escape") setEditNoteId(null); }}
                onBlur={() => commitNoteEdit(t.id)} />
            ) : (
              <span onClick={() => startNoteEdit(t)} title="Click to add note"
                className={cn("flex-1 text-xs cursor-pointer text-muted-foreground italic", !t.note && "opacity-50")}>
                {t.note || "Add note..."}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function AddTaskRow({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  const submit = () => { const n = name.trim(); if (!n) return; onAdd(n); setName(""); };
  return (
    <div className="flex gap-2 mt-3">
      <Input placeholder="Task or target description…" value={name}
        onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()}
        className="flex-1 h-8 text-sm" />
      <Button size="sm" onClick={submit} className="h-8 px-3 gap-1">
        <Plus className="h-3.5 w-3.5" />Add
      </Button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

interface BusinessPlanningPageProps {
  onClose: () => void;
  onOpenCrm?: () => void;
  onOpenInventory?: () => void;
  onOpenInvoicing?: () => void;
  onOpenQuotations?: () => void;
  onOpenBanking?: () => void;
  onOpenAccounts?: () => void;
}

export function BusinessPlanningPage({
  onClose,
  onOpenCrm,
  onOpenInventory,
  onOpenInvoicing,
  onOpenQuotations,
  onOpenBanking,
  onOpenAccounts,
}: BusinessPlanningPageProps) {
  const { workspaceId } = useAuth();
  const { toast } = useToast();
  const [plan, setPlan] = useState<PlanData>(empty);
  const [loading, setLoading] = useState(true);
  const [rightPanelWidth, setRightPanelWidth] = useState(420);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Handle resize drag
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = rightPanelWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(300, Math.min(800, startWidth + delta));
      setRightPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [rightPanelWidth]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try { setPlan(await loadPlan(workspaceId)); } finally { setLoading(false); }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const persist = useCallback(async (next: PlanData) => {
    if (!workspaceId) return;
    setPlan(next);
    try { await savePlan(workspaceId, next); }
    catch { toast({ variant: "destructive", title: "Save failed" }); }
  }, [workspaceId, toast]);

  // Expenses
  const addExpense    = (name: string, amount: number) => persist({ ...plan, expenses: [...plan.expenses, { id: uid(), name, amount, status: 'pending' as IncomeStatus }] });
  const toggleExpense = (id: string) => persist({ ...plan, expenses: plan.expenses.map(e => e.id === id ? { ...e, status: (e.status ?? (e.collected ? 'collected' : 'pending')) === 'collected' ? 'pending' as IncomeStatus : 'collected' as IncomeStatus } : e) });
  const deleteExpense = (id: string) => persist({ ...plan, expenses: plan.expenses.filter(e => e.id !== id) });
  const updateExpense = (id: string, name: string, amount: number) => persist({ ...plan, expenses: plan.expenses.map(e => e.id === id ? { ...e, name, amount } : e) });
  const addExpensePayment = (itemId: string, amount: number, note: string) =>
    persist({ ...plan, expenses: plan.expenses.map(e => e.id === itemId ? { ...e, payments: [...(e.payments ?? []), { id: uid(), amount, note: note || undefined }] } : e) });
  const deleteExpensePayment = (itemId: string, paymentId: string) =>
    persist({ ...plan, expenses: plan.expenses.map(e => e.id === itemId ? { ...e, payments: (e.payments ?? []).filter(p => p.id !== paymentId) } : e) });

  // Income
  const cycleIncomeStatus = (status: IncomeStatus): IncomeStatus =>
    status === 'pending' ? 'ready' : status === 'ready' ? 'collected' : 'pending';
  const addIncome    = (name: string, amount: number) => persist({ ...plan, income: [...plan.income, { id: uid(), name, amount, status: 'pending' as IncomeStatus }] });
  const toggleIncome = (id: string) => persist({ ...plan, income: plan.income.map(i => i.id === id ? { ...i, status: cycleIncomeStatus(i.status ?? (i.collected ? 'collected' : 'pending')) } : i) });
  const deleteIncome = (id: string) => persist({ ...plan, income: plan.income.filter(i => i.id !== id) });
  const updateIncome = (id: string, name: string, amount: number) => persist({ ...plan, income: plan.income.map(i => i.id === id ? { ...i, name, amount } : i) });

  // Tasks
  const addTask = (name: string) => persist({ ...plan, tasks: [...(plan.tasks ?? []), { id: uid(), name, done: false }] });
  const toggleTask = (id: string) => persist({ ...plan, tasks: (plan.tasks ?? []).map(t => t.id === id ? { ...t, done: !t.done } : t) });
  const deleteTask = (id: string) => persist({ ...plan, tasks: (plan.tasks ?? []).filter(t => t.id !== id) });
  const updateTask = (id: string, name: string) => persist({ ...plan, tasks: (plan.tasks ?? []).map(t => t.id === id ? { ...t, name } : t) });
  const updateTaskNote = (id: string, note: string) => persist({ ...plan, tasks: (plan.tasks ?? []).map(t => t.id === id ? { ...t, note } : t) });

  const getItemStatus = (item: PlanItem): IncomeStatus => item.status ?? (item.collected ? 'collected' : 'pending');
  const totalExpenses   = plan.expenses.reduce((s, e) => s + e.amount, 0);
  const paidExpenses    = plan.expenses.reduce((s, e) => {
    const payments = e.payments ?? [];
    if (payments.length > 0) return s + payments.reduce((ps, p) => ps + p.amount, 0);
    return s + (getItemStatus(e) === 'collected' ? e.amount : 0);
  }, 0);
  const totalIncome     = plan.income.reduce((s, i) => s + i.amount, 0);
  const collectedIncome = plan.income.filter(i => getItemStatus(i) === 'collected').reduce((s, i) => s + i.amount, 0);
  const readyIncome     = plan.income.filter(i => getItemStatus(i) === 'ready').reduce((s, i) => s + i.amount, 0);
  const net             = totalIncome - totalExpenses;
  const tasks           = plan.tasks ?? [];
  const doneTasks       = tasks.filter(t => t.done).length;

  return (
    <div className={cn("absolute inset-0 z-30 bg-background flex flex-col", isResizing && "select-none")}>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-background flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Business Planning</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Track expenses, income and daily targets</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-3 px-6 py-3 border-b bg-muted/20 flex-shrink-0">
        <div className="bg-background rounded-lg p-2.5 border text-center">
          <div className="text-xs text-muted-foreground mb-0.5">Total Expenses</div>
          <div className="text-base font-bold text-red-600">{fmt(totalExpenses)}</div>
          <div className="text-xs text-muted-foreground">{fmt(paidExpenses)} paid</div>
        </div>
        <div className="bg-background rounded-lg p-2.5 border text-center">
          <div className="text-xs text-muted-foreground mb-0.5">Potential Income</div>
          <div className="text-base font-bold text-emerald-600">{fmt(totalIncome)}</div>
          <div className="text-xs text-muted-foreground">
            {readyIncome > 0 && <span className="text-amber-600">{fmt(readyIncome)} ready · </span>}
            {fmt(collectedIncome)} collected
          </div>
        </div>
        <div className="bg-background rounded-lg p-2.5 border text-center">
          <div className="text-xs text-muted-foreground mb-0.5">Net</div>
          <div className={cn("text-base font-bold", net >= 0 ? "text-emerald-600" : "text-red-600")}>{fmt(net)}</div>
          <div className="text-xs text-muted-foreground">income − expenses</div>
        </div>
        <div className="bg-background rounded-lg p-2.5 border text-center">
          <div className="text-xs text-muted-foreground mb-0.5">Daily Targets</div>
          <div className="text-base font-bold text-blue-600">{doneTasks}/{tasks.length}</div>
          <div className="text-xs text-muted-foreground">completed</div>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
      ) : (
        <div className="flex-1 overflow-hidden flex gap-0">

          {/* ── Left: Expenses + Income ── */}
          <div className="flex-1 overflow-y-auto px-6 py-5 border-r space-y-6">

            <section>
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="h-4 w-4 text-red-500" />
                <h2 className="font-semibold">Expenses</h2>
                <span className="text-xs text-muted-foreground ml-auto">{plan.expenses.length} item{plan.expenses.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="rounded-lg border p-3">
                <ItemList items={plan.expenses} onToggle={toggleExpense} onDelete={deleteExpense}
                  onUpdate={updateExpense} emptyMsg="No expenses added yet." accentClass="text-red-500"
                  onAddPayment={addExpensePayment} onDeletePayment={deleteExpensePayment} />
                <AddRow onAdd={addExpense} placeholder="Expense name (e.g. Rent, Salaries)" />
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                <h2 className="font-semibold">Potential Income</h2>
                <span className="text-xs text-muted-foreground ml-auto">{plan.income.length} item{plan.income.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="rounded-lg border p-3">
                <ItemList items={plan.income} onToggle={toggleIncome} onDelete={deleteIncome}
                  onUpdate={updateIncome} emptyMsg="No income entries added yet." accentClass="text-emerald-500" threeState />
                <AddRow onAdd={addIncome} placeholder="Income source (e.g. Invoice #123, Deposit)" />
              </div>
            </section>

          </div>

          {/* ── Resize Handle ── */}
          <div
            className="w-1 flex-shrink-0 cursor-col-resize hover:bg-blue-300 transition-colors group relative"
            onMouseDown={startResize}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-12 rounded-full bg-muted-foreground/20 group-hover:bg-blue-400 transition-colors flex items-center justify-center">
              <div className="flex flex-col gap-1">
                <div className="w-1 h-1 rounded-full bg-current opacity-50" />
                <div className="w-1 h-1 rounded-full bg-current opacity-50" />
                <div className="w-1 h-1 rounded-full bg-current opacity-50" />
              </div>
            </div>
          </div>
    
          {/* ── Right: Daily Targets ── */}
          <div
            ref={panelRef}
            className="flex-shrink-0 overflow-y-auto px-6 py-5"
            style={{ width: rightPanelWidth }}
          >
            <div className="flex items-center gap-2 mb-2">
              <ClipboardList className="h-4 w-4 text-blue-500" />
              <h2 className="font-semibold">Daily Targets</h2>
              <span className="text-xs text-muted-foreground ml-auto">
                {doneTasks}/{tasks.length} done
              </span>
            </div>
    
            {tasks.length > 0 && (
              <div className="w-full bg-muted rounded-full h-1.5 mb-3">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all"
                  style={{ width: tasks.length ? `${(doneTasks / tasks.length) * 100}%` : "0%" }}
                />
              </div>
            )}
    
            <div className="rounded-lg border p-3">
              <TaskList tasks={tasks} onToggle={toggleTask} onDelete={deleteTask} onUpdate={updateTask} onUpdateNote={updateTaskNote} />
              <AddTaskRow onAdd={addTask} />
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
