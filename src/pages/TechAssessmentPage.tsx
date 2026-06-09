import { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft, Plus, Trash2, Save, Settings, BarChart2,
  Users, Target, CheckCircle, TrendingUp, TrendingDown,
  Trophy, RefreshCw, Wrench, DollarSign, Hash, ExternalLink, X,
  ChevronLeft, ChevronRight, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  loadTechAssessmentSettings,
  saveTechAssessmentSettings,
  Technician,
  TechAssessmentSettings,
  DEFAULT_TECH_SETTINGS,
} from "@/lib/techAssessmentService";
import { getInvoices } from "@/lib/invoiceService";
import type { WorkspaceState, Task } from "@/types/crm";
import {
  BarChart, Bar, LineChart, Line, ResponsiveContainer, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, Legend,
} from "recharts";

interface Props {
  onClose: () => void;
  workspace: WorkspaceState;
  onOpenTask?: (task: Task) => void;
}

const CHART_COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#f97316", "#ec4899",
];

const DEFAULT_COMPLETED_STATUSES = ["done", "complete", "paid", "collected", "invoiced"];

function KpiCard({
  title, value, sub, icon, trend,
}: {
  title: string; value: string; sub?: string;
  icon: React.ReactNode; trend?: number;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">{title}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="text-2xl font-bold text-foreground">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      {trend !== undefined && (
        <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-green-400" : "text-red-400"}`}>
          {trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {Math.abs(trend).toFixed(0)}% vs last month
        </div>
      )}
    </div>
  );
}

const fmtR = (n: number) =>
  `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export function TechAssessmentPage({ onClose, workspace, onOpenTask }: Props) {
  const { workspaceId, isSystemAdmin, workspace: authWorkspace } = useAuth();
  const { toast } = useToast();

  // Check if user has access to Tech Assessment
  const hiddenFeatures = authWorkspace?.hiddenFeatures ?? [];
  const hasAccess = isSystemAdmin || !hiddenFeatures.includes('tech_assessment');

  const [tab, setTab] = useState<"performance" | "comparison" | "settings">("performance");
  const [settings, setSettings] = useState<TechAssessmentSettings>(DEFAULT_TECH_SETTINGS);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Month selection state
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth()); // 0-11

  // Trend analysis state
  const [trendMonths, setTrendMonths] = useState(3); // 2, 3, 4, 6 months
  
  // Comparison state
  const [comparisonMonths, setComparisonMonths] = useState<{year: number; month: number}[]>([]);
  const [isAddingComparisonMonth, setIsAddingComparisonMonth] = useState(false);

  // Settings form state
  const [newTechName, setNewTechName] = useState("");
  const [newTechTarget, setNewTechTarget] = useState(5000);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Job list dialog state
  const [selectedTech, setSelectedTech] = useState<Technician | null>(null);
  const [showJobList, setShowJobList] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    Promise.all([
      loadTechAssessmentSettings(workspaceId),
      getInvoices(workspaceId).catch(() => []),
    ]).then(([s, inv]) => {
      setSettings(s);
      setInvoices(inv);
    }).finally(() => setLoading(false));
  }, [workspaceId]);

  // Access denied screen
  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background text-foreground p-8">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Access Restricted</h2>
          <p className="text-muted-foreground mb-6">
            You do not have access to the Tech Assessment module.
            Please contact ShopFlowz support for access options.
          </p>
          <Button onClick={onClose} variant="outline" className="border-border text-foreground/80 hover:bg-muted">
            Return to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // All tasks flat
  const allTasks: Task[] = workspace.tasks || [];

  // Determine which statuses count as completed
  const effectiveCompletedIds = useMemo(() => {
    if (settings.completedStatusIds.length > 0) return settings.completedStatusIds;
    // Auto-detect from workspace statuses
    const all = workspace.lists.flatMap(l => l.customStatuses || []);
    const matched = all.filter(s =>
      DEFAULT_COMPLETED_STATUSES.some(d => s.id.toLowerCase().includes(d) || s.label.toLowerCase().includes(d))
    ).map(s => s.id);
    if (matched.length > 0) return matched;
    return DEFAULT_COMPLETED_STATUSES;
  }, [settings.completedStatusIds, workspace.lists]);

  // All known statuses for the settings picker
  const allStatuses = useMemo(() => {
    const seen = new Map<string, string>();
    workspace.lists.forEach(l => {
      (l.customStatuses || []).forEach(s => seen.set(s.id, s.label));
    });
    return Array.from(seen.entries()).map(([id, label]) => ({ id, label }));
  }, [workspace.lists]);

  // All custom fields (to pick the assessment field from)
  const allCustomFields = useMemo(() => {
    return (workspace.customFields || []).map(f => ({ id: f.id, name: f.name, type: f.type }));
  }, [workspace.customFields]);

  const assessmentField = allCustomFields.find(f => f.id === settings.assessmentFieldId);
  const completedDateField = allCustomFields.find(f => f.id === settings.completedDateFieldId);

  // Month navigation helpers
  const goToPreviousMonth = () => {
    if (selectedMonth === 0) {
      setSelectedMonth(11);
      setSelectedYear(selectedYear - 1);
    } else {
      setSelectedMonth(selectedMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (selectedMonth === 11) {
      setSelectedMonth(0);
      setSelectedYear(selectedYear + 1);
    } else {
      setSelectedMonth(selectedMonth + 1);
    }
  };

  const goToCurrentMonth = () => {
    const now = new Date();
    setSelectedYear(now.getFullYear());
    setSelectedMonth(now.getMonth());
  };
  
  // Comparison months management
  const addCurrentMonthToComparison = () => {
    const alreadyExists = comparisonMonths.some(
      m => m.year === selectedYear && m.month === selectedMonth
    );
    
    if (!alreadyExists) {
      setComparisonMonths(prev => [...prev, { year: selectedYear, month: selectedMonth }]);
    }
  };
  
  const addMonthToComparison = (year: number, month: number) => {
    const alreadyExists = comparisonMonths.some(
      m => m.year === year && m.month === month
    );
    
    if (!alreadyExists) {
      setComparisonMonths(prev => [...prev, { year, month }]);
    }
    
    setIsAddingComparisonMonth(false);
  };
  
  const removeComparisonMonth = (year: number, month: number) => {
    setComparisonMonths(prev => 
      prev.filter(m => !(m.year === year && m.month === month))
    );
  };

  const selectedMonthName = new Date(selectedYear, selectedMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth();

  // Function to generate tech stats for a specific month
  const generateTechStatsForMonth = (year: number, month: number) => {
    const thisMonthStart = new Date(selectedYear, selectedMonth, 1).toISOString();
    const thisMonthEnd = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59).toISOString();
    const lastMonthStart = new Date(selectedYear, selectedMonth - 1, 1).toISOString();
    const lastMonthEnd = new Date(selectedYear, selectedMonth, 0, 23, 59, 59).toISOString();

    const fieldId = settings.assessmentFieldId;
    const dateFieldId = settings.completedDateFieldId;
    
    const getFieldValue = (task: Task): number => {
      if (!fieldId) return 0;
      const fv = (task.customFieldValues || []).find(v => v.fieldId === fieldId);
      return fv ? (Number(fv.value) || 0) : 0;
    };
    
    const getCompletedDate = (task: Task): string | null => {
      if (!dateFieldId) return task.createdAt;
      const fv = (task.customFieldValues || []).find(v => v.fieldId === dateFieldId);
      // When date field is configured, only return date if it has a value, otherwise null
      return fv?.value ? String(fv.value) : null;
    };
    
    const hasCompletedDate = (task: Task): boolean => {
      if (!dateFieldId) return true; // No date field configured, all tasks are valid
      const fv = (task.customFieldValues || []).find(v => v.fieldId === dateFieldId);
      return !!(fv?.value); // Only true if the completion date field has a value
    };

    return settings.technicians.filter(t => t.active).map(tech => {
      const techTasks = allTasks.filter(t => (t as any).technician === tech.name);

      // Filter completed tasks that have a completion date (when field is configured)
      const completedTasks = techTasks.filter(t =>
        effectiveCompletedIds.some(sid => t.status === sid || t.status.toLowerCase().includes(sid.toLowerCase())) &&
        hasCompletedDate(t)
      );

      // This month (based on completion date)
      const completedThisMonth = completedTasks.filter(t => {
        const compDate = getCompletedDate(t);
        return compDate && compDate >= thisMonthStart && compDate <= thisMonthEnd;
      });
      const thisMonthTasks = techTasks.filter(t => {
        const compDate = getCompletedDate(t);
        return compDate && compDate >= thisMonthStart && compDate <= thisMonthEnd && hasCompletedDate(t);
      });

      // Last month (for trend)
      const completedLastMonth = completedTasks.filter(t => {
        const compDate = getCompletedDate(t);
        return compDate && compDate >= lastMonthStart && compDate <= lastMonthEnd;
      });

      // Assessment value: sum field OR fall back to count
      const amountThisMonth = fieldId
        ? completedThisMonth.reduce((sum, t) => sum + getFieldValue(t), 0)
        : completedThisMonth.length;
      const amountLastMonth = fieldId
        ? completedLastMonth.reduce((sum, t) => sum + getFieldValue(t), 0)
        : completedLastMonth.length;

      // Revenue: invoices linked to completed tasks
      const completedTaskIds = new Set(completedThisMonth.map(t => t.id));
      const revenueThisMonth = invoices
        .filter(inv => inv.taskId && completedTaskIds.has(inv.taskId) && inv.paymentStatus === 'paid')
        .reduce((sum: number, inv: any) => sum + (inv.amountPaid || 0), 0);

      const target = tech.monthlyTarget || 1;
      const completionRate = thisMonthTasks.length > 0
        ? Math.round((completedThisMonth.length / thisMonthTasks.length) * 100)
        : 0;
      const targetAchievement = Math.round((amountThisMonth / target) * 100);

      const trend = amountLastMonth > 0
        ? Math.round(((amountThisMonth - amountLastMonth) / amountLastMonth) * 100)
        : 0;

      return {
        tech,
        total: techTasks.length,
        thisMonth: thisMonthTasks.length,
        completed: completedThisMonth.length,
        amountThisMonth,
        completionRate,
        targetAchievement,
        revenue: revenueThisMonth,
        trend,
      };
    });
  };

  // Per-tech stats for the selected month
  const techStats = useMemo(() => {
    return generateTechStatsForMonth(selectedYear, selectedMonth);
  }, [settings.technicians, settings.assessmentFieldId, settings.completedDateFieldId, allTasks, effectiveCompletedIds, invoices, selectedYear, selectedMonth]);
  
  // Per-tech stats for comparison months
  const comparisonStats = useMemo(() => {
    return comparisonMonths.map(({ year, month }) => {
      const stats = generateTechStatsForMonth(year, month);
      const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      return {
        monthName,
        year,
        month,
        stats
      };
    });
  }, [comparisonMonths, settings.technicians, settings.assessmentFieldId, settings.completedDateFieldId, allTasks, effectiveCompletedIds, invoices]);

  const chartData = techStats.map(s => ({
    name: s.tech.name.split(" ")[0],
    "Amount": s.amountThisMonth,
    "Target": s.tech.monthlyTarget,
    tech: s.tech, // Store the tech object for click handler
  }));

  // Multi-month trend data
  const trendData = useMemo(() => {
    const fieldId = settings.assessmentFieldId;
    const dateFieldId = settings.completedDateFieldId;
    
    const getFieldValue = (task: Task): number => {
      if (!fieldId) return 0;
      const fv = (task.customFieldValues || []).find(v => v.fieldId === fieldId);
      return fv ? (Number(fv.value) || 0) : 0;
    };
    
    const getCompletedDate = (task: Task): string | null => {
      if (!dateFieldId) return task.createdAt;
      const fv = (task.customFieldValues || []).find(v => v.fieldId === dateFieldId);
      return fv?.value ? String(fv.value) : null;
    };
    
    const hasCompletedDate = (task: Task): boolean => {
      if (!dateFieldId) return true;
      const fv = (task.customFieldValues || []).find(v => v.fieldId === dateFieldId);
      return !!(fv?.value);
    };

    // Build array of months going backwards from selected month
    const months: { year: number; month: number; label: string; start: string; end: string }[] = [];
    for (let i = trendMonths - 1; i >= 0; i--) {
      const date = new Date(selectedYear, selectedMonth - i, 1);
      const year = date.getFullYear();
      const month = date.getMonth();
      const label = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      const start = new Date(year, month, 1).toISOString();
      const end = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
      months.push({ year, month, label, start, end });
    }

    // Calculate each tech's performance per month
    const result = months.map(({ label, start, end }) => {
      const dataPoint: any = { month: label };
      
      settings.technicians.filter(t => t.active).forEach(tech => {
        const techTasks = allTasks.filter(t => (t as any).technician === tech.name);
        const completedTasks = techTasks.filter(t =>
          effectiveCompletedIds.some(sid => t.status === sid || t.status.toLowerCase().includes(sid.toLowerCase())) &&
          hasCompletedDate(t)
        );
        
        const completedInPeriod = completedTasks.filter(t => {
          const compDate = getCompletedDate(t);
          return compDate && compDate >= start && compDate <= end;
        });
        
        const amount = fieldId
          ? completedInPeriod.reduce((sum, t) => sum + getFieldValue(t), 0)
          : completedInPeriod.length;
        
        dataPoint[tech.name.split(" ")[0]] = amount;
      });
      
      return dataPoint;
    });

    return result;
  }, [settings.technicians, settings.assessmentFieldId, settings.completedDateFieldId, allTasks, effectiveCompletedIds, selectedYear, selectedMonth, trendMonths]);

  // Get jobs for selected technician
  const selectedTechJobs = useMemo(() => {
    if (!selectedTech) return [];
    
    const thisMonthStart = new Date(selectedYear, selectedMonth, 1).toISOString();
    const thisMonthEnd = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59).toISOString();
    const dateFieldId = settings.completedDateFieldId;
    
    const getCompletedDate = (task: Task): string | null => {
      if (!dateFieldId) return task.createdAt;
      const fv = (task.customFieldValues || []).find(v => v.fieldId === dateFieldId);
      return fv?.value ? String(fv.value) : null;
    };
    
    const hasCompletedDate = (task: Task): boolean => {
      if (!dateFieldId) return true;
      const fv = (task.customFieldValues || []).find(v => v.fieldId === dateFieldId);
      return !!(fv?.value);
    };
    
    return allTasks.filter(t => {
      // Filter by tech name
      if ((t as any).technician !== selectedTech.name) return false;
      // Must have a completion date when field is configured
      if (!hasCompletedDate(t)) return false;
      // Filter by selected month (using completion date)
      const compDate = getCompletedDate(t);
      if (!compDate || compDate < thisMonthStart || compDate > thisMonthEnd) return false;
      // Filter by completed status
      return effectiveCompletedIds.some(sid => 
        t.status === sid || t.status.toLowerCase().includes(sid.toLowerCase())
      );
    }).sort((a, b) => {
      const dateA = getCompletedDate(a);
      const dateB = getCompletedDate(b);
      return new Date(dateB || 0).getTime() - new Date(dateA || 0).getTime();
    });
  }, [selectedTech, allTasks, effectiveCompletedIds, settings.completedDateFieldId, selectedYear, selectedMonth]);

  // Get status label from ID (search task's specific list first, then all lists)
  const getStatusLabel = (task: Task): string => {
    // First, try to find status in the task's own list
    const taskList = workspace.lists.find(l => l.id === task.listId);
    if (taskList?.customStatuses) {
      const status = taskList.customStatuses.find(s => s.id === task.status);
      if (status) return status.label;
    }
    
    // Fallback: search all lists
    for (const list of workspace.lists) {
      const status = (list.customStatuses || []).find(s => s.id === task.status);
      if (status) return status.label;
    }
    
    // Last resort: format the status ID as a readable label
    return task.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  };

  // Handle bar click
  const handleBarClick = (data: any) => {
    if (data && data.tech) {
      setSelectedTech(data.tech);
      setShowJobList(true);
    }
  };

  // Handle job click
  const handleJobClick = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenTask) {
      onOpenTask(task);
      // Small delay to ensure task opens before closing dialog
      setTimeout(() => setShowJobList(false), 100);
    }
  };

  // ── Settings handlers ────────────────────────────────────────────────────────
  const addTechnician = () => {
    if (!newTechName.trim()) return;
    const updated: TechAssessmentSettings = {
      ...settings,
      technicians: [
        ...settings.technicians,
        {
          id: `tech_${Date.now()}`,
          name: newTechName.trim(),
          monthlyTarget: newTechTarget,
          active: true,
          color: CHART_COLORS[settings.technicians.length % CHART_COLORS.length],
        },
      ],
    };
    setSettings(updated);
    setNewTechName("");
    setNewTechTarget(5000);
  };

  const removeTechnician = (id: string) => {
    setSettings(prev => ({
      ...prev,
      technicians: prev.technicians.filter(t => t.id !== id),
    }));
  };

  const updateTechnician = (id: string, field: keyof Technician, value: any) => {
    setSettings(prev => ({
      ...prev,
      technicians: prev.technicians.map(t => t.id === id ? { ...t, [field]: value } : t),
    }));
  };

  const toggleCompletedStatus = (statusId: string) => {
    setSettings(prev => {
      const ids = prev.completedStatusIds.includes(statusId)
        ? prev.completedStatusIds.filter(s => s !== statusId)
        : [...prev.completedStatusIds, statusId];
      return { ...prev, completedStatusIds: ids };
    });
  };

  const handleSaveSettings = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      await saveTechAssessmentSettings(workspaceId, settings);
      toast({ title: "Settings saved", description: "Tech assessment settings updated." });
      // Switch to Performance tab to see updated results
      setTimeout(() => setTab("performance"), 500);
    } catch {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="absolute inset-0 bg-background z-50 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-background z-50 flex flex-col text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="icon" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-indigo-400" />
          <h1 className="text-lg font-semibold">Tech Assessment</h1>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setTab("performance")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${tab === "performance" ? "bg-indigo-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            <span className="flex items-center gap-1.5"><BarChart2 className="h-4 w-4" /> Performance</span>
          </button>
          <button
            onClick={() => setTab("comparison")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${tab === "comparison" ? "bg-indigo-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            <span className="flex items-center gap-1.5"><BarChart className="h-4 w-4" /> Comparison</span>
          </button>
          <button
            onClick={() => setTab("settings")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${tab === "settings" ? "bg-indigo-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
          >
            <span className="flex items-center gap-1.5"><Settings className="h-4 w-4" /> Settings</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── PERFORMANCE TAB ─────────────────────────────────────────────── */}
        {tab === "performance" && (
          <div className="p-6 space-y-6">
            {/* Month Navigation */}
            <div className="flex items-center justify-between bg-card border border-border rounded-lg p-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={goToPreviousMonth}
                className="text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-3">
                <div className="text-center">
                  <div className="text-lg font-semibold text-foreground">{selectedMonthName}</div>
                  <div className="text-xs text-muted-foreground">
                    {isCurrentMonth ? "Current Month" : "Historical"}
                  </div>
                </div>
                {!isCurrentMonth && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={goToCurrentMonth}
                    className="border-border text-foreground/80 hover:bg-muted"
                  >
                    Go to Current
                  </Button>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={goToNextMonth}
                className="text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {techStats.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
                <Users className="h-12 w-12 opacity-40" />
                <p className="text-lg">No technicians configured.</p>
                <p className="text-sm">Go to <strong>Settings</strong> to add your technicians.</p>
                <Button variant="outline" className="border-border text-foreground/80" onClick={() => setTab("settings")}>
                  <Settings className="h-4 w-4 mr-2" /> Go to Settings
                </Button>
              </div>
            ) : (
              <>
                {/* Active Settings Summary */}
                <div className="bg-card/50 border border-border/50 rounded-lg p-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Settings className="h-3.5 w-3.5" />
                    <span className="font-medium">Active Scope:</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-indigo-400" />
                    <span className="text-foreground/80">
                      {assessmentField ? assessmentField.name : "Job Count"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Hash className="h-3.5 w-3.5 text-green-400" />
                    <span className="text-foreground/80">
                      {completedDateField ? completedDateField.name : "Creation Date"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5 text-blue-400" />
                    <span className="text-foreground/80">
                      {effectiveCompletedIds.length} status{effectiveCompletedIds.length !== 1 ? 'es' : ''}
                    </span>
                  </div>
                  <button 
                    onClick={() => setTab("settings")}
                    className="ml-auto text-indigo-400 hover:text-indigo-300 text-xs font-medium flex items-center gap-1"
                  >
                    <Settings className="h-3 w-3" /> Configure
                  </button>
                </div>

                {/* Top KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <KpiCard
                    title="Active Technicians"
                    value={String(techStats.length)}
                    icon={<Users className="h-4 w-4" />}
                  />
                  <KpiCard
                    title={assessmentField ? `Total ${assessmentField.name}` : "Total Assessment"}
                    value={fmtR(techStats.reduce((s, t) => s + t.amountThisMonth, 0))}
                    sub="sum of field — completed tasks"
                    icon={<DollarSign className="h-4 w-4" />}
                  />
                  <KpiCard
                    title="Jobs Completed"
                    value={String(techStats.reduce((s, t) => s + t.completed, 0))}
                    sub={selectedMonthName}
                    icon={<CheckCircle className="h-4 w-4" />}
                  />
                  <KpiCard
                    title="Total Revenue (paid)"
                    value={fmtR(techStats.reduce((s, t) => s + t.revenue, 0))}
                    sub="from paid invoices"
                    icon={<Trophy className="h-4 w-4" />}
                  />
                </div>

                {/* Chart */}
                {chartData.length > 0 && (
                  <div className="bg-card border border-border rounded-xl p-4">
                    <h2 className="text-sm font-semibold text-foreground/80 mb-4">
                      {selectedMonthName} — {assessmentField ? assessmentField.name : "Assessment"} vs Target
                      <span className="text-xs font-normal text-muted-foreground ml-2">(Click bars to view jobs)</span>
                    </h2>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} tickFormatter={v => `R${(v/1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8 }}
                          labelStyle={{ color: "#e2e8f0" }}
                          formatter={(value: any) => [fmtR(Number(value)), ""]}
                        />
                        <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                        <Bar 
                          dataKey="Amount" 
                          fill="#6366f1" 
                          radius={[3, 3, 0, 0]}
                          onClick={handleBarClick}
                          style={{ cursor: 'pointer' }}
                        />
                        <Bar dataKey="Target" fill="#f59e0b" radius={[3, 3, 0, 0]} opacity={0.6} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Per-tech cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {techStats.map(s => (
                    <div key={s.tech.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                            style={{ background: s.tech.color || "#6366f1" }}>
                            {s.tech.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-foreground">{s.tech.name}</div>
                            <div className="text-xs text-muted-foreground">Target: {fmtR(s.tech.monthlyTarget)}/mo</div>
                          </div>
                        </div>
                        <Badge
                          className={`text-xs ${s.targetAchievement >= 100 ? "bg-green-600" : s.targetAchievement >= 70 ? "bg-yellow-600" : "bg-red-700"} text-white border-0`}
                        >
                          {s.targetAchievement}% of target
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-center">
                        <div className="bg-muted/50 rounded-lg py-2 px-3">
                          <div className="text-base font-bold text-indigo-300">{fmtR(s.amountThisMonth)}</div>
                          <div className="text-[10px] text-muted-foreground">{assessmentField ? assessmentField.name : "Assessment"}</div>
                        </div>
                        <div className="bg-muted/50 rounded-lg py-2 px-3">
                          <div className="text-base font-bold text-green-300">{s.completed}</div>
                          <div className="text-[10px] text-muted-foreground">Jobs completed</div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Revenue (paid invoices)</span>
                        <span className="font-semibold text-green-300">{fmtR(s.revenue)}</span>
                      </div>

                      {/* Progress bar */}
                      <div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                          <span>{fmtR(s.amountThisMonth)} / {fmtR(s.tech.monthlyTarget)}</span>
                          <span>{s.targetAchievement}%</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${s.targetAchievement >= 100 ? "bg-green-500" : s.targetAchievement >= 70 ? "bg-yellow-500" : "bg-red-500"}`}
                            style={{ width: `${Math.min(s.targetAchievement, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Monthly trend comparison */}
                      <div className={`flex items-center justify-between gap-1 text-xs py-1.5 px-2 rounded ${s.trend >= 0 ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
                        <span className="text-[10px] text-muted-foreground">vs Previous Month:</span>
                        <div className="flex items-center gap-1 font-medium">
                          {s.trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {s.trend >= 0 ? '+' : ''}{s.trend}%
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Multi-Month Trend Analysis */}
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-foreground/80">
                      Monthly Trend Analysis
                      <span className="text-xs font-normal text-muted-foreground ml-2">
                        ({assessmentField ? assessmentField.name : "Job Count"} over time)
                      </span>
                    </h2>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Period:</span>
                      <Select value={String(trendMonths)} onValueChange={v => setTrendMonths(Number(v))}>
                        <SelectTrigger className="h-8 w-32 bg-card border-border text-foreground">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2">2 months</SelectItem>
                          <SelectItem value="3">3 months</SelectItem>
                          <SelectItem value="4">4 months</SelectItem>
                          <SelectItem value="6">6 months</SelectItem>
                          <SelectItem value="12">12 months</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} tickFormatter={v => assessmentField ? `${(v/1000).toFixed(0)}k` : String(v)} />
                      <Tooltip
                        contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8 }}
                        labelStyle={{ color: "#e2e8f0" }}
                        formatter={(value: any, name: string) => [
                          assessmentField ? fmtR(Number(value)) : String(value),
                          name
                        ]}
                      />
                      <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                      {settings.technicians.filter(t => t.active).map((tech, idx) => (
                        <Line
                          key={tech.id}
                          type="monotone"
                          dataKey={tech.name.split(" ")[0]}
                          stroke={tech.color || CHART_COLORS[idx % CHART_COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 4 }}
                          activeDot={{ r: 6 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── COMPARISON TAB ───────────────────────────────────────────────── */}
        {tab === "comparison" && (
          <div className="p-6 space-y-6">
            {/* Month selection controls */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-sm font-semibold text-foreground/80 mb-3">Month Comparison</h2>

              <div className="flex flex-wrap gap-3 mb-4">
                {comparisonMonths.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No months selected for comparison. Add months below.</div>
                ) : (
                  comparisonMonths.map(({ year, month }) => {
                    const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    return (
                      <div key={`${year}-${month}`} className="bg-muted border border-border rounded-lg p-2 flex items-center gap-2">
                        <span className="text-sm text-foreground">{monthName}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400"
                          onClick={() => removeComparisonMonth(year, month)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
              
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  className="border-border text-foreground/80"
                  onClick={addCurrentMonthToComparison}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Current Month 
                  <span className="ml-1.5 text-muted-foreground text-xs">({selectedMonthName})</span>
                </Button>
                
                <Button
                  variant="outline"
                  className="border-border text-foreground/80"
                  onClick={() => setIsAddingComparisonMonth(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Another Month
                </Button>
                
                {isAddingComparisonMonth && (
                  <div className="flex items-center gap-2 ml-2">
                    <Select 
                      value={String(new Date().getFullYear())} 
                      onValueChange={(v) => {
                        const year = parseInt(v);
                        const month = new Date().getMonth() - 1;
                        addMonthToComparison(year, month >= 0 ? month : 11);
                      }}
                    >
                      <SelectTrigger className="w-28 h-8 bg-card border-border">
                        <SelectValue placeholder="Year" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({length: 3}, (_, i) => new Date().getFullYear() - i).map(year => (
                          <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select 
                      value="0" 
                      onValueChange={(v) => {
                        const year = new Date().getFullYear();
                        const month = parseInt(v);
                        addMonthToComparison(year, month);
                      }}
                    >
                      <SelectTrigger className="w-32 h-8 bg-card border-border">
                        <SelectValue placeholder="Month" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({length: 12}, (_, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {new Date(2000, i).toLocaleDateString('en-US', { month: 'long' })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setIsAddingComparisonMonth(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
            
            {comparisonMonths.length > 0 ? (
              <>
                {/* Comparison table */}
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-muted">
                        <th className="text-left py-2 px-4 text-foreground/80 font-medium text-sm">Technician</th>
                        {comparisonStats.map(({ monthName }) => (
                          <th key={monthName} className="text-center py-2 px-4 text-foreground/80 font-medium text-sm">
                            {monthName}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {settings.technicians.filter(t => t.active).map(tech => (
                        <tr key={tech.id} className="border-t border-border">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div 
                                className="h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                style={{ background: tech.color || "#6366f1" }}
                              >
                                {tech.name.charAt(0).toUpperCase()}
                              </div>
                              <span className="font-medium text-foreground">{tech.name}</span>
                            </div>
                          </td>
                          {comparisonStats.map(({ monthName, stats }) => {
                            const techStat = stats.find(s => s.tech.id === tech.id);
                            const amount = techStat?.amountThisMonth || 0;
                            const target = tech.monthlyTarget || 0;
                            const achievement = target > 0 ? Math.round((amount / target) * 100) : 0;
                            return (
                              <td key={monthName} className="py-2 px-4 text-center">
                                <div className="space-y-1">
                                  <div className="flex flex-col">
                                    <span className="text-lg font-bold text-indigo-300">{fmtR(amount)}</span>
                                    <span className="text-[10px] text-muted-foreground">{assessmentField?.name || "Amount"}</span>
                                  </div>
                                  <div className="flex flex-col mt-1">
                                    <span className="text-sm">{techStat?.completed || 0}</span>
                                    <span className="text-[10px] text-muted-foreground">Jobs Completed</span>
                                  </div>
                                  <div className="mt-2">
                                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                                      <span>{fmtR(amount)} / {fmtR(target)}</span>
                                      <span>{achievement}%</span>
                                    </div>
                                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${achievement >= 100 ? "bg-green-500" : achievement >= 70 ? "bg-yellow-500" : "bg-red-500"}`}
                                        style={{ width: `${Math.min(achievement, 100)}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* Comparison Chart */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h2 className="text-sm font-semibold text-foreground/80 mb-4">
                    Performance Comparison
                    <span className="text-xs font-normal text-muted-foreground ml-2">
                      ({assessmentField ? assessmentField.name : "Amount"})
                    </span>
                  </h2>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart 
                      data={settings.technicians
                        .filter(t => t.active)
                        .map(tech => {
                          const data: any = {
                            name: tech.name.split(" ")[0],
                          };
                          comparisonStats.forEach(({ monthName, stats }) => {
                            const techStat = stats.find(s => s.tech.id === tech.id);
                            data[monthName] = techStat?.amountThisMonth || 0;
                          });
                          return data;
                        })}
                      margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} tickFormatter={v => `R${(v/1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8 }}
                        labelStyle={{ color: "#e2e8f0" }}
                        formatter={(value: any) => [fmtR(Number(value)), ""]}
                      />
                      <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                      {comparisonStats.map(({ monthName }, index) => (
                        <Bar 
                          key={monthName}
                          dataKey={monthName} 
                          fill={CHART_COLORS[index % CHART_COLORS.length]} 
                          radius={[3, 3, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <BarChart2 className="h-12 w-12 opacity-40 mb-4" />
                <p className="text-lg">No months selected for comparison.</p>
                <p className="text-sm mb-6">Add months above to see a comparison.</p>
                <Button
                  variant="outline"
                  className="border-border text-foreground/80"
                  onClick={addCurrentMonthToComparison}
                >
                  <Plus className="h-3.5 w-3.5 mr-2" /> Add Current Month ({selectedMonthName})
                </Button>
              </div>
            )}
          </div>
        )}
        
        {/* ── SETTINGS TAB ─────────────────────────────────────────────────── */}
        {tab === "settings" && (
          <div className="p-6 space-y-8 max-w-2xl">

            {/* Assessment Field picker */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-indigo-400" /> Assessment Field
              </h2>
              <p className="text-xs text-muted-foreground">
                Choose the custom field whose value is summed to measure each technician's monthly performance.
                The technician's target should be set in the same currency/unit as this field.
              </p>
              {allCustomFields.length === 0 ? (
                <p className="text-xs text-yellow-400">No custom fields found on your lists yet.</p>
              ) : (
                <Select
                  value={settings.assessmentFieldId || "__none__"}
                  onValueChange={v => setSettings(prev => ({ ...prev, assessmentFieldId: v === "__none__" ? undefined : v }))}
                >
                  <SelectTrigger className="bg-card border-border text-foreground">
                    <SelectValue placeholder="Select a custom field…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None (count completed jobs) —</SelectItem>
                    {allCustomFields.map(f => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name} <span className="text-muted-foreground text-xs ml-1">({f.type})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Completed Date Field picker */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Hash className="h-4 w-4 text-green-400" /> Completion Date Field
              </h2>
              <p className="text-xs text-muted-foreground">
                Choose the custom date field that indicates when a job was completed.
                This determines which month a job counts towards. If not set, uses the task creation date.
              </p>
              {allCustomFields.length === 0 ? (
                <p className="text-xs text-yellow-400">No custom fields found on your lists yet.</p>
              ) : (
                <Select
                  value={settings.completedDateFieldId || "__none__"}
                  onValueChange={v => setSettings(prev => ({ ...prev, completedDateFieldId: v === "__none__" ? undefined : v }))}
                >
                  <SelectTrigger className="bg-card border-border text-foreground">
                    <SelectValue placeholder="Select a date field…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None (use creation date) —</SelectItem>
                    {allCustomFields.filter(f => f.type === 'date').map(f => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Add technician */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Users className="h-4 w-4 text-indigo-400" /> Technicians
              </h2>

              {/* Existing technicians */}
              <div className="space-y-2">
                {settings.technicians.length === 0 && (
                  <p className="text-sm text-muted-foreground">No technicians added yet.</p>
                )}
                {settings.technicians.map(tech => (
                  <div key={tech.id} className="flex items-center gap-3 bg-muted/50 rounded-lg px-3 py-2">
                    <div className="h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: tech.color || "#6366f1" }}>
                      {tech.name.charAt(0).toUpperCase()}
                    </div>
                    {editingId === tech.id ? (
                      <>
                        <Input
                          value={tech.name}
                          onChange={e => updateTechnician(tech.id, "name", e.target.value)}
                          className="h-7 text-sm bg-card border-border text-foreground flex-1"
                        />
                        <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                          <span>R</span>
                          <Input
                            type="number" min={1}
                            value={tech.monthlyTarget}
                            onChange={e => updateTechnician(tech.id, "monthlyTarget", Number(e.target.value) || 1)}
                            className="h-7 w-24 text-sm bg-card border-border text-foreground"
                          />
                        </div>
                        <Button size="sm" variant="ghost" className="h-7 text-green-400" onClick={() => setEditingId(null)}>
                          <Save className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-foreground">{tech.name}</span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Target className="h-3 w-3" /> {fmtR(tech.monthlyTarget)}/mo
                        </span>
                        <button
                          className={`text-xs px-2 py-0.5 rounded ${tech.active ? "text-green-400" : "text-muted-foreground"}`}
                          onClick={() => updateTechnician(tech.id, "active", !tech.active)}
                        >
                          {tech.active ? "Active" : "Inactive"}
                        </button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => setEditingId(tech.id)}>
                          <Settings className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:text-red-400" onClick={() => removeTechnician(tech.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Add new */}
              <div className="flex gap-2 pt-2 border-t border-border">
                <Input
                  placeholder="Technician name"
                  value={newTechName}
                  onChange={e => setNewTechName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addTechnician()}
                  className="flex-1 h-8 text-sm bg-card border-border text-foreground placeholder:text-muted-foreground"
                />
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span>R</span>
                  <Input
                    type="number" min={1}
                    value={newTechTarget}
                    onChange={e => setNewTechTarget(Number(e.target.value) || 1)}
                    className="w-24 h-8 text-sm bg-card border-border text-foreground"
                    placeholder="target"
                  />
                  <span className="whitespace-nowrap">/mo</span>
                </div>
                <Button size="sm" onClick={addTechnician} disabled={!newTechName.trim()}
                  className="h-8 bg-indigo-600 hover:bg-indigo-700 text-white">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              </div>
            </div>

            {/* Completed statuses */}
            {allStatuses.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-400" /> Completed Statuses
                </h2>
                <p className="text-xs text-muted-foreground">
                  Select which task statuses count as "completed" for assessment. If none selected, the system auto-detects (done, complete, paid, collected).
                </p>
                <div className="flex flex-wrap gap-2">
                  {allStatuses.map(s => {
                    const active = settings.completedStatusIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleCompletedStatus(s.id)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          active
                            ? "bg-green-600 border-green-500 text-white"
                            : "bg-muted border-border text-foreground/80 hover:border-border/60"
                        }`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Save */}
            <Button onClick={handleSaveSettings} disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 text-white w-full md:w-auto">
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        )}
      </div>

      {/* Job List Dialog */}
      <Dialog open={showJobList} onOpenChange={setShowJobList}>
        <DialogContent className="max-w-3xl max-h-[80vh] bg-background border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                style={{ background: selectedTech?.color || "#6366f1" }}>
                {selectedTech?.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="text-lg font-semibold">{selectedTech?.name}</div>
                <div className="text-sm text-muted-foreground font-normal">
                  {selectedTechJobs.length} completed jobs in {selectedMonthName}
                </div>
              </div>
            </DialogTitle>
          </DialogHeader>
          
          <div className="overflow-y-auto max-h-[60vh] space-y-2 pr-2">
            {selectedTechJobs.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No completed jobs found for this technician in {selectedMonthName}.
              </div>
            ) : (
              selectedTechJobs.map(job => {
                const fieldValue = settings.assessmentFieldId
                  ? (job.customFieldValues || []).find(v => v.fieldId === settings.assessmentFieldId)
                  : null;
                const amount = fieldValue ? Number(fieldValue.value) || 0 : 0;
                const statusLabel = getStatusLabel(job);
                
                return (
                  <div
                    key={job.id}
                    onClick={(e) => handleJobClick(job, e)}
                    className="bg-card hover:bg-muted border border-border hover:border-indigo-500 rounded-lg p-4 cursor-pointer transition-all group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {job.jobNumber && (
                            <Badge className="bg-indigo-600 text-white text-xs font-mono shrink-0">
                              #{job.jobNumber}
                            </Badge>
                          )}
                          <span className="font-medium text-foreground truncate">{job.title}</span>
                          <Badge variant="outline" className="text-xs border-border text-muted-foreground shrink-0">
                            {statusLabel}
                          </Badge>
                        </div>
                        {job.description && (
                          <p className="text-sm text-muted-foreground line-clamp-1">{job.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span>Created: {new Date(job.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {amount > 0 && (
                          <div className="text-right">
                            <div className="text-lg font-bold text-indigo-300">{fmtR(amount)}</div>
                            <div className="text-[10px] text-muted-foreground">{assessmentField?.name || "Value"}</div>
                          </div>
                        )}
                        <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-indigo-400 transition-colors" />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
