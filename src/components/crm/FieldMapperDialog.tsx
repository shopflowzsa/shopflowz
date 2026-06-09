import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Map, User, Phone, Mail, Briefcase, Plus, Trash2, GripVertical, ChevronDown, ChevronRight, DollarSign } from "lucide-react";
import { CustomFieldDefinition } from "@/types/crm";
import {
  FieldMapping,
  LineItemTemplateConfig,
  DEFAULT_FIELD_MAPPING,
  loadFieldMapping,
  saveFieldMapping,
} from "@/lib/fieldMapperService";

interface Props {
  open: boolean;
  onClose: () => void;
  customFields: CustomFieldDefinition[];
}

const NONE_VALUE = "__none__";

function newTemplate(): LineItemTemplateConfig {
  return {
    id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label: "New Line",
    serviceTemplate: "",
    descriptionTemplate: "",
    rateFieldId: "",
    quantityFieldId: "",
    defaultQuantity: 1,
    defaultRate: 0,
  };
}

/** Tiny component: click a chip to insert {Field Name} at cursor in an input */
function FieldChips({ fields, onInsert }: { fields: CustomFieldDefinition[]; onInsert: (name: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {fields.map(f => (
        <button
          key={f.id}
          type="button"
          onClick={() => onInsert(f.name)}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20"
          title={`Insert {${f.name}}`}
        >
          {`{${f.name}}`}
        </button>
      ))}
    </div>
  );
}

/** Input that supports field chip insertion at cursor position */
function TemplateInput({ value, onChange, placeholder, customFields }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  customFields: CustomFieldDefinition[];
}) {
  const ref = useRef<HTMLInputElement>(null);

  const insertAtCursor = (fieldName: string) => {
    const el = ref.current;
    if (!el) { onChange(value + `{${fieldName}}`); return; }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + `{${fieldName}}` + value.slice(end);
    onChange(next);
    // restore focus + cursor after state update
    setTimeout(() => {
      el.focus();
      const pos = start + fieldName.length + 2;
      el.setSelectionRange(pos, pos);
    }, 0);
  };

  return (
    <div className="space-y-1">
      <Input ref={ref} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="h-8 text-sm font-mono" />
      {customFields.length > 0 && <FieldChips fields={customFields} onInsert={insertAtCursor} />}
    </div>
  );
}

export function FieldMapperDialog({ open, onClose, customFields }: Props) {
  const { workspaceId } = useAuth();
  const { toast } = useToast();
  const [mapping, setMapping] = useState<FieldMapping>(DEFAULT_FIELD_MAPPING);
  const [saving, setSaving] = useState(false);
  const [expandedTemplates, setExpandedTemplates] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open && workspaceId) {
      loadFieldMapping(workspaceId).then(m => {
        setMapping(m);
        setExpandedTemplates(new Set(m.lineItemTemplates.map(t => t.id)));
      });
    }
  }, [open, workspaceId]);

  const setField = (key: keyof Omit<FieldMapping, 'lineItemTemplates'>, value: string) => {
    setMapping(prev => ({ ...prev, [key]: value === NONE_VALUE ? "" : value }));
  };

  const addTemplate = () => {
    const tpl = newTemplate();
    setMapping(prev => ({ ...prev, lineItemTemplates: [...prev.lineItemTemplates, tpl] }));
    setExpandedTemplates(prev => new Set([...prev, tpl.id]));
  };

  const removeTemplate = (id: string) => {
    setMapping(prev => ({ ...prev, lineItemTemplates: prev.lineItemTemplates.filter(t => t.id !== id) }));
  };

  const updateTemplate = (id: string, patch: Partial<LineItemTemplateConfig>) => {
    setMapping(prev => ({
      ...prev,
      lineItemTemplates: prev.lineItemTemplates.map(t => t.id === id ? { ...t, ...patch } : t),
    }));
  };

  const toggleExpand = (id: string) => {
    setExpandedTemplates(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      await saveFieldMapping(workspaceId, mapping);
      toast({ title: "Field mapping saved", description: "Quote and invoice generation will now use your configured fields." });
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to save field mapping.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Map className="h-5 w-5 text-primary" />
            Quote / Invoice Field Mapper
          </DialogTitle>
          <DialogDescription>
            Map CRM custom fields to quote fields, and configure multi-line item templates using{" "}
            <code className="text-xs bg-muted px-1 rounded">{"{Field Name}"}</code> placeholders.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 pr-1">
          {/* ── Customer Fields ── */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Customer Fields</h3>
            {[
              { key: "customerNameFieldId" as const, label: "Customer Name", icon: <User className="h-4 w-4 text-blue-400" />, badge: "Required" },
              { key: "customerPhoneFieldId" as const, label: "Customer Phone", icon: <Phone className="h-4 w-4 text-green-400" /> },
              { key: "customerEmailFieldId" as const, label: "Customer Email", icon: <Mail className="h-4 w-4 text-orange-400" /> },
              { key: "depositFieldId" as const, label: "Deposit / Amount Paid", icon: <DollarSign className="h-4 w-4 text-emerald-400" />, description: "Maps to 'Deposit' field on invoices — auto-subtracts from total" },
              { key: "jobReferenceFieldId" as const, label: "Job Reference Override", icon: <Briefcase className="h-4 w-4 text-slate-400" /> },
            ].map(row => (
              <div key={row.key} className="space-y-1">
                <Label className="flex items-center gap-2 text-sm">
                  {row.icon} {row.label}
                  {row.badge && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{row.badge}</Badge>}
                </Label>
                {row.description && <p className="text-xs text-muted-foreground">{row.description}</p>}
                <Select value={mapping[row.key] || NONE_VALUE} onValueChange={val => setField(row.key, val)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="— auto-detect —" />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={5}>
                    <SelectItem value={NONE_VALUE}><span className="text-muted-foreground italic">— Not mapped (auto-detect) —</span></SelectItem>
                    {customFields.map(cf => (
                      <SelectItem key={cf.id} value={cf.id}>
                        {cf.name} <span className="text-muted-foreground text-xs ml-1">({cf.type})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <Separator />

          {/* ── Line Item Templates ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Line Item Templates</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Each row becomes a line item on the quote. Use{" "}
                  <code className="bg-muted px-1 rounded text-primary">{"{Field Name}"}</code>{" "}
                  — click a chip to insert. Leave empty to use spare-parts / task-title fallback.
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={addTemplate} className="gap-1.5 text-xs">
                <Plus className="h-3.5 w-3.5" /> Add Line
              </Button>
            </div>

            {mapping.lineItemTemplates.length === 0 && (
              <div className="text-sm text-muted-foreground italic border border-dashed rounded-lg px-4 py-6 text-center">
                No templates — quotes will auto-build from spare parts / task title.<br />
                Click <strong>Add Line</strong> to define custom line items.
              </div>
            )}

            {mapping.lineItemTemplates.map((tpl, idx) => {
              const expanded = expandedTemplates.has(tpl.id);
              return (
                <div key={tpl.id} className="border rounded-lg overflow-hidden">
                  {/* Header row */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/40">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground font-mono shrink-0">#{idx + 1}</span>
                    <Input
                      value={tpl.label}
                      onChange={e => updateTemplate(tpl.id, { label: e.target.value })}
                      placeholder="Line label (e.g. Booking Description)"
                      className="h-7 text-sm border-0 bg-transparent p-0 focus-visible:ring-0 font-medium flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => toggleExpand(tpl.id)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTemplate(tpl.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {expanded && (
                    <div className="p-3 space-y-4 bg-background">
                      {/* Service / Product template */}
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Product / Service line</Label>
                        <p className="text-[11px] text-muted-foreground">
                          Main description shown in the first column. Click a field chip below to insert it.
                        </p>
                        <TemplateInput
                          value={tpl.serviceTemplate}
                          onChange={v => updateTemplate(tpl.id, { serviceTemplate: v })}
                          placeholder={`e.g. 1x {Model} booked in with fault: {Fault Description}`}
                          customFields={customFields}
                        />
                      </div>

                      {/* Description sub-line */}
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Description sub-line</Label>
                        <p className="text-[11px] text-muted-foreground">
                          Second smaller line under the product name (optional).
                        </p>
                        <TemplateInput
                          value={tpl.descriptionTemplate}
                          onChange={v => updateTemplate(tpl.id, { descriptionTemplate: v })}
                          placeholder={`e.g. Repair done: {Section}   or   Job #{job number}`}
                          customFields={customFields}
                        />
                      </div>

                      {/* Rate + Qty */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs font-medium">Rate from field</Label>
                          <Select value={tpl.rateFieldId || NONE_VALUE} onValueChange={val => updateTemplate(tpl.id, { rateFieldId: val === NONE_VALUE ? "" : val })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Fixed rate" /></SelectTrigger>
                            <SelectContent position="popper" sideOffset={5}>
                              <SelectItem value={NONE_VALUE}><span className="italic text-muted-foreground">Fixed default below</span></SelectItem>
                              {customFields.map(cf => (
                                <SelectItem key={cf.id} value={cf.id}>
                                  {cf.name} <span className="text-muted-foreground text-xs ml-1">({cf.type})</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {!tpl.rateFieldId && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-xs text-muted-foreground">Default R</span>
                              <Input type="number" value={tpl.defaultRate} min={0} onChange={e => updateTemplate(tpl.id, { defaultRate: parseFloat(e.target.value) || 0 })} className="h-7 text-xs w-24" />
                            </div>
                          )}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium">Qty from field</Label>
                          <Select value={tpl.quantityFieldId || NONE_VALUE} onValueChange={val => updateTemplate(tpl.id, { quantityFieldId: val === NONE_VALUE ? "" : val })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Fixed qty" /></SelectTrigger>
                            <SelectContent position="popper" sideOffset={5}>
                              <SelectItem value={NONE_VALUE}><span className="italic text-muted-foreground">Fixed default below</span></SelectItem>
                              {customFields.map(cf => (
                                <SelectItem key={cf.id} value={cf.id}>
                                  {cf.name} <span className="text-muted-foreground text-xs ml-1">({cf.type})</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {!tpl.quantityFieldId && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-xs text-muted-foreground">Default qty</span>
                              <Input type="number" value={tpl.defaultQuantity} min={1} onChange={e => updateTemplate(tpl.id, { defaultQuantity: parseInt(e.target.value) || 1 })} className="h-7 text-xs w-20" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t mt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Mapping"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
