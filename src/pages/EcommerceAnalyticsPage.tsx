import { useState, useEffect, useCallback } from "react";
import {
  X, RefreshCw, Users, Eye, ShoppingCart, CreditCard,
  TrendingUp, Search, ArrowRight, Package, BarChart2, CheckCircle2, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { getStoreAnalytics, StoreAnalytics } from "@/lib/ecommerceAnalyticsService";
import { supabase } from "@/lib/supabase";
import { format, subDays } from "date-fns";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { cn } from "@/lib/utils";

interface Props {
  onClose: () => void;
  onNavigateToProduct?: (searchQuery: string) => void;
}

type Range = '1' | '7' | '30' | '90';

const RANGE_LABELS: Record<Range, string> = { '1': 'Today', '7': '7 days', '30': '30 days', '90': '90 days' };

function KpiCard({ title, value, sub, icon, color = "" }: {
  title: string; value: string | number; sub?: string; icon: React.ReactNode; color?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">{title}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className={cn("text-2xl font-bold", color)}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value.toLocaleString()} <span className="text-muted-foreground font-normal">({pct}%)</span></span>
      </div>
      <div className="w-full bg-muted rounded-full h-2">
        <div className={cn("h-2 rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function EcommerceAnalyticsPage({ onClose, onNavigateToProduct }: Props) {
  const { workspaceId } = useAuth();
  const [range, setRange] = useState<Range>('7');
  const [data, setData] = useState<StoreAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Map of search query (lowercased) → matched product name or null
  const [productMatches, setProductMatches] = useState<Record<string, string | null>>({});

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(false);
    const days = parseInt(range) - 1;
    const dateTo = format(new Date(), 'yyyy-MM-dd');
    const dateFrom = format(subDays(new Date(), days), 'yyyy-MM-dd');
    const result = await getStoreAnalytics(workspaceId, dateFrom, dateTo);
    if (result === null) setError(true);
    else setData(result);
    setLoading(false);
  }, [workspaceId, range]);

  useEffect(() => { load(); }, [load]);

  // When top searches change, look up which ones match a product in inventory
  useEffect(() => {
    if (!workspaceId || !data || data.topSearches.length === 0) return;
    (async () => {
      const { data: products } = await supabase
        .from("inventory_items")
        .select("name")
        .eq("workspace_id", workspaceId);
      if (!products) return;
      const map: Record<string, string | null> = {};
      for (const s of data.topSearches) {
        const q = s.query.toLowerCase();
        const words = q.split(/\s+/).filter(Boolean);
        // Match if any product name contains all query words
        const match = products.find((p: { name: string }) => {
          const pn = p.name.toLowerCase();
          return words.every(w => pn.includes(w));
        });
        map[q] = match ? match.name : null;
      }
      setProductMatches(map);
    })();
  }, [workspaceId, data]);

  const d = data;

  return (
    <div className="absolute inset-0 z-30 bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <BarChart2 className="h-5 w-5 text-teal-500" />
          <div>
            <h1 className="text-lg font-semibold">Store Analytics</h1>
            <p className="text-xs text-muted-foreground">Real visitors only — your team is excluded</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Range selector */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(Object.keys(RANGE_LABELS) as Range[]).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors",
                  range === r
                    ? "bg-teal-600 text-white"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            Could not load analytics — make sure the <code className="font-mono">store_events</code> table exists in Supabase. See setup instructions.
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard title="Visitors" value={loading ? "—" : (d?.uniqueVisitors ?? 0).toLocaleString()} icon={<Users className="h-4 w-4" />} color="text-foreground" />
          <KpiCard title="Page Views" value={loading ? "—" : (d?.totalPageViews ?? 0).toLocaleString()} icon={<Eye className="h-4 w-4" />} color="text-foreground" />
          <KpiCard title="Add to Cart" value={loading ? "—" : (d?.totalAddToCart ?? 0).toLocaleString()} icon={<ShoppingCart className="h-4 w-4 text-blue-400" />} color="text-blue-500" />
          <KpiCard title="Purchases" value={loading ? "—" : (d?.totalPurchases ?? 0).toLocaleString()} icon={<CreditCard className="h-4 w-4 text-green-400" />} color="text-green-500" />
          <KpiCard title="Conversion" value={loading ? "—" : `${(d?.conversionRate ?? 0).toFixed(1)}%`} sub="visitors → purchase" icon={<TrendingUp className="h-4 w-4 text-teal-400" />} color="text-teal-600" />
          <KpiCard title="Registrations" value={loading ? "—" : (d?.totalRegistrations ?? 0).toLocaleString()} icon={<Users className="h-4 w-4 text-violet-400" />} color="text-violet-500" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Conversion funnel */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <ArrowRight className="h-4 w-4 text-muted-foreground" /> Conversion Funnel
            </h2>
            {loading ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
            ) : !d ? null : (
              <div className="space-y-3 pt-1">
                <FunnelBar label="Visitors" value={d.uniqueVisitors} max={d.uniqueVisitors} color="bg-teal-500" />
                <FunnelBar label="Add to Cart" value={d.totalAddToCart} max={d.uniqueVisitors} color="bg-blue-500" />
                <FunnelBar label="Checkout Start" value={d.totalCheckoutStarts} max={d.uniqueVisitors} color="bg-amber-500" />
                <FunnelBar label="Purchases" value={d.totalPurchases} max={d.uniqueVisitors} color="bg-green-500" />
              </div>
            )}
          </div>

          {/* Daily traffic chart */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-4">Daily Traffic</h2>
            {loading ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading…</div>
            ) : !d || d.dailyStats.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={d.dailyStats} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="visitors" stroke="#14b8a6" strokeWidth={2} dot={false} name="Visitors" />
                  <Line type="monotone" dataKey="pageViews" stroke="#6366f1" strokeWidth={2} dot={false} name="Page Views" />
                  <Line type="monotone" dataKey="purchases" stroke="#22c55e" strokeWidth={2} dot={false} name="Purchases" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top products */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" /> Top Products
            </h2>
            {loading ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
            ) : !d || d.topProducts.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No product views yet</p>
            ) : (
              <div className="space-y-0 divide-y divide-border">
                <div className="grid grid-cols-4 gap-2 pb-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  <span className="col-span-2">Product</span>
                  <span className="text-center">Views</span>
                  <span className="text-center">In Cart</span>
                </div>
                {d.topProducts.map(p => (
                  <div key={p.productId} className="grid grid-cols-4 gap-2 py-2 text-sm items-center">
                    <span className="col-span-2 truncate text-xs font-medium">{p.productName}</span>
                    <span className="text-center tabular-nums text-xs">{p.views}</span>
                    <span className="text-center tabular-nums text-xs text-blue-500">{p.addedToCart}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top searches */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" /> Top Searches
            </h2>
            {loading ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
            ) : !d || d.topSearches.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No searches recorded yet</p>
            ) : (
              <div className="space-y-2 mt-1">
                {d.topSearches.map((s, i) => {
                  const q = s.query.toLowerCase();
                  const matchedName = productMatches[q];
                  const hasMatch = matchedName !== undefined;
                  const inStock = hasMatch && matchedName !== null;
                  const clickable = inStock && onNavigateToProduct;
                  return (
                    <div
                      key={s.query}
                      onClick={clickable ? () => { onNavigateToProduct!(matchedName!); onClose(); } : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-2 py-1 -mx-2 transition-colors",
                        clickable && "cursor-pointer hover:bg-accent group"
                      )}
                      title={clickable ? `Open "${matchedName}" in inventory` : undefined}
                    >
                      <span className="text-xs text-muted-foreground w-4 text-right tabular-nums shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 text-xs mb-0.5">
                          <span className={cn("font-medium truncate", clickable && "group-hover:text-teal-500 transition-colors")}>
                            {s.query}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {hasMatch && (
                              inStock ? (
                                <span className="flex items-center gap-0.5 text-[10px] font-medium text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 px-1.5 py-0.5 rounded-full">
                                  <CheckCircle2 className="h-2.5 w-2.5" /> In stock
                                </span>
                              ) : (
                                <span className="flex items-center gap-0.5 text-[10px] font-medium text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 px-1.5 py-0.5 rounded-full">
                                  <XCircle className="h-2.5 w-2.5" /> Not found
                                </span>
                              )
                            )}
                            <span className="text-muted-foreground tabular-nums">{s.count}×</span>
                          </div>
                        </div>
                        <div className="w-full bg-muted rounded-full h-1">
                          <div
                            className={cn("h-1 rounded-full", inStock ? "bg-teal-500" : "bg-violet-500")}
                            style={{ width: `${Math.round((s.count / d.topSearches[0].count) * 100)}%` }}
                          />
                        </div>
                        {inStock && matchedName && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">→ {matchedName}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
