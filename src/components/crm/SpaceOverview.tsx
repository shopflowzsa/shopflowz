import { useState, useMemo } from "react";
import { WorkspaceState, Task, TaskStatus, Quote, Invoice } from "@/types/crm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  FileText, 
  CheckCircle, 
  Clock, 
  DollarSign, 
  Receipt, 
  CreditCard,
  Package,
  ArrowRight 
} from "lucide-react";

interface SpaceOverviewProps {
  spaceId: string;
  workspace: WorkspaceState;
  onUpdateWorkspace: (updates: Partial<WorkspaceState>) => void;
  onTaskClick: (taskId: string) => void;
}

export function SpaceOverview({ spaceId, workspace, onUpdateWorkspace, onTaskClick }: SpaceOverviewProps) {
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const space = workspace.spaces.find(s => s.id === spaceId);
  
  // Get all tasks in this space (including from folders)
  const spaceTasks = useMemo(() => {
    const spaceListIds: string[] = [];
    
    // Direct space lists
    spaceListIds.push(...workspace.lists.filter(l => l.parentType === "space" && l.parentId === spaceId).map(l => l.id));
    
    // Folder lists in this space
    const spaceFolders = workspace.folders.filter(f => f.spaceId === spaceId);
    spaceFolders.forEach(folder => {
      spaceListIds.push(...workspace.lists.filter(l => l.parentType === "folder" && l.parentId === folder.id).map(l => l.id));
    });
    
    return workspace.tasks.filter(task => spaceListIds.includes(task.listId));
  }, [workspace, spaceId]);

  // Filter tasks by status
  const filteredTasks = useMemo(() => {
    if (filterStatus === "all") return spaceTasks;
    return spaceTasks.filter(task => task.status === filterStatus);
  }, [spaceTasks, filterStatus]);

  // Group tasks by account status
  const tasksByAccountStatus = useMemo(() => {
    const groups = {
      'in-progress': [] as Task[],
      'quoted': [] as Task[],
      'accepted': [] as Task[],
      'invoiced': [] as Task[],
      'collected': [] as Task[]
    };

    filteredTasks.forEach(task => {
      // Determine account status based on task data and related quotes/invoices
      const hasQuote = workspace.quotes?.some(q => q.taskId === task.id);
      const quote = workspace.quotes?.find(q => q.taskId === task.id);
      const hasInvoice = workspace.invoices?.some(i => i.taskId === task.id);
      const invoice = workspace.invoices?.find(i => i.taskId === task.id);

      if (invoice && invoice.status === 'paid') {
        groups.collected.push(task);
      } else if (hasInvoice) {
        groups.invoiced.push(task);
      } else if (quote && (quote.status === 'accepted' || quote.status === 'approved')) {
        groups.accepted.push(task);
      } else if (hasQuote) {
        groups.quoted.push(task);
      } else {
        groups['in-progress'].push(task);
      }
    });

    return groups;
  }, [filteredTasks, workspace.quotes, workspace.invoices]);

  const createQuote = (task: Task) => {
    const quote: Quote = {
      id: `quote_${Date.now()}`,
      quoteNumber: `Q${(workspace.quotes?.length || 0) + 1}`.padStart(4, '0'),
      taskId: task.id,
      customerName: task.title,
      customerEmail: task.customFieldValues?.find(cv => cv.fieldId === 'cf2')?.value?.toString() || '',
      customerPhone: task.customFieldValues?.find(cv => cv.fieldId === 'cf1')?.value?.toString() || '',
      lineItems: [],
      subtotal: 0,
      taxRate: 0.15,
      taxAmount: 0,
      total: 0,
      status: 'draft',
      createdBy: 'System',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    onUpdateWorkspace({
      quotes: [...(workspace.quotes || []), quote]
    });

    // Auto-update task status to reflect it's been quoted
    updateTaskAccountStatus(task.id, 'quoted');
  };

  const acceptQuote = (taskId: string) => {
    const quote = workspace.quotes?.find(q => q.taskId === taskId);
    if (quote) {
      onUpdateWorkspace({
        quotes: workspace.quotes?.map(q => 
          q.id === quote.id ? { ...q, status: 'accepted', approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : q
        )
      });
      updateTaskAccountStatus(taskId, 'accepted');
    }
  };

  const createInvoice = (taskId: string) => {
    const quote = workspace.quotes?.find(q => q.taskId === taskId);
    const invoice: Invoice = {
      id: `invoice_${Date.now()}`,
      invoiceNumber: `INV${(workspace.invoices?.length || 0) + 1}`.padStart(4, '0'),
      taskId,
      quoteId: quote?.id,
      customerName: quote?.customerName || 'Unknown Customer',
      customerEmail: quote?.customerEmail,
      customerPhone: quote?.customerPhone,
      lineItems: quote?.lineItems || [],
      subtotal: quote?.subtotal || 0,
      taxRate: quote?.taxRate || 0.15,
      taxAmount: quote?.taxAmount || 0,
      total: quote?.total || 0,
      amountPaid: 0,
      balanceDue: quote?.total || 0,
      status: 'sent',
      paymentStatus: 'unpaid',
      createdBy: 'System',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    onUpdateWorkspace({
      invoices: [...(workspace.invoices || []), invoice]
    });
    updateTaskAccountStatus(taskId, 'invoiced');
  };

  const markPaid = (taskId: string) => {
    const invoice = workspace.invoices?.find(i => i.taskId === taskId);
    if (invoice) {
      onUpdateWorkspace({
        invoices: workspace.invoices?.map(i =>
          i.id === invoice.id ? { 
            ...i, 
            status: 'paid', 
            paymentStatus: 'paid',
            amountPaid: i.total,
            balanceDue: 0,
            paidAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          } : i
        )
      });
      updateTaskAccountStatus(taskId, 'collected');
    }
  };

  const updateTaskAccountStatus = (taskId: string, accountStatus: string) => {
    // Update task with a custom field or description to track account status
    const updatedTasks = workspace.tasks.map(task => {
      if (task.id === taskId) {
        const customFieldValues = task.customFieldValues || [];
        const accountStatusField = customFieldValues.find(v => v.fieldId === 'account-status');
        
        let newCustomFieldValues;
        if (accountStatusField) {
          newCustomFieldValues = customFieldValues.map(v => 
            v.fieldId === 'account-status' ? { ...v, value: accountStatus } : v
          );
        } else {
          newCustomFieldValues = [...customFieldValues, { fieldId: 'account-status', value: accountStatus }];
        }
        
        return { ...task, customFieldValues: newCustomFieldValues };
      }
      return task;
    });

    onUpdateWorkspace({ tasks: updatedTasks });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'in-progress': return <Clock className="h-4 w-4" />;
      case 'quoted': return <FileText className="h-4 w-4" />;
      case 'accepted': return <CheckCircle className="h-4 w-4" />;
      case 'invoiced': return <Receipt className="h-4 w-4" />;
      case 'collected': return <CreditCard className="h-4 w-4" />;
      default: return <Package className="h-4 w-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'in-progress': return 'bg-blue-500';
      case 'quoted': return 'bg-yellow-500';
      case 'accepted': return 'bg-green-500';
      case 'invoiced': return 'bg-purple-500';
      case 'collected': return 'bg-emerald-500';
      default: return 'bg-gray-500';
    }
  };

  const getActionButton = (task: Task, accountStatus: string) => {
    switch (accountStatus) {
      case 'in-progress':
        return (
          <Button size="sm" onClick={() => createQuote(task)}>
            <FileText className="h-4 w-4 mr-1" />
            Create Quote
          </Button>
        );
      case 'quoted':
        return (
          <Button size="sm" onClick={() => acceptQuote(task.id)}>
            <CheckCircle className="h-4 w-4 mr-1" />
            Accept Quote
          </Button>
        );
      case 'accepted':
        return (
          <Button size="sm" onClick={() => createInvoice(task.id)}>
            <Receipt className="h-4 w-4 mr-1" />
            Create Invoice
          </Button>
        );
      case 'invoiced':
        return (
          <Button size="sm" onClick={() => markPaid(task.id)}>
            <CreditCard className="h-4 w-4 mr-1" />
            Mark Paid
          </Button>
        );
      case 'collected':
        return <Badge variant="secondary" className="bg-green-100 text-green-700">Completed</Badge>;
      default:
        return null;
    }
  };

  if (!space) {
    return <div className="p-4">Space not found</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-2xl">{space.icon}</span>
            {space.name} Overview
          </h1>
          <p className="text-muted-foreground">
            {spaceTasks.length} total tasks across all account statuses
          </p>
        </div>
        
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tasks</SelectItem>
            <SelectItem value="todo">To Do</SelectItem>
            <SelectItem value="in-progress">In Progress</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Account Status Pipeline */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {Object.entries(tasksByAccountStatus).map(([accountStatus, tasks]) => (
          <Card key={accountStatus} className="h-fit">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <div className={`w-3 h-3 rounded-full ${getStatusColor(accountStatus)}`} />
                {accountStatus.replace('-', ' ').toUpperCase()}
                <Badge variant="secondary">{tasks.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {tasks.map(task => (
                <div 
                  key={task.id}
                  className="p-3 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                  onClick={() => onTaskClick(task.id)}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="font-medium text-sm line-clamp-2">{task.title}</h4>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {task.status}
                    </Badge>
                  </div>
                  
                  {task.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                      {task.description}
                    </p>
                  )}
                  
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {new Date(task.createdAt).toLocaleDateString()}
                    </span>
                    {getActionButton(task, accountStatus)}
                  </div>
                  
                  {/* Progress indicator */}
                  {accountStatus !== 'collected' && (
                    <div className="mt-2 flex items-center gap-1">
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        Next: {accountStatus === 'in-progress' ? 'Quote' : 
                               accountStatus === 'quoted' ? 'Accept' :
                               accountStatus === 'accepted' ? 'Invoice' : 
                               accountStatus === 'invoiced' ? 'Payment' : ''}
                      </span>
                    </div>
                  )}
                </div>
              ))}
              
              {tasks.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <div className="mb-2">{getStatusIcon(accountStatus)}</div>
                  <p className="text-sm">No tasks in this stage</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}