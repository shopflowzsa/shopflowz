import { useEffect, useState } from "react";
import { Loader2, Check, Zap, X, AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseServiceRole } from "@/lib/supabase";
import { MODULE_LABELS } from "@/lib/modules";

const BRAND_TEAL = "#1D9E75";

const DEFAULT_PLANS = [
  {
    key: "starter",
    name: "Starter",
    price: 299,
    color: "#3b82f6",
    badge: null as string | null,
    highlight: false,
    cta: "Pay with iKhokha",
    features: ["All features", "1 admin + 1 staff", "500 products", "Unlimited invoices & orders"],
    modules: ["crm", "email", "ecommerce", "settings", "sales", "inventory", "job_register", "business_planning", "outstanding_tasks", "ai_assistant"],
  },
  {
    key: "growth",
    name: "Growth",
    price: 799,
    color: BRAND_TEAL,
    badge: "Most popular",
    highlight: true,
    cta: "Pay with iKhokha",
    features: ["Everything in Starter", "1 admin + 4 staff", "Unlimited products", "Analytics + WhatsApp"],
    modules: ["crm", "email", "ecommerce", "settings", "sales", "inventory", "job_register", "business_planning", "outstanding_tasks", "ai_assistant", "banking", "analytics", "staff_reports", "performance_analytics", "ai_bot_warnings"],
  },
  {
    key: "pro",
    name: "Pro",
    price: 1499,
    color: "#8b5cf6",
    badge: null as string | null,
    highlight: false,
    cta: "Pay with iKhokha",
    features: ["Everything in Growth", "1 admin + 9 staff", "Custom domain", "White-label invoices"],
    modules: ["crm", "email", "ecommerce", "settings", "sales", "banking", "inventory", "business_planning", "job_register", "outstanding_tasks", "analytics", "staff_reports", "performance_analytics", "tech_assessment", "tech_datasheets", "ai_bot_warnings", "ai_assistant"],
  },
];

interface PlanConfig {
  key: string;
  name: string;
  price: number;
  color: string;
  badge: string | null;
  highlight: boolean;
  cta: string;
  features: string[];
  modules: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function UpgradePlanDialog({ open, onClose }: Props) {
  const { workspace } = useAuth();
  const [plans, setPlans] = useState<PlanConfig[]>(DEFAULT_PLANS);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Load plans dynamically from platform_settings (same source as LandingPage and AdminPage)
  useEffect(() => {
    if (!open) return;
    supabaseServiceRole
      .from("platform_settings")
      .select("value")
      .eq("key", "subscription_billing")
      .maybeSingle()
      .then(({ data }) => {
        if (!Array.isArray(data?.value?.plans) || data.value.plans.length === 0) return;
        setPlans(
          data.value.plans.map((p: any, i: number) => ({
            key: p.key ?? ["starter", "growth", "pro"][i] ?? `plan_${i}`,
            name: p.name ?? `Plan ${i + 1}`,
            price: p.price ?? 0,
            color: p.highlight ? BRAND_TEAL : DEFAULT_PLANS[i]?.color ?? "#6b7280",
            badge: p.badge || null,
            highlight: !!p.highlight,
            cta: p.cta || "Pay with iKhokha",
            features: Array.isArray(p.features) ? p.features : (DEFAULT_PLANS[i]?.features ?? []),
            modules: Array.isArray(p.modules) ? p.modules : (DEFAULT_PLANS[i]?.modules ?? []),
          }))
        );
      });
  }, [open]);

  if (!open) return null;

  const currentPlan = workspace?.plan ?? "free";
  const daysLeft = workspace?.subscriptionExpiresAt
    ? Math.max(0, Math.ceil((new Date(workspace.subscriptionExpiresAt).getTime() - Date.now()) / 86400000))
    : null;

  async function handleUpgrade(planKey: string) {
    if (!workspace?.id) return;
    setLoading(planKey);
    setError("");
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-subscription-paylink`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ workspaceId: workspace.id, plan: planKey }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to create payment link");
      if (!data.paylinkUrl) throw new Error("No payment URL returned from iKhokha");
      window.location.href = data.paylinkUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setLoading(null);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 16, padding: 32, maxWidth: 700, width: "100%", position: "relative", boxShadow: "0 25px 50px rgba(0,0,0,0.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "#6b7280" }}>
          <X size={20} />
        </button>

        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 20, padding: "6px 14px", marginBottom: 12 }}>
            <Zap size={14} style={{ color: BRAND_TEAL }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: BRAND_TEAL }}>Upgrade your plan</span>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "#111827" }}>Choose your ShopFlowz plan</h2>
          {currentPlan !== "free" && daysLeft !== null && (
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
              Current plan: <strong style={{ textTransform: "capitalize" }}>{currentPlan}</strong> — {daysLeft} day{daysLeft !== 1 ? "s" : ""} remaining
            </p>
          )}
          {currentPlan === "free" && (
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>You're on the Free Forever plan</p>
          )}
        </div>

        {error && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <AlertCircle size={16} style={{ color: "#991b1b", flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ fontSize: 13, color: "#991b1b", fontWeight: 600, margin: "0 0 2px" }}>Payment failed</p>
              <p style={{ fontSize: 12, color: "#7f1d1d", margin: 0 }}>{error}</p>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: `repeat(${plans.length}, 1fr)`, gap: 12 }}>
          {plans.map((plan) => {
            const isCurrent = currentPlan === plan.key;
            const isLoading = loading === plan.key;
            return (
              <div
                key={plan.key}
                style={{
                  border: `2px solid ${plan.highlight || isCurrent ? plan.color : "#e5e7eb"}`,
                  borderRadius: 12, padding: 20, position: "relative",
                  background: isCurrent ? `${plan.color}10` : plan.highlight ? `${plan.color}06` : "#fff",
                }}
              >
                {plan.badge && !isCurrent && (
                  <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: plan.color, color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
                    {plan.badge}
                  </div>
                )}
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: plan.color }}>{plan.name}</div>
                <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>
                  R{plan.price.toLocaleString()}<span style={{ fontSize: 12, fontWeight: 400, color: "#6b7280" }}>/mo</span>
                </div>
                <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, fontSize: 12, lineHeight: 1.9 }}>
                  {plan.features.map((f) => (
                    <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                      <Check size={12} style={{ color: plan.color, marginTop: 3, flexShrink: 0 }} />
                      <span style={{ color: "#374151" }}>{f}</span>
                    </li>
                  ))}
                </ul>
                {plan.modules.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 6px" }}>
                      Modules included
                    </div>
                    <ul style={{ listStyle: "none", margin: "0 0 16px", padding: 0, fontSize: 12, lineHeight: 1.9 }}>
                      {plan.modules.map((key) => (
                        <li key={key} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                          <Check size={12} style={{ color: plan.color, marginTop: 3, flexShrink: 0 }} />
                          <span style={{ color: "#374151" }}>{MODULE_LABELS[key] ?? key}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <button
                  onClick={() => !isCurrent && handleUpgrade(plan.key)}
                  disabled={isCurrent || !!loading}
                  style={{
                    width: "100%", padding: "9px 0", borderRadius: 8, border: "none",
                    cursor: isCurrent ? "default" : "pointer",
                    fontWeight: 700, fontSize: 13,
                    background: isCurrent ? "#f3f4f6" : plan.color,
                    color: isCurrent ? "#9ca3af" : "#fff",
                    opacity: (loading && !isLoading) ? 0.5 : 1,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    transition: "opacity 0.15s",
                  }}
                >
                  {isLoading && <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
                  {isCurrent ? "Current plan" : isLoading ? "Creating payment link…" : plan.cta}
                </button>
              </div>
            );
          })}
        </div>

        <p style={{ textAlign: "center", fontSize: 12, color: "#9ca3af", marginTop: 20, marginBottom: 0 }}>
          30-day subscription · Secure payment via iKhokha · Reverts to Free Forever on expiry
        </p>
      </div>
    </div>
  );
}
