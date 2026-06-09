import { useEffect, useState, Fragment } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, Link } from "react-router-dom";
import { Loader2, RefreshCw, Search, ChevronDown, ExternalLink, LayoutDashboard, Users, Settings, Send, LogOut, CreditCard, Save, LayoutGrid, SlidersHorizontal } from "lucide-react";
import { getAdminWorkspaces, adminUpdateWorkspace, adminSetWorkspaceHiddenFeatures, AdminWorkspace } from "@/lib/storeService";
import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { SIDEBAR_MODULES, MODULE_GROUPS, DEFAULT_PLAN_MODULES, getGlobalDisabledModules, setGlobalDisabledModules } from "@/lib/modules";

const BRAND_TEAL = "#1D9E75";

const PLANS = ["free", "starter", "growth", "pro"] as const;
const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free:    { label: "Free Forever", color: "#6b7280" },
  starter: { label: "Starter",      color: "#3b82f6" },
  growth:  { label: "Growth",       color: BRAND_TEAL },
  pro:     { label: "Pro",          color: "#8b5cf6" },
};

const STATUS_COLORS: Record<string, string> = {
  active:    "#1D9E75",
  trial:     "#f59e0b",
  suspended: "#ef4444",
  expired:   "#ef4444",
  none:      "#9ca3af",
};

export default function AdminPage() {
  const { user, loading, isSystemAdmin, logout } = useAuth();

  // Force light mode on this page
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => { if (wasDark) root.classList.add("dark"); };
  }, []);

  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"businesses" | "modules" | "support" | "billing">("businesses");

  // Module control
  const [globalDisabled, setGlobalDisabled] = useState<string[]>([]);
  const [globalSavingKey, setGlobalSavingKey] = useState<string | null>(null);
  const [expandedModulesWs, setExpandedModulesWs] = useState<string | null>(null);
  const [wsModuleSaving, setWsModuleSaving] = useState<string | null>(null);

  // Billing settings
  const DEFAULT_PLANS = [
    { id: "free",    name: "Free Forever", price: 0,    badge: "No credit card", description: "All features included — free for solo businesses, forever.", features: ["All platform features included", "1 admin (no staff members)", "30 products", "30 invoices / month", "30 quotes / month", "30 tasks / month", "Email support"], highlight: false, cta: "Get Started Free", modules: DEFAULT_PLAN_MODULES.free },
    { id: "starter", name: "Starter",      price: 299,  badge: "",              description: "Perfect for new businesses getting started.",                 features: ["All platform features", "1 admin + 1 staff member", "Up to 500 products", "Unlimited invoices & quotes", "Unlimited tasks & orders", "Email support"], highlight: false, cta: "Get Started", modules: DEFAULT_PLAN_MODULES.starter },
    { id: "growth",  name: "Growth",       price: 799,  badge: "Most popular",  description: "For growing businesses that need more power.",               features: ["Everything in Starter", "1 admin + 4 staff members", "Unlimited products", "Analytics dashboard", "WhatsApp integration", "Priority support"], highlight: true, cta: "Get Started", modules: DEFAULT_PLAN_MODULES.growth },
    { id: "pro",     name: "Pro",          price: 1499, badge: "",              description: "High-volume stores and multi-location businesses.",          features: ["Everything in Growth", "1 admin + 9 staff members", "Custom domain for your store", "Advanced analytics", "Dedicated support"], highlight: false, cta: "Get Started", modules: DEFAULT_PLAN_MODULES.pro },
  ];
  type PlanConfig = typeof DEFAULT_PLANS[number];
  const [billing, setBilling] = useState({ ikhokhaAppId: "", ikhokhaAppSecret: "" });
  const [plans, setPlans] = useState<PlanConfig[]>(DEFAULT_PLANS);
  const [editingPlan, setEditingPlan] = useState<number | null>(null);
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingLoaded, setBillingLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState("");

  // Support tab
  const [supportEmail, setSupportEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");

  const load = async () => {
    setFetching(true);
    const data = await getAdminWorkspaces();
    setWorkspaces(data);
    setFetching(false);
  };

  const loadBilling = async () => {
    const { data } = await supabaseServiceRole.from("platform_settings").select("value").eq("key", "subscription_billing").maybeSingle();
    if (data?.value) {
      const v = data.value;
      setBilling({ ikhokhaAppId: v.ikhokhaAppId ?? "", ikhokhaAppSecret: v.ikhokhaAppSecret ?? "" });
      if (Array.isArray(v.plans) && v.plans.length > 0) {
        // Show the effective module set: fall back to defaults for any plan that
        // has no explicit module list yet, so the checkboxes reflect what the
        // sidebar actually enforces.
        setPlans(v.plans.map((p: PlanConfig) => ({
          ...p,
          modules: (Array.isArray(p.modules) && p.modules.length > 0) ? p.modules : (DEFAULT_PLAN_MODULES[p.id] ?? []),
        })));
      }
    }
    setBillingLoaded(true);
  };

  const saveBilling = async () => {
    setBillingSaving(true);
    await supabaseServiceRole.from("platform_settings").upsert({
      key: "subscription_billing",
      value: { ikhokhaAppId: billing.ikhokhaAppId.trim(), ikhokhaAppSecret: billing.ikhokhaAppSecret.trim(), plans },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    setBillingSaving(false);
    flash("Billing settings saved — landing page will reflect changes immediately");
  };

  function updatePlanField(idx: number, field: string, value: unknown) {
    setPlans((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }

  const loadGlobalModules = async () => {
    try { setGlobalDisabled(await getGlobalDisabledModules()); } catch (e) { console.error(e); }
  };

  useEffect(() => { if (isSystemAdmin) { load(); loadBilling(); loadGlobalModules(); } }, [isSystemAdmin]);

  // Toggle a module globally on/off ("we're working on it")
  async function toggleGlobalModule(key: string) {
    const next = globalDisabled.includes(key)
      ? globalDisabled.filter((k) => k !== key)
      : [...globalDisabled, key];
    setGlobalSavingKey(key);
    const prev = globalDisabled;
    setGlobalDisabled(next); // optimistic
    try {
      await setGlobalDisabledModules(next);
      flash(next.includes(key) ? "Module deactivated globally (in development)" : "Module activated globally");
    } catch {
      setGlobalDisabled(prev); // revert on failure
      flash("Failed to save — try again");
    } finally {
      setGlobalSavingKey(null);
    }
  }

  // Toggle a module for one specific business
  async function toggleWorkspaceModule(ws: AdminWorkspace, key: string) {
    const hidden = ws.hiddenFeatures ?? [];
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setWsModuleSaving(ws.id + ":" + key);
    setWorkspaces((prev) => prev.map((w) => w.id === ws.id ? { ...w, hiddenFeatures: next } : w)); // optimistic
    try {
      await adminSetWorkspaceHiddenFeatures(ws.id, next);
    } catch {
      setWorkspaces((prev) => prev.map((w) => w.id === ws.id ? { ...w, hiddenFeatures: hidden } : w)); // revert
      flash("Failed to save — try again");
    } finally {
      setWsModuleSaving(null);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f9fafb" }}>
        <Loader2 style={{ width: 32, height: 32, color: BRAND_TEAL, animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  if (!user || !isSystemAdmin) return <Navigate to="/login" replace />;

  const filtered = workspaces.filter((w) =>
    w.name.toLowerCase().includes(search.toLowerCase()) ||
    w.ownerEmail.toLowerCase().includes(search.toLowerCase())
  );

  async function updatePlan(wsId: string, plan: string) {
    setSaving(wsId + ":plan");
    await adminUpdateWorkspace(wsId, { plan });
    setWorkspaces((prev) => prev.map((w) => w.id === wsId ? { ...w, plan } : w));
    setSaving(null);
    flash("Plan updated");
  }

  async function toggleCrmAccess(wsId: string, current: boolean) {
    setSaving(wsId + ":crm");
    await adminUpdateWorkspace(wsId, { hasCrmAccess: !current });
    setWorkspaces((prev) => prev.map((w) => w.id === wsId ? { ...w, hasCrmAccess: !current } : w));
    setSaving(null);
    flash(!current ? "CRM access granted" : "CRM access revoked");
  }

  async function toggleStatus(wsId: string, current: string) {
    const next = current === "suspended" ? "active" : "suspended";
    setSaving(wsId + ":status");
    await adminUpdateWorkspace(wsId, { subscriptionStatus: next });
    setWorkspaces((prev) => prev.map((w) => w.id === wsId ? { ...w, subscriptionStatus: next } : w));
    setSaving(null);
    flash(next === "suspended" ? "Account suspended" : "Account reactivated");
  }

  async function sendPasswordReset() {
    setResetLoading(true);
    setResetError("");
    const { error } = await supabase.auth.resetPasswordForEmail(supportEmail, {
      redirectTo: window.location.origin + "/login",
    });
    setResetLoading(false);
    if (error) { setResetError(error.message); return; }
    setResetSent(true);
  }

  function flash(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 2500);
  }

  const statCards = [
    { label: "Total Businesses", value: workspaces.length },
    { label: "Active CRM", value: workspaces.filter((w) => w.hasCrmAccess).length },
    { label: "Paid Plans", value: workspaces.filter((w) => w.plan !== "free").length },
    { label: "Suspended", value: workspaces.filter((w) => w.subscriptionStatus === "suspended").length },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", fontFamily: "Inter, system-ui, sans-serif", color: "#111827" }}>

      {/* Header */}
      <header style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, zIndex: 40 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: BRAND_TEAL, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff", fontSize: 16 }}>S</div>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Shop<span style={{ color: BRAND_TEAL }}>Flowz</span></span>
              <span style={{ marginLeft: 8, fontSize: 12, background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 7px", color: "#6b7280", fontWeight: 600 }}>Admin Portal</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link to="/crm" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none", display: "flex", alignItems: "center", gap: 5 }}>
              <LayoutDashboard size={14} /> CRM
            </Link>
            <button
              onClick={() => logout()}
              style={{ fontSize: 13, color: "#6b7280", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
          {statCards.map((s) => (
            <div key={s.label} style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: "20px 24px" }}>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
          {([["businesses", "Businesses", Users], ["modules", "Modules", LayoutGrid], ["billing", "Billing Settings", CreditCard], ["support", "Login Support", Settings]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 7,
                background: tab === key ? BRAND_TEAL : "#fff",
                color: tab === key ? "#fff" : "#374151",
                boxShadow: tab === key ? "none" : "0 1px 2px rgba(0,0,0,0.06)",
                border: tab === key ? "none" : "1px solid #e5e7eb",
              }}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
          <button
            onClick={load}
            style={{ marginLeft: "auto", padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6b7280" }}
          >
            <RefreshCw size={14} className={fetching ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {/* Success toast */}
        {successMsg && (
          <div style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 14, color: "#065f46", fontWeight: 500 }}>
            ✓ {successMsg}
          </div>
        )}

        {/* ── BUSINESSES TAB ── */}
        {tab === "businesses" && (
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden" }}>
            {/* Search */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 10 }}>
              <Search size={16} style={{ color: "#9ca3af" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by business name or owner email…"
                style={{ border: "none", outline: "none", fontSize: 14, flex: 1, background: "transparent" }}
              />
            </div>

            {fetching ? (
              <div style={{ padding: 48, display: "flex", justifyContent: "center" }}>
                <Loader2 style={{ width: 24, height: 24, color: BRAND_TEAL, animation: "spin 1s linear infinite" }} />
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "1px solid #f3f4f6" }}>
                    {["Business", "Owner", "Plan", "CRM Access", "Status", "Members", "Actions"].map((h) => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>No businesses found</td></tr>
                  )}
                  {filtered.map((ws) => (
                    <Fragment key={ws.id}>
                    <tr style={{ borderBottom: expandedModulesWs === ws.id ? "none" : "1px solid #f3f4f6" }}>
                      {/* Business */}
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: 600 }}>{ws.name}</div>
                        {ws.storeSlug && (
                          <a href={`/store/${ws.storeSlug}`} target="_blank" rel="noreferrer"
                            style={{ fontSize: 11, color: BRAND_TEAL, textDecoration: "none", display: "flex", alignItems: "center", gap: 3, marginTop: 2 }}>
                            /store/{ws.storeSlug} <ExternalLink size={10} />
                          </a>
                        )}
                      </td>

                      {/* Owner */}
                      <td style={{ padding: "14px 16px" }}>
                        <div>{ws.ownerName}</div>
                        <div style={{ color: "#6b7280", fontSize: 12 }}>{ws.ownerEmail}</div>
                      </td>

                      {/* Plan selector */}
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ position: "relative", display: "inline-block" }}>
                          <select
                            value={ws.plan}
                            onChange={(e) => updatePlan(ws.id, e.target.value)}
                            disabled={saving === ws.id + ":plan"}
                            style={{
                              appearance: "none", paddingRight: 24, padding: "4px 28px 4px 10px",
                              border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                              background: "#f9fafb", color: PLAN_LABELS[ws.plan]?.color ?? "#374151",
                            }}
                          >
                            {PLANS.map((p) => <option key={p} value={p}>{PLAN_LABELS[p].label}</option>)}
                          </select>
                          <ChevronDown size={12} style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#6b7280" }} />
                        </div>
                      </td>

                      {/* CRM Access toggle */}
                      <td style={{ padding: "14px 16px" }}>
                        <button
                          onClick={() => toggleCrmAccess(ws.id, ws.hasCrmAccess)}
                          disabled={saving === ws.id + ":crm"}
                          style={{
                            padding: "4px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                            background: ws.hasCrmAccess ? "#d1fae5" : "#fee2e2",
                            color: ws.hasCrmAccess ? "#065f46" : "#991b1b",
                          }}
                        >
                          {ws.hasCrmAccess ? "Enabled" : "Disabled"}
                        </button>
                      </td>

                      {/* Subscription status */}
                      <td style={{ padding: "14px 16px" }}>
                        <button
                          onClick={() => toggleStatus(ws.id, ws.subscriptionStatus)}
                          disabled={saving === ws.id + ":status"}
                          style={{
                            padding: "4px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                            background: ws.subscriptionStatus === "suspended" ? "#fee2e2" : "#f3f4f6",
                            color: STATUS_COLORS[ws.subscriptionStatus] ?? "#374151",
                          }}
                        >
                          {ws.subscriptionStatus === "none" ? "—" : ws.subscriptionStatus}
                        </button>
                      </td>

                      {/* Member count */}
                      <td style={{ padding: "14px 16px", textAlign: "center", color: "#6b7280" }}>
                        {ws.memberCount}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                          <button
                            onClick={() => setExpandedModulesWs(expandedModulesWs === ws.id ? null : ws.id)}
                            style={{ fontSize: 12, color: expandedModulesWs === ws.id ? "#111827" : "#6b7280", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontWeight: 600 }}
                          >
                            <SlidersHorizontal size={12} /> Modules
                            {(() => {
                              const hiddenCount = (ws.hiddenFeatures ?? []).filter((k) => SIDEBAR_MODULES.some((m) => m.key === k)).length;
                              return hiddenCount > 0 ? (
                                <span style={{ fontSize: 10, background: "#fee2e2", color: "#991b1b", borderRadius: 10, padding: "1px 6px", fontWeight: 700 }}>{hiddenCount} off</span>
                              ) : null;
                            })()}
                          </button>
                          <button
                            onClick={() => { setTab("support"); setSupportEmail(ws.ownerEmail); }}
                            style={{ fontSize: 12, color: BRAND_TEAL, background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                          >
                            <Send size={12} /> Support
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedModulesWs === ws.id && (
                      <tr style={{ borderBottom: "1px solid #f3f4f6", background: "#f9fafb" }}>
                        <td colSpan={7} style={{ padding: "16px 20px" }}>
                          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Module access for {ws.name}</div>
                          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14 }}>
                            Untick a module to hide it from this business's CRM sidebar. Globally deactivated modules (Modules tab) stay hidden regardless.
                          </div>
                          {MODULE_GROUPS.map((group) => (
                            <div key={group} style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{group}</div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                                {SIDEBAR_MODULES.filter((m) => m.group === group).map((m) => {
                                  const enabled = !(ws.hiddenFeatures ?? []).includes(m.key);
                                  const globallyOff = globalDisabled.includes(m.key);
                                  const busy = wsModuleSaving === ws.id + ":" + m.key;
                                  return (
                                    <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", color: globallyOff ? "#9ca3af" : "#374151", opacity: busy ? 0.5 : 1 }}>
                                      <input
                                        type="checkbox"
                                        checked={enabled}
                                        disabled={busy}
                                        onChange={() => toggleWorkspaceModule(ws, m.key)}
                                        style={{ width: 15, height: 15, accentColor: BRAND_TEAL }}
                                      />
                                      <span>{m.label}</span>
                                      {globallyOff && <span style={{ fontSize: 9, background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>DEV</span>}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── MODULES TAB (global) ── */}
        {tab === "modules" && (
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 24 }}>
            <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Global Module Control</h3>
            <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 8 }}>
              Turn a module <strong>off</strong> while you're still building it. It disappears from the CRM sidebar for
              <strong> every business</strong> — but stays visible to ShopFlowz admins (you) with a <span style={{ fontSize: 10, background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>DEV</span> badge so you can keep working on it.
            </p>
            <p style={{ color: "#9ca3af", fontSize: 12, marginBottom: 20 }}>
              To hide a module from just one client, use the <strong>Modules</strong> button on the Businesses tab instead.
            </p>

            {MODULE_GROUPS.map((group) => (
              <div key={group} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>{group}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
                  {SIDEBAR_MODULES.filter((m) => m.group === group).map((m) => {
                    const active = !globalDisabled.includes(m.key);
                    const busy = globalSavingKey === m.key;
                    return (
                      <div
                        key={m.key}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                          border: `1px solid ${active ? "#e5e7eb" : "#fcd34d"}`, borderRadius: 10, padding: "12px 14px",
                          background: active ? "#fff" : "#fffbeb", opacity: busy ? 0.6 : 1,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{m.label}</span>
                          {!active && <span style={{ fontSize: 9, background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>DEV</span>}
                        </div>
                        <button
                          onClick={() => toggleGlobalModule(m.key)}
                          disabled={busy}
                          title={active ? "Deactivate globally" : "Activate globally"}
                          style={{
                            position: "relative", width: 42, height: 24, borderRadius: 99, border: "none",
                            cursor: busy ? "default" : "pointer", flexShrink: 0,
                            background: active ? BRAND_TEAL : "#d1d5db", transition: "background 0.15s",
                          }}
                        >
                          <span style={{
                            position: "absolute", top: 3, left: active ? 21 : 3, width: 18, height: 18,
                            borderRadius: "50%", background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                          }} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── SUPPORT TAB ── */}
        {tab === "support" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* Password reset */}
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 24 }}>
              <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Send Password Reset</h3>
              <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 20 }}>
                Send a password reset link to any registered user's email address.
              </p>
              {resetSent ? (
                <div style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 8, padding: "12px 16px", fontSize: 14, color: "#065f46" }}>
                  ✓ Reset link sent to {supportEmail}
                  <br />
                  <button onClick={() => { setResetSent(false); setSupportEmail(""); }} style={{ marginTop: 8, fontSize: 12, color: BRAND_TEAL, background: "none", border: "none", cursor: "pointer" }}>
                    Send another
                  </button>
                </div>
              ) : (
                <>
                  {resetError && (
                    <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#991b1b", marginBottom: 12 }}>
                      {resetError}
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>User Email</label>
                    <input
                      type="email"
                      value={supportEmail}
                      onChange={(e) => setSupportEmail(e.target.value)}
                      placeholder="user@example.com"
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box", outline: "none" }}
                    />
                  </div>
                  <button
                    onClick={sendPasswordReset}
                    disabled={!supportEmail || resetLoading}
                    style={{
                      padding: "9px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600,
                      background: BRAND_TEAL, color: "#fff", display: "flex", alignItems: "center", gap: 8,
                      opacity: (!supportEmail || resetLoading) ? 0.6 : 1,
                    }}
                  >
                    {resetLoading && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
                    Send Reset Link
                  </button>
                </>
              )}
            </div>

            {/* Quick tips */}
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 24 }}>
              <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Support Notes</h3>
              <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 16 }}>Common support actions and where to find them.</p>
              <ul style={{ fontSize: 13, lineHeight: 2, color: "#374151", paddingLeft: 18 }}>
                <li>Change a business's plan → <strong>Businesses tab</strong>, Plan dropdown</li>
                <li>Block a business from logging in → set Status to <strong>Suspended</strong></li>
                <li>Re-enable CRM access → toggle the <strong>CRM Access</strong> button</li>
                <li>Reset a user's password → enter email above and send link</li>
                <li>View all members of a workspace → check <strong>Members</strong> count</li>
              </ul>
            </div>
          </div>
        )}

        {/* ── BILLING SETTINGS TAB ── */}
        {tab === "billing" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* ── Plan editors ── */}
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Subscription Plans</h3>
                  <p style={{ color: "#6b7280", fontSize: 13 }}>Edit pricing, names, features, and badges. Changes go live on the landing page when you save.</p>
                </div>
                <button
                  onClick={saveBilling}
                  disabled={billingSaving}
                  style={{ padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", background: BRAND_TEAL, color: "#fff", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}
                >
                  {billingSaving ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={14} />}
                  Save All Changes
                </button>
              </div>

              {!billingLoaded ? (
                <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: BRAND_TEAL }} />
              ) : (
                <>
                  {/* Plan overview cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
                    {plans.map((plan, i) => (
                      <div
                        key={plan.id}
                        onClick={() => setEditingPlan(editingPlan === i ? null : i)}
                        style={{
                          border: `2px solid ${editingPlan === i ? BRAND_TEAL : "#e5e7eb"}`,
                          borderRadius: 10, padding: 16, cursor: "pointer",
                          background: editingPlan === i ? "#f0fdf9" : plan.highlight ? "#fafff9" : "#fff",
                          transition: "border-color 0.15s",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{plan.name}</div>
                          {plan.highlight && (
                            <span style={{ fontSize: 10, background: "#d1fae5", color: "#065f46", borderRadius: 4, padding: "2px 6px", fontWeight: 700 }}>Featured</span>
                          )}
                        </div>
                        {plan.badge && (
                          <div style={{ fontSize: 10, background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "2px 6px", fontWeight: 600, display: "inline-block", marginBottom: 6 }}>{plan.badge}</div>
                        )}
                        <div style={{ fontSize: 22, fontWeight: 800, color: BRAND_TEAL }}>
                          R{plan.price.toLocaleString()}<span style={{ fontSize: 12, color: "#6b7280", fontWeight: 400 }}>/mo</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>{plan.features.length} features listed</div>
                        <div style={{ marginTop: 8, fontSize: 12, color: BRAND_TEAL, textDecoration: "underline" }}>
                          {editingPlan === i ? "Close ↑" : "Edit →"}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Inline plan editor */}
                  {editingPlan !== null && (
                    <div style={{ background: "#f9fafb", borderRadius: 10, border: `1px solid ${BRAND_TEAL}33`, padding: 20 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, color: BRAND_TEAL }}>
                        Editing: {plans[editingPlan].name}
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div>
                          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Plan Name</label>
                          <input
                            value={plans[editingPlan].name}
                            onChange={(e) => updatePlanField(editingPlan, "name", e.target.value)}
                            style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, boxSizing: "border-box" }}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Price (R / month)</label>
                          <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: 7, overflow: "hidden" }}>
                            <span style={{ padding: "8px 9px", background: "#f3f4f6", fontSize: 12, color: "#6b7280", borderRight: "1px solid #d1d5db" }}>R</span>
                            <input
                              type="number"
                              value={plans[editingPlan].price}
                              onChange={(e) => updatePlanField(editingPlan, "price", Number(e.target.value))}
                              style={{ flex: 1, padding: "8px 10px", border: "none", outline: "none", fontSize: 13 }}
                            />
                          </div>
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Badge Label</label>
                          <input
                            value={plans[editingPlan].badge}
                            onChange={(e) => updatePlanField(editingPlan, "badge", e.target.value)}
                            placeholder='e.g. "Most popular"'
                            style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, boxSizing: "border-box" }}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>CTA Button Text</label>
                          <input
                            value={plans[editingPlan].cta}
                            onChange={(e) => updatePlanField(editingPlan, "cta", e.target.value)}
                            style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, boxSizing: "border-box" }}
                          />
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div>
                          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Short Description</label>
                          <textarea
                            value={plans[editingPlan].description}
                            onChange={(e) => updatePlanField(editingPlan, "description", e.target.value)}
                            rows={3}
                            style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, boxSizing: "border-box", resize: "vertical" }}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Features (one per line)</label>
                          <textarea
                            value={plans[editingPlan].features.join("\n")}
                            onChange={(e) => updatePlanField(editingPlan, "features", e.target.value.split("\n"))}
                            rows={3}
                            style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 13, boxSizing: "border-box", resize: "vertical" }}
                          />
                        </div>
                      </div>

                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", userSelect: "none" }}>
                        <input
                          type="checkbox"
                          checked={plans[editingPlan].highlight}
                          onChange={(e) => updatePlanField(editingPlan, "highlight", e.target.checked)}
                          style={{ width: 15, height: 15 }}
                        />
                        <span>Highlight this plan (shown in brand colour on landing page)</span>
                      </label>

                      {/* Modules included in this tier — shown on the landing page & upgrade dialog */}
                      <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Modules included in this tier</div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
                          Tick what this plan gives access to. These appear as a checklist on the public pricing page and the in-app upgrade dialog.
                        </div>
                        {MODULE_GROUPS.map((group) => (
                          <div key={group} style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{group}</div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                              {SIDEBAR_MODULES.filter((m) => m.group === group).map((m) => {
                                const cur = plans[editingPlan].modules ?? [];
                                const checked = cur.includes(m.key);
                                return (
                                  <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", color: "#374151" }}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => updatePlanField(
                                        editingPlan,
                                        "modules",
                                        checked ? cur.filter((k) => k !== m.key) : [...cur, m.key],
                                      )}
                                      style={{ width: 15, height: 15, accentColor: BRAND_TEAL }}
                                    />
                                    <span>{m.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── iKhokha + How it works ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 24 }}>
                <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>iKhokha API Credentials</h3>
                <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 20 }}>
                  Used to generate subscription payment links for your clients.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>iKhokha App ID</label>
                    <input
                      value={billing.ikhokhaAppId}
                      onChange={(e) => setBilling((b) => ({ ...b, ikhokhaAppId: e.target.value }))}
                      placeholder="IK91VB0TW4CJ..."
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 }}>iKhokha App Secret</label>
                    <input
                      type="password"
                      value={billing.ikhokhaAppSecret}
                      onChange={(e) => setBilling((b) => ({ ...b, ikhokhaAppSecret: e.target.value }))}
                      placeholder="••••••••••••••••"
                      style={{ width: "100%", padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 24 }}>
                <h3 style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>How subscription billing works</h3>
                <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 16 }}>End-to-end flow from client upgrade to activation.</p>
                <ol style={{ fontSize: 13, lineHeight: 2, color: "#374151", paddingLeft: 20, margin: 0 }}>
                  <li>Client clicks <strong>Upgrade Plan</strong> in their CRM sidebar</li>
                  <li>They select a plan (Starter / Growth / Pro)</li>
                  <li>App calls iKhokha API to create a unique payment link</li>
                  <li>Client is redirected to iKhokha to pay</li>
                  <li>iKhokha fires a webhook to ShopFlowz with payment confirmation</li>
                  <li>Subscription activated: plan updated + <strong>30-day expiry set</strong></li>
                  <li>On expiry, plan automatically reverts to <strong>Free Forever</strong></li>
                </ol>
                <div style={{ marginTop: 16, background: "#f0fdf4", borderRadius: 8, padding: "12px 14px", fontSize: 12, color: "#065f46" }}>
                  <strong>Webhook URL</strong> (set in iKhokha dashboard as callback URL):<br />
                  <code style={{ fontSize: 11, wordBreak: "break-all" }}>
                    https://omqqbinhevyuyfgqvkqk.supabase.co/functions/v1/ikhokha-webhook
                  </code>
                </div>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
