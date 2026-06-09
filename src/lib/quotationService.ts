/**
 * Quotation Service
 * Manages quotations/estimates with customer tracking and invoice conversion
 */

import { supabase, supabaseServiceRole } from './supabase';
import { Quotation, InvoiceLineItem, Invoice } from '@/types/invoice';
import { generateQuotationNumber } from './counterService';
import { createInvoice } from './invoiceService';
import { logActivity } from './activityTrackingService';

/**
 * Recursively remove undefined fields so Firestore doesn't throw
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
 * Calculate quotation totals
 */
function calculateQuotationTotals(
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
 * Create a new quotation
 */
export async function createQuotation(
  workspaceId: string,
  userId: string,
  quotationData: {
    customerId: string;
    customerName: string;
    customerCompanyName?: string;
    customerContactName?: string;
    customerEmail?: string;
    customerPhone?: string;
    billingAddress?: import('@/types/invoice').CustomerAddress;
    shippingAddress?: import('@/types/invoice').CustomerAddress;
    customerAccountNumber?: string;
    items: Omit<InvoiceLineItem, 'id'>[];
    taxRate?: number;
    discountPercent?: number;
    validUntil: string; // Date string
    terms?: string;
    notes?: string;
    quotationNumber?: string; // Optional override — uses job number when creating from a task
    deposit?: number; // Amount already paid
  }
): Promise<Quotation> {
  try {
    const quotationNumber = quotationData.quotationNumber || await generateQuotationNumber(workspaceId);

    const items: InvoiceLineItem[] = quotationData.items.map((item, index) => stripUndefined({
      ...item,
      id: `item_${Date.now()}_${index}`,
      total: item.quantity * item.price,
    }));

    const taxRate = quotationData.taxRate ?? 0;
    const discountPercent = quotationData.discountPercent || 0;

    const { subtotal, discountAmount, taxAmount, total } = calculateQuotationTotals(
      items,
      taxRate,
      discountPercent
    );

    const now = new Date().toISOString();

    const quotation: Omit<Quotation, 'id'> = {
      quotationNumber,
      customerId: quotationData.customerId,
      customerName: quotationData.customerName,
      customerCompanyName: quotationData.customerCompanyName,
      customerContactName: quotationData.customerContactName,
      customerEmail: quotationData.customerEmail,
      customerPhone: quotationData.customerPhone,
      billingAddress: quotationData.billingAddress,
      shippingAddress: quotationData.shippingAddress,
      customerAccountNumber: quotationData.customerAccountNumber,
      items,
      subtotal,
      discountPercent,
      discountAmount,
      taxRate,
      tax: taxAmount,
      total,
      deposit: quotationData.deposit ?? 0,
      balanceDue: total - (quotationData.deposit ?? 0),
      validUntil: quotationData.validUntil,
      terms: quotationData.terms,
      notes: quotationData.notes,
      status: 'draft',
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    const id = `quot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const payload = stripUndefined(quotation);
    await supabaseServiceRole.from('quotes').insert({ id, workspace_id: workspaceId, data: { ...payload, id } });

    logActivity(workspaceId, userId, 'quote_created', 'quote', id, quotationNumber, {
      customerId: quotation.customerId,
      customerName: quotation.customerName,
      total,
    });

    return { ...quotation, id };
  } catch (error) {
    console.error('Error creating quotation:', error);
    throw new Error('Failed to create quotation');
  }
}

/**
 * Get all quotations for a workspace
 */
export async function getQuotations(workspaceId: string): Promise<Quotation[]> {
  try {
    const { data } = await supabase
      .from('quotes')
      .select('id, data')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    return (data || []).map(r => ({ id: r.id, ...(r.data as any) })) as Quotation[];
  } catch (error) {
    console.error('Error getting quotations:', error);
    throw new Error('Failed to fetch quotations');
  }
}

/**
 * Get quotations for a specific customer
 */
export async function getCustomerQuotations(
  workspaceId: string,
  customerId: string
): Promise<Quotation[]> {
  try {
    const all = await getQuotations(workspaceId);
    return all.filter(q => q.customerId === customerId);
  } catch (error) {
    console.error('Error getting customer quotations:', error);
    throw new Error('Failed to fetch customer quotations');
  }
}

/**
 * Get a single quotation by ID
 */
export async function getQuotation(
  workspaceId: string,
  quotationId: string
): Promise<Quotation | null> {
  try {
    const { data } = await supabase.from('quotes').select('id, data').eq('id', quotationId).single();
    if (!data) return null;
    return { id: data.id, ...(data.data as any) } as Quotation;
  } catch (error) {
    console.error('Error getting quotation:', error);
    return null;
  }
}

/**
 * Update quotation status
 */
export async function updateQuotationStatus(
  workspaceId: string,
  quotationId: string,
  status: Quotation['status'],
  userId?: string,
): Promise<void> {
  try {
    await updateQuotation(workspaceId, quotationId, {
      status,
      ...(status === 'sent' && { sentDate: new Date().toISOString() }),
    });
    if (userId) {
      const { data: row } = await supabase.from('quotes').select('data').eq('id', quotationId).single();
      const quoteNumber = (row?.data as any)?.quotationNumber || quotationId;
      const activityType = status === 'accepted' ? 'quote_approved' : 'quote_status_changed';
      logActivity(workspaceId, userId, activityType, 'quote', quotationId, quoteNumber, { status });
    }
  } catch (error) {
    console.error('Error updating quotation status:', error);
    throw new Error('Failed to update quotation status');
  }
}

/**
 * Update quotation
 */
export async function updateQuotation(
  workspaceId: string,
  quotationId: string,
  updates: Partial<Quotation>
): Promise<void> {
  try {
    const { data: existing } = await supabase.from('quotes').select('data').eq('id', quotationId).single();
    const merged = stripUndefined({ ...(existing?.data as any || {}), ...updates, updatedAt: new Date().toISOString() });
    await supabaseServiceRole.from('quotes').update({ data: merged }).eq('id', quotationId);
  } catch (error) {
    console.error('Error updating quotation:', error);
    throw new Error('Failed to update quotation');
  }
}

/**
 * Delete quotation (soft delete by marking as cancelled)
 */
export async function deleteQuotation(
  workspaceId: string,
  quotationId: string
): Promise<void> {
  try {
    const { error } = await supabaseServiceRole
      .from('quotes')
      .delete()
      .eq('id', quotationId)
      .eq('workspace_id', workspaceId);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting quotation:', error);
    throw new Error('Failed to delete quotation');
  }
}

/**
 * Convert quotation to invoice
 */
export async function convertQuotationToInvoice(
  workspaceId: string,
  quotationId: string,
  userId: string,
  userName: string,
  invoiceData?: {
    dueDate?: string;
    terms?: Invoice['terms'];
    notes?: string;
  }
): Promise<Invoice> {
  try {
    // Get the quotation
    const quotation = await getQuotation(workspaceId, quotationId);
    if (!quotation) {
      throw new Error('Quotation not found');
    }

    if (quotation.status === 'declined' || quotation.status === 'expired') {
      throw new Error('Cannot convert declined or expired quotation');
    }

    if (quotation.convertedToInvoiceId) {
      throw new Error('Quotation already converted to invoice');
    }

    // Calculate due date (default 30 days from now)
    const dueDate =
      invoiceData?.dueDate ||
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Create invoice from quotation
    const invoice = await createInvoice(workspaceId, userId, userName, {
      customerId: quotation.customerId,
      customerName: quotation.customerName,
      customerEmail: quotation.customerEmail,
      items: quotation.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        description: item.description,
        quantity: item.quantity,
        price: item.price,
        taxRate: item.taxRate,
      })),
      taxRate: quotation.taxRate, // Preserve VAT settings from quotation
      discountPercent: quotation.discountPercent,
      notes: invoiceData?.notes || quotation.notes || `Converted from ${quotation.quotationNumber}`,
      dueDate,
      terms: invoiceData?.terms || 'net-30',
    });

    // Update quotation to mark as converted
    await updateQuotation(workspaceId, quotationId, {
      status: 'accepted',
      convertedToInvoiceId: invoice.id,
      convertedDate: new Date().toISOString(),
    });

    return invoice;
  } catch (error) {
    console.error('Error converting quotation to invoice:', error);
    throw error;
  }
}

/**
 * Check and mark expired quotations
 */
export async function checkExpiredQuotations(workspaceId: string): Promise<number> {
  try {
    const all = await getQuotations(workspaceId);
    const now = new Date().toISOString().split('T')[0];
    let expiredCount = 0;
    for (const q of all) {
      if ((q.status === 'draft' || q.status === 'sent') && q.validUntil < now) {
        await updateQuotation(workspaceId, q.id, { status: 'expired' });
        expiredCount++;
      }
    }
    return expiredCount;
  } catch (error) {
    console.error('Error checking expired quotations:', error);
    return 0;
  }
}

/**
 * Get quotation analytics
 */
export async function getQuotationAnalytics(workspaceId: string) {
  try {
    const quotations = await getQuotations(workspaceId);

    const stats = {
      total: quotations.length,
      draft: quotations.filter((q) => q.status === 'draft').length,
      sent: quotations.filter((q) => q.status === 'sent').length,
      accepted: quotations.filter((q) => q.status === 'accepted').length,
      declined: quotations.filter((q) => q.status === 'declined').length,
      expired: quotations.filter((q) => q.status === 'expired').length,
      totalValue: quotations.reduce((sum, q) => sum + q.total, 0),
      acceptedValue: quotations
        .filter((q) => q.status === 'accepted')
        .reduce((sum, q) => sum + q.total, 0),
      conversionRate:
        quotations.length > 0
          ? Math.round(
              (quotations.filter((q) => q.status === 'accepted').length / quotations.length) * 100
            )
          : 0,
    };

    return stats;
  } catch (error) {
    console.error('Error getting quotation analytics:', error);
    return {
      total: 0,
      draft: 0,
      sent: 0,
      accepted: 0,
      declined: 0,
      expired: 0,
      totalValue: 0,
      acceptedValue: 0,
      conversionRate: 0,
    };
  }
}
