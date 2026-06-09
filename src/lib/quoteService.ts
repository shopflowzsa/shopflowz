import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { Quote, QuoteLineItem, Task } from "@/types/crm";
import { QuoteFormData } from "@/components/crm/QuoteGenerationDialog";

/**
 * Generate a unique quote number
 */
async function generateQuoteNumber(workspaceId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('quotes')
      .select('id, data')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1);
    let nextNumber = 1;
    if (data && data.length > 0) {
      const lastQuote = data[0].data as any;
      const lastNumber = parseInt((lastQuote?.quoteNumber || '').replace(/\D/g, '')) || 0;
      nextNumber = lastNumber + 1;
    }
    return `QUO-${nextNumber.toString().padStart(4, '0')}`;
  } catch (error) {
    console.error('Failed to generate quote number:', error);
    return `QUO-${Date.now().toString().slice(-4)}`;
  }
}

/**
 * Create a new quote from form data
 */
export async function createQuoteFromTask(
  workspaceId: string,
  formData: QuoteFormData,
  userId: string
): Promise<Quote> {
  const quoteNumber = await generateQuoteNumber(workspaceId);
  
  // Calculate totals
  const subtotal = formData.lineItems.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = subtotal * (formData.taxRate / 100);
  const total = subtotal + taxAmount;
  
  const quote: Quote = {
    id: "", // Will be set by Firestore
    quoteNumber,
    taskId: formData.taskId,
    customerName: formData.customerName,
    customerEmail: formData.customerEmail || undefined,
    customerPhone: formData.customerPhone || undefined,
    lineItems: formData.lineItems,
    subtotal,
    taxRate: formData.taxRate,
    taxAmount,
    total,
    notes: formData.notes || undefined,
    status: "draft",
    validUntil: formData.validUntil || undefined,
    createdBy: userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  try {
    const id = `quo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const savedQuote: Quote = { ...quote, id };
    await supabaseServiceRole.from('quotes').insert({ id, workspace_id: workspaceId, data: savedQuote });
    console.log('[Quote Service] Created quote:', savedQuote.quoteNumber);
    return savedQuote;
  } catch (error) {
    console.error('[Quote Service] Failed to create quote:', error);
    throw error;
  }
}

/**
 * Extract customer information from task custom fields
 */
export function extractCustomerInfo(task: Task, customFields: any[]): {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
} {
  const getFieldValue = (fieldName: string) => {
    const field = customFields.find(f => 
      f.name.toLowerCase().includes(fieldName.toLowerCase()) ||
      f.type === fieldName.toLowerCase()
    );
    
    if (!field) return '';
    
    const value = task.customFieldValues.find(v => v.fieldId === field.id);
    return value ? String(value.value) : '';
  };

  return {
    customerName: getFieldValue('customer') || getFieldValue('name') || 'Customer',
    customerEmail: getFieldValue('email'),
    customerPhone: getFieldValue('phone') || getFieldValue('contact')
  };
}

/**
 * Generate suggested line items based on task information
 */
export function generateSuggestedLineItems(task: Task): QuoteLineItem[] {
  const baseItem: QuoteLineItem = {
    id: `item_${Date.now()}`,
    description: task.title || 'Repair Service',
    quantity: 1,
    rate: 0,
    amount: 0
  };

  // Add additional suggested items based on common repair scenarios
  const suggestedItems: QuoteLineItem[] = [baseItem];

  // If task mentions specific components, suggest parts
  const taskText = (task.title + ' ' + (task.description || '')).toLowerCase();
  
  if (taskText.includes('speaker') || taskText.includes('driver')) {
    suggestedItems.push({
      id: `item_${Date.now() + 1}`,
      description: 'Replacement Parts',
      quantity: 1,
      rate: 0,
      amount: 0
    });
  }

  if (taskText.includes('cable') || taskText.includes('wire')) {
    suggestedItems.push({
      id: `item_${Date.now() + 2}`,
      description: 'Cable/Wire Replacement',
      quantity: 1,
      rate: 0,
      amount: 0
    });
  }

  return suggestedItems;
}