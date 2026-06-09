-- Fix restrictive RLS policies for activity tracking tables
drop policy if exists "users can insert their own activities" on public.user_activities;

create policy "users can insert activities"
on public.user_activities for insert
with check (true);

-- Ensure workspace members can run summary generation
grant EXECUTE on function public.generate_user_activity_summary TO authenticated;