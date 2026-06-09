import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Loader2, Save, Camera } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { loadJobSettings, saveJobSettings, JobSettings, DEFAULT_JOB_SETTINGS } from "@/lib/jobSettingsService";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function JobSettingsDialog({ open, onClose }: Props) {
  const { workspaceId } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<JobSettings>(DEFAULT_JOB_SETTINGS);

  useEffect(() => {
    if (open && workspaceId) {
      setLoading(true);
      loadJobSettings(workspaceId)
        .then(setSettings)
        .catch(() => toast({ title: "Error", description: "Failed to load settings", variant: "destructive" }))
        .finally(() => setLoading(false));
    }
  }, [open, workspaceId]);

  async function handleSave() {
    if (!workspaceId) return;
    setSaving(true);
    try {
      await saveJobSettings(workspaceId, settings);
      toast({ title: "Saved", description: "Job settings saved" });
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-orange-500" />
            Job Settings
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <Separator />
            <div className="flex items-start gap-3 p-4 border rounded-lg bg-muted/20">
              <Checkbox
                id="requirePhoto"
                checked={settings.requirePhotoBeforeEdit}
                onCheckedChange={v =>
                  setSettings(prev => ({ ...prev, requirePhotoBeforeEdit: v === true }))
                }
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="requirePhoto" className="cursor-pointer font-medium">
                  Require photo before editing a job
                </Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, staff cannot edit any fields on a job card until at least one photo of the unit has been uploaded. The photo upload button remains accessible. Recommended for ensuring all units are photographed on arrival.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
            ) : (
              <><Save className="h-4 w-4 mr-2" />Save</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
