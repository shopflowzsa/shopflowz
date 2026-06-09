import { useState } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MoreHorizontal, Pencil, Trash2, Palette, ListChecks,
  Copy, Archive, Star, CircleDot,
} from "lucide-react";

type ItemType = "space" | "folder" | "list";

interface ItemContextMenuProps {
  itemType: ItemType;
  itemName: string;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onCustomFields: () => void;
  onTaskStatuses?: () => void;
  onDuplicate?: () => void;
}

export function ItemContextMenu({
  itemType, itemName, onRename, onDelete, onCustomFields, onTaskStatuses, onDuplicate,
}: ItemContextMenuProps) {
  const [showRename, setShowRename] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [newName, setNewName] = useState(itemName);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={e => e.stopPropagation()}
            className="p-0.5 rounded hover:bg-muted"
          >
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48" onClick={e => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => { setNewName(itemName); setShowRename(true); }}>
            <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
          </DropdownMenuItem>
          {onDuplicate && (
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setTimeout(onCustomFields, 50)}>
            <ListChecks className="h-3.5 w-3.5 mr-2" /> Custom Fields
          </DropdownMenuItem>
          {itemType === "list" && onTaskStatuses && (
            <DropdownMenuItem onClick={() => setTimeout(onTaskStatuses, 50)}>
              <CircleDot className="h-3.5 w-3.5 mr-2" /> Task Statuses
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowDelete(true)} className="text-destructive focus:text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rename Dialog */}
      <Dialog open={showRename} onOpenChange={setShowRename}>
        <DialogContent className="sm:max-w-[350px]" onClick={e => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Rename {itemType}</DialogTitle>
            <DialogDescription className="sr-only">Enter a new name for this {itemType}.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs">Name</Label>
            <Input value={newName} onChange={e => setNewName(e.target.value)} className="h-8" autoFocus
              onKeyDown={e => { if (e.key === "Enter" && newName.trim()) { onRename(newName.trim()); setShowRename(false); } }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowRename(false)}>Cancel</Button>
            <Button size="sm" onClick={() => { if (newName.trim()) { onRename(newName.trim()); setShowRename(false); } }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="sm:max-w-[350px]" onClick={e => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Delete {itemType}?</DialogTitle>
            <DialogDescription className="sr-only">Confirm deletion of this {itemType}.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete <strong>{itemName}</strong>? This will also delete all items inside it.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => { onDelete(); setShowDelete(false); }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
