import { useState, useCallback, memo, useRef, useEffect } from "react";
import {
  DndContext, DragEndEvent, DragOverEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCorners,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Task, DEFAULT_STATUSES, PRIORITIES, TaskStatus, CustomFieldDefinition, StatusConfig } from "@/types/crm";
import { WorkspaceMember } from "@/types/auth";
import { cn } from "@/lib/utils";
import { Plus, Calendar, Trash2, CheckSquare, MoreHorizontal, CheckCheck, X, Edit, Copy, MoveRight, Archive, ArchiveRestore, ChevronDown, Settings2, UserPlus, Check, Clock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { LazyImage } from "@/components/ui/LazyImage";
import { useAuth } from "@/contexts/AuthContext";

const AVATAR_COLORS = ["bg-violet-500","bg-blue-500","bg-emerald-500","bg-amber-500","bg-rose-500","bg-pink-500","bg-teal-500","bg-indigo-500"];
function avatarColor(uid: string) { let h = 0; for (const c of uid) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return AVATAR_COLORS[h % AVATAR_COLORS.length]; }
function avatarInitials(name: string) { const p = name.trim().split(/\s+/); return p.length >= 2 ? (p[0][0]+p[p.length-1][0]).toUpperCase() : name.slice(0,2).toUpperCase(); }
function AssigneeAvatar({ member, uid, size = "sm" }: { member?: WorkspaceMember; uid: string; size?: "sm" | "md" | "lg" }) {
  const name = member?.displayName || member?.email || uid;
  return <div className={cn("rounded-full flex items-center justify-center font-bold text-white shrink-0 ring-2 ring-background -ml-1.5 first:ml-0", avatarColor(uid), size === "lg" ? "h-10 w-10 text-sm" : size === "md" ? "h-6 w-6 text-[10px]" : "h-5 w-5 text-[9px]")} title={name}>{avatarInitials(name)}</div>;
}
function AssigneePicker({ task, members, onUpdateTask }: { task: Task; members: WorkspaceMember[]; onUpdateTask: (t: Task) => void }) {
  const current = task.assignees ?? (task.assignee ? [task.assignee] : []);
  const [search, setSearch] = useState("");
  const filtered = members.filter(m => !search || m.displayName?.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase()));
  const toggle = (uid: string) => { const next = current.includes(uid) ? current.filter(id => id !== uid) : [...current, uid]; onUpdateTask({ ...task, assignees: next }); };
  return (
    <div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
      <input autoFocus className="w-full text-xs px-2 py-1.5 border-b border-border bg-transparent outline-none" placeholder="Search people…" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="max-h-48 overflow-y-auto py-1">
        {filtered.map(m => <button key={m.uid} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent rounded-sm" onClick={() => toggle(m.uid)}><AssigneeAvatar member={m} uid={m.uid} /><span className="flex-1 text-left truncate">{m.displayName || m.email}</span>{current.includes(m.uid) && <Check className="h-3 w-3 text-primary shrink-0" />}</button>)}
      </div>
    </div>
  );
}

interface TaskBoardViewProps {
  tasks: Task[];
  visibleFields?: CustomFieldDefinition[];
  customStatuses?: StatusConfig[];
  onSelectTask: (task: Task) => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onCreateTask: (status?: TaskStatus) => void;
  selectedTaskIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onSelectAllInStatus?: (status: TaskStatus, taskIds: string[]) => void;
  onDeleteSelected?: () => void;
  onDeleteAllInStatus?: (status: TaskStatus) => void;
  onArchiveAllInStatus?: (statusId: string) => void;
  onUnarchiveAll?: () => void;
  onClearSelection?: () => void;
  onDeleteTask?: (taskId: string) => void;
  onDuplicateTask?: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onMoveTask?: (task: Task) => void;
  // Bulk action callbacks
  onArchiveSelected?: () => void;
  onBulkStatusChange?: (status: string) => void;
  onBulkMoveToList?: (targetListId: string) => void;
  onDirectMoveTask?: (taskId: string, listId: string) => void;
  availableLists?: { id: string; name: string; parentLabel?: string }[];
  // Per-task archive
  archivedTasks?: Task[];
  onArchiveTask?: (taskId: string) => void;
  onUnarchiveTask?: (taskId: string) => void;
  onUpdateTask?: (task: Task) => void;
  /** When a list-age lockout is active, the id of the locked list */
  lockedListId?: string;
  /** The stale threshold in days for the active lockout rule */
  staleThresholdDays?: number;
}

// Timestamp of the last drag-end. Used to suppress the synthetic click that
// fires on a card right after it's dropped — when a task moves to a new column
// the card remounts, so its per-card pointer guard resets; this module-level
// flag survives the remount and stops the task detail opening after a drag.
let lastDragEndAt = 0;

// ── Board "Customize view" settings (ClickUp-style cog) ──────────────────────
type BoardCardSize = "small" | "medium" | "large";
interface BoardViewSettings {
  cardSize: BoardCardSize;
  showCover: boolean;            // show the task photo as a card cover
  showEmptyFields: boolean;      // show custom-field rows even when empty
  collapseEmptyColumns: boolean; // hide columns that have no tasks
}
const DEFAULT_BOARD_VIEW: BoardViewSettings = {
  cardSize: "medium", showCover: true, showEmptyFields: false, collapseEmptyColumns: false,
};
const BOARD_VIEW_KEY = "sf_board_view";
const COVER_HEIGHTS: Record<BoardCardSize, number> = { small: 80, medium: 130, large: 200 };

function TaskCard({ task, visibleFields, onSelect, dragHandleProps, isDragging, isSelected, effectiveOnToggleSelect, allStatuses, onDeleteTask, onDuplicateTask, onEditTask, onMoveTask, onDirectMoveTask, availableLists, onArchiveTask, isMobile, view = DEFAULT_BOARD_VIEW, members, onUpdateTask, lockedListId, staleThresholdDays }: {
  task: Task;
  visibleFields: CustomFieldDefinition[];
  onSelect: () => void;
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
  isSelected?: boolean;
  effectiveOnToggleSelect: (taskId: string) => void;
  allStatuses?: StatusConfig[];
  onDeleteTask?: (taskId: string) => void;
  onDuplicateTask?: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onMoveTask?: (task: Task) => void;
  onDirectMoveTask?: (taskId: string, listId: string) => void;
  availableLists?: { id: string; name: string; parentLabel?: string }[];
  isMobile: boolean;
  view?: BoardViewSettings;
  members?: WorkspaceMember[];
  onUpdateTask?: (task: Task) => void;
  lockedListId?: string;
  staleThresholdDays?: number;
}) {
  const priority = PRIORITIES.find(p => p.value === task.priority);
  const statusList = allStatuses || DEFAULT_STATUSES;
  const status = statusList.find(s => s.id === task.status) || DEFAULT_STATUSES.find(s => s.id === task.status);
  const assignees = task.assignees ?? (task.assignee ? [task.assignee] : []);

  // Days-in-list badge: shown when this task is in the locked list
  const staleDays = (lockedListId && task.listId === lockedListId && task.createdAt)
    ? Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 86_400_000)
    : null;
  const isOverStale = staleDays !== null && staleThresholdDays !== undefined && staleDays >= staleThresholdDays;
  // isMobile now passed as prop — no hook call per card

  const getFieldValue = (fieldId: string) => {
    const fv = (task.customFieldValues ?? []).find(v => v.fieldId === fieldId);
    return fv ? String(fv.value) : null;
  };

  // Custom fields shown on the card. "Show empty fields" reveals every visible
  // field (empty ones as "—"); otherwise only fields that have a value (max 3).
  const fieldsToShow = view.showEmptyFields
    ? visibleFields.map(f => ({ label: f.name, value: getFieldValue(f.id) || "—" })).slice(0, 6)
    : visibleFields.map(f => ({ label: f.name, value: getFieldValue(f.id) })).filter(f => f.value).slice(0, 3);

  // Use compressed thumbnail for board card; fall back to full photo for old tasks
  const heroThumb = view.showCover ? (task.photoThumbnails?.[0] ?? task.photos?.[0]) : undefined;
  const coverHeight = isMobile ? 60 : COVER_HEIGHTS[view.cardSize];

  // Density tokens — "Card size" shrinks/grows the WHOLE card (padding, text,
  // field rows), not just the cover, so Small fits many more cards on screen.
  const dense = {
    small:  { hPad: "px-2 pt-1.5 pb-0.5", job: "text-[10px]", titlePad: "px-2 pb-1", title: "text-xs",  fPad: "px-2 pb-1.5", fGap: "space-y-0",   fText: "text-[9px]",  labelW: "w-12", pillPad: "px-2 pb-1.5" },
    medium: { hPad: "px-3 pt-2.5 pb-1.5", job: "text-xs",     titlePad: "px-3 pb-2", title: "text-sm",   fPad: "px-3 pb-2.5", fGap: "space-y-1",   fText: "text-[10px]", labelW: "w-20", pillPad: "px-3 pb-2.5" },
    large:  { hPad: "px-4 pt-3 pb-2",     job: "text-sm",     titlePad: "px-4 pb-2.5", title: "text-base", fPad: "px-4 pb-3",  fGap: "space-y-1.5", fText: "text-xs",     labelW: "w-24", pillPad: "px-4 pb-3" },
  }[view.cardSize];
  const extraThumbs = task.photos?.slice(1, 4).map((url, i) => ({
    src: task.photoThumbnails?.[i + 1] ?? url,
    isLast: i === 2 && (task.photos?.length ?? 0) > 4,
  })) ?? [];
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      onPointerDown={(e) => {
        pointerStartRef.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        e.stopPropagation();
        pointerStartRef.current = null;
        if (Date.now() - lastDragEndAt < 300) return; // ignore the click after a drag
        // Mobile: single tap opens (dragging is disabled on mobile).
        // Desktop: single click just highlights (selects); double-click opens —
        // so dragging a card between columns can never open the task.
        if (isMobile) onSelect();
        else effectiveOnToggleSelect(task.id);
      }}
      onDoubleClick={(e) => {
        if (isMobile) return;
        e.stopPropagation();
        onSelect();
      }}
      className={cn(
        "bg-card border border-border rounded-lg shadow-sm cursor-pointer group transition-all overflow-hidden relative",
        "hover:border-primary/50 hover:shadow-lg touch-action-manipulation active:bg-accent/30",
        isDragging && "opacity-40",
        isSelected && "border-primary ring-1 ring-primary"
      )}
    >
      {/* Selection checkbox — top-left */}
      <div
        className={cn(
          "absolute top-2 left-2 z-20 transition-opacity",
          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          isMobile && "p-2 -m-2"
        )}
        onClick={(e) => {
          e.stopPropagation();
          effectiveOnToggleSelect(task.id);
        }}
        onPointerDown={(e) => e.stopPropagation()} // prevent drag starting from checkbox
      >
        <Checkbox 
          checked={!!isSelected} 
          className={cn(
            "bg-background border-2 shadow",
            isMobile && "h-5 w-5" // Larger checkbox on mobile
          )}
        />
      </div>
      {/* Hero photo — IntersectionObserver lazy, skeleton until visible+loaded */}
      {heroThumb && (
        <div className="relative w-full z-10" style={{ height: coverHeight }}>
          <LazyImage src={heroThumb} className="absolute inset-0 w-full h-full" />
          {/* extra thumbnails strip */}
          {extraThumbs.length > 0 && (
            <div className="absolute bottom-2 left-2 flex gap-1.5 z-20">
              {extraThumbs.map(({ src, isLast }, i) => {
                const thumbnailSize = isMobile ? "h-7 w-7" : "h-9 w-9";
                return (
                  <button
                    key={i}
                    className={cn(
                      "relative rounded overflow-hidden border-2 border-white/70 bg-muted shrink-0 cursor-pointer hover:border-white transition-colors",
                      thumbnailSize
                    )}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                  >
                    <LazyImage src={src} className="w-full h-full" />
                    {isLast && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <span className="text-white text-[10px] font-bold">+{(task.photos?.length ?? 0) - 4}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Header row — job number + meta */}
      <div className={cn(
        "flex items-center justify-between relative z-10",
        isMobile ? "px-1.5 pt-1 pb-0.5" : dense.hPad,
        (task.photos?.length ?? 0) === 0 && !heroThumb && "border-b border-border/60"
      )}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn("font-mono font-bold text-primary tracking-wide shrink-0", dense.job)}>{task.jobNumber ?? "—"}</span>
          {staleDays !== null && (
            <span className={cn(
              "flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold shrink-0",
              isOverStale
                ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
            )}>
              <Clock className="h-2.5 w-2.5 shrink-0" />
              {staleDays}d
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {priority && (
            <div className="flex items-center gap-1.5">
              <span
                className={cn("h-2 w-2 rounded-full shrink-0", priority.color)}
                title={priority.label}
              />
            </div>
          )}
          {task.dueDate && (
            <span className={cn(
              "flex items-center gap-0.5 text-muted-foreground text-[10px]"
            )}>
              <Calendar className="h-2.5 w-2.5" />{task.dueDate}
            </span>
          )}
        </div>
        
        {/* Task menu - 3 dots */}
        {(onDeleteTask || onDuplicateTask || onEditTask || onMoveTask) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity z-20",
                  isMobile && "opacity-100"
                )}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
                <span className="sr-only">Task menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {onEditTask && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditTask(task);
                  }}
                >
                  <Edit className="h-3.5 w-3.5 mr-2" />
                  Open / Edit
                </DropdownMenuItem>
              )}
              {onDuplicateTask && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicateTask(task);
                  }}
                >
                  <Copy className="h-3.5 w-3.5 mr-2" />
                  Duplicate
                </DropdownMenuItem>
              )}
              {(onDirectMoveTask && availableLists && availableLists.length > 0) ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger onPointerDown={e => e.stopPropagation()}>
                    <MoveRight className="h-3.5 w-3.5 mr-2" />
                    Move to List
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 overflow-y-auto w-64">
                    {availableLists.map(l => (
                      <DropdownMenuItem
                        key={l.id}
                        onClick={(e) => { e.stopPropagation(); onDirectMoveTask(task.id, l.id); }}
                      >
                        {l.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : onMoveTask ? (
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); onMoveTask(task); }}
                >
                  <MoveRight className="h-3.5 w-3.5 mr-2" />
                  Move to List
                </DropdownMenuItem>
              ) : null}
              {onArchiveTask && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchiveTask(task.id);
                  }}
                >
                  <Archive className="h-3.5 w-3.5 mr-2" />
                  Archive
                </DropdownMenuItem>
              )}
              {onDeleteTask && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteTask(task.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Task title */}
      <div className={cn("relative z-10", isMobile ? "px-1.5 pb-0.5" : dense.titlePad)}>
        <p className={cn(
          "font-semibold text-foreground leading-snug line-clamp-2", dense.title
        )}>{task.title}</p>
      </div>

      {/* Field values — desktop only; mobile cards stay compact, fields visible on tap-through */}
      {!isMobile && fieldsToShow.length > 0 && (
        <div className={cn("relative z-10", dense.fPad, dense.fGap)}>
          {fieldsToShow.map(f => (
            <div key={f.label} className="flex items-center gap-1.5 min-w-0">
              <span className={cn("text-muted-foreground shrink-0 truncate", dense.labelW, dense.fText)}>{f.label}:</span>
              <span className={cn("font-medium text-foreground truncate", dense.fText)}>{f.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Status pill + assignees row */}
      <div className={cn("relative z-10 flex items-center justify-between", isMobile ? "px-1.5 pb-1.5" : dense.pillPad)}>
        {status ? (
          <span className={cn("inline-flex items-center gap-1 rounded-full font-semibold uppercase tracking-wide", status.color, isMobile ? "px-1.5 py-0.5 text-[8px]" : "px-2 py-0.5 text-[9px]")}>
            <span className="h-1 w-1 rounded-full bg-current shrink-0" />{status.label}
          </span>
        ) : <span />}
        <div className="flex items-center" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
          {assignees.slice(0, 4).map(uid => <AssigneeAvatar key={uid} member={members?.find(m => m.uid === uid)} uid={uid} size="lg" />)}
          {assignees.length > 4 && <div className="h-10 w-10 rounded-full bg-muted border border-border text-xs flex items-center justify-center font-bold text-muted-foreground -ml-1.5">+{assignees.length - 4}</div>}
          {onUpdateTask && (
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn("h-10 w-10 rounded-full border-2 border-dashed border-muted-foreground/40 flex items-center justify-center transition-opacity hover:border-primary -ml-1.5", assignees.length === 0 ? "opacity-0 group-hover:opacity-100" : "opacity-100")}>
                  <UserPlus className="h-4 w-4 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-0" align="end">
                <AssigneePicker task={task} members={members ?? []} onUpdateTask={onUpdateTask} />
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </div>
  );
}

// Memoize TaskCard so it only re-renders when its own props change
const MemoTaskCard = memo(TaskCard);

function SortableTaskCard({ task, visibleFields, onSelect, isSelected, effectiveOnToggleSelect, allStatuses, onDeleteTask, onDuplicateTask, onEditTask, onMoveTask, onDirectMoveTask, availableLists, onArchiveTask, isMobile, view, members, onUpdateTask, lockedListId, staleThresholdDays }: {
  task: Task;
  visibleFields: CustomFieldDefinition[];
  onSelect: () => void;
  isSelected: boolean;
  effectiveOnToggleSelect: (taskId: string) => void;
  allStatuses?: StatusConfig[];
  onDeleteTask?: (taskId: string) => void;
  onDuplicateTask?: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onMoveTask?: (task: Task) => void;
  onDirectMoveTask?: (taskId: string, listId: string) => void;
  availableLists?: { id: string; name: string; parentLabel?: string }[];
  onArchiveTask?: (taskId: string) => void;
  isMobile: boolean;
  view?: BoardViewSettings;
  members?: WorkspaceMember[];
  onUpdateTask?: (task: Task) => void;
  lockedListId?: string;
  staleThresholdDays?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", task },
  });

  // On mobile we disable drag so horizontal column scrolling works without dragging the card.
  // Users can move tasks via the card's "..." menu → Move.
  const dragProps = isMobile
    ? {}
    : { draggable: true, onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }, ...attributes, ...listeners };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...dragProps}
      className={isMobile ? "" : "cursor-grab active:cursor-grabbing"}
    >
      <MemoTaskCard
        task={task}
        visibleFields={visibleFields}
        onSelect={onSelect}
        isDragging={isDragging}
        isSelected={isSelected}
        effectiveOnToggleSelect={effectiveOnToggleSelect}
        allStatuses={allStatuses}
        onDeleteTask={onDeleteTask}
        onDuplicateTask={onDuplicateTask}
        onEditTask={onEditTask}
        onMoveTask={onMoveTask}
        onDirectMoveTask={onDirectMoveTask}
        availableLists={availableLists}
        onArchiveTask={onArchiveTask}
        isMobile={isMobile}
        view={view}
        members={members}
        onUpdateTask={onUpdateTask}
        lockedListId={lockedListId}
        staleThresholdDays={staleThresholdDays}
      />
    </div>
  );
}

function TaskCardOverlay({ task, visibleFields, isMobile }: { task: Task; visibleFields: CustomFieldDefinition[]; isMobile: boolean }) {
  return (
    <div className="rotate-2 shadow-2xl rounded-lg w-[260px]">
      <MemoTaskCard 
        task={task} 
        visibleFields={visibleFields} 
        onSelect={() => {}} 
        effectiveOnToggleSelect={() => {}}
        onDeleteTask={undefined}
        onDuplicateTask={undefined}
        onEditTask={undefined}
        onMoveTask={undefined}
        isMobile={isMobile}
      />
    </div>
  );
}

function DroppableColumn({ statusId, children }: { statusId: string; children: React.ReactNode }) {
  const { setNodeRef } = useSortable({
    id: `column-${statusId}`,
    data: { type: "column", statusId },
    disabled: true,
  });

  return <div ref={setNodeRef}>{children}</div>;
}

export function TaskBoardView({ 
  tasks, 
  visibleFields = [], 
  customStatuses, 
  onSelectTask, 
  onStatusChange, 
  onCreateTask, 
  selectedTaskIds, 
  onToggleSelect, 
  onSelectAllInStatus, 
  onDeleteSelected, 
  onDeleteAllInStatus,
  onArchiveAllInStatus,
  onUnarchiveAll,
  onClearSelection,
  onDeleteTask,
  onDuplicateTask,
  onEditTask,
  onMoveTask,
  onDirectMoveTask,
  onArchiveSelected,
  onBulkStatusChange,
  onBulkMoveToList,
  availableLists,
  archivedTasks = [],
  onArchiveTask,
  onUnarchiveTask,
  onUpdateTask,
  lockedListId,
  staleThresholdDays,
}: TaskBoardViewProps) {
  const baseStatuses = customStatuses || DEFAULT_STATUSES;
  const isMobile = useIsMobile();
  const { members } = useAuth();

  // ClickUp-style "Customize view" settings, persisted locally.
  const [view, setView] = useState<BoardViewSettings>(() => {
    try { const v = localStorage.getItem(BOARD_VIEW_KEY); if (v) return { ...DEFAULT_BOARD_VIEW, ...JSON.parse(v) }; } catch {}
    return DEFAULT_BOARD_VIEW;
  });
  useEffect(() => { try { localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify(view)); } catch {} }, [view]);
  const setViewKey = <K extends keyof BoardViewSettings>(k: K, val: BoardViewSettings[K]) => setView(v => ({ ...v, [k]: val }));
  
  // Find any orphaned task statuses not in the current status configuration
  const usedStatuses = new Set(tasks.filter(t => !t.archived).map(t => t.status));
  const configuredStatuses = new Set(baseStatuses.map(s => s.id));
  const orphanedStatuses = Array.from(usedStatuses).filter(s => !configuredStatuses.has(s));
  
  // Add orphaned statuses to the display (with default styling)
  const statuses = [
    ...baseStatuses,
    ...orphanedStatuses.map(statusId => ({
      id: statusId,
      label: statusId.replace(/_/g, ' ').toUpperCase(),
      color: "bg-orange-100 text-orange-700" // Orange to indicate this status needs attention
    }))
  ];
  // Empty columns the user clicked to temporarily expand (when collapse is on).
  const [expandedEmpty, setExpandedEmpty] = useState<Set<string>>(new Set());
  
  // Local selection state if no external selection system is provided
  const [localSelectedTasks, setLocalSelectedTasks] = useState<Set<string>>(new Set());
  
  // Use external selection if provided, otherwise use local selection
  const effectiveSelectedTaskIds = selectedTaskIds || localSelectedTasks;

  // Stabilize with useCallback so SortableTaskCard doesn't re-render on every parent render
  const effectiveOnToggleSelect = useCallback(
    onToggleSelect || ((taskId: string) => {
      setLocalSelectedTasks(prev => {
        const newSet = new Set(prev);
        if (newSet.has(taskId)) newSet.delete(taskId);
        else newSet.add(taskId);
        return newSet;
      });
    }),
    [onToggleSelect]
  );
  
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id);
    if (task) setActiveTask(task);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    lastDragEndAt = Date.now(); // suppress the post-drop click that would open the task
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const overData = over.data.current;

    let targetStatus: TaskStatus | null = null;

    if (overData?.type === "column") {
      targetStatus = overData.statusId;
    } else if (overData?.type === "task") {
      targetStatus = overData.task.status;
    } else if (typeof over.id === "string" && over.id.startsWith("column-")) {
      targetStatus = over.id.replace("column-", "") as TaskStatus;
    }

    if (targetStatus) {
      onStatusChange(taskId, targetStatus);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* Floating bulk-action bar */}
      {effectiveSelectedTaskIds.size > 0 && onClearSelection && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-background border border-border shadow-xl rounded-full px-4 py-2 flex-wrap max-w-[92vw]">
          <CheckSquare className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="text-sm font-semibold mr-1">{effectiveSelectedTaskIds.size} selected</span>

          {/* Change Status */}
          {onBulkStatusChange && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-full h-7 gap-1 px-3">
                  Change Status <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="max-h-64 overflow-y-auto">
                {statuses.map(s => (
                  <DropdownMenuItem key={s.id} onClick={() => onBulkStatusChange(s.id)}>
                    <span className={cn("inline-block w-2 h-2 rounded-full mr-2 flex-shrink-0", s.color.split(' ')[0])} />
                    {s.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Move to List */}
          {onBulkMoveToList && availableLists && availableLists.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-full h-7 gap-1 px-3">
                  <MoveRight className="h-3.5 w-3.5" /> Move to <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="max-h-64 overflow-y-auto">
                {availableLists.map(l => (
                  <DropdownMenuItem key={l.id} onClick={() => onBulkMoveToList(l.id)}>
                    {l.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Archive */}
          {onArchiveSelected && (
            <Button variant="outline" size="sm" className="rounded-full h-7 gap-1.5 px-3" onClick={onArchiveSelected}>
              <Archive className="h-3.5 w-3.5" /> Archive
            </Button>
          )}

          {/* Delete */}
          {onDeleteSelected && (
            <Button variant="destructive" size="sm" className="rounded-full h-7 gap-1.5 px-3" onClick={onDeleteSelected}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          )}

          {/* Clear */}
          <button className="text-muted-foreground hover:text-foreground ml-1 flex-shrink-0" onClick={onClearSelection}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col h-full min-h-0">
      {/* ── Customize view (cog) ── */}
      <div className="flex items-center justify-end px-3 pt-2 pb-0.5 shrink-0">
        <Popover>
          <PopoverTrigger asChild>
            <button
              title="Customize board view"
              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-0">
            <div className="px-3 py-2.5 border-b">
              <p className="text-sm font-semibold">Customize view</p>
              <p className="text-[11px] text-muted-foreground">Settings are saved on this device.</p>
            </div>
            <div className="p-3 space-y-3">
              <div>
                <p className="text-xs font-medium mb-1.5">Card size</p>
                <div className="flex gap-1">
                  {(["small", "medium", "large"] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setViewKey("cardSize", s)}
                      className={cn(
                        "flex-1 capitalize text-xs rounded-md border py-1.5 transition-colors",
                        view.cardSize === s ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted/60"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm">Card cover image</span>
                <Switch checked={view.showCover} onCheckedChange={(v) => setViewKey("showCover", v)} />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm">Show empty fields</span>
                <Switch checked={view.showEmptyFields} onCheckedChange={(v) => setViewKey("showEmptyFields", v)} />
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm">Collapse empty columns</span>
                <Switch checked={view.collapseEmptyColumns} onCheckedChange={(v) => setViewKey("collapseEmptyColumns", v)} />
              </label>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className={cn("flex overflow-x-auto flex-1 min-h-0", isMobile ? "gap-1.5 p-1.5 pt-1" : "gap-3 p-3 pt-1")}>
        {statuses.map((status, statusIndex) => {
          const isLastColumn = statusIndex === statuses.length - 1;
          const columnTasks = tasks.filter(t => t.status === status.id && !t.archived);
          const taskIds = columnTasks.map(t => t.id);
          const allSelected = columnTasks.length > 0 && columnTasks.every(t => effectiveSelectedTaskIds.has(t.id));
          const someSelected = columnTasks.some(t => effectiveSelectedTaskIds.has(t.id));

          // Collapsed empty column → a thin vertical strip (ClickUp style). Click to expand.
          if (view.collapseEmptyColumns && columnTasks.length === 0 && !expandedEmpty.has(status.id)) {
            return (
              <div
                key={status.id}
                onClick={() => setExpandedEmpty(prev => { const n = new Set(prev); n.add(status.id); return n; })}
                title={`${status.label} (0) — click to expand`}
                className="flex flex-col items-center gap-2 shrink-0 w-9 py-2.5 rounded-lg sm:rounded-xl bg-muted/25 border border-border/60 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground -rotate-90" />
                <span className="text-[10px] font-semibold text-muted-foreground">0</span>
                <span
                  className={cn("inline-flex items-center rounded-full font-bold uppercase tracking-wide text-[10px]", status.color)}
                  style={{ writingMode: "vertical-rl", padding: "6px 2px" }}
                >
                  {status.label}
                </span>
              </div>
            );
          }

          return (
            <div key={status.id} className="flex flex-col min-w-[115px] w-[115px] sm:min-w-[300px] sm:w-[300px] lg:min-w-[320px] lg:w-[320px] shrink-0 overflow-y-auto max-h-full bg-muted/25 rounded-lg sm:rounded-xl border border-border/60">
              <div className={cn(
                "flex items-center sticky top-0 z-20 border-b border-border/50 rounded-t-lg sm:rounded-t-xl",
                isMobile ? "gap-1 px-1.5 pt-1.5 pb-1.5" : "gap-2 px-2.5 pt-2.5 pb-2.5"
              )} style={{ backgroundColor: 'hsl(var(--background))', backdropFilter: 'blur(4px)' }}>
                <span className={cn(
                  "inline-flex items-center gap-1.5 rounded-full font-bold uppercase tracking-wide truncate min-w-0",
                  status.color,
                  isMobile ? "px-1.5 py-0.5 text-[9px]" : "px-2.5 py-1 text-[11px]"
                )}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
                  {status.label}
                </span>
                <span className={cn("text-muted-foreground font-semibold", isMobile ? "text-[9px]" : "text-xs")}>{columnTasks.length}</span>
                <div className="flex-1" />
                <button
                  className="text-muted-foreground hover:text-foreground rounded p-0.5 hover:bg-muted/60"
                  onClick={() => onCreateTask(status.id)}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                {/* Column actions menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="text-muted-foreground hover:text-foreground rounded p-0.5">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onClick={() => onSelectAllInStatus && onSelectAllInStatus(status.id, taskIds)}
                      disabled={columnTasks.length === 0}
                    >
                      <CheckCheck className="h-3.5 w-3.5 mr-2" />
                      Select all ({columnTasks.length})
                    </DropdownMenuItem>
                    {someSelected && (
                      <DropdownMenuItem onClick={() => onSelectAllInStatus && onSelectAllInStatus(status.id, [])}>
                        <X className="h-3.5 w-3.5 mr-2" />
                        Deselect all
                      </DropdownMenuItem>
                    )}
                    {columnTasks.length > 0 && <DropdownMenuSeparator />}
                    {columnTasks.length > 0 && (
                      <DropdownMenuItem
                        onClick={() => onArchiveAllInStatus && onArchiveAllInStatus(status.id)}
                      >
                        <Archive className="h-3.5 w-3.5 mr-2" />
                        Archive all ({columnTasks.length})
                      </DropdownMenuItem>
                    )}
                    {isLastColumn && archivedTasks.length > 0 && onUnarchiveAll && (
                      <DropdownMenuItem onClick={onUnarchiveAll}>
                        <ArchiveRestore className="h-3.5 w-3.5 mr-2" />
                        Unarchive all ({archivedTasks.length})
                      </DropdownMenuItem>
                    )}
                    {columnTasks.length > 0 && (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDeleteAllInStatus && onDeleteAllInStatus(status.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Delete all ({columnTasks.length})
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <SortableContext items={[`column-${status.id}`, ...taskIds]} strategy={verticalListSortingStrategy}>
                <DroppableColumn statusId={status.id}>
                  <div className={cn("flex flex-col flex-1 min-h-[60px]", isMobile ? "gap-1 p-1" : "gap-2 p-1.5")}>
                    {columnTasks.map((task) => (
                      <SortableTaskCard
                        key={task.id}
                        task={task}
                        visibleFields={visibleFields}
                        onSelect={() => onSelectTask(task)}
                        isSelected={effectiveSelectedTaskIds.has(task.id)}
                        effectiveOnToggleSelect={effectiveOnToggleSelect}
                        allStatuses={statuses}
                        onDeleteTask={onDeleteTask}
                        onDuplicateTask={onDuplicateTask}
                        onEditTask={onEditTask}
                        onMoveTask={onMoveTask}
                        onDirectMoveTask={onDirectMoveTask}
                        availableLists={availableLists}
                        onArchiveTask={onArchiveTask}
                        isMobile={isMobile}
                        view={view}
                        members={members}
                        onUpdateTask={onUpdateTask}
                        lockedListId={lockedListId}
                        staleThresholdDays={staleThresholdDays}
                      />
                    ))}

                    <button
                      onClick={() => onCreateTask(status.id)}
                      className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary px-2 py-2.5 rounded-lg hover:bg-primary/5 w-full transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      Add Task
                    </button>
                  </div>
                </DroppableColumn>
              </SortableContext>

              {/* Archived tasks section — shown in the last column */}
              {isLastColumn && archivedTasks.length > 0 && onUnarchiveTask && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowArchived(v => !v)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground w-full px-1 py-1.5 rounded hover:bg-muted/40"
                  >
                    <Archive className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="font-medium">Archived ({archivedTasks.length})</span>
                    <ChevronDown className={cn("h-3 w-3 ml-auto transition-transform", showArchived && "rotate-180")} />
                  </button>
                  {showArchived && (
                    <div className="flex flex-col gap-2 mt-1.5">
                      {archivedTasks.map(archivedTask => (
                        <div key={archivedTask.id} className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 flex items-center gap-2 opacity-70">
                          <Archive className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="text-sm font-medium truncate flex-1">{archivedTask.title}</span>
                          {archivedTask.jobNumber && (
                            <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">#{archivedTask.jobNumber}</span>
                          )}
                          <button
                            onClick={() => onUnarchiveTask(archivedTask.id)}
                            className="flex items-center gap-1 text-xs text-primary hover:underline flex-shrink-0 ml-1"
                            title="Unarchive task"
                          >
                            <Archive className="h-3 w-3" />
                            Unarchive
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>

      <DragOverlay>
        {activeTask && <TaskCardOverlay task={activeTask} visibleFields={visibleFields} isMobile={isMobile} />}
      </DragOverlay>
    </DndContext>
  );
}
