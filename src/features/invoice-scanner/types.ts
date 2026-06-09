/**
 * Invoice Scanner Feature - Type Definitions
 * Isolated from main codebase to prevent conflicts
 */

export interface ScannedInvoiceData {
  /** Extracted company/vendor name */
  companyName: string;
  /** Extracted invoice number */
  invoiceNumber: string;
  /** Extracted date (ISO string) */
  date: string;
  /** Extracted total amount */
  totalAmount: number;
  /** Extracted subtotal if available */
  subtotal?: number;
  /** Extracted tax/VAT if available */
  taxAmount?: number;
  /** Extracted line items */
  lineItems: InvoiceLineItem[];
  /** Raw text extracted from OCR */
  rawText: string;
  /** Confidence score (0-100) */
  confidence: number;
}

export interface InvoiceLineItem {
  /** Item description */
  description: string;
  /** Quantity */
  quantity: number;
  /** Unit price */
  unitPrice: number;
  /** Total for this line */
  amount: number;
}

export interface ExpenseAccount {
  id: string;
  name: string;
  category: string;
}

export interface ExpenseEntry {
  id: string;
  vendorName: string;
  invoiceNumber: string;
  amount: number;
  date: string;
  category: string;
  accountId: string;
  notes: string;
  imageUrl?: string;
  createdAt: string;
}

export type OCRProcessingStatus = 'idle' | 'loading' | 'processing' | 'success' | 'error';

export interface OCRResult {
  success: boolean;
  data?: ScannedInvoiceData;
  error?: string;
}