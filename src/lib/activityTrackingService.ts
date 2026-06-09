import { supabase, supabaseServiceRole } from '@/lib/supabase';

export type ActivityType =
  | 'task_created'
  | 'task_updated'
  | 'task_completed'
  | 'task_status_changed'
  | 'form_submitted'
  | 'invoice_created'
  | 'invoice_updated'
  | 'invoice_paid'
  | 'payment_recorded'
  | 'quote_created'
  | 'quote_updated'
  | 'quote_approved'
  | 'quote_status_changed'
  | 'inventory_updated'
  | 'customer_created'
  | 'customer_updated'
  | 'customer_deleted'
  | 'comment_added'
  | 'user_logged_in'
  | 'user_logged_out';

export type EntityType =
  | 'task'
  | 'invoice'
  | 'payment'
  | 'quote'
  | 'form'
  | 'inventory'
  | 'customer'
  | 'comment'
  | 'user';

export interface ActivityRecord {
  id: string;
  workspaceId: string;
  userId: string;
  userName: string;
  activityType: ActivityType;
  activityDate: string;
  entityType: EntityType;
  entityId?: string;
  entityTitle?: string;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface ActivitySummary {
  id: string;
  workspaceId: string;
  userId: string;
  userName: string;
  summaryDate: string;
  tasksCreated: number;
  tasksUpdated: number;
  tasksCompleted: number;
  formsSubmitted: number;
  invoicesCreated: number;
  quotesCreated: number;
  totalActivities: number;
  activityBreakdown: Record<string, number>;
  entityInteractions: Record<string, string[]>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Log a user activity for tracking and reporting
 */
export async function logActivity(
  workspaceId: string,
  userId: string,
  activityType: ActivityType,
  entityType: EntityType,
  entityId?: string,
  entityTitle?: string,
  metadata: Record<string, any> = {}
): Promise<void> {
  try {
    const { error } = await supabaseServiceRole.from('user_activities').insert({
      workspace_id: workspaceId,
      user_id: userId,
      activity_type: activityType,
      activity_date: new Date().toISOString(),
      entity_type: entityType,
      entity_id: entityId,
      entity_title: entityTitle,
      metadata: metadata,
    });
    if (error) {
      console.error('[logActivity] Supabase error:', error.message, { activityType, entityType, entityId });
    }
  } catch (error) {
    console.error('[logActivity] Threw exception:', error);
  }
}

/**
 * Get recent activities for a specific user
 */
export async function getUserActivities(
  workspaceId: string,
  userId: string,
  limit: number = 100
): Promise<ActivityRecord[]> {
  try {
    const { data, error } = await supabase
      .from('user_activities')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .order('activity_date', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    
    // Join with user profiles to get names
    const userIds = [...new Set(data.map(a => a.user_id))];
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id, display_name')
      .in('id', userIds);
    
    const userMap = new Map();
    users?.forEach(u => userMap.set(u.id, u.display_name));
    
    return (data || []).map(record => ({
      id: record.id,
      workspaceId: record.workspace_id,
      userId: record.user_id,
      userName: userMap.get(record.user_id) || 'Unknown User',
      activityType: record.activity_type as ActivityType,
      activityDate: record.activity_date,
      entityType: record.entity_type as EntityType,
      entityId: record.entity_id,
      entityTitle: record.entity_title,
      metadata: record.metadata || {},
      createdAt: record.created_at,
    }));
  } catch (error) {
    console.error('Error fetching user activities:', error);
    return [];
  }
}

/**
 * Get all workspace activities, optionally filtered
 */
export async function getWorkspaceActivities(
  workspaceId: string,
  startDate?: string,
  endDate?: string,
  activityTypes?: ActivityType[],
  limit: number = 500
): Promise<ActivityRecord[]> {
  try {
    let query = supabase
      .from('user_activities')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('activity_date', { ascending: false })
      .limit(limit);
    
    if (startDate) {
      query = query.gte('activity_date', startDate);
    }
    
    if (endDate) {
      query = query.lte('activity_date', endDate);
    }
    
    if (activityTypes && activityTypes.length > 0) {
      query = query.in('activity_type', activityTypes);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    // Join with user profiles to get names
    const userIds = [...new Set(data.map(a => a.user_id))];
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id, display_name')
      .in('id', userIds);
    
    const userMap = new Map();
    users?.forEach(u => userMap.set(u.id, u.display_name));
    
    return (data || []).map(record => ({
      id: record.id,
      workspaceId: record.workspace_id,
      userId: record.user_id,
      userName: userMap.get(record.user_id) || 'Unknown User',
      activityType: record.activity_type as ActivityType,
      activityDate: record.activity_date,
      entityType: record.entity_type as EntityType,
      entityId: record.entity_id,
      entityTitle: record.entity_title,
      metadata: record.metadata || {},
      createdAt: record.created_at,
    }));
  } catch (error) {
    console.error('Error fetching workspace activities:', error);
    return [];
  }
}

/**
 * Get activity summary for a specific date range
 */
export async function getActivitySummary(
  workspaceId: string,
  startDate: string,
  endDate: string,
  userId?: string
): Promise<ActivitySummary[]> {
  try {
    let query = supabase
      .from('user_activity_summaries')
      .select('*')
      .eq('workspace_id', workspaceId)
      .gte('summary_date', startDate)
      .lte('summary_date', endDate)
      .order('summary_date', { ascending: false });
    
    if (userId) {
      query = query.eq('user_id', userId);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    // Join with user profiles to get names
    const userIds = [...new Set(data.map(a => a.user_id))];
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id, display_name')
      .in('id', userIds);
    
    const userMap = new Map();
    users?.forEach(u => userMap.set(u.id, u.display_name));
    
    return (data || []).map(record => ({
      id: record.id,
      workspaceId: record.workspace_id,
      userId: record.user_id,
      userName: userMap.get(record.user_id) || 'Unknown User',
      summaryDate: record.summary_date,
      tasksCreated: record.tasks_created || 0,
      tasksUpdated: record.tasks_updated || 0,
      tasksCompleted: record.tasks_completed || 0,
      formsSubmitted: record.forms_submitted || 0,
      invoicesCreated: record.invoices_created || 0,
      quotesCreated: record.quotes_created || 0,
      totalActivities: record.total_activities || 0,
      activityBreakdown: record.activity_breakdown || {},
      entityInteractions: record.entity_interactions || {},
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    }));
  } catch (error) {
    console.error('Error fetching activity summaries:', error);
    return [];
  }
}

/**
 * Generate a textual summary for a user's activities
 */
export function generateActivityNarrative(activities: ActivityRecord[]): string {
  if (!activities.length) return "No activities recorded.";
  
  const taskCreatedCount = activities.filter(a => a.activityType === 'task_created').length;
  const taskCompletedCount = activities.filter(a => a.activityType === 'task_completed').length;
  const taskUpdatedCount = activities.filter(a => a.activityType === 'task_updated').length;
  const invoiceCreatedCount = activities.filter(a => a.activityType === 'invoice_created').length;
  const quoteCreatedCount = activities.filter(a => a.activityType === 'quote_created').length;
  
  let narrative = `Summary of ${activities[0].userName}'s activities:\n\n`;
  
  if (taskCreatedCount > 0) {
    narrative += `• Created ${taskCreatedCount} new task${taskCreatedCount !== 1 ? 's' : ''}\n`;
  }
  
  if (taskCompletedCount > 0) {
    narrative += `• Completed ${taskCompletedCount} task${taskCompletedCount !== 1 ? 's' : ''}\n`;
  }
  
  if (taskUpdatedCount > 0) {
    narrative += `• Updated ${taskUpdatedCount} existing task${taskUpdatedCount !== 1 ? 's' : ''}\n`;
  }
  
  if (invoiceCreatedCount > 0) {
    narrative += `• Created ${invoiceCreatedCount} invoice${invoiceCreatedCount !== 1 ? 's' : ''}\n`;
  }
  
  if (quoteCreatedCount > 0) {
    narrative += `• Created ${quoteCreatedCount} quote${quoteCreatedCount !== 1 ? 's' : ''}\n`;
  }
  
  // Add detailed task information
  const completedTasks = activities
    .filter(a => a.activityType === 'task_completed')
    .map(a => a.entityTitle || a.entityId || 'Unnamed task');
  
  if (completedTasks.length > 0) {
    narrative += "\nCompleted tasks:\n";
    completedTasks.forEach(task => {
      narrative += `• ${task}\n`;
    });
  }
  
  return narrative;
}