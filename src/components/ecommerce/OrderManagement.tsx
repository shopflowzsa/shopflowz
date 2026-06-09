/**
 * Order Management Components
 * Admin interface for managing ecommerce orders
 */

import { useState, useEffect } from "react";
import { 
  Package, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Truck, 
  CreditCard,
  Search,
  Filter,
  Eye,
  ArrowUpDown
} from "lucide-react";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Order, OrderStatus, PaymentStatus } from "@/types/ecommerce";
import { 
  getOrders, 
  updateOrderStatus, 
  updatePaymentStatus,
  cancelOrder,
  getOrderAnalytics 
} from "@/lib/orderService";
import { useAuth } from "@/contexts/AuthContext";

// ─── Order Management Dashboard ──────────────────────────────────────────

export function OrderManagement() {
  const { workspace } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [filters, setFilters] = useState({
    status: "all" as OrderStatus | "all",
    paymentStatus: "all" as PaymentStatus | "all",
    search: "",
    dateRange: "week"
  });

  useEffect(() => {
    loadOrders();
    loadAnalytics();
  }, [workspace?.id, filters]);

  const loadOrders = async () => {
    if (!workspace?.id) return;
    
    try {
      setLoading(true);
      const ordersData = await getOrders(workspace.id, {
        status: filters.status !== "all" ? filters.status : undefined,
        paymentStatus: filters.paymentStatus !== "all" ? filters.paymentStatus : undefined,
        limit: 100,
      });
      
      // Client-side search filtering
      let filteredOrders = ordersData;
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        filteredOrders = ordersData.filter(order => 
          order.orderNumber.toLowerCase().includes(searchLower) ||
          order.customerInfo.name.toLowerCase().includes(searchLower) ||
          order.customerInfo.email.toLowerCase().includes(searchLower)
        );
      }
      
      setOrders(filteredOrders);
    } catch (error) {
      console.error("Error loading orders:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadAnalytics = async () => {
    if (!workspace?.id) return;
    
    try {
      const dateFrom = getDateFromRange(filters.dateRange);
      const dateTo = new Date().toISOString();
      
      const analyticsData = await getOrderAnalytics(workspace.id, dateFrom, dateTo);
      setAnalytics(analyticsData);
    } catch (error) {
      console.error("Error loading analytics:", error);
    }
  };

  const getDateFromRange = (range: string): string => {
    const now = new Date();
    switch (range) {
      case "today":
        return new Date(now.setHours(0, 0, 0, 0)).toISOString();
      case "week":
        return new Date(now.setDate(now.getDate() - 7)).toISOString();
      case "month":
        return new Date(now.setDate(now.getDate() - 30)).toISOString();
      case "quarter":
        return new Date(now.setDate(now.getDate() - 90)).toISOString();
      default:
        return new Date(now.setDate(now.getDate() - 7)).toISOString();
    }
  };

  const getStatusBadge = (status: OrderStatus) => {
    const statusConfig = {
      pending: { label: "Pending", variant: "secondary", icon: Clock },
      confirmed: { label: "Confirmed", variant: "default", icon: CheckCircle },
      processing: { label: "Processing", variant: "default", icon: Package },
      shipped: { label: "Shipped", variant: "default", icon: Truck },
      delivered: { label: "Delivered", variant: "default", icon: CheckCircle },
      cancelled: { label: "Cancelled", variant: "destructive", icon: XCircle },
    };
    
    const config = statusConfig[status];
    const Icon = config.icon;
    
    return (
      <Badge variant={config.variant as any} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const getPaymentBadge = (status: PaymentStatus) => {
    const statusConfig = {
      pending: { label: "Pending", variant: "secondary" },
      paid: { label: "Paid", variant: "default" },
      failed: { label: "Failed", variant: "destructive" },
      refunded: { label: "Refunded", variant: "outline" },
      cancelled: { label: "Cancelled", variant: "outline" },
    };
    
    const config = statusConfig[status];
    
    return (
      <Badge variant={config.variant as any} className="flex items-center gap-1">
        <CreditCard className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  if (loading && orders.length === 0) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Orders</h2>
          <p className="text-muted-foreground">
            Manage customer orders and track fulfillment
          </p>
        </div>
      </div>

      {/* Analytics Cards */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.totalOrders}</div>
              <p className="text-xs text-muted-foreground">
                Last {filters.dateRange}
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {analytics.totalRevenue.toFixed(2)} QAR
              </div>
              <p className="text-xs text-muted-foreground">
                Last {filters.dateRange}
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Order Value</CardTitle>
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {analytics.averageOrderValue.toFixed(2)} QAR
              </div>
              <p className="text-xs text-muted-foreground">
                Last {filters.dateRange}
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Orders</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {analytics.ordersByStatus.pending || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                Needs attention
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <Input
                placeholder="Search orders by number, customer name, or email..."
                value={filters.search}
                onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
              />
            </div>
            <Select 
              value={filters.status} 
              onValueChange={(value) => setFilters(prev => ({ ...prev, status: value as any }))}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="shipped">Shipped</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            
            <Select 
              value={filters.paymentStatus} 
              onValueChange={(value) => setFilters(prev => ({ ...prev, paymentStatus: value as any }))}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Payment Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payments</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
              </SelectContent>
            </Select>
            
            <Select 
              value={filters.dateRange} 
              onValueChange={(value) => setFilters(prev => ({ ...prev, dateRange: value }))}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Date Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">Last Week</SelectItem>
                <SelectItem value="month">Last Month</SelectItem>
                <SelectItem value="quarter">Last Quarter</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Orders Table */}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order Number</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="h-8 w-8 text-muted-foreground" />
                      <p className="text-muted-foreground">
                        {filters.search || filters.status !== "all" || filters.paymentStatus !== "all"
                          ? "No orders found matching your criteria"
                          : "No orders yet. Waiting for first customer order."
                        }
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                orders.map(order => (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono">{order.orderNumber}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{order.customerInfo.name}</p>
                        <p className="text-sm text-muted-foreground">{order.customerInfo.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {order.items.length} items
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {order.totalAmount.toFixed(2)} {order.currency}
                    </TableCell>
                    <TableCell>{getStatusBadge(order.status)}</TableCell>
                    <TableCell>{getPaymentBadge(order.paymentStatus)}</TableCell>
                    <TableCell>
                      {new Date(order.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedOrder(order)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Order Detail Dialog */}
      {selectedOrder && (
        <Dialog open={true} onOpenChange={() => setSelectedOrder(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Order {selectedOrder.orderNumber}</DialogTitle>
              <DialogDescription>
                Order details and management
              </DialogDescription>
            </DialogHeader>
            <OrderDetail 
              order={selectedOrder} 
              onOrderUpdate={(updatedOrder) => {
                setOrders(orders.map(o => o.id === updatedOrder.id ? updatedOrder : o));
                setSelectedOrder(updatedOrder);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Order Detail Component ──────────────────────────────────────────────

function OrderDetail({ 
  order, 
  onOrderUpdate 
}: { 
  order: Order; 
  onOrderUpdate: (order: Order) => void;
}) {
  const { workspace } = useAuth();
  const [updating, setUpdating] = useState(false);

  const handleStatusUpdate = async (newStatus: OrderStatus) => {
    if (!workspace?.id || updating) return;
    
    try {
      setUpdating(true);
      await updateOrderStatus(workspace.id, order.id, newStatus);
      const updatedOrder = { ...order, status: newStatus };
      onOrderUpdate(updatedOrder);
    } catch (error) {
      console.error("Error updating order status:", error);
      alert("Failed to update order status");
    } finally {
      setUpdating(false);
    }
  };

  const handlePaymentUpdate = async (newPaymentStatus: PaymentStatus) => {
    if (!workspace?.id || updating) return;
    
    try {
      setUpdating(true);
      await updatePaymentStatus(workspace.id, order.id, newPaymentStatus);
      const updatedOrder = { ...order, paymentStatus: newPaymentStatus };
      onOrderUpdate(updatedOrder);
    } catch (error) {
      console.error("Error updating payment status:", error);
      alert("Failed to update payment status");
    } finally {
      setUpdating(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!workspace?.id || updating) return;
    
    const reason = prompt("Please provide a reason for cancellation:");
    if (!reason) return;
    
    try {
      setUpdating(true);
      await cancelOrder(workspace.id, order.id, reason);
      const updatedOrder = { 
        ...order, 
        status: 'cancelled' as OrderStatus,
        paymentStatus: order.paymentStatus === 'paid' ? 'refunded' as PaymentStatus : 'cancelled' as PaymentStatus
      };
      onOrderUpdate(updatedOrder);
    } catch (error) {
      console.error("Error cancelling order:", error);
      alert("Failed to cancel order");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Tabs defaultValue="details" className="space-y-4">
      <TabsList>
        <TabsTrigger value="details">Order Details</TabsTrigger>
        <TabsTrigger value="items">Items</TabsTrigger>
        <TabsTrigger value="customer">Customer</TabsTrigger>
        <TabsTrigger value="actions">Actions</TabsTrigger>
      </TabsList>

      <TabsContent value="details" className="space-y-4">
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-3">
            <div>
              <h4 className="font-medium">Order Number</h4>
              <p className="text-sm font-mono">{order.orderNumber}</p>
            </div>
            
            <div>
              <h4 className="font-medium">Order Date</h4>
              <p className="text-sm">{new Date(order.createdAt).toLocaleString()}</p>
            </div>
            
            <div>
              <h4 className="font-medium">Status</h4>
              <div className="flex items-center gap-2">
                {getStatusBadge(order.status)}
                {getPaymentBadge(order.paymentStatus)}
              </div>
            </div>
          </div>
          
          <div className="space-y-3">
            <div>
              <h4 className="font-medium">Order Total</h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{order.subtotal.toFixed(2)} {order.currency}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax:</span>
                  <span>{order.taxAmount.toFixed(2)} {order.currency}</span>
                </div>
                <div className="flex justify-between">
                  <span>Shipping:</span>
                  <span>{order.shippingCost.toFixed(2)} {order.currency}</span>
                </div>
                <div className="flex justify-between font-medium pt-1 border-t">
                  <span>Total:</span>
                  <span>{order.totalAmount.toFixed(2)} {order.currency}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {order.notes && (
          <div>
            <h4 className="font-medium">Order Notes</h4>
            <p className="text-sm text-muted-foreground">{order.notes}</p>
          </div>
        )}
      </TabsContent>

      <TabsContent value="items">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>Unit Price</TableHead>
              <TableHead>Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((item, index) => (
              <TableRow key={index}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    {item.productImage && (
                      <img 
                        src={item.productImage} 
                        alt={item.productName}
                        className="w-10 h-10 rounded object-cover"
                      />
                    )}
                    <div>
                      <p className="font-medium">{item.productName}</p>
                      {item.variantName && (
                        <p className="text-sm text-muted-foreground">{item.variantName}</p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>{item.unitPrice.toFixed(2)} {order.currency}</TableCell>
                <TableCell>{item.totalPrice.toFixed(2)} {order.currency}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TabsContent>

      <TabsContent value="customer">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium mb-3">Customer Information</h4>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium">Name:</span> {order.customerInfo.name}
                </div>
                <div>
                  <span className="font-medium">Email:</span> {order.customerInfo.email}
                </div>
                {order.customerInfo.phone && (
                  <div>
                    <span className="font-medium">Phone:</span> {order.customerInfo.phone}
                  </div>
                )}
              </div>
            </div>
            
            <div>
              <h4 className="font-medium mb-3">Shipping Address</h4>
              <div className="text-sm">
                <p>{order.shippingAddress.street}</p>
                <p>{order.shippingAddress.city}</p>
                <p>{order.shippingAddress.state}</p>
                <p>{order.shippingAddress.country} {order.shippingAddress.postalCode}</p>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="actions">
        <div className="space-y-4">
          <div>
            <h4 className="font-medium mb-3">Order Status</h4>
            <div className="flex gap-2">
              {["confirmed", "processing", "shipped", "delivered"].map(status => (
                <Button
                  key={status}
                  variant={order.status === status ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleStatusUpdate(status as OrderStatus)}
                  disabled={updating}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <h4 className="font-medium mb-3">Payment Status</h4>
            <div className="flex gap-2">
              {["paid", "refunded"].map(status => (
                <Button
                  key={status}
                  variant={order.paymentStatus === status ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePaymentUpdate(status as PaymentStatus)}
                  disabled={updating}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          {order.status !== "cancelled" && (
            <div>
              <h4 className="font-medium mb-3">Cancel Order</h4>
              <Button
                variant="destructive"
                onClick={handleCancelOrder}
                disabled={updating}
              >
                <XCircle className="h-4 w-4 mr-2" />
                Cancel Order
              </Button>
            </div>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );

  function getStatusBadge(status: OrderStatus) {
    // Same implementation as parent component
    const statusConfig = {
      pending: { label: "Pending", variant: "secondary", icon: Clock },
      confirmed: { label: "Confirmed", variant: "default", icon: CheckCircle },
      processing: { label: "Processing", variant: "default", icon: Package },
      shipped: { label: "Shipped", variant: "default", icon: Truck },
      delivered: { label: "Delivered", variant: "default", icon: CheckCircle },
      cancelled: { label: "Cancelled", variant: "destructive", icon: XCircle },
    };
    
    const config = statusConfig[status];
    const Icon = config.icon;
    
    return (
      <Badge variant={config.variant as any} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  }

  function getPaymentBadge(status: PaymentStatus) {
    // Same implementation as parent component
    const statusConfig = {
      pending: { label: "Pending", variant: "secondary" },
      paid: { label: "Paid", variant: "default" },
      failed: { label: "Failed", variant: "destructive" },
      refunded: { label: "Refunded", variant: "outline" },
      cancelled: { label: "Cancelled", variant: "outline" },
    };
    
    const config = statusConfig[status];
    
    return (
      <Badge variant={config.variant as any} className="flex items-center gap-1">
        <CreditCard className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  }
}