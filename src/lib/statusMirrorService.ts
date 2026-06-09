import { Task, WorkspaceState, Quote, Invoice, TaskStatus } from "@/types/crm";

export function getTaskAccountsStatus(task: Task, quotes: Quote[], invoices: Invoice[]): TaskStatus {
  const quote = quotes.find(q => q.taskId === task.id);
  
  if (!quote || quote.status === "draft") {
    return "in_progress"; // Task is still in regular workflow or quote is being drafted
  }
  
  const invoice = quote ? invoices.find(i => i.quoteId === quote.id) : null;
  
  if (invoice) {
    if (invoice.status === "paid" || invoice.amountPaid >= invoice.total) {
      return "paid";
    }
    return "invoiced";
  }
  
  if (quote.status === "sent" || quote.status === "approved") {
    return "quoted";
  }
  
  // For rejected/expired quotes, keep in progress
  return "in_progress";
}

export function createMirrorTask(originalTask: Task, accountsStatus: TaskStatus): Task {
  return {
    ...originalTask,
    id: `mirror_${originalTask.id}`,
    status: accountsStatus,
    title: `${originalTask.title} (${originalTask.jobNumber})`,
  };
}

export function getMirrorTasks(workspace: WorkspaceState, statusListId: string): Task[] {
  const quotes = workspace.quotes || [];
  const invoices = workspace.invoices || [];
  
  // Get all tasks in the current space
  const statusList = workspace.lists.find(l => l.id === statusListId);
  if (!statusList) return [];
  
  const statusFolder = workspace.folders.find(f => f.id === statusList.parentId);
  if (!statusFolder) return [];
  
  // Get all lists in this space (excluding the status list itself)
  const spaceListIds = workspace.lists
    .filter(l => 
      (l.parentType === "space" && l.parentId === statusFolder.spaceId) ||
      (l.parentType === "folder" && workspace.folders.find(f => f.id === l.parentId)?.spaceId === statusFolder.spaceId)
    )
    .filter(l => l.id !== statusListId)
    .map(l => l.id);
  
  // Get all tasks in these lists
  const spaceTasks = workspace.tasks.filter(t => spaceListIds.includes(t.listId));
  
  // Create mirror tasks with accounts status
  return spaceTasks.map(task => {
    const accountsStatus = getTaskAccountsStatus(task, quotes, invoices);
    return createMirrorTask(task, accountsStatus);
  });
}

export function updateTaskAccountsStatus(
  workspace: WorkspaceState, 
  taskId: string, 
  statusListId: string
): WorkspaceState {
  // This is called when quotes/invoices are created/updated
  // The mirror tasks will be automatically updated by getMirrorTasks
  return workspace;
}