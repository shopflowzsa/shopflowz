import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TaskStatus, TaskPriority, DEFAULT_STATUSES, PRIORITIES } from "@/types/crm";

// ---- Create Space Dialog ----
export function CreateSpaceDialog({ open, onClose, onCreate }: {
  open: boolean; onClose: () => void; onCreate: (name: string, icon: string) => void;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🚀");
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Create Space</DialogTitle>
          <DialogDescription className="sr-only">Add a new space to your workspace.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex gap-2">
            <div>
              <Label className="text-xs">Icon</Label>
              <Input value={icon} onChange={e => setIcon(e.target.value)} className="w-16 h-8 text-center" />
            </div>
            <div className="flex-1">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} className="h-8" placeholder="Space name..." autoFocus />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => { if (name.trim()) { onCreate(name.trim(), icon); onClose(); setName(""); } }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Create Folder Dialog ----
export function CreateFolderDialog({ open, onClose, onCreate, spaceId }: {
  open: boolean; onClose: () => void; onCreate: (name: string, spaceId: string) => void; spaceId: string;
}) {
  const [name, setName] = useState("");
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Create Folder</DialogTitle>
          <DialogDescription className="sr-only">Add a new folder inside this space.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} className="h-8" placeholder="Folder name..." autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => { if (name.trim()) { onCreate(name.trim(), spaceId); onClose(); setName(""); } }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Create List Dialog ----
export function CreateListDialog({ open, onClose, onCreate, parentId, parentType }: {
  open: boolean; onClose: () => void;
  onCreate: (name: string, parentId: string, parentType: "folder" | "space") => void;
  parentId: string; parentType: "folder" | "space";
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📋");
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Create List</DialogTitle>
          <DialogDescription className="sr-only">Add a new list to organise tasks.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex gap-2">
            <div>
              <Label className="text-xs">Icon</Label>
              <Input value={icon} onChange={e => setIcon(e.target.value)} className="w-16 h-8 text-center" />
            </div>
            <div className="flex-1">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} className="h-8" placeholder="List name..." autoFocus />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => { if (name.trim()) { onCreate(name.trim(), parentId, parentType); onClose(); setName(""); } }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Create Task Dialog ----
export function CreateTaskDialog({ open, onClose, onCreate, defaultStatus }: {
  open: boolean; onClose: () => void;
  onCreate: (title: string, status: TaskStatus, priority: TaskPriority, description?: string) => void;
  defaultStatus?: TaskStatus;
}) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<TaskStatus>(defaultStatus || "to_do");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [description, setDescription] = useState("");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
          <DialogDescription className="sr-only">Add a new task to this list.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} className="h-8" placeholder="Task title..." autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={v => setStatus(v as TaskStatus)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEFAULT_STATUSES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={v => setPriority(v as TaskPriority)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Description (optional)</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} className="min-h-[60px] text-sm" placeholder="Describe the task..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => {
            if (title.trim()) {
              onCreate(title.trim(), status, priority, description || undefined);
              onClose(); setTitle(""); setDescription("");
            }
          }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
