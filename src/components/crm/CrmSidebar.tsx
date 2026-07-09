import { useState, useRef, useEffect, ReactNode } from "react";
import { createPortal } from "react-dom";
import { importWorkspaceFromZip, peekZipContents, type ImportProgress, type ImportResult, type ImportOptions, type ZipContents, DEFAULT_IMPORT_OPTIONS } from "@/lib/importService";
import { exportWorkspaceToZip, type ExportProgress, type ExportOptions, DEFAULT_EXPORT_OPTIONS, EXPORT_SECTIONS } from "@/lib/exportService";

import {
  ChevronDown, ChevronRight, Plus,
  Folder as FolderIcon, FileText, Users, Lock, LogOut, MessageSquare, MessageCircle, DollarSign, Clock, BarChart3, BarChart2, Mail, Wrench, Printer, Package, Receipt, TrendingUp, FileSpreadsheet, Store, Building2, Settings, ExternalLink, CreditCard, Map, KeyRound, AlertCircle, Camera, TableProperties, Landmark, ArrowLeftRight, Activity, PieChart, FolderOpen, Bot, Sparkles, EyeOff, Sun, Moon, SunMoon, Bell, Zap, Upload, Download, CheckCircle, XCircle, ShieldAlert, BookOpen,
  ShoppingBag as ShoppingBagIcon,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarHeader, SidebarFooter,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WorkspaceState, Space, Folder, List } from "@/types/crm";
import type { MenuPermission } from "@/types/auth";
import { ItemContextMenu } from "@/components/crm/ItemContextMenu";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { JOBS_WITH_ISSUES_SPACE_ID } from "@/types/crm";
import { AIBotWarningDialog } from "@/components/crm/AIBotWarningDialog";
import { WarningRulesPanel } from "@/components/crm/WarningRulesPanel";
import { UpgradePlanDialog } from "@/components/crm/UpgradePlanDialog";
import { NotificationsBell } from "@/components/crm/NotificationsBell";
import { EcommerceNotificationsBell } from "@/components/crm/EcommerceNotificationsBell";

// Inject neon glow keyframes once
if (typeof document !== "undefined" && !document.getElementById("neon-glow-style")) {
  const s = document.createElement("style");
  s.id = "neon-glow-style";
  s.textContent = `
    @keyframes neonViolet {
      0%,100% { box-shadow: 0 0 4px 1px rgba(168,85,247,0.5), 0 0 10px 2px rgba(168,85,247,0.25); }
      50%      { box-shadow: 0 0 10px 3px rgba(168,85,247,0.8), 0 0 20px 6px rgba(168,85,247,0.4); }
    }
    @keyframes neonAmber {
      0%,100% { box-shadow: 0 0 4px 1px rgba(251,191,36,0.5), 0 0 10px 2px rgba(251,191,36,0.25); }
      50%      { box-shadow: 0 0 10px 3px rgba(251,191,36,0.8), 0 0 20px 6px rgba(251,191,36,0.4); }
    }
    @keyframes neonCyan {
      0%,100% { box-shadow: 0 0 4px 1px rgba(34,211,238,0.5), 0 0 10px 2px rgba(34,211,238,0.25); }
      50%      { box-shadow: 0 0 10px 3px rgba(34,211,238,0.8), 0 0 20px 6px rgba(34,211,238,0.4); }
    }
  `;
  document.head.appendChild(s);
}

interface CrmSidebarProps {
  workspace: WorkspaceState;
  selectedListId: string | null;
  onSelectList: (listId: string) => void;
  onCreateSpace: () => void;
  onCreateFolder: (spaceId: string) => void;
  onCreateList: (parentId: string, parentType: "folder" | "space") => void;
  onRenameSpace: (id: string, name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onRenameList: (id: string, name: string) => void;
  onDeleteSpace: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onDeleteList: (id: string) => void;
  onOpenCustomFields: (targetId: string, targetType: "space" | "folder" | "list") => void;
  onTaskStatuses: (listId: string) => void;
  onOpenForms: () => void;
  onOpenAccounts: () => void;
  onSpaceOverview: (spaceId: string) => void;
  onManagePermissions?: (id: string, type: "space" | "folder" | "list") => void;
  onManageUsers: () => void;
  onManageWorkspaces: () => void;
  onOpenWhatsApp: () => void;
  onOpenInventory: () => void;
  onOpenStockMovements: () => void;
  onOpenQuotations: () => void;
  onOpenInvoicing: () => void;
  onOpenCustomers: () => void;
  onOpenSalesSettings: () => void;
  onOpenStatements: () => void;
  onOpenBusinessOverview: () => void;
  onOpenTechAssessment: () => void;
  onOpenOutstandingRepairs: () => void;
  onOpenTaskCreationList: () => void;
  onOpenSalesOverview: () => void;
  onOpenInventoryOverview: () => void;
  onOpenInvoiceRegister: () => void;
  onOpenExpenseSlips: () => void;
  onOpenInventoryRegister: () => void;
  onOpenBanking: () => void;
  onOpenBankingStatement: () => void;
  onOpenChartOfAccounts: () => void;
  onOpenBusinessPlanning: () => void;
  onOpenEcommerceOperations: (orderNumber?: string) => void;
  onOpenEcommerceAnalytics?: () => void;
  onOpenWalkInSale?: () => void;
  onOpenJobCardSpares?: () => void;
  onCaptureExpenseSlip?: () => void;
  onOpenInvoiceScanner: () => void;
  onOpenPrinter: () => void;
  onOpenAIAssistant: () => void;
  onOpenActivityMonitor: () => void;
  onOpenWhatsAppLogs: () => void;
  onOpenEmail: () => void;
  onOpenEmailSettings: () => void;
  emailUnreadCount?: number;
  onOpenEcommerceSettings: () => void;
  onOpenEcommercePayments?: () => void;
  onOpenStoreDesign?: () => void;
  onOpenEcommerceBot?: () => void;
  onOpenIkhokhaJobSettings: () => void;
  onOpenJobSettings: () => void;
  onOpenSupervisorPassword: () => void;
  onOpenTaskLimitSettings?: () => void;
  onOpenFieldMapper: () => void;
  onShowTaskRecovery?: () => void;
  onFolderOverview?: (folderId: string) => void;
  onOpenActivityReports: () => void;
  onOpenStaffDashboard: () => void;
  onOpenDataSheets: () => void;
  isOwner: boolean;
  onChangePassword: () => void;
  onDropTask?: (taskId: string, listId: string) => void;
  onOpenNotifications: () => void;
  onOpenSetupWizard?: () => void;
  onOpenAuditLog?: () => void;
  onOpenWhatsAppMessenger?: () => void;
  whatsappUnreadCount?: number;
  onOpenWhatsAppDirect?: () => void;
  whatsappDirectUnreadCount?: number;
}

export function CrmSidebar({
  workspace, selectedListId, onSelectList,
  onCreateSpace, onCreateFolder, onCreateList,
  onRenameSpace, onRenameFolder, onRenameList,
  onDeleteSpace, onDeleteFolder, onDeleteList,
  onOpenCustomFields, onTaskStatuses, onOpenForms, onOpenAccounts,
  onSpaceOverview, onManagePermissions, onManageUsers, onManageWorkspaces, onOpenWhatsApp, onOpenPrinter, onOpenAIAssistant, onOpenActivityMonitor, onOpenWhatsAppLogs, onOpenEmail, onOpenEmailSettings, emailUnreadCount, onOpenEcommerceSettings, onOpenEcommercePayments, onOpenStoreDesign, onOpenEcommerceBot, onOpenIkhokhaJobSettings, onOpenJobSettings, onOpenSupervisorPassword, onOpenTaskLimitSettings, onOpenFieldMapper, onShowTaskRecovery, onFolderOverview, onOpenActivityReports, onOpenStaffDashboard, onOpenDataSheets, isOwner, onChangePassword, onOpenInventory, onOpenStockMovements, onOpenQuotations, onOpenInvoicing, onOpenCustomers, onOpenSalesSettings, onOpenStatements, onOpenBusinessOverview, onOpenTechAssessment, onOpenOutstandingRepairs, onOpenTaskCreationList, onOpenSalesOverview, onOpenInventoryOverview, onOpenInvoiceRegister, onOpenExpenseSlips, onOpenInventoryRegister, onOpenBanking, onOpenBankingStatement, onOpenChartOfAccounts, onOpenBusinessPlanning, onOpenEcommerceOperations, onOpenEcommerceAnalytics, onOpenWalkInSale, onOpenJobCardSpares, onCaptureExpenseSlip, onDropTask, onOpenNotifications, onOpenSetupWizard, onOpenAuditLog, onOpenWhatsAppMessenger, whatsappUnreadCount, onOpenWhatsAppDirect, whatsappDirectUnreadCount,
}: CrmSidebarProps) {
  const { state } = useSidebar();
  const {
    user, logout, myRole, isSystemAdmin, workspace: authWorkspace, members,
    accessPreviewMemberUid, stopAccessPreview, globalDisabledModules, planModules,
  } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const collapsed = state === "collapsed";
  const [expandedSpaces, setExpandedSpaces] = useState<Set<string>>(new Set(workspace.spaces.map(s => s.id)));
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(workspace.folders.map(f => f.id)));
  const knownSpaceIds = useRef(new Set(workspace.spaces.map(s => s.id)));
  const knownFolderIds = useRef(new Set(workspace.folders.map(f => f.id)));
  const [showAIBotWarning, setShowAIBotWarning] = useState(false);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);

  // Import state
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showImportOptions, setShowImportOptions] = useState(false);
  const [importOptions, setImportOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [zipContents, setZipContents] = useState<ZipContents | null>(null);
  const [zipPeeking, setZipPeeking] = useState(false);

  // Export state
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);

  // Get current user's permissions
  const currentMember = members.find(m => m.uid === user?.uid);
  const previewMember = (isOwner || isSystemAdmin)
    ? members.find(m => m.uid === accessPreviewMemberUid)
    : undefined;
  const effectiveMember = previewMember || currentMember;
  const userPermissions = effectiveMember?.permissions;
  
  // Helper to check if user has access to a permission
  const hasPermission = (permission: MenuPermission): boolean => {
    // If no permissions set, user has full access (owner/editor with all permissions)
    if (!userPermissions || userPermissions.length === 0) return true;
    return userPermissions.includes(permission);
  };

  // Auto-expand newly created folders/spaces
  useEffect(() => {
    const workspaceFolderIds = workspace.folders.map(f => f.id);
    const workspaceSpaceIds = workspace.spaces.map(s => s.id);

    const newFolders = workspaceFolderIds.filter(id => !knownFolderIds.current.has(id));
    const newSpaces = workspaceSpaceIds.filter(id => !knownSpaceIds.current.has(id));

    knownFolderIds.current = new Set(workspaceFolderIds);
    knownSpaceIds.current = new Set(workspaceSpaceIds);

    if (newFolders.length > 0 || newSpaces.length > 0) {
      setExpandedFolders(prev => {
        const next = new Set(prev);
        newFolders.forEach(id => next.add(id));
        return next;
      });
      setExpandedSpaces(prev => {
        const next = new Set(prev);
        newSpaces.forEach(id => next.add(id));
        return next;
      });
    }
  }, [workspace.folders, workspace.spaces]);
  
  // Resizable divider state
  const [crmHeight, setCrmHeight] = useState(() => {
    const saved = localStorage.getItem('crm-sidebar-split');
    return saved ? parseInt(saved, 10) : 350;
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  useEffect(() => {
    if (!isDragging) return;
    
    const onMove = (e: MouseEvent) => {
      const delta = e.clientY - dragStartY.current;
      const newHeight = Math.max(150, Math.min(600, dragStartHeight.current + delta));
      setCrmHeight(newHeight);
    };
    
    const onUp = () => {
      setIsDragging(false);
      localStorage.setItem('crm-sidebar-split', crmHeight.toString());
    };
    
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, crmHeight]);

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartHeight.current = crmHeight;
    setIsDragging(true);
  };

  // Prevent text selection while dragging
  useEffect(() => {
    if (isDragging) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
  }, [isDragging]);

  // Module visibility — three layers:
  //  • Plan tier: the workspace's plan only includes certain modules (configured
  //    in admin Billing → tier checkboxes). Modules outside the plan are hidden.
  //  • Per-business: workspace.hiddenFeatures hides a module for this one business.
  //  • Global ("in development"): globalDisabledModules hides a module for ALL
  //    client businesses, but ShopFlowz system admins still see it (DEV badge).
  // System admins bypass the plan + per-business layers entirely.
  const globalDisabled: string[] = globalDisabledModules ?? [];
  const hiddenFeatures: string[] = isSystemAdmin ? [] : (authWorkspace?.hiddenFeatures ?? []);
  const planKey: string = authWorkspace?.plan ?? "free";
  const planAllowed: string[] | undefined = planModules?.[planKey];

  // Is this module hidden for the current user?
  const moduleHidden = (key: string): boolean => {
    if (globalDisabled.includes(key)) return !isSystemAdmin; // in-dev: only system admins see it
    if (isSystemAdmin) return false;
    if (hiddenFeatures.includes(key)) return true;
    // Plan entitlement: hide modules not included in this workspace's plan.
    // Only enforce once we have a non-empty allowed list (avoids hiding everything
    // before plan data has loaded).
    if (planAllowed && planAllowed.length > 0 && !planAllowed.includes(key)) return true;
    return false;
  };
  // Module is globally in-development (only ever rendered for system admins).
  const moduleDev = (key: string): boolean => globalDisabled.includes(key);

  const showSales = !moduleHidden('sales');
  const showInventory = !moduleHidden('inventory');
  const showAnalytics = !moduleHidden('analytics');
  const showTechAssessment = !moduleHidden('tech_assessment');
  const showBankingFeature = !moduleHidden('banking');

  const toggleSpace = (id: string) => {
    setExpandedSpaces(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const toggleFolder = (id: string) => {
    setExpandedFolders(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const getFoldersForSpace = (spaceId: string) => workspace.folders.filter(f => f.spaceId === spaceId);
  const getListsForFolder = (folderId: string) => workspace.lists.filter(l => l.parentId === folderId && l.parentType === "folder");
  const getListsForSpace = (spaceId: string) => workspace.lists.filter(l => l.parentId === spaceId && l.parentType === "space");
  const getTaskCount = (listId: string) => workspace.tasks.filter(t => t.listId === listId && !t.archived).length;
  const getFolderTaskCount = (folderId: string) => {
    const listIds = new Set(getListsForFolder(folderId).map(l => l.id));
    return workspace.tasks.filter(t => listIds.has(t.listId) && !t.archived).length;
  };
  const getSpaceTaskCount = (spaceId: string) => {
    const folderIds = new Set(getFoldersForSpace(spaceId).map(f => f.id));
    const listIds = new Set(
      workspace.lists
        .filter(l => (l.parentType === "space" && l.parentId === spaceId) || (l.parentType === "folder" && folderIds.has(l.parentId)))
        .map(l => l.id)
    );
    return workspace.tasks.filter(t => listIds.has(t.listId) && !t.archived).length;
  };
  const getFormUrl = (formId: string) => `${window.location.origin}/form/${formId}`;
  const openForm = (formId: string) => window.open(getFormUrl(formId), "_blank", "noopener,noreferrer");
  
  // Export: show options dialog first
  const handleExport = () => {
    if (!authWorkspace?.id) return;
    setExportOptions(DEFAULT_EXPORT_OPTIONS);
    setShowExportOptions(true);
  };

  const handleExportConfirm = async () => {
    if (!authWorkspace?.id) return;
    setShowExportOptions(false);
    setExportProgress({ phase: "Starting export…", current: 0 });
    try {
      await exportWorkspaceToZip(authWorkspace.id, authWorkspace.name || "workspace", setExportProgress, exportOptions);
    } catch (err) {
      setExportProgress({ phase: `Error: ${String(err)}`, current: 0 });
    }
  };

  // Import: peek ZIP contents, then show options dialog
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !authWorkspace?.id) return;
    e.target.value = "";

    setZipPeeking(true);
    try {
      const contents = await peekZipContents(file);
      setZipContents(contents);
      setPendingImportFile(file);
      // Pre-tick only sections present in the ZIP
      setImportOptions({
        workspaceState: contents.hasWorkspaceState,
        inventory:      contents.hasInventory,
        sales:          contents.hasSales,
        customers:      contents.hasCustomers,
        orders:         contents.hasOrders,
        forms:          contents.hasForms,
        settings:       contents.hasSettings,
        datasheets:     contents.hasDatasheets,
        documents:      contents.hasDocuments,
        photos:         false,
      });
      setShowImportOptions(true);
    } catch (err) {
      setImportResult({ imported: {}, skipped: [], errors: [`Could not read ZIP: ${String(err)}`] });
    } finally {
      setZipPeeking(false);
    }
  };

  const handleImportConfirm = async () => {
    if (!pendingImportFile || !authWorkspace?.id) return;
    setShowImportOptions(false);
    setImportResult(null);
    setImportProgress({ phase: "Starting import…", current: 0, errors: [] });
    try {
      const result = await importWorkspaceFromZip(pendingImportFile, authWorkspace.id, setImportProgress, importOptions);
      setImportResult(result);
    } catch (err) {
      setImportProgress(null);
      setImportResult({ imported: {}, skipped: [], errors: [String(err)] });
    } finally {
      setPendingImportFile(null);
    }
  };

  // Special function for counting tasks without photos
  const getJobsWithIssuesCount = () => {
    return workspace.tasks.filter(t => 
      !t.archived && 
      (!t.photos || t.photos.length === 0)
    ).length;
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border mobile-sidebar bg-sidebar text-sidebar-foreground flex flex-col h-screen">
      {/* ── Workspace Header ───────────────────────────────────── */}
      <SidebarHeader className="border-b border-sidebar-border px-3 py-3 bg-sidebar flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center shrink-0">
            <span className="text-primary-foreground text-xs font-bold">W</span>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate block text-sidebar-foreground">Workspace</span>
                {myRole && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 bg-sidebar-accent text-sidebar-foreground/80">
                    {myRole}
                  </Badge>
                )}
              </div>
              {user && <span className="text-xs text-sidebar-foreground/60 truncate block">{user.email}</span>}
              <button
                onClick={toggleTheme}
                className="mt-1 flex items-center gap-1.5 text-[11px] text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
                title={theme === "dark" ? "Switch to light mode" : theme === "light" ? "Switch to mixed mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? <Sun className="h-3 w-3" /> : theme === "light" ? <SunMoon className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
                {theme === "dark" ? "Light mode" : theme === "light" ? "Mixed mode" : "Dark mode"}
              </button>
            </div>
          )}
          {collapsed && (
            <button
              onClick={toggleTheme}
              className="mt-1 flex items-center justify-center text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
              title={theme === "dark" ? "Switch to light mode" : theme === "light" ? "Switch to mixed mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : theme === "light" ? <SunMoon className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </SidebarHeader>

      {/* ── SWITCH TO STORE BUTTON ─────────────────────────────── */}
      {previewMember && (
        <div className="px-2 pt-2 flex-shrink-0">
          <div className={cn(
            "rounded-md border border-emerald-700/70 bg-emerald-950/70 text-emerald-100",
            collapsed ? "p-1" : "px-2 py-2"
          )}>
            {!collapsed && (
              <>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">Viewing As</div>
                <div className="mt-0.5 truncate text-xs">{previewMember.displayName || previewMember.email}</div>
              </>
            )}
            <button
              onClick={stopAccessPreview}
              className={cn(
                "flex w-full items-center justify-center gap-1 rounded bg-emerald-700 text-xs font-medium text-white hover:bg-emerald-600",
                collapsed ? "h-7 w-7" : "mt-2 px-2 py-1"
              )}
              title="Exit user preview"
            >
              <EyeOff className="h-3 w-3" />
              {!collapsed && "Exit Preview"}
            </button>
          </div>
        </div>
      )}

      <div className="px-2 pt-2 pb-0 flex-shrink-0">
        {(() => {
          // Open the store on the SAME origin as the CRM so the owner's login
          // session carries over (enabling the "Back to Dashboard" button on the
          // store). Custom domains are a separate public origin by design.
          const storeUrl = authWorkspace?.customDomainEnabled && authWorkspace?.customDomain
            ? `https://${authWorkspace.customDomain}?admin=1`
            : authWorkspace?.storeSlug
              ? `${window.location.origin}/store/${authWorkspace.storeSlug}?admin=1`
              : null;
          return storeUrl ? (
            <a
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open my live ecommerce store"
              className={cn(
                "flex items-center justify-center gap-2 w-full rounded-md text-white font-bold transition-all shadow-lg hover:shadow-green-500/30 hover:scale-[1.02]",
                "bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 hover:from-green-400 hover:via-emerald-400 hover:to-teal-400",
                collapsed ? "h-9 w-9 mx-auto" : "px-3 py-2 text-sm"
              )}
            >
              <Store className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="whitespace-nowrap">My Live Store</span>}
            </a>
          ) : null;
        })()}
      </div>

      <div
        className="px-2 py-0 flex-shrink-0"
        style={{
          height: `${crmHeight}px`,
          minHeight: '150px',
          maxHeight: '600px',
          overflow: 'auto'
        }}
      >
        {/* ── CRM Section ─────────────────────────────────────────── */}
        {hasPermission("crm") && !moduleHidden("crm") && (
          <>
            <SectionHeader label="CRM" collapsed={collapsed} dev={moduleDev("crm")}>
              <button onClick={onCreateSpace} className="p-0.5 rounded hover:bg-sidebar-accent" title="New Space">
                <Plus className="h-3 w-3 text-sidebar-foreground/60" />
              </button>
            </SectionHeader>

          <SidebarMenu className="pb-2">
          {/* Tasks with Issues */}
          <div className="pb-1 mb-1 border-b border-sidebar-border/60">
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => { onSelectList(JOBS_WITH_ISSUES_SPACE_ID); }}
                className={cn(
                  "group hover:bg-sidebar-accent rounded-md text-sidebar-foreground",
                  selectedListId === JOBS_WITH_ISSUES_SPACE_ID && "bg-sidebar-accent"
                )}
              >
                <div className="flex items-center gap-2 w-full">
                  <span className="text-sm">⚠️</span>
                  {!collapsed && (
                    <>
                      <span className="text-sm font-medium truncate flex-1 text-orange-400">Tasks with Issues</span>
                      <Badge variant="outline" className="text-xs px-1.5 py-0.5 text-orange-400 border-orange-700">
                        {getJobsWithIssuesCount()}
                      </Badge>
                    </>
                  )}
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {workspace.forms.length > 0 && (
              <SidebarMenuItem>
                {workspace.forms.length === 1 ? (
                  <SidebarMenuButton
                    onClick={() => openForm(workspace.forms[0].id)}
                    className="group hover:bg-emerald-900/40 rounded-md text-emerald-300"
                    title="Create a task"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <ExternalLink className="h-4 w-4 shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="text-sm font-medium truncate flex-1">Create a Task</span>
                          <span className="text-[10px] text-emerald-400 truncate max-w-24">
                            {workspace.forms[0].name}
                          </span>
                        </>
                      )}
                    </div>
                  </SidebarMenuButton>
                ) : (
                  <FlyoutGroup
                    icon={<ExternalLink className="h-4 w-4 shrink-0 text-emerald-400" />}
                    label="Create a Task"
                    collapsed={collapsed}
                    dark
                  >
                    {workspace.forms.map((form) => (
                      <FlyoutItem
                        key={form.id}
                        icon={<FileText className="h-4 w-4 text-emerald-400" />}
                        label={form.name}
                        onClick={() => openForm(form.id)}
                      />
                    ))}
                  </FlyoutGroup>
                )}
              </SidebarMenuItem>
            )}

            {/* Staff Dashboard — quick-access home view */}
            <div className="rounded-md ring-1 ring-violet-500/60 my-0.5" style={{ animation: "neonViolet 2.4s ease-in-out infinite" }}>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={onOpenStaffDashboard}
                  className="group hover:bg-violet-900/40 rounded-md text-violet-200 font-semibold"
                  title="Staff Dashboard"
                >
                  <div className="flex items-center gap-2 w-full">
                    <BarChart2 className="h-4 w-4 shrink-0 text-violet-400" />
                    {!collapsed && (
                      <span className="text-sm font-semibold truncate flex-1">Staff Dashboard</span>
                    )}
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </div>

            {/* Walk-in Sale — counter sale shortcut */}
            {onOpenWalkInSale && (
              <div className="rounded-md ring-1 ring-amber-400/60 my-0.5" style={{ animation: "neonAmber 2s ease-in-out infinite" }}>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={onOpenWalkInSale}
                    className="group hover:bg-amber-900/40 rounded-md text-amber-200 font-semibold"
                    title="Open the store in walk-in sale mode"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <ShoppingBagIcon className="h-4 w-4 shrink-0 text-amber-400" />
                      {!collapsed && (
                        <>
                          <span className="text-sm font-semibold truncate flex-1">Walk-in Sale</span>
                          <span className="text-[10px] text-amber-400 truncate max-w-24">counter</span>
                        </>
                      )}
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </div>
            )}

            {/* Job Card Spares — book spare parts out of stock against a job number */}
            {onOpenJobCardSpares && (
              <div className="rounded-md ring-1 ring-cyan-400/60 my-0.5" style={{ animation: "neonCyan 2.8s ease-in-out infinite" }}>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={onOpenJobCardSpares}
                    className="group hover:bg-cyan-900/40 rounded-md text-cyan-200 font-semibold"
                    title="Book spare parts out of stock for a job card"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <Wrench className="h-4 w-4 shrink-0 text-cyan-400" />
                      {!collapsed && (
                        <>
                          <span className="text-sm font-semibold truncate flex-1">Job Card Spares</span>
                          <span className="text-[10px] text-cyan-400 truncate max-w-24">book out</span>
                        </>
                      )}
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </div>
            )}

            {/* Take Photo of Slip — quick capture shortcut, opens camera */}
            {onCaptureExpenseSlip && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={onCaptureExpenseSlip}
                  className="group hover:bg-pink-900/30 rounded-md text-pink-200"
                  title="Snap a slip and auto-extract the data"
                >
                  <div className="flex items-center gap-2 w-full">
                    <div className="h-6 w-6 rounded-md bg-pink-500/20 flex items-center justify-center shrink-0">
                      <Camera className="h-3.5 w-3.5 text-pink-400" />
                    </div>
                    {!collapsed && (
                      <>
                        <span className="text-sm font-medium truncate flex-1">Take Photo of Slip</span>
                        <span className="text-[10px] text-pink-400 truncate max-w-24">scan</span>
                      </>
                    )}
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </div>

          {workspace.spaces.map((space) => (
            <div key={space.id}>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => toggleSpace(space.id)}
                  className="group hover:bg-sidebar-accent rounded-md text-sidebar-foreground"
                >
                  <div className="flex items-center gap-2 w-full">
                    {expandedSpaces.has(space.id) ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
                    )}
                    <span className="text-sm">{space.icon}</span>
	                    {!collapsed && (
	                      <>
	                        <span className="text-sm font-medium truncate flex-1 text-sidebar-foreground">{space.name}</span>
	                        {getSpaceTaskCount(space.id) > 0 && (
	                          <span className="text-sm font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
	                            {getSpaceTaskCount(space.id)}
	                          </span>
	                        )}
	                        <div className="flex gap-0.5">
                          <button onClick={(e) => { e.stopPropagation(); onSpaceOverview(space.id); }} className="p-0.5 rounded hover:bg-sidebar-accent" title="Space Overview">
                            <BarChart3 className="h-3 w-3 text-sidebar-foreground/60" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); onCreateFolder(space.id); }} className="p-0.5 rounded hover:bg-sidebar-accent" title="Create Folder">
                            <Plus className="h-3 w-3 text-sidebar-foreground/60" />
                          </button>
                          {onManagePermissions && (
                            <button onClick={(e) => { e.stopPropagation(); onManagePermissions(space.id, "space"); }} className="p-0.5 rounded hover:bg-sidebar-accent" title="Manage permissions">
                              <Lock className="h-3 w-3 text-sidebar-foreground/60" />
                            </button>
                          )}
                          <ItemContextMenu
                            itemType="space" itemName={space.name}
                            onRename={(name) => onRenameSpace(space.id, name)}
                            onDelete={() => onDeleteSpace(space.id)}
                            onCustomFields={() => onOpenCustomFields(space.id, "space")}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {expandedSpaces.has(space.id) && (
                <div className="ml-3">
                  {getListsForSpace(space.id).map((list) => (
                    <ListItem
                      key={list.id} list={list} count={getTaskCount(list.id)}
                      selected={selectedListId === list.id} onClick={() => onSelectList(list.id)}
                      collapsed={collapsed}
                      onRename={(name) => onRenameList(list.id, name)}
                      onDelete={() => onDeleteList(list.id)}
                      onCustomFields={() => onOpenCustomFields(list.id, "list")}
                      onTaskStatuses={() => onTaskStatuses(list.id)}
                      onManagePermissions={onManagePermissions ? () => onManagePermissions(list.id, "list") : undefined}
                      onDropTask={onDropTask ? (taskId) => onDropTask(taskId, list.id) : undefined}
                    />
                  ))}

	                  {getFoldersForSpace(space.id).map((folder) => (
	                    <div key={folder.id}>
	                      <SidebarMenuItem>
	                        <SidebarMenuButton onClick={() => toggleFolder(folder.id)} className="group hover:bg-sidebar-accent rounded-md text-sidebar-foreground">
                          <div className="flex items-center gap-2 w-full">
                            {expandedFolders.has(folder.id) ? (
                              <ChevronDown className="h-3 w-3 shrink-0 text-sidebar-foreground/60" />
                            ) : (
                              <ChevronRight className="h-3 w-3 shrink-0 text-sidebar-foreground/60" />
                            )}
                            <FolderIcon className="h-3.5 w-3.5 shrink-0" style={{ color: folder.color || "#f59e0b" }} />
                            {!collapsed && (
	                              <>
	                                <span className="text-sm truncate flex-1 text-sidebar-foreground hover:text-white"
	                                  onClick={(e) => { e.stopPropagation(); onFolderOverview?.(folder.id); }}
	                                >{folder.name}</span>
	                                {getFolderTaskCount(folder.id) > 0 && (
	                                  <span className="text-sm font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
	                                    {getFolderTaskCount(folder.id)}
	                                  </span>
	                                )}
	                                <div className="flex gap-0.5">
                                  <button onClick={(e) => { e.stopPropagation(); onCreateList(folder.id, "folder"); }} className="p-0.5 rounded hover:bg-sidebar-accent">
                                    <Plus className="h-3 w-3 text-sidebar-foreground/60" />
                                  </button>
                                  {onManagePermissions && (
                                    <button onClick={(e) => { e.stopPropagation(); onManagePermissions(folder.id, "folder"); }} className="p-0.5 rounded hover:bg-sidebar-accent" title="Manage permissions">
                                      <Lock className="h-3 w-3 text-sidebar-foreground/60" />
                                    </button>
                                  )}
                                  <ItemContextMenu
                                    itemType="folder" itemName={folder.name}
                                    onRename={(name) => onRenameFolder(folder.id, name)}
                                    onDelete={() => onDeleteFolder(folder.id)}
                                    onCustomFields={() => onOpenCustomFields(folder.id, "folder")}
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        </SidebarMenuButton>
                      </SidebarMenuItem>

                      {expandedFolders.has(folder.id) && (
                        <div className="ml-3">
                          {getListsForFolder(folder.id).map((list) => (
                            <ListItem
                              key={list.id} list={list} count={getTaskCount(list.id)}
                              selected={selectedListId === list.id} onClick={() => onSelectList(list.id)}
                              collapsed={collapsed}
                              onRename={(name) => onRenameList(list.id, name)}
                              onDelete={() => onDeleteList(list.id)}
                              onCustomFields={() => onOpenCustomFields(list.id, "list")}
                              onTaskStatuses={() => onTaskStatuses(list.id)}
                              onManagePermissions={onManagePermissions ? () => onManagePermissions(list.id, "list") : undefined}
                              onDropTask={onDropTask ? (taskId) => onDropTask(taskId, list.id) : undefined}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </SidebarMenu>
        </>
        )}
      </div>

      {/* ── Resizable Divider ────────────────────────────────────── */}
      <div 
        onMouseDown={handleDragStart}
        className={cn(
          "h-1 bg-sidebar-accent hover:bg-blue-500 cursor-ns-resize transition-colors relative group flex-shrink-0",
          isDragging && "bg-blue-500"
        )}
        title="Drag to resize CRM section"
      >
        <div className="absolute inset-x-0 -top-1 -bottom-1" /> {/* Larger hit area */}
        <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-8 h-0.5 bg-sidebar-foreground/30 group-hover:bg-blue-400 rounded-full" />
      </div>

      {/* ── Footer sections ────────────────────────────────────── */}
      <SidebarFooter className="p-0 bg-sidebar flex-1 overflow-auto">
        <SidebarMenu className="p-2 space-y-0.5">

          {/* ── Sales & Invoicing ── */}
          {showSales && hasPermission("customers") && (
            <>
              <SectionHeader label="Sales & Invoicing" collapsed={collapsed} dev={moduleDev("sales")} />
              <FlyoutGroup
                icon={<DollarSign className="h-4 w-4 shrink-0 text-blue-400" />}
                label="Sales & Invoicing"
                collapsed={collapsed}
                dark
                dev={moduleDev("sales")}
                onHeaderClick={onOpenSalesOverview}
              >
                {hasPermission("customers") && <FlyoutItem icon={<Users className="h-4 w-4 text-blue-400" />} label="Customers" onClick={onOpenCustomers} />}
                {hasPermission("quotations") && <FlyoutItem icon={<FileSpreadsheet className="h-4 w-4 text-indigo-400" />} label="Quotations" onClick={onOpenQuotations} />}
                {hasPermission("invoices") && <FlyoutItem icon={<Receipt className="h-4 w-4 text-purple-400" />} label="Invoices" onClick={onOpenInvoicing} />}
                {hasPermission("invoices") && <FlyoutItem icon={<Camera className="h-4 w-4 text-pink-400" />} label="Expense Slips" onClick={onOpenExpenseSlips} />}
                {hasPermission("invoices") && <FlyoutItem icon={<TableProperties className="h-4 w-4 text-purple-300" />} label="Invoice Register" onClick={onOpenInvoiceRegister} />}
                {hasPermission("invoices") && <FlyoutItem icon={<FileText className="h-4 w-4 text-teal-400" />} label="Statements" onClick={onOpenStatements} />}
                {hasPermission("invoices") && <FlyoutItem icon={<Landmark className="h-4 w-4 text-emerald-400" />} label="Banking" onClick={onOpenBankingStatement} />}
                {hasPermission("invoices") && <FlyoutItem icon={<BookOpen className="h-4 w-4 text-blue-400" />} label="Chart of Accounts" onClick={onOpenChartOfAccounts} />}
                {hasPermission("settings") && <FlyoutItem icon={<Settings className="h-4 w-4 text-sidebar-foreground/60" />} label="Sales Settings" onClick={onOpenSalesSettings} />}
              </FlyoutGroup>
            </>
          )}

          {/* ── Notifications ── */}
          <SidebarMenuItem>
            <NotificationsBell
              collapsed={collapsed}
              onOpenLink={(link) => { if (link?.startsWith("ecommerce")) { const orderNumber = link.includes(":") ? link.split(":")[1] : undefined; onOpenEcommerceOperations(orderNumber); } }}
            />
          </SidebarMenuItem>

          {/* ── Email ── */}
          {!moduleHidden("email") && (
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onOpenEmail}
              className="group hover:bg-blue-900/30 rounded-md text-blue-200"
              title="Open your email inbox"
            >
              <div className="flex items-center gap-2 w-full">
                <div className="relative shrink-0 h-6 w-6 rounded-md bg-blue-500/20 flex items-center justify-center">
                  <Mail className="h-3.5 w-3.5 text-blue-400" />
                  {(emailUnreadCount ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                    </span>
                  )}
                </div>
                {!collapsed && (
                  <>
                    <span className="text-sm font-medium truncate flex-1 flex items-center gap-1.5">Email {moduleDev("email") && <DevBadge />}</span>
                    {(emailUnreadCount ?? 0) > 0 && (
                      <span className="ml-auto text-xs font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none">
                        {emailUnreadCount! > 99 ? "99+" : emailUnreadCount}
                      </span>
                    )}
                  </>
                )}
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          )}

          {/* ── WhatsApp Messenger ── */}
          {hasPermission("whatsapp") && !moduleHidden("whatsapp") && onOpenWhatsAppMessenger && (
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onOpenWhatsAppMessenger}
              className="group hover:bg-green-900/30 rounded-md text-green-200"
              title="WhatsApp Messenger — team inbox"
            >
              <div className="flex items-center gap-2 w-full">
                <div className="relative shrink-0 h-6 w-6 rounded-md bg-green-500/20 flex items-center justify-center">
                  <MessageSquare className="h-3.5 w-3.5 text-green-400" />
                  {(whatsappUnreadCount ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                    </span>
                  )}
                </div>
                {!collapsed && (
                  <>
                    <span className="text-sm font-medium truncate flex-1">WhatsApp Messenger</span>
                    {(whatsappUnreadCount ?? 0) > 0 && (
                      <span className="ml-auto text-xs font-bold bg-green-500 text-white rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none">
                        {(whatsappUnreadCount ?? 0) > 99 ? "99+" : whatsappUnreadCount}
                      </span>
                    )}
                  </>
                )}
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          )}

          {/* ── WhatsApp Second Number ── */}
          {hasPermission("whatsapp") && !moduleHidden("whatsapp") && onOpenWhatsAppDirect && (
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onOpenWhatsAppDirect}
              className="group hover:bg-emerald-900/30 rounded-md text-emerald-200"
              title="WhatsApp 2 — second official WhatsApp Business number"
            >
              <div className="flex items-center gap-2 w-full">
                <div className="relative shrink-0 h-6 w-6 rounded-md bg-emerald-500/20 flex items-center justify-center">
                  <MessageCircle className="h-3.5 w-3.5 text-emerald-400" />
                  {(whatsappDirectUnreadCount ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-600" />
                    </span>
                  )}
                </div>
                {!collapsed && (
                  <>
                    <span className="text-sm font-medium truncate flex-1">WhatsApp 2</span>
                    {(whatsappDirectUnreadCount ?? 0) > 0 && (
                      <span className="ml-auto text-xs font-bold bg-emerald-600 text-white rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none">
                        {(whatsappDirectUnreadCount ?? 0) > 99 ? "99+" : whatsappDirectUnreadCount}
                      </span>
                    )}
                  </>
                )}
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          )}

          {/* ── Ecommerce ── */}
          {!moduleHidden("ecommerce") && (
          <>
          <SectionHeader label="Ecommerce" collapsed={collapsed} dev={moduleDev("ecommerce")} />
          <FlyoutGroup
            icon={<Store className="h-4 w-4 shrink-0 text-orange-400" />}
            label="Ecommerce"
            collapsed={collapsed}
            dark
            dev={moduleDev("ecommerce")}
            onHeaderClick={() => onOpenEcommerceOperations()}
          >
            <FlyoutItem icon={<Users className="h-4 w-4 text-blue-400" />} label="Clients" onClick={() => onOpenEcommerceOperations()} />
            <FlyoutItem icon={<ShoppingBagIcon className="h-4 w-4 text-orange-400" />} label="Orders" onClick={() => onOpenEcommerceOperations()} />
            <FlyoutItem icon={<Package className="h-4 w-4 text-blue-400" />} label="Picking Slips" onClick={() => onOpenEcommerceOperations()} />
            <FlyoutItem icon={<Receipt className="h-4 w-4 text-green-400" />} label="Ready / Collected" onClick={() => onOpenEcommerceOperations()} />
          </FlyoutGroup>
          <EcommerceNotificationsBell collapsed={collapsed} onOpenLink={(link) => {
            const orderNumber = link?.startsWith("ecommerce:") ? link.slice("ecommerce:".length) : undefined;
            onOpenEcommerceOperations(orderNumber);
          }} />
          {onOpenEcommerceAnalytics && (
            <button
              onClick={onOpenEcommerceAnalytics}
              className={cn("group flex items-center gap-2 w-full rounded-md px-2 py-2 text-teal-200 hover:bg-teal-900/30 transition-colors", collapsed && "justify-center")}
            >
              <div className="h-6 w-6 rounded-md bg-teal-500/20 flex items-center justify-center shrink-0">
                <BarChart2 className="h-3.5 w-3.5 text-teal-400" />
              </div>
              {!collapsed && <span className="text-sm font-medium">Store Analytics</span>}
            </button>
          )}
          <button
            onClick={onOpenEcommerceSettings}
            className={cn("group flex items-center gap-2 w-full rounded-md px-2 py-2 text-orange-200 hover:bg-orange-900/30 transition-colors", collapsed && "justify-center")}
          >
            <div className="h-6 w-6 rounded-md bg-orange-500/20 flex items-center justify-center shrink-0">
              <Settings className="h-3.5 w-3.5 text-orange-400" />
            </div>
            {!collapsed && <span className="text-sm font-medium">Ecommerce Settings</span>}
          </button>
          </>
          )}

          {/* ── Inventory ── */}
          {showInventory && hasPermission("inventory") && (
            <>
              <SectionHeader label="Inventory" collapsed={collapsed} dev={moduleDev("inventory")} />
              <FlyoutGroup
                icon={<Package className="h-4 w-4 shrink-0 text-orange-400" />}
                label="Inventory"
                collapsed={collapsed}
                dark
                dev={moduleDev("inventory")}
                onHeaderClick={onOpenInventoryOverview}
              >
                <FlyoutItem icon={<Package className="h-4 w-4 text-orange-400" />} label="Products" onClick={onOpenInventory} />
                <FlyoutItem icon={<TableProperties className="h-4 w-4 text-orange-300" />} label="Inventory Register" onClick={onOpenInventoryRegister} />
                <FlyoutItem icon={<TrendingUp className="h-4 w-4 text-teal-400" />} label="Stock Updates" onClick={onOpenStockMovements} />
              </FlyoutGroup>
            </>
          )}

          {/* ── Banking & Matching ── */}
          {showBankingFeature && hasPermission("banking") && (
            <>
              <SectionHeader label="Banking & Matching" collapsed={collapsed} dev={moduleDev("banking")} />
              <FlyoutGroup
                icon={<Landmark className="h-4 w-4 shrink-0 text-emerald-500" />}
                label="Banking & Matching"
                collapsed={collapsed}
                dark
                dev={moduleDev("banking")}
                onHeaderClick={onOpenBanking}
              >
                <FlyoutItem icon={<ArrowLeftRight className="h-4 w-4 text-emerald-400" />} label="Transaction Feed" onClick={onOpenBanking} />
              </FlyoutGroup>
            </>
          )}

          {/* ── Business Planning ── */}
          {hasPermission("business_planning") && !moduleHidden("business_planning") && (
            <>
              <SectionHeader label="Business Planning" collapsed={collapsed} dev={moduleDev("business_planning")} />
              <FlyoutGroup
                icon={<TrendingUp className="h-4 w-4 shrink-0 text-violet-400" />}
                label="Business Planning"
                collapsed={collapsed}
                dark
                dev={moduleDev("business_planning")}
                onHeaderClick={onOpenBusinessPlanning}
              >
                <FlyoutItem icon={<TrendingUp className="h-4 w-4 text-violet-400" />} label="Expenses & Income" onClick={onOpenBusinessPlanning} />
                <FlyoutItem icon={<Users className="h-4 w-4 text-blue-400" />} label="CRM" onClick={() => { onOpenBusinessPlanning(); }} />
                <FlyoutItem icon={<Package className="h-4 w-4 text-amber-400" />} label="Inventory" onClick={() => { onOpenBusinessPlanning(); onOpenInventory(); }} />
                <FlyoutItem icon={<Receipt className="h-4 w-4 text-green-400" />} label="Invoicing" onClick={() => { onOpenBusinessPlanning(); onOpenInvoicing(); }} />
                <FlyoutItem icon={<FileSpreadsheet className="h-4 w-4 text-teal-400" />} label="Quotations" onClick={() => { onOpenBusinessPlanning(); onOpenQuotations(); }} />
                <FlyoutItem icon={<Landmark className="h-4 w-4 text-indigo-400" />} label="Banking" onClick={() => { onOpenBusinessPlanning(); onOpenBanking(); }} />
                <FlyoutItem icon={<DollarSign className="h-4 w-4 text-emerald-400" />} label="Accounts" onClick={() => { onOpenBusinessPlanning(); onOpenAccounts(); }} />
              </FlyoutGroup>
            </>
          )}

          {/* ── Analytics - Business Performance ── */}
          {showAnalytics && hasPermission("analytics_business") && (
            <FlyoutGroup
              icon={<BarChart2 className="h-4 w-4 shrink-0 text-cyan-400" />}
              label="Business Performance"
              collapsed={collapsed}
              dark
              dev={moduleDev("analytics")}
              onHeaderClick={onOpenBusinessOverview}
            >
              <FlyoutItem icon={<BarChart2 className="h-4 w-4 text-cyan-400" />} label="Business Performance" onClick={onOpenBusinessOverview} />
            </FlyoutGroup>
          )}

          {/* ── Tech Assessment ── */}
          {(isSystemAdmin || authWorkspace?.hasCrmAccess) && showTechAssessment && hasPermission("tech_assessment") && (
            <FlyoutGroup
              icon={<Wrench className="h-4 w-4 shrink-0 text-indigo-400" />}
              label="Tech Assessment"
              collapsed={collapsed}
              dark
              dev={moduleDev("tech_assessment")}
              onHeaderClick={onOpenTechAssessment}
            >
              <FlyoutItem icon={<Wrench className="h-4 w-4 text-indigo-400" />} label="Tech Assessment" onClick={onOpenTechAssessment} />
            </FlyoutGroup>
          )}

          {/* ── Tech Data Sheets ── */}
          {hasPermission("tech_datasheets") && !moduleHidden("tech_datasheets") && (
            <FlyoutGroup
              icon={<FolderOpen className="h-4 w-4 shrink-0 text-amber-400" />}
              label="Tech Data Sheets"
              collapsed={collapsed}
              dark
              dev={moduleDev("tech_datasheets")}
              onHeaderClick={onOpenDataSheets}
            >
              <FlyoutItem icon={<FolderOpen className="h-4 w-4 text-amber-400" />} label="Data Sheets" onClick={onOpenDataSheets} />
            </FlyoutGroup>
          )}

          {/* ── AI Bot Warnings ── */}
          {(isSystemAdmin || isOwner) && hasPermission("warnings") && !moduleHidden("ai_bot_warnings") && (
            <FlyoutGroup
              icon={<Bot className="h-4 w-4 shrink-0 text-purple-400" />}
              label="AI Bot Warnings"
              collapsed={collapsed}
              dark
              dev={moduleDev("ai_bot_warnings")}
              onHeaderClick={() => setShowAIBotWarning(true)}
            >
              <FlyoutItem icon={<Bot className="h-4 w-4 text-purple-400" />} label="Configure Warnings" onClick={() => setShowAIBotWarning(true)} />
            </FlyoutGroup>
          )}

          {/* ── AI Assistant ── */}
          {!moduleHidden("ai_assistant") && (
          <FlyoutGroup
            icon={<Sparkles className="h-4 w-4 shrink-0 text-violet-400" />}
            label="AI Assistant"
            collapsed={collapsed}
            dark
            dev={moduleDev("ai_assistant")}
            onHeaderClick={onOpenAIAssistant}
          >
            <FlyoutItem icon={<Sparkles className="h-4 w-4 text-violet-400" />} label="Chat with AI" onClick={onOpenAIAssistant} />
          </FlyoutGroup>
          )}

          {/* ── Activity Reports ── */}
          {hasPermission("analytics_staff") && !moduleHidden("staff_reports") && (
            <FlyoutGroup
              icon={<Activity className="h-4 w-4 shrink-0 text-indigo-400" />}
              label="Staff Reports"
              collapsed={collapsed}
              dark
              dev={moduleDev("staff_reports")}
              onHeaderClick={onOpenActivityReports}
            >
              <FlyoutItem icon={<Activity className="h-4 w-4 text-indigo-400" />} label="Staff Reports" onClick={onOpenActivityReports} />
            </FlyoutGroup>
          )}
          {hasPermission("analytics_performance") && !moduleHidden("performance_analytics") && (
            <FlyoutGroup
              icon={<PieChart className="h-4 w-4 shrink-0 text-green-400" />}
              label="Performance Analytics"
              collapsed={collapsed}
              dark
              dev={moduleDev("performance_analytics")}
              onHeaderClick={onOpenActivityReports}
            >
              <FlyoutItem icon={<PieChart className="h-4 w-4 text-green-400" />} label="Performance Analytics" onClick={onOpenActivityReports} />
            </FlyoutGroup>
          )}

          {/* ── Outstanding Tasks Assessment ── */}
          {hasPermission("outstanding_repairs") && !moduleHidden("outstanding_tasks") && (
            <FlyoutGroup
              icon={<AlertCircle className="h-4 w-4 shrink-0 text-orange-400" />}
              label="Outstanding Tasks"
              collapsed={collapsed}
              dark
              dev={moduleDev("outstanding_tasks")}
              onHeaderClick={onOpenOutstandingRepairs}
            >
              <FlyoutItem icon={<AlertCircle className="h-4 w-4 text-orange-400" />} label="Outstanding Tasks" onClick={onOpenOutstandingRepairs} />
            </FlyoutGroup>
          )}

          {/* ── Job Register ── */}
          {!moduleHidden("job_register") && (
          <FlyoutGroup
            icon={<TableProperties className="h-4 w-4 shrink-0 text-indigo-400" />}
            label="Job Register"
            collapsed={collapsed}
            dark
            dev={moduleDev("job_register")}
            onHeaderClick={onOpenTaskCreationList}
          >
            <FlyoutItem icon={<TableProperties className="h-4 w-4 text-indigo-400" />} label="Job Register" onClick={onOpenTaskCreationList} />
          </FlyoutGroup>
          )}

          {/* ── Settings ── */}
          {hasPermission("settings") && !moduleHidden("settings") && (
            <>
              <SectionHeader label="Settings" collapsed={collapsed} dev={moduleDev("settings")} />
              <FlyoutGroup
                icon={<Settings className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />}
                label="Settings"
                collapsed={collapsed}
                dark
                dev={moduleDev("settings")}
              >
                {hasPermission("whatsapp") && !moduleHidden("whatsapp") && <FlyoutItem icon={<MessageSquare className="h-4 w-4 text-green-400" />} label="WhatsApp" onClick={onOpenWhatsApp} />}
                {hasPermission("whatsapp") && !moduleHidden("whatsapp") && <FlyoutItem icon={<Clock className="h-4 w-4 text-green-300" />} label="WA Logs" onClick={onOpenWhatsAppLogs} />}
                {hasPermission("printer") && !moduleHidden("printer") && <FlyoutItem icon={<Printer className="h-4 w-4 text-blue-400" />} label="Printer" onClick={onOpenPrinter} />}
                <FlyoutItem icon={<Clock className="h-4 w-4 text-sidebar-foreground/60" />} label="Activity" onClick={onOpenActivityMonitor} />
                {(isSystemAdmin || isOwner) && onOpenAuditLog && <FlyoutItem icon={<ShieldAlert className="h-4 w-4 text-indigo-400" />} label="Audit Log" onClick={onOpenAuditLog} />}
                <FlyoutItem icon={<FileText className="h-4 w-4 text-sidebar-foreground/60" />} label="Forms" onClick={onOpenForms} />
                <FlyoutItem icon={<DollarSign className="h-4 w-4 text-sidebar-foreground/60" />} label="Accounts" onClick={onOpenAccounts} />
                <FlyoutItem icon={<Mail className="h-4 w-4 text-sidebar-foreground/60" />} label="Email Settings" onClick={onOpenEmailSettings} />
                <FlyoutItem icon={<Bell className="h-4 w-4 text-yellow-400" />} label="Notifications" onClick={onOpenNotifications} />
                <FlyoutItem icon={<KeyRound className="h-4 w-4 text-emerald-400" />} label="Supervisor Password" onClick={onOpenSupervisorPassword} />
                {(isSystemAdmin || isOwner) && <FlyoutItem icon={<Users className="h-4 w-4 text-sidebar-foreground/60" />} label="Manage Users" onClick={onManageUsers} />}
                {isSystemAdmin && <FlyoutItem icon={<Building2 className="h-4 w-4 text-sidebar-foreground/60" />} label="CRM Clients" onClick={onManageWorkspaces} />}
                {(isSystemAdmin || isOwner) && <FlyoutItem icon={<Store className="h-4 w-4 text-sidebar-foreground/60" />} label="Ecommerce" onClick={onOpenEcommerceSettings} />}
                {(isSystemAdmin || isOwner) && onOpenEcommercePayments && <FlyoutItem icon={<CreditCard className="h-4 w-4 text-green-400" />} label="Ecommerce Payment" onClick={onOpenEcommercePayments} />}
                {onOpenEcommerceBot && <FlyoutItem icon={<Sparkles className="h-4 w-4 text-cyan-400" />} label="Ecommerce Bot" onClick={onOpenEcommerceBot} />}
                {(isSystemAdmin || isOwner) && onOpenTaskLimitSettings && <FlyoutItem icon={<ShieldAlert className="h-4 w-4 text-orange-500" />} label="Task Limits" onClick={onOpenTaskLimitSettings} />}
                {(isSystemAdmin || isOwner) && <FlyoutItem icon={<Bot className="h-4 w-4 text-purple-400" />} label="Warning Rules" onClick={() => setShowAIBotWarning(true)} />}
                <FlyoutItem icon={<Camera className="h-4 w-4 text-orange-400" />} label="Job Settings" onClick={onOpenJobSettings} />
                <FlyoutItem icon={<CreditCard className="h-4 w-4 text-green-400" />} label="iKhokha (CRM Jobs)" onClick={onOpenIkhokhaJobSettings} />
                <FlyoutItem icon={<Map className="h-4 w-4 text-amber-400" />} label="Field Mapper" onClick={onOpenFieldMapper} />
                {(isSystemAdmin || isOwner) && onShowTaskRecovery && <FlyoutItem icon={<Wrench className="h-4 w-4 text-sidebar-foreground/60" />} label="Tools" onClick={onShowTaskRecovery} />}
                {(isSystemAdmin || isOwner) && (
                  <FlyoutItem
                    icon={<Upload className="h-4 w-4 text-amber-400" />}
                    label="Import from ZIP"
                    onClick={() => importFileRef.current?.click()}
                  />
                )}
                {(isSystemAdmin || isOwner) && (
                  <FlyoutItem
                    icon={<Download className="h-4 w-4 text-teal-400" />}
                    label="Export All Data"
                    onClick={handleExport}
                  />
                )}
              </FlyoutGroup>
            </>
          )}

          {/* ── My Store Design ── */}
          {(isSystemAdmin || isOwner) && onOpenStoreDesign && !moduleHidden("ecommerce") && (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={onOpenStoreDesign}
                className="hover:bg-fuchsia-900/30 rounded-md text-fuchsia-300 hover:text-fuchsia-200 w-full"
                title="Customize your store design with a live preview"
              >
                <Sparkles className="h-4 w-4 shrink-0 text-fuchsia-400" />
                {!collapsed && <span className="text-sm font-medium ml-2">My Store Design</span>}
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          {/* ── Plan badge + upgrade ── */}
          {!isSystemAdmin && (
            <div className="pt-1 mt-1 border-t border-sidebar-border">
              {collapsed ? (
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => setShowUpgradeDialog(true)} className="hover:bg-emerald-900/40 rounded-md w-full" title="Upgrade plan">
                    <Zap className="h-4 w-4 text-emerald-400 shrink-0" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : (
                <div className="px-2 py-2">
                  {(() => {
                    const plan = authWorkspace?.plan ?? "free";
                    const expiresAt = authWorkspace?.subscriptionExpiresAt;
                    const daysLeft = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000)) : null;
                    const planLabel = plan === "free" ? "Free Forever" : plan.charAt(0).toUpperCase() + plan.slice(1);
                    const planColor = plan === "free" ? "#6b7280" : plan === "starter" ? "#3b82f6" : plan === "growth" ? "#1D9E75" : "#8b5cf6";
                    return (
                      <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: planColor, textTransform: "uppercase", letterSpacing: "0.05em" }}>{planLabel}</span>
                          {daysLeft !== null && <span style={{ fontSize: 10, color: daysLeft < 7 ? "#ef4444" : "#9ca3af" }}>{daysLeft}d left</span>}
                        </div>
                        {plan === "free" ? (
                          <button
                            onClick={() => setShowUpgradeDialog(true)}
                            style={{ width: "100%", padding: "6px 0", borderRadius: 6, border: "none", cursor: "pointer", background: "#1D9E75", color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
                          >
                            <Zap size={11} /> Upgrade Plan
                          </button>
                        ) : (
                          <button
                            onClick={() => setShowUpgradeDialog(true)}
                            style={{ width: "100%", padding: "5px 0", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", background: "transparent", color: "#9ca3af", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
                          >
                            <Zap size={10} /> Renew / Upgrade
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ── Setup Guide ── */}
          {onOpenSetupWizard && (
            <div className="pt-1 mt-1 border-t border-sidebar-border">
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={onOpenSetupWizard}
                  className="hover:bg-violet-900/40 rounded-md w-full"
                  title="Store setup guide"
                >
                  <Sparkles className="h-4 w-4 shrink-0 text-violet-400" />
                  {!collapsed && (
                    <div className="flex flex-col items-start ml-2">
                      <span className="text-sm text-violet-400">Setup Guide</span>
                      <span className="text-xs text-violet-500/70">Re-open store wizard</span>
                    </div>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </div>
          )}

          {/* ── Account ── */}
          <div className="pt-1 mt-1 border-t border-sidebar-border">
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onChangePassword} className="hover:bg-indigo-900/40 rounded-md text-indigo-400 hover:text-indigo-300 w-full">
                <KeyRound className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <div className="flex flex-col items-start ml-2">
                    <span className="text-sm">Change My Password</span>
                    <span className="text-xs text-indigo-500/70 truncate max-w-[140px]">{user?.email}</span>
                  </div>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </div>

          {/* ── Sign Out ── */}
          <div className="pt-1 border-sidebar-border">
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => logout()} className="hover:bg-red-900/40 rounded-md text-red-400 hover:text-red-300 w-full">
                <LogOut className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="text-sm ml-2">Sign Out</span>}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </div>

        </SidebarMenu>
      </SidebarFooter>

      {/* Hidden file input for ZIP import */}
      <input
        ref={importFileRef}
        type="file"
        accept=".zip"
        style={{ display: "none" }}
        onChange={handleImportFile}
      />

      {/* ZIP peeking spinner */}
      {zipPeeking && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#1a1f2e", borderRadius: 16, padding: "28px 32px", width: 360, maxWidth: "92vw", boxShadow: "0 24px 64px rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.1)", textAlign: "center" }}>
            <div style={{ fontSize: 14, color: "#e5e7eb", marginBottom: 8 }}>Reading ZIP…</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Checking what's inside your backup</div>
          </div>
        </div>,
        document.body
      )}

      {/* Export options dialog */}
      {showExportOptions && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#1a1f2e", borderRadius: 16, padding: "28px 32px", width: 460, maxWidth: "92vw", boxShadow: "0 24px 64px rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#0d9488", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Download size={18} color="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#fff" }}>Export Workspace Data</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Choose what to include in the backup ZIP</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              <button onClick={() => setExportOptions(o => Object.fromEntries(Object.keys(o).map(k => [k, true])) as ExportOptions)} style={{ fontSize: 12, color: "#0d9488", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Select all</button>
              <button onClick={() => setExportOptions(o => Object.fromEntries(Object.keys(o).map(k => [k, false])) as ExportOptions)} style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Deselect all</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {EXPORT_SECTIONS.map(sec => (
                <label key={sec.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={exportOptions[sec.key]}
                    onChange={e => setExportOptions(o => ({ ...o, [sec.key]: e.target.checked }))}
                    style={{ marginTop: 3, accentColor: "#0d9488", width: 15, height: 15, flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>
                      {sec.label}
                      {sec.key === "photos" && <span style={{ marginLeft: 6, fontSize: 11, color: "#f59e0b", fontWeight: 400 }}>slow — large files</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{sec.description}</div>
                  </div>
                </label>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setShowExportOptions(false)}
                style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", background: "transparent", color: "#9ca3af", fontWeight: 600, fontSize: 14 }}
              >
                Cancel
              </button>
              <button
                disabled={!Object.values(exportOptions).some(Boolean)}
                onClick={handleExportConfirm}
                style={{ flex: 2, padding: "10px", borderRadius: 8, border: "none", cursor: Object.values(exportOptions).some(Boolean) ? "pointer" : "not-allowed", background: Object.values(exportOptions).some(Boolean) ? "#0d9488" : "#374151", color: "#fff", fontWeight: 700, fontSize: 14 }}
              >
                Export ZIP
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Import options dialog */}
      {showImportOptions && zipContents && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#1a1f2e", borderRadius: 16, padding: "28px 32px", width: 460, maxWidth: "92vw", boxShadow: "0 24px 64px rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#1D9E75", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Upload size={18} color="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#fff" }}>Restore from ZIP</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Choose what to restore — greyed sections weren't in this backup</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {EXPORT_SECTIONS.map(sec => {
                const inZip = (
                  (sec.key === "workspaceState" && zipContents.hasWorkspaceState) ||
                  (sec.key === "inventory"      && zipContents.hasInventory)      ||
                  (sec.key === "sales"          && zipContents.hasSales)          ||
                  (sec.key === "customers"      && zipContents.hasCustomers)      ||
                  (sec.key === "orders"         && zipContents.hasOrders)         ||
                  (sec.key === "forms"          && zipContents.hasForms)          ||
                  (sec.key === "settings"       && zipContents.hasSettings)       ||
                  (sec.key === "datasheets"     && zipContents.hasDatasheets)     ||
                  (sec.key === "documents"      && zipContents.hasDocuments)      ||
                  (sec.key === "photos"         && zipContents.hasPhotos)
                );
                return (
                  <label key={sec.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: inZip ? "pointer" : "default", opacity: inZip ? 1 : 0.35 }}>
                    <input
                      type="checkbox"
                      checked={importOptions[sec.key as keyof ImportOptions]}
                      disabled={!inZip}
                      onChange={e => setImportOptions(o => ({ ...o, [sec.key]: e.target.checked }))}
                      style={{ marginTop: 3, accentColor: "#1D9E75", width: 15, height: 15, flexShrink: 0 }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>
                        {sec.label}
                        {!inZip && <span style={{ marginLeft: 6, fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>not in this backup</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{sec.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 16 }}>
              Warning: restoring will overwrite existing data in the selected sections.
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { setShowImportOptions(false); setPendingImportFile(null); }}
                style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", background: "transparent", color: "#9ca3af", fontWeight: 600, fontSize: 14 }}
              >
                Cancel
              </button>
              <button
                disabled={!Object.values(importOptions).some(Boolean)}
                onClick={handleImportConfirm}
                style={{ flex: 2, padding: "10px", borderRadius: 8, border: "none", cursor: Object.values(importOptions).some(Boolean) ? "pointer" : "not-allowed", background: Object.values(importOptions).some(Boolean) ? "#1D9E75" : "#374151", color: "#fff", fontWeight: 700, fontSize: 14 }}
              >
                Restore Selected
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Export progress dialog */}
      {exportProgress && createPortal(
        <div style={{
          position: "fixed", inset: 0, zIndex: 99999,
          background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#1a1f2e", borderRadius: 16, padding: "28px 32px",
            width: 420, maxWidth: "92vw", boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#0d9488", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Download size={18} color="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#fff" }}>Export All Data</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Packaging your workspace into a ZIP</div>
              </div>
            </div>

            <div style={{ fontSize: 14, color: "#e5e7eb", marginBottom: 12 }}>{exportProgress.phase}</div>
            <div style={{ height: 8, background: "rgba(255,255,255,0.1)", borderRadius: 99, overflow: "hidden", marginBottom: 8 }}>
              <div style={{
                height: "100%", borderRadius: 99,
                background: "linear-gradient(90deg, #0d9488, #34d399)",
                width: `${exportProgress.current}%`,
                transition: "width 0.4s ease",
              }} />
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", textAlign: "right", marginBottom: 16 }}>
              {exportProgress.current}%
            </div>

            {exportProgress.current === 100 ? (
              <button
                onClick={() => setExportProgress(null)}
                style={{ width: "100%", padding: "10px", borderRadius: 8, border: "none", cursor: "pointer", background: "#0d9488", color: "#fff", fontWeight: 700, fontSize: 14 }}
              >
                Done — Close
              </button>
            ) : (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", textAlign: "center" }}>
                Please wait — do not navigate away
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Import progress / result dialog */}
      {(importProgress || importResult) && createPortal(
        <div style={{
          position: "fixed", inset: 0, zIndex: 99999,
          background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#1a1f2e", borderRadius: 16, padding: "28px 32px",
            width: 440, maxWidth: "92vw", boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#1D9E75", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Upload size={18} color="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#fff" }}>Import Workspace Data</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Importing from ZIP export</div>
              </div>
            </div>

            {/* In-progress view */}
            {importProgress && !importResult && (
              <>
                <div style={{ fontSize: 14, color: "#e5e7eb", marginBottom: 12 }}>{importProgress.phase}</div>
                <div style={{ height: 8, background: "rgba(255,255,255,0.1)", borderRadius: 99, overflow: "hidden", marginBottom: 8 }}>
                  <div style={{
                    height: "100%", borderRadius: 99,
                    background: "linear-gradient(90deg, #1D9E75, #34d399)",
                    width: `${importProgress.current}%`,
                    transition: "width 0.4s ease",
                  }} />
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", textAlign: "right" }}>{importProgress.current}%</div>
                {importProgress.errors.length > 0 && (
                  <div style={{ marginTop: 12, fontSize: 12, color: "#fca5a5" }}>
                    {importProgress.errors.slice(-3).map((e, i) => <div key={i}>⚠ {e}</div>)}
                  </div>
                )}
              </>
            )}

            {/* Result view */}
            {importResult && (
              <>
                {importResult.errors.length > 0 && Object.keys(importResult.imported).length === 0 ? (
                  // Total failure
                  <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
                    <XCircle size={40} color="#ef4444" style={{ margin: "0 auto 12px" }} />
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginBottom: 8 }}>Import failed</div>
                    <div style={{ fontSize: 13, color: "#fca5a5" }}>{importResult.errors[0]}</div>
                  </div>
                ) : (
                  // Success (possibly with some warnings)
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <CheckCircle size={20} color="#34d399" />
                      <span style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>Import successful!</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                      {Object.entries(importResult.imported).map(([table, count]) => (
                        <div key={table} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#d1d5db" }}>
                          <span>{table}</span>
                          <span style={{ color: "#34d399", fontWeight: 600 }}>
                            {table === "workspace_state (tasks/lists/spaces)" ? "✓ restored" : `${count} records`}
                          </span>
                        </div>
                      ))}
                    </div>
                    {importResult.errors.length > 0 && (
                      <div style={{ background: "rgba(239,68,68,0.1)", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#fca5a5", marginBottom: 4 }}>Partial errors ({importResult.errors.length})</div>
                        {importResult.errors.slice(0, 4).map((e, i) => <div key={i} style={{ fontSize: 11, color: "#fca5a5" }}>• {e}</div>)}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>
                      Refresh the page to see the imported data in your workspace.
                    </div>
                  </>
                )}
                <button
                  onClick={() => { setImportProgress(null); setImportResult(null); }}
                  style={{ width: "100%", padding: "10px", borderRadius: 8, border: "none", cursor: "pointer", background: "#1D9E75", color: "#fff", fontWeight: 700, fontSize: 14 }}
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* AI Bot Warning Dialog (old) */}
      <AIBotWarningDialog
        open={showAIBotWarning}
        onOpenChange={setShowAIBotWarning}
        workspaceId={authWorkspace?.id || ""}
        folders={workspace.folders.map(f => ({ id: f.id, name: f.name }))}
      />

      <UpgradePlanDialog open={showUpgradeDialog} onClose={() => setShowUpgradeDialog(false)} />

      {/* Task Guard Rules Panel (new) */}
      <WarningRulesPanel
        open={showAIBotWarning}
        onOpenChange={setShowAIBotWarning}
        workspaceId={authWorkspace?.id || ""}
        folders={workspace.folders.map(f => ({ id: f.id, name: f.name }))}
        lists={workspace.lists
          .filter(l => l.parentType === "folder")
          .map(l => ({ id: l.id, name: l.name, parentId: l.parentId, customStatuses: l.customStatuses }))}
        customFields={workspace.customFields}
        members={members}
      />
    </Sidebar>
  );
}

function ListItem({ list, count, selected, onClick, collapsed, onRename, onDelete, onCustomFields, onTaskStatuses, onManagePermissions, onDropTask }: {
  list: List; count: number; selected: boolean; onClick: () => void; collapsed: boolean;
  onRename: (name: string) => void; onDelete: () => void; onCustomFields: () => void;
  onTaskStatuses: () => void; onManagePermissions?: () => void;
  onDropTask?: (taskId: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={onClick}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const taskId = e.dataTransfer.getData('text/plain');
          if (taskId && onDropTask) onDropTask(taskId);
        }}
        className={cn(
          "hover:bg-sidebar-accent rounded-md group text-sidebar-foreground transition-colors",
          selected && "bg-sidebar-accent text-white font-medium",
          dragOver && "bg-primary/30 border border-primary/60 ring-1 ring-primary/40"
        )}
      >
        <div className="flex items-center gap-2 w-full">
          <span className="text-xs">{list.icon || "📋"}</span>
          {!collapsed && (
            <>
              <span className="text-sm truncate flex-1">{list.name}</span>
              <div className="flex items-center gap-1">
                {count > 0 && <span className="text-sm font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">{count}</span>}
                {/* Status indicator: blue dot if custom statuses, gray if default */}
                <div 
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    list.customStatuses && list.customStatuses.length > 0
                      ? "bg-blue-500" // Blue dot = custom statuses
                      : "bg-gray-400" // Gray dot = default statuses
                  )} 
                  title={list.customStatuses?.length ? `${list.customStatuses.length} custom statuses` : "8 default statuses"} 
                />
                {/* Status indicator: red dot if custom statuses, gray if default */}
                <div className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  list.customStatuses && list.customStatuses.length > 0
                    ? "bg-blue-500" // Blue dot = custom statuses
                    : "bg-gray-400" // Gray dot = default statuses
                )} title={list.customStatuses?.length ? `${list.customStatuses.length} custom statuses` : "8 default statuses"} />
                <div className="flex gap-0.5">
                  {onManagePermissions && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onManagePermissions(); }}
                      className="p-0.5 rounded hover:bg-sidebar-accent"
                      title="Manage permissions"
                    >
                      <Lock className="h-3 w-3 text-sidebar-foreground/60" />
                    </button>
                  )}
                  <ItemContextMenu
                    itemType="list"
                    itemName={list.name}
                    onRename={onRename}
                    onDelete={onDelete}
                    onCustomFields={onCustomFields}
                    onTaskStatuses={onTaskStatuses}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// ── Section header divider ────────────────────────────────────────────────────

function DevBadge() {
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-600/40"
      title="In development — visible to ShopFlowz admins only"
    >
      Dev
    </span>
  );
}

function SectionHeader({
  label, collapsed, children, dev,
}: {
  label: string;
  collapsed: boolean;
  children?: ReactNode;
  dev?: boolean;
}) {
  if (collapsed) return <div className="h-px bg-sidebar-foreground/10 my-2 mx-2" />;
  return (
    <div className="flex items-center justify-between px-2 pt-3 pb-1">
      <div className="flex items-center gap-2">
        <div className="h-3.5 w-[3px] rounded-full bg-gradient-to-b from-violet-400 via-blue-400 to-cyan-400 opacity-70" />
        <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-sidebar-foreground/40">
          {label}
          {dev && <DevBadge />}
        </span>
      </div>
      {children}
    </div>
  );
}

// ── Flyout helpers ──────────────────────────────────────────────────────

// Global state to ensure only one flyout open at a time
let currentOpenFlyout: string | null = null;
const flyoutClosers = new globalThis.Map<string, () => void>();

function FlyoutGroup({
  icon, label, collapsed, dark, children, onHeaderClick, dev,
}: {
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  dark?: boolean;
  children: ReactNode;
  onHeaderClick?: () => void;
  dev?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 400 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const moveRafRef = useRef<number | null>(null);
  const flyoutId = useRef(`flyout-${label}-${Math.random()}`).current;

  const computePos = () => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const panelW = 230;
    const desiredH = Math.min(panelRef.current?.scrollHeight ?? 260, 400);
    let top = r.top;
    if (top + desiredH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - desiredH - 8);
    const maxHeight = Math.min(desiredH, window.innerHeight - top - 8);
    const left = r.right + 6;
    const clampedLeft = left + panelW > window.innerWidth ? r.left - panelW - 6 : left;
    setPos({ top, left: clampedLeft, maxHeight });
  };

  // Register/unregister close handler
  useEffect(() => {
    if (open) {
      flyoutClosers.set(flyoutId, () => setOpen(false));
    } else {
      flyoutClosers.delete(flyoutId);
      if (currentOpenFlyout === flyoutId) {
        currentOpenFlyout = null;
      }
    }
    return () => {
      flyoutClosers.delete(flyoutId);
      if (currentOpenFlyout === flyoutId) {
        currentOpenFlyout = null;
      }
    };
  }, [open, flyoutId]);

  // Close flyout on any click outside the trigger or panel (catches dialog opens too)
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const tr = triggerRef.current;
      const pr = panelRef.current;
      if (tr && tr.contains(e.target as Node)) return;
      if (pr && pr.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClick, true);
    return () => document.removeEventListener('mousedown', onClick, true);
  }, [open]);

  // Global mousemove: close only when cursor is outside BOTH trigger and panel.
  // Throttled to one check per animation frame to avoid layout thrashing.
  useEffect(() => {
    if (!open) return;
    const onMove = (e: MouseEvent) => {
      if (moveRafRef.current) return; // already queued this frame
      const mx = e.clientX, my = e.clientY;
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = null;
        const tr = triggerRef.current?.getBoundingClientRect();
        const pr = panelRef.current?.getBoundingClientRect();
        const pad = 60;
        const inTrigger = tr && mx >= tr.left - pad && mx <= tr.right + pad && my >= tr.top - pad && my <= tr.bottom + pad;
        const inPanel  = pr && mx >= pr.left - pad && mx <= pr.right + pad && my >= pr.top - pad && my <= pr.bottom + pad;
        if (!inTrigger && !inPanel) {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => setOpen(false));
        } else {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
        }
      });
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (moveRafRef.current) cancelAnimationFrame(moveRafRef.current);
    };
  }, [open]);

  const handleEnter = () => {
    // Close any other open flyouts first
    if (currentOpenFlyout && currentOpenFlyout !== flyoutId) {
      const closer = flyoutClosers.get(currentOpenFlyout);
      if (closer) closer();
    }
    currentOpenFlyout = flyoutId;
    computePos();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(computePos);
    window.addEventListener('resize', computePos);
    window.addEventListener('scroll', computePos, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', computePos);
      window.removeEventListener('scroll', computePos, true);
    };
  }, [open]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        ref={triggerRef}
        onMouseEnter={handleEnter}
        onClick={onHeaderClick}
        className={cn(
          "rounded-md w-full",
          onHeaderClick ? "cursor-pointer" : "cursor-default",
          dark ? "hover:bg-sidebar-accent text-sidebar-foreground" : "hover:bg-sidebar-accent"
        )}
      >
        {icon}
        {!collapsed && (
          <>
            <span className={cn("text-sm font-medium ml-2 flex-1 flex items-center gap-1.5", dark && "text-sidebar-foreground")}>
              {label}
              {dev && <DevBadge />}
            </span>
            <ChevronRight className={cn("h-3.5 w-3.5", dark ? "text-sidebar-foreground/50" : "text-muted-foreground")} />
          </>
        )}
      </SidebarMenuButton>

      {open && createPortal(
        <div
          ref={panelRef}
	          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 99999, maxHeight: pos.maxHeight, overflowY: 'auto' }}
	          className="min-w-[220px] rounded-lg shadow-xl py-1 bg-sidebar-accent border border-sidebar-border"
	        >
          <div className="px-3 py-1.5 text-[10px] font-bold text-sidebar-foreground/60 uppercase tracking-widest border-b border-sidebar-border mb-1">
            {label}
          </div>
          {children}
        </div>,
        document.body
      )}
    </SidebarMenuItem>
  );
}

function FlyoutItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-sm rounded text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
