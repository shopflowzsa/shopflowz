import { useState, useEffect } from "react";
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, GripVertical } from "lucide-react";
import { StatusConfig, TaskStatus, DEFAULT_STATUSES, WorkspaceState } from "@/types/crm";

interface StatusManagerProps {
  open: boolean;
  onClose: () => void;
  listId: string;
  workspace: WorkspaceState;
  onUpdateWorkspace: (ws: WorkspaceState) => void;
}

const STATUS_COLORS = [
  { value: "bg-gray-100 text-gray-700", label: "Gray" },
  { value: "bg-blue-100 text-blue-700", label: "Blue" },
  { value: "bg-green-100 text-green-700", label: "Green" },
  { value: "bg-yellow-100 text-yellow-700", label: "Yellow" },
  { value: "bg-red-100 text-red-700", label: "Red" },
  { value: "bg-purple-100 text-purple-700", label: "Purple" },
  { value: "bg-pink-100 text-pink-700", label: "Pink" },
  { value: "bg-orange-100 text-orange-700", label: "Orange" },
  { value: "bg-muted text-muted-foreground", label: "Muted" },
  { value: "bg-info text-info-foreground", label: "Info" },
  { value: "bg-success text-success-foreground", label: "Success" },
  { value: "bg-warning text-warning-foreground", label: "Warning" },
  { value: "bg-destructive text-destructive-foreground", label: "Destructive" },
];

function SortableStatusRow({
  status,
  editingId,
  editLabel,
  editColor,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onLabelChange,
  onColorChange,
  canDelete,
}: {
  status: StatusConfig;
  editingId: string | null;
  editLabel: string;
  editColor: string;
  onStartEdit: (s: StatusConfig) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
  onLabelChange: (v: string) => void;
  onColorChange: (v: string) => void;
  canDelete: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 p-2 rounded border bg-background">
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing touch-none p-1 -ml-1 text-muted-foreground hover:text-foreground">
        <GripVertical className="h-4 w-4" />
      </div>

      {editingId === status.id ? (
        <>
          <Input value={editLabel} onChange={(e) => onLabelChange(e.target.value)} className="h-8 flex-1" placeholder="Status label" autoFocus />
          <select value={editColor} onChange={(e) => onColorChange(e.target.value)} className="h-8 px-2 border rounded text-sm">
            {STATUS_COLORS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <Button size="sm" onClick={onSaveEdit}>Save</Button>
          <Button size="sm" variant="outline" onClick={onCancelEdit}>Cancel</Button>
        </>
      ) : (
        <>
          <div className={`px-3 py-1 rounded text-sm font-medium ${status.color}`}>{status.label}</div>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => onStartEdit(status)}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDelete(status.id)} disabled={!canDelete} className="text-destructive">
            <Trash2 className="h-3 w-3" />
          </Button>
        </>
      )}
    </div>
  );
}

export function StatusManager({ open, onClose, listId, workspace, onUpdateWorkspace }: StatusManagerProps) {
  const targetList = workspace.lists.find(l => l.id === listId);
  const listName = targetList?.name || "List";
  const currentStatuses = targetList?.customStatuses && targetList.customStatuses.length > 0
    ? targetList.customStatuses
    : DEFAULT_STATUSES;

  const [statuses, setStatuses] = useState<StatusConfig[]>(currentStatuses);

  // Re-sync when the dialog opens for a different list
  useEffect(() => {
    if (open) setStatuses(currentStatuses);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, listId]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(STATUS_COLORS[0].value);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setStatuses(prev => {
        const oldIndex = prev.findIndex(s => s.id === active.id);
        const newIndex = prev.findIndex(s => s.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  const startEdit = (status: StatusConfig) => {
    setEditingId(status.id);
    setEditLabel(status.label);
    setEditColor(status.color);
    setShowAdd(false);
  };

  const saveEdit = () => {
    if (!editLabel.trim() || !editingId) return;
    setStatuses(prev => prev.map(s => s.id === editingId ? { ...s, label: editLabel.trim(), color: editColor } : s));
    setEditingId(null);
  };

  const deleteStatus = (id: string) => {
    if (statuses.length <= 1) return; // Must have at least one status
    setStatuses(prev => prev.filter(s => s.id !== id));
  };

  const addStatus = () => {
    if (!newLabel.trim()) return;
    const newId = `status_${Date.now()}` as TaskStatus;
    setStatuses(prev => [...prev, { id: newId, label: newLabel.trim(), color: newColor }]);
    setNewLabel("");
    setNewColor(STATUS_COLORS[0].value);
    setShowAdd(false);
  };

  const handleSave = () => {
    const updatedLists = workspace.lists.map(l =>
      l.id === listId ? { ...l, customStatuses: statuses } : l
    );
    onUpdateWorkspace({ ...workspace, lists: updatedLists });
    onClose();
  };

  const resetToDefaults = () => {
    setStatuses(DEFAULT_STATUSES);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Statuses - {listName}</DialogTitle>
          <DialogDescription>
            Customize the statuses for this list. Tasks will use these statuses in board view.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Existing Statuses */}
          <div className="space-y-2">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={statuses.map(s => s.id)} strategy={verticalListSortingStrategy}>
                {statuses.map((status) => (
                  <SortableStatusRow
                    key={status.id}
                    status={status}
                    editingId={editingId}
                    editLabel={editLabel}
                    editColor={editColor}
                    onStartEdit={startEdit}
                    onSaveEdit={saveEdit}
                    onCancelEdit={() => setEditingId(null)}
                    onDelete={deleteStatus}
                    onLabelChange={setEditLabel}
                    onColorChange={setEditColor}
                    canDelete={statuses.length > 1}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>

          {/* Add New Status */}
          {showAdd ? (
            <div className="flex items-center gap-2 p-2 rounded border border-dashed">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="h-8 flex-1"
                placeholder="New status label"
                autoFocus
              />
              <select
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="h-8 px-2 border rounded text-sm"
              >
                {STATUS_COLORS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <Button size="sm" onClick={addStatus}>Add</Button>
              <Button size="sm" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowAdd(true)} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Add Status
            </Button>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t">
            <Button variant="outline" size="sm" onClick={resetToDefaults}>
              Reset to Defaults
            </Button>
            <div className="flex-1" />
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
