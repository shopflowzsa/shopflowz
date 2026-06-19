import { useState, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Plus, Trash2, GripVertical, Copy, ExternalLink, ArrowUp, ArrowDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  FormDefinition, FormFieldMapping, CustomFieldDefinition,
  CustomFieldType, List, TaskStatus, TaskPriority,
  StickerRowAlign, StickerRowSize, StickerRowStyle,
  DEFAULT_STATUSES, PRIORITIES,
} from "@/types/crm";
import { StickerPreview } from "@/components/crm/StickerPreview";
import { StickerLayoutEditor } from "@/components/crm/StickerLayoutEditor";

interface FormBuilderProps {
  open: boolean;
  onClose: () => void;
  onSave: (form: FormDefinition) => void;
  existingForm?: FormDefinition;
  lists: List[];
  customFields: CustomFieldDefinition[];
  formId?: string;
}

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "url", label: "URL" },
  { value: "date", label: "Date" },
  { value: "dropdown", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
];

export function FormBuilder({ open, onClose, onSave, existingForm, lists, customFields, formId }: FormBuilderProps) {
  const [name, setName] = useState(existingForm?.name || "");
  const [targetListId, setTargetListId] = useState(existingForm?.targetListId || "");
  const [defaultStatus, setDefaultStatus] = useState<TaskStatus>(existingForm?.defaultStatus || "to_do");
  const [defaultPriority, setDefaultPriority] = useState<TaskPriority>(existingForm?.defaultPriority || "normal");
  const [prefixJobNumber, setPrefixJobNumber] = useState(existingForm?.prefixJobNumber ?? true);
  const [mapJobNumberToFieldId, setMapJobNumberToFieldId] = useState(existingForm?.mapJobNumberToFieldId ?? "");
  const [depositAmountFieldId, setDepositAmountFieldId] = useState(existingForm?.depositAmountFieldId ?? "");

  // ── Sticker print config ────────────────────────────────────────────────
  const [stickerEnabled, setStickerEnabled] = useState(existingForm?.stickerEnabled ?? false);
  const [stickerCount, setStickerCount] = useState(existingForm?.stickerCount ?? 1);
  const [stickerShowJobNumber, setStickerShowJobNumber] = useState(existingForm?.stickerShowJobNumber ?? true);
  const [stickerShowCustomerName, setStickerShowCustomerName] = useState(existingForm?.stickerShowCustomerName ?? true);
  const [stickerCustomerNameFieldId, setStickerCustomerNameFieldId] = useState(existingForm?.stickerCustomerNameFieldId ?? "");
  const [stickerShowDate, setStickerShowDate] = useState(existingForm?.stickerShowDate ?? true);
  const [stickerShowBarcode, setStickerShowBarcode] = useState(existingForm?.stickerShowBarcode ?? false);
  const [stickerShowQR, setStickerShowQR] = useState(existingForm?.stickerShowQR ?? false);
  const [stickerExtraFieldIds, setStickerExtraFieldIds] = useState<string[]>(existingForm?.stickerExtraFieldIds ?? []);
  const [stickerFooterText, setStickerFooterText] = useState(existingForm?.stickerFooterText ?? "");
  const [stickerPrinterVendorId, setStickerPrinterVendorId] = useState<number | undefined>(existingForm?.stickerPrinterVendorId);
  const [stickerPrinterProductId, setStickerPrinterProductId] = useState<number | undefined>(existingForm?.stickerPrinterProductId);
  const [stickerPrinterLabel, setStickerPrinterLabel] = useState<string>(existingForm?.stickerPrinterLabel ?? "");

  // ── New line/segment model state ─────────────────────────────────────────
  const [stickerUseLines, setStickerUseLines] = useState(existingForm?.stickerUseLines ?? false);
  const makeLineId = () => `ln_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const [stickerLines, setStickerLines] = useState<import("@/types/crm").StickerLine[]>(
    existingForm?.stickerLines || [
      { id: makeLineId(), segments: [{ source: "jobNumber", align: "center", size: "huge", bold: true }] },
      { id: makeLineId(), segments: [{ source: "customField", align: "center", size: "normal", bold: false }] },
    ]
  );

  // ── Layout / template (per-row alignment + size) ────────────────────────
  const DEFAULT_LAYOUT: NonNullable<FormDefinition["stickerLayout"]> = {
    paperWidth: "80mm",
    topMargin: 0,
    bottomMargin: 3,
    rowSpacing: 0,
    jobNumber:    { align: "center", size: "huge",   bold: true },
    customerName: { align: "center", size: "large",  bold: true },
    date:         { align: "center", size: "normal", bold: false },
    extras:       { align: "left",   size: "normal", bold: false },
    footer:       { align: "center", size: "small",  bold: false },
    columns: 1,
    rows: 1,
    stickerHeightMm: 20,
    rowGapMm: 3,
    topStartMm: 0,
    bottomEndMm: 0,
    verticalPaddingMm: 1,
    // Legacy fallbacks for older paths
    stickerWidthMm: 30,
    columnGapMm: 2,
    horizontalOffsetMm: 0,
  };
  const [stickerLayout, setStickerLayout] = useState<NonNullable<FormDefinition["stickerLayout"]>>({
    ...DEFAULT_LAYOUT,
    ...(existingForm?.stickerLayout || {}),
  });
  const updateRowStyle = (key: "jobNumber" | "customerName" | "date" | "extras" | "footer", patch: Partial<StickerRowStyle>) => {
    setStickerLayout(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
  };

  // ── Test-field values used in the preview / test print ──────────────────
  const [testJobNumber, setTestJobNumber] = useState("JOB-0042");
  const [testCustomerName, setTestCustomerName] = useState("John Doe");
  const [testDateLabel, setTestDateLabel] = useState(() =>
    new Date().toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })
  );

  const titleTemplateRef = useRef<HTMLTextAreaElement>(null);
  
  // Filter custom fields based on selected target list - reactive to changes
  const availableCustomFields = useMemo(() => {
    if (!targetListId) return customFields;
    // Show ALL custom fields — visibleFieldIds only controls CRM column visibility,
    // not what fields a form is allowed to map to.
    return customFields;
  }, [targetListId, customFields]);

  // Get available statuses for the selected target list
  const availableStatuses = useMemo(() => {
    if (!targetListId) return DEFAULT_STATUSES;
    const targetList = lists.find(l => l.id === targetListId);
    if (!targetList) return DEFAULT_STATUSES;
    
    // Use custom statuses if the list has them, otherwise use defaults
    return targetList.customStatuses && targetList.customStatuses.length > 0 
      ? targetList.customStatuses 
      : DEFAULT_STATUSES;
  }, [targetListId, lists]);

  // Clean up invalid field references when form loads or target changes
  const cleanInvalidFields = (fields: FormFieldMapping[], showWarning: boolean = false) => {
    const availableFieldIds = availableCustomFields.map(cf => cf.id);
    let hasChanges = false;
    
    const cleaned = fields.map(field => {
      if (field.mapTo === "customField" && field.customFieldId && !availableFieldIds.includes(field.customFieldId)) {
        hasChanges = true;
        return { ...field, customFieldId: undefined };
      }
      return field;
    });
    
    if (hasChanges && showWarning) {
      toast.warning("Some custom field mappings are no longer available in this target list");
    }
    
    return cleaned;
  };

  const [fields, setFields] = useState<FormFieldMapping[]>(() => {
    // Don't clean on initial load - preserve the form as-is
    return existingForm?.fields || [
      { id: `ff${Date.now()}`, label: "Name / Title", type: "text", required: true, mapTo: "title" },
    ];
  });

  // Clean up invalid tokens from title template
  const cleanTitleTemplate = (template: string, currentFields: FormFieldMapping[]) => {
    if (!template) return template;
    
    // Get valid field labels
    const validTokens = new Set([
      'jobNumber',
      ...currentFields.filter(f => f.label).map(f => f.label)
    ]);
    
    // Remove any tokens that don't match valid fields
    return template.replace(/\{([^}]+)\}/g, (match, token) => {
      return validTokens.has(token) ? match : '';
    }).replace(/\s+/g, ' ').trim();
  };
  
  const [titleTemplate, setTitleTemplate] = useState(() => {
    // Don't clean on initial load - preserve the template as-is
    return existingForm?.titleTemplate ?? "";
  });

  const addField = () => {
    setFields(prev => [...prev, {
      id: `ff${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      label: "",
      type: "text",
      required: false,
      mapTo: "customField",
    }]);
  };

  const updateField = (id: string, updates: Partial<FormFieldMapping>) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const removeField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id));
  };

  // Clear invalid custom field mappings when target list changes
  const handleTargetListChange = (newListId: string) => {
    setTargetListId(newListId);
    
    // Get new available custom fields
    const newTargetList = lists.find(l => l.id === newListId);
    if (!newTargetList) return;
    
    const newAvailableFieldIds = customFields
      .filter(cf => newTargetList.visibleFieldIds.includes(cf.id))
      .map(cf => cf.id);
    
    // Get new available statuses
    const newAvailableStatuses = newTargetList.customStatuses && newTargetList.customStatuses.length > 0 
      ? newTargetList.customStatuses 
      : DEFAULT_STATUSES;
    
    // Reset default status if current one is not available in new list
    const statusIds = newAvailableStatuses.map(s => s.id);
    if (!statusIds.includes(defaultStatus)) {
      setDefaultStatus(newAvailableStatuses[0].id);
    }
    
    // Clear mappings to custom fields that are no longer available
    const cleanedFields = fields.map(field => {
      if (field.mapTo === "customField" && field.customFieldId && !newAvailableFieldIds.includes(field.customFieldId)) {
        return { ...field, customFieldId: undefined };
      }
      return field;
    });
    
    // Show warning if any fields were unmapped
    const hadChanges = fields.some((field, i) => 
      field.customFieldId && field.customFieldId !== cleanedFields[i].customFieldId
    );
    if (hadChanges) {
      toast.warning("Some custom field mappings were cleared because they're not available in the new target list");
    }
    
    setFields(cleanedFields);
    
    // Clear job number mapping if the field is no longer available
    if (mapJobNumberToFieldId && !newAvailableFieldIds.includes(mapJobNumberToFieldId)) {
      setMapJobNumberToFieldId("");
    }
    // Clear deposit field mapping if the field is no longer available
    if (depositAmountFieldId && !newAvailableFieldIds.includes(depositAmountFieldId)) {
      setDepositAmountFieldId("");
    }
    
    // Clean up title template
    setTitleTemplate(prev => cleanTitleTemplate(prev, cleanedFields));
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= fields.length) return;
    const updated = [...fields];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setFields(updated);
  };

  const insertToken = (fieldId: string) => {
    const token = `{${fieldId}}`;
    const ta = titleTemplateRef.current;
    if (!ta) { setTitleTemplate(prev => prev + token); return; }
    const start = ta.selectionStart ?? titleTemplate.length;
    const end = ta.selectionEnd ?? titleTemplate.length;
    const newVal = titleTemplate.slice(0, start) + token + titleTemplate.slice(end);
    setTitleTemplate(newVal);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const handleSave = () => {
    if (!name.trim()) { toast.error("Form name is required"); return; }
    if (!targetListId) { toast.error("Please select a target list"); return; }
    if (fields.length === 0) { toast.error("Add at least one field"); return; }
    if (!titleTemplate.trim() && !fields.some(f => f.mapTo === "title")) {
      toast.error("Set a title template or map at least one field to Task Title");
      return;
    }

    const form: FormDefinition = {
      id: existingForm?.id || formId || `form${Date.now()}`,
      name: name.trim(),
      targetListId,
      defaultStatus,
      defaultPriority,
      fields,
      prefixJobNumber,
      createdAt: existingForm?.createdAt || new Date().toISOString().split("T")[0],
    };
    
    // Only include optional fields if they have values (Firestore doesn't accept undefined)
    if (titleTemplate.trim()) {
      form.titleTemplate = titleTemplate.trim();
    }
    if (mapJobNumberToFieldId) {
      form.mapJobNumberToFieldId = mapJobNumberToFieldId;
    }
    if (depositAmountFieldId) {
      form.depositAmountFieldId = depositAmountFieldId;
    }

    // Sticker print config — only persist when enabled to keep payloads clean
    if (stickerEnabled) {
      form.stickerEnabled = true;
      form.stickerCount = Math.max(1, Math.min(10, stickerCount || 1));
      form.stickerShowJobNumber = stickerShowJobNumber;
      form.stickerShowCustomerName = stickerShowCustomerName;
      if (stickerShowCustomerName && stickerCustomerNameFieldId) {
        form.stickerCustomerNameFieldId = stickerCustomerNameFieldId;
      }
      form.stickerShowDate = stickerShowDate;
      form.stickerShowBarcode = stickerShowBarcode;
      form.stickerShowQR = stickerShowQR;
      if (stickerExtraFieldIds.length > 0) {
        form.stickerExtraFieldIds = stickerExtraFieldIds;
      }
      if (stickerFooterText.trim()) {
        form.stickerFooterText = stickerFooterText.trim();
      }
      if (stickerPrinterVendorId != null && stickerPrinterProductId != null) {
        form.stickerPrinterVendorId = stickerPrinterVendorId;
        form.stickerPrinterProductId = stickerPrinterProductId;
        if (stickerPrinterLabel) form.stickerPrinterLabel = stickerPrinterLabel;
      }
      form.stickerLayout = stickerLayout;
      if (stickerUseLines) {
        form.stickerUseLines = true;
        form.stickerLines = stickerLines;
      }
    }

    onSave(form);
    onClose();
  };

  const formUrl = `${window.location.origin}/form/${existingForm?.id || formId || "new"}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{existingForm ? "Edit Form" : "Create New Form"}</DialogTitle>
          <DialogDescription className="sr-only">Build a public-facing form that creates tasks when submitted.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Form Settings */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Form Title</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New Drop Off Form" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Target List</Label>
              <Select value={targetListId} onValueChange={handleTargetListChange}>
                <SelectTrigger><SelectValue placeholder="Select list" /></SelectTrigger>
                <SelectContent>
                  {lists.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.icon || "📋"} {l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {targetListId && availableCustomFields.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  No custom fields available for this list. Add custom fields to the list first to use them in forms.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Default Status</Label>
                <Select value={defaultStatus} onValueChange={(v) => setDefaultStatus(v as TaskStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {availableStatuses.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {targetListId && (() => {
                  const targetList = lists.find(l => l.id === targetListId);
                  const hasCustomStatuses = targetList?.customStatuses && targetList.customStatuses.length > 0;
                  return (
                    <p className="text-xs text-muted-foreground mt-1">
                      {hasCustomStatuses 
                        ? `Using custom statuses (${availableStatuses.length} options)`
                        : "Using default statuses"
                      }
                    </p>
                  );
                })()}
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Default Priority</Label>
                <Select value={defaultPriority} onValueChange={(v) => setDefaultPriority(v as TaskPriority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Separator />

          {/* Form Fields — placed near the top so they're easy to find */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <Label className="text-sm font-medium">Form Fields</Label>
              <Button variant="outline" size="sm" onClick={addField} className="h-7 text-xs">
                <Plus className="h-3 w-3 mr-1" /> Add Field
              </Button>
            </div>

            <div className="space-y-2">
              {fields.map((field, index) => (
                <div key={field.id} className="border border-border rounded-lg p-3 space-y-2 bg-card">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      value={field.label}
                      onChange={(e) => updateField(field.id, { label: e.target.value })}
                      placeholder="Field label"
                      className="h-8 text-sm flex-1"
                    />
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveField(index, -1)} disabled={index === 0}>
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveField(index, 1)} disabled={index === fields.length - 1}>
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeField(field.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <Select value={field.type || "text"} onValueChange={(v) => updateField(field.id, { type: v as CustomFieldType })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map(t => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={field.mapTo || "customField"} onValueChange={(v) => updateField(field.id, { mapTo: v as "title" | "description" | "customField", customFieldId: undefined })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="title">→ Task Title</SelectItem>
                        <SelectItem value="description">→ Description</SelectItem>
                        <SelectItem value="customField">→ Custom Field</SelectItem>
                      </SelectContent>
                    </Select>

                    {field.mapTo === "customField" && (
                      <Select
                        value={
                          field.customFieldId && availableCustomFields.find(cf => cf.id === field.customFieldId)
                            ? field.customFieldId
                            : ""
                        }
                        onValueChange={(v) => updateField(field.id, { customFieldId: v })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select field" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableCustomFields.length === 0 ? (
                            <SelectItem value="no-fields" disabled>No custom fields available for this list</SelectItem>
                          ) : (
                            <>
                              {field.customFieldId && !availableCustomFields.find(cf => cf.id === field.customFieldId) && (
                                <SelectItem value={field.customFieldId} disabled className="text-amber-600">
                                  ⚠️ Field not found - please select another
                                </SelectItem>
                              )}
                              {availableCustomFields.map(cf => (
                                <SelectItem key={cf.id} value={cf.id}>{cf.name}</SelectItem>
                              ))}
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`req-top-${field.id}`}
                        checked={field.required}
                        onCheckedChange={(checked) => updateField(field.id, { required: checked })}
                        className="scale-75"
                      />
                      <Label htmlFor={`req-top-${field.id}`} className="text-xs text-muted-foreground">Required</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`shared-top-${field.id}`}
                        checked={field.shared ?? false}
                        onCheckedChange={(checked) => updateField(field.id, { shared: checked })}
                        className="scale-75"
                      />
                      <Label htmlFor={`shared-top-${field.id}`} className="text-xs text-muted-foreground" title="Pre-filled once when booking multiple items — staff enters this field only once and it applies to all items">Shared</Label>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] h-5",
                        field.mapTo === "customField" && field.customFieldId === mapJobNumberToFieldId
                          ? "border-blue-400 bg-blue-50 text-blue-700"
                          : field.mapTo === "customField" && field.customFieldId && !availableCustomFields.find(c => c.id === field.customFieldId)
                          ? "border-amber-400 bg-amber-50 text-amber-700"
                          : ""
                      )}
                    >
                      {field.mapTo === "title"
                        ? "Task Title"
                        : field.mapTo === "description"
                        ? "Description"
                        : field.mapTo === "customField" && field.customFieldId === mapJobNumberToFieldId
                        ? "Auto-filled (job no.)"
                        : availableCustomFields.find(c => c.id === field.customFieldId)?.name
                        || (field.customFieldId ? "⚠️ Field not available" : "Unmapped")}
                    </Badge>
                  </div>

                  {field.type === "dropdown" && (
                    <Input
                      placeholder="Options (comma-separated)"
                      value={field.options?.join(", ") || ""}
                      onChange={(e) => updateField(field.id, { options: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                      className="h-8 text-xs"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Job Number prefix toggle */}
          <div className="space-y-0 rounded-lg border border-border px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Prefix title with job number</p>
                <p className="text-xs text-muted-foreground">Task title becomes: JOB-0001 – your title</p>
              </div>
              <Switch checked={prefixJobNumber} onCheckedChange={setPrefixJobNumber} />
            </div>
            <div className="pt-3 border-t border-border mt-3">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">
                Save auto-generated job number to custom field
                <span className="font-normal"> (required for job number to appear in task)</span>
              </p>
              <Select value={mapJobNumberToFieldId || "none"} onValueChange={(v) => setMapJobNumberToFieldId(v === "none" ? "" : v)}>
                <SelectTrigger className={cn("h-8 text-xs", mapJobNumberToFieldId && availableCustomFields.find(cf => cf.id === mapJobNumberToFieldId) && "border-green-500 bg-green-50 text-green-800")}>
                  <SelectValue placeholder="⚠️ Not set — job number won't save to a field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">⚠️ None — don't save to a field</SelectItem>
                  {availableCustomFields.length === 0 ? (
                    <SelectItem value="no-fields" disabled>No custom fields available for this list</SelectItem>
                  ) : (
                    availableCustomFields.map(cf => (
                      <SelectItem key={cf.id} value={cf.id}>{cf.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {mapJobNumberToFieldId && availableCustomFields.find(cf => cf.id === mapJobNumberToFieldId) && (
                <p className="text-xs text-green-700 mt-1">✓ Job number will be saved to: <strong>{availableCustomFields.find(cf => cf.id === mapJobNumberToFieldId)?.name}</strong></p>
              )}
              {mapJobNumberToFieldId && !availableCustomFields.find(cf => cf.id === mapJobNumberToFieldId) && (
                <p className="text-xs text-amber-600 mt-1">⚠️ Previously selected field no longer exists. Please re-select.</p>
              )}
            </div>
          </div>

          {/* iKhokha Deposit Payment */}
          <div className="space-y-0 rounded-lg border border-green-200 bg-green-50/50 dark:border-green-800/40 dark:bg-green-900/10 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">💳 iKhokha Deposit Payment</p>
              <p className="text-xs text-muted-foreground mt-0.5">When set, submitting this form will instantly open a card payment screen on your iKhokha device for the deposit amount.</p>
            </div>
            <div className="pt-3 border-t border-green-200/60 dark:border-green-800/30 mt-3">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Deposit amount field</p>
              <Select value={depositAmountFieldId || "none"} onValueChange={(v) => setDepositAmountFieldId(v === "none" ? "" : v)}>
                <SelectTrigger className={cn("h-8 text-xs", depositAmountFieldId && availableCustomFields.find(cf => cf.id === depositAmountFieldId) && "border-green-500 bg-green-50 text-green-800")}>
                  <SelectValue placeholder="Disabled — select a number field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Disabled — no auto-payment</SelectItem>
                  {availableCustomFields.length === 0 ? (
                    <SelectItem value="no-fields" disabled>No custom fields available for this list</SelectItem>
                  ) : (
                    availableCustomFields.map(cf => (
                      <SelectItem key={cf.id} value={cf.id}>{cf.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {depositAmountFieldId && availableCustomFields.find(cf => cf.id === depositAmountFieldId) && (
                <p className="text-xs text-green-700 mt-1">✓ Payment will be requested for: <strong>{availableCustomFields.find(cf => cf.id === depositAmountFieldId)?.name}</strong></p>
              )}
              {depositAmountFieldId && !availableCustomFields.find(cf => cf.id === depositAmountFieldId) && (
                <p className="text-xs text-amber-600 mt-1">⚠️ Previously selected field no longer exists. Please re-select.</p>
              )}
            </div>
          </div>

          {/* Thermal sticker print on submit */}
          <div className="space-y-0 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800/40 dark:bg-amber-900/10 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-300">🖨️ Thermal Sticker on Submit</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  After the task is created, print a sticker on the Xprinter (80mm) via USB. Reception sticks it on the item — no more handwriting wrong job numbers.
                </p>
                <p className="text-[11px] text-amber-700 mt-1">
                  Requires Chrome/Edge on a desktop plugged into the printer. First print prompts to pick the device once.
                </p>
              </div>
              <Switch checked={stickerEnabled} onCheckedChange={setStickerEnabled} />
            </div>

            {stickerEnabled && (
              <div className="pt-3 mt-3 border-t border-amber-200/60 dark:border-amber-800/30 space-y-3">

                {/* Live preview with test fields */}
                <div className="rounded border border-amber-300 bg-white/80 dark:bg-amber-950/40 p-3 space-y-3">
                  <Label className="text-xs font-semibold flex items-center gap-2">
                    👁 Live preview
                    <span className="text-[10px] font-normal text-muted-foreground">
                      — uses test values, updates as you change settings
                    </span>
                  </Label>

                  {/* Test field editor */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[11px]">Test job number</Label>
                      <Input
                        value={testJobNumber}
                        onChange={(e) => setTestJobNumber(e.target.value)}
                        className="h-7 text-xs mt-0.5"
                      />
                    </div>
                    <div>
                      <Label className="text-[11px]">Test customer name</Label>
                      <Input
                        value={testCustomerName}
                        onChange={(e) => setTestCustomerName(e.target.value)}
                        className="h-7 text-xs mt-0.5"
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-[11px]">Test date label</Label>
                      <Input
                        value={testDateLabel}
                        onChange={(e) => setTestDateLabel(e.target.value)}
                        className="h-7 text-xs mt-0.5"
                      />
                    </div>
                  </div>

                  {/* The preview */}
                  <div className="flex justify-center p-2 bg-gray-100 dark:bg-background rounded">
                    <StickerPreview
                      form={{
                        stickerShowJobNumber,
                        stickerShowCustomerName,
                        stickerShowDate,
                        stickerShowBarcode,
                        stickerShowQR,
                        stickerExtraFieldIds,
                        stickerLayout,
                        stickerUseLines,
                        stickerLines,
                        // Provide form.fields so the preview's custom-field
                        // segments can look up labels
                        fields,
                      } as any}
                      testValues={{
                        jobNumber: testJobNumber,
                        customerName: testCustomerName,
                        dateLabel: testDateLabel,
                        // For the lines preview: build extras for EVERY custom
                        // field that segments reference, plus the legacy extras list
                        extras: (() => {
                          const map = new Map<string, { label: string; value: string }>();
                          // Legacy extras
                          for (const id of stickerExtraFieldIds) {
                            const cf = availableCustomFields.find(f => f.id === id);
                            if (cf) {
                              map.set(cf.id, {
                                label: cf.name,
                                value: cf.type === "number" ? "123" : cf.type === "date" ? new Date().toISOString().slice(0, 10) : `Sample ${cf.name}`,
                              });
                            }
                          }
                          // New line/segment references
                          if (stickerUseLines) {
                            for (const line of stickerLines) {
                              for (const seg of line.segments || []) {
                                if (seg.source === "customField" && seg.customFieldId) {
                                  const cf = availableCustomFields.find(f => f.id === seg.customFieldId);
                                  if (cf && !map.has(cf.id)) {
                                    map.set(cf.id, {
                                      label: cf.name,
                                      value: cf.type === "number" ? "123" : cf.type === "date" ? new Date().toISOString().slice(0, 10) : `Sample ${cf.name}`,
                                    });
                                  }
                                }
                              }
                            }
                          }
                          return Array.from(map.values());
                        })(),
                        footer: stickerFooterText,
                      }}
                    />
                  </div>
                </div>

                {/* Template editor — per-row alignment + size */}
                <details className="rounded border border-amber-200/60 bg-white/60 dark:bg-amber-950/30 px-3 py-2" open>
                  <summary className="text-xs font-semibold cursor-pointer">📐 Template — alignment &amp; sizing</summary>
                  <div className="mt-3 space-y-3">
                    {/* Global layout */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[11px]">Paper width</Label>
                        <Select
                          value={stickerLayout.paperWidth || "80mm"}
                          onValueChange={(v) => setStickerLayout(prev => ({ ...prev, paperWidth: v as "58mm" | "80mm" }))}
                        >
                          <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="80mm">80mm (XP-Q200, XP-T80)</SelectItem>
                            <SelectItem value="58mm">58mm (smaller)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[11px]">Row spacing</Label>
                        <Input
                          type="number"
                          min={0}
                          max={3}
                          value={stickerLayout.rowSpacing ?? 0}
                          onChange={(e) => setStickerLayout(prev => ({ ...prev, rowSpacing: Math.max(0, Math.min(3, parseInt(e.target.value, 10) || 0)) }))}
                          className="h-7 text-xs mt-0.5"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px]">Top margin (lines)</Label>
                        <Input
                          type="number"
                          min={0}
                          max={5}
                          value={stickerLayout.topMargin ?? 0}
                          onChange={(e) => setStickerLayout(prev => ({ ...prev, topMargin: Math.max(0, Math.min(5, parseInt(e.target.value, 10) || 0)) }))}
                          className="h-7 text-xs mt-0.5"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px]">Bottom feed (lines)</Label>
                        <Input
                          type="number"
                          min={0}
                          max={5}
                          value={stickerLayout.bottomMargin ?? 3}
                          onChange={(e) => setStickerLayout(prev => ({ ...prev, bottomMargin: Math.max(0, Math.min(5, parseInt(e.target.value, 10) || 0)) }))}
                          className="h-7 text-xs mt-0.5"
                        />
                      </div>
                    </div>

                    {/* Grid sticker layout — visual editor */}
                    <div className="rounded border border-purple-200 bg-purple-50 dark:bg-purple-950/30 px-3 py-3 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Label className="text-xs font-semibold text-purple-900 dark:text-purple-200">
                            Grid sticker layout (raster mode)
                          </Label>
                          <p className="text-[10px] text-purple-800 dark:text-purple-300 mt-0.5">
                            For multi-up rolls (e.g. 2×2 grid of 30×20mm stickers). Drag the handles to align each column / row to its die-cut. All cells print identical content. Single 1×1 forms stay in fast text mode.
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-[11px]">Columns</Label>
                          <Select
                            value={String(stickerLayout.columns || 1)}
                            onValueChange={(v) => setStickerLayout(prev => ({ ...prev, columns: parseInt(v, 10) }))}
                          >
                            <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">1</SelectItem>
                              <SelectItem value="2">2</SelectItem>
                              <SelectItem value="3">3</SelectItem>
                              <SelectItem value="4">4</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[11px]">Rows</Label>
                          <Select
                            value={String(stickerLayout.rows || 1)}
                            onValueChange={(v) => setStickerLayout(prev => ({ ...prev, rows: parseInt(v, 10) }))}
                          >
                            <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">1</SelectItem>
                              <SelectItem value="2">2</SelectItem>
                              <SelectItem value="3">3</SelectItem>
                              <SelectItem value="4">4</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[11px]">Sticker width (mm)</Label>
                          <Input
                            type="number"
                            min={5}
                            max={100}
                            step={0.5}
                            value={stickerLayout.stickerWidthMm ?? 30}
                            onChange={(e) => setStickerLayout(prev => ({ ...prev, stickerWidthMm: Math.max(5, Math.min(100, parseFloat(e.target.value) || 0)) }))}
                            className="h-7 text-xs mt-0.5"
                          />
                        </div>
                        <div>
                          <Label className="text-[11px]">Sticker height (mm)</Label>
                          <Input
                            type="number"
                            min={5}
                            max={100}
                            step={0.5}
                            value={stickerLayout.stickerHeightMm ?? 20}
                            onChange={(e) => setStickerLayout(prev => ({ ...prev, stickerHeightMm: Math.max(5, Math.min(100, parseFloat(e.target.value) || 0)) }))}
                            className="h-7 text-xs mt-0.5"
                          />
                        </div>
                        <div>
                          <Label className="text-[11px]">Column gap (mm)</Label>
                          <Input
                            type="number"
                            min={0}
                            max={50}
                            step={0.5}
                            value={stickerLayout.columnGapMm ?? 2}
                            onChange={(e) => setStickerLayout(prev => ({ ...prev, columnGapMm: Math.max(0, Math.min(50, parseFloat(e.target.value) || 0)) }))}
                            className="h-7 text-xs mt-0.5"
                          />
                        </div>
                        <div>
                          <Label className="text-[11px]">Row gap (mm)</Label>
                          <Input
                            type="number"
                            min={0}
                            max={50}
                            step={0.5}
                            value={stickerLayout.rowGapMm ?? 3}
                            onChange={(e) => setStickerLayout(prev => ({ ...prev, rowGapMm: Math.max(0, Math.min(50, parseFloat(e.target.value) || 0)) }))}
                            className="h-7 text-xs mt-0.5"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 rounded border border-amber-300 bg-amber-100/60 dark:bg-amber-950/40 px-3 py-2">
                        <div className="text-[11px] text-amber-900 dark:text-amber-200">
                          <strong>Recalc column bounds</strong> from W / gap / offset above. Use this AFTER you change sticker width or column count.
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] border-amber-400 text-amber-900 hover:bg-amber-200"
                          onClick={() => {
                            const cols = Math.max(1, Math.min(4, stickerLayout.columns || 1));
                            const w = stickerLayout.stickerWidthMm ?? 30;
                            const gap = stickerLayout.columnGapMm ?? 2;
                            const off = stickerLayout.horizontalOffsetMm ?? 0;
                            const bounds = Array.from({ length: cols }, (_, i) => {
                              const left = off + i * (w + gap);
                              return { leftMm: left, rightMm: left + w };
                            });
                            setStickerLayout(prev => ({ ...prev, columnBoundsMm: bounds, rowOffsetsMm: [] }));
                            toast.success("Column bounds reset to match W/gap settings.");
                          }}
                        >
                          Reset bounds
                        </Button>
                      </div>

                      <StickerLayoutEditor
                        layout={stickerLayout}
                        onChange={(patch) => setStickerLayout(prev => ({ ...prev, ...patch }))}
                      />
                    </div>

                    {/* Per-row style controls */}
                    {(["jobNumber", "customerName", "date", "extras", "footer"] as const).map(rowKey => {
                      const labels: Record<typeof rowKey, string> = {
                        jobNumber: "Job number",
                        customerName: "Secondary",
                        date: "Date",
                        extras: "Extra fields",
                        footer: "Footer",
                      };
                      const row = stickerLayout[rowKey] || {};
                      return (
                        <div key={rowKey} className="grid grid-cols-[100px_1fr_1fr_72px] gap-2 items-center">
                          <Label className="text-[11px] font-medium">{labels[rowKey]}</Label>
                          <Select
                            value={row.align || "center"}
                            onValueChange={(v) => updateRowStyle(rowKey, { align: v as StickerRowAlign })}
                          >
                            <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="left">Left</SelectItem>
                              <SelectItem value="center">Centre</SelectItem>
                              <SelectItem value="right">Right</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select
                            value={row.size || "normal"}
                            onValueChange={(v) => updateRowStyle(rowKey, { size: v as StickerRowSize })}
                          >
                            <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="small">Small</SelectItem>
                              <SelectItem value="normal">Normal</SelectItem>
                              <SelectItem value="large">Large</SelectItem>
                              <SelectItem value="huge">Huge</SelectItem>
                            </SelectContent>
                          </Select>
                          <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!row.bold}
                              onChange={(e) => updateRowStyle(rowKey, { bold: e.target.checked })}
                              className="rounded"
                            />
                            Bold
                          </label>
                        </div>
                      );
                    })}

                    <p className="text-[10px] text-muted-foreground pt-1">
                      Thermal printers can't drag rows around — they print top to bottom in the order shown. Toggle a row in "Sticker contents" below to hide it.
                    </p>
                  </div>
                </details>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Copies per submission</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={stickerCount}
                      onChange={(e) => setStickerCount(parseInt(e.target.value, 10) || 1)}
                      className="h-8 text-xs mt-1"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">Sticker contents</Label>
                  </div>

                  {/* Mode toggle: legacy fixed-slot toggles vs. new line/segment builder */}
                  <div className="flex items-center justify-between rounded border-2 border-purple-300 bg-purple-50 dark:bg-purple-950/30 px-3 py-2">
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-purple-900 dark:text-purple-200">
                        Line-by-line editor (recommended)
                      </p>
                      <p className="text-[10px] text-purple-800 dark:text-purple-300 mt-0.5">
                        Build the sticker as Line 1, Line 2, … Each line can hold 1, 2 or 3 fields side-by-side. Map any field to any line.
                      </p>
                    </div>
                    <Switch checked={stickerUseLines} onCheckedChange={setStickerUseLines} />
                  </div>

                  {stickerUseLines && (
                    <div className="rounded border border-purple-200 bg-white/70 dark:bg-purple-950/20 p-2 space-y-2">
                      {stickerLines.map((line, lineIdx) => (
                        <div key={line.id} className="rounded border border-purple-300 bg-purple-50/60 dark:bg-purple-950/30 p-2 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-purple-900">Line {lineIdx + 1}</span>
                            <div className="flex gap-1">
                              <Button
                                type="button" variant="ghost" size="sm"
                                className="h-6 w-6 p-0 text-[14px]"
                                disabled={lineIdx === 0}
                                onClick={() => {
                                  const next = [...stickerLines];
                                  [next[lineIdx - 1], next[lineIdx]] = [next[lineIdx], next[lineIdx - 1]];
                                  setStickerLines(next);
                                }}
                              >↑</Button>
                              <Button
                                type="button" variant="ghost" size="sm"
                                className="h-6 w-6 p-0 text-[14px]"
                                disabled={lineIdx === stickerLines.length - 1}
                                onClick={() => {
                                  const next = [...stickerLines];
                                  [next[lineIdx + 1], next[lineIdx]] = [next[lineIdx], next[lineIdx + 1]];
                                  setStickerLines(next);
                                }}
                              >↓</Button>
                              <Button
                                type="button" variant="ghost" size="sm"
                                className="h-6 px-1 text-[10px] text-red-700"
                                onClick={() => setStickerLines(stickerLines.filter((_, i) => i !== lineIdx))}
                              >Delete</Button>
                            </div>
                          </div>

                          {/* Segments — auto-split equal width */}
                          <div className="flex gap-1">
                            {line.segments.map((seg, segIdx) => (
                              <div key={segIdx} className="flex-1 rounded border border-purple-200 bg-white p-1.5 space-y-1">
                                <Select
                                  value={seg.source}
                                  onValueChange={(v) => {
                                    const next = [...stickerLines];
                                    next[lineIdx] = {
                                      ...line,
                                      segments: line.segments.map((s, i) => i === segIdx ? { ...s, source: v as any, customFieldId: v === "customField" ? s.customFieldId : undefined } : s),
                                    };
                                    setStickerLines(next);
                                  }}
                                >
                                  <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="jobNumber">Job #</SelectItem>
                                    <SelectItem value="customField">Custom field</SelectItem>
                                    <SelectItem value="date">Date</SelectItem>
                                    <SelectItem value="static">Static text</SelectItem>
                                    <SelectItem value="barcode">Barcode</SelectItem>
                                    <SelectItem value="qr">QR code</SelectItem>
                                    <SelectItem value="blank">— blank —</SelectItem>
                                  </SelectContent>
                                </Select>

                                {seg.source === "customField" && (
                                  <Select
                                    value={seg.customFieldId || "none"}
                                    onValueChange={(v) => {
                                      const next = [...stickerLines];
                                      next[lineIdx] = {
                                        ...line,
                                        segments: line.segments.map((s, i) => i === segIdx ? { ...s, customFieldId: v === "none" ? undefined : v } : s),
                                      };
                                      setStickerLines(next);
                                    }}
                                  >
                                    <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Pick field" /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">— pick —</SelectItem>
                                      {availableCustomFields.map(cf => (
                                        <SelectItem key={cf.id} value={cf.id}>{cf.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}

                                {seg.source === "static" && (
                                  <Input
                                    value={seg.staticText || ""}
                                    onChange={(e) => {
                                      const next = [...stickerLines];
                                      next[lineIdx] = {
                                        ...line,
                                        segments: line.segments.map((s, i) => i === segIdx ? { ...s, staticText: e.target.value } : s),
                                      };
                                      setStickerLines(next);
                                    }}
                                    placeholder="text"
                                    className="h-6 text-[10px]"
                                  />
                                )}

                                {(seg.source === "customField" || seg.source === "jobNumber" || seg.source === "date" || seg.source === "static") && (
                                  <Input
                                    value={seg.prefix || ""}
                                    onChange={(e) => {
                                      const next = [...stickerLines];
                                      next[lineIdx] = {
                                        ...line,
                                        segments: line.segments.map((s, i) => i === segIdx ? { ...s, prefix: e.target.value } : s),
                                      };
                                      setStickerLines(next);
                                    }}
                                    placeholder="Prefix (e.g. 'Fault:')"
                                    className="h-6 text-[10px]"
                                  />
                                )}

                                <div className="flex gap-1">
                                  <Select
                                    value={seg.size || "normal"}
                                    onValueChange={(v) => {
                                      const next = [...stickerLines];
                                      next[lineIdx] = {
                                        ...line,
                                        segments: line.segments.map((s, i) => i === segIdx ? { ...s, size: v as any } : s),
                                      };
                                      setStickerLines(next);
                                    }}
                                  >
                                    <SelectTrigger className="h-5 text-[9px] px-1.5"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="small">S</SelectItem>
                                      <SelectItem value="normal">M</SelectItem>
                                      <SelectItem value="large">L</SelectItem>
                                      <SelectItem value="huge">XL</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <Select
                                    value={seg.align || "center"}
                                    onValueChange={(v) => {
                                      const next = [...stickerLines];
                                      next[lineIdx] = {
                                        ...line,
                                        segments: line.segments.map((s, i) => i === segIdx ? { ...s, align: v as any } : s),
                                      };
                                      setStickerLines(next);
                                    }}
                                  >
                                    <SelectTrigger className="h-5 text-[9px] px-1.5"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="left">⇤</SelectItem>
                                      <SelectItem value="center">⇔</SelectItem>
                                      <SelectItem value="right">⇥</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <button
                                    type="button"
                                    className={`h-5 w-7 text-[9px] rounded border ${seg.bold ? "bg-purple-700 text-white border-purple-700" : "border-purple-200 text-purple-700"}`}
                                    onClick={() => {
                                      const next = [...stickerLines];
                                      next[lineIdx] = {
                                        ...line,
                                        segments: line.segments.map((s, i) => i === segIdx ? { ...s, bold: !s.bold } : s),
                                      };
                                      setStickerLines(next);
                                    }}
                                  >B</button>
                                  {line.segments.length > 1 && (
                                    <button
                                      type="button"
                                      className="h-5 w-5 text-[9px] text-red-600"
                                      onClick={() => {
                                        const next = [...stickerLines];
                                        next[lineIdx] = { ...line, segments: line.segments.filter((_, i) => i !== segIdx) };
                                        setStickerLines(next);
                                      }}
                                    >✕</button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>

                          {line.segments.length < 3 && (
                            <Button
                              type="button" variant="outline" size="sm"
                              className="h-6 text-[10px] w-full border-purple-300"
                              onClick={() => {
                                const next = [...stickerLines];
                                next[lineIdx] = {
                                  ...line,
                                  segments: [...line.segments, { source: "static", staticText: "", align: "center", size: "normal", bold: false }],
                                };
                                setStickerLines(next);
                              }}
                            >
                              + Add segment to this line
                            </Button>
                          )}
                        </div>
                      ))}

                      {stickerLines.length < 6 && (
                        <Button
                          type="button" variant="outline" size="sm"
                          className="h-7 text-xs w-full border-purple-400 bg-purple-50"
                          onClick={() => {
                            setStickerLines([
                              ...stickerLines,
                              { id: makeLineId(), segments: [{ source: "static", staticText: "", align: "center", size: "normal", bold: false }] },
                            ]);
                          }}
                        >
                          + Add line (max 6)
                        </Button>
                      )}

                      <p className="text-[10px] text-purple-700 italic">
                        Each line is auto-split into equal segments. 1 segment = full width · 2 segments = halves · 3 segments = thirds.
                      </p>
                    </div>
                  )}

                  {!stickerUseLines && (
                    <Label className="text-xs font-semibold pt-1">Legacy fixed slots — tick what to print</Label>
                  )}

                  {!stickerUseLines && (
                  <>
                  {/* Quick presets — one-click common combos */}
                  <div className="flex flex-wrap gap-1.5 rounded border border-amber-300 bg-amber-100/50 dark:bg-amber-950/40 px-2 py-1.5">
                    <span className="text-[10px] text-amber-900 dark:text-amber-200 self-center mr-1">Presets:</span>
                    <Button
                      type="button" variant="outline" size="sm"
                      className="h-6 text-[10px] px-2 border-amber-400"
                      onClick={() => {
                        setStickerShowJobNumber(true);
                        setStickerShowCustomerName(false);
                        setStickerShowDate(false);
                        setStickerShowBarcode(false);
                        setStickerShowQR(false);
                        setStickerExtraFieldIds([]);
                      }}
                    >
                      Job # only
                    </Button>
                    <Button
                      type="button" variant="outline" size="sm"
                      className="h-6 text-[10px] px-2 border-amber-400"
                      onClick={() => {
                        setStickerShowJobNumber(true);
                        setStickerShowCustomerName(true);
                        setStickerShowDate(false);
                        setStickerShowBarcode(false);
                        setStickerShowQR(false);
                      }}
                    >
                      Job # + Customer
                    </Button>
                    <Button
                      type="button" variant="outline" size="sm"
                      className="h-6 text-[10px] px-2 border-amber-400"
                      onClick={() => {
                        setStickerShowJobNumber(true);
                        setStickerShowCustomerName(true);
                        setStickerShowDate(true);
                        setStickerShowBarcode(false);
                        setStickerShowQR(false);
                      }}
                    >
                      Job # + Customer + Date
                    </Button>
                    <Button
                      type="button" variant="outline" size="sm"
                      className="h-6 text-[10px] px-2 border-amber-400"
                      onClick={() => {
                        setStickerShowJobNumber(true);
                        setStickerShowCustomerName(false);
                        setStickerShowDate(false);
                        setStickerShowBarcode(true);
                        setStickerShowQR(false);
                      }}
                    >
                      Job # + Barcode
                    </Button>
                  </div>

                  <div className="flex items-center justify-between rounded border border-amber-200/60 bg-white/60 dark:bg-amber-950/30 px-3 py-1.5">
                    <span className="text-xs">Big job number (top)</span>
                    <Switch checked={stickerShowJobNumber} onCheckedChange={setStickerShowJobNumber} />
                  </div>

                  <div className="rounded border border-amber-200/60 bg-white/60 dark:bg-amber-950/30 px-3 py-1.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs">
                        Secondary line
                        {stickerCustomerNameFieldId && stickerShowCustomerName && (
                          <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-300">
                            — currently: <strong>{availableCustomFields.find(cf => cf.id === stickerCustomerNameFieldId)?.name || "—"}</strong>
                          </span>
                        )}
                      </span>
                      <Switch checked={stickerShowCustomerName} onCheckedChange={setStickerShowCustomerName} />
                    </div>
                    {stickerShowCustomerName && (
                      <>
                        <p className="text-[10px] text-muted-foreground">
                          Pick which field to print on the second row (customer name, fault description, whatever you want highlighted).
                        </p>
                        <Select
                          value={stickerCustomerNameFieldId || "none"}
                          onValueChange={(v) => setStickerCustomerNameFieldId(v === "none" ? "" : v)}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="Pick a field" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— no field —</SelectItem>
                            {availableCustomFields.map(cf => (
                              <SelectItem key={cf.id} value={cf.id}>{cf.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </>
                    )}
                  </div>

                  <div className="flex items-center justify-between rounded border border-amber-200/60 bg-white/60 dark:bg-amber-950/30 px-3 py-1.5">
                    <span className="text-xs">Date received</span>
                    <Switch checked={stickerShowDate} onCheckedChange={setStickerShowDate} />
                  </div>

                  <div className="flex items-center justify-between rounded border border-amber-200/60 bg-white/60 dark:bg-amber-950/30 px-3 py-1.5">
                    <span className="text-xs">Barcode of job number (scannable)</span>
                    <Switch checked={stickerShowBarcode} onCheckedChange={setStickerShowBarcode} />
                  </div>

                  <div className="flex items-center justify-between rounded border border-amber-200/60 bg-white/60 dark:bg-amber-950/30 px-3 py-1.5">
                    <span className="text-xs">QR code of job number</span>
                    <Switch checked={stickerShowQR} onCheckedChange={setStickerShowQR} />
                  </div>
                  </>
                  )}
                </div>

                {!stickerUseLines && (
                <div>
                  <Label className="text-xs">Extra fields to include</Label>
                  <p className="text-[11px] text-muted-foreground mb-1">Tick custom fields to print below the header (e.g. model, serial, complaint).</p>
                  <div className="rounded border border-amber-200/60 bg-white/60 dark:bg-amber-950/30 p-2 max-h-32 overflow-y-auto space-y-1">
                    {availableCustomFields.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">No custom fields available.</p>
                    ) : availableCustomFields.map(cf => (
                      <label key={cf.id} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={stickerExtraFieldIds.includes(cf.id)}
                          onChange={(e) => {
                            setStickerExtraFieldIds(prev =>
                              e.target.checked
                                ? [...prev, cf.id]
                                : prev.filter(id => id !== cf.id)
                            );
                          }}
                          className="rounded"
                        />
                        {cf.name}
                      </label>
                    ))}
                  </div>
                </div>
                )}

                {!stickerUseLines && (
                <div>
                  <Label className="text-xs">Footer text</Label>
                  <Input
                    value={stickerFooterText}
                    onChange={(e) => setStickerFooterText(e.target.value)}
                    placeholder="Your Business · 074 000 0000"
                    className="h-8 text-xs mt-1"
                  />
                </div>
                )}

                <div className="pt-2 border-t border-amber-200/60 dark:border-amber-800/30 space-y-2">
                  <div className="rounded border border-amber-200/60 bg-white/60 dark:bg-amber-950/30 px-3 py-2">
                    <Label className="text-xs font-semibold">Printer assigned to this form</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex-1 min-w-0 text-xs text-amber-900 dark:text-amber-200 truncate">
                        {stickerPrinterLabel
                          ? <span><strong>{stickerPrinterLabel}</strong>{stickerPrinterVendorId != null && (
                              <span className="text-[10px] text-amber-700 ml-1">
                                ({stickerPrinterVendorId.toString(16)}:{(stickerPrinterProductId ?? 0).toString(16)})
                              </span>
                            )}</span>
                          : <span className="text-muted-foreground italic">No printer picked yet — click below.</span>}
                      </div>
                      {stickerPrinterLabel && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setStickerPrinterVendorId(undefined);
                            setStickerPrinterProductId(undefined);
                            setStickerPrinterLabel("");
                          }}
                          className="h-7 px-2 text-[11px] text-amber-700 hover:bg-amber-100"
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          const { pickPrinter } = await import("@/lib/thermalPrinterService");
                          const picked = await pickPrinter();
                          setStickerPrinterVendorId(picked.vendorId);
                          setStickerPrinterProductId(picked.productId);
                          setStickerPrinterLabel(picked.label);
                          toast.success(`Printer set: ${picked.label}`);
                        } catch (err: any) {
                          const msg = err?.message || String(err);
                          if (msg.toLowerCase().includes("no device selected") || msg.toLowerCase().includes("cancel")) {
                            toast.message("Cancelled — no device picked");
                          } else {
                            toast.error("Could not pick printer: " + msg);
                          }
                        }
                      }}
                      className="h-8 mt-2 text-xs gap-1.5 border-amber-300 text-amber-900 hover:bg-amber-100"
                    >
                      {stickerPrinterLabel ? "Change printer" : "Pick printer"}
                    </Button>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Opens the browser's USB device picker. Each form can use a different printer.
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const {
                          isThermalPrintSupported,
                          printJobStickers,
                        } = await import("@/lib/thermalPrinterService");
                        if (!isThermalPrintSupported()) {
                          toast.error("WebUSB not available — use Chrome or Edge on the desktop plugged into the printer.");
                          return;
                        }
                        // Build a dummy form snapshot using the in-flight (unsaved) config
                        const previewForm = {
                          stickerEnabled: true,
                          stickerCount: 1,
                          stickerShowJobNumber,
                          stickerShowCustomerName,
                          stickerShowDate,
                          stickerShowBarcode,
                          stickerShowQR,
                          stickerExtraFieldIds,
                          stickerFooterText,
                          stickerPrinterVendorId,
                          stickerPrinterProductId,
                          stickerLayout,
                        } as any;
                        const extras = stickerExtraFieldIds
                          .map(id => availableCustomFields.find(cf => cf.id === id))
                          .filter(Boolean)
                          .map(cf => ({
                            label: cf!.name,
                            value: cf!.type === "number" ? "123" :
                                   cf!.type === "date" ? new Date().toISOString().slice(0, 10) :
                                   `Sample ${cf!.name}`,
                          }));
                        await printJobStickers(
                          previewForm,
                          {
                            jobNumber: testJobNumber || "JOB-TEST",
                            customerName: stickerShowCustomerName ? (testCustomerName || "Test Customer") : undefined,
                            dateLabel: stickerShowDate ? (testDateLabel || new Date().toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })) : undefined,
                            extras,
                            footer: stickerFooterText,
                          },
                          1,
                        );
                        toast.success("Test sticker sent to printer");
                      } catch (err: any) {
                        const msg = err?.message || String(err);
                        if (msg.toLowerCase().includes("no device selected") || msg.toLowerCase().includes("cancel")) {
                          toast.message("Cancelled — no printer picked");
                        } else {
                          toast.error("Test print failed: " + msg);
                        }
                      }
                    }}
                    className="h-8 text-xs gap-1.5 border-amber-300 text-amber-900 hover:bg-amber-100"
                  >
                    🖨️ Test print sticker
                  </Button>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Prints one test sticker with sample values. First print only — Chrome will ask you to pick the Xprinter.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Title Template */}
          <div className="space-y-2 rounded-lg border border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Task Title Template</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Combine multiple fields and static text into the task title. Click a field button to insert its token.
              </p>
            </div>
            <textarea
              ref={titleTemplateRef}
              value={titleTemplate}
              onChange={e => setTitleTemplate(e.target.value)}
              placeholder={`e.g.  Repair: {name} – {model} | Serial: {serial}`}
              rows={2}
              className="w-full text-sm border border-input rounded-md px-3 py-2 bg-background resize-none font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {fields.filter(f => f.label).length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-muted-foreground">Insert field:</span>
                <button
                  type="button"
                  onClick={() => {
                    const token = "{jobNumber}";
                    const ta = titleTemplateRef.current;
                    if (!ta) { setTitleTemplate(prev => prev + token); return; }
                    const start = ta.selectionStart ?? titleTemplate.length;
                    const end = ta.selectionEnd ?? titleTemplate.length;
                    const newVal = titleTemplate.slice(0, start) + token + titleTemplate.slice(end);
                    setTitleTemplate(newVal);
                    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + token.length, start + token.length); });
                  }}
                  className="text-xs px-2 py-0.5 rounded border border-amber-400/60 bg-amber-50 hover:bg-amber-100 text-amber-700 font-mono transition-colors dark:bg-amber-900/20 dark:text-amber-400"
                >
                  {`{jobNumber}`}
                </button>
                {fields.filter(f => f.label).map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => insertToken(f.id)}
                    className="text-xs px-2 py-0.5 rounded border border-primary/40 bg-primary/5 hover:bg-primary/20 text-primary font-mono transition-colors"
                  >
                    {`{${f.label}}`}
                  </button>
                ))}
              </div>
            )}
            {fields.filter(f => f.label).length === 0 && (
              <p className="text-xs text-muted-foreground">Add form fields below to insert tokens here</p>
            )}
            {titleTemplate.trim() && (
              <div className="text-xs bg-muted rounded px-2.5 py-1.5">
                <span className="text-muted-foreground font-medium">Preview: </span>
                <span className="font-mono">
                  {titleTemplate.replace(/\{([^}]+)\}/g, (match, id) => {
                    if (id === "jobNumber") return "[JOB-0001]";
                    const f = fields.find(ff => ff.id === id);
                    return f ? `[${f.label || "value"}]` : match;
                  })}
                </span>
              </div>
            )}
            {!titleTemplate.trim() && (
              <p className="text-xs text-muted-foreground">
                Leave blank to use the field(s) mapped to <strong>Task Title</strong> below.
              </p>
            )}
          </div>

          {existingForm && (
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Form URL</Label>
              <div className="flex gap-2">
                <Input value={formUrl} readOnly className="text-xs bg-muted" />
                <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(formUrl); toast.success("URL copied"); }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => window.open(formUrl, "_blank")}>
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">Embed Code</Label>
                <div className="bg-muted rounded-md p-2">
                  <code className="text-xs break-all text-muted-foreground">
                    {`<iframe src="${formUrl}" width="100%" height="600" frameborder="0"></iframe>`}
                  </code>
                </div>
                <Button
                  variant="ghost" size="sm" className="text-xs h-7"
                  onClick={() => { navigator.clipboard.writeText(`<iframe src="${formUrl}" width="100%" height="600" frameborder="0"></iframe>`); toast.success("Embed code copied"); }}
                >
                  <Copy className="h-3 w-3 mr-1" /> Copy embed code
                </Button>
              </div>
            </div>
          )}

        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>{existingForm ? "Save Changes" : "Create Form"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
