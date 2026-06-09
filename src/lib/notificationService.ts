import { supabaseServiceRole } from "./supabase";

// Lightweight workspace notification feed (new orders, customer queries, …).
// Stored in the existing workspace_settings table (category 'notifications_feed')
// so it needs no schema migration. Workspace-scoped: every member sees the feed.
// Uses the service-role client so the public store (an anonymous customer) can
// still drop a notification into the owner's workspace when an order is placed.

export interface AppNotification {
  id: string;
  type: "order" | "query" | "info" | "client";
  title: string;
  body?: string;
  link?: string;        // logical target, e.g. "ecommerce" | "crm"
  meta?: Record<string, unknown>; // extra data e.g. { jobNumber: "JOB-1234" }
  read: boolean;
  createdAt: string;    // ISO
}

const CATEGORY = "notifications_feed";
const ECOM_CATEGORY = "ecommerce_notifications_feed";
const MAX_ITEMS = 100;

export async function getNotifications(workspaceId: string): Promise<AppNotification[]> {
  const { data } = await supabaseServiceRole
    .from("workspace_settings")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("category", CATEGORY)
    .maybeSingle();
  const items = (data?.data as { items?: AppNotification[] } | undefined)?.items;
  return Array.isArray(items) ? items : [];
}

async function saveFeed(workspaceId: string, items: AppNotification[]): Promise<void> {
  await supabaseServiceRole.from("workspace_settings").upsert(
    { workspace_id: workspaceId, category: CATEGORY, data: { items: items.slice(0, MAX_ITEMS) }, updated_at: new Date().toISOString() },
    { onConflict: "workspace_id,category" },
  );
}

export async function addNotification(
  workspaceId: string,
  n: { type: AppNotification["type"]; title: string; body?: string; link?: string; meta?: Record<string, unknown>; category?: "ecommerce" | "crm" },
): Promise<void> {
  try {
    const items = await getNotifications(workspaceId);
    const notif: AppNotification = {
      id: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      read: false,
      createdAt: new Date().toISOString(),
      ...n,
    };
    await saveFeed(workspaceId, [notif, ...items]);
  } catch (e) {
    console.error("addNotification failed", e);
  }
}

export async function markAllNotificationsRead(workspaceId: string): Promise<void> {
  const items = await getNotifications(workspaceId);
  if (!items.some((i) => !i.read)) return;
  await saveFeed(workspaceId, items.map((i) => ({ ...i, read: true })));
}

export async function clearNotifications(workspaceId: string): Promise<void> {
  await saveFeed(workspaceId, []);
}

// ─── Ecommerce-isolated feed ──────────────────────────────────────────────────

async function saveEcomFeed(workspaceId: string, items: AppNotification[]): Promise<void> {
  await supabaseServiceRole.from("workspace_settings").upsert(
    { workspace_id: workspaceId, category: ECOM_CATEGORY, data: { items: items.slice(0, MAX_ITEMS) }, updated_at: new Date().toISOString() },
    { onConflict: "workspace_id,category" },
  );
}

export async function getEcommerceNotifications(workspaceId: string): Promise<AppNotification[]> {
  const { data } = await supabaseServiceRole
    .from("workspace_settings")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("category", ECOM_CATEGORY)
    .maybeSingle();
  const items = (data?.data as { items?: AppNotification[] } | undefined)?.items;
  return Array.isArray(items) ? items : [];
}

export async function addEcommerceNotification(
  workspaceId: string,
  n: { type: AppNotification["type"]; title: string; body?: string; link?: string; meta?: Record<string, unknown> },
): Promise<void> {
  try {
    const items = await getEcommerceNotifications(workspaceId);
    const notif: AppNotification = {
      id: `entf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      read: false,
      createdAt: new Date().toISOString(),
      ...n,
    };
    await saveEcomFeed(workspaceId, [notif, ...items]);
  } catch (e) {
    console.error("addEcommerceNotification failed", e);
  }
}

export async function markAllEcommerceNotificationsRead(workspaceId: string): Promise<void> {
  const items = await getEcommerceNotifications(workspaceId);
  if (!items.some((i) => !i.read)) return;
  await saveEcomFeed(workspaceId, items.map((i) => ({ ...i, read: true })));
}

export async function clearEcommerceNotifications(workspaceId: string): Promise<void> {
  await saveEcomFeed(workspaceId, []);
}
