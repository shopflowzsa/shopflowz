import { useState } from "react";
import { Search, AlertTriangle, Info, RefreshCw, ImageIcon, CheckCircle, History, RotateCcw, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Task, WorkspaceState } from "@/types/crm";
import { recompressAllWorkspacePhotos, RecompressProgress } from "@/lib/photoService";
import { getRecentDeletedTasks, searchAuditLogs, logTaskRestored, TaskAuditEntry } from "@/lib/auditService";
import { supabase } from "@/lib/supabase";
import { loadWorkspaceState } from "@/lib/workspaceService";

interface TaskRecoveryPanelProps {
  workspace: WorkspaceState;
  workspaceId: string;
  onTaskRestore?: (task: Task) => void;
  onUpdateTask?: (task: Task) => void;
  onBatchUpdateTasks?: (tasks: Task[]) => void;
  onClose: () => void;
}

export function TaskRecoveryPanel({ workspace, workspaceId, onTaskRestore, onUpdateTask, onBatchUpdateTasks, onClose }: TaskRecoveryPanelProps) {
  const [searchQuery, setSearchQuery] = useState("JBL");

  // ── Photo compression state ──────────────────────────────────────────────
  type CompressState = "idle" | "running" | "done" | "error";
  const [compressState, setCompressState] = useState<CompressState>("idle");
  const [compressProgress, setCompressProgress] = useState<RecompressProgress | null>(null);
  const [compressSummary, setCompressSummary] = useState<string>("");

  // ── CRM client photo fix state ───────────────────────────────────────
  type CrmPhotoFixState = "idle" | "loading-workspaces" | "ready" | "running" | "done" | "error";
  const [crmPhotoState, setCrmPhotoState] = useState<CrmPhotoFixState>("idle");
  const [crmWorkspaces, setCrmWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [crmTargetId, setCrmTargetId] = useState<string>("");
  const [crmProgress, setCrmProgress] = useState<RecompressProgress | null>(null);
  const [crmSummary, setCrmSummary] = useState("");

  const loadCrmWorkspaces = async () => {
    setCrmPhotoState("loading-workspaces");
    try {
      const { data: wsRows } = await supabase.from('workspaces').select('id, name');
      const { data: memberRows } = await supabase.from('workspace_members').select('workspace_id, email, role');

      const list = (wsRows || [])
        .filter(w => w.id !== workspaceId)
        .map(w => {
          const ownerMember = (memberRows || []).find(m => m.workspace_id === w.id && m.role === 'owner');
          const label = ownerMember?.email
            ? `${w.name || 'Unnamed Workspace'} — ${ownerMember.email}`
            : (w.name || 'Unnamed Workspace');
          return { id: w.id, name: label };
        });

      setCrmWorkspaces(list);
      setCrmPhotoState("ready");
    } catch (err) {
      setCrmSummary(`Failed to load workspaces: ${err instanceof Error ? err.message : String(err)}`);
      setCrmPhotoState("error");
    }
  };

  const runCrmPhotoFix = async () => {
    if (!crmTargetId) return;
    setCrmPhotoState("running");
    setCrmProgress(null);
    setCrmSummary("");
    try {
      const targetState = await loadWorkspaceState(crmTargetId);
      const { tasks: updatedTasks, totalSavedBytes } = await recompressAllWorkspacePhotos(
        crmTargetId,
        targetState.tasks ?? [],
        (p) => setCrmProgress(p)
      );
      const photoCount = (targetState.tasks ?? []).reduce(
        (sum, t) => sum + (t.photos?.filter(p => p.includes("firebasestorage")).length ?? 0),
        0
      );
      const savedMB = (totalSavedBytes / (1024 * 1024)).toFixed(2);
      const savedKB = (totalSavedBytes / 1024).toFixed(0);
      const savedDisplay = totalSavedBytes > 1024 * 1024 ? `${savedMB} MB` : `${savedKB} KB`;
      setCrmSummary(
        totalSavedBytes > 0
          ? `Done — ${photoCount} photo(s) migrated, ${updatedTasks.length} tasks updated, saved ${savedDisplay}.`
          : `Done — ${photoCount} photo(s) processed. All already on Cloudinary or no photos found.`
      );
      setCrmPhotoState("done");
    } catch (err) {
      setCrmSummary(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setCrmPhotoState("error");
    }
  };

  // ── Audit log state ──────────────────────────────────────────────────
  const [auditQuery, setAuditQuery] = useState("");
  const [auditLogs, setAuditLogs] = useState<TaskAuditEntry[]>([]);
  const [isLoadingAudits, setIsLoadingAudits] = useState(false);
  const [recentDeleted, setRecentDeleted] = useState<TaskAuditEntry[]>([]);

  const handleCompressOldPhotos = async () => {
    setCompressState("running");
    setCompressProgress(null);
    setCompressSummary("");
    try {
      const { tasks: updatedTasks, totalSavedBytes } = await recompressAllWorkspacePhotos(
        workspaceId,
        workspace.tasks ?? [],
        (p) => setCompressProgress(p)
      );
      // Propagate all changed tasks to the parent in ONE batch to avoid race conditions
      const originalById = Object.fromEntries((workspace.tasks ?? []).map(t => [t.id, t]));
      const changedTasks = updatedTasks.filter(
        t => JSON.stringify(t.photos) !== JSON.stringify(originalById[t.id]?.photos)
      );
      if (changedTasks.length > 0) {
        if (onBatchUpdateTasks) {
          onBatchUpdateTasks(changedTasks);
        } else if (onUpdateTask) {
          // Fallback: shouldn't be hit in practice due to race condition, but kept for safety
          changedTasks.forEach(t => onUpdateTask(t));
        }
      }
      const photoCount = (workspace.tasks ?? []).reduce(
        (sum, t) => sum + (t.photos?.filter(p => p.includes("firebasestorage")).length ?? 0),
        0
      );
      const savedMB = (totalSavedBytes / (1024 * 1024)).toFixed(2);
      const savedKB = (totalSavedBytes / 1024).toFixed(0);
      const savedDisplay = totalSavedBytes > 1024 * 1024 ? `${savedMB} MB` : `${savedKB} KB`;
      setCompressSummary(
        totalSavedBytes > 0
          ? `Done — ${photoCount} photo(s) recompressed, saved ${savedDisplay} of storage.`
          : `Done — ${photoCount} photo(s) processed (already optimised or could not be compressed).`
      );
      setCompressState("done");
    } catch (err) {
      setCompressSummary(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setCompressState("error");
    }
  };

  // ── Audit log functions ──────────────────────────────────────────────────
  const loadRecentDeletedTasks = async () => {
    setIsLoadingAudits(true);
    try {
      const deleted = await getRecentDeletedTasks(workspaceId, 50);
      setRecentDeleted(deleted);
    } catch (error) {
      console.error("Failed to load recent deleted tasks:", error);
    } finally {
      setIsLoadingAudits(false);
    }
  };

  const searchAuditHistory = async (query: string) => {
    setIsLoadingAudits(true);
    try {
      const logs = await searchAuditLogs(workspaceId, query, 100);
      setAuditLogs(logs);
    } catch (error) {
      console.error("Failed to search audit logs:", error);
    } finally {
      setIsLoadingAudits(false);
    }
  };

  const restoreTaskFromAudit = async (auditEntry: TaskAuditEntry) => {
    if (!auditEntry.taskData || !onTaskRestore) return;
    
    try {
      // Restore the task to workspace
      onTaskRestore(auditEntry.taskData);
      
      // Log the restoration
      await logTaskRestored(workspaceId, auditEntry.taskData, 'User', auditEntry.id);
      
      // Refresh audit logs
      if (auditQuery) {
        await searchAuditHistory(auditQuery);
      } else {
        await loadRecentDeletedTasks();
      }
    } catch (error) {
      console.error("Failed to restore task:", error);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  const [searchResults, setSearchResults] = useState<{
    foundTasks: Task[];
    gaps: number[];
    duplicates: { [key: string]: Task[] };
    analysis: string[];
  } | null>(null);

  const analyzeTasksForMissing = (query: string) => {
    const foundTasks: Task[] = [];
    const jobNumbers: number[] = [];
    const jobMap: { [key: string]: Task[] } = {};

    // Search through all tasks
    workspace.tasks?.forEach(task => {
      // Direct search match
      if (
        task.jobNumber?.includes(query) ||
        task.title.toLowerCase().includes(query.toLowerCase()) ||
        task.id.includes(query)
      ) {
        foundTasks.push(task);
      }

      // Collect job numbers for gap analysis
      if (task.jobNumber) {
        const numMatch = task.jobNumber.match(/(\d+)/);
        if (numMatch) {
          const num = parseInt(numMatch[1]);
          if (!isNaN(num)) {
            jobNumbers.push(num);
            
            // Track duplicates
            if (jobMap[task.jobNumber]) {
              jobMap[task.jobNumber].push(task);
            } else {
              jobMap[task.jobNumber] = [task];
            }
          }
        }
      }
    });

    // Find gaps in job sequence
    jobNumbers.sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 0; i < jobNumbers.length - 1; i++) {
      const current = jobNumbers[i];
      const next = jobNumbers[i + 1];
      for (let gap = current + 1; gap < next; gap++) {
        gaps.push(gap);
      }
    }

    // Find duplicates
    const duplicates: { [key: string]: Task[] } = {};
    Object.entries(jobMap).forEach(([jobNumber, tasks]) => {
      if (tasks.length > 1) {
        duplicates[jobNumber] = tasks;
      }
    });

    // Generate analysis
    const analysis: string[] = [];
    
    if (foundTasks.length === 0) {
      analysis.push(`❌ No tasks found matching "${query}"`);
    } else {
      analysis.push(`✅ Found ${foundTasks.length} tasks matching "${query}"`);
    }

    const queryNum = parseInt(query);
    if (!isNaN(queryNum) && gaps.includes(queryNum)) {
      analysis.push(`🕳️ Job number ${queryNum} appears to be missing from the sequence`);
    }

    if (Object.keys(duplicates).length > 0) {
      analysis.push(`⚠️ Found ${Object.keys(duplicates).length} duplicate job numbers`);
    }

    analysis.push(`📊 Total tasks: ${workspace.tasks?.length || 0}`);
    analysis.push(`📊 Job counter: ${workspace.jobCounter || 0}`);
    
    if (gaps.length > 0) {
      const nearbyGaps = gaps.filter(g => Math.abs(g - queryNum) <= 10);
      if (nearbyGaps.length > 0) {
        analysis.push(`🔍 Nearby missing job numbers: ${nearbyGaps.join(', ')}`);
      }
    }

    setSearchResults({
      foundTasks,
      gaps: gaps.filter(g => Math.abs(g - queryNum) <= 20), // Show relevant gaps
      duplicates,
      analysis
    });
  };

  const getJobNumber = (task: Task): number => {
    if (!task.jobNumber) return 0;
    const match = task.jobNumber.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Task Recovery Tool
            </CardTitle>
            <Button variant="ghost" onClick={onClose}>
              ×
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              This tool helps locate missing tasks and analyze potential data loss. 
              <strong> If you deleted one duplicate and both disappeared, check the "Missing Job Numbers" section below.</strong>
              For recent deletions, also check Activity Monitor in the sidebar.
            </AlertDescription>
          </Alert>

          {/* ── Compress old photos ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Compress Existing Photos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Downloads every existing photo, re-encodes it to the best format your browser supports
                (AVIF → WebP → JPEG) at max 1200 px, and re-uploads it. Old files are deleted automatically.
                Typically reduces storage by 50–75%. This is a one-way operation.
              </p>
              {compressState === "idle" && (
                <Button onClick={handleCompressOldPhotos} variant="outline">
                  <ImageIcon className="h-4 w-4 mr-2" />
                  Start Compression
                </Button>
              )}
              {compressState === "running" && (
                <div className="space-y-2">
                  <p className="text-sm">
                    {compressProgress
                      ? `Processing (${compressProgress.current}/${compressProgress.total}): ${compressProgress.taskTitle}${
                          compressProgress.savedBytes > 0
                            ? ` — saved ${(compressProgress.savedBytes / 1024).toFixed(0)} KB so far`
                            : ""
                        }`
                      : "Starting…"}
                  </p>
                  {compressProgress && compressProgress.total > 0 && (
                    <Progress value={(compressProgress.current / compressProgress.total) * 100} />
                  )}
                </div>
              )}
              {(compressState === "done" || compressState === "error") && (
                <div className="space-y-2">
                  <div className={`flex items-center gap-2 text-sm ${
                    compressState === "done" ? "text-green-600" : "text-destructive"
                  }`}>
                    {compressState === "done" && <CheckCircle className="h-4 w-4" />}
                    {compressSummary}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setCompressState("idle"); setCompressSummary(""); setCompressProgress(null); }}
                  >
                    Run Again
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Fix CRM Client Photos ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Fix CRM Client Photos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Run photo migration for a CRM client workspace (e.g. Speedo Computers).
                Migrates old Firebase Storage photos to Cloudinary and generates thumbnails to fix lagging and missing images.
              </p>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <strong>Important:</strong> Due to Firebase Storage security, this migration must be run by the CRM client themselves from their own login session.
                Ask the Speedo Computers owner to log in and use <strong>Settings → Tools → Compress Existing Photos</strong> to migrate their photos.
              </div>
              {crmPhotoState === "idle" && (
                <Button onClick={loadCrmWorkspaces} variant="outline">
                  <Building2 className="h-4 w-4 mr-2" />
                  Load CRM Workspaces
                </Button>
              )}
              {crmPhotoState === "loading-workspaces" && (
                <p className="text-sm text-muted-foreground">Loading workspaces…</p>
              )}
              {(crmPhotoState === "ready" || crmPhotoState === "running") && (
                <div className="space-y-3">
                  <Select value={crmTargetId} onValueChange={setCrmTargetId} disabled={crmPhotoState === "running"}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a client workspace…" />
                    </SelectTrigger>
                    <SelectContent>
                      {crmWorkspaces.map(w => (
                        <SelectItem key={w.id} value={w.id}>{w.name} ({w.id})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {crmPhotoState === "ready" && (
                    <Button onClick={runCrmPhotoFix} disabled={!crmTargetId} variant="outline">
                      <ImageIcon className="h-4 w-4 mr-2" />
                      Start Photo Fix
                    </Button>
                  )}
                  {crmPhotoState === "running" && (
                    <div className="space-y-2">
                      <p className="text-sm">
                        {crmProgress
                          ? `Processing (${crmProgress.current}/${crmProgress.total}): ${crmProgress.taskTitle}${
                              crmProgress.savedBytes > 0
                                ? ` — saved ${(crmProgress.savedBytes / 1024).toFixed(0)} KB so far`
                                : ""
                            }`
                          : "Loading workspace tasks…"}
                      </p>
                      {crmProgress && crmProgress.total > 0 && (
                        <Progress value={(crmProgress.current / crmProgress.total) * 100} />
                      )}
                    </div>
                  )}
                </div>
              )}
              {(crmPhotoState === "done" || crmPhotoState === "error") && (
                <div className="space-y-2">
                  <div className={`flex items-center gap-2 text-sm ${
                    crmPhotoState === "done" ? "text-green-600" : "text-destructive"
                  }`}>
                    {crmPhotoState === "done" && <CheckCircle className="h-4 w-4" />}
                    {crmSummary}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setCrmPhotoState("ready"); setCrmSummary(""); setCrmProgress(null); }}
                  >
                    Run Again
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Audit Log Viewer ────────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <History className="h-5 w-5" />
                Audit Log & Task Recovery
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={auditQuery}
                  onChange={(e) => setAuditQuery(e.target.value)}
                  placeholder="Search audit logs by job number, title, or task ID..."
                  className="flex-1"
                />
                <Button 
                  onClick={() => searchAuditHistory(auditQuery)} 
                  disabled={isLoadingAudits}
                >
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </Button>
                <Button 
                  onClick={loadRecentDeletedTasks} 
                  variant="outline"
                  disabled={isLoadingAudits}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Recent Deleted
                </Button>
              </div>

              {isLoadingAudits && (
                <div className="text-sm text-muted-foreground">Loading audit logs...</div>
              )}

              {/* Recent Deleted Tasks */}
              {recentDeleted.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">Recently Deleted Tasks</h3>
                  {recentDeleted.map(entry => (
                    <div key={entry.id} className="flex items-center justify-between p-3 border rounded bg-red-50">
                      <div className="flex-1">
                        <div className="font-medium text-sm">
                          {entry.taskData?.title || 'Unknown Task'}
                          {entry.taskData?.jobNumber && (
                            <Badge variant="outline" className="ml-2">
                              {entry.taskData.jobNumber}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Deleted {new Date(entry.timestamp).toLocaleString()} by {entry.userId}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Reason: {entry.metadata?.reason || 'Manual deletion'}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => restoreTaskFromAudit(entry)}
                        className="ml-2"
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Restore
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Search Results */}
              {auditLogs.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">Audit Search Results</h3>
                  {auditLogs.map(entry => (
                    <div key={entry.id} className="flex items-center justify-between p-3 border rounded">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={entry.action === 'delete' ? 'destructive' : 
                                       entry.action === 'create' ? 'default' : 'secondary'}>
                            {entry.action}
                          </Badge>
                          <span className="font-medium text-sm">
                            {entry.taskData?.title || 'Unknown Task'}
                          </span>
                          {entry.taskData?.jobNumber && (
                            <Badge variant="outline">
                              {entry.taskData.jobNumber}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(entry.timestamp).toLocaleString()} by {entry.userId}
                        </div>
                        {entry.metadata && (
                          <div className="text-xs text-muted-foreground">
                            {entry.metadata.reason && `Reason: ${entry.metadata.reason}`}
                          </div>
                        )}
                      </div>
                      {entry.action === 'delete' && entry.taskData && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => restoreTaskFromAudit(entry)}
                          className="ml-2"
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Restore
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!isLoadingAudits && auditQuery && auditLogs.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No audit logs found for "{auditQuery}"
                </div>
              )}

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  <strong>Audit System:</strong> All task operations (create, update, delete) are automatically 
                  logged for recovery. Use this panel to search for and restore accidentally deleted tasks.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter job number, task title, or task ID to search..."
              className="flex-1"
            />
            <Button onClick={() => analyzeTasksForMissing(searchQuery)}>
              <Search className="h-4 w-4 mr-2" />
              Search & Analyze
            </Button>
          </div>

          {searchResults && (
            <div className="space-y-4">
              {/* Analysis Results */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Analysis Results</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    {searchResults.analysis.map((line, i) => (
                      <div key={i} className="font-mono">
                        {line}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Found Tasks */}
              {searchResults.foundTasks.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Found Tasks</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {searchResults.foundTasks.map(task => (
                        <div key={task.id} className="flex items-center justify-between p-2 border rounded">
                          <div>
                            <div className="font-medium">
                              {task.jobNumber && (
                                <Badge variant="outline" className="mr-2">{task.jobNumber}</Badge>
                              )}
                              {task.title}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              ID: {task.id} | List: {task.listId} | Created: {task.createdAt}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Badge variant={task.status === 'done' ? 'secondary' : 'outline'}>
                              {task.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Missing Job Numbers */}
              {searchResults.gaps.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Missing Job Numbers (Gaps in Sequence)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {searchResults.gaps.map(gap => (
                        <Badge key={gap} variant="destructive">
                          JOB-{String(gap).padStart(4, '0')}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      These job numbers are missing from the sequence. They may have been deleted or lost due to deduplication.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Duplicates */}
              {Object.keys(searchResults.duplicates).length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Duplicate Job Numbers</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(searchResults.duplicates).map(([jobNumber, tasks]) => (
                        <div key={jobNumber} className="p-2 border rounded">
                          <div className="font-medium text-amber-600">
                            {jobNumber} ({tasks.length} copies)
                          </div>
                          {tasks.map(task => (
                            <div key={task.id} className="text-sm text-muted-foreground ml-4">
                              • {task.title} (ID: {task.id})
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Console Log Instructions */}
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  <strong>Check Browser Console:</strong> Open Developer Tools (F12) and check the Console tab for any 
                  "[Dedup] Removing duplicate task" messages. These logs show which tasks were automatically removed.
                </AlertDescription>
              </Alert>

              {/* Recovery Instructions for Duplicate Deletion */}
              <Card className="border-amber-200">
                <CardHeader>
                  <CardTitle className="text-sm text-amber-700">Recovery Steps for Lost Duplicates</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  <div className="space-y-1">
                    <p><strong>1. Check Activity Monitor:</strong> Click "Activity" in sidebar to see recent task changes</p>
                    <p><strong>2. Check missing job numbers above:</strong> Look for gaps that match your JBL Extreme 4 timing</p>
                    <p><strong>3. Check Browser Console:</strong> Look for deduplication logs showing deleted task details</p>
                    <p><strong>4. Manual Recreation:</strong> If completely lost, create a new task with the same details:</p>
                    <div className="ml-4 space-y-1 text-xs">
                      <p>• Use the missing job number from the gaps above</p>
                      <p>• Title: "JBL Extreme 4" + repair details</p>
                      <p>• Add customer information in custom fields</p>
                      <p>• Set appropriate status and priority</p>
                    </div>
                  </div>
                  <Alert className="mt-3">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      <strong>Prevention:</strong> In the future, use the 3-dot menu on task cards to safely delete individual duplicates instead of bulk actions.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}