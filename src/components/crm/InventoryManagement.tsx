/**
 * Enhanced Inventory Management Component
 * Complete inventory management with barcode support, stock tracking, and alerts
 */

import { useState, useEffect } from "react";
import { 
  Package, 
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  AlertTriangle, 
  TrendingDown,
  TrendingUp,
  BarChart3,
  FileText,
  Download,
  Upload,
  QrCode,
  Camera,
  Eye,
  Settings,
  Bell,
  History,
  Activity
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { 
  getInventoryItems, 
  createInventoryItem, 
  updateInventoryItem,
  updateInventoryStock,
  getStockMovements,
  getInventoryStats,
  generateBarcodesForAllItems,
  searchInventoryItems,
  getInventoryCategories,
  createInventoryCategory,
  deleteInventoryCategory,
  bulkImportInventoryItems,
  type InventoryItem,
  type StockMovement,
  type InventoryCategory
} from "@/lib/inventoryEcommerceSync";
import { generateBarcode, getBarcodeInfo } from "@/lib/barcodeService";
import { uploadInventoryImage } from "@/lib/imageUploadService";
import BarcodePrinting from "./BarcodePrinting";
import OCRScanner from "./OCRScanner";

// ─── Additional Types ─────────────────────────────────────────────────────

interface StockTransaction {
  id: string;
  itemId: string;
  itemName: string;
  type: 'in' | 'out' | 'adjustment';
  quantity: number;
  reason: string;
  reference?: string; // Job number, supplier invoice, etc.
  cost?: number;
  performedBy: string;
  timestamp: string;
  notes?: string;
}

// ─── Main Inventory Component ───────────────────────────────────────────

export function InventoryManagement() {
  const { workspaceId } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showStockDialog, setShowStockDialog] = useState<InventoryItem | null>(null);
  const [showBarcodesDialog, setShowBarcodesDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [stats, setStats] = useState<any>({});
  const [activeTab, setActiveTab] = useState("inventory");
  const [firestoreCategories, setFirestoreCategories] = useState<InventoryCategory[]>([]);
  const [showCategoriesDialog, setShowCategoriesDialog] = useState(false);
  const [showCSVImportDialog, setShowCSVImportDialog] = useState(false);

  // ─── Load Data ────────────────────────────────────────────────────────

  useEffect(() => {
    if (workspaceId) {
      loadInventoryData();
      loadCategories();
    }
  }, [workspaceId]);

  const loadCategories = async () => {
    if (!workspaceId) return;
    try {
      const cats = await getInventoryCategories(workspaceId);
      setFirestoreCategories(cats);
    } catch (error) {
      console.error("Error loading categories:", error);
    }
  };

  const loadInventoryData = async () => {
    if (!workspaceId) return;
    
    setLoading(true);
    try {
      const inventoryItems = await getInventoryItems(workspaceId);
      setItems(inventoryItems);
      
      // If no items exist, create some sample items
      if (inventoryItems.length === 0) {
        await createSampleInventory();
      }
    } catch (error) {
      console.error("Error loading inventory:", error);
    } finally {
      setLoading(false);
    }
  };

  const createSampleInventory = async () => {
    if (!workspaceId) return;

    const sampleItems = [
      {
        name: "iPhone Screen - iPhone 12",
        description: "Original quality LCD screen for iPhone 12",
        category: "Screens",
        sku: "IP12-SCR-001",
        currentStock: 15,
        minStock: 5,
        maxStock: 50,
        unitCost: 120,
        unitPrice: 200,
        supplier: "TechParts Qatar",
        location: "Shelf A1",
        status: "active" as const,
        syncToEcommerce: true,
        isPublic: true
      },
      {
        name: "Samsung Battery - S21",
        description: "OEM battery replacement for Samsung Galaxy S21",
        category: "Batteries",
        sku: "SAM-BAT-S21",
        currentStock: 3,
        minStock: 10,
        unitCost: 85,
        unitPrice: 150,
        supplier: "Samsung Parts",
        location: "Shelf B2",
        status: "active" as const,
        syncToEcommerce: true,
        isPublic: true
      },
      {
        name: "iPad Charging Port",
        description: "Charging port assembly for iPad Air 4th Gen",
        category: "Components",
        sku: "IPD-CHG-AIR4",
        currentStock: 8,
        minStock: 3,
        unitCost: 45,
        unitPrice: 85,
        supplier: "Apple Authorized",
        location: "Shelf C1",
        status: "active" as const,
        syncToEcommerce: false,
        isPublic: false
      }
    ];

    try {
      for (const item of sampleItems) {
        await createInventoryItem(workspaceId, item, item.syncToEcommerce);
      }
      // Reload the inventory after creating samples
      const inventoryItems = await getInventoryItems(workspaceId);
      setItems(inventoryItems);
    } catch (error) {
      console.error("Error creating sample inventory:", error);
    }
  };

  const categoryNames = firestoreCategories.length > 0
    ? firestoreCategories.map(c => c.name)
    : [...new Set(items.map(item => item.category).filter(Boolean))];
  // alias for legacy usage in stats card
  const categories = categoryNames;
  
  const filteredItems = items.filter(item => {
    const matchesSearch = 
      (item.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.sku || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const lowStockItems = items.filter(item => item.currentStock <= item.minStock);
  const totalValue = items.reduce((sum, item) => sum + (item.currentStock * item.unitCost), 0);

  const getStockStatus = (item: InventoryItem) => {
    if (item.currentStock === 0) {
      return { label: "Out of Stock", variant: "destructive" as const };
    } else if (item.currentStock <= item.minStock) {
      return { label: "Low Stock", variant: "destructive" as const };
    } else if (item.currentStock <= item.minStock * 2) {
      return { label: "Running Low", variant: "secondary" as const };
    }
    return { label: "In Stock", variant: "default" as const };
  };

  if (loading) {
    return <InventorySkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Inventory Management</h2>
          <p className="text-muted-foreground">
            Track and manage your repair parts and stock levels
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowCategoriesDialog(true)}>
            <FileText className="h-4 w-4 mr-2" />
            Manage Categories
          </Button>
          <Button variant="outline" onClick={() => setShowCSVImportDialog(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{items.length}</div>
            <p className="text-xs text-muted-foreground">
              Active inventory items
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalValue.toFixed(0)} QAR</div>
            <p className="text-xs text-muted-foreground">
              Current stock value
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{lowStockItems.length}</div>
            <p className="text-xs text-muted-foreground">
              Items need restocking
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Categories</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{categories.length}</div>
            <p className="text-xs text-muted-foreground">
              Product categories
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              <CardTitle className="text-orange-800">Low Stock Alert</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lowStockItems.slice(0, 3).map(item => (
                <div key={item.id} className="flex justify-between items-center text-sm">
                  <span>{item.name} ({item.sku})</span>
                  <Badge variant="destructive">
                    {item.currentStock} left (min: {item.minStock})
                  </Badge>
                </div>
              ))}
              {lowStockItems.length > 3 && (
                <p className="text-xs text-muted-foreground">
                  +{lowStockItems.length - 3} more items need restocking
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search items by name, SKU, or description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full"
              />
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categoryNames.map(category => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Inventory Table */}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Unit Cost</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="h-8 w-8 text-muted-foreground" />
                      <p className="text-muted-foreground">
                        {searchTerm || selectedCategory !== "all" 
                          ? "No items found matching your criteria"
                          : "No inventory items yet. Add your first item to get started."
                        }
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredItems.map(item => {
                  const status = getStockStatus(item);
                  const itemValue = item.currentStock * item.unitCost;
                  
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {item.imageUrl ? (
                            <img 
                              src={item.imageUrl} 
                              alt={item.name} 
                              className="h-12 w-12 object-cover rounded border"
                            />
                          ) : (
                            <div className="h-12 w-12 bg-gray-100 rounded border flex items-center justify-center">
                              <Package className="h-6 w-6 text-gray-400" />
                            </div>
                          )}
                          <div>
                            <p className="font-medium">{item.name}</p>
                            {item.description && (
                              <p className="text-sm text-muted-foreground line-clamp-1">{item.description}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-center">
                          <p className="font-medium">{item.currentStock}</p>
                          <p className="text-xs text-muted-foreground">min: {item.minStock}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant={status.variant}>{status.label}</Badge>
                          {item.syncToEcommerce && (
                            <div className="flex gap-1">
                              <Badge variant="secondary" className="text-xs">
                                🛒 Store
                              </Badge>
                              {item.isPublic && (
                                <Badge variant="outline" className="text-xs">
                                  👀 Public
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{item.unitCost} QAR</TableCell>
                      <TableCell className="font-medium">{itemValue.toFixed(0)} QAR</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowStockDialog(item)}
                          >
                            <TrendingUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedItem(item)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <CreateItemDialog 
        open={showCreateDialog} 
        onOpenChange={setShowCreateDialog}
        categories={categoryNames}
        onSuccess={() => {
          setShowCreateDialog(false);
          loadInventoryData();
        }}
      />

      <ManageCategoriesDialog
        open={showCategoriesDialog}
        onOpenChange={setShowCategoriesDialog}
        categories={firestoreCategories}
        onChanged={loadCategories}
      />

      <CSVImportDialog
        open={showCSVImportDialog}
        onOpenChange={setShowCSVImportDialog}
        categories={categoryNames}
        onSuccess={() => {
          setShowCSVImportDialog(false);
          loadInventoryData();
        }}
      />

      {showStockDialog && (
        <StockAdjustmentDialog
          item={showStockDialog}
          open={true}
          onOpenChange={() => setShowStockDialog(null)}
          onSuccess={() => {
            setShowStockDialog(null);
            loadInventoryData();
          }}
        />
      )}
    </div>
  );
}

// ─── Create Item Dialog ─────────────────────────────────────────────────

function CreateItemDialog({ 
  open, 
  onOpenChange, 
  onSuccess,
  categories = []
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  categories?: string[];
}) {
  const { workspaceId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "",
    sku: "",
    minStock: "5",
    currentStock: "0",
    unitCost: "",
    unitPrice: "",
    supplier: "",
    location: "",
    syncToEcommerce: true,
    isPublic: true
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!workspaceId) return;
    
    setLoading(true);
    try {
      const itemData: any = {
        name: formData.name,
        description: formData.description || undefined,
        category: formData.category,
        sku: formData.sku,
        currentStock: parseInt(formData.currentStock) || 0,
        minStock: parseInt(formData.minStock) || 5,
        unitCost: parseFloat(formData.unitCost) || 0,
        unitPrice: parseFloat(formData.unitPrice) || 0,
        supplier: formData.supplier || undefined,
        location: formData.location || undefined,
        status: (parseFloat(formData.unitPrice) || 0) > 0 ? "active" as const : "inactive" as const,
        syncToEcommerce: formData.syncToEcommerce,
        isPublic: formData.isPublic
      };

      const itemId = await createInventoryItem(workspaceId, itemData, formData.syncToEcommerce);
      
      // Upload image if provided
      if (imageFile && itemId) {
        const imageUrl = await uploadInventoryImage(workspaceId, itemId, imageFile);
        await updateInventoryItem(workspaceId, itemId, { imageUrl });
      }
      
      // Reset form and close
      setFormData({
        name: "",
        description: "",
        category: "",
        sku: "",
        minStock: "5",
        currentStock: "0",
        unitCost: "",
        unitPrice: "",
        supplier: "",
        location: "",
        syncToEcommerce: true,
        isPublic: true
      });
      setImageFile(null);
      setImagePreview("");
      
      onSuccess();
    } catch (error) {
      console.error("Error creating inventory item:", error);
      alert(error instanceof Error ? error.message : "Failed to create item. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add New Inventory Item</DialogTitle>
          <DialogDescription>
            Create a new item to track in your inventory
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">Item Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="sku">SKU *</Label>
              <Input
                id="sku"
                value={formData.sku}
                onChange={(e) => setFormData(prev => ({ ...prev, sku: e.target.value }))}
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={2}
            />
          </div>

          <div>
            <Label htmlFor="image">Product Image</Label>
            <Input
              id="image"
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="cursor-pointer"
            />
            {imagePreview && (
              <div className="mt-2">
                <img src={imagePreview} alt="Preview" className="h-32 w-32 object-cover rounded border" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="category">Category</Label>
              {categories.length > 0 ? (
                <Select
                  value={formData.category}
                  onValueChange={(val) => setFormData(prev => ({ ...prev, category: val === "__other__" ? "" : val }))}
                >
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                    <SelectItem value="__other__">Other (type below)</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
              {(categories.length === 0 || formData.category === "") && (
                <Input
                  id="category-custom"
                  value={formData.category}
                  onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                  placeholder="e.g. Screens, Batteries, Components"
                  className={categories.length > 0 ? "mt-2" : ""}
                />
              )}
            </div>
            <div>
              <Label htmlFor="currentStock">Current Stock</Label>
              <Input
                id="currentStock"
                type="number"
                value={formData.currentStock}
                onChange={(e) => setFormData(prev => ({ ...prev, currentStock: e.target.value }))}
                min="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="minStock">Minimum Stock Level</Label>
              <Input
                id="minStock"
                type="number"
                value={formData.minStock}
                onChange={(e) => setFormData(prev => ({ ...prev, minStock: e.target.value }))}
                min="0"
              />
            </div>
            <div>
              <Label htmlFor="unitCost">Unit Cost (QAR)</Label>
              <Input
                id="unitCost"
                type="number"
                step="0.01"
                value={formData.unitCost}
                onChange={(e) => setFormData(prev => ({ ...prev, unitCost: e.target.value }))}
                min="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="unitPrice">Unit Price (QAR)</Label>
              <Input
                id="unitPrice"
                type="number"
                step="0.01"
                value={formData.unitPrice}
                onChange={(e) => setFormData(prev => ({ ...prev, unitPrice: e.target.value }))}
                min="0"
              />
            </div>
            <div>
              <Label htmlFor="supplier">Supplier</Label>
              <Input
                id="supplier"
                value={formData.supplier}
                onChange={(e) => setFormData(prev => ({ ...prev, supplier: e.target.value }))}
                placeholder="Supplier name"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="location">Storage Location</Label>
              <Input
                id="location"
                value={formData.location}
                onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                placeholder="e.g. Shelf A1"
              />
            </div>
            <div className="flex items-center space-x-2 pt-6">
              <input
                type="checkbox"
                id="syncToEcommerce"
                checked={formData.syncToEcommerce}
                onChange={(e) => setFormData(prev => ({ 
                  ...prev, 
                  syncToEcommerce: e.target.checked,
                  isPublic: e.target.checked ? prev.isPublic : false
                }))}
                className="rounded border-gray-300"
              />
              <Label htmlFor="syncToEcommerce" className="text-sm">
                Sync to ecommerce store
              </Label>
            </div>
          </div>

          {formData.syncToEcommerce && (
            <div className="flex items-center space-x-2 pl-6">
              <input
                type="checkbox"
                id="isPublic"
                checked={formData.isPublic}
                onChange={(e) => setFormData(prev => ({ ...prev, isPublic: e.target.checked }))}
                className="rounded border-gray-300"
              />
              <Label htmlFor="isPublic" className="text-sm text-gray-600">
                Show in public store (customers can purchase)
              </Label>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── CSV Import Dialog ──────────────────────────────────────────────────

function CSVImportDialog({
  open,
  onOpenChange,
  categories,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: string[];
  onSuccess: () => void;
}) {
  const { workspaceId } = useAuth();
  const [csvFile, setCSVFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<any[]>([]);
  const [syncToEcommerce, setSyncToEcommerce] = useState(true);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'text/csv') {
      setCSVFile(file);
      parseCSVPreview(file);
    } else {
      alert('Please select a valid CSV file');
    }
  };

  const parseCSVPreview = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = lines.slice(1, 6).map(line => {
        const values = line.split(',').map(v => v.trim());
        return headers.reduce((obj, header, idx) => {
          obj[header] = values[idx] || '';
          return obj;
        }, {} as any);
      });
      setPreview(rows);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!csvFile || !workspaceId) return;

    setImporting(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const text = e.target?.result as string;
        const lines = text.split('\\n').filter(line => line.trim());
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        
        // Limit to 1000 items
        const dataLines = lines.slice(1, 1001);
        
        const items = dataLines.map(line => {
          const values = line.split(',').map(v => v.trim());
          const row: any = {};
          headers.forEach((header, idx) => {
            row[header] = values[idx] || '';
          });

          return {
            name: row.name || row.product || row.item || 'Unnamed Item',
            description: row.description || row.desc || '',
            category: row.category || 'Uncategorized',
            sku: row.sku || row.code || `SKU${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
            currentStock: parseInt(row.stock || row.quantity || row.currentstock || '0') || 0,
            minStock: parseInt(row.minstock || row.reorderlevel || '5') || 5,
            unitCost: parseFloat(row.cost || row.unitcost || row.price || '0') || 0,
            unitPrice: parseFloat(row.price || row.unitprice || row.saleprice || '0') || 0,
            supplier: row.supplier || row.vendor || undefined,
            location: row.location || row.shelf || undefined,
            imageUrl: row.imageurl || row.image || undefined,
            status: 'active' as const,
            syncToEcommerce,
            isPublic: syncToEcommerce,
          };
        });

        const result = await bulkImportInventoryItems(workspaceId, items, syncToEcommerce);
        
        alert(`Import complete!\\n✓ ${result.success} items imported\\n✗ ${result.failed} failed${result.errors.length > 0 ? '\\n\\nErrors:\\n' + result.errors.slice(0, 5).join('\\n') : ''}`);
        
        if (result.success > 0) {
          onSuccess();
        }
      };
      reader.readAsText(csvFile);
    } catch (error) {
      console.error('Import error:', error);
      alert('Failed to import CSV. Please check the format and try again.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Products from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file with up to 1,000 products. Required columns: name, sku, category
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="csv-file">CSV File</Label>
            <Input
              id="csv-file"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="cursor-pointer"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Columns: name, sku, description, category, stock, minstock, cost, price, supplier, location, imageurl
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="sync-csv"
              checked={syncToEcommerce}
              onChange={(e) => setSyncToEcommerce(e.target.checked)}
              className="rounded border-gray-300"
            />
            <Label htmlFor="sync-csv" className="text-sm">
              Sync all items to ecommerce store
            </Label>
          </div>

          {preview.length > 0 && (
            <div>
              <h4 className="font-medium mb-2">Preview (first 5 rows):</h4>
              <div className="border rounded overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {Object.keys(preview[0]).slice(0, 6).map(key => (
                        <th key={key} className="px-2 py-1 text-left border-b">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, idx) => (
                      <tr key={idx} className="border-b">
                        {Object.values(row).slice(0, 6).map((val: any, i) => (
                          <td key={i} className="px-2 py-1">{val}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!csvFile || importing}
          >
            {importing ? 'Importing...' : 'Import Products'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Manage Categories Dialog ──────────────────────────────────────────

function ManageCategoriesDialog({
  open,
  onOpenChange,
  categories,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: InventoryCategory[];
  onChanged: () => void;
}) {
  const { workspaceId } = useAuth();
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !newName.trim()) return;
    setSaving(true);
    try {
      await createInventoryCategory(workspaceId, newName.trim(), newDesc.trim() || undefined);
      setNewName("");
      setNewDesc("");
      onChanged();
    } catch (err) {
      console.error("Error creating category:", err);
      alert("Failed to create category.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!workspaceId) return;
    if (!confirm("Delete this category? Existing items will keep the category name.")) return;
    setDeletingId(id);
    try {
      await deleteInventoryCategory(workspaceId, id);
      onChanged();
    } catch (err) {
      console.error("Error deleting category:", err);
      alert("Failed to delete category.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Inventory Categories</DialogTitle>
          <DialogDescription>
            Add or remove categories used to organise your inventory items.
          </DialogDescription>
        </DialogHeader>

        {/* Existing categories */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No categories yet. Add one below.
            </p>
          ) : (
            categories.map(cat => (
              <div key={cat.id} className="flex items-center justify-between p-2 rounded border">
                <div>
                  <p className="font-medium text-sm">{cat.name}</p>
                  {cat.description && (
                    <p className="text-xs text-muted-foreground">{cat.description}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deletingId === cat.id}
                  onClick={() => handleDelete(cat.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Add new category */}
        <form onSubmit={handleAdd} className="space-y-3 border-t pt-4">
          <div>
            <Label htmlFor="cat-name">New Category Name *</Label>
            <Input
              id="cat-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Speaker Drivers"
              required
            />
          </div>
          <div>
            <Label htmlFor="cat-desc">Description (optional)</Label>
            <Input
              id="cat-desc"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Short description"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
            <Button type="submit" disabled={saving || !newName.trim()}>
              {saving ? "Adding..." : "Add Category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Stock Adjustment Dialog ────────────────────────────────────────────

function StockAdjustmentDialog({ 
  item,
  open, 
  onOpenChange, 
  onSuccess 
}: {
  item: InventoryItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { workspaceId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    type: "adjustment" as "in" | "out" | "adjustment",
    newStock: item.currentStock.toString(),
    reason: "",
    reference: "",
    notes: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!workspaceId) return;
    
    setLoading(true);
    try {
      const newStockLevel = parseInt(formData.newStock) || 0;
      await updateInventoryStock(
        workspaceId, 
        item.id, 
        newStockLevel, 
        formData.reason || "Manual adjustment"
      );
      
      onSuccess();
    } catch (error) {
      console.error("Error updating stock:", error);
      alert("Failed to update stock. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const newStockLevel = parseInt(formData.newStock) || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust Stock - {item.name}</DialogTitle>
          <DialogDescription>
            Current stock: {item.currentStock} units (SKU: {item.sku})
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="newStock">New Stock Level</Label>
            <Input
              id="newStock"
              type="number"
              value={formData.newStock}
              onChange={(e) => setFormData(prev => ({ ...prev, newStock: e.target.value }))}
              min="0"
              required
            />
            {formData.newStock && (
              <p className="text-sm text-muted-foreground mt-1">
                Stock change: {newStockLevel - item.currentStock > 0 ? '+' : ''}{newStockLevel - item.currentStock} units
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="reason">Reason</Label>
            <Input
              id="reason"
              value={formData.reason}
              onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
              placeholder="e.g. Supplier delivery, Used for repair, Stock count correction"
              required
            />
          </div>

          <div>
            <Label htmlFor="reference">Reference (Optional)</Label>
            <Input
              id="reference"
              value={formData.reference}
              onChange={(e) => setFormData(prev => ({ ...prev, reference: e.target.value }))}
              placeholder="e.g. Job number, Invoice number"
            />
          </div>

          <div>
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Updating..." : "Update Stock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Loading Skeleton ───────────────────────────────────────────────────

function InventorySkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i}>
            <CardHeader className="space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16 mb-1" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Skeleton className="h-96" />
    </div>
  );
}

export default InventoryManagement;
