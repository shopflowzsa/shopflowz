import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { logActivity } from "@/lib/activityTrackingService";

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  description: string;
  category: string;
  price: number;
  salePrice?: number; // Optional discounted price — when set, the storefront and Google Shopping feed treat this as the sale price
  costPrice: number;
  quantity: number;
  reorderLevel: number;
  supplier?: string;
  location?: string;
  imageUrl?: string;
  status: "active" | "inactive";
  itemType?: "inventory" | "service"; // "service" = non-stocked / labour / repair charge
  barcode?: string;
  // Pack sales configuration
  packSize?: number; // Number of units per pack (e.g., 5 means "sell in packs of 5")
  packPrice?: number; // Price per pack (if different from price * packSize)
  // Multi-image support (for clothing, multiple angles, etc.)
  extraImages?: string[];
  // Named variants with per-variant stock (sizes, colours, etc.)
  productVariants?: Array<{
    id: string;
    name: string;   // e.g. "Red / Large"
    price?: number; // overrides base price when set
    stock: number;
    sku?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  type: "in" | "out" | "adjustment";
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  reason: string;
  userId: string;
  timestamp: Date;
  notes?: string;
}

function resolveDate(val: any): Date {
  if (!val) return new Date();
  if (val.toDate) return val.toDate();
  return new Date(val);
}

function getSellPrice(item: Partial<InventoryItem> & Record<string, any>): number {
  return Number(item.price ?? item.unitPrice ?? 0);
}

function assertActiveItemHasPrice(item: Partial<InventoryItem> & Record<string, any>): void {
  if (item.status === "active" && getSellPrice(item) <= 0) {
    throw new Error("A product must have a selling price before it can be marked active.");
  }
}

// ─── Products ─────────────────────────────────────────────────────────────────

export const inventoryService = {
  async getAll(workspaceId: string): Promise<InventoryItem[]> {
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
    return all.map(r => {
      const d = r.data as any;
      return { id: r.id, ...d, createdAt: resolveDate(d.createdAt), updatedAt: resolveDate(d.updatedAt) } as InventoryItem;
    });
  },

  async add(workspaceId: string, item: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    assertActiveItemHasPrice(item);
    const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    await supabaseServiceRole.from('inventory').insert({ id, workspace_id: workspaceId, data: { ...item, id, createdAt: now, updatedAt: now } });
    
    // Track inventory item creation
    try {
      const { data: userInfo } = await supabase.auth.getUser();
      if (userInfo?.user?.id && workspaceId) {
        await logActivity(
          workspaceId,
          userInfo.user.id,
          'inventory_updated', // Using the same activity type for consistency
          'inventory',
          id,
          item.name || 'New product',
          { 
            changeType: 'item_created',
            itemDetails: {
              sku: item.sku,
              price: item.price,
              quantity: item.quantity,
              category: item.category
            }
          }
        );
      }
    } catch (error) {
      console.error('Failed to track inventory creation activity:', error);
    }
    
    return id;
  },

  async findBySku(workspaceId: string, sku: string): Promise<InventoryItem | null> {
    const { data } = await supabase
      .from('inventory')
      .select('id, data')
      .eq('workspace_id', workspaceId);
    const found = (data || []).find(r => (r.data as any)?.sku === sku);
    if (!found) return null;
    const d = found.data as any;
    return { id: found.id, ...d, createdAt: resolveDate(d.createdAt), updatedAt: resolveDate(d.updatedAt) } as InventoryItem;
  },

  async update(workspaceId: string, id: string, data: Partial<InventoryItem>): Promise<void> {
    const { data: existing } = await supabase.from('inventory').select('data').eq('id', id).single();
    const existingData = existing?.data as any || {};
    const merged = { ...existingData, ...data, updatedAt: new Date().toISOString() };
    assertActiveItemHasPrice(merged);
    await supabaseServiceRole.from('inventory').update({ data: merged }).eq('id', id);

    // Track inventory update activity
    try {
      const { data: userInfo } = await supabase.auth.getUser();
      if (userInfo?.user?.id && workspaceId) {
        // Determine what changed for a more specific activity description
        const changeType = [];
        if (data.price !== undefined && data.price !== existingData.price) changeType.push('price');
        if (data.quantity !== undefined && data.quantity !== existingData.quantity) changeType.push('stock');
        if (data.name !== undefined && data.name !== existingData.name) changeType.push('name');
        if (data.description !== undefined && data.description !== existingData.description) changeType.push('description');
        
        await logActivity(
          workspaceId, 
          userInfo.user.id,
          'inventory_updated',
          'inventory',
          id,
          existingData.name || merged.name || 'Unnamed product',
          { 
            changes: changeType.join(','),
            previousValues: Object.entries(data).reduce((acc, [key, val]) => {
              if (existingData[key] !== val) acc[key] = existingData[key];
              return acc;
            }, {}),
            newValues: data
          }
        );
      }
    } catch (error) {
      console.error('Failed to track inventory update activity:', error);
    }
  },

  async delete(workspaceId: string, id: string): Promise<void> {
    // Get item details before deleting
    const { data: item } = await supabase.from('inventory').select('data').eq('id', id).single();
    const itemData = item?.data as any || {};
    
    // Delete the item
    await supabaseServiceRole.from('inventory').delete().eq('id', id);
    
    // Track inventory deletion
    try {
      const { data: userInfo } = await supabase.auth.getUser();
      if (userInfo?.user?.id && workspaceId) {
        await logActivity(
          workspaceId,
          userInfo.user.id,
          'inventory_updated',
          'inventory',
          id,
          itemData.name || 'Unknown product',
          { 
            changeType: 'item_deleted',
            itemDetails: {
              sku: itemData.sku,
              price: itemData.price,
              category: itemData.category
            }
          }
        );
      }
    } catch (error) {
      console.error('Failed to track inventory deletion activity:', error);
    }
  },

  async adjustStock(
    workspaceId: string,
    item: InventoryItem,
    delta: number,
    reason: string,
    userId: string,
    notes?: string
  ): Promise<void> {
    const previous = item.quantity;
    const newQty = Math.max(0, previous + delta);
    
    // Update the quantity directly to avoid double-tracking in the update method
    const { data: existing } = await supabase.from('inventory').select('data').eq('id', item.id).single();
    const existingData = existing?.data as any || {};
    const merged = { ...existingData, quantity: newQty, updatedAt: new Date().toISOString() };
    await supabaseServiceRole.from('inventory').update({ data: merged }).eq('id', item.id);

    // Log movement in stock_movements table
    const movId = `sm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    await supabaseServiceRole.from('stock_movements').insert({
      id: movId,
      workspace_id: workspaceId,
      data: { productId: item.id, productName: item.name, type: delta >= 0 ? 'in' : 'out', quantity: Math.abs(delta), previousQuantity: previous, newQuantity: newQty, reason, userId, notes: notes || '', timestamp: now }
    });
    
    // Track inventory update in activity tracking system
    try {
      await logActivity(
        workspaceId,
        userId,
        'inventory_updated',
        'inventory',
        item.id,
        item.name,
        {
          changeType: delta >= 0 ? 'stock_added' : 'stock_removed',
          previousQuantity: previous,
          newQuantity: newQty,
          delta: delta,
          reason: reason,
          notes: notes
        }
      );
    } catch (error) {
      console.error('Failed to track inventory adjustment activity:', error);
    }
  },

  async getMovements(workspaceId: string): Promise<StockMovement[]> {
    const { data } = await supabase
      .from('stock_movements')
      .select('id, data')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    return (data || []).map(r => {
      const d = r.data as any;
      return { id: r.id, ...d, timestamp: resolveDate(d.timestamp) } as StockMovement;
    });
  },
};
