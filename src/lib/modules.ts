import { supabaseServiceRole } from "./supabase";

// ── Sidebar module registry ───────────────────────────────────────────────────
// Canonical list of toggleable CRM sidebar modules. Two layers of control:
//   1. Per-business  — stored in workspace_settings (category 'subscription') as
//      `hiddenFeatures: string[]`. A key in that array hides the module for that
//      one business.
//   2. Global        — stored in platform_settings (key 'module_flags') as
//      `{ disabled: string[] }`. A key here means "we're still building this":
//      hidden for every client business, but ShopFlowz system admins still see it
//      (marked with a DEV badge) so they can keep working on it.
//
// The keys for sales / inventory / analytics / tech_assessment / banking are kept
// stable — existing workspace hiddenFeatures data already uses them.

export interface ModuleDef {
  key: string;
  label: string;
  group: string;
}

export const SIDEBAR_MODULES: ModuleDef[] = [
  { key: "crm",                   label: "CRM (Tasks & Folders)", group: "Core" },
  { key: "email",                 label: "Email",                 group: "Core" },
  { key: "ecommerce",             label: "Ecommerce",             group: "Core" },
  { key: "settings",              label: "Settings",              group: "Core" },

  { key: "sales",                 label: "Sales & Invoicing",     group: "Sales & Finance" },
  { key: "banking",               label: "Banking & Matching",    group: "Sales & Finance" },

  { key: "inventory",             label: "Inventory",             group: "Operations" },
  { key: "business_planning",     label: "Business Planning",     group: "Operations" },
  { key: "job_register",          label: "Job Register",          group: "Operations" },
  { key: "outstanding_tasks",     label: "Outstanding Tasks",     group: "Operations" },

  { key: "analytics",             label: "Business Performance",  group: "Analytics" },
  { key: "staff_reports",         label: "Staff Reports",         group: "Analytics" },
  { key: "performance_analytics", label: "Performance Analytics", group: "Analytics" },

  { key: "tech_assessment",       label: "Tech Assessment",       group: "Tools & AI" },
  { key: "tech_datasheets",       label: "Tech Data Sheets",      group: "Tools & AI" },
  { key: "ai_bot_warnings",       label: "AI Bot Warnings",       group: "Tools & AI" },
  { key: "ai_assistant",          label: "AI Assistant",          group: "Tools & AI" },
  { key: "custom_ai_agents",      label: "Custom AI Agents",      group: "Tools & AI" },

  { key: "whatsapp",              label: "WhatsApp",              group: "Channels & Devices" },
  { key: "printer",               label: "Printer",               group: "Channels & Devices" },
];

export const MODULE_LABELS: Record<string, string> = Object.fromEntries(
  SIDEBAR_MODULES.map((m) => [m.key, m.label]),
);

export const MODULE_GROUPS: string[] = SIDEBAR_MODULES.reduce<string[]>((acc, m) => {
  if (!acc.includes(m.group)) acc.push(m.group);
  return acc;
}, []);

// ── Plan entitlements ─────────────────────────────────────────────────────────
// Which modules each subscription tier includes. The admin Billing editor can
// override these per plan (saved into subscription_billing.plans[].modules);
// these defaults are the fallback when a plan has no explicit module list yet.
export const DEFAULT_PLAN_MODULES: Record<string, string[]> = {
  free:    ["crm", "email", "ecommerce", "settings", "sales", "inventory", "job_register", "printer"],
  starter: ["crm", "email", "ecommerce", "settings", "sales", "inventory", "job_register", "printer", "business_planning", "outstanding_tasks", "ai_assistant", "custom_ai_agents"],
  growth:  ["crm", "email", "ecommerce", "settings", "sales", "inventory", "job_register", "printer", "business_planning", "outstanding_tasks", "ai_assistant", "custom_ai_agents", "banking", "analytics", "staff_reports", "performance_analytics", "ai_bot_warnings", "whatsapp"],
  pro:     SIDEBAR_MODULES.map((m) => m.key),
};

/**
 * Map of plan key → allowed module keys. Reads the admin-configured tier
 * checkboxes from subscription_billing.plans and falls back to
 * DEFAULT_PLAN_MODULES for any plan without an explicit list.
 */
export async function getPlanModuleMap(): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = { ...DEFAULT_PLAN_MODULES };
  try {
    const { data } = await supabaseServiceRole
      .from("platform_settings")
      .select("value")
      .eq("key", "subscription_billing")
      .maybeSingle();
    const plans = (data?.value as { plans?: Array<{ id?: string; key?: string; modules?: string[] }> } | undefined)?.plans;
    if (Array.isArray(plans)) {
      for (const p of plans) {
        const id = p.id ?? p.key;
        if (id && Array.isArray(p.modules) && p.modules.length > 0) map[id] = p.modules;
      }
    }
  } catch (e) {
    console.error("getPlanModuleMap failed", e);
  }
  return map;
}

const GLOBAL_MODULES_KEY = "module_flags";

/** Modules globally turned off ("in development") — hidden for all client businesses. */
export async function getGlobalDisabledModules(): Promise<string[]> {
  const { data } = await supabaseServiceRole
    .from("platform_settings")
    .select("value")
    .eq("key", GLOBAL_MODULES_KEY)
    .maybeSingle();
  const v = data?.value as { disabled?: string[] } | undefined;
  return Array.isArray(v?.disabled) ? v!.disabled! : [];
}

export async function setGlobalDisabledModules(disabled: string[]): Promise<void> {
  const { error } = await supabaseServiceRole.from("platform_settings").upsert(
    { key: GLOBAL_MODULES_KEY, value: { disabled }, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) throw error;
}
