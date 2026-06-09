import { useState, useEffect, useRef, useCallback } from "react";
import {
  X, Mail, Send, RefreshCw, Inbox, Settings, Plus, ChevronLeft,
  Check, Loader2, AlertCircle, Eye, Trash2, Reply, Forward, Volume2, VolumeX, Upload, PenLine, Paperclip, Archive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// ── Notification sound player ──────────────────────────────────────────────────
function playSound(type: string) {
  if (type === "none") return;
  if (type.startsWith("http") || type.startsWith("blob") || type.startsWith("data:")) {
    try { new Audio(type).play(); } catch { /**/ }
    return;
  }
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const scheduleNote = (freq: number, start: number, dur: number, vol = 0.25) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    if (type === "ding") { scheduleNote(880, 0, 0.6); }
    else if (type === "chime") { [523, 659, 784].forEach((f, i) => scheduleNote(f, i * 0.18, 0.35)); }
    else if (type === "pop")  { scheduleNote(440, 0, 0.1, 0.4); scheduleNote(660, 0.05, 0.15, 0.2); }
    else if (type === "double") { scheduleNote(880, 0, 0.2); scheduleNote(880, 0.3, 0.2); }
  } catch { /**/ }
}
import {
  getEmailAccount,
  saveEmailAccount,
  getCachedMessages,
  upsertMessages,
  updateMessageBody,
  markMessageRead,
  updateAccountLastSynced,
  syncFolder,
  fetchBody,
  imapMarkRead,
  imapMove,
  deleteMessageFromCache,
  sendEmail,
  saveSentEmail,
  listImapFolders,
  type EmailAccount,
  type EmailMessage,
} from "@/lib/emailAccountService";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null): string {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  const isThisYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", ...(isThisYear ? {} : { year: "numeric" }) });
}

function initials(name?: string, email?: string): string {
  const src = name || email || "?";
  const parts = src.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ── Account Setup Dialog ───────────────────────────────────────────────────────

interface AccountSetupProps {
  workspaceId: string;
  userId: string;
  existing?: EmailAccount | null;
  onSaved: (account: EmailAccount) => void;
  onClose: () => void;
}

const SOUND_PRESETS = [
  { value: "ding",   label: "Ding",        desc: "Single bell tone" },
  { value: "chime",  label: "Chime",       desc: "Triple rising notes" },
  { value: "pop",    label: "Pop",         desc: "Quick double pop" },
  { value: "double", label: "Double Ding", desc: "Two quick bells" },
  { value: "none",   label: "Silent",      desc: "No sound" },
];

function AccountSetupDialog({ workspaceId, userId, existing, onSaved, onClose }: AccountSetupProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [form, setForm] = useState({
    displayName: existing?.displayName ?? "",
    emailAddress: existing?.emailAddress ?? "",
    imapHost: existing?.imapHost ?? "",
    imapPort: existing?.imapPort ?? 993,
    imapSecure: existing?.imapSecure ?? true,
    imapUsername: existing?.imapUsername ?? "",
    imapPassword: existing?.imapPassword ?? "",
    sentFolder: existing?.sentFolder ?? "Sent",
    smtpPort: existing?.smtpPort ?? 465,
    useForSending: existing?.useForSending ?? false,
    signature: existing?.signature ?? "",
    notificationSound: existing?.notificationSound ?? "ding",
    customSoundUrl: (!existing?.notificationSound || SOUND_PRESETS.some(p => p.value === existing.notificationSound)) ? "" : (existing.notificationSound ?? ""),
  });

  const isCustomSound = !SOUND_PRESETS.some(p => p.value === form.notificationSound);

  function set(field: string, value: unknown) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleTest() {
    setTesting(true);
    try {
      const partial: EmailAccount = {
        id: existing?.id ?? "", workspaceId, userId,
        displayName: form.displayName, emailAddress: form.emailAddress,
        imapHost: form.imapHost, imapPort: form.imapPort, imapSecure: form.imapSecure,
        imapUsername: form.imapUsername, imapPassword: form.imapPassword,
        sentFolder: form.sentFolder, smtpPort: form.smtpPort, useForSending: form.useForSending,
        signature: form.signature, notificationSound: form.notificationSound,
      };
      const list = await listImapFolders(partial);
      setFolders(list);
      toast({ title: "Connection successful", description: `Found ${list.length} folders` });
    } catch (e: unknown) {
      toast({ title: "Connection failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!form.emailAddress || !form.imapHost || !form.imapUsername || !form.imapPassword) {
      toast({ title: "Fill in all required fields", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const soundValue = isCustomSound ? form.customSoundUrl || "none" : form.notificationSound;
      const account = await saveEmailAccount({
        workspaceId, userId,
        displayName: form.displayName, emailAddress: form.emailAddress,
        imapHost: form.imapHost, imapPort: form.imapPort, imapSecure: form.imapSecure,
        imapUsername: form.imapUsername, imapPassword: form.imapPassword,
        sentFolder: form.sentFolder, smtpPort: form.smtpPort, useForSending: form.useForSending,
        signature: form.signature, notificationSound: soundValue,
      });
      toast({ title: "Email account saved" });
      onSaved(account);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? JSON.stringify(e);
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function handleUploadSound(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      set("customSoundUrl", dataUrl);
      set("notificationSound", "custom");
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold text-lg">Email Account Settings</h2>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>

        <Tabs defaultValue="connection" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-5 mt-4 shrink-0">
            <TabsTrigger value="connection" className="flex-1">Connection</TabsTrigger>
            <TabsTrigger value="signature" className="flex-1">Signature</TabsTrigger>
            <TabsTrigger value="notifications" className="flex-1">Notifications</TabsTrigger>
          </TabsList>

          {/* ── Connection tab ── */}
          <TabsContent value="connection" className="flex-1 overflow-y-auto px-5 pb-5 space-y-4 mt-4">
            <p className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/30 border border-amber-200 rounded p-2">
              Credentials are stored in the database. Use an app-specific password where possible.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Your name</Label>
                <Input className="mt-1 h-8 text-sm" placeholder="e.g. Dinel" value={form.displayName} onChange={e => set("displayName", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Email address <span className="text-red-500">*</span></Label>
                <Input className="mt-1 h-8 text-sm" type="email" placeholder="you@domain.com" value={form.emailAddress} onChange={e => set("emailAddress", e.target.value)} />
              </div>
            </div>
            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Incoming mail (IMAP)</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label className="text-xs">IMAP Host <span className="text-red-500">*</span></Label>
                  <Input className="mt-1 h-8 text-sm" placeholder="mail.domain.com" value={form.imapHost} onChange={e => set("imapHost", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Port</Label>
                  <div className="flex gap-1 mt-1">
                    <Input className="h-8 text-sm" type="number" value={form.imapPort} onChange={e => set("imapPort", parseInt(e.target.value) || 993)} />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => { set("imapPort", 993); set("imapSecure", true); }} className="text-[11px] px-2 py-0.5 rounded border border-input hover:bg-accent">993 SSL</button>
                <button type="button" onClick={() => { set("imapPort", 143); set("imapSecure", false); }} className="text-[11px] px-2 py-0.5 rounded border border-input hover:bg-accent">143 STARTTLS</button>
                <button type="button" onClick={() => { set("imapPort", 143); set("imapSecure", true); }} className="text-[11px] px-2 py-0.5 rounded border border-input hover:bg-accent">143 SSL</button>
                <span className="text-[10px] text-muted-foreground self-center">Try each if connection fails</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Username <span className="text-red-500">*</span></Label>
                  <Input className="mt-1 h-8 text-sm" value={form.imapUsername} onChange={e => set("imapUsername", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Password <span className="text-red-500">*</span></Label>
                  <Input className="mt-1 h-8 text-sm" type="password" value={form.imapPassword} onChange={e => set("imapPassword", e.target.value)} />
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={form.imapSecure} onChange={e => set("imapSecure", e.target.checked)} />
                Use SSL/TLS (recommended)
              </label>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={handleTest} disabled={testing || !form.imapHost || !form.imapUsername || !form.imapPassword}>
                  {testing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                  Test connection
                </Button>
                <div className="flex-1">
                  <Label className="text-xs">Sent folder</Label>
                  {folders.length > 0
                    ? <select className="mt-1 w-full h-8 rounded border border-input bg-background px-2 text-sm" value={form.sentFolder} onChange={e => set("sentFolder", e.target.value)}>
                        {folders.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    : <Input className="mt-1 h-8 text-sm" placeholder="Sent" value={form.sentFolder} onChange={e => set("sentFolder", e.target.value)} />
                  }
                </div>
              </div>
            </div>
            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Outgoing mail (SMTP)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">SMTP Port</Label>
                  <Input className="mt-1 h-8 text-sm" type="number" value={form.smtpPort} onChange={e => set("smtpPort", parseInt(e.target.value) || 465)} />
                  <p className="text-[10px] text-muted-foreground mt-0.5">465 (SSL) or 587 (STARTTLS)</p>
                </div>
                <div className="flex flex-col justify-center">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={form.useForSending} onChange={e => set("useForSending", e.target.checked)} />
                    <div>
                      <span className="text-sm font-medium">Use as default sender</span>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Invoices &amp; quotations from you will come from this address</p>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Signature tab ── */}
          <TabsContent value="signature" className="flex-1 overflow-y-auto px-5 pb-5 space-y-3 mt-4">
            <div className="flex items-center gap-2">
              <PenLine className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">Email Signature</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Appended automatically to every new email you compose. You can use plain text or basic HTML.
            </p>
            <Textarea
              className="min-h-[180px] text-sm font-mono resize-none"
              placeholder={`Kind regards,\nYour Name\n\nYour Business Name\n📞 Your phone\n✉ your@email.co.za`}
              value={form.signature}
              onChange={e => set("signature", e.target.value)}
            />
            <div className="bg-muted/40 rounded-lg p-3 border">
              <p className="text-xs font-medium mb-2 text-muted-foreground">Preview</p>
              <div
                className="text-sm text-foreground border-t pt-2 whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: form.signature.includes("<") ? form.signature : form.signature.replace(/\n/g, "<br/>") }}
              />
            </div>
          </TabsContent>

          {/* ── Notifications tab ── */}
          <TabsContent value="notifications" className="flex-1 overflow-y-auto px-5 pb-5 space-y-4 mt-4">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">New email notification sound</p>
            </div>
            <p className="text-xs text-muted-foreground">Plays when new emails arrive during a sync.</p>

            <div className="grid grid-cols-1 gap-2">
              {SOUND_PRESETS.map(preset => (
                <label key={preset.value} className={cn(
                  "flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  form.notificationSound === preset.value ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                )}>
                  <div className="flex items-center gap-3">
                    <input type="radio" name="sound" value={preset.value}
                      checked={form.notificationSound === preset.value}
                      onChange={() => set("notificationSound", preset.value)} />
                    <div>
                      <p className="text-sm font-medium">{preset.label}</p>
                      <p className="text-xs text-muted-foreground">{preset.desc}</p>
                    </div>
                  </div>
                  {preset.value !== "none" && (
                    <Button variant="ghost" size="sm" type="button" className="h-7 px-2 text-xs"
                      onClick={e => { e.preventDefault(); playSound(preset.value); }}>
                      <Volume2 className="h-3 w-3 mr-1" /> Preview
                    </Button>
                  )}
                </label>
              ))}

              {/* Custom sound */}
              <div className={cn(
                "p-3 rounded-lg border transition-colors",
                isCustomSound ? "border-primary bg-primary/5" : "hover:bg-muted/50"
              )}>
                <label className="flex items-center gap-3 cursor-pointer mb-2">
                  <input type="radio" name="sound" value="custom"
                    checked={isCustomSound}
                    onChange={() => set("notificationSound", "custom")} />
                  <div>
                    <p className="text-sm font-medium">Custom sound</p>
                    <p className="text-xs text-muted-foreground">Upload an .mp3 or .wav file</p>
                  </div>
                </label>
                <div className="flex gap-2 ml-6">
                  <label className="flex-1">
                    <Button variant="outline" size="sm" className="w-full text-xs gap-1.5" type="button"
                      onClick={() => document.getElementById("sound-upload")?.click()}>
                      <Upload className="h-3.5 w-3.5" />
                      {form.customSoundUrl ? "Replace file" : "Upload file"}
                    </Button>
                    <input id="sound-upload" type="file" accept="audio/*" className="hidden" onChange={handleUploadSound} />
                  </label>
                  {form.customSoundUrl && (
                    <Button variant="ghost" size="sm" className="text-xs gap-1" type="button"
                      onClick={() => playSound(form.customSoundUrl)}>
                      <Volume2 className="h-3 w-3" /> Test
                    </Button>
                  )}
                </div>
                <div className="mt-2 ml-6">
                  <Label className="text-xs">Or paste a sound URL</Label>
                  <Input className="mt-1 h-8 text-xs" placeholder="https://example.com/sound.mp3"
                    value={typeof form.customSoundUrl === "string" && !form.customSoundUrl.startsWith("data:") ? form.customSoundUrl : ""}
                    onChange={e => { set("customSoundUrl", e.target.value); set("notificationSound", "custom"); }} />
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex gap-2 px-5 py-4 border-t shrink-0">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
            Save settings
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Compose / Reply ────────────────────────────────────────────────────────────

interface ComposeProps {
  account: EmailAccount;
  workspaceId: string;
  userId: string;
  replyTo?: EmailMessage | null;
  onClose: () => void;
  onSent: () => void;
}

function ComposePanel({ account, workspaceId, userId, replyTo, onClose, onSent }: ComposeProps) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [to, setTo] = useState(replyTo ? (replyTo.fromEmail ?? "") : "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(replyTo ? (replyTo.subject.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`) : "");
  const sigBlock = account.signature ? `\n\n-- \n${account.signature}` : "";
  const [body, setBody] = useState(replyTo
    ? `${sigBlock}\n\n---\nOn ${fmtDate(replyTo.sentDate)}, ${replyTo.fromName || replyTo.fromEmail} wrote:\n${stripHtml(replyTo.bodyHtml || replyTo.bodyText || "")}`
    : sigBlock);

  async function handleSend() {
    if (!to.trim() || !subject.trim()) {
      toast({ title: "To and subject are required", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const sentDate = new Date();
      await sendEmail({
        smtpConfig: {
          host: account.imapHost,
          port: account.smtpPort,
          secure: account.smtpPort === 465,
          user: account.imapUsername,
          pass: account.imapPassword,
        },
        from: `${account.displayName} <${account.emailAddress}>`,
        to: to.trim(),
        cc: cc.trim() || undefined,
        subject: subject.trim(),
        text: body,
      });
      // Save to IMAP sent folder + DB cache (fire-and-forget)
      saveSentEmail(workspaceId, userId, {
        from: `${account.displayName} <${account.emailAddress}>`,
        to: to.trim(),
        cc: cc.trim() || undefined,
        subject: subject.trim(),
        text: body,
        date: sentDate,
      }).catch(() => {});
      toast({ title: "Email sent" });
      onSent();
      onClose();
    } catch (e: unknown) {
      toast({ title: "Send failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h3 className="font-medium text-sm">{replyTo ? "Reply" : "New Email"}</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-2">
        <div className="space-y-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-10">To</span>
            <Input className="h-7 text-sm" value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@example.com" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-10">Cc</span>
            <Input className="h-7 text-sm" value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-10">Subject</span>
            <Input className="h-7 text-sm" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
        </div>
        <Textarea
          className="flex-1 resize-none text-sm font-mono mt-1"
          placeholder="Type your message here..."
          value={body}
          onChange={e => setBody(e.target.value)}
        />
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose} className="flex-1">Discard</Button>
          <Button size="sm" className="flex-1 gap-1" onClick={handleSend} disabled={sending}>
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Email Detail ───────────────────────────────────────────────────────────────

interface EmailDetailProps {
  message: EmailMessage;
  onReply: () => void;
  onBack: () => void;
  onArchive?: () => void;
  archiving?: boolean;
}

function EmailDetail({ message, onReply, onBack, onArchive, archiving }: EmailDetailProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (iframeRef.current && message.bodyHtml) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(`<!DOCTYPE html><html><head><style>body{font-family:Arial,sans-serif;font-size:13px;padding:12px;color:#1a1a1a;word-wrap:break-word;}a{color:#2563eb}img{max-width:100%}</style></head><body>${message.bodyHtml}</body></html>`);
        doc.close();
        // Auto-resize
        setTimeout(() => {
          if (iframeRef.current) {
            iframeRef.current.style.height = (doc.body?.scrollHeight ?? 300) + 40 + "px";
          }
        }, 200);
      }
    }
  }, [message.bodyHtml]);

  const displayBody = message.bodyHtml || message.bodyText;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground md:hidden">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <Button variant="ghost" size="sm" className="gap-1 ml-auto" onClick={onReply}>
          <Reply className="h-3.5 w-3.5" /> Reply
        </Button>
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => {}}>
          <Forward className="h-3.5 w-3.5" /> Forward
        </Button>
        {onArchive && (
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground" onClick={onArchive} disabled={archiving} title="Archive this email">
            {archiving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
            {archiving ? "Archiving…" : "Archive"}
          </Button>
        )}
      </div>
      <div className="p-4 space-y-3 flex-1 overflow-y-auto">
        <h2 className="text-base font-semibold">{message.subject}</h2>
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
            {initials(message.fromName, message.fromEmail)}
          </div>
          <div className="text-sm">
            <p className="font-medium">{message.fromName || message.fromEmail}</p>
            <p className="text-xs text-muted-foreground">&lt;{message.fromEmail}&gt;</p>
            {message.toRecipients?.length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                To: {message.toRecipients.map(r => r.email).join(", ")}
              </p>
            )}
          </div>
          <span className="ml-auto text-xs text-muted-foreground shrink-0">{fmtDate(message.sentDate)}</span>
        </div>
        <div className="border-t pt-3">
          {!displayBody ? (
            <p className="text-sm text-muted-foreground italic">Loading message body…</p>
          ) : message.bodyHtml ? (
            <iframe ref={iframeRef} className="w-full border-0 min-h-[200px]" sandbox="allow-same-origin" title="Email body" />
          ) : (
            <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{message.bodyText}</pre>
          )}
        </div>
        {message.attachments && message.attachments.length > 0 && (
          <div className="border-t pt-3 mt-1">
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <Paperclip className="h-3 w-3" /> Attachments ({message.attachments.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {message.attachments.map((att, i) => (
                <a
                  key={i}
                  href={`data:${att.contentType};base64,${att.content}`}
                  download={att.filename}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-muted hover:bg-muted/70 text-sm transition-colors"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                  {att.filename}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main EmailPage ─────────────────────────────────────────────────────────────

interface EmailPageProps {
  onClose: () => void;
  onUnreadCountChange?: (count: number) => void;
}

export function EmailPage({ onClose, onUnreadCountChange }: EmailPageProps) {
  const { user, workspaceId, accessPreviewMemberUid } = useAuth();
  const effectiveUid = accessPreviewMemberUid ?? user?.uid ?? "";
  const { toast } = useToast();

  const [account, setAccount] = useState<EmailAccount | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const [folder, setFolder] = useState("INBOX");
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [showCompose, setShowCompose] = useState(false);
  const [replyTo, setReplyTo] = useState<EmailMessage | null>(null);
  const [archiving, setArchiving] = useState(false);

  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const prevMessageUidsRef = useRef<Set<number>>(new Set());

  // ── Load account ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!workspaceId || !effectiveUid) return;
    getEmailAccount(workspaceId, effectiveUid).then(acc => {
      setAccount(acc);
      setLoadingAccount(false);
      if (!acc) setShowSettings(true);
    });
  }, [workspaceId, effectiveUid]);

  // ── Load cached messages when folder changes ──────────────────────────────────
  useEffect(() => {
    if (!workspaceId || !effectiveUid) return;
    getCachedMessages(workspaceId, effectiveUid, folder).then(setMessages);
    setSelectedMessage(null);
  }, [folder, workspaceId, effectiveUid]);

  // ── Sync from IMAP ────────────────────────────────────────────────────────────
  const handleSync = useCallback(async () => {
    if (!account || !workspaceId || !effectiveUid) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const fetched = await syncFolder(account, folder);
      await upsertMessages(workspaceId, effectiveUid, account.id, folder, fetched);
      await updateAccountLastSynced(account.id);
      const cached = await getCachedMessages(workspaceId, effectiveUid, folder);
      setMessages(cached);
      const unread = cached.filter(m => !m.isRead).length;
      onUnreadCountChange?.(unread);
      // Play notification sound for newly arrived unread messages (skip initial load)
      const prevUids = prevMessageUidsRef.current;
      const newUnread = cached.filter(m => !m.isRead && !prevUids.has(m.uid));
      prevMessageUidsRef.current = new Set(cached.map(m => m.uid));
      if (newUnread.length > 0 && prevUids.size > 0) {
        playSound(account.notificationSound || "ding");
      }
      toast({ title: `${fetched.length} messages synced` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Sync failed";
      setSyncError(msg);
      toast({ title: "Sync failed", description: msg, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }, [account, workspaceId, effectiveUid, folder, toast, onUnreadCountChange]);

  // Auto-sync on first open, then every 2 minutes
  useEffect(() => {
    if (account && !loadingAccount) handleSync();
  }, [account?.id]); // eslint-disable-line

  useEffect(() => {
    if (!account || loadingAccount) return;
    const timer = setInterval(() => handleSync(), 2 * 60 * 1000);
    return () => clearInterval(timer);
  }, [account?.id, loadingAccount]); // eslint-disable-line

  // ── Open a message ────────────────────────────────────────────────────────────
  async function openMessage(msg: EmailMessage) {
    setSelectedMessage(msg);
    setMobileView("detail");
    setShowCompose(false);
    setReplyTo(null);

    // Immediately mark as read in local state + update sidebar count
    if (!msg.isRead) {
      setMessages(prev => {
        const updated = prev.map(m => m.uid === msg.uid ? { ...m, isRead: true } : m);
        onUnreadCountChange?.(updated.filter(m => !m.isRead).length);
        return updated;
      });
      if (account && workspaceId && effectiveUid) {
        imapMarkRead(account, folder, msg.uid).catch(() => {});
        markMessageRead(workspaceId, effectiveUid, folder, msg.uid);
      }
    }

    // If we already have body AND attachments have been resolved, nothing more to do
    if ((msg.bodyText || msg.bodyHtml) && msg.attachments !== undefined) return;

    // Fetch body from IMAP
    if (!account || !workspaceId || !effectiveUid) return;
    try {
      const { text, html, isRead, attachments } = await fetchBody(account, folder, msg.uid);
      const updated = { ...msg, bodyText: text, bodyHtml: html, isRead: true, attachments };
      setSelectedMessage(updated);
      setMessages(prev => prev.map(m => m.uid === msg.uid ? updated : m));
      await updateMessageBody(workspaceId, effectiveUid, folder, msg.uid, text, html, isRead);
      if (!isRead) {
        imapMarkRead(account, folder, msg.uid).catch(() => {});
        markMessageRead(workspaceId, effectiveUid, folder, msg.uid);
      }
    } catch (e: unknown) {
      toast({ title: "Could not load email body", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  }

  const ARCHIVE_FOLDER = "Archive";

  async function handleArchive(msg: EmailMessage) {
    if (!account || !workspaceId || !effectiveUid) return;
    // Don't archive if already in Archive
    if (folder === ARCHIVE_FOLDER) return;
    setArchiving(true);
    try {
      await imapMove(account, folder, msg.uid, ARCHIVE_FOLDER);
      await deleteMessageFromCache(workspaceId, effectiveUid, folder, msg.uid);
      setMessages(prev => prev.filter(m => m.uid !== msg.uid));
      setSelectedMessage(null);
      setMobileView("list");
      toast({ title: "Archived", description: `"${msg.subject}" moved to Archive` });
    } catch (e: unknown) {
      toast({ title: "Archive failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setArchiving(false);
    }
  }

  const unreadCount = messages.filter(m => !m.isRead).length;
  const sentFolderName = account?.sentFolder ?? "Sent";

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loadingAccount) {
    return (
      <div className="absolute inset-0 z-30 bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 bg-background flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-background shrink-0">
        <Mail className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-base font-semibold leading-none">Email</h1>
          {account && <p className="text-xs text-muted-foreground mt-0.5">{account.emailAddress}</p>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {account && (
            <>
              <Button size="sm" className="gap-1.5" onClick={() => { setShowCompose(true); setSelectedMessage(null); setReplyTo(null); }}>
                <Plus className="h-3.5 w-3.5" /> Compose
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSync} disabled={syncing}>
                <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                {syncing ? "Syncing…" : "Sync"}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowSettings(true)} title="Email settings">
            <Settings className="h-3.5 w-3.5" /> Settings
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* ── No account banner ── */}
      {!account && !showSettings && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-3 max-w-sm">
            <Mail className="h-12 w-12 mx-auto text-muted-foreground/40" />
            <h2 className="font-semibold">Set up your email</h2>
            <p className="text-sm text-muted-foreground">Connect your email account to view your inbox and send emails directly from the app.</p>
            <Button onClick={() => setShowSettings(true)}>Configure email account</Button>
          </div>
        </div>
      )}

      {/* ── 3-panel layout ── */}
      {account && (
        <div className="flex-1 flex overflow-hidden">

          {/* Left sidebar — folders */}
          <div className={cn(
            "w-44 shrink-0 border-r flex flex-col bg-muted/20 py-3 px-2",
            "hidden md:flex"
          )}>
            {[
              { key: "INBOX", label: "Inbox", icon: <Inbox className="h-3.5 w-3.5" />, badge: unreadCount },
              { key: sentFolderName, label: "Sent", icon: <Send className="h-3.5 w-3.5" /> },
              { key: ARCHIVE_FOLDER, label: "Archive", icon: <Archive className="h-3.5 w-3.5" /> },
            ].map(({ key, label, icon, badge }) => (
              <button
                key={key}
                onClick={() => { setFolder(key); setMobileView("list"); }}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left",
                  folder === key ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {icon}
                <span className="flex-1">{label}</span>
                {badge ? <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 leading-none">{badge}</span> : null}
              </button>
            ))}
            <div className="mt-auto px-1">
              {account.lastSyncedAt && (
                <p className="text-xs text-muted-foreground text-center">
                  Synced {fmtDate(account.lastSyncedAt)}
                </p>
              )}
            </div>
          </div>

          {/* Mobile folder tabs */}
          <div className="md:hidden flex gap-1 border-r px-2 py-2 flex-col shrink-0">
            {[
              { key: "INBOX", icon: <Inbox className="h-4 w-4" />, badge: unreadCount },
              { key: sentFolderName, icon: <Send className="h-4 w-4" /> },
              { key: ARCHIVE_FOLDER, icon: <Archive className="h-4 w-4" /> },
            ].map(({ key, icon, badge }) => (
              <button
                key={key}
                onClick={() => { setFolder(key); setMobileView("list"); }}
                className={cn(
                  "relative p-2 rounded-md transition-colors",
                  folder === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {icon}
                {badge ? <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 flex items-center justify-center text-[9px] bg-primary text-primary-foreground rounded-full">{badge}</span> : null}
              </button>
            ))}
          </div>

          {/* Message list */}
          <div className={cn(
            "w-72 shrink-0 border-r flex flex-col overflow-hidden",
            mobileView === "detail" && "hidden md:flex"
          )}>
            {syncError && (
              <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 border-b text-xs text-red-600">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {syncError}
              </div>
            )}
            {messages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-muted-foreground text-sm">
                  {syncing ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : <p>No messages in {folder === "INBOX" ? "inbox" : folder}</p>}
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto divide-y">
                {messages.map((msg) => (
                  <button
                    key={`${msg.uid}-${msg.folder}`}
                    onClick={() => openMessage(msg)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 transition-colors border-l-2",
                      // unread: blue tinted background + blue left border
                      !msg.isRead && selectedMessage?.uid !== msg.uid && "bg-blue-50 dark:bg-blue-950/40 border-blue-500 hover:bg-blue-100 dark:hover:bg-blue-950/60",
                      // read: plain background + transparent border
                      msg.isRead && selectedMessage?.uid !== msg.uid && "bg-background border-transparent hover:bg-muted/50",
                      // selected
                      selectedMessage?.uid === msg.uid && "bg-primary/10 border-primary",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <span className={cn("text-sm truncate", !msg.isRead ? "font-bold text-foreground" : "font-normal text-muted-foreground")}>
                        {msg.fromName || msg.fromEmail || "Unknown"}
                      </span>
                      <span className={cn("text-xs shrink-0", !msg.isRead ? "text-blue-600 dark:text-blue-400 font-semibold" : "text-muted-foreground")}>
                        {fmtDate(msg.sentDate)}
                      </span>
                    </div>
                    <p className={cn("text-xs truncate", !msg.isRead ? "text-foreground font-semibold" : "text-muted-foreground")}>
                      {msg.subject}
                    </p>
                    <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                      {stripHtml(msg.bodyHtml || msg.bodyText || "").slice(0, 80)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Detail / compose pane */}
          <div className={cn(
            "flex-1 overflow-hidden",
            mobileView === "list" && "hidden md:flex md:flex-col"
          )}>
            {showCompose ? (
              <ComposePanel
                account={account}
                workspaceId={workspaceId!}
                userId={effectiveUid}
                replyTo={replyTo}
                onClose={() => { setShowCompose(false); setReplyTo(null); }}
                onSent={handleSync}
              />
            ) : selectedMessage ? (
              <EmailDetail
                message={selectedMessage}
                onBack={() => setMobileView("list")}
                onReply={() => { setReplyTo(selectedMessage); setShowCompose(true); }}
                onArchive={folder !== ARCHIVE_FOLDER ? () => handleArchive(selectedMessage) : undefined}
                archiving={archiving}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center h-full text-muted-foreground text-sm">
                <div className="text-center">
                  <Eye className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>Select an email to read it</p>
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── Settings dialog ── */}
      {showSettings && (
        <AccountSetupDialog
          workspaceId={workspaceId!}
          userId={effectiveUid}
          existing={account}
          onSaved={(acc) => { setAccount(acc); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
