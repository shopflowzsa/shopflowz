// ═══════════════════════════════════════════════════════════════════════════
// INVOICE & CUSTOMER TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

// ─── Customer Management ─────────────────────────────────────────────────

export interface CustomerAddress {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface Customer {
  id: string;
  customerNumber: string; // Auto-generated: CUST00001
  companyName?: string;
  contactPerson: string;
  email: string;
  phone: string;
  mobile?: string;
  website?: string;
  
  // Addresses
  billingAddress: CustomerAddress;
  shippingAddress?: CustomerAddress;
  
  // Business details
  taxNumber?: string; // VAT/Tax ID
  vatEnabled?: boolean; // Per-customer VAT override (undefined = follow global default)
  paymentTerms: 'net-15' | 'net-30' | 'net-45' | 'due-on-receipt' | 'custom';
  customPaymentTerms?: string;
  creditLimit?: number;
  currency: string;
  
  // Financial tracking
  totalInvoiced: number;
  totalPaid: number;
  outstandingBalance: number;
  
  // Metadata
  notes?: string;
  tags: string[];
  status: 'active' | 'inactive';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Invoice Management ──────────────────────────────────────────────────

export interface InvoiceLineItem {
  id: string;
  productId?: string;
  productName: string;
  sku?: string;
  description?: string;
  quantity: number;
  price: number;
  total: number;
  serviceDate?: string;
  taxRate?: number;
  taxAmount?: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string; // Auto-generated: INV00001
  
  // Customer info
  customerId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  ccEmails?: string;
  bccEmails?: string;
  
  // Addresses
  billingAddress?: CustomerAddress;
  shippingAddress?: CustomerAddress;
  
  // Dates and terms
  invoiceDate: string;
  dueDate: string;
  terms: 'due-on-receipt' | 'net-15' | 'net-30' | 'net-60' | 'custom';
  customTerms?: string;
  
  // Shipping info
  shipVia?: string;
  shippingDate?: string;
  trackingNumber?: string;
  purchaseOrder?: string;
  
  // Line items
  items: InvoiceLineItem[];
  
  // Financial calculations
  subtotal: number;
  discountPercent?: number;
  discountAmount?: number;
  shippingCost?: number;
  tax: number;
  taxRate?: number;
  total: number;
  deposit?: number;
  amountPaid: number;
  balanceDue: number;
  
  // Messages
  messageOnInvoice?: string;
  messageOnStatement?: string;
  notes?: string;
  
  // Status tracking
  status: 'draft' | 'sent' | 'viewed' | 'partial' | 'paid' | 'overdue' | 'cancelled';
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  
  // Metadata
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sentDate?: string;
  paidDate?: string;
  class?: string;
}

// ─── Payment Tracking ─────────────────────────────────────────────────────

export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  
  amount: number;
  paymentMethod: 'cash' | 'card' | 'bank-transfer' | 'cheque' | 'other';
  reference?: string;
  notes?: string;
  
  paymentDate: string;
  createdBy: string;
  createdAt: string;
}

// ─── Quotation Management ────────────────────────────────────────────────

export interface Quotation {
  id: string;
  quotationNumber: string; // Auto-generated: QUO00001
  
  customerId: string;
  customerName: string;
  customerCompanyName?: string;
  customerContactName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAccountNumber?: string;
  billingAddress?: CustomerAddress;
  shippingAddress?: CustomerAddress;
  
  items: InvoiceLineItem[];
  
  subtotal: number;
  discountPercent?: number;
  discountAmount?: number;
  taxRate?: number;
  tax: number;
  total: number;
  deposit?: number;      // Amount already paid / deposit received
  balanceDue?: number;  // total - deposit
  
  validUntil: string;
  terms?: string;
  notes?: string;
  
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
  
  // Conversion tracking
  convertedToInvoiceId?: string;
  convertedDate?: string;
  
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Counters ─────────────────────────────────────────────────────────────

export interface Counter {
  value: number;
}
