import { supabase, supabaseServiceRole } from '@/lib/supabase';
import { EcommerceSettings, DEFAULT_ECOMMERCE_SETTINGS } from '@/types/ecommerce';

/**
 * Load ecommerce settings for a workspace
 */
export async function loadEcommerceSettings(workspaceId: string): Promise<EcommerceSettings> {
  try {
    const { data: row } = await supabaseServiceRole
      .from('workspace_settings')
      .select('data')
      .eq('workspace_id', workspaceId)
      .eq('category', 'ecommerce')
      .maybeSingle();
    if (row?.data) {
      // Merge over defaults so legacy rows saved before newer fields
      // (deliveryZones, pickupLocations, services, …) existed don't surface
      // as `undefined` and crash the settings UI on `.length` / `.map`.
      return { ...DEFAULT_ECOMMERCE_SETTINGS, ...(row.data as Partial<EcommerceSettings>) };
    }
    return DEFAULT_ECOMMERCE_SETTINGS;
  } catch (error) {
    console.error('Error loading ecommerce settings:', error);
    throw error;
  }
}

/**
 * Save ecommerce settings for a workspace
 */
export async function saveEcommerceSettings(
  workspaceId: string,
  settings: EcommerceSettings,
  userId: string
): Promise<void> {
  try {
    await supabase
      .from('workspace_settings')
      .upsert(
        { workspace_id: workspaceId, category: 'ecommerce', data: { ...settings, updatedBy: userId } },
        { onConflict: 'workspace_id,category' }
      );
  } catch (error) {
    console.error('Error saving ecommerce settings:', error);
    throw error;
  }
}

/**
 * Calculate delivery fee based on delivery zones
 */
export function calculateDeliveryFee(
  settings: EcommerceSettings,
  deliveryAddress: string,
  orderTotal: number
): number {
  // Check for free delivery threshold
  if (settings.freeDeliveryThreshold && orderTotal >= settings.freeDeliveryThreshold) {
    return 0;
  }
  
  // Check delivery zones (basic implementation - can be enhanced)
  const zones = settings.deliveryZones || [];
  if (zones.length > 0) {
    const addressLower = (deliveryAddress || '').toLowerCase();

    for (const zone of zones) {
      if (!zone.isActive) continue;

      // Check if min order amount is met
      if (zone.minOrderAmount && orderTotal < zone.minOrderAmount) {
        continue;
      }

      // Check area codes
      if (zone.areaCodes && zone.areaCodes.length > 0) {
        const hasMatchingAreaCode = zone.areaCodes.some(code =>
          code && addressLower.includes(code.toLowerCase())
        );
        if (hasMatchingAreaCode) return zone.fee;
      }

      // Check suburbs
      if (zone.suburbs && zone.suburbs.length > 0) {
        const hasMatchingSuburb = zone.suburbs.some(suburb =>
          suburb && addressLower.includes(suburb.toLowerCase())
        );
        if (hasMatchingSuburb) return zone.fee;
      }
    }
  }
  
  // Return default delivery fee
  return settings.defaultDeliveryFee;
}
