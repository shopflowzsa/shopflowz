import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, X, Loader2 } from "lucide-react";
import {
  loadEcommerceBotSettings,
  saveEcommerceBotSettings,
  DEFAULT_BOT_SETTINGS,
  type EcommerceBotSettings,
  type BotQAEntry,
  type BotQuickButton,
} from "@/lib/ecommerceBotService";

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
}

const newId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export function EcommerceBotSettingsDialog({ open, onClose, workspaceId }: Props) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<EcommerceBotSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingQAId, setEditingQAId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const loaded = await loadEcommerceBotSettings(workspaceId);
      if (cancelled) return;
      setSettings(loaded ?? DEFAULT_BOT_SETTINGS);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, workspaceId]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    const ok = await saveEcommerceBotSettings(workspaceId, settings);
    setSaving(false);
    if (ok) {
      toast({ title: "Saved", description: "Ecommerce bot settings updated." });
    } else {
      toast({
        title: "Save failed",
        description: "Check the console for details.",
        variant: "destructive",
      });
    }
  };

  // ── Q&A helpers ──────────────────────────────────────────────────────────
  const updateEntry = (id: string, patch: Partial<BotQAEntry>) => {
    if (!settings) return;
    setSettings({
      ...settings,
      qa_entries: settings.qa_entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  };
  const addEntry = () => {
    if (!settings) return;
    const id = newId("qa");
    setSettings({
      ...settings,
      qa_entries: [
        { id, title: "", questions: [""], answer: "" },
        ...settings.qa_entries,
      ],
    });
    setEditingQAId(id);
  };
  const removeEntry = (id: string) => {
    if (!settings) return;
    setSettings({ ...settings, qa_entries: settings.qa_entries.filter((e) => e.id !== id) });
  };

  // ── Quick buttons helpers ────────────────────────────────────────────────
  const updateButton = (id: string, patch: Partial<BotQuickButton>) => {
    if (!settings) return;
    setSettings({
      ...settings,
      quick_buttons: settings.quick_buttons.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    });
  };
  const addButton = () => {
    if (!settings) return;
    setSettings({
      ...settings,
      quick_buttons: [
        ...settings.quick_buttons,
        { id: newId("qb"), label: "", answer: "" },
      ],
    });
  };
  const removeButton = (id: string) => {
    if (!settings) return;
    setSettings({ ...settings, quick_buttons: settings.quick_buttons.filter((b) => b.id !== id) });
  };


  // ── Stats panel ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!settings) return null;
    const qaSize = JSON.stringify(settings.qa_entries).length;
    const qbSize = JSON.stringify(settings.quick_buttons).length;
    return {
      qaCount: settings.qa_entries.length,
      qbCount: settings.quick_buttons.length,
      sizeKB: ((qaSize + qbSize) / 1024).toFixed(1),
    };
  }, [settings]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="text-lg">Ecommerce Bot — Training</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Train your store's customer-facing chatbot. Q&amp;A entries are matched against customer questions first; if nothing matches, the bot can fall back to AI with knowledge of your in-stock inventory.
          </p>
        </DialogHeader>

        {loading || !settings ? (
          <div className="flex-1 flex items-center justify-center p-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex">
            {/* Main column */}
            <div className="flex-1 overflow-y-auto">
              <Tabs defaultValue="qa" className="w-full">
                <TabsList className="mx-6 mt-4">
                  <TabsTrigger value="qa">Q&amp;A</TabsTrigger>
                  <TabsTrigger value="buttons">Quick buttons</TabsTrigger>
                  <TabsTrigger value="general">General</TabsTrigger>
                  <TabsTrigger value="brain">AI fallback</TabsTrigger>
                </TabsList>

                {/* ── Q&A ───────────────────────────────────────────────── */}
                <TabsContent value="qa" className="px-6 pb-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm">Q&amp;A library</h3>
                      <p className="text-xs text-muted-foreground">
                        Each entry has a title (admin-only), one or more phrasings of the question, and a single answer.
                      </p>
                    </div>
                    <Button size="sm" onClick={addEntry} className="gap-1">
                      <Plus className="h-3.5 w-3.5" /> Add Q&amp;A
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {settings.qa_entries.length === 0 && (
                      <div className="text-sm text-muted-foreground py-8 text-center border-dashed border-2 rounded-md">
                        No Q&amp;A entries yet. Click "Add Q&amp;A" to create one.
                      </div>
                    )}
                    {settings.qa_entries.map((entry) => (
                      <div
                        key={entry.id}
                        className={`rounded-md border p-3 ${editingQAId === entry.id ? "border-cyan-500" : "border-border"}`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Input
                            value={entry.title}
                            onChange={(e) => updateEntry(entry.id, { title: e.target.value })}
                            placeholder="Title (e.g. Refund requests) — admin-only"
                            className="font-medium"
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeEntry(entry.id)}
                            title="Delete entry"
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>

                        <Label className="text-xs text-muted-foreground">Questions (alternative phrasings)</Label>
                        <div className="space-y-1.5 mt-1 mb-3">
                          {entry.questions.map((q, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <Input
                                value={q}
                                onChange={(e) => {
                                  const next = [...entry.questions];
                                  next[idx] = e.target.value;
                                  updateEntry(entry.id, { questions: next });
                                }}
                                placeholder={idx === 0 ? "How do I request a refund?" : "Add another phrasing"}
                                className="text-sm"
                              />
                              {entry.questions.length > 1 && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => updateEntry(entry.id, {
                                    questions: entry.questions.filter((_, i) => i !== idx),
                                  })}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateEntry(entry.id, { questions: [...entry.questions, ""] })}
                            className="h-7 gap-1 text-xs"
                          >
                            <Plus className="h-3 w-3" /> Add question variant
                          </Button>
                        </div>

                        <Label className="text-xs text-muted-foreground">Answer</Label>
                        <Textarea
                          value={entry.answer}
                          onChange={(e) => updateEntry(entry.id, { answer: e.target.value })}
                          placeholder="Enter the answer the bot will give. Plain text — links are auto-detected."
                          className="text-sm mt-1 min-h-[80px]"
                        />
                      </div>
                    ))}
                  </div>
                </TabsContent>

                {/* ── Quick buttons ─────────────────────────────────────── */}
                <TabsContent value="buttons" className="px-6 pb-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm">Quick-reply buttons</h3>
                      <p className="text-xs text-muted-foreground">
                        Buttons shown above the input. Customers click instead of typing for instant answers.
                      </p>
                    </div>
                    <Button size="sm" onClick={addButton} className="gap-1">
                      <Plus className="h-3.5 w-3.5" /> Add button
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {settings.quick_buttons.length === 0 && (
                      <div className="text-sm text-muted-foreground py-8 text-center border-dashed border-2 rounded-md">
                        No quick buttons yet.
                      </div>
                    )}
                    {settings.quick_buttons.map((btn) => (
                      <div key={btn.id} className="rounded-md border p-3 flex items-start gap-2">
                        <div className="flex-1 space-y-2">
                          <Input
                            value={btn.label}
                            onChange={(e) => updateButton(btn.id, { label: e.target.value })}
                            placeholder="Button label (e.g. Opening hours)"
                            className="text-sm"
                          />
                          <Textarea
                            value={btn.answer}
                            onChange={(e) => updateButton(btn.id, { answer: e.target.value })}
                            placeholder="Answer shown when this button is clicked"
                            className="text-sm min-h-[60px]"
                          />
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeButton(btn.id)}
                          title="Delete button"
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                {/* ── General ───────────────────────────────────────────── */}
                <TabsContent value="general" className="px-6 pb-6 space-y-4">
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <h3 className="font-semibold text-sm">Bot enabled</h3>
                      <p className="text-xs text-muted-foreground">When off, the chat bubble is hidden on the public store.</p>
                    </div>
                    <button
                      onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
                      className={`w-12 h-6 rounded-full transition-colors ${settings.enabled ? "bg-cyan-500" : "bg-slate-300"}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full transition-transform ${settings.enabled ? "translate-x-6" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">Bot display name</Label>
                    <Input
                      value={settings.bot_name}
                      onChange={(e) => setSettings({ ...settings, bot_name: e.target.value })}
                      placeholder="Sammy"
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">Welcome message</Label>
                    <Textarea
                      value={settings.welcome_message}
                      onChange={(e) => setSettings({ ...settings, welcome_message: e.target.value })}
                      placeholder="Hi! How can I help?"
                      className="mt-1 min-h-[60px]"
                    />
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">Fallback message (when no Q&amp;A matches and AI is off)</Label>
                    <Textarea
                      value={settings.fallback_message}
                      onChange={(e) => setSettings({ ...settings, fallback_message: e.target.value })}
                      placeholder="I'm not sure — WhatsApp us on..."
                      className="mt-1 min-h-[60px]"
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <h3 className="font-semibold text-sm">Live product search</h3>
                      <p className="text-xs text-muted-foreground">When a customer mentions a part, the bot searches in-stock inventory.</p>
                    </div>
                    <button
                      onClick={() => setSettings({ ...settings, enable_product_search: !settings.enable_product_search })}
                      className={`w-12 h-6 rounded-full transition-colors ${settings.enable_product_search ? "bg-cyan-500" : "bg-slate-300"}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full transition-transform ${settings.enable_product_search ? "translate-x-6" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <h3 className="font-semibold text-sm">Quick-reply buttons</h3>
                      <p className="text-xs text-muted-foreground">Show clickable shortcut buttons under the chat input.</p>
                    </div>
                    <button
                      onClick={() => setSettings({ ...settings, enable_quick_buttons: !settings.enable_quick_buttons })}
                      className={`w-12 h-6 rounded-full transition-colors ${settings.enable_quick_buttons ? "bg-cyan-500" : "bg-slate-300"}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full transition-transform ${settings.enable_quick_buttons ? "translate-x-6" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <h3 className="font-semibold text-sm">Q&amp;A library</h3>
                      <p className="text-xs text-muted-foreground">Match customer questions against your trained Q&amp;A entries.</p>
                    </div>
                    <button
                      onClick={() => setSettings({ ...settings, enable_qa: !settings.enable_qa })}
                      className={`w-12 h-6 rounded-full transition-colors ${settings.enable_qa ? "bg-cyan-500" : "bg-slate-300"}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full transition-transform ${settings.enable_qa ? "translate-x-6" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                </TabsContent>

                {/* ── AI fallback ───────────────────────────────────────── */}
                <TabsContent value="brain" className="px-6 pb-6 space-y-4">
                  <div className="rounded-md bg-cyan-50 border border-cyan-200 p-3 text-xs text-cyan-900">
                    <p className="font-semibold mb-1">How the bot decides what to say</p>
                    <ol className="list-decimal pl-4 space-y-0.5">
                      <li>If the customer clicks a quick button, show the button's answer.</li>
                      <li>If Q&amp;A is on, try matching their question against your trained answers.</li>
                      <li>If Live product search is on, search live inventory (only ever shows parts you actually stock).</li>
                      <li>If AI fallback is on and nothing matches, ask the LLM with your store context.</li>
                      <li>Otherwise, show the fallback message.</li>
                    </ol>
                  </div>

                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <h3 className="font-semibold text-sm">AI fallback</h3>
                      <p className="text-xs text-muted-foreground">Use the staff AI (NVIDIA Llama) when no Q&amp;A matches.</p>
                    </div>
                    <button
                      onClick={() => setSettings({ ...settings, enable_llm_fallback: !settings.enable_llm_fallback })}
                      className={`w-12 h-6 rounded-full transition-colors ${settings.enable_llm_fallback ? "bg-cyan-500" : "bg-slate-300"}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full transition-transform ${settings.enable_llm_fallback ? "translate-x-6" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">Custom store instructions for the AI (optional)</Label>
                    <Textarea
                      value={settings.llm_system_prompt || ""}
                      onChange={(e) => setSettings({ ...settings, llm_system_prompt: e.target.value })}
                      placeholder="E.g. 'Always mention free pickup. Don't quote on items above R10,000 without a human.'"
                      className="mt-1 min-h-[80px]"
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* Right rail — data sources / save */}
            <div className="w-72 shrink-0 border-l bg-muted/30 p-4 flex flex-col gap-3 overflow-y-auto">
              <h3 className="text-sm font-semibold">Bot data</h3>
              <div className="space-y-2 text-sm">
                <div className="rounded-md bg-background border p-2 flex items-center justify-between">
                  <span>Q&amp;A entries</span>
                  <span className="font-semibold">{stats?.qaCount ?? 0}</span>
                </div>
                <div className="rounded-md bg-background border p-2 flex items-center justify-between">
                  <span>Quick buttons</span>
                  <span className="font-semibold">{stats?.qbCount ?? 0}</span>
                </div>
                <div className="rounded-md bg-background border p-2 flex items-center justify-between">
                  <span>Total size</span>
                  <span className="font-semibold">{stats?.sizeKB} KB</span>
                </div>
              </div>
              <div className="mt-auto" />
              <Button
                onClick={handleSave}
                disabled={saving}
                className="w-full bg-cyan-600 hover:bg-cyan-700"
              >
                {saving ? "Saving…" : "Save settings"}
              </Button>
              <Button variant="outline" className="w-full" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
