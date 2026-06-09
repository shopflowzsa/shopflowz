import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, GripVertical, Pencil, Trash2, Check, X } from "lucide-react";
import { CustomFieldDefinition, CustomFieldType } from "@/types/crm";

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  dropdown: "Dropdown",
  date: "Date",
  checkbox: "Checkbox",
  email: "Email",
  phone: "Phone",
  url: "URL",
};

const FIELD_TYPE_ICONS: Record<CustomFieldType, string> = {
  text: "T",
  number: "#",
  dropdown: "▾",
  date: "📅",
  checkbox: "☑",
  email: "@",
  phone: "📞",
  url: "🔗",
};

interface CustomFieldsManagerProps {
  open: boolean;
  onClose: () => void;
  allFields: CustomFieldDefinition[];
  visibleFieldIds: string[];
  contextName: string;
  contextType: "space" | "folder" | "list";
  onToggleField: (fieldId: string) => void;
  onCreateField: (field: Omit<CustomFieldDefinition, "id">) => void;
  onEditField: (id: string, changes: Partial<Omit<CustomFieldDefinition, "id">>) => void;
  onDeleteField: (id: string) => void;
}

export function CustomFieldsManager({
  open, onClose, allFields, visibleFieldIds, contextName, contextType,
  onToggleField, onCreateField, onEditField, onDeleteField,
}: CustomFieldsManagerProps) {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<CustomFieldType>("text");
  const [newOptions, setNewOptions] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<CustomFieldType>("text");
  const [editOptions, setEditOptions] = useState("");

  const startEdit = (field: CustomFieldDefinition) => {
    setEditingId(field.id);
    setEditName(field.name);
    setEditType(field.type);
    setEditOptions(field.options?.join(", ") ?? "");
    setShowCreate(false);
  };

  const commitEdit = (field: CustomFieldDefinition) => {
    if (!editName.trim()) return;
    const changes: Partial<Omit<CustomFieldDefinition, "id">> = { 
      name: editName.trim(),
      type: editType
    };
    if (editType === "dropdown") {
      changes.options = editOptions.split(",").map(o => o.trim()).filter(Boolean);
    } else {
      // Clear options if switching away from dropdown
      changes.options = undefined;
    }
    onEditField(field.id, changes);
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  const filtered = allFields.filter(f =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  // Group by type
  const grouped = filtered.reduce<Record<string, CustomFieldDefinition[]>>((acc, f) => {
    (acc[f.type] = acc[f.type] || []).push(f);
    return acc;
  }, {});

  const handleCreate = () => {
    if (!newName.trim()) return;
    const field: Omit<CustomFieldDefinition, "id"> = {
      name: newName.trim(),
      type: newType,
      ...(newType === "dropdown" && newOptions ? { options: newOptions.split(",").map(o => o.trim()).filter(Boolean) } : {}),
    };
    onCreateField(field);
    setNewName("");
    setNewType("text");
    setNewOptions("");
    setShowCreate(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Custom Fields
            <Badge variant="outline" className="text-xs font-normal">{contextName}</Badge>
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Fields are created globally. Toggle visibility for this {contextType}.
          </p>
        </DialogHeader>

        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search fields..."
              className="h-8 pl-8 text-sm"
            />
          </div>
          <Button size="sm" className="h-8" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Create new field
          </Button>
        </div>

        {showCreate && (
          <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/30">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs">Field Name</Label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} className="h-8" placeholder="e.g. Contact Number" autoFocus />
              </div>
              <div className="w-36">
                <Label className="text-xs">Type</Label>
                <Select value={newType} onValueChange={v => setNewType(v as CustomFieldType)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(FIELD_TYPE_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {newType === "dropdown" && (
              <div>
                <Label className="text-xs">Options (comma separated)</Label>
                <Input value={newOptions} onChange={e => setNewOptions(e.target.value)} className="h-8" placeholder="Option 1, Option 2, ..." />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate}>Create & Add</Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-4 mt-2 min-h-0">
          {/* Table header */}
          <div className="grid grid-cols-[auto_1fr_120px_auto_80px] gap-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border pb-2">
            <span></span>
            <span>Name</span>
            <span>Type</span>
            <span></span>
            <span className="text-center">Visible</span>
          </div>

          {Object.entries(grouped).map(([type, fields]) => (
            <div key={type}>
              <div className="px-2 mb-1">
                <Badge variant="secondary" className="text-xs">
                  {FIELD_TYPE_ICONS[type as CustomFieldType]} {FIELD_TYPE_LABELS[type as CustomFieldType]}
                </Badge>
              </div>
              {fields.map(field => (
                <div key={field.id}>
                  <div className="grid grid-cols-[auto_1fr_120px_auto_80px] gap-2 items-center px-2 py-2 rounded-md hover:bg-muted/50 group">
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100" />
                    <span className="text-sm font-medium truncate">{field.name}</span>
                    <span className="text-xs text-muted-foreground">{FIELD_TYPE_LABELS[field.type]}</span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6"
                        onClick={() => startEdit(field)}
                        title="Edit field"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                        onClick={() => onDeleteField(field.id)}
                        title="Delete field"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex justify-center">
                      <Checkbox
                        checked={visibleFieldIds.includes(field.id)}
                        onCheckedChange={() => onToggleField(field.id)}
                      />
                    </div>
                  </div>

                  {editingId === field.id && (
                    <div className="mx-2 mb-2 border border-border rounded-md p-3 space-y-2 bg-muted/30">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Field Name</Label>
                          <Input
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            className="h-8"
                            autoFocus
                            onKeyDown={e => { if (e.key === "Enter") commitEdit(field); if (e.key === "Escape") cancelEdit(); }}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Field Type</Label>
                          <Select value={editType} onValueChange={v => setEditType(v as CustomFieldType)}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(FIELD_TYPE_LABELS).map(([val, label]) => (
                                <SelectItem key={val} value={val}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {editType === "dropdown" && (
                        <div>
                          <Label className="text-xs">Options (comma separated)</Label>
                          <Input
                            value={editOptions}
                            onChange={e => setEditOptions(e.target.value)}
                            className="h-8"
                            placeholder="Option 1, Option 2, ..."
                          />
                        </div>
                      )}
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" className="h-7" onClick={cancelEdit}>
                          <X className="h-3 w-3 mr-1" /> Cancel
                        </Button>
                        <Button size="sm" className="h-7" onClick={() => commitEdit(field)}>
                          <Check className="h-3 w-3 mr-1" /> Save
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {search ? "No fields match your search" : "No custom fields yet. Create one above!"}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
