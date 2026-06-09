import { Quote, Invoice, QuoteLineItem, Payment, Task, CustomFieldValue } from "@/types/crm";

/**
 * Service for managing quotes and invoices within the workspace state.
 * These are stored in the workspace document alongside tasks.
 */

/** Generate next quote number */
export function generateQuoteNumber(counter: number): string {
  return `QT-${String(counter).padStart(4, '0')}`;
}

/** Generate next invoice number */
export function generateInvoiceNumber(counter: number): string {
  return `INV-${String(counter).padStart(4, '0')}`;
}

/** 
 * Convert a task to a quote by extracting customer info from custom fields
 * and creating line items from the task title/description 
 */
export function createQuoteFromTask(
  task: Task,
  counter: number,
  userId: string,
  customFields: Array<{ id: string; name: string; type: string }>
): Quote {
  // Extract customer info from custom fields
  const getFieldValue = (fieldId: string): string => {
    const val = task.customFieldValues.find(v => v.fieldId === fieldId);
    return val ? String(val.value) : "";
  };

  // Find potential customer name, email, phone fields
  const nameField = customFields.find(f => 
    f.name.toLowerCase().includes("name") || f.name.toLowerCase().includes("customer")
  );
  const emailField = customFields.find(f => f.type === "email");
  const phoneField = customFields.find(f => f.type === "phone");

  const customerName = nameField ? getFieldValue(nameField.id) : "Customer";
  const customerEmail = emailField ? getFieldValue(emailField.id) : undefined;
  const customerPhone = phoneField ? getFieldValue(phoneField.id) : undefined;

  // Create a default line item from the task
  const lineItem: QuoteLineItem = {
    id: `li${Date.now()}`,
    description: task.title + (task.description ? ` - ${task.description}` : ""),
    quantity: 1,
    rate: 0, // User will fill this in
    amount: 0,
  };

  const now = new Date().toISOString();
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  return {
    id: `qt${Date.now()}`,
    quoteNumber: generateQuoteNumber(counter),
    taskId: task.id,
    customerName,
    customerEmail,
    customerPhone,
    lineItems: [lineItem],
    subtotal: 0,
    taxRate: 0.15, // 15% default
    taxAmount: 0,
    total: 0,
    notes: `Quote for: ${task.jobNumber || task.id}`,
    status: "draft",
    validUntil,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
}

/** Calculate quote totals based on line items */
export function calculateQuoteTotals(lineItems: QuoteLineItem[], taxRate: number): {
  subtotal: number;
  taxAmount: number;
  total: number;
} {
  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = subtotal * taxRate;
  const total = subtotal + taxAmount;
  return { subtotal, taxAmount, total };
}

/** Convert a quote to an invoice */
export function createInvoiceFromQuote(
  quote: Quote,
  counter: number,
  dueDate?: string
): Invoice {
  const now = new Date().toISOString();
  const dueDateStr = dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    id: `inv${Date.now()}`,
    invoiceNumber: generateInvoiceNumber(counter),
    quoteId: quote.id,
    taskId: quote.taskId,
    customerName: quote.customerName,
    customerEmail: quote.customerEmail,
    customerPhone: quote.customerPhone,
    lineItems: [...quote.lineItems], // Copy line items
    subtotal: quote.subtotal,
    taxRate: quote.taxRate,
    taxAmount: quote.taxAmount,
    total: quote.total,
    amountPaid: 0,
    balanceDue: quote.total,
    payments: [],
    notes: quote.notes,
    status: "draft",
    paymentStatus: "unpaid",
    dueDate: dueDateStr,
    createdBy: quote.createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

/** Record a payment on an invoice */
export function recordPayment(
  invoice: Invoice,
  amount: number,
  method: string,
  userId: string,
  notes?: string
): Invoice {
  const payment: Payment = {
    id: `pay${Date.now()}`,
    amount,
    method,
    notes,
    paidAt: new Date().toISOString(),
    recordedBy: userId,
  };

  const newAmountPaid = invoice.amountPaid + amount;
  const newBalanceDue = invoice.total - newAmountPaid;

  let paymentStatus: Invoice["paymentStatus"] = "unpaid";
  if (newAmountPaid >= invoice.total) {
    paymentStatus = "paid";
  } else if (newAmountPaid > 0) {
    paymentStatus = "partial";
  }

  const status = paymentStatus === "paid" ? "paid" : invoice.status;
  const paidAt = paymentStatus === "paid" ? new Date().toISOString() : invoice.paidAt;

  return {
    ...invoice,
    amountPaid: newAmountPaid,
    balanceDue: newBalanceDue,
    payments: [...(invoice.payments || []), payment],
    paymentStatus,
    status,
    paidAt,
    updatedAt: new Date().toISOString(),
  };
}

/** Format currency for display */
export function formatCurrency(amount: number, currency: string = "ZAR"): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
  }).format(amount);
}
