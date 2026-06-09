import { Plus, ExternalLink, Copy, Pencil, Trash2, FileText, Files } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { FormDefinition, List } from "@/types/crm";

interface FormListPanelProps {
  forms: FormDefinition[];
  lists: List[];
  onCreateForm: () => void;
  onEditForm: (form: FormDefinition) => void;
  onDeleteForm: (id: string) => void;
  onDuplicateForm: (form: FormDefinition) => void;
}

export function FormListPanel({ forms, lists, onCreateForm, onEditForm, onDeleteForm, onDuplicateForm }: FormListPanelProps) {
  const getListName = (listId: string) => lists.find(l => l.id === listId)?.name || "Unknown";

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">Forms</h2>
            <p className="text-sm text-muted-foreground mt-1">Create public forms that submit tasks into your lists</p>
          </div>
          <Button onClick={onCreateForm} size="sm">
            <Plus className="h-4 w-4 mr-1.5" /> Create Form
          </Button>
        </div>

        {forms.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-medium mb-1">No forms yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Create a form to start collecting submissions as tasks</p>
            <Button onClick={onCreateForm} variant="outline" size="sm">
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Create your first form
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {forms.map(form => {
              const url = `${window.location.origin}/form/${form.id}`;
              return (
                <div key={form.id} className="border border-border rounded-lg p-4 hover:bg-accent/30 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm">{form.name}</h3>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <Badge variant="secondary" className="text-[10px]">
                          → {getListName(form.targetListId)}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{form.fields.length} fields</span>
                        <span className="text-[10px] text-muted-foreground">Created {form.createdAt}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-2">
                        <code className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded max-w-[300px] truncate">{url}</code>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { navigator.clipboard.writeText(url); toast.success("URL copied"); }}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-3">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.open(url, "_blank")} title="Open form">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEditForm(form)} title="Edit form">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { onDuplicateForm(form); toast.success("Form duplicated"); }} title="Duplicate form">
                        <Files className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onDeleteForm(form.id)} title="Delete form">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
