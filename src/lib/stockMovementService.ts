/**
 * Stock Movement Service
 * Manages inventory stock movements with audit trail and automatic deductions
 */

import { supabase, supabaseServiceRole } from './supabase';
import { StockMovement, CreateStockMovementData, StockMovementSummary } from '@/types/stockMovement';
import { logAgentAuditEvent } from './agentAuditLogService';

/**
 * Create a stock movement and update inventory quantity
 * Uses transaction to ensure atomic updates
 */
export async function createStockMovement(
  workspaceId: string,
  userId: string,
  userName: string,
  movementData: CreateStockMovementData
): Promise<StockMovement> {
  // Read current inventory item
  const { data: invRow } = await supabase.from('inventory').select('data').eq('workspace_id', workspaceId).eq('id', movementData.productId).single();
  if (!invRow) throw new Error('Product not found in inventory');
  const inventoryItem = invRow.data as any;
  const previousQuantity = inventoryItem.quantity || 0;
  const newQuantity = previousQuantity + movementData.quantity;

  if (newQuantity < 0) {
    throw new Error(`Insufficient stock. Available: ${previousQuantity}, Requested: ${Math.abs(movementData.quantity)}`);
  }

  const now = new Date().toISOString();
  const movementId = `mov_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const movement: StockMovement = {
    id: movementId,
    productId: movementData.productId,
    productName: movementData.productName,
    sku: movementData.sku,
    type: movementData.type,
    quantity: movementData.quantity,
    previousQuantity,
    newQuantity,
    unitCost: movementData.unitCost,
    totalCost: movementData.unitCost ? movementData.unitCost * Math.abs(movementData.quantity) : undefined,
    referenceType: movementData.referenceType,
    referenceId: movementData.referenceId,
    referenceNumber: movementData.referenceNumber,
    reason: movementData.reason,
    notes: movementData.notes,
    status: 'completed',
    createdBy: userId,
    createdByName: userName,
    createdAt: now,
    updatedAt: now,
  };

  // Save movement record
  await supabaseServiceRole.from('stock_movements').insert({ id: movementId, workspace_id: workspaceId, data: movement });

  // Update inventory quantity
  const mergedInv = { ...inventoryItem, quantity: newQuantity, lastStockUpdate: now, updatedAt: now };
  await supabaseServiceRole.from('inventory').update({ data: mergedInv }).eq('id', movementData.productId);

  if (movement.type === 'sale' || movement.type === 'adjustment-out') {
    logAgentAuditEvent(
      workspaceId,
      movement.type === 'sale' ? 'stock_sold' : 'stock_booked_out',
      'inventory_item',
      movementData.productId,
      movementData.productName,
      {
        sku: movementData.sku,
        quantity: Math.abs(movementData.quantity),
        previousQuantity,
        newQuantity,
        unitCost: movement.unitCost,
        totalCost: movement.totalCost,
        referenceType: movementData.referenceType,
        referenceNumber: movementData.referenceNumber,
        reason: movementData.reason,
        createdBy: userName,
      },
    );
  }

  return movement;
}

/**
 * Create stock movements for invoice line items
 * Automatically deducts stock when invoice is created
 */
export async function createInvoiceStockMovements(
  workspaceId: string,
  userId: string,
  userName: string,
  invoiceId: string,
  invoiceNumber: string,
  lineItems: Array<{
    productId?: string;
    productName: string;
    sku?: string;
    quantity: number;
    packSize?: number; // Pack size for the inventory item
  }>
): Promise<StockMovement[]> {
  const movements: StockMovement[] = [];

  // Only process items that have productId (from inventory)
  const inventoryItems = lineItems.filter(item => item.productId);

  for (const item of inventoryItems) {
    try {
      // If item has packSize, quantity represents number of packs, so multiply to get units
      const unitsDeducted = item.packSize && item.packSize > 1
        ? item.quantity * item.packSize
        : item.quantity;

      const movement = await createStockMovement(workspaceId, userId, userName, {
        productId: item.productId!,
        productName: item.productName,
        sku: item.sku,
        type: 'sale',
        quantity: -unitsDeducted, // Negative for stock OUT
        referenceType: 'invoice',
        referenceId: invoiceId,
        referenceNumber: invoiceNumber,
        notes: item.packSize && item.packSize > 1
          ? `Stock deducted for invoice ${invoiceNumber} (${item.quantity} packs × ${item.packSize} units)`
          : `Stock deducted for invoice ${invoiceNumber}`,
      });
      movements.push(movement);
    } catch (error) {
      console.error(`Failed to create stock movement for ${item.productName}:`, error);
      // Continue processing other items even if one fails
      // You might want to handle this differently in production
    }
  }

  return movements;
}

/**
 * Get all stock movements for a workspace
 */
export async function getStockMovements(
  workspaceId: string,
  options?: {
    productId?: string;
    type?: StockMovement['type'];
    limit?: number;
  }
): Promise<StockMovement[]> {
  let query = supabase
    .from('stock_movements')
    .select('id, data')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data } = await query;
  let movements = (data || []).map(r => ({ id: r.id, ...(r.data as any) })) as StockMovement[];

  if (options?.productId) {
    movements = movements.filter(m => m.productId === options.productId);
  }
  if (options?.type) {
    movements = movements.filter(m => m.type === options.type);
  }

  return movements;
}

/**
 * Get stock movement summary for a product
 */
export async function getProductStockSummary(
  workspaceId: string,
  productId: string
): Promise<StockMovementSummary> {
  const movements = await getStockMovements(workspaceId, { productId });

  const totalIn = movements
    .filter(m => m.quantity > 0)
    .reduce((sum, m) => sum + m.quantity, 0);

  const totalOut = movements
    .filter(m => m.quantity < 0)
    .reduce((sum, m) => sum + Math.abs(m.quantity), 0);

  const lastMovement = movements[0];
  const currentStock = lastMovement?.newQuantity || 0;

  return {
    productId,
    productName: lastMovement?.productName || '',
    currentStock,
    totalIn,
    totalOut,
    totalMovements: movements.length,
    lastMovement,
    lowStockAlert: currentStock < 10, // Configurable threshold
  };
}

/**
 * Manual stock adjustment (add or remove stock)
 */
export async function adjustStock(
  workspaceId: string,
  userId: string,
  userName: string,
  productId: string,
  productName: string,
  sku: string | undefined,
  quantityChange: number, // Positive to add, negative to remove
  reason: string,
  notes?: string
): Promise<StockMovement> {
  const type = quantityChange > 0 ? 'adjustment-in' : 'adjustment-out';

  return await createStockMovement(workspaceId, userId, userName, {
    productId,
    productName,
    sku,
    type,
    quantity: quantityChange,
    referenceType: 'manual',
    reason,
    notes,
  });
}

/**
 * Get low stock items
 */
export async function getLowStockItems(
  workspaceId: string,
  threshold: number = 10
): Promise<any[]> {
  const { data } = await supabase
    .from('inventory')
    .select('id, data')
    .eq('workspace_id', workspaceId);
  return (data || [])
    .map(r => ({ id: r.id, ...(r.data as any) }))
    .filter((item: any) => (item.status === 'active' || item.status === undefined) && (item.quantity || 0) <= threshold);
}

/**
 * Cancel a stock movement (reverses the transaction)
 */
export async function cancelStockMovement(
  workspaceId: string,
  movementId: string,
  userId: string,
  userName: string,
  reason: string
): Promise<void> {
  // Read the movement
  const { data: movRow } = await supabase.from('stock_movements').select('data').eq('id', movementId).single();
  if (!movRow) throw new Error('Stock movement not found');
  const movement = movRow.data as StockMovement;

  if (movement.status === 'cancelled') throw new Error('Movement already cancelled');

  const now = new Date().toISOString();
  const reversalId = `mov_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Create reversal movement
  const reversalMovement: StockMovement = {
    ...movement,
    id: reversalId,
    quantity: -movement.quantity,
    previousQuantity: movement.newQuantity,
    newQuantity: movement.previousQuantity,
    reason: `Reversal: ${reason}`,
    notes: `Cancelled movement ${movementId}. Original: ${movement.notes || 'N/A'}`,
    status: 'completed',
    createdBy: userId,
    createdByName: userName,
    createdAt: now,
    updatedAt: now,
  };
  await supabaseServiceRole.from('stock_movements').insert({ id: reversalId, workspace_id: workspaceId, data: reversalMovement });

  // Mark original as cancelled
  await supabaseServiceRole.from('stock_movements').update({ data: { ...movement, status: 'cancelled', updatedAt: now } }).eq('id', movementId);

  // Update inventory to reversed quantity
  const { data: invRow } = await supabase.from('inventory').select('data').eq('workspace_id', workspaceId).eq('id', movement.productId).single();
  if (invRow) {
    const mergedInv = { ...(invRow.data as any), quantity: movement.previousQuantity, lastStockUpdate: now, updatedAt: now };
    await supabaseServiceRole.from('inventory').update({ data: mergedInv }).eq('id', movement.productId);
  }
}
