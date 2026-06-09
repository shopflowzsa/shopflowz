import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { Invoice, InvoiceLineItem, Payment } from "@/types/invoice";
import { generateInvoiceNumber } from "@/lib/counterService";
import { createInvoiceStockMovements } from "@/lib/stockMovementService";
import { logActivity } from "@/lib/activityTrackingService";

type InvoiceStatus = Invoice["status"];
type PaymentMethod = Payment["paymentMethod"];

/**
 * Recursively remove undefined fields so Firestore doesn't throw
 * "Unsupported field value: undefined"
 */
function stripUndefined<T>(obj: T): T {
  if (Array.isArray(obj)) return obj.map(stripUndefined) as unknown as T;
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as object)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)])
    ) as T;
  }
  return obj;
}

/**
 * Calculate invoice totals
 */
function calculateInvoiceTotals(
  lineItems: InvoiceLineItem[],
  taxRate: number = 0,
  discountPercent: number = 0
) {
  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const discountAmount = (subtotal * discountPercent) / 100;
  const taxableAmount = subtotal - discountAmount;
  const taxAmount = (taxableAmount * taxRate) / 100;
  const total = taxableAmount + taxAmount;

  return {
    subtotal,
    discountAmount,
    taxAmount,
    total,
  };
}

/**
 * Determine invoice status based on payments
 */
function determinePaymentStatus(total: number, amountPaid: number): Invoice["paymentStatus"] {
  if (amountPaid === 0) return "unpaid";
  if (amountPaid >= total) return "paid";
  return "partial";
}

/**
 * Create a new invoice
 */
export async function createInvoice(
  workspaceId: string,
  userId: string,
  userName: string,
  invoiceData: {
    customerId: string;
    customerName: string;
    customerEmail?: string;
    customerPhone?: string;
    items: Omit<InvoiceLineItem, "id">[];
    taxRate?: number;
    discountPercent?: number;
    notes?: string;
    dueDate: string;
    terms?: Invoice["terms"];
    purchaseOrder?: string;
    amountPaid?: number;
    invoiceNumber?: string; // Optional override — uses job number when creating from a task
  }
): Promise<Invoice> {
  try {
    // Use provided number (e.g. job number) or auto-generate
    const invoiceNumber = invoiceData.invoiceNumber || await generateInvoiceNumber(workspaceId);

    // Add IDs to line items and calculatetotals
    const items: InvoiceLineItem[] = invoiceData.items.map((item, index) => stripUndefined({
      ...item,
      id: `item_${Date.now()}_${index}`,
      total: item.quantity * item.price,
    }));

    const taxRate = invoiceData.taxRate ?? 0;
    const discountPercent = invoiceData.discountPercent ?? 0;

    const { subtotal, discountAmount, taxAmount, total } = calculateInvoiceTotals(
      items,
      taxRate,
      discountPercent
    );

    const now = new Date().toISOString();

    const invoice: Omit<Invoice, "id"> = {
      invoiceNumber,
      customerId: invoiceData.customerId,
      customerName: invoiceData.customerName,
      ...(invoiceData.customerEmail && { customerEmail: invoiceData.customerEmail }),
      ...(invoiceData.customerPhone && { customerPhone: invoiceData.customerPhone }),
      ...(invoiceData.purchaseOrder ? { purchaseOrder: invoiceData.purchaseOrder } : {}),
      items,
      subtotal,
      discountPercent,
      discountAmount,
      taxRate,
      tax: taxAmount,
      total,
      amountPaid: invoiceData.amountPaid ?? 0,
      balanceDue: total - (invoiceData.amountPaid ?? 0),
      status: "draft",
      paymentStatus: determinePaymentStatus(total, invoiceData.amountPaid ?? 0),
      invoiceDate: now.split('T')[0],
      dueDate: invoiceData.dueDate,
      terms: invoiceData.terms || 'net-30',
      ...(invoiceData.notes && { notes: invoiceData.notes }),
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    };

    // Save to Supabase
    const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const createdInvoice = { ...invoice, id };
    await supabaseServiceRole.from('invoices').insert({ id, workspace_id: workspaceId, data: stripUndefined(invoice) });

    logActivity(workspaceId, userId, 'invoice_created', 'invoice', id, invoiceNumber, {
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      total,
    });

    // Create stock movements for inventory items (runs after invoice creation)
    // This will automatically deduct stock quantities
    try {
      // Build a map of inventory items with packSize for quick lookup
      const inventoryMap = new Map<string, { packSize?: number; packPrice?: number }>();
      for (const item of items) {
        if (item.productId) {
          // Get inventory item data from Supabase
          const { data: invRow } = await supabase
            .from('inventory')
            .select('data')
            .eq('id', item.productId)
            .single();
          if (invRow?.data) {
            inventoryMap.set(item.productId, {
              packSize: (invRow.data as any).packSize,
              packPrice: (invRow.data as any).packPrice,
            });
          }
        }
      }
    
      await createInvoiceStockMovements(
        workspaceId,
        userId,
        userName,
        createdInvoice.id,
        invoiceNumber,
        items.map(item => ({
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          packSize: inventoryMap.get(item.productId || '')?.packSize,
        }))
      );
    } catch (stockErr) {
      console.error('[Invoice] Stock sync failed - inventory may be out of sync:', stockErr);
    }

    return createdInvoice;
  } catch (error) {
    console.error("Error creating invoice:", error);
    throw new Error("Failed to create invoice");
  }
}

/**
 * Add payment to invoice and update customer financials
 */
export async function addPaymentToInvoice(
  workspaceId: string,
  invoiceId: string,
  userId: string,
  paymentData: {
    amount: number;
    paymentMethod: PaymentMethod;
    reference?: string;
    notes?: string;
  }
): Promise<Invoice> {
  try {
    // Read invoice
    const { data: invoiceRow, error: invoiceRowError } = await supabase.from('invoices').select('id, data').eq('id', invoiceId).single();
    if (invoiceRowError) throw new Error('DB error: ' + invoiceRowError.message);
    if (!invoiceRow) throw new Error('Invoice not found');
    const invoice = { id: invoiceRow.id, ...(invoiceRow.data as any) } as Invoice;

    // Create payment record
    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const payment: Payment = {
      id: paymentId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      amount: paymentData.amount,
      paymentMethod: paymentData.paymentMethod,
      reference: paymentData.reference,
      notes: paymentData.notes,
      paymentDate: new Date().toISOString().split('T')[0],
      createdBy: userId,
      createdAt: new Date().toISOString(),
    };
    await supabaseServiceRole.from('payments').insert({ id: paymentId, workspace_id: workspaceId, data: payment });

    // Update invoice
    const amountPaid = invoice.amountPaid + paymentData.amount;
    const balanceDue = invoice.total - amountPaid;
    const paymentStatus = determinePaymentStatus(invoice.total, amountPaid);
    const status = paymentStatus === 'paid' ? 'paid' : invoice.status;
    const updates: Partial<Invoice> = {
      amountPaid, balanceDue, paymentStatus, status,
      updatedAt: new Date().toISOString(),
      ...(paymentStatus === 'paid' && { paidDate: new Date().toISOString() }),
    };
    const mergedInvoice = { ...(invoiceRow.data as any), ...updates };
    await supabaseServiceRole.from('invoices').update({ data: mergedInvoice }).eq('id', invoiceId);

    // Update customer financials (non-reserved IDs only)
    const isReservedCustomer = /^__.*__$/.test(invoice.customerId);
    if (!isReservedCustomer) {
      try {
        const { data: custRow } = await supabase.from('customers').select('data').eq('workspace_id', workspaceId).eq('id', invoice.customerId).single();
        if (custRow) {
          const custData = custRow.data as any;
          const mergedCust = {
            ...custData,
            totalPaid: (custData.totalPaid || 0) + paymentData.amount,
            outstandingBalance: (custData.outstandingBalance || 0) - paymentData.amount,
            updatedAt: new Date().toISOString(),
          };
          await supabaseServiceRole.from('customers').update({ data: mergedCust }).eq('id', invoice.customerId);
        }
      } catch (balanceError) {
        console.error('[CRITICAL] Payment recorded but customer balance not updated - manual reconciliation needed for invoice:', invoiceId, balanceError);
      }
    }

    logActivity(workspaceId, userId, 'payment_recorded', 'payment', paymentId, invoice.invoiceNumber, {
      invoiceId,
      customerId: invoice.customerId,
      amount: paymentData.amount,
      paymentMethod: paymentData.paymentMethod,
      paymentStatus,
    });
    if (paymentStatus === 'paid') {
      logActivity(workspaceId, userId, 'invoice_paid', 'invoice', invoiceId, invoice.invoiceNumber, {
        customerId: invoice.customerId,
        total: invoice.total,
      });
    }

    return { ...invoice, ...updates };
  } catch (error) {
    console.error('Error adding payment:', error);
    throw new Error('Failed to add payment');
  }
}

/**
 * Get invoice by ID
 */
export async function getInvoiceById(
  workspaceId: string,
  invoiceId: string
): Promise<Invoice | null> {
  try {
    const { data } = await supabase.from('invoices').select('id, data').eq('id', invoiceId).single();
    if (!data) return null;
    return { id: data.id, ...(data.data as any) } as Invoice;
  } catch (error) {
    console.error('Error fetching invoice:', error);
    return null;
  }
}

/**
 * Get all invoices for a workspace
 */
export async function getInvoices(workspaceId: string): Promise<Invoice[]> {
  try {
    const { data } = await supabase
      .from('invoices')
      .select('id, data')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    return (data || []).map(r => ({ id: r.id, ...(r.data as any) })) as Invoice[];
  } catch (error) {
    console.error('Error fetching invoices:', error);
    throw new Error('Failed to fetch invoices');
  }
}

/**
 * Get invoices for a specific customer
 */
export async function getCustomerInvoices(
  workspaceId: string,
  customerId: string
): Promise<Invoice[]> {
  try {
    const all = await getInvoices(workspaceId);
    return all.filter(inv => inv.customerId === customerId);
  } catch (error) {
    console.error('Error fetching customer invoices:', error);
    throw new Error('Failed to fetch customer invoices');
  }
}

/**
 * Update invoice status
 */
export async function updateInvoiceStatus(
  workspaceId: string,
  invoiceId: string,
  status: InvoiceStatus
): Promise<void> {
  try {
    await updateInvoice(workspaceId, invoiceId, { status });
  } catch (error) {
    console.error('Error updating invoice status:', error);
    throw new Error('Failed to update invoice status');
  }
}

/**
 * Update invoice
 */
export async function updateInvoice(
  workspaceId: string,
  invoiceId: string,
  updates: Partial<Invoice>
): Promise<void> {
  try {
    const { data: existing, error: existingError } = await supabase.from('invoices').select('data').eq('id', invoiceId).single();
    if (existingError) throw new Error('DB error: ' + existingError.message);
    const merged = stripUndefined({ ...(existing?.data as any || {}), ...updates, updatedAt: new Date().toISOString() });
    await supabaseServiceRole.from('invoices').update({ data: merged }).eq('id', invoiceId);
  } catch (error) {
    console.error('Error updating invoice:', error);
    throw new Error('Failed to update invoice');
  }
}

/**
 * Delete invoice (soft delete by updating status)
 */
export async function deleteInvoice(
  workspaceId: string,
  invoiceId: string
): Promise<void> {
  try {
    await updateInvoice(workspaceId, invoiceId, { status: 'cancelled' as InvoiceStatus });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    throw new Error('Failed to delete invoice');
  }
}

export async function deleteInvoicePermanently(
  workspaceId: string,
  invoiceId: string
): Promise<void> {
  try {
    await supabaseServiceRole.from('invoices').delete().eq('id', invoiceId);
  } catch (error) {
    console.error('Error permanently deleting invoice:', error);
    throw new Error('Failed to delete invoice');
  }
}

/**
 * Get invoice analytics for dashboard
 */
export async function getInvoiceAnalytics(workspaceId: string) {
  try {
    const invoices = await getInvoices(workspaceId);

    const totalInvoices = invoices.length;
    const totalRevenue = invoices.reduce((sum, inv) => sum + inv.total, 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + inv.amountPaid, 0);
    const totalOutstanding = invoices.reduce((sum, inv) => sum + inv.balanceDue, 0);
    const paidInvoices = invoices.filter((inv) => inv.paymentStatus === 'paid').length;
    const unpaidInvoices = invoices.filter((inv) => inv.paymentStatus === 'unpaid').length;
    const partialInvoices = invoices.filter((inv) => inv.paymentStatus === 'partial').length;
    const overdueInvoices = invoices.filter(
      (inv) => inv.paymentStatus !== 'paid' && inv.dueDate && new Date(inv.dueDate) < new Date()
    ).length;

    return { totalInvoices, totalRevenue, totalPaid, totalOutstanding, paidInvoices, unpaidInvoices, partialInvoices, overdueInvoices };
  } catch (error) {
    console.error('Error fetching invoice analytics:', error);
    throw new Error('Failed to fetch invoice analytics');
  }
}