import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  X, Search, Image as ImageIcon, ChevronLeft, ChevronRight,
  Save, RefreshCw, Check, AlertCircle, Loader2, ArrowUpDown, Trash2,
  Globe, Wand2, SkipForward, Settings2, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { inventoryService, InventoryItem } from "@/lib/inventoryService";
import { getThumbnailUrl, uploadImageToCloudinary } from "@/lib/cloudinaryService";
import { cn } from "@/lib/utils";
import { supabase, supabaseServiceRole } from "@/lib/supabase";

const CLOUDINARY_CLOUD_NAME = 'dzukhgptd';
const CLOUDINARY_UPLOAD_PRESET = 'inventory_products';

const PAGE_SIZE = 60;

const DEFAULT_CATEGORIES = [
  "Speaker Parts", "Amplifier Parts", "Connectors", "Cables", "Tools",
  "Consumables", "Electronics", "Other",
];

// Editable text fields (in display order)
const TEXT_FIELDS: { key: keyof InventoryItem; label: string; width: string; type?: string; options?: string[] }[] = [
  { key: "name",         label: "Name",        width: "min-w-[200px]" },
  { key: "sku",          label: "SKU",         width: "min-w-[110px]" },
  { key: "category",     label: "Category",    width: "min-w-[150px]", type: "select", options: DEFAULT_CATEGORIES },
  { key: "price",        label: "Price",       width: "min-w-[90px]",  type: "number" },
  { key: "costPrice",    label: "Cost",        width: "min-w-[90px]",  type: "number" },
  { key: "quantity",     label: "Qty",         width: "min-w-[80px]",  type: "number" },
  { key: "reorderLevel", label: "Reorder",     width: "min-w-[80px]",  type: "number" },
  { key: "supplier",     label: "Supplier",    width: "min-w-[130px]" },
  { key: "location",     label: "Location",    width: "min-w-[110px]" },
  { key: "description",  label: "Description", width: "min-w-[200px]" },
  { key: "barcode",      label: "Barcode",     width: "min-w-[120px]" },
];

interface CellEdit {
  rowId: string;
  field: keyof InventoryItem;
}

interface InventoryBulkEditorProps {
  workspaceId: string;
  onClose: () => void;
  /** When true the component fills its parent container (no fixed overlay, no header bar) */
  embedded?: boolean;
}

export function InventoryBulkEditor({ workspaceId, onClose, embedded }: InventoryBulkEditorProps) {
  const { toast } = useToast();

  // Data
  const [rows, setRows] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedCategories, setSavedCategories] = useState<string[]>(DEFAULT_CATEGORIES);

  // Dirty tracking
  const [dirty, setDirty] = useState<Map<string, Partial<InventoryItem>>>(new Map());
  const dirtyRef = useRef<Map<string, Partial<InventoryItem>>>(new Map());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  // Keep ref in sync
  function updateDirty(fn: (prev: Map<string, Partial<InventoryItem>>) => Map<string, Partial<InventoryItem>>) {
    setDirty((prev) => {
      const next = fn(prev);
      dirtyRef.current = next;
      return next;
    });
  }

  // Inline editing
  const [activeCell, setActiveCell] = useState<CellEdit | null>(null);
  const [cellValue, setCellValue] = useState<string>("");
  const cellInputRef = useRef<HTMLInputElement | null>(null);

  // Image upload
  const [uploadingRowId, setUploadingRowId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileUploadTarget = useRef<string | null>(null);

  // Filter / pagination
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [sortField, setSortField] = useState<keyof InventoryItem>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  // Delete confirm (row id pending confirmation)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Row selection
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // ── Description Search ────────────────────────────────────────────────────
  const [fetchingDescriptions, setFetchingDescriptions] = useState(false);
  const [descProgress, setDescProgress] = useState<{ done: number; total: number } | null>(null);

  async function fetchDescriptions() {
    const selected = rows.filter((r) => selectedRows.has(r.id));
    if (!selected.length) return;
    setFetchingDescriptions(true);
    setDescProgress({ done: 0, total: selected.length });
    let found = 0;
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      const query = [item.name, item.sku].filter(Boolean).join(" ");
      try {
        const { data, error } = await supabase.functions.invoke("description-search-ddg", {
          body: { query, workspaceId },
        });
        if (error) throw new Error(error.message);
        const text: string = data?.description ?? "";
        if (text) {
          found++;
          setRows((prev) => prev.map((r) => r.id === item.id ? { ...r, description: text } : r));
          updateDirty((prev) => {
            const n = new Map(prev);
            n.set(item.id, { ...(n.get(item.id) ?? {}), description: text });
            return n;
          });
        }
      } catch { /* skip on error */ }
      setDescProgress({ done: i + 1, total: selected.length });
    }
    setFetchingDescriptions(false);
    setDescProgress(null);
    if (found === 0) {
      toast({
        title: "No descriptions found",
        description: "The search service returned no results. Make sure the edge function is deployed, or enter descriptions manually.",
        variant: "destructive",
      });
    } else {
      toast({
        title: `${found} description${found > 1 ? "s" : ""} found`,
        description: `Updated ${found} of ${selected.length} item${selected.length > 1 ? "s" : ""}. Click Save Changes to persist.`,
      });
    }
  }

  // ── Image Search ───────────────────────────────────────────────────────────
  interface ImgResult { url: string; thumb: string; title: string; source: string; }
  type ImgProvider = "ddg" | "google";
  const [showImgSearch, setShowImgSearch] = useState(false);
  const [imgProvider, setImgProvider] = useState<ImgProvider>("ddg");
  const [imgApiKey, setImgApiKey]   = useState("");
  const [imgCx, setImgCx]           = useState("");
  const [imgSetupMode, setImgSetupMode] = useState(false);
  const [imgProviderInput, setImgProviderInput] = useState<ImgProvider>("ddg");
  const [imgApiKeyInput, setImgApiKeyInput] = useState("");
  const [imgCxInput, setImgCxInput]         = useState("");
  const [searchQueue, setSearchQueue]       = useState<InventoryItem[]>([]);
  const [searchQueueIdx, setSearchQueueIdx] = useState(0);
  const [searchResults, setSearchResults]   = useState<ImgResult[]>([]);
  const [searchLoading, setSearchLoading]   = useState(false);
  const [searchQuery, setSearchQuery]       = useState("");
  const [uploadingSearch, setUploadingSearch] = useState<string | null>(null); // url being uploaded

  // ─── Load ────────────────────────────────────────────────────────────────────

  const loadItems = useCallback(async (force = false) => {
    if (!force && dirtyRef.current.size > 0) {
      const ok = window.confirm(`You have ${dirtyRef.current.size} unsaved change${dirtyRef.current.size > 1 ? "s" : ""}. Refresh will discard them. Continue?`);
      if (!ok) return;
    }
    updateDirty(() => new Map());
    setLoading(true);
    try {
      const [items, settingsRow] = await Promise.all([
        inventoryService.getAll(workspaceId),
        supabase.from('workspace_settings').select('data').eq('workspace_id', workspaceId).eq('category', 'inventory').single(),
      ]);
      setRows(items);
      const cats = (settingsRow.data?.data as any)?.categories;
      if (Array.isArray(cats)) {
        setSavedCategories(cats);
      }
    } catch (e: any) {
      toast({ title: "Failed to load inventory", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { loadItems(true); }, [workspaceId]);

  // ─── Auto-save when dirty changes ────────────────────────────────────────
  useEffect(() => {
    if (dirty.size === 0) return;
    const timer = setTimeout(() => {
      const entries = Array.from(dirty.entries());
      entries.forEach(([rowId, updates]) => saveRow(rowId, updates));
    }, 800); // debounce 800ms to batch rapid edits
    return () => clearTimeout(timer);
  }, [dirty]);

  // ─── Dynamic category list ────────────────────────────────────────────────
  const allCategories = useMemo(() => {
    const fromRows = rows.map((r) => r.category).filter(Boolean) as string[];
    const merged = Array.from(new Set([...DEFAULT_CATEGORIES, ...savedCategories, ...fromRows]));
    return merged.sort((a, b) => a.localeCompare(b));
  }, [rows, savedCategories]);

  // ─── Derived / filtered rows ──────────────────────────────────────────────

  const filteredRows = (() => {
    const q = search.toLowerCase();
    let list = rows;

    if (q) {
      list = list.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        (r.sku || "").toLowerCase().includes(q) ||
        (r.category || "").toLowerCase().includes(q) ||
        (r.supplier || "").toLowerCase().includes(q)
      );
    }

    if (filterStatus !== "all") {
      list = list.filter((r) => r.status === filterStatus);
    }

    list = [...list].sort((a, b) => {
      const av = String(a[sortField] ?? "").toLowerCase();
      const bv = String(b[sortField] ?? "").toLowerCase();
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    return list;
  })();

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [search, filterStatus]);

  // ─── Cell editing ─────────────────────────────────────────────────────────

  function startEdit(rowId: string, field: keyof InventoryItem, currentValue: any) {
    setActiveCell({ rowId, field });
    setCellValue(String(currentValue ?? ""));
    setTimeout(() => cellInputRef.current?.focus(), 20);
  }

  function commitEdit(rowId: string, field: keyof InventoryItem, raw: string) {
    const fieldDef = TEXT_FIELDS.find((f) => f.key === field);
    let value: any = raw;
    if (fieldDef?.type === "number") {
      const n = parseFloat(raw);
      value = isNaN(n) ? 0 : n;
    }

    // Update local rows
    setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, [field]: value } : r));

    // Track dirty — auto-save triggers via useEffect
    updateDirty((prev) => {
      const next = new Map(prev);
      const existing = next.get(rowId) ?? {};
      next.set(rowId, { ...existing, [field]: value });
      return next;
    });

    setActiveCell(null);
  }

  function handleCellKeyDown(e: React.KeyboardEvent, rowId: string, field: keyof InventoryItem) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commitEdit(rowId, field, cellValue);
    } else if (e.key === "Escape") {
      setActiveCell(null);
    }
  }

  // ─── Save (only triggered by Save Changes button) ────────────────────────────

  async function saveRow(rowId: string, updates: Partial<InventoryItem>) {
    setSaving((prev) => new Set(prev).add(rowId));
    setErrors((prev) => { const n = new Map(prev); n.delete(rowId); return n; });
    try {
      await inventoryService.update(workspaceId, rowId, updates);
      updateDirty((prev) => { const n = new Map(prev); n.delete(rowId); return n; });
      setSaved((prev) => {
        const n = new Set(prev).add(rowId);
        setTimeout(() => setSaved((s) => { const ns = new Set(s); ns.delete(rowId); return ns; }), 2000);
        return n;
      });
    } catch (e: any) {
      setErrors((prev) => new Map(prev).set(rowId, e.message));
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving((prev) => { const n = new Set(prev); n.delete(rowId); return n; });
    }
  }

  async function saveAllDirty() {
    const entries = Array.from(dirty.entries());
    if (!entries.length) return;
    await Promise.all(entries.map(([rowId, updates]) => saveRow(rowId, updates)));
    toast({ title: `✅ Saved ${entries.length} item${entries.length > 1 ? "s" : ""}` });
  }

  // ─── Status toggle ────────────────────────────────────────────────────────

  function toggleStatus(row: InventoryItem) {
    const newStatus = row.status === "active" ? "inactive" : "active";
    if (newStatus === "active" && Number(row.price || 0) <= 0) {
      toast({
        title: "Price required",
        description: "Add a selling price before marking this product active.",
        variant: "destructive",
      });
      return;
    }
    setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, status: newStatus } : r));
    // Stage for save — auto-save triggers via useEffect
    updateDirty((prev) => {
      const next = new Map(prev);
      next.set(row.id, { ...(next.get(row.id) ?? {}), status: newStatus });
      return next;
    });
  }

  // ─── Image upload ─────────────────────────────────────────────────────────

  function openImagePicker(rowId: string) {
    fileUploadTarget.current = rowId;
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const rowId = fileUploadTarget.current;
    if (!file || !rowId) return;
    e.target.value = "";

    setUploadingRowId(rowId);
    try {
      const url = await uploadImageToCloudinary(file);
      setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, imageUrl: url } : r));
      // Stage for save — auto-save triggers via useEffect
      updateDirty((prev) => {
        const next = new Map(prev);
        next.set(rowId, { ...(next.get(rowId) ?? {}), imageUrl: url });
        return next;
      });
      toast({ title: "Image ready — click Save Changes to persist" });
    } catch (err: any) {
      toast({ title: "Image upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadingRowId(null);
      fileUploadTarget.current = null;
    }
  }

  // ─── Sort ─────────────────────────────────────────────────────────────────

  function toggleSort(field: keyof InventoryItem) {
    if (sortField === field) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  function handleDeleteClick(rowId: string) {
    if (confirmDelete === rowId) {
      // Second click — actually delete
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmDelete(null);
      deleteRow(rowId);
    } else {
      // First click — arm confirm, auto-cancel after 3 s
      setConfirmDelete(rowId);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmDelete(null), 3000);
    }
  }

  async function deleteRow(rowId: string) {
    setSaving((prev) => new Set(prev).add(rowId));
    try {
      await inventoryService.delete(workspaceId, rowId);
      setRows((prev) => prev.filter((r) => r.id !== rowId));
      updateDirty((prev) => { const n = new Map(prev); n.delete(rowId); return n; });
      toast({ title: "Item deleted" });
    } catch (e: any) {
      setErrors((prev) => new Map(prev).set(rowId, e.message));
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving((prev) => { const n = new Set(prev); n.delete(rowId); return n; });
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  // ─── Row selection ────────────────────────────────────────────────────────

  function toggleRowSelect(id: string) {
    setSelectedRows((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleSelectAll() {
    if (selectedRows.size === pageRows.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(pageRows.map((r) => r.id)));
    }
  }

  // ─── Image search ─────────────────────────────────────────────────────────

  async function loadSearchSettings() {
    try {
      const { data: row } = await supabase.from('workspace_settings').select('data').eq('workspace_id', workspaceId).eq('category', 'inventoryImageSearch').single();
      if (row?.data) {
        const d = row.data as any;
        const provider: ImgProvider = d.provider === "google" ? "google" : "ddg";
        setImgProvider(provider);
        setImgProviderInput(provider);
        setImgApiKey(d.apiKey ?? "");
        setImgCx(d.cx ?? "");
        setImgApiKeyInput(d.apiKey ?? "");
        setImgCxInput(d.cx ?? "");
        return { provider, apiKey: d.apiKey ?? "", cx: d.cx ?? "" };
      }
    } catch (_) {}
    return { provider: "ddg" as ImgProvider, apiKey: "", cx: "" };
  }

  async function saveSearchSettings() {
    const payload: any = { provider: imgProviderInput };
    if (imgProviderInput === "google") {
      payload.apiKey = imgApiKeyInput;
      payload.cx = imgCxInput;
    }
    await supabaseServiceRole.from('workspace_settings').upsert({ workspace_id: workspaceId, category: 'inventoryImageSearch', data: payload }, { onConflict: 'workspace_id,category' });
    setImgProvider(imgProviderInput);
    setImgApiKey(imgApiKeyInput);
    setImgCx(imgCxInput);
    setImgSetupMode(false);
    toast({ title: "Search settings saved" });
    if (searchQueue.length > 0) runSearch(searchQueue[searchQueueIdx], imgProviderInput, imgApiKeyInput, imgCxInput);
  }

  async function openImageSearch() {
    const selected = rows.filter((r) => selectedRows.has(r.id));
    if (!selected.length) { toast({ title: "Select at least one item first" }); return; }
    setSearchQueue(selected);
    setSearchQueueIdx(0);
    setSearchResults([]);
    setShowImgSearch(true);
    const { provider, apiKey, cx } = await loadSearchSettings();
    // DDG needs no setup; Google needs key+cx. Open setup screen only if Google chosen but creds missing.
    if (provider === "google" && (!apiKey || !cx)) { setImgSetupMode(true); return; }
    const item = selected[0];
    setSearchQuery(`${item.name} ${item.category || ""} product`);
    runSearch(item, provider, apiKey, cx);
  }

  async function runSearch(item: InventoryItem, provider: ImgProvider, apiKey: string, cx: string, customQ?: string) {
    const q = customQ ?? `${item.name} ${item.category || ""} product photo`;
    setSearchQuery(q);
    setSearchLoading(true);
    setSearchResults([]);
    try {
      let results: ImgResult[] = [];
      if (provider === "ddg") {
        const { data, error } = await supabase.functions.invoke('image-search-ddg', { body: { query: q } });
        if (error) throw new Error((error as any)?.message || 'DuckDuckGo search failed');
        if (data?.error) throw new Error(data.error);
        results = (data?.results ?? []).map((r: any) => ({
          url: r.url,
          thumb: r.thumb || r.url,
          title: r.title || "",
          source: r.source || "",
        }));
      } else {
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&searchType=image&num=10&imgType=photo&safe=active&q=${encodeURIComponent(q)}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        results = (data.items ?? []).map((it: any) => ({
          url: it.link,
          thumb: it.image?.thumbnailLink ?? it.link,
          title: it.title,
          source: it.image?.contextLink ?? "",
        }));
      }
      setSearchResults(results);
    } catch (e: any) {
      toast({ title: "Image search failed", description: e.message, variant: "destructive" });
    } finally {
      setSearchLoading(false);
    }
  }

  async function applySearchImage(imageUrl: string, rowId: string) {
    setUploadingSearch(imageUrl);
    try {
      // Upload via Cloudinary's URL fetch (avoids CORS — Cloudinary fetches server-side)
      const formData = new FormData();
      formData.append("file", imageUrl);
      formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
      formData.append("folder", "inventory");
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: "POST", body: formData,
      });
      const data = await res.json();
      if (!data.secure_url) throw new Error(data.error?.message ?? "Upload failed");
      const cdnUrl = data.secure_url;
      setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, imageUrl: cdnUrl } : r));
      updateDirty((prev) => {
        const n = new Map(prev);
        n.set(rowId, { ...(n.get(rowId) ?? {}), imageUrl: cdnUrl });
        return n;
      });
      toast({ title: "Image staged — click Save Changes to persist" });
      // Auto-advance to next
      advanceQueue();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingSearch(null);
    }
  }

  function advanceQueue() {
    const next = searchQueueIdx + 1;
    if (next >= searchQueue.length) {
      setShowImgSearch(false);
      setSelectedRows(new Set());
      return;
    }
    setSearchQueueIdx(next);
    setSearchResults([]);
    const item = searchQueue[next];
    const q = `${item.name} ${item.category || ""} product photo`;
    setSearchQuery(q);
    runSearch(item, imgProvider, imgApiKey, imgCx, q);
  }

  const dirtyCount = dirty.size;

  return (
    <div className={embedded ? "flex flex-col h-full" : "fixed inset-0 z-50 flex flex-col bg-background"}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* ── Header (standalone mode only) ── */}
      {!embedded && (
        <div className="flex items-center justify-between px-4 py-3 border-b bg-card shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Batch Editor</h2>
            <Badge variant="outline" className="text-muted-foreground">
              {filteredRows.length} items
            </Badge>
            {dirtyCount > 0 && (
              <Badge className="bg-amber-100 text-amber-800 border-amber-300">
                {dirtyCount} row{dirtyCount > 1 ? "s" : ""} with unsaved changes
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedRows.size > 0 && (
              <Button size="sm" variant="outline" onClick={openImageSearch}
                className="gap-1.5 border-purple-300 text-purple-700 hover:bg-purple-50">
                <Wand2 className="h-4 w-4" />
                Find Images ({selectedRows.size})
              </Button>
            )}
            {selectedRows.size > 0 && (
              <Button size="sm" variant="outline" onClick={fetchDescriptions}
                disabled={fetchingDescriptions}
                className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50">
                <Search className="h-4 w-4" />
                {fetchingDescriptions && descProgress
                  ? `Searching… ${descProgress.done}/${descProgress.total}`
                  : `Find Descriptions (${selectedRows.size})`}
              </Button>
            )}
            <Button
              size="sm"
              variant={dirtyCount > 0 ? "default" : "outline"}
              onClick={saveAllDirty}
              disabled={dirtyCount === 0}
              className="gap-1.5"
            >
              <Save className="h-4 w-4" />
              Save Changes{dirtyCount > 0 ? ` (${dirtyCount})` : ""}
            </Button>
            <Button size="sm" variant="outline" onClick={() => loadItems()} className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-muted/30 shrink-0">
        {/* Save Changes + Refresh always visible when embedded */}
        {embedded && (
          <>
            <Button
              size="sm"
              variant={dirtyCount > 0 ? "default" : "outline"}
              onClick={saveAllDirty}
              disabled={dirtyCount === 0}
              className="gap-1.5 shrink-0"
            >
              <Save className="h-4 w-4" />
              Save Changes{dirtyCount > 0 ? ` (${dirtyCount})` : ""}
            </Button>
            <Button size="sm" variant="outline" onClick={() => loadItems()} className="gap-1.5 shrink-0">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            {dirtyCount > 0 && (
              <span className="text-xs text-amber-600 font-medium">
                {dirtyCount} row{dirtyCount > 1 ? "s" : ""} with unsaved changes
              </span>
            )}
          </>
        )}
        {/* Find Images button */}
        {selectedRows.size > 0 && (
          <Button size="sm" variant="outline" onClick={openImageSearch} className="gap-1.5 shrink-0 border-purple-300 text-purple-700 hover:bg-purple-50">
            <Wand2 className="h-4 w-4" />
            Find Images ({selectedRows.size})
          </Button>
        )}
        {/* Find Descriptions button */}
        {selectedRows.size > 0 && (
          <Button size="sm" variant="outline" onClick={fetchDescriptions}
            disabled={fetchingDescriptions}
            className="gap-1.5 shrink-0 border-green-300 text-green-700 hover:bg-green-50">
            <Search className="h-4 w-4" />
            {fetchingDescriptions && descProgress
              ? `Searching… ${descProgress.done}/${descProgress.total}`
              : `Find Descriptions (${selectedRows.size})`}
          </Button>
        )}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, SKU, category, supplier…"
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="absolute right-2 top-2 text-muted-foreground hover:text-foreground" onClick={() => setSearch("")}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 text-sm">
          {(["all", "active", "inactive"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={cn(
                "px-3 py-1 rounded-full border text-xs font-medium transition-colors",
                filterStatus === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span>Page {page} / {totalPages}</span>
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="p-1 rounded hover:bg-accent disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="p-1 rounded hover:bg-accent disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading inventory…
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-card border-b shadow-sm">
              <tr>
                {/* Select all */}
                <th className="text-left px-2 py-2 w-9 border-r">
                  <input
                    type="checkbox"
                    className="rounded cursor-pointer"
                    checked={pageRows.length > 0 && selectedRows.size === pageRows.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                {/* Row state */}
                <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground w-8 border-r"></th>
                {/* Image */}
                <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground w-14 border-r">Img</th>
                {/* Status */}
                <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground w-20 border-r">Status</th>
                {/* Text fields */}
                {TEXT_FIELDS.map((f) => (
                  <th
                    key={f.key}
                    className={cn("text-left px-2 py-2 text-xs font-medium text-muted-foreground border-r cursor-pointer hover:bg-accent select-none", f.width)}
                    onClick={() => toggleSort(f.key)}
                  >
                    <span className="flex items-center gap-1">
                      {f.label}
                      {sortField === f.key && (
                        <ArrowUpDown className="h-3 w-3 text-primary" />
                      )}
                    </span>
                  </th>
                ))}
                {/* Delete */}
                <th className="text-left px-2 py-2 text-xs font-medium text-muted-foreground w-12"></th>
              </tr>
            </thead>

            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={TEXT_FIELDS.length + 3} className="text-center py-12 text-muted-foreground">
                    No items found
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => {
                  const isDirty = dirty.has(row.id);
                  const isSaving = saving.has(row.id);
                  const isSaved = saved.has(row.id);
                  const hasError = errors.has(row.id);
                  const thumb = row.imageUrl ? getThumbnailUrl(row.imageUrl) : null;
                  const isUploading = uploadingRowId === row.id;

                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        "border-b hover:bg-muted/30 transition-colors",
                        selectedRows.has(row.id) && "bg-purple-50/40",
                        isDirty && !selectedRows.has(row.id) && "bg-amber-50/40",
                        hasError && "bg-red-50/40",
                      )}
                    >
                      {/* ── Checkbox ── */}
                      <td className="px-2 py-1 border-r w-9 text-center">
                        <input
                          type="checkbox"
                          className="rounded cursor-pointer"
                          checked={selectedRows.has(row.id)}
                          onChange={() => toggleRowSelect(row.id)}
                        />
                      </td>
                      {/* ── State indicator ── */}
                      <td className="px-2 py-1 border-r text-center w-8">
                        {isSaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground mx-auto" />}
                        {isSaved && !isSaving && <Check className="h-3 w-3 text-green-500 mx-auto" />}
                        {hasError && !isSaving && <AlertCircle className="h-3 w-3 text-red-500 mx-auto" />}
                        {isDirty && !isSaving && !isSaved && !hasError && (
                          <span className="block w-2 h-2 rounded-full bg-amber-400 mx-auto" />
                        )}
                      </td>

                      {/* ── Image ── */}
                      <td className="px-1 py-1 border-r w-14">
                        <button
                          className="relative w-10 h-10 rounded border border-dashed border-muted-foreground/40 overflow-hidden flex items-center justify-center hover:border-primary transition-colors group"
                          onClick={() => openImagePicker(row.id)}
                          title="Click to change image"
                        >
                          {isUploading ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : thumb ? (
                            <>
                              <img src={thumb} alt="" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <ImageIcon className="h-3 w-3 text-white" />
                              </div>
                            </>
                          ) : (
                            <ImageIcon className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary" />
                          )}
                        </button>
                      </td>

                      {/* ── Status toggle ── */}
                      <td className="px-2 py-1 border-r w-20">
                        <button
                          onClick={() => toggleStatus(row)}
                          className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-medium transition-all",
                            row.status === "active"
                              ? "bg-green-100 text-green-700 hover:bg-green-200"
                              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                          )}
                        >
                          {row.status === "active" ? "Active" : "Inactive"}
                        </button>
                      </td>

                      {/* ── Editable text cells ── */}
                      {TEXT_FIELDS.map((f) => {
                        const isActive = activeCell?.rowId === row.id && activeCell?.field === f.key;
                        const rawVal = row[f.key];
                        const displayVal = rawVal !== undefined && rawVal !== null && rawVal !== "" ? String(rawVal) : "";

                        return (
                          <td
                            key={f.key}
                            className={cn(
                              "border-r px-0 py-0",
                              f.width,
                              isActive ? "bg-blue-50" : "hover:bg-accent/50 cursor-pointer"
                            )}
                            onClick={() => !isActive && startEdit(row.id, f.key, rawVal)}
                          >
                            {isActive ? (
                              f.type === "select" && f.options ? (
                                <select
                                  autoFocus
                                  value={cellValue}
                                  onChange={(e) => {
                                    setCellValue(e.target.value);
                                    commitEdit(row.id, f.key, e.target.value);
                                  }}
                                  onBlur={() => commitEdit(row.id, f.key, cellValue)}
                                  onKeyDown={(e) => e.key === "Escape" && setActiveCell(null)}
                                  className="w-full h-full px-2 py-1.5 bg-white border-none outline-none ring-1 ring-inset ring-primary text-sm cursor-pointer"
                                >
                                  {(f.key === "category" ? allCategories : f.options).map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  ref={cellInputRef}
                                  type={f.type === "number" ? "number" : "text"}
                                  value={cellValue}
                                  onChange={(e) => setCellValue(e.target.value)}
                                  onBlur={() => commitEdit(row.id, f.key, cellValue)}
                                  onKeyDown={(e) => handleCellKeyDown(e, row.id, f.key)}
                                  className="w-full h-full px-2 py-1.5 bg-transparent border-none outline-none ring-1 ring-inset ring-primary text-sm"
                                />
                              )
                            ) : (
                              <span className={cn(
                                "block px-2 py-1.5 text-sm leading-tight",
                                !displayVal && "text-muted-foreground/30 italic text-xs"
                              )}>
                                {displayVal || "—"}
                              </span>
                            )}
                          </td>
                        );
                      })}

                      {/* ── Delete ── */}
                      <td className="px-1 py-1 text-center w-12">
                        {isSaving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground mx-auto" />
                        ) : (
                          <button
                            onClick={() => handleDeleteClick(row.id)}
                            title={confirmDelete === row.id ? "Click again to confirm delete" : "Delete item"}
                            className={cn(
                              "p-1 rounded transition-colors",
                              confirmDelete === row.id
                                ? "bg-red-100 text-red-600 hover:bg-red-200 animate-pulse"
                                : "text-muted-foreground/40 hover:text-red-500 hover:bg-red-50"
                            )}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="flex items-center justify-between px-4 py-2 border-t bg-card shrink-0 text-xs text-muted-foreground">
        <span>
          Click any cell to edit • Tab / Enter to move on • Esc to cancel • Click <strong>Save Changes</strong> to write to database
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="p-1 rounded hover:bg-accent disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span>Page {page} / {totalPages} ({filteredRows.length} items)</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="p-1 rounded hover:bg-accent disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      {/* ── Image Search Modal ── */}
      {showImgSearch && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-background rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-purple-600" />
                <h3 className="font-semibold text-base">Find Product Images</h3>
                {!imgSetupMode && searchQueue.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {searchQueueIdx + 1} / {searchQueue.length}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setImgSetupMode(!imgSetupMode)} title="API Settings"
                  className="p-1.5 rounded hover:bg-accent text-muted-foreground">
                  <Settings2 className="h-4 w-4" />
                </button>
                <button onClick={() => setShowImgSearch(false)}
                  className="p-1.5 rounded hover:bg-accent text-muted-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Setup screen */}
            {imgSetupMode ? (
              <div className="flex-1 overflow-auto p-6 space-y-4">
                {/* Provider toggle */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-2">Image search provider</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setImgProviderInput("ddg")}
                      className={`border rounded-lg px-3 py-2 text-left transition-colors ${imgProviderInput === "ddg" ? "border-purple-500 bg-purple-50" : "border-gray-200 hover:bg-gray-50"}`}
                    >
                      <div className="font-semibold text-sm">DuckDuckGo</div>
                      <div className="text-xs text-muted-foreground">Free, no signup, unlimited</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setImgProviderInput("google")}
                      className={`border rounded-lg px-3 py-2 text-left transition-colors ${imgProviderInput === "google" ? "border-purple-500 bg-purple-50" : "border-gray-200 hover:bg-gray-50"}`}
                    >
                      <div className="font-semibold text-sm">Google Images</div>
                      <div className="text-xs text-muted-foreground">Better results, 100/day free, needs API key</div>
                    </button>
                  </div>
                </div>

                {imgProviderInput === "google" && (
                  <>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 space-y-1">
                      <p className="font-semibold">One-time Google Custom Search setup</p>
                      <p>1. Go to <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="underline">console.cloud.google.com</a> → Enable <strong>Custom Search JSON API</strong> → Create an API key</p>
                      <p>2. Go to <a href="https://programmablesearchengine.google.com" target="_blank" rel="noreferrer" className="underline">programmablesearchengine.google.com</a> → Create a search engine → Copy the <strong>Search engine ID (cx)</strong></p>
                      <p>3. Free tier: 100 image searches/day</p>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Google API Key</label>
                        <Input value={imgApiKeyInput} onChange={(e) => setImgApiKeyInput(e.target.value)}
                          placeholder="AIzaSy…" className="font-mono text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Search Engine ID (cx)</label>
                        <Input value={imgCxInput} onChange={(e) => setImgCxInput(e.target.value)}
                          placeholder="abc123…" className="font-mono text-sm" />
                      </div>
                    </div>
                  </>
                )}

                {imgProviderInput === "ddg" && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-800">
                    <p className="font-semibold mb-1">DuckDuckGo is ready to use</p>
                    <p>No keys needed. Results come straight from DuckDuckGo's image index, no daily quota. Quality is decent but slightly less precise than Google for niche electronic parts.</p>
                  </div>
                )}

                <Button
                  onClick={saveSearchSettings}
                  disabled={imgProviderInput === "google" && (!imgApiKeyInput || !imgCxInput)}
                  className="w-full"
                >
                  Save & Start Searching
                </Button>
              </div>
            ) : (
              <>
                {/* Current item info + search bar */}
                {searchQueue[searchQueueIdx] && (
                  <div className="px-5 py-3 border-b bg-muted/30 shrink-0 space-y-2">
                    <div className="flex items-center gap-2">
                      {searchQueue[searchQueueIdx].imageUrl && (
                        <img src={getThumbnailUrl(searchQueue[searchQueueIdx].imageUrl!)}
                          alt="" className="w-10 h-10 rounded object-cover border" />
                      )}
                      <div>
                        <p className="font-medium text-sm">{searchQueue[searchQueueIdx].name}</p>
                        <p className="text-xs text-muted-foreground">SKU: {searchQueue[searchQueueIdx].sku || "—"} • {searchQueue[searchQueueIdx].category || "—"}</p>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={advanceQueue} className="gap-1 text-muted-foreground">
                          <SkipForward className="h-4 w-4" /> Skip
                        </Button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && runSearch(searchQueue[searchQueueIdx], imgProvider, imgApiKey, imgCx, searchQuery)}
                        className="text-sm h-8"
                        placeholder="Search query…"
                      />
                      <Button size="sm" onClick={() => runSearch(searchQueue[searchQueueIdx], imgProvider, imgApiKey, imgCx, searchQuery)}
                        disabled={searchLoading} className="gap-1.5 shrink-0">
                        {searchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        Search
                      </Button>
                    </div>
                  </div>
                )}

                {/* Results grid */}
                <div className="flex-1 overflow-auto p-4">
                  {searchLoading ? (
                    <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin" /> Searching the web…
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                      No results yet — click Search to find images
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                      {searchResults.map((r, i) => (
                        <div key={i} className="group relative rounded-lg overflow-hidden border bg-muted/30 aspect-square cursor-pointer hover:border-purple-400 transition-all"
                          onClick={() => !uploadingSearch && applySearchImage(r.url, searchQueue[searchQueueIdx].id)}>
                          <img src={r.thumb} alt={r.title}
                            className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
                            onError={(e) => { (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23f0f0f0'/%3E%3Ctext x='50' y='55' text-anchor='middle' font-size='12' fill='%23999'%3ENo preview%3C/text%3E%3C/svg%3E"; }}
                          />
                          {uploadingSearch === r.url && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                              <Loader2 className="h-6 w-6 animate-spin text-white" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-end">
                            <div className="w-full bg-gradient-to-t from-black/60 to-transparent p-1.5 translate-y-full group-hover:translate-y-0 transition-transform">
                              <p className="text-white text-[10px] truncate">{r.title}</p>
                              {r.source && (
                                <a href={r.source} target="_blank" rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-white/70 text-[10px] hover:text-white flex items-center gap-0.5">
                                  <ExternalLink className="h-2.5 w-2.5" /> Source
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Progress */}
                {searchQueue.length > 1 && (
                  <div className="px-5 py-2 border-t bg-muted/20 shrink-0 flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="flex-1 bg-muted rounded-full h-1.5">
                      <div className="bg-purple-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${((searchQueueIdx) / searchQueue.length) * 100}%` }} />
                    </div>
                    <span>{searchQueueIdx} of {searchQueue.length} done</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
