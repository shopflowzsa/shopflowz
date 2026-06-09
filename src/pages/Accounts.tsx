import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { 
  FileText, DollarSign, Plus, Eye, Check, X, Send, Clock, CheckCircle2, Printer, Download, MessageSquare 
} from "lucide-react";
import { Quote, Invoice, WorkspaceState } from "@/types/crm";
import { formatCurrency, createInvoiceFromQuote, recordPayment as recordPaymentHelper } from "@/lib/accountsService";
import { QuoteEditor } from "@/components/accounts/QuoteEditor";
import { InvoiceEditor } from "@/components/accounts/InvoiceEditor";
import { previewInvoice, printInvoice, downloadInvoice, sendInvoiceViaWhatsApp } from "@/lib/pdfService";
import { previewQuotation, printQuotation, downloadQuotation, sendQuotationViaWhatsApp } from "@/lib/pdfService";
import { toast } from "sonner";

interface AccountsPageProps {
  workspace: WorkspaceState;
  onUpdateWorkspace: (updates: Partial<WorkspaceState>) => void;
  userId: string;
  onTaskClick?: (taskId: string) => void;
}

export function AccountsPage({ workspace, onUpdateWorkspace, userId, onTaskClick }: AccountsPageProps) {
  const [activeTab, setActiveTab] = useState<"quotes" | "invoices">("quotes");
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [sendingWhatsAppId, setSendingWhatsAppId] = useState<string | null>(null);
  const [sendingQuoteWhatsAppId, setSendingQuoteWhatsAppId] = useState<string | null>(null);

  const quotes = workspace.quotes || [];
  const invoices = workspace.invoices || [];

  const handleSaveQuote = (quote: Quote) => {
    const exists = quotes.some(q => q.id === quote.id);
    onUpdateWorkspace({
      quotes: exists 
        ? quotes.map(q => q.id === quote.id ? quote : q)
        : [...quotes, quote],
    });
    setSelectedQuote(null);
  };

  const handleApproveQuote = (quote: Quote) => {
    handleSaveQuote(quote);
    toast.success("Quote approved! Click 'Create Invoice' to generate an invoice.");
  };

  const handleConvertToInvoice = (quote: Quote) => {
    const counter = (workspace.invoiceCounter ?? 0) + 1;
    const invoice = createInvoiceFromQuote(quote, counter);
    onUpdateWorkspace({
      invoices: [...invoices, invoice],
      invoiceCounter: counter,
      quotes: quotes.map(q => 
        q.id === quote.id ? { ...q, invoiceId: invoice.id } : q
      ),
    });
    setSelectedInvoice(invoice);
    toast.success("Invoice created from quote");
  };

  const handleSaveInvoice = (invoice: Invoice) => {
    const exists = invoices.some(i => i.id === invoice.id);
    onUpdateWorkspace({
      invoices: exists 
        ? invoices.map(i => i.id === invoice.id ? invoice : i)
        : [...invoices, invoice],
    });
    setSelectedInvoice(null);
  };

  const handleRecordPayment = (invoice: Invoice, amount: number, method: string, notes?: string) => {
    const updatedInvoice = recordPaymentHelper(invoice, amount, method, userId, notes);
    handleSaveInvoice(updatedInvoice);
  };

  const handleInvoicePreview = (invoice: Invoice) => {
    previewInvoice(invoice, workspace.id);
  };

  const handleInvoicePrint = (invoice: Invoice) => {
    printInvoice(invoice, workspace.id);
  };

  const handleInvoiceDownload = (invoice: Invoice) => {
    downloadInvoice(invoice, workspace.id);
  };

  const handleInvoiceWhatsApp = async (invoice: Invoice) => {
    setSendingWhatsAppId(invoice.id);
    try {
      await sendInvoiceViaWhatsApp(invoice, workspace.id);
      toast({ title: "PDF Downloaded", description: "Invoice PDF saved — attach it in WhatsApp" });
    } catch (e: any) {
      toast({ title: "WhatsApp Failed", description: e.message || "Failed", variant: "destructive" });
    } finally {
      setSendingWhatsAppId(null);
    }
  };

  const handleQuotePreview = (quote: Quote) => {
    previewQuotation(quote, workspace.id);
  };

  const handleQuotePrint = (quote: Quote) => {
    printQuotation(quote, workspace.id);
  };

  const handleQuoteDownload = (quote: Quote) => {
    downloadQuotation(quote, workspace.id);
  };

  const handleQuoteWhatsApp = async (quote: Quote) => {
    setSendingQuoteWhatsAppId(quote.id);
    try {
      await sendQuotationViaWhatsApp(quote, workspace.id);
      toast({ title: "PDF Downloaded", description: "Quotation PDF saved — attach it in WhatsApp" });
    } catch (e: any) {
      toast({ title: "WhatsApp Failed", description: e.message || "Failed", variant: "destructive" });
    } finally {
      setSendingQuoteWhatsAppId(null);
    }
  };

  const getQuoteStatusBadge = (status: Quote["status"]) => {
    const variants = {
      draft: { variant: "secondary" as const, icon: Clock, className: undefined },
      sent: { variant: "default" as const, icon: Send, className: undefined },
      approved: { variant: "default" as const, icon: Check, className: "bg-green-600" },
      rejected: { variant: "destructive" as const, icon: X, className: undefined },
      expired: { variant: "secondary" as const, icon: Clock, className: undefined },
    };
    const config = variants[status];
    const Icon = config.icon;
    return (
      <Badge variant={config.variant} className={config.className}>
        <Icon className="h-3 w-3 mr-1" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const getInvoiceStatusBadge = (status: Invoice["status"]) => {
    const variants = {
      draft: { variant: "secondary" as const, icon: Clock, className: undefined },
      sent: { variant: "default" as const, icon: Send, className: undefined },
      viewed: { variant: "default" as const, icon: Eye, className: undefined },
      partial: { variant: "default" as const, icon: Clock, className: "bg-yellow-600" },
      paid: { variant: "default" as const, icon: CheckCircle2, className: "bg-green-600" },
      overdue: { variant: "destructive" as const, icon: Clock, className: undefined },
      cancelled: { variant: "secondary" as const, icon: X, className: undefined },
    };
    const config = variants[status];
    const Icon = config.icon;
    return (
      <Badge variant={config.variant} className={config.className}>
        <Icon className="h-3 w-3 mr-1" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const stats = {
    totalQuotes: quotes.length,
    draftQuotes: quotes.filter(q => q.status === "draft").length,
    approvedQuotes: quotes.filter(q => q.status === "approved").length,
    totalInvoices: invoices.length,
    unpaidInvoices: invoices.filter(i => i.paymentStatus === "unpaid").length,
    paidInvoices: invoices.filter(i => i.paymentStatus === "paid").length,
    totalRevenue: invoices.filter(i => i.paymentStatus === "paid").reduce((sum, i) => sum + i.total, 0),
    outstandingAmount: invoices.reduce((sum, i) => sum + i.balanceDue, 0),
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Sales</h1>
        <p className="text-muted-foreground">Manage quotes and invoices</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Quotes</p>
                <p className="text-2xl font-bold">{stats.totalQuotes}</p>
              </div>
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {stats.draftQuotes} draft • {stats.approvedQuotes} approved
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Invoices</p>
                <p className="text-2xl font-bold">{stats.totalInvoices}</p>
              </div>
              <DollarSign className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {stats.unpaidInvoices} unpaid • {stats.paidInvoices} paid
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">{formatCurrency(stats.totalRevenue)}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">From paid invoices</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Outstanding</p>
                <p className="text-2xl font-bold">{formatCurrency(stats.outstandingAmount)}</p>
              </div>
              <Clock className="h-8 w-8 text-yellow-600" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">Awaiting payment</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for Quotes and Invoices */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "quotes" | "invoices")}>
        <TabsList>
          <TabsTrigger value="quotes">
            <FileText className="h-4 w-4 mr-2" />
            Quotes ({quotes.length})
          </TabsTrigger>
          <TabsTrigger value="invoices">
            <DollarSign className="h-4 w-4 mr-2" />
            Invoices ({invoices.length})
          </TabsTrigger>
        </TabsList>

        {/* Quotes Tab */}
        <TabsContent value="quotes" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Quotes</CardTitle>
                  <CardDescription>Manage customer quotes and estimates</CardDescription>
                </div>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  New Quote
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {quotes.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">No quotes yet</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Convert tasks to quotes from the task board
                  </p>
                </div>
               ) : (
                 <div className="space-y-1">
                   {quotes.map((quote) => {
                     const task = workspace.tasks.find(t => t.id === quote.taskId);
                     return (
                       <div key={quote.id} className="flex items-center gap-2 p-2 border rounded-lg hover:bg-muted/50 text-sm">
                         <div className="w-16 font-mono text-xs font-semibold">{quote.quoteNumber}</div>
                         <div className="flex-1 min-w-0">
                           <div className="font-medium truncate text-xs">{quote.customerName}</div>
                         </div>
                         <div className="w-14 text-xs text-muted-foreground">
                           {task?.jobNumber ? (
                             <button
                               onClick={() => onTaskClick?.(quote.taskId)}
                               className="text-blue-600 hover:underline"
                             >
                               {task.jobNumber}
                             </button>
                           ) : (
                             "—"
                           )}
                         </div>
                         <div className="w-16 text-right text-xs">{formatCurrency(quote.total)}</div>
                         <div className="w-20">{getQuoteStatusBadge(quote.status)}</div>
                         <div className="w-20 text-xs text-muted-foreground">{new Date(quote.createdAt).toLocaleDateString()}</div>
                         <div className="flex gap-1">
                           <Button
                             size="sm"
                             variant="outline"
                             onClick={() => setSelectedQuote(quote)}
                             title="View"
                           >
                             <Eye className="h-3 w-3" />
                           </Button>
                           <Button
                             size="sm"
                             variant="outline"
                             onClick={() => handleQuotePreview(quote)}
                             title="Preview"
                           >
                             <Eye className="h-3 w-3" />
                           </Button>
                           <Button
                             size="sm"
                             variant="outline"
                             onClick={() => handleQuotePrint(quote)}
                             title="Print"
                           >
                             <Printer className="h-3 w-3" />
                           </Button>
                           <Button
                             size="sm"
                             variant="outline"
                             onClick={() => handleQuoteDownload(quote)}
                             title="Download"
                           >
                             <Download className="h-3 w-3" />
                           </Button>
                           <Button
                             size="sm"
                             variant="outline"
                             onClick={() => handleQuoteWhatsApp(quote)}
                             disabled={sendingQuoteWhatsAppId === quote.id}
                             title="WhatsApp"
                           >
                             <MessageSquare className="h-3 w-3" />
                           </Button>
                           {quote.status === "approved" && !quote.invoiceId && (
                             <Button
                               size="sm"
                               onClick={() => handleConvertToInvoice(quote)}
                             >
                               <DollarSign className="h-3 w-3 mr-1" />
                               Create Invoice
                             </Button>
                           )}
                         </div>
                       </div>
                     );
                   })}
                 </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Invoices Tab */}
        <TabsContent value="invoices" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Invoices</CardTitle>
                  <CardDescription>Track payments and manage invoices</CardDescription>
                </div>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  New Invoice
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {invoices.length === 0 ? (
                <div className="text-center py-12">
                  <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">No invoices yet</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create invoices from approved quotes
                  </p>
                </div>
               ) : (
                  <div className="space-y-1">
                    {invoices.map((invoice) => {
                      const task = workspace.tasks.find(t => t.id === invoice.taskId);
                      return (
                        <div key={invoice.id} className="flex items-center gap-2 p-2 border rounded-lg hover:bg-muted/50 text-sm">
                          <div className="w-16 font-mono text-xs font-semibold">{invoice.invoiceNumber}</div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate text-xs">{invoice.customerName}</div>
                          </div>
                          <div className="w-16 text-right text-xs">{formatCurrency(invoice.total)}</div>
                          <div className="w-14 text-right text-green-600 text-xs">{formatCurrency(invoice.amountPaid)}</div>
                          <div className="w-14 text-right text-xs">{formatCurrency(invoice.balanceDue)}</div>
                          <div className="w-20">{getInvoiceStatusBadge(invoice.status)}</div>
                          <div className="w-20 text-xs text-muted-foreground">
                            {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—"}
                          </div>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedInvoice(invoice)}
                              title="View"
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleInvoicePreview(invoice)}
                              title="Preview"
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleInvoicePrint(invoice)}
                              title="Print"
                            >
                              <Printer className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleInvoiceDownload(invoice)}
                              title="Download"
                            >
                              <Download className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleInvoiceWhatsApp(invoice)}
                              disabled={sendingWhatsAppId === invoice.id}
                              title="WhatsApp"
                            >
                              <MessageSquare className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Quote Editor Dialog */}
      <QuoteEditor 
        quote={selectedQuote} 
        open={!!selectedQuote} 
        onClose={() => setSelectedQuote(null)} 
        onSave={handleSaveQuote}
        onApprove={handleApproveQuote}
      />
      
      {/* Invoice Editor Dialog */}
      <InvoiceEditor 
        invoice={selectedInvoice} 
        open={!!selectedInvoice} 
        onClose={() => setSelectedInvoice(null)} 
        onSave={handleSaveInvoice}
        onRecordPayment={handleRecordPayment}
      />
    </div>
  );
}
