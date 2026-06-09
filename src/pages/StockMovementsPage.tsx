import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  getStockMovements,
  adjustStock,
  getLowStockItems,
  cancelStockMovement,
} from "@/lib/stockMovementService";
import { inventoryService } from "@/lib/inventoryService";
import { StockMovement } from "@/types/stockMovement";
import {
  ArrowUpCircle,
  ArrowDownCircle,
  Plus,
  Minus,
  AlertTriangle,
  Package,
  TrendingUp,
  TrendingDown,
  Search,
  X,
} from "lucide-react";

export default function StockMovementsPage() {
  const { user, workspaceId } = useAuth();
  const { toast } = useToast();

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [filteredMovements, setFilteredMovements] = useState<StockMovement[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [selectedProductId, setSelectedProductId] = useState<string>("");

  // Manual adjustment dialog
  const [showAdjustDialog, setShowAdjustDialog] = useState(false);
  const [adjustmentData, setAdjustmentData] = useState({
    productId: "",
    productName: "",
    sku: "",
    quantity: 0,
    reason: "",
    notes: "",
  });

  useEffect(() => {
    if (workspaceId) {
      loadData();
    }
  }, [workspaceId]);

  useEffect(() => {
    filterMovements();
  }, [movements, searchTerm, filterType, selectedProductId]);

  async function loadData() {
    setLoading(true);
    try {
      const [movementsData, inventoryData] = await Promise.all([
        getStockMovements(workspaceId),
        inventoryService.getAll(workspaceId),
      ]);
      setMovements(movementsData);
      setInventoryItems(inventoryData);
      // Low-stock query is best-effort (may need a composite index)
      try {
        const lowStockData = await getLowStockItems(workspaceId, 10);
        setLowStockItems(lowStockData);
      } catch (_e) {
        setLowStockItems(inventoryData.filter((i: any) => i.quantity <= 10 && i.status !== 'inactive'));
      }
    } catch (error) {
      console.error("Error loading data:", error);
      toast({
        title: "Error",
        description: "Failed to load stock movements",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function filterMovements() {
    let filtered = [...movements];

    // Filter by search term
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.productName.toLowerCase().includes(search) ||
          m.sku?.toLowerCase().includes(search) ||
          m.referenceNumber?.toLowerCase().includes(search) ||
          m.notes?.toLowerCase().includes(search)
      );
    }

    // Filter by type
    if (filterType !== "all") {
      filtered = filtered.filter((m) => m.type === filterType);
    }

    // Filter by product
    if (selectedProductId) {
      filtered = filtered.filter((m) => m.productId === selectedProductId);
    }

    setFilteredMovements(filtered);
  }

  async function handleAdjustment() {
    if (!adjustmentData.productId || adjustmentData.quantity === 0 || !adjustmentData.reason) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    try {
      await adjustStock(
        workspaceId,
        user.uid,
        user.displayName || user.email || "Unknown User",
        adjustmentData.productId,
        adjustmentData.productName,
        adjustmentData.sku,
        adjustmentData.quantity,
        adjustmentData.reason,
        adjustmentData.notes
      );

      toast({
        title: "Success",
        description: "Stock adjustment created successfully",
      });

      setShowAdjustDialog(false);
      setAdjustmentData({
        productId: "",
        productName: "",
        sku: "",
        quantity: 0,
        reason: "",
        notes: "",
      });

      loadData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create stock adjustment",
        variant: "destructive",
      });
    }
  }

  function openAdjustDialog(product?: any) {
    if (product) {
      setAdjustmentData({
        productId: product.id,
        productName: product.name,
        sku: product.sku || "",
        quantity: 0,
        reason: "",
        notes: "",
      });
    }
    setShowAdjustDialog(true);
  }

  function getMovementIcon(type: StockMovement["type"]) {
    const inTypes: StockMovement["type"][] = [
      "purchase",
      "adjustment-in",
      "return",
      "transfer-in",
      "initial",
    ];
    return inTypes.includes(type) ? (
      <ArrowUpCircle className="h-4 w-4 text-green-600" />
    ) : (
      <ArrowDownCircle className="h-4 w-4 text-red-600" />
    );
  }

  function getMovementColor(type: StockMovement["type"]) {
    const colorMap: Record<StockMovement["type"], string> = {
      purchase: "bg-blue-100 text-blue-800",
      sale: "bg-purple-100 text-purple-800",
      "adjustment-in": "bg-green-100 text-green-800",
      "adjustment-out": "bg-orange-100 text-orange-800",
      return: "bg-yellow-100 text-yellow-800",
      "transfer-in": "bg-cyan-100 text-cyan-800",
      "transfer-out": "bg-pink-100 text-pink-800",
      initial: "bg-gray-100 text-gray-800",
    };
    return colorMap[type];
  }

  const totalIn = movements
    .filter((m) => m.quantity > 0)
    .reduce((sum, m) => sum + m.quantity, 0);

  const totalOut = movements
    .filter((m) => m.quantity < 0)
    .reduce((sum, m) => sum + Math.abs(m.quantity), 0);

  if (!user || !workspaceId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-500">Please login to view stock movements</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Stock Movements</h1>
          <p className="text-gray-600 mt-1">Track all inventory changes and adjustments</p>
        </div>
        <Button onClick={() => openAdjustDialog()}>
          <Package className="mr-2 h-4 w-4" />
          Manual Adjustment
        </Button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Total Movements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{movements.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Stock In</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center">
              <TrendingUp className="h-5 w-5 text-green-600 mr-2" />
              <div className="text-2xl font-bold text-green-600">{totalIn}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Stock Out</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center">
              <TrendingDown className="h-5 w-5 text-red-600 mr-2" />
              <div className="text-2xl font-bold text-red-600">{totalOut}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Low Stock Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center">
              <AlertTriangle className="h-5 w-5 text-orange-600 mr-2" />
              <div className="text-2xl font-bold text-orange-600">{lowStockItems.length}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-orange-800 flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2" />
              Low Stock Alert
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lowStockItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between bg-white p-3 rounded">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-gray-600">
                      {item.sku && `SKU: ${item.sku} • `}
                      Current Stock: {item.quantity}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => openAdjustDialog(item)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Restock
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by product name, SKU, or reference..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="sale">Sales</SelectItem>
                <SelectItem value="purchase">Purchases</SelectItem>
                <SelectItem value="adjustment-in">Adjustment In</SelectItem>
                <SelectItem value="adjustment-out">Adjustment Out</SelectItem>
                <SelectItem value="return">Returns</SelectItem>
                <SelectItem value="transfer-in">Transfer In</SelectItem>
                <SelectItem value="transfer-out">Transfer Out</SelectItem>
                <SelectItem value="initial">Initial Stock</SelectItem>
              </SelectContent>
            </Select>

            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
              <SelectTrigger className="w-full md:w-[250px]">
                <SelectValue placeholder="Filter by product" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Products</SelectItem>
                {inventoryItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} {item.sku && `(${item.sku})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(searchTerm || filterType !== "all" || selectedProductId) && (
              <Button
                variant="outline"
                onClick={() => {
                  setSearchTerm("");
                  setFilterType("all");
                  setSelectedProductId("");
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Movements Table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Loading stock movements...</p>
            </div>
          ) : filteredMovements.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-500">No stock movements found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Previous</TableHead>
                    <TableHead className="text-center">Change</TableHead>
                    <TableHead className="text-right">New</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMovements.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell className="text-sm">
                        {new Date(movement.createdAt).toLocaleDateString()}<br />
                        <span className="text-xs text-gray-500">
                          {new Date(movement.createdAt).toLocaleTimeString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{movement.productName}</p>
                          {movement.sku && (
                            <p className="text-sm text-gray-500">SKU: {movement.sku}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={getMovementColor(movement.type)}>
                          {movement.type.replace("-", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{movement.previousQuantity}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-2">
                          {getMovementIcon(movement.type)}
                          <span
                            className={`font-medium ${
                              movement.quantity > 0 ? "text-green-600" : "text-red-600"
                            }`}
                          >
                            {movement.quantity > 0 ? "+" : ""}
                            {movement.quantity}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {movement.newQuantity}
                      </TableCell>
                      <TableCell>
                        {movement.referenceNumber && (
                          <div className="text-sm">
                            <p className="font-medium">{movement.referenceNumber}</p>
                            <p className="text-gray-500 capitalize">{movement.referenceType}</p>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="text-sm truncate" title={movement.reason}>
                          {movement.reason || "-"}
                        </p>
                        {movement.notes && (
                          <p className="text-xs text-gray-500 truncate" title={movement.notes}>
                            {movement.notes}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{movement.createdByName}</TableCell>
                      <TableCell>
                        <Badge
                          variant={movement.status === "completed" ? "default" : "secondary"}
                        >
                          {movement.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual Adjustment Dialog */}
      <Dialog open={showAdjustDialog} onOpenChange={setShowAdjustDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manual Stock Adjustment</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Product *</Label>
              <Select
                value={adjustmentData.productId}
                onValueChange={(value) => {
                  const product = inventoryItems.find((p) => p.id === value);
                  if (product) {
                    setAdjustmentData({
                      ...adjustmentData,
                      productId: product.id,
                      productName: product.name,
                      sku: product.sku || "",
                    });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {inventoryItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} {item.sku && `(${item.sku})`} - Stock: {item.quantity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Quantity Change *</Label>
              <div className="flex gap-2 mt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setAdjustmentData({ ...adjustmentData, quantity: adjustmentData.quantity - 1 })
                  }
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  value={adjustmentData.quantity}
                  onChange={(e) =>
                    setAdjustmentData({ ...adjustmentData, quantity: parseInt(e.target.value) || 0 })
                  }
                  className="text-center"
                  placeholder="0"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setAdjustmentData({ ...adjustmentData, quantity: adjustmentData.quantity + 1 })
                  }
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Use positive numbers to add stock, negative to remove
              </p>
            </div>

            <div>
              <Label>Reason *</Label>
              <Select
                value={adjustmentData.reason}
                onValueChange={(value) => setAdjustmentData({ ...adjustmentData, reason: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Stock correction">Stock correction</SelectItem>
                  <SelectItem value="Physical count">Physical count</SelectItem>
                  <SelectItem value="Damaged goods">Damaged goods</SelectItem>
                  <SelectItem value="Theft/Loss">Theft/Loss</SelectItem>
                  <SelectItem value="Restocking">Restocking</SelectItem>
                  <SelectItem value="Promotion/Gift">Promotion/Gift</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notes (Optional)</Label>
              <Textarea
                value={adjustmentData.notes}
                onChange={(e) => setAdjustmentData({ ...adjustmentData, notes: e.target.value })}
                placeholder="Additional details about this adjustment..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdjustDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdjustment}>Create Adjustment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
