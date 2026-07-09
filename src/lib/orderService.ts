/**
 * Ecommerce Order Management Service
 * Handles orders, customers, payments, and checkout process
 */

import { supabase as sbClient, supabaseServiceRole } from './supabase';
import { 
  Order, 
  Customer,
  OrderItem,
  CartItem,
  PaymentMethod,
  ShippingAddress,
  OrderStatus,
  PaymentStatus
} from '@/types/ecommerce';
// updateStock import removed — stock is managed through inventoryService

// ─── Order Management ───────────────────────────────────────────────────

export async function createOrder(
  workspaceId: string,
  orderData: {
    customer: Customer;
    items: CartItem[];
    shippingAddress: ShippingAddress;
    paymentMethod: PaymentMethod;
    notes?: string;
    // Optional: tag where the order came from. "walk_in" = staff counter sale.
    source?: string;
    // Optional: override defaults when staff records a paid-in-shop sale.
    paymentStatus?: PaymentStatus;
    status?: OrderStatus;
  }
): Promise<string> {
  const orderNumber = await generateOrderNumber(workspaceId);
  const subtotal = orderData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const isWalkIn = orderData.source === 'walk_in';
  // Walk-in counter sales: no shipping, no tax (prices are already VAT-inclusive)
  const taxAmount = isWalkIn ? 0 : 0;
  const shippingCost = isWalkIn ? 0 : calculateShippingCost(subtotal, orderData.shippingAddress);
  const totalAmount = subtotal + taxAmount + shippingCost;
  const orderItems: OrderItem[] = orderData.items.map(item => ({
    productId: item.productId, variantId: item.variantId, productName: item.productName,
    variantName: item.variantName, sku: item.sku, quantity: item.quantity,
    unitPrice: item.price, totalPrice: item.price * item.quantity, productImage: item.productImage,
  }));
  const id = `order_${Date.now()}`;
  const now = new Date().toISOString();
  const paid = orderData.paymentStatus === 'paid';
  const order: Order = {
    id, orderNumber, customerId: orderData.customer.id,
    customerInfo: { name: orderData.customer.name, email: orderData.customer.email, phone: orderData.customer.phone },
    items: orderItems,
    status: orderData.status || (paid ? 'confirmed' : 'pending'),
    paymentStatus: orderData.paymentStatus || 'pending',
    subtotal, taxAmount, shippingCost, totalAmount, currency: 'ZAR',
    shippingAddress: orderData.shippingAddress, paymentMethod: orderData.paymentMethod,
    notes: orderData.notes, createdAt: now, updatedAt: now,
    ...(paid && { paidAt: now }),
    ...(orderData.source && { source: orderData.source } as any),
  };
  await supabaseServiceRole.from('orders').insert({ id, workspace_id: workspaceId, data: order });

  // Drop a notification into both the general feed and the isolated ecommerce feed.
  try {
    const { addNotification, addEcommerceNotification } = await import('./notificationService');
    const who = orderData.customer.name || 'a customer';
    const isWalkIn = orderData.source === 'walk_in';
    const notif = {
      type: 'order' as const,
      title: `${isWalkIn ? 'Walk-in sale' : 'New order'} ${orderNumber}`,
      body: `R${totalAmount.toFixed(2)} from ${who}${paid ? ' · paid' : ' · awaiting payment'}`,
      link: `ecommerce:${orderNumber}`,
    };
    await Promise.all([
      addNotification(workspaceId, notif),
      addEcommerceNotification(workspaceId, notif),
    ]);
  } catch (e) {
    console.error('order notification failed', e);
  }

  return id;
}

export async function updateOrderStatus(
  workspaceId: string, 
  orderId: string, 
  status: OrderStatus,
  notes?: string
): Promise<void> {
  const { data: existing } = await sbClient.from('orders').select('data').eq('id', orderId).single();
  const merged = { ...(existing?.data as any || {}), status, updatedAt: new Date().toISOString(), ...(notes && { statusNotes: notes }) };
  await supabaseServiceRole.from('orders').update({ data: merged }).eq('id', orderId);
  await sendOrderStatusNotification(workspaceId, orderId, status);
}

export async function updatePaymentStatus(
  workspaceId: string,
  orderId: string,
  paymentStatus: PaymentStatus,
  paymentData?: { transactionId?: string; paymentMethod?: string; amount?: number; notes?: string; }
): Promise<void> {
  const { data: existing } = await sbClient.from('orders').select('data').eq('id', orderId).single();
  const merged = {
    ...(existing?.data as any || {}),
    paymentStatus,
    updatedAt: new Date().toISOString(),
    ...(paymentData && { paymentData: { ...paymentData, timestamp: new Date().toISOString() } }),
    ...(paymentStatus === 'paid' && { status: 'confirmed', paidAt: new Date().toISOString() }),
  };
  await supabaseServiceRole.from('orders').update({ data: merged }).eq('id', orderId);
}

export async function getOrder(workspaceId: string, orderId: string): Promise<Order | null> {
  const { data } = await sbClient.from('orders').select('id, data').eq('id', orderId).single();
  if (!data) return null;
  return { id: data.id, ...(data.data as any) } as Order;
}

export async function getOrders(
  workspaceId: string,
  options: {
    customerId?: string;
    status?: OrderStatus;
    paymentStatus?: PaymentStatus;
    limit?: number;
    dateFrom?: string;
    dateTo?: string;
  } = {}
): Promise<Order[]> {
  const { data } = await sbClient.from('orders').select('id, data').eq('workspace_id', workspaceId).order('created_at', { ascending: false });
  let orders = (data || []).map(r => ({ id: r.id, ...(r.data as any) } as Order));
  if (options.customerId) orders = orders.filter(o => o.customerId === options.customerId);
  if (options.status) orders = orders.filter(o => o.status === options.status);
  if (options.paymentStatus) orders = orders.filter(o => o.paymentStatus === options.paymentStatus);
  if (options.dateFrom || options.dateTo) {
    orders = orders.filter(order => {
      const d = new Date(order.createdAt);
      if (options.dateFrom && d < new Date(options.dateFrom)) return false;
      if (options.dateTo && d > new Date(options.dateTo)) return false;
      return true;
    });
  }
  if (options.limit) orders = orders.slice(0, options.limit);
  return orders;
}

export async function cancelOrder(
  workspaceId: string, 
  orderId: string, 
  reason: string
): Promise<void> {
  const order = await getOrder(workspaceId, orderId);
  if (!order) throw new Error('Order not found');
  if (!['pending', 'confirmed'].includes(order.status)) {
    throw new Error(`Cannot cancel order with status: ${order.status}`);
  }
  const { data: existing } = await supabaseServiceRole.from('orders').select('data').eq('id', orderId).single();
  const merged = {
    ...(existing?.data as any || {}),
    status: 'cancelled' as OrderStatus,
    paymentStatus: order.paymentStatus === 'paid' ? 'refunded' : 'cancelled',
    cancelReason: reason, cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await supabaseServiceRole.from('orders').update({ data: merged }).eq('id', orderId);
  await sendOrderStatusNotification(workspaceId, orderId, 'cancelled');
}

// ─── Customer Management ─────────────────────────────────────────────────

export async function createCustomer(
  workspaceId: string, 
  customerData: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'totalOrders' | 'totalSpent'>
): Promise<string> {
  const existingCustomer = await getCustomerByEmail(workspaceId, customerData.email);
  if (existingCustomer) throw new Error('Customer with this email already exists');
  const id = `cust_${Date.now()}`;
  const now = new Date().toISOString();
  const customer: Customer = { ...customerData, id, totalOrders: 0, totalSpent: 0, isActive: true, createdAt: now, updatedAt: now };
  await supabaseServiceRole.from('ecommerce_customers').insert({ id, workspace_id: workspaceId, data: customer });
  return id;
}

export async function updateCustomer(
  workspaceId: string, 
  customerId: string, 
  updates: Partial<Customer>
): Promise<void> {
  const { data: existing } = await sbClient.from('ecommerce_customers').select('data').eq('id', customerId).single();
  const merged = { ...(existing?.data as any || {}), ...updates, updatedAt: new Date().toISOString() };
  await supabaseServiceRole.from('ecommerce_customers').update({ data: merged }).eq('id', customerId);
}

export async function getCustomer(workspaceId: string, customerId: string): Promise<Customer | null> {
  const { data } = await sbClient.from('ecommerce_customers').select('id, data').eq('id', customerId).single();
  if (!data) return null;
  return { id: data.id, ...(data.data as any) } as Customer;
}

export async function getCustomerByEmail(workspaceId: string, email: string): Promise<Customer | null> {
  const { data } = await sbClient.from('ecommerce_customers').select('id, data').eq('workspace_id', workspaceId);
  const found = (data || []).find(r => (r.data as any)?.email === email);
  if (!found) return null;
  return { id: found.id, ...(found.data as any) } as Customer;
}

export async function getCustomers(
  workspaceId: string,
  options: { isActive?: boolean; limit?: number; searchTerm?: string; } = {}
): Promise<Customer[]> {
  const { data } = await sbClient.from('ecommerce_customers').select('id, data').eq('workspace_id', workspaceId).order('created_at', { ascending: false });
  let customers = (data || []).map(r => ({ id: r.id, ...(r.data as any) } as Customer));
  if (options.isActive !== undefined) customers = customers.filter(c => c.isActive === options.isActive);
  if (options.searchTerm) {
    const s = options.searchTerm.toLowerCase();
    customers = customers.filter(c => c.name.toLowerCase().includes(s) || c.email.toLowerCase().includes(s) || c.phone?.toLowerCase().includes(s));
  }
  if (options.limit) customers = customers.slice(0, options.limit);
  return customers;
}

// ─── Cart and Checkout Helpers ──────────────────────────────────────────

export function calculateCartTotals(items: CartItem[]): {
  subtotal: number;
  itemCount: number;
} {
  const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  
  return { subtotal, itemCount };
}

export function calculateShippingCost(subtotal: number, _address: ShippingAddress): number {
  // Flat-rate shipping — free over R500, R80 otherwise.
  // Online store delivery fees are configured in Ecommerce Settings and override this.
  if (subtotal >= 500) return 0;
  return 80;
}

export function validateOrderData(orderData: {
  customer: Customer;
  items: CartItem[];
  shippingAddress: ShippingAddress;
  paymentMethod: PaymentMethod;
}): string[] {
  const errors: string[] = [];
  
  // Validate customer
  if (!orderData.customer.name.trim()) {
    errors.push('Customer name is required');
  }
  if (!orderData.customer.email.trim() || !isValidEmail(orderData.customer.email)) {
    errors.push('Valid customer email is required');
  }
  
  // Validate items
  if (orderData.items.length === 0) {
    errors.push('Order must contain at least one item');
  }
  
  orderData.items.forEach((item, index) => {
    if (item.quantity <= 0) {
      errors.push(`Item ${index + 1} quantity must be greater than 0`);
    }
    if (item.price <= 0) {
      errors.push(`Item ${index + 1} price must be greater than 0`);
    }
  });
  
  // Validate shipping address
  const requiredAddressFields = ['street', 'city', 'country'];
  requiredAddressFields.forEach(field => {
    if (!orderData.shippingAddress[field as keyof ShippingAddress]?.trim()) {
      errors.push(`Shipping ${field} is required`);
    }
  });
  
  // Validate payment method
  if (!orderData.paymentMethod.type) {
    errors.push('Payment method is required');
  }
  
  return errors;
}

// ─── Helper Functions ────────────────────────────────────────────────────

async function generateOrderNumber(workspaceId: string): Promise<string> {
  const { data } = await sbClient.from('orders').select('id').eq('workspace_id', workspaceId);
  const count = (data?.length || 0) + 1001;
  const year = new Date().getFullYear();
  return `ORD-${year}-${count.toString().padStart(6, '0')}`;
}

async function sendOrderStatusNotification(
  workspaceId: string, 
  orderId: string, 
  status: OrderStatus
): Promise<void> {
  // This would integrate with your notification system
  // For now, we'll log the notification
  console.log(`Order ${orderId} status updated to ${status}`);
  
  // TODO: Implement email/SMS notifications
  // TODO: Integrate with WhatsApp API for order updates
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// ─── Analytics Helpers ───────────────────────────────────────────────────

export async function getOrderAnalytics(
  workspaceId: string,
  dateFrom: string,
  dateTo: string
): Promise<{
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  ordersByStatus: Record<OrderStatus, number>;
  topProducts: Array<{ productId: string; productName: string; quantity: number; revenue: number; }>;
}> {
  const orders = await getOrders(workspaceId, { dateFrom, dateTo });
  
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  
  // Orders by status
  const ordersByStatus = orders.reduce((acc, order) => {
    acc[order.status] = (acc[order.status] || 0) + 1;
    return acc;
  }, {} as Record<OrderStatus, number>);
  
  // Top products
  const productStats = new Map<string, { productName: string; quantity: number; revenue: number; }>();
  
  orders.forEach(order => {
    order.items.forEach(item => {
      const existing = productStats.get(item.productId) || { 
        productName: item.productName, 
        quantity: 0, 
        revenue: 0 
      };
      existing.quantity += item.quantity;
      existing.revenue += item.totalPrice;
      productStats.set(item.productId, existing);
    });
  });
  
  const topProducts = Array.from(productStats.entries())
    .map(([productId, stats]) => ({ productId, ...stats }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10); // Top 10 products
  
  return {
    totalOrders,
    totalRevenue,
    averageOrderValue,
    ordersByStatus,
    topProducts,
  };
}