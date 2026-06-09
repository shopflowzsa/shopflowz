import { supabase, supabaseServiceRole } from './supabase';

export type StoreEventType =
  | 'page_view'
  | 'product_view'
  | 'search'
  | 'add_to_cart'
  | 'checkout_start'
  | 'purchase'
  | 'registration';

interface TrackArgs {
  workspaceId: string;
  sessionId: string;
  browserId: string;
  eventType: StoreEventType;
  productId?: string;
  productName?: string;
  searchQuery?: string;
}

export function getOrCreateSessionId(): string {
  try {
    const key = 'sf_store_session';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch { return 'unknown'; }
}

export async function trackStoreEvent(args: TrackArgs): Promise<void> {
  try {
    await supabase.from('store_events').insert({
      workspace_id: args.workspaceId,
      session_id: args.sessionId,
      browser_id: args.browserId,
      event_type: args.eventType,
      product_id: args.productId ?? null,
      product_name: args.productName ?? null,
      search_query: args.searchQuery ?? null,
    });
  } catch { /* silently fail — analytics must never break the store */ }
}

export interface StoreAnalytics {
  totalPageViews: number;
  uniqueVisitors: number;
  totalSearches: number;
  totalAddToCart: number;
  totalCheckoutStarts: number;
  totalPurchases: number;
  totalRegistrations: number;
  conversionRate: number;
  topProducts: { productId: string; productName: string; views: number; addedToCart: number; purchased: number }[];
  topSearches: { query: string; count: number }[];
  dailyStats: { date: string; visitors: number; pageViews: number; purchases: number }[];
}

export async function getStoreAnalytics(
  workspaceId: string,
  dateFrom: string,
  dateTo: string,
): Promise<StoreAnalytics | null> {
  try {
    const { data: events, error } = await supabaseServiceRole
      .from('store_events')
      .select('session_id, event_type, product_id, product_name, search_query, created_at')
      .eq('workspace_id', workspaceId)
      .gte('created_at', `${dateFrom}T00:00:00Z`)
      .lte('created_at', `${dateTo}T23:59:59Z`);

    if (error || !events) return null;

    const empty: StoreAnalytics = {
      totalPageViews: 0, uniqueVisitors: 0, totalSearches: 0,
      totalAddToCart: 0, totalCheckoutStarts: 0, totalPurchases: 0,
      totalRegistrations: 0, conversionRate: 0,
      topProducts: [], topSearches: [], dailyStats: [],
    };
    if (events.length === 0) return empty;

    const uniqueSessions = new Set(events.map(e => e.session_id)).size;
    const byType = (type: string) => events.filter(e => e.event_type === type);

    // Top products
    const productMap = new Map<string, { productId: string; productName: string; views: number; addedToCart: number; purchased: number }>();
    for (const e of events) {
      if (!e.product_id) continue;
      if (!productMap.has(e.product_id)) {
        productMap.set(e.product_id, { productId: e.product_id, productName: e.product_name || e.product_id, views: 0, addedToCart: 0, purchased: 0 });
      }
      const p = productMap.get(e.product_id)!;
      if (e.event_type === 'product_view') p.views++;
      if (e.event_type === 'add_to_cart') p.addedToCart++;
      if (e.event_type === 'purchase') p.purchased++;
    }
    const topProducts = [...productMap.values()].sort((a, b) => b.views - a.views).slice(0, 10);

    // Top searches
    const searchMap = new Map<string, number>();
    for (const e of byType('search')) {
      const q = ((e.search_query as string) ?? '').toLowerCase().trim();
      if (q.length >= 2) searchMap.set(q, (searchMap.get(q) ?? 0) + 1);
    }
    const topSearches = [...searchMap.entries()]
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Daily stats
    const dailyMap = new Map<string, { sessions: Set<string>; pageViews: number; purchases: number }>();
    for (const e of events) {
      const date = (e.created_at as string).slice(0, 10);
      if (!dailyMap.has(date)) dailyMap.set(date, { sessions: new Set(), pageViews: 0, purchases: 0 });
      const d = dailyMap.get(date)!;
      d.sessions.add(e.session_id as string);
      if (e.event_type === 'page_view') d.pageViews++;
      if (e.event_type === 'purchase') d.purchases++;
    }
    const dailyStats = [...dailyMap.entries()]
      .map(([date, d]) => ({ date, visitors: d.sessions.size, pageViews: d.pageViews, purchases: d.purchases }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const searches = byType('search');
    const purchases = byType('purchase');

    return {
      totalPageViews: byType('page_view').length,
      uniqueVisitors: uniqueSessions,
      totalSearches: searches.length,
      totalAddToCart: byType('add_to_cart').length,
      totalCheckoutStarts: byType('checkout_start').length,
      totalPurchases: purchases.length,
      totalRegistrations: byType('registration').length,
      conversionRate: uniqueSessions > 0 ? (purchases.length / uniqueSessions) * 100 : 0,
      topProducts,
      topSearches,
      dailyStats,
    };
  } catch { return null; }
}
