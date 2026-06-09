/**
 * Barcode Printing Component
 * Print barcode labels for inventory items
 */

import { useState, useRef, useEffect } from "react";
import { 
  Package, 
  Printer, 
  Settings, 
  Search,
  Plus,
  Minus,
  Download,
  Eye,
  X,
  Check
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import JsBarcode from "jsbarcode";
import { useAuth } from "@/contexts/AuthContext";
import { getInventoryItems, type InventoryItem } from "@/lib/inventoryEcommerceSync";
import { generateBarcode, getBarcodeInfo } from "@/lib/barcodeService";
import { loadInventoryPrinterConfig, type InventoryPrinterConfig } from "@/components/crm/InventoryPrinterSettings";

// ─── Types ───────────────────────────────────────────────────────────────

interface LabelTemplate {
  id: string;
  name: string;
  labelsPerPage: number;
  labelWidth: number; // mm
  labelHeight: number; // mm;
  paperWidth: number; // mm (A4 = 210)
  paperHeight: number; // mm (A4 = 297)
  marginTop: number; // mm
  marginLeft: number; // mm
  gapX: number; // mm
  gapY: number; // mm
}

const predefinedTemplates: Record<string, LabelTemplate> = {
  "tower_w107": {
    id: "tower_w107",
    name: "Tower W107 – 65 per sheet (38x21mm)",
    labelsPerPage: 65,
    labelWidth: 38.1,
    labelHeight: 21.2,
    paperWidth: 210,
    paperHeight: 297,
    marginTop: 10.7,
    marginLeft: 4.65,
    gapX: 2.5,
    gapY: 0
  },
  "21up": {
    id: "21up",
    name: "21 Labels (70x42mm)",
    labelsPerPage: 21,
    labelWidth: 70,
    labelHeight: 42,
    paperWidth: 210,
    paperHeight: 297,
    marginTop: 8,
    marginLeft: 5,
    gapX: 2.5,
    gapY: 0
  },
  "65up": {
    id: "65up",
    name: "65 Labels (38x21mm)",
    labelsPerPage: 65,
    labelWidth: 38,
    labelHeight: 21,
    paperWidth: 210,
    paperHeight: 297,
    marginTop: 8.5,
    marginLeft: 7,
    gapX: 2.5,
    gapY: 0
  },
  "84up": {
    id: "84up",
    name: "84 Labels (25x10mm) - Tiny",
    labelsPerPage: 84,
    labelWidth: 25,
    labelHeight: 10,
    paperWidth: 210,
    paperHeight: 297,
    marginTop: 8.5,
    marginLeft: 10,
    gapX: 2.5,
    gapY: 2.5
  }
};

export default function BarcodePrinting() {
  const { workspaceId } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({});
  const [selectedTemplate, setSelectedTemplate] = useState<string>("tower_w107");
  const [startLabel, setStartLabel] = useState(1);
  const [includeName, setIncludeName] = useState(true);
  const [includePrice, setIncludePrice] = useState(false);
  const [includeSKU, setIncludeSKU] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [printerConfig, setPrinterConfig] = useState<InventoryPrinterConfig | null>(null);
  const [thermalPrinting, setThermalPrinting] = useState(false);
  const [thermalSupported, setThermalSupported] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  // ─── Load Inventory Data ──────────────────────────────────────────────

  useEffect(() => {
    loadInventoryData();
    if (workspaceId) loadInventoryPrinterConfig(workspaceId).then(setPrinterConfig).catch(() => {});
    import("@/lib/thermalPrinterService").then(({ isThermalPrintSupported }) => {
      setThermalSupported(isThermalPrintSupported());
    });
  }, [workspaceId]);

  const loadInventoryData = async () => {
    if (!workspaceId) return;
    
    setLoading(true);
    try {
      const inventoryItems = await getInventoryItems(workspaceId);
      setItems(inventoryItems);
    } catch (error) {
      console.error("Error loading inventory:", error);
    } finally {
      setLoading(false);
    }
  };

  // ─── Filtering ────────────────────────────────────────────────────────

  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.barcode && item.barcode.toLowerCase().includes(searchTerm.toLowerCase())) ||
    item.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ─── Selection Management ─────────────────────────────────────────────

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const newSelection = new Set(filteredItems.map(item => item.id));
      setSelectedItems(newSelection);
      
      // Set default quantities
      const newQuantities = { ...itemQuantities };
      filteredItems.forEach(item => {
        if (!newQuantities[item.id]) {
          newQuantities[item.id] = 1;
        }
      });
      setItemQuantities(newQuantities);
    } else {
      setSelectedItems(new Set());
    }
  };

  const handleSelectItem = (itemId: string, checked: boolean) => {
    const newSelection = new Set(selectedItems);
    if (checked) {
      newSelection.add(itemId);
      if (!itemQuantities[itemId]) {
        setItemQuantities(prev => ({ ...prev, [itemId]: 1 }));
      }
    } else {
      newSelection.delete(itemId);
    }
    setSelectedItems(newSelection);
  };

  const updateQuantity = (itemId: string, change: number) => {
    setItemQuantities(prev => ({
      ...prev,
      [itemId]: Math.max(1, (prev[itemId] || 1) + change)
    }));
  };

  // ─── Barcode Generation ───────────────────────────────────────────────

  const generateBarcodeDataURL = (value: string): string => {
    if (!value) return '';
    
    const canvas = document.createElement('canvas');
    try {
      JsBarcode(canvas, value, {
        format: "CODE128",
        width: 1,
        height: 40,
        displayValue: false,
        margin: 2,
        font: "Arial"
      });
      return canvas.toDataURL();
    } catch (error) {
      console.error('Error generating barcode:', error);
      return '';
    }
  };

  // ─── Print Functions ──────────────────────────────────────────────────

  // Render a single product label to a canvas at the exact mm size (8 dots/mm,
  // 203 DPI thermal). Layout: name (top), price, barcode + code filling the rest.
  const renderInventoryLabelCanvas = (item: InventoryItem, widthMm: number, heightMm: number): HTMLCanvasElement => {
    const DPM = 8;
    const W = Math.max(80, Math.round(widthMm * DPM));
    const H = Math.max(80, Math.round(heightMm * DPM));
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    const pad = Math.max(4, Math.round(H * 0.05));
    const contentW = W - pad * 2;
    let y = pad;

    const fit = (text: string, fontPx: number, weight = "bold") => {
      ctx.font = `${weight} ${fontPx}px Arial, sans-serif`;
      let t = text;
      while (ctx.measureText(t).width > contentW && t.length > 3) t = t.slice(0, -2);
      if (t !== text) t = t.slice(0, -1) + "…";
      return t;
    };

    if (includeName && item.name) {
      const fs = Math.min(Math.round(H * 0.16), 34);
      ctx.textBaseline = "top";
      ctx.fillText(fit(item.name, fs), W / 2, y);
      y += fs + Math.round(H * 0.04);
    }
    const price = Number((item as any).unitPrice ?? (item as any).price ?? 0);
    if (includePrice && price > 0) {
      const fs = Math.min(Math.round(H * 0.14), 28);
      ctx.textBaseline = "top";
      ctx.fillText(fit(`R${price.toFixed(2)}`, fs, "bold"), W / 2, y);
      y += fs + Math.round(H * 0.03);
    }

    // Barcode fills the remaining vertical space
    const code = item.barcode || item.sku || "";
    if (code) {
      const tmp = document.createElement("canvas");
      try {
        JsBarcode(tmp, code, {
          format: "CODE128", displayValue: includeSKU, margin: 0,
          width: 2, height: Math.max(40, H - y - pad - (includeSKU ? Math.round(H * 0.14) : 0)),
          fontSize: Math.max(12, Math.round(H * 0.12)), font: "Arial",
        });
        // Scale the barcode to fit the label width (down-scaling keeps it scannable)
        const scale = Math.min(contentW / tmp.width, 1);
        const drawW = tmp.width * scale;
        const drawH = tmp.height * scale;
        ctx.drawImage(tmp, (W - drawW) / 2, Math.min(y, H - drawH - pad), drawW, drawH);
      } catch {
        ctx.font = `bold ${Math.round(H * 0.14)}px Arial`;
        ctx.textBaseline = "middle";
        ctx.fillText(fit(code, Math.round(H * 0.14)), W / 2, (y + H - pad) / 2);
      }
    }
    return canvas;
  };

  // Print product stickers directly to a USB thermal printer at the custom label
  // size set in Printer Settings. Printer identity is stored per-PC in localStorage
  // so each workstation can use its own printer. If no printer is saved on this PC,
  // the browser USB picker opens automatically.
  const handleThermalPrint = async () => {
    const selectedItemsList = items.filter(item => selectedItems.has(item.id));
    if (selectedItemsList.length === 0) { alert("Please select items to print"); return; }

    setThermalPrinting(true);
    try {
      const { isThermalPrintSupported, getLocalPrinter, setLocalPrinter, pickPrinter, printRasterImage } =
        await import("@/lib/thermalPrinterService");

      if (!isThermalPrintSupported()) {
        alert("Thermal printing needs Chrome or Edge on a desktop plugged into the printer.");
        return;
      }

      // Use this PC's saved printer; if none, open the USB picker now.
      let local = getLocalPrinter("inventory");
      if (!local) {
        local = await pickPrinter();
        setLocalPrinter("inventory", local);
      }

      const t = printerConfig?.thermal;
      const widthMm = t?.widthMm && t.widthMm >= 10 ? t.widthMm : 50;
      const heightMm = t?.heightMm && t.heightMm >= 10 ? t.heightMm : 30;
      const target = { vendorId: local.vendorId, productId: local.productId };

      for (const item of selectedItemsList) {
        const qty = itemQuantities[item.id] || 1;
        const canvas = renderInventoryLabelCanvas(item, widthMm, heightMm);
        await printRasterImage(target, canvas, qty, 2);
      }
      alert(`Sent ${selectedItemsList.length} product(s) to ${local.label} at ${widthMm}×${heightMm}mm.`);
    } catch (e: any) {
      if (e?.message) alert(e.message);
    } finally {
      setThermalPrinting(false);
    }
  };

  const handlePrint = () => {
    const template = predefinedTemplates[selectedTemplate];
    const selectedItemsList = items.filter(item => selectedItems.has(item.id));

    if (selectedItemsList.length === 0) {
      alert("Please select items to print");
      return;
    }

    // Generate all labels
    const allLabels: { item: InventoryItem; barcodeDataURL: string }[] = [];
    
    selectedItemsList.forEach(item => {
      const quantity = itemQuantities[item.id] || 1;
      const barcodeDataURL = generateBarcodeDataURL(item.barcode || item.sku);
      
      for (let i = 0; i < quantity; i++) {
        allLabels.push({ item, barcodeDataURL });
      }
    });

    // Create print content
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      const labelsPerRow = Math.floor(template.paperWidth / (template.labelWidth + template.gapX)) || 1;

      const labelStyle = `
        width: ${template.labelWidth}mm;
        height: ${template.labelHeight}mm;
        margin-right: ${template.gapX}mm;
        margin-bottom: ${template.gapY}mm;
        display: inline-block;
        box-sizing: border-box;
        border: 1px dashed #ddd;
        padding: 1mm;
        vertical-align: top;
        text-align: center;
        font-family: Arial, sans-serif;
        page-break-inside: avoid;
        overflow: hidden;
      `;

      const offset = startLabel - 1;
      const totalSlots = offset + allLabels.length;
      let content = '';
      for (let slot = 0; slot < totalSlots; slot++) {
        if (slot > 0 && slot % labelsPerRow === 0) {
          content += '<br style="clear: both;">';
        }
        if (slot < offset) {
          // blank spacer for used labels
          content += `<div style="${labelStyle} visibility: hidden; border: none;"></div>`;
        } else {
          const label = allLabels[slot - offset];
          content += `
            <div style="${labelStyle}">
              ${includeName ? `<div style="font-size: 6px; font-weight: bold; margin-bottom: 1mm; line-height: 1;">${label.item.name}</div>` : ''}
              ${label.barcodeDataURL ? `<img src="${label.barcodeDataURL}" style="max-width: 100%; max-height: ${template.labelHeight - 8}mm;" />` : ''}
              ${includeSKU ? `<div style="font-size: 5px; margin-top: 1mm;">${label.item.sku}</div>` : ''}
              ${includePrice ? `<div style="font-size: 5px;">$${label.item.unitPrice}</div>` : ''}
            </div>
          `;
        }
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Barcode Labels</title>
            <style>
              @media print {
                body { 
                  margin: ${template.marginTop}mm 0 0 ${template.marginLeft}mm !important;
                  padding: 0;
                  font-size: 0;
                  line-height: 0;
                }
                @page {
                  margin: 0;
                  size: ${template.paperWidth}mm ${template.paperHeight}mm;
                }
              }
            </style>
          </head>
          <body>
            ${content}
          </body>
        </html>
      `);
      printWindow.document.close();
      
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 250);
    }
  };

  // ─── Statistics ───────────────────────────────────────────────────────

  const selectedItemsList = items.filter(item => selectedItems.has(item.id));
  const totalLabels = Object.entries(itemQuantities)
    .filter(([itemId]) => selectedItems.has(itemId))
    .reduce((sum, [, quantity]) => sum + quantity, 0);
  const itemsWithoutBarcodes = selectedItemsList.filter(item => !item.barcode).length;

  if (loading) {
    return <div className="flex justify-center items-center h-48">Loading inventory...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Barcode Printing</h2>
          <p className="text-muted-foreground">
            Select inventory items and print barcode labels on A4 sheets
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowPreview(true)} disabled={selectedItems.size === 0}>
            <Eye className="h-4 w-4 mr-2" />
            Preview
          </Button>
          <Button onClick={handlePrint} disabled={selectedItems.size === 0}>
            <Printer className="h-4 w-4 mr-2" />
            Print Labels ({totalLabels})
          </Button>
          {thermalSupported && (
            <Button
              onClick={handleThermalPrint}
              disabled={selectedItems.size === 0 || thermalPrinting}
              className="bg-purple-600 hover:bg-purple-700"
              title="Print directly to USB thermal printer (will prompt to select if not yet connected on this PC)"
            >
              <Printer className="h-4 w-4 mr-2" />
              {thermalPrinting ? "Printing…" : `Print to thermal (${totalLabels})`}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Product Selection */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Select Items to Print</CardTitle>
              <div className="flex gap-2">
                <Input
                  placeholder="Search items by name, SKU, or barcode..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-1"
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={filteredItems.length > 0 && selectedItems.size === filteredItems.length}
                    onCheckedChange={handleSelectAll}
                  />
                  <Label>Select All ({filteredItems.length} items)</Label>
                </div>
                <p className="text-sm text-muted-foreground">
                  {selectedItems.size} selected, {totalLabels} labels
                </p>
              </div>

              <div className="border rounded-lg max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Select</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Barcode</TableHead>
                      <TableHead>Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedItems.has(item.id)}
                            onCheckedChange={(checked) => handleSelectItem(item.id, checked as boolean)}
                          />
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{item.name}</p>
                            <Badge variant="outline" className="text-xs">{item.category}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                        <TableCell>
                          {item.barcode ? (
                            <Badge variant="default">{item.barcode}</Badge>
                          ) : (
                            <Badge variant="destructive">No barcode</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {selectedItems.has(item.id) && (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => updateQuantity(item.id, -1)}
                                disabled={(itemQuantities[item.id] || 1) <= 1}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-8 text-center">{itemQuantities[item.id] || 1}</span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => updateQuantity(item.id, 1)}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Print Settings */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Print Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Label Template</Label>
                <Select value={selectedTemplate} onValueChange={(v) => { setSelectedTemplate(v); setStartLabel(1); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(predefinedTemplates).map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Start position picker */}
              <div>
                <Label className="text-sm">Start from label</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                  Click the first empty label on your sheet
                </p>
                {(() => {
                  const tmpl = predefinedTemplates[selectedTemplate];
                  const cols = Math.floor(tmpl.paperWidth / (tmpl.labelWidth + tmpl.gapX)) || 1;
                  return (
                    <div>
                      <div
                        className="inline-grid gap-px border rounded p-1.5 bg-muted/40"
                        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
                      >
                        {Array.from({ length: tmpl.labelsPerPage }, (_, i) => {
                          const pos = i + 1;
                          return (
                            <div
                              key={i}
                              onClick={() => setStartLabel(pos)}
                              title={`Start from label ${pos}`}
                              className={`rounded-sm cursor-pointer transition-colors ${
                                pos < startLabel
                                  ? "bg-slate-300"
                                  : pos === startLabel
                                  ? "bg-primary"
                                  : "bg-white hover:bg-blue-100 border border-gray-200"
                              }`}
                              style={{ width: 13, height: 7 }}
                            />
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {startLabel > 1
                          ? `Skipping ${startLabel - 1} used label${startLabel - 1 !== 1 ? "s" : ""} — starting at #${startLabel}`
                          : "Starting from label 1"}
                      </p>
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-2">
                <Label>Include on Labels</Label>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="includeName"
                      checked={includeName}
                      onCheckedChange={setIncludeName}
                    />
                    <Label htmlFor="includeName" className="text-sm">Product Name</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="includeSKU"
                      checked={includeSKU}
                      onCheckedChange={setIncludeSKU}
                    />
                    <Label htmlFor="includeSKU" className="text-sm">SKU</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="includePrice"
                      checked={includePrice}
                      onCheckedChange={setIncludePrice}
                    />
                    <Label htmlFor="includePrice" className="text-sm">Price</Label>
                  </div>
                </div>
              </div>

              {itemsWithoutBarcodes > 0 && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    ⚠️ {itemsWithoutBarcodes} selected items don't have barcodes. 
                    SKU will be used instead.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Summary */}
          {selectedItems.size > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Print Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Items selected:</span>
                    <span>{selectedItems.size}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total labels:</span>
                    <span>{totalLabels}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Template:</span>
                    <span>{predefinedTemplates[selectedTemplate].name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Pages needed:</span>
                    <span>{Math.ceil(totalLabels / predefinedTemplates[selectedTemplate].labelsPerPage)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Label Preview</DialogTitle>
            <DialogDescription>
              Preview of how your barcode labels will look when printed
            </DialogDescription>
          </DialogHeader>
          
          <div className="border rounded-lg p-4 bg-gray-50 max-h-96 overflow-auto">
            <div className="grid grid-cols-3 gap-2">
              {selectedItemsList.slice(0, 6).map((item) => (
                <div
                  key={item.id}
                  className="border bg-white p-2 text-center text-xs"
                  style={{
                    width: `${predefinedTemplates[selectedTemplate].labelWidth}px`,
                    height: `${predefinedTemplates[selectedTemplate].labelHeight}px`
                  }}
                >
                  {includeName && (
                    <div className="font-bold mb-1 text-xs truncate">{item.name}</div>
                  )}
                  {item.barcode && (
                    <img 
                      src={generateBarcodeDataURL(item.barcode)} 
                      alt={`Barcode for ${item.name}`}
                      className="w-full h-8 object-contain mb-1"
                    />
                  )}
                  {includeSKU && (
                    <div className="text-xs">{item.sku}</div>
                  )}
                  {includePrice && (
                    <div className="text-xs">${item.unitPrice}</div>
                  )}
                </div>
              ))}
              {selectedItemsList.length > 6 && (
                <div className="border bg-white p-2 text-center text-xs flex items-center justify-center">
                  +{selectedItemsList.length - 6} more items
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              Close Preview
            </Button>
            <Button onClick={() => { setShowPreview(false); handlePrint(); }}>
              Print Labels
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}