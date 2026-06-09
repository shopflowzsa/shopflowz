import { supabase, supabaseServiceRole } from "@/lib/supabase";

export interface InvoiceLineItem {
  id: string;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface SalesInvoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  items: InvoiceLineItem[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  status: "draft" | "sent" | "paid" | "partial" | "overdue" | "cancelled";
  dueDate: Date;
  notes?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

function resolveDate(val: any): Date {
  if (!val) return new Date();
  if (val.toDate) return val.toDate();
  return new Date(val);
}

async function generateInvoiceNumber(workspaceId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('sales_invoices')
      .select('id, data')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1);
    let next = 1;
    if (data && data.length > 0) {
      const last = (data[0].data as any)?.invoiceNumber as string || '';
      const n = parseInt(last.replace(/\D/g, '')) || 0;
      next = n + 1;
    }
    return `INV-${next.toString().padStart(4, '0')}`;
  } catch {
    return `INV-${Date.now().toString().slice(-4)}`;
  }
}

export const invoicingService = {
  async getAll(workspaceId: string): Promise<SalesInvoice[]> {
    const { data } = await supabase
      .from('sales_invoices')
      .select('id, data')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    return (data || []).map(r => {
      const d = r.data as any;
      return { id: r.id, ...d, dueDate: resolveDate(d.dueDate), createdAt: resolveDate(d.createdAt), updatedAt: resolveDate(d.updatedAt) } as SalesInvoice;
    });
  },

  async create(
    workspaceId: string,
    data: Omit<SalesInvoice, 'id' | 'invoiceNumber' | 'createdAt' | 'updatedAt'>
  ): Promise<SalesInvoice> {
    const invoiceNumber = await generateInvoiceNumber(workspaceId);
    const id = `sinv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowDate = new Date();
    const payload = { ...data, invoiceNumber, dueDate: (data.dueDate as Date).toISOString(), createdAt: nowDate.toISOString(), updatedAt: nowDate.toISOString() };
    await supabaseServiceRole.from('sales_invoices').insert({ id, workspace_id: workspaceId, data: payload });
    return { id, ...data, invoiceNumber, createdAt: nowDate, updatedAt: nowDate } as SalesInvoice;
  },

  async update(workspaceId: string, id: string, data: Partial<SalesInvoice>): Promise<void> {
    const { data: existing } = await supabase.from('sales_invoices').select('data').eq('id', id).single();
    const update: any = { ...(existing?.data as any || {}), ...data, updatedAt: new Date().toISOString() };
    if (data.dueDate instanceof Date) update.dueDate = data.dueDate.toISOString();
    await supabaseServiceRole.from('sales_invoices').update({ data: update }).eq('id', id);
  },

  async delete(workspaceId: string, id: string): Promise<void> {
    await supabaseServiceRole.from('sales_invoices').delete().eq('id', id);
  },

  async recordPayment(workspaceId: string, invoice: SalesInvoice, amount: number): Promise<void> {
    const newPaid = invoice.amountPaid + amount;
    const newBalance = Math.max(0, invoice.total - newPaid);
    const status: SalesInvoice['status'] = newBalance === 0 ? 'paid' : 'partial';
    await invoicingService.update(workspaceId, invoice.id, { amountPaid: newPaid, balanceDue: newBalance, status });
  },
};
