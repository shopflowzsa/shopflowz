import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Bot, Save, Plus, Trash2, AlertCircle, Settings, X, Volume2 } from "lucide-react";
import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { useVoice } from "@/hooks/useVoice";
import { loadSRSettings, type SRBotSettings } from "@/lib/srAgentService";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface WarningRule {
  id: string;
  workspace_id: string;
  folder_id: string;
  folder_name?: string;
  required_fields: string[];
  warning_message: string;
  enabled: boolean;
}

export interface FolderOption {
  id: string;
  name: string;
}

export interface AIBotWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  folders?: FolderOption[];
  taskId?: string;
  targetFolderId?: string;
  missingFields?: string[];
  onDismiss?: () => void;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const AI_BOT_MESSAGES = [
  "I'm watching your every move... and I noticed something!",
  "O Waaow! im only here a while and im doing your job better than you , you forgot something important!",
  "GIRLY! GIRLY! Something doesn't add up here!",
  "Hmm, I'm learning learning your floors as we go, and I spotted an issue!",
  "My sensors are tingling - something's missing!",
  "Error 404: Required information not found!",
];

const DEFAULT_WARNING_MESSAGE =
  "Please fill in the required fields before moving this task.";

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export function AIBotWarningDialog({
  open,
  onOpenChange,
  workspaceId,
  folders = [],
  taskId,
  targetFolderId,
  missingFields = [],
  onDismiss,
}: AIBotWarningDialogProps) {
  const [view, setView] = useState<"landing" | "settings" | "warning">("landing");
  const [rules, setRules] = useState<WarningRule[]>([]);
  const [editingRule, setEditingRule] = useState<Partial<WarningRule> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [botMessage] = useState(
    () => AI_BOT_MESSAGES[Math.floor(Math.random() * AI_BOT_MESSAGES.length)]
  );
  // Load SR Assistant voice settings from sr_bot_settings so the warning
  // uses the same voice as the chat bot. Falls back to silent if disabled.
  const [srSettings, setSrSettings] = useState<SRBotSettings | null>(null);
  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    (async () => {
      const s = await loadSRSettings(workspaceId);
      if (!cancelled) setSrSettings(s);
    })();
    return () => { cancelled = true; };
  }, [open, workspaceId]);

  const voice = useVoice({
    ttsEnabled: !!srSettings?.tts_enabled,
    sttEnabled: false,
    voiceName: srSettings?.voice_name || null,
    wakeWord: null,
  });
  const isSpeaking = voice.isSpeaking;

  // ── Load rules when dialog opens ──
  useEffect(() => {
    if (open && workspaceId) {
      loadRules();
    }
  }, [open, workspaceId]);

  // ── Determine which view to show when dialog opens ──
  useEffect(() => {
    if (open) {
      if (targetFolderId && missingFields.length > 0) {
        setView("warning");
      } else {
        setView("landing");
      }
      setEditingRule(null);
    }
  }, [open, targetFolderId, missingFields]);

  // ── Speak the warning aloud when the warning view appears (if TTS on) ──
  useEffect(() => {
    if (!open || view !== "warning" || !srSettings?.tts_enabled) return;
    if (!missingFields.length) return;
    const fieldList = missingFields.join(", ");
    const phrase = `Hold up. You're moving this task but ${missingFields.length === 1 ? "this field is" : "these fields are"} missing: ${fieldList}. Please fill them in first.`;
    voice.speak(phrase);
    return () => voice.stopSpeaking();
  }, [open, view, missingFields, srSettings?.tts_enabled, voice]);

  // Always stop speech when the dialog closes
  useEffect(() => {
    if (!open) voice.stopSpeaking();
  }, [open, voice]);

  // ── Load rules from Supabase ──
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

  // ── Save rule (create or update) ──
  const saveRule = async () => {
    if (!editingRule?.folder_id || !editingRule?.required_fields?.length) {
      return;
    }

    setIsLoading(true);
    try {
      const ruleToSave = {
        workspace_id: workspaceId,
        folder_id: editingRule.folder_id,
        folder_name: folders.find((f) => f.id === editingRule.folder_id)?.name || editingRule.folder_id,
        required_fields: editingRule.required_fields,
        warning_message: editingRule.warning_message?.trim() || DEFAULT_WARNING_MESSAGE,
        enabled: editingRule.enabled ?? true,
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

  // ── Delete rule ──
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

  // ── Toggle rule enabled/disabled ──
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

  // ── Find matching rule for target folder ──
  const matchingRule = rules.find(
    (r) => r.folder_id === targetFolderId && r.enabled
  );
  const shouldShowWarning = !!matchingRule && missingFields.length > 0;

  // ── Determine which view to render ──
  const renderContent = () => {
    // Warning view (task move blocked)
    if (view === "warning" && shouldShowWarning && matchingRule) {
      return (
        <>
          {/* Two column layout: Big SR Assistant on left, content on right */}
          <div className="flex gap-6 py-4">
            {/* SR Assistant column */}
            <div className="flex flex-col items-center space-y-3 min-w-[200px]">
              <div className="relative">
                <div
                  className={`absolute inset-0 rounded-full bg-cyan-300/40 blur-2xl transition-opacity duration-500 ${
                    isSpeaking ? "opacity-100 animate-pulse" : "opacity-40"
                  }`}
                  aria-hidden
                />
                <div
                  className={`relative h-44 w-44 rounded-full overflow-hidden bg-white ring-4 ring-cyan-400/60 shadow-2xl ${
                    isSpeaking ? "animate-[pulse_1.4s_ease-in-out_infinite]" : ""
                  }`}
                >
                  <img
                    src="/sr-bot.jpg"
                    alt=""
                    aria-hidden
                    className="h-full w-full object-contain select-none pointer-events-none"
                    draggable={false}
                  />
                </div>
              </div>

              <div className="text-center">
                <h2 className="text-xl font-bold bg-gradient-to-r from-cyan-600 to-emerald-600 bg-clip-text text-transparent">
                  SR Assistant
                </h2>
                <p className="text-xs text-gray-500 italic mt-1 max-w-[180px]">
                  {botMessage}
                </p>
              </div>

              {isSpeaking && (
                <div className="flex items-end justify-center gap-0.5 h-6" aria-hidden>
                  <div className="w-1 bg-gradient-to-t from-cyan-500 to-cyan-300 rounded-full animate-audio-bar" style={{ height: "8px", animationDelay: "0ms" }} />
                  <div className="w-1 bg-gradient-to-t from-cyan-500 to-cyan-300 rounded-full animate-audio-bar" style={{ height: "16px", animationDelay: "100ms" }} />
                  <div className="w-1 bg-gradient-to-t from-cyan-500 to-cyan-300 rounded-full animate-audio-bar" style={{ height: "12px", animationDelay: "200ms" }} />
                  <div className="w-1 bg-gradient-to-t from-cyan-500 to-cyan-300 rounded-full animate-audio-bar" style={{ height: "20px", animationDelay: "300ms" }} />
                  <div className="w-1 bg-gradient-to-t from-cyan-500 to-cyan-300 rounded-full animate-audio-bar" style={{ height: "14px", animationDelay: "400ms" }} />
                </div>
              )}
            </div>

            {/* Content Column */}
            <div className="flex-1 space-y-4">
              {/* Warning Content */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-800">
                      Warning: Missing Information!
                    </p>
                    <p className="text-sm text-amber-700 mt-1">
                      You're moving a task to{" "}
                      <strong>"{matchingRule.folder_name || "this folder"}"</strong>{" "}
                      but the following fields are not filled in:
                    </p>
                    <ul className="text-sm text-amber-700 mt-2 space-y-1">
                      {missingFields.map((field) => (
                        <li key={field} className="flex items-center gap-2">
                          <AlertCircle className="h-3 w-3" />
                          <span className="font-mono bg-amber-100 px-2 py-0.5 rounded">
                            {field}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Custom Message from Rule */}
              {matchingRule.warning_message && (
                <p className="text-sm text-gray-600 italic border-l-4 border-purple-300 pl-3">
                  "{matchingRule.warning_message}"
                </p>
              )}

              {/* AI Bot Learning Message */}
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <p className="text-sm text-purple-700">
                  <span className="font-semibold">Remember:</span> I'm always watching
                  and learning as we go. Filling in these fields helps keep our system
                  accurate and helps me give you better insights!
                </p>
              </div>

              {/* Actions - No way to proceed, must fill fields */}
              <div className="flex justify-center pt-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Go Back & Fill Fields
                </Button>
              </div>
            </div>
          </div>
          
          <style>{`
            @keyframes float {
              0%, 100% { transform: translateY(0px); }
              50% { transform: translateY(-4px); }
            }
            @keyframes headBob {
              0%, 100% { transform: translateX(-50%) translateY(0) rotate(0deg); }
              25% { transform: translateX(-50%) translateY(-2px) rotate(-1deg); }
              75% { transform: translateX(-50%) translateY(-2px) rotate(1deg); }
            }
            @keyframes idleBounce {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-2px); }
            }
            @keyframes blink {
              0%, 90%, 100% { transform: scaleY(1); }
              95% { transform: scaleY(0.1); }
            }
            @keyframes eyelid {
              0%, 90%, 100% { transform: scaleY(0); opacity: 0; }
              92% { transform: scaleY(1); opacity: 1; }
            }
            @keyframes eye-shine {
              0%, 100% { transform: translate(0, 0); }
              50% { transform: translate(0.5px, 0.5px); }
            }
            @keyframes mouth {
              0%, 100% { transform: scaleY(1) scaleX(1); }
              25% { transform: scaleY(1.2) scaleX(0.95); }
              50% { transform: scaleY(1.1) scaleX(1.05); }
              75% { transform: scaleY(1.15) scaleX(0.98); }
            }
            @keyframes mouth-open {
              0%, 100% { transform: scaleY(1); }
              50% { transform: scaleY(1.2); }
            }
            @keyframes tieSwing {
              0%, 100% { transform: translateX(-50%) rotate(-2deg); }
              50% { transform: translateX(-50%) rotate(2deg); }
            }
            @keyframes sound-wave {
              0%, 100% { transform: scaleY(0.5); opacity: 0.5; }
              50% { transform: scaleY(1.2); opacity: 1; }
            }
            @keyframes audio-bar {
              0%, 100% { transform: scaleY(0.3); }
              50% { transform: scaleY(1); }
            }
            @keyframes bodyBounce {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-3px); }
            }
            @keyframes pulse-slow {
              0%, 100% { opacity: 0.3; transform: translateX(-50%) scale(1); }
              50% { opacity: 0.6; transform: translateX(-50%) scale(1.05); }
            }
            .animate-blink {
              animation: blink 4s infinite;
            }
            .animate-eyelid {
              animation: eyelid 4s infinite;
            }
            .animate-eye-shine {
              animation: eye-shine 2s infinite;
            }
            .animate-mouth {
              animation: mouth 0.3s infinite;
            }
            .animate-mouth-open {
              animation: mouth-open 0.4s infinite;
            }
            .animate-sound-wave {
              animation: sound-wave 0.5s infinite;
            }
            .animate-audio-bar {
              animation: audio-bar 0.4s ease-in-out infinite;
            }
            .animate-pulse-slow {
              animation: pulse-slow 2s ease-in-out infinite;
            }
            .bg-gradient-radial {
              background: radial-gradient(circle, var(--tw-gradient-stops));
            }
          }
          .animate-sound-wave {
            animation: sound-wave 0.5s infinite;
          }
          @keyframes bodyBounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
          }
        `}</style>
        </>
      );
    }

    // Settings view
    if (view === "settings") {
      return (
        <div className="space-y-4">
          {/* How it works */}
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <h3 className="font-semibold text-purple-800 mb-2">How it works:</h3>
            <ul className="text-sm text-purple-700 space-y-1">
              <li>• Set rules for specific folders</li>
              <li>• Define required fields for each folder</li>
              <li>
                • When a task is moved without those fields, an AI Bot will warn
                the user
              </li>
              <li>• The bot has a personality and learns as it goes!</li>
            </ul>
          </div>

          {/* Rules List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Warning Rules</h3>
              <Button
                size="sm"
                onClick={() =>
                  setEditingRule({ required_fields: [], enabled: true })
                }
              >
                <Plus className="h-4 w-4 mr-1" /> Add Rule
              </Button>
            </div>

            {isLoading && rules.length === 0 ? (
              <p className="text-gray-500 text-sm">Loading rules...</p>
            ) : rules.length === 0 && !editingRule ? (
              <p className="text-gray-500 text-sm">
                No rules configured yet. Add a rule to get started!
              </p>
            ) : (
              rules.map((rule) => (
                <div
                  key={rule.id}
                  className="border rounded-lg p-3 flex items-center justify-between"
                >
                  <div className="flex-1">
                    <p className="font-medium">
                      {rule.folder_name || rule.folder_id}
                    </p>
                    <p className="text-sm text-gray-500">
                      Required: {rule.required_fields.join(", ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={rule.enabled ? "default" : "outline"}
                      onClick={() => toggleRule(rule.id, !rule.enabled)}
                    >
                      {rule.enabled ? "ON" : "OFF"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingRule(rule)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteRule(rule.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Edit / New Rule Form */}
          {editingRule !== null && (
            <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">
                  {editingRule.id ? "Edit Rule" : "New Rule"}
                </h4>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingRule(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Folder Selection */}
              <div className="space-y-2">
                <Label>Folder</Label>
                {folders.length > 0 ? (
                  <Select
                    value={editingRule.folder_id || ""}
                    onValueChange={(value) => {
                      const folder = folders.find((f) => f.id === value);
                      setEditingRule({
                        ...editingRule,
                        folder_id: value,
                        folder_name: folder?.name || value,
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a folder" />
                    </SelectTrigger>
                    <SelectContent>
                      {folders.map((folder) => (
                        <SelectItem key={folder.id} value={folder.id}>
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
                  />
                )}
              </div>

              {/* Required Fields */}
              <div className="space-y-2">
                <Label>Required Fields (comma-separated)</Label>
                <Input
                  value={editingRule.required_fields?.join(", ") || ""}
                  onChange={(e) =>
                    setEditingRule({
                      ...editingRule,
                      required_fields: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="e.g. date_completed, technician_notes"
                />
              </div>

              {/* Warning Message */}
              <div className="space-y-2">
                <Label>Warning Message</Label>
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
                />
              </div>

              {/* Save / Cancel */}
              <div className="flex gap-2">
                <Button onClick={saveRule} disabled={isLoading}>
                  <Save className="h-4 w-4 mr-1" /> Save Rule
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditingRule(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Close */}
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setView("landing")}>
              Close Settings
            </Button>
          </div>
        </div>
      );
    }

    // Landing view (default)
    return (
      <div className="space-y-4">
        <p className="text-gray-600 py-2">
          Configure AI Bot warning rules for task validation. Set up rules to warn
          users when they move tasks without filling in required fields.
        </p>
        <Button
          onClick={() => {
            console.log("Configure button clicked, switching to settings");
            setView("settings");
          }}
          className="w-full"
        >
          <Settings className="h-4 w-4 mr-2" /> Configure Warning Rules
        </Button>
      </div>
    );
  };

  // ── Determine dialog size based on view ──
  const dialogSize = view === "settings"
    ? "max-w-2xl max-h-[90vh] overflow-y-auto"
    : view === "warning"
      ? "max-w-2xl"
      : "max-w-md";

  // ── Single Dialog render ──
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSize}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-cyan-500" />
            {view === "warning" ? "SR Assistant says:" :
             view === "settings" ? "AI Bot Warning Settings" : "AI Bot Warnings"}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {view === "warning"
            ? "Warning: Missing task information"
            : view === "settings"
            ? "Configure AI Bot warning rules for task validation"
            : "Manage AI Bot warning rules for your workspace"}
        </DialogDescription>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────
// Hook: useAIBotWarning
// ─────────────────────────────────────────────

export interface WarningCheckResult {
  shouldWarn: boolean;
  missingFields: string[];
  matchingRule: WarningRule | null;
}

export function useAIBotWarning(workspaceId: string) {
  const [warningData, setWarningData] = useState<{
    taskId: string;
    targetFolderId: string;
    missingFields: string[];
    matchingRule: WarningRule | null;
  } | null>(null);

  /**
   * Check if a task move should trigger a warning.
   * Call this before moving a task to a new folder.
   *
   * @param taskId - The ID of the task being moved
   * @param targetFolderId - The folder ID the task is being moved to
   * @param taskData - The task's current field values
   * @returns true if warning should be shown, false otherwise
   */
  const checkTaskWarning = useCallback(
    async (
      taskId: string,
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
        const missingFields = requiredFields.filter(
          (field) =>
            taskData[field] === undefined ||
            taskData[field] === null ||
            taskData[field] === ""
        );

        if (missingFields.length > 0) {
          const ruleWithName: WarningRule = {
            ...rules,
            folder_name:
              rules.folder_name ||
              (rules as Record<string, unknown>).folder_id as string,
          };
          setWarningData({ taskId, targetFolderId, missingFields, matchingRule: ruleWithName });
          return {
            shouldWarn: true,
            missingFields,
            matchingRule: ruleWithName,
          };
        }

        return { shouldWarn: false, missingFields: [], matchingRule: null };
      } catch (err) {
        console.error("Error checking task warning:", err);
        return { shouldWarn: false, missingFields: [], matchingRule: null };
      }
    },
    [workspaceId]
  );

  /**
   * Clear the current warning data.
   */
  function clearWarning() {
    setWarningData(null);
  }

  return { warningData, checkTaskWarning, clearWarning };
}