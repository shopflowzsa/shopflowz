import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";
import { ItemPermission } from "@/types/crm";

interface PermissionManagerProps {
  open: boolean;
  onClose: () => void;
  itemName: string;
  itemType: "space" | "folder" | "list";
  permissions: Record<string, ItemPermission>;
  onPermissionsChange: (perms: Record<string, ItemPermission>) => void;
}

const PERMISSION_OPTIONS: { value: ItemPermission; label: string; desc: string }[] = [
  { value: "inherit", label: "Inherit", desc: "Use workspace role" },
  { value: "editor", label: "Editor", desc: "Can edit" },
  { value: "viewer", label: "Viewer", desc: "Read only" },
  { value: "none", label: "Hidden", desc: "Cannot see this item" },
];

export function PermissionManager({
  open, onClose, itemName, itemType, permissions, onPermissionsChange,
}: PermissionManagerProps) {
  const { members, user } = useAuth();

  // Only show non-owner members
  const targetMembers = members.filter((m) => m.role !== "owner");

  function setPermission(uid: string, perm: ItemPermission) {
    const updated = { ...permissions, [uid]: perm };
    onPermissionsChange(updated);
  }

  function initials(name?: string, email?: string) {
    const s = name || email || "?";
    return s.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Permissions — {itemName}
          </DialogTitle>
          <DialogDescription>
            Control who can see and edit this {itemType}. "Inherit" uses the member's workspace role.
          </DialogDescription>
        </DialogHeader>

        {targetMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No members to configure. Invite people from the Manage Users menu.
          </p>
        ) : (
          <div className="space-y-2 pt-2">
            {targetMembers.map((m) => {
              const perm = permissions[m.uid] ?? "inherit";
              return (
                <div
                  key={m.uid}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">
                      {initials(m.displayName, m.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {m.displayName || m.email}
                      {m.uid === user?.uid && (
                        <span className="text-muted-foreground font-normal"> (you)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </div>
                  <Badge variant="outline" className="text-xs mr-2 shrink-0">
                    {m.role}
                  </Badge>
                  <Select
                    value={perm}
                    onValueChange={(v) => setPermission(m.uid, v as ItemPermission)}
                  >
                    <SelectTrigger className="h-7 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERMISSION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div>
                            <span className="font-medium">{opt.label}</span>
                            <span className="text-muted-foreground"> — {opt.desc}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
