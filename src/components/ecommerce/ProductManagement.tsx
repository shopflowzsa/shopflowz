/**
 * Product Management Components
 * Admin interface for managing ecommerce products
 */

import { useState, useEffect } from "react";
import { Plus, Edit, Trash2, Search, Filter, Eye, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Product, ProductCategory } from "@/types/ecommerce";
import { getProducts, getCategories, deleteProduct } from "@/lib/productService";
import { useAuth } from "@/contexts/AuthContext";

// ─── Product List Component ──────────────────────────────────────────────

export function ProductList() {
  const { workspace } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  useEffect(() => {
    loadData();
  }, [workspace?.id]);

  const loadData = async () => {
    if (!workspace?.id) return;
    
    try {
      setLoading(true);
      const [productsData, categoriesData] = await Promise.all([
        getProducts(workspace.id),
        getCategories(workspace.id),
      ]);
      
      setProducts(productsData);
      setCategories(categoriesData);
    } catch (error) {
      console.error("Error loading products:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(product => {
    const matchesSearch = 
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.brand?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = 
      selectedCategory === "all" || 
      product.categoryIds.includes(selectedCategory);
    
    return matchesSearch && matchesCategory;
  });

  const handleDeleteProduct = async (productId: string) => {
    if (!workspace?.id) return;
    
    const confirmDelete = confirm("Are you sure you want to delete this product? This action cannot be undone.");
    if (!confirmDelete) return;
    
    try {
      await deleteProduct(workspace.id, productId);
      setProducts(products.filter(p => p.id !== productId));
    } catch (error) {
      console.error("Error deleting product:", error);
      alert("Failed to delete product. Please check if it has existing stock or orders.");
    }
  };

  const getStockStatus = (product: Product) => {
    const totalStock = product.variants.reduce((sum, variant) => sum + variant.stockQuantity, 0);
    if (totalStock === 0) return { status: "Out of Stock", variant: "destructive" };
    if (totalStock <= 10) return { status: "Low Stock", variant: "warning" };
    return { status: "In Stock", variant: "default" };
  };

  const getCategoryName = (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId);
    return category?.name || "Unknown Category";
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Products</h2>
          <p className="text-muted-foreground">
            Manage your product inventory and pricing
          </p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Product
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Create New Product</DialogTitle>
            </DialogHeader>
            <ProductForm 
              onSuccess={() => {
                setShowCreateDialog(false);
                loadData();
              }}
              categories={categories}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search products by name, SKU, or brand..."
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
                {categories.map(category => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Products Table */}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price Range</TableHead>
                <TableHead>Stock Status</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="h-8 w-8 text-muted-foreground" />
                      <p className="text-muted-foreground">
                        {searchTerm || selectedCategory !== "all" 
                          ? "No products found matching your criteria"
                          : "No products yet. Create your first product to get started."
                        }
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts.map(product => {
                  const stockStatus = getStockStatus(product);
                  const priceRange = product.variants.length > 1 
                    ? `${Math.min(...product.variants.map(v => v.price))} - ${Math.max(...product.variants.map(v => v.price))} QAR`
                    : `${product.variants[0]?.price || 0} QAR`;
                  
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {product.images && product.images.length > 0 ? (
                            <img 
                              src={product.images[0]} 
                              alt={product.name}
                              className="w-12 h-12 rounded object-cover"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded bg-gray-100 flex items-center justify-center">
                              <Package className="h-6 w-6 text-gray-400" />
                            </div>
                          )}
                          <div>
                            <p className="font-medium">{product.name}</p>
                            <p className="text-sm text-muted-foreground">{product.brand}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                      <TableCell>
                        {product.categoryIds.map(categoryId => (
                          <Badge key={categoryId} variant="secondary" className="mr-1">
                            {getCategoryName(categoryId)}
                          </Badge>
                        ))}
                      </TableCell>
                      <TableCell>{priceRange}</TableCell>
                      <TableCell>
                        <Badge variant={stockStatus.variant as any}>
                          {stockStatus.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={product.isActive ? "default" : "secondary"}>
                          {product.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedProduct(product)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedProduct(product);
                              setShowCreateDialog(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteProduct(product.id)}
                          >
                            <Trash2 className="h-4 w-4" />
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

      {/* Product Detail Dialog */}
      {selectedProduct && !showCreateDialog && (
        <Dialog open={true} onOpenChange={() => setSelectedProduct(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{selectedProduct.name}</DialogTitle>
            </DialogHeader>
            <ProductDetail product={selectedProduct} categories={categories} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Product Form Component (stub) ───────────────────────────────────────

function ProductForm({ 
  product, 
  onSuccess, 
  categories 
}: { 
  product?: Product; 
  onSuccess: () => void; 
  categories: ProductCategory[];
}) {
  // This would contain the full product form implementation
  // For now, just a placeholder
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Product form implementation will go here. This will include:
      </p>
      <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
        <li>Basic product information (name, description, brand, SKU)</li>
        <li>Category selection and tagging</li>
        <li>Image upload and gallery management</li>
        <li>Product variants (size, color, etc.) with individual pricing</li>
        <li>Inventory tracking and stock management</li>
        <li>SEO settings and metadata</li>
        <li>Pricing rules and discounts</li>
      </ul>
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={onSuccess}>Cancel</Button>
        <Button onClick={onSuccess}>
          {product ? "Update Product" : "Create Product"}
        </Button>
      </div>
    </div>
  );
}

// ─── Product Detail Component (stub) ─────────────────────────────────────

function ProductDetail({ 
  product, 
  categories 
}: { 
  product: Product; 
  categories: ProductCategory[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div>
          {product.images && product.images.length > 0 ? (
            <img 
              src={product.images[0]} 
              alt={product.name}
              className="w-full aspect-square object-cover rounded-lg"
            />
          ) : (
            <div className="w-full aspect-square bg-gray-100 rounded-lg flex items-center justify-center">
              <Package className="h-12 w-12 text-gray-400" />
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">{product.name}</h3>
            <p className="text-muted-foreground">{product.brand}</p>
          </div>
          
          <div>
            <h4 className="font-medium">Description</h4>
            <p className="text-sm text-muted-foreground">{product.description}</p>
          </div>
          
          <div>
            <h4 className="font-medium">SKU</h4>
            <p className="text-sm font-mono">{product.sku}</p>
          </div>
          
          <div>
            <h4 className="font-medium">Categories</h4>
            <div className="flex gap-2">
              {product.categoryIds.map(categoryId => {
                const category = categories.find(c => c.id === categoryId);
                return (
                  <Badge key={categoryId} variant="secondary">
                    {category?.name || "Unknown"}
                  </Badge>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      
      <div>
        <h4 className="font-medium mb-3">Product Variants</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variant</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {product.variants.map(variant => (
              <TableRow key={variant.id}>
                <TableCell>{variant.name}</TableCell>
                <TableCell className="font-mono text-sm">{variant.sku}</TableCell>
                <TableCell>{variant.price} QAR</TableCell>
                <TableCell>
                  <Badge variant={variant.stockQuantity > 0 ? "default" : "destructive"}>
                    {variant.stockQuantity} units
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={variant.isActive ? "default" : "secondary"}>
                    {variant.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}