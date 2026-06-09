/**
 * Inventory-Ecommerce Sync Service
 * Synchronizes CRM inventory items with ecommerce products
 */

import { supabase, supabaseServiceRole } from './supabase';
import { Product, ProductVariant, ProductCategory } from '@/types/ecommerce';
import { generateBarcode, validateBarcode } from './barcodeService';

// ─── Enhanced Inventory Types ────────────────────────────────────────────

export interface InventoryItem {
  id: string;
  name: string;
  description?: string;
  category: string;
  sku: string;
  barcode?: string; // Auto-generated or custom barcode
  currentStock: number;
  minStock: number;
  maxStock?: number;
  reorderLevel?: number;
  unitCost: number;
  unitPrice: number;

  // Enhanced supplier information
  supplier?: string;
  supplierStockCode?: string; // For OCR matching
  manufacturer?: string;

  // Storage and tracking
  location?: string; // Physical storage location
  imageUrl?: string;

  // System fields
  lastRestocked?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;

  // Sync configurations
  syncToEcommerce?: boolean;
  isPublic?: boolean;
  ecommerceProductId?: string;

  // Pack sales configuration
  packSize?: number; // Number of units per pack (e.g., 5 means "sell in packs of 5")
  packPrice?: number; // Price per pack (if different from price * packSize)

  // Status and notes
  status: 'active' | 'inactive' | 'discontinued';
  notes?: string;
  tags?: string[];
}

export interface StockMovement {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  type: 'in' | 'out' | 'adjustment' | 'reserved' | 'returned' | 'damaged' | 'lost';
  quantity: number;
  previousStock: number;
  newStock: number;
  reason: string;
  reference?: string; // Job number, invoice number, etc.
  cost?: number; // For cost tracking
  performedBy: string;
  timestamp: string;
  notes?: string;
  jobId?: string; // Link to repair job if applicable
}

export interface InventoryCategory {
  id: string;
  name: string;
  description?: string;
  parentId?: string; // For subcategories
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryAlert {
  id: string;
  itemId: string;
  itemName: string;
  type: 'low-stock' | 'out-of-stock' | 'overstock' | 'reorder-point';
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  isRead: boolean;
  createdAt: string;
}

function getSellPrice(item: Partial<InventoryItem> & Record<string, any>): number {
  return Number(item.unitPrice ?? item.price ?? 0);
}

function assertActiveItemHasPrice(item: Partial<InventoryItem> & Record<string, any>): void {
  if (item.status === 'active' && getSellPrice(item) <= 0) {
    throw new Error('A product must have a selling price before it can be marked active.');
  }
}

// ─── Inventory Management ────────────────────────────────────────────────

export async function getInventoryItems(workspaceId: string): Promise<InventoryItem[]> {
  const PAGE = 1000;
  let all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('inventory')
      .select('id, data')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) break;
    all = all.concat(data || []);
    if ((data || []).length < PAGE) break;
    from += PAGE;
  }
  return all.map(r => ({ id: r.id, ...(r.data as any) } as InventoryItem));
}

export async function findInventoryItemByBarcode(workspaceId: string, barcode: string): Promise<InventoryItem | null> {
  const q = barcode.trim();
  // Try barcode field first, then SKU
  const { data } = await supabase
    .from('inventory')
    .select('id, data')
    .eq('workspace_id', workspaceId)
    .or(`data->>barcode.eq.${q},data->>sku.ilike.${q}`)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, ...(data.data as any) } as InventoryItem;
}

export async function createInventoryItem(
  workspaceId: string, 
  item: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>,
  syncToEcommerce: boolean = false
): Promise<string> {
  const barcode = item.barcode || generateBarcode('CODE128');
  const newItem: InventoryItem = {
    ...item,
    id: `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    barcode,
    status: item.status || (getSellPrice(item) > 0 ? 'active' : 'inactive'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    syncToEcommerce,
    isPublic: syncToEcommerce && (item.isPublic !== false),
  };
  assertActiveItemHasPrice(newItem);
  await supabaseServiceRole.from('inventory').insert({ id: newItem.id, workspace_id: workspaceId, data: newItem });
  if (newItem.currentStock > 0) {
    logStockMovement(workspaceId, {
      itemId: newItem.id, itemName: newItem.name, itemSku: newItem.sku,
      type: 'in', quantity: newItem.currentStock, previousStock: 0, newStock: newItem.currentStock,
      reason: 'Initial stock', performedBy: 'system', timestamp: new Date().toISOString(),
    }).catch(() => {});
  }
  return newItem.id;
}

export async function bulkImportInventoryItems(
  workspaceId: string,
  items: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>[],
  syncToEcommerce: boolean = false
): Promise<{ success: number; failed: number; errors: string[] }> {
  const results = { success: 0, failed: 0, errors: [] as string[] };
  
  for (let i = 0; i < items.length; i++) {
    try {
      await createInventoryItem(workspaceId, items[i], syncToEcommerce);
      results.success++;
    } catch (error) {
      results.failed++;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      results.errors.push(`Row ${i + 1}: ${errorMsg}`);
    }
  }
  
  return results;
}

export async function updateInventoryItem(
  workspaceId: string,
  itemId: string,
  updates: Partial<InventoryItem>
): Promise<void> {
  const { data: existing } = await supabase.from('inventory').select('data').eq('id', itemId).single();
  const merged = { ...(existing?.data as any || {}), ...updates, updatedAt: new Date().toISOString() };
  assertActiveItemHasPrice(merged);
  await supabaseServiceRole.from('inventory').update({ data: merged }).eq('id', itemId);
}

// ─── Sync Functions ──────────────────────────────────────────────────────

// Supabase is the single source of truth — no Firestore ecommerce sync needed

// ─── Inventory Alerts ────────────────────────────────────────────────────

export async function createInventoryAlert(
  workspaceId: string,
  itemId: string,
  itemName: string,
  type: InventoryAlert['type'],
  message: string
): Promise<void> {
  const id = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const alert = { id, itemId, itemName, type, message, severity: type === 'out-of-stock' ? 'critical' : type === 'low-stock' ? 'high' : 'medium', isRead: false, createdAt: new Date().toISOString() };
  await supabaseServiceRole.from('inventory_alerts').insert({ id, workspace_id: workspaceId, data: alert }).catch(() => {});
}

export async function getInventoryAlerts(
  workspaceId: string,
  unreadOnly: boolean = false
): Promise<InventoryAlert[]> {
  const { data } = await supabase
    .from('inventory_alerts')
    .select('id, data')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  const rows = (data || []).map(r => ({ id: r.id, ...(r.data as any) } as InventoryAlert));
  return unreadOnly ? rows.filter(r => !r.isRead) : rows;
}

export async function markAlertAsRead(workspaceId: string, alertId: string): Promise<void> {
  const { data: existing } = await supabase.from('inventory_alerts').select('data').eq('id', alertId).single();
  if (!existing) return;
  await supabaseServiceRole.from('inventory_alerts').update({ data: { ...(existing.data as any), isRead: true } }).eq('id', alertId);
}

// ─── Barcode Management ───────────────────────────────────────────────────

export async function generateBarcodesForAllItems(workspaceId: string): Promise<number> {
  const items = await getInventoryItems(workspaceId);
  const itemsWithoutBarcodes = items.filter(item => !item.barcode);
  
  let updatedCount = 0;
  
  for (const item of itemsWithoutBarcodes) {
    try {
      const barcode = generateBarcode('CODE128');
      await updateInventoryItem(workspaceId, item.id, { barcode });
      updatedCount++;
    } catch (error) {
      console.error(`Error updating barcode for item ${item.id}:`, error);
    }
  }
  
  return updatedCount;
}

export async function searchInventoryItems(
  workspaceId: string,
  searchTerm: string,
  category?: string,
  status?: InventoryItem['status']
): Promise<InventoryItem[]> {
  const items = await getInventoryItems(workspaceId);
  
  return items.filter(item => {
    // Text search
    const searchText = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm || 
      (item.name || "").toLowerCase().includes(searchText) ||
      (item.sku || "").toLowerCase().includes(searchText) ||
      item.barcode?.toLowerCase().includes(searchText) ||
      item.description?.toLowerCase().includes(searchText) ||
      item.supplier?.toLowerCase().includes(searchText) ||
      item.supplierStockCode?.toLowerCase().includes(searchText);
    
    // Category filter
    const matchesCategory = !category || item.category === category;
    
    // Status filter
    const matchesStatus = !status || item.status === status;
    
    return matchesSearch && matchesCategory && matchesStatus;
  });
}

// ─── Inventory Analytics ──────────────────────────────────────────────────

export async function getInventoryStats(workspaceId: string): Promise<{
  totalItems: number;
  totalValue: number;
  lowStockItems: number;
  outOfStockItems: number;
  totalStock: number;
  activeItems: number;
  categoriesCount: number;
}> {
  const items = await getInventoryItems(workspaceId);
  
  const stats = {
    totalItems: items.length,
    totalValue: items.reduce((sum, item) => sum + (item.currentStock * item.unitCost), 0),
    lowStockItems: items.filter(item => item.currentStock <= item.minStock && item.currentStock > 0).length,
    outOfStockItems: items.filter(item => item.currentStock === 0).length,
    totalStock: items.reduce((sum, item) => sum + item.currentStock, 0),
    activeItems: items.filter(item => item.status === 'active').length,
    categoriesCount: new Set(items.map(item => item.category)).size
  };
  
  return stats;
}

// ─── Job Integration ──────────────────────────────────────────────────────

export async function reserveInventoryForJob(
  workspaceId: string,
  jobId: string,
  items: Array<{ itemId: string; quantity: number }>
): Promise<void> {
  for (const { itemId, quantity } of items) {
    const { data: existing } = await supabase.from('inventory').select('data').eq('id', itemId).single();
    if (!existing) continue;
    const currentItem = existing.data as any as InventoryItem;
    if (currentItem.currentStock < quantity) {
      throw new Error(`Insufficient stock for ${currentItem.name}. Available: ${currentItem.currentStock}, Required: ${quantity}`);
    }
    const newStock = currentItem.currentStock - quantity;
    await updateInventoryStock(workspaceId, itemId, newStock, 'Reserved for repair job', 'system', jobId);
  }
}

export async function releaseReservedInventory(
  workspaceId: string,
  jobId: string,
  items: Array<{ itemId: string; quantity: number; used: number }>
): Promise<void> {
  for (const { itemId, quantity, used } of items) {
    const toReturn = quantity - used;
    if (toReturn > 0) {
      const currentItem = await getInventoryItems(workspaceId);
      const item = currentItem.find(i => i.id === itemId);
      if (!item) continue;
      
      await updateInventoryStock(
        workspaceId, 
        itemId, 
        item.currentStock + toReturn, 
        'Return unused parts from job',
        'system',
        jobId
      );
    }
  }
}

// ─── Stock Management ───────────────────────────────────────────────────

// ─── Stock Movement Management ────────────────────────────────────────────

export async function logStockMovement(
  workspaceId: string,
  movement: Omit<StockMovement, 'id'>
): Promise<string> {
  const id = `mov_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  await supabaseServiceRole.from('stock_movements').insert({
    id, workspace_id: workspaceId,
    data: { ...movement, id, timestamp: movement.timestamp || new Date().toISOString() }
  }).catch(() => {});
  return id;
}

export async function getStockMovements(
  workspaceId: string,
  itemId?: string,
  limitCount: number = 50
): Promise<StockMovement[]> {
  const { data } = await supabase
    .from('stock_movements')
    .select('id, data')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limitCount);
  const rows = (data || []).map(r => ({ id: r.id, ...(r.data as any) } as StockMovement));
  return itemId ? rows.filter(r => r.itemId === itemId) : rows;
}

export async function updateInventoryStock(
  workspaceId: string,
  itemId: string,
  newStock: number,
  reason: string = 'Stock adjustment',
  performedBy: string = 'system',
  jobId?: string
): Promise<void> {
  const { data: existing } = await supabase.from('inventory').select('data').eq('id', itemId).single();
  if (!existing) throw new Error('Inventory item not found');
  const currentItem = existing.data as any as InventoryItem;
  const previousStock = currentItem.currentStock;
  const stockDifference = newStock - previousStock;
  const merged = { ...currentItem, currentStock: newStock, lastRestocked: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await supabaseServiceRole.from('inventory').update({ data: merged }).eq('id', itemId);
  await logStockMovement(workspaceId, {
    itemId, itemName: currentItem.name, itemSku: currentItem.sku,
    type: stockDifference > 0 ? 'in' : stockDifference < 0 ? 'out' : 'adjustment',
    quantity: Math.abs(stockDifference), previousStock, newStock, reason, performedBy,
    timestamp: new Date().toISOString(), jobId,
  }).catch(() => {});
  if (newStock <= currentItem.minStock && newStock > 0) {
    createInventoryAlert(workspaceId, itemId, currentItem.name, 'low-stock', `${currentItem.name} is running low (${newStock} remaining)`).catch(() => {});
  } else if (newStock === 0) {
    createInventoryAlert(workspaceId, itemId, currentItem.name, 'out-of-stock', `${currentItem.name} is out of stock`).catch(() => {});
  }
}

// ─── Inventory Categories ─────────────────────────────────────────────────────

export async function getInventoryCategories(workspaceId: string): Promise<InventoryCategory[]> {
  const items = await getInventoryItems(workspaceId);
  const seen = new Map<string, InventoryCategory>();
  items.forEach(item => {
    if (item.category && !seen.has(item.category)) {
      seen.set(item.category, {
        id: item.category, name: item.category, isActive: true, sortOrder: seen.size,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
    }
  });
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createInventoryCategory(
  workspaceId: string,
  name: string,
  description?: string
): Promise<string> {
  // Categories are derived from item.category field — just return a stable ID
  return `cat_${name.trim().toLowerCase().replace(/\s+/g, '_')}`;
}

export async function updateInventoryCategory(
  workspaceId: string,
  id: string,
  data: Partial<Pick<InventoryCategory, 'name' | 'description' | 'isActive' | 'sortOrder'>>
): Promise<void> {
  // Categories are derived — bulk-update items with matching category if name changed
  if (data.name) {
    const items = await getInventoryItems(workspaceId);
    const toUpdate = items.filter(i => i.id === id || i.category === id);
    for (const item of toUpdate) {
      await updateInventoryItem(workspaceId, item.id, { category: data.name });
    }
  }
}

export async function deleteInventoryCategory(workspaceId: string, id: string): Promise<void> {
  // No-op: categories are derived from item.category — removing them requires updating each item
  console.warn('[deleteInventoryCategory] Category deletion requires updating affected inventory items manually.');
}
