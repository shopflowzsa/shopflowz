/**
 * Ecommerce Product Management Service
 * Handles products, categories, variants, and inventory
 */

/**
 * Injects Cloudinary transformations into a Cloudinary image URL so every
 * product image shown in the public store has a clean white background,
 * square crop and consistent 600 × 600 size.
 *
 * Works only on Cloudinary URLs — external URLs are returned unchanged.
 * Transformations applied (all available on the free Cloudinary plan):
 *   b_white   – white background fill
 *   c_pad     – pad to target dimensions without cropping the product
 *   ar_1:1    – enforce square aspect ratio
 *   w_600,h_600 – output size
 *   f_jpg     – convert to JPEG (no transparency needed with white bg)
 *   q_auto:good – smart compression
 */
export function toCleanProductImageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (!url.includes('res.cloudinary.com')) return url; // non-Cloudinary — leave as-is

  const marker = '/upload/';
  const idx = url.indexOf(marker);
  if (idx === -1) return url;

  const base = url.slice(0, idx + marker.length);
  let rest  = url.slice(idx + marker.length);

  // Strip any existing transformation block (everything before the version "v…" or first path segment)
  // e.g. "b_white,c_fill/v1234/folder/file.jpg" → "v1234/folder/file.jpg"
  const versionMatch = rest.match(/^((?:[^/]+\/)*)?(v\d+\/.+)$/);
  if (versionMatch) {
    rest = versionMatch[2]; // keep only "v1234/..." part
  }

  const transform = 'b_white,c_pad,ar_1:1,w_600,h_600,f_jpg,q_auto:good';
  return `${base}${transform}/${rest}`;
}

import { supabase as sbClient, publicRestGet, supabaseServiceRole } from './supabase';
import { 
  Product, 
  ProductCategory, 
  ProductVariant,
  StockMovement,
  InventoryAlert,
  PublicProduct,
  PublicCategory 
} from '@/types/ecommerce';

// ─── Product Management ──────────────────────────────────────────────────

function getProductSellPrice(product: Partial<Product> & Record<string, any>): number {
  const variantPrices = (product.variants || []).map((variant: ProductVariant) => Number(variant.price || 0));
  return Math.max(Number(product.price ?? product.unitPrice ?? 0), ...variantPrices, 0);
}

function assertActiveProductHasPrice(product: Partial<Product> & Record<string, any>): void {
  const isActive = product.isActive === true || product.status === 'active';
  if (isActive && getProductSellPrice(product) <= 0) {
    throw new Error('A product must have a selling price before it can be marked active.');
  }
}

export async function createProduct(workspaceId: string, product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const id = `prod_${Date.now()}`;
  const now = new Date().toISOString();
  const newProduct = { ...product, id, createdAt: now, updatedAt: now };
  assertActiveProductHasPrice(newProduct);
  await sbClient.from('inventory').insert({ id, workspace_id: workspaceId, data: newProduct });
  return id;
}

export async function updateProduct(workspaceId: string, productId: string, updates: Partial<Product>): Promise<void> {
  const { data: existing } = await sbClient.from('inventory').select('data').eq('id', productId).single();
  const merged = { ...(existing?.data as any || {}), ...updates, updatedAt: new Date().toISOString() };
  assertActiveProductHasPrice(merged);
  await sbClient.from('inventory').update({ data: merged }).eq('id', productId);
}

export async function deleteProduct(workspaceId: string, productId: string): Promise<void> {
  await sbClient.from('inventory').delete().eq('id', productId);
}

export async function getProduct(workspaceId: string, productId: string): Promise<Product | null> {
  const { data } = await sbClient.from('inventory').select('id, data').eq('id', productId).single();
  if (!data) return null;
  return { id: data.id, ...(data.data as any) } as Product;
}

export async function getProducts(
  workspaceId: string,
  options: {
    categoryId?: string;
    isActive?: boolean;
    isFeatured?: boolean;
    limit?: number;
    startAfterDoc?: any;
  } = {}
): Promise<Product[]> {
  // Read from Supabase inventory — single source of truth
  const PAGE2 = 1000;
  let allRows2: any[] = [];
  let from2 = 0;
  while (true) {
    const { data, error } = await sbClient
      .from('inventory')
      .select('id, data, updated_at')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .range(from2, from2 + PAGE2 - 1);
    if (error) { console.error('[getProducts/admin] Supabase error:', error.message); break; }
    allRows2 = allRows2.concat(data || []);
    if ((data || []).length < PAGE2) break;
    from2 += PAGE2;
  }

  let items: any[] = allRows2.map(r => ({ id: r.id, ...(r.data as Record<string, any>) }));

  // Apply filters
  if (options.isActive !== undefined) {
    items = items.filter(i => options.isActive ? i.status === 'active' : i.status !== 'active');
  }
  if (options.categoryId) {
    items = items.filter(i => i.category === options.categoryId);
  }
  if (options.limit) {
    items = items.slice(0, options.limit);
  }

  // Map inventory item → Product shape
  return items.map(item => ({
    id: item.id,
    name: (item.name as string) || '',
    description: (item.description as string) || '',
    shortDescription: (item.description as string) || '',
    sku: (item.sku as string) || item.id,
    categoryIds: item.category ? [item.category as string] : [],
    images: item.imageUrl
      ? [{ id: '1', url: item.imageUrl as string, alt: item.name as string, sortOrder: 0, isDefault: true }]
      : [],
    variants: [{
      id: `${item.id}_v1`,
      sku: (item.sku as string) || item.id,
      name: 'Standard',
      price: (item.price as number) || (item.unitPrice as number) || 0,
      compareAtPrice: undefined,
      stockQuantity: (item.quantity as number | undefined) ?? (item.currentStock as number | undefined) ?? 0,
      lowStockThreshold: (item.reorderLevel as number) || (item.minStock as number) || 5,
      isActive: item.status === 'active',
      attributes: [],
      packSize: (item as any).packSize,
      packPrice: (item as any).packPrice,
    }],
    isActive: item.status === 'active',
    isFeatured: false,
    brand: (item.supplier as string) || undefined,
    tags: [],
    createdAt: (item.createdAt as string) || new Date().toISOString(),
    updatedAt: (item.updatedAt as string) || new Date().toISOString(),
    createdBy: 'system',
  } as Product));
}

// ─── Category Management ─────────────────────────────────────────────────

export async function createCategory(workspaceId: string, category: Omit<ProductCategory, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  // Categories are derived from inventory item.category field
  return `cat_${category.name.toLowerCase().replace(/\s+/g, '_')}`;
}

export async function getCategories(workspaceId: string, activeOnly: boolean = false): Promise<ProductCategory[]> {
  // Derive distinct categories from Supabase inventory
  const { data: rows, error } = await sbClient
    .from('inventory')
    .select('data')
    .eq('workspace_id', workspaceId)
    .range(0, 9999);

  if (error) {
    console.error('[getCategories] Supabase error:', error.message);
    return [];
  }

  const categoryMap = new Map<string, number>();
  (rows || []).forEach(r => {
    const d = r.data as Record<string, any>;
    if (activeOnly && d?.status !== 'active') return;
    const cat = (d?.category as string) || '';
    if (cat) categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
  });

  return Array.from(categoryMap.entries()).map(([name], i) => ({
    id: name,
    name,
    description: '',
    isActive: true,
    sortOrder: i,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as ProductCategory));
}

// ─── Inventory Management ────────────────────────────────────────────────

export async function updateStock(
  workspaceId: string, 
  variantId: string, 
  movement: Omit<StockMovement, 'id' | 'timestamp'>
): Promise<void> {
  const id = `mov_${Date.now()}`;
  try {
    await sbClient.from('stock_movements').insert({
      id, workspace_id: workspaceId,
      data: { ...movement, id, productVariantId: variantId, timestamp: new Date().toISOString() }
    });
  } catch (_) {}
}

export async function getStockMovements(
  workspaceId: string,
  variantId?: string,
  limitCount: number = 50
): Promise<StockMovement[]> {
  const { data } = await sbClient
    .from('stock_movements')
    .select('id, data')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limitCount);
  const rows = (data || []).map(r => ({ id: r.id, ...(r.data as any) } as StockMovement));
  return variantId ? rows.filter(r => r.productVariantId === variantId) : rows;
}

export async function createInventoryAlert(
  workspaceId: string, 
  alert: Omit<InventoryAlert, 'id' | 'createdAt' | 'isRead' | 'isResolved'>
): Promise<void> {
  const id = `alert_${Date.now()}`;
  const newAlert: InventoryAlert = { ...alert, id, createdAt: new Date().toISOString(), isRead: false, isResolved: false };
  try { await sbClient.from('inventory_alerts').insert({ id, workspace_id: workspaceId, data: newAlert }); } catch (_) {}
}

export async function getInventoryAlerts(workspaceId: string, unresolvedOnly: boolean = false): Promise<InventoryAlert[]> {
  const { data: rows } = await sbClient.from('inventory_alerts').select('id, data').eq('workspace_id', workspaceId).order('created_at', { ascending: false });
  const alerts = (rows || []).map(r => ({ id: r.id, ...(r.data as any) } as InventoryAlert));
  return unresolvedOnly ? alerts.filter(a => !a.isResolved) : alerts;
}

// ─── Public Store Functions ──────────────────────────────────────────────

export async function getPublicProducts(
  workspaceId: string,
  options: {
    categoryId?: string;
    search?: string;
    sortBy?: 'name' | 'price_asc' | 'price_desc' | 'newest' | 'popular';
    page?: number;
    limit?: number;
  } = {}
): Promise<{ products: PublicProduct[]; totalCount: number; }> {
  let rows: any[] | null = null;
  try {
    // Filter active items with a price at the DB level — avoids fetching the full
    // inventory table and sending unused rows over the wire (reduces Supabase egress).
    const { data } = await supabaseServiceRole
      .from('inventory')
      .select('id,data,updated_at')
      .eq('workspace_id', workspaceId)
      .eq('data->>status', 'active')
      .or('data->>price.gt.0,data->>unitPrice.gt.0')
      .order('updated_at', { ascending: false })
      .limit(2000);
    rows = data;
  } catch (e) {
    console.error('[getPublicProducts] fetch error:', e);
    // Fallback: fetch all and filter in JS if the filtered query fails
    try {
      const { data } = await supabaseServiceRole
        .from('inventory')
        .select('id,data,updated_at')
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })
        .limit(2000);
      rows = data;
    } catch (e2) { console.error('[getPublicProducts] fallback fetch error:', e2); }
  }

  let items: any[] = (rows || []).map(r => ({ id: r.id, ...(r.data as Record<string, any>) }));

  // Only show active items that have a sellable price.
  // Use || not ?? so that price:0 falls through to unitPrice (items edited via both inventory services).
  items = items.filter(item => item.status === 'active' && Number(item.price || item.unitPrice || 0) > 0);

  // Apply filters
  if (options.categoryId) {
    items = items.filter(item => item.category === options.categoryId);
  }
  if (options.search) {
    const s = options.search.toLowerCase();
    items = items.filter(item =>
      (item.name as string)?.toLowerCase().includes(s) ||
      (item.description as string)?.toLowerCase().includes(s) ||
      (item.sku as string)?.toLowerCase().includes(s)
    );
  }

  // Transform inventory items → PublicProduct shape
  const publicProducts: PublicProduct[] = items.map(item => {
    const regularPrice = Number(item.price || item.unitPrice || 0);
    const rawSale = typeof item.salePrice === 'number' ? item.salePrice : 0;
    const saleActive = rawSale > 0 && rawSale < regularPrice;

    // ── Images ─────────────────────────────────────────────────────────────
    const mainImg = item.imageUrl
      ? [{ id: '1', url: toCleanProductImageUrl(item.imageUrl as string) ?? (item.imageUrl as string), alt: item.name as string, sortOrder: 0, isDefault: true }]
      : [];
    const extraImgs = ((item.extraImages as string[]) || []).map((url, i) => ({
      id: `extra_${i + 2}`,
      url: toCleanProductImageUrl(url) ?? url,
      alt: `${item.name as string} — view ${i + 2}`,
      sortOrder: i + 1,
      isDefault: false,
    }));
    const images = [...mainImg, ...extraImgs];

    // ── Variants ────────────────────────────────────────────────────────────
    const namedVariants = item.productVariants as Array<{ id: string; name: string; price?: number; stock: number; sku?: string; }> | undefined;
    const hasNamedVariants = Array.isArray(namedVariants) && namedVariants.length > 0;

    const variants = hasNamedVariants
      ? namedVariants!.map(v => ({
          id: v.id || `v_${v.name}`,
          sku: v.sku || (item.sku as string) || item.id,
          name: v.name,
          price: Number(v.price ?? regularPrice),
          compareAtPrice: undefined,
          salePrice: undefined,
          inStock: Number(v.stock ?? 0) > 0,
          attributes: [],
          packSize: undefined,
          packPrice: undefined,
        }))
      : [{
          id: `${item.id}_v1`,
          sku: (item.sku as string) || item.id,
          name: 'Standard',
          price: saleActive ? rawSale : regularPrice,
          compareAtPrice: saleActive ? regularPrice : undefined,
          salePrice: saleActive ? rawSale : undefined,
          inStock: (() => {
            const qty = (item.quantity !== undefined && item.quantity !== null)
              ? item.quantity
              : (item.currentStock !== undefined && item.currentStock !== null)
                ? item.currentStock
                : undefined;
            return qty === undefined || Number(qty) > 0;
          })(),
          attributes: [],
          packSize: (item as any).packSize,
          packPrice: (item as any).packPrice,
        }];

    const quantityInStock = hasNamedVariants
      ? namedVariants!.reduce((sum, v) => sum + Number(v.stock ?? 0), 0)
      : ((item.quantity as number | undefined) ?? (item.currentStock as number | undefined) ?? 0);

    return {
      id: item.id,
      name: item.name as string,
      description: (item.description as string) || '',
      shortDescription: (item.description as string) || '',
      images,
      variants,
      brand: (item.supplier as string) || undefined,
      category: (item.category as string) || '',
      tags: [],
      quantityInStock,
      averageRating: undefined,
      reviewCount: undefined,
    };
  });

  return {
    products: publicProducts,
    totalCount: publicProducts.length,
  };
}

export async function getPublicCategories(workspaceId: string): Promise<PublicCategory[]> {
  let rows: any[] | null = null;
  try {
    // Only fetch active+priced items and only the category field to minimise egress
    const { data } = await supabaseServiceRole
      .from('inventory')
      .select('data->category,data->price,data->unitPrice')
      .eq('workspace_id', workspaceId)
      .eq('data->>status', 'active')
      .limit(2000);
    rows = data;
  } catch (e) {
    console.error('[getPublicCategories] fetch error:', e);
    return [];
  }

  const categoryMap = new Map<string, number>();
  (rows || []).forEach(r => {
    const d = r as Record<string, any>;
    if (Number(d.price || d.unitPrice || 0) <= 0) return;
    const cat = (d.category as string) || '';
    if (cat) categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
  });

  return Array.from(categoryMap.entries()).map(([name, count]) => ({
    id: name,
    name,
    productCount: count,
  }));
}

// ─── Helper Functions ────────────────────────────────────────────────────

async function checkProductHasStock(workspaceId: string, productId: string): Promise<boolean> {
  const product = await getProduct(workspaceId, productId);
  if (!product) return false;
  
  return product.variants.some(variant => variant.stockQuantity > 0);
}

async function updateProductSearchIndex(_workspaceId: string, _product: Product): Promise<void> {
  // Supabase is the source of truth — no separate search index needed
}

async function removeProductFromSearchIndex(_workspaceId: string, _productId: string): Promise<void> {
  // No-op
}
