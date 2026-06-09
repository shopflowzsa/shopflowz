import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Save, X, Monitor, Smartphone, Plus, Trash2, Upload, Image as ImageIcon, RotateCcw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { PublicStore } from "@/components/ecommerce/PublicStore";
import { loadEcommerceSettings, saveEcommerceSettings } from "@/lib/ecommerceSettingsService";
import { EcommerceSettings, DEFAULT_ECOMMERCE_SETTINGS } from "@/types/ecommerce";
import { STORE_TEMPLATES } from "@/lib/storeTemplates";
import { uploadImageToCloudinary } from "@/lib/cloudinaryService";

interface Props {
  open: boolean;
  onClose: () => void;
}

const HERO_HEIGHTS = [
  { key: "compact", label: "Compact" },
  { key: "standard", label: "Standard" },
  { key: "tall", label: "Tall" },
  { key: "full", label: "Full screen" },
] as const;

export function StoreDesignStudio({ open, onClose }: Props) {
  const { workspaceId, user, workspace } = useAuth();
  const { toast } = useToast();
  const [draft, setDraft] = useState<EcommerceSettings>(DEFAULT_ECOMMERCE_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [logoUploading, setLogoUploading] = useState(false);
  const [heroUploadingIdx, setHeroUploadingIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !workspaceId) return;
    setLoaded(false);
    loadEcommerceSettings(workspaceId)
      .then((s) => { setDraft(s); setLoaded(true); })
      .catch(() => { setDraft(DEFAULT_ECOMMERCE_SETTINGS); setLoaded(true); });
  }, [open, workspaceId]);

  if (!open) return null;

  const set = <K extends keyof EcommerceSettings>(key: K, val: EcommerceSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: val }));

  const template = STORE_TEMPLATES.find((t) => t.key === (draft.storeTemplate ?? "classic")) ?? STORE_TEMPLATES[0];
  const heroSlides = draft.heroSlides ?? [];
  const addSlide = () => set("heroSlides", [...heroSlides, { image: "", heading: "", subheading: "", ctaText: "Shop Now" }]);
  const removeSlide = (i: number) => set("heroSlides", heroSlides.filter((_, j) => j !== i));
  const updateSlide = (i: number, field: string, val: string) =>
    set("heroSlides", heroSlides.map((s, j) => (j === i ? { ...s, [field]: val } : s)));

  const uploadHero = async (i: number, file: File) => {
    setHeroUploadingIdx(i);
    try {
      const url = await uploadImageToCloudinary(file, `hero/${workspaceId}`);
      if (url) updateSlide(i, "image", url);
    } catch { toast({ title: "Upload failed", variant: "destructive" }); }
    finally { setHeroUploadingIdx(null); }
  };

  const uploadLogo = async (file: File) => {
    setLogoUploading(true);
    try {
      const url = await uploadImageToCloudinary(file, `logos/${workspaceId}`);
      if (url) set("storeLogo" as keyof EcommerceSettings, url as never);
    } catch { toast({ title: "Upload failed", variant: "destructive" }); }
    finally { setLogoUploading(false); }
  };

  const save = async () => {
    if (!workspaceId || !user) return;
    setSaving(true);
    try {
      await saveEcommerceSettings(workspaceId, draft, user.uid);
      toast({ title: "Design saved", description: "Your store has been updated." });
    } catch {
      toast({ title: "Save failed", description: "Please try again.", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const accentDefault = template.accent;

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-white flex flex-col">
      {/* Header bar */}
      <header className="h-14 shrink-0 border-b flex items-center justify-between px-4 bg-white">
        <div className="flex items-center gap-3">
          <span className="font-bold text-gray-900">My Store Design</span>
          <span className="text-xs text-gray-400 hidden sm:inline">Customize your store — preview updates live</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center rounded-md border p-0.5">
            <button onClick={() => setDevice("desktop")} title="Desktop preview"
              className={`p-1.5 rounded ${device === "desktop" ? "bg-gray-900 text-white" : "text-gray-500"}`}><Monitor className="h-4 w-4" /></button>
            <button onClick={() => setDevice("mobile")} title="Mobile preview"
              className={`p-1.5 rounded ${device === "mobile" ? "bg-gray-900 text-white" : "text-gray-500"}`}><Smartphone className="h-4 w-4" /></button>
          </div>
          {workspace?.storeSlug && (
            <a href={`${window.location.origin}/store/${workspace.storeSlug}`} target="_blank" rel="noreferrer"
              className="text-sm text-gray-500 hover:text-gray-900 inline-flex items-center gap-1.5 px-2">
              <ExternalLink className="h-4 w-4" /> Open live
            </a>
          )}
          <Button onClick={save} disabled={saving || !loaded} className="bg-emerald-600 hover:bg-emerald-700">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />} Save
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Settings panel ── */}
        <aside className="w-[360px] shrink-0 border-r overflow-y-auto bg-gray-50 p-4 space-y-6">
          {!loaded ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : (
            <>
              {/* Template */}
              <section className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Template</h3>
                <div className="grid grid-cols-1 gap-2">
                  {STORE_TEMPLATES.map((t) => {
                    const active = (draft.storeTemplate ?? "classic") === t.key;
                    return (
                      <button key={t.key} type="button" onClick={() => set("storeTemplate", t.key)}
                        className={`text-left rounded-lg border p-2.5 transition-all ${active ? "border-emerald-400 ring-2 ring-emerald-200 bg-white" : "bg-white hover:border-gray-300"}`}>
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-3 w-3 rounded-full border shrink-0" style={{ background: t.accent }} />
                          <span className="text-sm font-bold">{t.name}</span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{t.description}</p>
                      </button>
                    );
                  })}
                </div>
              </section>

              <Separator />

              {/* Branding */}
              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Branding</h3>
                <div className="space-y-1.5">
                  <Label className="text-xs">Store name</Label>
                  <Input value={draft.storeName ?? ""} onChange={(e) => set("storeName", e.target.value)} placeholder="My Store" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tagline</Label>
                  <Input value={draft.storeTagline ?? ""} onChange={(e) => set("storeTagline", e.target.value)} placeholder="Short line under your name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Logo</Label>
                  <div className="flex items-center gap-2">
                    <div className="h-12 w-12 rounded-full border bg-white overflow-hidden flex items-center justify-center shrink-0">
                      {(draft as any).storeLogo ? <img src={(draft as any).storeLogo} alt="logo" className="h-full w-full object-contain" /> : <ImageIcon className="h-5 w-5 text-gray-300" />}
                    </div>
                    <label className="text-xs text-blue-600 cursor-pointer hover:underline inline-flex items-center gap-1">
                      {logoUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Upload logo
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ""; }} />
                    </label>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Accent colour</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={draft.accentColor || accentDefault} onChange={(e) => set("accentColor", e.target.value)} className="h-9 w-12 rounded border cursor-pointer" />
                    <Input value={draft.accentColor ?? ""} onChange={(e) => set("accentColor", e.target.value)} placeholder={`Default ${accentDefault}`} className="text-xs font-mono flex-1" />
                    {draft.accentColor && <Button variant="ghost" size="icon" onClick={() => set("accentColor", "")} title="Reset"><RotateCcw className="h-4 w-4" /></Button>}
                  </div>
                </div>
              </section>

              <Separator />

              {/* Hero */}
              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Hero slider</h3>
                {!template.hero && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">The “{template.name}” template doesn’t show a hero. Pick Showcase, Boutique or Bold to use it.</p>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">Height</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {HERO_HEIGHTS.map((h) => {
                      const active = (draft.heroHeight ?? "standard") === h.key;
                      return (
                        <button key={h.key} type="button" onClick={() => set("heroHeight", h.key)}
                          className={`px-2.5 py-1 rounded text-xs border ${active ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-gray-200 hover:bg-gray-50"}`}>{h.label}</button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-xs">Slides</Label>
                  <Button size="sm" variant="outline" className="h-7" onClick={addSlide}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
                </div>
                {heroSlides.length === 0 ? (
                  <p className="text-[11px] text-gray-400 italic">No slides — a styled banner with your store name shows instead.</p>
                ) : (
                  <div className="space-y-2">
                    {heroSlides.map((slide, i) => (
                      <div key={i} className="rounded-lg border bg-white p-2 space-y-1.5">
                        <div className="flex gap-2">
                          <div className="w-16 shrink-0">
                            <div className="aspect-[4/3] rounded border bg-gray-50 overflow-hidden flex items-center justify-center">
                              {slide.image ? <img src={slide.image} alt="" className="w-full h-full object-cover" /> : <ImageIcon className="h-4 w-4 text-gray-300" />}
                            </div>
                            <label className="mt-1 flex items-center justify-center gap-1 text-[10px] text-blue-600 cursor-pointer hover:underline">
                              {heroUploadingIdx === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Upload
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadHero(i, f); e.target.value = ""; }} />
                            </label>
                          </div>
                          <div className="flex-1 space-y-1">
                            <Input value={slide.image} onChange={(e) => updateSlide(i, "image", e.target.value)} placeholder="Image URL" className="h-7 text-[11px] font-mono" />
                            <Input value={slide.heading ?? ""} onChange={(e) => updateSlide(i, "heading", e.target.value)} placeholder="Heading" className="h-7 text-xs" />
                          </div>
                        </div>
                        <Input value={slide.subheading ?? ""} onChange={(e) => updateSlide(i, "subheading", e.target.value)} placeholder="Subheading" className="h-7 text-xs" />
                        <div className="flex gap-1.5">
                          <Input value={slide.ctaText ?? ""} onChange={(e) => updateSlide(i, "ctaText", e.target.value)} placeholder="Button text" className="h-7 text-xs flex-1" />
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 shrink-0" onClick={() => removeSlide(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <Separator />

              {/* Product cards */}
              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Product cards</h3>
                {([
                  { key: "showBrand", label: "Show brand / supplier" },
                  { key: "showSku", label: "Show SKU / part number" },
                  { key: "showQuantity", label: "Show quantity in stock" },
                ] as const).map((opt) => (
                  <div key={opt.key} className="flex items-center justify-between">
                    <Label className="text-xs font-normal">{opt.label}</Label>
                    <Switch checked={(draft as any)[opt.key] ?? false} onCheckedChange={(v) => set(opt.key as keyof EcommerceSettings, v as never)} />
                  </div>
                ))}
              </section>
            </>
          )}
        </aside>

        {/* ── Live preview ── */}
        <main className="flex-1 overflow-auto bg-gray-200 p-0 sm:p-4">
          {!loaded ? (
            <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
          ) : (
            <div
              className={device === "mobile"
                ? "mx-auto w-[390px] max-w-full bg-white rounded-2xl shadow-2xl overflow-hidden ring-1 ring-black/10"
                : "w-full bg-white rounded-lg shadow-xl overflow-hidden ring-1 ring-black/5"}
              // A transform turns this into the containing block for the store's
              // fixed overlays (cart/checkout), so they stay inside the preview.
              style={{ transform: "translateZ(0)" }}
            >
              {workspaceId && <PublicStore workspaceId={workspaceId} previewSettings={draft} />}
            </div>
          )}
        </main>
      </div>
    </div>,
    document.body,
  );
}
