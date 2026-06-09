import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Receipt, Plus, Search, Trash2, X, Camera, Upload, Loader2, AlertCircle,
  Save, FileText, Edit, Eye, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  expenseSlipService,
  ExpenseSlip,
  ExpenseSlipInput,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
} from "@/lib/expenseSlipService";
import { extractSlipWithAi } from "@/lib/aiOcrService";

interface ExpenseSlipsPageProps {
  onClose: () => void;
  /** Auto-open the new-slip editor and prompt for an image source on mount */
  initialAction?: "camera" | "upload";
}

const emptyForm = (): ExpenseSlipInput => ({
  vendorName: "",
  slipNumber: "",
  date: new Date().toISOString().split("T")[0],
  subtotal: 0,
  vatAmount: 0,
  totalAmount: 0,
  category: "General Expenses",
  paymentMethod: "card",
  notes: "",
  imageUrl: undefined,
  imagePath: undefined,
  lineItems: [],
  rawOcrText: undefined,
  ocrConfidence: undefined,
  createdBy: "",
});

export function ExpenseSlipsPage({ onClose, initialAction }: ExpenseSlipsPageProps) {
  const { workspaceId, user } = useAuth();
  const { toast } = useToast();

  const [slips, setSlips] = useState<ExpenseSlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<ExpenseSlip | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExpenseSlip | null>(null);
  const [viewing, setViewing] = useState<ExpenseSlip | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<ExpenseSlipInput>(emptyForm());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ stage: string; percent: number }>({ stage: "", percent: 0 });
  const [scanError, setScanError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!workspaceId) return;
    void loadData();
  }, [workspaceId]);

  // Auto-open the editor and the camera/file picker when launched via the sidebar shortcut
  const autoActionFiredRef = useRef(false);
  useEffect(() => {
    if (!initialAction || autoActionFiredRef.current) return;
    autoActionFiredRef.current = true;
    openCreate();
    // Wait for dialog to mount before clicking the hidden input
    const t = setTimeout(() => {
      if (initialAction === "camera") cameraInputRef.current?.click();
      else fileInputRef.current?.click();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAction]);

  async function loadData() {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await expenseSlipService.list(workspaceId);
      setSlips(data);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return slips.filter(s => {
      if (filterCategory !== "all" && s.category !== filterCategory) return false;
      if (!term) return true;
      return (
        s.vendorName?.toLowerCase().includes(term) ||
        s.slipNumber?.toLowerCase().includes(term) ||
        s.notes?.toLowerCase().includes(term) ||
        s.category?.toLowerCase().includes(term)
      );
    });
  }, [slips, searchTerm, filterCategory]);

  const totalCount = filtered.length;
  const totalAmount = useMemo(() => filtered.reduce((a, b) => a + (Number(b.totalAmount) || 0), 0), [filtered]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setPreviewUrl(null);
    setPendingFile(null);
    setScanError(null);
    setShowEditor(true);
  }

  function openEdit(slip: ExpenseSlip) {
    setEditing(slip);
    setForm({
      vendorName: slip.vendorName,
      slipNumber: slip.slipNumber,
      date: slip.date,
      subtotal: slip.subtotal,
      vatAmount: slip.vatAmount,
      totalAmount: slip.totalAmount,
      category: slip.category,
      paymentMethod: slip.paymentMethod,
      notes: slip.notes,
      imageUrl: slip.imageUrl,
      imagePath: slip.imagePath,
      lineItems: slip.lineItems || [],
      rawOcrText: slip.rawOcrText,
      ocrConfidence: slip.ocrConfidence,
      createdBy: slip.createdBy,
    });
    setPreviewUrl(slip.imageUrl || null);
    setPendingFile(null);
    setScanError(null);
    setShowEditor(true);
  }

  function closeEditor() {
    setShowEditor(false);
    setEditing(null);
    setPreviewUrl(null);
    setPendingFile(null);
    setScanError(null);
  }

  const updateForm = <K extends keyof ExpenseSlipInput>(field: K, value: ExpenseSlipInput[K]) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  // Auto-recalc total when subtotal/vat change
  useEffect(() => {
    const newTotal = Number((Number(form.subtotal) + Number(form.vatAmount)).toFixed(2));
    if (!Number.isNaN(newTotal) && newTotal !== form.totalAmount) {
      setForm(prev => ({ ...prev, totalAmount: newTotal }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.subtotal, form.vatAmount]);

  const handleFileChosen = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setScanError("Please choose an image file");
      return;
    }
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setScanError(null);
  }, []);

  async function runScan() {
    if (!pendingFile || !workspaceId) return;
    setScanning(true);
    setScanError(null);
    try {
      const result = await extractSlipWithAi(workspaceId, pendingFile, (stage, percent) => {
        setScanProgress({ stage, percent });
      });
      if (result.success && result.data) {
        const d = result.data;
        const subtotal = Number(d.subtotal) || 0;
        const vat = Number(d.vatAmount) || 0;
        const total = Number(d.totalAmount) || (subtotal + vat);
        setForm(prev => ({
          ...prev,
          vendorName: d.vendorName || prev.vendorName,
          slipNumber: d.slipNumber || prev.slipNumber,
          date: d.date || prev.date,
          subtotal,
          vatAmount: vat,
          totalAmount: total,
          paymentMethod: d.paymentMethod || prev.paymentMethod,
          lineItems: Array.isArray(d.lineItems) ? d.lineItems.map(li => ({
            description: String(li.description ?? ""),
            quantity: Number(li.quantity) || 1,
            unitPrice: Number(li.unitPrice) || 0,
            amount: Number(li.amount) || 0,
          })) : [],
          rawOcrText: result.raw,
          ocrConfidence: Number(d.confidence) || 0,
        }));
        toast({
          title: "Slip scanned",
          description: `Extracted with ${d.confidence}% confidence using ${result.model?.split('/').pop() || 'AI'}. Review and edit before saving.`,
        });
      } else {
        setScanError(result.error || "Could not extract data from image");
      }
    } catch (err: any) {
      setScanError(err?.message || "Scan failed");
    } finally {
      setScanning(false);
      setScanProgress({ stage: "", percent: 0 });
    }
  }

  async function handleSave() {
    if (!workspaceId) return;
    if (!form.vendorName.trim()) {
      toast({ title: "Vendor required", description: "Please enter a vendor name", variant: "destructive" });
      return;
    }
    if (!form.totalAmount || form.totalAmount <= 0) {
      toast({ title: "Amount required", description: "Total amount must be greater than 0", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      let imageUrl = form.imageUrl;
      let imagePath = form.imagePath;
      if (pendingFile) {
        const uploaded = await expenseSlipService.uploadImage(workspaceId, pendingFile);
        if (uploaded) {
          imageUrl = uploaded.url;
          imagePath = uploaded.path;
        } else if (previewUrl?.startsWith("blob:")) {
          // Storage bucket missing — fall back to leaving imageUrl unset so we don't store a stale blob URL
          imageUrl = undefined;
          imagePath = undefined;
        }
      }

      const payload: ExpenseSlipInput = {
        ...form,
        imageUrl,
        imagePath,
        createdBy: editing?.createdBy || user?.uid || user?.email || "unknown",
      };

      if (editing) {
        await expenseSlipService.update(editing.id, payload);
        toast({ title: "Slip updated" });
      } else {
        await expenseSlipService.create(workspaceId, payload);
        toast({ title: "Slip added" });
      }
      closeEditor();
      await loadData();
    } catch (err: any) {
      console.error("[expense-slips] save failed", err);
      toast({
        title: "Save failed",
        description: err?.message || "Check that the expense_slips table exists",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await expenseSlipService.remove(confirmDelete.id);
      toast({ title: "Slip deleted" });
      setConfirmDelete(null);
      await loadData();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="fixed inset-0 bg-background z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
        <div className="flex items-center gap-3">
          <Receipt className="h-5 w-5 text-purple-500" />
          <div>
            <h2 className="font-semibold">Expense Slips</h2>
            <p className="text-xs text-muted-foreground">Snap a slip — extract vendor, amount &amp; VAT automatically</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add Slip
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Filter / search bar */}
      <div className="px-4 py-3 border-b bg-muted/30 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search vendor, slip #, notes…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {EXPENSE_CATEGORIES.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-4 text-sm">
          <div><span className="text-muted-foreground">Slips:</span> <span className="font-semibold">{totalCount}</span></div>
          <div><span className="text-muted-foreground">Total:</span> <span className="font-semibold">R {totalAmount.toFixed(2)}</span></div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
            <Receipt className="h-12 w-12 opacity-30" />
            <p>No expense slips yet</p>
            <Button onClick={openCreate} variant="outline" size="sm">
              <Camera className="h-4 w-4 mr-1" /> Scan your first slip
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Slip #</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
                <TableHead className="text-right">VAT</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(s => (
                <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setViewing(s)}>
                  <TableCell className="text-sm">{s.date}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {s.imageUrl && <FileText className="h-3 w-3 text-muted-foreground" />}
                      {s.vendorName}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.slipNumber || "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{s.category}</Badge></TableCell>
                  <TableCell className="capitalize text-sm">{s.paymentMethod}</TableCell>
                  <TableCell className="text-right">R {Number(s.subtotal || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right">R {Number(s.vatAmount || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-semibold">R {Number(s.totalAmount || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)} title="Edit">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(s)} title="Delete">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Editor dialog */}
      <Dialog open={showEditor} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit expense slip" : "New expense slip"}</DialogTitle>
            <DialogDescription>
              Snap a photo of the slip and we'll extract the details — or fill the fields in manually.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Image / scanner column */}
            <div className="space-y-3">
              <Label>Slip image</Label>
              {previewUrl ? (
                <div className="space-y-2">
                  <div className="relative aspect-[3/4] bg-muted rounded-lg overflow-hidden border">
                    <img src={previewUrl} alt="Slip preview" className="w-full h-full object-contain" />
                  </div>
                  <div className="flex gap-2">
                    {pendingFile && (
                      <Button
                        type="button"
                        onClick={runScan}
                        disabled={scanning}
                        size="sm"
                        className="flex-1"
                      >
                        {scanning ? (
                          <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> {scanProgress.stage} {scanProgress.percent}%</>
                        ) : (
                          <><CheckCircle2 className="h-4 w-4 mr-1" /> Extract data</>
                        )}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setPreviewUrl(null);
                        setPendingFile(null);
                        updateForm("imageUrl", undefined);
                        updateForm("imagePath", undefined);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary transition-colors cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm font-medium">Upload slip image</p>
                    <p className="text-xs text-muted-foreground">JPG, PNG, HEIC</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChosen(f); }}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => cameraInputRef.current?.click()}
                    className="w-full"
                  >
                    <Camera className="h-4 w-4 mr-2" />
                    Take photo
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChosen(f); }}
                    />
                  </Button>
                </>
              )}

              {/* AI-powered OCR — no browser support check needed; runs server-side via NVIDIA vision */}
              {scanError && (
                <div className="flex gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{scanError}</span>
                </div>
              )}
              {form.ocrConfidence !== undefined && (
                <p className="text-xs text-muted-foreground">
                  OCR confidence: <span className={form.ocrConfidence >= 60 ? "text-green-600" : "text-amber-600"}>{form.ocrConfidence}%</span>
                </p>
              )}
            </div>

            {/* Form column */}
            <div className="space-y-3">
              <div>
                <Label htmlFor="vendorName">Vendor *</Label>
                <Input
                  id="vendorName"
                  value={form.vendorName}
                  onChange={e => updateForm("vendorName", e.target.value)}
                  placeholder="Builders Warehouse"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="slipNumber">Slip / Inv #</Label>
                  <Input
                    id="slipNumber"
                    value={form.slipNumber}
                    onChange={e => updateForm("slipNumber", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="date">Date *</Label>
                  <Input
                    id="date"
                    type="date"
                    value={form.date}
                    onChange={e => updateForm("date", e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => updateForm("category", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Payment method</Label>
                <Select value={form.paymentMethod} onValueChange={v => updateForm("paymentMethod", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(p => (
                      <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="subtotal">Subtotal</Label>
                  <Input
                    id="subtotal"
                    type="number"
                    step="0.01"
                    value={form.subtotal}
                    onChange={e => updateForm("subtotal", parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <Label htmlFor="vatAmount">VAT</Label>
                  <Input
                    id="vatAmount"
                    type="number"
                    step="0.01"
                    value={form.vatAmount}
                    onChange={e => updateForm("vatAmount", parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <Label htmlFor="totalAmount">Total *</Label>
                  <Input
                    id="totalAmount"
                    type="number"
                    step="0.01"
                    value={form.totalAmount}
                    onChange={e => updateForm("totalAmount", parseFloat(e.target.value) || 0)}
                    className="font-semibold"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={form.notes || ""}
                  onChange={e => updateForm("notes", e.target.value)}
                  rows={2}
                />
              </div>

              {form.lineItems.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Detected line items ({form.lineItems.length})
                  </summary>
                  <div className="mt-2 space-y-1 max-h-32 overflow-auto border rounded p-2">
                    {form.lineItems.map((li, i) => (
                      <div key={i} className="flex justify-between gap-2">
                        <span className="truncate">{li.description}</span>
                        <span className="text-muted-foreground shrink-0">R {li.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeEditor}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Saving</> : <><Save className="h-4 w-4 mr-1" /> Save slip</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={!!viewing} onOpenChange={open => !open && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle>{viewing.vendorName}</DialogTitle>
                <DialogDescription>{viewing.date} · {viewing.category}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {viewing.imageUrl ? (
                  <a href={viewing.imageUrl} target="_blank" rel="noreferrer">
                    <img src={viewing.imageUrl} alt="Slip" className="rounded border w-full object-contain" />
                  </a>
                ) : (
                  <div className="rounded border h-48 flex items-center justify-center text-muted-foreground text-sm">
                    No image
                  </div>
                )}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Slip #</span><span>{viewing.slipNumber || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Payment</span><span className="capitalize">{viewing.paymentMethod}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>R {Number(viewing.subtotal || 0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">VAT</span><span>R {Number(viewing.vatAmount || 0).toFixed(2)}</span></div>
                  <div className="flex justify-between font-semibold text-base border-t pt-2"><span>Total</span><span>R {Number(viewing.totalAmount || 0).toFixed(2)}</span></div>
                  {viewing.notes && (
                    <div className="pt-2 text-xs text-muted-foreground whitespace-pre-wrap">{viewing.notes}</div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { const s = viewing; setViewing(null); openEdit(s); }}>
                  <Edit className="h-4 w-4 mr-1" /> Edit
                </Button>
                <Button onClick={() => setViewing(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <Dialog open={!!confirmDelete} onOpenChange={open => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this expense slip?</DialogTitle>
            <DialogDescription>
              {confirmDelete?.vendorName} — R {Number(confirmDelete?.totalAmount || 0).toFixed(2)}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ExpenseSlipsPage;
