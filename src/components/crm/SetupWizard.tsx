import { useState, useEffect } from "react";
import {
  ChevronRight, ChevronLeft, X, Check, Store, Link2, ImageIcon, Package, CreditCard,
  Sparkles, Upload, Minimize2, Zap, FileText, Users, MessageSquare, Receipt,
  Shield, User, Crown, ClipboardList,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { loadEcommerceSettings, saveEcommerceSettings } from "@/lib/ecommerceSettingsService";
import { updateStoreSlug } from "@/lib/storeService";
import { uploadImageToCloudinary } from "@/lib/cloudinaryService";
import { cn } from "@/lib/utils";

interface Props {
  onOpenInventory: () => void;
  onOpenEcommerceSettings: () => void;
  onOpenInvoicing: () => void;
  onOpenManageUsers: () => void;
  onOpenForms: () => void;
  onOpenWhatsApp: () => void;
  onDone: () => void;
}

const STEPS = [
  { id: "welcome",   icon: Sparkles,      label: "Welcome",    color: "#a78bfa" },
  { id: "storeinfo", icon: Store,         label: "Store Info", color: "#34d399" },
  { id: "storeurl",  icon: Link2,         label: "URL",        color: "#60a5fa" },
  { id: "logo",      icon: ImageIcon,     label: "Logo",       color: "#f472b6" },
  { id: "products",  icon: Package,       label: "Products",   color: "#fb923c" },
  { id: "payment",   icon: CreditCard,    label: "Payment",    color: "#facc15" },
  { id: "invoicing", icon: Receipt,       label: "Invoicing",  color: "#818cf8" },
  { id: "team",      icon: Users,         label: "Team",       color: "#38bdf8" },
  { id: "forms",     icon: ClipboardList, label: "Forms",      color: "#e879f9" },
  { id: "whatsapp",  icon: MessageSquare, label: "WhatsApp",   color: "#4ade80" },
  { id: "done",      icon: Check,         label: "Done!",      color: "#4ade80" },
];

const SAM_MESSAGES = [
  "Hey! I'm Sam — your setup guide. I'll get your entire business platform running in minutes. Let's go! 🚀",
  "Let's start with the basics — your business name and contact info. This shows on your store and all your documents.",
  "Now let's create your store URL. This is the link you share with customers to visit your online shop.",
  "Upload your logo — it appears in your store header and on every invoice and quote. Makes everything look professional instantly.",
  "Time to add products! Open inventory, add items with prices and photos, set them to Active, and come back here.",
  "Want customers to pay online? Connect iKhokha for card payments. You can skip this and set it up later — no pressure.",
  "Invoicing is fully built in — no extra tools needed! Create quotes, convert them to invoices, and track every payment.",
  "Add your team! Each person gets their own login with permissions you control. Never share your password again.",
  "Forms let customers or staff create CRM tasks without touching the app. Perfect for job bookings, repair requests, or intake forms.",
  "Send quotes, invoices, and order updates directly to customers via WhatsApp — in one click from any document.",
  "Your business is fully set up! 🎉 Here's a summary of everything that's ready and waiting for you.",
];

export function SetupWizard({
  onOpenInventory, onOpenEcommerceSettings, onOpenInvoicing,
  onOpenManageUsers, onOpenForms, onOpenWhatsApp, onDone,
}: Props) {
  const { workspaceId, workspace, user } = useAuth();
  const [step, setStep]         = useState(0);
  const [minimised, setMinimised] = useState(false);
  const [saving, setSaving]     = useState(false);

  const [storeName, setStoreName]         = useState("");
  const [storePhone, setStorePhone]       = useState("");
  const [storeWhatsApp, setStoreWhatsApp] = useState("");
  const [storeEmail, setStoreEmail]       = useState("");
  const [storeAddress, setStoreAddress]   = useState("");
  const [slug, setSlug]                   = useState("");
  const [slugError, setSlugError]         = useState("");
  const [logoUrl, setLogoUrl]             = useState("");
  const [logoFile, setLogoFile]           = useState<File | null>(null);
  const [uploading, setUploading]         = useState(false);
  const [ikhokhaId, setIkhokhaId]         = useState("");
  const [ikhokhaSecret, setIkhokhaSecret] = useState("");

  useEffect(() => {
    if (!workspaceId) return;
    loadEcommerceSettings(workspaceId).then(s => {
      if (s.storeName)      setStoreName(s.storeName);
      if (s.storePhone)     setStorePhone(s.storePhone);
      if (s.storeWhatsApp)  setStoreWhatsApp(s.storeWhatsApp);
      if (s.storeEmail)     setStoreEmail(s.storeEmail);
      if (s.storeAddress)   setStoreAddress(s.storeAddress);
      if ((s as any).storeLogo)      setLogoUrl((s as any).storeLogo);
      if (s.ikhokhaAppId)            setIkhokhaId(s.ikhokhaAppId);
      if (s.ikhokhaAppSecret)        setIkhokhaSecret(s.ikhokhaAppSecret);
    }).catch(() => {});
    if (workspace?.storeSlug) setSlug(workspace.storeSlug);
  }, [workspaceId, workspace]);

  async function saveStoreInfo() {
    if (!workspaceId || !storeName.trim()) return;
    setSaving(true);
    try {
      const current = await loadEcommerceSettings(workspaceId);
      await saveEcommerceSettings(workspaceId, {
        ...current, storeName: storeName.trim(), storePhone: storePhone.trim(),
        storeWhatsApp: storeWhatsApp.trim(), storeEmail: storeEmail.trim(),
        storeAddress: storeAddress.trim(),
      }, user?.uid || "system");
      next();
    } finally { setSaving(false); }
  }

  async function saveSlug() {
    if (!workspaceId || !slug.trim()) { setSlugError("Enter a store URL slug"); return; }
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    setSaving(true); setSlugError("");
    try {
      const err = await updateStoreSlug(workspaceId, clean);
      if (err) { setSlugError(err); return; }
      next();
    } finally { setSaving(false); }
  }

  async function saveLogo() {
    if (!workspaceId) return;
    setSaving(true);
    try {
      let url = logoUrl;
      if (logoFile) {
        setUploading(true);
        url = await uploadImageToCloudinary(logoFile, `workspaces/${workspaceId}/logo`);
        setLogoUrl(url); setUploading(false);
      }
      if (url) {
        const current = await loadEcommerceSettings(workspaceId);
        await saveEcommerceSettings(workspaceId, { ...current, storeLogo: url } as any, user?.uid || "system");
      }
      next();
    } finally { setSaving(false); setUploading(false); }
  }

  async function savePayment() {
    if (!workspaceId) return;
    if (ikhokhaId.trim() || ikhokhaSecret.trim()) {
      setSaving(true);
      try {
        const current = await loadEcommerceSettings(workspaceId);
        await saveEcommerceSettings(workspaceId, {
          ...current, ikhokhaAppId: ikhokhaId.trim(), ikhokhaAppSecret: ikhokhaSecret.trim(),
        }, user?.uid || "system");
      } finally { setSaving(false); }
    }
    next();
  }

  async function markDone() {
    if (!workspaceId) return;
    await supabaseServiceRole.from("workspace_settings").upsert(
      { workspace_id: workspaceId, category: "setup_wizard", data: { completed: true, completedAt: new Date().toISOString() } },
      { onConflict: "workspace_id,category" }
    );
    onDone();
  }

  function next() { setStep(s => Math.min(s + 1, STEPS.length - 1)); }
  function prev() { setStep(s => Math.max(s - 1, 0)); }

  const storeUrl = workspace?.storeSlug ? `https://shopflowz.web.app/store/${workspace.storeSlug}` : null;

  // ── Minimised orb ──────────────────────────────────────────────────────────
  if (minimised) {
    return (
      <button
        onClick={() => setMinimised(false)}
        className="fixed bottom-6 right-6 z-50 h-16 w-16 rounded-full flex items-center justify-center text-2xl shadow-2xl border border-white/20 hover:scale-110 transition-all duration-300"
        style={{
          background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)",
          boxShadow: "0 0 30px rgba(139,92,246,0.6), 0 0 60px rgba(6,182,212,0.3)",
          animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
        }}
        title="Open setup guide"
      >
        🤖
      </button>
    );
  }

  // ── Main panel ─────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-[420px] rounded-3xl overflow-hidden"
      style={{
        background: "rgba(10, 10, 20, 0.94)",
        backdropFilter: "blur(24px)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.08)",
        maxHeight: "90vh",
        overflowY: "auto",
      }}
    >
      {/* Animated top gradient bar */}
      <div
        className="h-1 w-full"
        style={{
          background: "linear-gradient(90deg, #6366f1, #8b5cf6, #06b6d4, #10b981)",
          backgroundSize: "300% 100%",
          animation: "gradientShift 3s ease infinite",
        }}
      />

      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center text-base shrink-0"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)", boxShadow: "0 0 16px rgba(99,102,241,0.5)" }}
          >
            🤖
          </div>
          <div>
            <p className="text-white text-sm font-semibold leading-tight">Sam · Setup Guide</p>
            <p className="text-xs" style={{ color: "#6366f1" }}>Step {step + 1} of {STEPS.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMinimised(true)} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={markDone} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Close wizard">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Progress dots */}
      <div className="px-5 pb-3">
        <div className="flex items-center gap-1 mb-3">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              onClick={() => i < step && setStep(i)}
              className={cn("transition-all duration-300 rounded-full", i < step ? "cursor-pointer" : "")}
              style={{
                height: 5,
                flex: i === step ? 3 : 1,
                background: i === step
                  ? "linear-gradient(90deg, #6366f1, #06b6d4)"
                  : i < step ? "#10b981" : "rgba(255,255,255,0.1)",
                boxShadow: i === step ? "0 0 8px rgba(99,102,241,0.6)" : undefined,
              }}
            />
          ))}
        </div>

        {/* Sam speech bubble */}
        <div
          className="rounded-2xl p-3.5 mb-4"
          style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}
        >
          <div className="flex items-start gap-2.5">
            <div
              className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-sm mt-0.5"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: "0 0 12px rgba(99,102,241,0.4)" }}
            >
              🤖
            </div>
            <p className="text-sm leading-relaxed" style={{ color: "#c7d2fe" }}>
              {SAM_MESSAGES[step]}
            </p>
          </div>
        </div>

        {/* ── STEP CONTENT ── */}

        {/* Step 0 — Welcome */}
        {step === 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: "🏪", label: "Your Store",    desc: "Branded storefront live in minutes" },
                { icon: "🧾", label: "Invoicing",     desc: "Quotes & invoices with PDF & email" },
                { icon: "📦", label: "Inventory",     desc: "Products, stock levels & barcodes" },
                { icon: "👥", label: "CRM & Team",    desc: "Staff logins & customer management" },
                { icon: "💬", label: "WhatsApp",      desc: "Send docs directly via WhatsApp" },
                { icon: "📊", label: "Analytics",     desc: "Sales, stock & performance reports" },
              ].map(item => (
                <div
                  key={item.label}
                  className="rounded-xl p-2.5 text-center"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div className="text-lg mb-1">{item.icon}</div>
                  <p className="text-xs font-semibold text-white leading-tight">{item.label}</p>
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{item.desc}</p>
                </div>
              ))}
            </div>
            <button
              onClick={next}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)", boxShadow: "0 0 24px rgba(99,102,241,0.4)" }}
            >
              <Zap className="h-4 w-4" /> Let's Set Everything Up
            </button>
          </div>
        )}

        {/* Step 1 — Store Info */}
        {step === 1 && (
          <div className="space-y-2.5">
            <Field label="Business name *" value={storeName} onChange={setStoreName} placeholder="e.g. Cape Audio Repairs" />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Phone" value={storePhone} onChange={setStorePhone} placeholder="071 234 5678" />
              <Field label="WhatsApp" value={storeWhatsApp} onChange={setStoreWhatsApp} placeholder="071 234 5678" />
            </div>
            <Field label="Email" value={storeEmail} onChange={setStoreEmail} placeholder="info@yourbusiness.co.za" />
            <Field label="Address" value={storeAddress} onChange={setStoreAddress} placeholder="123 Main Rd, Cape Town" />
            <NavButtons onBack={prev} onNext={saveStoreInfo} disabled={saving || !storeName.trim()} label={saving ? "Saving…" : "Save & Continue"} />
          </div>
        )}

        {/* Step 2 — Store URL */}
        {step === 2 && (
          <div className="space-y-2.5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: "#94a3b8" }}>Your store web address</label>
              <div
                className="flex items-center rounded-xl overflow-hidden"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <span className="px-3 text-xs py-2.5 shrink-0" style={{ color: "#64748b", borderRight: "1px solid rgba(255,255,255,0.08)" }}>
                  shopflowz.web.app/store/
                </span>
                <input
                  className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white outline-none placeholder-gray-600"
                  placeholder="your-business"
                  value={slug}
                  onChange={e => { setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-")); setSlugError(""); }}
                />
              </div>
              {slugError && <p className="text-xs text-red-400">{slugError}</p>}
              <p className="text-xs" style={{ color: "#475569" }}>Lowercase letters, numbers and dashes only.</p>
            </div>
            <NavButtons onBack={prev} onNext={saveSlug} disabled={saving || !slug.trim()} label={saving ? "Saving…" : "Save & Continue"} />
          </div>
        )}

        {/* Step 3 — Logo */}
        {step === 3 && (
          <div className="space-y-2.5">
            <label
              className="flex flex-col items-center justify-center gap-2 cursor-pointer rounded-xl py-6 transition-colors hover:border-indigo-500"
              style={{ border: "2px dashed rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}
            >
              {logoUrl || logoFile ? (
                <img src={logoFile ? URL.createObjectURL(logoFile) : logoUrl} alt="Logo" className="h-16 w-16 rounded-xl object-cover" />
              ) : (
                <>
                  <Upload className="h-8 w-8" style={{ color: "#6366f1" }} />
                  <span className="text-sm" style={{ color: "#64748b" }}>Click to upload your logo</span>
                </>
              )}
              <input type="file" className="hidden" accept="image/*" onChange={e => { if (e.target.files?.[0]) setLogoFile(e.target.files[0]); }} />
            </label>
            <div className="flex gap-2">
              <button onClick={prev} className="px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button onClick={next} className="flex-1 py-2.5 rounded-xl text-sm text-gray-400 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                Skip
              </button>
              <button onClick={saveLogo} disabled={saving || uploading} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:scale-[1.02] disabled:opacity-50" style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)", boxShadow: "0 0 16px rgba(99,102,241,0.3)" }}>
                {uploading ? "Uploading…" : saving ? "Saving…" : "Save & Continue"}
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — Products */}
        {step === 4 && (
          <div className="space-y-3">
            <div className="rounded-xl p-3 text-sm space-y-1.5" style={{ background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.2)" }}>
              <p className="font-semibold text-xs" style={{ color: "#fb923c" }}>In Inventory, for each product:</p>
              {["Click + Add Item", "Give it a name and price", "Add a photo (shows in your store)", "Set status to Active"].map((s, i) => (
                <p key={i} className="text-xs flex items-center gap-1.5" style={{ color: "#94a3b8" }}>
                  <span className="text-[10px] font-bold" style={{ color: "#fb923c" }}>{i + 1}.</span> {s}
                </p>
              ))}
            </div>
            <button
              onClick={() => { onOpenInventory(); setMinimised(true); }}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
              style={{ background: "linear-gradient(135deg, #f97316, #fb923c)", boxShadow: "0 0 20px rgba(249,115,22,0.3)" }}
            >
              <Package className="h-4 w-4" /> Open Inventory
            </button>
            <div className="flex gap-2">
              <button onClick={prev} className="px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button onClick={next} className="flex-1 py-2.5 rounded-xl text-sm text-gray-400 hover:text-white font-medium transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                Done adding products →
              </button>
            </div>
          </div>
        )}

        {/* Step 5 — Payment (iKhokha) */}
        {step === 5 && (
          <div className="space-y-2.5">
            <div className="rounded-xl p-3 space-y-1.5" style={{ background: "rgba(250,204,21,0.06)", border: "1px solid rgba(250,204,21,0.15)" }}>
              <p className="text-xs font-semibold" style={{ color: "#facc15" }}>What iKhokha enables:</p>
              {["Online card payments from your store", "Payment links sent via WhatsApp or email", "Automatic payment confirmation on orders"].map((item, i) => (
                <p key={i} className="text-xs flex items-center gap-1.5 text-gray-400">
                  <Check className="h-3 w-3 text-yellow-400 shrink-0" /> {item}
                </p>
              ))}
            </div>
            <Field label="iKhokha App ID" value={ikhokhaId} onChange={setIkhokhaId} placeholder="Your iKhokha App ID" />
            <Field label="iKhokha App Secret" value={ikhokhaSecret} onChange={setIkhokhaSecret} placeholder="••••••••" type="password" />
            <p className="text-xs" style={{ color: "#475569" }}>Find these in your iKhokha merchant dashboard → API credentials.</p>
            <div className="flex gap-2">
              <button onClick={prev} className="px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button onClick={next} className="flex-1 py-2.5 rounded-xl text-sm text-gray-400 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                Skip for now
              </button>
              <button onClick={savePayment} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:scale-[1.02] disabled:opacity-50" style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)", boxShadow: "0 0 16px rgba(99,102,241,0.3)" }}>
                {saving ? "Saving…" : "Save & Continue"}
              </button>
            </div>
          </div>
        )}

        {/* Step 6 — Invoicing & Quotes */}
        {step === 6 && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: "📄", label: "Quotes",   desc: "Create & send branded quotes instantly" },
                { icon: "🧾", label: "Invoices", desc: "Convert quotes with one click, track payments" },
                { icon: "📊", label: "Reports",  desc: "Statements, overdue alerts & sales history" },
              ].map(item => (
                <div key={item.label} className="rounded-xl p-2.5 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="text-lg mb-1">{item.icon}</div>
                  <p className="text-xs font-semibold text-white leading-tight">{item.label}</p>
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{item.desc}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl p-3 space-y-1.5" style={{ background: "rgba(129,140,248,0.08)", border: "1px solid rgba(129,140,248,0.15)" }}>
              <p className="text-xs font-semibold" style={{ color: "#818cf8" }}>All handled automatically:</p>
              {["VAT calculations (15% or your custom rate)", "PDF generation — download or print", "Email & WhatsApp delivery in one click", "Payment tracking with overdue reminders", "Inventory stock deducted on each invoice"].map((item, i) => (
                <p key={i} className="text-xs flex items-center gap-1.5 text-gray-400">
                  <Check className="h-3 w-3 text-indigo-400 shrink-0" /> {item}
                </p>
              ))}
            </div>
            <button
              onClick={() => { onOpenInvoicing(); setMinimised(true); }}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
              style={{ background: "linear-gradient(135deg, #6366f1, #818cf8)", boxShadow: "0 0 20px rgba(99,102,241,0.3)" }}
            >
              <FileText className="h-4 w-4" /> Open Invoicing
            </button>
            <div className="flex gap-2">
              <button onClick={prev} className="px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button onClick={next} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-300 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                Got it, continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 7 — Team Members */}
        {step === 7 && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: Crown,  label: "Owner",  desc: "Full access, billing, all settings", color: "#facc15" },
                { icon: Shield, label: "Admin",  desc: "Manage users, settings & all data", color: "#60a5fa" },
                { icon: User,   label: "Staff",  desc: "Custom permissions per module",     color: "#34d399" },
              ].map(({ icon: Icon, label, desc, color }) => (
                <div key={label} className="rounded-xl p-2.5 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <Icon className="h-5 w-5 mx-auto mb-1" style={{ color }} />
                  <p className="text-xs font-semibold text-white leading-tight">{label}</p>
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{desc}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl p-3 space-y-1.5" style={{ background: "rgba(56,189,248,0.07)", border: "1px solid rgba(56,189,248,0.15)" }}>
              <p className="text-xs font-semibold" style={{ color: "#38bdf8" }}>What team members can access:</p>
              {[
                "Each staff member gets their own login — no shared passwords",
                "You control access to CRM, inventory, invoicing, analytics per person",
                "Staff can't see areas you haven't given them permission to",
                "Invite by email — they set their own password",
              ].map((item, i) => (
                <p key={i} className="text-xs flex items-center gap-1.5 text-gray-400">
                  <Check className="h-3 w-3 text-sky-400 shrink-0" /> {item}
                </p>
              ))}
            </div>
            <button
              onClick={() => { onOpenManageUsers(); setMinimised(true); }}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
              style={{ background: "linear-gradient(135deg, #0ea5e9, #38bdf8)", boxShadow: "0 0 20px rgba(14,165,233,0.3)" }}
            >
              <Users className="h-4 w-4" /> Invite Team Members
            </button>
            <div className="flex gap-2">
              <button onClick={prev} className="px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button onClick={next} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-300 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                I'll do this later →
              </button>
            </div>
          </div>
        )}

        {/* Step 8 — Forms */}
        {step === 8 && (
          <div className="space-y-3">
            <div className="rounded-xl p-3.5" style={{ background: "rgba(232,121,249,0.08)", border: "1px solid rgba(232,121,249,0.2)" }}>
              <p className="text-xs font-semibold mb-2" style={{ color: "#e879f9" }}>What is a Form?</p>
              <p className="text-xs text-gray-300 leading-relaxed">
                A Form is a shareable link — like a mini web page — that anyone can fill in to create a task directly in your CRM. No app needed. No login required.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: "🔧", label: "Repair Intake",   desc: "Customer fills in device fault details → task created automatically" },
                { icon: "📅", label: "Job Booking",     desc: "Book an appointment — appears in your CRM as a new task" },
                { icon: "🛠️", label: "Staff Report",    desc: "Technician fills in a job card from their phone — no login needed" },
                { icon: "📋", label: "Any Custom Form", desc: "You design the fields — name, phone, notes, dropdowns, photos" },
              ].map(item => (
                <div key={item.label} className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="text-lg mb-1">{item.icon}</div>
                  <p className="text-xs font-semibold text-white leading-tight">{item.label}</p>
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{item.desc}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl p-3 space-y-1.5" style={{ background: "rgba(232,121,249,0.06)", border: "1px solid rgba(232,121,249,0.12)" }}>
              <p className="text-xs font-semibold" style={{ color: "#e879f9" }}>How to set one up:</p>
              {[
                "Open Forms in the Settings menu",
                "Click + New Form and name it (e.g. 'Repair Request')",
                "Add the fields you need — text, phone, dropdown, photo upload",
                "Share the link via WhatsApp, email, or add to your website",
                "Every submission creates a task in your CRM automatically",
              ].map((item, i) => (
                <p key={i} className="text-xs flex items-start gap-1.5 text-gray-400">
                  <span className="text-[10px] font-bold shrink-0 mt-0.5" style={{ color: "#e879f9" }}>{i + 1}.</span> {item}
                </p>
              ))}
            </div>
            <button
              onClick={() => { onOpenForms(); setMinimised(true); }}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
              style={{ background: "linear-gradient(135deg, #a21caf, #e879f9)", boxShadow: "0 0 20px rgba(168,85,247,0.3)" }}
            >
              <ClipboardList className="h-4 w-4" /> Open Forms Builder
            </button>
            <div className="flex gap-2">
              <button onClick={prev} className="px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button onClick={next} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-300 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                I'll do this later →
              </button>
            </div>
          </div>
        )}

        {/* Step 9 — WhatsApp (step index 9) */}
        {step === 9 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: "📤", label: "Send Quotes",    desc: "Send any quote directly to a customer's WhatsApp" },
                { icon: "🧾", label: "Send Invoices",  desc: "Share invoices with payment links via WhatsApp" },
                { icon: "📦", label: "Order Updates",  desc: "Notify customers when orders are ready to collect" },
                { icon: "🤖", label: "Chat Bot",       desc: "Let customers browse products & place orders via WA" },
              ].map(item => (
                <div key={item.label} className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="text-lg mb-1">{item.icon}</div>
                  <p className="text-xs font-semibold text-white leading-tight">{item.label}</p>
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{item.desc}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl p-3 space-y-1.5" style={{ background: "rgba(74,222,128,0.07)", border: "1px solid rgba(74,222,128,0.15)" }}>
              <p className="text-xs font-semibold" style={{ color: "#4ade80" }}>How to connect:</p>
              {[
                "Go to WhatsApp Settings in the sidebar",
                "Enter your business WhatsApp number",
                "Connect via QR code or API key",
                "All documents get a 'Send via WhatsApp' button",
              ].map((item, i) => (
                <p key={i} className="text-xs flex items-center gap-1.5 text-gray-400">
                  <span className="text-[10px] font-bold" style={{ color: "#4ade80" }}>{i + 1}.</span> {item}
                </p>
              ))}
            </div>
            <button
              onClick={() => { onOpenWhatsApp(); setMinimised(true); }}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
              style={{ background: "linear-gradient(135deg, #16a34a, #4ade80)", boxShadow: "0 0 20px rgba(22,163,74,0.3)" }}
            >
              <MessageSquare className="h-4 w-4" /> Open WhatsApp Settings
            </button>
            <div className="flex gap-2">
              <button onClick={prev} className="px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button onClick={next} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-300 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.05)" }}>
                I'll do this later →
              </button>
            </div>
          </div>
        )}

        {/* Step 10 — Done */}
        {step === 10 && (
          <div className="space-y-3">
            <div
              className="rounded-2xl p-4"
              style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(99,102,241,0.08))", border: "1px solid rgba(16,185,129,0.2)" }}
            >
              <div className="text-3xl text-center mb-2">🎉</div>
              <p className="font-bold text-white text-center mb-3">You're all set up!</p>
              <div className="space-y-1.5">
                {[
                  { icon: "🏪", label: "Online Store",    done: !!storeName,              hint: "Add store name to activate" },
                  { icon: "🔗", label: "Store URL",       done: !!workspace?.storeSlug,   hint: "Set a URL to share" },
                  { icon: "📦", label: "Products",        done: true,                      hint: "" },
                  { icon: "🧾", label: "Invoicing",       done: true,                      hint: "" },
                  { icon: "👥", label: "Team Management", done: true,                      hint: "" },
                  { icon: "📋", label: "Forms (Task intake)", done: true,                  hint: "" },
                  { icon: "💬", label: "WhatsApp",        done: true,                      hint: "" },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-2.5">
                    <span className="text-sm">{item.icon}</span>
                    <span className="flex-1 text-xs text-gray-300">{item.label}</span>
                    {item.done ? (
                      <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
                    ) : (
                      <span className="text-[10px] text-gray-500">{item.hint}</span>
                    )}
                  </div>
                ))}
              </div>
              {storeUrl && (
                <div className="mt-3 pt-3 border-t border-white/10">
                  <p className="text-xs text-gray-500 mb-1">Your live store:</p>
                  <a href={storeUrl} target="_blank" rel="noopener noreferrer" className="text-xs break-all hover:underline" style={{ color: "#34d399" }}>
                    {storeUrl}
                  </a>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { onOpenEcommerceSettings(); setMinimised(true); }}
                className="py-2.5 rounded-xl text-sm text-gray-300 hover:text-white font-medium transition-colors"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                ⚙️ More Settings
              </button>
              <button
                onClick={markDone}
                className="py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-1.5 transition-all hover:scale-[1.02]"
                style={{ background: "linear-gradient(135deg, #10b981, #06b6d4)", boxShadow: "0 0 20px rgba(16,185,129,0.3)" }}
              >
                <Check className="h-4 w-4" /> Done!
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes gradientShift {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 30px rgba(139,92,246,0.6), 0 0 60px rgba(6,182,212,0.3); }
          50%       { box-shadow: 0 0 50px rgba(139,92,246,0.9), 0 0 80px rgba(6,182,212,0.5); }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium" style={{ color: "#94a3b8" }}>{label}</label>
      <input
        type={type}
        className="w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none placeholder-gray-600 transition-colors"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
        onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
      />
    </div>
  );
}

function NavButtons({ onBack, onNext, disabled, label }: {
  onBack: () => void; onNext: () => void; disabled?: boolean; label: string;
}) {
  return (
    <div className="flex gap-2 pt-1">
      <button
        onClick={onBack}
        className="px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:text-white transition-colors"
        style={{ background: "rgba(255,255,255,0.05)" }}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        onClick={onNext} disabled={disabled}
        className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-1.5 transition-all hover:scale-[1.02] disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)", boxShadow: "0 0 16px rgba(99,102,241,0.3)" }}
      >
        {label} <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
