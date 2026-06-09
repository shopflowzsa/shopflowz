import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Upload, Trash2, Save } from "lucide-react";
import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LabelTemplateConfig {
  columns: number;
  rows: number;
  labelW: number;    // mm
  labelH: number;    // mm
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  gapH: number;      // mm horizontal gap between labels
  gapV: number;      // mm vertical gap between labels
  pageWidth: number;  // mm  (210 = A4)
  pageHeight: number; // mm  (297 = A4)
}

export interface LabelContentConfig {
  showName: boolean;
  showSku: boolean;
  showBarcode: boolean;
  showPrice: boolean;
  showCategory: boolean;
  barcodeHeight: number; // px
}

export interface InventoryPrinterConfig {
  printerName: string;
  templateId: string;
  customTemplate: LabelTemplateConfig;
  backgroundImageBase64: string; // stored inline to avoid bucket complexity
  content: LabelContentConfig;
  // Direct-to-USB thermal sticker printer (same engine as the job-card forms).
  thermal?: {
    vendorId?: number;
    productId?: number;
    label?: string;
    widthMm?: number;   // physical label width
    heightMm?: number;  // physical label height
  };
}

// ── Predefined templates ───────────────────────────────────────────────────────

export const LABEL_TEMPLATES: { id: string; name: string; config: LabelTemplateConfig }[] = [
  {
    id: "a4_2",
    name: "A4 – 2 per sheet (large)",
    config: { columns: 1, rows: 2, labelW: 190, labelH: 130, marginTop: 12, marginBottom: 12, marginLeft: 10, marginRight: 10, gapH: 0, gapV: 5, pageWidth: 210, pageHeight: 297 },
  },
  {
    id: "a4_4",
    name: "A4 – 4 per sheet (2×2)",
    config: { columns: 2, rows: 2, labelW: 90, labelH: 130, marginTop: 12, marginBottom: 12, marginLeft: 10, marginRight: 10, gapH: 5, gapV: 5, pageWidth: 210, pageHeight: 297 },
  },
  {
    id: "a4_6",
    name: "A4 – 6 per sheet (2×3)",
    config: { columns: 2, rows: 3, labelW: 90, labelH: 84, marginTop: 12, marginBottom: 12, marginLeft: 10, marginRight: 10, gapH: 5, gapV: 4, pageWidth: 210, pageHeight: 297 },
  },
  {
    id: "a4_8",
    name: "A4 – 8 per sheet (2×4)",
    config: { columns: 2, rows: 4, labelW: 90, labelH: 63, marginTop: 12, marginBottom: 12, marginLeft: 10, marginRight: 10, gapH: 5, gapV: 3, pageWidth: 210, pageHeight: 297 },
  },
  {
    id: "a4_10",
    name: "A4 – 10 per sheet (2×5)",
    config: { columns: 2, rows: 5, labelW: 90, labelH: 50, marginTop: 12, marginBottom: 12, marginLeft: 10, marginRight: 10, gapH: 5, gapV: 2, pageWidth: 210, pageHeight: 297 },
  },
  {
    id: "avery_l7163",
    name: "Avery / Formtec L7163 – 14 per sheet (2×7)",
    config: { columns: 2, rows: 7, labelW: 99.1, labelH: 38.1, marginTop: 15.1, marginBottom: 15.1, marginLeft: 4.65, marginRight: 4.65, gapH: 2.5, gapV: 0, pageWidth: 210, pageHeight: 297 },
  },
  {
    id: "avery_l7160",
    name: "Avery / Formtec L7160 – 21 per sheet (3×7)",
    config: { columns: 3, rows: 7, labelW: 63.5, labelH: 38.1, marginTop: 15.1, marginBottom: 15.1, marginLeft: 7.2, marginRight: 7.2, gapH: 2.5, gapV: 0, pageWidth: 210, pageHeight: 297 },
  },
  {
    id: "avery_l7159",
    name: "Avery / Formtec L7159 – 24 per sheet (3×8)",
    config: { columns: 3, rows: 8, labelW: 63.5, labelH: 33.9, marginTop: 13.5, marginBottom: 13.5, marginLeft: 7.2, marginRight: 7.2, gapH: 2.5, gapV: 0, pageWidth: 210, pageHeight: 297 },
  },
  {
    id: "tower_w107",
    name: "Tower W107 – 65 per sheet (5×13, 38×21mm)",
    config: { columns: 5, rows: 13, labelW: 38.1, labelH: 21.2, marginTop: 10.7, marginBottom: 10.7, marginLeft: 4.65, marginRight: 4.65, gapH: 2.5, gapV: 0, pageWidth: 210, pageHeight: 297 },
  },
  {
    id: "avery_l7651",
    name: "Avery L7651 – 65 per sheet (5×13, small)",
    config: { columns: 5, rows: 13, labelW: 38.1, labelH: 21.2, marginTop: 10.7, marginBottom: 10.7, marginLeft: 4.65, marginRight: 4.65, gapH: 2.5, gapV: 0, pageWidth: 210, pageHeight: 297 },
  },
  {
    id: "thermal_58",
    name: "Thermal printer – 58mm roll",
    config: { columns: 1, rows: 1, labelW: 52, labelH: 30, marginTop: 1, marginBottom: 1, marginLeft: 2, marginRight: 2, gapH: 0, gapV: 2, pageWidth: 58, pageHeight: 40 },
  },
  {
    id: "thermal_80",
    name: "Thermal printer – 80mm roll",
    config: { columns: 1, rows: 1, labelW: 72, labelH: 40, marginTop: 2, marginBottom: 2, marginLeft: 2, marginRight: 2, gapH: 0, gapV: 2, pageWidth: 80, pageHeight: 50 },
  },
  {
    id: "thermal_40x30",
    name: "Thermal printer – 40×30mm sticker",
    config: { columns: 1, rows: 1, labelW: 36, labelH: 26, marginTop: 2, marginBottom: 2, marginLeft: 2, marginRight: 2, gapH: 0, gapV: 0, pageWidth: 40, pageHeight: 30 },
  },
  {
    id: "custom",
    name: "Custom / Upload template",
    config: { columns: 2, rows: 5, labelW: 90, labelH: 50, marginTop: 12, marginBottom: 12, marginLeft: 10, marginRight: 10, gapH: 5, gapV: 3, pageWidth: 210, pageHeight: 297 },
  },
];

export const DEFAULT_PRINTER_CONFIG: InventoryPrinterConfig = {
  printerName: "",
  templateId: "a4_8",
  customTemplate: LABEL_TEMPLATES.find((t) => t.id === "custom")!.config,
  backgroundImageBase64: "",
  content: {
    showName: true,
    showSku: true,
    showBarcode: true,
    showPrice: true,
    showCategory: false,
    barcodeHeight: 35,
  },
  thermal: { widthMm: 50, heightMm: 30 },
};

// ── Supabase load / save ───────────────────────────────────────────────────────

export async function loadInventoryPrinterConfig(workspaceId: string): Promise<InventoryPrinterConfig> {
  const { data } = await supabase
    .from("workspace_settings")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("category", "inventory_printer")
    .maybeSingle();
  if (!data?.data) return DEFAULT_PRINTER_CONFIG;
  return { ...DEFAULT_PRINTER_CONFIG, ...(data.data as Partial<InventoryPrinterConfig>) };
}

async function saveInventoryPrinterConfig(workspaceId: string, config: InventoryPrinterConfig): Promise<void> {
  await supabaseServiceRole.from("workspace_settings").upsert(
    { workspace_id: workspaceId, category: "inventory_printer", data: config },
    { onConflict: "workspace_id,category" }
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
  onConfigChange?: (config: InventoryPrinterConfig) => void;
}

export default function InventoryPrinterSettings({ workspaceId, onConfigChange }: Props) {
  const { toast } = useToast();
  const [config, setConfig] = useState<InventoryPrinterConfig>(DEFAULT_PRINTER_CONFIG);
  const [saving, setSaving] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);
  // Printer identity is stored per-browser in localStorage so each PC can
  // connect to its own printer without affecting other PCs on the workspace.
  const [localPrinterLabel, setLocalPrinterLabel] = useState<string | undefined>(undefined);

  useEffect(() => {
    loadInventoryPrinterConfig(workspaceId).then((c) => {
      setConfig(c);
      onConfigChange?.(c);
    });
    import("@/lib/thermalPrinterService").then(({ getLocalPrinter }) => {
      const saved = getLocalPrinter("inventory");
      setLocalPrinterLabel(saved?.label);
    });
  }, [workspaceId]);

  const activeTemplateConfig: LabelTemplateConfig =
    config.templateId === "custom"
      ? config.customTemplate
      : LABEL_TEMPLATES.find((t) => t.id === config.templateId)?.config ??
        DEFAULT_PRINTER_CONFIG.customTemplate;

  function updateCustom(field: keyof LabelTemplateConfig, raw: string) {
    const isInt = field === "columns" || field === "rows";
    const value = isInt ? parseInt(raw) || 1 : parseFloat(raw) || 0;
    setConfig((c) => ({ ...c, customTemplate: { ...c.customTemplate, [field]: value } }));
  }

  function updateContent(field: keyof LabelContentConfig, value: boolean | number) {
    setConfig((c) => ({ ...c, content: { ...c.content, [field]: value } }));
  }

  async function handleBgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) {
      toast({ title: "Image too large", description: "Please use an image under 500 KB.", variant: "destructive" });
      return;
    }
    setUploadingBg(true);
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        setConfig((c) => ({ ...c, backgroundImageBase64: base64 }));
        setUploadingBg(false);
        toast({ title: "Background image loaded" });
      };
      reader.readAsDataURL(file);
    } catch {
      setUploadingBg(false);
      toast({ title: "Upload failed", variant: "destructive" });
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveInventoryPrinterConfig(workspaceId, config);
      onConfigChange?.(config);
      toast({ title: "Printer settings saved" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const labelsPerSheet = activeTemplateConfig.columns * activeTemplateConfig.rows;

  const CUSTOM_FIELDS: { field: keyof LabelTemplateConfig; label: string; step: number }[] = [
    { field: "columns", label: "Columns", step: 1 },
    { field: "rows", label: "Rows", step: 1 },
    { field: "labelW", label: "Label width (mm)", step: 0.1 },
    { field: "labelH", label: "Label height (mm)", step: 0.1 },
    { field: "marginTop", label: "Margin top (mm)", step: 0.1 },
    { field: "marginBottom", label: "Margin bottom (mm)", step: 0.1 },
    { field: "marginLeft", label: "Margin left (mm)", step: 0.1 },
    { field: "marginRight", label: "Margin right (mm)", step: 0.1 },
    { field: "gapH", label: "Horizontal gap (mm)", step: 0.1 },
    { field: "gapV", label: "Vertical gap (mm)", step: 0.1 },
    { field: "pageWidth", label: "Page width (mm)", step: 0.1 },
    { field: "pageHeight", label: "Page height (mm)", step: 0.1 },
  ];

  return (
    <div className="max-w-2xl space-y-6 pb-8">

      {/* ── Dedicated printer ── */}
      <section>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Printer className="h-4 w-4 text-primary" />
          Dedicated Printer
        </h3>
        <div className="rounded-lg border p-4 space-y-3">
          <div>
            <Label className="text-xs">Printer name / reference</Label>
            <Input
              className="mt-1"
              placeholder="e.g. HP LaserJet M234 (inventory labels)"
              value={config.printerName}
              onChange={(e) => setConfig((c) => ({ ...c, printerName: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              This name is shown as a reminder when you print. Select this printer in your browser's print
              dialog. It is separate from any printer configured for job cards or CRM forms.
            </p>
          </div>
        </div>
      </section>

      {/* ── Thermal sticker printer (direct USB) ── */}
      <section>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Printer className="h-4 w-4 text-primary" />
          Thermal Sticker Printer
        </h3>
        <div className="rounded-lg border p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Print product stickers straight to a USB thermal label printer (CODE128 barcode), exactly like job-card
            stickers — no browser print dialog. Works in Chrome/Edge on desktop.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const { isThermalPrintSupported, pickPrinter, setLocalPrinter } = await import("@/lib/thermalPrinterService");
                  if (!isThermalPrintSupported()) {
                    toast({ title: "Not supported", description: "Use Chrome or Edge on a desktop plugged into the printer.", variant: "destructive" });
                    return;
                  }
                  const picked = await pickPrinter();
                  setLocalPrinter("inventory", picked);
                  setLocalPrinterLabel(picked.label);
                  toast({ title: "Printer connected", description: `${picked.label} saved for this PC` });
                } catch (e: any) {
                  if (e?.message) toast({ title: "Could not connect", description: e.message, variant: "destructive" });
                }
              }}
            >
              <Printer className="h-4 w-4 mr-1.5" />
              {localPrinterLabel ? "Change printer" : "Connect thermal printer"}
            </Button>
            {localPrinterLabel ? (
              <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                ● {localPrinterLabel} <span className="text-emerald-500">(this PC)</span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">No thermal printer connected on this PC</span>
            )}
            {localPrinterLabel && (
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={async () => {
                const { setLocalPrinter } = await import("@/lib/thermalPrinterService");
                setLocalPrinter("inventory", null);
                setLocalPrinterLabel(undefined);
              }}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Forget
              </Button>
            )}
          </div>

          {/* Custom label size */}
          <div className="pt-1">
            <Label className="text-xs">Label size (mm)</Label>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex items-center gap-1.5">
                <Input
                  type="number" min={10} max={120} className="w-20"
                  value={config.thermal?.widthMm ?? 50}
                  onChange={(e) => setConfig((c) => ({ ...c, thermal: { ...c.thermal, widthMm: Number(e.target.value) || 0 } }))}
                />
                <span className="text-xs text-muted-foreground">W</span>
              </div>
              <span className="text-muted-foreground">×</span>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number" min={10} max={120} className="w-20"
                  value={config.thermal?.heightMm ?? 30}
                  onChange={(e) => setConfig((c) => ({ ...c, thermal: { ...c.thermal, heightMm: Number(e.target.value) || 0 } }))}
                />
                <span className="text-xs text-muted-foreground">H</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[
                { w: 40, h: 30 }, { w: 50, h: 30 }, { w: 58, h: 40 }, { w: 50, h: 25 }, { w: 38, h: 25 }, { w: 80, h: 50 },
              ].map((s) => {
                const active = config.thermal?.widthMm === s.w && config.thermal?.heightMm === s.h;
                return (
                  <button key={`${s.w}x${s.h}`} type="button"
                    onClick={() => setConfig((c) => ({ ...c, thermal: { ...c.thermal, widthMm: s.w, heightMm: s.h } }))}
                    className={`px-2 py-1 rounded text-xs border ${active ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
                    {s.w}×{s.h}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Once connected, a <strong>Print to thermal printer</strong> button appears on the Barcodes tab. The label is
            rendered at the exact size above with the product name, price and a scannable barcode (per the “Label
            Content” options below).
          </p>
        </div>
      </section>

      {/* ── Label template ── */}
      <section>
        <h3 className="text-sm font-semibold mb-3">Label Template</h3>
        <div className="rounded-lg border p-4 space-y-4">

          <div>
            <Label className="text-xs">Template</Label>
            <Select
              value={config.templateId}
              onValueChange={(v) => setConfig((c) => ({ ...c, templateId: v }))}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LABEL_TEMPLATES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Spec summary */}
          <div className="flex flex-wrap gap-4 text-xs bg-muted/40 rounded-md px-3 py-2 text-muted-foreground">
            <span>
              <strong className="text-foreground">{activeTemplateConfig.columns}</strong> col ×{" "}
              <strong className="text-foreground">{activeTemplateConfig.rows}</strong> rows ={" "}
              <strong className="text-foreground">{labelsPerSheet}</strong> labels/sheet
            </span>
            <span>
              Label: <strong className="text-foreground">{activeTemplateConfig.labelW} × {activeTemplateConfig.labelH} mm</strong>
            </span>
            <span>
              Page: <strong className="text-foreground">{activeTemplateConfig.pageWidth} × {activeTemplateConfig.pageHeight} mm</strong>
            </span>
          </div>

          {/* Custom dimensions — only shown for 'custom' */}
          {config.templateId === "custom" && (
            <div className="border-t pt-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Enter the exact dimensions from your label manufacturer's specification sheet.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {CUSTOM_FIELDS.map(({ field, label, step }) => (
                  <div key={field}>
                    <Label className="text-xs">{label}</Label>
                    <Input
                      type="number"
                      step={step}
                      min={step === 1 ? 1 : 0}
                      className="mt-1 h-8 text-sm"
                      value={config.customTemplate[field] ?? ""}
                      onChange={(e) => updateCustom(field, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Background image upload */}
          <div className="border-t pt-4">
            <Label className="text-xs">
              Label background image{" "}
              <span className="text-muted-foreground font-normal">
                (optional — use a template from your label manufacturer, max 500 KB)
              </span>
            </Label>
            <div className="flex items-center gap-2 mt-2">
              {config.backgroundImageBase64 && (
                <img
                  src={config.backgroundImageBase64}
                  alt="Label background"
                  className="h-14 rounded border object-contain bg-muted"
                />
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => bgInputRef.current?.click()}
                disabled={uploadingBg}
              >
                <Upload className="h-3.5 w-3.5 mr-1" />
                {uploadingBg ? "Loading…" : config.backgroundImageBase64 ? "Replace" : "Upload image"}
              </Button>
              {config.backgroundImageBase64 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfig((c) => ({ ...c, backgroundImageBase64: "" }))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <input
                ref={bgInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleBgUpload}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              This image is placed behind every label when printing — e.g. a pre-printed branded design
              from the label sheet manufacturer.
            </p>
          </div>
        </div>
      </section>

      {/* ── Label content ── */}
      <section>
        <h3 className="text-sm font-semibold mb-3">Label Content</h3>
        <div className="rounded-lg border p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["showName", "Product name"],
                ["showSku", "SKU / code"],
                ["showBarcode", "Barcode"],
                ["showPrice", "Price"],
                ["showCategory", "Category"],
              ] as [keyof LabelContentConfig, string][]
            ).map(([field, label]) => (
              <label key={field} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox
                  checked={config.content[field] as boolean}
                  onCheckedChange={(v) => updateContent(field, !!v)}
                />
                {label}
              </label>
            ))}
          </div>

          {config.content.showBarcode && (
            <div className="border-t pt-3">
              <Label className="text-xs">Barcode height (px)</Label>
              <Input
                type="number"
                min={15}
                max={100}
                step={1}
                className="mt-1 h-8 text-sm w-24"
                value={config.content.barcodeHeight}
                onChange={(e) => updateContent("barcodeHeight", parseInt(e.target.value) || 35)}
              />
            </div>
          )}
        </div>
      </section>

      <Button onClick={handleSave} disabled={saving} className="w-full">
        <Save className="h-4 w-4 mr-2" />
        {saving ? "Saving…" : "Save Printer Settings"}
      </Button>
    </div>
  );
}
