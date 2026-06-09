import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  ArrowLeft, Search, ChevronUp, ChevronDown, ChevronsUpDown,
  TableProperties, Check, Pencil, PencilOff, Eye, EyeOff, Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import type { WorkspaceState, Task, StatusConfig } from "@/types/crm";
import { DEFAULT_STATUSES } from "@/types/crm";

interface Props {
  onClose: () => void;
  workspace: WorkspaceState;
  onOpenTask?: (task: Task) => void;
  onUpdateTask?: (task: Task) => Promise<void>;
}

// We'll now handle custom fields dynamically instead of using fixed IDs
// We'll keep these mappings for backward compatibility
const FIELD_KEY_MAPPING = {
  "customer": "Client",
  "phone": "Contact",
  "brand": "Brand",
  "model": "Model",
  "fault": "Fault",
  "cost": "Cost (R)"
};

const STATUS_COLOR: Record<string, string> = {
  to_do:       "bg-slate-600 text-foreground",
  in_progress: "bg-blue-700 text-blue-100",
  review:      "bg-yellow-700 text-yellow-100",
  done:        "bg-green-700 text-green-100",
  quoted:      "bg-purple-700 text-purple-100",
  invoiced:    "bg-cyan-700 text-cyan-100",
  paid:        "bg-emerald-700 text-emerald-100",
  complete:    "bg-teal-700 text-teal-100",
};

/** Resolve a task's status label + tailwind classes from its list's customStatuses. */
function resolveStatus(task: Task, lists: WorkspaceState["lists"]): { label: string; color: string } {
  const list = lists?.find(l => l.id === task.listId);
  if (list?.customStatuses?.length) {
    const sc = list.customStatuses.find(s => s.id === task.status);
    if (sc) return { label: sc.label, color: sc.color };
  }
  const def = DEFAULT_STATUSES.find(s => s.id === task.status);
  if (def) return { label: def.label, color: def.color };
  // Unknown status — show as-is
  return { label: (task.status || "").replace(/_/g, " "), color: STATUS_COLOR[task.status] || "bg-muted text-foreground/80" };
}

// We'll make SortField more dynamic to handle custom field IDs
type SortField = "idx" | "jobNum" | "date" | "status" | "list" | string;

interface ColumnDefinition {
  key: SortField;
  label: string;
  defaultW: number;
  minW: number;
  editable?: boolean;
  customFieldId?: string; // Store the actual custom field ID
  type?: "text" | "number" | "status" | "date" | "checkbox";
  align?: string;
}

// Basic columns that are always present
const BASIC_COLUMNS: ColumnDefinition[] = [
  { key: "idx",         label: "#",           defaultW: 40,  minW: 36 },
  { key: "jobNum",      label: "Job No.",     defaultW: 100, minW: 70 },
  { key: "date",        label: "Date",        defaultW: 105, minW: 80 },
  { key: "description", label: "Description", defaultW: 200, minW: 100, editable: true, type: "text" },
  { key: "technician",  label: "Technician",  defaultW: 120, minW: 60, editable: true, type: "text" },
  { key: "status",      label: "Status",      defaultW: 105, minW: 70, editable: true, type: "status" },
  { key: "list",        label: "List",        defaultW: 130, minW: 60 },
];

// Function to generate all columns (including custom fields)
function generateColumns(customFields: CustomFieldDefinition[]): ColumnDefinition[] {
  // Start with basic columns
  const columns = [...BASIC_COLUMNS];
  
  // Map custom fields to columns
  customFields.forEach(field => {
    // Convert field type to column type
    let columnType: "text" | "number" | "date" | "checkbox" = "text";
    if (field.type === "number") columnType = "number";
    else if (field.type === "date") columnType = "date";
    else if (field.type === "checkbox") columnType = "checkbox";
    
    // Determine alignment
    let align = "";
    if (columnType === "number") align = "text-right";
    
    // Create column definition
    columns.push({
      key: field.id,
      label: field.name,
      defaultW: 120,
      minW: 60,
      editable: true,
      customFieldId: field.id,
      type: columnType,
      align
    });
  });
  
  return columns;
};

function cfGet(task: Task, id: string): string {
  const arr = task.customFieldValues as any[];
  const v = arr?.find((x: any) => x.fieldId === id)?.value;
  return v === null || v === undefined ? "" : String(v);
}

function cfSet(task: Task, id: string, value: string): Task {
  const arr = (task.customFieldValues as any[]) || [];
  const has = arr.some((x: any) => x.fieldId === id);
  return {
    ...task,
    customFieldValues: has
      ? arr.map((x: any) => (x.fieldId === id ? { ...x, value } : x))
      : [...arr, { fieldId: id, value }],
  };
}

function fmt(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

function Dash() {
  return <span className="text-muted-foreground/40">&mdash;</span>;
}

export function TaskCreationListPage({ onClose, workspace, onOpenTask, onUpdateTask }: Props) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("idx");
  const [sortAsc, setSortAsc] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [bulkEdit, setBulkEdit] = useState(false);
  const [localTasks, setLocalTasks] = useState<Map<string, Task>>(new Map());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [activeCell, setActiveCell] = useState<{ taskId: string; col: SortField } | null>(null);
  const [cellValue, setCellValue] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);

  // Generate dynamic columns based on workspace custom fields
  const allColumns = useMemo(() => generateColumns(workspace.customFields || []), [workspace.customFields]);

  // Column visibility and resizing
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
    // Try to load from local storage
    const saved = localStorage.getItem('job_register_visible_columns');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved column preferences', e);
      }
    }
    // Default: all columns visible
    return allColumns.reduce((acc, col) => ({ ...acc, [col.key]: true }), {});
  });
  const [colWidths, setColWidths] = useState<number[]>(() => allColumns.map(c => c.defaultW));
  const resizeState = useRef<{ colIdx: number; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeState.current) return;
      const { colIdx, startX, startW } = resizeState.current;
      const delta = e.clientX - startX;
      setColWidths(prev => {
        const next = [...prev];
        next[colIdx] = Math.max(allColumns[colIdx].minW, startW + delta);
        return next;
      });
    };
    const onUp = () => { resizeState.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  function startResize(e: React.MouseEvent, colIdx: number) {
    e.preventDefault();
    e.stopPropagation();
    resizeState.current = { colIdx, startX: e.clientX, startW: colWidths[colIdx] };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }
  
  // Toggle column visibility
  function toggleColumnVisibility(columnKey: string, visible: boolean) {
    setVisibleColumns(prev => ({
      ...prev,
      [columnKey]: visible
    }));
  }
  
  // Save column visibility preferences when they change
  useEffect(() => {
    localStorage.setItem('job_register_visible_columns', JSON.stringify(visibleColumns));
  }, [visibleColumns]);
  
  // Get visible columns
  const filteredColumns = useMemo(() => {
    return allColumns.filter(col => visibleColumns[col.key] !== false);
  }, [allColumns, visibleColumns]);

  const getTask = useCallback((t: Task) => localTasks.get(t.id) ?? t, [localTasks]);

  // Collect unique statuses as { id, label, color } resolved from each task's list
  const statuses = useMemo<StatusConfig[]>(() => {
    const seen = new Map<string, StatusConfig>();
    for (const t of (workspace.tasks || [])) {
      if (!t.status || seen.has(t.status)) continue;
      const resolved = resolveStatus(t, workspace.lists);
      seen.set(t.status, { id: t.status as any, label: resolved.label, color: resolved.color });
    }
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [workspace.tasks, workspace.lists]);

  const allStatusIds = statuses.length
    ? statuses.map(s => s.id)
    : ["to_do", "in_progress", "review", "done", "quoted", "invoiced", "paid", "complete"];

  const indexed = useMemo(() => {
    const base = [...(workspace.tasks || [])].sort(
      (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
    );
    return base.map((t, i) => ({ task: t, idx: i + 1 }));
  }, [workspace.tasks]);

  const filtered = useMemo(() => {
    let rows = indexed;
    if (statusFilter !== "all") rows = rows.filter((r) => getTask(r.task).status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(({ task }) => {
        const t = getTask(task);
        const listName = workspace.lists?.find(l => l.id === t.listId)?.name || "";
        
        // Get all custom field values for search
        const customFieldValues = workspace.customFields.map(field => 
          cfGet(t, field.id)
        );
        
        return [
          t.title, t.description, t.status, listName, (t as any).jobNumber, (t as any).technician,
          ...customFieldValues
        ].some((v) => String(v || "").toLowerCase().includes(q));
      });
    }
    return [...rows].sort((a, b) => {
      const ta = getTask(a.task);
      const tb = getTask(b.task);
      const str = (av: string, bv: string) => (sortAsc ? av.localeCompare(bv) : bv.localeCompare(av));
      // Find if the sortField is a custom field column
      const sortColumn = allColumns.find(col => col.key === sortField);
      
      if (sortField === "idx") {
        return sortAsc ? a.idx - b.idx : b.idx - a.idx;
      } else if (sortField === "date") {
        return sortAsc
          ? new Date(a.task.createdAt || 0).getTime() - new Date(b.task.createdAt || 0).getTime()
          : new Date(b.task.createdAt || 0).getTime() - new Date(a.task.createdAt || 0).getTime();
      } else if (sortField === "jobNum") {
        return str((ta as any).jobNumber || ta.title, (tb as any).jobNumber || tb.title);
      } else if (sortField === "description") {
        return str(ta.description || "", tb.description || "");
      } else if (sortField === "technician") {
        return str((ta as any).technician || "", (tb as any).technician || "");
      } else if (sortField === "status") {
        return str(ta.status, tb.status);
      } else if (sortField === "list") {
        const la = workspace.lists?.find(l => l.id === ta.listId)?.name || "";
        const lb = workspace.lists?.find(l => l.id === tb.listId)?.name || "";
        return str(la, lb);
      } else if (sortColumn?.customFieldId) {
        // This is a custom field column - get the values from the task's custom field values
        const customFieldId = sortColumn.customFieldId;
        
        if (sortColumn.type === "number") {
          // For number fields, do numeric comparison
          return sortAsc
            ? parseFloat(cfGet(ta, customFieldId) || "0") - parseFloat(cfGet(tb, customFieldId) || "0")
            : parseFloat(cfGet(tb, customFieldId) || "0") - parseFloat(cfGet(ta, customFieldId) || "0");
        } else if (sortColumn.type === "date") {
          // For date fields, do date comparison
          return sortAsc
            ? new Date(cfGet(ta, customFieldId) || 0).getTime() - new Date(cfGet(tb, customFieldId) || 0).getTime()
            : new Date(cfGet(tb, customFieldId) || 0).getTime() - new Date(cfGet(ta, customFieldId) || 0).getTime();
        } else {
          // For text and other fields, do string comparison
          return str(cfGet(ta, customFieldId), cfGet(tb, customFieldId));
        }
      }
      
      return 0;
    });
  }, [indexed, search, statusFilter, sortField, sortAsc, getTask]);

  function startEdit(taskId: string, col: SortField, val: string) {
    if (!onUpdateTask || !bulkEdit) return;
    setActiveCell({ taskId, col });
    setCellValue(val);
    // For select, focus it after state update
    if (allColumns.find(c => c.key === col)?.type === "status") {
      setTimeout(() => selectRef.current?.focus(), 30);
    }
  }

  async function commitEdit(taskId: string, col: SortField, value: string) {
    setActiveCell(null);
    const original = workspace.tasks.find((t) => t.id === taskId);
    if (!original || !onUpdateTask) return;
    const base = localTasks.get(taskId) ?? original;
    const colDef = allColumns.find((c) => c.key === col);
    if (!colDef?.editable) return;

    let updated: Task;
    if (col === "status") {
      updated = { ...base, status: value as any };
    } else if (col === "description") {
      updated = { ...base, description: value };
    } else if (col === "technician") {
      updated = { ...base, technician: value };
    } else if (colDef?.customFieldId) {
      updated = cfSet(base, colDef.customFieldId, value);
    } else return;

    setLocalTasks((prev) => new Map(prev).set(taskId, updated));
    setSavingIds((prev) => new Set(prev).add(taskId));
    try {
      await onUpdateTask(updated);
      setSavedIds((prev) => new Set(prev).add(taskId));
      setTimeout(() => setSavedIds((prev) => { const n = new Set(prev); n.delete(taskId); return n; }), 1800);
    } catch {
      setLocalTasks((prev) => { const n = new Map(prev); n.delete(taskId); return n; });
    } finally {
      setSavingIds((prev) => { const n = new Set(prev); n.delete(taskId); return n; });
    }
  }

  function cellDisplay(task: Task, col: SortField, idx: number): React.ReactNode {
    const t = getTask(task);
    const columnDef = allColumns.find(c => c.key === col);
    
    if (col === "idx") {
      return <span className="text-[11px] font-mono text-muted-foreground">{idx}</span>;
    } else if (col === "jobNum") {
      return <span className="font-mono text-xs text-indigo-300">{(t as any).jobNumber || <Dash />}</span>;
    } else if (col === "date") {
      return <span className="text-[11px] text-muted-foreground">{fmt(t.createdAt)}</span>;
    } else if (col === "description") {
      return <span className="text-xs text-foreground/80 line-clamp-2">{t.description || <Dash />}</span>;
    } else if (col === "technician") {
      return <span className="text-xs font-medium text-foreground">{(t as any).technician || <Dash />}</span>;
    } else if (col === "status") {
      const { label: statusLabel, color: statusColor } = resolveStatus(t, workspace.lists);
      const sc = statusColor.includes("bg-") ? statusColor : STATUS_COLOR[t.status] || "bg-slate-700 text-foreground/80";
      return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize whitespace-nowrap ${sc}`}>{statusLabel}</span>;
    } else if (col === "list") {
      const list = workspace.lists?.find(l => l.id === t.listId);
      const folder = list?.parentType === "folder" ? workspace.folders?.find(f => f.id === list.parentId) : null;
      return list ? (
        <div className="flex flex-col leading-tight">
          <span className="text-xs text-foreground truncate">{list.name}</span>
          {folder && <span className="text-[10px] text-muted-foreground truncate">{folder.name}</span>}
        </div>
      ) : <Dash />;
    } else if (columnDef?.customFieldId) {
      // Custom field column
      const value = cfGet(t, columnDef.customFieldId);
      
      // Special display for specific field types
      if (columnDef.type === "number") {
        // Check if this is a cost/price field (contains "cost", "price" in the label)
        const isCost = columnDef.label.toLowerCase().includes("cost") || columnDef.label.toLowerCase().includes("price");
        return <span className="text-xs text-green-400 font-mono">{value ? (isCost ? `R${value}` : value) : <Dash />}</span>;
      } else if (columnDef.type === "date") {
        return <span className="text-[11px] text-muted-foreground">{value ? fmt(value as string) : <Dash />}</span>;
      } else if (columnDef.type === "checkbox") {
        return <span className="text-xs">{value === "true" ? "✓" : "✗"}</span>;
      } else {
        // Default text display
        // Fault field gets special treatment - falls back to task title
        if (columnDef.label === "Fault" && !value) {
          return <span className="text-xs text-muted-foreground line-clamp-2">{t.title || <Dash />}</span>;
        }
        
        // Client/customer field gets highlighted
        if (columnDef.label === "Client" || columnDef.label === "Customer") {
          return <span className="text-xs font-medium text-foreground">{value || <Dash />}</span>;
        }
        
        // Default for all other custom fields
        return <span className="text-xs text-foreground/80">{value || <Dash />}</span>;
      }
    }
    
    // Fallback for any unhandled columns
    return null;
  }

  function colCurrentVal(task: Task, col: SortField) {
    const t = getTask(task);
    if (col === "status") return t.status;
    if (col === "description") return t.description || "";
    if (col === "technician") return (t as any).technician || "";
    
    const colDef = allColumns.find((c) => c.key === col);
    if (!colDef?.customFieldId) return "";
    
    const cfVal = cfGet(t, colDef.customFieldId);
    
    // Special case for fault field - falls back to task title
    if (colDef.label === "Fault" && !cfVal) return t.title || "";
    
    return cfVal;
  }

  const canEdit = !!onUpdateTask;

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0 flex-wrap gap-y-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 text-muted-foreground hover:text-foreground px-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <TableProperties className="h-5 w-5 text-indigo-400" />
          <span className="font-semibold text-foreground text-base">Job Register</span>
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            {filtered.length} / {(workspace.tasks || []).length}
          </span>
        </div>

        {/* Bulk Edit toggle */}
        {canEdit && (
          <Button
            variant={bulkEdit ? "default" : "outline"}
            size="sm"
            onClick={() => { setBulkEdit(p => !p); setActiveCell(null); }}
            className={`gap-1.5 text-xs ${bulkEdit ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-500" : "border-border text-muted-foreground hover:text-foreground hover:border-border/60"}`}
          >
            {bulkEdit ? <><PencilOff className="h-3.5 w-3.5" /> Exit Bulk Edit</> : <><Pencil className="h-3.5 w-3.5" /> Bulk Edit</>}
          </Button>
        )}

        {bulkEdit && (
          <span className="text-[11px] text-indigo-400/70 border border-indigo-800/40 bg-indigo-950/40 rounded px-2 py-0.5">
            Click any cell to edit · Enter or click away to save · Esc to cancel
          </span>
        )}

        {/* Status filters */}
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setStatusFilter("all")}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${statusFilter === "all" ? "bg-indigo-600 border-indigo-500 text-white" : "border-border text-muted-foreground hover:border-border/60"}`}>
            All
          </button>
          {statuses.map((s) => (
            <button key={s.id} onClick={() => setStatusFilter((p) => (p === s.id ? "all" : s.id))}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors capitalize ${statusFilter === s.id ? "bg-indigo-600 border-indigo-500 text-white" : "border-border text-muted-foreground hover:border-border/60"}`}>
              {s.label}
            </button>
          ))}
        </div>

        {/* Search */}
        {/* Column Visibility Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-border text-muted-foreground hover:text-foreground hover:border-slate-500"
            >
              <Settings className="h-3.5 w-3.5" /> Display Options
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-card border-border text-foreground max-h-[70vh] overflow-auto">
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Show/Hide Columns
            </div>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuGroup>
              {allColumns.map(col => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={visibleColumns[col.key] !== false}
                  onCheckedChange={(checked) => toggleColumnVisibility(col.key, !!checked)}
                  className="cursor-pointer text-sm"
                >
                  <span className="flex items-center gap-2">
                    {visibleColumns[col.key] !== false ? (
                      <Eye className="h-3.5 w-3.5 text-indigo-400" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    {col.label}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="bg-border" />
            <div className="px-2 py-1.5 flex justify-between gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="h-7 text-xs border-border text-muted-foreground hover:text-foreground hover:border-slate-500 flex-1"
                onClick={() => setVisibleColumns(allColumns.reduce((acc, col) => ({ ...acc, [col.key]: true }), {}))}
              >
                Show All
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-7 text-xs border-border text-muted-foreground hover:text-foreground hover:border-slate-500 flex-1"
                onClick={() => {
                  // Reset to basic columns only (idx, jobNum, date, status, list)
                  const defaults = allColumns.reduce((acc, col) => {
                    const isBasic = ["idx", "jobNum", "date", "status", "list"].includes(col.key);
                    return { ...acc, [col.key]: isBasic };
                  }, {});
                  setVisibleColumns(defaults);
                }}
              >
                Reset
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto relative w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search jobs..."
            className="pl-8 h-8 text-sm bg-card border-border text-foreground placeholder:text-muted-foreground" />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="text-sm border-collapse" style={{ tableLayout: "fixed", width: filteredColumns.map((_, i) => colWidths[allColumns.findIndex(col => col.key === filteredColumns[i].key)]).reduce((a, b) => a + b, 0) + 32 }}>
          <colgroup>
            {filteredColumns.map((col) => <col key={col.key} style={{ width: colWidths[allColumns.findIndex(c => c.key === col.key)] }} />)}
            <col style={{ width: 32 }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-background border-b border-border">
            <tr>
              {filteredColumns.map((col) => {
                const colIdx = allColumns.findIndex(c => c.key === col.key);
                return (
                <th key={col.key}
                  style={{ width: colWidths[colIdx], overflow: "hidden" }}
                  className={`relative px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide select-none whitespace-nowrap ${col.align || ""} ${bulkEdit && col.editable ? "border-b-2 border-indigo-700/50" : ""}`}>
                  <div className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => { if (sortField === col.key) setSortAsc((p) => !p); else { setSortField(col.key); setSortAsc(true); } }}>
                    <span className="truncate">{col.label}</span>
                    {sortField === col.key ? (sortAsc ? <ChevronUp className="h-3 w-3 text-indigo-400 shrink-0" /> : <ChevronDown className="h-3 w-3 text-indigo-400 shrink-0" />) : <ChevronsUpDown className="h-3 w-3 text-slate-600 shrink-0" />}
                  </div>
                  {/* Resize handle */}
                  <div
                    onMouseDown={(e) => startResize(e, colIdx)}
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize group/resize flex items-center justify-center"
                  >
                    <div className="w-px h-4 bg-slate-700 group-hover/resize:bg-indigo-500 transition-colors" />
                  </div>
                </th>
              );
              })}
              <th style={{ width: 32 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={filteredColumns.length + 1} className="py-16 text-center text-muted-foreground text-sm">No jobs found</td></tr>
            )}
            {filtered.map(({ task, idx }, rowIdx) => {
              const isEdited = localTasks.has(task.id);
              const isSaving = savingIds.has(task.id);
              const isSaved  = savedIds.has(task.id);
              return (
                <tr key={task.id}
                  onClick={() => { if (!bulkEdit && onOpenTask) onOpenTask(task); }}
                  className={`border-b border-border group transition-colors ${rowIdx % 2 === 0 ? "bg-background/30" : "bg-background/10"} ${!bulkEdit && onOpenTask ? "hover:bg-indigo-950/30 cursor-pointer" : "hover:bg-card/20"} ${isEdited ? "outline outline-1 outline-indigo-800/40" : ""}`}>
                  {filteredColumns.map((col) => {
                    const isActive   = bulkEdit && activeCell?.taskId === task.id && activeCell?.col === col.key;
                    const isEditable = bulkEdit && canEdit && col.editable;
                    const colIdx = allColumns.findIndex(c => c.key === col.key);
                    
                    // Handle custom field type (date, checkbox, etc.)
                    let inputType = "text";
                    if (col.type === "number") inputType = "number";
                    if (col.type === "date") inputType = "date";
                    
                    return (
                      <td key={col.key}
                        style={{ width: colWidths[colIdx], overflow: "hidden" }}
                        className={`px-2 py-1.5 ${col.align || ""} ${isEditable && !isActive ? "cursor-pointer" : ""}`}
                        onClick={(e) => {
                          if (!bulkEdit) return;
                          e.stopPropagation();
                          if (!isActive && isEditable) startEdit(task.id, col.key, colCurrentVal(task, col.key));
                        }}>
                        {isActive ? (
                          col.type === "status" ? (
                            <select ref={selectRef} value={cellValue}
                              onChange={(e) => setCellValue(e.target.value)}
                              onBlur={() => commitEdit(task.id, col.key, cellValue)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitEdit(task.id, col.key, cellValue);
                                if (e.key === "Escape") setActiveCell(null);
                              }}
                              className="w-full bg-card border border-indigo-500 text-foreground text-xs rounded px-2 py-1 outline-none capitalize">
                              {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                            </select>
                          ) : col.type === "checkbox" ? (
                            <select value={cellValue}
                              onChange={(e) => setCellValue(e.target.value)}
                              onBlur={() => commitEdit(task.id, col.key, cellValue)}
                              className="w-full bg-card border border-indigo-500 text-foreground text-xs rounded px-2 py-1 outline-none">
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </select>
                          ) : (
                            <input
                              autoFocus
                              type={inputType}
                              value={cellValue}
                              onChange={(e) => setCellValue(e.target.value)}
                              onFocus={(e) => e.target.select()}
                              onBlur={() => commitEdit(task.id, col.key, cellValue)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitEdit(task.id, col.key, cellValue);
                                if (e.key === "Escape") setActiveCell(null);
                                if (e.key === "Tab") { e.preventDefault(); commitEdit(task.id, col.key, cellValue); }
                              }}
                              className="w-full bg-card border border-indigo-500 text-foreground text-xs rounded px-2 py-1 outline-none"
                              style={{ minWidth: col.minW - 16 }}
                            />
                          )
                        ) : (
                          <div className={`rounded px-1 py-0.5 min-h-[22px] flex items-center ${isEditable ? "hover:bg-muted/60 hover:ring-1 hover:ring-indigo-500/40 transition-all" : ""}`}>
                            {cellDisplay(task, col.key, idx)}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1 py-1.5 text-center" style={{ width: 32 }}>
                    {isSaving ? (
                      <span className="text-[10px] text-muted-foreground animate-pulse">...</span>
                    ) : isSaved ? (
                      <Check className="h-3.5 w-3.5 text-green-500 mx-auto" />
                    ) : onOpenTask && !bulkEdit ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); onOpenTask(task); }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-indigo-400 transition-all p-0.5 rounded"
                        title="Open task">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border bg-background px-4 py-2 flex items-center gap-6 text-[11px] text-muted-foreground">
        <span><span className="text-foreground/80 font-semibold">{filtered.length}</span> jobs shown</span>
        {(() => {
          // Find the cost field by looking for fields with "cost" in the name
          const costField = workspace.customFields?.find(f => f.name.toLowerCase().includes("cost"))?.id;
          const total = filtered.reduce((s, { task }) => s + parseFloat(cfGet(getTask(task), costField || "") || "0"), 0);
          return total > 0 ? (
            <span>Total: <span className="text-green-400 font-semibold">R{total.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}</span></span>
          ) : null;
        })()}
        {!bulkEdit && onOpenTask && (
          <span className="ml-auto text-slate-600">Click any row to open the task</span>
        )}
      </div>
    </div>
  );
}
