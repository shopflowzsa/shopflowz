/**
 * OCR Scanner Component
 * Scan invoices and automatically update inventory stock levels
 */

import { useState, useEffect } from "react";
import { 
  Camera, 
  Upload, 
  Eye, 
  Trash2, 
  CheckCircle,
  AlertTriangle,
  FileText,
  Sparkles,
  Download,
  RefreshCw
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { getInventoryItems, updateInventoryItem, type InventoryItem } from "@/lib/inventoryEcommerceSync";

// ─── Types ───────────────────────────────────────────────────────────────

interface OCRLineItem {
  id: string;
  description: string;
  quantity: number;
  price?: number;
  sku?: string;
  partNumber?: string;
  status: 'matched' | 'unmatched' | 'manual';
  matchedItemId?: string;
  matchedItem?: InventoryItem;
  confidence?: number;
  rawText?: string;
}

interface InvoiceMetadata {
  invoiceNumber?: string;
  date?: string;
  supplier?: string;
  total?: number;
}

interface OCRResult {
  items: OCRLineItem[];
  metadata: InvoiceMetadata;
  rawText: string;
}

export default function OCRScanner() {
  const { workspaceId } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [extractedItems, setExtractedItems] = useState<OCRLineItem[]>([]);
  const [invoiceMetadata, setInvoiceMetadata] = useState<InvoiceMetadata | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // ─── Load Inventory Data ──────────────────────────────────────────────

  useEffect(() => {
    loadInventoryData();
  }, [workspaceId]);

  const loadInventoryData = async () => {
    if (!workspaceId) return;
    
    setLoading(true);
    try {
      const inventoryItems = await getInventoryItems(workspaceId);
      setItems(inventoryItems);
    } catch (error) {
      console.error("Error loading inventory:", error);
      setErrorMessage("Failed to load inventory items");
    } finally {
      setLoading(false);
    }
  };

  // ─── Image Handling ───────────────────────────────────────────────────

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select an image file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('Image file is too large. Please select a file smaller than 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setUploadedImage(result);
      setExtractedItems([]);
      setInvoiceMetadata(null);
      setErrorMessage('');
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setUploadedImage(result);
        setExtractedItems([]);
        setInvoiceMetadata(null);
        setErrorMessage('');
      };
      reader.readAsDataURL(file);
    }
  };

  // ─── OCR Processing ────────────────────────────────────────────────────

  const processImage = async () => {
    if (!uploadedImage) return;

    setProcessing(true);
    setErrorMessage('');

    try {
      // Simulate OCR processing (replace with actual AI/OCR service)
      await simulateOCRProcessing();
    } catch (error) {
      console.error('OCR processing error:', error);
      setErrorMessage('Failed to process image. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const simulateOCRProcessing = async (): Promise<void> => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Mock OCR result
    const mockItems: OCRLineItem[] = [
      {
        id: '1',
        description: 'iPhone 12 Screen Assembly',
        quantity: 5,
        price: 120.00,
        sku: 'IP12-SCR-001',
        status: 'matched',
        confidence: 0.95,
        rawText: 'iPhone 12 Screen Assembly x5 @$120.00'
      },
      {
        id: '2', 
        description: 'Samsung S21 Battery',
        quantity: 3,
        price: 85.00,
        partNumber: 'SAM-BAT-S21',
        status: 'matched',
        confidence: 0.88,
        rawText: 'Samsung S21 Battery x3 @$85.00'
      },
      {
        id: '3',
        description: 'iPad Air 4 Charging Port',
        quantity: 2,
        price: 45.00,
        status: 'unmatched',
        confidence: 0.72,
        rawText: 'iPad Air 4 Charging Port x2 @$45.00'
      }
    ];

    // Match items with inventory
    const updatedItems = mockItems.map(ocrItem => {
      const matchedItem = findMatchingInventoryItem(ocrItem);
      return {
        ...ocrItem,
        matchedItemId: matchedItem?.id,
        matchedItem,
        status: matchedItem ? 'matched' : 'unmatched'
      } as OCRLineItem;
    });

    setExtractedItems(updatedItems);
    setInvoiceMetadata({
      invoiceNumber: 'INV-2024-001',
      date: new Date().toISOString().split('T')[0],
      supplier: 'TechParts Qatar',
      total: 575.00
    });
  };

  const findMatchingInventoryItem = (ocrItem: OCRLineItem): InventoryItem | undefined => {
    // Search by SKU first
    if (ocrItem.sku) {
      const bySku = items.find(item => 
        item.sku.toLowerCase() === ocrItem.sku?.toLowerCase()
      );
      if (bySku) return bySku;
    }

    // Search by supplier stock code
    if (ocrItem.partNumber) {
      const byPartNumber = items.find(item => 
        item.supplierStockCode?.toLowerCase() === ocrItem.partNumber?.toLowerCase()
      );
      if (byPartNumber) return byPartNumber;
    }

    // Search by name similarity
    const byName = items.find(item => {
      const itemName = item.name.toLowerCase();
      const ocrName = ocrItem.description.toLowerCase();
      
      // Simple keyword matching
      const itemKeywords = itemName.split(/\s+/);
      const ocrKeywords = ocrName.split(/\s+/);
      
      const matchingKeywords = itemKeywords.filter(keyword => 
        ocrKeywords.some(ocrKeyword => 
          ocrKeyword.includes(keyword) || keyword.includes(ocrKeyword)
        )
      );
      
      return matchingKeywords.length >= 2;
    });

    return byName;
  };

  // ─── Item Management ───────────────────────────────────────────────────

  const updateItemProperty = (itemId: string, property: string, value: any) => {
    setExtractedItems(prev => 
      prev.map(item => 
        item.id === itemId 
          ? { ...item, [property]: value }
          : item
      )
    );
  };

  const manuallyMatchItem = (itemId: string, inventoryItemId: string) => {
    const inventoryItem = items.find(item => item.id === inventoryItemId);
    setExtractedItems(prev => 
      prev.map(item => 
        item.id === itemId 
          ? { 
              ...item, 
              matchedItemId: inventoryItemId,
              matchedItem: inventoryItem,
              status: 'matched'
            }
          : item
      )
    );
  };

  const removeItem = (itemId: string) => {
    setExtractedItems(prev => prev.filter(item => item.id !== itemId));
  };

  // ─── Apply Updates ─────────────────────────────────────────────────────

  const applyUpdates = async () => {
    if (!workspaceId) return;

    const matchedItems = extractedItems.filter(item => item.status === 'matched' && item.matchedItem);
    
    if (matchedItems.length === 0) {
      setErrorMessage('No matched items to update');
      return;
    }

    setProcessing(true);
    try {
      let successCount = 0;
      let errorCount = 0;

      for (const ocrItem of matchedItems) {
        if (!ocrItem.matchedItem) continue;

        try {
          const newStock = ocrItem.matchedItem.currentStock + ocrItem.quantity;
          await updateInventoryItem(workspaceId, ocrItem.matchedItem.id, {
            currentStock: newStock,
            unitCost: ocrItem.price || ocrItem.matchedItem.unitCost,
            lastRestocked: new Date().toISOString()
          });
          successCount++;
        } catch (error) {
          console.error(`Error updating ${ocrItem.matchedItem.name}:`, error);
          errorCount++;
        }
      }

      setSuccessMessage(
        `Successfully updated ${successCount} items` + 
        (errorCount > 0 ? `. ${errorCount} failed.` : '')
      );
      
      // Reset state
      setExtractedItems([]);
      setUploadedImage(null);
      setShowConfirmDialog(false);
      
      // Reload inventory
      await loadInventoryData();
      
    } catch (error) {
      console.error('Error applying updates:', error);
      setErrorMessage('Failed to apply updates. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  // ─── Reset Scanner ────────────────────────────────────────────────────

  const resetScanner = () => {
    setUploadedImage(null);
    setExtractedItems([]);
    setInvoiceMetadata(null);
    setProcessing(false);
    setErrorMessage('');
    setSuccessMessage('');
  };

  // ─── Statistics ───────────────────────────────────────────────────────

  const matchedCount = extractedItems.filter(item => item.status === 'matched').length;
  const unmatchedCount = extractedItems.filter(item => item.status === 'unmatched').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">OCR Stock Scanner</h2>
          <p className="text-muted-foreground">
            Scan supplier invoices to automatically update inventory stock levels
          </p>
        </div>
        {(uploadedImage || extractedItems.length > 0) && (
          <Button variant="outline" onClick={resetScanner}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Start Over
          </Button>
        )}
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}
      {errorMessage && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {/* How it works */}
      {!uploadedImage && (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <Upload className="h-6 w-6 text-blue-600" />
                </div>
                <h3 className="font-semibold mb-2">1. Upload Invoice</h3>
                <p className="text-sm text-muted-foreground">
                  Take a clear photo or upload an image of your supplier invoice
                </p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <Sparkles className="h-6 w-6 text-green-600" />
                </div>
                <h3 className="font-semibold mb-2">2. AI Processing</h3>
                <p className="text-sm text-muted-foreground">
                  AI extracts product details and matches them with your inventory
                </p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <CheckCircle className="h-6 w-6 text-purple-600" />
                </div>
                <h3 className="font-semibold mb-2">3. Update Stock</h3>
                <p className="text-sm text-muted-foreground">
                  Review matches and apply quantity/price updates in bulk
                </p>
              </div>
            </div>
            <Alert className="mt-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Tip:</strong> For best results, ensure your product SKUs or Supplier Stock Codes match those on the invoice.
                The system will automatically match products based on SKU, supplier codes, or product names.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      {/* Upload Section */}
      {!uploadedImage && (
        <Card>
          <CardContent className="pt-6">
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 cursor-pointer"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <Camera className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Upload Invoice Image</h3>
              <p className="text-gray-600 mb-4">
                Drag and drop your invoice image here, or click to select
              </p>
              <Button variant="outline">
                <Upload className="h-4 w-4 mr-2" />
                Choose File
              </Button>
              <input
                id="file-input"
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
              />
              <p className="text-xs text-gray-500 mt-2">
                Supports JPG, PNG, WebP (max 10MB)
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Uploaded Image Preview */}
      {uploadedImage && (
        <Card>
          <CardHeader>
            <CardTitle>Uploaded Invoice</CardTitle>
            <div className="flex gap-2">
              <Button onClick={processImage} disabled={processing}>
                {processing ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                {processing ? 'Processing...' : 'Process with AI'}
              </Button>
              <Button variant="outline" onClick={() => setShowImageDialog(true)}>
                <Eye className="h-4 w-4 mr-2" />
                View Full Image
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <img
              src={uploadedImage}
              alt="Uploaded invoice"
              className="max-h-48 mx-auto rounded-lg border"
            />
          </CardContent>
        </Card>
      )}

      {/* Extracted Items */}
      {extractedItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Extracted Items</CardTitle>
            <div className="flex justify-between">
              <div className="flex gap-4">
                <Badge variant="default">{matchedCount} Matched</Badge>
                <Badge variant="secondary">{unmatchedCount} Unmatched</Badge>
              </div>
              <Button 
                onClick={() => setShowConfirmDialog(true)}
                disabled={matchedCount === 0}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Apply Updates ({matchedCount})
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {extractedItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{item.description}</p>
                        {item.sku && <p className="text-sm text-muted-foreground">SKU: {item.sku}</p>}
                        {item.partNumber && <p className="text-sm text-muted-foreground">Part: {item.partNumber}</p>}
                      </div>
                    </TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>${item.price?.toFixed(2) || 'N/A'}</TableCell>
                    <TableCell>
                      <Badge variant={item.status === 'matched' ? 'default' : 'secondary'}>
                        {item.status === 'matched' ? 'Matched' : 'Unmatched'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.status === 'matched' && item.matchedItem ? (
                        <div>
                          <p className="font-medium">{item.matchedItem.name}</p>
                          <p className="text-sm text-muted-foreground">{item.matchedItem.sku}</p>
                        </div>
                      ) : (
                        <Select
                          value={item.matchedItemId || ''}
                          onValueChange={(value) => manuallyMatchItem(item.id, value)}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue placeholder="Select inventory item" />
                          </SelectTrigger>
                          <SelectContent>
                            {items.map((inventoryItem) => (
                              <SelectItem key={inventoryItem.id} value={inventoryItem.id}>
                                {inventoryItem.name} ({inventoryItem.sku})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Confirm Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Stock Updates</DialogTitle>
            <DialogDescription>
              You are about to update {matchedCount} product(s). This will add quantities to your inventory.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-2">
            <h4 className="font-medium">Summary of Changes:</h4>
            {extractedItems
              .filter(item => item.status === 'matched' && item.matchedItem)
              .map(item => (
                <div key={item.id} className="text-sm p-2 bg-gray-50 rounded">
                  <strong>{item.matchedItem!.name}</strong>: +{item.quantity} units
                  {item.price && ` @ $${item.price.toFixed(2)}`}
                </div>
              ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button onClick={applyUpdates} disabled={processing}>
              {processing ? 'Updating...' : 'Apply Updates'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image View Dialog */}
      <Dialog open={showImageDialog} onOpenChange={setShowImageDialog}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Invoice Image</DialogTitle>
          </DialogHeader>
          {uploadedImage && (
            <img
              src={uploadedImage}
              alt="Full invoice"
              className="max-h-96 w-auto mx-auto rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}