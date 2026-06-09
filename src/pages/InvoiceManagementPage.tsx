import { useState, useEffect, useMemo } from "react";
import {
  Receipt, Plus, Search, Trash2, DollarSign, Eye, X, Edit, Send, Check, Mail,
  Calendar, User, Package, FileText, AlertCircle, Printer, MessageSquare, ExternalLink, Download
} from "lucide-react";
import { printInvoice, previewInvoice, sendInvoiceViaWhatsApp, downloadInvoice, generateInvoiceHTML, generateInvoicePDFBlob } from "@/lib/pdfService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  createInvoice,
  getInvoices,
  getInvoiceById,
  updateInvoiceStatus,
  addPaymentToInvoice,
  getInvoiceAnalytics,
  deleteInvoicePermanently,
} from "@/lib/invoiceService";
import { getCustomers } from "@/lib/customerService";
import { getInventoryItems } from "@/lib/inventoryEcommerceSync";
import { loadSalesSettings } from "@/lib/salesSettingsService";
import { Customer, Invoice, InvoiceLineItem } from "@/types/invoice";
import { cn } from "@/lib/utils";
import { InvoiceCreationPage } from "./InvoiceCreationPage";
import { SUPABASE_URL,  supabase } from "@/lib/supabase";
import { getEffectiveSmtp, saveSentEmail } from "@/lib/emailAccountService";

const SMTP_URL = `${SUPABASE_URL}/functions/v1/send-email`;

interface InvoiceManagementPageProps {
  onClose: () => void;
  initialInvoiceId?: string;
}

const STATUS_CONFIG: Record<Invoice["status"], { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-700" },
  sent: { label: "Sent", color: "bg-blue-100 text-blue-700" },
  viewed: { label: "Viewed", color: "bg-purple-100 text-purple-700" },
  partial: { label: "Partial", color: "bg-amber-100 text-amber-700" },
  paid: { label: "Paid", color: "bg-green-100 text-green-700" },
  overdue: { label: "Overdue", color: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-400" },
};

const PAYMENT_STATUS_CONFIG: Record<Invoice["paymentStatus"], { label: string; color: string }> = {
  unpaid: { label: "Unpaid", color: "bg-red-100 text-red-700" },
  partial: { label: "Partial", color: "bg-amber-100 text-amber-700" },
  paid: { label: "Paid", color: "bg-green-100 text-green-700" },
};

export function InvoiceManagementPage({ onClose, initialInvoiceId }: InvoiceManagementPageProps) {
  const { user, workspaceId } = useAuth();
  const { toast } = useToast();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | Invoice["status"]>("all");

  // Create/Edit Invoice Dialog
  const [showCreate, setShowCreate] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
  const [confirmDeleteInvoice, setConfirmDeleteInvoice] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [items, setItems] = useState<Omit<InvoiceLineItem, "id">[]>([
    { productName: "", quantity: 1, price: 0, total: 0 }
  ]);
  const [taxRate, setTaxRate] = useState(0); // Set from sales settings on load
  const [discountPercent, setDiscountPercent] = useState(0);
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().split('T')[0];
  });
  const [terms, setTerms] = useState<Invoice["terms"]>("net-30");
  const [saving, setSaving] = useState(false);

  // Payment Dialog
  const [showPayment, setShowPayment] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "bank-transfer" | "cheque" | "other">("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");

  // WhatsApp sending
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  // Email sending
  const [sendingEmail, setSendingEmail] = useState(false);
  // PDF downloading
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    loadData();
  }, [workspaceId]);

  async function loadData() {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [invoicesData, customersData, inventoryData, salesCfg] = await Promise.all([
        getInvoices(workspaceId),
        getCustomers(workspaceId),
        getInventoryItems(workspaceId),
        loadSalesSettings(workspaceId).catch(() => ({ defaultVatEnabled: false, defaultVatRate: 15 })),
      ]);
      setInvoices(invoicesData);
      setCustomers(customersData);
      setInventory(inventoryData.filter((item: any) => item.status === "active"));
      setTaxRate(salesCfg.defaultVatEnabled ? (salesCfg.defaultVatRate || 15) : 0);
      // Auto-open a specific invoice if provided
      if (initialInvoiceId) {
        const target = invoicesData.find((i: any) => i.id === initialInvoiceId);
        if (target) setViewInvoice(target);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  // Calculate line item total
  function updateItemTotal(index: number) {
    const item = items[index];
    const total = item.quantity * item.price;
    const updatedItems = [...items];
    updatedItems[index] = { ...item, total };
    setItems(updatedItems);
  }

  // Add new line item
  function addLineItem() {
    setItems([...items, { productName: "", quantity: 1, price: 0, total: 0 }]);
  }

  // Remove line item
  function removeLineItem(index: number) {
    if (items.length === 1) {
      toast({
        title: "Cannot remove",
        description: "Invoice must have at least one line item",
        variant: "destructive",
      });
      return;
    }
    setItems(items.filter((_, i) => i !== index));
  }

  // Select inventory item
  function selectInventoryItem(index: number, inventoryItem: any) {
    const updatedItems = [...items];
    updatedItems[index] = {
      productId: inventoryItem.id,
      productName: inventoryItem.name,
      sku: inventoryItem.sku,
      quantity: 1,
      price: inventoryItem.price,
      total: inventoryItem.price,
      description: inventoryItem.description,
    };
    setItems(updatedItems);
  }

  // Calculate totals
  const calculations = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const discountAmount = (subtotal * discountPercent) / 100;
    const taxableAmount = subtotal - discountAmount;
    const taxAmount = (taxableAmount * taxRate) / 100;
    const total = taxableAmount + taxAmount;

    return {
      subtotal,
      discountAmount,
      taxAmount,
      total,
    };
  }, [items, taxRate, discountPercent]);

  async function handleSaveInvoice() {
    if (!workspaceId || !user) return;

    if (!selectedCustomerId) {
      toast({
        title: "Validation Error",
        description: "Please select a customer",
        variant: "destructive",
      });
      return;
    }

    if (items.some(item => !item.productName || item.quantity <= 0 || item.price < 0)) {
      toast({
        title: "Validation Error",
        description: "Please fill in all line items correctly",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const customer = customers.find(c => c.id === selectedCustomerId);
      if (!customer) throw new Error("Customer not found");

      const newInvoice = await createInvoice(
        workspaceId,
        user.uid,
        user.displayName || user.email || 'Unknown User',
        {
          customerId: customer.id,
          customerName: customer.companyName || customer.contactPerson,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          items: items.map(item => ({
            ...item,
            taxRate,
          })),
          taxRate,
          discountPercent,
          notes,
          dueDate,
          terms,
        }
      );
      setInvoices((prev) => [newInvoice, ...prev]);

      toast({
        title: "Success",
        description: "Invoice created successfully",
      });

      resetForm();
      setShowCreate(false);
    } catch (error) {
      console.error("Error creating invoice:", error);
      toast({
        title: "Error",
        description: "Failed to create invoice",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPayment() {
    if (!workspaceId || !user || !showPayment) return;

    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid payment amount",
        variant: "destructive",
      });
      return;
    }

    if (amount > showPayment.balanceDue) {
      toast({
        title: "Validation Error",
        description: `Payment amount cannot exceed balance due (R${showPayment.balanceDue.toFixed(2)})`,
        variant: "destructive",
      });
      return;
    }

    try {
      const updatedInvoice = await addPaymentToInvoice(workspaceId, showPayment.id, user.uid, {
        amount,
        paymentMethod,
        reference: paymentReference,
        notes: paymentNotes,
      });
      setInvoices((prev) => prev.map((inv) => inv.id === updatedInvoice.id ? updatedInvoice : inv));

      toast({
        title: "Success",
        description: "Payment recorded successfully",
      });

      setShowPayment(null);
      resetPaymentForm();
    } catch (error) {
      console.error("Error adding payment:", error);
      toast({
        title: "Error",
        description: "Failed to record payment",
        variant: "destructive",
      });
    }
  }

  async function handleUpdateStatus(invoiceId: string, status: Invoice["status"]) {
    if (!workspaceId) return;

    try {
      await updateInvoiceStatus(workspaceId, invoiceId, status);
      toast({
        title: "Success",
        description: "Invoice status updated",
      });
      await loadData();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update status",
        variant: "destructive",
      });
    }
  }

  async function handleSendEmail(invoice: Invoice) {
    if (!workspaceId) return;
    if (!invoice.customerEmail) {
      toast({ title: "No customer email", description: "This invoice has no customer email address. Edit the invoice to add one.", variant: "destructive" });
      return;
    }
    setSendingEmail(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const userSmtp = currentUser ? await getEffectiveSmtp(workspaceId, currentUser.id) : null;
      const salesSettings = await loadSalesSettings(workspaceId);
      let fromName: string;
      let fromEmail: string;
      let smtpConfig: { host: string; port: number; secure: boolean; user: string; pass: string };
      if (userSmtp) {
        fromName = userSmtp.fromName;
        fromEmail = userSmtp.fromEmail;
        smtpConfig = { host: userSmtp.host, port: userSmtp.port, secure: userSmtp.secure, user: userSmtp.user, pass: userSmtp.pass };
      } else {
        const { data: emailRow } = await supabase.from('workspace_settings').select('data').eq('workspace_id', workspaceId).eq('category', 'email').single();
        if (!emailRow?.data) throw new Error("Email is not configured. Set it up in Settings → Email Settings.");
        const es = emailRow.data as any;
        if (!es.enabled) throw new Error("Email is disabled in Settings → Email Settings.");
        fromName = es.fromName || salesSettings.companyName || "ShopFlowz";
        fromEmail = es.fromEmail || es.smtpUser || "";
        const host = es.provider === "gmail" ? "smtp.gmail.com" : (es.smtpHost ?? "");
        const port = es.provider === "gmail" ? 587 : (es.smtpPort ?? 465);
        const secure = es.provider === "gmail" ? false : (es.smtpSecure ?? (port === 465));
        smtpConfig = { host, port, secure, user: es.smtpUser, pass: es.smtpPassword };
      }
      const invoiceHtml = generateInvoiceHTML(invoice, salesSettings);
      const pdfBlob = await generateInvoicePDFBlob(invoice, salesSettings);
      const pdfArrayBuffer = await pdfBlob.arrayBuffer();
      const pdfBytes = new Uint8Array(pdfArrayBuffer);
      let pdfBinary = "";
      for (let i = 0; i < pdfBytes.length; i += 8192) pdfBinary += String.fromCharCode(...pdfBytes.subarray(i, i + 8192));
      const pdfBase64 = btoa(pdfBinary);
      const resp = await fetch(SMTP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smtpConfig,
          email: {
            from: `${fromName} <${fromEmail}>`,
            to: invoice.customerEmail,
            subject: `${invoice.invoiceNumber} from ${fromName}`,
            text: `Please find your invoice ${invoice.invoiceNumber} attached.\nTotal: R${invoice.total.toFixed(2)}\nDue: ${invoice.dueDate}`,
            html: invoiceHtml,
            attachments: [{ filename: `${invoice.invoiceNumber}.pdf`, content: pdfBase64, contentType: "application/pdf" }],
          },
        }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) throw new Error(json.error || `HTTP ${resp.status}`);
      await updateInvoiceStatus(workspaceId, invoice.id, "sent");
      if (currentUser) {
        saveSentEmail(workspaceId, currentUser.id, {
          from: `${fromName} <${fromEmail}>`,
          to: invoice.customerEmail,
          subject: `${invoice.invoiceNumber} from ${fromName}`,
          text: `Please find your invoice ${invoice.invoiceNumber} attached.\nTotal: R${invoice.total.toFixed(2)}\nDue: ${invoice.dueDate}`,
          date: new Date(),
        }).catch(() => {});
      }
      toast({ title: "Invoice emailed!", description: `${invoice.invoiceNumber} sent to ${invoice.customerEmail}` });
      await loadData();
      if (viewInvoice?.id === invoice.id) setViewInvoice(prev => prev ? { ...prev, status: "sent" } : null);
    } catch (err: any) {
      toast({ title: "Email failed", description: err.message, variant: "destructive" });
    } finally {
      setSendingEmail(false);
    }
  }

  async function handleDeleteInvoice() {
    if (!workspaceId || !confirmDeleteInvoice) return;
    setDeleting(true);
    try {
      await deleteInvoicePermanently(workspaceId, confirmDeleteInvoice.id);
      toast({ title: "Invoice deleted", description: `${confirmDeleteInvoice.invoiceNumber} has been permanently deleted.` });
      setConfirmDeleteInvoice(null);
      await loadData();
    } catch (error) {
      toast({ title: "Delete failed", description: error instanceof Error ? error.message : "Could not delete invoice", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  function resetForm() {
    setSelectedCustomerId("");
    setItems([{ productName: "", quantity: 1, price: 0, total: 0 }]);
    setTaxRate(15);
    setDiscountPercent(0);
    setNotes("");
    const date = new Date();
    date.setDate(date.getDate() + 30);
    setDueDate(date.toISOString().split('T')[0]);
    setTerms("net-30");
  }

  function resetPaymentForm() {
    setPaymentAmount("");
    setPaymentMethod("cash");
    setPaymentReference("");
    setPaymentNotes("");
  }

  const filteredInvoices = useMemo(() => {
    let filtered = invoices;

    if (filterStatus !== "all") {
      filtered = filtered.filter(inv => inv.status === filterStatus);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        inv =>
          inv.invoiceNumber.toLowerCase().includes(term) ||
          inv.customerName.toLowerCase().includes(term) ||
          inv.customerEmail?.toLowerCase().includes(term)
      );
    }

    return filtered.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [invoices, filterStatus, searchTerm]);

  const stats = useMemo(() => {
    const total = invoices.length;
    const totalRevenue = invoices.reduce((sum, inv) => sum + inv.total, 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + inv.amountPaid, 0);
    const totalOutstanding = invoices.reduce((sum, inv) => sum + inv.balanceDue, 0);
    const draftCount = invoices.filter(inv => inv.status === "draft").length;
    const paidCount = invoices.filter(inv => inv.paymentStatus === "paid").length;
    const overdueCount = invoices.filter(
      inv => inv.paymentStatus !== "paid" && new Date(inv.dueDate) < new Date()
    ).length;

    return { total, totalRevenue, totalPaid, totalOutstanding, draftCount, paidCount, overdueCount };
  }, [invoices]);

  if (loading) {
    return (
      <div className="absolute inset-0 bg-background z-30 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading invoices...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-background z-30 flex flex-col">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Receipt className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Invoice Management</h1>
              <p className="text-sm text-muted-foreground">Create and manage customer invoices</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-4 gap-4 p-4 border-t">
          <div className="bg-background rounded-lg p-3 border">
            <div className="text-xs text-muted-foreground mb-1">Total Invoices</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </div>
          <div className="bg-background rounded-lg p-3 border">
            <div className="text-xs text-muted-foreground mb-1">Total Revenue</div>
            <div className="text-2xl font-bold text-green-600">
              R{stats.totalRevenue.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="bg-background rounded-lg p-3 border">
            <div className="text-xs text-muted-foreground mb-1">Outstanding</div>
            <div className="text-2xl font-bold text-amber-600">
              R{stats.totalOutstanding.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="bg-background rounded-lg p-3 border">
            <div className="text-xs text-muted-foreground mb-1">Overdue</div>
            <div className="text-2xl font-bold text-red-600">{stats.overdueCount}</div>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex items-center gap-3 p-4 border-t">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search invoices..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterStatus} onValueChange={(val: any) => setFilterStatus(val)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="partial">Partial Payment</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => { resetForm(); setShowCreate(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            New Invoice
          </Button>
        </div>
      </div>

      {/* Invoice List */}
      <div className="flex-1 overflow-auto p-4">
        {filteredInvoices.length === 0 ? (
          <div className="text-center py-12">
            <Receipt className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {searchTerm || filterStatus !== "all"
                ? "No invoices found"
                : "No invoices yet. Create your first invoice!"}
            </p>
          </div>
        ) : (
          <div className="bg-card border rounded-lg">
            <Table className="resizable-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium font-mono">{invoice.invoiceNumber}</TableCell>
                    <TableCell>{invoice.customerName}</TableCell>
                    <TableCell>{new Date(invoice.invoiceDate).toLocaleDateString()}</TableCell>
                    <TableCell className={cn(
                      new Date(invoice.dueDate) < new Date() && invoice.paymentStatus !== "paid"
                        ? "text-red-600 font-semibold"
                        : ""
                    )}>
                      {new Date(invoice.dueDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      R{invoice.total.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right text-green-600">
                      R{invoice.amountPaid.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className={cn(
                      "text-right",
                      invoice.balanceDue > 0 ? "text-amber-600 font-semibold" : "text-muted-foreground"
                    )}>
                      R{invoice.balanceDue.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Badge className={STATUS_CONFIG[invoice.status].color}>
                          {STATUS_CONFIG[invoice.status].label}
                        </Badge>
                        <Badge className={PAYMENT_STATUS_CONFIG[invoice.paymentStatus].color}>
                          {PAYMENT_STATUS_CONFIG[invoice.paymentStatus].label}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {invoice.customerEmail && (
                          <Button
                            variant="outline"
                            size="sm"
                            title={`Email invoice to ${invoice.customerEmail}`}
                            onClick={() => handleSendEmail(invoice)}
                            disabled={sendingEmail}
                          >
                            <Mail className="h-4 w-4" />
                          </Button>
                        )}
                        {invoice.paymentStatus !== "paid" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowPayment(invoice)}
                          >
                            <DollarSign className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingInvoice(invoice)}
                          title="Edit invoice"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setViewInvoice(invoice)}
                          title="View invoice"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            setDownloadingId(invoice.id);
                            try {
                              await downloadInvoice(invoice, workspaceId || undefined);
                              toast({
                                title: "PDF Downloaded",
                                description: `Invoice-${invoice.invoiceNumber}.pdf saved`,
                              });
                            } catch (error) {
                              toast({
                                title: "Download Failed",
                                description: error instanceof Error ? error.message : "Failed to download",
                                variant: "destructive",
                              });
                            } finally {
                              setDownloadingId(null);
                            }
                          }}
                          disabled={downloadingId === invoice.id}
                          title="Download PDF"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setConfirmDeleteInvoice(invoice)}
                          title="Delete invoice"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Create Invoice - AI Stock Style */}
      {showCreate && (
        <InvoiceCreationPage
          onClose={() => {
            setShowCreate(false);
            resetForm();
          }}
          onSaved={() => loadData()}
          type="invoice"
        />
      )}

      {/* Edit Invoice */}
      {editingInvoice && (
        <InvoiceCreationPage
          onClose={() => {
            setEditingInvoice(null);
          }}
          onSaved={() => loadData()}
          type="invoice"
          editingInvoice={editingInvoice}
        />
      )}

      {/* Add Payment Dialog */}
      <Dialog open={!!showPayment} onOpenChange={() => setShowPayment(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Payment</DialogTitle>
            <DialogDescription>
              Invoice: {showPayment?.invoiceNumber} | Balance Due: R
              {showPayment?.balanceDue.toFixed(2)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Payment Amount *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </div>
            <div>
              <Label>Payment Method *</Label>
              <Select value={paymentMethod} onValueChange={(val: any) => setPaymentMethod(val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank-transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference Number</Label>
              <Input
                placeholder="Transaction/Check number"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                placeholder="Payment notes..."
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayment(null)}>
              Cancel
            </Button>
            <Button onClick={handleAddPayment}>
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Invoice Dialog */}
      <Dialog open={!!viewInvoice} onOpenChange={() => setViewInvoice(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{viewInvoice?.invoiceNumber}</span>
              <div className="flex items-center gap-2">
                <Badge className={viewInvoice ? STATUS_CONFIG[viewInvoice.status].color : ""}>
                  {viewInvoice ? STATUS_CONFIG[viewInvoice.status].label : ""}
                </Badge>
                <Badge
                  className={
                    viewInvoice ? PAYMENT_STATUS_CONFIG[viewInvoice.paymentStatus].color : ""
                  }
                >
                  {viewInvoice ? PAYMENT_STATUS_CONFIG[viewInvoice.paymentStatus].label : ""}
                </Badge>
              </div>
            </DialogTitle>
          </DialogHeader>

          {viewInvoice && (
            <div className="space-y-6">
              {/* Customer & Dates */}
              <div className="grid grid-cols-2 gap-6 p-4 bg-muted/30 rounded-lg">
                <div>
                  <h3 className="font-semibold mb-2">Bill To:</h3>
                  <p className="font-medium">{viewInvoice.customerName}</p>
                  {viewInvoice.customerEmail && (
                    <p className="text-sm text-muted-foreground">{viewInvoice.customerEmail}</p>
                  )}
                  {viewInvoice.customerPhone && (
                    <p className="text-sm text-muted-foreground">{viewInvoice.customerPhone}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Invoice Date:</span>
                    <span>{new Date(viewInvoice.invoiceDate).toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Due Date:</span>
                    <span>{new Date(viewInvoice.dueDate).toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Terms:</span>
                    <span className="capitalize">{viewInvoice.terms.replace(/-/g, " ")}</span>
                  </div>
                </div>
              </div>

              {/* Line Items */}
              <div>
                <h3 className="font-semibold mb-3">Items</h3>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product/Service</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewInvoice.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{item.productName}</div>
                              {item.description && (
                                <div className="text-sm text-muted-foreground">
                                  {item.description}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">R{item.price.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium">
                            R{item.total.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Totals */}
              <div className="border rounded-lg p-4 bg-muted/30">
                <div className="space-y-2 max-w-sm ml-auto">
                  <div className="flex justify-between text-sm">
                    <span>Subtotal:</span>
                    <span>R{viewInvoice.subtotal.toFixed(2)}</span>
                  </div>
                  {viewInvoice.discountAmount && viewInvoice.discountAmount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span>Discount ({viewInvoice.discountPercent}%):</span>
                      <span>-R{viewInvoice.discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span>Tax ({viewInvoice.taxRate || 15}%):</span>
                    <span>R{viewInvoice.tax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total:</span>
                    <span>R{viewInvoice.total.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-green-600 border-t pt-2">
                    <span>Amount Paid:</span>
                    <span>R{viewInvoice.amountPaid.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold text-amber-600">
                    <span>Balance Due:</span>
                    <span>R{viewInvoice.balanceDue.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {viewInvoice.notes && (
                <div>
                  <h3 className="font-semibold mb-2">Notes</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {viewInvoice.notes}
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewInvoice(null)}>
              Close
            </Button>
            <Button 
              variant="outline" 
              onClick={() => viewInvoice && previewInvoice(viewInvoice, workspaceId || undefined)}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Preview
            </Button>
            <Button 
              variant="outline"
              onClick={() => viewInvoice && printInvoice(viewInvoice, workspaceId || undefined)}
            >
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
            <Button
                onClick={async () => {
                  if (!viewInvoice) return;
                  setSendingWhatsApp(true);
                  try {
                    await sendInvoiceViaWhatsApp(viewInvoice, workspaceId || undefined);
                    toast({
                      title: "PDF Downloaded",
                      description: "Invoice PDF saved — attach it in WhatsApp Web",
                    });
                  } catch (error) {
                    toast({
                      title: "WhatsApp Failed",
                      description: error instanceof Error ? error.message : "Failed to send",
                      variant: "destructive",
                    });
                  } finally {
                    setSendingWhatsApp(false);
                  }
                }}
                disabled={sendingWhatsApp}
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                {sendingWhatsApp ? "Generating PDF..." : "Send WhatsApp"}
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={() => viewInvoice && handleSendEmail(viewInvoice)}
                disabled={sendingEmail}
              >
                <Mail className="h-4 w-4 mr-2" />
                {sendingEmail ? "Sending..." : "Send Email"}
              </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!confirmDeleteInvoice} onOpenChange={() => setConfirmDeleteInvoice(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Invoice
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete <strong>{confirmDeleteInvoice?.invoiceNumber}</strong>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteInvoice(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteInvoice} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
