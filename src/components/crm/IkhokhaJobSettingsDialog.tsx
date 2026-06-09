import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Eye, EyeOff, CreditCard } from "lucide-react";
import { loadIkhokhaJobSettings, saveIkhokhaJobSettings, IkhokhaJobSettings } from "@/lib/ikhokhaJobService";

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
}

export function IkhokhaJobSettingsDialog({ open, onClose, workspaceId }: Props) {
  const [settings, setSettings] = useState<IkhokhaJobSettings>({ enabled: false, appId: "", appSecret: "" });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (!open || !workspaceId) return;
    setLoading(true);
    loadIkhokhaJobSettings(workspaceId)
      .then(setSettings)
      .finally(() => setLoading(false));
  }, [open, workspaceId]);

  const handleSave = async () => {
    if (settings.enabled && (!settings.appId.trim() || !settings.appSecret.trim())) {
      toast.error("Please enter both App ID and App Secret before enabling.");
      return;
    }
    setSaving(true);
    try {
      await saveIkhokhaJobSettings(workspaceId, {
        ...settings,
        appId: settings.appId.trim(),
        appSecret: settings.appSecret.trim(),
      });
      toast.success("iKhokha CRM settings saved");
      onClose();
    } catch (err) {
      console.error(err);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-green-500" />
            iKhokha CRM Payments
          </DialogTitle>
          <DialogDescription>
            Configure your iKhokha card reader credentials for CRM job deposit payments.
            These are separate from the ecommerce iKhokha integration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Enable deposit payments</p>
              <p className="text-xs text-muted-foreground">
                Auto-open card payment screen when a form with a deposit field is submitted
              </p>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(v) => setSettings((s) => ({ ...s, enabled: v }))}
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">App ID (IK-APPID)</Label>
            <Input
              value={settings.appId}
              onChange={(e) => setSettings((s) => ({ ...s, appId: e.target.value }))}
              placeholder="IK…"
              disabled={loading}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Found in your iKhokha Merchant Dashboard → iK Pay API
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">App Secret</Label>
            <div className="relative">
              <Input
                type={showSecret ? "text" : "password"}
                value={settings.appSecret}
                onChange={(e) => setSettings((s) => ({ ...s, appSecret: e.target.value }))}
                placeholder="Enter App Secret"
                disabled={loading}
                className="font-mono text-sm pr-10"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored securely in Firestore — never sent to the browser for payments
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Collected status label</Label>
            <Input
              value={settings.collectedStatusLabel}
              onChange={(e) => setSettings((s) => ({ ...s, collectedStatusLabel: e.target.value }))}
              placeholder="Collected"
              disabled={loading}
              className="text-sm"
            />
            <p className="text-xs text-muted-foreground">
              When staff enters a job number (e.g. <span className="font-mono">JOB-0042</span>) as the description on the iK Flyer, the task automatically moves to this status. Must match exactly a status name in your list.
            </p>
          </div>

          <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800/40 dark:bg-blue-900/10 px-4 py-3">
            <p className="text-xs text-blue-700 dark:text-blue-300 font-medium mb-1">How it works</p>
            <ol className="text-xs text-blue-600 dark:text-blue-400 space-y-1 list-decimal list-inside">
              <li>Staff submits drop-off form — task + job number created</li>
              <li>Deposit amount banner appears — staff processes deposit payment</li>
              <li>When client collects: staff enters <strong>balance amount</strong> on iK Flyer</li>
              <li>Sets description to the job number e.g. <span className="font-mono">JOB-0042</span></li>
              <li>Customer taps card — within 2 minutes task moves to <strong>{settings.collectedStatusLabel || "Collected"}</strong> automatically</li>
            </ol>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading} className="bg-green-600 hover:bg-green-700 text-white">
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
