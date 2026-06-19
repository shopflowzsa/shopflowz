import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DollarSign, Plus, Send, Printer, MessageSquare, Download, Eye } from "lucide-react";
import { Invoice, Payment } from "@/types/crm";
import { formatCurrency } from "@/lib/accountsService";
import { previewInvoice, printInvoice, downloadInvoice, generateInvoicePDFBlob } from "@/lib/pdfService";
import { loadSalesSettings } from "@/lib/salesSettingsService";
import { sendPDFViaWhatsApp } from "@/lib/whatsappPdfService";
import { toast } from "sonner";

interface InvoiceEditorProps {
  invoice: Invoice | null;
  open: boolean;
  onClose: () => void;
  onSave: (invoice: Invoice) => void;
  onRecordPayment: (invoice: Invoice, amount: number, method: string, notes?: string) => void;
}

export function InvoiceEditor({ invoice, open, onClose, onSave, onRecordPayment }: InvoiceEditorProps) {
  const { workspaceId, user } = useAuth();
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);

  if (!invoice) return null;

  const handleRecordPayment = () => {
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid payment amount");
      return;
    }
    if (amount > invoice.balanceDue) {
      toast.error("Payment amount cannot exceed balance due");
      return;
    }

    onRecordPayment(invoice, amount, paymentMethod, paymentNotes.trim() || undefined);
    setShowPaymentDialog(false);
    setPaymentAmount("");
    setPaymentMethod("cash");
    setPaymentNotes("");
    toast.success("Payment recorded");
  };

  const handleMarkSent = () => {
    const updated: Invoice = {
      ...invoice,
      status: "sent",
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onSave(updated);
    toast.success("Invoice marked as sent");
  };

  const handlePreview = () => {
    previewInvoice(invoice, undefined);
  };

  const handlePrint = () => {
    printInvoice(invoice, undefined);
  };

  const handleDownload = () => {
    downloadInvoice(invoice);
  };

  const handleSendWhatsApp = async () => {
    if (!invoice || !workspaceId) return;
    const phone = invoice.customerPhone?.trim();
    if (!phone) {
      toast({ title: "No phone number", description: "This invoice has no customer phone number.", variant: "destructive" });
      return;
    }
    setSendingWhatsApp(true);
    try {
      const salesSettings = await loadSalesSettings(workspaceId);
      const blob  = await generateInvoicePDFBlob(invoice, salesSettings);
      const fname = `Invoice-${invoice.invoiceNumber}.pdf`;
      const result = await sendPDFViaWhatsApp({
        blob, filename: fname,
        phone, contactName: invoice.customerName || phone,
        workspaceId, sentByName: user?.email ?? "Staff",
      });
      if (result.success) {
        toast({
          title: result.queued ? "PDF Queued ✓" : "PDF Sent via WhatsApp ✓",
          description: result.queued
            ? "24hr window expired — re-opener sent. PDF delivers when client replies."
            : `${fname} sent to ${phone}. Check WhatsApp Messenger to continue the chat.`,
        });
      } else {
        toast({ title: "WhatsApp Failed", description: result.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "WhatsApp Failed", description: e.message || "Failed", variant: "destructive" });
    } finally {
      setSendingWhatsApp(false);
    }
  };

  const getPaymentStatusColor = (status: Invoice["paymentStatus"]) => {
    switch (status) {
      case "paid": return "bg-green-600";
      case "partial": return "bg-yellow-600";
      case "unpaid": return "bg-red-600";
    }
  };

  return (
    <>
      <Dialog open={open && !showPaymentDialog} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice - {invoice.invoiceNumber}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Status Badges */}
            <div className="flex gap-2">
              <Badge variant="outline">{invoice.status.toUpperCase()}</Badge>
              <Badge className={getPaymentStatusColor(invoice.paymentStatus)}>
                {invoice.paymentStatus.toUpperCase()}
              </Badge>
            </div>

            {/* Customer Information */}
            <div className="space-y-2">
              <h3 className="font-semibold text-sm">Customer</h3>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Name</p>
                  <p className="font-medium">{invoice.customerName}</p>
                </div>
                {invoice.customerEmail && (
                  <div>
                    <p className="text-muted-foreground">Email</p>
                    <p className="font-medium">{invoice.customerEmail}</p>
                  </div>
                )}
                {invoice.customerPhone && (
                  <div>
                    <p className="text-muted-foreground">Phone</p>
                    <p className="font-medium">{invoice.customerPhone}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Invoice Details */}
            <div className="space-y-2">
              <h3 className="font-semibold text-sm">Details</h3>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p className="font-medium">{new Date(invoice.createdAt).toLocaleDateString()}</p>
                </div>
                {invoice.dueDate && (
                  <div>
                    <p className="text-muted-foreground">Due Date</p>
                    <p className="font-medium">{new Date(invoice.dueDate).toLocaleDateString()}</p>
                  </div>
                )}
                {invoice.sentAt && (
                  <div>
                    <p className="text-muted-foreground">Sent</p>
                    <p className="font-medium">{new Date(invoice.sentAt).toLocaleDateString()}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Line Items */}
            <div className="space-y-2">
              <h3 className="font-semibold text-sm">Items</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.lineItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.rate)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(item.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Totals */}
            <div className="space-y-2 border-t pt-4">
              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span className="font-semibold">{formatCurrency(invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Tax ({(invoice.taxRate * 100).toFixed(0)}%)</span>
                <span className="font-semibold">{formatCurrency(invoice.taxAmount)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t pt-2">
                <span>Total</span>
                <span>{formatCurrency(invoice.total)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-sm text-green-600">
                <span>Amount Paid</span>
                <span className="font-semibold">{formatCurrency(invoice.amountPaid)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold">
                <span>Balance Due</span>
                <span className="text-red-600">{formatCurrency(invoice.balanceDue)}</span>
              </div>
            </div>

            {/* Payment History */}
            {invoice.payments && invoice.payments.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold text-sm">Payment History</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>{new Date(payment.paidAt).toLocaleDateString()}</TableCell>
                        <TableCell className="capitalize">{payment.method.replace("_", " ")}</TableCell>
                        <TableCell className="text-right font-semibold text-green-600">
                          {formatCurrency(payment.amount)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {payment.notes || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Notes */}
            {invoice.notes && (
              <div className="space-y-2">
                <h3 className="font-semibold text-sm">Notes</h3>
                <p className="text-sm text-muted-foreground">{invoice.notes}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Close</Button>

            {invoice.status === "draft" && (
              <Button variant="outline" onClick={handleMarkSent}>
                <Send className="h-4 w-4 mr-2" />
                Mark as Sent
              </Button>
            )}

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

            {invoice.balanceDue > 0 && (
              <Button onClick={() => setShowPaymentDialog(true)}>
                <DollarSign className="h-4 w-4 mr-2" />
                Record Payment
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex justify-between text-sm mb-2">
                <span>Invoice Total</span>
                <span className="font-semibold">{formatCurrency(invoice.total)}</span>
              </div>
              <div className="flex justify-between text-sm mb-2">
                <span>Already Paid</span>
                <span className="font-semibold text-green-600">{formatCurrency(invoice.amountPaid)}</span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between text-lg font-bold">
                <span>Balance Due</span>
                <span className="text-red-600">{formatCurrency(invoice.balanceDue)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Payment Amount *</Label>
              <Input
                type="number"
                min="0"
                max={invoice.balanceDue}
                step="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <Label>Payment Method *</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="eft">EFT</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="Payment reference, etc."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleRecordPayment}>
              <Plus className="h-4 w-4 mr-2" />
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
