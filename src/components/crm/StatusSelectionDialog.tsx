import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect } from "react";
import { StatusConfig, Task } from "@/types/crm";
import { cn } from "@/lib/utils";

interface StatusSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  task: Task | null;
  targetListName: string;
  availableStatuses: StatusConfig[];
  onConfirm: (selectedStatus: string) => void;
}

export function StatusSelectionDialog({
  open,
  onClose,
  task,
  targetListName,
  availableStatuses,
  onConfirm,
}: StatusSelectionDialogProps) {
  const [selectedStatus, setSelectedStatus] = useState<string>(availableStatuses[0]?.id || "");

  // Reset selection whenever the dialog opens with a new list's statuses
  useEffect(() => {
    if (open) setSelectedStatus(availableStatuses[0]?.id || "");
  }, [open, availableStatuses]);

  const handleConfirm = () => {
    if (selectedStatus) {
      onConfirm(selectedStatus);
      onClose();
    }
  };

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move to {targetListName}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            Select the status for <strong>{task.title}</strong> in <strong>{targetListName}</strong>.
          </p>
          
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Assign Status in {targetListName}:</label>
              <div className="mt-1">
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableStatuses.map((status) => (
                      <SelectItem key={status.id} value={status.id}>
                        <div className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold", status.color)}>
                          {status.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedStatus}>
            Confirm
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}