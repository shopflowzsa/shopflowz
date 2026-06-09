import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Search, X, ArrowRight } from "lucide-react";
import { Task, WorkspaceState, DEFAULT_STATUSES } from "@/types/crm";

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  workspace: WorkspaceState;
  onOpenTask: (task: Task) => void;
  initialQuery?: string;
}

// Status dot colour map
const STATUS_COLORS: Record<string, string> = {
  to_do:      "bg-gray-400",
  in_progress:"bg-blue-500",
  review:     "bg-yellow-400",
  done:       "bg-green-500",
  quoted:     "bg-blue-300",
  invoiced:   "bg-purple-500",
  paid:       "bg-green-400",
  complete:   "bg-gray-500",
};

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  const weeks = Math.floor(days / 7);
  const months= Math.floor(days / 30);
  if (mins  < 1)   return "just now";
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  if (weeks < 5)   return `${weeks}w ago`;
  return `${months}mo ago`;
}

/** Highlight every occurrence of `term` inside `text` */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5">{part}</mark>
        ) : (
          part
        )
      )}
    </>
  );
}

export function GlobalSearchModal({ open, onClose, workspace, onOpenTask, initialQuery = "" }: GlobalSearchModalProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Helper function to get status label for a task using its list's custom statuses
  const getTaskStatusLabel = useCallback((task: Task): string => {
    const taskList = workspace.lists.find(l => l.id === task.listId);
    const statuses = taskList?.customStatuses && taskList.customStatuses.length > 0 
      ? taskList.customStatuses 
      : DEFAULT_STATUSES;
    return statuses.find(s => s.id === task.status)?.label || "";
  }, [workspace.lists]);

  // Focus input when opened; seed query from a barcode scan if provided
  useEffect(() => {
    if (open) {
      setQuery(initialQuery || "");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, initialQuery]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const listMap = useMemo(() => {
    const m: Record<string, string> = {};
    workspace.lists.forEach(l => { m[l.id] = l.name; });
    return m;
  }, [workspace.lists]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workspace.tasks.slice(0, 12); // show recent when empty
    return workspace.tasks.filter(task => {
      if (task.title.toLowerCase().includes(q)) return true;
      if (task.jobNumber?.toLowerCase().includes(q)) return true;
      if (task.description?.toLowerCase().includes(q)) return true;
      if (task.assignee?.toLowerCase().includes(q)) return true;
      for (const fv of task.customFieldValues || []) {
        if (String(fv.value || "").toLowerCase().includes(q)) return true;
      }
      for (const c of task.comments || []) {
        if (c.text.toLowerCase().includes(q)) return true;
      }
      const statusLabel = getTaskStatusLabel(task);
      if (statusLabel.toLowerCase().includes(q)) return true;
      return false;
    }).slice(0, 20);
  }, [query, workspace.tasks]);

  // Reset active index when results change
  useEffect(() => setActiveIndex(0), [results]);

  // Scroll active item into view
  useEffect(() => {
    const item = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const task = results[activeIndex];
      if (task) { onOpenTask(task); onClose(); }
    }
  }, [results, activeIndex, onOpenTask, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl mx-4 bg-background border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Search input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, job numbers, assignees…"
            className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-block text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto max-h-[60vh] py-1">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No tasks found for "{query}"
            </div>
          ) : (
            <>
              {!query && (
                <div className="px-4 py-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Recent tasks
                </div>
              )}
              {query && (
                <div className="px-4 py-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  {results.length} result{results.length !== 1 ? "s" : ""}
                </div>
              )}
              {results.map((task, i) => {
                const listName = listMap[task.listId] ?? task.listId;
                const isActive = i === activeIndex;
                return (
                  <button
                    key={task.id}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      isActive ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => { onOpenTask(task); onClose(); }}
                  >
                    {/* Status dot */}
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${STATUS_COLORS[task.status] ?? "bg-gray-400"}`} />

                    {/* Title + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {task.jobNumber && (
                          <span className="text-xs text-muted-foreground font-mono shrink-0">{task.jobNumber}</span>
                        )}
                        <span className="text-sm font-medium truncate">
                          <Highlight text={task.title} term={query} />
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        in {listName}
                      </div>
                    </div>

                    {/* Time ago */}
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                      {timeAgo(task.createdAt)}
                    </span>

                    {/* Enter arrow on active */}
                    {isActive && (
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-xs text-muted-foreground">
          <span><kbd className="bg-muted px-1 rounded border border-border">↑↓</kbd> navigate</span>
          <span><kbd className="bg-muted px-1 rounded border border-border">↵</kbd> open</span>
          <span><kbd className="bg-muted px-1 rounded border border-border">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
