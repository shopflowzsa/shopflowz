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
  { key: "compact", label: "Compact", hint: "2400×320px" },
  { key: "standard", label: "Standard", hint: "2400×480px" },
  { key: "tall", label: "Tall", hint: "2400×620px" },
  { key: "full", label: "Full screen", hint: "2400×900px" },
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
  const [overlayUploadingIdx, setOverlayUploadingIdx] = useState<number | null>(null);
  const [editingSlideIdx, setEditingSlideIdx] = useState<number | null>(null);

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
      if (url) {
        // Auto-size: fill-width shows the full image at full banner width,
        // clipping only the bottom if the image is taller than the banner.
        const heroSlides = draft.heroSlides ?? [];
        const updated = heroSlides.map((s, j) => j === i
          ? { ...s, image: url, imageFit: "fill-width", imagePosition: "top", imageWidth: 100, imageHeight: 100 }
          : s
        );
        set("heroSlides", updated);
      }
    } catch { toast({ title: "Upload failed", variant: "destructive" }); }
    finally { setHeroUploadingIdx(null); }
  };

  const uploadOverlay = async (i: number, file: File) => {
    setOverlayUploadingIdx(i);
    try {
      const url = await uploadImageToCloudinary(file, `hero-overlay/${workspaceId}`);
      if (url) updateSlide(i, "overlayImage", url);
    } catch { toast({ title: "Upload failed", variant: "destructive" }); }
    finally { setOverlayUploadingIdx(null); }
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
                          className={`px-2.5 py-1.5 rounded text-xs border flex flex-col items-center leading-tight ${active ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                          <span>{h.label}</span>
                          <span className={`text-[9px] ${active ? "text-emerald-100" : "text-gray-400"}`}>{h.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-xs">Slides</Label>
                  <Button size="sm" variant="outline" className="h-7" onClick={addSlide}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
                </div>
                <p className="text-[10px] text-gray-400 leading-snug">Click a slide to freeze the preview on it while you adjust settings. Click again to unfreeze.</p>
                {heroSlides.length === 0 ? (
                  <p className="text-[11px] text-gray-400 italic">No slides — a styled banner with your store name shows instead.</p>
                ) : (
                  <div className="space-y-2">
                    {heroSlides.map((slide, i) => (
                      <div key={i} className={`rounded-lg border bg-white p-2 space-y-1.5 cursor-pointer transition-shadow ${editingSlideIdx === i ? "ring-2 ring-emerald-500 border-emerald-400" : "hover:border-gray-300"}`} onClick={() => setEditingSlideIdx(editingSlideIdx === i ? null : i)}>
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
                            <div className="flex gap-1">
                              {(["top", "center", "bottom"] as const).map((p) => {
                                const active = ((slide as any).imagePosition ?? "center") === p;
                                return (
                                  <button key={p} type="button"
                                    onClick={() => updateSlide(i, "imagePosition", p)}
                                    className={`flex-1 py-1 text-[10px] rounded border capitalize ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                                    {p}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex gap-1">
                              {([["fill-width", "Fill width"], ["cover", "Fill (crop)"], ["contain", "Fit (letterbox)"]] as const).map(([val, label]) => {
                                const active = ((slide as any).imageFit ?? "fill-width") === val;
                                return (
                                  <button key={val} type="button"
                                    onClick={() => updateSlide(i, "imageFit", val)}
                                    className={`flex-1 py-1 text-[10px] rounded border ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="space-y-1 pt-0.5">
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] text-gray-500">Width</p>
                                <span className="text-[10px] font-semibold text-gray-700">{(slide as any).imageWidth ?? 100}%</span>
                              </div>
                              <input type="range" min={20} max={200} step={5}
                                value={(slide as any).imageWidth ?? 100}
                                onChange={(e) => updateSlide(i, "imageWidth", Number(e.target.value))}
                                className="w-full h-1.5 accent-blue-600 cursor-pointer" />
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] text-gray-500">Height</p>
                                <span className="text-[10px] font-semibold text-gray-700">{(slide as any).imageHeight ?? 100}%</span>
                              </div>
                              <input type="range" min={20} max={200} step={5}
                                value={(slide as any).imageHeight ?? 100}
                                onChange={(e) => updateSlide(i, "imageHeight", Number(e.target.value))}
                                className="w-full h-1.5 accent-blue-600 cursor-pointer" />
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] text-gray-500">Move left/right</p>
                                <span className="text-[10px] font-semibold text-gray-700">{(slide as any).offsetX ?? 50}%</span>
                              </div>
                              <input type="range" min={0} max={100} step={1}
                                value={(slide as any).offsetX ?? 50}
                                onChange={(e) => updateSlide(i, "offsetX", Number(e.target.value))}
                                className="w-full h-1.5 accent-blue-600 cursor-pointer" />
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] text-gray-500">Move up/down</p>
                                <span className="text-[10px] font-semibold text-gray-700">{(slide as any).offsetY ?? 50}%</span>
                              </div>
                              <input type="range" min={0} max={100} step={1}
                                value={(slide as any).offsetY ?? 50}
                                onChange={(e) => updateSlide(i, "offsetY", Number(e.target.value))}
                                className="w-full h-1.5 accent-blue-600 cursor-pointer" />
                            </div>
                            <Input value={slide.heading ?? ""} onChange={(e) => updateSlide(i, "heading", e.target.value)} placeholder="Heading" className="h-7 text-xs" />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-gray-500 shrink-0">Background colour</label>
                          <input
                            type="color"
                            value={(slide as any).bgColor ?? "#1a1a1a"}
                            onChange={(e) => updateSlide(i, "bgColor", e.target.value)}
                            className="h-7 w-10 rounded border border-gray-200 cursor-pointer p-0.5"
                          />
                          <span className="text-[10px] font-mono text-gray-400">{(slide as any).bgColor ?? "#1a1a1a"}</span>
                          {(slide as any).bgColor && (slide as any).bgColor !== "#1a1a1a" && (
                            <button type="button" onClick={() => updateSlide(i, "bgColor", "#1a1a1a")} className="text-[10px] text-gray-400 hover:text-red-500 ml-auto">Reset</button>
                          )}
                        </div>
                        <Input value={slide.subheading ?? ""} onChange={(e) => updateSlide(i, "subheading", e.target.value)} placeholder="Subheading" className="h-7 text-xs" />
                        <div className="flex gap-1.5">
                          <Input value={slide.ctaText ?? ""} onChange={(e) => updateSlide(i, "ctaText", e.target.value)} placeholder="Button text" className="h-7 text-xs flex-1" />
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 shrink-0" onClick={() => removeSlide(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>

                        {/* Overlay / foreground image */}
                        <div className="border-t pt-2 space-y-1.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Overlay image (optional)</p>
                          <p className="text-[10px] text-gray-400 leading-snug">A model or product cutout placed on top of the background — use a PNG with a transparent background for best results.</p>
                          <div className="flex gap-2 items-start">
                            <div className="w-14 shrink-0">
                              <div className="aspect-[3/4] rounded border bg-gray-50 overflow-hidden flex items-center justify-center">
                                {(slide as any).overlayImage
                                  ? <img src={(slide as any).overlayImage} alt="" className="w-full h-full object-contain" />
                                  : <ImageIcon className="h-4 w-4 text-gray-300" />}
                              </div>
                              <label className="mt-1 flex items-center justify-center gap-1 text-[10px] text-blue-600 cursor-pointer hover:underline">
                                {overlayUploadingIdx === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Upload
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadOverlay(i, f); e.target.value = ""; }} />
                              </label>
                            </div>
                            <div className="flex-1 space-y-1">
                              <Input value={(slide as any).overlayImage ?? ""} onChange={(e) => updateSlide(i, "overlayImage", e.target.value)} placeholder="Overlay image URL" className="h-7 text-[11px] font-mono" />
                              <p className="text-[10px] text-gray-500">Position</p>
                              <div className="flex gap-1">
                                {(["left", "center", "right"] as const).map((p) => {
                                  const active = ((slide as any).overlayPosition ?? "right") === p;
                                  return (
                                    <button key={p} type="button"
                                      onClick={() => updateSlide(i, "overlayPosition", p)}
                                      className={`flex-1 py-1 text-[10px] rounded border capitalize ${active ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                                      {p}
                                    </button>
                                  );
                                })}
                              </div>
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] text-gray-500">Size</p>
                                <span className="text-[10px] font-semibold text-gray-700">{(slide as any).overlaySize ?? 90}%</span>
                              </div>
                              <input
                                type="range"
                                min={20}
                                max={100}
                                step={5}
                                value={(slide as any).overlaySize ?? 90}
                                onChange={(e) => updateSlide(i, "overlaySize", Number(e.target.value))}
                                className="w-full accent-gray-900"
                              />
                              {(slide as any).overlayImage && (
                                <button type="button" onClick={() => { updateSlide(i, "overlayImage", ""); updateSlide(i, "overlayPosition", "right"); updateSlide(i, "overlaySize", 90); }}
                                  className="text-[10px] text-red-500 hover:underline">Remove overlay</button>
                              )}
                            </div>
                          </div>
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
              {workspaceId && <PublicStore workspaceId={workspaceId} previewSettings={draft} previewSlideIdx={editingSlideIdx ?? undefined} previewPaused={editingSlideIdx !== null} />}
            </div>
          )}
        </main>
      </div>
    </div>,
    document.body,
  );
}
