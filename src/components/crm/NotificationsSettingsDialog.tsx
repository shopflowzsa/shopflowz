import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Bell, ShoppingCart, Wrench, CheckSquare, Receipt, Package, Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface NotificationConfig {
  enabled: boolean;
  email: string;
  whatsapp: string;
}

export interface NotificationsSettings {
  [key: string]: NotificationConfig;
}

interface EventDef {
  key: string;
  label: string;
}

interface CategoryDef {
  label: string;
  icon: React.ReactNode;
  color: string;
  events: EventDef[];
}

const CATEGORIES: CategoryDef[] = [
  {
    label: "Ecommerce",
    icon: <ShoppingCart className="h-4 w-4" />,
    color: "text-blue-400",
    events: [
      { key: "ecommerceNewOrder", label: "New Order Placed" },
      { key: "ecommerceOrderPaid", label: "Order Payment Confirmed" },
    ],
  },
  {
    label: "CRM / Jobs",
    icon: <Wrench className="h-4 w-4" />,
    color: "text-orange-400",
    events: [
      { key: "crmNewBooking", label: "New Job Booked In" },
      { key: "crmJobReady", label: "Job Ready for Collection" },
      { key: "crmJobCollected", label: "Job Collected" },
    ],
  },
  {
    label: "Tasks",
    icon: <CheckSquare className="h-4 w-4" />,
    color: "text-green-400",
    events: [
      { key: "taskDeleted", label: "Task Deleted" },
      { key: "taskCompleted", label: "Task Completed" },
      { key: "taskOverdue", label: "Task Overdue" },
    ],
  },
  {
    label: "Invoicing",
    icon: <Receipt className="h-4 w-4" />,
    color: "text-purple-400",
    events: [
      { key: "invoiceCreated", label: "New Invoice Created" },
      { key: "invoicePaid", label: "Invoice Paid" },
    ],
  },
  {
    label: "Inventory",
    icon: <Package className="h-4 w-4" />,
    color: "text-yellow-400",
    events: [
      { key: "inventoryLowStock", label: "Low Stock Alert" },
    ],
  },
];

const DEFAULT_CONFIG: NotificationConfig = { enabled: false, email: "", whatsapp: "" };

function buildDefaultSettings(): NotificationsSettings {
  const s: NotificationsSettings = {};
  for (const cat of CATEGORIES) {
    for (const ev of cat.events) {
      s[ev.key] = { ...DEFAULT_CONFIG };
    }
  }
  return s;
}

export async function getNotificationConfig(
  workspaceId: string,
  event: string,
): Promise<NotificationConfig | null> {
  const { data } = await supabase
    .from("workspace_settings")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("category", "notifications")
    .maybeSingle();
  if (!data?.data) return null;
  const cfg = (data.data as NotificationsSettings)[event];
  return cfg ?? null;
}

interface NotificationsSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function NotificationsSettingsDialog({ open, onClose }: NotificationsSettingsDialogProps) {
  const { workspaceId } = useAuth();
  const [settings, setSettings] = useState<NotificationsSettings>(buildDefaultSettings());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !workspaceId) return;
    setLoading(true);
    supabase
      .from("workspace_settings")
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("category", "notifications")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.data) {
          setSettings({ ...buildDefaultSettings(), ...(data.data as NotificationsSettings) });
        } else {
          setSettings(buildDefaultSettings());
        }
        setLoading(false);
      });
  }, [open, workspaceId]);

  function updateConfig(key: string, patch: Partial<NotificationConfig>) {
    setSettings(prev => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  }

  async function handleSave() {
    if (!workspaceId) return;
    setSaving(true);
    const { error } = await supabase
      .from("workspace_settings")
      .upsert({ workspace_id: workspaceId, category: "notifications", data: settings });
    setSaving(false);
    if (error) {
      toast.error("Failed to save notification settings");
    } else {
      toast.success("Notification settings saved");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-yellow-400" />
            Notification Settings
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-4">
            {CATEGORIES.map((cat, catIdx) => (
              <div key={cat.label}>
                {catIdx > 0 && <Separator className="mb-4" />}
                <div className={`flex items-center gap-2 font-semibold mb-3 ${cat.color}`}>
                  {cat.icon}
                  <span>{cat.label}</span>
                </div>
                <div className="space-y-3">
                  {cat.events.map((ev) => {
                    const cfg = settings[ev.key] ?? DEFAULT_CONFIG;
                    return (
                      <div key={ev.key} className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={cfg.enabled}
                            onCheckedChange={(v) => updateConfig(ev.key, { enabled: v })}
                          />
                          <span className="text-sm font-medium">{ev.label}</span>
                        </div>
                        {cfg.enabled && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            <Input
                              placeholder="Email address"
                              value={cfg.email}
                              onChange={(e) => updateConfig(ev.key, { email: e.target.value })}
                              className="h-8 text-sm"
                            />
                            <Input
                              placeholder="WhatsApp e.g. +27821234567"
                              value={cfg.whatsapp}
                              onChange={(e) => updateConfig(ev.key, { whatsapp: e.target.value })}
                              className="h-8 text-sm"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
