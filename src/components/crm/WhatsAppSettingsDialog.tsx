import { useState, useEffect, useRef } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Eye, EyeOff, Plus, Trash2, MessageSquare, Loader2, RefreshCw, CheckCircle2, AlertCircle, ClipboardList, RotateCcw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  loadWhatsAppSettings, saveWhatsAppSettings, fetchWhatsAppTemplates, loadWhatsAppLogs, resendWhatsAppMessage,
} from "@/lib/whatsappService";
import {
  WhatsAppSettings, WhatsAppVariableMapping, WhatsAppTemplate,
  DEFAULT_WHATSAPP_SETTINGS, TASK_FIELD_LABELS, TaskFieldKey, WhatsAppLog,
  SecondMessageConfig, DEFAULT_SECOND_MESSAGE,
} from "@/types/whatsapp";
import { CustomFieldDefinition } from "@/types/crm";

const TASK_FIELDS = Object.entries(TASK_FIELD_LABELS) as [TaskFieldKey, string][];

function countBodyVariables(template: WhatsAppTemplate): number {
  const body = template.components.find((c) => c.type === "BODY");
  if (!body?.text) return 0;
  const matches = body.text.match(/\{\{\d+\}\}/g);
  return matches ? matches.length : 0;
}

function getBodyPreview(template: WhatsAppTemplate): string {
  const body = template.components.find((c) => c.type === "BODY");
  return body?.text ?? "";
}

interface Props {
  open: boolean;
  onClose: () => void;
  customFields: CustomFieldDefinition[];
}

export function WhatsAppSettingsDialog({ open, onClose, customFields }: Props) {
  const { workspaceId } = useAuth();
  const { toast } = useToast();

  const [settings, setSettings] = useState<WhatsAppSettings>({ ...DEFAULT_WHATSAPP_SETTINGS });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Template fetching state
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [fetchingTemplates, setFetchingTemplates] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchedOk, setFetchedOk] = useState(false);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [logs, setLogs] = useState<WhatsAppLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [resendingIds, setResendingIds] = useState<Set<string>>(new Set());

  const loadLogs = () => {
    if (!workspaceId) return;
    setLogsLoading(true);
    loadWhatsAppLogs(workspaceId)
      .then(setLogs)
      .catch(() => {})
      .finally(() => setLogsLoading(false));
  };

  const handleResendMessage = async (log: WhatsAppLog) => {
    if (!workspaceId || !log.id) return;
    
    setResendingIds(prev => new Set(prev.add(log.id!)));
    
    try {
      await resendWhatsAppMessage(settings, log, workspaceId);
      toast({
        title: "Message Resent",
        description: `WhatsApp message to ${log.to} has been resent successfully.`,
      });
      // Reload logs to show the new attempt
      loadLogs();
    } catch (error) {
      console.error("Failed to resend message:", error);
      toast({
        title: "Resend Failed", 
        description: error instanceof Error ? error.message : "Failed to resend message",
        variant: "destructive",
      });
    } finally {
      setResendingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(log.id!);
        return newSet;
      });
    }
  };

  useEffect(() => {
    if (!open || !workspaceId) return;
    setLoading(true);
    loadWhatsAppSettings(workspaceId)
      .then((s) => {
        // Merge with defaults to fill in any fields missing from old saved data
        const merged = { ...DEFAULT_WHATSAPP_SETTINGS, ...s };
        setSettings(merged);
        if (merged.wabaId && merged.accessToken) triggerFetch(merged.wabaId, merged.accessToken);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  function scheduleTemplateFetch(wabaId: string, token: string) {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    if (!(wabaId ?? "").trim() || !(token ?? "").trim()) {
      setTemplates([]); setFetchedOk(false); setFetchError(null); return;
    }
    fetchTimer.current = setTimeout(() => triggerFetch(wabaId, token), 800);
  }

  function triggerFetch(wabaId: string, token: string) {
    setFetchingTemplates(true); setFetchError(null); setFetchedOk(false);
    fetchWhatsAppTemplates(wabaId, token)
      .then((list) => { setTemplates(list); setFetchedOk(true); })
      .catch((e: Error) => {
        setFetchError(
          e.message.includes("190") ? "Invalid or expired access token." :
          e.message.includes("100") ? "Business Account ID not found. Check your WABA ID." :
          "Could not load templates. Check credentials."
        );
        setTemplates([]);
      })
      .finally(() => setFetchingTemplates(false));
  }

  const update = (patch: Partial<WhatsAppSettings>) =>
    setSettings((s) => ({ ...s, ...patch }));

  const updateSecond = (patch: Partial<SecondMessageConfig>) =>
    update({ secondMessage: { ...(settings.secondMessage ?? DEFAULT_SECOND_MESSAGE), ...patch } });

  const handleWabaChange = (wabaId: string) => {
    update({ wabaId });
    scheduleTemplateFetch(wabaId, settings.accessToken);
  };

  const handleTokenChange = (accessToken: string) => {
    update({ accessToken });
    scheduleTemplateFetch(settings.wabaId, accessToken);
  };

  const handleTemplateSelect = (name: string) => {
    const tpl = templates.find((t) => t.name === name);
    if (!tpl) return;
    const varCount = countBodyVariables(tpl);
    const newVars: WhatsAppVariableMapping[] = Array.from(
      { length: Math.max(varCount, 1) },
      (_, i) => ({ variableIndex: i + 1, fieldKey: i === 0 ? "title" : "status" } as WhatsAppVariableMapping),
    );
    update({ templateName: tpl.name, languageCode: tpl.language, variables: newVars });
  };

  const handleSecondTemplateSelect = (name: string) => {
    const tpl = templates.find((t) => t.name === name);
    if (!tpl) return;
    const varCount = countBodyVariables(tpl);
    const newVars: WhatsAppVariableMapping[] = Array.from(
      { length: varCount }, // Only create variables if needed (don't force minimum 1 for second message)
      (_, i) => ({ variableIndex: i + 1, fieldKey: i === 0 ? "title" : "status" } as WhatsAppVariableMapping),
    );
    updateSecond({ templateName: tpl.name, languageCode: tpl.language, variables: newVars });
  };

  const addVariable = () => {
    const next = settings.variables.length + 1;
    update({ variables: [...settings.variables, { variableIndex: next, fieldKey: "title" }] });
  };

  const removeVariable = (idx: number) => {
    update({
      variables: settings.variables
        .filter((_, i) => i !== idx)
        .map((v, i) => ({ ...v, variableIndex: i + 1 })),
    });
  };

  const updateVariable = (idx: number, patch: Partial<WhatsAppVariableMapping>) =>
    update({ variables: settings.variables.map((v, i) => i === idx ? { ...v, ...patch } : v) });

  // Find phone fields - include explicit "phone" type AND fields with phone-related names
  const phoneFields = customFields.filter((f) => 
    f.type === "phone" || 
    f.name.toLowerCase().includes("phone") ||
    f.name.toLowerCase().includes("contact") ||
    f.name.toLowerCase().includes("mobile") ||
    f.name.toLowerCase().includes("cell")
  );

  const handleSave = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      await saveWhatsAppSettings(workspaceId, settings);
      toast({ title: "WhatsApp settings saved" });
      onClose();
    } catch {
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const selectedTpl = templates.find((t) => t.name === settings.templateName);
  const bodyPreview = selectedTpl ? getBodyPreview(selectedTpl) : "";
  const credentialsReady = !!((settings.wabaId ?? "").trim() && (settings.accessToken ?? "").trim());

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-green-600" />
            WhatsApp Notifications
          </DialogTitle>
          <DialogDescription>
            Configure Meta WhatsApp Cloud API credentials and template message mapping.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            Loading…
          </div>
        ) : (
          <>
            {/* Enable toggle */}
            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Send on task creation</p>
                <p className="text-xs text-muted-foreground">
                  Fires a WhatsApp template message each time a task is created
                </p>
              </div>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(v) => update({ enabled: v })}
              />
            </div>

          <Tabs defaultValue="credentials" onValueChange={(v) => v === "logs" && loadLogs()}>
              <TabsList className="w-full">
                <TabsTrigger value="credentials" className="flex-1">Credentials</TabsTrigger>
                <TabsTrigger value="template" className="flex-1" disabled={!credentialsReady}>
                  Template
                  {fetchingTemplates && <Loader2 className="ml-1 h-3 w-3 animate-spin" />}
                  {fetchedOk && !fetchingTemplates && <CheckCircle2 className="ml-1 h-3 w-3 text-green-500" />}
                  {fetchError && !fetchingTemplates && <AlertCircle className="ml-1 h-3 w-3 text-destructive" />}
                </TabsTrigger>
                <TabsTrigger value="mapping" className="flex-1" disabled={!settings.templateName}>
                  Mapping
                </TabsTrigger>
                <TabsTrigger value="logs" className="flex-1" onClick={loadLogs}>
                  <ClipboardList className="h-3.5 w-3.5 mr-1" />Logs
                </TabsTrigger>
              </TabsList>

              {/* ── Credentials ──────────────────────────────── */}
              <TabsContent value="credentials" className="space-y-4 pt-2">
                <form onSubmit={(e) => e.preventDefault()} autoComplete="off">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>WhatsApp Business Account ID (WABA ID)</Label>
                      <Input
                        placeholder="123456789012345"
                        value={settings.wabaId}
                        onChange={(e) => handleWabaChange(e.target.value.trim())}
                        autoComplete="off"
                      />
                      <p className="text-xs text-muted-foreground">
                        Meta Business Manager → WhatsApp Accounts → your account ID
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Phone Number ID</Label>
                      <Input
                        placeholder="987654321098765"
                        value={settings.phoneNumberId}
                        onChange={(e) => update({ phoneNumberId: e.target.value.trim() })}
                        autoComplete="off"
                      />
                      <p className="text-xs text-muted-foreground">
                        Meta Business Manager → WhatsApp → API Setup → Phone Number ID
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Access Token</Label>
                      <div className="relative">
                        <Input
                          type={showToken ? "text" : "password"}
                          placeholder="EAAxxxxxxxx…"
                          value={settings.accessToken}
                          onChange={(e) => handleTokenChange(e.target.value.trim())}
                          autoComplete="new-password"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowToken((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Use a permanent system user token for production
                      </p>
                    </div>

                    {credentialsReady && (
                      <div className="flex items-center gap-2">
                        {fetchingTemplates && (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Fetching templates…
                          </span>
                        )}
                        {fetchedOk && !fetchingTemplates && (
                          <span className="flex items-center gap-1.5 text-xs text-green-600">
                            <CheckCircle2 className="h-3 w-3" />
                            {templates.length} approved template{templates.length !== 1 ? "s" : ""} loaded
                          </span>
                        )}
                        {fetchError && !fetchingTemplates && (
                          <span className="flex items-center gap-1.5 text-xs text-destructive">
                            <AlertCircle className="h-3 w-3" /> {fetchError}
                          </span>
                        )}
                        {!fetchingTemplates && (
                          <Button
                            variant="ghost" size="sm" className="h-6 px-2 text-xs ml-auto"
                            onClick={() => triggerFetch(settings.wabaId, settings.accessToken)}
                          >
                            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </form>
              </TabsContent>

              {/* ── Template ─────────────────────────────────── */}
              <TabsContent value="template" className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label>Select Template</Label>
                  {templates.length > 0 ? (
                    <Select value={settings.templateName} onValueChange={handleTemplateSelect}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose an approved template…" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((t) => (
                          <SelectItem key={t.name} value={t.name}>
                            <div className="flex flex-col">
                              <span>{t.name}</span>
                              <span className="text-xs text-muted-foreground">{t.category} · {t.language}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground text-center">
                      {fetchingTemplates ? "Loading templates from Meta…" :
                       fetchError ? fetchError :
                       "Enter WABA ID + Access Token on the Credentials tab to load templates."}
                    </div>
                  )}
                </div>

                {bodyPreview && (
                  <div className="space-y-1.5">
                    <Label>Template Body Preview</Label>
                    <div className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{bodyPreview}</div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Language</Label>
                  <Input
                    value={settings.languageCode}
                    onChange={(e) => update({ languageCode: e.target.value })}
                    placeholder="en_US"
                  />
                  <p className="text-xs text-muted-foreground">
                    Auto-filled from the selected template. Edit only if needed.
                  </p>
                </div>

                <Separator />

                {/* Flow Template toggle */}
                <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">WhatsApp Flow Template</Label>
                    <p className="text-xs text-muted-foreground">
                      Enable if this template is a <strong>Flow</strong> type (name often ends in <code className="bg-muted px-1 rounded">_flow</code>).
                      Adds the required <code className="bg-muted px-1 rounded">button / sub_type: flow</code> component to the API request.
                    </p>
                  </div>
                  <Switch
                    checked={!!settings.isFlowTemplate}
                    onCheckedChange={(v) => update({ isFlowTemplate: v })}
                  />
                </div>
                {settings.isFlowTemplate && (
                  <div className="space-y-1.5">
                    <Label>Flow Token <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                    <Input
                      value={settings.flowToken ?? "unused"}
                      onChange={(e) => update({ flowToken: e.target.value })}
                      placeholder="unused"
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave as <code className="bg-muted px-1 rounded">unused</code> unless your flow requires a specific token.
                    </p>
                  </div>
                )}

                <Separator />

                <div className="space-y-1.5">
                  <Label>Recipient Phone Number</Label>
                  {phoneFields.length > 0 && (
                    <Select
                      value={settings.recipientField.startsWith("fixed:") || settings.recipientField === "" ? "fixed:" : settings.recipientField}
                      onValueChange={(v) => update({ recipientField: v === "fixed:" ? "fixed:" : v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select phone field or fixed number…" />
                      </SelectTrigger>
                      <SelectContent>
                        {phoneFields.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name} {f.type === "phone" ? "(Phone field)" : "(Text field)"}
                          </SelectItem>
                        ))}
                        <SelectItem value="fixed:">Fixed number (same for all tasks)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {(settings.recipientField.startsWith("fixed:") || phoneFields.length === 0) && (
                    <Input
                      placeholder="27831234567 (E.164 without +)"
                      value={settings.recipientField.startsWith("fixed:") ? settings.recipientField.slice(6) : ""}
                      onChange={(e) => update({ recipientField: `fixed:${e.target.value.replace(/\D/g, "")}` })}
                      autoComplete="tel"
                    />
                  )}
                  {phoneFields.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      ⚠️ No phone fields found. Create a custom field named "Customer Phone", "Contact", or "Mobile" in your list settings, 
                      then it will appear here for selection.
                    </p>
                  )}
                </div>

                {/* ── CC / Business Number ────────────────────────────── */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">CC / Business Confirmation Number</Label>
                  <p className="text-xs text-muted-foreground">
                    Your business WhatsApp number. Receives a copy of every booking notification so you can confirm the client got it.
                  </p>
                  <Input
                    placeholder="27831234567 (E.164 without +)"
                    value={settings.ccNumber ?? ""}
                    onChange={(e) => update({ ccNumber: e.target.value.replace(/\D/g, "") })}
                    autoComplete="tel"
                  />
                </div>

                <Separator />

                {/* ── Second Message ──────────────────────────────────── */}
                <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Second Message</Label>
                    <p className="text-xs text-muted-foreground">
                      Send a second template simultaneously when a task is created.
                    </p>
                  </div>
                  <Switch
                    checked={!!settings.secondMessage?.enabled}
                    onCheckedChange={(v) =>
                      updateSecond({ enabled: v })
                    }
                  />
                </div>

                {settings.secondMessage?.enabled && (
                  <div className="space-y-4 pl-3 border-l-2 border-primary/20 ml-1">
                    {/* Template select */}
                    <div className="space-y-1.5">
                      <Label>Template</Label>
                      {fetchedOk && templates.length > 0 ? (
                        <Select
                          value={settings.secondMessage.templateName}
                          onValueChange={handleSecondTemplateSelect}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a template…" />
                          </SelectTrigger>
                          <SelectContent>
                            {templates.map((t) => (
                              <SelectItem key={t.name} value={t.name}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          placeholder="e.g. my_second_template"
                          value={settings.secondMessage.templateName}
                          onChange={(e) => {
                            // Auto-detect variables when template name is manually typed
                            const templateName = e.target.value;
                            const tpl = templates.find((t) => t.name === templateName);
                            if (tpl) {
                              handleSecondTemplateSelect(templateName);
                            } else {
                              updateSecond({ templateName });
                            }
                          }}
                        />
                      )}
                    </div>

                    {/* Language code */}
                    <div className="space-y-1.5">
                      <Label>Language Code</Label>
                      <Input
                        placeholder="en_US"
                        value={settings.secondMessage.languageCode}
                        onChange={(e) => updateSecond({ languageCode: e.target.value })}
                      />
                    </div>

                    {/* Recipient field */}
                    <div className="space-y-1.5">
                      <Label>Recipient Phone Number</Label>
                      {phoneFields.length > 0 && (
                        <Select
                          value={
                            (settings.secondMessage.recipientField ?? "").startsWith("fixed:") ||
                            !settings.secondMessage.recipientField
                              ? "fixed:"
                              : settings.secondMessage.recipientField
                          }
                          onValueChange={(v) =>
                            updateSecond({ recipientField: v === "fixed:" ? "fixed:" : v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select phone field or fixed number…" />
                          </SelectTrigger>
                          <SelectContent>
                            {phoneFields.map((f) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.name} {f.type === "phone" ? "(Phone field)" : "(Text field)"}
                              </SelectItem>
                            ))}
                            <SelectItem value="fixed:">Fixed number (same for all tasks)</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      {((settings.secondMessage.recipientField ?? "").startsWith("fixed:") ||
                        phoneFields.length === 0) && (
                        <Input
                          placeholder="27831234567 (E.164 without +)"
                          value={
                            (settings.secondMessage.recipientField ?? "").startsWith("fixed:")
                              ? settings.secondMessage.recipientField.slice(6)
                              : ""
                          }
                          onChange={(e) =>
                            updateSecond({ recipientField: `fixed:${e.target.value.replace(/\D/g, "")}` })
                          }
                          autoComplete="tel"
                        />
                      )}
                    </div>

                    {/* Flow template toggle */}
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-sm">Flow Template</Label>
                        <p className="text-xs text-muted-foreground">
                          Enable if this is a WhatsApp Flow template.
                        </p>
                      </div>
                      <Switch
                        checked={!!settings.secondMessage.isFlowTemplate}
                        onCheckedChange={(v) => updateSecond({ isFlowTemplate: v })}
                      />
                    </div>

                    {settings.secondMessage.isFlowTemplate && (
                      <div className="space-y-1.5">
                        <Label>Flow Token</Label>
                        <Input
                          value={settings.secondMessage.flowToken ?? "unused"}
                          onChange={(e) => updateSecond({ flowToken: e.target.value })}
                          placeholder="unused"
                        />
                        <p className="text-xs text-muted-foreground">
                          Leave as <code className="bg-muted px-1 rounded">unused</code> unless your flow requires a specific token.
                        </p>
                      </div>
                    )}

                    {/* Second Message Variables */}
                    <div className="space-y-3 border-t pt-3">
                      <Label className="text-sm font-medium">Variable Mapping</Label>
                      <p className="text-xs text-muted-foreground">
                        Map each template variable (&#123;&#123;1&#125;&#125;, &#123;&#123;2&#125;&#125;…) to a task field for the second message.
                      </p>
                      
                      {/* Second Message Template Preview */}
                      {settings.secondMessage.templateName && (() => {
                        const selectedTemplate = templates.find(t => t.name === settings.secondMessage.templateName);
                        const preview = selectedTemplate ? getBodyPreview(selectedTemplate) : '';
                        const paramCount = selectedTemplate ? countBodyVariables(selectedTemplate) : 0;
                        
                        return preview ? (
                          <div className="rounded-md bg-muted px-3 py-2 text-xs">
                            <div className="text-muted-foreground mb-1">Template Preview ({paramCount} parameters):</div>
                            <div className="whitespace-pre-wrap">{preview}</div>
                          </div>
                        ) : null;
                      })()}
                      
                      {(settings.secondMessage.variables || []).map((v, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                            {`{{${v.variableIndex}}}`}
                          </Badge>
                          <Select
                            value={v.fieldKey}
                            onValueChange={(val) => {
                              const newVars = [...(settings.secondMessage?.variables || [])];
                              newVars[i] = { ...v, fieldKey: val as TaskFieldKey | `custom:${string}` };
                              updateSecond({ variables: newVars });
                            }}
                          >
                            <SelectTrigger className="flex-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {TASK_FIELDS.map(([key, label]) => (
                                <SelectItem key={key} value={key}>{label}</SelectItem>
                              ))}
                              {customFields.length > 0 && (
                                <>
                                  <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Custom Fields</div>
                                  {customFields.map((cf) => (
                                    <SelectItem key={cf.id} value={`custom:${cf.id}`}>{cf.name}</SelectItem>
                                  ))}
                                </>
                              )}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              const newVars = (settings.secondMessage?.variables || []).filter((_, idx) => idx !== i);
                              updateSecond({ variables: newVars });
                            }}
                            disabled={(settings.secondMessage?.variables || []).length <= 1}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      {(settings.secondMessage?.variables || []).length < 10 && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full gap-1.5" 
                          onClick={() => {
                            const currentVars = settings.secondMessage?.variables || [];
                            const nextIndex = Math.max(0, ...currentVars.map(v => v.variableIndex)) + 1;
                            updateSecond({ 
                              variables: [...currentVars, { variableIndex: nextIndex, fieldKey: "title" }] 
                            });
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" /> Add Variable
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* ── Variable Mapping ──────────────────────────── */}
              <TabsContent value="mapping" className="space-y-3 pt-2">
                <p className="text-xs text-muted-foreground">
                  Map each template variable (&#123;&#123;1&#125;&#125;,
                  &#123;&#123;2&#125;&#125;…) to a task field.
                  Variables are auto-detected from the selected template body.
                </p>
                {bodyPreview && (
                  <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">{bodyPreview}</div>
                )}
                {settings.variables.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                      {`{{${v.variableIndex}}}`}
                    </Badge>
                    <Select
                      value={v.fieldKey}
                      onValueChange={(val) => updateVariable(i, { fieldKey: val as TaskFieldKey | `custom:${string}` })}
                    >
                      <SelectTrigger className="flex-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TASK_FIELDS.map(([key, label]) => (
                          <SelectItem key={key} value={key}>{label}</SelectItem>
                        ))}
                        {customFields.length > 0 && (
                          <>
                            <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Custom Fields</div>
                            {customFields.map((cf) => (
                              <SelectItem key={cf.id} value={`custom:${cf.id}`}>{cf.name}</SelectItem>
                            ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeVariable(i)}
                      disabled={settings.variables.length <= 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                {settings.variables.length < 10 && (
                  <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={addVariable}>
                    <Plus className="h-3.5 w-3.5" /> Add Variable
                  </Button>
                )}
              </TabsContent>

              {/* ── Logs ───────────────────────────────── */}
              <TabsContent value="logs" className="pt-2">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-muted-foreground">Last 50 send attempts (newest first)</p>
                  <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={loadLogs} disabled={logsLoading}>
                    <RefreshCw className={`h-3 w-3 ${logsLoading ? "animate-spin" : ""}`} /> Refresh
                  </Button>
                </div>
                {logsLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : logs.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">No logs yet — send a test message to see entries here.</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {logs.map((log) => (
                      <div key={log.id} className={`rounded-lg border p-3 text-xs space-y-1 ${
                        log.status === "sent" ? "border-green-200 bg-green-50 dark:bg-green-950/20" :
                        log.status === "failed" ? "border-red-200 bg-red-50 dark:bg-red-950/20" :
                        "border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20"
                      }`}>
                        <div className="flex items-center justify-between">
                          <span className={`font-semibold ${
                            log.status === "sent" ? "text-green-700 dark:text-green-400" :
                            log.status === "failed" ? "text-red-700 dark:text-red-400" :
                            "text-yellow-700 dark:text-yellow-400"
                          }`}>
                            {log.status === "sent" ? "✅ Sent" : log.status === "failed" ? "❌ Failed" : "⚠️ Skipped"}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</span>
                            {log.status === "failed" && log.id && (
                              <Button 
                                size="sm"
                                variant="outline" 
                                className="h-6 px-2 text-xs"
                                onClick={() => handleResendMessage(log)}
                                disabled={resendingIds.has(log.id!)}
                              >
                                {resendingIds.has(log.id!) ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3 w-3" />
                                )}
                                <span className="ml-1">Resend</span>
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-4 text-muted-foreground">
                          <span>📱 To: <span className="font-mono text-foreground">{log.to || log.toOriginal || "—"}</span></span>
                          <span>📄 Template: <span className="text-foreground">{log.templateName || "—"}</span></span>
                        </div>
                        <div className="text-muted-foreground truncate">💼 Task: {log.taskTitle}</div>
                        {log.error && <div className="text-red-600 dark:text-red-400 break-words">❌ {log.error}</div>}
                        {log.messageId && <div className="text-muted-foreground font-mono">ID: {log.messageId}</div>}
                        {log.parameters.length > 0 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Parameters ({log.parameters.length})</summary>
                            <div className="mt-1 space-y-0.5 pl-3">
                              {log.parameters.map((p, i) => (
                                <div key={i} className="font-mono">{i + 1}. {p.text}</div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save Settings"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
