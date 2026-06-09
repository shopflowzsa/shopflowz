import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { loadSupervisorSecuritySettings, saveSupervisorPassword } from "@/lib/supervisorSecurityService";

interface Props {
  open: boolean;
  onClose: () => void;
}

const MAIN_OWNER_EMAIL = "info@shopflowz.co.za";

export function SupervisorPasswordDialog({ open, onClose }: Props) {
  const { workspaceId, user, isSystemAdmin } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const canManage = isSystemAdmin || user?.email?.toLowerCase() === MAIN_OWNER_EMAIL;

  useEffect(() => {
    if (!open || !workspaceId) return;
    setPassword("");
    setConfirmPassword("");
    setLoading(true);
    loadSupervisorSecuritySettings(workspaceId)
      .then(settings => setHasPassword(!!settings.passwordHash))
      .catch(() => toast({ title: "Error", description: "Could not load supervisor password settings.", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [open, workspaceId]);

  async function handleSave() {
    if (!workspaceId || !user) return;
    if (!canManage) {
      toast({ title: "Not allowed", description: "Only the main system owner can set this password.", variant: "destructive" });
      return;
    }
    if (password.length < 4) {
      toast({ title: "Password too short", description: "Use at least 4 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      await saveSupervisorPassword(workspaceId, password, user.uid);
      toast({ title: "Supervisor password saved" });
      onClose();
    } catch (error) {
      console.error("Failed to save supervisor password:", error);
      toast({ title: "Error", description: "Could not save supervisor password.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            Supervisor Password
          </DialogTitle>
          <DialogDescription>
            Required before reversing paid ecommerce orders and reinserting stock.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {hasPassword && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                A supervisor password is already set. Saving here will replace it.
              </div>
            )}

            {!canManage && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Only {MAIN_OWNER_EMAIL} can set or change this password.
              </div>
            )}

            <div className="space-y-2">
              <Label>New Supervisor Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={!canManage}
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-2">
              <Label>Confirm Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={!canManage}
                autoComplete="new-password"
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loading || !canManage}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
