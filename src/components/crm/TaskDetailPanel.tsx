import { useState, useEffect, useCallback, useRef } from "react";
import {
  X, MoveRight, Clock, Send, ArrowLeft, Camera, Upload, Trash2,
  ImagePlus, DollarSign, Package, Plus, Minus, User, Phone, Mail,
  CalendarDays, CalendarCheck, Calendar, FileText, ClipboardList, AlertTriangle, Printer, UserPlus, Check,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { loadJobSettings } from "@/lib/jobSettingsService";
import { sbGetComments, sbInsertComment, sbDeleteComment, sbSubscribeComments } from "@/lib/supabase";
import {
  Task, TaskStatus, TaskPriority, DEFAULT_STATUSES, PRIORITIES,
  CustomFieldDefinition, List, TaskComment, SparePartUsage,
} from "@/types/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCameraUpload } from "@/hooks/useCameraUpload";
import { inventoryService } from "@/lib/inventoryService";
import type { InventoryItem } from "@/lib/inventoryService";
import { loadTechnicians } from "@/lib/techAssessmentService";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { WorkspaceMember } from "@/types/auth";

// Module-level inventory cache (avoids repeated Firestore calls)
const _invCache = new Map<string, InventoryItem[]>();
export function warmInventoryCache(workspaceId: string) {
  if (_invCache.has(workspaceId)) return;
  inventoryService.getAll(workspaceId)
    .then(items => _invCache.set(workspaceId, items))
    .catch(() => {});
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface TaskDetailPanelProps {
  task: Task;
  visibleFields: CustomFieldDefinition[];
  allFields: CustomFieldDefinition[];
  allLists: List[];
  forms?: import("@/types/crm").FormDefinition[];
  onUpdate: (updated: Task) => void;
  onMoveTask: (taskId: string, targetListId: string) => void;
  onClose: () => void;
  isFullScreen?: boolean;
  currentViewContext?: string;
  onGenerateQuote?: (task: Task) => void;
  onGenerateInvoice?: (task: Task) => void;
  onGenerateAssessment?: (task: Task) => void;
}

interface BodyProps {
  editedTask: Task;
  setEditedTask: (t: Task) => void;
  onUpdate: (t: Task) => void;
  onMoveTask: (taskId: string, listId: string) => void;
  visibleFields: CustomFieldDefinition[];
  allLists: List[];
  taskStatuses: typeof DEFAULT_STATUSES;
  inventoryItems: InventoryItem[];
  loadingInventory: boolean;
  technicians: string[];
  members: WorkspaceMember[];
  user: { displayName?: string | null; email?: string | null } | null;
  isNative: boolean;
  takePhoto: () => void;
  pickFromGallery: () => void;
  handleFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  cameraInputRef: React.RefObject<HTMLInputElement>;
  formatTimestamp: (ts: string) => string;
  showActivity?: boolean;
  photoLocked?: boolean;
  workspaceId?: string;
}

// ── Shared: PropRow ────────────────────────────────────────────────────────────
function PropRow({ icon, label, children }: {
  icon?: React.ReactNode; label: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center min-h-[34px] px-3 gap-2">
      <div className="flex items-center gap-1.5 w-28 shrink-0 text-xs text-muted-foreground">
        {icon}<span>{label}</span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ── Shared: SectionHeading ─────────────────────────────────────────────────────
function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 pt-3 pb-1 border-t border-border/60">
      <span className="text-muted-foreground">{icon}</span>
      <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</h4>
    </div>
  );
}

// ── PhotosSection ──────────────────────────────────────────────────────────────
function PhotosSection({ editedTask, setEditedTask, onUpdate, isNative, takePhoto, pickFromGallery,
  handleFileInputChange, fileInputRef, cameraInputRef }: {
  editedTask: Task; setEditedTask: (t: Task) => void; onUpdate: (t: Task) => void;
  isNative: boolean; takePhoto: () => void; pickFromGallery: () => void;
  handleFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement>; cameraInputRef: React.RefObject<HTMLInputElement>;
}) {
  const handleDeletePhoto = (index: number) => {
    const photos = editedTask.photos || [];
    const thumbs = editedTask.photoThumbnails || [];
    const updated: Task = {
      ...editedTask,
      photos: photos.filter((_, i) => i !== index),
      photoThumbnails: thumbs.filter((_, i) => i !== index),
    };
    setEditedTask(updated); onUpdate(updated);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Camera className="h-3.5 w-3.5" />
          <span className="font-semibold uppercase tracking-wider">Photos</span>
        </div>
        <div className="flex gap-1.5">
          {!isNative && (
            <>
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
                onChange={handleFileInputChange} className="hidden" multiple />
              <input ref={fileInputRef} type="file" accept="image/*"
                onChange={handleFileInputChange} className="hidden" multiple />
            </>
          )}
          <Button type="button" variant="outline" size="sm" onClick={takePhoto} className="h-7 gap-1 text-xs">
            <Camera className="h-3 w-3" /> Camera
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={pickFromGallery} className="h-7 gap-1 text-xs">
            {isNative ? <ImagePlus className="h-3 w-3" /> : <Upload className="h-3 w-3" />}
            {isNative ? "Gallery" : "Upload"}
          </Button>
        </div>
      </div>
      {editedTask.photos && editedTask.photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {editedTask.photos.map((photo, index) => (
            <div key={index} className="relative group aspect-square">
              <img src={editedTask.photoThumbnails?.[index] ?? photo} alt={`Photo ${index + 1}`}
                className="w-full h-full object-cover rounded border cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => window.open(photo, "_blank")} />
              <Button type="button" size="icon" variant="destructive"
                className="absolute top-1 right-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); handleDeletePhoto(index); }}>
                <Trash2 className="h-2.5 w-2.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <button type="button" onClick={takePhoto}
          className="w-full text-center py-5 text-muted-foreground border border-dashed border-border rounded-lg hover:border-primary hover:text-primary transition-colors">
          <Camera className="h-5 w-5 mx-auto mb-1 opacity-50" />
          <p className="text-xs font-medium">Tap to add photos</p>
        </button>
      )}
    </div>
  );
}

// ── SparePartsSection ──────────────────────────────────────────────────────────
function SparePartsSection({ editedTask, setEditedTask, onUpdate, inventoryItems, loadingInventory, user }: {
  editedTask: Task; setEditedTask: (t: Task) => void; onUpdate: (t: Task) => void;
  inventoryItems: InventoryItem[]; loadingInventory: boolean;
  user: { displayName?: string | null; email?: string | null } | null;
}) {
  const [selectedPartId, setSelectedPartId] = useState("");
  const [partQuantity, setPartQuantity] = useState(1);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedItem = inventoryItems.find(i => i.id === selectedPartId);

  const filteredParts = inventoryItems.filter(i => {
    if (i.quantity <= 0) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      i.name.toLowerCase().includes(q) ||
      i.sku.toLowerCase().includes(q) ||
      (i.description || "").toLowerCase().includes(q)
    );
  });

  const handleAdd = () => {
    if (!selectedPartId || partQuantity <= 0) return;
    const item = inventoryItems.find(i => i.id === selectedPartId);
    if (!item) return;
    if (item.quantity < partQuantity) { alert(`Not enough stock! Only ${item.quantity} available.`); return; }
    const part: SparePartUsage = {
      id: `spare_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      productVariantId: selectedPartId, productName: item.name,
      variantName: item.description, sku: item.sku, quantity: partQuantity,
      unitCost: item.costPrice || 0,
      addedBy: user?.displayName || user?.email || "Unknown",
      addedAt: new Date().toISOString(),
    };
    const updated: Task = { ...editedTask, sparePartsUsed: [...(editedTask.sparePartsUsed || []), part] };
    setEditedTask(updated); onUpdate(updated); setSelectedPartId(""); setSearch(""); setPartQuantity(1);
  };

  const handleRemove = (id: string) => {
    const updated: Task = { ...editedTask, sparePartsUsed: (editedTask.sparePartsUsed || []).filter(sp => sp.id !== id) };
    setEditedTask(updated); onUpdate(updated);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="h-8 flex-1 text-xs border rounded-md px-3 text-left flex items-center justify-between bg-background hover:bg-accent disabled:opacity-50"
              disabled={loadingInventory}
            >
              <span className={selectedItem ? "text-foreground" : "text-muted-foreground"}>
                {loadingInventory ? "Loading..." : selectedItem ? `${selectedItem.name} (${selectedItem.sku})` : "Search by name, SKU or description..."}
              </span>
              <svg className="h-3.5 w-3.5 text-muted-foreground ml-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[340px]" align="start" side="bottom">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Type part name, SKU..."
                value={search}
                onValueChange={setSearch}
                className="h-9 text-xs"
              />
              <CommandList className="max-h-[220px]">
                <CommandEmpty>No parts found.</CommandEmpty>
                {filteredParts.map(item => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => { setSelectedPartId(item.id); setOpen(false); }}
                    className="text-xs px-3 py-2 cursor-pointer"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate">{item.name}</span>
                      <span className="text-muted-foreground">{item.sku}{item.description ? ` · ${item.description}` : ""} · <span className="text-green-600 font-medium">{item.quantity} in stock</span></span>
                    </div>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <div className="flex items-center border rounded-md overflow-hidden">
          <button type="button" className="px-2 h-8 text-muted-foreground hover:bg-accent disabled:opacity-40"
            onClick={() => setPartQuantity(q => Math.max(1, q - 1))} disabled={partQuantity <= 1}>
            <Minus className="h-3 w-3" />
          </button>
          <Input type="number" min="1" value={partQuantity}
            onChange={e => setPartQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            className="h-8 w-12 text-center border-0 p-0 focus-visible:ring-0 text-xs" />
          <button type="button" className="px-2 h-8 text-muted-foreground hover:bg-accent"
            onClick={() => setPartQuantity(q => q + 1)}>
            <Plus className="h-3 w-3" />
          </button>
        </div>
        <Button type="button" size="sm" className="h-8 px-3 text-xs" onClick={handleAdd} disabled={!selectedPartId || loadingInventory}>
          <Plus className="h-3 w-3 mr-1" /> Add
        </Button>
      </div>
      {editedTask.sparePartsUsed && editedTask.sparePartsUsed.length > 0 ? (
        <div className="space-y-1.5">
          {editedTask.sparePartsUsed.map(part => (
            <div key={part.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/40 rounded-lg border text-sm">
              <div className="flex-1 min-w-0">
                <span className="font-medium truncate">{part.productName}</span>
                <span className="text-muted-foreground ml-2 text-xs">x {part.quantity} - R{(part.unitCost * part.quantity).toFixed(2)}</span>
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 hover:text-destructive shrink-0" onClick={() => handleRemove(part.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <div className="flex justify-between pt-1 text-sm font-semibold border-t border-border">
            <span>Total Parts Cost</span>
            <span>R{editedTask.sparePartsUsed.reduce((s, p) => s + p.unitCost * p.quantity, 0).toFixed(2)}</span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-3 border border-dashed rounded">No spare parts added yet</p>
      )}
    </div>
  );
}

// ── ActivitySection ────────────────────────────────────────────────────────────
type ActivityFilter = "all" | "changes" | "comments" | "moves";

function ActivitySection({ editedTask, workspaceId, user, formatTimestamp }: {
  editedTask: Task; workspaceId: string | undefined;
  user: { displayName?: string | null; email?: string | null } | null;
  formatTimestamp: (ts: string) => string;
}) {
  const [newComment, setNewComment] = useState("");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [tableComments, setTableComments] = useState<TaskComment[]>([]);
  const ownInsertIds = useRef<Set<string>>(new Set());

  // Load comments from task_comments table on mount / task change
  useEffect(() => {
    let cancelled = false;
    setTableComments([]);
    sbGetComments(editedTask.id)
      .then(rows => {
        if (!cancelled) setTableComments(rows as unknown as TaskComment[]);
      })
      .catch(err => console.warn('[ActivitySection] load comments failed:', err));
    return () => { cancelled = true; };
  }, [editedTask.id]);

  // Live subscription — new comments from any user appear instantly
  useEffect(() => {
    const unsub = sbSubscribeComments(editedTask.id, {
      onInsert: (row) => {
        const c = row as unknown as TaskComment;
        // Skip echo from our own insert (already applied optimistically)
        if (ownInsertIds.current.has(c.id)) { ownInsertIds.current.delete(c.id); return; }
        setTableComments(prev => {
          if (prev.some(x => x.id === c.id)) return prev;
          return [...prev, c];
        });
      },
      onDelete: (id) => setTableComments(prev => prev.filter(c => c.id !== id)),
    });
    return unsub;
  }, [editedTask.id]);

  const handleAddComment = async () => {
    if (!newComment.trim() || !workspaceId) return;
    const displayName = user?.displayName;
    const email = user?.email;
    const author = displayName || (email ? email.split('@')[0] : null) || 'A user';
    const comment: TaskComment = {
      id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text: newComment.trim(),
      author,
      createdAt: new Date().toISOString(),
    };
    // Optimistic local add
    ownInsertIds.current.add(comment.id);
    setTableComments(prev => [...prev, comment]);
    setNewComment("");
    try {
      await sbInsertComment(workspaceId, editedTask.id, comment as unknown as Record<string, unknown>);
    } catch (err) {
      console.error('[ActivitySection] insert comment failed:', err);
      // Roll back optimistic add
      setTableComments(prev => prev.filter(c => c.id !== comment.id));
      ownInsertIds.current.delete(comment.id);
    }
  };

  // Merge: table rows are authoritative; fall back to task.comments for legacy
  // entries that predate the migration (they were already migrated but just in case).
  const tableIds = new Set(tableComments.map(c => c.id));
  const legacyOnly = (editedTask.comments || []).filter(c => !tableIds.has(c.id));
  const all = [...tableComments, ...legacyOnly];
  const filtered = all.filter(c => {
    if (filter === "all") return true;
    if (filter === "comments") return !c.isSystem;
    if (filter === "moves") return c.isSystem && (c.action === "list_move" || c.action === "status");
    if (filter === "changes") return c.isSystem;
    return true;
  });
  // Newest first
  const ordered = [...filtered].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  // Group by day label
  const dayLabel = (iso: string): string => {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, today)) return "Today";
    if (sameDay(d, yesterday)) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
  };
  const groups: { label: string; items: TaskComment[] }[] = [];
  for (const c of ordered) {
    const label = dayLabel(c.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(c);
    else groups.push({ label, items: [c] });
  }

  const userInitial = (user?.displayName || user?.email || "U").charAt(0).toUpperCase();
  const counts = {
    all: all.length,
    changes: all.filter(c => c.isSystem).length,
    comments: all.filter(c => !c.isSystem).length,
    moves: all.filter(c => c.isSystem && (c.action === "list_move" || c.action === "status")).length,
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium text-sm">Activity</h3>
          <span className="text-xs text-muted-foreground">({counts.all})</span>
        </div>
      </div>

      {/* Comment composer */}
      <div className="flex gap-2">
        <Avatar className="h-7 w-7 shrink-0">
          <AvatarFallback className="text-xs">{userInitial}</AvatarFallback>
        </Avatar>
        <div className="flex-1 space-y-2">
          <Textarea value={newComment} onChange={e => setNewComment(e.target.value)}
            placeholder="Write a comment..." className="min-h-[70px] resize-none text-sm"
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddComment(); }} />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleAddComment} disabled={!newComment.trim()} className="h-8 px-3 gap-1.5">
              <Send className="h-3.5 w-3.5" /> Comment
            </Button>
          </div>
        </div>
      </div>

      {/* Filter chips */}
      {counts.all > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {([
            { key: "all", label: "All", n: counts.all },
            { key: "comments", label: "Comments", n: counts.comments },
            { key: "changes", label: "Changes", n: counts.changes },
            { key: "moves", label: "Moves", n: counts.moves },
          ] as const).map(({ key, label, n }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                filter === key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-accent",
              )}
            >
              {label} {n > 0 && <span className="opacity-70">{n}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Activity stream */}
      <div className="space-y-4">
        {groups.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No activity yet</p>
        )}
        {groups.map(group => (
          <div key={group.label} className="space-y-2">
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  {group.label}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </div>
            <div className="space-y-2">
              {group.items.map(c => (
                <ActivityRow key={c.id} comment={c} formatTimestamp={formatTimestamp} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ActivityRow ──────────────────────────────────────────────────────────────
function ActivityRow({ comment, formatTimestamp }: {
  comment: TaskComment;
  formatTimestamp: (ts: string) => string;
}) {
  const initial = (comment.author || "U").charAt(0).toUpperCase();

  // User comment → bubble with avatar + name + bubble + time
  if (!comment.isSystem) {
    return (
      <div className="flex gap-2">
        <Avatar className="h-7 w-7 shrink-0 mt-0.5">
          <AvatarFallback className="text-[11px] bg-primary text-primary-foreground">{initial}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-xs font-semibold truncate">{comment.author}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">{formatTimestamp(comment.createdAt)}</span>
          </div>
          <div className="bg-accent rounded-lg rounded-tl-sm px-3 py-2">
            <p className="text-sm whitespace-pre-wrap break-words">{comment.text}</p>
          </div>
        </div>
      </div>
    );
  }

  // System entry — ClickUp-style "Name did X to Field: old → new"
  // Falls back to plain `text` if structured fields are missing (legacy entries).
  const hasDiff = comment.oldValue !== undefined || comment.newValue !== undefined;
  return (
    <div className="flex gap-2 items-start py-0.5">
      <Avatar className="h-6 w-6 shrink-0 mt-0.5">
        <AvatarFallback className="text-[10px] bg-slate-200 text-slate-700">{initial}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0 text-xs text-foreground/80 leading-relaxed">
        <span className="font-semibold text-foreground">{comment.author}</span>{" "}
        {hasDiff && comment.field ? (
          <>
            <span className="text-muted-foreground">{actionVerb(comment.action)}</span>{" "}
            <span className="font-medium text-foreground">{comment.field}</span>
            {comment.oldValue !== null && comment.oldValue !== undefined && (
              <>
                {" "}
                <span className="text-muted-foreground">from</span>{" "}
                <span className="line-through opacity-70">{comment.oldValue}</span>
              </>
            )}
            {comment.newValue !== null && comment.newValue !== undefined && (
              <>
                {" "}
                <span className="text-muted-foreground">to</span>{" "}
                <span className="font-semibold text-emerald-700">{comment.newValue}</span>
              </>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">{comment.text}</span>
        )}
      </div>
      <span className="text-[10px] text-muted-foreground/60 shrink-0 pt-0.5">
        {formatTimestamp(comment.createdAt)}
      </span>
    </div>
  );
}

function actionVerb(action: TaskComment["action"]): string {
  switch (action) {
    case "status": return "changed";
    case "list_move": return "moved";
    case "priority": return "set";
    case "title": return "renamed";
    case "due_date": return "set";
    case "start_date": return "set";
    case "technician": return "assigned";
    case "assignee": return "assigned";
    case "is_paid": return "marked";
    case "custom_field": return "updated";
    case "spare_part_added": return "added";
    case "spare_part_removed": return "removed";
    default: return "updated";
  }
}

// ── TaskPanelBody ──────────────────────────────────────────────────────────────
function TaskPanelBody({ editedTask, setEditedTask, onUpdate, onMoveTask, visibleFields, allLists,
  taskStatuses, inventoryItems, loadingInventory, technicians, members, user, isNative, takePhoto, pickFromGallery,
  handleFileInputChange, fileInputRef, cameraInputRef, formatTimestamp, showActivity = false,
  photoLocked = false, workspaceId }: BodyProps) {

  const { myRole } = useAuth();

  const getFieldValue = (fieldId: string) => {
    const fv = editedTask.customFieldValues.find(v => v.fieldId === fieldId);
    return fv ? String(fv.value) : "";
  };

  const handleFieldChange = (fieldId: string, value: string | number | boolean) => {
    const existing = editedTask.customFieldValues.find(v => v.fieldId === fieldId);
    const newValues = existing
      ? editedTask.customFieldValues.map(v => v.fieldId === fieldId ? { ...v, value } : v)
      : [...editedTask.customFieldValues, { fieldId, value }];
    const updated = { ...editedTask, customFieldValues: newValues };
    setEditedTask(updated); onUpdate(updated);
  };

  // Auto-detect customer info for summary bar
  const CUSTOMER_HINTS = ["customer name", "client name", "client", "name"];
  const PHONE_HINTS = ["phone", "contact number", "contact", "cell", "mobile"];
  const EMAIL_HINTS = ["email", "e-mail"];

  const findHint = (hints: string[]) => {
    for (const hint of hints) {
      const f = visibleFields.find(fld => fld.name.toLowerCase().includes(hint));
      if (f) { const v = getFieldValue(f.id); if (v) return v; }
    }
    return null;
  };

  const customerName = findHint(CUSTOMER_HINTS);
  const customerPhone = findHint(PHONE_HINTS);
  const customerEmail = findHint(EMAIL_HINTS);
  const currentStatus = taskStatuses.find(s => s.id === editedTask.status);
  const currentPriority = PRIORITIES.find(p => p.value === editedTask.priority);

  const isLocked = photoLocked && (!editedTask.photos || editedTask.photos.length === 0);

  return (
    <div className="relative space-y-4 p-4">
      {/* Photo-required overlay */}
      {isLocked && (
        <div className="absolute inset-0 z-20 bg-background/96 backdrop-blur-sm flex flex-col p-5 gap-5 overflow-y-auto">
          <div className="flex flex-col items-center gap-3 pt-4 text-center">
            <div className="h-16 w-16 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center">
              <Camera className="h-8 w-8 text-orange-500" />
            </div>
            <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <h3 className="font-bold text-base">Photo Required</h3>
            </div>
            <p className="text-sm text-muted-foreground max-w-[300px]">
              This job has no photo attached. Please upload a photo of the unit from the <strong>phone app</strong> before editing.
            </p>
          </div>
          <div className="border border-border rounded-lg p-4 bg-muted/20">
            <PhotosSection
              editedTask={editedTask} setEditedTask={setEditedTask} onUpdate={onUpdate}
              isNative={isNative} takePhoto={takePhoto} pickFromGallery={pickFromGallery}
              handleFileInputChange={handleFileInputChange} fileInputRef={fileInputRef} cameraInputRef={cameraInputRef}
            />
          </div>
        </div>
      )}

      {/* Title */}
      <Input value={editedTask.title}
        onChange={e => { const u = { ...editedTask, title: e.target.value }; setEditedTask(u); onUpdate(u); }}
        className="text-base font-semibold border-0 border-b border-border/60 rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary"
        placeholder="Task title..." />

      {/* Customer info bar */}
      {(customerName || customerPhone || customerEmail) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800 text-sm">
          {customerName && (
            <span className="flex items-center gap-1.5 font-medium text-blue-900 dark:text-blue-200">
              <User className="h-3.5 w-3.5 shrink-0" /> {customerName}
            </span>
          )}
          {customerPhone && (
            <a href={`tel:${customerPhone}`} className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300 hover:underline">
              <Phone className="h-3.5 w-3.5 shrink-0" /> {customerPhone}
            </a>
          )}
          {customerEmail && (
            <a href={`mailto:${customerEmail}`} className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300 hover:underline truncate">
              <Mail className="h-3.5 w-3.5 shrink-0" /> {customerEmail}
            </a>
          )}
        </div>
      )}

      {/* Property rows */}
      <div className="divide-y divide-border/30 border border-border/50 rounded-lg overflow-hidden bg-muted/10">
        <PropRow icon={<span className={cn("h-2 w-2 rounded-full shrink-0", currentStatus?.color.split(" ")[0] ?? "bg-gray-400")} />} label="Status">
          <Select value={editedTask.status} onValueChange={v => { const u = { ...editedTask, status: v as TaskStatus }; setEditedTask(u); onUpdate(u); }}>
            <SelectTrigger className="h-7 border-0 bg-transparent px-1 text-xs focus:ring-0 hover:bg-accent w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {taskStatuses.map(s => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", s.color.split(" ")[0])} />{s.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropRow>

        <PropRow icon={<span className={cn("h-2 w-2 rounded-full shrink-0", currentPriority?.color ?? "bg-gray-400")} />} label="Priority">
          <Select value={editedTask.priority} onValueChange={v => { const u = { ...editedTask, priority: v as TaskPriority }; setEditedTask(u); onUpdate(u); }}>
            <SelectTrigger className="h-7 border-0 bg-transparent px-1 text-xs focus:ring-0 hover:bg-accent w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES.map(p => (
                <SelectItem key={p.value} value={p.value}>
                  <span className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", p.color)} />{p.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropRow>

        <PropRow icon={<MoveRight className="h-3.5 w-3.5 shrink-0" />} label="In List">
          <Select value={editedTask.listId} onValueChange={listId => { onMoveTask(editedTask.id, listId); setEditedTask({ ...editedTask, listId }); }}>
            <SelectTrigger className="h-7 border-0 bg-transparent px-1 text-xs focus:ring-0 hover:bg-accent w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {allLists.map(l => (
                <SelectItem key={l.id} value={l.id}>
                  <span className="flex items-center gap-1.5"><span>{l.icon || "📋"}</span>{l.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropRow>

        <PropRow icon={<CalendarDays className="h-3.5 w-3.5 shrink-0" />} label="Booked In">
          <span className="px-1 text-xs">{editedTask.createdAt || "—"}</span>
        </PropRow>

        <PropRow icon={<Calendar className="h-3.5 w-3.5 shrink-0" />} label="Start Date">
          <Input type="date" value={editedTask.startDate || ""}
            onChange={e => { const u = { ...editedTask, startDate: e.target.value || undefined }; setEditedTask(u); onUpdate(u); }}
            className="h-7 border-0 bg-transparent px-1 text-xs focus-visible:ring-0 hover:bg-accent" />
        </PropRow>

        <PropRow icon={<CalendarCheck className="h-3.5 w-3.5 shrink-0" />} label="Due Date">
          <Input type="date" value={editedTask.dueDate || ""}
            onChange={e => { const u = { ...editedTask, dueDate: e.target.value || undefined }; setEditedTask(u); onUpdate(u); }}
            className="h-7 border-0 bg-transparent px-1 text-xs focus-visible:ring-0 hover:bg-accent" />
        </PropRow>

        <PropRow icon={<User className="h-3.5 w-3.5 shrink-0" />} label="Technician">
          {technicians.length === 0 ? (
            <span className="px-1 text-xs text-muted-foreground italic">No techs configured — use Tech Assessment settings</span>
          ) : (
            <Select
              value={(editedTask as any).technician || "__none__"}
              onValueChange={v => { const tech = v === "__none__" ? undefined : v; const u = { ...editedTask, technician: tech } as any; setEditedTask(u); onUpdate(u); }}
            >
              <SelectTrigger className="h-7 border-0 bg-transparent px-1 text-xs focus:ring-0 hover:bg-accent w-full">
                <SelectValue placeholder="— Unassigned —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Unassigned —</SelectItem>
                {technicians.map(name => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </PropRow>

        <PropRow icon={<UserPlus className="h-3.5 w-3.5 shrink-0" />} label="Assignees">
          {(() => {
            const assignees = editedTask.assignees ?? (editedTask.assignee ? [editedTask.assignee] : []);
            const COLORS = ["bg-violet-500","bg-blue-500","bg-emerald-500","bg-amber-500","bg-rose-500","bg-pink-500","bg-teal-500","bg-indigo-500"];
            const color = (uid: string) => { let h = 0; for (const c of uid) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return COLORS[h % COLORS.length]; };
            const ini = (name: string) => { const p = name.trim().split(/\s+/); return p.length >= 2 ? (p[0][0]+p[p.length-1][0]).toUpperCase() : name.slice(0,2).toUpperCase(); };
            const canEditAssignees = myRole === 'owner';
            const remove = (uid: string) => { const u = { ...editedTask, assignees: assignees.filter(id => id !== uid) }; setEditedTask(u); onUpdate(u); };
            const toggle = (uid: string) => { const next = assignees.includes(uid) ? assignees.filter(id => id !== uid) : [...assignees, uid]; const u = { ...editedTask, assignees: next }; setEditedTask(u); onUpdate(u); };
            return (
              <div className="flex items-center flex-wrap gap-1 px-1 py-0.5">
                {assignees.map(uid => { const m = members.find(m => m.uid === uid); const name = m?.displayName || m?.email || uid; return (
                  <div key={uid} className={cn("flex items-center gap-1 rounded-full px-1.5 py-0.5 text-white text-[10px] font-semibold", color(uid))}>
                    <span>{ini(name)}</span><span className="max-w-[80px] truncate">{m?.displayName || m?.email}</span>
                    {canEditAssignees && <button onClick={() => remove(uid)} className="ml-0.5 hover:text-white/70"><X className="h-2.5 w-2.5" /></button>}
                  </div>
                ); })}
                {canEditAssignees && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                        <UserPlus className="h-2.5 w-2.5" />{assignees.length === 0 ? "Assign" : "Add"}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-0" align="start">
                      <div>
                        <p className="text-xs font-semibold px-2 pt-2 pb-1 text-muted-foreground uppercase tracking-wide">Assign members</p>
                        <div className="max-h-48 overflow-y-auto pb-1">
                          {members.map(m => { const assigned = assignees.includes(m.uid); return (
                            <button key={m.uid} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent rounded-sm" onClick={() => toggle(m.uid)}>
                              <div className={cn("h-5 w-5 rounded-full flex items-center justify-center font-bold text-white shrink-0 text-[9px]", color(m.uid))}>{ini(m.displayName || m.email)}</div>
                              <span className="flex-1 text-left truncate">{m.displayName || m.email}</span>
                              {assigned && <Check className="h-3 w-3 text-primary shrink-0" />}
                            </button>
                          ); })}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            );
          })()}
        </PropRow>

        <PropRow icon={<DollarSign className="h-3.5 w-3.5 shrink-0" />} label="Is Paid">
          <div className="flex items-center gap-2">
            <Checkbox
              id="isPaid"
              checked={editedTask.isPaid === true}
              onCheckedChange={(checked) => {
                const u = { ...editedTask, isPaid: checked === true };
                setEditedTask(u);
                onUpdate(u);
              }}
            />
            <label htmlFor="isPaid" className="text-xs cursor-pointer">
              {editedTask.isPaid ? "Yes" : "No"}
            </label>
          </div>
        </PropRow>
      </div>

      {/* Description */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" /> Description
        </Label>
        <Textarea value={editedTask.description || ""}
          onChange={e => { const u = { ...editedTask, description: e.target.value }; setEditedTask(u); onUpdate(u); }}
          placeholder="Add a description..." className="min-h-[80px] text-sm resize-none" />
      </div>

      {/* Photos */}
      <PhotosSection editedTask={editedTask} setEditedTask={setEditedTask} onUpdate={onUpdate}
        isNative={isNative} takePhoto={takePhoto} pickFromGallery={pickFromGallery}
        handleFileInputChange={handleFileInputChange} fileInputRef={fileInputRef} cameraInputRef={cameraInputRef} />

      {/* Custom fields - 2 col grid */}
      {visibleFields.length > 0 && (
        <div className="space-y-2">
          <SectionHeading icon={<span className="text-sm">⚙️</span>} label="Fields" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {visibleFields.map(field => (
              <div key={field.id} className="space-y-0.5 min-w-0">
                <Label className="text-[11px] text-muted-foreground truncate block">{field.name}</Label>
                <Input
                  type={
                    field.type === "number" ? "number" :
                    field.type === "email" ? "email" :
                    field.type === "url" ? "url" :
                    field.type === "date" ? "date" :
                    "text"
                  }
                  value={getFieldValue(field.id)}
                  onChange={e => handleFieldChange(field.id, field.type === "number" ? Number(e.target.value) : e.target.value)}
                  className="h-7 text-sm" placeholder="—" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spare parts */}
      <div className="space-y-2">
        <SectionHeading icon={<Package className="h-3.5 w-3.5" />} label="Spare Parts / Stock" />
        <SparePartsSection editedTask={editedTask} setEditedTask={setEditedTask} onUpdate={onUpdate}
          inventoryItems={inventoryItems} loadingInventory={loadingInventory} user={user} />
      </div>

      {/* Inline activity (side-panel) */}
      {showActivity && (
        <div className="space-y-2">
          <SectionHeading icon={<Clock className="h-3.5 w-3.5" />} label="Activity" />
          <ActivitySection editedTask={editedTask} workspaceId={workspaceId}
            user={user} formatTimestamp={formatTimestamp} />
        </div>
      )}
    </div>
  );
}

// ── Main exported component ────────────────────────────────────────────────────
export function TaskDetailPanel({ task, visibleFields, allFields, allLists, forms = [], onUpdate, onMoveTask, onClose,
  isFullScreen = false, currentViewContext, onGenerateQuote, onGenerateInvoice, onGenerateAssessment }: TaskDetailPanelProps) {
  const { user, workspace, members } = useAuth();
  const isMobile = useIsMobile();
  const [editedTask, setEditedTask] = useState<Task>(task);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [technicians, setTechnicians] = useState<string[]>([]);
  const [requirePhotoBeforeEdit, setRequirePhotoBeforeEdit] = useState(false);

  useEffect(() => { setEditedTask(task); }, [task.id]);
  useEffect(() => { setEditedTask(prev => prev.id === task.id ? { ...prev, ...task } : task); }, [task]);

  useEffect(() => {
    if (!workspace?.id) return;
    loadJobSettings(workspace.id).then(s => setRequirePhotoBeforeEdit(s.requirePhotoBeforeEdit)).catch(() => {});
  }, [workspace?.id]);

  useEffect(() => {
    if (!workspace?.id) return;
    const cached = _invCache.get(workspace.id);
    if (cached) { setInventoryItems(cached); return; }
    setLoadingInventory(true);
    inventoryService.getAll(workspace.id)
      .then(items => { _invCache.set(workspace.id, items); setInventoryItems(items); })
      .catch(err => console.error("Error loading inventory:", err))
      .finally(() => setLoadingInventory(false));
  }, [workspace?.id]);

  // Load technicians fresh each time (no cache — list is tiny and must stay current)
  useEffect(() => {
    if (!workspace?.id) return;
    loadTechnicians(workspace.id)
      .then(techs => setTechnicians(techs.map(t => t.name)))
      .catch(() => {});
  }, [workspace?.id]);

  const taskList = allLists.find(l => l.id === task.listId);
  const taskStatuses = taskList?.customStatuses && taskList.customStatuses.length > 0
    ? taskList.customStatuses : DEFAULT_STATUSES;

  const formatTimestamp = useCallback((timestamp: string) => {
    const date = new Date(timestamp);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }, []);

  const { takePhoto, pickFromGallery, handleFileInputChange, fileInputRef, cameraInputRef, isNative } =
    useCameraUpload((dataUrls, thumbnailUrls) => {
      const photos = editedTask.photos || [];
      const thumbs = editedTask.photoThumbnails || [];
      const updated: Task = {
        ...editedTask,
        photos: [...photos, ...dataUrls],
        ...(thumbnailUrls?.length ? { photoThumbnails: [...thumbs, ...thumbnailUrls] } : {}),
      };
      setEditedTask(updated); onUpdate(updated);
    }, editedTask.id);

  const photoLocked = requirePhotoBeforeEdit && (!editedTask.photos || editedTask.photos.length === 0);

  const bodyProps: BodyProps = {
    editedTask, setEditedTask, onUpdate, onMoveTask,
    visibleFields, allLists, taskStatuses,
    inventoryItems, loadingInventory, technicians, members, user,
    isNative, takePhoto, pickFromGallery,
    handleFileInputChange, fileInputRef, cameraInputRef,
    formatTimestamp, photoLocked, workspaceId: workspace?.id,
  };

  const headerBar = (
    <div className="flex items-center justify-between border-b border-border shrink-0 px-4 py-2.5 bg-background">
      <div className="flex items-center gap-2 min-w-0">
        {isMobile && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        {editedTask.jobNumber && (
          <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded shrink-0">
            {editedTask.jobNumber}
          </span>
        )}
        {currentViewContext === "Tasks with Issues" && (
          <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full shrink-0">Issues</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {onGenerateQuote && (
          <Button
            onClick={() => onGenerateQuote(editedTask)}
            variant={editedTask.linkedQuotationId ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 gap-1.5 text-xs"
          >
            <DollarSign className="h-3.5 w-3.5" />
            {editedTask.linkedQuotationId ? "Edit Quote" : "Quote"}
          </Button>
        )}
        {onGenerateInvoice && (
          <Button onClick={() => onGenerateInvoice(editedTask)} variant="outline" size="sm" className="h-7 px-2.5 gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" /> Invoice
          </Button>
        )}
        {onGenerateAssessment && (
          <Button onClick={() => onGenerateAssessment(editedTask)} variant="outline" size="sm" className="h-7 px-2.5 gap-1.5 text-xs">
            <ClipboardList className="h-3.5 w-3.5" /> Assessment
          </Button>
        )}
        {(() => {
          // Prefer a form whose targetListId matches this task's list.
          // Fall back to the first sticker-enabled form in the workspace so
          // every task gets a reprint button regardless of which list it's in.
          const allSticker = forms.filter(f => f.stickerEnabled);
          if (allSticker.length === 0) return null;
          const form = allSticker.find(f => f.targetListId === editedTask.listId) ?? allSticker[0];
          return (
            <Button
              onClick={async () => {
                try {
                  const { printJobStickers, buildStickerDataFromTask, isThermalPrintSupported } =
                    await import("@/lib/thermalPrinterService");
                  if (!isThermalPrintSupported()) {
                    toast.error("Printing needs Chrome / Edge on the desktop plugged into the printer.");
                    return;
                  }
                  const customFieldsObj: Record<string, any> = {};
                  (editedTask.customFieldValues || []).forEach(v => {
                    customFieldsObj[v.fieldId] = v.value;
                  });
                  const data = buildStickerDataFromTask(
                    form,
                    {
                      jobNumber: editedTask.jobNumber || editedTask.id,
                      customFields: customFieldsObj,
                      createdAt: editedTask.createdAt,
                    },
                    allFields,
                  );
                  await printJobStickers(form, data, form.stickerCount || 1);
                  toast.success(`Reprinted ${form.stickerCount || 1} sticker(s) for ${editedTask.jobNumber || editedTask.id}.`);
                } catch (err: any) {
                  const msg = err?.message || String(err);
                  toast.error("Reprint failed: " + msg);
                }
              }}
              variant="outline"
              size="sm"
              className="h-7 px-2.5 gap-1.5 text-xs border-amber-300 text-amber-900 hover:bg-amber-100"
              title="Reprint sticker on the configured Xprinter"
            >
              <Printer className="h-3.5 w-3.5" /> Reprint sticker
            </Button>
          );
        })()}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  // Full-screen layout
  if (isFullScreen) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />
        <div className="fixed inset-0 z-50 bg-background overflow-hidden flex flex-col">
          {headerBar}
          <div className="flex-1 overflow-hidden">
            {isMobile ? (
              <div className="h-full overflow-y-auto">
                <TaskPanelBody {...bodyProps} showActivity={true} />
              </div>
            ) : (
              <div className="flex h-full">
                <div className="flex-1 overflow-y-auto border-r border-border">
                  <TaskPanelBody {...bodyProps} showActivity={false} />
                </div>
                <div className="w-[380px] shrink-0 overflow-y-auto p-4">
                  <ActivitySection editedTask={editedTask} workspaceId={workspace?.id}
                    user={user} formatTimestamp={formatTimestamp} />
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // Side-panel layout
  return (
    <div className="flex flex-col h-full bg-background">
      {headerBar}
      {isMobile ? (
        <div className="flex-1 overflow-y-auto">
          <TaskPanelBody {...bodyProps} showActivity={true} />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto border-r border-border">
            <TaskPanelBody {...bodyProps} showActivity={false} />
          </div>
          <div className="w-[300px] shrink-0 overflow-y-auto p-4">
            <ActivitySection editedTask={editedTask} workspaceId={workspace?.id}
              user={user} formatTimestamp={formatTimestamp} />
          </div>
        </div>
      )}
    </div>
  );
}
