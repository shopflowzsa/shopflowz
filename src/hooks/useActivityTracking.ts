import { useAuth } from "@/contexts/AuthContext";
import { logActivity, ActivityType, EntityType } from "@/lib/activityTrackingService";

/**
 * Hook for tracking user activities throughout the application
 */
export function useActivityTracking() {
  const { workspaceId, user } = useAuth();
  
  /**
   * Track an activity
   */
  const trackActivity = (
    activityType: ActivityType,
    entityType: EntityType,
    entityId?: string,
    entityTitle?: string,
    metadata: Record<string, any> = {}
  ) => {
    if (!workspaceId || !user?.uid) return;
    
    logActivity(
      workspaceId,
      user.uid,
      activityType,
      entityType,
      entityId,
      entityTitle,
      metadata
    );
  };
  
  /**
   * Track task creation
   */
  const trackTaskCreated = (taskId: string, taskTitle: string, listId?: string) => {
    trackActivity('task_created', 'task', taskId, taskTitle, { listId });
  };
  
  /**
   * Track task update
   */
  const trackTaskUpdated = (taskId: string, taskTitle: string, changes?: string[]) => {
    trackActivity('task_updated', 'task', taskId, taskTitle, { changes });
  };
  
  /**
   * Track task completion
   */
  const trackTaskCompleted = (taskId: string, taskTitle: string) => {
    trackActivity('task_completed', 'task', taskId, taskTitle);
  };
  
  /**
   * Track task status change
   */
  const trackTaskStatusChanged = (taskId: string, taskTitle: string, oldStatus: string, newStatus: string) => {
    trackActivity('task_status_changed', 'task', taskId, taskTitle, { oldStatus, newStatus });
  };
  
  /**
   * Track form submission
   */
  const trackFormSubmitted = (formId: string, formName: string) => {
    trackActivity('form_submitted', 'form', formId, formName);
  };
  
  /**
   * Track invoice creation
   */
  const trackInvoiceCreated = (invoiceId: string, invoiceNumber: string, amount: number) => {
    trackActivity('invoice_created', 'invoice', invoiceId, invoiceNumber, { amount });
  };
  
  /**
   * Track invoice payment
   */
  const trackInvoicePaid = (invoiceId: string, invoiceNumber: string, amount: number) => {
    trackActivity('invoice_paid', 'invoice', invoiceId, invoiceNumber, { amount });
  };
  
  /**
   * Track quote creation
   */
  const trackQuoteCreated = (quoteId: string, quoteNumber: string, amount: number) => {
    trackActivity('quote_created', 'quote', quoteId, quoteNumber, { amount });
  };
  
  /**
   * Track quote approval
   */
  const trackQuoteApproved = (quoteId: string, quoteNumber: string) => {
    trackActivity('quote_approved', 'quote', quoteId, quoteNumber);
  };
  
  /**
   * Track adding a comment
   */
  const trackCommentAdded = (commentId: string, entityId: string, entityType: Exclude<EntityType, 'comment'>) => {
    trackActivity('comment_added', 'comment', commentId, undefined, { entityId, entityType });
  };
  
  /**
   * Track inventory update
   */
  const trackInventoryUpdated = (productId: string, productName: string, changeType: string) => {
    trackActivity('inventory_updated', 'inventory', productId, productName, { changeType });
  };
  
  /**
   * Track user login
   */
  const trackUserLogin = () => {
    trackActivity('user_logged_in', 'user', user?.uid, user?.displayName);
  };
  
  /**
   * Track user logout
   */
  const trackUserLogout = () => {
    trackActivity('user_logged_out', 'user', user?.uid, user?.displayName);
  };
  
  return {
    trackActivity,
    trackTaskCreated,
    trackTaskUpdated,
    trackTaskCompleted,
    trackTaskStatusChanged,
    trackFormSubmitted,
    trackInvoiceCreated,
    trackInvoicePaid,
    trackQuoteCreated,
    trackQuoteApproved,
    trackCommentAdded,
    trackInventoryUpdated,
    trackUserLogin,
    trackUserLogout,
  };
}