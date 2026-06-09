import { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { CustomFieldDefinition, FormDefinition, FormFieldMapping, Task } from "@/types/crm";
import {
  loadPublicForm,
  submitForm,
  checkFormStaleBlock,
  verifyFormSupervisorCode,
  claimNextJobNumber,
  type FormStaleBlock,
} from "@/lib/workspaceService";

// Sarcastic-advice pool for the supervisor-bypass card. One is picked at random
// per page load so the SR Assistant doesn't read like a canned recording. Keep
// each line on-character: snarky but ultimately steering the user back to the
// right behaviour (clear the backlog instead of escalating).
const BLOCK_BYPASS_ADVICE: readonly string[] = [
  "Heads up — asking for a supervisor code tells the supervisor you couldn't fulfil your duties on your own, which makes you look incompetent in this position. My advice: sort this out without calling them. Clear the old job first and the form unlocks automatically.",
  "Quick word: every time you reach for that code, the supervisor adds another tally to your 'can't manage on their own' column. Sort the backlog yourself and keep your reputation intact.",
  "Friendly reminder — the bypass code is also a competence report. Use it and the boss knows you couldn't handle the queue. Far better to clear that old job and walk in clean.",
  "Before you call — typing in the supervisor code is basically writing 'I gave up' on your own performance review. Try clearing the backlog first; future-you will thank you.",
  "Listen — supervisors notice when bypass codes get used. Each one whispers 'I couldn't do my job today.' Sort the old work first and stay invisible (in the good way).",
  "Tip: the bypass exists for emergencies, not for skipping homework. Calling for it now puts you on the supervisor's radar for the wrong reasons. Clear the backlog instead.",
  "Heads up — every supervisor unlock is logged with your name on it. Best move? Don't show up on that list. Knock out the old job and the form unlocks itself.",
  "Real talk — calling the supervisor for a bypass is a louder way of saying 'I couldn't keep up.' My advice: clear the backlog quietly and skip the awkward conversation.",
  "One sec — supervisors keep track of who needs the bypass and how often. Don't be on that leaderboard. Tackle the old job and the form opens itself in seconds.",
  "Pro move: handle the backlog, don't escalate it. Bypass codes get noticed by the people who decide promotions. Clear the old job first; let the form unlock itself.",
];

function setCustomFieldValue(
  customFieldValues: { fieldId: string; value: string | number | boolean }[],
  entry: { fieldId: string; value: string | number | boolean },
) {
  const idx = customFieldValues.findIndex(v => v.fieldId === entry.fieldId);
  if (idx >= 0) customFieldValues[idx] = entry;
  else customFieldValues.push(entry);
}

export default function PublicForm() {
  const { formId } = useParams<{ formId: string }>();
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  // Last successfully-printed snapshot so the success screen can offer a
  // "Print again" button if the sticker came out crooked/jammed/missed.
  const [lastPrint, setLastPrint] = useState<{
    jobNumber: string;
    customFieldsObj: Record<string, unknown>;
    createdAt: string;
  } | null>(null);
  const [reprinting, setReprinting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notFound, setNotFound] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reservedJobNumber, setReservedJobNumber] = useState<string | null>(null);
  const [claimingJobNumber, setClaimingJobNumber] = useState(false);
  // Sync guard — prevents double-submit before React re-render disables the button
  const isSubmittingRef = useRef(false);
  const isClaimingJobNumberRef = useRef(false);
  // Stale-task block state. If `block.blocked` is true, the form refuses to
  // render until a supervisor enters a valid bypass code.
  const [block, setBlock] = useState<FormStaleBlock | null>(null);
  const [bypassed, setBypassed] = useState(false);
  const [supervisorCode, setSupervisorCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [bypassError, setBypassError] = useState<string | null>(null);
  // Pick one snarky advice line per page load so the warning doesn't read
  // like the same recording every time.
  const bypassAdvice = useMemo(
    () => BLOCK_BYPASS_ADVICE[Math.floor(Math.random() * BLOCK_BYPASS_ADVICE.length)],
    [],
  );
  // Typewriter effect — reveal the snark one character at a time so it feels
  // like the bot is composing it live. Only animates while the block screen is
  // actually visible; pre-bypass.
  const [typedAdvice, setTypedAdvice] = useState("");
  useEffect(() => {
    if (!block?.blocked || bypassed) { setTypedAdvice(""); return; }
    setTypedAdvice("");
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setTypedAdvice(bypassAdvice.slice(0, i));
      if (i >= bypassAdvice.length) clearInterval(interval);
    }, 22); // ~22ms/char ≈ 45cps, fast enough to read but visibly "typing"
    return () => clearInterval(interval);
  }, [block?.blocked, bypassed, bypassAdvice]);
  const isTyping = typedAdvice.length < bypassAdvice.length;

  useEffect(() => {
    if (!formId) { setNotFound(true); setPageLoading(false); return; }
    Promise.all([loadPublicForm(formId), checkFormStaleBlock(formId)])
      .then(([result, blockResult]) => {
        if (!result) { setNotFound(true); return; }
        setForm(result.form);
        setWorkspaceId(result.workspaceId);
        setBlock(blockResult);
        const defaults: Record<string, string | boolean> = {};
        result.form.fields.forEach(field => {
          defaults[field.id] = field.type === "checkbox" ? false : "";
        });
        setValues(defaults);
      })
      .catch(() => setNotFound(true))
      .finally(() => setPageLoading(false));
  }, [formId]);

  useEffect(() => {
    if (!formId || !workspaceId || !form || submitted) return;
    if (block?.blocked && !bypassed) return;
    if (reservedJobNumber || isClaimingJobNumberRef.current) return;

    const storageKey = `publicForm:${formId}:reservedJobNumber`;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        setReservedJobNumber(saved);
        return;
      }
    } catch {
      // sessionStorage can be unavailable in strict privacy modes.
    }

    isClaimingJobNumberRef.current = true;
    setClaimingJobNumber(true);
    claimNextJobNumber(workspaceId)
      .then((jobNumber) => {
        if (!jobNumber) return;
        setReservedJobNumber(jobNumber);
        try {
          sessionStorage.setItem(storageKey, jobNumber);
        } catch (error) {
          console.warn("[PublicForm] Could not cache reserved job number:", error);
        }
      })
      .catch((err) => {
        console.warn("[PublicForm] Could not reserve job number:", err);
      })
      .finally(() => {
        isClaimingJobNumberRef.current = false;
        setClaimingJobNumber(false);
      });
  }, [formId, workspaceId, form, block?.blocked, bypassed, submitted, reservedJobNumber]);

  const handleSupervisorBypass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formId || !supervisorCode.trim()) return;

    // Rate limiting: max 5 attempts per 60 000 ms window, tracked in localStorage.
    const RL_KEY = `supervisorBypass:rateLimit:${formId}`;
    const WINDOW_MS = 60000;
    const MAX_ATTEMPTS = 5;
    try {
      const raw = localStorage.getItem(RL_KEY);
      const rl: { attempts: number; windowStart: number } = raw
        ? JSON.parse(raw)
        : { attempts: 0, windowStart: performance.now() };

      // Reset window if it has expired.
      if (performance.now() - rl.windowStart >= WINDOW_MS) {
        rl.attempts = 0;
        rl.windowStart = performance.now();
      }

      if (rl.attempts >= MAX_ATTEMPTS) {
        const remainingSec = Math.ceil((WINDOW_MS - (performance.now() - rl.windowStart)) / 1000);
        setBypassError(`Too many attempts. Please wait ${remainingSec} second${remainingSec === 1 ? "" : "s"} before trying again.`);
        return;
      }

      rl.attempts += 1;
      localStorage.setItem(RL_KEY, JSON.stringify(rl));
    } catch {
      // localStorage unavailable — proceed without rate limiting.
    }

    setBypassError(null);
    setVerifying(true);
    try {
      const ok = await verifyFormSupervisorCode(formId, supervisorCode.trim());
      if (ok) {
        // Clear rate-limit counter on successful bypass.
        try { localStorage.removeItem(`supervisorBypass:rateLimit:${formId}`); } catch { /* ignore */ }
        setBypassed(true);
        setSupervisorCode("");
      } else {
        setBypassError("Incorrect supervisor code.");
      }
    } catch {
      setBypassError("Could not verify code. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const validate = (): boolean => {
    if (!form) return false;
    const newErrors: Record<string, string> = {};
    form.fields.forEach(field => {
      if (field.required) {
        const val = values[field.id];
        if (val === undefined || val === "" || val === false) {
          newErrors[field.id] = `${field.label} is required`;
        }
      }
      if (field.type === "email" && values[field.id] && typeof values[field.id] === "string") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[field.id] as string)) {
          newErrors[field.id] = "Invalid email address";
        }
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !workspaceId) return;
    // Synchronous guard — blocks any second call before React re-renders
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    if (!validate()) { isSubmittingRef.current = false; return; }

    let title = "";
    let description = "";
    const customFieldValues: { fieldId: string; value: string | number | boolean }[] = [];

    // Resolve title: template takes priority over mapTo="title" fields
    if (form.titleTemplate?.trim()) {
      title = form.titleTemplate.replace(/\{([^}]+)\}/g, (match, fieldId) => {
        if (fieldId === "jobNumber") return match; // resolved server-side in Index.tsx
        const field = form.fields.find(f => f.id === fieldId);
        if (!field) return "";
        const val = values[field.id];
        return val !== undefined && val !== false ? String(val) : "";
      }).replace(/\s{2,}/g, " ").trim();
    }

    form.fields.forEach(field => {
      const val = values[field.id];
      if (field.mapTo === "title" && !form.titleTemplate?.trim()) {
        title = title ? `${title} - ${val}` : String(val);
      } else if (field.mapTo === "description") {
        description = description ? `${description}\n${val}` : String(val);
      } else if (field.mapTo === "customField" && field.customFieldId) {
        setCustomFieldValue(customFieldValues, {
          fieldId: field.customFieldId,
          value: field.type === "number" ? Number(val) : val as string | boolean,
        });
      }
    });

    // Atomically claim the next job number BEFORE inserting the submission so
    // the sticker can print the real number immediately. If the RPC fails
    // (e.g. migration not yet applied) we fall back to admin-side numbering.
    let preAssignedJobNumber: string | null = reservedJobNumber;
    if (!preAssignedJobNumber) {
      try {
        preAssignedJobNumber = await claimNextJobNumber(workspaceId);
      } catch (err) {
        console.warn("[PublicForm] Could not pre-claim job number:", err);
      }
    }

    // If we have a pre-assigned job# AND the title template references {jobNumber},
    // substitute it now so the title is correct from the start.
    if (preAssignedJobNumber) {
      title = title.replace(/\{jobNumber\}/g, preAssignedJobNumber);
      // Also stamp it into the task's mapped custom field (if the form has one)
      if (form.mapJobNumberToFieldId) {
        setCustomFieldValue(customFieldValues, { fieldId: form.mapJobNumberToFieldId, value: preAssignedJobNumber });
      }
    }

    const newTask: Task = {
      id: `t${Date.now()}`,
      title: title || "Form Submission",
      ...(description ? { description } : {}),
      status: form.defaultStatus,
      priority: form.defaultPriority,
      listId: form.targetListId,
      customFieldValues,
      createdAt: new Date().toISOString().split("T")[0],
      ...(preAssignedJobNumber ? { jobNumber: preAssignedJobNumber } : {}),
    };

    setSubmitting(true);
    try {
      // Try to print FIRST so we know whether to flag the submission as printed.
      // The flag tells admin not to double-print when it picks up the row.
      let printedAtSubmit = false;
      if (form.stickerEnabled) {
        if (!preAssignedJobNumber) {
          console.warn("[PublicForm] Skipping sticker print: no pre-assigned job number (claim_next_job_number RPC unavailable). Admin tab will print when it picks up the submission.");
          setErrors(prev => ({ ...prev, _printer: "Job number service unreachable — sticker will print from the admin tab." }));
        } else {
          // Always snapshot form data so the success screen can offer "Print again"
          // regardless of whether the initial print succeeded or the printer was available.
          const customFieldsObj: Record<string, unknown> = {};
          customFieldValues.forEach(v => { customFieldsObj[v.fieldId] = v.value; });
          setLastPrint({
            jobNumber: preAssignedJobNumber,
            customFieldsObj,
            createdAt: newTask.createdAt,
          });

          try {
            const { printJobStickers, buildStickerDataFromTask, isThermalPrintSupported } =
              await import("@/lib/thermalPrinterService");
            if (!isThermalPrintSupported()) {
              console.warn("[PublicForm] Skipping sticker print: WebUSB not supported in this browser. Use Chrome/Edge on desktop with the printer plugged in.");
              setErrors(prev => ({ ...prev, _printer: "This browser can't reach the sticker printer. Use Chrome or Edge on the desktop plugged into it." }));
            } else {
              const formFieldsAsCustom: CustomFieldDefinition[] = form.fields
                .filter(f => f.mapTo === "customField" && f.customFieldId && f.label)
                .map(f => ({ id: f.customFieldId!, name: f.label, type: f.type }));
              const data = buildStickerDataFromTask(
                form,
                {
                  jobNumber: preAssignedJobNumber,
                  customFields: customFieldsObj,
                  createdAt: newTask.createdAt,
                },
                formFieldsAsCustom,
              );
              await printJobStickers(form, data, form.stickerCount || 1);
              printedAtSubmit = true;
            }
          } catch (printErr) {
            // Print failure is non-fatal — submission still proceeds. Admin will
            // print when it picks up the row (because printedAtSubmit stays false).
            const msg = printErr instanceof Error ? printErr.message : String(printErr);
            console.warn("[PublicForm] Sticker print failed (submission still succeeded):", printErr);
            setErrors(prev => ({ ...prev, _printer: `Sticker printer error: ${msg}` }));
          }
        }
      }

      await submitForm({
        formId: form.id,
        workspaceId,
        task: newTask,
        submittedAt: new Date().toISOString(),
        printedAtSubmit,
      });

      if (formId) {
        try {
          sessionStorage.removeItem(`publicForm:${formId}:reservedJobNumber`);
        } catch (error) {
          console.warn("[PublicForm] Could not clear reserved job number cache:", error);
        }
      }
      setReservedJobNumber(null);
      setSubmitted(true);
    } catch (err) {
      console.error("Submission failed", err);
      setErrors({ _form: "Submission failed. Please try again." });
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const renderField = (field: FormFieldMapping) => {
    const val = values[field.id];
    const error = errors[field.id];

    const inputProps = {
      value: typeof val === "string" ? val : "",
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setValues(prev => ({ ...prev, [field.id]: e.target.value })),
      className: error ? "border-destructive" : "",
    };

    switch (field.type) {
      case "checkbox":
        return (
          <div className="flex items-center gap-2">
            <Checkbox
              id={field.id}
              checked={val as boolean}
              onCheckedChange={(checked) => setValues(prev => ({ ...prev, [field.id]: !!checked }))}
            />
            <Label htmlFor={field.id} className="text-sm">{field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}</Label>
          </div>
        );
      case "dropdown":
        return (
          <div className="space-y-1.5">
            <Label className="text-sm">{field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}</Label>
            <Select value={val as string} onValueChange={(v) => setValues(prev => ({ ...prev, [field.id]: v }))}>
              <SelectTrigger className={error ? "border-destructive" : ""}><SelectValue placeholder={`Select ${field.label}`} /></SelectTrigger>
              <SelectContent>
                {field.options?.map(opt => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      case "date":
        return (
          <div className="space-y-1.5">
            <Label className="text-sm">{field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}</Label>
            <Input type="date" {...inputProps} />
          </div>
        );
      case "number":
        return (
          <div className="space-y-1.5">
            <Label className="text-sm">{field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}</Label>
            <Input type="number" {...inputProps} />
          </div>
        );
      case "email":
        return (
          <div className="space-y-1.5">
            <Label className="text-sm">{field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}</Label>
            <Input type="email" placeholder={field.label} {...inputProps} />
          </div>
        );
      case "phone":
        return (
          <div className="space-y-1.5">
            <Label className="text-sm">{field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}</Label>
            <Input type="tel" placeholder={field.label} {...inputProps} />
          </div>
        );
      case "url":
        return (
          <div className="space-y-1.5">
            <Label className="text-sm">{field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}</Label>
            <Input type="url" placeholder="https://..." {...inputProps} />
          </div>
        );
      default:
        return (
          <div className="space-y-1.5">
            <Label className="text-sm">{field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}</Label>
            {field.mapTo === "description" ? (
              <Textarea placeholder={field.label} rows={3} {...inputProps} />
            ) : (
              <Input placeholder={field.label} {...inputProps} />
            )}
          </div>
        );
    }
  };

  if (pageLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <h2 className="text-lg font-semibold mb-2">Form Not Found</h2>
            <p className="text-sm text-muted-foreground">This form doesn't exist or has been removed.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Submission Received</h2>
            <p className="text-sm text-muted-foreground mb-4">Your form has been submitted successfully and a task has been created.</p>
            {lastPrint && form?.stickerEnabled && (
              <Button
                variant="default"
                disabled={reprinting}
                className="w-full mb-2 bg-amber-600 hover:bg-amber-700 text-white"
                onClick={async () => {
                  if (!form || !lastPrint) return;
                  setReprinting(true);
                  try {
                    const { printJobStickers, buildStickerDataFromTask, isThermalPrintSupported } =
                      await import("@/lib/thermalPrinterService");
                    if (!isThermalPrintSupported()) {
                      alert("Reprint needs Chrome / Edge on the desktop plugged into the printer.");
                      return;
                    }
                    const formFieldsAsCustom: CustomFieldDefinition[] = form.fields
                      .filter(f => f.mapTo === "customField" && f.customFieldId && f.label)
                      .map(f => ({ id: f.customFieldId!, name: f.label, type: f.type }));
                    const data = buildStickerDataFromTask(
                      form,
                      {
                        jobNumber: lastPrint.jobNumber,
                        customFields: lastPrint.customFieldsObj,
                        createdAt: lastPrint.createdAt,
                      },
                      formFieldsAsCustom,
                    );
                    await printJobStickers(form, data, form.stickerCount || 1);
                  } catch (err) {
                    console.warn("[PublicForm] Reprint failed:", err);
                    alert("Reprint failed: " + (err instanceof Error ? err.message : String(err)));
                  } finally {
                    setReprinting(false);
                  }
                }}
              >
                {reprinting ? "Printing…" : `🖨️ Print again (${lastPrint.jobNumber})`}
              </Button>
            )}
            <Button variant="outline" onClick={() => {
              setSubmitted(false);
              setErrors({});
              setLastPrint(null);
              setReservedJobNumber(null);
              isSubmittingRef.current = false;
              if (form) {
                const defaults: Record<string, string | boolean> = {};
                form.fields.forEach(f => { defaults[f.id] = f.type === "checkbox" ? false : ""; });
                setValues(defaults);
              }
            }}>
              Submit Another
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!form) return null;

  if (block?.blocked && !bypassed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-2xl border-amber-300">
          <CardHeader className="bg-amber-50/60 rounded-t-lg">
            <CardTitle className="flex items-center gap-2 text-amber-900">
              <ShieldAlert className="h-5 w-5" />
              Booking Temporarily Unavailable
            </CardTitle>
            <CardDescription className="text-amber-800">
              New bookings are paused while existing work is cleared.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {block.warning_message ? (
              <pre className="whitespace-pre-wrap text-sm text-foreground bg-muted/50 rounded-md p-3 font-sans">
                {block.warning_message}
              </pre>
            ) : (
              <p className="text-sm">
                Jobs in <strong>{block.list_name}</strong> have aged past the{" "}
                <strong>{block.threshold}-day</strong> threshold. Please contact the supervisor.
              </p>
            )}

            {block.stale_tasks && block.stale_tasks.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50/40">
                <div className="px-3 py-2 border-b border-amber-200 flex items-center justify-between">
                  <p className="text-xs font-semibold text-amber-900">
                    {block.total_stale === 1
                      ? "1 job needs to be cleared first"
                      : `${block.total_stale} jobs need to be cleared first`}
                  </p>
                  {block.threshold && (
                    <span className="text-[10px] text-amber-700 uppercase tracking-wide">
                      Over {block.threshold} day{block.threshold === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <ul className="max-h-48 overflow-y-auto divide-y divide-amber-100">
                  {block.stale_tasks.map((t, i) => (
                    <li key={`${t.job_number || t.title}-${i}`} className="px-3 py-1.5 flex items-center justify-between gap-3 text-xs">
                      <span className="flex items-center gap-2 min-w-0">
                        {t.job_number && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 shrink-0">
                            {t.job_number}
                          </span>
                        )}
                        <span className="truncate text-slate-700">{t.title}</span>
                      </span>
                      <span className="shrink-0 text-amber-800 font-medium tabular-nums">
                        {t.days_old}d
                      </span>
                    </li>
                  ))}
                </ul>
                {block.total_stale && block.stale_tasks.length < block.total_stale && (
                  <div className="px-3 py-1.5 border-t border-amber-200 text-[11px] text-amber-700 text-center">
                    …and {block.total_stale - block.stale_tasks.length} more older job{block.total_stale - block.stale_tasks.length === 1 ? "" : "s"}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-end gap-3 pt-2">
              {/* Speech balloon — chat-bubble style, points toward the bot */}
              <div className="flex-1 min-w-0">
                <div
                  className="rounded-2xl rounded-br-sm bg-white text-slate-800
                             shadow-2xl shadow-cyan-500/20 ring-1 ring-cyan-200
                             p-4 animate-in slide-in-from-bottom-2 fade-in duration-200"
                >
                  <p className="text-xs font-semibold text-cyan-700 mb-1 flex items-center gap-2">
                    SR Assistant
                    {isTyping && (
                      <span className="inline-flex gap-0.5" aria-label="typing">
                        <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-bounce" style={{ animationDelay: "120ms" }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-bounce" style={{ animationDelay: "240ms" }} />
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-slate-800 leading-relaxed min-h-[3.5rem]">
                    {typedAdvice}
                    {isTyping && (
                      <span className="inline-block w-[2px] h-[1em] align-text-bottom bg-cyan-500 ml-0.5 animate-pulse" />
                    )}
                  </p>

                  <div className="mt-4 pt-3 border-t border-cyan-100">
                    <p className="text-xs text-slate-500 mb-2">
                      If a supervisor has already authorised this booking, enter the bypass code below.
                    </p>
                    <form onSubmit={handleSupervisorBypass} className="flex gap-2">
                      <Input
                        type="password"
                        placeholder="Supervisor code"
                        value={supervisorCode}
                        onChange={(e) => { setSupervisorCode(e.target.value); setBypassError(null); }}
                        autoComplete="off"
                        disabled={verifying}
                      />
                      <Button type="submit" disabled={verifying || !supervisorCode.trim()}>
                        {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unlock"}
                      </Button>
                    </form>
                    {bypassError && (
                      <p className="text-xs text-destructive mt-2">{bypassError}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* SR Bot — large circular avatar with animated cyan glow */}
              <div
                className="relative h-44 w-44 sm:h-56 sm:w-56 shrink-0 rounded-full overflow-hidden bg-white
                           ring-2 ring-cyan-400/50 drop-shadow-[0_18px_32px_rgba(74,222,222,0.55)]"
                aria-hidden
              >
                <span className="absolute inset-4 rounded-full bg-cyan-300/30 blur-md -z-10 animate-pulse" />
                <img
                  src="/sr-bot.jpg"
                  alt=""
                  aria-hidden
                  className="h-full w-full object-contain pointer-events-none"
                  draggable={false}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-3 rounded-md border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Job Number</p>
            <p className="mt-1 font-mono text-3xl font-bold text-primary tabular-nums">
              {reservedJobNumber || (claimingJobNumber ? "Preparing…" : "Will assign on submit")}
            </p>
          </div>
          <CardTitle className="text-xl">{form.name}</CardTitle>
          <CardDescription>Fill out the form below to submit</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {form.fields.map(field => (
              <div key={field.id}>
                {renderField(field)}
                {errors[field.id] && (
                  <p className="text-xs text-destructive mt-1">{errors[field.id]}</p>
                )}
              </div>
            ))}
            {errors._form && (
              <p className="text-sm text-destructive text-center">{errors._form}</p>
            )}
            <Button type="submit" className="w-full mt-2" disabled={submitting}>
              {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Submitting…</> : "Submit"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
