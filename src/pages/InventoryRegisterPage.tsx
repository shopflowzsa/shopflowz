import { useState, useMemo, useRef, useEffect } from "react";
import {
  ArrowLeft, Search, ChevronUp, ChevronDown, ChevronsUpDown,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inventoryService, InventoryItem } from "@/lib/inventoryService";

interface Props {
  onClose: () => void;
  workspaceId: string;
  onOpenItem?: (item: InventoryItem) => void;
}

type SortField = "idx" | "sku" | "name" | "category" | "type" | "supplier" | "qty" | "reorder" | "costPrice" | "price" | "status";

const COLUMNS: { key: SortField; label: string; defaultW: number; minW: number; align?: string }[] = [
  { key: "idx",       label: "#",           defaultW: 40,  minW: 36 },
  { key: "sku",       label: "SKU",         defaultW: 100, minW: 60 },
  { key: "name",      label: "Name",        defaultW: 200, minW: 80 },
  { key: "category",  label: "Category",    defaultW: 120, minW: 60 },
  { key: "type",      label: "Type",        defaultW: 90,  minW: 60 },
  { key: "supplier",  label: "Supplier",    defaultW: 130, minW: 60 },
  { key: "qty",       label: "Qty",         defaultW: 70,  minW: 50, align: "text-right" },
  { key: "reorder",   label: "Reorder",     defaultW: 80,  minW: 50, align: "text-right" },
  { key: "costPrice", label: "Cost Price",  defaultW: 100, minW: 60, align: "text-right" },
  { key: "price",     label: "Sell Price",  defaultW: 100, minW: 60, align: "text-right" },
  { key: "status",    label: "Status",      defaultW: 80,  minW: 60 },
];

function currency(n: number) {
  return "R" + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function Dash() { return <span className="text-muted-foreground/40">&mdash;</span>; }

export function InventoryRegisterPage({ onClose, workspaceId, onOpenItem }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [colWidths, setColWidths] = useState(() => COLUMNS.map(c => c.defaultW));
  const resizeState = useRef<{ colIdx: number; startX: number; startW: number } | null>(null);

  useEffect(() => {
    setLoading(true);
    inventoryService.getAll(workspaceId)
      .then(setItems)
      .catch(e => setError(e?.message || "Failed to load inventory"))
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

  const categories = useMemo(() => Array.from(new Set(items.map(i => i.category).filter(Boolean))).sort(), [items]);

  const filtered = useMemo(() => {
    let rows = items;
    if (categoryFilter !== "all") rows = rows.filter(i => i.category === categoryFilter);
    if (typeFilter !== "all") rows = rows.filter(i => (i.itemType || "inventory") === typeFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(i =>
        [i.name, i.sku, i.category, i.supplier, i.description, i.itemType]
          .some(v => String(v || "").toLowerCase().includes(q))
      );
    }
    const sorted = [...rows].sort((a, b) => {
      const mul = sortAsc ? 1 : -1;
      switch (sortField) {
        case "sku":       return mul * a.sku.localeCompare(b.sku);
        case "name":      return mul * a.name.localeCompare(b.name);
        case "category":  return mul * (a.category || "").localeCompare(b.category || "");
        case "type":      return mul * ((a.itemType || "inventory").localeCompare(b.itemType || "inventory"));
        case "supplier":  return mul * (a.supplier || "").localeCompare(b.supplier || "");
        case "qty":       return mul * (a.quantity - b.quantity);
        case "reorder":   return mul * (a.reorderLevel - b.reorderLevel);
        case "costPrice": return mul * (a.costPrice - b.costPrice);
        case "price":     return mul * (a.price - b.price);
        case "status":    return mul * a.status.localeCompare(b.status);
        default:          return 0;
      }
    });
    return sorted.map((item, i) => ({ item, idx: i + 1 }));
  }, [items, search, categoryFilter, typeFilter, sortField, sortAsc]);

  function cellContent(item: InventoryItem, idx: number, col: SortField) {
    const isLow = item.quantity <= item.reorderLevel;
    switch (col) {
      case "idx":
        return <span className="text-[11px] font-mono text-muted-foreground">{idx}</span>;
      case "sku":
        return <span className="font-mono text-xs text-indigo-300">{item.sku || <Dash />}</span>;
      case "name":
        return <span className="text-xs font-medium text-foreground">{item.name}</span>;
      case "category":
        return <span className="text-xs text-foreground/80">{item.category || <Dash />}</span>;
      case "type":
        return (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize whitespace-nowrap ${
            item.itemType === "service" ? "bg-blue-700/60 text-blue-200" : "bg-muted text-foreground/80"
          }`}>
            {item.itemType || "inventory"}
          </span>
        );
      case "supplier":
        return <span className="text-xs text-muted-foreground">{item.supplier || <Dash />}</span>;
      case "qty":
        return (
          <span className={`text-xs font-mono font-semibold ${isLow ? "text-red-400" : "text-foreground"}`}>
            {item.quantity}
          </span>
        );
      case "reorder":
        return <span className="text-xs font-mono text-muted-foreground">{item.reorderLevel}</span>;
      case "costPrice":
        return <span className="text-xs font-mono text-muted-foreground">{currency(item.costPrice)}</span>;
      case "price":
        return <span className="text-xs font-mono text-green-400">{currency(item.price)}</span>;
      case "status":
        return (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize whitespace-nowrap ${
            item.status === "active" ? "bg-green-800/60 text-green-300" : "bg-muted text-muted-foreground"
          }`}>
            {item.status}
          </span>
        );
      default: return null;
    }
  }

  function SortIcon({ col }: { col: SortField }) {
    if (sortField === col) return sortAsc ? <ChevronUp className="h-3 w-3 text-indigo-400 shrink-0" /> : <ChevronDown className="h-3 w-3 text-indigo-400 shrink-0" />;
    return <ChevronsUpDown className="h-3 w-3 text-muted-foreground/40 shrink-0" />;
  }

  const tableWidth = colWidths.reduce((a, b) => a + b, 0) + 32;
  const lowStockCount = items.filter(i => i.quantity <= i.reorderLevel && i.status === "active" && i.itemType !== "service").length;

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0 flex-wrap gap-y-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 text-muted-foreground hover:text-foreground px-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-orange-400" />
          <span className="font-semibold text-foreground text-base">Inventory Register</span>
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            {filtered.length} / {items.length}
          </span>
          {lowStockCount > 0 && (
            <span className="text-xs bg-red-900/60 text-red-300 border border-red-700/50 rounded-full px-2 py-0.5">
              {lowStockCount} low stock
            </span>
          )}
        </div>

        {/* Type filter */}
        <div className="flex gap-1.5">
          {["all", "inventory", "service"].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors capitalize ${typeFilter === t ? "bg-orange-600 border-orange-500 text-white" : "border-border text-muted-foreground hover:border-border/60"}`}>
              {t === "all" ? "All Types" : t}
            </button>
          ))}
        </div>

        {/* Category filter */}
        {categories.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setCategoryFilter("all")}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${categoryFilter === "all" ? "bg-muted border-border text-foreground" : "border-border text-muted-foreground hover:border-border/60"}`}>
              All Categories
            </button>
            {categories.map(c => (
              <button key={c} onClick={() => setCategoryFilter(p => p === c ? "all" : c)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${categoryFilter === c ? "bg-muted border-border text-foreground" : "border-border text-muted-foreground hover:border-border/60"}`}>
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto relative w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search inventory..."
            className="pl-8 h-8 text-sm bg-card border-border text-foreground placeholder:text-muted-foreground" />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading && <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading inventory…</div>}
        {error && <div className="p-6 text-red-400 text-sm">{error}</div>}
        {!loading && !error && (
          <table className="text-sm border-collapse" style={{ tableLayout: "fixed", width: tableWidth }}>
            <colgroup>
              {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
              <col style={{ width: 32 }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-card border-b border-border">
              <tr>
                {COLUMNS.map((col, colIdx) => (
                  <th key={col.key}
                    style={{ width: colWidths[colIdx], overflow: "hidden" }}
                    className={`relative px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide select-none whitespace-nowrap ${col.align || ""}`}>
                    <div className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => { if (sortField === col.key) setSortAsc(p => !p); else { setSortField(col.key); setSortAsc(true); } }}>
                      <span className="truncate">{col.label}</span>
                      <SortIcon col={col.key} />
                    </div>
                    <div onMouseDown={e => startResize(e, colIdx)}
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize group/resize flex items-center justify-center">
                      <div className="w-px h-4 bg-border group-hover/resize:bg-orange-500 transition-colors" />
                    </div>
                  </th>
                ))}
                <th style={{ width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={COLUMNS.length + 1} className="py-16 text-center text-muted-foreground text-sm">No items found</td></tr>
              )}
              {filtered.map(({ item, idx }, rowIdx) => {
                const isLow = item.quantity <= item.reorderLevel && item.status === "active" && item.itemType !== "service";
                return (
                  <tr key={item.id}
                    onClick={() => onOpenItem?.(item)}
                    className={`border-b border-border group transition-colors ${onOpenItem ? "cursor-pointer" : ""} ${rowIdx % 2 === 0 ? "bg-card/30" : "bg-card/10"} hover:bg-orange-950/20 ${isLow ? "border-l-2 border-l-red-600/40" : ""}`}>
                    {COLUMNS.map((col, colIdx) => (
                      <td key={col.key}
                        style={{ width: colWidths[colIdx], overflow: "hidden" }}
                        className={`px-2 py-1.5 ${col.align || ""}`}>
                        <div className="px-1 py-0.5 min-h-[22px] flex items-center">
                          {cellContent(item, idx, col.key)}
                        </div>
                      </td>
                    ))}
                    <td className="px-1 py-1.5 text-center w-8">
                      {onOpenItem && (
                        <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-orange-400 transition-all p-0.5 rounded" title="Edit item">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-2 flex items-center gap-6 text-[11px] text-muted-foreground">
        <span><span className="text-foreground/80 font-semibold">{filtered.length}</span> items shown</span>
        {(() => {
          const totalValue = filtered.reduce((s, { item }) => s + item.price * item.quantity, 0);
          return totalValue > 0 ? (
            <span>Stock Value: <span className="text-green-400 font-semibold">{currency(totalValue)}</span></span>
          ) : null;
        })()}
        {lowStockCount > 0 && (
          <span className="text-red-400"><span className="font-semibold">{lowStockCount}</span> items at or below reorder level</span>
        )}
        {onOpenItem && <span className="ml-auto text-muted-foreground/50">Click any row to open the item</span>}
      </div>
    </div>
  );
}
