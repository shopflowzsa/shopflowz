import { Plus, Search, LayoutGrid, List as ListIcon, LogOut, ChevronLeft, ChevronRight, RotateCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { List, ViewMode } from "@/types/crm";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { MobileDownloadDialog } from "./MobileDownloadDialog";

interface CrmHeaderProps {
  currentList: List | null;
  breadcrumb: string[];
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchOpen?: () => void;
  onCreateTask: () => void;
  canEdit?: boolean;
  companyName?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onOpenAutomations?: () => void;
}

export function CrmHeader({
  currentList, breadcrumb, viewMode, onViewModeChange,
  searchQuery, onSearchChange, onSearchOpen, onCreateTask, canEdit = true, companyName,
  canGoBack = false, canGoForward = false, onBack, onForward, onRefresh, isRefreshing = false,
  onOpenAutomations,
}: CrmHeaderProps) {
  const { logout } = useAuth();

  return (
    <div className="border-b border-border">
      {companyName && (
        <div className="bg-sidebar px-4 py-2 text-center border-b border-sidebar-border">
          <span className="text-base font-extrabold tracking-widest uppercase text-sidebar-foreground">{companyName}</span>
        </div>
      )}
      <div className="bg-background px-3 py-2 flex items-center gap-2">

        {/* Left: Sidebar trigger + back/forward/refresh + breadcrumb */}
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <SidebarTrigger className="h-9 w-9 shrink-0" />

          {/* Back */}
          <button
            onClick={onBack}
            disabled={!canGoBack}
            title="Go back"
            className={cn(
              "p-1.5 rounded-md transition-colors",
              canGoBack
                ? "text-muted-foreground hover:text-foreground hover:bg-accent"
                : "text-muted-foreground/30 cursor-default"
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Forward */}
          <button
            onClick={onForward}
            disabled={!canGoForward}
            title="Go forward"
            className={cn(
              "p-1.5 rounded-md transition-colors",
              canGoForward
                ? "text-muted-foreground hover:text-foreground hover:bg-accent"
                : "text-muted-foreground/30 cursor-default"
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          {/* Refresh */}
          <button
            onClick={onRefresh}
            title="Refresh workspace data"
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mr-0.5"
          >
            <RotateCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </button>
          <div className="flex items-center gap-1 text-sm text-muted-foreground min-w-0 overflow-hidden">
            {breadcrumb.map((crumb, i) => (
              <span
                key={i}
                className={cn(
                  "flex items-center gap-1 shrink-0 last:shrink last:truncate",
                  i === breadcrumb.length - 1 ? "text-foreground font-medium" : "hidden sm:flex"
                )}
              >
                {i > 0 && <span className="text-border hidden sm:inline">/</span>}
                {crumb}
              </span>
            ))}
          </div>
        </div>

        {/* Center: Search trigger button — matches ClickUp style */}
        <div className="hidden sm:flex justify-center flex-1">
          <button
            onClick={onSearchOpen}
            className="flex items-center gap-2 w-full max-w-sm h-9 px-3 rounded-md border border-border bg-muted/40 hover:bg-muted text-sm text-muted-foreground transition-colors"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left truncate">Search all tasks…</span>
            <kbd className="hidden md:inline-flex items-center text-[10px] bg-background border border-border rounded px-1.5 py-0.5 shrink-0">⌘K</kbd>
          </button>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5 shrink-0 flex-1 justify-end">

          {/* Mobile search icon */}
          <button
            onClick={onSearchOpen}
            className="sm:hidden p-2 text-muted-foreground hover:text-foreground"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Automations */}
          {onOpenAutomations && currentList && (
            <button
              onClick={onOpenAutomations}
              title="Automations"
              className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-amber-600 hover:text-amber-500 border border-amber-500/40 hover:border-amber-500 rounded-md transition-colors"
            >
              <Zap className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Automations</span>
            </button>
          )}

          {/* View toggle */}
          <div className="flex items-center border border-border rounded-md overflow-hidden">
            <button
              onClick={() => onViewModeChange("board")}
              className={cn("p-2 transition-colors", viewMode === "board" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => onViewModeChange("list")}
              className={cn("p-2 transition-colors", viewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <ListIcon className="h-4 w-4" />
            </button>
          </div>

          {/* Mobile app download */}
          <div className="hidden md:block">
            <MobileDownloadDialog />
          </div>

          {/* Logout */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-destructive"
            title="Sign out"
            onClick={() => logout()}
          >
            <LogOut className="h-4 w-4" />
          </Button>

          {/* Create Task */}
          {canEdit && (
            <Button size="sm" className="h-9 gap-1.5 px-3" onClick={onCreateTask}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Task</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
