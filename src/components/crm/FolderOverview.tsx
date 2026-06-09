import { Folder, WorkspaceState } from "@/types/crm";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface FolderOverviewProps {
  folderId: string;
  workspace: WorkspaceState;
  onSelectList: (listId: string) => void;
  onCreateList?: (parentId: string, parentType: "folder" | "space") => void;
}

export function FolderOverview({ folderId, workspace, onSelectList, onCreateList }: FolderOverviewProps) {
  const folder = workspace.folders.find(f => f.id === folderId);
  const lists = workspace.lists.filter(l => l.parentId === folderId && l.parentType === "folder");

  if (!folder) return null;

  const getTaskCount = (listId: string) => workspace.tasks.filter(t => t.listId === listId).length;

  const getStatusBreakdown = (listId: string) => {
    const tasks = workspace.tasks.filter(t => t.listId === listId);
    const list = workspace.lists.find(l => l.id === listId);
    const statuses = list?.customStatuses ?? [];
    const counts: Record<string, number> = {};
    tasks.forEach(t => { counts[t.status] = (counts[t.status] ?? 0) + 1; });
    return { counts, statuses, total: tasks.length };
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-lg flex items-center justify-center"
              style={{ background: folder.color || "hsl(var(--warning))", opacity: 0.9 }}
            >
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{folder.name}</h1>
              <p className="text-sm text-muted-foreground">
                {lists.length} {lists.length === 1 ? "list" : "lists"} · {workspace.tasks.filter(t => lists.some(l => l.id === t.listId)).length} total tasks
              </p>
            </div>
          </div>
          {onCreateList && (
            <Button size="sm" onClick={() => onCreateList(folderId, "folder")}>
              <Plus className="h-4 w-4 mr-1.5" />
              New List
            </Button>
          )}
        </div>

        {/* Lists grid */}
        {lists.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-medium mb-1">No lists yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Create a list to start organising tasks in this folder</p>
            {onCreateList && (
              <Button variant="outline" size="sm" onClick={() => onCreateList(folderId, "folder")}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Create first list
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {lists.map((list) => {
              const { counts, statuses, total } = getStatusBreakdown(list.id);
              return (
                <button
                  key={list.id}
                  onClick={() => onSelectList(list.id)}
                  className="group text-left border border-border rounded-xl p-4 hover:border-primary/50 hover:bg-accent/30 transition-all"
                >
                  {/* List header */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xl">{list.icon || "📋"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">{list.name}</p>
                    </div>
                    <Badge variant="secondary" className="text-xs shrink-0">{total}</Badge>
                  </div>

                  {/* Status breakdown */}
                  {total > 0 ? (
                    <div className="space-y-1.5">
                      {statuses.length > 0
                        ? statuses.map(s => {
                            const count = counts[s.id] ?? 0;
                            if (count === 0) return null;
                            return (
                              <div key={s.id} className="flex items-center gap-2">
                                <div className="flex-1">
                                  <div className="flex items-center justify-between text-xs mb-0.5">
                                    <span className="text-muted-foreground truncate">{s.label}</span>
                                    <span className="font-medium ml-2">{count}</span>
                                  </div>
                                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-primary/60 transition-all"
                                      style={{ width: `${Math.round((count / total) * 100)}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        : Object.entries(counts).map(([status, count]) => (
                            <div key={status} className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground capitalize">{status.replace(/_/g, " ")}</span>
                              <span className="font-medium">{count}</span>
                            </div>
                          ))
                      }
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No tasks yet</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
