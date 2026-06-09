import { supabaseServiceRole } from "./supabase";

export async function getWorkspaceBySlug(slug: string): Promise<string | null> {
  const { data } = await supabaseServiceRole
    .from("workspaces")
    .select("id")
    .eq("store_slug", slug)
    .eq("store_enabled", true)
    .maybeSingle();
  return data?.id ?? null;
}

export async function getWorkspaceByDomain(domain: string): Promise<string | null> {
  const { data } = await supabaseServiceRole
    .from("workspaces")
    .select("id")
    .eq("custom_domain", domain)
    .eq("store_enabled", true)
    .maybeSingle();
  return data?.id ?? null;
}

export async function getWorkspaceInfoByDomain(domain: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabaseServiceRole
    .from("workspaces")
    .select("id, name")
    .eq("custom_domain", domain)
    .eq("store_enabled", true)
    .maybeSingle();
  return data ? { id: data.id, name: data.name ?? "" } : null;
}

export async function updateStoreSlug(
  workspaceId: string,
  slug: string
): Promise<void> {
  const { error } = await supabaseServiceRole
    .from("workspaces")
    .update({ store_slug: slug, store_enabled: true })
    .eq("id", workspaceId);
  if (error) throw error;
}

export async function saveCustomDomain(
  workspaceId: string,
  domain: string,
  status: "none" | "pending" | "active"
): Promise<void> {
  const { error } = await supabaseServiceRole
    .from("workspaces")
    .update({ custom_domain: domain || null, custom_domain_status: status })
    .eq("id", workspaceId);
  if (error) throw error;
}

export async function setCustomDomainEnabled(
  workspaceId: string,
  enabled: boolean
): Promise<void> {
  const { error } = await supabaseServiceRole
    .from("workspaces")
    .update({ custom_domain_enabled: enabled })
    .eq("id", workspaceId);
  if (error) throw error;
}

export async function getAllWorkspacesForAdmin(): Promise<{
  id: string;
  name: string;
  storeSlug: string | null;
  customDomain: string | null;
  customDomainEnabled: boolean;
  customDomainStatus: string;
  storeEnabled: boolean;
}[]> {
  const { data } = await supabaseServiceRole
    .from("workspaces")
    .select("id, name, store_slug, custom_domain, custom_domain_enabled, custom_domain_status, store_enabled")
    .order("name");
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    storeSlug: r.store_slug ?? null,
    customDomain: r.custom_domain ?? null,
    customDomainEnabled: r.custom_domain_enabled ?? false,
    customDomainStatus: r.custom_domain_status ?? "none",
    storeEnabled: r.store_enabled ?? false,
  }));
}

export type AdminWorkspace = {
  id: string;
  name: string;
  plan: string;
  hasCrmAccess: boolean;
  storeEnabled: boolean;
  createdAt: string;
  ownerEmail: string;
  ownerName: string;
  memberCount: number;
  storeSlug: string | null;
  customDomain: string | null;
  subscriptionStatus: string;
  hiddenFeatures: string[];
};

export async function getAdminWorkspaces(): Promise<AdminWorkspace[]> {
  const { data: workspaces } = await supabaseServiceRole
    .from("workspaces")
    .select("id, name, plan, has_crm_access, store_enabled, created_at, store_slug, custom_domain, subscription_status")
    .order("created_at", { ascending: false });

  if (!workspaces?.length) return [];

  const { data: members } = await supabaseServiceRole
    .from("workspace_members")
    .select("workspace_id, uid, email, display_name, role");

  // Per-business module access lives in workspace_settings (category 'subscription')
  const { data: subSettings } = await supabaseServiceRole
    .from("workspace_settings")
    .select("workspace_id, data")
    .eq("category", "subscription");

  return workspaces.map((ws) => {
    const wsMembers = (members ?? []).filter((m) => m.workspace_id === ws.id);
    const owner = wsMembers.find((m) => m.role === "owner");
    const sub = (subSettings ?? []).find((s) => s.workspace_id === ws.id);
    const hidden = (sub?.data as { hiddenFeatures?: string[] } | undefined)?.hiddenFeatures;
    return {
      id: ws.id,
      name: ws.name,
      plan: ws.plan ?? "free",
      hasCrmAccess: ws.has_crm_access ?? false,
      storeEnabled: ws.store_enabled ?? false,
      createdAt: ws.created_at ?? "",
      ownerEmail: owner?.email ?? "—",
      ownerName: owner?.display_name ?? "—",
      memberCount: wsMembers.length,
      storeSlug: ws.store_slug ?? null,
      customDomain: ws.custom_domain ?? null,
      subscriptionStatus: ws.subscription_status ?? "none",
      hiddenFeatures: Array.isArray(hidden) ? hidden : [],
    };
  });
}

/**
 * Set which modules are hidden for one business. Writes to workspace_settings
 * (category 'subscription') — the same place AuthContext reads `hiddenFeatures`
 * from, so the change reflects on the client's next workspace resolve.
 */
export async function adminSetWorkspaceHiddenFeatures(
  workspaceId: string,
  hiddenFeatures: string[]
): Promise<void> {
  const { data: existing } = await supabaseServiceRole
    .from("workspace_settings")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("category", "subscription")
    .maybeSingle();
  const merged = { ...((existing?.data as Record<string, unknown>) || {}), hiddenFeatures };
  const { error } = await supabaseServiceRole.from("workspace_settings").upsert(
    { workspace_id: workspaceId, category: "subscription", data: merged },
    { onConflict: "workspace_id,category" },
  );
  if (error) throw error;
}

export async function adminUpdateWorkspace(
  workspaceId: string,
  updates: Partial<{ plan: string; hasCrmAccess: boolean; storeEnabled: boolean; subscriptionStatus: string }>
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.plan !== undefined) dbUpdates.plan = updates.plan;
  if (updates.hasCrmAccess !== undefined) dbUpdates.has_crm_access = updates.hasCrmAccess;
  if (updates.storeEnabled !== undefined) dbUpdates.store_enabled = updates.storeEnabled;
  if (updates.subscriptionStatus !== undefined) dbUpdates.subscription_status = updates.subscriptionStatus;
  const { error } = await supabaseServiceRole.from("workspaces").update(dbUpdates).eq("id", workspaceId);
  if (error) throw error;
}

export async function adminSendPasswordReset(email: string): Promise<void> {
  const { error } = await supabaseServiceRole.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: window.location.origin + "/login" },
  });
  if (error) throw error;
}
