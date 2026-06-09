-- Extend warning_rules for stale-task rule types.
--
-- The original create_warning_rules.sql only modelled "missing_fields" rules
-- (require certain fields before a task can move). The app has since added:
--   • block_new_in_stale_list — hard-block creating a new task while an
--     existing task in the same list/folder is older than the threshold.
--   • stale_task — periodic sweep that asks reception to justify overdue tasks.
--
-- WarningRulesPanel writes the columns below; without them, inserts/updates
-- silently fail and select("*") returns no rule_type, so the block check at
-- staleTaskService.ts:70 skips every rule.

ALTER TABLE warning_rules
  ADD COLUMN IF NOT EXISTS rule_type TEXT NOT NULL DEFAULT 'missing_fields',
  ADD COLUMN IF NOT EXISTS list_id TEXT,
  ADD COLUMN IF NOT EXISTS stale_threshold_days INTEGER,
  ADD COLUMN IF NOT EXISTS stale_check_trigger TEXT,
  ADD COLUMN IF NOT EXISTS stale_reasons TEXT[] NOT NULL DEFAULT '{}';

-- List-scoped stale rules don't need a folder, so loosen the NOT NULL.
ALTER TABLE warning_rules ALTER COLUMN folder_id DROP NOT NULL;
