import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, Download, Printer } from "lucide-react";
import { Task, CustomFieldDefinition } from "@/types/crm";
import { generateFaultReportHTML } from "@/lib/pdfService";
import { loadSalesSettings } from "@/lib/salesSettingsService";
import { useAuth } from "@/contexts/AuthContext";

interface FaultReportDialogProps {
  open: boolean;
  onClose: () => void;
  task: Task;
  customFields: CustomFieldDefinition[];
}

const TESTS = [
  "Visual Inspection",
  "Power-On Test",
  "Signal Trace",
  "Oscilloscope",
  "Multimeter",
  "Load Test",
  "Speaker Output Test",
  "Thermal Inspection",
];

const FAULT_STAGES = [
  "Power Supply",
  "Pre-Amplifier",
  "Power Amplifier",
  "Output Stage",
  "Protection Circuit",
  "Input Stage",
  "DSP / Processing",
  "PCB Trace / Solder Joint",
  "Mechanical",
  "Crossover / Passive Network",
  "Woofer / Driver",
  "Tweeter / HF Driver",
  "Other",
];

const ROOT_CAUSES = [
  "Component Failure (Age/Wear)",
  "Power Surge / Lightning",
  "Physical Damage / Impact",
  "Water / Moisture Ingress",
  "Overheating",
  "Manufacturing Defect",
  "Incorrect Operation",
  "Unknown",
  "Other",
];

const OUTCOMES = [
  "Successfully Repaired",
  "Partially Repaired",
  "Unrepairable",
  "Pending Parts",
  "Customer Declined Repair",
];

function getFieldValue(task: Task, fields: CustomFieldDefinition[], hints: string[]): string {
  for (const hint of hints) {
    const field = fields.find(f => f.name.toLowerCase().includes(hint.toLowerCase()));
    if (field) {
      const val = task.customFieldValues.find(v => v.fieldId === field.id);
      if (val?.value) return String(val.value);
    }
  }
  return "";
}

export function FaultReportDialog({ open, onClose, task, customFields }: FaultReportDialogProps) {
  const { workspace } = useAuth();
  const workspaceId = workspace?.id;

  // Pre-filled from job card
  const customerName  = getFieldValue(task, customFields, ["customer name", "client name", "client", "name"]);
  const customerPhone = getFieldValue(task, customFields, ["phone", "contact number", "cell", "mobile"]);
  const faultReported = getFieldValue(task, customFields, ["fault", "problem", "issue", "symptom"]);
  const deviceBrand   = getFieldValue(task, customFields, ["brand", "make", "manufacturer"]);
  const deviceModel   = getFieldValue(task, customFields, ["model"]);
  const serialNum     = getFieldValue(task, customFields, ["serial", "serial number"]);
  const deposit       = getFieldValue(task, customFields, ["deposit"]);
  const repairCost    = getFieldValue(task, customFields, ["repair cost", "cost", "repair price", "price"]);

  // Assessment answers
  const [testsPerformed, setTestsPerformed] = useState<string[]>([]);
  const [visualFindings, setVisualFindings] = useState("");
  const [diagnosisFault, setDiagnosisFault] = useState("");
  const [faultStage, setFaultStage] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [componentsTested, setComponentsTested] = useState("");
  const [componentsReplaced, setComponentsReplaced] = useState("");
  const [repairCarriedOut, setRepairCarriedOut] = useState("");
  const [postRepairTests, setPostRepairTests] = useState("");
  const [outcome, setOutcome] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [loading, setLoading] = useState(false);

  const toggleTest = (t: string) =>
    setTestsPerformed(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const buildData = () => ({
    jobNumber: task.jobNumber || task.id,
    jobTitle: task.title,
    customerName,
    customerPhone,
    deviceBrand,
    deviceModel,
    serialNum,
    faultReported: faultReported || task.description || "",
    technician: (task as any).technician || "",
    dateReceived: task.createdAt,
    deposit,
    repairCost,
    // assessment
    testsPerformed,
    visualFindings,
    diagnosisFault,
    faultStage,
    rootCause,
    componentsTested,
    componentsReplaced,
    repairCarriedOut,
    postRepairTests,
    outcome,
    recommendations,
    generatedAt: new Date().toISOString(),
  });

  async function getSalesSettings() {
    if (!workspaceId) return undefined;
    return loadSalesSettings(workspaceId);
  }

  async function handlePrint() {
    setLoading(true);
    const s = await getSalesSettings();
    const html = generateFaultReportHTML(buildData(), s);
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); }
    setLoading(false);
  }

  async function handleDownload() {
    setLoading(true);
    const s = await getSalesSettings();
    const html = generateFaultReportHTML(buildData(), s);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fault-report-${task.jobNumber || task.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
    setLoading(false);
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Fault Assessment Report
            {task.jobNumber && (
              <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded ml-1">
                {task.jobNumber}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 text-sm">

          {/* Pre-filled summary */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-xs">
            <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-2">Job Info (from card)</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span><span className="text-muted-foreground">Device: </span><strong>{task.title}</strong></span>
              {customerName && <span><span className="text-muted-foreground">Customer: </span><strong>{customerName}</strong></span>}
              {deviceBrand && <span><span className="text-muted-foreground">Brand: </span>{deviceBrand}</span>}
              {deviceModel && <span><span className="text-muted-foreground">Model: </span>{deviceModel}</span>}
              {serialNum && <span><span className="text-muted-foreground">Serial: </span>{serialNum}</span>}
              {customerPhone && <span><span className="text-muted-foreground">Phone: </span>{customerPhone}</span>}
              {faultReported && <span className="col-span-2"><span className="text-muted-foreground">Fault Reported: </span>{faultReported}</span>}
            </div>
          </div>

          {/* 1. Tests performed */}
          <div className="space-y-2">
            <Label className="font-semibold">1. Tests Performed</Label>
            <div className="grid grid-cols-2 gap-2">
              {TESTS.map(t => (
                <label key={t} className="flex items-center gap-2 cursor-pointer select-none">
                  <Checkbox
                    checked={testsPerformed.includes(t)}
                    onCheckedChange={() => toggleTest(t)}
                  />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 2. Visual inspection findings */}
          <div className="space-y-1.5">
            <Label className="font-semibold">2. Visual Inspection Findings</Label>
            <Textarea
              placeholder="e.g. Burnt resistor on power supply board, damaged PCB trace near Q3, bulging capacitors…"
              value={visualFindings}
              onChange={e => setVisualFindings(e.target.value)}
              rows={3}
            />
          </div>

          {/* 3. Diagnosis / fault found */}
          <div className="space-y-1.5">
            <Label className="font-semibold">3. Fault Diagnosis</Label>
            <Textarea
              placeholder="Describe exactly what fault was found and how it was confirmed…"
              value={diagnosisFault}
              onChange={e => setDiagnosisFault(e.target.value)}
              rows={3}
            />
          </div>

          {/* 4. Fault stage */}
          <div className="space-y-1.5">
            <Label className="font-semibold">4. Fault Location / Stage</Label>
            <Select value={faultStage} onValueChange={setFaultStage}>
              <SelectTrigger><SelectValue placeholder="Select stage…" /></SelectTrigger>
              <SelectContent>
                {FAULT_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 5. Root cause */}
          <div className="space-y-1.5">
            <Label className="font-semibold">5. Root Cause of Fault</Label>
            <Select value={rootCause} onValueChange={setRootCause}>
              <SelectTrigger><SelectValue placeholder="Select cause…" /></SelectTrigger>
              <SelectContent>
                {ROOT_CAUSES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 6. Components tested */}
          <div className="space-y-1.5">
            <Label className="font-semibold">6. Components Tested</Label>
            <Textarea
              placeholder="e.g. R14 (47Ω), C8 (100µF/50V), Q3 (TIP142), D5 (1N4007)…"
              value={componentsTested}
              onChange={e => setComponentsTested(e.target.value)}
              rows={2}
            />
          </div>

          {/* 7. Components replaced */}
          <div className="space-y-1.5">
            <Label className="font-semibold">7. Components Replaced</Label>
            <Textarea
              placeholder="e.g. R14 – replaced with 47Ω 2W; C8 – replaced with 100µF/63V; Q3 – replaced with TIP142…"
              value={componentsReplaced}
              onChange={e => setComponentsReplaced(e.target.value)}
              rows={2}
            />
          </div>

          {/* 8. Repair carried out */}
          <div className="space-y-1.5">
            <Label className="font-semibold">8. Repair Carried Out</Label>
            <Textarea
              placeholder="Describe the repair work performed step by step…"
              value={repairCarriedOut}
              onChange={e => setRepairCarriedOut(e.target.value)}
              rows={3}
            />
          </div>

          {/* 9. Post-repair test */}
          <div className="space-y-1.5">
            <Label className="font-semibold">9. Post-Repair Test Results</Label>
            <Textarea
              placeholder="e.g. Unit powers on, output measures 120W RMS at 4Ω, no distortion, protection not triggering…"
              value={postRepairTests}
              onChange={e => setPostRepairTests(e.target.value)}
              rows={2}
            />
          </div>

          {/* 10. Outcome */}
          <div className="space-y-1.5">
            <Label className="font-semibold">10. Repair Outcome</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger><SelectValue placeholder="Select outcome…" /></SelectTrigger>
              <SelectContent>
                {OUTCOMES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 11. Recommendations */}
          <div className="space-y-1.5">
            <Label className="font-semibold">11. Recommendations &amp; Notes</Label>
            <Textarea
              placeholder="Any recommendations for the customer, preventative notes, future maintenance…"
              value={recommendations}
              onChange={e => setRecommendations(e.target.value)}
              rows={2}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-border">
            <Button onClick={handlePrint} disabled={loading} className="flex-1 gap-2">
              <Printer className="h-4 w-4" /> Print / Save PDF
            </Button>
            <Button variant="outline" onClick={handleDownload} disabled={loading} className="gap-2">
              <Download className="h-4 w-4" /> Download HTML
            </Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
