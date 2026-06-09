/**
 * Counter Service for Auto-Numbering
 * Generates sequential numbers for invoices, customers, quotations, etc.
 */

import { supabase } from '@/lib/supabase';

type CounterType = 'invoice' | 'customer' | 'quotation' | 'payment' | 'creditNote';

/** Map internal counter types to the RPC p_counter_type strings */
const RPC_COUNTER_TYPE: Partial<Record<CounterType, string>> = {
  invoice: 'invoice',
  customer: 'customer',
  quotation: 'quote',
};

/**
 * Get the next number for a counter type
 * Uses Firestore transaction to ensure atomicity
 */
export async function getNextNumber(
  workspaceId: string,
  counterType: CounterType
): Promise<number> {
  // Primary path: atomic RPC avoids read-modify-write race condition
  const rpcType = RPC_COUNTER_TYPE[counterType];
  if (rpcType) {
    try {
      const { data, error } = await supabase.rpc('claim_next_counter', {
        p_workspace_id: workspaceId,
        p_counter_type: rpcType,
      });
      if (!error && data != null) return data as number;
    } catch (_) {
      // RPC not available — fall through to read-modify-write
    }
  }

  // Fallback: read-modify-write (non-atomic, kept for backwards compatibility)
  try {
    const { data: row } = await supabase
      .from('workspace_settings')
      .select('data')
      .eq('workspace_id', workspaceId)
      .eq('category', 'counters')
      .maybeSingle();
    const counters: Record<string, number> = (row?.data as any) || {};
    const nextValue = (counters[counterType] || 0) + 1;
    const updated = { ...counters, [counterType]: nextValue };
    await supabase
      .from('workspace_settings')
      .upsert({ workspace_id: workspaceId, category: 'counters', data: updated }, { onConflict: 'workspace_id,category' });
    return nextValue;
  } catch (error) {
    console.error(`Error getting next ${counterType} number:`, error);
    throw error;
  }
}

/**
 * Generate formatted invoice number
 * Format: INV00001, INV00002, etc.
 */
export async function generateInvoiceNumber(workspaceId: string): Promise<string> {
  const number = await getNextNumber(workspaceId, 'invoice');
  return `INV${number.toString().padStart(5, '0')}`;
}

/**
 * Generate formatted customer number
 * Format: CUST00001, CUST00002, etc.
 */
export async function generateCustomerNumber(workspaceId: string): Promise<string> {
  const number = await getNextNumber(workspaceId, 'customer');
  return `CUST${number.toString().padStart(5, '0')}`;
}

/**
 * Generate formatted quotation number
 * Format: QUO00001, QUO00002, etc.
 */
export async function generateQuotationNumber(workspaceId: string): Promise<string> {
  const number = await getNextNumber(workspaceId, 'quotation');
  return `QUO${number.toString().padStart(5, '0')}`;
}

/**
 * Generate formatted payment reference
 * Format: PAY00001, PAY00002, etc.
 */
export async function generatePaymentReference(workspaceId: string): Promise<string> {
  const number = await getNextNumber(workspaceId, 'payment');
  return `PAY${number.toString().padStart(5, '0')}`;
}

/**
 * Reset a counter (admin function)
 */
export async function resetCounter(
  workspaceId: string,
  counterType: CounterType,
  newValue: number = 0
): Promise<void> {
  const { data: row } = await supabase
    .from('workspace_settings')
    .select('data')
    .eq('workspace_id', workspaceId)
    .eq('category', 'counters')
    .maybeSingle();
  const counters: Record<string, number> = (row?.data as any) || {};
  await supabase
    .from('workspace_settings')
    .upsert({ workspace_id: workspaceId, category: 'counters', data: { ...counters, [counterType]: newValue } }, { onConflict: 'workspace_id,category' });
}

/**
 * Get current counter value (read-only)
 */
export async function getCounterValue(
  workspaceId: string,
  counterType: CounterType
): Promise<number> {
  const { data: row } = await supabase
    .from('workspace_settings')
    .select('data')
    .eq('workspace_id', workspaceId)
    .eq('category', 'counters')
    .maybeSingle();
  const counters: Record<string, number> = (row?.data as any) || {};
  return counters[counterType] || 0;
}
