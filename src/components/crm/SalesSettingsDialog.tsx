import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Loader2, Save, Building2, CreditCard, FileText, Palette, Wrench } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { loadSalesSettings, saveSalesSettings, SalesSettings, DEFAULT_SALES_SETTINGS } from "@/lib/salesSettingsService";
import { loadJobSettings, saveJobSettings, JobSettings, DEFAULT_JOB_SETTINGS } from "@/lib/jobSettingsService";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SalesSettingsDialog({ open, onClose }: Props) {
  const { workspaceId, user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SalesSettings>(DEFAULT_SALES_SETTINGS);
  const [jobSettings, setJobSettings] = useState<JobSettings>(DEFAULT_JOB_SETTINGS);

  useEffect(() => {
    if (open && workspaceId) {
      setLoading(true);
      Promise.all([
        loadSalesSettings(workspaceId),
        loadJobSettings(workspaceId),
      ])
        .then(([sales, jobs]) => { setSettings(sales); setJobSettings(jobs); })
        .catch(() => toast({ title: "Error", description: "Failed to load settings", variant: "destructive" }))
        .finally(() => setLoading(false));
    }
  }, [open, workspaceId]);

  function set(key: keyof SalesSettings, value: string | number) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!workspaceId || !user) return;
    setSaving(true);
    try {
      await Promise.all([
        saveSalesSettings(workspaceId, settings, user.uid),
        saveJobSettings(workspaceId, jobSettings),
      ]);
      toast({ title: "Saved", description: "Settings saved successfully" });
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Sales Settings
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="company">
            <TabsList className="grid grid-cols-5 w-full">
              <TabsTrigger value="company" className="text-xs">
                <Building2 className="h-3.5 w-3.5 mr-1" />
                Company
              </TabsTrigger>
              <TabsTrigger value="banking" className="text-xs">
                <CreditCard className="h-3.5 w-3.5 mr-1" />
                Banking
              </TabsTrigger>
              <TabsTrigger value="defaults" className="text-xs">
                <FileText className="h-3.5 w-3.5 mr-1" />
                Defaults
              </TabsTrigger>
              <TabsTrigger value="template" className="text-xs">
                <Palette className="h-3.5 w-3.5 mr-1" />
                Template
              </TabsTrigger>
              <TabsTrigger value="jobs" className="text-xs">
                <Wrench className="h-3.5 w-3.5 mr-1" />
                Jobs
              </TabsTrigger>
            </TabsList>

            {/* COMPANY TAB */}
            <TabsContent value="company" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                This information appears on all invoices and quotations.
              </p>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Company Name</Label>
                  <Input
                    value={settings.companyName}
                    onChange={e => set("companyName", e.target.value)}
                    placeholder="Speaker Repairs Sa (Pty) Ltd"
                  />
                </div>
                <div className="col-span-2">
                  <Label>Street Address</Label>
                  <Input
                    value={settings.companyAddress}
                    onChange={e => set("companyAddress", e.target.value)}
                    placeholder="363 Main Road Wynberg"
                  />
                </div>
                <div>
                  <Label>City</Label>
                  <Input
                    value={settings.companyCity}
                    onChange={e => set("companyCity", e.target.value)}
                    placeholder="Cape Town"
                  />
                </div>
                <div>
                  <Label>Province</Label>
                  <Input
                    value={settings.companyProvince}
                    onChange={e => set("companyProvince", e.target.value)}
                    placeholder="Western Cape"
                  />
                </div>
                <div>
                  <Label>Postal Code</Label>
                  <Input
                    value={settings.companyPostalCode}
                    onChange={e => set("companyPostalCode", e.target.value)}
                    placeholder="7800"
                  />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input
                    value={settings.companyPhone}
                    onChange={e => set("companyPhone", e.target.value)}
                    placeholder="+27 615010457"
                  />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={settings.companyEmail}
                    onChange={e => set("companyEmail", e.target.value)}
                    placeholder="info@yourbusiness.co.za"
                  />
                </div>
                <div>
                  <Label>Website</Label>
                  <Input
                    value={settings.companyWebsite}
                    onChange={e => set("companyWebsite", e.target.value)}
                    placeholder="www.yourbusiness.co.za"
                  />
                </div>
                <div>
                  <Label>VAT Registration No.</Label>
                  <Input
                    value={settings.vatRegistrationNumber}
                    onChange={e => set("vatRegistrationNumber", e.target.value)}
                    placeholder="4650307350"
                  />
                </div>
                <div>
                  <Label>Business Registration No.</Label>
                  <Input
                    value={settings.businessRegistrationNumber}
                    onChange={e => set("businessRegistrationNumber", e.target.value)}
                    placeholder="2018/609361/07"
                  />
                </div>
              </div>
            </TabsContent>

            {/* BANKING TAB */}
            <TabsContent value="banking" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Banking details appear at the bottom of invoices.
              </p>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Account Name</Label>
                  <Input
                    value={settings.bankAccountName}
                    onChange={e => set("bankAccountName", e.target.value)}
                    placeholder="Speaker Repairs Sa Pty Ltd"
                  />
                </div>
                <div>
                  <Label>Bank Name</Label>
                  <Input
                    value={settings.bankName}
                    onChange={e => set("bankName", e.target.value)}
                    placeholder="CAPITEC BUSINESS"
                  />
                </div>
                <div>
                  <Label>Account Type</Label>
                  <Input
                    value={settings.bankAccountType}
                    onChange={e => set("bankAccountType", e.target.value)}
                    placeholder="Current"
                  />
                </div>
                <div>
                  <Label>Account Number</Label>
                  <Input
                    value={settings.bankAccountNumber}
                    onChange={e => set("bankAccountNumber", e.target.value)}
                    placeholder="1051860563"
                  />
                </div>
                <div>
                  <Label>Branch Code</Label>
                  <Input
                    value={settings.bankBranchCode}
                    onChange={e => set("bankBranchCode", e.target.value)}
                    placeholder="450105"
                  />
                </div>
              </div>
            </TabsContent>

            {/* DEFAULTS TAB */}
            <TabsContent value="defaults" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Default values pre-filled on new invoices and quotations.
              </p>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Default VAT Rate (%)</Label>
                  <Input
                    type="number"
                    value={settings.defaultVatRate}
                    onChange={e => set("defaultVatRate", parseFloat(e.target.value) || 15)}
                    placeholder="15"
                  />
                </div>
                <div className="flex items-end pb-1 gap-3">
                  <Checkbox
                    id="defaultVatEnabled"
                    checked={settings.defaultVatEnabled === true}
                    onCheckedChange={v => set("defaultVatEnabled", v === true)}
                  />
                  <Label htmlFor="defaultVatEnabled" className="cursor-pointer">
                    VAT enabled by default on new invoices
                  </Label>
                </div>
                <div>
                  <Label>Default Payment Terms</Label>
                  <Input
                    value={settings.defaultPaymentTerms}
                    onChange={e => set("defaultPaymentTerms", e.target.value)}
                    placeholder="due-on-receipt"
                  />
                </div>
                <div>
                  <Label>Invoice Number Prefix</Label>
                  <Input
                    value={settings.invoicePrefix}
                    onChange={e => set("invoicePrefix", e.target.value)}
                    placeholder="INV"
                  />
                </div>
                <div>
                  <Label>Quotation Number Prefix</Label>
                  <Input
                    value={settings.quotationPrefix}
                    onChange={e => set("quotationPrefix", e.target.value)}
                    placeholder="QUO"
                  />
                </div>
                <div className="col-span-2">
                  <Label>Default Invoice Notes</Label>
                  <Textarea
                    value={settings.defaultInvoiceNotes}
                    onChange={e => set("defaultInvoiceNotes", e.target.value)}
                    placeholder="Thanks for your business."
                    rows={3}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Default Quotation Notes</Label>
                  <Textarea
                    value={settings.defaultQuoteNotes}
                    onChange={e => set("defaultQuoteNotes", e.target.value)}
                    placeholder="Thanks for your business."
                    rows={3}
                  />
                </div>
              </div>
            </TabsContent>

            {/* TEMPLATE TAB */}
            <TabsContent value="template" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Customize the look of your invoices and quotations.
              </p>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Primary Colour</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="color"
                      value={settings.primaryColor}
                      onChange={e => set("primaryColor", e.target.value)}
                      className="h-10 w-16 cursor-pointer rounded border"
                    />
                    <Input
                      value={settings.primaryColor}
                      onChange={e => set("primaryColor", e.target.value)}
                      placeholder="#2563eb"
                      className="flex-1"
                    />
                  </div>
                </div>
                <div>
                  <Label>Logo URL</Label>
                  <Input
                    value={settings.logoUrl}
                    onChange={e => set("logoUrl", e.target.value)}
                    placeholder="https://..."
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Paste a direct image URL for your company logo
                  </p>
                </div>
                {settings.logoUrl && (
                  <div className="col-span-2">
                    <Label>Logo Preview</Label>
                    <div className="mt-1 border rounded p-4 bg-gray-50">
                      <img
                        src={settings.logoUrl}
                        alt="Logo preview"
                        className="max-h-20 object-contain"
                        onError={e => (e.currentTarget.style.display = "none")}
                      />
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* JOBS TAB */}
            <TabsContent value="jobs" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Controls and rules that apply when staff open and edit job cards.
              </p>
              <Separator />
              <div className="flex items-start gap-3 p-4 border rounded-lg bg-muted/20">
                <Checkbox
                  id="requirePhoto"
                  checked={jobSettings.requirePhotoBeforeEdit}
                  onCheckedChange={v =>
                    setJobSettings(prev => ({ ...prev, requirePhotoBeforeEdit: v === true }))
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
            </TabsContent>
          </Tabs>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
            ) : (
              <><Save className="h-4 w-4 mr-2" />Save Settings</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
