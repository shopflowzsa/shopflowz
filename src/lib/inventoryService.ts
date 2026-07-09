import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { logActivity } from "@/lib/activityTrackingService";
import { bustPublicProductCache } from "@/lib/productService";

// Voltage: 1–50V every 1V, 55–200V every 5V, 210–500V every 10V, 525–1000V every 25V, 1050–2000V every 50V
function buildVoltageList(): string[] {
  const out: string[] = [];
  for (let v = 1; v <= 50; v++) out.push(`${v}V`);
  for (let v = 55; v <= 200; v += 5) out.push(`${v}V`);
  for (let v = 210; v <= 500; v += 10) out.push(`${v}V`);
  for (let v = 525; v <= 1000; v += 25) out.push(`${v}V`);
  for (let v = 1050; v <= 2000; v += 50) out.push(`${v}V`);
  return out;
}

// Amperage: 0.1–20mA every 0.1mA, 21–100mA every 1mA, 105–500mA every 5mA,
//           510–900mA every 10mA, 1–10A every 0.5A, 11–30A every 1A, 32–100A every 2A, 105–300A every 5A
function buildAmperageList(): string[] {
  const out: string[] = [];
  for (let v = 1; v <= 200; v++) out.push(`${(v / 10).toFixed(1)}mA`);   // 0.1mA … 20.0mA
  for (let v = 21; v <= 100; v++) out.push(`${v}mA`);                     // 21mA … 100mA
  for (let v = 105; v <= 500; v += 5) out.push(`${v}mA`);                 // 105mA … 500mA
  for (let v = 510; v <= 900; v += 10) out.push(`${v}mA`);                // 510mA … 900mA
  for (let v = 2; v <= 20; v++) out.push(`${(v / 2).toFixed(1)}A`);       // 1.0A … 10.0A (step 0.5)
  for (let v = 11; v <= 30; v++) out.push(`${v}A`);                       // 11A … 30A
  for (let v = 32; v <= 100; v += 2) out.push(`${v}A`);                   // 32A … 100A
  for (let v = 105; v <= 300; v += 5) out.push(`${v}A`);                  // 105A … 300A
  return out;
}

export const VOLTAGE_RANGES: string[] = buildVoltageList();
export const AMPERAGE_RANGES: string[] = buildAmperageList();

export type VoltageRange = string;
export type AmperageRange = string;

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  description: string;
  category: string;
  subcategory?: string;
  voltageRange?: VoltageRange;
  amperageRange?: AmperageRange;
  rdson?: string;
  vbe?: string;
  price: number;
  salePrice?: number; // Optional discounted price — when set, the storefront and Google Shopping feed treat this as the sale price
  costPrice: number;
  quantity: number;
  reorderLevel: number;
  manufacturer?: string;
  supplier?: string;
  location?: string;
  imageUrl?: string;
  status: "active" | "inactive" | "on_order";
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
    bustPublicProductCache(workspaceId);
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
    const { data: existing } = await supabaseServiceRole.from('inventory').select('data').eq('id', id).single();
    const existingData = existing?.data as any || {};
    const merged = { ...existingData, ...data, updatedAt: new Date().toISOString() };
    assertActiveItemHasPrice(merged);
    await supabaseServiceRole.from('inventory').update({ data: merged }).eq('id', id);
    bustPublicProductCache(workspaceId);
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
    bustPublicProductCache(workspaceId);
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

  async getOutMovementsSince(workspaceId: string, since: Date): Promise<StockMovement[]> {
    const { data } = await supabase
      .from('stock_movements')
      .select('id, data')
      .eq('workspace_id', workspaceId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false });
    return (data || [])
      .map(r => { const d = r.data as any; return { id: r.id, ...d, timestamp: resolveDate(d.timestamp) } as StockMovement; })
      .filter(m => m.type === 'out');
  },
};
