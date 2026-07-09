import { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft, Package, TrendingUp, TrendingDown, AlertTriangle,
  RefreshCw, BarChart2, ChevronDown, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { inventoryService, InventoryItem } from "@/lib/inventoryService";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

interface Props {
  onClose: () => void;
  onGoProducts?: () => void;
  onGoStockMovements?: () => void;
}

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"];
const fmtR = (n: number) => `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const tooltipStyle = { backgroundColor: "#1e293b", border: "1px solid #334155", color: "#f1f5f9", borderRadius: 8 };

function KpiCard({ title, value, sub, icon, color = "text-foreground", warn }: {
  title: string; value: string; sub?: string; icon: React.ReactNode;
  color?: string; warn?: boolean;
}) {
  return (
    <div className={`bg-card border rounded-xl p-4 flex flex-col gap-2 ${warn ? "border-amber-500/60" : "border-border"}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">{title}</span>
        <span className={warn ? "text-amber-400" : "text-muted-foreground"}>{icon}</span>
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function InventoryOverviewPage({ onClose, onGoProducts, onGoStockMovements }: Props) {
  const { workspaceId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    inventoryService.getAll(workspaceId)
      .then(setInventory)
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const active = useMemo(() => inventory.filter(i => i.status === "active"), [inventory]);

  // ── KPIs ──────────────────────────────────────────────────────────────
  const totalStockValue = useMemo(
    () => active.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0),
    [active]
  );
  const totalCostValue = useMemo(
    () => active.filter(i => i.itemType !== "service").reduce((s, i) => s + (i.costPrice || 0) * (i.quantity || 0), 0),
    [active]
  );
  const lowStock = useMemo(
    () => active.filter(i => i.itemType !== "service" && i.quantity > 0 && i.quantity <= (i.reorderLevel || 5)),
    [active]
  );
  const outOfStock = useMemo(() => active.filter(i => i.itemType !== "service" && i.quantity === 0), [active]);

  // ── Category breakdown ────────────────────────────────────────────────
  const categoryData = useMemo(() => {
    const map: Record<string, { count: number; value: number }> = {};
    active.forEach(i => {
      const cat = i.category || "Uncategorised";
      if (!map[cat]) map[cat] = { count: 0, value: 0 };
      map[cat].count += 1;
      map[cat].value += (i.price || 0) * (i.quantity || 0);
    });
    return Object.entries(map)
      .sort((a, b) => b[1].value - a[1].value)
      .map(([fullName, d]) => ({
        fullName,
        name: fullName.length > 16 ? fullName.slice(0, 15) + "…" : fullName,
        Items: d.count,
        Value: Math.round(d.value),
      }));
  }, [active]);

  const categoryItems = useMemo(() =>
    selectedCategory
      ? [...active.filter(i => (i.category || "Uncategorised") === selectedCategory)]
          .sort((a, b) => (b.price * b.quantity) - (a.price * a.quantity))
      : [],
    [active, selectedCategory]
  );

  // ── Category pie ─────────────────────────────────────────────────────
  const categoryPie = useMemo(() =>
    categoryData.map(d => ({ name: d.name, value: d.Items })),
    [categoryData]
  );

  // ── Top items by stock value ──────────────────────────────────────────
  const topByValue = useMemo(() =>
    [...active]
      .filter(i => i.quantity > 0)
      .sort((a, b) => (b.price * b.quantity) - (a.price * a.quantity))
      .slice(0, 10)
      .map(i => ({
        name: (i.name || "").length > 20 ? i.name.slice(0, 19) + "…" : i.name,
        Value: Math.round(i.price * i.quantity),
        Qty: i.quantity,
      })),
    [active]
  );

  // ── Stock level distribution ──────────────────────────────────────────
  const stockDistribution = useMemo(() => {
    const buckets = [
      { label: "0 (Out)", min: 0, max: 0, count: 0 },
      { label: "1–5", min: 1, max: 5, count: 0 },
      { label: "6–20", min: 6, max: 20, count: 0 },
      { label: "21–50", min: 21, max: 50, count: 0 },
      { label: "50+", min: 51, max: Infinity, count: 0 },
    ];
    active.forEach(i => {
      const b = buckets.find(b => i.quantity >= b.min && i.quantity <= b.max);
      if (b) b.count++;
    });
    return buckets.filter(b => b.count > 0).map(b => ({ name: b.label, count: b.count }));
  }, [active]);

  if (loading) {
    return (
      <div className="absolute inset-0 bg-background z-30 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-orange-400" />
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
          <Package className="h-5 w-5 text-orange-400" />
          <div>
            <h1 className="text-lg font-bold text-foreground">Inventory Overview</h1>
            <p className="text-xs text-muted-foreground">Stock levels · Value · Categories · Alerts</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onGoProducts && (
            <Button size="sm" variant="ghost" onClick={onGoProducts} className="text-orange-400 hover:text-orange-300 h-7 text-xs gap-1.5">
              <Package className="h-3.5 w-3.5" /> Products
            </Button>
          )}
          {onGoStockMovements && (
            <Button size="sm" variant="ghost" onClick={onGoStockMovements} className="text-teal-400 hover:text-teal-300 h-7 text-xs gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Stock Updates
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard title="Total Products" value={String(active.length)}
            sub={`${inventory.filter(i => i.status === "inactive").length} inactive`}
            icon={<Package className="h-4 w-4" />} color="text-orange-400" />
          <KpiCard title="Stock Value (Retail)" value={fmtR(totalStockValue)}
            sub="at selling price"
            icon={<TrendingUp className="h-4 w-4" />} color="text-green-400" />
          <KpiCard title="Stock Value (Cost)" value={fmtR(totalCostValue)}
            sub="at cost price"
            icon={<BarChart2 className="h-4 w-4" />} color="text-indigo-400" />
          <KpiCard title="Gross Margin Potential" value={totalCostValue > 0 ? `${Math.round(((totalStockValue - totalCostValue) / totalStockValue) * 100)}%` : "—"}
            sub={fmtR(totalStockValue - totalCostValue) + " potential profit"}
            icon={<TrendingUp className="h-4 w-4" />} color="text-cyan-400" />
          <KpiCard title="Low Stock Items" value={String(lowStock.length)}
            sub="at or below reorder level"
            icon={<AlertTriangle className="h-4 w-4" />}
            color={lowStock.length > 0 ? "text-amber-400" : "text-green-400"}
            warn={lowStock.length > 0} />
          <KpiCard title="Out of Stock" value={String(outOfStock.length)}
            sub="zero quantity"
            icon={<TrendingDown className="h-4 w-4" />}
            color={outOfStock.length > 0 ? "text-red-400" : "text-green-400"}
            warn={outOfStock.length > 0} />
        </div>

        {/* ── Row 1: Category value bars + Pie ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Stock Value by Category</h3>
              <span className="text-[10px] text-muted-foreground">Click a bar to see items</span>
            </div>
            {categoryData.length === 0 ? (
              <div className="flex items-center justify-center h-[230px] text-muted-foreground text-sm">No products yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart
                  data={categoryData}
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  onClick={(data) => {
                    if (data?.activePayload?.[0]?.payload?.fullName) {
                      const clicked = data.activePayload[0].payload.fullName;
                      setSelectedCategory(prev => prev === clicked ? null : clicked);
                    }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `R${(v/1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: string) => name === "Value" ? fmtR(v) : v} />
                  <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                  <Bar dataKey="Value" radius={[4,4,0,0]} maxBarSize={40}>
                    {categoryData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.fullName === selectedCategory ? "#fb923c" : "#f97316"}
                        opacity={selectedCategory && entry.fullName !== selectedCategory ? 0.45 : 1}
                      />
                    ))}
                  </Bar>
                  <Bar dataKey="Items" radius={[4,4,0,0]} maxBarSize={40}>
                    {categoryData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.fullName === selectedCategory ? "#818cf8" : "#6366f1"}
                        opacity={selectedCategory && entry.fullName !== selectedCategory ? 0.45 : 1}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}

            {/* ── Category drill-down panel ── */}
            {selectedCategory && (
              <div className="mt-3 border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
                  <div className="flex items-center gap-2">
                    <ChevronDown className="h-3.5 w-3.5 text-orange-400" />
                    <span className="text-xs font-semibold text-foreground">{selectedCategory}</span>
                    <span className="text-[10px] text-muted-foreground">· {categoryItems.length} items</span>
                  </div>
                  <button onClick={() => setSelectedCategory(null)} className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="overflow-x-auto max-h-56 overflow-y-auto">
                  <table className="w-full text-xs text-foreground/80">
                    <thead className="sticky top-0 bg-card border-b border-border">
                      <tr className="text-muted-foreground">
                        <th className="text-left py-1.5 px-3 font-semibold">Name</th>
                        <th className="text-left py-1.5 px-2 font-semibold">SKU</th>
                        <th className="text-right py-1.5 px-2 font-semibold">Price</th>
                        <th className="text-right py-1.5 px-2 font-semibold">Qty</th>
                        <th className="text-right py-1.5 px-3 font-semibold">Stock Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryItems.map(item => (
                        <tr key={item.id} className="border-b border-border/40 hover:bg-muted/30">
                          <td className="py-1.5 px-3 font-medium text-foreground max-w-[160px] truncate">{item.name}</td>
                          <td className="py-1.5 px-2 text-muted-foreground">{item.sku || "—"}</td>
                          <td className="py-1.5 px-2 text-right">{fmtR(item.price || 0)}</td>
                          <td className={`py-1.5 px-2 text-right font-bold ${item.quantity === 0 ? "text-red-400" : item.quantity <= (item.reorderLevel || 5) ? "text-amber-400" : "text-green-400"}`}>
                            {item.quantity}
                          </td>
                          <td className="py-1.5 px-3 text-right font-semibold text-orange-400">
                            {fmtR((item.price || 0) * (item.quantity || 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Items per Category</h3>
            {categoryPie.length === 0 ? (
              <div className="flex items-center justify-center h-[190px] text-muted-foreground text-sm">No products yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie data={categoryPie} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={45} outerRadius={75} paddingAngle={3}
                    label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                    {categoryPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {categoryPie.map((d, i) => (
                <div key={d.name} className="flex items-center gap-1 text-xs text-foreground/80">
                  <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  {d.name}: <span className="font-semibold">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Row 2: Top items by value + Stock level distribution ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Top 10 Items by Stock Value</h3>
            {topByValue.length === 0 ? (
              <div className="flex items-center justify-center h-[240px] text-muted-foreground text-sm">No stock yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topByValue} layout="vertical" margin={{ top: 4, right: 70, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `R${(v/1000).toFixed(1)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={130} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: string) => name === "Value" ? fmtR(v) : v} />
                  <Bar dataKey="Value" fill="#22c55e" radius={[0,4,4,0]} maxBarSize={20}
                    label={{ position: "right", fill: "#94a3b8", fontSize: 10, formatter: (v: number) => fmtR(v) }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Stock Level Distribution</h3>
            <p className="text-xs text-muted-foreground mb-3">How many products fall in each quantity range</p>
            {stockDistribution.length === 0 ? (
              <div className="flex items-center justify-center h-[240px] text-muted-foreground text-sm">No products yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={stockDistribution} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Products" radius={[4,4,0,0]} maxBarSize={60}>
                    {stockDistribution.map((d, i) => (
                      <Cell key={i} fill={d.name === "0 (Out)" ? "#ef4444" : d.name === "1–5" ? "#f59e0b" : COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Low stock alert table ── */}
        {lowStock.length > 0 && (
          <div className="bg-card border border-amber-500/40 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-amber-400">Low Stock Alert — {lowStock.length} items need attention</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-foreground/80">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1.5 pr-4 font-semibold">Product</th>
                    <th className="text-left py-1.5 pr-4 font-semibold">SKU</th>
                    <th className="text-left py-1.5 pr-4 font-semibold">Category</th>
                    <th className="text-right py-1.5 pr-4 font-semibold">Qty</th>
                    <th className="text-right py-1.5 font-semibold">Reorder At</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.slice(0, 15).map(item => (
                    <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-1.5 pr-4 font-medium text-foreground">{item.name}</td>
                      <td className="py-1.5 pr-4 text-muted-foreground">{item.sku || "—"}</td>
                      <td className="py-1.5 pr-4">{item.category || "—"}</td>
                      <td className={`py-1.5 pr-4 text-right font-bold ${item.quantity === 0 ? "text-red-400" : "text-amber-400"}`}>
                        {item.quantity}
                      </td>
                      <td className="py-1.5 text-right text-muted-foreground">{item.reorderLevel || 5}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="h-4" />
      </div>
    </div>
  );
}
