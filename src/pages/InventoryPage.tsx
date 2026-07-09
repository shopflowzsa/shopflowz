import { useState, useEffect, useMemo, useRef } from "react";
import JsBarcode from "jsbarcode";
import { generateBarcode } from "@/lib/barcodeService";
import {
  Package, Plus, Search, Edit2, Trash2, TrendingUp, TrendingDown,
  AlertTriangle, ChevronDown, ChevronUp, ChevronRight, BarChart3, X, RefreshCw, Upload, Image, Download, CheckSquare, Square, Settings, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { inventoryService, InventoryItem, StockMovement, VOLTAGE_RANGES, AMPERAGE_RANGES } from "@/lib/inventoryService";
import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { uploadImageToCloudinary, getThumbnailUrl } from "@/lib/cloudinaryService";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from 'xlsx';
import { InventoryBulkEditor } from "@/components/crm/InventoryBulkEditor";
import InventoryPrinterSettings, {
  loadInventoryPrinterConfig,
  DEFAULT_PRINTER_CONFIG,
  LABEL_TEMPLATES,
  type InventoryPrinterConfig,
  type LabelTemplateConfig,
} from "@/components/crm/InventoryPrinterSettings";

const DEFAULT_CATEGORIES: string[] = [];
const REASONS = [
  "Purchase / Received stock",
  "Sale / Used in repair",
  "Inventory correction",
  "Damaged / Written off",
  "Returned by customer",
  "Other",
];

// ─── Barcode display helper component ───────────────────────────────────────
function BarcodeDisplay({ value, height = 40 }: { value: string; height?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format: "CODE128",
          width: 1.5,
          height,
          displayValue: true,
          fontSize: 10,
          margin: 4,
        });
      } catch (_e) {
        // invalid barcode value — render nothing
      }
    }
  }, [value, height]);
  return <svg ref={svgRef} className="max-w-full" />;
}

function emptyItem(): Omit<InventoryItem, "id" | "createdAt" | "updatedAt"> {
  return {
    name: "", sku: "", description: "", category: "",
    price: 0, salePrice: undefined, costPrice: 0, quantity: 0, reorderLevel: 5,
    manufacturer: "", supplier: "", location: "", imageUrl: "", status: "active",
    itemType: "inventory",
    packSize: undefined, packPrice: undefined,
    extraImages: [],
    productVariants: [],
  };
}

interface InventoryPageProps {
  onClose: () => void;
  initialSearch?: string;
}

export function InventoryPage({ onClose, initialSearch }: InventoryPageProps) {
  const { user, workspaceId } = useAuth();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"products" | "movements" | "barcodes" | "batch" | "printer" | "recently_added" | "latest_edited" | "latest_sold" | "to_order">("products");
  const [recentDays, setRecentDays] = useState(2);
  const [printerConfig, setPrinterConfig] = useState<InventoryPrinterConfig>(DEFAULT_PRINTER_CONFIG);
  const [barcodeSearch, setBarcodeSearch] = useState("");
  const [selectedBarcodeItems, setSelectedBarcodeItems] = useState<Set<string>>(new Set());
  const [barcodeLabelTemplateId, setBarcodeLabelTemplateId] = useState("tower_w107");
  const [startBarcodeLabel, setStartBarcodeLabel] = useState(1);
  const [generatingBarcodes, setGeneratingBarcodes] = useState(false);
  const [barcodeCopies, setBarcodeCopies] = useState<Record<string, number>>({});

  // Per-template alignment adjustments (saved to localStorage)
  const ALIGN_KEY = "inventory_label_align";
  type AlignState = { offX: number; offY: number; scale: number; labelW?: number; labelH?: number; fontScale?: number; barcodeScale?: number };
  const loadAlign = (): Record<string, AlignState> => {
    try { return JSON.parse(localStorage.getItem(ALIGN_KEY) || "{}"); } catch { return {}; }
  };
  const [labelAlign, setLabelAlign] = useState<Record<string, AlignState>>(loadAlign);
  const [showAlignPreview, setShowAlignPreview] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const currentAlign = labelAlign[barcodeLabelTemplateId] ?? { offX: 0, offY: 0, scale: 1 };

  function updateAlign(patch: Partial<AlignState>) {
    setLabelAlign((prev) => {
      const next = { ...prev, [barcodeLabelTemplateId]: { ...currentAlign, ...patch } };
      localStorage.setItem(ALIGN_KEY, JSON.stringify(next));
      return next;
    });
  }

  const [searchInput, setSearchInput] = useState(initialSearch ?? "");
  const searchTerm = searchInput;
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "low" | "out">("all");
  const [sortField, setSortField] = useState<"name" | "quantity" | "price">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Dialogs
  const [showAddEdit, setShowAddEdit] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [formData, setFormData] = useState(emptyItem());
  const [saving, setSaving] = useState(false);
  const [cloningId, setCloningId] = useState<string | null>(null);

  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState(REASONS[0]);
  const [adjustNotes, setAdjustNotes] = useState("");
  const [adjustSaving, setAdjustSaving] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState<InventoryItem | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Bulk selection
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [bulkAction, setBulkAction] = useState<'delete' | 'category' | 'status' | 'quickUpdate' | null>(null);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkStatus, setBulkStatus] = useState<"active" | "inactive" | "on_order">("active");
  const [processingBulk, setProcessingBulk] = useState(false);

  // Image upload
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  // Extra images (multi-image / clothing gallery)
  const [pendingExtraImages, setPendingExtraImages] = useState<{ file: File; preview: string }[]>([]);
  // Variant builder toggle
  const [variantsEnabled, setVariantsEnabled] = useState(false);
  const { toast } = useToast();

  // Bulk Editor
  // (rendered as embedded "Batch Editor" tab — no overlay state needed)

  // CSV Import
  const [showImportCSV, setShowImportCSV] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [rawParsedData, setRawParsedData] = useState<any[]>([]); // Raw data before mapping
  const [availableColumns, setAvailableColumns] = useState<string[]>([]); // Columns from file
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({}); // field -> column mapping
  const [csvData, setCsvData] = useState<any[]>([]); // Final mapped data
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStep, setImportStep] = useState<'upload' | 'map' | 'preview'>('upload');
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'update' | 'create'>('update');

  // Quick Update from Supplier
  const [showQuickUpdate, setShowQuickUpdate] = useState(false);
  const [quickUpdateItem, setQuickUpdateItem] = useState<InventoryItem | null>(null);
  const [productPageUrl, setProductPageUrl] = useState("");
  const [supplierImageUrl, setSupplierImageUrl] = useState("");
  const [supplierPrice, setSupplierPrice] = useState("");
  const [markupPercent, setMarkupPercent] = useState(30);
  // Pack sales fields for quick/bulk update
  const [bulkEnablePackSales, setBulkEnablePackSales] = useState(false);
  const [bulkPackSize, setBulkPackSize] = useState("");
  const [bulkPackPrice, setBulkPackPrice] = useState("");
  const [processingQuickUpdate, setProcessingQuickUpdate] = useState(false);
  const [scrapingPage, setScrapingPage] = useState(false);
  const [fetchingDescription, setFetchingDescription] = useState(false);
  const [quickUpdateDescription, setQuickUpdateDescription] = useState("");

  // Categories Management
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [showSettings, setShowSettings] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editCategoryValue, setEditCategoryValue] = useState("");
  // Subcategory management
  const [subcategoryMap, setSubcategoryMap] = useState<Record<string, string[]>>({});
  const [filterSubcategory, setFilterSubcategory] = useState("all");
  const [filterVoltage, setFilterVoltage] = useState("all");
  const [filterAmperage, setFilterAmperage] = useState("all");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [newSubcategory, setNewSubcategory] = useState("");
  const [editingSubcategory, setEditingSubcategory] = useState<{ cat: string; sub: string } | null>(null);
  const [editSubcategoryValue, setEditSubcategoryValue] = useState("");
  // Inline "+ Add category" inside the Add/Edit Item form
  const [showInlineNewCategory, setShowInlineNewCategory] = useState(false);
  const [inlineNewCategory, setInlineNewCategory] = useState("");

  useEffect(() => {
    if (!workspaceId) return;
    load();
    loadCategories();
    loadInventoryPrinterConfig(workspaceId).then(setPrinterConfig);
  }, [workspaceId]);

  async function loadCategories() {
    if (!workspaceId) return;
    try {
      const { data: row } = await supabase.from('workspace_settings').select('data').eq('workspace_id', workspaceId).eq('category', 'inventory').single();
      const cats = (row?.data as any)?.categories;
      if (cats) setCategories(cats);
      const subs = (row?.data as any)?.subcategories;
      if (subs) setSubcategoryMap(subs);
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  }

  async function saveCategoryData(newCategories: string[], newSubMap: Record<string, string[]>) {
    if (!workspaceId) return;
    try {
      const { data: row } = await supabase.from('workspace_settings').select('data').eq('workspace_id', workspaceId).eq('category', 'inventory').single();
      const existing = (row?.data as any) || {};
      await supabaseServiceRole.from('workspace_settings').upsert(
        { workspace_id: workspaceId, category: 'inventory', data: { ...existing, categories: newCategories, subcategories: newSubMap } },
        { onConflict: 'workspace_id,category' }
      );
      setCategories(newCategories);
      setSubcategoryMap(newSubMap);
      toast({ title: "Saved", description: "Categories updated" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to save categories", variant: "destructive" });
    }
  }

  async function handleAddCategory() {
    if (!newCategory.trim()) return;
    if (categories.includes(newCategory.trim())) {
      toast({ title: "Duplicate", description: "This category already exists", variant: "destructive" });
      return;
    }
    await saveCategoryData([...categories, newCategory.trim()], subcategoryMap);
    setNewCategory("");
  }

  async function handleEditCategory(oldCategory: string) {
    const newName = editCategoryValue.trim();
    if (!newName) return;
    if (oldCategory === newName) { setEditingCategory(null); return; }
    if (categories.includes(newName)) {
      toast({ title: "Duplicate", description: "This category already exists", variant: "destructive" });
      return;
    }
    const updated = categories.map(c => c === oldCategory ? newName : c);
    // Move subcategories to new name
    const newSubMap = { ...subcategoryMap };
    if (newSubMap[oldCategory]) { newSubMap[newName] = newSubMap[oldCategory]; delete newSubMap[oldCategory]; }
    await saveCategoryData(updated, newSubMap);
    setEditingCategory(null);
    setEditCategoryValue("");
  }

  async function handleDeleteCategory(category: string) {
    if (categories.length === 1) {
      toast({ title: "Cannot delete", description: "You must have at least one category", variant: "destructive" });
      return;
    }
    const newSubMap = { ...subcategoryMap };
    delete newSubMap[category];
    await saveCategoryData(categories.filter(c => c !== category), newSubMap);
    if (filterCategory === category) setFilterCategory("all");
    if (expandedCategory === category) setExpandedCategory(null);
  }

  async function handleAddSubcategory(category: string) {
    const sub = newSubcategory.trim();
    if (!sub) return;
    const existing = subcategoryMap[category] || [];
    if (existing.includes(sub)) {
      toast({ title: "Duplicate", description: "This subcategory already exists", variant: "destructive" });
      return;
    }
    await saveCategoryData(categories, { ...subcategoryMap, [category]: [...existing, sub] });
    setNewSubcategory("");
  }

  async function handleDeleteSubcategory(category: string, sub: string) {
    const updated = (subcategoryMap[category] || []).filter(s => s !== sub);
    await saveCategoryData(categories, { ...subcategoryMap, [category]: updated });
    if (filterSubcategory === sub) setFilterSubcategory("all");
  }

  async function handleEditSubcategory(category: string, oldSub: string) {
    const newSub = editSubcategoryValue.trim();
    if (!newSub || newSub === oldSub) { setEditingSubcategory(null); setEditSubcategoryValue(""); return; }
    const subs = subcategoryMap[category] || [];
    if (subs.includes(newSub)) {
      toast({ title: "Duplicate", description: "This subcategory already exists", variant: "destructive" });
      return;
    }
    await saveCategoryData(categories, { ...subcategoryMap, [category]: subs.map(s => s === oldSub ? newSub : s) });
    setEditingSubcategory(null);
    setEditSubcategoryValue("");
  }

  async function load() {
    if (!workspaceId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [prods, movs] = await Promise.all([
        inventoryService.getAll(workspaceId),
        inventoryService.getMovements(workspaceId),
      ]);
      setItems(prods);
      setMovements(movs);
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }

  // Items with no name — corrupted/blank records to clean up
  const blankItems = useMemo(() => items.filter(i => !i.name?.trim()), [items]);

  const filteredItems = useMemo(() => {
    // Always exclude blank (nameless) records from the main product view
    let result = items.filter(i => i.name?.trim());
    if (searchTerm) {
      const words = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter((i) => {
        const haystack = [i.name, i.sku, i.category, i.supplier, i.manufacturer, i.description]
          .map(v => (v || "").toLowerCase())
          .join(" ");
        return words.every(w => haystack.includes(w));
      });
    }
    if (filterCategory !== "all") result = result.filter((i) => i.category === filterCategory);
    if (filterSubcategory !== "all") result = result.filter((i) => (i as any).subcategory === filterSubcategory);
    if (filterVoltage !== "all") result = result.filter((i) => (i as any).voltageRange === filterVoltage);
    if (filterAmperage !== "all") result = result.filter((i) => (i as any).amperageRange === filterAmperage);
    if (filterStatus === "low") result = result.filter((i) => i.quantity > 0 && i.quantity <= i.reorderLevel);
    if (filterStatus === "out") result = result.filter((i) => i.quantity === 0);
    return [...result].sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortField === "name") return mul * (a.name || "").localeCompare(b.name || "");
      if (sortField === "quantity") return mul * (a.quantity - b.quantity);
      if (sortField === "price") return mul * (a.price - b.price);
      return 0;
    });
  }, [items, searchTerm, filterCategory, filterSubcategory, filterVoltage, filterAmperage, filterStatus, sortField, sortDir]);

  const allVoltageOptions = useMemo(() =>
    [...new Set(items.map(i => (i as any).voltageRange).filter(Boolean))].sort() as string[], [items]);
  const allAmperageOptions = useMemo(() =>
    [...new Set(items.map(i => (i as any).amperageRange).filter(Boolean))].sort() as string[], [items]);

  const stats = useMemo(() => ({
    total: items.length,
    lowStock: items.filter((i) => i.quantity > 0 && i.quantity <= i.reorderLevel).length,
    outOfStock: items.filter((i) => i.quantity === 0).length,
    costValue: items.reduce((sum, i) => sum + (Number(i.costPrice) || 0) * (Number(i.quantity) || 0), 0),
    retailValue: items.reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0),
  }), [items]);

  // ─── Barcode tab helpers ─────────────────────────────────────────────────────
  const barcodeFilteredItems = useMemo(() => {
    if (!barcodeSearch.trim()) return items;
    const q = barcodeSearch.toLowerCase();
    return items.filter(
      (i) =>
        (i.name || "").toLowerCase().includes(q) ||
        (i.sku || "").toLowerCase().includes(q) ||
        (i.barcode || "").includes(q)
    );
  }, [items, barcodeSearch]);

  const [deletingBlanks, setDeletingBlanks] = useState(false);
  async function deleteBlankItems() {
    if (!workspaceId || blankItems.length === 0) return;
    setDeletingBlanks(true);
    try {
      for (const item of blankItems) {
        await inventoryService.delete(workspaceId, item.id);
      }
      setItems(prev => prev.filter(i => i.name?.trim()));
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to delete blank items");
    } finally {
      setDeletingBlanks(false);
    }
  }

  async function generateAllMissingBarcodes() {
    if (!workspaceId) return;
    setGeneratingBarcodes(true);
    try {
      const missing = items.filter((i) => !i.barcode);
      for (const item of missing) {
        const bc = generateBarcode("CODE128");
        await inventoryService.update(workspaceId, item.id, { barcode: bc });
      }
      // reload
      const all = await inventoryService.getAll(workspaceId);
      setItems(all);
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to generate barcodes");
    } finally {
      setGeneratingBarcodes(false);
    }
  }

  function printBarcodeLabels(itemsToPrint: InventoryItem[], cfg: InventoryPrinterConfig = printerConfig, startAt: number = startBarcodeLabel, templateId: string = barcodeLabelTemplateId) {
    const tmpl: LabelTemplateConfig =
      templateId === "custom"
        ? cfg.customTemplate
        : LABEL_TEMPLATES.find((t) => t.id === templateId)?.config ?? DEFAULT_PRINTER_CONFIG.customTemplate;

    const align = (loadAlign()[templateId]) ?? { offX: 0, offY: 0, scale: 1 };
    const { columns, gapH, gapV, pageWidth, pageHeight } = tmpl;
    const baseLabelW = align.labelW ?? tmpl.labelW;
    const baseLabelH = align.labelH ?? tmpl.labelH;
    const marginTop = tmpl.marginTop + align.offY;
    const marginLeft = tmpl.marginLeft + align.offX;
    const marginBottom = tmpl.marginBottom - align.offY;
    const marginRight = tmpl.marginRight - align.offX;
    const scaledLabelW = +(baseLabelW * align.scale).toFixed(2);
    const scaledLabelH = +(baseLabelH * align.scale).toFixed(2);
    const fontScale = align.fontScale ?? 1;
    const barcodeScale = align.barcodeScale ?? 1;
    const { showName, showSku, showBarcode, showPrice, showCategory, barcodeHeight } = cfg.content;

    const spacerHtml = Array.from({ length: Math.max(0, startAt - 1) }, () =>
      `<div class="label" style="visibility:hidden;"></div>`
    ).join("");

    const labelsHtml = itemsToPrint.map((item) => {
      // Scale barcode to the label height — bars + text must fit within the label
      const bcH = Math.min(barcodeHeight, Math.round(scaledLabelH * 0.55 * barcodeScale));
      const bcFontSize = Math.max(4, Math.round(scaledLabelH * 0.22 * fontScale));
      let barcodeImg = "";
      if (item.barcode && showBarcode) {
        const canvas = document.createElement("canvas");
        try {
          JsBarcode(canvas, item.barcode, {
            format: "CODE128",
            width: 1,
            height: bcH,
            displayValue: true,
            fontSize: bcFontSize,
            margin: 1,
          });
          barcodeImg = canvas.toDataURL("image/png");
        } catch (_e) {}
      }
      return `
        <div class="label">
          ${cfg.backgroundImageBase64 ? `<img class="bg-img" src="${cfg.backgroundImageBase64}" />` : ""}
          <div class="lbl-inner">
            ${showName ? `<div class="lbl-name">${item.name}</div>` : ""}
            ${showSku && item.sku ? `<div class="lbl-sku">${item.sku}</div>` : ""}
            ${barcodeImg ? `<img class="lbl-bc" src="${barcodeImg}" />` : (showBarcode ? '<div class="no-bc">No barcode</div>' : "")}
            ${showPrice && item.price ? `<div class="lbl-price">R${item.price.toFixed(2)}</div>` : ""}
            ${showCategory && item.category ? `<div class="lbl-cat">${item.category}</div>` : ""}
          </div>
        </div>`;
    }).join("");

    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;

    // For thermal roll (single column), each label gets its own page so the
    // printer feeds exactly one label per cut/gap. For sheet layouts (multi-column)
    // we keep the grid approach so labels stay on the same sheet.
    const isThermalRoll = columns === 1 && pageWidth <= 80;

    const sharedStyles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; }
    .label { width: ${scaledLabelW}mm; height: ${scaledLabelH}mm; max-height: ${scaledLabelH}mm; overflow: hidden; position: relative; }
    .bg-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.15; }
    .lbl-inner { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; padding: 0.4mm 0.8mm; gap: 0.1mm; overflow: hidden; }
    .lbl-name { font-size: ${Math.max(4, scaledLabelH * 0.22 * fontScale).toFixed(1)}pt; font-weight: bold; text-align: center; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; line-height: 1.15; }
    .lbl-sku { font-size: ${Math.max(3, scaledLabelH * 0.17 * fontScale).toFixed(1)}pt; color: #555; font-family: monospace; line-height: 1.15; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .lbl-bc { max-width: 100%; max-height: ${Math.round(scaledLabelH * 0.95 * barcodeScale)}px; object-fit: contain; display: block; }
    .lbl-price { font-size: ${Math.max(4, scaledLabelH * 0.22 * fontScale).toFixed(1)}pt; font-weight: bold; line-height: 1.15; }
    .lbl-cat { font-size: ${Math.max(3, scaledLabelH * 0.15 * fontScale).toFixed(1)}pt; color: #777; line-height: 1.15; }
    .no-bc { font-size: ${Math.max(3, scaledLabelH * 0.17 * fontScale).toFixed(1)}pt; color: #aaa; }`;

    let htmlContent: string;
    if (isThermalRoll) {
      // Each label is its own @page — printer feeds exactly one label per job
      const labelPages = itemsToPrint.map((item) => {
        const bcH = Math.min(barcodeHeight, Math.round(scaledLabelH * 0.55 * barcodeScale));
        const bcFontSize = Math.max(4, Math.round(scaledLabelH * 0.22 * fontScale));
        let barcodeImg = "";
        if (item.barcode && showBarcode) {
          const canvas = document.createElement("canvas");
          try {
            JsBarcode(canvas, item.barcode, { format: "CODE128", width: 1, height: bcH, displayValue: true, fontSize: bcFontSize, margin: 1 });
            barcodeImg = canvas.toDataURL("image/png");
          } catch (_e) {}
        }
        return `<div class="label page-label">
          ${cfg.backgroundImageBase64 ? `<img class="bg-img" src="${cfg.backgroundImageBase64}" />` : ""}
          <div class="lbl-inner">
            ${showName ? `<div class="lbl-name">${item.name}</div>` : ""}
            ${showSku && item.sku ? `<div class="lbl-sku">${item.sku}</div>` : ""}
            ${barcodeImg ? `<img class="lbl-bc" src="${barcodeImg}" />` : (showBarcode ? '<div class="no-bc">No barcode</div>' : "")}
            ${showPrice && item.price ? `<div class="lbl-price">R${item.price.toFixed(2)}</div>` : ""}
            ${showCategory && item.category ? `<div class="lbl-cat">${item.category}</div>` : ""}
          </div>
        </div>`;
      }).join("");
      htmlContent = `<!DOCTYPE html>
<html><head>
  <title>Barcode Labels</title>
  <style>
    @page { size: ${pageWidth}mm ${pageHeight}mm; margin: ${marginTop}mm ${marginRight}mm ${marginBottom}mm ${marginLeft}mm; }
    ${sharedStyles}
    .page-label { page-break-after: always; }
    .page-label:last-child { page-break-after: avoid; }
    @media print { body { margin: 0; } }
  </style>
</head><body>${labelPages}</body></html>`;
    } else {
      // Sheet layout — keep grid, multiple labels per page
      htmlContent = `<!DOCTYPE html>
<html><head>
  <title>Barcode Labels${cfg.printerName ? ` — ${cfg.printerName}` : ""}</title>
  <style>
    @page { size: ${pageWidth}mm ${pageHeight}mm; margin: ${marginTop}mm ${marginRight}mm ${marginBottom}mm ${marginLeft}mm; }
    ${sharedStyles}
    ${cfg.printerName ? `.printer-note { font-size: 8pt; color: #aaa; margin-bottom: 3mm; }` : ""}
    .grid { display: grid; grid-template-columns: repeat(${columns}, ${scaledLabelW}mm); grid-auto-rows: ${scaledLabelH}mm; gap: ${gapV}mm ${gapH}mm; }
    .label { page-break-inside: avoid; }
    @media print { body { margin: 0; } }
  </style>
</head><body>
  ${cfg.printerName ? `<div class="printer-note">Print on: ${cfg.printerName}</div>` : ""}
  <div class="grid">${spacerHtml}${labelsHtml}</div>
</body></html>`;
    }

    w.document.write(htmlContent);
    w.document.close();
  }

  function openAdd() {
    setEditingItem(null);
    setFormData({ ...emptyItem(), category: categories[0] ?? "" });
    setImageFile(null);
    setImagePreview(null);
    setPendingExtraImages([]);
    setVariantsEnabled(false);
    setShowAddEdit(true);
  }
  function openEdit(item: InventoryItem) {
    setEditingItem(item);
    const existingVariants = (item as any).productVariants || [];
    setFormData({
      name: item.name, sku: item.sku, description: item.description,
      category: item.category, price: item.price, costPrice: item.costPrice,
      quantity: item.quantity, reorderLevel: item.reorderLevel,
      manufacturer: item.manufacturer ?? "", supplier: item.supplier, location: item.location,
      imageUrl: item.imageUrl || "", status: item.status,
      itemType: item.itemType ?? "inventory",
      packSize: (item as any).packSize, packPrice: (item as any).packPrice,
      extraImages: (item as any).extraImages || [],
      productVariants: existingVariants,
    });
    setImageFile(null);
    setImagePreview(item.imageUrl || null);
    setPendingExtraImages([]);
    setVariantsEnabled(existingVariants.length > 0);
    setShowAddEdit(true);
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file",
        description: "Please select an image file",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Image must be less than 5MB",
        variant: "destructive",
      });
      return;
    }

    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  function removeImage() {
    setImageFile(null);
    setImagePreview(null);
    setFormData({ ...formData, imageUrl: "" });
  }

  async function handleExtraImageAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: "File too large", description: "Extra images must be under 5MB each", variant: "destructive" });
        continue;
      }
      const preview = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      setPendingExtraImages(prev => [...prev, { file, preview }]);
    }
    e.target.value = "";
  }

  function removeExistingExtraImage(index: number) {
    setFormData(prev => ({ ...prev, extraImages: (prev.extraImages || []).filter((_, i) => i !== index) }));
  }

  function removePendingExtraImage(index: number) {
    setPendingExtraImages(prev => prev.filter((_, i) => i !== index));
  }

  async function uploadImage(): Promise<string> {
    if (!imageFile || !workspaceId) return formData.imageUrl;

    setUploadingImage(true);
    try {
      // Upload to Cloudinary with workspace folder organization
      const folder = `workspaces/${workspaceId}/inventory`;
      const imageUrl = await uploadImageToCloudinary(imageFile, folder);
      return imageUrl;
    } catch (error) {
      console.error('Error uploading image:', error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload image",
        variant: "destructive",
      });
      throw error;
    } finally {
      setUploadingImage(false);
    }
  }
  async function saveItem() {
    if (!workspaceId || !formData.name) return;
    // Inventory items: when SKU is blank, mirror the product name (Google
    // Shopping uses this as the part identifier). Services still fall back
    // to an auto-generated SVC-* code.
    const skuToUse = formData.sku?.trim()
      || (formData.itemType === "service" ? `SVC-${Date.now()}` : formData.name.trim());
    setSaving(true);
    setErrorMsg(null);
    try {
      // Upload main image if a new file is selected
      let imageUrl = formData.imageUrl;
      if (imageFile) {
        imageUrl = await uploadImage();
      }

      // Upload any pending extra images
      const folder = `workspaces/${workspaceId}/inventory`;
      const uploadedExtraUrls: string[] = [];
      for (const { file } of pendingExtraImages) {
        try {
          const url = await uploadImageToCloudinary(file, folder);
          uploadedExtraUrls.push(url);
        } catch (_) { /* skip failed extra images silently */ }
      }
      const allExtraImages = [...(formData.extraImages || []), ...uploadedExtraUrls];

      const dataToSave = { ...formData, sku: skuToUse, imageUrl, extraImages: allExtraImages };

      const nowIso = new Date().toISOString();
      if (editingItem) {
        await inventoryService.update(workspaceId, editingItem.id, dataToSave);
        setItems((prev) => prev.map((it) =>
          it.id === editingItem.id
            ? ({ ...it, ...dataToSave, updatedAt: nowIso } as InventoryItem)
            : it
        ));
      } else {
        const newId = await inventoryService.add(workspaceId, dataToSave);
        const newItem = {
          ...(dataToSave as any),
          id: newId,
          createdAt: nowIso,
          updatedAt: nowIso,
        } as InventoryItem;
        setItems((prev) => [newItem, ...prev]);
      }

      toast({
        title: "Success",
        description: `Item ${editingItem ? 'updated' : 'added'} successfully`,
      });

      setShowAddEdit(false);
      setImageFile(null);
      setImagePreview(null);
      setPendingExtraImages([]);
      setVariantsEnabled(false);
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to save item");
      toast({
        title: "Error",
        description: e?.message || "Failed to save item",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  function openQuickUpdate(item: InventoryItem) {
    setQuickUpdateItem(item);
    setProductPageUrl("");
    setSupplierImageUrl("");
    setSupplierPrice("");
    setMarkupPercent(30);
    setQuickUpdateDescription(item.description || "");
    setShowQuickUpdate(true);
  }

  async function downloadImageFromUrl(imageUrl: string): Promise<File | null> {
    try {
      const response = await fetch(imageUrl, { mode: 'cors' });
      if (!response.ok) throw new Error('Failed to download image');
      
      const blob = await response.blob();
      const filename = imageUrl.split('/').pop()?.split('?')[0] || 'image.jpg';
      return new File([blob], filename, { type: blob.type });
    } catch (error) {
      // If CORS fails, try through a proxy or just use the URL directly
      console.error('Download failed:', error);
      throw new Error('Unable to download image. The supplier website may block direct downloads. Try saving the image locally first.');
    }
  }

  async function scrapeProductPage() {
    if (!productPageUrl.trim()) {
      toast({
        title: "Missing URL",
        description: "Please enter a product page URL",
        variant: "destructive",
      });
      return;
    }

    setScrapingPage(true);
    try {
      // Try to fetch the page (will likely fail due to CORS)
      const response = await fetch(productPageUrl, { mode: 'cors' });
      const html = await response.text();
      
      // Create a DOM parser
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Try common image selectors
      let imageUrl = '';
      const imageSelectors = [
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'img.product-image',
        'img[itemprop="image"]',
        '.product-img img',
        '#product-image',
        'img[alt*="product"]',
      ];
      
      for (const selector of imageSelectors) {
        const element = doc.querySelector(selector);
        if (element) {
          imageUrl = element.getAttribute('content') || element.getAttribute('src') || '';
          if (imageUrl) break;
        }
      }
      
      // Try common price selectors
      let price = '';
      const priceSelectors = [
        '[itemprop="price"]',
        '.price',
        '.product-price',
        '#price',
        '[data-price]',
      ];
      
      for (const selector of priceSelectors) {
        const element = doc.querySelector(selector);
        if (element) {
          const priceText = element.getAttribute('content') || element.textContent || '';
          const match = priceText.match(/[\d,\.]+/);
          if (match) {
            price = match[0].replace(/,/g, '');
            break;
          }
        }
      }
      
      if (imageUrl) {
        // Make absolute URL if relative
        if (imageUrl.startsWith('/')) {
          const url = new URL(productPageUrl);
          imageUrl = url.origin + imageUrl;
        }
        setSupplierImageUrl(imageUrl);
      }
      
      if (price) {
        setSupplierPrice(price);
      }
      
      if (!imageUrl && !price) {
        toast({
          title: "Nothing found",
          description: "Could not extract image or price. This website may block scraping. Please enter values manually.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Extracted successfully!",
          description: `${imageUrl ? 'Image' : ''}${imageUrl && price ? ' and ' : ''}${price ? 'price' : ''} extracted`,
        });
      }
      
    } catch (error: any) {
      console.error('Scraping error:', error);
      toast({
        title: "Scraping failed",
        description: "This website blocks scraping. Please copy the image URL and price manually.",
        variant: "destructive",
      });
    } finally {
      setScrapingPage(false);
    }
  }

  async function fetchDescription() {
    if (!quickUpdateItem) return;
    const query = [quickUpdateItem.name, quickUpdateItem.sku].filter(Boolean).join(" ");
    setFetchingDescription(true);
    try {
      const { data, error } = await supabase.functions.invoke("description-search-ddg", {
        body: { query },
      });
      if (error) throw new Error(error.message);
      const text: string = data?.description ?? "";
      if (text) {
        setQuickUpdateDescription(text);
        toast({ title: "Description found", description: "Review and edit before saving." });
      } else {
        toast({
          title: "No description found",
          description: "Try a more specific product name or enter manually.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Search failed",
        description: "Could not reach search service. Enter description manually.",
        variant: "destructive",
      });
    } finally {
      setFetchingDescription(false);
    }
  }

  async function handleQuickUpdate() {
    if (!workspaceId) return;
    
    const cost = parseFloat(supplierPrice);
    if (isNaN(cost) || cost <= 0) {
      toast({
        title: "Invalid price",
        description: "Please enter a valid cost price",
        variant: "destructive",
      });
      return;
    }

    setProcessingQuickUpdate(true);
    
    try {
      // Calculate selling price
      const costPrice = cost;
      const sellingPrice = parseFloat((costPrice * (1 + markupPercent / 100)).toFixed(2));
      
      // BULK MODE: Update multiple selected items
      if (!quickUpdateItem && selectedItems.size > 0) {
        let successCount = 0;
        let cloudinaryUrl = "";
        
        // Download and upload image once if URL provided
        if (supplierImageUrl.trim()) {
          toast({
            title: "Downloading image...",
            description: "Fetching image from supplier website",
          });
          
          try {
            const imageFile = await downloadImageFromUrl(supplierImageUrl);
            
            if (imageFile) {
              toast({
                title: "Uploading to Cloudinary...",
                description: "This may take a moment",
              });
              
              const folder = `workspaces/${workspaceId}/inventory`;
              cloudinaryUrl = await uploadImageToCloudinary(imageFile, folder);
            }
          } catch (imgError: any) {
            toast({
              title: "Image upload failed",
              description: imgError.message || "Will update prices only",
              variant: "destructive",
            });
          }
        }
        
        // Update all selected items
        for (const itemId of selectedItems) {
          try {
            const updates: any = {
              costPrice,
              price: sellingPrice,
            };
        
            if (cloudinaryUrl) {
              updates.imageUrl = cloudinaryUrl;
            }
        
            // Add pack sales fields if enabled
            if (bulkEnablePackSales && bulkPackSize && parseInt(bulkPackSize) > 1) {
              updates.packSize = parseInt(bulkPackSize);
              updates.packPrice = bulkPackPrice ? parseFloat(bulkPackPrice) : undefined;
            } else if (!bulkEnablePackSales) {
              // Clear pack sales if disabled
              updates.packSize = null;
              updates.packPrice = null;
            }
        
            await inventoryService.update(workspaceId, itemId, updates);
            successCount++;
          } catch (error) {
            console.error(`Failed to update ${itemId}:`, error);
          }
        }
        
        toast({
          title: "Bulk update complete!",
          description: `Updated ${successCount} of ${selectedItems.size} items - Cost: R${costPrice}, Price: R${sellingPrice}`,
        });
        
        clearSelection();
      }
      // SINGLE MODE: Update one item
      else if (quickUpdateItem) {
        let cloudinaryUrl = quickUpdateItem.imageUrl;
        
        // Download and upload image if URL provided
        if (supplierImageUrl.trim()) {
          toast({
            title: "Downloading image...",
            description: "Fetching image from supplier website",
          });
          
          try {
            const imageFile = await downloadImageFromUrl(supplierImageUrl);
            
            if (imageFile) {
              toast({
                title: "Uploading to Cloudinary...",
                description: "This may take a moment",
              });
              
              const folder = `workspaces/${workspaceId}/inventory`;
              cloudinaryUrl = await uploadImageToCloudinary(imageFile, folder);
            }
          } catch (imgError: any) {
            // Continue anyway with price update even if image fails
            toast({
              title: "Image update failed",
              description: imgError.message || "Will update price only",
              variant: "destructive",
            });
          }
        }
        
        // Update inventory
        const updates: any = {
          costPrice,
          price: sellingPrice,
        };

        if (cloudinaryUrl !== quickUpdateItem.imageUrl) {
          updates.imageUrl = cloudinaryUrl;
        }

        if (quickUpdateDescription.trim()) {
          updates.description = quickUpdateDescription.trim();
        }
        
        // Add pack sales fields if enabled
        if (bulkEnablePackSales && bulkPackSize && parseInt(bulkPackSize) > 1) {
          updates.packSize = parseInt(bulkPackSize);
          updates.packPrice = bulkPackPrice ? parseFloat(bulkPackPrice) : undefined;
        } else if (!bulkEnablePackSales) {
          // Clear pack sales if disabled
          updates.packSize = null;
          updates.packPrice = null;
        }
        
        await inventoryService.update(workspaceId, quickUpdateItem.id, updates);
        
        toast({
          title: "Success!",
          description: `Updated ${quickUpdateItem.name} - Cost: R${costPrice}, Price: R${sellingPrice}`,
        });
      }
      
      await load();
      setShowQuickUpdate(false);
      setSupplierImageUrl("");
      setSupplierPrice("");
      setQuickUpdateDescription("");
      setBulkEnablePackSales(false);
      setBulkPackSize("");
      setBulkPackPrice("");
    } catch (error: any) {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update item",
        variant: "destructive",
      });
    } finally {
      setProcessingQuickUpdate(false);
    }
  }

  function handleCsvFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const isCSV = file.name.endsWith('.csv');
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

    if (!isCSV && !isExcel) {
      toast({
        title: "Invalid file",
        description: "Please select a CSV or Excel file (.csv, .xlsx, .xls)",
        variant: "destructive",
      });
      return;
    }

    setCsvFile(file);
    
    if (isExcel) {
      parseExcelFile(file);
    } else {
      parseCsvFile(file);
    }
  }

  function parseCsvFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        toast({
          title: "Invalid CSV",
          description: "CSV must have headers and at least one data row",
          variant: "destructive",
        });
        return;
      }

      // Keep original column names for display
      const originalHeaders = lines[0].split(',').map(h => h.trim());
      setAvailableColumns(originalHeaders);
      
      const data = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row: any = {};
        
        originalHeaders.forEach((header, index) => {
          row[header] = values[index] || '';
        });
        
        data.push(row);
      }

      setRawParsedData(data);
      setImportStep('map');
      
      toast({
        title: "File uploaded",
        description: `Found ${data.length} rows with ${originalHeaders.length} columns. Please map the columns.`,
      });
    };
    reader.readAsText(file);
  }

  function parseExcelFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        
        // Get first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Get the range of the worksheet
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
        
        // Extract all column headers from the first row
        const headers: string[] = [];
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
          const cell = worksheet[cellAddress];
          headers.push(cell ? String(cell.v).trim() : `Column ${col + 1}`);
        }
        
        // Convert to JSON preserving all columns
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
          raw: false,
          defval: '' // Use empty string for missing cells
        });
        
        if (jsonData.length === 0) {
          toast({
            title: "Empty file",
            description: "Excel file has no data rows",
            variant: "destructive",
          });
          return;
        }
        
        console.log('Excel headers found:', headers);
        console.log('First row data:', jsonData[0]);
        
        setAvailableColumns(headers);
        setRawParsedData(jsonData);
        setImportStep('map');
        
        toast({
          title: "File uploaded",
          description: `Found ${jsonData.length} rows with ${headers.length} columns. Please map the columns.`,
        });
      } catch (error) {
        console.error('Error parsing Excel:', error);
        toast({
          title: "Parse error",
          description: "Failed to parse Excel file. Please check the format.",
          variant: "destructive",
        });
      }
    };
    reader.readAsBinaryString(file);
  }

  function applyMapping() {
    if (!columnMapping.name || columnMapping.name === '__skip__' || !columnMapping.sku || columnMapping.sku === '__skip__') {
      toast({
        title: "Mapping incomplete",
        description: "Please map at least 'Name' and 'SKU' fields",
        variant: "destructive",
      });
      return;
    }

    console.log('Column Mapping:', columnMapping);
    console.log('Sample row:', rawParsedData[0]);

    const mappedData = rawParsedData.map((row, index) => {
      const item = {
        name: row[columnMapping.name] || '',
        sku: row[columnMapping.sku] || '',
        description: (columnMapping.description && columnMapping.description !== '__skip__') ? row[columnMapping.description] || '' : '',
        category: (columnMapping.category && columnMapping.category !== '__skip__') ? row[columnMapping.category] || categories[0] || '' : categories[0] || '',
        price: (columnMapping.price && columnMapping.price !== '__skip__') ? parseFloat(String(row[columnMapping.price] || '0').replace(/[^0-9.-]/g, '')) || 0 : 0,
        costPrice: (columnMapping.costPrice && columnMapping.costPrice !== '__skip__') ? parseFloat(String(row[columnMapping.costPrice] || '0').replace(/[^0-9.-]/g, '')) || 0 : 0,
        quantity: (columnMapping.quantity && columnMapping.quantity !== '__skip__') ? parseInt(String(row[columnMapping.quantity] || '0').replace(/[^0-9]/g, '')) || 0 : 0,
        reorderLevel: (columnMapping.reorderLevel && columnMapping.reorderLevel !== '__skip__') ? parseInt(String(row[columnMapping.reorderLevel] || '5').replace(/[^0-9]/g, '')) || 5 : 5,
        supplier: (columnMapping.supplier && columnMapping.supplier !== '__skip__') ? row[columnMapping.supplier] || '' : '',
        location: (columnMapping.location && columnMapping.location !== '__skip__') ? row[columnMapping.location] || '' : '',
        status: 'active' as const,
      };
      
      // Debug first few rows
      if (index < 3) {
        console.log(`Row ${index + 1}:`, {
          name: item.name,
          sku: item.sku,
          quantity: item.quantity,
          quantityRaw: row[columnMapping.quantity || ''],
          price: item.price,
          priceRaw: row[columnMapping.price || '']
        });
      }
      
      return item;
    });

    const validItems = mappedData.filter(item => item.name && item.sku);
    console.log(`Total rows: ${mappedData.length}, Valid items: ${validItems.length}`);
    
    setCsvData(validItems);
    setImportStep('preview');
    
    toast({
      title: "Mapping applied",
      description: `Ready to import ${mappedData.filter(item => item.name && item.sku).length} items`,
    });
  }

  async function importCsvData() {
    if (!workspaceId || csvData.length === 0) return;

    setImporting(true);
    setImportProgress(0);
    
    try {
      let successCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < csvData.length; i++) {
        try {
          const itemData = csvData[i];
          
          // Check if item with same SKU already exists
          const existingItem = await inventoryService.findBySku(workspaceId, itemData.sku);
          
          if (existingItem) {
            // Duplicate found - handle based on strategy
            if (duplicateStrategy === 'skip') {
              skippedCount++;
            } else if (duplicateStrategy === 'update') {
              // Update existing item with new data
              await inventoryService.update(workspaceId, existingItem.id, itemData);
              updatedCount++;
            } else {
              // Create new item anyway (duplicate)
              await inventoryService.add(workspaceId, itemData);
              successCount++;
            }
          } else {
            // No duplicate - create new item
            await inventoryService.add(workspaceId, itemData);
            successCount++;
          }
        } catch (error) {
          console.error(`Failed to import item ${i + 1}:`, error);
          errorCount++;
        }
        setImportProgress(Math.round(((i + 1) / csvData.length) * 100));
      }

      const messages = [];
      if (successCount > 0) messages.push(`${successCount} new items`);
      if (updatedCount > 0) messages.push(`${updatedCount} updated`);
      if (skippedCount > 0) messages.push(`${skippedCount} skipped`);
      if (errorCount > 0) messages.push(`${errorCount} failed`);

      toast({
        title: "Import complete",
        description: messages.join(', '),
      });

      await load();
      setShowImportCSV(false);
      setCsvFile(null);
      setRawParsedData([]);
      setAvailableColumns([]);
      setColumnMapping({});
      setCsvData([]);
      setImportProgress(0);
      setImportStep('upload');
    } catch (error) {
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Failed to import CSV",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  }

  async function deleteItem(item: InventoryItem) {
    if (!workspaceId) return;
    await inventoryService.delete(workspaceId, item.id);
    setShowDeleteConfirm(null);
    await load();
  }

  // Clone a product — duplicates it with a unique SKU (base-1, base-2, …).
  async function cloneItem(item: InventoryItem) {
    if (!workspaceId) return;
    setCloningId(item.id);
    try {
      // Strip any existing -N suffix to get the base, then find the next free one.
      const baseSku = (item.sku || item.name || "item").replace(/-\d+$/, "");
      const existingSkus = new Set(items.map((it) => it.sku));
      let n = 1;
      while (existingSkus.has(`${baseSku}-${n}`)) n++;
      const newSku = `${baseSku}-${n}`;

      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = item;
      const clone = { ...rest, sku: newSku, quantity: 0 } as Omit<InventoryItem, "id" | "createdAt" | "updatedAt">;

      const newId = await inventoryService.add(workspaceId, clone);
      const nowIso = new Date().toISOString();
      setItems((prev) => [{ ...(clone as any), id: newId, createdAt: nowIso, updatedAt: nowIso } as InventoryItem, ...prev]);
      toast({ title: "Product cloned", description: `Created "${item.name}" as ${newSku} (stock starts at 0).` });
    } catch (e: any) {
      toast({ title: "Clone failed", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setCloningId(null);
    }
  }

  // Bulk Operations
  function toggleSelectItem(itemId: string) {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  }

  function toggleSelectAll() {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(item => item.id)));
    }
  }

  function clearSelection() {
    setSelectedItems(new Set());
    setBulkAction(null);
  }

  async function handleBulkDelete() {
    if (!workspaceId || selectedItems.size === 0) return;
    
    setProcessingBulk(true);
    try {
      let successCount = 0;
      for (const itemId of selectedItems) {
        try {
          await inventoryService.delete(workspaceId, itemId);
          successCount++;
        } catch (error) {
          console.error(`Failed to delete ${itemId}:`, error);
        }
      }
      
      toast({
        title: "Bulk delete complete",
        description: `Deleted ${successCount} of ${selectedItems.size} items`,
      });
      
      clearSelection();
      setBulkAction(null);
      await load();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete items",
        variant: "destructive",
      });
    } finally {
      setProcessingBulk(false);
    }
  }

  async function handleBulkCategoryChange() {
    if (!workspaceId || selectedItems.size === 0 || !bulkCategory) return;
    
    setProcessingBulk(true);
    try {
      let successCount = 0;
      for (const itemId of selectedItems) {
        try {
          await inventoryService.update(workspaceId, itemId, { category: bulkCategory });
          successCount++;
        } catch (error) {
          console.error(`Failed to update ${itemId}:`, error);
        }
      }
      
      toast({
        title: "Category updated",
        description: `Updated ${successCount} of ${selectedItems.size} items to "${bulkCategory}"`,
      });
      
      clearSelection();
      setBulkAction(null);
      setBulkCategory("");
      await load();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update categories",
        variant: "destructive",
      });
    } finally {
      setProcessingBulk(false);
    }
  }

  async function handleBulkStatusChange() {
    if (!workspaceId || selectedItems.size === 0) return;
    
    setProcessingBulk(true);
    try {
      let successCount = 0;
      for (const itemId of selectedItems) {
        try {
          await inventoryService.update(workspaceId, itemId, { status: bulkStatus });
          successCount++;
        } catch (error) {
          console.error(`Failed to update ${itemId}:`, error);
        }
      }
      
      toast({
        title: "Status updated",
        description: `Updated ${successCount} of ${selectedItems.size} items to "${bulkStatus}"`,
      });
      
      clearSelection();
      setBulkAction(null);
      await load();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    } finally {
      setProcessingBulk(false);
    }
  }

  function openAdjust(item: InventoryItem) {
    setAdjustItem(item);
    setAdjustDelta("");
    setAdjustReason(REASONS[0]);
    setAdjustNotes("");
    setShowAdjust(true);
  }
  async function saveAdjust() {
    if (!workspaceId || !adjustItem || !user) return;
    const delta = parseInt(adjustDelta);
    if (!delta || isNaN(delta)) { setErrorMsg("Enter a non-zero adjustment value"); return; }
    if (!adjustReason) { setErrorMsg("Please select a reason"); return; }
    setAdjustSaving(true);
    try {
      await inventoryService.adjustStock(
        workspaceId, adjustItem, delta, adjustReason, user.uid, adjustNotes
      );
      // Update the item quantity directly in state for instant UI feedback
      const newQty = Math.max(0, adjustItem.quantity + delta);
      setItems((prev) =>
        prev.map((i) => (i.id === adjustItem.id ? { ...i, quantity: newQty } : i))
      );
      setShowAdjust(false);
      // Reload in background to sync movements tab
      load().catch(() => {});
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to adjust stock — check Firestore permissions");
    } finally {
      setAdjustSaving(false);
    }
  }

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  }
  function SortIcon({ field }: { field: typeof sortField }) {
    if (sortField !== field) return null;
    return sortDir === "asc" ? <ChevronUp className="h-3 w-3 inline ml-0.5" /> : <ChevronDown className="h-3 w-3 inline ml-0.5" />;
  }

  function stockBadge(item: InventoryItem) {
    if (item.status === "on_order") return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">On order</Badge>;
    if (item.quantity === 0) return <Badge variant="destructive">Out of stock</Badge>;
    if (item.quantity <= item.reorderLevel) return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Low stock</Badge>;
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">In stock</Badge>;
  }

  return (
    <div className="absolute inset-0 bg-background z-30 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background shrink-0">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Inventory</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
            <Settings className="h-4 w-4 mr-1" /> Categories
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowImportCSV(true)}>
            <Upload className="h-4 w-4 mr-1" /> Import
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1" /> Add Item
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 px-4 py-3 bg-muted/40 border-b shrink-0">
        {[
          { label: "Total SKUs", value: stats.total, icon: Package, color: "text-blue-600" },
          { label: "Low Stock", value: stats.lowStock, icon: AlertTriangle, color: "text-amber-600" },
          { label: "Out of Stock", value: stats.outOfStock, icon: TrendingDown, color: "text-red-600" },
          { label: "Cost Value", value: `R${stats.costValue.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`, icon: BarChart3, color: "text-orange-600" },
          { label: "Retail Value", value: `R${stats.retailValue.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`, icon: TrendingUp, color: "text-green-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-background rounded-lg p-3 flex items-center gap-3 border">
            <Icon className={cn("h-5 w-5 shrink-0", color)} />
            <div>
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="font-semibold text-sm">{value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Error banner */}
      {errorMsg && (
        <div className="mx-4 mt-2 shrink-0 rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-4 px-4 pt-3 shrink-0 overflow-x-auto border-b border-border">
        {(["products", "movements", "barcodes", "batch", "printer", "recently_added", "latest_edited", "latest_sold", "to_order"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "pb-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px",
              tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "products" ? "Products"
              : t === "movements" ? "Stock Movements"
              : t === "barcodes" ? "Barcodes"
              : t === "batch" ? "Batch Editor"
              : t === "printer" ? "Printer Settings"
              : t === "recently_added" ? "Recently Added"
              : t === "latest_edited" ? "Latest Edited"
              : t === "latest_sold" ? "Latest Sold"
              : "To Order"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {tab === "batch" ? (
          <div className="h-full -mx-4 -my-3">
            {workspaceId && (
              <InventoryBulkEditor
                workspaceId={workspaceId}
                embedded
                onClose={() => setTab("products")}
              />
            )}
          </div>
        ) : tab === "products" ? (
          <>
            {/* Blank items warning */}
            {blankItems.length > 0 && (
              <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <p className="text-sm text-amber-800 flex-1">
                  <span className="font-semibold">{blankItems.length} blank record{blankItems.length !== 1 ? "s" : ""}</span> found with no name or data — likely from a failed import. They are hidden from the list below.
                </p>
                <button
                  onClick={deleteBlankItems}
                  disabled={deletingBlanks}
                  className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-800 border border-red-200 bg-white rounded px-2.5 py-1 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  {deletingBlanks ? "Deleting…" : `Delete ${blankItems.length} blank`}
                </button>
              </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search name, SKU, supplier…"
                  className="pl-8 h-8 text-sm"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <Select value={filterCategory} onValueChange={(v) => { setFilterCategory(v); setFilterSubcategory("all"); }}>
                <SelectTrigger className="h-8 text-sm w-[150px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              {filterCategory !== "all" && (subcategoryMap[filterCategory]?.length ?? 0) > 0 && (
                <Select value={filterSubcategory} onValueChange={setFilterSubcategory}>
                  <SelectTrigger className="h-8 text-sm w-[160px]">
                    <SelectValue placeholder="Subcategory" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All subcategories</SelectItem>
                    {(subcategoryMap[filterCategory] || []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Select value={filterVoltage} onValueChange={setFilterVoltage}>
                <SelectTrigger className="h-8 text-sm w-[150px]">
                  <SelectValue placeholder="Voltage" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All voltages</SelectItem>
                  {allVoltageOptions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterAmperage} onValueChange={setFilterAmperage}>
                <SelectTrigger className="h-8 text-sm w-[160px]">
                  <SelectValue placeholder="Amperage" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All amperages</SelectItem>
                  {allAmperageOptions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
                <SelectTrigger className="h-8 text-sm w-[130px]">
                  <SelectValue placeholder="Stock status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stock</SelectItem>
                  <SelectItem value="low">Low stock</SelectItem>
                  <SelectItem value="out">Out of stock</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground ml-auto">{filteredItems.length} items</span>
            </div>

            {/* Bulk Actions Toolbar */}
            {selectedItems.size > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <CheckSquare className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-900">
                    {selectedItems.size} item{selectedItems.size > 1 ? 's' : ''} selected
                  </span>
                </div>
                <div className="flex-1"></div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-blue-600 hover:text-blue-700"
                    onClick={() => {
                      setQuickUpdateItem(null); // null means bulk mode
                      setProductPageUrl("");
                      setSupplierImageUrl("");
                      setSupplierPrice("");
                      setMarkupPercent(30);
                      setShowQuickUpdate(true);
                    }}
                  >
                    <Download className="h-3.5 w-3.5 mr-1" />
                    Quick Update
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => setBulkAction('category')}
                  >
                    Change Category
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => setBulkAction('status')}
                  >
                    Change Status
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-destructive hover:text-destructive"
                    onClick={() => setBulkAction('delete')}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={clearSelection}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="text-center py-16 text-muted-foreground">Loading…</div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No items found</p>
                <Button size="sm" className="mt-3" onClick={openAdd}><Plus className="h-4 w-4 mr-1" />Add first item</Button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="w-12 px-3 py-2">
                        <button
                          onClick={toggleSelectAll}
                          className="flex items-center justify-center w-5 h-5 text-muted-foreground hover:text-foreground"
                        >
                          {selectedItems.size === filteredItems.length && filteredItems.length > 0 ? (
                            <CheckSquare className="h-4 w-4" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      </th>
                      <th className="text-left px-3 py-2 font-medium cursor-pointer select-none w-48 min-w-[160px]" onClick={() => toggleSort("name")}>
                        Name <SortIcon field="name" />
                      </th>
                      <th className="text-left px-3 py-2 font-medium hidden xl:table-cell w-64 max-w-xs">Description</th>
                      <th className="text-left px-3 py-2 font-medium hidden md:table-cell w-32">SKU</th>
                      <th className="text-left px-3 py-2 font-medium hidden lg:table-cell w-28">Category</th>
                      <th className="text-right px-3 py-2 font-medium cursor-pointer select-none w-16" onClick={() => toggleSort("quantity")}>
                        Qty <SortIcon field="quantity" />
                      </th>
                      <th className="text-left px-3 py-2 font-medium hidden md:table-cell w-24">Status</th>
                      <th className="text-right px-3 py-2 font-medium cursor-pointer select-none hidden sm:table-cell w-24" onClick={() => toggleSort("price")}>
                        Price <SortIcon field="price" />
                      </th>
                      <th className="text-right px-3 py-2 font-medium hidden lg:table-cell w-20">Cost</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredItems.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2">
                          <button
                            onClick={() => toggleSelectItem(item.id)}
                            className="flex items-center justify-center w-5 h-5 text-muted-foreground hover:text-foreground"
                          >
                            {selectedItems.has(item.id) ? (
                              <CheckSquare className="h-4 w-4 text-blue-600" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-2 font-medium">
                          <div className="flex items-center gap-2">
                            {item.itemType !== "service" && item.imageUrl ? (
                              <img src={getThumbnailUrl(item.imageUrl)} alt={item.name} className="w-10 h-10 rounded object-cover" />
                            ) : item.itemType === "service" ? (
                              <div className="w-10 h-10 rounded bg-blue-50 flex items-center justify-center">
                                <span className="text-base">🔧</span>
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                                <Package className="h-5 w-5 text-muted-foreground" />
                              </div>
                            )}
                            <div>
                              <div className="flex items-center gap-1.5">
                                {item.name}
                                {item.itemType === "service" && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700 border border-blue-200">SERVICE</span>
                                )}
                              </div>
                              {(item.manufacturer || item.supplier) && (
                                <div className="text-xs text-muted-foreground">
                                  {[item.manufacturer, item.supplier].filter(Boolean).join(" · ")}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 hidden xl:table-cell max-w-xs">
                          <span className="text-xs text-muted-foreground line-clamp-2">{item.description || ""}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs hidden md:table-cell">{item.sku}</td>
                        <td className="px-3 py-2 hidden lg:table-cell">{item.category}</td>
                        <td className={cn("px-3 py-2 text-right font-semibold", item.itemType === "service" ? "text-muted-foreground" : item.quantity === 0 ? "text-red-600" : item.quantity <= item.reorderLevel ? "text-amber-600" : "text-green-700")}>
                          {item.itemType === "service" ? "—" : item.quantity}
                        </td>
                        <td className="px-3 py-2 hidden md:table-cell">{item.itemType === "service" ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">No stock</span> : stockBadge(item)}</td>
                        <td className="px-3 py-2 text-right hidden sm:table-cell">R{(Number(item.price) || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground hidden lg:table-cell">R{(Number(item.costPrice) || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {item.itemType !== "service" && (
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Adjust stock" onClick={() => openAdjust(item)}>
                              <TrendingUp className="h-3.5 w-3.5" />
                            </Button>
                            )}
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Edit" onClick={() => openEdit(item)}>
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-purple-600 hover:text-purple-700" title="Clone product" disabled={cloningId === item.id} onClick={() => cloneItem(item)}>
                              {cloningId === item.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700" title="Quick update from supplier" onClick={() => openQuickUpdate(item)}>
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Delete" onClick={() => setShowDeleteConfirm(item)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}

        {tab === "movements" && (
          <>
            {movements.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <BarChart3 className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No stock movements yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-left px-3 py-2 font-medium">Product</th>
                      <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Type</th>
                      <th className="text-right px-3 py-2 font-medium">Qty</th>
                      <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Before</th>
                      <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">After</th>
                      <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {movements.map((m) => (
                      <tr key={m.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          {m.timestamp.toLocaleDateString("en-ZA")}<br />
                          <span>{m.timestamp.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</span>
                        </td>
                        <td className="px-3 py-2 font-medium">{m.productName}</td>
                        <td className="px-3 py-2 hidden md:table-cell">
                          <Badge className={cn("capitalize", m.type === "in" ? "bg-green-100 text-green-800 hover:bg-green-100" : m.type === "out" ? "bg-red-100 text-red-800 hover:bg-red-100" : "bg-blue-100 text-blue-800 hover:bg-blue-100")}>
                            {m.type}
                          </Badge>
                        </td>
                        <td className={cn("px-3 py-2 text-right font-semibold", m.type === "in" ? "text-green-700" : "text-red-600")}>
                          {m.type === "in" ? "+" : "-"}{m.quantity}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground hidden sm:table-cell">{m.previousQuantity}</td>
                        <td className="px-3 py-2 text-right font-medium hidden sm:table-cell">{m.newQuantity}</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs hidden lg:table-cell">{m.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === "barcodes" && (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search name, SKU or barcode…"
                  className="pl-8 h-8 text-sm"
                  value={barcodeSearch}
                  onChange={(e) => setBarcodeSearch(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={generateAllMissingBarcodes}
                disabled={generatingBarcodes}
              >
                {generatingBarcodes ? "Generating…" : "⚡ Generate All Missing"}
              </Button>
              <Button
                variant={showAlignPreview ? "default" : "outline"}
                size="sm"
                onClick={() => setShowAlignPreview((v) => !v)}
              >
                🎯 Align
              </Button>
              {/* Template + start position picker */}
              {(() => {
                const tmpl = barcodeLabelTemplateId === "custom"
                  ? printerConfig.customTemplate
                  : (LABEL_TEMPLATES.find((t) => t.id === barcodeLabelTemplateId)?.config ?? DEFAULT_PRINTER_CONFIG.customTemplate);
                const total = tmpl.columns * tmpl.rows;
                const isThermalRoll = tmpl.columns === 1 && tmpl.pageWidth <= 80;
                return (
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      className="h-8 rounded border border-input bg-background px-2 text-xs"
                      value={barcodeLabelTemplateId}
                      onChange={(e) => {
                        const newTmpl = LABEL_TEMPLATES.find((t) => t.id === e.target.value)?.config ?? printerConfig.customTemplate;
                        setBarcodeLabelTemplateId(e.target.value);
                        if (newTmpl.columns === 1 && newTmpl.pageWidth <= 80) setStartBarcodeLabel(1);
                        else setStartBarcodeLabel(1);
                      }}
                    >
                      {LABEL_TEMPLATES.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    {!isThermalRoll && (
                      <>
                        <div className="text-xs text-muted-foreground whitespace-nowrap">Start at:</div>
                        <div
                          className="inline-grid gap-px border rounded p-1 bg-muted/40 cursor-pointer"
                          style={{ gridTemplateColumns: `repeat(${tmpl.columns}, 1fr)` }}
                          title="Click first empty label on your sheet"
                        >
                          {Array.from({ length: total }, (_, i) => {
                            const pos = i + 1;
                            return (
                              <div
                                key={i}
                                onClick={() => setStartBarcodeLabel(pos)}
                                title={`Start from label ${pos}`}
                                className={`rounded-sm transition-colors ${
                                  pos < startBarcodeLabel
                                    ? "bg-slate-400"
                                    : pos === startBarcodeLabel
                                    ? "bg-primary"
                                    : "bg-white hover:bg-blue-100 border border-gray-200"
                                }`}
                                style={{ width: 11, height: 6 }}
                              />
                            );
                          })}
                        </div>
                        {startBarcodeLabel > 1 && (
                          <span className="text-xs text-muted-foreground">#{startBarcodeLabel}</span>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}
              <Button
                size="sm"
                disabled={selectedBarcodeItems.size === 0}
                onClick={() =>
                  printBarcodeLabels(
                    items.filter((i) => selectedBarcodeItems.has(i.id))
                  )
                }
              >
                🖨️ Print Selected ({selectedBarcodeItems.size})
              </Button>
            </div>

            {/* Alignment panel */}
            {showAlignPreview && (() => {
              const tmpl = barcodeLabelTemplateId === "custom"
                ? printerConfig.customTemplate
                : (LABEL_TEMPLATES.find((t) => t.id === barcodeLabelTemplateId)?.config ?? DEFAULT_PRINTER_CONFIG.customTemplate);
              const align = currentAlign;
              const previewScale = 3; // px per mm
              const pw = tmpl.pageWidth * previewScale;
              const ph = tmpl.pageHeight * previewScale;
              const baseLW = align.labelW ?? tmpl.labelW;
              const baseLH = align.labelH ?? tmpl.labelH;
              const lw = baseLW * align.scale * previewScale;
              const lh = baseLH * align.scale * previewScale;
              const mt = (tmpl.marginTop + align.offY) * previewScale;
              const ml = (tmpl.marginLeft + align.offX) * previewScale;
              const sampleItem = [...selectedBarcodeItems].length > 0
                ? items.find((i) => selectedBarcodeItems.has(i.id))
                : items.find((i) => i.barcode);
              return (
                <div className="border rounded-lg p-4 bg-muted/30 mb-3 flex flex-wrap gap-6 items-start">
                  {/* Live preview — 3 labels stacked to show next-print position */}
                  <div className="flex flex-col items-center gap-1">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Preview</div>
                    <div className="flex flex-col gap-0">
                      {[0, 1, 2].map((idx) => (
                        <div
                          key={idx}
                          className="relative border-2 border-dashed border-gray-300 bg-white"
                          style={{ width: pw, height: ph, minWidth: pw, minHeight: ph }}
                        >
                          <div
                            className="absolute border border-gray-800 bg-white overflow-hidden flex flex-col items-center justify-center text-center"
                            style={{ left: ml, top: mt, width: lw, height: lh, fontSize: Math.max(4, lh * 0.12) }}
                          >
                            {sampleItem ? (
                              <>
                                {printerConfig.content.showName && <div style={{ fontSize: Math.max(4, lh * 0.14), fontWeight: 'bold', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '100%', padding: '0 2px' }}>{sampleItem.name}</div>}
                                {printerConfig.content.showSku && sampleItem.sku && <div style={{ fontSize: Math.max(3, lh * 0.11), color: '#555', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '100%' }}>{sampleItem.sku}</div>}
                                <div style={{ fontSize: Math.max(3, lh * 0.1), color: '#999', border: '1px solid #ccc', padding: '1px 4px', margin: '1px 0' }}>▮▯▮▯▮▮▯▮</div>
                                {printerConfig.content.showPrice && sampleItem.price && <div style={{ fontSize: Math.max(3, lh * 0.13), fontWeight: 'bold' }}>R{sampleItem.price.toFixed(2)}</div>}
                              </>
                            ) : (
                              <div style={{ color: '#aaa', fontSize: 8 }}>Sample</div>
                            )}
                          </div>
                          {idx < 2 && (
                            <div className="absolute bottom-0 left-0 right-0 text-center" style={{ fontSize: 7, color: '#bbb', lineHeight: '10px' }}>
                              — next print —
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">{tmpl.pageWidth}×{tmpl.pageHeight}mm page</div>
                  </div>

                  {/* Controls */}
                  <div className="flex flex-col gap-3">
                    <div className="text-xs font-medium text-muted-foreground">Adjust for this template</div>

                    {/* Up/Down/Left/Right */}
                    <div className="flex flex-col items-center gap-1">
                      <div className="text-xs text-muted-foreground">Position</div>
                      <button className="border rounded px-3 py-1 text-sm hover:bg-muted" onClick={() => updateAlign({ offY: +(align.offY - 0.5).toFixed(1) })}>▲ Up</button>
                      <div className="flex gap-1">
                        <button className="border rounded px-3 py-1 text-sm hover:bg-muted" onClick={() => updateAlign({ offX: +(align.offX - 0.5).toFixed(1) })}>◀ Left</button>
                        <button className="border rounded px-3 py-1 text-sm hover:bg-muted" onClick={() => updateAlign({ offX: +(align.offX + 0.5).toFixed(1) })}>Right ▶</button>
                      </div>
                      <button className="border rounded px-3 py-1 text-sm hover:bg-muted" onClick={() => updateAlign({ offY: +(align.offY + 0.5).toFixed(1) })}>▼ Down</button>
                    </div>

                    {/* Label size */}
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted-foreground text-center">Label size</div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs w-6">W:</span>
                        <button className="border rounded px-2 py-1 text-sm hover:bg-muted" onClick={() => updateAlign({ labelW: +(baseLW - 0.5).toFixed(1) })}>−</button>
                        <span className="text-xs w-10 text-center">{baseLW.toFixed(1)}mm</span>
                        <button className="border rounded px-2 py-1 text-sm hover:bg-muted" onClick={() => updateAlign({ labelW: +(baseLW + 0.5).toFixed(1) })}>+</button>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs w-6">H:</span>
                        <button className="border rounded px-2 py-1 text-sm hover:bg-muted" onClick={() => updateAlign({ labelH: +(baseLH - 0.5).toFixed(1) })}>−</button>
                        <span className="text-xs w-10 text-center">{baseLH.toFixed(1)}mm</span>
                        <button className="border rounded px-2 py-1 text-sm hover:bg-muted" onClick={() => updateAlign({ labelH: +(baseLH + 0.5).toFixed(1) })}>+</button>
                      </div>
                    </div>

                    {/* Font size */}
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted-foreground text-center">Text size</div>
                      <div className="flex items-center gap-1 justify-center">
                        <button className="border rounded px-2 py-1 text-sm hover:bg-muted" onClick={() => updateAlign({ fontScale: +((align.fontScale ?? 1) - 0.1).toFixed(2) })}>− Smaller</button>
                        <span className="text-xs w-10 text-center">{((align.fontScale ?? 1) * 100).toFixed(0)}%</span>
                        <button className="border rounded px-2 py-1 text-sm hover:bg-muted" onClick={() => updateAlign({ fontScale: +((align.fontScale ?? 1) + 0.1).toFixed(2) })}>+ Bigger</button>
                      </div>
                    </div>

                    {/* Barcode size */}
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-muted-foreground text-center">Barcode size</div>
                      <div className="flex items-center gap-1 justify-center">
                        <button className="border rounded px-2 py-1 text-sm hover:bg-muted" onClick={() => updateAlign({ barcodeScale: +((align.barcodeScale ?? 1) - 0.1).toFixed(2) })}>− Smaller</button>
                        <span className="text-xs w-10 text-center">{((align.barcodeScale ?? 1) * 100).toFixed(0)}%</span>
                        <button className="border rounded px-2 py-1 text-sm hover:bg-muted" onClick={() => updateAlign({ barcodeScale: +((align.barcodeScale ?? 1) + 0.1).toFixed(2) })}>+ Bigger</button>
                      </div>
                    </div>

                    {/* Reset */}
                    <button className="border rounded px-3 py-1 text-sm hover:bg-muted text-center" onClick={() => updateAlign({ offX: 0, offY: 0, scale: 1, labelW: undefined, labelH: undefined, fontScale: 1, barcodeScale: 1 })}>↺ Reset all</button>

                    {/* Saved indicator */}
                    <div className="text-xs text-green-600 text-center font-medium">✓ Settings auto-saved</div>

                    {/* Test print */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const sample = sampleItem ?? items.find((i) => i.barcode);
                        if (sample) printBarcodeLabels([sample]);
                      }}
                    >
                      🖨️ Test Print
                    </Button>
                  </div>
                </div>
              );
            })()}

            {/* Select-all row */}
            <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
              <button
                className="flex items-center gap-1.5 hover:text-foreground"
                onClick={() => {
                  const withBarcodes = barcodeFilteredItems.filter((i) => i.barcode);
                  if (selectedBarcodeItems.size === withBarcodes.length && withBarcodes.length > 0) {
                    setSelectedBarcodeItems(new Set());
                  } else {
                    setSelectedBarcodeItems(new Set(withBarcodes.map((i) => i.id)));
                  }
                }}
              >
                {selectedBarcodeItems.size > 0 ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                Select all with barcodes
              </button>
              <span className="ml-auto text-xs">
                {barcodeFilteredItems.filter((i) => i.barcode).length} / {barcodeFilteredItems.length} have barcodes
              </span>
            </div>

            {/* Item list */}
            {barcodeFilteredItems.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No items found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {barcodeFilteredItems.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border bg-card transition-colors",
                      selectedBarcodeItems.has(item.id) && "border-primary/60 bg-primary/5"
                    )}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => {
                        if (!item.barcode) return;
                        const s = new Set(selectedBarcodeItems);
                        s.has(item.id) ? s.delete(item.id) : s.add(item.id);
                        setSelectedBarcodeItems(s);
                      }}
                      className={cn("shrink-0", !item.barcode && "opacity-30 cursor-not-allowed")}
                      title={item.barcode ? "Select for printing" : "Generate a barcode first"}
                    >
                      {selectedBarcodeItems.has(item.id) ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>

                    {/* Thumbnail */}
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="h-12 w-12 rounded object-contain bg-gray-50 border border-gray-100 shrink-0"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded bg-gray-100 flex items-center justify-center shrink-0">
                        <Package className="h-5 w-5 text-gray-300" />
                      </div>
                    )}

                    {/* Item info */}
                    <div className="w-[220px] shrink-0">
                      <p className="text-sm font-semibold truncate leading-tight">{item.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{item.sku}</p>
                      {item.category && (
                        <p className="text-xs text-muted-foreground">{item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}</p>
                      )}
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-tight">{item.description}</p>
                      )}
                      <p className="text-xs font-bold text-green-700 mt-0.5">
                        R{(item.salePrice ?? item.price ?? 0).toFixed(2)}
                        {item.salePrice && item.salePrice < item.price && (
                          <span className="text-muted-foreground font-normal line-through ml-1">R{item.price.toFixed(2)}</span>
                        )}
                      </p>
                    </div>

                    {/* Barcode visual */}
                    <div className="flex-1 flex items-center justify-center min-h-[52px]">
                      {item.barcode ? (
                        <BarcodeDisplay value={item.barcode} height={40} />
                      ) : (
                        <span className="text-xs text-muted-foreground italic">No barcode assigned</span>
                      )}
                    </div>

                    {/* Barcode value */}
                    {item.barcode && (
                      <p className="text-xs font-mono text-muted-foreground shrink-0 hidden sm:block">
                        {item.barcode}
                      </p>
                    )}

                    {/* Actions */}
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          if (!workspaceId) return;
                          const bc = generateBarcode("CODE128");
                          await inventoryService.update(workspaceId, item.id, { barcode: bc });
                          setItems((prev) =>
                            prev.map((i) => (i.id === item.id ? { ...i, barcode: bc } : i))
                          );
                        }}
                      >
                        {item.barcode ? "Regenerate" : "Generate"}
                      </Button>
                      {item.barcode && (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={barcodeCopies[item.id] ?? 1}
                            onChange={(e) =>
                              setBarcodeCopies((prev) => ({
                                ...prev,
                                [item.id]: Math.max(1, parseInt(e.target.value) || 1),
                              }))
                            }
                            className="w-14 h-8 rounded border border-input bg-background px-2 text-sm text-center"
                            title="Number of copies"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              printBarcodeLabels(
                                Array(barcodeCopies[item.id] ?? 1).fill(item)
                              )
                            }
                            title="Print labels"
                          >
                            🖨️
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Printer Settings tab ── */}
        {tab === "printer" && workspaceId && (
          <InventoryPrinterSettings
            workspaceId={workspaceId}
            onConfigChange={setPrinterConfig}
          />
        )}

        {/* ── Recently Added / Latest Edited tabs — inline batch editor with date filter ── */}
        {(tab === "recently_added" || tab === "latest_edited") && workspaceId && (
          <div className="h-full -mx-4 -my-3 flex flex-col">
            {/* Day filter bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
              <span className="text-xs text-muted-foreground font-medium">Show last:</span>
              {[1, 2, 3, 4].map(d => (
                <button
                  key={d}
                  onClick={() => setRecentDays(d)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-semibold border transition-colors",
                    recentDays === d
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
                  )}
                >
                  {d} {d === 1 ? "day" : "days"}
                </button>
              ))}
              <span className="ml-2 text-xs text-muted-foreground">
                {tab === "recently_added" ? "Items added in this window" : "Items edited in this window"}
              </span>
            </div>
            {/* Full batch editor scoped to date window */}
            <div className="flex-1 overflow-hidden">
              <InventoryBulkEditor
                key={`${tab}_${recentDays}`}
                workspaceId={workspaceId}
                embedded
                onClose={() => setTab("products")}
                filterSince={new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000)}
                filterMode={tab === "recently_added" ? "added" : "edited"}
              />
            </div>
          </div>
        )}

        {/* ── Latest Sold / Removed tab ── */}
        {tab === "latest_sold" && workspaceId && (
          <LatestSoldTab workspaceId={workspaceId} items={items} />
        )}

        {/* ── To Order tab ── */}
        {tab === "to_order" && workspaceId && (
          <ToOrderTab workspaceId={workspaceId} />
        )}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={showAddEdit} onOpenChange={(open) => {
        setShowAddEdit(open);
        if (!open) {
          setShowInlineNewCategory(false);
          setInlineNewCategory("");
        }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit Item" : "Add Inventory Item"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {/* Item Type selector */}
            <div>
              <Label className="text-xs mb-1 block">Item Type</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, itemType: "inventory", quantity: formData.itemType === "service" ? 0 : formData.quantity, reorderLevel: formData.itemType === "service" ? 5 : formData.reorderLevel })}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    formData.itemType !== "service"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  )}
                >
                  📦 Physical / Inventory Item
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, itemType: "service", quantity: 0, reorderLevel: 0 })}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                    formData.itemType === "service"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  )}
                >
                  🔧 Service / Labour
                </button>
              </div>
              {formData.itemType === "service" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Service items have no stock tracking — they appear in invoices &amp; quotes as a chargeable line item (e.g. Repair Labour, Diagnostic Fee, Call-out Charge).
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="name" className="text-xs">Name *</Label>
                <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="sku" className="text-xs">SKU *</Label>
                <Input id="sku" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} className="mt-1 font-mono" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              {showInlineNewCategory ? (
                <div className="mt-1 flex gap-2">
                  <Input
                    autoFocus
                    placeholder="New category name…"
                    value={inlineNewCategory}
                    onChange={(e) => setInlineNewCategory(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const name = inlineNewCategory.trim();
                        if (!name) return;
                        if (categories.includes(name)) {
                          toast({ title: "Duplicate", description: "This category already exists", variant: "destructive" });
                          return;
                        }
                        const updated = [...categories, name];
                        await saveCategories(updated);
                        setFormData({ ...formData, category: name });
                        setInlineNewCategory("");
                        setShowInlineNewCategory(false);
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setInlineNewCategory("");
                        setShowInlineNewCategory(false);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={async () => {
                      const name = inlineNewCategory.trim();
                      if (!name) return;
                      if (categories.includes(name)) {
                        toast({ title: "Duplicate", description: "This category already exists", variant: "destructive" });
                        return;
                      }
                      const updated = [...categories, name];
                      await saveCategories(updated);
                      setFormData({ ...formData, category: name });
                      setInlineNewCategory("");
                      setShowInlineNewCategory(false);
                    }}
                    disabled={!inlineNewCategory.trim()}
                  >
                    Add
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setInlineNewCategory("");
                      setShowInlineNewCategory(false);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Select
                  value={formData.category}
                  onValueChange={(v) => {
                    if (v === "__add_new__") {
                      setShowInlineNewCategory(true);
                      return;
                    }
                    setFormData({ ...formData, category: v });
                  }}
                >
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select category…" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    <SelectItem value="__add_new__" className="text-blue-600 font-medium">
                      + Add new category…
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
              {/* Subcategory — only shown when selected category has subcategories */}
              {formData.category && (subcategoryMap[formData.category]?.length ?? 0) > 0 && (
                <div className="mt-2">
                  <Label className="text-xs">Subcategory</Label>
                  <Select
                    value={(formData as any).subcategory || "__none__"}
                    onValueChange={(v) => setFormData({ ...formData, subcategory: v === "__none__" ? "" : v } as any)}
                  >
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select subcategory…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {(subcategoryMap[formData.category] || []).map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {/* Voltage & Amperage — exact values */}
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Voltage</Label>
                  <Select
                    value={(formData as any).voltageRange || "__none__"}
                    onValueChange={(v) => setFormData({ ...formData, voltageRange: v === "__none__" ? undefined : v } as any)}
                  >
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not set —</SelectItem>
                      {VOLTAGE_RANGES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Amperage</Label>
                  <Select
                    value={(formData as any).amperageRange || "__none__"}
                    onValueChange={(v) => setFormData({ ...formData, amperageRange: v === "__none__" ? undefined : v } as any)}
                  >
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not set —</SelectItem>
                      {AMPERAGE_RANGES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div>
              <Label htmlFor="desc" className="text-xs">Description</Label>
              <Textarea id="desc" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="mt-1 h-16 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <Label className="text-xs">{formData.itemType === "service" ? "Rate (R)" : "Sell Price (R)"}</Label>
                <Input type="number" min="0" step="0.01" value={formData.price} onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })} className="mt-1" />
              </div>
              {formData.itemType !== "service" && (
                <div>
                  <Label className="text-xs flex items-center gap-1">
                    Sale Price (R)
                    <span className="text-[10px] text-muted-foreground">optional</span>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="leave blank if no sale"
                    value={formData.salePrice ?? ""}
                    onChange={(e) => setFormData({ ...formData, salePrice: e.target.value ? parseFloat(e.target.value) || undefined : undefined })}
                    className="mt-1"
                  />
                  {formData.salePrice && formData.price > 0 && formData.salePrice < formData.price && (
                    <p className="mt-1 text-[10px] text-emerald-600">
                      Save R{(formData.price - formData.salePrice).toFixed(2)} ({Math.round((1 - formData.salePrice / formData.price) * 100)}% off)
                    </p>
                  )}
                  {formData.salePrice && formData.salePrice >= formData.price && (
                    <p className="mt-1 text-[10px] text-amber-600">
                      Sale price must be lower than the regular price.
                    </p>
                  )}
                </div>
              )}
              <div>
                <Label className="text-xs">Cost Price (R)</Label>
                <Input type="number" min="0" step="0.01" value={formData.costPrice} onChange={(e) => setFormData({ ...formData, costPrice: parseFloat(e.target.value) || 0 })} className="mt-1" />
              </div>
              {formData.itemType !== "service" && (
                <div>
                  <Label className="text-xs">Reorder Level</Label>
                  <Input type="number" min="0" value={formData.reorderLevel} onChange={(e) => setFormData({ ...formData, reorderLevel: parseInt(e.target.value) || 0 })} className="mt-1" />
                </div>
              )}
            </div>
            {/* Pack Sales Configuration */}
            {formData.itemType !== "service" && (
              <div className="border rounded-lg p-3 bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  <Checkbox
                    id="enablePackSales"
                    checked={!!formData.packSize && formData.packSize > 1}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        // Enable pack sales - set default pack size of 2 if not already set
                        setFormData({ ...formData, packSize: formData.packSize || 2 });
                      } else {
                        // Disable pack sales - clear pack fields
                        setFormData({ ...formData, packSize: undefined, packPrice: undefined });
                      }
                    }}
                  />
                  <Label htmlFor="enablePackSales" className="text-xs font-medium cursor-pointer">
                    ☑️ Sell in Packs - Enable pack sales for this item
                  </Label>
                </div>
                
                {formData.packSize && formData.packSize > 1 && (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">
                      Sell multiple units as a single pack item. Stock is tracked per unit but sold per pack.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Units per Pack</Label>
                        <Input
                          type="number"
                          min="2"
                          placeholder="e.g. 2"
                          value={formData.packSize || ""}
                          onChange={(e) => setFormData({ ...formData, packSize: e.target.value ? parseInt(e.target.value) || undefined : undefined })}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Pack Price (R)</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder={formData.price ? `R${(formData.price * formData.packSize).toFixed(2)} (auto)` : "e.g. 3.50"}
                          value={formData.packPrice ?? ""}
                          onChange={(e) => setFormData({ ...formData, packPrice: e.target.value ? parseFloat(e.target.value) || undefined : undefined })}
                          className="mt-1"
                        />
                      </div>
                    </div>
                    {formData.packPrice && formData.price && (
                      <div className="mt-2 text-xs bg-green-50 border border-green-200 rounded p-2">
                        <div className="flex justify-between">
                          <span>Unit price:</span>
                          <span className="font-medium">R{formData.price.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Pack price:</span>
                          <span className="font-medium text-green-700">R{formData.packPrice.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-green-600">
                          <span>Per unit in pack:</span>
                          <span className="font-medium">R{(formData.packPrice / formData.packSize).toFixed(2)}</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
                </div>
                )}
                {formData.itemType !== "service" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Quantity {editingItem && "(use Adjust Stock to change)"}</Label>
                  <Input type="number" min="0" value={formData.quantity} readOnly={!!editingItem} onChange={(e) => !editingItem && setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })} className={cn("mt-1", editingItem && "bg-muted text-muted-foreground")} />
                </div>
                <div>
                  <Label className="text-xs">Supplier</Label>
                  <Input value={formData.supplier} onChange={(e) => setFormData({ ...formData, supplier: e.target.value })} className="mt-1" />
                </div>
              </div>
            )}
            {formData.itemType !== "service" && (
            <div>
              <Label className="text-xs">Manufacturer</Label>
              <Input value={(formData as any).manufacturer ?? ""} onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value } as any)} className="mt-1" placeholder="e.g. Samsung, Bosch, LG" />
            </div>
            )}
            {formData.itemType !== "service" && (
            <div>
              <Label className="text-xs">Location / Shelf</Label>
              <Input value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} className="mt-1" placeholder="e.g. Shelf A3, Bin 12" />
            </div>
            )}
            {formData.itemType !== "service" && (
            <div>
              <Label className="text-xs">Product Image</Label>
              <div className="mt-1 space-y-2">
                {imagePreview ? (
                  <div className="relative">
                    <img src={imagePreview} alt="Preview" className="w-full h-32 object-cover rounded border" />
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={removeImage}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div 
                    className="border-2 border-dashed rounded p-4 text-center cursor-pointer hover:border-primary transition-colors"
                    onClick={() => document.getElementById('image-upload-input')?.click()}
                  >
                    <Image className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-xs text-muted-foreground mb-2">Upload product image (max 5MB)</p>
                  </div>
                )}
                <Input
                  id="image-upload-input"
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
              </div>
            </div>
            )}
            {/* Additional Images */}
            {formData.itemType !== "service" && (
              <div>
                <Label className="text-xs">
                  Additional Images <span className="text-muted-foreground font-normal">(optional — clothing angles, colour variants, etc.)</span>
                </Label>
                <div className="mt-1.5 flex flex-wrap gap-2 items-center">
                  {(formData.extraImages || []).map((url, i) => (
                    <div key={i} className="relative">
                      <img src={url} alt="" className="w-14 h-14 object-cover rounded border" />
                      <button type="button" onClick={() => removeExistingExtraImage(i)}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] hover:bg-red-600 leading-none">
                        ×
                      </button>
                    </div>
                  ))}
                  {pendingExtraImages.map((p, i) => (
                    <div key={`pending_${i}`} className="relative">
                      <img src={p.preview} alt="" className="w-14 h-14 object-cover rounded border border-blue-300 opacity-80" />
                      <button type="button" onClick={() => removePendingExtraImage(i)}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] hover:bg-red-600 leading-none">
                        ×
                      </button>
                    </div>
                  ))}
                  <label className="w-14 h-14 border-2 border-dashed rounded flex flex-col items-center justify-center cursor-pointer hover:border-primary text-muted-foreground hover:text-primary transition-colors gap-0.5">
                    <Plus className="h-4 w-4" />
                    <span className="text-[9px]">Add</span>
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleExtraImageAdd} />
                  </label>
                </div>
              </div>
            )}
            {/* Product Variants */}
            {formData.itemType !== "service" && (
              <div className="border rounded-lg p-3 bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  <Checkbox
                    id="enableVariants"
                    checked={variantsEnabled}
                    onCheckedChange={(checked) => {
                      const on = !!checked;
                      setVariantsEnabled(on);
                      if (on && (formData.productVariants || []).length === 0) {
                        setFormData(prev => ({ ...prev, productVariants: [{ id: `v_${Date.now()}`, name: "", stock: 0 }] }));
                      } else if (!on) {
                        setFormData(prev => ({ ...prev, productVariants: [] }));
                      }
                    }}
                  />
                  <Label htmlFor="enableVariants" className="text-xs font-medium cursor-pointer">
                    This product has size / colour variants
                  </Label>
                </div>
                {variantsEnabled && (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">
                      Add each option (e.g. "Red / Large", "Blue / S"). Stock is tracked per variant — the Quantity field above is ignored.
                    </p>
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-[1fr_72px_88px_24px] gap-1.5 text-[11px] font-medium text-muted-foreground px-0.5">
                        <span>Variant Name</span><span>Stock</span><span>Price (R)</span><span />
                      </div>
                      {(formData.productVariants || []).map((pv: any, i: number) => (
                        <div key={pv.id || i} className="grid grid-cols-[1fr_72px_88px_24px] gap-1.5 items-center">
                          <Input
                            placeholder='e.g. "Red / Large"'
                            value={pv.name}
                            onChange={(e) => {
                              const updated = [...(formData.productVariants || [])];
                              updated[i] = { ...updated[i], name: e.target.value };
                              setFormData(prev => ({ ...prev, productVariants: updated }));
                            }}
                            className="h-7 text-xs"
                          />
                          <Input
                            type="number" min="0" placeholder="0"
                            value={pv.stock ?? ""}
                            onChange={(e) => {
                              const updated = [...(formData.productVariants || [])];
                              updated[i] = { ...updated[i], stock: parseInt(e.target.value) || 0 };
                              setFormData(prev => ({ ...prev, productVariants: updated }));
                            }}
                            className="h-7 text-xs"
                          />
                          <Input
                            type="number" min="0" step="0.01"
                            placeholder={formData.price ? String(formData.price) : "same"}
                            value={pv.price ?? ""}
                            onChange={(e) => {
                              const updated = [...(formData.productVariants || [])];
                              updated[i] = { ...updated[i], price: e.target.value ? parseFloat(e.target.value) || undefined : undefined };
                              setFormData(prev => ({ ...prev, productVariants: updated }));
                            }}
                            className="h-7 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const updated = (formData.productVariants || []).filter((_: any, j: number) => j !== i);
                              setFormData(prev => ({ ...prev, productVariants: updated }));
                              if (updated.length === 0) setVariantsEnabled(false);
                            }}
                            className="h-7 flex items-center justify-center text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <Button
                      type="button" variant="outline" size="sm" className="mt-2 h-7 text-xs"
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        productVariants: [...(prev.productVariants || []), { id: `v_${Date.now()}`, name: "", stock: 0 }]
                      }))}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Variant
                    </Button>
                  </>
                )}
              </div>
            )}
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v as any })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="on_order">On Order</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddEdit(false)}>Cancel</Button>
            <Button onClick={saveItem} disabled={saving || uploadingImage || !formData.name || (formData.itemType !== "service" && !formData.sku)}>
              {uploadingImage ? "Uploading image..." : saving ? "Saving…" : editingItem ? "Update" : "Add Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust Stock Dialog */}
      <Dialog open={showAdjust} onOpenChange={setShowAdjust}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Stock — {adjustItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Current quantity: <span className="font-semibold">{adjustItem?.quantity}</span></div>
              <Label className="text-xs">Adjustment (+ to add, - to remove)</Label>
              <Input type="number" value={adjustDelta} onChange={(e) => setAdjustDelta(e.target.value)} className="mt-1" placeholder="e.g. +5 or -2" />
              {adjustDelta && adjustItem && (
                <div className="text-xs mt-1 text-muted-foreground">
                  New quantity: <span className="font-semibold">{Math.max(0, adjustItem.quantity + (parseInt(adjustDelta) || 0))}</span>
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Reason *</Label>
              <Select value={adjustReason} onValueChange={setAdjustReason}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea value={adjustNotes} onChange={(e) => setAdjustNotes(e.target.value)} className="mt-1 h-16 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdjust(false)}>Cancel</Button>
            <Button onClick={saveAdjust} disabled={adjustSaving || !adjustDelta || isNaN(parseInt(adjustDelta)) || parseInt(adjustDelta) === 0 || !adjustReason}>
              {adjustSaving ? "Saving…" : "Apply Adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inventory Settings */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Product Categories</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 overflow-y-auto flex-1 pr-1">
            {/* Add new top-level category */}
            <div className="flex gap-2">
              <Input
                placeholder="New category name…"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory(); } }}
                className="flex-1"
              />
              <Button onClick={handleAddCategory} disabled={!newCategory.trim()}>
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>

            {/* Category + subcategory tree */}
            <div className="border rounded-lg divide-y overflow-y-auto max-h-[420px]">
              {categories.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No categories yet — add one above.</p>
              )}
              {categories.map((category) => {
                const subs = subcategoryMap[category] || [];
                const isExpanded = expandedCategory === category;
                return (
                  <div key={category}>
                    {/* ── Category row ── */}
                    <div className="flex items-center gap-1 px-3 py-2 hover:bg-muted/30">
                      <button
                        className="p-0.5 rounded hover:bg-muted text-muted-foreground"
                        onClick={() => setExpandedCategory(isExpanded ? null : category)}
                        title={isExpanded ? "Collapse" : "Expand subcategories"}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>

                      {editingCategory === category ? (
                        <div className="flex-1 flex gap-1.5">
                          <Input value={editCategoryValue} onChange={(e) => setEditCategoryValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); handleEditCategory(category); }
                              if (e.key === 'Escape') { setEditingCategory(null); setEditCategoryValue(""); }
                            }}
                            className="h-7 text-sm" autoFocus />
                          <Button size="sm" variant="ghost" onClick={() => handleEditCategory(category)} className="h-7 text-xs px-2">Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingCategory(null); setEditCategoryValue(""); }} className="h-7 w-7 p-0"><X className="h-3.5 w-3.5" /></Button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm font-medium flex-1 cursor-pointer" onClick={() => setExpandedCategory(isExpanded ? null : category)}>
                            {category}
                            {subs.length > 0 && <span className="ml-1.5 text-xs text-muted-foreground font-normal">({subs.length} subcategories)</span>}
                          </span>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingCategory(category); setEditCategoryValue(category); }} className="h-7 w-7 p-0"><Edit2 className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDeleteCategory(category)} className="h-7 w-7 p-0 text-destructive hover:text-destructive" disabled={categories.length === 1}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </>
                      )}
                    </div>

                    {/* ── Subcategories (expanded) ── */}
                    {isExpanded && (
                      <div className="bg-muted/20 border-t border-dashed pb-2">
                        {subs.map((sub) => (
                          <div key={sub} className="flex items-center gap-1 pl-10 pr-3 py-1.5 hover:bg-muted/40">
                            <span className="text-muted-foreground mr-1 text-xs">↳</span>
                            {editingSubcategory?.cat === category && editingSubcategory?.sub === sub ? (
                              <div className="flex-1 flex gap-1.5">
                                <Input value={editSubcategoryValue} onChange={(e) => setEditSubcategoryValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); handleEditSubcategory(category, sub); }
                                    if (e.key === 'Escape') { setEditingSubcategory(null); setEditSubcategoryValue(""); }
                                  }}
                                  className="h-6 text-xs" autoFocus />
                                <Button size="sm" variant="ghost" onClick={() => handleEditSubcategory(category, sub)} className="h-6 text-xs px-2">Save</Button>
                                <Button size="sm" variant="ghost" onClick={() => { setEditingSubcategory(null); setEditSubcategoryValue(""); }} className="h-6 w-6 p-0"><X className="h-3 w-3" /></Button>
                              </div>
                            ) : (
                              <>
                                <span className="text-sm flex-1">{sub}</span>
                                <Button size="sm" variant="ghost" onClick={() => { setEditingSubcategory({ cat: category, sub }); setEditSubcategoryValue(sub); }} className="h-6 w-6 p-0"><Edit2 className="h-3 w-3" /></Button>
                                <Button size="sm" variant="ghost" onClick={() => handleDeleteSubcategory(category, sub)} className="h-6 w-6 p-0 text-destructive"><Trash2 className="h-3 w-3" /></Button>
                              </>
                            )}
                          </div>
                        ))}
                        {/* Add subcategory input */}
                        <div className="flex gap-1.5 pl-10 pr-3 pt-1.5">
                          <Input
                            placeholder="New subcategory…"
                            value={isExpanded ? newSubcategory : ""}
                            onChange={(e) => setNewSubcategory(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubcategory(category); } }}
                            className="h-7 text-xs flex-1"
                          />
                          <Button size="sm" onClick={() => handleAddSubcategory(category)} disabled={!newSubcategory.trim()} className="h-7 text-xs px-2">
                            <Plus className="h-3 w-3 mr-0.5" /> Add
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Click the arrow to expand a category and add subcategories. Products can be assigned a category + subcategory for finer filtering.</p>
          </div>

          <DialogFooter>
            <Button onClick={() => setShowSettings(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Update from Supplier */}
      <Dialog open={showQuickUpdate} onOpenChange={setShowQuickUpdate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {quickUpdateItem ? 'Quick Update from Supplier' : `Bulk Quick Update (${selectedItems.size} items)`}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {quickUpdateItem ? (
              <div>
                <Label className="text-sm font-medium">Product</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  {quickUpdateItem.name} ({quickUpdateItem.sku})
                </p>
              </div>
            ) : (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-900">
                  <strong>Bulk Update Mode:</strong> This will update{' '}
                  <span className="font-bold">{selectedItems.size} selected items</span> with the same cost price,
                  selling price, and image (if provided).
                </p>
              </div>
            )}

            {/* Description Search */}
            {quickUpdateItem && (
              <div className="border border-green-300 rounded-lg p-3 bg-green-50/50 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold text-green-900">
                    📝 Product Description
                  </Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={fetchDescription}
                    disabled={fetchingDescription}
                    className="text-green-700 border-green-400 hover:bg-green-100"
                  >
                    {fetchingDescription ? "Searching..." : "🔍 Search Description"}
                  </Button>
                </div>
                <Textarea
                  placeholder="Product description will appear here after searching, or type manually..."
                  value={quickUpdateDescription}
                  onChange={(e) => setQuickUpdateDescription(e.target.value)}
                  rows={3}
                  className="text-sm"
                />
                <p className="text-xs text-green-700">
                  Click Search to auto-fetch a description using the product name, or type one manually. Leave blank to keep existing.
                </p>
              </div>
            )}

            {/* Auto-Scrape Product Page */}
            <div className="border border-blue-300 rounded-lg p-3 bg-blue-50/50 space-y-2">
              <Label htmlFor="productPageUrl" className="text-sm font-semibold text-blue-900">
                🔍 Auto-Extract from Product Page
              </Label>
              <div className="flex gap-2">
                <Input
                  id="productPageUrl"
                  type="url"
                  placeholder="https://supplier.com/product/123"
                  value={productPageUrl}
                  onChange={(e) => setProductPageUrl(e.target.value)}
                  className="flex-1"
                  disabled={scrapingPage}
                />
                <Button
                  type="button"
                  onClick={scrapeProductPage}
                  disabled={scrapingPage || !productPageUrl.trim()}
                  variant="outline"
                >
                  {scrapingPage ? "Scraping..." : "Extract"}
                </Button>
              </div>
              <p className="text-xs text-blue-700">
                Paste the supplier's product page URL and click Extract to automatically get the image and price
              </p>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-muted-foreground">Or enter manually</span>
              </div>
            </div>

            <div>
              <Label htmlFor="supplierImageUrl" className="text-sm font-medium">
                Supplier Image URL (optional)
              </Label>
              <Input
                id="supplierImageUrl"
                type="url"
                placeholder="https://supplier.com/image.jpg"
                value={supplierImageUrl}
                onChange={(e) => setSupplierImageUrl(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Right-click supplier's product image → Copy Image Address → Paste here
              </p>
            </div>

            <div>
              <Label htmlFor="supplierPrice" className="text-sm font-medium">
                Supplier Cost Price *
              </Label>
              <Input
                id="supplierPrice"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={supplierPrice}
                onChange={(e) => setSupplierPrice(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="markupPercent" className="text-sm font-medium">
                Markup Percentage
              </Label>
              <Input
                id="markupPercent"
                type="number"
                step="1"
                value={markupPercent}
                onChange={(e) => setMarkupPercent(parseInt(e.target.value) || 30)}
                className="mt-1"
              />
            </div>
            
            {/* Pack Sales Configuration in Bulk Update */}
            <div className="border rounded-lg p-3 bg-purple-50/50 space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="bulkEnablePackSales"
                  checked={bulkEnablePackSales}
                  onCheckedChange={(checked) => {
                    setBulkEnablePackSales(!!checked);
                    if (!checked) {
                      setBulkPackSize("");
                      setBulkPackPrice("");
                    } else {
                      setBulkPackSize(bulkPackSize || "2");
                    }
                  }}
                />
                <Label htmlFor="bulkEnablePackSales" className="text-sm font-semibold text-purple-900 cursor-pointer">
                  ☑️ Sell in Packs - Enable pack sales for selected items
                </Label>
              </div>
              {bulkEnablePackSales && (
                <>
                  <p className="text-xs text-purple-700">Set how many units per pack and the pack price.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="bulkPackSize" className="text-xs font-medium">Units per Pack</Label>
                      <Input
                        id="bulkPackSize"
                        type="number"
                        min="1"
                        placeholder="e.g. 5"
                        value={bulkPackSize}
                        onChange={(e) => setBulkPackSize(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="bulkPackPrice" className="text-xs font-medium">Pack Price (R)</Label>
                      <Input
                        id="bulkPackPrice"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Leave blank for auto"
                        value={bulkPackPrice}
                        onChange={(e) => setBulkPackPrice(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  {bulkPackSize && parseInt(bulkPackSize) > 1 && (
                    <div className="text-xs text-purple-800 bg-purple-100 rounded p-2">
                      <strong>Pack pricing:</strong>{" "}
                      {bulkPackPrice
                        ? `R${parseFloat(bulkPackPrice).toFixed(2)} per pack (R${(parseFloat(bulkPackPrice) / parseInt(bulkPackSize)).toFixed(2)} per unit)`
                        : supplierPrice && !isNaN(parseFloat(supplierPrice))
                          ? `R${((parseFloat(supplierPrice) * (1 + markupPercent / 100)) * parseInt(bulkPackSize)).toFixed(2)} per pack (auto-calculated)`
                          : "Enter supplier price above to see auto-calculated pack price"
                      }
                    </div>
                  )}
                </>
              )}
            </div>
            
            {supplierPrice && !isNaN(parseFloat(supplierPrice)) && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Cost Price:</span>
                  <span>R{parseFloat(supplierPrice).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Markup:</span>
                  <span>{markupPercent}%</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-blue-900 pt-1 border-t border-blue-300">
                  <span>Selling Price:</span>
                  <span>R{(parseFloat(supplierPrice) * (1 + markupPercent / 100)).toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowQuickUpdate(false);
                setBulkEnablePackSales(false);
                setBulkPackSize("");
                setBulkPackPrice("");
              }}
              disabled={processingQuickUpdate}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleQuickUpdate}
              disabled={processingQuickUpdate || !supplierPrice}
            >
              {processingQuickUpdate ? "Processing..." : "Update Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Action: Change Category */}
      <Dialog open={bulkAction === 'category'} onOpenChange={(open) => !open && setBulkAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change Category for {selectedItems.size} Items</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="bulkCategory" className="text-sm font-medium">
                New Category
              </Label>
              <Select value={bulkCategory} onValueChange={setBulkCategory}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setBulkAction(null)}
              disabled={processingBulk}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleBulkCategoryChange}
              disabled={processingBulk || !bulkCategory}
            >
              {processingBulk ? "Updating..." : `Update ${selectedItems.size} Items`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Action: Change Status */}
      <Dialog open={bulkAction === 'status'} onOpenChange={(open) => !open && setBulkAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change Status for {selectedItems.size} Items</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="bulkStatus" className="text-sm font-medium">
                New Status
              </Label>
              <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v as any)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="on_order">On Order</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setBulkAction(null)}
              disabled={processingBulk}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleBulkStatusChange}
              disabled={processingBulk}
            >
              {processingBulk ? "Updating..." : `Update ${selectedItems.size} Items`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Action: Delete Confirmation */}
      <Dialog open={bulkAction === 'delete'} onOpenChange={(open) => !open && setBulkAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {selectedItems.size} Items?</DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              This will permanently delete {selectedItems.size} selected item{selectedItems.size > 1 ? 's' : ''} from your inventory. 
              This action cannot be undone.
            </p>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setBulkAction(null)}
              disabled={processingBulk}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={processingBulk}
            >
              {processingBulk ? "Deleting..." : `Delete ${selectedItems.size} Items`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!showDeleteConfirm} onOpenChange={() => setShowDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete "{showDeleteConfirm?.name}"?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">This will permanently remove the item and cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => showDeleteConfirm && deleteItem(showDeleteConfirm)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV Import Dialog */}
      <Dialog open={showImportCSV} onOpenChange={(open) => {
        setShowImportCSV(open);
        if (!open) {
          // Reset all states when closing
          setCsvFile(null);
          setRawParsedData([]);
          setAvailableColumns([]);
          setColumnMapping({});
          setCsvData([]);
          setImportStep('upload');
        }
      }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Import Products from CSV/Excel 
              {importStep === 'map' && ' - Map Columns'}
              {importStep === 'preview' && ' - Preview Data'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4 overflow-y-auto flex-1">
            {/* Step 1: Upload File */}
            {importStep === 'upload' && (
              <div>
                <Label>CSV or Excel File</Label>
                <Input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleCsvFileChange}
                  className="mt-1"
                  disabled={importing}
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Supports CSV, Excel (.xlsx, .xls). After uploading, you'll map your columns to our inventory fields.
                </p>
              </div>
            )}

            {/* Step 2: Map Columns */}
            {importStep === 'map' && availableColumns.length > 0 && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-900">
                    <strong>Map your columns:</strong> Select which column from your file corresponds to each inventory field. 
                    Only <span className="font-semibold">Name</span> and <span className="font-semibold">SKU</span> are required.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Name (Required) */}
                  <div>
                    <Label className="text-sm font-medium">
                      Name <span className="text-red-500">*</span>
                    </Label>
                    <Select 
                      value={columnMapping.name || '__skip__'} 
                      onValueChange={(v) => setColumnMapping({...columnMapping, name: v})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">-- Skip this field --</SelectItem>
                        {availableColumns.map(col => (
                          <SelectItem key={col} value={col}>{col}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* SKU (Required) */}
                  <div>
                    <Label className="text-sm font-medium">
                      SKU <span className="text-red-500">*</span>
                    </Label>
                    <Select 
                      value={columnMapping.sku || '__skip__'} 
                      onValueChange={(v) => setColumnMapping({...columnMapping, sku: v})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">-- Skip this field --</SelectItem>
                        {availableColumns.map(col => (
                          <SelectItem key={col} value={col}>{col}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Description (Optional) */}
                  <div>
                    <Label className="text-sm font-medium">Description</Label>
                    <Select 
                      value={columnMapping.description || '__skip__'} 
                      onValueChange={(v) => setColumnMapping({...columnMapping, description: v})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">-- Skip this field --</SelectItem>
                        {availableColumns.map(col => (
                          <SelectItem key={col} value={col}>{col}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Category (Optional) */}
                  <div>
                    <Label className="text-sm font-medium">Category</Label>
                    <Select 
                      value={columnMapping.category || '__skip__'} 
                      onValueChange={(v) => setColumnMapping({...columnMapping, category: v})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">-- Skip this field --</SelectItem>
                        {availableColumns.map(col => (
                          <SelectItem key={col} value={col}>{col}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Price (Optional) */}
                  <div>
                    <Label className="text-sm font-medium">Selling Price</Label>
                    <Select 
                      value={columnMapping.price || '__skip__'} 
                      onValueChange={(v) => setColumnMapping({...columnMapping, price: v})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">-- Skip this field --</SelectItem>
                        {availableColumns.map(col => (
                          <SelectItem key={col} value={col}>{col}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Cost Price (Optional) */}
                  <div>
                    <Label className="text-sm font-medium">Cost Price</Label>
                    <Select 
                      value={columnMapping.costPrice || '__skip__'} 
                      onValueChange={(v) => setColumnMapping({...columnMapping, costPrice: v})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">-- Skip this field --</SelectItem>
                        {availableColumns.map(col => (
                          <SelectItem key={col} value={col}>{col}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Quantity (Optional) */}
                  <div>
                    <Label className="text-sm font-medium">Quantity</Label>
                    <Select 
                      value={columnMapping.quantity || '__skip__'} 
                      onValueChange={(v) => setColumnMapping({...columnMapping, quantity: v})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">-- Skip this field --</SelectItem>
                        {availableColumns.map(col => (
                          <SelectItem key={col} value={col}>{col}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Reorder Level (Optional) */}
                  <div>
                    <Label className="text-sm font-medium">Reorder Level</Label>
                    <Select 
                      value={columnMapping.reorderLevel || '__skip__'} 
                      onValueChange={(v) => setColumnMapping({...columnMapping, reorderLevel: v})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">-- Skip this field --</SelectItem>
                        {availableColumns.map(col => (
                          <SelectItem key={col} value={col}>{col}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Supplier (Optional) */}
                  <div>
                    <Label className="text-sm font-medium">Supplier</Label>
                    <Select 
                      value={columnMapping.supplier || '__skip__'} 
                      onValueChange={(v) => setColumnMapping({...columnMapping, supplier: v})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">-- Skip this field --</SelectItem>
                        {availableColumns.map(col => (
                          <SelectItem key={col} value={col}>{col}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Location (Optional) */}
                  <div>
                    <Label className="text-sm font-medium">Location</Label>
                    <Select 
                      value={columnMapping.location || '__skip__'} 
                      onValueChange={(v) => setColumnMapping({...columnMapping, location: v})}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">-- Skip this field --</SelectItem>
                        {availableColumns.map(col => (
                          <SelectItem key={col} value={col}>{col}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Duplicate Handling */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <Label className="text-sm font-medium text-amber-900">
                    If SKU already exists:
                  </Label>
                  <Select 
                    value={duplicateStrategy} 
                    onValueChange={(v) => setDuplicateStrategy(v as 'skip' | 'update' | 'create')}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="update">Update existing item with new data</SelectItem>
                      <SelectItem value="skip">Skip (keep existing item unchanged)</SelectItem>
                      <SelectItem value="create">Create duplicate item anyway</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-amber-700">
                    {duplicateStrategy === 'update' && 'Existing items will be updated with data from your file'}
                    {duplicateStrategy === 'skip' && 'Items with matching SKUs will be ignored'}
                    {duplicateStrategy === 'create' && 'New items will be created even if SKU already exists'}
                  </p>
                </div>
              </div>
            )}

            {/* Step 3: Preview Data */}
            {importStep === 'preview' && csvData.length > 0 && (
              <div className="border rounded-lg p-3 bg-muted/40">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Preview ({csvData.length} items to import)</p>
                  {importing && (
                    <p className="text-sm text-muted-foreground">{importProgress}% complete</p>
                  )}
                </div>
                <div className="max-h-96 overflow-auto border rounded">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr className="border-b">
                        <th className="text-left p-2">Name</th>
                        <th className="text-left p-2">SKU</th>
                        <th className="text-left p-2">Category</th>
                        <th className="text-right p-2">Qty</th>
                        <th className="text-right p-2">Cost</th>
                        <th className="text-right p-2">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvData.map((item, i) => (
                        <tr key={i} className="border-b hover:bg-muted/50">
                          <td className="p-2">{item.name}</td>
                          <td className="p-2 font-mono">{item.sku}</td>
                          <td className="p-2">{item.category}</td>
                          <td className="text-right p-2">{item.quantity}</td>
                          <td className="text-right p-2">R{item.costPrice}</td>
                          <td className="text-right p-2">R{item.price}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          
          <DialogFooter>
            {importStep === 'map' && (
              <>
                <Button variant="outline" onClick={() => setImportStep('upload')}>
                  Back
                </Button>
                <Button onClick={applyMapping} disabled={!columnMapping.name || columnMapping.name === '__skip__' || !columnMapping.sku || columnMapping.sku === '__skip__'}>
                  Next: Preview Data
                </Button>
              </>
            )}
            {importStep === 'preview' && (
              <>
                <Button variant="outline" onClick={() => setImportStep('map')} disabled={importing}>
                  Back to Mapping
                </Button>
                <Button onClick={importCsvData} disabled={csvData.length === 0 || importing}>
                  {importing ? `Importing... ${importProgress}%` : `Import ${csvData.length} Items`}
                </Button>
              </>
            )}
            {importStep === 'upload' && (
              <Button variant="outline" onClick={() => setShowImportCSV(false)}>
                Cancel
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Latest Sold / Removed Tab ───────────────────────────────────────────────
function LatestSoldTab({ workspaceId, items }: { workspaceId: string; items: InventoryItem[] }) {
  const [days, setDays] = useState(1);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    inventoryService.getOutMovementsSince(workspaceId, since)
      .then(setMovements)
      .finally(() => setLoading(false));
  }, [workspaceId, days]);

  // Group by product, sum qty removed
  const grouped = useMemo(() => {
    const map = new Map<string, { productId: string; productName: string; totalRemoved: number; lastMovement: Date; currentQty: number; movements: StockMovement[] }>();
    for (const m of movements) {
      const key = m.productId || m.productName;
      const existing = map.get(key);
      const item = items.find(i => i.id === m.productId);
      if (existing) {
        existing.totalRemoved += m.quantity;
        if (new Date(m.timestamp as any) > existing.lastMovement) existing.lastMovement = new Date(m.timestamp as any);
        existing.movements.push(m);
      } else {
        map.set(key, {
          productId: m.productId,
          productName: m.productName,
          totalRemoved: m.quantity,
          lastMovement: new Date(m.timestamp as any),
          currentQty: item?.quantity ?? 0,
          movements: [m],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.lastMovement.getTime() - a.lastMovement.getTime());
  }, [movements, items]);

  return (
    <div className="h-full flex flex-col">
      {/* Day filter bar */}
      <div className="flex items-center gap-2 px-0 py-2 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground font-medium">Show last:</span>
        {[1, 2, 3, 4, 5, 6, 7].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-semibold border transition-colors",
              days === d
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
            )}
          >
            {d} {d === 1 ? "day" : "days"}
          </button>
        ))}
        <span className="ml-2 text-xs text-muted-foreground">Items sold or removed in this window</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading...</div>
        ) : grouped.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No stock removed in the last {days} {days === 1 ? "day" : "days"}.</div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-background z-10">
              <tr className="border-b border-border text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground">Product</th>
                <th className="px-3 py-2 font-medium text-muted-foreground text-right">Qty Removed</th>
                <th className="px-3 py-2 font-medium text-muted-foreground text-right">Current Stock</th>
                <th className="px-3 py-2 font-medium text-muted-foreground text-right">Status</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Last Movement</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Reason</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((row) => {
                const isOut = row.currentQty === 0;
                const isLow = row.currentQty > 0 && row.currentQty <= 5;
                return (
                  <tr key={row.productId || row.productName} className="border-b border-border hover:bg-accent/40 transition-colors">
                    <td className="px-3 py-2 font-medium">{row.productName}</td>
                    <td className="px-3 py-2 text-right font-bold text-red-600">-{row.totalRemoved}</td>
                    <td className={cn("px-3 py-2 text-right font-semibold", isOut ? "text-red-600" : isLow ? "text-amber-600" : "text-green-700")}>
                      {row.currentQty}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isOut
                        ? <Badge variant="destructive">Out of stock</Badge>
                        : isLow
                          ? <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Low stock</Badge>
                          : <Badge className="bg-green-100 text-green-800 hover:bg-green-100">In stock</Badge>
                      }
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {row.lastMovement.toLocaleDateString()} {row.lastMovement.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {row.movements.map(m => m.reason).filter(Boolean).join(", ") || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── To Order Tab ─────────────────────────────────────────────────────────────
interface OrderLine {
  id: string;
  product: string;
  description: string;
  supplier: string;
  qty: number;
  estimatedCost: number;
  ordered: boolean;
}

function ToOrderTab({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast();
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const SETTINGS_KEY = "to_order_list";

  useEffect(() => {
    supabase.from("workspace_settings")
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("category", SETTINGS_KEY)
      .single()
      .then(({ data }) => {
        if (data?.data && Array.isArray((data.data as any).lines)) {
          setLines((data.data as any).lines);
        }
        setLoading(false);
      });
  }, [workspaceId]);

  async function save(updated: OrderLine[]) {
    setSaving(true);
    const { error } = await supabase.from("workspace_settings").upsert(
      { workspace_id: workspaceId, category: SETTINGS_KEY, data: { lines: updated } },
      { onConflict: "workspace_id,category" }
    );
    setSaving(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
  }

  function addLine() {
    const newLine: OrderLine = { id: crypto.randomUUID(), product: "", description: "", supplier: "", qty: 1, estimatedCost: 0, ordered: false };
    const updated = [...lines, newLine];
    setLines(updated);
    save(updated);
  }

  function updateLine(id: string, field: keyof OrderLine, value: any) {
    const updated = lines.map(l => l.id === id ? { ...l, [field]: value } : l);
    setLines(updated);
    save(updated);
  }

  function removeLine(id: string) {
    const updated = lines.filter(l => l.id !== id);
    setLines(updated);
    save(updated);
  }

  function markAllOrdered() {
    const updated = lines.map(l => ({ ...l, ordered: true }));
    setLines(updated);
    save(updated);
  }

  function clearOrdered() {
    const updated = lines.filter(l => !l.ordered);
    setLines(updated);
    save(updated);
  }

  const totalEstimated = lines.filter(l => !l.ordered).reduce((sum, l) => sum + (l.estimatedCost * l.qty), 0);
  const pendingCount = lines.filter(l => !l.ordered).length;

  if (loading) return <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <Button size="sm" onClick={addLine} className="gap-1.5">
          <span className="text-base leading-none">+</span> Add Item
        </Button>
        {lines.some(l => !l.ordered) && (
          <Button size="sm" variant="outline" onClick={markAllOrdered}>Mark all ordered</Button>
        )}
        {lines.some(l => l.ordered) && (
          <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={clearOrdered}>Clear ordered</Button>
        )}
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
        <div className="ml-auto text-sm text-muted-foreground">
          {pendingCount} item{pendingCount !== 1 ? "s" : ""} to order
          {totalEstimated > 0 && <span className="ml-3 font-semibold text-foreground">Est. total: R{totalEstimated.toFixed(2)}</span>}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-border">
        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
            <span>No items on the order list yet.</span>
            <Button size="sm" variant="outline" onClick={addLine}>+ Add first item</Button>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-background z-10 border-b border-border">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8"></th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Product / Model</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Description</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Supplier</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-20">Qty</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-32">Est. Cost (each)</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-28">Est. Total</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className={cn("border-b border-border transition-colors", line.ordered ? "opacity-50 bg-muted/30" : "hover:bg-accent/30")}>
                  {/* Ordered checkbox */}
                  <td className="px-3 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={line.ordered}
                      onChange={(e) => updateLine(line.id, "ordered", e.target.checked)}
                      className="h-4 w-4 accent-primary cursor-pointer"
                      title="Mark as ordered"
                    />
                  </td>
                  {/* Product */}
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={line.product}
                      onChange={(e) => updateLine(line.id, "product", e.target.value)}
                      placeholder="Product / model…"
                      className={cn("w-full bg-transparent border-none outline-none text-sm px-1 py-0.5 rounded focus:ring-1 focus:ring-primary", line.ordered && "line-through text-muted-foreground")}
                    />
                  </td>
                  {/* Description */}
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) => updateLine(line.id, "description", e.target.value)}
                      placeholder="Description…"
                      className="w-full bg-transparent border-none outline-none text-sm px-1 py-0.5 rounded focus:ring-1 focus:ring-primary text-muted-foreground"
                    />
                  </td>
                  {/* Supplier */}
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={line.supplier}
                      onChange={(e) => updateLine(line.id, "supplier", e.target.value)}
                      placeholder="Supplier / company…"
                      className="w-full bg-transparent border-none outline-none text-sm px-1 py-0.5 rounded focus:ring-1 focus:ring-primary text-muted-foreground"
                    />
                  </td>
                  {/* Qty */}
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      min={1}
                      value={line.qty}
                      onChange={(e) => updateLine(line.id, "qty", parseInt(e.target.value) || 1)}
                      className="w-full bg-transparent border-none outline-none text-sm px-1 py-0.5 rounded focus:ring-1 focus:ring-primary text-right font-semibold"
                    />
                  </td>
                  {/* Est cost each */}
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={line.estimatedCost}
                      onChange={(e) => updateLine(line.id, "estimatedCost", parseFloat(e.target.value) || 0)}
                      className="w-full bg-transparent border-none outline-none text-sm px-1 py-0.5 rounded focus:ring-1 focus:ring-primary text-right"
                    />
                  </td>
                  {/* Est total */}
                  <td className="px-3 py-1.5 text-right font-semibold text-sm">
                    {line.estimatedCost > 0 ? `R${(line.estimatedCost * line.qty).toFixed(2)}` : "—"}
                  </td>
                  {/* Delete */}
                  <td className="px-2 py-1 text-center">
                    <button onClick={() => removeLine(line.id)} className="text-muted-foreground hover:text-red-500 transition-colors" title="Remove">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {lines.length > 1 && totalEstimated > 0 && (
              <tfoot className="border-t-2 border-border">
                <tr>
                  <td colSpan={6} className="px-3 py-2 text-right text-sm font-semibold">Estimated Total (pending):</td>
                  <td className="px-3 py-2 text-right font-bold text-base">R{totalEstimated.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  );
}
