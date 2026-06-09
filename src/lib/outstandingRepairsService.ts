import { supabase } from '@/lib/supabase';

export interface OutstandingRepairsSettings {
  /** Which list to scan for outstanding repairs */
  listId: string;
  /** Which custom field holds the repair value (number field) */
  valueFieldId: string;
  /**
   * Status IDs that are considered "outstanding" (uncollected).
   * If empty, all tasks in the list that are NOT in completedStatusIds are counted.
   */
  outstandingStatusIds: string[];
  /**
   * Status IDs that mean the job is done / collected.
   * Tasks in these statuses are excluded from the outstanding total.
   */
  completedStatusIds: string[];
}

export const DEFAULT_OUTSTANDING_SETTINGS: OutstandingRepairsSettings = {
  listId: '',
  valueFieldId: '',
  outstandingStatusIds: [],
  completedStatusIds: [],
};

const CATEGORY = 'outstandingRepairs';

export async function loadOutstandingRepairsSettings(
  workspaceId: string
): Promise<OutstandingRepairsSettings> {
  try {
    const { data: row } = await supabase
      .from('workspace_settings')
      .select('data')
      .eq('workspace_id', workspaceId)
      .eq('category', CATEGORY)
      .maybeSingle();
    if (!row?.data) return { ...DEFAULT_OUTSTANDING_SETTINGS };
    return { ...DEFAULT_OUTSTANDING_SETTINGS, ...(row.data as any) };
  } catch {
    return { ...DEFAULT_OUTSTANDING_SETTINGS };
  }
}

export async function saveOutstandingRepairsSettings(
  workspaceId: string,
  settings: OutstandingRepairsSettings
): Promise<void> {
  await supabase
    .from('workspace_settings')
    .upsert(
      { workspace_id: workspaceId, category: CATEGORY, data: { ...settings } },
      { onConflict: 'workspace_id,category' }
    );
}
