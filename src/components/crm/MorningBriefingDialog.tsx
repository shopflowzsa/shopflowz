import { differenceInDays, differenceInWeeks } from "date-fns";
import { AlertTriangle, Clock, CheckCircle2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Task, List } from "@/types/crm";

interface Props {
  userName: string;
  tasks: Task[];
  lists: List[];
  onClose: () => void;
}

const CLOSING_LINES = [
  "I'm watching every single task on that list. Make today count.",
  "Management sees everything. No more delays — today you deliver.",
  "Every job on that list is a customer waiting. Don't let them down.",
  "Your customers are counting on you. Get off your phone and get to it.",
  "The backlog doesn't clear itself. Today is the day you fix that.",
];

function getGreeting(): { text: string; emoji: string } {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return { text: "Good Morning",   emoji: "☀️" };
  if (h >= 12 && h < 17) return { text: "Good Afternoon", emoji: "🌤️" };
  if (h >= 17 && h < 21) return { text: "Good Evening",   emoji: "🌇" };
  return { text: "Still here?",    emoji: "🌙" };
}

function formatAge(createdAt?: string): { label: string; urgent: boolean } {
  if (!createdAt) return { label: "unknown time", urgent: false };
  const days = differenceInDays(new Date(), new Date(createdAt));
  if (days < 1) return { label: "today", urgent: false };
  if (days === 1) return { label: "1 day", urgent: false };
  const weeks = differenceInWeeks(new Date(), new Date(createdAt));
  if (weeks >= 2) return { label: `${weeks} weeks`, urgent: true };
  if (weeks === 1) return { label: "1 week", urgent: true };
  return { label: `${days} days`, urgent: days >= 5 };
}

const STATUS_LABEL: Record<string, string> = {
  to_do: "hasn't been started",
  in_progress: "in progress",
  review: "waiting on review",
  quoted: "quoted, pending",
};

export function MorningBriefingDialog({ userName, tasks, lists, onClose }: Props) {
  const closingLine = CLOSING_LINES[new Date().getDay() % CLOSING_LINES.length];
  const firstName = userName.split(" ")[0] || userName;
  const { text: greeting, emoji } = getGreeting();

  // Sort: oldest first, then by urgency
  const sorted = [...tasks].sort((a, b) => {
    const da = differenceInDays(new Date(), new Date(a.startDate || a.createdAt || ""));
    const db = differenceInDays(new Date(), new Date(b.startDate || b.createdAt || ""));
    return db - da;
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-indigo-600 to-purple-700 px-6 py-8 text-white text-center flex-shrink-0">
          <div className="text-4xl mb-2">{emoji}</div>
          <h1 className="text-2xl font-extrabold tracking-tight">{greeting}, {firstName}!</h1>
          <p className="text-indigo-200 text-sm mt-1">Here's your briefing — straight from management.</p>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {sorted.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
              <p className="text-sm font-semibold text-green-600">No open tasks on your name right now.</p>
              <p className="text-xs text-muted-foreground mt-1">Keep it that way.</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground pb-1">
                You have <span className="font-bold text-foreground">{sorted.length} open job{sorted.length !== 1 ? "s" : ""}</span> sitting on your name right now:
              </p>
              {sorted.map(task => {
                const list = lists.find(l => l.id === task.listId);
                const age = formatAge(task.startDate || task.createdAt);
                const isUrgent = task.priority === "urgent" || age.urgent;
                const statusNote = STATUS_LABEL[task.status] ?? task.status;
                return (
                  <div
                    key={task.id}
                    className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
                      isUrgent
                        ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
                        : "border-border bg-muted/30"
                    }`}
                  >
                    {isUrgent
                      ? <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      : <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm text-primary">
                          {task.jobNumber || task.id.slice(0, 8)}
                        </span>
                        <span className="text-muted-foreground text-xs">→</span>
                        <span className="text-xs font-semibold">{list?.name ?? "Unknown List"}</span>
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                          isUrgent ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" : "bg-muted text-muted-foreground"
                        }`}>
                          {age.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {task.title.replace(/^JOB-\d+/, "").trim() || task.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 italic">
                        {statusNote}
                        {task.priority === "urgent" ? " — 🔴 URGENT" : ""}
                        {age.urgent ? ` — customer has been waiting ${age.label}` : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-border px-6 py-4 bg-muted/20">
          <div className="flex items-start gap-2 mb-4">
            <Eye className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs font-semibold text-red-600 italic">"{closingLine}"</p>
          </div>
          <Button className="w-full" onClick={onClose}>
            I understand — let's get to work 💪
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
