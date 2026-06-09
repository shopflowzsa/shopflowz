import { supabase } from '@/lib/supabase';

export interface Technician {
  id: string;
  name: string;
  /** Monthly job completion target */
  monthlyTarget: number;
  /** Optional colour for charts */
  color?: string;
  active: boolean;
}

export interface TechAssessmentSettings {
  technicians: Technician[];
  /**
   * Which task status id(s) count as "completed" for the assessment.
   * If empty, defaults to "done" / "complete" / "paid" / "collected".
   */
  completedStatusIds: string[];
  /** Which month/range to score on by default */
  defaultRange: 3 | 6 | 12;
  /**
   * The custom field ID whose numeric value is summed as the assessment amount.
   * If empty, falls back to counting completed jobs.
   */
  assessmentFieldId?: string;
  /**
   * The custom date field ID that indicates when a job was completed.
   * Used to determine "this month" for assessment. If empty, uses task createdAt.
   */
  completedDateFieldId?: string;
}

export const DEFAULT_TECH_SETTINGS: TechAssessmentSettings = {
  technicians: [],
  completedStatusIds: [],
  defaultRange: 6,
  assessmentFieldId: undefined,
  completedDateFieldId: undefined,
};

const PATH = 'techAssessment';

export async function loadTechAssessmentSettings(
  workspaceId: string
): Promise<TechAssessmentSettings> {
  try {
    const { data: row } = await supabase
      .from('workspace_settings')
      .select('data')
      .eq('workspace_id', workspaceId)
      .eq('category', PATH)
      .maybeSingle();
    if (!row?.data) return { ...DEFAULT_TECH_SETTINGS };
    return { ...DEFAULT_TECH_SETTINGS, ...(row.data as any) } as TechAssessmentSettings;
  } catch {
    return { ...DEFAULT_TECH_SETTINGS };
  }
}

export async function saveTechAssessmentSettings(
  workspaceId: string,
  settings: TechAssessmentSettings
): Promise<void> {
  await supabase
    .from('workspace_settings')
    .upsert(
      { workspace_id: workspaceId, category: PATH, data: { ...settings } },
      { onConflict: 'workspace_id,category' }
    );
}

/** Convenience: load just the technician list (used by TaskDetailPanel) */
export async function loadTechnicians(workspaceId: string): Promise<Technician[]> {
  const s = await loadTechAssessmentSettings(workspaceId);
  return s.technicians.filter(t => t.active);
}
