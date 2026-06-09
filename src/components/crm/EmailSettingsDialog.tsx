import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Mail, Send, Loader2, CheckCircle2, AlertCircle, ExternalLink, Info,
} from "lucide-react";
import { SUPABASE_URL,  supabase, supabaseServiceRole } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface EmailSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export interface EmailSettings {
  provider: "gmail" | "smtp" | "emailjs";
  // EmailJS (old working setup - sends from browser)
  publicKey?: string;
  serviceId?: string;
  templateId?: string;
  // SMTP / Gmail
  fromEmail: string;
  fromName: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;  // true for SSL (465), false for STARTTLS (587) or plain (25)
  smtpUser?: string;
  smtpPassword?: string;
  enabled: boolean;
}

const defaultSettings: EmailSettings = {
  provider: "smtp",
  publicKey: "",
  serviceId: "",
  templateId: "",
  fromEmail: "",
  fromName: "",
  smtpHost: "",
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: "",
  smtpPassword: "",
  enabled: false,
};

export function EmailSettingsDialog({ open, onClose }: EmailSettingsDialogProps) {
  const { workspaceId } = useAuth();
  const [settings, setSettings] = useState<EmailSettings>(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">("idle");
  const [testError, setTestError] = useState("");

  useEffect(() => {
    if (open && workspaceId) loadSettings();
  }, [open, workspaceId]);

  async function loadSettings() {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const { data: row } = await supabase.from('workspace_settings').select('data').eq('workspace_id', workspaceId).eq('category', 'email').single();
      if (row?.data) {
        setSettings({ ...defaultSettings, ...(row.data as any) } as EmailSettings);
      } else {
        setSettings(defaultSettings);
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
      toast.error("Failed to load email settings");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    if (!workspaceId) return;
    // Validate
    if (settings.provider === "emailjs" && (!settings.publicKey || !settings.serviceId || !settings.templateId)) {
      toast.error("Enter your EmailJS Public Key, Service ID, and Template ID"); return;
    }
    if ((settings.provider === "gmail" || settings.provider === "smtp") && (!settings.smtpUser || !settings.smtpPassword)) {
      toast.error("Enter your email username and password"); return;
    }
    setSaving(true);
    try {
      const payload: EmailSettings = { ...settings, enabled: true };
      await supabaseServiceRole.from('workspace_settings').upsert({ workspace_id: workspaceId, category: 'email', data: payload }, { onConflict: 'workspace_id,category' });
      toast.success("Email settings saved!");
    } catch (err) {
      console.error("Failed to save:", err);
      toast.error("Failed to save email settings");
    } finally {
      setSaving(false);
    }
  }

  async function sendTestEmail() {
    if (!testEmail) { toast.error("Enter a test email address"); return; }
    setSendingTest(true);
    setTestStatus("idle");
    setTestError("");
    try {
      if (settings.provider === "emailjs") {
        // ── EmailJS: send directly from browser (your old working setup) ───
        const emailjs = await import("@emailjs/browser").then(m => m.default);
        await emailjs.send(
          settings.serviceId!,
          settings.templateId!,
          {
            to_email: testEmail,
            to_name: testEmail,
            from_name: settings.fromName || "ShopFlowz",
            reply_to: settings.fromEmail || settings.smtpUser || "",
            subject: `Test Email from ${settings.fromName || "ShopFlowz"}`,
            message: "Your EmailJS configuration is working! This is the same setup that worked before.",
          },
          settings.publicKey!
        );
      } else {
        // ── Gmail / SMTP: call HTTP endpoint directly ── same as form-builder-2025 ──
        const host = settings.provider === "gmail" ? "smtp.gmail.com" : (settings.smtpHost ?? "");
        const port = settings.provider === "gmail" ? 587 : (settings.smtpPort ?? 465);
        const secure = settings.provider === "gmail" ? false : (settings.smtpSecure ?? (port === 465));
        
        const SMTP_URL = `${SUPABASE_URL}/functions/v1/send-email`;
        const resp = await fetch(SMTP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            smtpConfig: {
              host,
              port,
              secure,
              user: settings.smtpUser,
              pass: settings.smtpPassword,
              fromName: settings.fromName,
              fromEmail: settings.fromEmail || settings.smtpUser,
            },
            email: {
              from: `${settings.fromName || "ShopFlowz"} <${settings.fromEmail || settings.smtpUser}>`,
              to: testEmail,
              subject: `Test Email from ${settings.fromName || "ShopFlowz"}`,
              text: `Test from port ${port}, secure=${secure}. If you receive this, your SMTP configuration works!`,
              html: `<h2>✅ Email Test Successful</h2><p>Port: <strong>${port}</strong><br>Security: <strong>${secure ? "SSL" : "STARTTLS"}</strong><br>Your SMTP configuration is working correctly!</p>`,
            },
          }),
        });
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        throw new Error(json.error || `HTTP ${resp.status}`);
      }
      }
      setTestStatus("success");
      toast.success(`Test email sent to ${testEmail}!`);
    } catch (err: any) {
      const msg = err?.message || String(err);
      setTestError(msg);
      setTestStatus("error");
      toast.error(`Failed: ${msg}`);
    } finally {
      setSendingTest(false);
    }
  }

  const set = (partial: Partial<EmailSettings>) => setSettings(s => ({ ...s, ...partial }));

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-xl">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading...
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Email Settings
          </DialogTitle>
          <DialogDescription>
            Test all SMTP port combinations (465/587/25/2525) with your cPanel settings.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={settings.provider}
          onValueChange={(v) => {
            set({ provider: v as EmailSettings["provider"] });
            setTestStatus("idle");
          }}
        >
          <TabsList className="w-full grid-cols-3">
            <TabsTrigger value="smtp" className="flex-1">
              Custom SMTP <Badge variant="secondary" className="ml-1 text-[10px]">Test All Ports</Badge>
            </TabsTrigger>
            <TabsTrigger value="gmail" className="flex-1">Gmail Relay</TabsTrigger>
            <TabsTrigger value="emailjs" className="flex-1">EmailJS</TabsTrigger>
          </TabsList>

          {/* ── EMAILJS (old working setup) ─────────────────────────────────── */}
          <TabsContent value="emailjs" className="space-y-4 pt-3">
            <Alert className="py-2 border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-xs text-green-900 space-y-1">
               <div><strong>This is your old working setup!</strong> Sends directly from browser (bypasses Firebase Functions).</div>
                <div>
                  1. Log in to{" "}
                  <a href="https://dashboard.emailjs.com" target="_blank" rel="noopener noreferrer" className="underline font-semibold inline-flex items-center gap-0.5">
                    dashboard.emailjs.com <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div>2. Get your <strong>Public Key</strong>, <strong>Service ID</strong>, and <strong>Template ID</strong></div>
                <div>3. Paste them below — works instantly like before</div>
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">EmailJS Public Key</Label>
                <Input
                  placeholder="Your public key"
                  value={settings.publicKey ?? ""}
                  onChange={(e) => set({ publicKey: e.target.value.trim() })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Service ID</Label>
                  <Input
                    placeholder="service_xxxxxx"
                    value={settings.serviceId ?? ""}
                    onChange={(e) => set({ serviceId: e.target.value.trim() })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Template ID</Label>
                  <Input
                    placeholder="template_xxxxxx"
                    value={settings.templateId ?? ""}
                    onChange={(e) => set({ templateId: e.target.value.trim() })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">From Name</Label>
                  <Input
                    placeholder="Your Business Name"
                    value={settings.fromName}
                    onChange={(e) => set({ fromName: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Reply-to Email</Label>
                  <Input
                    type="email"
                    placeholder="info@yourbusiness.co.za"
                    value={settings.fromEmail}
                    onChange={(e) => set({ fromEmail: e.target.value.trim() })}
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── GMAIL RELAY ────────────────────────────────────────── */}
          <TabsContent value="gmail" className="space-y-4 pt-3">
            <Alert className="py-2 border-amber-200 bg-amber-50">
              <Info className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-900">
                Uses <strong>smtp.gmail.com:587</strong>. Google never blocks its own servers
                from Google Cloud. Requires a <strong>Gmail App Password</strong> — not your
                regular Google password.{" "}
                <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer"
                  className="underline font-semibold inline-flex items-center gap-0.5">
                  Create App Password <ExternalLink className="h-3 w-3" />
                </a>
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <form autoComplete="on" onSubmit={(e) => e.preventDefault()} className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Gmail Address</Label>
                  <Input
                    type="email"
                    autoComplete="username"
                    placeholder="yourname@gmail.com"
                    value={settings.smtpUser ?? ""}
                    onChange={(e) => set({ smtpUser: e.target.value.trim() })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">App Password <span className="text-muted-foreground">(16-char, not your Gmail password)</span></Label>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    placeholder="xxxx xxxx xxxx xxxx"
                    value={settings.smtpPassword ?? ""}
                    onChange={(e) => set({ smtpPassword: e.target.value.trim().replace(/\s/g, "") })}
                  />
                </div>
              </form>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">From Email <span className="text-muted-foreground">(displayed)</span></Label>
                  <Input
                    type="email"
                    placeholder="info@yourbusiness.co.za"
                    value={settings.fromEmail}
                    onChange={(e) => set({ fromEmail: e.target.value.trim() })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">From Name</Label>
                  <Input
                    placeholder="Speaker Repairs SA"
                    value={settings.fromName}
                    onChange={(e) => set({ fromName: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── CUSTOM SMTP ────────────────────────────────────────── */}
          <TabsContent value="smtp" className="space-y-4 pt-3">
            <Alert className="py-2 border-blue-200 bg-blue-50">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-xs text-blue-900">
                <strong>Test all port/security combinations below.</strong> Your cPanel email client shows SMTP settings.
                Try each preset configuration until one works.
              </AlertDescription>
            </Alert>

            {/* Preset Configurations */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Quick Presets (cPanel Standard)</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-auto py-2"
                  onClick={() => set({ smtpPort: 465, smtpSecure: true })}
                >
                  <div className="text-left">
                    <div className="font-semibold">Port 465 (SSL)</div>
                    <div className="text-[10px] text-muted-foreground">Implicit SSL - Most common</div>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-auto py-2"
                  onClick={() => set({ smtpPort: 587, smtpSecure: false })}
                >
                  <div className="text-left">
                    <div className="font-semibold">Port 587 (STARTTLS)</div>
                    <div className="text-[10px] text-muted-foreground">Explicit TLS</div>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-auto py-2"
                  onClick={() => set({ smtpPort: 25, smtpSecure: false })}
                >
                  <div className="text-left">
                    <div className="font-semibold">Port 25 (Plain/TLS)</div>
                    <div className="text-[10px] text-muted-foreground">Legacy - may be blocked</div>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-auto py-2"
                  onClick={() => set({ smtpPort: 2525, smtpSecure: false })}
                >
                  <div className="text-left">
                    <div className="font-semibold">Port 2525 (TLS)</div>
                    <div className="text-[10px] text-muted-foreground">Alternative port</div>
                  </div>
                </Button>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">SMTP Host</Label>
                <Input
                  placeholder="mail.yourbusiness.co.za"
                  value={settings.smtpHost ?? ""}
                  onChange={(e) => set({ smtpHost: e.target.value.trim() })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Port</Label>
                  <Input
                    type="number"
                    value={settings.smtpPort ?? 465}
                    onChange={(e) => set({ smtpPort: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Current: <strong>{settings.smtpPort ?? 465}</strong>
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Security</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={settings.smtpSecure ? "ssl" : "tls"}
                    onChange={(e) => set({ smtpSecure: e.target.value === "ssl" })}
                  >
                    <option value="ssl">SSL (port 465)</option>
                    <option value="tls">STARTTLS (587/25/2525)</option>
                  </select>
                  <p className="text-[10px] text-muted-foreground">
                    {settings.smtpSecure ? "Implicit SSL" : "Explicit STARTTLS"}
                  </p>
                </div>
              </div>

              <form autoComplete="on" onSubmit={(e) => e.preventDefault()} className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Username / Email</Label>
                  <Input
                    type="email"
                    autoComplete="username"
                    placeholder="info@yourbusiness.co.za"
                    value={settings.smtpUser ?? ""}
                    onChange={(e) => set({ smtpUser: e.target.value.trim() })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Password</Label>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    placeholder="Your cPanel email password"
                    value={settings.smtpPassword ?? ""}
                    onChange={(e) => set({ smtpPassword: e.target.value })}
                  />
                </div>
              </form>

              <Separator />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">From Email</Label>
                  <Input
                    type="email"
                    placeholder="info@yourbusiness.co.za"
                    value={settings.fromEmail}
                    onChange={(e) => set({ fromEmail: e.target.value.trim() })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">From Name</Label>
                  <Input
                    placeholder="Your Business Name"
                    value={settings.fromName}
                    onChange={(e) => set({ fromName: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <Separator />

        {/* ── TEST SECTION ───────────────────────────────────────── */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Test Configuration</h3>
          <div className="space-y-1.5">
            <Label className="text-xs">Send test to</Label>
            <Input
              type="email"
              placeholder="test@example.com"
              value={testEmail}
              onChange={(e) => { setTestEmail(e.target.value); setTestStatus("idle"); setTestError(""); }}
            />
          </div>

          {testStatus === "success" && (
            <Alert className="border-green-200 bg-green-50 py-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800 text-xs">
                Test email delivered to <strong>{testEmail}</strong> — check your inbox!
              </AlertDescription>
            </Alert>
          )}

          {testStatus === "error" && (
            <Alert variant="destructive" className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Failed:</strong> {testError || "Check your credentials and try again."}
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={sendTestEmail}
            disabled={sendingTest || !testEmail}
            variant="outline"
            className="w-full gap-2"
          >
            {sendingTest
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</>
              : <><Send className="h-4 w-4" /> Send Test Email</>}
          </Button>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={saveSettings} disabled={saving} className="gap-2">
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
              : <><CheckCircle2 className="h-4 w-4" /> Save Settings</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
