import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, AlertTriangle, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { recordStaleReason, type StaleTaskHit } from "@/lib/staleTaskService";
import { loadSRSettings, type SRBotSettings } from "@/lib/srAgentService";
import { useVoice } from "@/hooks/useVoice";

interface BaseProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  userId: string;
  userName: string;
}

// ─── Variant A: Block-new-task ─────────────────────────────────────────────
// Shown when reception tries to create a task in a list/folder that has a
// stale task. There's no proceed button — they MUST go deal with the old
// task first.
export function StaleTaskBlockDialog({
  open,
  onClose,
  workspaceId,
  ruleMessage,
  offenderTitle,
  offenderDays,
  listName,
}: BaseProps & {
  ruleMessage: string;
  offenderTitle: string;
  offenderDays: number;
  listName?: string;
}) {
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

  useEffect(() => {
    if (!open || !srSettings?.tts_enabled) return;
    const phrase = `Hold up. ${offenderTitle} has been sitting in ${listName || "this list"} for ${offenderDays} days. Please move that one first.`;
    voice.speak(phrase);
    return () => voice.stopSpeaking();
  }, [open, srSettings?.tts_enabled, offenderTitle, offenderDays, listName, voice]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-cyan-500" />
            SR Assistant says:
          </DialogTitle>
        </DialogHeader>
        <DialogDescription>You can't create a new task here yet.</DialogDescription>

        <div className="flex gap-6 py-4">
          {/* SR Robot */}
          <div className="flex flex-col items-center space-y-3 min-w-[180px]">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-cyan-300/40 blur-2xl opacity-60" aria-hidden />
              <div className="relative h-40 w-40 rounded-full overflow-hidden bg-white ring-4 ring-cyan-400/60 shadow-2xl">
                <img
                  src="/sr-bot.jpg"
                  alt=""
                  aria-hidden
                  className="h-full w-full object-contain pointer-events-none"
                  draggable={false}
                />
              </div>
            </div>
            <p className="text-center text-xs text-gray-500 italic max-w-[160px]">
              Sort the old one first, then we can take the new job.
            </p>
          </div>

          <div className="flex-1 space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Clock className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-800">
                    A task in {listName || "this list"} hasn't moved for {offenderDays} days
                  </p>
                  <p className="text-sm text-amber-700 mt-1">
                    Job: <strong>{offenderTitle}</strong>
                  </p>
                  <p className="text-sm text-amber-700 mt-2">{ruleMessage}</p>
                </div>
              </div>
            </div>

            <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-3">
              <p className="text-sm text-cyan-700">
                Please progress or close that job before booking another. Keeping the queue clean stops
                customers' work from piling up.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={onClose} variant="outline">
                Got it
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Variant B: Acknowledge stale tasks ────────────────────────────────────
// Shown on app load / scheduled sweep. Reception sees a list of stale tasks
// and must pick a reason (or write one) for each before dismissing.
export function StaleTaskAcknowledgeDialog({
  open,
  onClose,
  workspaceId,
  userId,
  userName,
  hits,
}: BaseProps & {
  hits: StaleTaskHit[];
}) {
  const { toast } = useToast();
  const [picks, setPicks] = useState<Record<string, { reason: string; note: string }>>({});
  const [submitting, setSubmitting] = useState(false);

  // Reset state when the dialog opens with a new set of hits
  useEffect(() => {
    if (open) setPicks({});
  }, [open, hits.length]);

  const allAnswered = hits.every((h) => {
    const p = picks[h.task.id];
    return p && (p.reason.trim() !== "" || p.note.trim() !== "");
  });

  const handleSubmit = async () => {
    if (!allAnswered) return;
    setSubmitting(true);
    try {
      for (const h of hits) {
        const p = picks[h.task.id];
        const reason = (p?.reason || "").trim() || "Other";
        const note = (p?.note || "").trim();
        await recordStaleReason({
          workspaceId,
          taskId: h.task.id,
          taskTitle: h.task.title,
          userId,
          userName,
          reason,
          note: note || null,
          snoozeHours: 24,
        });
      }
      toast({
        title: "Logged",
        description: `${hits.length} stale task${hits.length > 1 ? "s" : ""} acknowledged.`,
      });
      onClose();
    } catch (err) {
      console.error(err);
      toast({
        title: "Failed to log",
        description: "Try again or check your connection.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (hits.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-cyan-500" />
            SR Assistant says:
          </DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {hits.length} task{hits.length > 1 ? "s have" : " has"} been sitting too long. Tell me why and I'll log it.
        </DialogDescription>

        <div className="flex-1 overflow-y-auto pr-2 space-y-3">
          {hits.map((h) => {
            const reasons = h.rule.stale_reasons || [];
            const pick = picks[h.task.id] || { reason: "", note: "" };
            return (
              <div key={h.task.id} className="rounded-lg border bg-amber-50 border-amber-200 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-amber-900 break-words">{h.task.title}</p>
                    <p className="text-xs text-amber-700">
                      {h.listName ? `${h.listName} · ` : ""}
                      {Math.floor((Date.now() - new Date(h.task.createdAt || 0).getTime()) / 86400000)} days old
                      {h.daysOverdue > 0 && ` · ${h.daysOverdue}d over the ${h.rule.stale_threshold_days}d threshold`}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {reasons.length > 0 && (
                    <div className="sm:col-span-1">
                      <Label className="text-xs text-amber-900">Reason</Label>
                      <Select
                        value={pick.reason}
                        onValueChange={(v) =>
                          setPicks((prev) => ({ ...prev, [h.task.id]: { ...pick, reason: v } }))
                        }
                      >
                        <SelectTrigger className="bg-white border-amber-200">
                          <SelectValue placeholder="Pick a reason" />
                        </SelectTrigger>
                        <SelectContent>
                          {reasons.map((r) => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                          ))}
                          <SelectItem value="Other">Other (use note)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className={reasons.length > 0 ? "sm:col-span-2" : "sm:col-span-3"}>
                    <Label className="text-xs text-amber-900">Note (optional but recommended)</Label>
                    <Textarea
                      rows={2}
                      value={pick.note}
                      onChange={(e) =>
                        setPicks((prev) => ({ ...prev, [h.task.id]: { ...pick, note: e.target.value } }))
                      }
                      placeholder={reasons.length === 0 ? "Why is this still here?" : "Extra detail (optional)"}
                      className="bg-white border-amber-200 text-sm"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-3 border-t flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Snoozed for 24 hours after logging. I'll ask again tomorrow if the task is still sitting.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Remind me later
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!allAnswered || submitting}
              className="bg-cyan-600 hover:bg-cyan-700"
            >
              {submitting ? "Logging…" : "Submit reasons"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
