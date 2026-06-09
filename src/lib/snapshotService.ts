/**
 * snapshotService.ts
 *
 * Daily full backup of the entire workspace state:
 *   - All tasks (with all custom field values)
 *   - All spaces, folders, lists (with custom statuses)
 *   - All custom field definitions
 *   - All settings (WhatsApp, printer, field mappings, etc.)
 *
 * Called once per day on app load. Uses upsert so it's idempotent.
 * Never deletes — keeps a rolling history of every day the app was used.
 */

import { supabaseServiceRole } from "@/lib/supabase";
import { WorkspaceState } from "@/types/crm";

const SNAPSHOT_KEY = "last_snapshot_date_";

/**
 * Take a daily snapshot of the full workspace state.
 * Skips silently if already snapshotted today.
 */
export async function maybeTakeDailySnapshot(
  workspaceId: string,
  state: WorkspaceState
): Promise<void> {
  try {
    const today = new Date().toISOString().split("T")[0]; // "2026-04-22"
    const storageKey = SNAPSHOT_KEY + workspaceId;

    // Check localStorage first to avoid unnecessary DB calls
    if (localStorage.getItem(storageKey) === today) return;

    const taskCount = state.tasks?.length ?? 0;

    // Don't snapshot an empty/broken state
    if (taskCount === 0 && (state.spaces?.length ?? 0) === 0) return;

    const { error } = await supabaseServiceRole.from("workspace_snapshots").upsert(
      {
        workspace_id: workspaceId,
        snapshot_date: today,
        state: state as unknown as Record<string, unknown>,
        task_count: taskCount,
      },
      { onConflict: "workspace_id,snapshot_date" }
    );

    if (error) {
      console.warn("[Snapshot] Failed to save daily snapshot:", error.message);
    } else {
      localStorage.setItem(storageKey, today);
      console.log(
        `[Snapshot] ✅ Daily snapshot saved for ${workspaceId} — ${taskCount} tasks, ` +
        `${state.lists?.length ?? 0} lists, ${state.customFields?.length ?? 0} fields`
      );
    }
  } catch (err) {
    // Never crash the app over a backup failure
    console.warn("[Snapshot] Exception:", err);
  }
}
