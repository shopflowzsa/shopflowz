import { useState } from "react";
import { Plus, Trash2, DollarSign, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Task, QuoteLineItem, CustomFieldDefinition } from "@/types/crm";

interface QuoteGenerationDialogProps {
  open: boolean;
  onClose: () => void;
  task: Task;
  customFields: CustomFieldDefinition[];
  onCreateQuote: (quoteData: QuoteFormData) => void;
}

export interface QuoteFormData {
  taskId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  lineItems: QuoteLineItem[];
  notes: string;
  taxRate: number;
  validUntil: string;
}

export function QuoteGenerationDialog({ open, onClose, task, customFields, onCreateQuote }: QuoteGenerationDialogProps) {
  const [formData, setFormData] = useState<QuoteFormData>(() => {
    // Pre-populate from task data
    const customerNameField = customFields.find(f => f.name.toLowerCase().includes('name') || f.name.toLowerCase().includes('customer'));
    const emailField = customFields.find(f => f.type === 'email');
    const phoneField = customFields.find(f => f.type === 'phone');
    
    const getFieldValue = (field?: CustomFieldDefinition) => {
      if (!field) return '';
      const value = task.customFieldValues.find(v => v.fieldId === field.id);
      return value ? String(value.value) : '';
    };

    // Auto-populate line items from spare parts if available
    let initialLineItems: QuoteLineItem[] = [];
    
    if (task.sparePartsUsed && task.sparePartsUsed.length > 0) {
      // Convert spare parts to line items
      initialLineItems = task.sparePartsUsed.map(part => ({
        id: part.id,
        description: `${part.productName}${part.variantName ? ` - ${part.variantName}` : ''} (SKU: ${part.sku})`,
        quantity: part.quantity,
        rate: part.unitCost,
        amount: part.quantity * part.unitCost,
        productId: part.productVariantId, // Include productId for stock tracking
        sku: part.sku
      }));
      
      // Add labor/service line item
      initialLineItems.push({
        id: `item_${Date.now()}`,
        description: `Labor: ${task.title}`,
        quantity: 1,
        rate: 0,
        amount: 0
      });
    } else {
      // Auto-generate initial line item based on task title
      initialLineItems = [{
        id: `item_${Date.now()}`,
        description: task.title || 'Repair Service',
        quantity: 1,
        rate: 0,
        amount: 0
      }];
    }

    return {
      taskId: task.id,
      customerName: getFieldValue(customerNameField),
      customerEmail: getFieldValue(emailField),
      customerPhone: getFieldValue(phoneField),
      lineItems: initialLineItems,
      notes: task.description || '',
      taxRate: 15, // Default 15% VAT
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // 30 days from now
    };
  });

  const addLineItem = () => {
    const newItem: QuoteLineItem = {
      id: `item_${Date.now()}`,
      description: '',
      quantity: 1,
      rate: 0,
      amount: 0
    };
    setFormData(prev => ({
      ...prev,
      lineItems: [...prev.lineItems, newItem]
    }));
  };

  const removeLineItem = (id: string) => {
    setFormData(prev => ({
      ...prev,
      lineItems: prev.lineItems.filter(item => item.id !== id)
    }));
  };

  const updateLineItem = (id: string, updates: Partial<QuoteLineItem>) => {
    setFormData(prev => ({
      ...prev,
      lineItems: prev.lineItems.map(item => {
        if (item.id === id) {
          const updated = { ...item, ...updates };
          // Auto-calculate amount when quantity or rate changes
          if ('quantity' in updates || 'rate' in updates) {
            updated.amount = updated.quantity * updated.rate;
          }
          return updated;
        }
        return item;
      })
    }));
  };

  const subtotal = formData.lineItems.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = subtotal * (formData.taxRate / 100);
  const total = subtotal + taxAmount;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateQuote(formData);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Generate Quote for {task.jobNumber || task.title}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Customer Information */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="customerName">Customer Name *</Label>
              <Input
                id="customerName"
                value={formData.customerName}
                onChange={(e) => setFormData(prev => ({ ...prev, customerName: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="customerEmail">Email</Label>
              <Input
                id="customerEmail"
                type="email"
                value={formData.customerEmail}
                onChange={(e) => setFormData(prev => ({ ...prev, customerEmail: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="customerPhone">Phone</Label>
              <Input
                id="customerPhone"
                value={formData.customerPhone}
                onChange={(e) => setFormData(prev => ({ ...prev, customerPhone: e.target.value }))}
              />
            </div>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <Label className="text-lg font-semibold">Quote Items</Label>
              <Button type="button" onClick={addLineItem} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            </div>

            <div className="space-y-3">
              {formData.lineItems.map((item) => (
                <div key={item.id} className="grid grid-cols-12 gap-2 items-end p-3 border rounded-lg">
                  <div className="col-span-5">
                    <Label className="text-sm">Description</Label>
                    <Input
                      placeholder="Service or item description"
                      value={item.description}
                      onChange={(e) => updateLineItem(item.id, { description: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-sm">Qty</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-sm">Rate (R)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.rate}
                      onChange={(e) => updateLineItem(item.id, { rate: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-sm">Amount</Label>
                    <div className="text-lg font-semibold p-2 bg-muted rounded">
                      R{item.amount.toFixed(2)}
                    </div>
                  </div>
                  <div className="col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLineItem(item.id)}
                      disabled={formData.lineItems.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quote Summary */}
          <div className="border rounded-lg p-4 bg-muted/30">
            <div className="flex justify-between items-center mb-2">
              <span>Subtotal:</span>
              <span className="font-medium">R{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <span>VAT ({formData.taxRate}%):</span>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={formData.taxRate}
                  onChange={(e) => setFormData(prev => ({ ...prev, taxRate: parseFloat(e.target.value) || 0 }))}
                  className="w-20 h-8"
                />
              </div>
              <span className="font-medium">R{taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-lg font-bold border-t pt-2">
              <span>Total:</span>
              <span>R{total.toFixed(2)}</span>
            </div>
          </div>

          {/* Additional Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="validUntil">Valid Until</Label>
              <Input
                id="validUntil"
                type="date"
                value={formData.validUntil}
                onChange={(e) => setFormData(prev => ({ ...prev, validUntil: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Additional terms, conditions, or notes..."
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Create Quote
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}