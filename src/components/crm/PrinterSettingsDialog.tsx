import { useState, useEffect } from "react";
import { Settings, Printer, Plus, Trash2, TestTube, CheckCircle, AlertCircle, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  PrinterSettings, PrinterConfig, PrintTemplate, PrinterFieldMapping, 
  DEFAULT_PRINTER_SETTINGS, DEFAULT_PRINT_TEMPLATE, DEFAULT_XPRINTER_CONFIG,
  PRINTER_TYPES, PRINTER_FIELD_LABELS, PrinterType
} from "@/types/printer";
import { CustomFieldDefinition } from "@/types/crm";
import { loadPrinterSettings, savePrinterSettings, detectUSBPrinters, testPrinter } from "@/lib/printerService";

interface PrinterSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  customFields: CustomFieldDefinition[];
}

export function PrinterSettingsDialog({ 
  open, 
  onClose, 
  workspaceId, 
  customFields 
}: PrinterSettingsDialogProps) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS);
  const [editingPrinter, setEditingPrinter] = useState<PrinterConfig | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<PrintTemplate | null>(null);
  const [testingPrinter, setTestingPrinter] = useState<string | null>(null);
  const [detectingPrinters, setDetectingPrinters] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load settings on open
  useEffect(() => {
    if (open) {
      loadSettings();
    }
  }, [open, workspaceId]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await loadPrinterSettings(workspaceId);
      setSettings(data);
    } catch (error) {
      console.error("Failed to load printer settings:", error);
      toast({
        title: "Error",
        description: "Failed to load printer settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      await savePrinterSettings(workspaceId, settings);
      toast({
        title: "Settings Saved",
        description: "Printer settings have been updated successfully",
      });
    } catch (error) {
      console.error("Failed to save printer settings:", error);
      toast({
        title: "Error", 
        description: "Failed to save printer settings",
        variant: "destructive",
      });
    }
  };

  const handleDetectPrinters = async () => {
    setDetectingPrinters(true);
    try {
      const detected = await detectUSBPrinters();
      if (detected.length > 0) {
        const newPrinters = detected.map((p, i) => ({
          ...DEFAULT_XPRINTER_CONFIG,
          ...p,
          id: `detected-${Date.now()}-${i}`,
        }));
        setSettings(prev => ({
          ...prev,
          printers: [...prev.printers, ...newPrinters]
        }));
        toast({
          title: "Printers Detected",
          description: `Found ${detected.length} USB printer(s)`,
        });
      } else {
        toast({
          title: "No Printers Found",
          description: "No USB printers detected. Make sure your printer is connected.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Detection Failed",
        description: "Failed to detect printers. Please check browser permissions.",
        variant: "destructive",
      });
    } finally {
      setDetectingPrinters(false);
    }
  };

  const handleTestPrinter = async (printer: PrinterConfig) => {
    setTestingPrinter(printer.id);
    try {
      const success = await testPrinter(printer);
      toast({
        title: success ? "Test Successful" : "Test Failed",
        description: success ? "Printer is working correctly" : "Failed to communicate with printer",
        variant: success ? "default" : "destructive",
      });
    } catch (error) {
      toast({
        title: "Test Failed",
        description: "Failed to test printer connection",
        variant: "destructive",
      });
    } finally {
      setTestingPrinter(null);
    }
  };

  const addPrinter = () => {
    const newPrinter: PrinterConfig = {
      ...DEFAULT_XPRINTER_CONFIG,
      id: `printer-${Date.now()}`,
      name: `Printer ${settings.printers.length + 1}`,
    };
    setSettings(prev => ({
      ...prev,
      printers: [...prev.printers, newPrinter]
    }));
    setEditingPrinter(newPrinter);
  };

  const updatePrinter = (printer: PrinterConfig) => {
    setSettings(prev => ({
      ...prev,
      printers: prev.printers.map(p => p.id === printer.id ? printer : p)
    }));
    setEditingPrinter(null);
  };

  const deletePrinter = (printerId: string) => {
    setSettings(prev => ({
      ...prev,
      printers: prev.printers.filter(p => p.id !== printerId),
      selectedPrinterId: prev.selectedPrinterId === printerId ? undefined : prev.selectedPrinterId
    }));
  };

  const addTemplate = () => {
    const newTemplate: PrintTemplate = {
      ...DEFAULT_PRINT_TEMPLATE,
      id: `template-${Date.now()}`,
      name: `Template ${settings.templates.length + 1}`,
    };
    setSettings(prev => ({
      ...prev,
      templates: [...prev.templates, newTemplate]
    }));
    setEditingTemplate(newTemplate);
  };

  const updateTemplate = (template: PrintTemplate) => {
    setSettings(prev => ({
      ...prev,
      templates: prev.templates.map(t => t.id === template.id ? template : t)
    }));
    setEditingTemplate(null);
  };

  const deleteTemplate = (templateId: string) => {
    setSettings(prev => ({
      ...prev,
      templates: prev.templates.filter(t => t.id !== templateId),
      selectedTemplateId: prev.selectedTemplateId === templateId ? undefined : prev.selectedTemplateId
    }));
  };

  const duplicateTemplate = (template: PrintTemplate) => {
    const newTemplate: PrintTemplate = {
      ...template,
      id: `template-${Date.now()}`,
      name: `${template.name} (Copy)`,
    };
    setSettings(prev => ({
      ...prev,
      templates: [...prev.templates, newTemplate]
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Thermal Printer Settings
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="general" className="flex-1">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="printers">Printers</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[500px] mt-4">
            <TabsContent value="general" className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="printer-enabled"
                    checked={settings.enabled}
                    onCheckedChange={(enabled) => setSettings(prev => ({ ...prev, enabled }))}
                  />
                  <Label htmlFor="printer-enabled">Enable thermal printing</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="print-on-create"
                    checked={settings.printOnTaskCreate}
                    onCheckedChange={(printOnTaskCreate) => setSettings(prev => ({ ...prev, printOnTaskCreate }))}
                    disabled={!settings.enabled}
                  />
                  <Label htmlFor="print-on-create">Auto-print booking slip when tasks are created</Label>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label>Default Printer</Label>
                  <Select
                    value={settings.selectedPrinterId || ""}
                    onValueChange={(value) => setSettings(prev => ({ ...prev, selectedPrinterId: value || undefined }))}
                    disabled={!settings.enabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a printer..." />
                    </SelectTrigger>
                    <SelectContent>
                      {settings.printers.filter(p => p.enabled).map(printer => (
                        <SelectItem key={printer.id} value={printer.id}>
                          {printer.name} ({PRINTER_TYPES[printer.type]})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Default Template</Label>
                  <Select
                    value={settings.selectedTemplateId || ""}
                    onValueChange={(value) => setSettings(prev => ({ ...prev, selectedTemplateId: value || undefined }))}
                    disabled={!settings.enabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {settings.templates.map(template => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="printers" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Configured Printers</h3>
                <div className="space-x-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDetectPrinters}
                    disabled={detectingPrinters}
                  >
                    {detectingPrinters ? "Detecting..." : "Detect USB Printers"}
                  </Button>
                  <Button size="sm" onClick={addPrinter}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Printer
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {settings.printers.map(printer => (
                  <div key={printer.id} className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={printer.enabled}
                          onCheckedChange={(enabled) => updatePrinter({ ...printer, enabled })}
                        />
                        <div>
                          <p className="font-medium">{printer.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {PRINTER_TYPES[printer.type]} • {printer.connectionType.toUpperCase()}
                            {printer.address && ` • ${printer.address}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleTestPrinter(printer)}
                          disabled={!printer.enabled || testingPrinter === printer.id}
                        >
                          {testingPrinter === printer.id ? (
                            "Testing..."
                          ) : (
                            <>
                              <TestTube className="h-4 w-4 mr-1" />
                              Test
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingPrinter(printer)}
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deletePrinter(printer.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="templates" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Print Templates</h3>
                <Button size="sm" onClick={addTemplate}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Template
                </Button>
              </div>

              <div className="space-y-2">
                {settings.templates.map(template => (
                  <div key={template.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{template.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {template.paperWidth}mm • {template.fontSize} font • {template.alignment} aligned
                        </p>
                        <div className="flex items-center space-x-2 mt-1">
                          <Badge variant="secondary">{template.fields.filter(f => f.enabled).length} fields</Badge>
                          {template.printLogo && <Badge variant="outline">Logo</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => duplicateTemplate(template)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingTemplate(template)}
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteTemplate(template.id)}
                          disabled={settings.templates.length <= 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </ScrollArea>

          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={saveSettings} disabled={loading}>
              Save Settings
            </Button>
          </div>
        </Tabs>

        {/* Printer Edit Dialog */}
        {editingPrinter && (
          <PrinterConfigDialog
            printer={editingPrinter}
            onSave={updatePrinter}
            onCancel={() => setEditingPrinter(null)}
          />
        )}

        {/* Template Edit Dialog */}
        {editingTemplate && (
          <TemplateConfigDialog
            template={editingTemplate}
            customFields={customFields}
            onSave={updateTemplate}
            onCancel={() => setEditingTemplate(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Printer Configuration Dialog
function PrinterConfigDialog({
  printer,
  onSave,
  onCancel,
}: {
  printer: PrinterConfig;
  onSave: (printer: PrinterConfig) => void;
  onCancel: () => void;
}) {
  const [config, setConfig] = useState(printer);

  return (
    <Dialog open={true} onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure Printer</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="printer-name">Printer Name</Label>
            <Input
              id="printer-name"
              value={config.name}
              onChange={(e) => setConfig(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Enter printer name..."
            />
          </div>

          <div>
            <Label htmlFor="printer-type">Printer Type</Label>
            <Select
              value={config.type}
              onValueChange={(type: PrinterType) => setConfig(prev => ({ ...prev, type }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRINTER_TYPES).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="connection-type">Connection Type</Label>
            <Select
              value={config.connectionType}
              onValueChange={(connectionType: "usb" | "network" | "bluetooth" | "serial") => 
                setConfig(prev => ({ ...prev, connectionType }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="usb">USB</SelectItem>
                <SelectItem value="serial">Serial (COM Port)</SelectItem>
                <SelectItem value="network">Network (TCP/IP)</SelectItem>
                <SelectItem value="bluetooth">Bluetooth</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(config.connectionType === "network" || config.connectionType === "serial") && (
            <div>
              <Label htmlFor="printer-address">
                {config.connectionType === "network" ? "IP Address" : "COM Port"}
              </Label>
              <Input
                id="printer-address"
                value={config.address || ""}
                onChange={(e) => setConfig(prev => ({ ...prev, address: e.target.value }))}
                placeholder={config.connectionType === "network" ? "192.168.1.100" : "COM1"}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-2 pt-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSave(config)}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Template Configuration Dialog  
function TemplateConfigDialog({
  template,
  customFields,
  onSave,
  onCancel,
}: {
  template: PrintTemplate;
  customFields: CustomFieldDefinition[];
  onSave: (template: PrintTemplate) => void;
  onCancel: () => void;
}) {
  const [config, setConfig] = useState(template);

  const updateField = (index: number, field: PrinterFieldMapping) => {
    setConfig(prev => ({
      ...prev,
      fields: prev.fields.map((f, i) => i === index ? field : f)
    }));
  };

  const addCustomField = (fieldId: string) => {
    const customField = customFields.find(cf => cf.id === fieldId);
    if (customField) {
      setConfig(prev => ({
        ...prev,
        fields: [...prev.fields, {
          fieldKey: `custom:${fieldId}`,
          label: customField.name,
          enabled: true,
        }]
      }));
    }
  };

  return (
    <Dialog open={true} onOpenChange={onCancel}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Configure Template</DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[500px]">
          <div className="space-y-4 pr-4">
            <div>
              <Label htmlFor="template-name">Template Name</Label>
              <Input
                id="template-name"
                value={config.name}
                onChange={(e) => setConfig(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Enter template name..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="paper-width">Paper Width</Label>
                <Select
                  value={config.paperWidth.toString()}
                  onValueChange={(width) => setConfig(prev => ({ ...prev, paperWidth: parseInt(width) as 58 | 80 }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58">58mm</SelectItem>
                    <SelectItem value="80">80mm</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="font-size">Font Size</Label>
                <Select
                  value={config.fontSize}
                  onValueChange={(fontSize: "small" | "normal" | "large") => 
                    setConfig(prev => ({ ...prev, fontSize }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Small</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="large">Large</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="alignment">Text Alignment</Label>
              <Select
                value={config.alignment}
                onValueChange={(alignment: "left" | "center" | "right") => 
                  setConfig(prev => ({ ...prev, alignment }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">Left</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="right">Right</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="header-text">Header Text</Label>
              <Input
                id="header-text"
                value={config.headerText}
                onChange={(e) => setConfig(prev => ({ ...prev, headerText: e.target.value }))}
                placeholder="Enter header text..."
              />
            </div>

            <div>
              <Label htmlFor="footer-text">Footer Text</Label>
              <Input
                id="footer-text"
                value={config.footerText}
                onChange={(e) => setConfig(prev => ({ ...prev, footerText: e.target.value }))}
                placeholder="Enter footer text..."
              />
            </div>

            <div>
              <Label>Fields to Print</Label>
              <div className="space-y-2 mt-2">
                {config.fields.map((field, index) => (
                  <div key={index} className="flex items-center space-x-2 p-2 border rounded">
                    <Switch
                      checked={field.enabled}
                      onCheckedChange={(enabled) => updateField(index, { ...field, enabled })}
                    />
                    <Input
                      value={field.label}
                      onChange={(e) => updateField(index, { ...field, label: e.target.value })}
                      placeholder="Field label..."
                      className="flex-1"
                    />
                    <span className="text-sm text-muted-foreground min-w-[100px]">
                      {field.fieldKey.startsWith("custom:") 
                        ? `Custom: ${customFields.find(cf => cf.id === field.fieldKey.slice(7))?.name || "Unknown"}`
                        : PRINTER_FIELD_LABELS[field.fieldKey as keyof typeof PRINTER_FIELD_LABELS] || field.fieldKey
                      }
                    </span>
                  </div>
                ))}
              </div>

              {customFields.length > 0 && (
                <div className="mt-4">
                  <Label>Add Custom Field</Label>
                  <Select onValueChange={addCustomField}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select custom field to add..." />
                    </SelectTrigger>
                    <SelectContent>
                      {customFields
                        .filter(cf => !config.fields.some(f => f.fieldKey === `custom:${cf.id}`))
                        .map(cf => (
                          <SelectItem key={cf.id} value={cf.id}>
                            {cf.name} ({cf.type})
                          </SelectItem>
                        ))
                      }
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <div className="flex justify-end space-x-2 pt-4 border-t">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSave(config)}>
            Save Template
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}