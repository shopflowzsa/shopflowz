import { supabase, supabaseServiceRole } from "@/lib/supabase";

export interface TaskDocument {
  id?: string;
  taskId: string;
  filename: string;
  downloadUrl: string;
  type: 'invoice' | 'quote' | 'receipt' | 'contract' | 'other';
  mimeType: string;
  size: number;
  createdAt: string;
  createdBy: string;
  metadata?: {
    invoiceNumber?: string;
    amount?: number;
    description?: string;
  };
}

/**
 * Store a document reference in the documents collection
 */
export async function storeTaskDocument(
  workspaceId: string,
  document: Omit<TaskDocument, 'id'>
): Promise<TaskDocument> {
  try {
    const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const docData = { ...document, createdAt: new Date().toISOString() };
    await supabaseServiceRole.from('documents').insert({ id, workspace_id: workspaceId, data: docData });
    return { id, ...document };
  } catch (error) {
    console.error("Failed to store document:", error);
    throw error;
  }
}

/**
 * Find documents for a specific task
 */
export async function getTaskDocuments(
  workspaceId: string,
  taskId: string
): Promise<TaskDocument[]> {
  try {
    const { data } = await supabase
      .from('documents')
      .select('id, data')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    return (data || [])
      .map(r => ({ id: r.id, ...(r.data as any) } as TaskDocument))
      .filter(d => d.taskId === taskId);
  } catch (error) {
    console.error("Failed to get task documents:", error);
    return [];
  }
}

/**
 * Find documents by type for a task
 */
export async function getTaskDocumentsByType(
  workspaceId: string,
  taskId: string,
  type: TaskDocument['type']
): Promise<TaskDocument[]> {
  try {
    const { data } = await supabase
      .from('documents')
      .select('id, data')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    return (data || [])
      .map(r => ({ id: r.id, ...(r.data as any) } as TaskDocument))
      .filter(d => d.taskId === taskId && d.type === type);
  } catch (error) {
    console.error("Failed to get task documents by type:", error);
    return [];
  }
}

/**
 * Find the most recent document of a given type for a task
 */
export async function getLatestTaskDocument(
  workspaceId: string,
  taskId: string,
  type: TaskDocument['type']
): Promise<TaskDocument | null> {
  const documents = await getTaskDocumentsByType(workspaceId, taskId, type);
  return documents.length > 0 ? documents[0] : null;
}

/**
 * Delete a document reference
 */
export async function deleteTaskDocument(
  workspaceId: string,
  documentId: string
): Promise<void> {
  try {
    await supabaseServiceRole.from('documents').delete().eq('id', documentId);
  } catch (error) {
    console.error("Failed to delete document:", error);
    throw error;
  }
}

/**
 * Store an invoice PDF document for a task
 */
export async function storeInvoiceDocument(
  workspaceId: string,
  taskId: string,
  invoiceNumber: string,
  downloadUrl: string,
  amount: number,
  userId: string
): Promise<TaskDocument> {
  return storeTaskDocument(workspaceId, {
    taskId,
    filename: `${invoiceNumber}.pdf`,
    downloadUrl,
    type: 'invoice',
    mimeType: 'application/pdf',
    size: 0, // Size unknown for generated PDFs
    createdBy: userId,
    createdAt: new Date().toISOString(),
    metadata: {
      invoiceNumber,
      amount,
      description: `Deposit invoice ${invoiceNumber}`
    }
  });
}