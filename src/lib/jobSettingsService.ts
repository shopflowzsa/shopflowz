import { supabase } from "@/lib/supabase";

export interface JobSettings {
  requirePhotoBeforeEdit: boolean;
}

export const DEFAULT_JOB_SETTINGS: JobSettings = {
  requirePhotoBeforeEdit: false,
};

export async function loadJobSettings(workspaceId: string): Promise<JobSettings> {
  try {
    const { data: row } = await supabase
      .from("workspace_settings")
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("category", "job_settings")
      .maybeSingle();
    if (row?.data) {
      return { ...DEFAULT_JOB_SETTINGS, ...(row.data as Partial<JobSettings>) };
    }
    return DEFAULT_JOB_SETTINGS;
  } catch {
    return DEFAULT_JOB_SETTINGS;
  }
}

export async function saveJobSettings(workspaceId: string, settings: JobSettings): Promise<void> {
  await supabase
    .from("workspace_settings")
    .upsert(
      { workspace_id: workspaceId, category: "job_settings", data: settings },
      { onConflict: "workspace_id,category" }
    );
}
