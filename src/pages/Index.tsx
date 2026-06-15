import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { supabase, supabaseServiceRole, sbInsertComment } from "@/lib/supabase";
import { useActivityTracking } from "@/hooks";
import { logActivity } from "@/lib/activityTrackingService";
import { useToast } from "@/hooks/use-toast";
import { Plus, Archive, Trash2, CheckSquare, X, ChevronDown, MoveRight, CreditCard } from "lucide-react";
import { SidebarProvider } from "@/components/ui/sidebar";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CrmSidebar } from "@/components/crm/CrmSidebar";
import { CrmHeader } from "@/components/crm/CrmHeader";
import { TaskBoardView } from "@/components/crm/TaskBoardView";
import { TaskListView } from "@/components/crm/TaskListView";
import { TaskDetailPanel, warmInventoryCache } from "@/components/crm/TaskDetailPanel";
import { CreateSpaceDialog, CreateFolderDialog, CreateListDialog, CreateTaskDialog } from "@/components/crm/CreateDialogs";
import { CustomFieldsManager } from "@/components/crm/CustomFieldsManager";
import { FormListPanel } from "@/components/crm/FormListPanel";
import { FormBuilder } from "@/components/crm/FormBuilder";
import { WhatsAppSettingsDialog } from "@/components/crm/WhatsAppSettingsDialog";
import { WhatsAppLogsDialog } from "@/components/crm/WhatsAppLogsDialog";
import { PrinterSettingsDialog } from "@/components/crm/PrinterSettingsDialog";
import { UserManagement } from "@/components/crm/UserManagement";
import { WorkspaceManagement } from "@/components/crm/WorkspaceManagement";
import { EmailSettingsDialog } from "@/components/crm/EmailSettingsDialog";
import { SetupWizard } from "@/components/crm/SetupWizard";
import { NotificationsSettingsDialog } from "@/components/crm/NotificationsSettingsDialog";
import { EcommerceSettingsDialog } from "@/components/crm/EcommerceSettingsDialog";
import { StoreDesignStudio } from "@/components/crm/StoreDesignStudio";
import { EcommerceBotSettingsDialog } from "@/components/crm/EcommerceBotSettingsDialog";
import { IkhokhaJobSettingsDialog } from "@/components/crm/IkhokhaJobSettingsDialog";
import { JobSettingsDialog } from "@/components/crm/JobSettingsDialog";
import { SupervisorPasswordDialog } from "@/components/crm/SupervisorPasswordDialog";
import { SalesSettingsDialog } from "@/components/crm/SalesSettingsDialog";
import { loadSalesSettings } from "@/lib/salesSettingsService";
import { TaskLimitSettingsDialog, loadTaskLimitSettings, TaskLimitSettings } from "@/components/crm/TaskLimitSettingsDialog";
import { FieldMapperDialog } from "@/components/crm/FieldMapperDialog";
import { loadFieldMapping, FieldMapping, DEFAULT_FIELD_MAPPING } from "@/lib/fieldMapperService";
import { MorningBriefingDialog } from "@/components/crm/MorningBriefingDialog";
import { StatusManager } from "@/components/crm/StatusManager";
import { StatusSelectionDialog } from "@/components/crm/StatusSelectionDialog";
import { PermissionManager } from "@/components/crm/PermissionManager";
import { useWarningCheck, type WarningRule } from "@/components/crm/WarningRulesPanel";
import { StaleTaskBlockDialog, StaleTaskAcknowledgeDialog } from "@/components/crm/StaleTaskWarningDialog";
import { checkBlockNewInStaleList, findStaleTasks, type StaleTaskHit } from "@/lib/staleTaskService";
import { AIBotWarningDialog } from "@/components/crm/AIBotWarningDialog";
import { SRAgentPanel } from "@/components/ai/SRAgentPanel";
import { FloatingAIBubble } from "@/components/ai/FloatingAIBubble";
import { ActivityMonitor } from "@/components/crm/ActivityMonitor";
import { TaskRecoveryPanel } from "@/components/crm/TaskRecoveryPanel";
import { GlobalSearchModal } from "@/components/crm/GlobalSearchModal";
import { QuotationCreationPage } from "@/pages/QuotationCreationPage";
import { AccountsPage } from "@/pages/Accounts";
import { InventoryPage } from "@/pages/InventoryPage";
import { WalkInSalePage } from "@/pages/WalkInSalePage";
import { EmailPage } from "@/pages/EmailPage";
import { getUnreadCount } from "@/lib/emailAccountService";
import StockMovementsPage from "@/pages/StockMovementsPage";
import { QuotationManagementPage } from "@/pages/QuotationManagementPage";
import { InvoiceManagementPage } from "@/pages/InvoiceManagementPage";
import { InvoiceCreationPage } from "@/pages/InvoiceCreationPage";
import { CustomerPage } from "@/pages/CustomerPage";
import { StatementPage } from "@/pages/StatementPage";
import { BusinessOverviewPage } from "@/pages/BusinessOverviewPage";
import { BusinessPlanningPage } from "@/pages/BusinessPlanningPage";
import { TechAssessmentPage } from "@/pages/TechAssessmentPage";
import { OutstandingRepairsPage } from "@/pages/OutstandingRepairsPage";
import { DataSheetsPage } from "@/pages/DataSheetsPage";
import { TaskCreationListPage } from "@/pages/TaskCreationListPage";
import { ActivityReportPage } from "@/pages/ActivityReportPage";
import { AuditLogPage } from "@/pages/AuditLogPage";
import { StaffDashboardPage } from "@/pages/StaffDashboardPage";
import { FaultReportDialog } from "@/components/crm/FaultReportDialog";
import { ChangePasswordDialog } from "@/components/crm/ChangePasswordDialog";
import { SalesOverviewPage } from "@/pages/SalesOverviewPage";
import { InventoryOverviewPage } from "@/pages/InventoryOverviewPage";
import { EcommerceOrdersPage } from "@/pages/EcommerceOrdersPage";
import { EcommerceAnalyticsPage } from "@/pages/EcommerceAnalyticsPage";
import { InvoiceRegisterPage } from "@/pages/InvoiceRegisterPage";
// import { ExpenseSlipsPage } from "@/pages/ExpenseSlipsPage"; // disabled — file missing on this machine
import { InventoryRegisterPage } from "@/pages/InventoryRegisterPage";
import { BankingMatchingPage } from "@/pages/BankingMatchingPage";
import { SpaceOverview } from "@/components/crm/SpaceOverview";
import { FolderOverview } from "@/components/crm/FolderOverview";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { loadWorkspaceState, saveWorkspaceState, subscribeWorkspaceState, subscribeTaskChanges, loadTasksForWorkspace, upsertTask, subscribeFormSubmissions, getPendingFormSubmissions, deleteFormSubmission, publishForm, unpublishForm, claimJobNumberAndAddTask, deleteTaskFromWorkspace, FormSubmission } from "@/lib/workspaceService";
import { loadWhatsAppSettings, sendTaskWhatsApp, sendInvoiceWhatsApp } from "@/lib/whatsappService";
import { createJobDepositPaylink } from "@/lib/ikhokhaJobService";
import { logNewTask, reconcileRecentJobLog } from "@/lib/jobLogService";
import { loadPrinterSettings, printBookingSlip } from "@/lib/printerService";
import { logTaskCreated, logTaskUpdated, logTaskDeleted, logTasksBulkDeleted } from "@/lib/auditService";
import { getQuotation } from "@/lib/quotationService";
import { Quotation } from "@/types/invoice";
import { createInvoice } from "@/lib/invoiceService";
import { getCachedWorkspace, setCachedWorkspace, getMemCachedWorkspace, setMemCachedWorkspace } from "@/lib/cacheService";
import { maybeTakeDailySnapshot } from "@/lib/snapshotService";
import { useAppNav, NavState } from "@/hooks/useAppNav";
import { WorkspaceState, Task, TaskComment, ViewMode, TaskStatus, TaskPriority, CustomFieldDefinition, FormDefinition, DEFAULT_STATUSES, PRIORITIES, JOBS_WITH_ISSUES_SPACE_ID, List } from "@/types/crm";
import { AutomationsDialog } from "@/components/crm/AutomationsDialog";

const DONE_STATUSES = new Set(["done","complete","invoiced","paid","completed"]);

// Empty workspace state (no sample data to prevent flash of wrong content)
const EMPTY_WORKSPACE: WorkspaceState = {
  customFields: [],
  spaces: [],
  folders: [],
  lists: [],
  tasks: [],
  forms: [],
};

function workspaceFingerprint(state: WorkspaceState): string {
  const tasks = (state.tasks || []).map(task => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    listId: task.listId,
    jobNumber: task.jobNumber,
    archived: task.archived,
    dueDate: task.dueDate,
    startDate: task.startDate,
    assignee: task.assignee,
    assignees: task.assignees,
    technician: task.technician,
    isPaid: task.isPaid,
    customFieldValues: task.customFieldValues,
    comments: task.comments?.length,
    photos: task.photos?.length,
  }));
  const lists = (state.lists || []).map(list => ({
    id: list.id,
    taskOrder: list.taskOrder,
    visibleFieldIds: list.visibleFieldIds,
    customStatuses: list.customStatuses,
    automationCount: list.automations?.length ?? 0,
    automationIds: list.automations?.map((a: any) => a.id + (a.enabled ? '1' : '0')).join(',') ?? '',
  }));
  return JSON.stringify({
    jobCounter: state.jobCounter,
    tasks,
    lists,
    customFields: state.customFields,
    forms: state.forms?.map(form => ({
      id: form.id,
      name: form.name,
      targetListId: form.targetListId,
      fields: form.fields,
      titleTemplate: form.titleTemplate,
      stickerEnabled: form.stickerEnabled,
      stickerCount: form.stickerCount,
    })),
  });
}

// Special space for tasks without photos
import { Loader2 } from "lucide-react";
import { ScanResultPopup, ScanResult } from "@/components/crm/ScanResultPopup";
import { findInventoryItemByBarcode } from "@/lib/inventoryEcommerceSync";

export default function Index() {
  const { user, workspaceId, loading, myRole, members } = useAuth();
  const [isImpersonated, setIsImpersonated] = useState(() => sessionStorage.getItem('impersonated') === '1');
  const [companyName, setCompanyName] = useState("");

  useEffect(() => {
    if (!workspaceId) return;
    // Single query for all workspace_settings categories instead of 4 separate round-trips
    supabaseServiceRole
      .from("workspace_settings")
      .select("category, data")
      .eq("workspace_id", workspaceId)
      .in("category", ["sales", "field_mapping", "task_limits", "setup_wizard"])
      .then(({ data: rows }) => {
        const byCategory = Object.fromEntries((rows || []).map(r => [r.category, r.data]));
        // sales
        if (byCategory.sales?.companyName) setCompanyName(byCategory.sales.companyName);
        // field_mapping
        if (byCategory.field_mapping) setFieldMapping({ ...DEFAULT_FIELD_MAPPING, ...byCategory.field_mapping });
        // task_limits
        const tl = byCategory.task_limits;
        setTaskLimitSettings(tl && tl.limit > 0 ? tl : null);
        // setup_wizard
        if (!byCategory.setup_wizard?.completed) setShowSetupWizard(true);
      });
  }, [workspaceId]);

  // Refresh email unread count every 2 minutes
  useEffect(() => {
    if (!workspaceId || !user) return;
    const refresh = () => getUnreadCount(workspaceId, user.uid).then(setEmailUnreadCount).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 2 * 60 * 1000);
    return () => clearInterval(timer);
  }, [workspaceId, user]);
  const isMobile = useIsMobile();
  
  const { toast } = useToast();

  const [workspace, setWorkspace] = useState<WorkspaceState>(EMPTY_WORKSPACE);
  const workspaceRef = useRef<WorkspaceState>(EMPTY_WORKSPACE);
  // Debounce saves so rapid actions (status change, drag, typing) batch into one Firestore write
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks writes we initiated so we can ignore the echoed Firestore snapshot
  const selfWriteRef = useRef(false);
  // Track recently-saved task IDs so the subscription echo for OUR save
  // doesn't overwrite a subsequent local edit, while still accepting updates
  // from OTHER users for the same task.
  const recentlySavedTaskIds = useRef<Set<string>>(new Set());
  // Pending task save — queued on every field edit, flushed when the panel closes.
  // This avoids firing the RPC on every keystroke (which times out on large workspaces).
  const taskDbSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTaskSaveRef = useRef<{ wid: string; task: Task } | null>(null);
  // True between the start of debounce and the successful save. Used by the
  // realtime subscriber to detect concurrent edits (someone else saved while
  // we still had a local change waiting to be persisted).
  const pendingSaveRef = useRef(false);
  // Track ongoing save to suppress duplicate "didn't save" toasts.
  const lastSaveErrorAtRef = useRef(0);
  // Fingerprint of the last state we set — skip snapshot if nothing changed
  const stateVersionRef = useRef("");
  // Track if we've already loaded workspace for this workspaceId to prevent double-loads
  const loadedWorkspaceIdRef = useRef<string | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAutomations, setShowAutomations] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string | null>("l1");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIncludeArchived, setSearchIncludeArchived] = useState(false);
  const [showFormsPanel, setShowFormsPanel] = useState(false);
  const [showFormBuilder, setShowFormBuilder] = useState(false);
  const [editingForm, setEditingForm] = useState<FormDefinition | null>(null);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [showPrinter, setShowPrinter] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [showWorkspaceManagement, setShowWorkspaceManagement] = useState(false);
  const [showEmailSettings, setShowEmailSettings] = useState(false);
  const [showEcommerceSettings, setShowEcommerceSettings] = useState(false);
  const [ecommerceSettingsTab, setEcommerceSettingsTab] = useState<string | undefined>(undefined);
  const [showStoreDesign, setShowStoreDesign] = useState(false);
  const [showEcommerceBotSettings, setShowEcommerceBotSettings] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [showIkhokhaJobSettings, setShowIkhokhaJobSettings] = useState(false);
  const [showJobSettings, setShowJobSettings] = useState(false);
  const [showSupervisorPassword, setShowSupervisorPassword] = useState(false);
  const [pendingPaylink, setPendingPaylink] = useState<{ paylinkUrl: string; jobNumber: string; amountRands: number } | null>(null);
  const [showStatusManager, setShowStatusManager] = useState<string | null>(null);
  const [showPermissionManager, setShowPermissionManager] = useState<{ id: string; type: "space" | "folder" | "list" } | null>(null);
  const [showStatusSelection, setShowStatusSelection] = useState(false);
  const [statusSelectionData, setStatusSelectionData] = useState<{
    task: Task | null;
    targetListId: string;
    targetListName: string;
    availableStatuses: any[];
  } | null>(null);

  // Warning check state for task moves
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [warningDialogData, setWarningDialogData] = useState<{
    task: Task;
    targetListId: string;
    targetFolderId: string;
    selectedStatus: string;
    missingFields: string[];
  } | null>(null);
  const { checkWarning } = useWarningCheck(workspaceId);

  // Cache of all warning rules (re-fetched on workspace change). Used to
  // evaluate the block-new-task and stale-task rules on demand without doing
  // a round-trip on every action.
  const [allWarningRules, setAllWarningRules] = useState<WarningRule[]>([]);
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("warning_rules")
        .select("*")
        .eq("workspace_id", workspaceId);
      if (!cancelled) setAllWarningRules((data || []) as unknown as WarningRule[]);
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  // Block-new-task dialog
  const [staleBlockData, setStaleBlockData] = useState<{
    rule: WarningRule;
    offenderTitle: string;
    offenderDays: number;
    listName?: string;
  } | null>(null);

  // Stale-task acknowledgement dialog
  const [staleAckHits, setStaleAckHits] = useState<StaleTaskHit[]>([]);
  const staleSweepDoneRef = useRef(false);
  useEffect(() => {
    if (staleSweepDoneRef.current) return;
    if (!workspaceId) return;
    if (allWarningRules.length === 0) return;
    if (workspace.tasks.length === 0) return;
    staleSweepDoneRef.current = true;

    (async () => {
      try {
        const hits = await findStaleTasks(
          workspaceId,
          workspace.tasks,
          workspace.lists,
          allWarningRules,
          { trigger: "on_load" },
        );
        if (hits.length > 0) setStaleAckHits(hits);
      } catch (err) {
        console.error("[stale sweep] failed:", err);
      }
    })();
  }, [workspaceId, allWarningRules, workspace.tasks, workspace.lists]);

  const [showAccountsPage, setShowAccountsPage] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [emailUnreadCount, setEmailUnreadCount] = useState(0);
  const [showStockMovements, setShowStockMovements] = useState(false);
  const [showQuotations, setShowQuotations] = useState(false);
  const [showInvoicing, setShowInvoicing] = useState(false);
  const [initialInvoiceId, setInitialInvoiceId] = useState<string | undefined>();
  const [initialQuotationId, setInitialQuotationId] = useState<string | undefined>();
  const [showCustomers, setShowCustomers] = useState(false);
  const [showStatements, setShowStatements] = useState(false);
  const [showBusinessOverview, setShowBusinessOverview] = useState(false);
  const [showTechAssessment, setShowTechAssessment] = useState(false);
  const [showOutstandingRepairs, setShowOutstandingRepairs] = useState(false);
  const [showActivityReports, setShowActivityReports] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showStaffDashboard, setShowStaffDashboard] = useState(false);
  const [showMorningBriefing, setShowMorningBriefing] = useState(false);
  const [showDataSheets, setShowDataSheets] = useState(false);
  const [showTaskCreationList, setShowTaskCreationList] = useState(false);
  const [showSalesOverview, setShowSalesOverview] = useState(false);
  const [showInventoryOverview, setShowInventoryOverview] = useState(false);
  const [showInvoiceRegister, setShowInvoiceRegister] = useState(false);
  const [showInventoryRegister, setShowInventoryRegister] = useState(false);
  const [showBanking, setShowBanking] = useState(false);
  const [showBusinessPlanning, setShowBusinessPlanning] = useState(false);
  const [showEcommerceOperations, setShowEcommerceOperations] = useState(false);
  const [showEcommerceAnalytics, setShowEcommerceAnalytics] = useState(false);
  const [showExpenseSlips, setShowExpenseSlips] = useState(false);
  const [expenseSlipInitialAction, setExpenseSlipInitialAction] = useState<"camera" | "upload" | undefined>();
  const [showWalkInSale, setShowWalkInSale] = useState(false);
  const [showSpaceOverview, setShowSpaceOverview] = useState<string | null>(null);
  const [showFolderOverview, setShowFolderOverview] = useState<string | null>(null);
  const [showSalesSettings, setShowSalesSettings] = useState(false);
  const [showTaskLimitSettings, setShowTaskLimitSettings] = useState(false);
  const [taskLimitSettings, setTaskLimitSettings] = useState<TaskLimitSettings | null>(null);
  const [taskLockoutOverridden, setTaskLockoutOverridden] = useState(false);
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [overrideInput, setOverrideInput] = useState("");
  const [showFieldMapper, setShowFieldMapper] = useState(false);
  const [fieldMapping, setFieldMapping] = useState<FieldMapping>(DEFAULT_FIELD_MAPPING);
  const [showActivityMonitor, setShowActivityMonitor] = useState(false);
  const [showWhatsAppLogs, setShowWhatsAppLogs] = useState(false);
  const [showTaskRecovery, setShowTaskRecovery] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [scanInitialQuery, setScanInitialQuery] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  const [quoteTask, setQuoteTask] = useState<Task | null>(null);
  const [editingQuotationForTask, setEditingQuotationForTask] = useState<Quotation | null>(null);
  const [showInvoiceFromTask, setShowInvoiceFromTask] = useState(false);
  const [invoiceTask, setInvoiceTask] = useState<Task | null>(null);
  const [showFaultReport, setShowFaultReport] = useState(false);
  const [faultReportTask, setFaultReportTask] = useState<Task | null>(null);
  const [panelWidth, setPanelWidth] = useState(() => Math.floor(window.innerWidth * 0.72));

  // Multi-select / bulk actions
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  // Clear selection when switching lists
  useEffect(() => { setSelectedTaskIds(new Set()); }, [selectedListId]);

  // Keep selectedTask in sync with latest workspace data (real-time subscription updates workspace.tasks
  // but selectedTask is a separate ref — without this, custom field values appear "stuck" after updates)
  useEffect(() => {
    if (!selectedTask) return;
    const latest = workspace.tasks.find(t => t.id === selectedTask.id);
    if (latest && latest !== selectedTask) setSelectedTask(latest);
  }, [workspace.tasks]);

  // Close every full-screen overlay page — call this before navigating anywhere else
  // ── In-app navigation helpers ─────────────────────────────────────────────

  const captureNav = useCallback((): NavState => {
    const overlay =
      showTaskCreationList ? "taskCreationList"
      : showInvoiceRegister ? "invoiceRegister"
      : showInventoryRegister ? "inventoryRegister"
      : showInvoicing ? "invoicing"
      : showQuotations ? "quotations"
      : showCustomers ? "customers"
      : showStatements ? "statements"
      : showBusinessOverview ? "businessOverview"
      : showSalesOverview ? "salesOverview"
      : showInventoryOverview ? "inventoryOverview"
      : showTechAssessment ? "techAssessment"
      : showOutstandingRepairs ? "outstandingRepairs"
      : showActivityReports ? "activityReports"
      : showStaffDashboard ? "staffDashboard"
      : showInventory ? "inventory"
      : showStockMovements ? "stockMovements"
      : showBanking ? "banking"
      : showBusinessPlanning ? "businessPlanning"
      : showEcommerceOperations ? "ecommerceOperations"
      : showExpenseSlips ? "expenseSlips"
      : showAccountsPage ? "accountsPage"
      : showSpaceOverview ? "spaceOverview"
      : showFolderOverview ? "folderOverview"
      : showFormsPanel ? "forms"
      : null;
    return {
      listId: selectedListId,
      taskId: selectedTask?.id ?? null,
      overlay,
      extra: showSpaceOverview ?? showFolderOverview ?? undefined,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTaskCreationList, showInvoiceRegister, showInventoryRegister, showInvoicing, showQuotations,
      showCustomers, showStatements, showBusinessOverview, showSalesOverview, showInventoryOverview,
      showTechAssessment, showOutstandingRepairs, showInventory, showStockMovements, showBanking, showBusinessPlanning, showEcommerceOperations, showExpenseSlips, showAccountsPage,
      showSpaceOverview, showFolderOverview, showFormsPanel, showStaffDashboard, selectedListId, selectedTask?.id]);

  const restoreNav = useCallback((snap: NavState) => {
    // Close everything, then restore
    setShowInventory(false); setShowStockMovements(false); setShowQuotations(false);
    setShowInvoicing(false); setShowCustomers(false); setShowStatements(false);
    setShowBusinessOverview(false);     setShowTechAssessment(false);
    setShowOutstandingRepairs(false);
    setShowActivityReports(false);
    setShowStaffDashboard(false);
    setShowTaskCreationList(false); setShowSalesOverview(false); setShowInventoryOverview(false);
    setShowInvoiceRegister(false); setShowInventoryRegister(false); setShowInvoiceFromTask(false); setShowBanking(false);
    setShowBusinessPlanning(false);
    setShowEcommerceOperations(false);
    setShowExpenseSlips(false);
    setShowAccountsPage(false); setShowSpaceOverview(null); setShowFolderOverview(null); setShowFormsPanel(false);
    setSelectedTask(null);
    if (snap.listId) setSelectedListId(snap.listId);
    if (snap.overlay === "taskCreationList")   setShowTaskCreationList(true);
    else if (snap.overlay === "invoiceRegister")   setShowInvoiceRegister(true);
    else if (snap.overlay === "inventoryRegister") setShowInventoryRegister(true);
    else if (snap.overlay === "invoicing")         setShowInvoicing(true);
    else if (snap.overlay === "quotations")        setShowQuotations(true);
    else if (snap.overlay === "customers")         setShowCustomers(true);
    else if (snap.overlay === "statements")        setShowStatements(true);
    else if (snap.overlay === "businessOverview")  setShowBusinessOverview(true);
    else if (snap.overlay === "salesOverview")     setShowSalesOverview(true);
    else if (snap.overlay === "inventoryOverview") setShowInventoryOverview(true);
    else if (snap.overlay === "techAssessment")    setShowTechAssessment(true);
    else if (snap.overlay === "outstandingRepairs") setShowOutstandingRepairs(true);
    else if (snap.overlay === "activityReports")   setShowActivityReports(true);
    else if (snap.overlay === "staffDashboard")    setShowStaffDashboard(true);
    else if (snap.overlay === "inventory")         setShowInventory(true);
    else if (snap.overlay === "stockMovements")    setShowStockMovements(true);
    else if (snap.overlay === "banking")           setShowBanking(true);
    else if (snap.overlay === "businessPlanning")  setShowBusinessPlanning(true);
    else if (snap.overlay === "ecommerceOperations") setShowEcommerceOperations(true);
    else if (snap.overlay === "expenseSlips")      setShowExpenseSlips(true);
    else if (snap.overlay === "accountsPage")      setShowAccountsPage(true);
    else if (snap.overlay === "spaceOverview" && snap.extra) setShowSpaceOverview(snap.extra);
    else if (snap.overlay === "folderOverview" && snap.extra) setShowFolderOverview(snap.extra);
    else if (snap.overlay === "forms")             setShowFormsPanel(true);
    else setShowStaffDashboard(true); // no overlay = board view; dashboard is the default home
    if (snap.taskId) {
      const t = workspaceRef.current.tasks.find(tk => tk.id === snap.taskId);
      if (t) setTimeout(() => setSelectedTask(t), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { push: navPush, replace: navReplace, back: navBack, forward: navForward,
          canGoBack, canGoForward, restoreOnMount } = useAppNav(restoreNav);

  // Auto-push to nav history whenever the view changes
  const navInitRef = useRef(false);
  const prevNavKeyRef = useRef("");
  useEffect(() => {
    if (!navInitRef.current) { navInitRef.current = true; return; }
    const snap = captureNav();
    const key = JSON.stringify(snap);
    if (key === prevNavKeyRef.current) return;
    prevNavKeyRef.current = key;
    navPush(snap);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTaskCreationList, showInvoiceRegister, showInventoryRegister, showInvoicing, showQuotations,
      showCustomers, showStatements, showBusinessOverview, showSalesOverview, showInventoryOverview,
      showTechAssessment, showOutstandingRepairs, showInventory, showStockMovements, showBanking, showBusinessPlanning, showEcommerceOperations, showExpenseSlips, showAccountsPage,
      showSpaceOverview, showFolderOverview, showFormsPanel, showStaffDashboard, selectedListId, selectedTask?.id]);

  // Refresh workspace data without reloading the page
  const handleRefresh = useCallback(async () => {
    if (!workspaceId || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const [freshBlob, freshTasks] = await Promise.all([
        loadWorkspaceState(workspaceId),
        loadTasksForWorkspace(workspaceId),
      ]);
      setWorkspace(prev => {
        const merged = {
          ...freshBlob,
          tasks: freshTasks.length > 0 ? freshTasks : prev.tasks,
        };
        workspaceRef.current = merged;
        return merged;
      });
    } catch (e) {
      console.error("Refresh failed", e);
    } finally {
      setIsRefreshing(false);
    }
  }, [workspaceId, isRefreshing]);

  const closeAllOverlays = () => {
    setShowInventory(false);
    setShowStockMovements(false);
    setShowQuotations(false);
    setShowInvoicing(false);
    setShowCustomers(false);
    setShowStatements(false);
    setShowBusinessOverview(false);
    setShowTechAssessment(false);
    setShowOutstandingRepairs(false);
    setShowTaskCreationList(false);
    setShowSalesOverview(false);
    setShowInventoryOverview(false);
    setShowInvoiceRegister(false);
    setShowInventoryRegister(false);
    setShowBanking(false);
    setShowBusinessPlanning(false);
    setShowEcommerceOperations(false);
    setShowExpenseSlips(false);
    setShowInvoiceFromTask(false);
    setShowEmail(false);
    setShowActivityReports(false);
    setShowAuditLog(false);
    setShowStaffDashboard(false);
    setShowDataSheets(false);
    setShowWalkInSale(false);
    // Always close the task detail panel when leaving CRM context
    setSelectedTask(null);
  };

  // Bot navigation — FloatingAIBubble dispatches "shopflowz-navigate" to open sections
  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent<{ target: string }>).detail?.target;
      if (!target) return;
      // Close all overlays first, then open the requested one
      setShowInventory(false); setShowStockMovements(false); setShowQuotations(false);
      setShowInvoicing(false); setShowCustomers(false); setShowStatements(false);
      setShowBusinessOverview(false); setShowTechAssessment(false); setShowOutstandingRepairs(false);
      setShowTaskCreationList(false); setShowSalesOverview(false); setShowInventoryOverview(false);
      setShowInvoiceRegister(false); setShowInventoryRegister(false); setShowBanking(false);
      setShowBusinessPlanning(false); setShowEcommerceOperations(false); setShowExpenseSlips(false);
      setShowInvoiceFromTask(false); setShowEmail(false); setShowActivityReports(false); setShowDataSheets(false);
      if (target === "inventory")          setShowInventory(true);
      else if (target === "invoicing")     setShowInvoicing(true);
      else if (target === "banking")       setShowBanking(true);
      else if (target === "email")         setShowEmail(true);
      else if (target === "customers")     setShowCustomers(true);
      else if (target === "ecommerce")     setShowEcommerceOperations(true);
      else if (target === "ecommerce-settings") setShowEcommerceSettings(true);
      else if (target === "whatsapp")      setShowWhatsApp(true);
      else if (target === "users")         setShowUserManagement(true);
      else if (target === "forms")         { setShowFormsPanel(true); setSelectedListId(null); }
      else if (target === "tasks")         { setSelectedListId(null); }
    };
    window.addEventListener("shopflowz-navigate", handler);
    return () => window.removeEventListener("shopflowz-navigate", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // True whenever a full-screen overlay page is active — used to hide the CRM task panel
  const anyOverlayActive = showInventory || showStockMovements || showQuotations || showInvoicing ||
    showCustomers || showStatements || showBusinessOverview || showTechAssessment ||
    showOutstandingRepairs || showTaskCreationList || showSalesOverview || showInventoryOverview ||
    showActivityReports || showAuditLog || showEmail || showDataSheets ||
    showInvoiceRegister || showInventoryRegister || showBanking || showBusinessPlanning || showEcommerceOperations || showExpenseSlips;

  // Track whether a task card is being HTML5-dragged (to show drop zones)
  const [isDraggingTask, setIsDraggingTask] = useState(false);
  useEffect(() => {
    const onStart = () => setIsDraggingTask(true);
    const onEnd = () => setIsDraggingTask(false);
    document.addEventListener('dragstart', onStart);
    document.addEventListener('dragend', onEnd);
    document.addEventListener('drop', onEnd);
    return () => {
      document.removeEventListener('dragstart', onStart);
      document.removeEventListener('dragend', onEnd);
      document.removeEventListener('drop', onEnd);
    };
  }, []);

  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Sidebar (left) resize
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('crm_sidebar_width');
    return saved ? parseInt(saved, 10) : 256;
  });
  const isSidebarResizing = useRef(false);
  const sidebarStartX = useRef(0);
  const sidebarStartWidth = useRef(0);

  // Auto-fit sidebar to content width when no manual override is set.
  // Uses text-length approximation: ~7.5px per char + 72px for icon/badge/chevron/padding.
  // Double-clicking the resize handle resets to auto-fit mode.
  const STATIC_SIDEBAR_ITEMS = [
    "Performance Analytics", "Outstanding Tasks", "Banking & Matching",
    "Sales & Invoicing", "Change My Password", "AI Bot Warnings",
    "Take Photo of Slip", "AI Assistant", "Staff Reports",
  ];

  useEffect(() => {
    if (localStorage.getItem('crm_sidebar_width_manual')) return;
    const names: string[] = [...STATIC_SIDEBAR_ITEMS];
    if (workspace) {
      for (const s of workspace.spaces ?? []) names.push(s.name ?? "");
      for (const f of workspace.folders ?? []) names.push(f.name ?? "");
      for (const l of workspace.lists ?? []) names.push(l.name ?? "");
    }
    const longest = Math.max(0, ...names.filter(Boolean).map((n) => n.length));
    const auto = Math.round(Math.min(400, Math.max(220, longest * 7.5 + 72)));
    setSidebarWidth(auto);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  const onSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    isSidebarResizing.current = true;
    sidebarStartX.current = e.clientX;
    sidebarStartWidth.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!isSidebarResizing.current) return;
      const delta = ev.clientX - sidebarStartX.current;
      const newW = Math.min(480, Math.max(180, sidebarStartWidth.current + delta));
      setSidebarWidth(newW);
      localStorage.setItem('crm_sidebar_width', String(newW));
      localStorage.setItem('crm_sidebar_width_manual', '1');
    };
    const onUp = () => {
      isSidebarResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX.current - ev.clientX;
      const newWidth = Math.min(Math.floor(window.innerWidth * 0.9), Math.max(320, startWidth.current + delta));
      setPanelWidth(newWidth);
    };
    const onUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panelWidth]);

  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [createFolderSpaceId, setCreateFolderSpaceId] = useState<string | null>(null);
  const [createListParent, setCreateListParent] = useState<{ id: string; type: "folder" | "space" } | null>(null);
  const [createTaskStatus, setCreateTaskStatus] = useState<TaskStatus | undefined>();
  const [showCreateTask, setShowCreateTask] = useState(false);
  const creatingTaskRef = useRef(false);

  // Load and subscribe to workspace data from Firebase
  useEffect(() => {
    console.log('[Workspace Load] Effect triggered. workspaceId:', workspaceId, 'loadedWorkspaceId:', loadedWorkspaceIdRef.current);
    
    if (!workspaceId) {
      setIsLoadingWorkspace(false);
      return;
    }

    // Guard: prevent re-loading if we've already loaded this workspace AND have data
    if (loadedWorkspaceIdRef.current === workspaceId && workspace.tasks.length > 0) {
      console.log('[Workspace Load] Already loaded this workspace with', workspace.tasks.length, 'tasks, skipping...');
      return;
    }

    console.log('[Workspace Load] Will load workspace...');
    let unsubscribe: (() => void) | undefined;

    const loadAndSubscribe = async () => {
      console.log('[Workspace Load] Starting loadAndSubscribe...');
      try {
        // ⚡ 1. Serve in-memory cache first (instant — no I/O)
        const memHit = getMemCachedWorkspace(workspaceId);
        if (memHit) {
          console.log('[Workspace Load] Memory cache hit:', memHit.tasks.length, 'tasks');
          setWorkspace(memHit);
          stateVersionRef.current = workspaceFingerprint(memHit);
          setIsLoadingWorkspace(false);
        } else {
          // ⚡ 2. Fall back to IndexedDB cache (fast async read)
          const cached = await getCachedWorkspace(workspaceId);
          if (cached) {
            console.log('[Workspace Load] IndexedDB cache hit:', cached.tasks.length, 'tasks');
            setWorkspace(cached);
            stateVersionRef.current = workspaceFingerprint(cached);
            setMemCachedWorkspace(workspaceId, cached);
            setIsLoadingWorkspace(false);
          } else {
            console.log('[Workspace Load] No cache found, will load from Firebase');
          }
        }

        // Phase 1: load workspace structure (blob) first — fast, small payload.
        // Show the UI immediately with cached tasks, then fetch fresh tasks in the background.
        console.log('[Workspace Load] Loading from Supabase with workspaceId:', workspaceId);
        const blobState = await loadWorkspaceState(workspaceId);

        // Show structure immediately so the sidebar/lists render without waiting for tasks
        const structureOnly: typeof blobState = {
          ...blobState,
          tasks: blobState.tasks?.length ? blobState.tasks : (workspace.tasks ?? []),
        };
        setWorkspace(prev => {
          const merged = { ...structureOnly, tasks: structureOnly.tasks.length > 0 ? structureOnly.tasks : prev.tasks };
          workspaceRef.current = merged;
          return merged;
        });
        setIsLoadingWorkspace(false);

        // Phase 2: load tasks in background — update when ready
        const taskRows = await loadTasksForWorkspace(workspaceId);
        const initialState: typeof blobState = {
          ...blobState,
          tasks: taskRows.length > 0 ? taskRows : (blobState.tasks ?? []),
        };
        console.log('[Workspace Load] Loaded from Supabase:', {
          tasks: initialState.tasks.length,
          lists: initialState.lists.length,
          spaces: initialState.spaces.length,
          folders: initialState.folders.length
        });

        // --- Duplicate detection: report only, never delete live jobs automatically ---
        const seenKeys = new Set<string>();
        const duplicateTasks: Task[] = [];
        initialState.tasks.forEach(task => {
          // Key: prefer jobNumber (unique per real task), else title+listId+createdAt
          const key = task.jobNumber
            ? `job:${task.jobNumber}`
            : `title:${task.title}|list:${task.listId}|date:${task.createdAt}`;
          if (seenKeys.has(key)) {
            console.warn(`[DuplicateTaskCheck] Duplicate task found; leaving it untouched:`, {
              id: task.id,
              jobNumber: task.jobNumber,
              title: task.title,
              listId: task.listId,
              createdAt: task.createdAt,
              key: key
            });
            duplicateTasks.push(task);
            return;
          }
          seenKeys.add(key);
        });
        let cleanState = initialState;
        if (duplicateTasks.length > 0) {
          console.warn(`[DuplicateTaskCheck] Found ${duplicateTasks.length} duplicate task(s). No tasks were deleted.`);

          // Keep the counter safely above every existing task without removing
          // records. This prevents future submissions from reusing numbers.
          let maxJob = initialState.jobCounter ?? 0;
          initialState.tasks.forEach(t => {
            if (t.jobNumber) {
              const n = parseInt(t.jobNumber.replace(/\D/g, ""), 10);
              if (!isNaN(n) && n > maxJob) maxJob = n;
            }
          });
          if (maxJob > (initialState.jobCounter ?? 0)) {
            cleanState = { ...initialState, jobCounter: maxJob };
            saveWorkspaceState(workspaceId, cleanState).catch(console.error);
          }
        }
        // Backfill: any task missing startDate gets createdAt as its start date
        const tasksNeedingStartDate = cleanState.tasks.filter(t => !t.startDate && t.createdAt);
        if (tasksNeedingStartDate.length > 0) {
          const patchedTasks = cleanState.tasks.map(t =>
            !t.startDate && t.createdAt ? { ...t, startDate: t.createdAt.split("T")[0] } : t
          );
          cleanState = { ...cleanState, tasks: patchedTasks };
          saveWorkspaceState(workspaceId, cleanState).catch(console.error);
          console.log(`[StartDate Backfill] Patched ${tasksNeedingStartDate.length} task(s) with missing startDate`);
        }

        console.log('[Workspace Load] Setting workspace with', cleanState.tasks.length, 'tasks');
        // Preserve any tasks already loaded from cache or the tasks table —
        // the blob carries 0 tasks after migration so we must never overwrite.
        setWorkspace(prev => {
          const merged = {
            ...cleanState,
            tasks: cleanState.tasks.length > 0 ? cleanState.tasks : prev.tasks,
          };
          workspaceRef.current = merged;
          return merged;
        });
        stateVersionRef.current = workspaceFingerprint(cleanState);
        setMemCachedWorkspace(workspaceId, cleanState);
        setCachedWorkspace(workspaceId, cleanState);
        console.log('[Workspace Load] Workspace set successfully');
        // Run date-based automations on load (deferred so React state flushes first)
        setTimeout(runDateAutomations, 500);

        // Morning briefing — show once per login session (sessionStorage clears on browser close, survives refresh)
        if (user?.uid) {
          const sessionKey = `sfz_briefing_shown_${workspaceId}_${user.uid}`;
          if (!sessionStorage.getItem(sessionKey)) {
            sessionStorage.setItem(sessionKey, "1");
            setTimeout(() => setShowMorningBriefing(true), 800);
          }
        }

        // Daily full backup: spaces, lists, custom fields, statuses, tasks, settings
        maybeTakeDailySnapshot(workspaceId, cleanState);
        
        // Mark as loaded only AFTER successfully loading
        loadedWorkspaceIdRef.current = workspaceId;
        // Warm inventory cache in the background so clicking a task is instant
        warmInventoryCache(workspaceId);
        // Restore any tasks from the last 7 days that are in job_log but missing
        // from the tasks table (e.g. due to a missed realtime INSERT event).
        reconcileRecentJobLog(workspaceId).catch(console.warn);
        
        // Publish all existing forms (migration for existing workspaces)
        if (cleanState.forms && cleanState.forms.length > 0) {
          Promise.all(
            cleanState.forms.map(form => publishForm(workspaceId, form))
          ).catch(error => {
            console.error('Failed to publish existing forms:', error);
          });
        }
        
        // Subscribe to per-task realtime changes — each event carries exactly
        // one task row. No full-state re-fetch, no blob overwrite race.
        const applyTaskChange = (incomingTask: Task, isDelete = false) => {
          // Skip only if THIS specific task was recently saved by this tab.
          // A global selfWriteRef would also block other users' updates for
          // unrelated tasks that happen to arrive in the same window.
          if (recentlySavedTaskIds.current.has(incomingTask.id)) {
            console.log('[Task Subscription] Skipping self-write echo for task', incomingTask.id);
            return;
          }
          setWorkspace(prev => {
            const next = { ...prev };
            if (isDelete) {
              next.tasks = prev.tasks.filter(t => t.id !== incomingTask.id);
            } else {
              const idx = prev.tasks.findIndex(t => t.id === incomingTask.id);
              if (idx === -1) {
                next.tasks = [...prev.tasks, incomingTask];
              } else {
                const updated = [...prev.tasks];
                updated[idx] = incomingTask;
                next.tasks = updated;
              }
            }
            workspaceRef.current = next;
            return next;
          });
        };

        unsubscribe = subscribeTaskChanges(workspaceId, {
          onInsert: (task) => {
            console.log('[Task Subscription] INSERT', task.id);
            applyTaskChange(task);
          },
          onUpdate: (task) => {
            console.log('[Task Subscription] UPDATE', task.id);
            applyTaskChange(task);
          },
          onDelete: (taskId) => {
            console.log('[Task Subscription] DELETE', taskId);
            if (selfWriteRef.current) return;
            setWorkspace(prev => {
              const next = { ...prev, tasks: prev.tasks.filter(t => t.id !== taskId) };
              workspaceRef.current = next;
              return next;
            });
          },
        });

        // workspace_state subscription removed — task saves no longer touch the
        // blob so there is nothing to listen for there. The tasks table
        // subscription above handles all live sync.
      } catch (error) {
        console.error('[Workspace Load] Failed to load workspace:', error);
        // Never blank an already-loaded workspace on a failed reload — keep
        // whatever tasks are already visible. Only set empty on the very first load.
        if (workspaceRef.current.tasks.length === 0) {
          console.log('[Workspace Load] Setting empty workspace (no existing data)');
          setWorkspace(EMPTY_WORKSPACE);
        } else {
          console.log('[Workspace Load] Keeping existing workspace data despite error');
        }
      } finally {
        setIsLoadingWorkspace(false);
        console.log('[Workspace Load] Loading complete');
        // Restore view from URL hash on page refresh (only runs once)
        const savedSnap = restoreOnMount();
        if (savedSnap) restoreNav(savedSnap);
        else setShowStaffDashboard(true); // fresh session (no hash) → show dashboard
      }
    };

    loadAndSubscribe();

    // ─── 60-second polling fallback ──────────────────────────────────────
    // Safety net in case the WebSocket misses an event.
    const pollInterval = setInterval(async () => {
      if (selfWriteRef.current) return;
      if (pendingSaveRef.current) return;
      try {
        const freshTasks = await loadTasksForWorkspace(workspaceId);
        if (pendingSaveRef.current || selfWriteRef.current) return;
        if (freshTasks.length === 0) return;
        setWorkspace(prev => {
          const next = { ...prev, tasks: freshTasks };
          workspaceRef.current = next;
          return next;
        });
      } catch {
        // silently ignore poll errors
      }
    }, 60_000);

    // ─── Visibility-change refresh ────────────────────────────────────────
    // When the user switches back to the tab after being away, reconcile tasks only
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      if (selfWriteRef.current) return;
      if (pendingSaveRef.current) return;
      // Restore any tasks missing from the tasks table before re-fetching
      reconcileRecentJobLog(workspaceId).catch(console.warn);
      try {
        const freshTasks = await loadTasksForWorkspace(workspaceId);
        if (pendingSaveRef.current || selfWriteRef.current) return;
        if (freshTasks.length === 0) return;
        setWorkspace(prev => {
          const next = { ...prev, tasks: freshTasks };
          workspaceRef.current = next;
          return next;
        });
      } catch {
        // silently ignore
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (unsubscribe) unsubscribe();
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', onVisible);
      // Don't reset loadedWorkspaceIdRef here - we want to keep it loaded
    };
  }, [workspaceId]);

  // Warn before page close/refresh when a save is still in flight
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingSaveRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Save workspace changes to Supabase
  // UI updates instantly; write is debounced and retried so transient network
  // lag doesn't silently lose changes.
  const updateWorkspace = useCallback((updatedWorkspace: WorkspaceState, opts?: { immediate?: boolean }) => {
    if (!workspaceId) return;

    // Update local state immediately so the UI never lags
    setWorkspace(updatedWorkspace);
    workspaceRef.current = updatedWorkspace;
    const fingerprint = workspaceFingerprint(updatedWorkspace);
    stateVersionRef.current = fingerprint;
    setMemCachedWorkspace(workspaceId, updatedWorkspace);
    setCachedWorkspace(workspaceId, updatedWorkspace);

    // Mark that we have a local change pending — concurrent-edit detection
    // in the realtime subscriber uses this.
    pendingSaveRef.current = true;

    // Debounce the write — wait 400ms after the last call before writing.
    // Rapid sequences (status change + drag + etc.) become a single write.
    // Critical operations (deletes) pass immediate:true to skip the debounce
    // so the save completes before the user can navigate away.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const snapForSave = workspaceRef.current;
      // Tasks live in the tasks table — never write them into the blob.
      // Only save structural state: spaces, lists, forms, counters etc.
      const blobOnly = { ...snapForSave, tasks: [] } as WorkspaceState;
      console.log('[SAVE] Firing — saving structural state (spaces/lists/forms)');

      const delays = [0, 1000, 3000];
      let lastError: unknown = null;
      let saved = false;
      for (let i = 0; i < delays.length; i++) {
        if (delays[i]) await new Promise(r => setTimeout(r, delays[i]));
        try {
          await saveWorkspaceState(workspaceId, blobOnly);
          saved = true;
          console.log('[SAVE] Success on attempt', i + 1);
          break;
        } catch (error) {
          lastError = error;
          console.warn(`[saveWorkspaceState] attempt ${i + 1} failed:`, error);
        }
      }

      pendingSaveRef.current = false;

      if (!saved) {
        console.error('[SAVE] FAILED after all retries:', lastError);
        const sinceLast = Date.now() - lastSaveErrorAtRef.current;
        if (sinceLast > 4000) {
          lastSaveErrorAtRef.current = Date.now();
          toast({
            variant: 'destructive',
            title: 'Changes did not save',
            description: 'Network problem. Your last change may be lost on refresh — try again or check your connection.',
          });
        }
      }
      // No post-save re-fetch — tasks table subscription keeps task list live.
    }, opts?.immediate ? 0 : 400);
  }, [workspaceId, toast]);

  // Persist an array of changed tasks to the tasks table (fire-and-forget).
  // Used by handlers that call updateWorkspace to mutate tasks locally but
  // need those changes to also reach the DB so they survive a refresh.
  // Registers each task ID in recentlySavedTaskIds so the realtime echo
  // doesn't overwrite the already-correct local state on the saving tab.
  const persistTasks = useCallback((tasks: Task[]) => {
    if (!workspaceId || tasks.length === 0) return;
    const wid = workspaceId;
    tasks.forEach(t => {
      recentlySavedTaskIds.current.add(t.id);
      const { comments: _c, ...taskWithoutComments } = t as any;
      upsertTask(wid, taskWithoutComments as Task)
        .then(() => {
          // Keep echo suppression active for 4s after write completes
          setTimeout(() => recentlySavedTaskIds.current.delete(t.id), 4000);
        })
        .catch(err => {
          recentlySavedTaskIds.current.delete(t.id);
          console.error('[persistTasks] upsert failed for', t.id, err);
        });
    });
  }, [workspaceId]);

  // Keep workspaceRef in sync so async callbacks always read fresh state
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    if (!selectedTask) return;
    const freshSelectedTask = workspace.tasks.find(task => task.id === selectedTask.id);
    if (!freshSelectedTask) {
      setSelectedTask(null);
      return;
    }
    if (JSON.stringify(freshSelectedTask) !== JSON.stringify(selectedTask)) {
      setSelectedTask(freshSelectedTask);
    }
  }, [workspace.tasks, selectedTask]);

  // Mirror allWarningRules into a ref so the form-submission subscriber (whose
  // useEffect only depends on workspaceId) sees fresh rules without re-subscribing.
  const warningRulesRef = useRef<WarningRule[]>([]);
  useEffect(() => {
    warningRulesRef.current = allWarningRules;
  }, [allWarningRules]);

  // Track submissions being processed to prevent double-handling
  const processingRef = useRef<Set<string>>(new Set());
  // Track recently created jobs per form to block duplicate submissions within 15 minutes.
  // Key: `${formId}:${normalizedTitle}`, Value: Date.now() when the task was created.
  const recentFormJobsRef = useRef<Map<string, number>>(new Map());

  // Subscribe to form submissions and auto-create tasks
  useEffect(() => {
    if (!workspaceId) return;

    const handleSubmission = async (submission: FormSubmission & { id: string }) => {
      // Guard: skip if already being processed
      if (processingRef.current.has(submission.id)) return;
      processingRef.current.add(submission.id);
      try {
        // Guard 1: skip genuinely orphaned submissions only.
        // IMPORTANT: the age is based on the booking device's clock, which is often
        // wrong (tablets, kiosks). A 15-min window silently deleted REAL bookings
        // whenever a device clock was slow. So: tolerate clock skew (a NaN/future
        // timestamp counts as fresh, never stale) and only skip after 24h. And make
        // it VISIBLE so a skipped booking is never silent.
        const submittedAtMs = new Date(submission.submittedAt).getTime();
        const submissionAge = Number.isFinite(submittedAtMs) ? Date.now() - submittedAtMs : 0;
        const STALE_MS = 24 * 60 * 60 * 1000;
        if (submissionAge > STALE_MS) {
          console.warn('[FormSubmission] Skipping stale submission (age:', Math.round(submissionAge / 1000), 's):', submission.id);
          toast({
            title: 'Skipped an old booking',
            description: 'A queued booking was over 24h old and was skipped. If it was real, please re-submit it.',
            variant: 'destructive',
          });
          try {
            await deleteFormSubmission(submission.id);
          } catch (error) {
            console.warn('[FormSubmission] Failed to delete stale submission:', error);
          }
          processingRef.current.delete(submission.id);
          return;
        }

        // Guard 2: prevent duplicate tasks caused by accidental double-taps/double-submits.
        // Key on the pre-assigned job number when available — each form OPEN claims a unique
        // number via the DB RPC, so same job number = same physical form submission (double-tap),
        // different job number = new customer even if the title looks identical (e.g. two
        // consecutive "Speaker Repair" jobs). Fall back to title-based dedup only when no
        // job number is present (older form without pre-claim support).
        const dedupeKey = submission.task.jobNumber
          ? `${submission.formId}:job:${submission.task.jobNumber}`
          : `${submission.formId}:${(submission.task.title || '').replace(/\{jobNumber\}/g, '').replace(/\bjob-\d+\b/gi, '').replace(/\s{2,}/g, ' ').trim().toLowerCase()}`;
        const DEDUP_WINDOW = 15 * 60 * 1000; // 15 minutes — only relevant for the title-based fallback
        const lastCreated = recentFormJobsRef.current.get(dedupeKey);
        if (lastCreated && (Date.now() - lastCreated) < DEDUP_WINDOW) {
          console.warn('[FormSubmission] Duplicate submission blocked — same form+title created', Math.round((Date.now() - lastCreated) / 1000), 's ago. Deleting submission', submission.id);
          toast({
            title: 'Duplicate booking skipped',
            description: 'This is identical to a booking made in the last 15 minutes, so it was not added again. Change a detail (e.g. customer name) if it is a separate job.',
          });
          try {
            await deleteFormSubmission(submission.id);
          } catch (error) {
            console.warn('[FormSubmission] Failed to delete duplicate submission:', error);
          }
          processingRef.current.delete(submission.id);
          return;
        }

        // Use a Firestore transaction to atomically claim the next job number and
        // append the task — prevents race conditions when multiple forms are submitted
        // simultaneously, which previously caused duplicate job numbers and overwrites.
        const currentWorkspace = workspaceRef.current;
        const form = currentWorkspace.forms?.find(f => f.id === submission.formId);

        // Hard-block: same stale-task rule that gates "+ Add Task" must also gate
        // form submissions, otherwise reception bypasses the backlog check by using
        // the public booking form. Leave the submission queued (don't claim/delete)
        // so the next page load picks it up once the offending task is cleared.
        const stale = checkBlockNewInStaleList(
          submission.task.listId,
          currentWorkspace.tasks,
          currentWorkspace.lists,
          warningRulesRef.current,
        );
        if (stale) {
          const daysOld = Math.floor(
            (Date.now() - new Date(stale.offender.createdAt || 0).getTime()) / 86400000,
          );
          const listName = currentWorkspace.lists.find(l => l.id === stale.offender.listId)?.name;
          setStaleBlockData({
            rule: stale.rule,
            offenderTitle: stale.offender.title,
            offenderDays: daysOld,
            listName,
          });
          console.warn('[FormSubmission] Blocked by stale-task rule. Submission left queued:', submission.id);
          processingRef.current.delete(submission.id);
          return;
        }

        const claimResult = await claimJobNumberAndAddTask(
          workspaceId,
          submission.id, // claimed+deleted inside the transaction
          (jobNum) => {
            const title = (submission.task.title || "Form Submission").replace(/\{jobNumber\}/g, jobNum);
            let customFieldValues = [...(submission.task.customFieldValues || [])];
            if (form?.mapJobNumberToFieldId) {
              customFieldValues = customFieldValues.filter(v => v.fieldId !== form.mapJobNumberToFieldId);
              customFieldValues.push({ fieldId: form.mapJobNumberToFieldId, value: jobNum });
            }
            const submissionToday = new Date().toISOString().split("T")[0];
            return {
              ...submission.task,
              title,
              jobNumber: jobNum,
              customFieldValues,
              startDate: submission.task.startDate || submissionToday,
            };
          },
          // Use the pre-assigned job# if the public form already claimed one.
          submission.task.jobNumber || undefined,
        );

        const { jobNumberStr, updatedState, preAssigned } = claimResult ?? { jobNumberStr: null, updatedState: null, preAssigned: false };

        // null means another tab already processed this submission — bail out
        if (!updatedState) {
          processingRef.current.delete(submission.id);
          return;
        }

        // Merge the new task into the CURRENT local workspace rather than replacing
        // everything with updatedState — updatedState may have been built from an
        // empty base (state read timed out) and would wipe all existing tasks.
        let newTask = updatedState.tasks[updatedState.tasks.length - 1];
        const currentWs = workspaceRef.current;

        // Run task_created and task_in_list automations for form-submitted tasks
        // (form submissions bypass handleCreateTask, so we apply automations here)
        if (newTask) {
          const autoNow = new Date().toISOString();
          const formTaskList = currentWs.lists.find(l => l.id === newTask.listId);
          if (formTaskList?.automations) {
            for (const auto of formTaskList.automations) {
              if (!auto.enabled || auto.trigger.type !== 'task_created') continue;
              switch (auto.action.type) {
                case 'set_status':    if (auto.action.status)       newTask = { ...newTask, status: auto.action.status as TaskStatus }; break;
                case 'assign_members':if (auto.action.assigneeUids?.length) newTask = { ...newTask, assignees: auto.action.assigneeUids, assignee: auto.action.assigneeUids[0] }; break;
                case 'unassign_members': { const toRemove = auto.action.assigneeUids ?? []; const remaining = toRemove.length ? (newTask.assignees ?? []).filter((u: string) => !toRemove.includes(u)) : []; newTask = { ...newTask, assignees: remaining, assignee: remaining[0] ?? null }; break; }
                case 'set_priority':  if (auto.action.priority)     newTask = { ...newTask, priority: auto.action.priority as TaskPriority }; break;
                case 'flag_task':     newTask = { ...newTask, adminFlag: { flagged: true, reason: auto.action.flagReason || '', flaggedBy: 'automation', flaggedAt: autoNow } }; break;
                case 'move_to_list':  if (auto.action.listId)       newTask = { ...newTask, listId: auto.action.listId }; break;
              }
            }
          }
          for (const l of currentWs.lists) {
            if (!l.automations) continue;
            for (const auto of l.automations) {
              if (!auto.enabled) continue;
              if (auto.trigger.type !== 'task_in_list' && auto.trigger.type !== 'task_always_in_list') continue;
              if (auto.trigger.targetListId !== newTask.listId) continue;
              switch (auto.action.type) {
                case 'set_status':    if (auto.action.status)       newTask = { ...newTask, status: auto.action.status as TaskStatus }; break;
                case 'assign_members':if (auto.action.assigneeUids?.length) newTask = { ...newTask, assignees: auto.action.assigneeUids, assignee: auto.action.assigneeUids[0] }; break;
                case 'unassign_members': { const toRemove = auto.action.assigneeUids ?? []; const remaining = toRemove.length ? (newTask.assignees ?? []).filter((u: string) => !toRemove.includes(u)) : []; newTask = { ...newTask, assignees: remaining, assignee: remaining[0] ?? null }; break; }
                case 'set_priority':  if (auto.action.priority)     newTask = { ...newTask, priority: auto.action.priority as TaskPriority }; break;
                case 'flag_task':     newTask = { ...newTask, adminFlag: { flagged: true, reason: auto.action.flagReason || '', flaggedBy: 'automation', flaggedAt: autoNow } }; break;
                case 'move_to_list':  if (auto.action.listId)       newTask = { ...newTask, listId: auto.action.listId }; break;
              }
            }
          }
        }

        const mergedState: WorkspaceState = newTask ? {
          ...currentWs,
          tasks: [...currentWs.tasks.filter(t => t.id !== newTask.id), newTask],
          jobCounter: Math.max(currentWs.jobCounter ?? 0, updatedState.jobCounter ?? 0),
        } : currentWs;

        stateVersionRef.current = workspaceFingerprint(mergedState);
        setMemCachedWorkspace(workspaceId, mergedState);
        setCachedWorkspace(workspaceId, mergedState);
        setWorkspace(mergedState);
        // Submission already deleted inside the transaction — no separate call needed

        // Activity log: the form just produced a new task. The other "+ Add Task"
        // path is logged via trackTaskCreated; this is the form-driven path.
        const createdTask = newTask;
        if (user?.uid && createdTask) {
          logActivity(
            workspaceId,
            user.uid,
            'task_created',
            'task',
            createdTask.id,
            createdTask.title,
            { source: 'form_submission', formId: submission.formId, jobNumber: jobNumberStr },
          );
        }

        console.log('Form submission processed successfully:', submission.id, 'job:', jobNumberStr);

        // Record this form+title so any re-submission within 15 min is blocked
        recentFormJobsRef.current.set(dedupeKey, Date.now());

        const formTask = updatedState.tasks.find(t => t.jobNumber === jobNumberStr) ?? newTask;

        // Log task creation from form submission for audit trail
        try {
          await logTaskCreated(workspaceId, formTask, 'Form Submission System');
        } catch (error) {
          console.error("Failed to log form submission task creation:", error);
        }

        // Trigger WhatsApp if configured
        try {
          const waSettings = await loadWhatsAppSettings(workspaceId);
          if (waSettings.enabled) {
            const list = updatedState.lists.find(l => l.id === formTask.listId);
            await sendTaskWhatsApp(waSettings, formTask, list?.name || "", updatedState.customFields, workspaceId);
          }
        } catch (waErr) {
          console.error('[WhatsApp] Failed to send on form submission:', waErr);
        }

        // Print thermal sticker(s) if the form has it configured AND the
        // public form did NOT already print at submit time. The form sets
        // printedAtSubmit=true only when WebUSB was available + print
        // succeeded.
        if (form?.stickerEnabled && !submission.printedAtSubmit) {
          try {
            const { printJobStickers, buildStickerDataFromTask, isThermalPrintSupported } =
              await import("@/lib/thermalPrinterService");
            if (!isThermalPrintSupported()) {
              console.warn("[Sticker] WebUSB not supported on this browser — skipping print.");
            } else {
              // Map customFieldValues array → object keyed by fieldId for the helper
              const customFieldsObj: Record<string, any> = {};
              (newTask.customFieldValues || []).forEach(v => {
                customFieldsObj[v.fieldId] = v.value;
              });
              const data = buildStickerDataFromTask(
                form,
                {
                  jobNumber: newTask.jobNumber || jobNumberStr || newTask.id,
                  customFields: customFieldsObj,
                  createdAt: newTask.createdAt,
                },
                updatedState.customFields,
              );
              await printJobStickers(form, data, form.stickerCount || 1);
              console.log("[Sticker] Printed", form.stickerCount || 1, "sticker(s) for", newTask.jobNumber);
            }
          } catch (stickerErr: any) {
            console.error("[Sticker] Failed to print:", stickerErr);
            toast({
              title: "Sticker print failed",
              description: stickerErr?.message || "Check the printer is plugged in and try again.",
              variant: "destructive",
            });
          }
        }

        // Trigger iKhokha deposit payment if configured on the form
        if (form?.depositAmountFieldId) {
          try {
            const depositField = newTask.customFieldValues?.find(v => v.fieldId === form.depositAmountFieldId);
            const depositAmount = depositField ? parseFloat(String(depositField.value)) : 0;
            if (depositAmount > 0) {
              const { paylinkUrl } = await createJobDepositPaylink(
                workspaceId,
                jobNumberStr || newTask.jobNumber || newTask.id,
                depositAmount,
                `Deposit for ${newTask.title}`
              );
              // Do NOT call window.open() here — browser blocks popups from async Firestore callbacks.
              // Instead, store the paylink and show a clickable payment banner so staff taps it.
              setPendingPaylink({
                paylinkUrl,
                jobNumber: jobNumberStr || newTask.jobNumber || newTask.id,
                amountRands: depositAmount,
              });
              console.log('[iKhokha] Deposit paylink ready for job', jobNumberStr);
            }
          } catch (ikErr) {
            console.error('[iKhokha] Failed to create deposit paylink:', ikErr);
          }
        }

        // Auto-create a draft invoice under Walk-in Client for every book-in form submission
        try {
          const WALKIN_ID = "__walkin__";
          const today = new Date().toISOString().split('T')[0];
          const salesCfg = await loadSalesSettings(workspaceId).catch(() => ({ defaultVatEnabled: false, defaultVatRate: 15 }));
          const autoTaxRate = salesCfg.defaultVatEnabled ? (salesCfg.defaultVatRate || 15) : 0;

          // Extract customer name and phone from task custom field values
          const cfDefs = updatedState.customFields || [];
          let customerName = "Walk-in Client";
          let customerPhone: string | undefined;

          for (const cfv of newTask.customFieldValues || []) {
            const def = cfDefs.find(d => d.id === cfv.fieldId);
            const val = String(cfv.value || '').trim();
            if (!val) continue;
            const defType = def?.type || '';
            const defName = (def?.name || '').toLowerCase();
            // Phone: type is 'phone' or field name suggests phone
            if (!customerPhone && (defType === 'phone' || defName.includes('phone') || defName.includes('cell') || defName.includes('mobile') || defName.includes('contact'))) {
              customerPhone = val;
            }
            // Name: field named name/customer/client
            if (customerName === "Walk-in Client" && (defName.includes('name') || defName.includes('customer') || defName.includes('client'))) {
              customerName = val;
            }
          }

          // Read deposit amount from the form's mapped field (same field used for iKhokha paylink)
          const autoDepositAmount = form?.depositAmountFieldId
            ? parseFloat(String(newTask.customFieldValues?.find(v => v.fieldId === form.depositAmountFieldId)?.value || '0')) || 0
            : 0;

          await createInvoice(workspaceId, user?.uid || 'system', 'Form Submission', {
            customerId: WALKIN_ID,
            customerName,
            ...(customerPhone ? { customerPhone } : {}),
            items: [{
              productName: autoDepositAmount > 0 ? `Booking Deposit: ${newTask.title}` : `Book-in: ${newTask.title}`,
              description: autoDepositAmount > 0
                ? `Deposit received for Job ${jobNumberStr}`
                : `Job ${jobNumberStr} — awaiting assessment`,
              quantity: 1,
              price: autoDepositAmount,
              total: autoDepositAmount,
            }],
            taxRate: autoTaxRate,
            dueDate: today,
            terms: 'due-on-receipt',
            notes: `Auto-created on book-in. Job: ${jobNumberStr}`,
            purchaseOrder: jobNumberStr || String(newTask.jobNumber || ''),
            ...(autoDepositAmount > 0 ? { amountPaid: autoDepositAmount } : {}),
          });
          console.log('[BookIn Invoice] Draft invoice created for job', jobNumberStr, autoDepositAmount > 0 ? `(deposit: ${autoDepositAmount})` : '');
        } catch (invoiceErr) {
          console.error('[BookIn Invoice] Failed to create invoice:', invoiceErr);
        }
      } catch (error) {
        console.error('Failed to process form submission:', error);
        toast({
          title: 'Booking could not be created',
          description: (error as any)?.message
            ? `The booking was received but the task failed to save: ${(error as any).message}. It will retry automatically.`
            : 'The booking was received but the task failed to save. It will retry automatically — if it keeps failing, reload the page.',
          variant: 'destructive',
        });
      }
    };

    // Poll for submissions as a low-latency fallback. Supabase realtime can lag
    // or miss events if the table publication/socket is sleepy; this keeps the
    // book-in desk seeing new tasks within a few seconds.
    const pollPendingSubmissions = () => {
      getPendingFormSubmissions(workspaceId)
        .then(pending => {
          if (pending.length > 0) console.log('[FormPoll]', pending.length, 'pending submission(s) found — processing now');
          pending.forEach(s => handleSubmission(s));
        })
        .catch(err => console.error('[FormPoll] Failed to check pending submissions:', err));
    };
    pollPendingSubmissions();
    const formPollInterval = setInterval(pollPendingSubmissions, 5 * 60_000);

    const unsubscribe = subscribeFormSubmissions(workspaceId, handleSubmission);
    return () => {
      clearInterval(formPollInterval);
      unsubscribe();
    };
  }, [workspaceId]);


  // Custom fields manager state
  const [cfTarget, setCfTarget] = useState<{ id: string; type: "space" | "folder" | "list" } | null>(null);

  const currentList = workspace.lists.find(l => l.id === selectedListId) || null;

  // Keyboard shortcuts for debugging features
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Shift + R = Task Recovery Panel
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        setShowTaskRecovery(true);
      }
      // Ctrl/Cmd + K = Global Search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);


  const breadcrumb = useMemo(() => {
    // Special case for Tasks with Issues space
    if (selectedListId === JOBS_WITH_ISSUES_SPACE_ID) {
      return ["⚠️ Tasks with Issues"];
    }
    
    if (!currentList) return ["Select a list"];
    const parts: string[] = [];
    if (currentList.parentType === "folder") {
      const folder = workspace.folders.find(f => f.id === currentList.parentId);
      if (folder) {
        const space = workspace.spaces.find(s => s.id === folder.spaceId);
        if (space) parts.push(space.name);
        parts.push(folder.name);
      }
    } else {
      const space = workspace.spaces.find(s => s.id === currentList.parentId);
      if (space) parts.push(space.name);
    }
    parts.push(currentList.name);
    return parts;
  }, [selectedListId, currentList, workspace.folders, workspace.spaces]);

  const visibleFields = useMemo(() => {
    // Special case for Tasks with Issues space
    if (selectedListId === JOBS_WITH_ISSUES_SPACE_ID) {
      // Show all fields for better visibility of issues
      return workspace.customFields;
    }
    
    if (!currentList) return [];
    let fieldIds = [...(currentList.visibleFieldIds || [])];
    if (currentList.parentType === "folder") {
      const folder = workspace.folders.find(f => f.id === currentList.parentId);
      if (folder && folder.visibleFieldIds) {
        folder.visibleFieldIds.forEach(id => { if (!fieldIds.includes(id)) fieldIds.push(id); });
      }
    }
    return workspace.customFields.filter(f => fieldIds.includes(f.id));
  }, [selectedListId, currentList, workspace.folders, workspace.customFields]);

  // Calculate visible fields for the selected task's actual list
  const taskVisibleFields = useMemo(() => {
    if (!selectedTask) return [];
    const taskList = workspace.lists.find(l => l.id === selectedTask.listId);
    if (!taskList) return [];
    
    let fieldIds = [...(taskList.visibleFieldIds || [])];
    if (taskList.parentType === "folder") {
      const folder = workspace.folders.find(f => f.id === taskList.parentId);
      if (folder && folder.visibleFieldIds) {
        folder.visibleFieldIds.forEach(id => { if (!fieldIds.includes(id)) fieldIds.push(id); });
      }
    }
    return workspace.customFields.filter(f => fieldIds.includes(f.id));
  }, [selectedTask, workspace.lists, workspace.folders, workspace.customFields]);

  const filteredTasks = useMemo(() => {
    if (searchQuery) {
      // Global search: search ALL tasks across all lists
      const q = searchQuery.toLowerCase();
      return workspace.tasks.filter(task => {
        if (task.archived && !searchIncludeArchived) return false;
        // Global search across all task fields
        
        // 1. Basic task fields
        if ((task.title || "").toLowerCase().includes(q)) return true;
        if (task.description?.toLowerCase().includes(q)) return true;
        if (task.jobNumber?.toLowerCase().includes(q)) return true;
        if ((task.id || "").toLowerCase().includes(q)) return true;
        if ((task.status || "").toLowerCase().includes(q)) return true;
        if ((task.priority || "").toLowerCase().includes(q)) return true;
        if (task.assignee?.toLowerCase().includes(q)) return true;

        // 2. Custom field values
        for (const fieldValue of task.customFieldValues || []) {
          const fieldDef = workspace.customFields.find(f => f.id === fieldValue.fieldId);
          if (fieldDef) {
            if ((fieldDef.name || "").toLowerCase().includes(q)) return true;
            const valueStr = String(fieldValue.value || '').toLowerCase();
            if (valueStr.includes(q)) return true;
          }
        }

        // 3. Comments
        if (task.comments) {
          for (const comment of task.comments) {
            if ((comment.text || "").toLowerCase().includes(q)) return true;
            if ((comment.author || "").toLowerCase().includes(q)) return true;
          }
        }
        
        // 4. Dates (search formatted versions)
        if (task.createdAt?.includes(q)) return true;
        if (task.dueDate?.includes(q)) return true;
        
        // 5. Status and Priority labels (more user-friendly)
        const taskList = workspace.lists.find(l => l.id === task.listId);
        const taskStatuses = taskList?.customStatuses && taskList.customStatuses.length > 0 
          ? taskList.customStatuses 
          : DEFAULT_STATUSES;
        const statusConfig = taskStatuses.find(s => s.id === task.status);
        if (statusConfig?.label.toLowerCase().includes(q)) return true;
        
        const priorityConfig = PRIORITIES.find(p => p.value === task.priority);
        if (priorityConfig?.label.toLowerCase().includes(q)) return true;
        
        return false;
      });
    }
    // No search query: show only the selected list
    if (!selectedListId) return [];
    
    // Special case: "Tasks with Issues" space shows tasks without photos,
    // deduped by content so form-triplicated jobs only appear once.
    if (selectedListId === JOBS_WITH_ISSUES_SPACE_ID) {
      // Strip leading job-number prefix (e.g. "JOB-0193 ") before comparing titles
      const normalise = (title: string) =>
        title.replace(/^JOB-\d+\s*/i, "").trim().toLowerCase();

      // Group by normalised title + listId, keep the lowest job number in each group
      const groups = new Map<string, Task>();
      for (const t of workspace.tasks) {
        if (t.archived || (t.photos && t.photos.length > 0)) continue;
        const key = `${normalise(t.title)}|${t.listId}`;
        const existing = groups.get(key);
        if (!existing) {
          groups.set(key, t);
        } else {
          // Prefer the task with the HIGHEST job number (most recently booked in)
          const existingNum = parseInt((existing.jobNumber ?? "").replace(/\D/g, "") || "0", 10);
          const thisNum    = parseInt((t.jobNumber      ?? "").replace(/\D/g, "") || "0", 10);
          if (thisNum > existingNum) groups.set(key, t);
        }
      }
      return Array.from(groups.values())
        .sort((a, b) => (a.jobNumber ?? "").localeCompare(b.jobNumber ?? ""));
    }
    
    return workspace.tasks.filter(t => t.listId === selectedListId && !t.archived);
  }, [workspace.tasks, workspace.customFields, selectedListId, searchQuery, searchIncludeArchived]);

  const myOpenTaskCount = useMemo(() => {
    if (!user) return 0;
    return workspace.tasks.filter(t => {
      if (t.archived || DONE_STATUSES.has(t.status)) return false;
      const assignees = t.assignees?.length ? t.assignees : (t.assignee ? [t.assignee] : []);
      return assignees.includes(user.uid);
    }).length;
  }, [workspace.tasks, user]);

  const isTaskLocked = !!(taskLimitSettings && !taskLockoutOverridden && myRole !== 'owner' && myOpenTaskCount >= taskLimitSettings.limit);

  // List-age lockout: if a task assigned to this user has been sitting in a
  // list_age_lockout-targeted list longer than the threshold, lock them to
  // only that list's tasks until they clear it.
  const listAgeLock = useMemo(() => {
    if (!user || myRole === 'owner' || myRole === 'admin') return null;
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const lockoutRules = allWarningRules.filter(r => r.enabled && r.rule_type === 'list_age_lockout' && (r.stale_threshold_days ?? 0) > 0);
    for (const rule of lockoutRules) {
      // If rule targets specific users, skip if this user is not in the list
      const applyTo: string[] = (rule as any).apply_to_uids ?? [];
      if (applyTo.length > 0 && !applyTo.includes(user.uid)) continue;

      const scopedTasks = workspace.tasks.filter(t => {
        if (t.archived) return false;
        const assignees = t.assignees?.length ? t.assignees : (t.assignee ? [t.assignee] : []);
        if (!assignees.includes(user.uid)) return false;
        if (rule.list_id) return t.listId === rule.list_id;
        const taskList = workspace.lists.find(l => l.id === t.listId);
        return taskList?.parentId === rule.folder_id;
      });
      const overdue = scopedTasks.find(t => {
        if (!t.createdAt) return false;
        const days = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / MS_PER_DAY);
        return days >= (rule.stale_threshold_days as number);
      });
      if (overdue) {
        const lockedListId = rule.list_id ?? overdue.listId;
        const lockedListName = workspace.lists.find(l => l.id === lockedListId)?.name ?? 'this list';
        return { rule, overdue, lockedListId, lockedListName };
      }
    }
    return null;
  }, [user, myRole, allWarningRules, workspace.tasks, workspace.lists]);

  const visibleTasks = useMemo(() => {
    if (listAgeLock && user) {
      return filteredTasks.filter(t => t.listId === listAgeLock.lockedListId);
    }
    if (!isTaskLocked || !user) return filteredTasks;
    return filteredTasks.filter(t => {
      const assignees = t.assignees?.length ? t.assignees : (t.assignee ? [t.assignee] : []);
      return assignees.includes(user.uid);
    });
  }, [filteredTasks, isTaskLocked, listAgeLock, user]);

  // CRUD handlers
  const handleCreateSpace = (name: string, icon: string) => {
    updateWorkspace({ ...workspace, spaces: [...workspace.spaces, { id: `sp${Date.now()}`, name, icon, visibleFieldIds: [] }] });
  };
  const handleCreateFolder = (name: string, spaceId: string) => {
    updateWorkspace({ ...workspace, folders: [...workspace.folders, { id: `f${Date.now()}`, name, spaceId, visibleFieldIds: [] }] });
  };
  const handleCreateList = (name: string, parentId: string, parentType: "folder" | "space") => {
    const id = `l${Date.now()}`;
    updateWorkspace({ ...workspace, lists: [...workspace.lists, { id, name, parentId, parentType, visibleFieldIds: [], taskOrder: [] }] });
    setSelectedListId(id);
  };
  // Add activity tracking
  const { trackTaskCreated } = useActivityTracking();
  
  const handleCreateTask = async (title: string, status: TaskStatus, priority: TaskPriority, description?: string) => {
    if (creatingTaskRef.current) return;
    creatingTaskRef.current = true;
    try {
    // Prevent task creation in special "Tasks with Issues" space
    if (selectedListId === JOBS_WITH_ISSUES_SPACE_ID) {
      alert("Cannot create tasks in 'Tasks with Issues' space. Please select a regular list to create tasks.");
      return;
    }

    if (!selectedListId) return;

    // Hard-block: an existing task in this list/folder has gone stale per a
    // warning rule. Reception must handle that one before adding new work.
    const stale = checkBlockNewInStaleList(selectedListId, workspace.tasks, workspace.lists, allWarningRules);
    if (stale) {
      const daysOld = Math.floor(
        (Date.now() - new Date(stale.offender.createdAt || 0).getTime()) / 86400000,
      );
      const listName = workspace.lists.find((l) => l.id === stale.offender.listId)?.name;
      setStaleBlockData({
        rule: stale.rule,
        offenderTitle: stale.offender.title,
        offenderDays: daysOld,
        listName,
      });
      return;
    }
    
    const todayStr = new Date().toISOString().split("T")[0];
    let newTask: Task = {
      id: `t${Date.now()}`,
      title,
      status,
      priority,
      listId: selectedListId,
      customFieldValues: [],
      createdAt: todayStr,
      startDate: todayStr,
      description
    };

    const allListsForAuto = workspaceRef.current.lists;
    const createdList = allListsForAuto.find(l => l.id === selectedListId);
    const applyAutoAction = (auto: any, task: Task, now: string): Task => {
      switch (auto.action.type) {
        case 'set_status':    return auto.action.status ? { ...task, status: auto.action.status as TaskStatus } : task;
        case 'assign_members':return auto.action.assigneeUids?.length ? { ...task, assignees: auto.action.assigneeUids, assignee: auto.action.assigneeUids[0] } : task;
        case 'unassign_members': { const toRemove = auto.action.assigneeUids ?? []; const remaining = toRemove.length ? (task.assignees ?? []).filter((u: string) => !toRemove.includes(u)) : []; return { ...task, assignees: remaining, assignee: remaining[0] ?? null }; }
        case 'set_priority':  return auto.action.priority ? { ...task, priority: auto.action.priority as TaskPriority } : task;
        case 'flag_task':     return { ...task, adminFlag: { flagged: true, reason: auto.action.flagReason || '', flaggedBy: 'automation', flaggedAt: now } };
        case 'move_to_list':  return auto.action.listId ? { ...task, listId: auto.action.listId } : task;
        default: return task;
      }
    };
    if (createdList?.automations) {
      const now = new Date().toISOString();
      for (const auto of createdList.automations) {
        if (!auto.enabled || (auto.trigger.type !== 'task_created')) continue;
        newTask = applyAutoAction(auto, newTask, now);
      }
    }
    // task_in_list and task_always_in_list — fire on creation
    {
      const now = new Date().toISOString();
      for (const l of allListsForAuto) {
        if (!l.automations) continue;
        for (const auto of l.automations) {
          if (!auto.enabled) continue;
          if (auto.trigger.type !== 'task_in_list' && auto.trigger.type !== 'task_always_in_list') continue;
          if (auto.trigger.targetListId !== newTask.listId) continue;
          newTask = applyAutoAction(auto, newTask, now);
        }
      }
    }

    // Update workspace with new task
    const updatedWorkspace = {
      ...workspace,
      tasks: [...workspace.tasks, newTask],
    };
    updateWorkspace(updatedWorkspace);
    
    // Track task creation activity
    trackTaskCreated(newTask.id, newTask.title, selectedListId);
    
    // Trigger thermal printing if enabled
    if (workspaceId) {
      try {
        const currentList = workspace.lists.find(l => l.id === selectedListId);
        const listName = currentList?.name || "Unknown List";
        const printerSettings = await loadPrinterSettings(workspaceId);
        
        await printBookingSlip(
          workspaceId,
          newTask,
          listName,
          workspace.customFields,
          printerSettings
        );
      } catch (error) {
        console.error("Failed to print booking slip:", error);
        // Don't throw - printing failure shouldn't prevent task creation
      }
      
      // Log task creation for audit trail
      try {
        await logTaskCreated(workspaceId, newTask, user?.email || 'Unknown');
      } catch (error) {
        console.error("Failed to log task creation:", error);
        // Don't throw - audit failure shouldn't prevent task creation
      }

      // Append-only backup to job_log
      try {
        await logNewTask(workspaceId, newTask);
      } catch (error) {
        console.error("Failed to backup task to job_log:", error);
      }

      // Trigger WhatsApp notification if configured
      try {
        const waSettings = await loadWhatsAppSettings(workspaceId);
        if (waSettings.enabled) {
          const currentList = workspace.lists.find(l => l.id === selectedListId);
          await sendTaskWhatsApp(waSettings, newTask, currentList?.name || "", workspace.customFields, workspaceId);
        }
      } catch (waErr) {
        console.error('[WhatsApp] Failed to send on manual task creation:', waErr);
      }
    }
    } finally {
      creatingTaskRef.current = false;
    }
  };
  // Flush the pending task save to the DB immediately. Called on panel close
  // and by the 5-second idle fallback inside handleUpdateTask.
  const flushPendingTaskSave = useCallback(async () => {
    const pending = pendingTaskSaveRef.current;
    if (!pending) return;
    if (taskDbSaveTimerRef.current) { clearTimeout(taskDbSaveTimerRef.current); taskDbSaveTimerRef.current = null; }
    pendingTaskSaveRef.current = null;
    // Register this task ID so the subscription echo doesn't overwrite our save.
    const taskId = pending.task.id;
    recentlySavedTaskIds.current.add(taskId);
    try {
      // Strip comments from the task before saving — comments live in task_comments table.
      // Keeping them in task.data would mean the tasks table and task_comments table
      // diverge as each grows independently, and old embedded entries resurface on reload.
      const { comments: _stripped, ...taskWithoutComments } = pending.task as any;
      await upsertTask(pending.wid, taskWithoutComments as Task);
      console.log('[flushPendingTaskSave] Saved:', taskId);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[flushPendingTaskSave] Failed:', errMsg);
      toast({ variant: 'destructive', title: 'Save failed', description: 'Changes are visible locally but could not reach the server. They will retry automatically.' });
    } finally {
      // Clear the echo-suppression after 4s — long enough for realtime to fire.
      setTimeout(() => { recentlySavedTaskIds.current.delete(taskId); }, 4000);
    }
  }, []);

  // Save any pending task edit when the panel closes or switches to a different task.
  const prevSelectedTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = prevSelectedTaskIdRef.current;
    const currId = selectedTask?.id ?? null;
    if (prevId !== null && prevId !== currId && pendingTaskSaveRef.current) {
      flushPendingTaskSave();
    }
    prevSelectedTaskIdRef.current = currId;
  }, [selectedTask?.id, flushPendingTaskSave]);

  // Add activity tracking hooks
  const { trackTaskUpdated, trackTaskStatusChanged, trackTaskCompleted } = useActivityTracking();
  
  const handleUpdateTask = useCallback(async (updated: Task) => {
    // Use workspaceRef so this callback never has a stale closure even though it's memoized
    const current = workspaceRef.current;
    const previousTask = current.tasks.find(t => t.id === updated.id);

    // ── Build ClickUp-style system activity entries ──────────────────────────
    let taskWithActivity: Task = { ...updated, updatedAt: new Date().toISOString() };
    if (previousTask) {
      const activityEntries: TaskComment[] = [];
      const now = new Date().toISOString();
      const actorDisplayName = (user as any)?.displayName;
      const actorEmail = user?.email;
      const actor = actorDisplayName
        || (actorEmail ? actorEmail.split('@')[0] : null)
        || 'A user';
      const ts = () => `sys_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const labelDate = (iso: string | undefined | null) =>
        iso ? new Date(iso).toLocaleDateString() : '—';
      const labelValue = (v: any) => {
        if (v === null || v === undefined || v === '') return '—';
        if (typeof v === 'object') return JSON.stringify(v);
        if (typeof v === 'boolean') return v ? 'Yes' : 'No';
        return String(v);
      };
      const push = (entry: Omit<TaskComment, 'id' | 'isSystem' | 'author' | 'createdAt'>) => {
        activityEntries.push({ id: ts(), isSystem: true, author: actor, createdAt: now, ...entry });
      };

      // Status
      if (previousTask.status !== updated.status) {
        push({
          action: 'status',
          field: 'Status',
          oldValue: previousTask.status,
          newValue: updated.status,
          text: `changed status from ${previousTask.status} to ${updated.status}`,
        });
        trackTaskStatusChanged(updated.id, updated.title, previousTask.status, updated.status);
        if (updated.status === 'completed' || updated.status === 'done') {
          trackTaskCompleted(updated.id, updated.title);
        }
        // Snapshot current assignees when a task is first marked done — so the
        // staff dashboard still credits the right person even after unassignment
        if (DONE_STATUSES.has(updated.status) && !DONE_STATUSES.has(previousTask.status) && !updated.completedBy) {
          const snap = updated.assignees?.length ? updated.assignees : (updated.assignee ? [updated.assignee] : []);
          if (snap.length > 0) taskWithActivity = { ...taskWithActivity, completedBy: snap };
        }
      }
      // Title
      if (previousTask.title !== updated.title) {
        push({
          action: 'title',
          field: 'Title',
          oldValue: previousTask.title,
          newValue: updated.title,
          text: `renamed task to "${updated.title}"`,
        });
      }
      // Priority
      if (previousTask.priority !== updated.priority) {
        const oldP = previousTask.priority || 'none';
        const newP = updated.priority || 'none';
        push({
          action: 'priority',
          field: 'Priority',
          oldValue: oldP,
          newValue: newP,
          text: `set priority to ${newP}`,
        });
      }
      // List move
      if (previousTask.listId !== updated.listId) {
        const fromList = current.lists.find(l => l.id === previousTask.listId);
        const toList = current.lists.find(l => l.id === updated.listId);
        const fromName = fromList?.name || previousTask.listId;
        const toName = toList?.name || updated.listId;
        push({
          action: 'list_move',
          field: 'List',
          oldValue: fromName,
          newValue: toName,
          text: `moved task from ${fromName} to ${toName}`,
        });
      }
      // Due date
      const prevDue = previousTask.dueDate ?? '';
      const newDue = updated.dueDate ?? '';
      if (prevDue !== newDue) {
        push({
          action: 'due_date',
          field: 'Due date',
          oldValue: prevDue ? labelDate(prevDue) : null,
          newValue: newDue ? labelDate(newDue) : null,
          text: newDue ? `set due date to ${labelDate(newDue)}` : 'removed due date',
        });
      }
      // Start date
      const prevStart = (previousTask as any).startDate ?? '';
      const newStart = (updated as any).startDate ?? '';
      if (prevStart !== newStart) {
        push({
          action: 'start_date',
          field: 'Start date',
          oldValue: prevStart ? labelDate(prevStart) : null,
          newValue: newStart ? labelDate(newStart) : null,
          text: newStart ? `set start date to ${labelDate(newStart)}` : 'removed start date',
        });
      }
      // Technician
      if ((previousTask as any).technician !== (updated as any).technician) {
        const oldT = (previousTask as any).technician || null;
        const newT = (updated as any).technician || null;
        push({
          action: 'technician',
          field: 'Technician',
          oldValue: oldT,
          newValue: newT,
          text: newT ? `assigned technician to ${newT}` : 'removed technician',
        });
      }
      // Assignee
      if ((previousTask as any).assignee !== (updated as any).assignee) {
        const oldA = (previousTask as any).assignee || null;
        const newA = (updated as any).assignee || null;
        push({
          action: 'assignee',
          field: 'Assignee',
          oldValue: oldA,
          newValue: newA,
          text: newA ? `assigned to ${newA}` : 'unassigned',
        });
      }
      // Is paid
      if ((previousTask as any).isPaid !== (updated as any).isPaid) {
        push({
          action: 'is_paid',
          field: 'Is paid',
          oldValue: labelValue((previousTask as any).isPaid),
          newValue: labelValue((updated as any).isPaid),
          text: `marked is paid as ${labelValue((updated as any).isPaid)}`,
        });
      }
      // Custom fields
      const toMap = (arr: any[]) => {
        const m: Record<string, any> = {};
        (arr || []).forEach((v: any) => { if (v?.fieldId !== undefined) m[v.fieldId] = v.value; });
        return m;
      };
      const prevCF = toMap(previousTask.customFieldValues as any[]);
      const newCF = toMap(updated.customFieldValues as any[]);
      const allCFIds = new Set([...Object.keys(prevCF), ...Object.keys(newCF)]);
      allCFIds.forEach(fieldId => {
        const prev = prevCF[fieldId] ?? null;
        const next = newCF[fieldId] ?? null;
        if (JSON.stringify(prev) === JSON.stringify(next)) return;
        const fieldDef = current.customFields?.find((f: any) => f.id === fieldId);
        const fieldName = fieldDef?.name || fieldId;
        push({
          action: 'custom_field',
          field: fieldName,
          oldValue: labelValue(prev),
          newValue: labelValue(next),
          text: `updated ${fieldName} to ${labelValue(next)}`,
        });
      });
      // Spare parts
      const prevParts = (previousTask as any).sparePartsUsed ?? (previousTask as any).spareParts ?? [];
      const newParts = (updated as any).sparePartsUsed ?? (updated as any).spareParts ?? [];
      if (JSON.stringify(prevParts) !== JSON.stringify(newParts)) {
        const prevNames = new Set(prevParts.map((p: any) => p.name || p.partName || p.id));
        const newNames = new Set(newParts.map((p: any) => p.name || p.partName || p.id));
        (newParts as any[]).forEach((p: any) => {
          const n = p.name || p.partName || p.id;
          if (!prevNames.has(n)) push({
            action: 'spare_part_added',
            field: 'Spare parts',
            oldValue: null,
            newValue: String(n),
            text: `added spare part ${n}`,
          });
        });
        (prevParts as any[]).forEach((p: any) => {
          const n = p.name || p.partName || p.id;
          if (!newNames.has(n)) push({
            action: 'spare_part_removed',
            field: 'Spare parts',
            oldValue: String(n),
            newValue: null,
            text: `removed spare part ${n}`,
          });
        });
      }

      if (activityEntries.length > 0) {
        taskWithActivity = { ...taskWithActivity, comments: [...(updated.comments || []), ...activityEntries] };
        // Also insert each system entry into task_comments table so other users
        // see activity live via subscription (fire-and-forget, non-blocking).
        if (workspaceId) {
          for (const entry of activityEntries) {
            sbInsertComment(workspaceId, updated.id, entry as unknown as Record<string, unknown>)
              .catch(e => console.warn('[handleUpdateTask] system entry insert failed:', e));
          }
        }
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    // Run automations
    const applyAuto = (auto: any, task: Task, now: string): Task => {
      switch (auto.action.type) {
        case 'set_status':    return auto.action.status ? { ...task, status: auto.action.status as TaskStatus } : task;
        case 'assign_members':return auto.action.assigneeUids?.length ? { ...task, assignees: auto.action.assigneeUids, assignee: auto.action.assigneeUids[0] } : task;
        case 'unassign_members': { const toRemove = auto.action.assigneeUids ?? []; const remaining = toRemove.length ? (task.assignees ?? []).filter((u: string) => !toRemove.includes(u)) : []; return { ...task, assignees: remaining, assignee: remaining[0] ?? null }; }
        case 'set_priority':  return auto.action.priority ? { ...task, priority: auto.action.priority as TaskPriority } : task;
        case 'flag_task':     return { ...task, adminFlag: { flagged: true, reason: auto.action.flagReason || '', flaggedBy: 'automation', flaggedAt: now } };
        case 'move_to_list':  return auto.action.listId ? { ...task, listId: auto.action.listId } : task;
        default: return task;
      }
    };
    const autoList = current.lists.find(l => l.id === taskWithActivity.listId);
    if (autoList?.automations) {
      const now = new Date().toISOString();
      for (const auto of autoList.automations) {
        if (!auto.enabled) continue;
        let matches = false;
        if (auto.trigger.type === 'status_changed_to' && previousTask?.status !== taskWithActivity.status)
          matches = !auto.trigger.toStatus || taskWithActivity.status === auto.trigger.toStatus;
        else if (auto.trigger.type === 'task_moved_here' && previousTask?.listId !== taskWithActivity.listId)
          matches = true;
        if (!matches) continue;
        taskWithActivity = applyAuto(auto, taskWithActivity, now);
      }
    }
    // task_in_list: fires once when task enters the list (on move only)
    if (previousTask?.listId !== taskWithActivity.listId) {
      const now = new Date().toISOString();
      for (const l of current.lists) {
        if (!l.automations) continue;
        for (const auto of l.automations) {
          if (!auto.enabled || auto.trigger.type !== 'task_in_list') continue;
          if (auto.trigger.targetListId !== taskWithActivity.listId) continue;
          taskWithActivity = applyAuto(auto, taskWithActivity, now);
        }
      }
    }
    // task_always_in_list: enforced on every save — fires regardless of whether task moved
    {
      const now = new Date().toISOString();
      for (const l of current.lists) {
        if (!l.automations) continue;
        for (const auto of l.automations) {
          if (!auto.enabled || auto.trigger.type !== 'task_always_in_list') continue;
          if (auto.trigger.targetListId !== taskWithActivity.listId) continue;
          taskWithActivity = applyAuto(auto, taskWithActivity, now);
        }
      }
    }
    // start_date_overdue: fires when task's startDate is past the configured threshold
    if (taskWithActivity.startDate) {
      const now = new Date().toISOString();
      const todayMs = new Date(now.split('T')[0]).getTime();
      const startMs = new Date(taskWithActivity.startDate).getTime();
      for (const l of current.lists) {
        if (!l.automations) continue;
        for (const auto of l.automations) {
          if (!auto.enabled || auto.trigger.type !== 'start_date_overdue') continue;
          const targetListId = auto.trigger.targetListId;
          if (targetListId && taskWithActivity.listId !== targetListId) continue;
          const daysPast = Math.floor((todayMs - startMs) / 86400000);
          if (daysPast >= (auto.trigger.offsetDays ?? 0)) {
            taskWithActivity = applyAuto(auto, taskWithActivity, now);
          }
        }
      }
    }

    // Update local state instantly — UI never lags
    const newState = { ...current, tasks: current.tasks.map(t => t.id === taskWithActivity.id ? taskWithActivity : t) };
    setWorkspace(newState);
    workspaceRef.current = newState;
    stateVersionRef.current = workspaceFingerprint(newState);
    setMemCachedWorkspace(workspaceId!, newState);
    setCachedWorkspace(workspaceId!, newState);

    // Only keep the detail panel in sync if THIS task is already open — never
    // force it open. Otherwise a drag (status change) or any inline edit would
    // pop the task detail open unexpectedly.
    setSelectedTask((prev) => (prev && prev.id === taskWithActivity.id) ? taskWithActivity : prev);

    // Structural changes (list move, status, assignee, priority) must reach the
    // DB immediately — any incoming realtime event during a 5s debounce window
    // would re-fetch stale state and visually revert the move. Text-only edits
    // (title, description, custom field text) are safe to debounce because they
    // don't trigger Kanban/board position changes visible to other users.
    const isStructuralChange = previousTask && (
      previousTask.listId !== updated.listId ||
      previousTask.status !== updated.status ||
      previousTask.assignee !== updated.assignee ||
      previousTask.priority !== updated.priority ||
      JSON.stringify(previousTask.assignees) !== JSON.stringify(updated.assignees)
    );

    if (workspaceId) {
      if (taskDbSaveTimerRef.current) clearTimeout(taskDbSaveTimerRef.current);
      pendingTaskSaveRef.current = { wid: workspaceId, task: taskWithActivity };
      if (isStructuralChange) {
        // Flush immediately — no debounce for moves/status/assignee changes
        flushPendingTaskSave();
      } else {
        // Debounce text edits to collapse keystrokes into one RPC call
        taskDbSaveTimerRef.current = setTimeout(() => flushPendingTaskSave(), 5000);
      }
    }

    // Log task update for audit trail
    if (workspaceId && previousTask) {
      try {
        await logTaskUpdated(workspaceId, taskWithActivity, previousTask, user?.email || 'Unknown');

        // Track task updated activity using the activity tracking service
        // Only track if there are actual changes (activityEntries were created)
        if (taskWithActivity.comments && taskWithActivity.comments.length > previousTask.comments?.length) {
          const changesArray = taskWithActivity.comments
            .filter(c => c.isSystem)
            .slice(-(taskWithActivity.comments.length - (previousTask.comments?.length || 0)))
            .map(c => c.text);

          trackTaskUpdated(
            taskWithActivity.id,
            taskWithActivity.title,
            changesArray
          );
        }
      } catch (error) {
        console.error("Failed to log task update:", error);
      }
    }
  }, [workspaceId, user, toast]);

  const handleSaveList = useCallback((updatedList: List) => {
    const current = workspaceRef.current;
    const updatedLists = current.lists.map(l => l.id === updatedList.id ? updatedList : l);
    let tasks = current.tasks;
    // Auto-enforce any task_always_in_list automations immediately when saved
    const now = new Date().toISOString();
    for (const l of updatedLists) {
      if (!l.automations) continue;
      for (const auto of l.automations) {
        if (!auto.enabled || auto.trigger.type !== 'task_always_in_list') continue;
        const targetListId = auto.trigger.targetListId;
        if (!targetListId) continue;
        tasks = tasks.map(t => {
          if (t.listId !== targetListId || t.archived) return t;
          switch (auto.action.type) {
            case 'set_status':    return auto.action.status ? { ...t, status: auto.action.status as TaskStatus } : t;
            case 'assign_members':return auto.action.assigneeUids?.length ? { ...t, assignees: auto.action.assigneeUids, assignee: auto.action.assigneeUids[0] } : t;
            case 'unassign_members': { const toRemove = auto.action.assigneeUids ?? []; const remaining = toRemove.length ? (t.assignees ?? []).filter((u: string) => !toRemove.includes(u)) : []; return { ...t, assignees: remaining, assignee: remaining[0] ?? null }; }
            case 'set_priority':  return auto.action.priority ? { ...t, priority: auto.action.priority as TaskPriority } : t;
            case 'flag_task':     return { ...t, adminFlag: { flagged: true, reason: auto.action.flagReason || '', flaggedBy: 'automation', flaggedAt: now } };
            case 'move_to_list':  return auto.action.listId ? { ...t, listId: auto.action.listId } : t;
            default: return t;
          }
        });
      }
    }
    const changedTasks = tasks.filter((t, i) => t !== current.tasks[i]);
    updateWorkspace({ ...current, lists: updatedLists, tasks });
    persistTasks(changedTasks);
  }, [updateWorkspace, persistTasks]);

  const handleApplyAutomationToExisting = useCallback((auto: Automation): number => {
    const current = workspaceRef.current;
    const now = new Date().toISOString();
    // Determine which list to apply to — task_in_list uses targetListId, others use the list the automation lives on
    const targetListId = auto.trigger.type === 'task_in_list' ? (auto.trigger.targetListId ?? '') : (current.lists.find(l => l.automations?.some(a => a.id === auto.id))?.id ?? '');
    if (!targetListId) return 0;
    const tasksInList = current.tasks.filter(t => t.listId === targetListId && !t.archived);
    if (!tasksInList.length) return 0;
    const updatedTasks = tasksInList.map(task => {
      switch (auto.action.type) {
        case 'set_status':    return auto.action.status ? { ...task, status: auto.action.status as TaskStatus } : task;
        case 'assign_members':return auto.action.assigneeUids?.length ? { ...task, assignees: auto.action.assigneeUids, assignee: auto.action.assigneeUids[0] } : task;
        case 'unassign_members': { const toRemove = auto.action.assigneeUids ?? []; const remaining = toRemove.length ? (task.assignees ?? []).filter((u: string) => !toRemove.includes(u)) : []; return { ...task, assignees: remaining, assignee: remaining[0] ?? null }; }
        case 'set_priority':  return auto.action.priority ? { ...task, priority: auto.action.priority as TaskPriority } : task;
        case 'flag_task':     return { ...task, adminFlag: { flagged: true, reason: auto.action.flagReason || '', flaggedBy: 'automation', flaggedAt: now } };
        case 'move_to_list':  return auto.action.listId ? { ...task, listId: auto.action.listId } : task;
        default: return task;
      }
    });
    const updatedById = Object.fromEntries(updatedTasks.map(t => [t.id, t]));
    updateWorkspace({ ...current, tasks: current.tasks.map(t => updatedById[t.id] ?? t) });
    persistTasks(updatedTasks);
    return updatedTasks.length;
  }, [updateWorkspace, persistTasks]);

  // Batch-update multiple tasks at once (used by re-compressor to avoid race conditions)
  const handleBatchUpdateTasks = useCallback((updatedTasks: Task[]) => {
    const current = workspaceRef.current;
    const updatedById = Object.fromEntries(updatedTasks.map(t => [t.id, t]));
    updateWorkspace({ ...current, tasks: current.tasks.map(t => updatedById[t.id] ?? t) });
    persistTasks(updatedTasks);
  }, [updateWorkspace, persistTasks]);

  // Sweep all start_date_overdue automations across the workspace
  const runDateAutomations = useCallback(() => {
    const current = workspaceRef.current;
    if (!current.tasks.length) return;
    const now = new Date().toISOString();
    const todayMs = new Date(now.split('T')[0]).getTime();
    let tasks = current.tasks;
    let changed = false;

    const applyDateAction = (auto: any, task: Task): Task => {
      switch (auto.action.type) {
        case 'set_status':
          if (!auto.action.status || task.status === auto.action.status) return task;
          return { ...task, status: auto.action.status as TaskStatus };
        case 'assign_members':
          if (!auto.action.assigneeUids?.length) return task;
          if (JSON.stringify(task.assignees) === JSON.stringify(auto.action.assigneeUids)) return task;
          return { ...task, assignees: auto.action.assigneeUids, assignee: auto.action.assigneeUids[0] };
        case 'unassign_members': {
          const toRemove = auto.action.assigneeUids ?? [];
          const remaining = toRemove.length ? (task.assignees ?? []).filter((u: string) => !toRemove.includes(u)) : [];
          if (JSON.stringify(task.assignees) === JSON.stringify(remaining)) return task;
          return { ...task, assignees: remaining, assignee: remaining[0] ?? null };
        }
        case 'set_priority':
          if (!auto.action.priority || task.priority === auto.action.priority) return task;
          return { ...task, priority: auto.action.priority as TaskPriority };
        case 'flag_task':
          if (task.adminFlag?.flagged) return task;
          return { ...task, adminFlag: { flagged: true, reason: auto.action.flagReason || '', flaggedBy: 'automation', flaggedAt: now } };
        case 'move_to_list':
          if (!auto.action.listId || task.listId === auto.action.listId) return task;
          return { ...task, listId: auto.action.listId };
        default: return task;
      }
    };

    for (const list of current.lists) {
      for (const auto of list.automations ?? []) {
        if (!auto.enabled || auto.trigger.type !== 'start_date_overdue') continue;
        const offsetDays = auto.trigger.offsetDays ?? 0;
        const targetListId = auto.trigger.targetListId;
        tasks = tasks.map(task => {
          if (task.archived || !task.startDate) return task;
          if (targetListId && task.listId !== targetListId) return task;
          const daysPast = Math.floor((todayMs - new Date(task.startDate).getTime()) / 86400000);
          if (daysPast < offsetDays) return task;
          const updated = applyDateAction(auto, task);
          if (updated !== task) changed = true;
          return updated;
        });
      }
    }

    if (changed) {
      const changedTasks = tasks.filter((t, i) => t !== current.tasks[i]);
      updateWorkspace({ ...current, tasks });
      persistTasks(changedTasks);
    }
  }, [updateWorkspace, persistTasks]);

  // Run date automations on load and then every 5 minutes
  useEffect(() => {
    if (!workspaceId) return;
    const timer = setInterval(runDateAutomations, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [workspaceId, runDateAutomations]);

  // Navigate to the task's list and open it (used by search results & 3-dot menus)
  const handleOpenTask = useCallback((task: Task) => {
    setShowFormsPanel(false);
    setShowAccountsPage(false);
    setShowSpaceOverview(null);
    setShowFolderOverview(null);
    setShowTechAssessment(false);
    setShowOutstandingRepairs(false);
    setShowTaskCreationList(false);
    setSelectedListId(task.listId);   // switch to the list that contains this task
    setSearchQuery("");               // clear search so the list renders normally
    setSelectedTask(task);
  }, []);

  // Global barcode scanner — detects fast keyboard bursts (scanner hardware) from anywhere in the app.
  // Uses a timeout: after the last character, waits 150ms then fires automatically — no Enter needed.
  const barcodeBufferRef = useRef<{ chars: string; lastTime: number; timer: ReturnType<typeof setTimeout> | null }>({
    chars: "", lastTime: 0, timer: null,
  });
  const workspaceTasksRef = useRef(workspace.tasks);
  const handleOpenTaskRef = useRef(handleOpenTask);
  useEffect(() => { workspaceTasksRef.current = workspace.tasks; }, [workspace.tasks]);
  useEffect(() => { handleOpenTaskRef.current = handleOpenTask; }, [handleOpenTask]);

  useEffect(() => {
    const SCAN_INTERVAL_MS = 100; // max gap between scanner keystrokes
    const COMMIT_DELAY_MS  = 150; // wait after last char before firing
    const MIN_SCAN_LENGTH  = 3;

    const commitScan = async () => {
      const scanned = barcodeBufferRef.current.chars.trim();
      barcodeBufferRef.current.chars = "";
      barcodeBufferRef.current.lastTime = 0;
      barcodeBufferRef.current.timer = null;
      if (scanned.length < MIN_SCAN_LENGTH) return;

      // 1. Check tasks by job number
      const q = scanned.toLowerCase();
      const taskMatch = workspaceTasksRef.current.find(t => t.jobNumber?.toLowerCase() === q);
      if (taskMatch) {
        setScanResult({ type: "task", task: taskMatch });
        return;
      }

      // 2. Check inventory products by barcode / SKU
      const wid = workspaceId;
      if (wid) {
        try {
          const product = await findInventoryItemByBarcode(wid, scanned);
          if (product) {
            setScanResult({ type: "product", product });
            return;
          }
        } catch (_e) {}
      }

      // 3. No match — show popup instead of generic search modal
      setScanResult({ type: "notfound", query: scanned });
    };

    const handleBarcodeScan = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Don't hijack normal typing inside text fields
      if (inInput) {
        console.log("[BarcodeScanner] skipped — focus is in input:", target.tagName);
        return;
      }

      const buf = barcodeBufferRef.current;
      const now = Date.now();

      // Enter fires immediately (scanner suffix) — commit whatever is buffered
      if (e.key === "Enter") {
        if (buf.timer) clearTimeout(buf.timer);
        commitScan();
        return;
      }

      // Ignore modifier-only keypresses — scanners send Shift+letter for uppercase
      if (["Shift", "CapsLock", "Control", "Alt", "Meta"].includes(e.key)) return;

      // Non-printable key (Escape, Tab, arrows) — abort current buffer
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) {
        if (buf.timer) clearTimeout(buf.timer);
        buf.chars = "";
        buf.lastTime = 0;
        buf.timer = null;
        return;
      }

      // Printable character — gap check
      if (now - buf.lastTime > SCAN_INTERVAL_MS && buf.chars.length > 0) {
        // Too slow to be a scanner — reset
        if (buf.timer) clearTimeout(buf.timer);
        buf.chars = "";
        buf.timer = null;
      }

      buf.chars += e.key;
      buf.lastTime = now;

      // (Re)start the commit timer — fires if no more chars arrive within COMMIT_DELAY_MS
      if (buf.timer) clearTimeout(buf.timer);
      buf.timer = setTimeout(commitScan, COMMIT_DELAY_MS);
    };

    document.addEventListener('keydown', handleBarcodeScan);
    return () => {
      document.removeEventListener('keydown', handleBarcodeScan);
      if (barcodeBufferRef.current.timer) clearTimeout(barcodeBufferRef.current.timer);
    };
  }, []);

  // Quote generation handler — opens the same QuotationCreationPage used in Sales & Invoicing
  const handleGenerateQuote = async (task: Task) => {
    setQuoteTask(task);
    // If this task already has a linked quotation, load it for editing
    if (task.linkedQuotationId && workspaceId) {
      try {
        const existing = await getQuotation(workspaceId, task.linkedQuotationId);
        setEditingQuotationForTask(existing);
      } catch {
        setEditingQuotationForTask(null);
      }
    } else {
      setEditingQuotationForTask(null);
    }
    setShowQuoteDialog(true);
  };

  // Invoice generation from task handler
  const handleGenerateInvoice = (task: Task) => {
    setInvoiceTask(task);
    setShowInvoiceFromTask(true);
  };

  // Fault assessment report handler
  const handleGenerateAssessment = (task: Task) => {
    setFaultReportTask(task);
    setShowFaultReport(true);
  };

  const handleStatusChange = (taskId: string, status: TaskStatus) => {
    const task = workspace.tasks.find(t => t.id === taskId);
    if (!task) return;

    const taskList = workspace.lists.find(l => l.id === task.listId);
    const listStatuses = taskList?.customStatuses && taskList.customStatuses.length > 0
      ? taskList.customStatuses
      : DEFAULT_STATUSES;

    // Check if the target status exists in the task's list configuration
    const targetStatusExists = listStatuses.some(s => s.id === status);

    if (!targetStatusExists) {
      console.warn(`Status "${status}" is not valid for list "${taskList?.name}". Change rejected.`);
      return;
    }

    // Route through handleUpdateTask so the change is logged in the activity
    // feed (same as a field edit). Previously this directly mutated state and
    // bypassed all logging — drag-and-drop moves were invisible to staff.
    handleUpdateTask({ ...task, status });
  };

  const handleMoveTask = (taskId: string, targetListId: string) => {
    const task = workspace.tasks.find(t => t.id === taskId);
    if (!task) return;
    if (!task.photos || task.photos.length === 0) {
      toast({ title: "Photo required", description: "Please add a photo to this task before moving it.", variant: "destructive" });
      return;
    }
    
    const targetList = workspace.lists.find(l => l.id === targetListId);
    const targetStatuses = targetList?.customStatuses && targetList.customStatuses.length > 0 
      ? targetList.customStatuses 
      : DEFAULT_STATUSES;
    
    // Always ask which status to assign in the target list
    setStatusSelectionData({
      task,
      targetListId,
      targetListName: targetList?.name || "Unknown List",
      availableStatuses: targetStatuses
    });
    setShowStatusSelection(true);
  };

  const handleStatusSelectionConfirm = async (selectedStatus: string) => {
    if (!statusSelectionData || !statusSelectionData.task) return;
    
    const { task, targetListId } = statusSelectionData;
    
    // Get target list to find folder ID
    const targetList = workspace.lists.find(l => l.id === targetListId);
    const targetFolderId = targetList?.parentType === "folder" ? targetList.parentId : null;
    
    if (targetFolderId) {
      // Build task data from task properties and customFieldValues
      const cfMap: Record<string, unknown> = {};
      (task.customFieldValues || []).forEach((cfv: { fieldId: string; value: unknown }) => {
        const fieldDef = workspace.customFields.find(f => f.id === cfv.fieldId);
        if (fieldDef) {
          cfMap[fieldDef.name] = cfv.value;
        }
      });

      // Include built-in task fields too — warning rules might require things
      // like "Technician" or "Due Date" which aren't custom fields.
      const taskData: Record<string, unknown> = {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        startDate: task.startDate,
        dueDate: task.dueDate,
        technician: task.technician,
        assignee: task.assignee,
        isPaid: task.isPaid,
        jobNumber: task.jobNumber,
        date_completed: (task as any).date_completed,
        ...cfMap,
      };
      
      // Check for warnings
      const warningResult = await checkWarning(targetFolderId, taskData);
      
      if (warningResult.shouldWarn) {
        // Show warning dialog instead of completing move
        setWarningDialogData({
          task,
          targetListId,
          targetFolderId,
          selectedStatus,
          missingFields: warningResult.missingFields,
        });
        setShowWarningDialog(true);
        setShowStatusSelection(false);
        return;
      }
    }
    
    // No warning or no folder — proceed with move via handleUpdateTask so
    // the move + status change are recorded in the activity feed.
    handleUpdateTask({ ...task, listId: targetListId, status: selectedStatus as TaskStatus });

    setStatusSelectionData(null);
    setShowStatusSelection(false);
  };

  // Warning dialog handlers - proceed with move despite warning
  const handleWarningProceed = () => {
    if (!warningDialogData) return;

    const { task, targetListId, selectedStatus } = warningDialogData;
    handleUpdateTask({ ...task, listId: targetListId, status: selectedStatus as TaskStatus });

    setWarningDialogData(null);
    setShowWarningDialog(false);
  };

  const handleWarningCancel = () => {
    setWarningDialogData(null);
    setShowWarningDialog(false);
  };

  const handleDeleteTask = async (taskId: string) => {
    const taskToDelete = workspace.tasks.find(t => t.id === taskId);
    if (selectedTask?.id === taskId) setSelectedTask(null);

    // Update local state instantly so the UI is responsive
    const current = workspaceRef.current;
    const newState = {
      ...current,
      tasks: current.tasks.filter(t => t.id !== taskId),
      deletedTaskIds: [...new Set([...(current.deletedTaskIds ?? []), taskId])],
    };
    setWorkspace(newState);
    workspaceRef.current = newState;
    stateVersionRef.current = workspaceFingerprint(newState);
    setMemCachedWorkspace(workspaceId!, newState);
    setCachedWorkspace(workspaceId!, newState);

    // Fire atomic DB delete immediately — no debounce, no full-state merge needed.
    // The DB function removes only this task from the tasks array and tombstones its ID,
    // so concurrent saves from other users can never resurrect it.
    if (workspaceId) {
      selfWriteRef.current = true;
      try {
        await deleteTaskFromWorkspace(workspaceId, taskId);
      } catch (err) {
        console.error('[deleteTask] DB delete failed:', err);
        toast({ variant: 'destructive', title: 'Delete failed', description: 'Could not remove task — please try again.' });
        // Revert local state on failure
        setWorkspace(current);
        workspaceRef.current = current;
      } finally {
        setTimeout(() => { selfWriteRef.current = false; }, 1500);
      }
    }

    if (workspaceId && taskToDelete) {
      try { await logTaskDeleted(workspaceId, taskToDelete, user?.email || 'Unknown'); } catch { /* non-fatal */ }
    }
  };

  const handleArchiveAllInStatus = (statusId: string) => {
    const changed = workspace.tasks
      .filter(t => t.status === statusId && t.listId === selectedListId)
      .map(t => ({ ...t, archived: true }));
    updateWorkspace({
      ...workspace,
      tasks: workspace.tasks.map(t =>
        t.status === statusId && t.listId === selectedListId ? { ...t, archived: true } : t
      ),
    });
    persistTasks(changed);
  };

  const handleArchiveTask = useCallback((taskId: string) => {
    const t = workspace.tasks.find(t => t.id === taskId);
    updateWorkspace({ ...workspace, tasks: workspace.tasks.map(t => t.id === taskId ? { ...t, archived: true } : t) });
    if (t) persistTasks([{ ...t, archived: true }]);
  }, [workspace, persistTasks]);

  const handleUnarchiveTask = useCallback((taskId: string) => {
    const t = workspace.tasks.find(t => t.id === taskId);
    updateWorkspace({ ...workspace, tasks: workspace.tasks.map(t => t.id === taskId ? { ...t, archived: false } : t) });
    if (t) persistTasks([{ ...t, archived: false }]);
  }, [workspace, persistTasks]);

  const handleUnarchiveAll = useCallback(() => {
    const changed = workspace.tasks.filter(t => t.archived).map(t => ({ ...t, archived: false }));
    updateWorkspace({ ...workspace, tasks: workspace.tasks.map(t => ({ ...t, archived: false })) });
    persistTasks(changed);
  }, [workspace, persistTasks]);

  // ── Bulk / multi-select handlers ─────────────────────────────────────────
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAllInStatus = useCallback((statusOrIds: string, taskIds: string[]) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (taskIds.length === 0) {
        // deselect all in this status
        prev.forEach(id => {
          const t = workspace.tasks.find(t => t.id === id);
          if (t && t.status === statusOrIds) next.delete(id);
        });
      } else {
        taskIds.forEach(id => next.add(id));
      }
      return next;
    });
  }, [workspace.tasks]);

  const handleClearSelection = useCallback(() => setSelectedTaskIds(new Set()), []);

  const handleDeleteSelected = useCallback(async () => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    const current = workspaceRef.current;
    const tasksToDelete = current.tasks.filter(t => ids.includes(t.id));
    if (selectedTask && ids.includes(selectedTask.id)) setSelectedTask(null);

    // Update local state instantly
    const newState = {
      ...current,
      tasks: current.tasks.filter(t => !ids.includes(t.id)),
      deletedTaskIds: [...new Set([...(current.deletedTaskIds ?? []), ...ids])],
    };
    setWorkspace(newState);
    workspaceRef.current = newState;
    stateVersionRef.current = workspaceFingerprint(newState);
    setMemCachedWorkspace(workspaceId!, newState);
    setCachedWorkspace(workspaceId!, newState);
    setSelectedTaskIds(new Set());

    // Fire atomic deletes immediately for each selected task
    if (workspaceId) {
      selfWriteRef.current = true;
      try {
        await Promise.all(ids.map(id => deleteTaskFromWorkspace(workspaceId, id)));
      } catch (err) {
        console.error('[deleteSelected] DB delete failed:', err);
        toast({ variant: 'destructive', title: 'Bulk delete failed', description: 'Some tasks may not have been removed — please refresh.' });
      } finally {
        setTimeout(() => { selfWriteRef.current = false; }, 1500);
      }
    }

    if (workspaceId && tasksToDelete.length > 0) {
      try { await logTasksBulkDeleted(workspaceId, tasksToDelete, user?.email || 'Unknown', {}); } catch { /* non-fatal */ }
    }
  }, [selectedTaskIds, workspace, selectedTask, workspaceId, user]);

  const handleArchiveSelected = useCallback(() => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    const changedTasks = workspace.tasks.filter(t => ids.includes(t.id)).map(t => ({ ...t, archived: true }));
    updateWorkspace({ ...workspace, tasks: workspace.tasks.map(t => ids.includes(t.id) ? { ...t, archived: true } : t) });
    persistTasks(changedTasks);
    setSelectedTaskIds(new Set());
  }, [selectedTaskIds, workspace, persistTasks]);

  const handleBulkStatusChange = useCallback((status: string) => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    const changedTasks = workspace.tasks.filter(t => ids.includes(t.id)).map(t => ({ ...t, status: status as TaskStatus }));
    updateWorkspace({ ...workspace, tasks: workspace.tasks.map(t => ids.includes(t.id) ? { ...t, status: status as TaskStatus } : t) });
    persistTasks(changedTasks);
    setSelectedTaskIds(new Set());
  }, [selectedTaskIds, workspace, persistTasks]);

  const handleBulkMoveToList = useCallback((targetListId: string) => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    const selectedTasks = workspace.tasks.filter(t => ids.includes(t.id));
    const noPhotoTasks = selectedTasks.filter(t => !t.photos || t.photos.length === 0);
    if (noPhotoTasks.length > 0) {
      toast({ title: "Photo required", description: `${noPhotoTasks.length} task(s) have no photo. Add photos before moving.`, variant: "destructive" });
      return;
    }
    const targetList = workspace.lists.find(l => l.id === targetListId);
    const targetStatuses = targetList?.customStatuses?.length ? targetList.customStatuses : DEFAULT_STATUSES;
    const firstStatus = targetStatuses[0]?.id || 'to_do';
    const movedTasks = selectedTasks.map(t => ({ ...t, listId: targetListId, status: firstStatus as TaskStatus }));
    updateWorkspace({ ...workspace, tasks: workspace.tasks.map(t => ids.includes(t.id) ? { ...t, listId: targetListId, status: firstStatus as TaskStatus } : t) });
    persistTasks(movedTasks);
    setSelectedTaskIds(new Set());
  }, [selectedTaskIds, workspace, toast, persistTasks]);

  const handleDuplicateTask = (task: Task) => {
    const newTask: Task = {
      ...task,
      id: `t${Date.now()}`,
      title: `${task.title} (copy)`,
      jobNumber: undefined,
      createdAt: new Date().toISOString().split('T')[0],
      comments: [],
    };
    updateWorkspace({ ...workspace, tasks: [...workspace.tasks, newTask] });
    persistTasks([newTask]);
  };

  // Rename handlers
  const handleRenameSpace = (id: string, name: string) => {
    updateWorkspace({ ...workspace, spaces: workspace.spaces.map(s => s.id === id ? { ...s, name } : s) });
  };
  const handleRenameFolder = (id: string, name: string) => {
    updateWorkspace({ ...workspace, folders: workspace.folders.map(f => f.id === id ? { ...f, name } : f) });
  };
  const handleRenameList = (id: string, name: string) => {
    updateWorkspace({ ...workspace, lists: workspace.lists.map(l => l.id === id ? { ...l, name } : l) });
  };

  // Delete handlers (cascade)
  const handleDeleteSpace = (id: string) => {
    const folderIds = workspace.folders.filter(f => f.spaceId === id).map(f => f.id);
    const listIds = workspace.lists.filter(l =>
      (l.parentType === "space" && l.parentId === id) ||
      (l.parentType === "folder" && folderIds.includes(l.parentId))
    ).map(l => l.id);
    
    updateWorkspace({
      ...workspace,
      spaces: workspace.spaces.filter(s => s.id !== id),
      folders: workspace.folders.filter(f => f.spaceId !== id),
      lists: workspace.lists.filter(l => !listIds.includes(l.id)),
      tasks: workspace.tasks.filter(t => !listIds.includes(t.listId)),
    });
    
    if (selectedListId) {
      const list = workspace.lists.find(l => l.id === selectedListId);
      if (list) {
        const belongsToSpace = list.parentType === "space" && list.parentId === id;
        const folder = list.parentType === "folder" ? workspace.folders.find(f => f.id === list.parentId) : null;
        if (belongsToSpace || (folder && folder.spaceId === id)) setSelectedListId(null);
      }
    }
  };
  const handleDeleteFolder = (id: string) => {
    const listIds = workspace.lists.filter(l => l.parentId === id && l.parentType === "folder").map(l => l.id);
    updateWorkspace({
      ...workspace,
      folders: workspace.folders.filter(f => f.id !== id),
      lists: workspace.lists.filter(l => !listIds.includes(l.id)),
      tasks: workspace.tasks.filter(t => !listIds.includes(t.listId)),
    });
  };
  const handleDeleteList = (id: string) => {
    updateWorkspace({
      ...workspace,
      lists: workspace.lists.filter(l => l.id !== id),
      tasks: workspace.tasks.filter(t => t.listId !== id),
    });
    if (selectedListId === id) setSelectedListId(null);
  };

  // Custom fields handlers
  const getCfTargetName = () => {
    if (!cfTarget) return "";
    if (cfTarget.type === "space") return workspace.spaces.find(s => s.id === cfTarget.id)?.name || "";
    if (cfTarget.type === "folder") return workspace.folders.find(f => f.id === cfTarget.id)?.name || "";
    return workspace.lists.find(l => l.id === cfTarget.id)?.name || "";
  };
  const getCfVisibleIds = () => {
    if (!cfTarget) return [];
    if (cfTarget.type === "space") return workspace.spaces.find(s => s.id === cfTarget.id)?.visibleFieldIds || [];
    if (cfTarget.type === "folder") return workspace.folders.find(f => f.id === cfTarget.id)?.visibleFieldIds || [];
    return workspace.lists.find(l => l.id === cfTarget.id)?.visibleFieldIds || [];
  };
  const handleToggleField = (fieldId: string) => {
    if (!cfTarget) return;
    const toggle = (ids: string[]) => ids.includes(fieldId) ? ids.filter(i => i !== fieldId) : [...ids, fieldId];
    
    let updatedWorkspace = { ...workspace };
    if (cfTarget.type === "space") {
      updatedWorkspace.spaces = workspace.spaces.map(s => s.id === cfTarget.id ? { ...s, visibleFieldIds: toggle(s.visibleFieldIds || []) } : s);
    } else if (cfTarget.type === "folder") {
      updatedWorkspace.folders = workspace.folders.map(f => f.id === cfTarget.id ? { ...f, visibleFieldIds: toggle(f.visibleFieldIds || []) } : f);
    } else {
      updatedWorkspace.lists = workspace.lists.map(l => l.id === cfTarget.id ? { ...l, visibleFieldIds: toggle(l.visibleFieldIds || []) } : l);
    }
    updateWorkspace(updatedWorkspace);
  };
  const handleCreateField = (field: Omit<CustomFieldDefinition, "id">) => {
    const id = `cf${Date.now()}`;
    let updated = { ...workspace, customFields: [...workspace.customFields, { ...field, id }] };
    
    // Auto-add to current target's visible fields
    if (cfTarget) {
      if (cfTarget.type === "space") {
        updated.spaces = updated.spaces.map(s => s.id === cfTarget.id ? { ...s, visibleFieldIds: [...(s.visibleFieldIds || []), id] } : s);
      } else if (cfTarget.type === "folder") {
        updated.folders = updated.folders.map(f => f.id === cfTarget.id ? { ...f, visibleFieldIds: [...(f.visibleFieldIds || []), id] } : f);
      } else {
        updated.lists = updated.lists.map(l => l.id === cfTarget.id ? { ...l, visibleFieldIds: [...(l.visibleFieldIds || []), id] } : l);
      }
    }
    updateWorkspace(updated);
  };

  const handleEditField = (id: string, changes: Partial<Omit<CustomFieldDefinition, "id">>) => {
    updateWorkspace({
      ...workspace,
      customFields: workspace.customFields.map(f => f.id === id ? { ...f, ...changes } : f),
    });
  };

  const handleDeleteField = (id: string) => {
    updateWorkspace({
      ...workspace,
      customFields: workspace.customFields.filter(f => f.id !== id),
    });
  };

  // Form handlers
  const handleSaveForm = async (form: FormDefinition) => {
    if (!workspaceId) return;
    
    const exists = workspace.forms.some(f => f.id === form.id);
    updateWorkspace({
      ...workspace,
      forms: exists ? workspace.forms.map(f => f.id === form.id ? form : f) : [...workspace.forms, form],
    });
    
    // Publish form for public access
    try {
      await publishForm(workspaceId, form);
    } catch (error) {
      console.error('Failed to publish form:', error);
    }
  };
  const handleDeleteForm = async (id: string) => {
    updateWorkspace({ ...workspace, forms: workspace.forms.filter(f => f.id !== id) });
    
    // Unpublish form from public access
    try {
      await unpublishForm(id);
    } catch (error) {
      console.error('Failed to unpublish form:', error);
    }
  };

  // Show loading while auth or workspace is loading
  if (loading || isLoadingWorkspace) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {loading ? 'Authenticating...' : 'Loading workspace...'}
            </p>
            <p className="text-xs text-muted-foreground">
              {loading 
                ? 'Verifying your credentials' 
                : 'Setting up your workspace'
              }
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      defaultOpen={true}
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <div className="flex h-dvh w-full bg-background mobile-safe-layout">
        <CrmSidebar
          workspace={workspace}
          selectedListId={selectedListId}
          onSelectList={(id) => { closeAllOverlays(); setSelectedListId(id); setShowFormsPanel(false); setShowAccountsPage(false); setShowSpaceOverview(null); setShowFolderOverview(null); }}
          onCreateSpace={() => setShowCreateSpace(true)}
          onCreateFolder={(spaceId) => setCreateFolderSpaceId(spaceId)}
          onCreateList={(parentId, parentType) => setCreateListParent({ id: parentId, type: parentType })}
          onRenameSpace={handleRenameSpace}
          onRenameFolder={handleRenameFolder}
          onRenameList={handleRenameList}
          onDeleteSpace={handleDeleteSpace}
          onDeleteFolder={handleDeleteFolder}
          onDeleteList={handleDeleteList}
          onOpenCustomFields={(id, type) => setCfTarget({ id, type })}
          onTaskStatuses={(listId) => setShowStatusManager(listId)}
          onOpenForms={() => { closeAllOverlays(); setShowFormsPanel(true); setSelectedListId(null); setShowAccountsPage(false); setShowSpaceOverview(null); setShowFolderOverview(null); }}
          onOpenAccounts={() => { closeAllOverlays(); setShowAccountsPage(true); setShowFormsPanel(false); setSelectedListId(null); setShowSpaceOverview(null); setShowFolderOverview(null); }}
          onSpaceOverview={(spaceId) => { closeAllOverlays(); setShowSpaceOverview(spaceId); setShowFormsPanel(false); setShowAccountsPage(false); setSelectedListId(null); setShowFolderOverview(null); }}
          onFolderOverview={(folderId) => { closeAllOverlays(); setShowFolderOverview(folderId); setShowSpaceOverview(null); setShowFormsPanel(false); setShowAccountsPage(false); setSelectedListId(null); }}
          onManagePermissions={(id, type) => setShowPermissionManager({ id, type })}
          onManageUsers={() => setShowUserManagement(true)}
          onManageWorkspaces={() => setShowWorkspaceManagement(true)}
          onOpenWhatsApp={() => setShowWhatsApp(true)}
          onOpenInventory={() => { closeAllOverlays(); setShowInventory(true); }}
          onOpenStockMovements={() => { closeAllOverlays(); setShowStockMovements(true); }}
          onOpenQuotations={() => { closeAllOverlays(); setShowQuotations(true); }}
          onOpenInvoicing={() => { closeAllOverlays(); setShowInvoicing(true); }}
          onOpenCustomers={() => { closeAllOverlays(); setShowCustomers(true); }}
          onOpenStatements={() => { closeAllOverlays(); setShowStatements(true); }}
          onOpenBusinessOverview={() => { closeAllOverlays(); setShowBusinessOverview(true); }}
          onOpenTechAssessment={() => { closeAllOverlays(); setShowTechAssessment(true); }}
          onOpenOutstandingRepairs={() => { closeAllOverlays(); setShowOutstandingRepairs(true); }}
          onOpenDataSheets={() => { closeAllOverlays(); setShowDataSheets(true); }}
          onOpenActivityReports={() => { closeAllOverlays(); setShowActivityReports(true); }}
          onOpenAuditLog={() => { closeAllOverlays(); setShowAuditLog(true); }}
          onOpenStaffDashboard={() => { closeAllOverlays(); setShowStaffDashboard(true); }}
          onOpenTaskCreationList={() => { closeAllOverlays(); setShowTaskCreationList(true); }}
          onOpenSalesOverview={() => { closeAllOverlays(); setShowSalesOverview(true); }}
          onOpenInventoryOverview={() => { closeAllOverlays(); setShowInventoryOverview(true); }}
          onOpenInvoiceRegister={() => { closeAllOverlays(); setShowInvoiceRegister(true); }}
          onOpenExpenseSlips={() => { closeAllOverlays(); setShowExpenseSlips(true); }}
          onOpenInventoryRegister={() => { closeAllOverlays(); setShowInventoryRegister(true); }}
          onOpenBanking={() => { closeAllOverlays(); setShowBanking(true); }}
          onOpenBusinessPlanning={() => { closeAllOverlays(); setShowBusinessPlanning(true); }}
          onOpenEcommerceOperations={() => { closeAllOverlays(); setShowEcommerceOperations(true); }}
          onOpenEcommerceAnalytics={() => { closeAllOverlays(); setShowEcommerceAnalytics(true); }}
          onOpenWalkInSale={() => { closeAllOverlays(); setShowWalkInSale(true); }}
          onCaptureExpenseSlip={() => { closeAllOverlays(); setExpenseSlipInitialAction('camera'); setShowExpenseSlips(true); }}
          onDropTask={handleMoveTask}
          onOpenSalesSettings={() => setShowSalesSettings(true)}
          onOpenTaskLimitSettings={() => setShowTaskLimitSettings(true)}
          onOpenPrinter={() => setShowPrinter(true)}
          onOpenActivityMonitor={() => setShowActivityMonitor(true)}
          onOpenWhatsAppLogs={() => setShowWhatsAppLogs(true)}
          onOpenEmail={() => { closeAllOverlays(); setShowEmail(true); }}
          onOpenEmailSettings={() => setShowEmailSettings(true)}
          emailUnreadCount={emailUnreadCount}
          onOpenEcommerceSettings={() => { setEcommerceSettingsTab(undefined); setShowEcommerceSettings(true); }}
          onOpenEcommercePayments={() => { setEcommerceSettingsTab("payments"); setShowEcommerceSettings(true); }}
          onOpenStoreDesign={() => setShowStoreDesign(true)}
          onOpenEcommerceBot={() => setShowEcommerceBotSettings(true)}
          onOpenIkhokhaJobSettings={() => setShowIkhokhaJobSettings(true)}
          onOpenJobSettings={() => setShowJobSettings(true)}
          onOpenSupervisorPassword={() => setShowSupervisorPassword(true)}
          onOpenFieldMapper={() => setShowFieldMapper(true)}
          onShowTaskRecovery={() => setShowTaskRecovery(true)}
          onOpenAIAssistant={() => setShowAIAssistant(true)}
          onChangePassword={() => setShowChangePassword(true)}
          onOpenNotifications={() => setShowNotifications(true)}
          isOwner={myRole === 'owner'}
          onOpenSetupWizard={() => setShowSetupWizard(true)}
        />
        {/* Sidebar resize handle — hidden on mobile where sidebar is a sheet */}
        <div
          className="hidden md:block w-1 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors flex-shrink-0 z-20"
          onMouseDown={onSidebarResizeStart}
          onDoubleClick={() => {
            localStorage.removeItem('crm_sidebar_width');
            localStorage.removeItem('crm_sidebar_width_manual');
            // Trigger auto-fit by clearing manual flag and forcing re-computation
            const names: string[] = [...STATIC_SIDEBAR_ITEMS];
            if (workspace) {
              for (const s of workspace.spaces ?? []) names.push(s.name ?? "");
              for (const f of workspace.folders ?? []) names.push(f.name ?? "");
              for (const l of workspace.lists ?? []) names.push(l.name ?? "");
            }
            const longest = Math.max(0, ...names.filter(Boolean).map((n) => n.length));
            setSidebarWidth(Math.round(Math.min(400, Math.max(220, longest * 7.5 + 72))));
          }}
          title="Drag to resize · Double-click to auto-fit"
        />
        <div className="flex flex-col flex-1 overflow-hidden mobile-main-content relative">
          {isImpersonated && (
            <div className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-400 text-amber-950 text-xs font-medium shrink-0 z-50">
              <span>👁️ Viewing as <strong>{user?.email}</strong> — this is an admin impersonation session</span>
              <button
                onClick={async () => {
                  sessionStorage.removeItem('impersonated');
                  await supabase.auth.signOut();
                  window.close();
                }}
                className="bg-amber-950 text-amber-100 px-3 py-1 rounded text-xs font-semibold hover:bg-amber-900 transition-colors whitespace-nowrap"
              >
                ✕ End Session
              </button>
            </div>
          )}
          {!showFormsPanel && !showAccountsPage && !showSpaceOverview && !showFolderOverview && !showStaffDashboard && !anyOverlayActive && (
            <CrmHeader
              currentList={currentList}
              breadcrumb={breadcrumb}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSearchOpen={() => setShowSearch(true)}
              onCreateTask={() => { setCreateTaskStatus(undefined); setShowCreateTask(true); }}
              companyName={companyName}
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onBack={navBack}
              onForward={navForward}
              onRefresh={handleRefresh}
              isRefreshing={isRefreshing}
              onOpenAutomations={currentList ? () => setShowAutomations(true) : undefined}
            />
          )}
          {/* Floating nav pill — visible when a full-screen overlay is active */}
          {(anyOverlayActive || showAccountsPage || showSpaceOverview || showFolderOverview || showFormsPanel || showStaffDashboard) && (
            <div className="absolute top-3 right-4 z-50 flex items-center gap-0.5 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-1.5 py-1 shadow-md">
              <button
                onClick={navBack}
                disabled={!canGoBack}
                title="Go back"
                className={`p-1 rounded transition-colors ${canGoBack ? "text-muted-foreground hover:text-foreground hover:bg-accent" : "text-muted-foreground/25 cursor-default"}`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button
                onClick={navForward}
                disabled={!canGoForward}
                title="Go forward"
                className={`p-1 rounded transition-colors ${canGoForward ? "text-muted-foreground hover:text-foreground hover:bg-accent" : "text-muted-foreground/25 cursor-default"}`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <div className="w-px h-4 bg-border mx-0.5" />
              <button
                onClick={handleRefresh}
                title="Refresh data"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <svg className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              </button>
            </div>
          )}
          <div className="flex flex-1 overflow-hidden">
            <div className={!isMobile && selectedTask && !anyOverlayActive ? "flex-1 overflow-y-auto min-w-0" : "flex-1 overflow-y-auto"}>
              {showStaffDashboard ? (
                <StaffDashboardPage
                  onClose={() => setShowStaffDashboard(false)}
                  workspace={workspace}
                  onOpenTask={(taskId) => {
                    const t = workspace.tasks.find(t => t.id === taskId);
                    if (t) { setShowStaffDashboard(false); handleOpenTask(t); }
                  }}
                />
              ) : showWorkspaceManagement ? (
                <div className="h-full">
                  <WorkspaceManagement />
                </div>
              ) : showAccountsPage ? (
                <AccountsPage
                  workspace={workspace}
                  onUpdateWorkspace={updateWorkspace}
                  userId={user?.uid || ''}
                  onTaskClick={(taskId) => {
                    const task = workspace.tasks.find(t => t.id === taskId);
                    if (task) handleOpenTask(task);
                  }}
                />
              ) : showSpaceOverview ? (
                <SpaceOverview
                  spaceId={showSpaceOverview}
                  workspace={workspace}
                  onUpdateWorkspace={updateWorkspace}
                  onTaskClick={(taskId) => {
                    const task = workspace.tasks.find(t => t.id === taskId);
                    if (task) handleOpenTask(task);
                  }}
                />
              ) : showFolderOverview ? (
                <FolderOverview
                  folderId={showFolderOverview}
                  workspace={workspace}
                  onSelectList={(id) => { closeAllOverlays(); setSelectedListId(id); setShowFolderOverview(null); }}
                  onCreateList={(parentId, parentType) => setCreateListParent({ id: parentId, type: parentType })}
                />
              ) : showFormsPanel ? (
                <FormListPanel
                  forms={workspace.forms}
                  lists={workspace.lists}
                  onCreateForm={() => { setEditingForm(null); setShowFormBuilder(true); }}
                  onEditForm={(form) => { setEditingForm(form); setShowFormBuilder(true); }}
                  onDeleteForm={handleDeleteForm}
                  onDuplicateForm={(form) => { setEditingForm({ ...form, id: `f${Date.now()}`, name: `${form.name} (copy)` }); setShowFormBuilder(true); }}
                />
              ) : !selectedListId ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <p>Select a list from the sidebar to view tasks</p>
                </div>
              ) : (
                <div className="flex flex-col h-full">
                  {/* Search Results Indicator */}
                  {searchQuery && (
                    <div className="px-4 py-2 bg-muted/30 border-b text-sm text-muted-foreground">
                      <div className="flex items-center justify-between gap-3">
                        <span>
                          {visibleTasks.length} {visibleTasks.length === 1 ? 'result' : 'results'} for &ldquo;{searchQuery}&rdquo; across all lists
                        </span>
                        <button
                          onClick={() => setSearchIncludeArchived(v => !v)}
                          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            searchIncludeArchived
                              ? 'bg-amber-100 border-amber-400 text-amber-700 dark:bg-amber-900/40 dark:border-amber-600 dark:text-amber-400'
                              : 'bg-background border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                          }`}
                        >
                          <Archive className="h-3 w-3" />
                          {searchIncludeArchived ? 'Archived included' : 'Include archived'}
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {/* Tasks with Issues Indicator */}
                  {selectedListId === JOBS_WITH_ISSUES_SPACE_ID && (
                    <div className="px-4 py-3 bg-orange-50 border-b border-orange-200 text-sm">
                      <div className="flex items-center gap-2 text-orange-800">
                        <span className="text-base">⚠️</span>
                        <div>
                          <div className="font-medium">Tasks with Issues</div>
                          <div className="text-xs text-orange-600 mt-1">
                            Tasks shown here are missing photos. Upload photos to move them back to their regular lists.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Task Limit Lockout Banner */}
                  {taskLimitSettings && myRole !== 'owner' && (
                    <div className={`px-4 py-3 border-b shrink-0 ${isTaskLocked ? "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800" : "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"}`}>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-start gap-2.5">
                          <span className={`text-lg leading-none mt-0.5 ${isTaskLocked ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
                            {isTaskLocked ? "🔒" : "⚠️"}
                          </span>
                          <div>
                            <div className={`font-semibold text-sm ${isTaskLocked ? "text-red-700 dark:text-red-400" : "text-amber-800 dark:text-amber-300"}`}>
                              {myOpenTaskCount} / {taskLimitSettings.limit} open tasks
                              {isTaskLocked ? " — You are locked out" : ""}
                            </div>
                            {isTaskLocked && (
                              <div className="text-xs mt-0.5 text-red-600 dark:text-red-400">
                                I have locked you out of all other tasks. You have reached your tolerance limit — please complete and close your assigned tasks to regain full access.
                              </div>
                            )}
                          </div>
                        </div>
                        {isTaskLocked && taskLimitSettings.override_code && !taskLockoutOverridden && (
                          <button
                            onClick={() => { setOverrideInput(""); setShowOverrideDialog(true); }}
                            className="text-xs px-3 py-1 rounded-full border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors whitespace-nowrap"
                          >
                            Enter override code
                          </button>
                        )}
                        {taskLockoutOverridden && (
                          <button
                            onClick={() => setTaskLockoutOverridden(false)}
                            className="text-xs px-3 py-1 rounded-full border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors whitespace-nowrap"
                          >
                            Override active — click to cancel
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* List Age Lockout Banner */}
                  {listAgeLock && (
                    <div className="px-4 py-3 border-b shrink-0 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800">
                      <div className="flex items-start gap-2.5">
                        <span className="text-lg leading-none mt-0.5 text-red-600 dark:text-red-400">🔒</span>
                        <div>
                          <div className="font-semibold text-sm text-red-700 dark:text-red-400">
                            Locked to {listAgeLock.lockedListName} — overdue task
                          </div>
                          <div className="text-xs mt-0.5 text-red-600 dark:text-red-400">
                            <strong>{listAgeLock.overdue.title}</strong> has been sitting in {listAgeLock.lockedListName} too long. Clear it first before working on anything else.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Task Views */}
                  <div className="flex-1 overflow-hidden relative">
                    {/* Floating bulk action bar — shown in list view when tasks are selected */}
                    {viewMode === "list" && selectedTaskIds.size > 0 && (
                      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-background border border-border shadow-xl rounded-full px-4 py-2 flex-wrap max-w-[92vw]">
                        <CheckSquare className="h-4 w-4 text-primary flex-shrink-0" />
                        <span className="text-sm font-semibold mr-1">{selectedTaskIds.size} selected</span>

                        {/* Change Status */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="rounded-full h-7 gap-1 px-3">
                              Change Status <ChevronDown className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="center" className="max-h-64 overflow-y-auto">
                            {(workspace.lists.find(l => l.id === selectedListId)?.customStatuses || DEFAULT_STATUSES).map(s => (
                              <DropdownMenuItem key={s.id} onClick={() => handleBulkStatusChange(s.id)}>
                                {s.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Move to List */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="rounded-full h-7 gap-1 px-3">
                              <MoveRight className="h-3.5 w-3.5" /> Move to <ChevronDown className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="center" className="max-h-64 overflow-y-auto">
                            {workspace.lists.filter(l => l.id !== selectedListId).map(l => (
                              <DropdownMenuItem key={l.id} onClick={() => handleBulkMoveToList(l.id)}>
                                {l.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <Button variant="outline" size="sm" className="rounded-full h-7 gap-1.5 px-3" onClick={handleArchiveSelected}>
                          <Archive className="h-3.5 w-3.5" /> Archive
                        </Button>
                        <Button variant="destructive" size="sm" className="rounded-full h-7 gap-1.5 px-3" onClick={handleDeleteSelected}>
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                        <button className="text-muted-foreground hover:text-foreground ml-1 flex-shrink-0" onClick={handleClearSelection}>
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    {viewMode === "board" ? (
                      <TaskBoardView
                        tasks={visibleTasks}
                        visibleFields={visibleFields}
                        customStatuses={workspace.lists.find(l => l.id === selectedListId)?.customStatuses}
                        onSelectTask={handleOpenTask}
                        onStatusChange={handleStatusChange}
                        onCreateTask={(status) => { setCreateTaskStatus(status); setShowCreateTask(true); }}
                        onDeleteTask={handleDeleteTask}
                        onArchiveAllInStatus={handleArchiveAllInStatus}
                        onDuplicateTask={handleDuplicateTask}
                        onEditTask={(task) => handleOpenTask(task)}
                        onMoveTask={(task) => handleOpenTask(task)}
                        selectedTaskIds={selectedTaskIds}
                        onToggleSelect={handleToggleSelect}
                        onSelectAllInStatus={handleSelectAllInStatus}
                        onDeleteSelected={handleDeleteSelected}
                        onArchiveSelected={handleArchiveSelected}
                        onBulkStatusChange={handleBulkStatusChange}
                        onBulkMoveToList={handleBulkMoveToList}
                        onClearSelection={handleClearSelection}
                        availableLists={workspace.lists.filter(l => l.id !== selectedListId).map(l => ({ id: l.id, name: l.name }))}
                        archivedTasks={workspace.tasks.filter(t => t.listId === selectedListId && !!t.archived)}
                        onArchiveTask={handleArchiveTask}
                        onUnarchiveTask={handleUnarchiveTask}
                        onUnarchiveAll={handleUnarchiveAll}
                        onUpdateTask={handleUpdateTask}
                        lockedListId={listAgeLock?.lockedListId}
                        staleThresholdDays={listAgeLock?.rule?.stale_threshold_days as number | undefined}
                      />
                    ) : (
                      <TaskListView
                        tasks={visibleTasks}
                        visibleFields={visibleFields}
                        customStatuses={workspace.lists.find(l => l.id === selectedListId)?.customStatuses}
                        onSelectTask={handleOpenTask}
                        selectedTaskIds={selectedTaskIds}
                        onToggleSelect={handleToggleSelect}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Desktop Task Detail — inline resizable side panel */}
            {!isMobile && selectedTask && !anyOverlayActive && (
              <div
                className="relative flex shrink-0 border-l border-border bg-background overflow-hidden"
                style={{ width: panelWidth }}
              >
                {/* Resize handle */}
                <div
                  onMouseDown={onResizeStart}
                  className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10 transition-colors"
                  title="Drag to resize"
                />
                <div className="flex-1 overflow-hidden">
                  <TaskDetailPanel
                    task={selectedTask}
                    visibleFields={taskVisibleFields}
                    allFields={workspace.customFields}
                    allLists={workspace.lists}
                    forms={workspace.forms}
                    onUpdate={handleUpdateTask}
                    onMoveTask={handleMoveTask}
                    onClose={() => setSelectedTask(null)}
                    isFullScreen={false}
                    currentViewContext={selectedListId === JOBS_WITH_ISSUES_SPACE_ID ? "Tasks with Issues" : undefined}
                    onGenerateQuote={handleGenerateQuote}
                    onGenerateInvoice={handleGenerateInvoice}
                    onGenerateAssessment={handleGenerateAssessment}
                  />
                </div>
              </div>
            )}
          </div>

          {/* PAGE OVERLAYS — inside main content column so sidebar stays visible */}
          {showEmail && (
            <EmailPage onClose={() => setShowEmail(false)} onUnreadCountChange={setEmailUnreadCount} />
          )}
          {showInventory && (
            <InventoryPage onClose={() => setShowInventory(false)} />
          )}
          {showWalkInSale && (
            <WalkInSalePage onClose={() => setShowWalkInSale(false)} />
          )}
          {showStockMovements && (
            <div className="absolute inset-0 z-30 bg-background overflow-y-auto">
              <div className="relative">
                <button
                  onClick={() => setShowStockMovements(false)}
                  className="absolute top-4 right-4 z-10 p-2 bg-gray-100 hover:bg-gray-200 rounded-full"
                >
                  <svg className="w-6 h-6" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <StockMovementsPage />
              </div>
            </div>
          )}
          {showQuotations && (
            <QuotationManagementPage
              onClose={() => { setShowQuotations(false); setInitialQuotationId(undefined); }}
              initialQuotationId={initialQuotationId}
              onQuotationDeleted={(quotationId) => {
                const changed = workspace.tasks.filter(t => t.linkedQuotationId === quotationId).map(t => ({ ...t, linkedQuotationId: undefined }));
                updateWorkspace({
                  ...workspace,
                  tasks: workspace.tasks.map(t =>
                    t.linkedQuotationId === quotationId
                      ? { ...t, linkedQuotationId: undefined }
                      : t
                  ),
                });
                persistTasks(changed);
              }}
            />
          )}
          {showInvoicing && (
            <InvoiceManagementPage onClose={() => { setShowInvoicing(false); setInitialInvoiceId(undefined); }} initialInvoiceId={initialInvoiceId} />
          )}
          {showCustomers && (
            <CustomerPage onClose={() => setShowCustomers(false)} />
          )}
          {showStatements && (
            <StatementPage onClose={() => setShowStatements(false)} />
          )}
          {showBusinessOverview && (
            <BusinessOverviewPage
              onClose={() => setShowBusinessOverview(false)}
              workspace={workspace}
              onOpenTask={(taskId) => { const t = workspace.tasks.find(t => t.id === taskId); if (t) { setShowBusinessOverview(false); handleOpenTask(t); } }}
              onOpenInvoice={(id) => { setShowBusinessOverview(false); setInitialInvoiceId(id); closeAllOverlays(); setShowInvoicing(true); }}
              onOpenQuotation={(id) => { setShowBusinessOverview(false); setInitialQuotationId(id); closeAllOverlays(); setShowQuotations(true); }}
            />
          )}
          {showTechAssessment && (
            <TechAssessmentPage 
              onClose={() => setShowTechAssessment(false)} 
              workspace={workspace}
              onOpenTask={handleOpenTask}
            />
          )}
          {showOutstandingRepairs && (
            <OutstandingRepairsPage
              onClose={() => setShowOutstandingRepairs(false)}
              workspace={workspace}
            />
          )}
          {showDataSheets && (
            <DataSheetsPage />
          )}
          {showAuditLog && (
            <AuditLogPage
              onClose={() => setShowAuditLog(false)}
            />
          )}
          {showActivityReports && (
            <ActivityReportPage
              onClose={() => setShowActivityReports(false)}
            />
          )}
          {showTaskCreationList && (
            <TaskCreationListPage
              onClose={() => setShowTaskCreationList(false)}
              workspace={workspace}
              onOpenTask={(task) => { setShowTaskCreationList(false); handleOpenTask(task); }}
              onUpdateTask={handleUpdateTask}
            />
          )}
          {showSalesOverview && (
            <SalesOverviewPage
              onClose={() => setShowSalesOverview(false)}
              workspace={workspace}
              onGoCustomers={() => { setShowSalesOverview(false); setShowCustomers(true); }}
              onGoQuotations={() => { setShowSalesOverview(false); setShowQuotations(true); }}
              onGoInvoices={() => { setShowSalesOverview(false); setShowInvoicing(true); }}
              onOpenInvoice={(id) => { setShowSalesOverview(false); setInitialInvoiceId(id); setShowInvoicing(true); }}
              onOpenQuotation={(id) => { setShowSalesOverview(false); setInitialQuotationId(id); setShowQuotations(true); }}
            />
          )}
          {showInventoryOverview && (
            <InventoryOverviewPage
              onClose={() => setShowInventoryOverview(false)}
              onGoProducts={() => { setShowInventoryOverview(false); setShowInventory(true); }}
              onGoStockMovements={() => { setShowInventoryOverview(false); setShowStockMovements(true); }}
            />
          )}
          {showInvoiceRegister && (
            <InvoiceRegisterPage
              onClose={() => setShowInvoiceRegister(false)}
              workspaceId={workspaceId}
              onOpenInvoice={(id) => { setShowInvoiceRegister(false); setInitialInvoiceId(id); setShowInvoicing(true); }}
            />
          )}
          {showInventoryRegister && (
            <InventoryRegisterPage
              onClose={() => setShowInventoryRegister(false)}
              workspaceId={workspaceId}
              onOpenItem={() => { setShowInventoryRegister(false); setShowInventory(true); }}
            />
          )}
          {showBanking && (
            <BankingMatchingPage onClose={() => setShowBanking(false)} />
          )}
          {showBusinessPlanning && (
            <BusinessPlanningPage
              onClose={() => setShowBusinessPlanning(false)}
              onOpenCrm={() => { setShowBusinessPlanning(false); }}
              onOpenInventory={() => { setShowBusinessPlanning(false); setShowInventory(true); }}
              onOpenInvoicing={() => { setShowBusinessPlanning(false); setShowInvoiceRegister(true); }}
              onOpenQuotations={() => { setShowBusinessPlanning(false); setShowQuotations(true); }}
              onOpenBanking={() => { setShowBusinessPlanning(false); setShowBanking(true); }}
              onOpenAccounts={() => { setShowBusinessPlanning(false); setShowAccountsPage(true); }}
            />
          )}
          {showEcommerceOperations && (
            <EcommerceOrdersPage onClose={() => setShowEcommerceOperations(false)} />
          )}
          {showEcommerceAnalytics && (
            <EcommerceAnalyticsPage onClose={() => setShowEcommerceAnalytics(false)} />
          )}
          {/* showExpenseSlips && (
            <ExpenseSlipsPage
              onClose={() => { setShowExpenseSlips(false); setExpenseSlipInitialAction(undefined); }}
              initialAction={expenseSlipInitialAction}
            />
          ) */}
        </div>
        <CreateSpaceDialog open={showCreateSpace} onClose={() => setShowCreateSpace(false)} onCreate={handleCreateSpace} />
        {createFolderSpaceId && <CreateFolderDialog open={!!createFolderSpaceId} onClose={() => setCreateFolderSpaceId(null)} onCreate={handleCreateFolder} spaceId={createFolderSpaceId} />}
        {createListParent && <CreateListDialog open={!!createListParent} onClose={() => setCreateListParent(null)} onCreate={handleCreateList} parentId={createListParent.id} parentType={createListParent.type} />}
        <CreateTaskDialog open={showCreateTask} onClose={() => setShowCreateTask(false)} onCreate={handleCreateTask} defaultStatus={createTaskStatus} />
        {showAutomations && currentList && (
          <AutomationsDialog
            list={currentList}
            allLists={workspace.lists}
            members={members}
            onSave={handleSaveList}
            onClose={() => setShowAutomations(false)}
            onApplyToExisting={handleApplyAutomationToExisting}
          />
        )}
        <StatusSelectionDialog
          open={showStatusSelection}
          onClose={() => setShowStatusSelection(false)}
          task={statusSelectionData?.task || null}
          targetListName={statusSelectionData?.targetListName || ""}
          availableStatuses={statusSelectionData?.availableStatuses || []}
          onConfirm={handleStatusSelectionConfirm}
        />
        {/* Warning dialog for task moves */}
        {warningDialogData && (
          <AIBotWarningDialog
            open={showWarningDialog}
            onOpenChange={(open) => {
              setShowWarningDialog(open);
              if (!open) {
                // If dialog is being closed (not proceeding), cancel the move
                handleWarningCancel();
              }
            }}
            workspaceId={workspaceId || ""}
            targetFolderId={warningDialogData.targetFolderId}
            missingFields={warningDialogData.missingFields}
            onDismiss={() => {
              setShowWarningDialog(false);
              handleWarningCancel();
            }}
            folders={workspace.folders.map(f => ({ id: f.id, name: f.name }))}
          />
        )}

        {/* Stale task — Rule A: block creating a new task */}
        {staleBlockData && (
          <StaleTaskBlockDialog
            open={!!staleBlockData}
            onClose={() => setStaleBlockData(null)}
            workspaceId={workspaceId || ""}
            userId={user?.uid || ""}
            userName={user?.displayName || user?.email || "User"}
            ruleMessage={staleBlockData.rule.warning_message || "Please sort the existing task first."}
            offenderTitle={staleBlockData.offenderTitle}
            offenderDays={staleBlockData.offenderDays}
            listName={staleBlockData.listName}
          />
        )}

        {/* Stale task — Rule B: acknowledge sweep */}
        {staleAckHits.length > 0 && (
          <StaleTaskAcknowledgeDialog
            open={staleAckHits.length > 0}
            onClose={() => setStaleAckHits([])}
            workspaceId={workspaceId || ""}
            userId={user?.uid || ""}
            userName={user?.displayName || user?.email || "User"}
            hits={staleAckHits}
          />
        )}
        <SRAgentPanel
          open={showAIAssistant}
          onOpenChange={setShowAIAssistant}
          workspaceId={workspaceId || ""}
          userId={user?.uid || ""}
        />
        {!showAIAssistant && workspaceId && user?.uid && (
          <FloatingAIBubble workspaceId={workspaceId} userId={user.uid} open={false} />
        )}
        {cfTarget && (
          <CustomFieldsManager
            open={!!cfTarget}
            onClose={() => setCfTarget(null)}
            allFields={workspace.customFields}
            visibleFieldIds={getCfVisibleIds()}
            contextName={getCfTargetName()}
            contextType={cfTarget.type}
            onToggleField={handleToggleField}
            onCreateField={handleCreateField}
            onEditField={handleEditField}
            onDeleteField={handleDeleteField}
          />
        )}
        {showFormBuilder && (
          <FormBuilder
            key={editingForm?.id || 'new'}
            open={showFormBuilder}
            onClose={() => { setShowFormBuilder(false); setEditingForm(null); }}
            onSave={handleSaveForm}
            existingForm={editingForm || undefined}
            lists={workspace.lists}
            customFields={workspace.customFields}
          />
        )}

        {/* Mobile Task Detail Full-screen */}
        {isMobile && selectedTask && (
          <TaskDetailPanel
            task={selectedTask}
            visibleFields={taskVisibleFields}
            allFields={workspace.customFields}
            allLists={workspace.lists}
            forms={workspace.forms}
            onUpdate={handleUpdateTask}
            onMoveTask={handleMoveTask}
            onClose={() => setSelectedTask(null)}
            isFullScreen={true}
            currentViewContext={selectedListId === JOBS_WITH_ISSUES_SPACE_ID ? "Tasks with Issues" : undefined}
            onGenerateQuote={handleGenerateQuote}
            onGenerateInvoice={handleGenerateInvoice}
            onGenerateAssessment={handleGenerateAssessment}
          />
        )}

        {/* WhatsApp Settings Dialog */}
        <WhatsAppSettingsDialog
          open={showWhatsApp}
          onClose={() => setShowWhatsApp(false)}
          customFields={workspace.customFields}
        />

        {/* Fault Assessment Report Dialog */}
        {showFaultReport && faultReportTask && (
          <FaultReportDialog
            open={showFaultReport}
            onClose={() => { setShowFaultReport(false); setFaultReportTask(null); }}
            task={faultReportTask}
            customFields={workspace.customFields}
          />
        )}

        {/* Thermal Printer Settings Dialog */}
        <PrinterSettingsDialog
          open={showPrinter}
          onClose={() => setShowPrinter(false)}
          workspaceId={workspaceId!}
          customFields={workspace.customFields}
        />

        {/* User Management Dialog */}
        <UserManagement
          open={showUserManagement}
          onClose={() => setShowUserManagement(false)}
        />

        {/* Email Settings Dialog */}
        <EmailSettingsDialog
          open={showEmailSettings}
          onClose={() => setShowEmailSettings(false)}
        />

        {/* Notifications Settings Dialog */}
        <NotificationsSettingsDialog
          open={showNotifications}
          onClose={() => setShowNotifications(false)}
        />

        {/* Ecommerce Settings Dialog */}
        <EcommerceSettingsDialog
          open={showEcommerceSettings}
          onClose={() => setShowEcommerceSettings(false)}
          initialTab={ecommerceSettingsTab}
        />

        <StoreDesignStudio
          open={showStoreDesign}
          onClose={() => setShowStoreDesign(false)}
        />

        {/* Setup Wizard — shown automatically for new workspaces */}
        {showMorningBriefing && user && (
          <MorningBriefingDialog
            userName={(user as any).displayName || user.email?.split("@")[0] || "there"}
            tasks={workspace.tasks.filter(t => {
              if (t.archived) return false;
              const assignees: string[] = t.assignees?.length ? t.assignees : (t.assignee ? [t.assignee] : []);
              return assignees.includes(user.uid) && !["done","complete","invoiced","paid","completed"].includes(t.status);
            })}
            lists={workspace.lists}
            onClose={() => setShowMorningBriefing(false)}
          />
        )}

        {showSetupWizard && (
          <SetupWizard
            onOpenInventory={() => { setShowInventory(true); }}
            onOpenEcommerceSettings={() => { setShowEcommerceSettings(true); }}
            onOpenInvoicing={() => { closeAllOverlays(); setShowInvoicing(true); }}
            onOpenManageUsers={() => setShowUserManagement(true)}
            onOpenForms={() => { closeAllOverlays(); setShowFormsPanel(true); }}
            onOpenWhatsApp={() => setShowWhatsApp(true)}
            onDone={() => setShowSetupWizard(false)}
          />
        )}

        {/* Ecommerce Bot training dialog */}
        <EcommerceBotSettingsDialog
          open={showEcommerceBotSettings}
          onClose={() => setShowEcommerceBotSettings(false)}
          workspaceId={workspaceId || ""}
        />

        {/* iKhokha CRM Job Settings Dialog */}
        {workspaceId && (
          <IkhokhaJobSettingsDialog
            open={showIkhokhaJobSettings}
            onClose={() => setShowIkhokhaJobSettings(false)}
            workspaceId={workspaceId}
          />
        )}

        {/* Job Settings Dialog */}
        <JobSettingsDialog
          open={showJobSettings}
          onClose={() => setShowJobSettings(false)}
        />

        {/* Supervisor Password Dialog */}
        <SupervisorPasswordDialog
          open={showSupervisorPassword}
          onClose={() => setShowSupervisorPassword(false)}
        />

        {/* Sales Settings Dialog */}
        <SalesSettingsDialog
          open={showSalesSettings}
          onClose={() => setShowSalesSettings(false)}
        />

        {/* Task Limit Settings Dialog */}
        <TaskLimitSettingsDialog
          open={showTaskLimitSettings}
          onClose={() => {
            setShowTaskLimitSettings(false);
            if (workspaceId) loadTaskLimitSettings(workspaceId).then(s => setTaskLimitSettings(s && s.limit > 0 ? s : null));
          }}
          lists={workspace.lists
            .filter(l => l.parentType === "folder")
            .map(l => ({
              id: l.id,
              name: l.name,
              folderId: l.parentId,
              folderName: workspace.folders.find(f => f.id === l.parentId)?.name,
            }))}
          members={members.filter(m => m.role !== 'owner').map(m => ({
            uid: m.uid,
            displayName: m.displayName,
            email: m.email,
          }))}
        />

        {/* Task Lockout Override Dialog */}
        {showOverrideDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background border border-border rounded-lg shadow-xl p-6 w-80 space-y-4">
              <div className="font-semibold text-base flex items-center gap-2">
                <span>🔓</span> Enter Override Code
              </div>
              <p className="text-sm text-muted-foreground">Enter the admin override code to temporarily restore full task visibility for this session.</p>
              <input
                type="text"
                autoFocus
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Override code"
                value={overrideInput}
                onChange={e => setOverrideInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    if (overrideInput.trim() === taskLimitSettings?.override_code) {
                      setTaskLockoutOverridden(true);
                      setShowOverrideDialog(false);
                      setOverrideInput("");
                    } else {
                      setOverrideInput("");
                    }
                  }
                  if (e.key === 'Escape') setShowOverrideDialog(false);
                }}
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowOverrideDialog(false)}
                  className="px-3 py-1.5 text-sm rounded border border-border hover:bg-accent transition-colors"
                >Cancel</button>
                <button
                  onClick={() => {
                    if (overrideInput.trim() === taskLimitSettings?.override_code) {
                      setTaskLockoutOverridden(true);
                      setShowOverrideDialog(false);
                      setOverrideInput("");
                    } else {
                      setOverrideInput("");
                    }
                  }}
                  className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >Unlock</button>
              </div>
            </div>
          </div>
        )}

        {/* Status Manager Dialog */}
        {showStatusManager && (
          <StatusManager
            open={!!showStatusManager}
            onClose={() => setShowStatusManager(null)}
            listId={showStatusManager}
            workspace={workspace}
            onUpdateWorkspace={updateWorkspace}
          />
        )}

        {/* Permission Manager Dialog */}
        {showPermissionManager && (
          <PermissionManager
            open={!!showPermissionManager}
            onClose={() => setShowPermissionManager(null)}
            itemName={
              showPermissionManager.type === 'space' ? workspace.spaces.find(s => s.id === showPermissionManager.id)?.name || 'Unknown'
              : showPermissionManager.type === 'folder' ? workspace.folders.find(f => f.id === showPermissionManager.id)?.name || 'Unknown'
              : workspace.lists.find(l => l.id === showPermissionManager.id)?.name || 'Unknown'
            }
            itemType={showPermissionManager.type}
            permissions={(
              showPermissionManager.type === 'space' ? workspace.spaces.find(s => s.id === showPermissionManager.id)?.permissions || {}
              : showPermissionManager.type === 'folder' ? workspace.folders.find(f => f.id === showPermissionManager.id)?.permissions || {}
              : workspace.lists.find(l => l.id === showPermissionManager.id)?.permissions || {}
            ) as Record<string, any>}
            onPermissionsChange={(perms) => {
              let updated = { ...workspace };
              if (showPermissionManager.type === 'space') {
                updated.spaces = updated.spaces.map(s => s.id === showPermissionManager.id ? { ...s, permissions: perms } : s);
              } else if (showPermissionManager.type === 'folder') {
                updated.folders = updated.folders.map(f => f.id === showPermissionManager.id ? { ...f, permissions: perms } : f);
              } else {
                updated.lists = updated.lists.map(l => l.id === showPermissionManager.id ? { ...l, permissions: perms } : l);
              }
              updateWorkspace(updated);
            }}
          />
        )}

        {/* Activity Monitor Dialog */}
        <ActivityMonitor
          open={showActivityMonitor}
          onClose={() => setShowActivityMonitor(false)}
          workspace={workspace}
        />

        {/* WhatsApp Logs Dialog */}
        <WhatsAppLogsDialog
          open={showWhatsAppLogs}
          onClose={() => setShowWhatsAppLogs(false)}
        />

        {/* Global Search Modal */}
        <GlobalSearchModal
          open={showSearch}
          onClose={() => { setShowSearch(false); setScanInitialQuery(""); }}
          workspace={workspace}
          onOpenTask={(task) => { handleOpenTask(task); setShowSearch(false); setScanInitialQuery(""); }}
          initialQuery={scanInitialQuery}
        />

        {/* Barcode scan result popup */}
        {scanResult && (
          <ScanResultPopup
            result={scanResult}
            onClose={() => setScanResult(null)}
            onOpenTask={(task) => { handleOpenTask(task); setScanResult(null); }}
          />
        )}

        {/* Quote Creation — uses the same full QuotationCreationPage as Sales & Invoicing */}
        {showQuoteDialog && quoteTask && (
          <QuotationCreationPage
            fromTask={editingQuotationForTask ? undefined : quoteTask}
            editingQuotation={editingQuotationForTask || undefined}
            fieldMapping={fieldMapping}
            customFields={workspace.customFields}
            onClose={() => {
              setShowQuoteDialog(false);
              setQuoteTask(null);
              setEditingQuotationForTask(null);
            }}
            onSaved={(info) => {
              setShowQuoteDialog(false);
              setEditingQuotationForTask(null);
              // Link quotation to the task and log activity
              if (info?.fromTaskId) {
                const currentWs = workspaceRef.current;
                const task = currentWs.tasks.find(t => t.id === info.fromTaskId);
                if (task) {
                  const activityEntry: TaskComment = {
                    id: `activity_${Date.now()}`,
                    text: `📄 Quotation ${info.quotationNumber} ${info.id === task.linkedQuotationId ? 'updated' : 'created'} for this job`,
                    author: 'System',
                    createdAt: new Date().toISOString(),
                  };
                  const updatedTask: Task = {
                    ...task,
                    linkedQuotationId: info.id,
                    comments: [...(task.comments || []), activityEntry],
                  };
                  const updatedWs = {
                    ...currentWs,
                    tasks: currentWs.tasks.map(t => t.id === info.fromTaskId ? updatedTask : t),
                  };
                  updateWorkspace(updatedWs);
                  if (selectedTask?.id === info.fromTaskId) setSelectedTask(updatedTask);
                }
              }
              setQuoteTask(null);
            }}
          />
        )}

        {/* Invoice Creation from Task */}
        {showInvoiceFromTask && invoiceTask && (
          <InvoiceCreationPage
            onClose={() => {
              setShowInvoiceFromTask(false);
              setInvoiceTask(null);
            }}
            fromTask={invoiceTask}
            fieldMapping={fieldMapping}
            customFields={workspace.customFields}
          />
        )}

        {/* Field Mapper Dialog */}
        <FieldMapperDialog
          open={showFieldMapper}
          onClose={() => { setShowFieldMapper(false); if (workspaceId) loadFieldMapping(workspaceId).then(setFieldMapping); }}
          customFields={workspace.customFields}
        />

        {/* Task Recovery Panel */}
        {showChangePassword && <ChangePasswordDialog onClose={() => setShowChangePassword(false)} />}
        {showTaskRecovery && (
          <TaskRecoveryPanel
            workspace={workspace}
            workspaceId={workspaceId!}
            onUpdateTask={handleUpdateTask}
            onBatchUpdateTasks={handleBatchUpdateTasks}
            onClose={() => setShowTaskRecovery(false)}
          />
        )}

        {/* Mobile Floating Action Button (FAB) */}
        {isMobile && selectedListId && !showFormsPanel && !showAccountsPage && (
          <Button
            onClick={() => { setCreateTaskStatus(undefined); setShowCreateTask(true); }}
            className="fixed bottom-safe right-6 h-14 w-14 rounded-full shadow-lg z-40 bg-primary hover:bg-primary/90"
            size="icon"
          >
            <Plus className="h-6 w-6" />
          </Button>
        )}

        {/* iKhokha Deposit Payment Banner */}
        {pendingPaylink && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 rounded-2xl border border-green-400 bg-green-600 px-6 py-4 shadow-2xl text-white max-w-sm w-full mx-4 animate-in slide-in-from-bottom-4">
            <CreditCard className="h-8 w-8 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium opacity-80">Deposit ready — {pendingPaylink.jobNumber}</p>
              <p className="text-xl font-bold leading-tight">R{pendingPaylink.amountRands.toFixed(2)}</p>
            </div>
            <button
              onClick={() => {
                window.open(pendingPaylink.paylinkUrl, '_blank', 'noopener');
                setPendingPaylink(null);
              }}
              className="rounded-xl bg-white text-green-700 font-bold px-4 py-2 text-sm hover:bg-green-50 transition-colors shrink-0"
            >
              Tap to Pay
            </button>
            <button
              onClick={() => setPendingPaylink(null)}
              className="ml-1 opacity-70 hover:opacity-100 transition-opacity shrink-0"
              title="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

      </div>
    </SidebarProvider>
  );
}
