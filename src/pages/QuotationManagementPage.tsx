import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QuotationCreationPage } from "@/pages/QuotationCreationPage";
import { InvoiceCreationPage } from "@/pages/InvoiceCreationPage";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { X, Plus, FileText, TrendingUp, CheckCircle, XCircle, Clock, DollarSign, ArrowRight, MessageSquare, Edit, Printer, ExternalLink, Download, Trash2 } from "lucide-react";
import { Quotation, InvoiceLineItem, Customer } from "@/types/invoice";
import {
  getQuotations,
  createQuotation,
  updateQuotationStatus,
  convertQuotationToInvoice,
  getQuotationAnalytics,
  checkExpiredQuotations,
  deleteQuotation,
} from "@/lib/quotationService";
import { getCustomers } from "@/lib/customerService";
import { inventoryService } from "@/lib/inventoryService";
import { printQuotation, previewQuotation, sendQuotationViaWhatsApp, downloadQuotation } from "@/lib/pdfService";

interface QuotationManagementPageProps {
  onClose: () => void;
  onQuotationDeleted?: (quotationId: string) => void;
  initialQuotationId?: string;
}

export function QuotationManagementPage({ onClose, onQuotationDeleted, initialQuotationId }: QuotationManagementPageProps) {
  const { user, workspaceId } = useAuth();
  const { toast } = useToast();

  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Analytics
  const [analytics, setAnalytics] = useState({
    total: 0,
    draft: 0,
    sent: 0,
    accepted: 0,
    declined: 0,
    expired: 0,
    totalValue: 0,
    acceptedValue: 0,
    conversionRate: 0,
  });

  // New Quotation Dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState<Quotation | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [items, setItems] = useState<Omit<InvoiceLineItem, "id">[]>([
    { productName: "", quantity: 1, price: 0, total: 0 },
  ]);
  const [vatEnabled, setVatEnabled] = useState(true);
  const [taxRate, setTaxRate] = useState(15);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [validUntil, setValidUntil] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [terms, setTerms] = useState("");
  const [notes, setNotes] = useState("");

  // Convert Dialog
  const [showConvertToInvoice, setShowConvertToInvoice] = useState(false);
  const [quotationToConvert, setQuotationToConvert] = useState<Quotation | null>(null);

  // WhatsApp sending
  const [sendingWhatsAppId, setSendingWhatsAppId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Enrich a quotation with customer address/account data for PDF generation
  const enrichQ = (q: Quotation): Quotation => {
    const customer = customers.find(c => c.id === q.customerId);
    return {
      ...q,
      customerCompanyName: q.customerCompanyName || customer?.companyName,
      customerContactName: q.customerContactName || customer?.contactPerson,
      billingAddress: q.billingAddress || customer?.billingAddress,
      shippingAddress: q.shippingAddress || customer?.shippingAddress,
      customerAccountNumber: q.customerAccountNumber || customer?.customerNumber,
      customerPhone: q.customerPhone || customer?.phone,
      customerEmail: q.customerEmail || customer?.email,
    };
  };

  useEffect(() => {
    if (workspaceId) {
      loadData();
    }
  }, [workspaceId]);

  async function loadData() {
    setLoading(true);
    try {
      const [quotationsData, customersData, inventoryData, analyticsData] = await Promise.all([
        getQuotations(workspaceId),
        getCustomers(workspaceId),
        inventoryService.getAll(workspaceId),
        getQuotationAnalytics(workspaceId),
      ]);

      // Check for expired quotations
      await checkExpiredQuotations(workspaceId);

      setQuotations(quotationsData);
      setCustomers(customersData);
      setInventoryItems(inventoryData);
      setAnalytics(analyticsData);
      // Auto-open a specific quotation if provided
      if (initialQuotationId) {
        const target = quotationsData.find((q: any) => q.id === initialQuotationId);
        if (target) setEditingQuotation(target);
      }
    } catch (error) {
      console.error("Error loading data:", error);
      toast({
        title: "Error",
        description: "Failed to load quotations",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function addLineItem() {
    setItems([...items, { productName: "", quantity: 1, price: 0, total: 0 }]);
  }

  function removeLineItem(index: number) {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  }

  function updateLineItem(index: number, field: keyof InvoiceLineItem, value: any) {
    const newItems = [...items];
    (newItems[index] as any)[field] = value;

    if (field === "quantity" || field === "price") {
      newItems[index].total = newItems[index].quantity * newItems[index].price;
    }

    // If selecting from inventory
    if (field === "productName" && value.startsWith("inv_")) {
      const productId = value.replace("inv_", "");
      const product = inventoryItems.find((p) => p.id === productId);
      if (product) {
        newItems[index].productId = product.id;
        newItems[index].productName = product.name;
        newItems[index].sku = product.sku;
        newItems[index].price = product.price || 0;
        newItems[index].total = newItems[index].quantity * newItems[index].price;
      }
    }

    setItems(newItems);
  }

  async function handleCreateQuotation() {
    if (!selectedCustomerId) {
      toast({
        title: "Validation Error",
        description: "Please select a customer",
        variant: "destructive",
      });
      return;
    }

    if (items.some((item) => !item.productName || item.quantity <= 0 || item.price < 0)) {
      toast({
        title: "Validation Error",
        description: "Please fill in all line items correctly",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const customer = customers.find((c) => c.id === selectedCustomerId);
      if (!customer) throw new Error("Customer not found");

      const newQuotation = await createQuotation(workspaceId, user.uid, {
        customerId: customer.id,
        customerName: customer.companyName || customer.contactPerson,
        customerEmail: customer.email,
        items: items.map((item) => ({
          ...item,
          taxRate: vatEnabled ? taxRate : 0,
        })),
        taxRate: vatEnabled ? taxRate : 0,
        discountPercent,
        validUntil,
        terms,
        notes,
      });
      setQuotations((prev) => [newQuotation, ...prev]);

      toast({
        title: "Success",
        description: "Quotation created successfully",
      });

      setShowCreateDialog(false);
      resetForm();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create quotation",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(quotationId: string, newStatus: Quotation["status"]) {
    try {
      await updateQuotationStatus(workspaceId, quotationId, newStatus, user?.uid);
      toast({
        title: "Success",
        description: `Quotation marked as ${newStatus}`,
      });
      loadData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    }
  }

  async function handleDelete(quotationId: string, quotationNumber: string) {
    if (!confirm(`Permanently delete quotation ${quotationNumber}? This cannot be undone.`)) {
      return;
    }
    
    try {
      await deleteQuotation(workspaceId, quotationId);
      onQuotationDeleted?.(quotationId);
      toast({
        title: "Success",
        description: `Quotation ${quotationNumber} deleted`,
      });
      loadData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete quotation",
        variant: "destructive",
      });
    }
  }

  function resetForm() {
    setSelectedCustomerId("");
    setItems([{ productName: "", quantity: 1, price: 0, total: 0 }]);
    setVatEnabled(true);
    setTaxRate(15);
    setDiscountPercent(0);
    setValidUntil(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);
    setTerms("");
    setNotes("");
  }

  function openConvertDialog(quotation: Quotation) {
    setQuotationToConvert(quotation);
    setShowConvertToInvoice(true);
  }

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const discountAmount = (subtotal * discountPercent) / 100;
  const taxableAmount = subtotal - discountAmount;
  const taxAmount = vatEnabled ? (taxableAmount * taxRate) / 100 : 0;
  const grandTotal = taxableAmount + taxAmount;

  const filteredQuotations = quotations.filter((q) => {
    const matchesSearch =
      (q.quotationNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (q.customerName || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || q.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  function getStatusBadge(status: Quotation["status"]) {
    const statusConfig = {
      draft: { color: "bg-gray-100 text-gray-800", label: "Draft" },
      sent: { color: "bg-blue-100 text-blue-800", label: "Sent" },
      accepted: { color: "bg-green-100 text-green-800", label: "Accepted" },
      declined: { color: "bg-red-100 text-red-800", label: "Declined" },
      expired: { color: "bg-orange-100 text-orange-800", label: "Expired" },
    };

    const config = statusConfig[status] || { color: "bg-gray-100 text-gray-800", label: status || "Unknown" };
    return <Badge className={config.color}>{config.label}</Badge>;
  }

  if (!user || !workspaceId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-500">Please login to manage quotations</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 bg-background overflow-y-auto">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Quotation Management</h1>
            <p className="text-gray-600 mt-1">Create quotes and convert them to invoices</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Quotation
            </Button>
            <Button variant="outline" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Analytics Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600">Total Quotations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600">Sent</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center">
                <Clock className="h-5 w-5 text-blue-600 mr-2" />
                <div className="text-2xl font-bold">{analytics.sent}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600">Accepted</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
                <div className="text-2xl font-bold">{analytics.accepted}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600">Conversion Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center">
                <TrendingUp className="h-5 w-5 text-purple-600 mr-2" />
                <div className="text-2xl font-bold">{analytics.conversionRate}%</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600">Total Value</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center">
                <DollarSign className="h-5 w-5 text-orange-600 mr-2" />
                <div className="text-2xl font-bold">
                  R{analytics.totalValue.toLocaleString()}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <Input
                placeholder="Search quotations..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
              />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Quotations Table */}
        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <div className="text-center py-12">
                <p className="text-gray-500">Loading quotations...</p>
              </div>
            ) : filteredQuotations.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500">No quotations found</p>
                <Button className="mt-4" onClick={() => setShowCreateDialog(true)}>
                  Create Your First Quotation
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Number</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Valid Until</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredQuotations.map((quotation) => (
                      <TableRow key={quotation.id}>
                        <TableCell className="font-medium">{quotation.quotationNumber}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{quotation.customerName}</p>
                            {quotation.customerEmail && (
                              <p className="text-sm text-gray-500">{quotation.customerEmail}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {new Date(quotation.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              new Date(quotation.validUntil) < new Date()
                                ? "text-red-600 font-medium"
                                : ""
                            }
                          >
                            {new Date(quotation.validUntil).toLocaleDateString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          R{quotation.total.toFixed(2)}
                        </TableCell>
                        <TableCell>{getStatusBadge(quotation.status)}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            {!quotation.convertedToInvoiceId && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingQuotation(quotation)}
                                title="Edit quotation"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            )}
                            {quotation.status === "draft" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleStatusChange(quotation.id, "sent")}
                              >
                                Send
                              </Button>
                            )}
                            {quotation.status === "sent" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleStatusChange(quotation.id, "accepted")}
                                >
                                  Accept
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleStatusChange(quotation.id, "declined")}
                                >
                                  Decline
                                </Button>
                              </>
                            )}
                            {(quotation.customerPhone || quotation.customerEmail) && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  if (!workspaceId || !quotation.customerPhone) {
                                    toast({
                                      title: "No Phone Number",
                                      description: "Customer phone number is required",
                                      variant: "destructive",
                                    });
                                    return;
                                  }
                                  setSendingWhatsAppId(quotation.id);
                                  try {
                                    await sendQuotationViaWhatsApp(enrichQ(quotation), workspaceId || undefined);
                                    toast({
                                      title: "PDF Downloaded",
                                      description: "Quotation PDF saved — attach it in WhatsApp Web",
                                    });
                                  } catch (error) {
                                    toast({
                                      title: "WhatsApp Failed",
                                      description: error instanceof Error ? error.message : "Failed to send",
                                      variant: "destructive",
                                    });
                                  } finally {
                                    setSendingWhatsAppId(null);
                                  }
                                }}
                                disabled={sendingWhatsAppId === quotation.id}
                                title={quotation.customerPhone ? `Send to ${quotation.customerPhone}` : "No phone number"}
                              >
                                <MessageSquare className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                setDownloadingId(quotation.id);
                                try {
                                  await downloadQuotation(enrichQ(quotation), workspaceId || undefined);
                                  toast({
                                    title: "PDF Downloaded",
                                    description: `Quotation-${quotation.quotationNumber}.pdf saved`,
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
                              disabled={downloadingId === quotation.id}
                              title="Download PDF"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => previewQuotation(enrichQ(quotation), workspaceId || undefined)}
                              title="Preview quotation"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => printQuotation(enrichQ(quotation), workspaceId || undefined)}
                              title="Print quotation"
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                            {(quotation.status === "accepted" || quotation.status === "sent") &&
                              !quotation.convertedToInvoiceId && (
                                <Button size="sm" onClick={() => openConvertDialog(quotation)}>
                                  <ArrowRight className="h-4 w-4 mr-1" />
                                  To Invoice
                                </Button>
                              )}
                            {quotation.convertedToInvoiceId && (
                              <Badge variant="secondary">✓ Invoiced</Badge>
                            )}
                            {!quotation.convertedToInvoiceId && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDelete(quotation.id, quotation.quotationNumber)}
                                title="Delete quotation"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Create Quotation - Full Page */}
        {showCreateDialog && (
          <QuotationCreationPage
            onClose={() => setShowCreateDialog(false)}
            onSaved={() => loadData()}
          />
        )}

        {/* Edit Quotation - Full Page */}
        {editingQuotation && (
          <QuotationCreationPage
            onClose={() => setEditingQuotation(null)}
            onSaved={() => loadData()}
            editingQuotation={editingQuotation}
          />
        )}

        {/* Convert to Invoice - Full Page */}
        {showConvertToInvoice && quotationToConvert && (
          <InvoiceCreationPage
            fromQuotation={quotationToConvert}
            onClose={async () => {
              // Mark quotation as converted
              if (quotationToConvert) {
                try {
                  await updateQuotationStatus(workspaceId, quotationToConvert.id, 'accepted', user?.uid);
                } catch (error) {
                  console.error('Error updating quotation status:', error);
                }
              }
              setShowConvertToInvoice(false);
              setQuotationToConvert(null);
              loadData();
            }}
          />
        )}
      </div>
    </div>
  );
}
