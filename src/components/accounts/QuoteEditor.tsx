import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Plus, Trash2, Check, Send, X, Printer, Download, Eye, MessageSquare } from "lucide-react";
import { Quote, QuoteLineItem } from "@/types/crm";
import { calculateQuoteTotals, formatCurrency } from "@/lib/accountsService";
import { previewQuotation, printQuotation, downloadQuotation, sendQuotationViaWhatsApp } from "@/lib/pdfService";
import { toast } from "sonner";

interface QuoteEditorProps {
  quote: Quote | null;
  open: boolean;
  onClose: () => void;
  onSave: (quote: Quote) => void;
  onApprove: (quote: Quote) => void;
}

export function QuoteEditor({ quote, open, onClose, onSave, onApprove }: QuoteEditorProps) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [lineItems, setLineItems] = useState<QuoteLineItem[]>([]);
  const [taxRate, setTaxRate] = useState(0.15);
  const [notes, setNotes] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);

  useEffect(() => {
    if (quote) {
      setCustomerName(quote.customerName);
      setCustomerEmail(quote.customerEmail || "");
      setCustomerPhone(quote.customerPhone || "");
      setLineItems(quote.lineItems);
      setTaxRate(quote.taxRate);
      setNotes(quote.notes || "");
      setValidUntil(quote.validUntil || "");
    }
  }, [quote]);

  const addLineItem = () => {
    const newItem: QuoteLineItem = {
      id: `li${Date.now()}`,
      description: "",
      quantity: 1,
      rate: 0,
      amount: 0,
    };
    setLineItems([...lineItems, newItem]);
  };

  const updateLineItem = (id: string, updates: Partial<QuoteLineItem>) => {
    setLineItems(items =>
      items.map(item => {
        if (item.id !== id) return item;
        const updated = { ...item, ...updates };
        // Recalculate amount
        updated.amount = updated.quantity * updated.rate;
        return updated;
      })
    );
  };

  const removeLineItem = (id: string) => {
    setLineItems(items => items.filter(item => item.id !== id));
  };

  const { subtotal, taxAmount, total } = calculateQuoteTotals(lineItems, taxRate);

  const handleSave = () => {
    if (!customerName.trim()) {
      toast.error("Customer name is required");
      return;
    }
    if (lineItems.length === 0) {
      toast.error("Add at least one line item");
      return;
    }
    if (lineItems.some(item => !item.description.trim())) {
      toast.error("All line items must have a description");
      return;
    }

    const updatedQuote: Quote = {
      ...quote!,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      lineItems,
      subtotal,
      taxRate,
      taxAmount,
      total,
      notes: notes.trim() || undefined,
      validUntil: validUntil || undefined,
      updatedAt: new Date().toISOString(),
    };

    onSave(updatedQuote);
    toast.success("Quote saved");
  };

  const handleApprove = () => {
    if (!customerName.trim() || lineItems.length === 0) {
      toast.error("Complete all required fields before approving");
      return;
    }

    const updatedQuote: Quote = {
      ...quote!,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      lineItems,
      subtotal,
      taxRate,
      taxAmount,
      total,
      notes: notes.trim() || undefined,
      validUntil: validUntil || undefined,
      status: "approved",
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onApprove(updatedQuote);
    toast.success("Quote approved! You can now create an invoice.");
  };

  const handleReject = () => {
    const updatedQuote: Quote = {
      ...quote!,
      status: "rejected",
      updatedAt: new Date().toISOString(),
    };
    onSave(updatedQuote);
    toast.success("Quote rejected");
  };

  const handleMarkSent = () => {
    const updatedQuote: Quote = {
      ...quote!,
      status: "sent",
      updatedAt: new Date().toISOString(),
    };
    onSave(updatedQuote);
    toast.success("Quote marked as sent");
  };

  const handlePreview = () => {
    previewQuotation(quote!, undefined);
  };

  const handlePrint = () => {
    printQuotation(quote!, undefined);
  };

  const handleDownload = () => {
    downloadQuotation(quote!, undefined);
  };

  const handleSendWhatsApp = async () => {
    setSendingWhatsApp(true);
    try {
      await sendQuotationViaWhatsApp(quote!, undefined);
      toast({ title: "PDF Downloaded", description: "Quotation PDF saved — attach it in WhatsApp" });
    } catch (e: any) {
      toast({ title: "WhatsApp Failed", description: e.message || "Failed", variant: "destructive" });
    } finally {
      setSendingWhatsApp(false);
    }
  };

  if (!quote) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {quote.status === "draft" ? "Edit Quote" : "View Quote"} - {quote.quoteNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Customer Information */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">Customer Information</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Customer Name *</Label>
                <Input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  disabled={quote.status !== "draft"}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  disabled={quote.status !== "draft"}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  disabled={quote.status !== "draft"}
                />
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Line Items</h3>
              {quote.status === "draft" && (
                <Button size="sm" variant="outline" onClick={addLineItem}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Item
                </Button>
              )}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">Description</TableHead>
                  <TableHead className="w-[15%]">Quantity</TableHead>
                  <TableHead className="w-[20%]">Rate</TableHead>
                  <TableHead className="w-[20%]">Amount</TableHead>
                  {quote.status === "draft" && <TableHead className="w-[5%]"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lineItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Input
                        value={item.description}
                        onChange={(e) => updateLineItem(item.id, { description: e.target.value })}
                        placeholder="Item description"
                        disabled={quote.status !== "draft"}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                        disabled={quote.status !== "draft"}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.rate}
                        onChange={(e) => updateLineItem(item.id, { rate: parseFloat(e.target.value) || 0 })}
                        disabled={quote.status !== "draft"}
                      />
                    </TableCell>
                    <TableCell className="font-semibold">{formatCurrency(item.amount)}</TableCell>
                    {quote.status === "draft" && (
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeLineItem(item.id)}
                          className="h-8 w-8 text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Totals */}
          <div className="space-y-2 border-t pt-4">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span className="font-semibold">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm items-center">
              <div className="flex items-center gap-2">
                <span>Tax</span>
                {quote.status === "draft" && (
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={taxRate}
                    onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                    className="w-20 h-7 text-xs"
                  />
                )}
                {quote.status !== "draft" && (
                  <span className="text-xs text-muted-foreground">({(taxRate * 100).toFixed(0)}%)</span>
                )}
              </div>
              <span className="font-semibold">{formatCurrency(taxAmount)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold border-t pt-2">
              <span>Total</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>

          {/* Notes and Valid Until */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes..."
                rows={3}
                disabled={quote.status !== "draft"}
              />
            </div>
            <div className="space-y-2">
              <Label>Valid Until</Label>
              <Input
                type="date"
                value={validUntil ? validUntil.split("T")[0] : ""}
                onChange={(e) => setValidUntil(e.target.value ? new Date(e.target.value).toISOString() : "")}
                disabled={quote.status !== "draft"}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>

          {quote.status === "draft" && (
            <>
              <Button variant="outline" onClick={handleMarkSent}>
                <Send className="h-4 w-4 mr-2" />
                Mark as Sent
              </Button>
              <Button variant="outline" onClick={handleReject} className="text-destructive">
                <X className="h-4 w-4 mr-2" />
                Reject
              </Button>
              <Button onClick={handleSave}>Save Draft</Button>
              <Button onClick={handleApprove} className="bg-green-600 hover:bg-green-700">
                <Check className="h-4 w-4 mr-2" />
                Approve
              </Button>
            </>
          )}

          {quote.status === "sent" && (
            <>
              <Button variant="outline" onClick={handlePreview}>
                <Eye className="h-4 w-4 mr-2" />
                Preview
              </Button>
              <Button variant="outline" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
              <Button variant="outline" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button variant="outline" onClick={handleSendWhatsApp} disabled={sendingWhatsApp}>
                <MessageSquare className="h-4 w-4 mr-2" />
                {sendingWhatsApp ? "Sending..." : "WhatsApp"}
              </Button>
              <Button variant="outline" onClick={handleReject} className="text-destructive">
                <X className="h-4 w-4 mr-2" />
                Reject
              </Button>
              <Button onClick={handleApprove} className="bg-green-600 hover:bg-green-700">
                <Check className="h-4 w-4 mr-2" />
                Approve
              </Button>
            </>
          )}

          {quote.status === "approved" && (
            <>
              <Button variant="outline" onClick={handlePreview}>
                <Eye className="h-4 w-4 mr-2" />
                Preview
              </Button>
              <Button variant="outline" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
              <Button variant="outline" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button variant="outline" onClick={handleSendWhatsApp} disabled={sendingWhatsApp}>
                <MessageSquare className="h-4 w-4 mr-2" />
                {sendingWhatsApp ? "Sending..." : "WhatsApp"}
              </Button>
              <div className="text-sm text-green-600 flex items-center">
                <Check className="h-4 w-4 mr-2" />
                Quote approved - ready to create invoice
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
