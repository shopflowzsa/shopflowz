// ═══════════════════════════════════════════════════════════════════════════
// ECOMMERCE TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

// ─── WhatsApp Notification Templates ─────────────────────────────────────

export type WhatsAppRecipient = 'store' | 'customer' | 'both';

export interface WhatsAppNotificationTemplate {
  enabled: boolean;
  recipientType: WhatsAppRecipient;
  storeNumber?: string;   // override storeWhatsApp for this event
  message: string;        // supports {variable} placeholders
}

export interface WhatsAppNotifications {
  newOrder?: WhatsAppNotificationTemplate;
  newClient?: WhatsAppNotificationTemplate;
  orderConfirmed?: WhatsAppNotificationTemplate;
  orderPaid?: WhatsAppNotificationTemplate;
  orderShipped?: WhatsAppNotificationTemplate;
  orderReadyForPickup?: WhatsAppNotificationTemplate;
  orderDelivered?: WhatsAppNotificationTemplate;
}

// ─── Product Management ──────────────────────────────────────────────────

export interface ProductCategory {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  parentId?: string; // For subcategories
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  sku: string;
  name: string;
  price: number;
  compareAtPrice?: number; // Was price / MSRP
  salePrice?: number; // Discounted price for Google Shopping "Sale" badge — when set, this is the price the customer pays
  stockQuantity: number;
  lowStockThreshold: number;
  isActive: boolean;
  attributes: ProductVariantAttribute[];
  // Pack sales configuration
  packSize?: number; // Number of units per pack (e.g., 5 means "sell in packs of 5")
  packPrice?: number; // Price per pack (if different from price * packSize)
}

export interface ProductVariantAttribute {
  name: string; // e.g., "Color", "Size", "Model"
  value: string; // e.g., "Red", "Large", "XL-2500"
}

export interface ProductImage {
  id: string;
  url: string;
  alt: string;
  sortOrder: number;
  isDefault: boolean;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  shortDescription?: string;
  sku: string; // Base SKU
  categoryIds: string[];
  images: ProductImage[];
  variants: ProductVariant[];
  isActive: boolean;
  isFeatured: boolean;
  brand?: string;
  tags: string[];
  seoTitle?: string;
  seoDescription?: string;
  weight?: number; // in grams
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

// ─── Inventory Management ────────────────────────────────────────────────

export interface StockMovement {
  id: string;
  productVariantId: string;
  type: 'in' | 'out' | 'adjustment' | 'reserved' | 'returned';
  quantity: number;
  reason: string;
  reference?: string; // Order ID, supplier invoice, etc.
  cost?: number; // For cost tracking
  performedBy: string;
  timestamp: string;
  notes?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  paymentTerms: string;
  isActive: boolean;
  createdAt: string;
}

export interface PurchaseOrderItem {
  productVariantId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  items: PurchaseOrderItem[];
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  status: 'draft' | 'sent' | 'confirmed' | 'received' | 'cancelled';
  expectedDate?: string;
  receivedDate?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

// ─── Customer Management ─────────────────────────────────────────────────

export interface CustomerAddress {
  id: string;
  type: 'billing' | 'shipping';
  firstName: string;
  lastName: string;
  company?: string;
  streetAddress: string;
  streetAddress2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  phone?: string;
  isDefault: boolean;
}

export interface Customer {
  id: string; // Firebase Auth UID
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  dateOfBirth?: string;
  addresses: CustomerAddress[];
  isActive: boolean;
  acceptsMarketing: boolean;
  totalSpent: number;
  orderCount: number;
  averageOrderValue: number;
  lastOrderDate?: string;
  customerSince: string;
  notes?: string;
  tags: string[];
}

// ─── Shopping & Orders ───────────────────────────────────────────────────

export interface CartItem {
  productVariantId: string;
  quantity: number;
  price: number; // Price at time of adding to cart
}

export interface ShippingMethod {
  id: string;
  name: string;
  description: string;
  price: number;
  estimatedDays: number;
  isActive: boolean;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'paypal' | 'payfast' | 'eft' | 'cash_on_delivery';
  name: string;
  isActive: boolean;
  processingFee?: number;
}

export interface OrderLineItem {
  id: string;
  productVariantId: string;
  productName: string;
  variantName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  image?: string;
}

export interface OrderShipping {
  method: ShippingMethod;
  address: CustomerAddress;
  cost: number;
  trackingNumber?: string;
  carrierName?: string;
  estimatedDelivery?: string;
  actualDelivery?: string;
}

export interface OrderPayment {
  method: PaymentMethod;
  amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
  transactionId?: string;
  gateway?: string;
  processedAt?: string;
  refundedAt?: string;
  refundReason?: string;
}

export type OrderStatus = 
  | 'pending'        // Payment pending
  | 'processing'     // Payment confirmed, preparing order  
  | 'shipped'        // Order shipped
  | 'delivered'      // Order delivered
  | 'completed'      // Order completed
  | 'cancelled'      // Order cancelled
  | 'refunded';      // Order refunded

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  customerEmail: string;
  
  // Order Items
  lineItems: OrderLineItem[];
  
  // Pricing
  subtotal: number;
  discount: number;
  tax: number;
  shipping: number;
  total: number;
  
  // Status & Timeline
  status: OrderStatus;
  orderDate: string;
  updatedAt: string;
  
  // Shipping & Payment
  shippingDetails?: OrderShipping;
  paymentDetails: OrderPayment;
  billingAddress: CustomerAddress;
  
  // Additional Info
  notes?: string;
  customerNotes?: string;
  internalNotes?: string;
  
  // Tracking
  fulfillmentStatus: 'pending' | 'partial' | 'fulfilled' | 'cancelled';
  
  // Communications
  emailNotifications: {
    orderConfirmation: boolean;
    shippingNotification: boolean;
    deliveryNotification: boolean;
  };
}

// ─── Analytics & Reporting ───────────────────────────────────────────────

export interface SalesAnalytics {
  period: string; // ISO date or period identifier
  totalSales: number;
  totalOrders: number;
  averageOrderValue: number;
  conversionRate: number;
  topProducts: Array<{
    productId: string;
    productName: string;
    quantity: number;
    revenue: number;
  }>;
  newCustomers: number;
  returningCustomers: number;
}

export interface InventoryAlert {
  id: string;
  type: 'low_stock' | 'out_of_stock' | 'overstock';
  productVariantId: string;
  productName: string;
  variantName: string;
  currentStock: number;
  threshold: number;
  createdAt: string;
  isRead: boolean;
  isResolved: boolean;
}

// ─── Discounts & Promotions ──────────────────────────────────────────────

export interface DiscountRule {
  id: string;
  code: string;
  name: string;
  description?: string;
  type: 'percentage' | 'fixed_amount' | 'free_shipping' | 'buy_x_get_y';
  value: number;
  minimumAmount?: number;
  usageLimit?: number;
  usageCount: number;
  perCustomerLimit?: number;
  startDate: string;
  endDate?: string;
  isActive: boolean;
  applicableProducts?: string[]; // Product IDs
  applicableCategories?: string[]; // Category IDs
  createdBy: string;
  createdAt: string;
}

// ─── Extended Workspace State ────────────────────────────────────────────

export interface EcommerceWorkspaceExtension {
  // Product Catalog
  categories: ProductCategory[];
  products: Product[];
  suppliers: Supplier[];
  
  // Inventory
  stockMovements: StockMovement[];
  purchaseOrders: PurchaseOrder[];
  inventoryAlerts: InventoryAlert[];
  
  // Customer Management
  customers: Customer[];
  
  // Order Management
  orders: Order[];
  orderCounter: number;
  
  // Configuration
  shippingMethods: ShippingMethod[];
  paymentMethods: PaymentMethod[];
  discountRules: DiscountRule[];
  
  // Settings
  storeSettings: {
    storeName: string;
    storeDescription: string;
    storeEmail: string;
    storePhone: string;
    storeAddress: string;
    currency: string;
    timezone: string;
    taxRate: number;
    enableInventoryTracking: boolean;
    lowStockThreshold: number;
    autoFulfillDigitalProducts: boolean;
  };
  
  // Analytics
  salesAnalytics: SalesAnalytics[];
}

// ─── Public Store Types ──────────────────────────────────────────────────

export interface PublicProduct {
  id: string;
  name: string;
  description: string;
  shortDescription?: string;
  images: ProductImage[];
  variants: Array<{
    id: string;
    sku: string;
    name: string;
    price: number;
    compareAtPrice?: number;
    salePrice?: number;
    inStock: boolean;
    attributes: ProductVariantAttribute[];
    packSize?: number;
    packPrice?: number;
  }>;
  brand?: string;
  category: string;
  subcategory?: string;
  voltageRange?: string;
  amperageRange?: string;
  rdson?: string;
  vbe?: string;
  tags: string[];
  quantityInStock?: number;
  averageRating?: number;
  reviewCount?: number;
  status?: string;
}

export interface PublicCategory {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  productCount: number;
  subcategories?: PublicCategory[];
}

export interface CartState {
  items: CartItem[];
  subtotal: number;
  itemCount: number;
  lastUpdated: string;
}

export interface CheckoutState {
  step: 'cart' | 'shipping' | 'payment' | 'review' | 'complete';
  cart: CartState;
  customer: Customer | null;
  shippingAddress: CustomerAddress | null;
  billingAddress: CustomerAddress | null;
  shippingMethod: ShippingMethod | null;
  paymentMethod: PaymentMethod | null;
  appliedDiscounts: DiscountRule[];
  total: number;
}

// ─── API Response Types ──────────────────────────────────────────────────

export interface ProductSearchResult {
  products: PublicProduct[];
  categories: PublicCategory[];
  totalProducts: number;
  currentPage: number;
  totalPages: number;
  filters: {
    categories: string[];
    brands: string[];
    priceRange: { min: number; max: number; };
    inStock: boolean;
  };
}

export interface OrderConfirmation {
  orderId: string;
  orderNumber: string;
  total: number;
  estimatedDelivery?: string;
  trackingInfo?: {
    carrier: string;
    trackingNumber: string;
    trackingUrl: string;
  };
}

// ─── Ecommerce Settings ──────────────────────────────────────────────────

export interface DeliveryZone {
  id: string;
  name: string;
  description?: string;
  fee: number;
  isActive: boolean;
  // Optional: Add area codes, regions, or radius
  areaCodes?: string[];
  suburbs?: string[];
  minOrderAmount?: number; // Free delivery above this amount
}

export interface EcommerceSettings {
  // Delivery Settings
  enableDelivery: boolean;
  defaultDeliveryFee: number;
  deliveryZones: DeliveryZone[];
  freeDeliveryThreshold?: number; // Free delivery above this amount
  
  // Pickup Settings
  enablePickup: boolean;
  pickupLocations: Array<{
    name: string;
    address: string;
    phone: string;
    hours: string;
  }>;
  
  // Payment Settings
  enableCashOnDelivery: boolean;
  enableCardPayments: boolean;
  ikhokhaAppId?: string;
  ikhokhaAppSecret?: string;
  // Additional payment gateways (payfast, yoco, stripe, eft, ozow, snapscan).
  // iKhokha + cash keep using the fields above for backward compatibility.
  paymentMethods?: Record<string, { enabled?: boolean; [field: string]: string | boolean | undefined }>;
  
  // Store Settings
  storeName: string;
  storeTagline?: string; // short line shown under the store name in the header
  storeEmail: string;
  storePhone: string;
  storeWhatsApp?: string;
  storeAddress: string;

  // Store Design / template
  storeTemplate?: string;   // 'classic' | 'showcase' | 'boutique' | 'bold' | 'catalog'
  accentColor?: string;     // overrides the template's default accent
  heroHeight?: string;      // 'compact' | 'standard' | 'tall' | 'full'
  heroSlides?: Array<{
    image: string;                              // background image URL
    imagePosition?: string;                     // CSS object-position: "top" | "center" | "bottom"
    overlayImage?: string;                      // foreground model / product cutout
    overlayPosition?: "left" | "right" | "center"; // where the overlay sits horizontally
    overlaySize?: number;                       // overlay height as % of slide (30–100, default 90)
    bgColor?: string;                           // solid colour fallback if no image
    heading?: string;
    subheading?: string;
    ctaText?: string;                           // button label (scrolls to products)
  }>;

  // Product Card Display Options
  showBrand: boolean;       // show supplier/brand on cards
  showQuantity: boolean;    // show qty available on cards
  showSku: boolean;         // show SKU/part number on cards
  enableSimilarParts?: boolean;    // show "Find Similar Parts" button on product detail pages
  similarPartsThreshold?: number;  // 0–100: minimum spec/tag overlap % to show a part as similar (default 30)
  
  // Tax Settings
  taxRate: number;
  taxIncluded: boolean;
  
  // Order Settings
  minOrderAmount?: number;
  maxOrderAmount?: number;
  
  // Notification Settings
  sendOrderConfirmationEmail: boolean;
  sendOrderStatusUpdates: boolean;

  // WhatsApp Notification Templates
  whatsappNotifications?: WhatsAppNotifications;

  // Public-facing policy text (Markdown-ish — rendered on /shipping-policy and /returns-policy).
  // Required by Google Merchant Center store quality scoring.
  shippingPolicy?: string;
  returnsPolicy?: string;
  businessHours?: string; // e.g. "Mon–Sat 8am–5pm, closed Sun"

  // Optional services section shown below the product grid on the public store
  servicesEnabled?: boolean;
  servicesBadge?: string;    // small label above title e.g. "Repair Services"
  servicesTitle?: string;    // heading e.g. "Audio Repair Experts"
  servicesSubtitle?: string; // one-paragraph description
  services?: Array<{
    title: string;
    description: string;
    bullets: string[];       // newline-separated bullet points
  }>;
  servicesCtaText?: string;  // button label e.g. "Book a Repair Assessment"
  servicesCtaPhone?: string; // phone for the CTA button

  // Courier integration (ShipLogic / Fastway)
  shiplogicApiKey?: string;
  shiplogicSenderStreet?: string;
  shiplogicSenderSuburb?: string;
  shiplogicSenderCity?: string;
  shiplogicSenderPostalCode?: string;
  shiplogicSenderCompany?: string;
  shiplogicEnabled?: boolean;
  shiplogicMarkupPercent?: number;

  updatedAt: string;
  updatedBy: string;
}

export const DEFAULT_ECOMMERCE_SETTINGS: EcommerceSettings = {
  enableDelivery: true,
  defaultDeliveryFee: 85,
  deliveryZones: [],
  enablePickup: true,
  pickupLocations: [],
  enableCashOnDelivery: false,
  enableCardPayments: true,
  ikhokhaAppId: '',
  ikhokhaAppSecret: '',
  paymentMethods: {},
  storeName: '',
  storeEmail: '',
  storePhone: '',
  storeWhatsApp: '',
  storeAddress: '',
  storeTemplate: 'classic',
  accentColor: '',
  heroHeight: 'standard',
  heroSlides: [],
  showBrand: false,
  showQuantity: true,
  showSku: true,
  enableSimilarParts: false,
  similarPartsThreshold: 30,
  taxRate: 15,
  taxIncluded: true,
  sendOrderConfirmationEmail: true,
  sendOrderStatusUpdates: true,
  shippingPolicy: `Pickup is free from our shop at [your shop address] during business hours ([your business hours]).

Local delivery is a flat [your delivery fee] within the metro area, taking 2–3 business days from payment.

Orders placed before 2pm on a business day are usually packed the same day. For areas outside the metro, contact us on [your phone / WhatsApp] for a courier quote.

Damaged or missing items must be reported within 48 hours of receipt with a photo and order number.`,
  returnsPolicy: `7-day return window from the date you receive your order.

Items must be unused, in their original unopened packaging, and have proof of purchase. Items damaged through misuse or incorrect installation cannot be returned. Custom or special-order items are non-returnable.

To return an item, contact us on [your phone / WhatsApp] or email [your email] with your order number. We'll confirm whether the item qualifies and issue a return reference number. Return shipping is at your cost unless the item was damaged or incorrect.

Refunds are issued to the original payment method within 5 business days of inspection. EFT refunds clear in 1–3 business days; card refunds can take up to 7 days.

If your order arrives damaged or wrong, contact us within 48 hours and we'll arrange a replacement or full refund at no cost to you.

This policy is offered in addition to your rights under the Consumer Protection Act, 2008 (South Africa).`,
  businessHours: '',
  shiplogicEnabled: false,
  shiplogicApiKey: '',
  shiplogicSenderStreet: '',
  shiplogicSenderSuburb: '',
  shiplogicSenderCity: '',
  shiplogicSenderPostalCode: '',
  shiplogicSenderCompany: '',
  shiplogicMarkupPercent: 0,
  updatedAt: new Date().toISOString(),
  updatedBy: '',
};