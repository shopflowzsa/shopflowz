import { supabase } from '@/lib/supabase';
import { startOfDay, endOfDay, format } from 'date-fns';

/**
 * Generates and stores activity summaries for all users in a workspace
 * This can be triggered on a schedule or on-demand
 */
export async function generateActivitySummaries(
  workspaceId: string,
  date: Date = new Date(),
): Promise<boolean> {
  try {
    // Use the provided date or default to today
    const summaryDate = format(date, 'yyyy-MM-dd');
    const startTime = startOfDay(date).toISOString();
    const endTime = endOfDay(date).toISOString();
    
    // Get all user activities for the date
    const { data: activities } = await supabase
      .from('user_activities')
      .select('*')
      .eq('workspace_id', workspaceId)
      .gte('activity_date', startTime)
      .lte('activity_date', endTime);
    
    if (!activities?.length) {
      console.log('No activities found for summary generation');
      return false;
    }
    
    // Group activities by user
    const userActivities = activities.reduce((acc, activity) => {
      if (!acc[activity.user_id]) {
        acc[activity.user_id] = [];
      }
      acc[activity.user_id].push(activity);
      return acc;
    }, {} as Record<string, any[]>);
    
    // Generate summary for each user
    for (const [userId, userActs] of Object.entries(userActivities)) {
      // Count activities by type
      const tasksCreated = userActs.filter(a => a.activity_type === 'task_created').length;
      const tasksUpdated = userActs.filter(a => a.activity_type === 'task_updated').length;
      const tasksCompleted = userActs.filter(a => a.activity_type === 'task_completed').length;
      const formsSubmitted = userActs.filter(a => a.activity_type === 'form_submitted').length;
      const invoicesCreated = userActs.filter(a => a.activity_type === 'invoice_created').length;
      const quotesCreated = userActs.filter(a => a.activity_type === 'quote_created').length;
      
      // Generate activity breakdown
      const activityBreakdown = userActs.reduce((acc, a) => {
        acc[a.activity_type] = (acc[a.activity_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      // Generate entity interactions (which entities the user interacted with)
      const entityInteractions = userActs.reduce((acc, a) => {
        if (a.entity_id && a.entity_title) {
          if (!acc[a.entity_type]) acc[a.entity_type] = [];
          if (!acc[a.entity_type].includes(a.entity_id)) {
            acc[a.entity_type].push(a.entity_id);
          }
        }
        return acc;
      }, {} as Record<string, string[]>);
      
      // Upsert the summary
      await supabase
        .from('user_activity_summaries')
        .upsert({
          workspace_id: workspaceId,
          user_id: userId,
          summary_date: summaryDate,
          tasks_created: tasksCreated,
          tasks_updated: tasksUpdated,
          tasks_completed: tasksCompleted,
          forms_submitted: formsSubmitted,
          invoices_created: invoicesCreated,
          quotes_created: quotesCreated,
          total_activities: userActs.length,
          activity_breakdown: activityBreakdown,
          entity_interactions: entityInteractions,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'workspace_id,user_id,summary_date'
        });
    }
    
    return true;
  } catch (error) {
    console.error('Error generating activity summaries:', error);
    return false;
  }
}

/**
 * Regenerates all summaries for a given date range
 * Useful for backfilling data
 */
export async function regenerateAllSummaries(
  workspaceId: string,
  startDate: Date,
  endDate: Date = new Date()
): Promise<boolean> {
  try {
    // Generate a list of dates
    const dates: Date[] = [];
    let currentDate = startDate;
    
    while (currentDate <= endDate) {
      dates.push(new Date(currentDate));
      currentDate = new Date(currentDate.setDate(currentDate.getDate() + 1));
    }
    
    // Process each date
    for (const date of dates) {
      await generateActivitySummaries(workspaceId, date);
    }
    
    return true;
  } catch (error) {
    console.error('Error regenerating activity summaries:', error);
    return false;
  }
}