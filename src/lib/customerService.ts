/**
 * Customer Service
 * Manages customer data, transactions, and financial tracking
 */

import { supabase, supabaseServiceRole } from '@/lib/supabase';
import { Customer } from '@/types/invoice';
import { generateCustomerNumber } from './counterService';
import { logActivity } from '@/lib/activityTrackingService';

/**
 * Get all customers for a workspace
 */
export async function getCustomers(workspaceId: string): Promise<Customer[]> {
  const { data } = await supabase
    .from('customers')
    .select('id, data')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  return (data || []).map(r => ({ id: r.id, ...(r.data as any) } as Customer));
}

/**
 * Get a single customer by ID
 */
export async function getCustomerById(
  workspaceId: string,
  customerId: string
): Promise<Customer | null> {
  const { data } = await supabase
    .from('customers')
    .select('id, data')
    .eq('workspace_id', workspaceId)
    .eq('id', customerId)
    .single();
  if (!data) return null;
  return { id: data.id, ...(data.data as any) } as Customer;
}

/**
 * Create a new customer
 */
export async function createCustomer(
  workspaceId: string,
  customerData: Omit<Customer, 'id' | 'customerNumber' | 'createdAt' | 'updatedAt' | 'totalInvoiced' | 'totalPaid' | 'outstandingBalance' | 'createdBy'>,
  userId: string
): Promise<Customer> {
  const customerNumber = await generateCustomerNumber(workspaceId);
  const customerId = `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();
  const newCustomer: Customer = {
    id: customerId,
    customerNumber,
    ...customerData,
    totalInvoiced: 0,
    totalPaid: 0,
    outstandingBalance: 0,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  await supabaseServiceRole.from('customers').insert({ id: customerId, workspace_id: workspaceId, data: newCustomer });
  logActivity(workspaceId, userId, 'customer_created', 'customer', customerId, newCustomer.companyName || newCustomer.contactPerson, { customerNumber });
  return newCustomer;
}

/**
 * Update customer information
 */
export async function updateCustomer(
  workspaceId: string,
  customerId: string,
  updates: Partial<Customer>,
  userId?: string,
): Promise<void> {
  const { data: existing } = await supabase.from('customers').select('data').eq('id', customerId).single();
  const merged = { ...(existing?.data as any || {}), ...updates, updatedAt: new Date().toISOString() };
  await supabaseServiceRole.from('customers').update({ data: merged }).eq('id', customerId);
  if (userId) {
    const name = merged.companyName || merged.contactPerson || 'Unknown';
    logActivity(workspaceId, userId, 'customer_updated', 'customer', customerId, name, { fields: Object.keys(updates) });
  }
}

/**
 * Delete a customer
 */
export async function deleteCustomer(
  workspaceId: string,
  customerId: string,
  userId?: string,
): Promise<void> {
  const { data: linkedInvs } = await supabase
    .from('invoices')
    .select('id, data')
    .eq('workspace_id', workspaceId)
    .limit(1);
  const hasInvoices = linkedInvs?.some(inv =>
    (inv.data as any)?.customerId === customerId
  );
  if (hasInvoices) {
    throw new Error('Cannot delete customer with existing invoices. Archive the customer instead.');
  }
  const { data: existing } = await supabase.from('customers').select('data').eq('id', customerId).single();
  const name = (existing?.data as any)?.companyName || (existing?.data as any)?.contactPerson || 'Unknown';
  await supabaseServiceRole.from('customers').delete().eq('id', customerId);
  if (userId) {
    logActivity(workspaceId, userId, 'customer_deleted', 'customer', customerId, name);
  }
}

/**
 * Update customer financial totals
 * Called when invoices are created or payments are received
 */
export async function updateCustomerFinancials(
  workspaceId: string,
  customerId: string,
  invoiceTotal: number,
  paymentAmount: number
): Promise<void> {
  const { data } = await supabase.from('customers').select('data').eq('id', customerId).single();
  if (!data) throw new Error('Customer not found');
  const customer = data.data as any;
  const totalInvoiced = (customer.totalInvoiced || 0) + invoiceTotal;
  const totalPaid = (customer.totalPaid || 0) + paymentAmount;
  const outstandingBalance = totalInvoiced - totalPaid;
  const merged = { ...customer, totalInvoiced, totalPaid, outstandingBalance, updatedAt: new Date().toISOString() };
  await supabaseServiceRole.from('customers').update({ data: merged }).eq('id', customerId);
}

/**
 * Search customers by name, email, or company
 */
export async function searchCustomers(
  workspaceId: string,
  searchTerm: string
): Promise<Customer[]> {
  const allCustomers = await getCustomers(workspaceId);
  
  const lowerSearch = searchTerm.toLowerCase();
  return allCustomers.filter(customer => 
    customer.contactPerson.toLowerCase().includes(lowerSearch) ||
    customer.email.toLowerCase().includes(lowerSearch) ||
    customer.companyName?.toLowerCase().includes(lowerSearch) ||
    customer.customerNumber.toLowerCase().includes(lowerSearch)
  );
}

/**
 * Get active customers only
 */
export async function getActiveCustomers(workspaceId: string): Promise<Customer[]> {
  const all = await getCustomers(workspaceId);
  return all.filter(c => c.status === 'active');
}
