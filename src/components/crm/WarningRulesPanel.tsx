import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Bot, Save, Plus, Trash2, AlertCircle, X, Settings, ShieldAlert, Volume2 } from "lucide-react";
import { supabase, supabaseServiceRole } from "@/lib/supabase";
import type { WorkspaceMember } from "@/types/auth";
import { DEFAULT_STATUSES } from "@/types/crm";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type WarningRuleType = "missing_fields" | "block_new_in_stale_list" | "stale_task" | "list_age_lockout" | "invoice_collected";

export type StaleCheckTrigger = "on_load" | "on_open" | "daily_08";

export interface WarningRule {
  id: string;
  workspace_id: string;
  folder_id: string;
  folder_name?: string;
  required_fields: string[];
  warning_message: string;
  enabled: boolean;
  // ── New (stale-task family) ────────────────────────────────────────────
  rule_type?: WarningRuleType;
  stale_threshold_days?: number | null;
  stale_check_trigger?: StaleCheckTrigger | null;
  stale_reasons?: string[];
  list_id?: string | null;
  // ── Staff targeting — empty = applies to everyone ─────────────────────
  apply_to_uids?: string[] | null;
  // ── Statuses to skip — tasks with these statuses are ignored ──────────
  exclude_statuses?: string[] | null;
}

export interface FolderOption {
  id: string;
  name: string;
}

export interface ListOption {
  id: string;
  name: string;
  parentId: string; // folder id this list lives under
  customStatuses?: { id: string; label: string; color: string }[];
}

export interface WarningRulesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  folders?: FolderOption[];
  lists?: ListOption[];
  customFields?: { id: string; name: string; type?: string }[];
  members?: WorkspaceMember[];
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const BOT_NAMES = [
  "WatchBot",
  "Guardian", 
  "Overseer",
  "SafetyBot",
  "Inspector",
];

const BOT_MESSAGES = [
  "I'm watching your every move... and I noticed something!",
  "Beep boop! Human, you forgot something important!",
  "Alert! Something doesn't add up here!",
  "My sensors are tingling - something's missing!",
];

const DEFAULT_WARNING_MESSAGE =
  "Please fill in the required fields before moving this task.";

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export function WarningRulesPanel({
  open,
  onOpenChange,
  workspaceId,
  folders = [],
  lists = [],
  customFields = [],
  members = [],
}: WarningRulesPanelProps) {
  const [rules, setRules] = useState<WarningRule[]>([]);
  const [editingRule, setEditingRule] = useState<Partial<WarningRule> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState(() => {
    const saved = localStorage.getItem('taskguard_voice_settings');
    if (saved) return JSON.parse(saved);
    return {
      enabled: true,
      rate: 0.9,
      pitch: 1.0,
      voiceName: '',
    };
  });
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [botName] = useState(() => BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]);
  const [botMessage] = useState(() => BOT_MESSAGES[Math.floor(Math.random() * BOT_MESSAGES.length)]);

  // Load available voices (no-op on platforms that lack speechSynthesis, e.g. Android WebView)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    const loadVoices = () => {
      setAvailableVoices(synth.getVoices());
    };
    loadVoices();
    synth.onvoiceschanged = loadVoices;
    return () => { synth.onvoiceschanged = null; };
  }, []);

  // Save voice settings to localStorage when changed
  useEffect(() => {
    localStorage.setItem('taskguard_voice_settings', JSON.stringify(voiceSettings));
  }, [voiceSettings]);

  // Load rules when panel opens
  useEffect(() => {
    if (open && workspaceId) {
      loadRules();
    }
  }, [open, workspaceId]);

  // Load rules from Supabase
  const loadRules = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("warning_rules")
        .select("*")
        .eq("workspace_id", workspaceId);

      if (error) throw error;
      setRules(data || []);
    } catch (err) {
      console.error("Failed to load warning rules:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Save rule (create or update)
  const saveRule = async () => {
    if (!editingRule?.folder_id) return;
    const type = editingRule.rule_type || "missing_fields";

    // Per-type validation
    if (type === "missing_fields" && !editingRule.required_fields?.length) return;
    if ((type === "block_new_in_stale_list" || type === "stale_task" || type === "list_age_lockout") &&
        (!editingRule.stale_threshold_days || editingRule.stale_threshold_days <= 0)) return;
    // invoice_collected needs only a folder (already checked above)

    setIsLoading(true);
    try {
      const ruleToSave: Record<string, unknown> = {
        workspace_id: workspaceId,
        folder_id: editingRule.folder_id,
        folder_name: folders.find((f) => f.id === editingRule.folder_id)?.name || editingRule.folder_id,
        rule_type: type,
        required_fields: editingRule.required_fields ?? [],
        warning_message: editingRule.warning_message?.trim() || DEFAULT_WARNING_MESSAGE,
        enabled: editingRule.enabled ?? true,
        list_id: editingRule.list_id ?? null,
        stale_threshold_days: editingRule.stale_threshold_days ?? null,
        stale_check_trigger: editingRule.stale_check_trigger ?? null,
        stale_reasons: editingRule.stale_reasons ?? [],
        apply_to_uids: editingRule.apply_to_uids ?? [],
        exclude_statuses: editingRule.exclude_statuses ?? [],
      };

      if (editingRule.id) {
        await supabaseServiceRole
          .from("warning_rules")
          .update(ruleToSave)
          .eq("id", editingRule.id);
      } else {
        await supabaseServiceRole.from("warning_rules").insert(ruleToSave);
      }

      setEditingRule(null);
      await loadRules();
    } catch (err) {
      console.error("Failed to save rule:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Delete rule
  const deleteRule = async (id: string) => {
    setIsLoading(true);
    try {
      await supabaseServiceRole.from("warning_rules").delete().eq("id", id);
      await loadRules();
    } catch (err) {
      console.error("Failed to delete rule:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle rule enabled/disabled
  const toggleRule = async (id: string, enabled: boolean) => {
    setIsLoading(true);
    try {
      await supabaseServiceRole
        .from("warning_rules")
        .update({ enabled })
        .eq("id", id);
      await loadRules();
    } catch (err) {
      console.error("Failed to toggle rule:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto bg-background text-foreground border-l-slate-700">
        <SheetHeader className="pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <ShieldAlert className="h-5 w-5 text-white" />
            </div>
            <div>
              <SheetTitle className="text-foreground flex items-center gap-2">
                <Bot className="h-5 w-5 text-purple-400" />
                Task Guard Rules
              </SheetTitle>
              <SheetDescription className="text-muted-foreground">
                Set rules to warn when tasks are moved without required fields
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* How it works */}
          <div className="bg-purple-900/30 border border-purple-500/30 rounded-lg p-4">
            <h3 className="font-semibold text-purple-300 mb-2 flex items-center gap-2">
              <Bot className="h-4 w-4" />
              {botName} says:
            </h3>
            <p className="text-sm text-purple-200/80 italic">{botMessage}</p>
            <ul className="mt-3 text-sm text-purple-200/70 space-y-1">
              <li>• Set rules for specific folders</li>
              <li>• Define required fields for each folder</li>
              <li>• Get warned when tasks are moved without those fields</li>
            </ul>
          </div>

          {/* Voice Settings Toggle */}
          <div className="flex items-center justify-between bg-card/50 border border-border rounded-lg p-3">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-purple-400" />
              <span className="text-sm text-foreground">Voice Settings</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowVoiceSettings(!showVoiceSettings)}
              className="border-border text-foreground/80 hover:bg-muted"
            >
              {showVoiceSettings ? "Hide" : "Configure"}
            </Button>
          </div>

          {/* Voice Settings Panel */}
          {showVoiceSettings && (
            <div className="bg-card/30 border border-border rounded-lg p-4 space-y-4">
              <h4 className="font-semibold text-foreground flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-purple-400" />
                Voice Configuration
              </h4>
              
              {/* Enable/Disable Auto-play */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground/80">Auto-play voice on warning</span>
                <button
                  onClick={() => setVoiceSettings({ ...voiceSettings, enabled: !voiceSettings.enabled })}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    voiceSettings.enabled ? "bg-purple-600" : "bg-slate-600"
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    voiceSettings.enabled ? "translate-x-6" : "translate-x-0.5"
                  }`} />
                </button>
              </div>

              {/* Voice Selection */}
              <div className="space-y-2">
                <label className="text-sm text-foreground/80">Voice</label>
                <select
                  value={voiceSettings.voiceName}
                  onChange={(e) => setVoiceSettings({ ...voiceSettings, voiceName: e.target.value })}
                  className="w-full bg-slate-700 border border-border rounded-lg px-3 py-2 text-foreground text-sm"
                >
                  <option value="">Default Voice</option>
                  {availableVoices.map((voice) => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name} ({voice.lang})
                    </option>
                  ))}
                </select>
              </div>

              {/* Rate Slider */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/80">Speed</span>
                  <span className="text-muted-foreground">{voiceSettings.rate.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  value={voiceSettings.rate}
                  onChange={(e) => setVoiceSettings({ ...voiceSettings, rate: parseFloat(e.target.value) })}
                  className="w-full accent-purple-600"
                />
              </div>

              {/* Pitch Slider */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/80">Pitch</span>
                  <span className="text-muted-foreground">{voiceSettings.pitch.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={voiceSettings.pitch}
                  onChange={(e) => setVoiceSettings({ ...voiceSettings, pitch: parseFloat(e.target.value) })}
                  className="w-full accent-purple-600"
                />
              </div>

              {/* Test Voice Button */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if ('speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance("Hey! You forgot something important!");
                    utterance.rate = voiceSettings.rate;
                    utterance.pitch = voiceSettings.pitch;
                    if (voiceSettings.voiceName) {
                      const selectedVoice = availableVoices.find(v => v.name === voiceSettings.voiceName);
                      if (selectedVoice) utterance.voice = selectedVoice;
                    }
                    window.speechSynthesis.speak(utterance);
                  }
                }}
                className="border-purple-500/50 text-purple-300 hover:bg-purple-900/30"
              >
                <Volume2 className="h-4 w-4 mr-1" /> Test Voice
              </Button>
            </div>
          )}

          {/* Rules List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Warning Rules</h3>
              <Button
                size="sm"
                onClick={() => setEditingRule({ required_fields: [], enabled: true })}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Plus className="h-4 w-4 mr-1" /> New Rule
              </Button>
            </div>

            {isLoading && rules.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <div className="animate-spin w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2" />
                Loading rules...
              </div>
            ) : rules.length === 0 && !editingRule ? (
              <div className="text-center py-8 border border-dashed border-border rounded-lg">
                <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">No rules yet</p>
                <p className="text-muted-foreground text-xs mt-1">Create your first rule to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className={`border rounded-lg p-3 flex items-center justify-between transition-colors ${
                      rule.enabled 
                        ? "border-border bg-card/50" 
                        : "border-border bg-card/20 opacity-60"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {rule.folder_name || rule.folder_id}
                        {rule.list_id && (() => {
                          const listName = lists.find((l) => l.id === rule.list_id)?.name;
                          return listName ? (
                            <span className="text-muted-foreground font-normal"> › {listName}</span>
                          ) : null;
                        })()}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {(rule.rule_type || "missing_fields") === "missing_fields" && (
                          <>Block move · Required: {rule.required_fields.join(", ")}</>
                        )}
                        {rule.rule_type === "block_new_in_stale_list" && (
                          <>Block new task when a task is {rule.stale_threshold_days}+ days old</>
                        )}
                        {rule.rule_type === "stale_task" && (
                          <>
                            Alert when a task is {rule.stale_threshold_days}+ days old
                            {rule.stale_check_trigger && ` (${rule.stale_check_trigger.replace("_", " ")})`}
                          </>
                        )}
                        {rule.rule_type === "list_age_lockout" && (
                          <>🔒 Lock staff out when a task is {rule.stale_threshold_days}+ days old in this list</>
                        )}
                        {rule.rule_type === "invoice_collected" && (
                          <>🧾 Warn when invoiced unit still in storage</>
                        )}
                        {(rule.rule_type === "stale_task" || rule.rule_type === "invoice_collected") &&
                          rule.apply_to_uids && rule.apply_to_uids.length > 0 && (
                            <> · {rule.apply_to_uids.map(uid => members.find(m => m.uid === uid)?.displayName || members.find(m => m.uid === uid)?.email || uid).join(", ")}</>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleRule(rule.id, !rule.enabled)}
                        className={rule.enabled ? "text-green-400 hover:text-green-300" : "text-muted-foreground"}
                      >
                        {rule.enabled ? "ON" : "OFF"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingRule(rule)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteRule(rule.id)}
                        className="text-red-400/70 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Edit / New Rule Form */}
          {editingRule !== null && (
            <div className="border border-purple-500/30 rounded-lg p-4 space-y-4 bg-card/50">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-foreground flex items-center gap-2">
                  <Settings className="h-4 w-4 text-purple-400" />
                  {editingRule.id ? "Edit Rule" : "New Rule"}
                </h4>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingRule(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Rule type */}
              <div className="space-y-2">
                <Label className="text-foreground/80">Rule type</Label>
                <Select
                  value={editingRule.rule_type || "missing_fields"}
                  onValueChange={(value) =>
                    setEditingRule({
                      ...editingRule,
                      rule_type: value as WarningRuleType,
                    })
                  }
                >
                  <SelectTrigger className="bg-slate-700 border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-700 border-border">
                    <SelectItem value="missing_fields" className="text-foreground">
                      Block move — missing fields
                    </SelectItem>
                    <SelectItem value="block_new_in_stale_list" className="text-foreground">
                      Block new task — stale task in list
                    </SelectItem>
                    <SelectItem value="stale_task" className="text-foreground">
                      Alert — stale task in folder
                    </SelectItem>
                    <SelectItem value="list_age_lockout" className="text-foreground">
                      🔒 Lock staff out — task too old in list
                    </SelectItem>
                    <SelectItem value="invoice_collected" className="text-foreground">
                      🧾 Invoice collected — unit still in storage
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {editingRule.rule_type === "block_new_in_stale_list" &&
                    "Prevents creating a new task while an existing task in the same list has gone stale."}
                  {editingRule.rule_type === "stale_task" &&
                    "Warns reception when a task has been sitting too long, and requires a reason."}
                  {editingRule.rule_type === "list_age_lockout" &&
                    "Locks the assigned staff member out of all other tasks until they clear the overdue task in this list. Works like the task limit lockout."}
                  {editingRule.rule_type === "invoice_collected" &&
                    "Warns staff when a task has an invoice but the job is still sitting in this folder/list — the customer was already invoiced and may have collected."}
                  {(!editingRule.rule_type || editingRule.rule_type === "missing_fields") &&
                    "Original rule: warns when a task is moved without required fields filled in."}
                </p>
              </div>

              {/* Folder Selection */}
              <div className="space-y-2">
                <Label className="text-foreground/80">Folder</Label>
                {folders.length > 0 ? (
                  <Select
                    value={editingRule.folder_id || ""}
                    onValueChange={(value) => {
                      const folder = folders.find((f) => f.id === value);
                      setEditingRule({
                        ...editingRule,
                        folder_id: value,
                        folder_name: folder?.name || value,
                        // Changing folder invalidates any previously picked list.
                        list_id: null,
                      });
                    }}
                  >
                    <SelectTrigger className="bg-slate-700 border-border text-foreground">
                      <SelectValue placeholder="Select a folder" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-700 border-border">
                      {folders.map((folder) => (
                        <SelectItem key={folder.id} value={folder.id} className="text-foreground">
                          {folder.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={editingRule.folder_id || ""}
                    onChange={(e) =>
                      setEditingRule({
                        ...editingRule,
                        folder_id: e.target.value,
                      })
                    }
                    placeholder="Enter folder ID"
                    className="bg-slate-700 border-border text-foreground"
                  />
                )}
              </div>

              {/* List Selection — only for stale-task and invoice-collected rules. Leaving blank
                  scopes the rule to the whole folder. */}
              {(editingRule.rule_type === "block_new_in_stale_list" ||
                editingRule.rule_type === "stale_task" ||
                editingRule.rule_type === "list_age_lockout" ||
                editingRule.rule_type === "invoice_collected") && (
                <div className="space-y-2">
                  <Label className="text-foreground/80">List (optional)</Label>
                  {(() => {
                    const folderLists = lists.filter((l) => l.parentId === editingRule.folder_id);
                    const ALL = "__all__";
                    return (
                      <Select
                        value={editingRule.list_id || ALL}
                        onValueChange={(value) =>
                          setEditingRule({
                            ...editingRule,
                            list_id: value === ALL ? null : value,
                          })
                        }
                        disabled={!editingRule.folder_id || folderLists.length === 0}
                      >
                        <SelectTrigger className="bg-slate-700 border-border text-foreground">
                          <SelectValue placeholder={
                            !editingRule.folder_id
                              ? "Pick a folder first"
                              : folderLists.length === 0
                                ? "No lists in this folder"
                                : "Any list in this folder"
                          } />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-700 border-border">
                          <SelectItem value={ALL} className="text-foreground">
                            Any list in this folder
                          </SelectItem>
                          {folderLists.map((list) => (
                            <SelectItem key={list.id} value={list.id} className="text-foreground">
                              {list.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );
                  })()}
                  <p className="text-xs text-muted-foreground">
                    Pick a specific list to limit the rule. Leave as "Any list in this folder" to apply it across every list in the folder.
                  </p>
                </div>
              )}

              {/* Staff targeting — who should see this warning (all rule types) */}
              {members.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-foreground/80">Send warning to</Label>
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => {
                      const selected = (editingRule.apply_to_uids ?? []).includes(m.uid);
                      return (
                        <button
                          key={m.uid}
                          type="button"
                          onClick={() => {
                            const current = editingRule.apply_to_uids ?? [];
                            setEditingRule({
                              ...editingRule,
                              apply_to_uids: selected
                                ? current.filter((uid) => uid !== m.uid)
                                : [...current, m.uid],
                            });
                          }}
                          className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                            selected
                              ? "bg-purple-600 border-purple-500 text-white"
                              : "bg-slate-700 border-border text-foreground/70 hover:border-purple-400"
                          }`}
                        >
                          {m.displayName || m.email}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {(editingRule.apply_to_uids ?? []).length === 0
                      ? "No staff selected — warning will show to everyone."
                      : `Only the selected ${(editingRule.apply_to_uids ?? []).length} staff member(s) will see this warning.`}
                  </p>
                </div>
              )}

              {/* Status exclusions — which statuses to skip (all rule types) */}
              {(() => {
                let statusOptions = DEFAULT_STATUSES as { id: string; label: string; color: string }[];
                if (editingRule.list_id) {
                  const picked = lists.find(l => l.id === editingRule.list_id);
                  if (picked?.customStatuses?.length) statusOptions = picked.customStatuses;
                } else if (editingRule.folder_id) {
                  const folderLists = lists.filter(l => l.parentId === editingRule.folder_id);
                  const seen = new Set<string>();
                  const merged: { id: string; label: string; color: string }[] = [];
                  for (const l of folderLists) {
                    for (const s of (l.customStatuses?.length ? l.customStatuses : DEFAULT_STATUSES)) {
                      if (!seen.has(s.id)) { seen.add(s.id); merged.push(s); }
                    }
                  }
                  if (merged.length) statusOptions = merged;
                }
                return (
                  <div className="space-y-2">
                    <Label className="text-foreground/80">Ignore jobs with these statuses</Label>
                    <div className="flex flex-wrap gap-2">
                      {statusOptions.map((s) => {
                        const excluded = (editingRule.exclude_statuses ?? []).includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              const current = editingRule.exclude_statuses ?? [];
                              setEditingRule({
                                ...editingRule,
                                exclude_statuses: excluded
                                  ? current.filter((id) => id !== s.id)
                                  : [...current, s.id],
                              });
                            }}
                            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                              excluded
                                ? "bg-emerald-700 border-emerald-500 text-white"
                                : "bg-slate-700 border-border text-foreground/70 hover:border-emerald-400"
                            }`}
                          >
                            {excluded ? "✓ " : ""}{s.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {(editingRule.exclude_statuses ?? []).length === 0
                        ? "No statuses excluded — rule checks all jobs regardless of status."
                        : `Jobs marked as ${(editingRule.exclude_statuses ?? []).map(id => statusOptions.find(s => s.id === id)?.label || id).join(", ")} will be skipped.`}
                    </p>
                  </div>
                );
              })()}

              {/* Stale-task fields (only for stale rule types) */}
              {(editingRule.rule_type === "block_new_in_stale_list" ||
                editingRule.rule_type === "stale_task" ||
                editingRule.rule_type === "list_age_lockout") && (
                <>
                  <div className="space-y-2">
                    <Label className="text-foreground/80">Threshold (days)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={editingRule.stale_threshold_days ?? ""}
                      onChange={(e) =>
                        setEditingRule({
                          ...editingRule,
                          stale_threshold_days: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      placeholder="2"
                      className="bg-slate-700 border-border text-foreground"
                    />
                    <p className="text-xs text-muted-foreground">
                      A task is considered stale once it has been sitting this many days.
                    </p>
                  </div>

                  {editingRule.rule_type === "stale_task" && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-foreground/80">When to check</Label>
                        <Select
                          value={editingRule.stale_check_trigger || "on_load"}
                          onValueChange={(value) =>
                            setEditingRule({
                              ...editingRule,
                              stale_check_trigger: value as StaleCheckTrigger,
                            })
                          }
                        >
                          <SelectTrigger className="bg-slate-700 border-border text-foreground">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-700 border-border">
                            <SelectItem value="on_load" className="text-foreground">
                              When the app loads (once per session)
                            </SelectItem>
                            <SelectItem value="on_open" className="text-foreground">
                              When the stale task is opened
                            </SelectItem>
                            <SelectItem value="daily_08" className="text-foreground">
                              Daily morning sweep (8 am)
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-foreground/80">Pre-set reasons (comma-separated)</Label>
                        <Input
                          value={(editingRule.stale_reasons || []).join(", ")}
                          onChange={(e) =>
                            setEditingRule({
                              ...editingRule,
                              stale_reasons: e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="Awaiting customer, Parts on order, Technician absent"
                          className="bg-slate-700 border-border text-foreground"
                        />
                        <p className="text-xs text-muted-foreground">
                          Reception picks one of these (or types a free-form reason) when explaining a stale task.
                        </p>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Required Fields - only for the legacy missing_fields rule type */}
              {(!editingRule.rule_type || editingRule.rule_type === "missing_fields") && (
              <div className="space-y-3">
                <Label className="text-foreground/80">Required Fields</Label>
                
                {/* Add new field row */}
                <div className="flex gap-2">
                  <Select
                    value=""
                    onValueChange={(value) => {
                      if (value && !editingRule.required_fields?.includes(value)) {
                        setEditingRule({
                          ...editingRule,
                          required_fields: [...(editingRule.required_fields || []), value],
                        });
                      }
                    }}
                  >
                    <SelectTrigger className="flex-1 bg-slate-700 border-border text-foreground">
                      <SelectValue placeholder="Select a field to add..." />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-700 border-border">
                      {/* Built-in task fields (must match Task interface in types/crm.ts) */}
                      <SelectItem value="title">Title</SelectItem>
                      <SelectItem value="description">Description</SelectItem>
                      <SelectItem value="status">Status</SelectItem>
                      <SelectItem value="priority">Priority</SelectItem>
                      <SelectItem value="technician">Technician</SelectItem>
                      <SelectItem value="assignee">Assignee</SelectItem>
                      <SelectItem value="startDate">Start Date</SelectItem>
                      <SelectItem value="dueDate">Due Date</SelectItem>
                      <SelectItem value="isPaid">Is Paid</SelectItem>
                      <SelectItem value="jobNumber">Job Number</SelectItem>
                      {/* Custom fields from workspace */}
                      {customFields.map((field) => (
                        <SelectItem key={field.id} value={field.name}>
                          {field.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const customField = prompt("Enter custom field name:");
                      if (customField && !editingRule.required_fields?.includes(customField)) {
                        setEditingRule({
                          ...editingRule,
                          required_fields: [...(editingRule.required_fields || []), customField],
                        });
                      }
                    }}
                    className="border-border text-foreground/80 hover:bg-muted"
                  >
                    Custom
                  </Button>
                </div>

                {/* Selected fields list */}
                {editingRule.required_fields && editingRule.required_fields.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Selected fields:</p>
                    <div className="flex flex-wrap gap-2">
                      {editingRule.required_fields.map((field, index) => (
                        <div
                          key={`${field}-${index}`}
                          className="flex items-center gap-1 bg-purple-900/40 border border-purple-500/40 rounded-full px-3 py-1 text-sm text-purple-200"
                        >
                          <span>{field}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingRule({
                                ...editingRule,
                                required_fields: editingRule.required_fields?.filter((_, i) => i !== index),
                              });
                            }}
                            className="ml-1 hover:text-white"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No fields selected yet</p>
                )}
              </div>
              )}

              {/* Warning Message */}
              <div className="space-y-2">
                <Label className="text-foreground/80">Warning Message</Label>
                <Textarea
                  value={editingRule.warning_message || ""}
                  onChange={(e) =>
                    setEditingRule({
                      ...editingRule,
                      warning_message: e.target.value,
                    })
                  }
                  placeholder="Custom warning message..."
                  rows={3}
                  className="bg-slate-700 border-border text-foreground resize-none"
                />
              </div>

              {/* Save / Cancel */}
              <div className="flex gap-2 pt-2">
                <Button 
                  onClick={saveRule} 
                  disabled={
                    isLoading ||
                    !editingRule.folder_id ||
                    ((editingRule.rule_type || "missing_fields") === "missing_fields"
                      ? !editingRule.required_fields?.length
                      : editingRule.rule_type === "invoice_collected"
                        ? false
                        : !editingRule.stale_threshold_days || editingRule.stale_threshold_days <= 0)
                  }
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <Save className="h-4 w-4 mr-1" /> Save Rule
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditingRule(null)}
                  className="border-border text-foreground/80 hover:bg-muted"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Footer info */}
          <div className="pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground text-center">
              Task Guard monitors task moves and warns users when required fields are missing
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────
// Warning Check Hook
// ─────────────────────────────────────────────

export interface WarningCheckResult {
  shouldWarn: boolean;
  missingFields: string[];
  matchingRule: WarningRule | null;
}

export function useWarningCheck(workspaceId: string) {
  const checkWarning = async (
    targetFolderId: string,
    taskData: Record<string, unknown>
  ): Promise<WarningCheckResult> => {
    if (!workspaceId || !targetFolderId) {
      return { shouldWarn: false, missingFields: [], matchingRule: null };
    }

    try {
      const { data: rules, error } = await supabase
        .from("warning_rules")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("folder_id", targetFolderId)
        .eq("enabled", true)
        .maybeSingle();

      if (error || !rules) {
        return { shouldWarn: false, missingFields: [], matchingRule: null };
      }

      const requiredFields: string[] = rules.required_fields || [];

      // Build a case+separator-insensitive lookup over taskData so a rule
      // requiring "Technician" matches a task field called "technician", and
      // "Due Date" matches "dueDate".
      const normalise = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
      const lookup: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(taskData)) {
        lookup[normalise(k)] = v;
      }
      const isEmpty = (v: unknown) =>
        v === undefined || v === null || v === "";

      const missingFields = requiredFields.filter((field) =>
        isEmpty(lookup[normalise(field)]),
      );

      if (missingFields.length > 0) {
        return {
          shouldWarn: true,
          missingFields,
          matchingRule: rules,
        };
      }

      return { shouldWarn: false, missingFields: [], matchingRule: null };
    } catch (err) {
      console.error("Error checking warning:", err);
      return { shouldWarn: false, missingFields: [], matchingRule: null };
    }
  };

  return { checkWarning };
}