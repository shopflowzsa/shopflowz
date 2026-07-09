import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Trash2, Loader2, Save, Store, Truck, MapPin, DollarSign, Settings2, Eye, FileText,
  Link as LinkIcon, Globe, Copy, Check, ExternalLink, CreditCard, Bell, MessageCircle,
} from "lucide-react";
import { PAYMENT_PROVIDERS } from "@/lib/paymentProviders";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  loadEcommerceSettings,
  saveEcommerceSettings,
} from "@/lib/ecommerceSettingsService";
import { updateStoreSlug, saveCustomDomain } from "@/lib/storeService";
import { supabase } from "@/lib/supabase";
import {
  EcommerceSettings,
  DeliveryZone,
  DEFAULT_ECOMMERCE_SETTINGS,
  WhatsAppNotifications,
} from "@/types/ecommerce";
import {
  NOTIFICATION_EVENTS,
  getDefaultTemplate,
  NotificationEventKey,
} from "@/lib/whatsappNotificationService";

interface Props {
  open: boolean;
  onClose: () => void;
  initialTab?: string;
}

export function EcommerceSettingsDialog({ open, onClose, initialTab }: Props) {
  const { workspaceId, user, workspace } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState(initialTab ?? "delivery");

  // Jump to the requested tab whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) setActiveTab(initialTab ?? "delivery");
  }, [open, initialTab]);

  // ── Payment method helpers ──────────────────────────────────────────────────
  // iKhokha + cash reuse the existing top-level fields (so checkout keeps working);
  // every other gateway is stored under settings.paymentMethods[key].
  const isMethodEnabled = (key: string): boolean => {
    if (key === "ikhokha") return settings.enableCardPayments;
    if (key === "cash") return settings.enableCashOnDelivery;
    return settings.paymentMethods?.[key]?.enabled ?? false;
  };
  const setMethodEnabled = (key: string, val: boolean) => {
    if (key === "ikhokha") { setSettings(p => ({ ...p, enableCardPayments: val })); return; }
    if (key === "cash") { setSettings(p => ({ ...p, enableCashOnDelivery: val })); return; }
    setSettings(p => ({ ...p, paymentMethods: { ...p.paymentMethods, [key]: { ...p.paymentMethods?.[key], enabled: val } } }));
  };
  const getMethodField = (key: string, field: string): string => {
    if (key === "ikhokha" && field === "appId") return settings.ikhokhaAppId ?? "";
    if (key === "ikhokha" && field === "appSecret") return settings.ikhokhaAppSecret ?? "";
    return (settings.paymentMethods?.[key]?.[field] as string) ?? "";
  };
  const setMethodField = (key: string, field: string, val: string) => {
    if (key === "ikhokha" && field === "appId") { setSettings(p => ({ ...p, ikhokhaAppId: val })); return; }
    if (key === "ikhokha" && field === "appSecret") { setSettings(p => ({ ...p, ikhokhaAppSecret: val })); return; }
    setSettings(p => ({ ...p, paymentMethods: { ...p.paymentMethods, [key]: { ...p.paymentMethods?.[key], [field]: val } } }));
  };

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<EcommerceSettings>(DEFAULT_ECOMMERCE_SETTINGS);

  // Store URL state
  const [slugInput, setSlugInput] = useState("");
  const [savingSlug, setSavingSlug] = useState(false);
  const [slugCopied, setSlugCopied] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [linkingDomain, setLinkingDomain] = useState(false);
  const [dnsRecords, setDnsRecords] = useState<{ type: string; name: string; value: string }[] | null>(null);
  const [dnsTestResult, setDnsTestResult] = useState<{ status: 'connected' | 'pending' | 'error'; ips?: string[]; message: string } | null>(null);
  const [testingDns, setTestingDns] = useState(false);

  // Sync slug + domain from workspace when dialog opens
  useEffect(() => {
    if (open && workspace) {
      setSlugInput(workspace.storeSlug || "");
      setDomainInput(workspace.customDomain || "");
      setDnsRecords(null);
    }
  }, [open, workspace]);

  // Load settings on mount
  useEffect(() => {
    if (open && workspaceId) {
      loadSettings();
    }
  }, [open, workspaceId]);

  const loadSettings = async () => {
    if (!workspaceId) return;
    
    setLoading(true);
    try {
      const loaded = await loadEcommerceSettings(workspaceId);
      setSettings(loaded);
    } catch (error) {
      console.error("Failed to load ecommerce settings:", error);
      toast({
        title: "Error",
        description: "Failed to load ecommerce settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!workspaceId || !user) return;
    
    setSaving(true);
    try {
      await saveEcommerceSettings(workspaceId, settings, user.uid);
      toast({
        title: "Success",
        description: "Ecommerce settings saved successfully",
      });
      onClose();
    } catch (error) {
      console.error("Failed to save ecommerce settings:", error);
      toast({
        title: "Error",
        description: "Failed to save ecommerce settings",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const STORE_BASE_URL = "https://shopflowz.web.app/store";

  async function handleSaveSlug() {
    if (!workspaceId) return;
    const cleaned = slugInput.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!cleaned) return;
    setSavingSlug(true);
    try {
      await updateStoreSlug(workspaceId, cleaned);
      setSlugInput(cleaned);
      toast({ title: "Store URL saved", description: `Your store is live at ${STORE_BASE_URL}/${cleaned}` });
    } catch {
      toast({ title: "Failed to save", description: "Could not save store slug. Please try again.", variant: "destructive" });
    } finally {
      setSavingSlug(false);
    }
  }

  async function handleCopyStoreUrl() {
    const slug = workspace?.storeSlug || slugInput;
    if (!slug) return;
    await navigator.clipboard.writeText(`${STORE_BASE_URL}/${slug}`);
    setSlugCopied(true);
    setTimeout(() => setSlugCopied(false), 2000);
  }

  async function handleTestDns() {
    const domain = (workspace?.customDomain || domainInput).trim().replace(/^https?:\/\//, '').split('/')[0];
    if (!domain) return;
    setTestingDns(true);
    setDnsTestResult(null);
    try {
      // Firebase Hosting IPs — both the classic and newer ranges
      const FIREBASE_IPS = new Set([
        '151.101.1.195', '151.101.65.195', '151.101.129.195', '151.101.193.195',
        '199.36.158.100', '199.36.158.75',
      ]);
      const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`, {
        headers: { Accept: 'application/json' },
      });
      const json = await res.json() as { Status: number; Answer?: { data: string }[] };
      const ips = (json.Answer || []).map((a) => a.data.trim());
      if (ips.length === 0) {
        setDnsTestResult({ status: 'pending', ips: [], message: 'No A records found yet — DNS may still be propagating.' });
      } else if (ips.some((ip) => FIREBASE_IPS.has(ip))) {
        setDnsTestResult({ status: 'connected', ips, message: `Connected ✓ — resolves to Firebase (${ips.join(', ')})` });
      } else {
        setDnsTestResult({ status: 'pending', ips, message: `Not pointing to Firebase yet — currently resolves to: ${ips.join(', ')}` });
      }
    } catch {
      setDnsTestResult({ status: 'error', message: 'Could not check DNS — check your internet connection.' });
    } finally {
      setTestingDns(false);
    }
  }

  async function handleLinkDomain() {
    if (!workspaceId || !domainInput.trim()) return;
    // Forgiving cleanup: strip protocol, any path, and a leading www.
    const domain = domainInput
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "");
    // Must look like a domain: at least one dot, valid characters only
    if (!domain.includes(".") || !/^[a-z0-9.-]+$/.test(domain)) {
      toast({ title: "Invalid domain", description: "Enter a domain like shop.yourbusiness.co.za or yourbusiness.co.za", variant: "destructive" });
      return;
    }
    setDomainInput(domain);
    setLinkingDomain(true);
    try {
      const res = await supabase.functions.invoke("setup-custom-domain", {
        body: { workspaceId, domain },
      });
      const result = res.data as { dnsRecords?: { type: string; name: string; value: string }[]; error?: string };
      if (result?.error) throw new Error(result.error);
      await saveCustomDomain(workspaceId, domain, "pending");
      if (result?.dnsRecords?.length) setDnsRecords(result.dnsRecords);
      toast({ title: "Domain registered", description: "Add the DNS records shown below at your domain registrar." });
    } catch (e: any) {
      toast({ title: "Failed to register domain", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setLinkingDomain(false);
    }
  }

  const addDeliveryZone = () => {
    const newZone: DeliveryZone = {
      id: `zone-${Date.now()}`,
      name: '',
      fee: 0,
      isActive: true,
    };
    setSettings(prev => ({
      ...prev,
      deliveryZones: [...prev.deliveryZones, newZone],
    }));
  };

  const removeDeliveryZone = (zoneId: string) => {
    setSettings(prev => ({
      ...prev,
      deliveryZones: prev.deliveryZones.filter(z => z.id !== zoneId),
    }));
  };

  const updateDeliveryZone = (zoneId: string, updates: Partial<DeliveryZone>) => {
    setSettings(prev => ({
      ...prev,
      deliveryZones: prev.deliveryZones.map(z =>
        z.id === zoneId ? { ...z, ...updates } : z
      ),
    }));
  };

  const addPickupLocation = () => {
    setSettings(prev => ({
      ...prev,
      pickupLocations: [
        ...prev.pickupLocations,
        { name: '', address: '', phone: '', hours: '' },
      ],
    }));
  };

  const removePickupLocation = (index: number) => {
    setSettings(prev => ({
      ...prev,
      pickupLocations: prev.pickupLocations.filter((_, i) => i !== index),
    }));
  };

  const updatePickupLocation = (index: number, field: string, value: string) => {
    setSettings(prev => ({
      ...prev,
      pickupLocations: prev.pickupLocations.map((loc, i) =>
        i === index ? { ...loc, [field]: value } : loc
      ),
    }));
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-[#cc1818]" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-5 w-5 text-[#cc1818]" />
            Ecommerce Settings
          </DialogTitle>
          <DialogDescription>
            Configure delivery options, pricing, and store settings for your online store
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5 mb-1">
            <TabsTrigger value="delivery"><Truck className="h-4 w-4 mr-1" />Delivery</TabsTrigger>
            <TabsTrigger value="pickup"><MapPin className="h-4 w-4 mr-1" />Pickup</TabsTrigger>
            <TabsTrigger value="payments"><CreditCard className="h-4 w-4 mr-1" />Payment</TabsTrigger>
            <TabsTrigger value="store"><Store className="h-4 w-4 mr-1" />Store</TabsTrigger>
            <TabsTrigger value="services"><Settings2 className="h-4 w-4 mr-1" />Services</TabsTrigger>
          </TabsList>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="policies"><FileText className="h-4 w-4 mr-1" />Policies</TabsTrigger>
            <TabsTrigger value="other"><Settings2 className="h-4 w-4 mr-1" />Other</TabsTrigger>
            <TabsTrigger value="courier"><Truck className="h-4 w-4 mr-1" />Courier</TabsTrigger>
            <TabsTrigger value="storeurl"><Globe className="h-4 w-4 mr-1" />Store URL</TabsTrigger>
            <TabsTrigger value="notifications"><Bell className="h-4 w-4 mr-1" />Notify</TabsTrigger>
          </TabsList>

          {/* Delivery Settings */}
          <TabsContent value="delivery" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable Delivery</Label>
                <p className="text-sm text-gray-500">Allow customers to choose delivery option</p>
              </div>
              <Switch
                checked={settings.enableDelivery}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enableDelivery: checked }))}
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Default Delivery Fee (R)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={settings.defaultDeliveryFee}
                onChange={(e) => setSettings(prev => ({ ...prev, defaultDeliveryFee: parseFloat(e.target.value) || 0 }))}
                placeholder="85.00"
              />
              <p className="text-xs text-gray-500">Default fee when no specific zone matches</p>
            </div>

            <div className="space-y-2">
              <Label>Free Delivery Threshold (R) - Optional</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={settings.freeDeliveryThreshold || ''}
                onChange={(e) => setSettings(prev => ({ ...prev, freeDeliveryThreshold: e.target.value ? parseFloat(e.target.value) : undefined }))}
                placeholder="500.00"
              />
              <p className="text-xs text-gray-500">Orders above this amount get free delivery</p>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Delivery Zones</Label>
                <Button onClick={addDeliveryZone} size="sm" variant="outline">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Zone
                </Button>
              </div>

              {settings.deliveryZones.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No delivery zones configured. Click "Add Zone" to create one.
                </div>
              ) : (
                <div className="space-y-4">
                  {settings.deliveryZones.map((zone) => (
                    <div key={zone.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={zone.isActive}
                            onCheckedChange={(checked) => updateDeliveryZone(zone.id, { isActive: checked })}
                          />
                          <Badge variant={zone.isActive ? "default" : "secondary"}>
                            {zone.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <Button
                          onClick={() => removeDeliveryZone(zone.id)}
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Zone Name</Label>
                          <Input
                            value={zone.name}
                            onChange={(e) => updateDeliveryZone(zone.id, { name: e.target.value })}
                            placeholder="e.g., City Center"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Delivery Fee (R)</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={zone.fee}
                            onChange={(e) => updateDeliveryZone(zone.id, { fee: parseFloat(e.target.value) || 0 })}
                            placeholder="85.00"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Description (Optional)</Label>
                        <Input
                          value={zone.description || ''}
                          onChange={(e) => updateDeliveryZone(zone.id, { description: e.target.value })}
                          placeholder="e.g., Central business district"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Suburbs (comma-separated)</Label>
                        <Input
                          value={zone.suburbs?.join(', ') || ''}
                          onChange={(e) => updateDeliveryZone(zone.id, { 
                            suburbs: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                          })}
                          placeholder="e.g., Sandton, Rosebank, Morningside"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Area Codes (comma-separated)</Label>
                        <Input
                          value={zone.areaCodes?.join(', ') || ''}
                          onChange={(e) => updateDeliveryZone(zone.id, { 
                            areaCodes: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                          })}
                          placeholder="e.g., 2196, 2191"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Min Order Amount for This Zone (R) - Optional</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={zone.minOrderAmount || ''}
                          onChange={(e) => updateDeliveryZone(zone.id, { 
                            minOrderAmount: e.target.value ? parseFloat(e.target.value) : undefined 
                          })}
                          placeholder="200.00"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Pickup Settings */}
          <TabsContent value="pickup" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable Pickup</Label>
                <p className="text-sm text-gray-500">Allow customers to collect orders in person</p>
              </div>
              <Switch
                checked={settings.enablePickup}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enablePickup: checked }))}
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Pickup Locations</Label>
                <Button onClick={addPickupLocation} size="sm" variant="outline">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Location
                </Button>
              </div>

              {settings.pickupLocations.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No pickup locations configured. Click "Add Location" to create one.
                </div>
              ) : (
                <div className="space-y-4">
                  {settings.pickupLocations.map((location, index) => (
                    <div key={index} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Location {index + 1}</Label>
                        <Button
                          onClick={() => removePickupLocation(index)}
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Location Name</Label>
                          <Input
                            value={location.name}
                            onChange={(e) => updatePickupLocation(index, 'name', e.target.value)}
                            placeholder="e.g., Main Store"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Phone</Label>
                          <Input
                            value={location.phone}
                            onChange={(e) => updatePickupLocation(index, 'phone', e.target.value)}
                            placeholder="e.g., 011 123 4567"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Address</Label>
                        <Input
                          value={location.address}
                          onChange={(e) => updatePickupLocation(index, 'address', e.target.value)}
                          placeholder="e.g., 123 Main Street, Johannesburg"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Operating Hours</Label>
                        <Input
                          value={location.hours}
                          onChange={(e) => updatePickupLocation(index, 'hours', e.target.value)}
                          placeholder="e.g., Mon-Fri: 9am-5pm, Sat: 9am-1pm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Payment Methods */}
          <TabsContent value="payments" className="space-y-3 mt-4">
            <div>
              <Label className="text-base font-semibold">Ecommerce Payment Methods</Label>
              <p className="text-sm text-gray-500 mt-0.5">
                Choose how customers pay for online orders. Enable a method and add its credentials.
                <span className="font-medium text-foreground"> iKhokha</span> and <span className="font-medium text-foreground">Cash on Collection</span> are processed at checkout today; the others save your details now and we activate them for you.
              </p>
            </div>

            <div className="space-y-2.5 max-h-[52vh] overflow-y-auto pr-1">
              {PAYMENT_PROVIDERS.map((provider) => {
                const enabled = isMethodEnabled(provider.key);
                return (
                  <div key={provider.key} className={`rounded-lg border p-3 ${enabled ? "border-emerald-300 bg-emerald-50/40" : "bg-muted/20"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <CreditCard className={`h-4 w-4 shrink-0 ${enabled ? "text-emerald-600" : "text-muted-foreground"}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{provider.name}</span>
                            {provider.status === "live" ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-700 border-emerald-300 bg-emerald-50">Live</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-700 border-amber-300 bg-amber-50">Setup pending</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{provider.blurb}</p>
                        </div>
                      </div>
                      <Switch checked={enabled} onCheckedChange={(v) => setMethodEnabled(provider.key, v)} />
                    </div>

                    {enabled && provider.fields.length > 0 && (
                      <div className="mt-3 pl-6 space-y-2.5">
                        {provider.fields.map((f) => (
                          <div key={f.key} className="space-y-1">
                            <Label className="text-xs">{f.label}</Label>
                            {f.multiline ? (
                              <Textarea
                                rows={4}
                                value={getMethodField(provider.key, f.key)}
                                onChange={(e) => setMethodField(provider.key, f.key, e.target.value)}
                                placeholder={f.placeholder}
                                className="text-sm font-mono"
                              />
                            ) : (
                              <Input
                                type={f.secret ? "password" : "text"}
                                value={getMethodField(provider.key, f.key)}
                                onChange={(e) => setMethodField(provider.key, f.key, e.target.value)}
                                placeholder={f.placeholder}
                                className="text-sm font-mono"
                              />
                            )}
                          </div>
                        ))}
                        {provider.status === "setup" && (
                          <p className="text-[11px] text-amber-700">
                            Saved — we'll wire {provider.name} into your live checkout. Until then, customers won't see it as a checkout option.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* Store Info */}
          <TabsContent value="store" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Store Name</Label>
              <Input
                value={settings.storeName}
                onChange={(e) => setSettings(prev => ({ ...prev, storeName: e.target.value }))}
                placeholder="Your Store Name"
              />
            </div>

            <div className="space-y-2">
              <Label>Tagline <span className="text-muted-foreground text-xs font-normal">— shown under your store name in the header</span></Label>
              <Input
                value={settings.storeTagline ?? ""}
                onChange={(e) => setSettings(prev => ({ ...prev, storeTagline: e.target.value }))}
                placeholder="e.g. Audio Specialists · Cape Town"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Store Email</Label>
                <Input
                  type="email"
                  value={settings.storeEmail}
                  onChange={(e) => setSettings(prev => ({ ...prev, storeEmail: e.target.value }))}
                  placeholder="store@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Store Phone</Label>
                <Input
                  value={settings.storePhone}
                  onChange={(e) => setSettings(prev => ({ ...prev, storePhone: e.target.value }))}
                  placeholder="011 123 4567"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Store Address</Label>
              <Input
                value={settings.storeAddress}
                onChange={(e) => setSettings(prev => ({ ...prev, storeAddress: e.target.value }))}
                placeholder="363 Main Road, Wynberg, Cape Town"
              />
            </div>

            <div className="space-y-2">
              <Label>WhatsApp Number (with country code)</Label>
              <Input
                value={(settings as any).storeWhatsApp || ''}
                onChange={(e) => setSettings(prev => ({ ...prev, storeWhatsApp: e.target.value } as any))}
                placeholder="27615010457"
              />
              <p className="text-xs text-gray-400">Used for the "Order via WhatsApp" link. Format: 27xxxxxxxxx (no + or spaces)</p>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-semibold">Product Card Display Options</Label>
              </div>
              <p className="text-xs text-gray-500">Control what information is shown on product cards in your public store.</p>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="font-normal">Show Brand / Supplier</Label>
                  <p className="text-xs text-gray-500">Displays the supplier name on product cards</p>
                </div>
                <Switch
                  checked={(settings as any).showBrand ?? false}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, showBrand: checked } as any))}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="font-normal">Show Qty Available</Label>
                  <p className="text-xs text-gray-500">Show stock quantity on product cards</p>
                </div>
                <Switch
                  checked={(settings as any).showQuantity ?? true}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, showQuantity: checked } as any))}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="font-normal">Show SKU / Part Number</Label>
                  <p className="text-xs text-gray-500">Show part numbers on product cards</p>
                </div>
                <Switch
                  checked={(settings as any).showSku ?? true}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, showSku: checked } as any))}
                />
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="text-sm font-semibold">Similar Parts Finder</Label>
                <p className="text-xs text-gray-500">
                  Adds a "Find Similar Parts" button on product detail pages. Useful for electronics stores where customers need substitute components — disable for clothing or general retail.
                </p>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="font-normal">Enable Similar Parts Finder</Label>
                    <p className="text-xs text-gray-500">Show a button to find substitutes or compatible parts</p>
                  </div>
                  <Switch
                    checked={(settings as any).enableSimilarParts ?? false}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enableSimilarParts: checked } as any))}
                  />
                </div>
                {(settings as any).enableSimilarParts && (
                  <div className="space-y-2 pt-1">
                    <div className="flex justify-between items-center">
                      <Label className="font-normal text-sm">Similarity Threshold</Label>
                      <span className="text-sm font-semibold text-orange-600">{(settings as any).similarPartsThreshold ?? 30}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={(settings as any).similarPartsThreshold ?? 30}
                      onChange={(e) => setSettings(prev => ({ ...prev, similarPartsThreshold: Number(e.target.value) } as any))}
                      className="w-full accent-orange-500"
                    />
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>0% (all same-category)</span>
                      <span>100% (exact spec match)</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ── SERVICES SECTION TAB ── */}
          <TabsContent value="services" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-semibold">Services Section</Label>
                <p className="text-sm text-gray-500">Show a services / about section below your products on the store.</p>
              </div>
              <Switch
                checked={settings.servicesEnabled ?? false}
                onCheckedChange={(v) => setSettings(prev => ({ ...prev, servicesEnabled: v }))}
              />
            </div>

            {(settings.servicesEnabled) && (
              <div className="space-y-4 pt-2">
                <Separator />
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Badge label</Label>
                    <Input
                      placeholder="e.g. Repair Services"
                      value={settings.servicesBadge ?? ""}
                      onChange={e => setSettings(prev => ({ ...prev, servicesBadge: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Section heading</Label>
                    <Input
                      placeholder="e.g. Audio Repair Experts"
                      value={settings.servicesTitle ?? ""}
                      onChange={e => setSettings(prev => ({ ...prev, servicesTitle: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Subtitle / description</Label>
                  <Textarea
                    rows={2}
                    placeholder="One short paragraph describing your services..."
                    value={settings.servicesSubtitle ?? ""}
                    onChange={e => setSettings(prev => ({ ...prev, servicesSubtitle: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>CTA button text</Label>
                    <Input
                      placeholder="e.g. Book an Assessment"
                      value={settings.servicesCtaText ?? ""}
                      onChange={e => setSettings(prev => ({ ...prev, servicesCtaText: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>CTA phone number</Label>
                    <Input
                      placeholder="e.g. 074 651 1031"
                      value={settings.servicesCtaPhone ?? ""}
                      onChange={e => setSettings(prev => ({ ...prev, servicesCtaPhone: e.target.value }))}
                    />
                  </div>
                </div>

                <Separator />
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Service cards (up to 4)</Label>
                  {(settings.services ?? []).length < 4 && (
                    <Button
                      size="sm" variant="outline"
                      onClick={() => setSettings(prev => ({
                        ...prev,
                        services: [...(prev.services ?? []), { title: "", description: "", bullets: [""] }],
                      }))}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add card
                    </Button>
                  )}
                </div>

                {(settings.services ?? []).map((svc, i) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500">Card {i + 1}</span>
                      <Button
                        size="sm" variant="ghost" className="h-6 px-2 text-red-500 hover:text-red-700"
                        onClick={() => setSettings(prev => ({
                          ...prev,
                          services: (prev.services ?? []).filter((_, idx) => idx !== i),
                        }))}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <Input
                      placeholder="Card title"
                      value={svc.title}
                      onChange={e => setSettings(prev => ({
                        ...prev,
                        services: (prev.services ?? []).map((s, idx) => idx === i ? { ...s, title: e.target.value } : s),
                      }))}
                    />
                    <Textarea
                      rows={2}
                      placeholder="Short description..."
                      value={svc.description}
                      onChange={e => setSettings(prev => ({
                        ...prev,
                        services: (prev.services ?? []).map((s, idx) => idx === i ? { ...s, description: e.target.value } : s),
                      }))}
                    />
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-500">Bullet points (one per line)</Label>
                      <Textarea
                        rows={3}
                        placeholder={"Re-coning & recapping\nVoice coil replacement\nCabinet restoration"}
                        value={svc.bullets.join("\n")}
                        onChange={e => setSettings(prev => ({
                          ...prev,
                          services: (prev.services ?? []).map((s, idx) => idx === i ? { ...s, bullets: e.target.value.split("\n") } : s),
                        }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Public-facing policies (Shipping, Returns, Hours) */}
          <TabsContent value="policies" className="space-y-4 mt-4">
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              These appear on your live storefront at <code>/shipping-policy</code> and <code>/returns-policy</code>.
              Google Merchant Center and shoppers use them to assess trust. Keep them clear and accurate.
            </div>

            <div className="space-y-2">
              <Label htmlFor="businessHours">Business Hours (one-line)</Label>
              <Input
                id="businessHours"
                placeholder="Mon–Sat 8am–5pm, closed Sun"
                value={settings.businessHours || ''}
                onChange={(e) => setSettings(prev => ({ ...prev, businessHours: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="shippingPolicy">Shipping Policy</Label>
              <Textarea
                id="shippingPolicy"
                rows={10}
                placeholder="Describe pickup, local delivery, courier options, fees, timing, and what to do if a parcel is damaged."
                value={settings.shippingPolicy || ''}
                onChange={(e) => setSettings(prev => ({ ...prev, shippingPolicy: e.target.value }))}
                className="font-mono text-sm"
              />
              <p className="text-xs text-gray-500">
                Plain text. Blank lines start a new paragraph.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="returnsPolicy">Returns Policy</Label>
              <Textarea
                id="returnsPolicy"
                rows={12}
                placeholder="Describe the return window, what qualifies, how to start a return, refund timing, and statutory rights."
                value={settings.returnsPolicy || ''}
                onChange={(e) => setSettings(prev => ({ ...prev, returnsPolicy: e.target.value }))}
                className="font-mono text-sm"
              />
              <p className="text-xs text-gray-500">
                Plain text. Blank lines start a new paragraph.
              </p>
            </div>
          </TabsContent>

          {/* Other Settings */}
          <TabsContent value="other" className="space-y-4 mt-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Tax Rate (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={settings.taxRate}
                  onChange={(e) => setSettings(prev => ({ ...prev, taxRate: parseFloat(e.target.value) || 0 }))}
                  placeholder="15"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Tax Included in Prices</Label>
                  <p className="text-sm text-gray-500">Prices shown include tax</p>
                </div>
                <Switch
                  checked={settings.taxIncluded}
                  onCheckedChange={(checked) => setSettings(prev => ({ ...prev, taxIncluded: checked }))}
                />
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Min Order Amount (R) - Optional</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={settings.minOrderAmount || ''}
                    onChange={(e) => setSettings(prev => ({ ...prev, minOrderAmount: e.target.value ? parseFloat(e.target.value) : undefined }))}
                    placeholder="50.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max Order Amount (R) - Optional</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={settings.maxOrderAmount || ''}
                    onChange={(e) => setSettings(prev => ({ ...prev, maxOrderAmount: e.target.value ? parseFloat(e.target.value) : undefined }))}
                    placeholder="10000.00"
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label>Payment Methods</Label>
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="font-normal">Enable Card Payments (iKhokha)</Label>
                    <p className="text-xs text-gray-500">Online payment via iKhokha</p>
                  </div>
                  <Switch
                    checked={settings.enableCardPayments}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enableCardPayments: checked }))}
                  />
                </div>

                {settings.enableCardPayments && (
                  <div className="space-y-3 rounded-lg border border-border p-3 bg-muted/30">
                    <Label className="text-xs font-medium text-muted-foreground">iKhokha API Credentials</Label>
                    <div className="space-y-1.5">
                      <Label className="text-xs">App ID (IK-APPID) — starts with "IK"</Label>
                      <Input
                        value={settings.ikhokhaAppId || ''}
                        onChange={(e) => setSettings(prev => ({ ...prev, ikhokhaAppId: e.target.value }))}
                        placeholder="IK91VB0T… (Application Key ID)"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">App Secret — shorter alphanumeric (not starting with IK)</Label>
                      <Input
                        type="password"
                        value={settings.ikhokhaAppSecret || ''}
                        onChange={(e) => setSettings(prev => ({ ...prev, ikhokhaAppSecret: e.target.value }))}
                        placeholder="Application Key Secret"
                        className="font-mono text-sm"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Found in iKhokha Merchant Dashboard → Payments → Integrations → Payment API</p>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="font-normal">Enable Cash on Delivery</Label>
                    <p className="text-xs text-gray-500">Pay with cash when receiving order</p>
                  </div>
                  <Switch
                    checked={settings.enableCashOnDelivery}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, enableCashOnDelivery: checked }))}
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label>Notifications</Label>
                
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="font-normal">Send Order Confirmation Email</Label>
                    <p className="text-xs text-gray-500">Automatically email customers when order is placed</p>
                  </div>
                  <Switch
                    checked={settings.sendOrderConfirmationEmail}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, sendOrderConfirmationEmail: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="font-normal">Send Order Status Updates</Label>
                    <p className="text-xs text-gray-500">Email customers when order status changes</p>
                  </div>
                  <Switch
                    checked={settings.sendOrderStatusUpdates}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, sendOrderStatusUpdates: checked }))}
                  />
                </div>
              </div>
            </div>
          </TabsContent>
          {/* ── COURIER TAB ── */}
          <TabsContent value="courier" className="space-y-4 mt-4">
            <div>
              <Label className="text-base font-semibold">ShipLogic / Fastway Couriers</Label>
              <p className="text-sm text-gray-500 mt-0.5">
                Enter your ShipLogic API key from{" "}
                <a
                  href="https://portal.fastway.co.za/integrations"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-blue-600 hover:text-blue-800"
                >
                  portal.fastway.co.za/integrations
                </a>{" "}
                to enable live delivery quotes at checkout.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable courier delivery quotes</Label>
                <p className="text-sm text-gray-500">Show live ShipLogic rates at checkout</p>
              </div>
              <Switch
                checked={settings.shiplogicEnabled ?? false}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, shiplogicEnabled: checked }))}
              />
            </div>

            <div className="space-y-2">
              <Label>ShipLogic API Key</Label>
              <Input
                type="password"
                value={settings.shiplogicApiKey ?? ''}
                onChange={(e) => setSettings(prev => ({ ...prev, shiplogicApiKey: e.target.value }))}
                placeholder="ea6...ea7"
                className="font-mono text-sm"
              />
              <p className="text-xs text-gray-500">
                Get your API key at{" "}
                <a
                  href="https://portal.fastway.co.za/integrations"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-blue-600 hover:text-blue-800"
                >
                  portal.fastway.co.za/integrations
                </a>
              </p>
            </div>

            <Separator />

            <div>
              <Label className="text-sm font-semibold">Collection / Sender Address</Label>
              <p className="text-sm text-gray-500 mt-0.5">Your business address — where parcels are collected from.</p>
            </div>

            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input
                value={settings.shiplogicSenderCompany ?? ''}
                onChange={(e) => setSettings(prev => ({ ...prev, shiplogicSenderCompany: e.target.value }))}
                placeholder={settings.storeName || 'Your business name'}
              />
            </div>

            <div className="space-y-2">
              <Label>Street Address</Label>
              <Input
                value={settings.shiplogicSenderStreet ?? ''}
                onChange={(e) => setSettings(prev => ({ ...prev, shiplogicSenderStreet: e.target.value }))}
                placeholder="e.g. 12 Industrial Road"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Suburb</Label>
                <Input
                  value={settings.shiplogicSenderSuburb ?? ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, shiplogicSenderSuburb: e.target.value }))}
                  placeholder="e.g. Wynberg"
                />
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <Input
                  value={settings.shiplogicSenderCity ?? ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, shiplogicSenderCity: e.target.value }))}
                  placeholder="e.g. Cape Town"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Postal Code</Label>
              <Input
                value={settings.shiplogicSenderPostalCode ?? ''}
                onChange={(e) => setSettings(prev => ({ ...prev, shiplogicSenderPostalCode: e.target.value }))}
                placeholder="e.g. 7800"
              />
            </div>

            <div className="border-t pt-4 space-y-2">
              <Label className="text-base font-semibold">Delivery Markup</Label>
              <p className="text-sm text-muted-foreground">
                Add a percentage on top of Fastway's rate before showing it to customers.
                e.g. Fastway quotes R100 + 20% markup = customer pays R120.
              </p>
              <div className="flex items-center gap-3 max-w-xs">
                <Input
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  value={settings.shiplogicMarkupPercent ?? 0}
                  onChange={(e) => setSettings(prev => ({ ...prev, shiplogicMarkupPercent: Math.max(0, Number(e.target.value)) }))}
                  className="w-28"
                  placeholder="0"
                />
                <span className="text-sm text-muted-foreground">% markup</span>
                {(settings.shiplogicMarkupPercent ?? 0) > 0 && (
                  <span className="text-xs text-emerald-600 font-medium">
                    e.g. R100 → R{(100 * (1 + (settings.shiplogicMarkupPercent ?? 0) / 100)).toFixed(0)}
                  </span>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ── STORE URL TAB ── */}
          <TabsContent value="storeurl" className="space-y-6 mt-4">

            {/* Slug-based URL */}
            <div className="space-y-3">
              <div>
                <Label className="text-base font-semibold">Your Store URL</Label>
                <p className="text-sm text-muted-foreground mt-0.5">Share this link with customers to access your online store.</p>
              </div>

              {workspace?.storeSlug ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border">
                  <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-mono flex-1 truncate">
                    {STORE_BASE_URL}/{workspace.storeSlug}
                  </span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleCopyStoreUrl}>
                    {slugCopied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                  <a href={`${STORE_BASE_URL}/${workspace.storeSlug}`} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                </div>
              ) : (
                <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  Set a store slug below to activate your public store URL.
                </p>
              )}

              <div className="space-y-1.5">
                <Label>Store Slug</Label>
                <p className="text-xs text-muted-foreground">Lowercase letters, numbers and hyphens only (e.g. <span className="font-mono">my-shop</span>)</p>
                <div className="flex gap-2">
                  <div className="flex items-center flex-1 rounded-md border overflow-hidden">
                    <span className="px-3 text-xs text-muted-foreground bg-muted border-r whitespace-nowrap">shopflowz.web.app/store/</span>
                    <Input
                      value={slugInput}
                      onChange={(e) => setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                      placeholder="your-store"
                      className="border-0 rounded-none focus-visible:ring-0 font-mono text-sm"
                    />
                  </div>
                  <Button onClick={handleSaveSlug} disabled={savingSlug || !slugInput.trim()} size="sm" className="shrink-0">
                    {savingSlug ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    <span className="ml-1.5">Save</span>
                  </Button>
                </div>
              </div>
            </div>

            <Separator />

            {/* Custom Domain section — only shown if enabled by ShopFlowz admin */}
            <div className="space-y-3">
                <div>
                  <Label className="text-base font-semibold">Link Your Own Domain</Label>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Point your domain straight to your store. You can use either:
                  </p>
                  <ul className="text-sm text-muted-foreground mt-1.5 space-y-1">
                    <li>• A <span className="font-medium text-foreground">subdomain</span> like <span className="font-mono">shop.yourbusiness.co.za</span> — your existing website stays untouched <span className="text-xs">(recommended)</span></li>
                    <li>• Your <span className="font-medium text-foreground">root domain</span> like <span className="font-mono">yourbusiness.co.za</span> — only do this if you don't already have a website on it</li>
                  </ul>
                </div>

                {/* Current domain status */}
                {workspace?.customDomain && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border">
                      <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm font-mono flex-1">{workspace.customDomain}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        workspace.customDomainStatus === 'active'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {workspace.customDomainStatus === 'active' ? '● Active' : '● Pending DNS'}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTestDns}
                        disabled={testingDns}
                        className="shrink-0 h-7 text-xs"
                      >
                        {testingDns ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                        {testingDns ? 'Checking…' : 'Test DNS'}
                      </Button>
                    </div>
                    {dnsTestResult && (
                      <div className={`flex items-start gap-2 p-2.5 rounded-lg text-xs border ${
                        dnsTestResult.status === 'connected'
                          ? 'bg-green-50 border-green-200 text-green-800'
                          : dnsTestResult.status === 'error'
                          ? 'bg-red-50 border-red-200 text-red-800'
                          : 'bg-amber-50 border-amber-200 text-amber-800'
                      }`}>
                        <span className="mt-0.5 shrink-0">
                          {dnsTestResult.status === 'connected' ? '✓' : dnsTestResult.status === 'error' ? '✗' : '⏳'}
                        </span>
                        <span>{dnsTestResult.message}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Your domain or subdomain</Label>
                  <div className="flex gap-2">
                    <Input
                      value={domainInput}
                      onChange={(e) => setDomainInput(e.target.value.toLowerCase())}
                      placeholder="shop.yourbusiness.co.za  or  yourbusiness.co.za"
                      className="font-mono text-sm"
                    />
                    <Button onClick={handleLinkDomain} disabled={linkingDomain || !domainInput.trim()} size="sm" className="shrink-0">
                      {linkingDomain ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
                      <span className="ml-1.5">Link Domain</span>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    We'll show you exactly which DNS records to add — a CNAME for a subdomain, or A records for a root domain.
                  </p>
                </div>

                {/* DNS records shown after linking */}
                {dnsRecords && dnsRecords.length > 0 && (
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                    <p className="text-sm font-medium">Add these DNS records at your domain registrar:</p>
                    <div className="space-y-2">
                      {dnsRecords.map((r, i) => {
                        const displayName = r.name === '@'
                          ? (domainInput || workspace?.customDomain || '@')
                          : r.name;
                        return (
                          <div key={i} className="grid grid-cols-3 gap-2 text-xs font-mono bg-background rounded p-2 border">
                            <span className="text-muted-foreground font-sans font-medium">Type: <span className="text-foreground">{r.type}</span></span>
                            <span className="text-muted-foreground font-sans font-medium">Name: <span className="text-foreground">{displayName}</span></span>
                            <span className="text-muted-foreground font-sans font-medium truncate">Value: <span className="text-foreground">{r.value}</span></span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      DNS changes take up to 48 hours to propagate. Your store will go live automatically once verified — no further action needed.
                    </p>
                  </div>
                )}
            </div>
          </TabsContent>

          {/* ── WhatsApp Notifications ── */}
          <TabsContent value="notifications" className="space-y-4 mt-4">
            <div className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <MessageCircle className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
              <div className="text-sm text-green-800">
                <p className="font-semibold">WhatsApp Notification Templates</p>
                <p className="mt-0.5 text-green-700">Configure a message template for each event. Use <code className="bg-green-100 px-1 rounded text-xs">{"{variable}"}</code> placeholders — they are filled in automatically. Customer notifications open WhatsApp at checkout. Store notifications open when triggered from the admin.</p>
              </div>
            </div>

            {(Object.keys(NOTIFICATION_EVENTS) as NotificationEventKey[]).map((key) => {
              const meta = NOTIFICATION_EVENTS[key];
              const tpl = settings.whatsappNotifications?.[key] ?? getDefaultTemplate(key);
              const update = (field: string, value: unknown) =>
                setSettings(prev => ({
                  ...prev,
                  whatsappNotifications: {
                    ...prev.whatsappNotifications,
                    [key]: { ...(prev.whatsappNotifications?.[key] ?? getDefaultTemplate(key)), [field]: value },
                  },
                }));

              return (
                <div key={key} className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* Header row */}
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{meta.label}</p>
                      <p className="text-xs text-gray-500">{meta.description}</p>
                    </div>
                    <Switch
                      checked={tpl.enabled}
                      onCheckedChange={v => update('enabled', v)}
                    />
                  </div>

                  {/* Body — only shown when enabled */}
                  {tpl.enabled && (
                    <div className="px-4 py-4 space-y-3">
                      {/* Recipient */}
                      <div>
                        <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Send To</Label>
                        <div className="flex gap-2 mt-1.5">
                          {(['store', 'customer', 'both'] as const).map(r => (
                            <button
                              key={r}
                              type="button"
                              onClick={() => update('recipientType', r)}
                              className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors capitalize ${
                                tpl.recipientType === r
                                  ? 'bg-green-600 text-white border-green-600'
                                  : 'bg-white text-gray-600 border-gray-200 hover:border-green-400'
                              }`}
                            >
                              {r === 'store' ? '🏪 Store' : r === 'customer' ? '👤 Customer' : '👥 Both'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Store override number */}
                      {(tpl.recipientType === 'store' || tpl.recipientType === 'both') && (
                        <div>
                          <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                            Store WhatsApp Number
                          </Label>
                          <Input
                            className="mt-1 text-sm"
                            placeholder={`Default: ${(settings as any).storeWhatsApp || '27xxxxxxxxx'}`}
                            value={tpl.storeNumber ?? ''}
                            onChange={e => update('storeNumber', e.target.value)}
                          />
                          <p className="text-xs text-gray-400 mt-0.5">Leave blank to use the store WhatsApp number above. Format: 27xxxxxxxxx</p>
                        </div>
                      )}

                      {/* Template message */}
                      <div>
                        <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Message Template</Label>
                        <Textarea
                          className="mt-1 text-sm font-mono min-h-[140px]"
                          value={tpl.message}
                          onChange={e => update('message', e.target.value)}
                          placeholder={meta.defaultMessage}
                        />
                        <button
                          type="button"
                          className="mt-1 text-xs text-blue-600 hover:underline"
                          onClick={() => update('message', meta.defaultMessage)}
                        >
                          Reset to default
                        </button>
                      </div>

                      {/* Variable reference */}
                      <div>
                        <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Available Variables</Label>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {meta.variables.map(v => (
                            <button
                              key={v}
                              type="button"
                              title="Click to copy"
                              onClick={() => navigator.clipboard?.writeText(`{${v}}`)}
                              className="px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-xs font-mono text-gray-700 transition-colors border border-gray-200"
                            >
                              {`{${v}}`}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-gray-400 mt-1">Click a variable to copy it, then paste into the template above.</p>
                      </div>

                      {/* Preview link */}
                      {((tpl.recipientType === 'store' || tpl.recipientType === 'both') && (tpl.storeNumber || (settings as any).storeWhatsApp)) && (
                        <div>
                          <a
                            href={`https://wa.me/${(tpl.storeNumber || (settings as any).storeWhatsApp || '').replace(/\D/g, '')}?text=${encodeURIComponent(tpl.message)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-green-700 hover:underline"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            Preview in WhatsApp
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-[#cc1818] hover:bg-[#cc1818]/90">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
