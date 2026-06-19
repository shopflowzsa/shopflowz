import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, Printer, Download, Search, FileText, Calendar, Pencil, Eye, Mail, CreditCard, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { getInvoices, addPaymentToInvoice } from "@/lib/invoiceService";
import { getCustomers } from "@/lib/customerService";
import { loadSalesSettings, DEFAULT_SALES_SETTINGS } from "@/lib/salesSettingsService";
import { previewInvoice, printInvoice, downloadInvoice, sendInvoiceViaWhatsApp } from "@/lib/pdfService";
import { InvoiceCreationPage } from "@/pages/InvoiceCreationPage";

import { SUPABASE_URL,  supabase } from "@/lib/supabase";
import { getEffectiveSmtp } from "@/lib/emailAccountService";
import type { Invoice, Customer } from "@/types/invoice";

const SMTP_URL = `${SUPABASE_URL}/functions/v1/send-email`;

interface StatementRow {
  date: string;
  reference: string;
  jobRef?: string;
  description: string;
  debit: number;   // invoice amount
  credit: number;  // payment received
  balance: number; // running balance
  type: "invoice" | "payment" | "opening";
  status?: string;
}

interface StatementPageProps {
  onClose: () => void;
}

function fmt(n: number) {
  return `R${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function fmtDate(d: string) {
  try { return new Date(d).toLocaleDateString("en-ZA"); } catch { return d; }
}

export function StatementPage({ onClose }: StatementPageProps) {
  const { user, workspaceId } = useAuth();

  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [printing, setPrinting] = useState(false);
  const [statementType, setStatementType] = useState<"account" | "summary" | "outstanding" | "ageing">("account");
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);

  // ── Payment state ──────────────────────────────────────────────────────────
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [receivedAmount, setReceivedAmount] = useState("");
  const [paymentAllocations, setPaymentAllocations] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState<string>("bank-transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [processingPayment, setProcessingPayment] = useState(false);

  function autoAllocate(totalStr: string, invoices: Invoice[]) {
    let remaining = parseFloat(totalStr) || 0;
    const allocs: Record<string, string> = {};
    for (const inv of invoices) {
      if (remaining <= 0) { allocs[inv.id] = ""; continue; }
      const apply = Math.min(remaining, inv.balanceDue);
      allocs[inv.id] = apply.toFixed(2);
      remaining -= apply;
      remaining = Math.round(remaining * 100) / 100;
    }
    return allocs;
  }

  const { toast } = useToast();

  const WALKIN_ID = "__walkin__";

  useEffect(() => {
    if (!workspaceId) return;
    Promise.all([getInvoices(workspaceId), getCustomers(workspaceId)])
      .then(([invs, custs]) => {
        setInvoices(invs);
        // Inject virtual Cash Sale customer if any walk-in invoices exist
        const hasWalkin = invs.some(i => i.customerId === WALKIN_ID);
        if (hasWalkin && !custs.find(c => c.id === WALKIN_ID)) {
          const walkinCustomer = {
            id: WALKIN_ID,
            companyName: "Cash Sale",
            contactPerson: "Cash Sale",
            customerNumber: "CASH-001",
            email: "",
            phone: "",
            status: "active",
          } as unknown as Customer;
          custs = [walkinCustomer, ...custs];
        }
        setCustomers(custs);
      })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  // Build per-customer statement rows from invoices
  const statementByCustomer = useMemo(() => {
    const map = new Map<string, StatementRow[]>();

    for (const inv of invoices) {
      if (!map.has(inv.customerId)) map.set(inv.customerId, []);
      const rows = map.get(inv.customerId)!;

      rows.push({
        date: inv.invoiceDate,
        reference: inv.invoiceNumber,
        jobRef: inv.purchaseOrder || "",
        description: `Invoice – ${inv.items.map(i => i.productName).filter(Boolean).join(", ") || "Services"}`,
        debit: inv.total,
        credit: 0,
        balance: 0, // recalculated below
        type: "invoice",
        status: inv.paymentStatus,
      });

      // If paid (fully or partial), add payment rows
      const paid = inv.amountPaid || 0;
      if (paid > 0) {
        rows.push({
          date: inv.updatedAt?.split("T")[0] || inv.invoiceDate,
          reference: `PMT-${inv.invoiceNumber}`,
          description: `Payment received – ${inv.invoiceNumber}`,
          debit: 0,
          credit: paid,
          balance: 0,
          type: "payment",
        });
      }
    }

    // Sort rows by date and recalculate running balance per customer
    for (const [, rows] of map) {
      rows.sort((a, b) => a.date.localeCompare(b.date));
      let running = 0;
      for (const row of rows) {
        running += row.debit - row.credit;
        row.balance = running;
      }
    }
    return map;
  }, [invoices]);

  // Summary totals per customer
  const customerSummaries = useMemo(() => {
    return customers.map(c => {
      const allInvs = invoices.filter(i => i.customerId === c.id);
      const totalInvoiced = allInvs.reduce((s, i) => s + i.total, 0);
      const totalPaid = allInvs.reduce((s, i) => s + (i.amountPaid || 0), 0);
      const outstanding = totalInvoiced - totalPaid;
      const overdue = allInvs
        .filter(i => i.paymentStatus !== "paid" && new Date(i.dueDate) < new Date())
        .reduce((s, i) => s + i.balanceDue, 0);
      return { ...c, totalInvoiced, totalPaid, outstanding, overdue };
    }).filter(c => c.totalInvoiced > 0 || selectedCustomerId === c.id);
  }, [customers, invoices, selectedCustomerId]);

  const filteredCustomers = useMemo(() => {
    const q = search.toLowerCase();
    return customerSummaries.filter(c =>
      (c.companyName || c.contactPerson).toLowerCase().includes(q)
    );
  }, [customerSummaries, search]);

  // Rows for selected customer within date range
  const selectedRows = useMemo(() => {
    if (selectedCustomerId === "all") return [];
    const rows = statementByCustomer.get(selectedCustomerId) || [];
    const dateFiltered = rows.filter(r => r.date >= dateFrom && r.date <= dateTo);

    if (statementType === "outstanding") {
      // Only keep invoice rows where the invoice still has a balance due, plus their payment rows
      const outstandingInvNums = new Set(
        invoices
          .filter(i => i.customerId === selectedCustomerId && i.balanceDue > 0)
          .map(i => i.invoiceNumber)
      );
      return dateFiltered.filter(r =>
        r.type === "invoice"
          ? outstandingInvNums.has(r.reference)
          : outstandingInvNums.has(r.reference.replace(/^PMT-/, ""))
      );
    }

    return dateFiltered;
  }, [selectedCustomerId, statementByCustomer, dateFrom, dateTo, statementType, invoices]);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

  // Outstanding invoices for the selected customer (for payment allocation)
  const outstandingInvoices = useMemo(() => {
    if (selectedCustomerId === "all") return [];
    return invoices
      .filter(i => i.customerId === selectedCustomerId && i.balanceDue > 0)
      .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
  }, [invoices, selectedCustomerId]);

  function openPaymentDialog(prefillInvoice?: Invoice) {
    if (prefillInvoice) {
      // Single invoice — pre-fill the exact balance
      const amtStr = prefillInvoice.balanceDue.toFixed(2);
      setReceivedAmount(amtStr);
      setPaymentAllocations({ [prefillInvoice.id]: amtStr });
    } else {
      // All outstanding — start with 0, user types the amount received
      setReceivedAmount("");
      setPaymentAllocations({});
    }
    setPaymentMethod("bank-transfer");
    setPaymentReference("");
    setPaymentNotes("");
    setPaymentDialogOpen(true);
  }

  function handleReceivedAmountChange(val: string) {
    setReceivedAmount(val);
    setPaymentAllocations(autoAllocate(val, outstandingInvoices));
  }

  const paymentTotal = Object.values(paymentAllocations)
    .reduce((sum, v) => sum + (parseFloat(v) || 0), 0);

  async function handleReceivePayment() {
    if (!workspaceId || !user) return;
    const entries = Object.entries(paymentAllocations)
      .map(([id, v]) => ({ id, amount: parseFloat(v) || 0 }))
      .filter(e => e.amount > 0);
    if (entries.length === 0) {
      toast({ title: "No amounts entered", description: "Enter an amount for at least one invoice", variant: "destructive" });
      return;
    }
    // Validate each allocation doesn't exceed balance
    for (const e of entries) {
      const inv = outstandingInvoices.find(i => i.id === e.id);
      if (inv && e.amount > inv.balanceDue + 0.001) {
        toast({ title: "Amount exceeds balance", description: `${inv.invoiceNumber}: max R${inv.balanceDue.toFixed(2)}`, variant: "destructive" });
        return;
      }
    }
    setProcessingPayment(true);
    try {
      const updatedById = new Map<string, Invoice>();
      for (const e of entries) {
        const updatedInv = await addPaymentToInvoice(workspaceId, e.id, user.uid, {
          amount: e.amount,
          paymentMethod: paymentMethod as any,
          reference: paymentReference,
          notes: paymentNotes,
        });
        updatedById.set(updatedInv.id, updatedInv);
      }
      toast({ title: "Payment recorded", description: `R${paymentTotal.toFixed(2)} allocated across ${entries.length} invoice${entries.length > 1 ? "s" : ""}` });
      setInvoices((prev) => prev.map((inv) => updatedById.get(inv.id) || inv));
      setPaymentDialogOpen(false);
      setViewingInvoice(null);
    } catch (err: any) {
      toast({ title: "Failed to record payment", description: err.message, variant: "destructive" });
    } finally {
      setProcessingPayment(false);
    }
  }

  // ── PDF/Print ──────────────────────────────────────────────────────────────
  async function handlePrint() {
    if (!selectedCustomer) return;
    setPrinting(true);
    try {
      const settings = workspaceId
        ? await loadSalesSettings(workspaceId)
        : DEFAULT_SALES_SETTINGS;
      const color = settings.primaryColor || "#2563eb";
      const custName = selectedCustomer.companyName || selectedCustomer.contactPerson || "";
      const customerInvoices = invoices.filter(i => i.customerId === selectedCustomerId);

      let html = "";
      let filename = `Statement-${custName.replace(/\s+/g, "-")}`;

      if (statementType === "account") {
        if (selectedRows.length === 0) { setPrinting(false); return; }
        const openingBalance = (() => {
          const allRows = statementByCustomer.get(selectedCustomerId) || [];
          const before = allRows.filter(r => r.date < dateFrom);
          return before.length ? before[before.length - 1].balance : 0;
        })();
        const rows = selectedRows;
        const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
        const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
        const closingBalance = rows.length ? rows[rows.length - 1].balance : openingBalance;
        html = buildAccountStatementHTML(settings, color, dateFrom, dateTo, selectedCustomer, openingBalance, rows, totalDebit, totalCredit, closingBalance);
        filename = `AccountStatement-${custName.replace(/\s+/g, "-")}`;
      } else if (statementType === "summary") {
        const invRows = customerInvoices.filter(i => i.invoiceDate >= dateFrom && i.invoiceDate <= dateTo);
        if (invRows.length === 0) { setPrinting(false); return; }
        html = buildInvoiceSummaryHTML(settings, color, dateFrom, dateTo, custName, invRows);
        filename = `InvoiceSummary-${custName.replace(/\s+/g, "-")}`;
      } else if (statementType === "outstanding") {
        const outstanding = customerInvoices.filter(i => i.balanceDue > 0);
        if (outstanding.length === 0) { setPrinting(false); return; }
        html = buildOutstandingHTML(settings, color, custName, outstanding);
        filename = `OutstandingStatement-${custName.replace(/\s+/g, "-")}`;
      } else if (statementType === "ageing") {
        if (customerInvoices.length === 0) { setPrinting(false); return; }
        html = buildAgeingHTML(settings, color, custName, customerInvoices);
        filename = `AgeingSummary-${custName.replace(/\s+/g, "-")}`;
      }

      const html2pdf = (await import("html2pdf.js")).default;
      const parser = new DOMParser();
      const parsed = parser.parseFromString(html, "text/html");
      const styleEl = parsed.querySelector("style");
      const pageEl = parsed.querySelector(".page") as HTMLElement;
      const container = document.createElement("div");
      container.style.position = "absolute";
      container.style.left = "-9999px";
      container.style.background = "#fff";
      if (styleEl) container.appendChild(styleEl);
      container.appendChild(pageEl);
      document.body.appendChild(container);
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename: `${filename}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["avoid-all", "css"] },
        })
        .from(pageEl)
        .save();
      document.body.removeChild(container);
    } finally {
      setPrinting(false);
    }
  }

  // ── Build statement HTML (shared between download + email) ─────────────────
  async function buildStatementHTML() {
    if (!selectedCustomer) return null;
    const settings = workspaceId
      ? await loadSalesSettings(workspaceId)
      : DEFAULT_SALES_SETTINGS;
    const color = settings.primaryColor || "#2563eb";
    const custName = selectedCustomer.companyName || selectedCustomer.contactPerson || "";
    const customerInvoices = invoices.filter(i => i.customerId === selectedCustomerId);

    if (statementType === "account") {
      if (selectedRows.length === 0) return null;
      const allRows = statementByCustomer.get(selectedCustomerId) || [];
      const before = allRows.filter(r => r.date < dateFrom);
      const openingBalance = before.length ? before[before.length - 1].balance : 0;
      const rows = selectedRows;
      const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
      const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
      const closingBalance = rows.length ? rows[rows.length - 1].balance : openingBalance;
      return { html: buildAccountStatementHTML(settings, color, dateFrom, dateTo, selectedCustomer, openingBalance, rows, totalDebit, totalCredit, closingBalance), closingBalance, settings };
    } else if (statementType === "summary") {
      const invRows = customerInvoices.filter(i => i.invoiceDate >= dateFrom && i.invoiceDate <= dateTo);
      if (invRows.length === 0) return null;
      return { html: buildInvoiceSummaryHTML(settings, color, dateFrom, dateTo, custName, invRows), closingBalance: invRows.reduce((s, i) => s + i.total, 0), settings };
    } else if (statementType === "outstanding") {
      const outstanding = customerInvoices.filter(i => i.balanceDue > 0);
      if (outstanding.length === 0) return null;
      return { html: buildOutstandingHTML(settings, color, custName, outstanding), closingBalance: outstanding.reduce((s, i) => s + i.balanceDue, 0), settings };
    } else if (statementType === "ageing") {
      if (customerInvoices.length === 0) return null;
      return { html: buildAgeingHTML(settings, color, custName, customerInvoices), closingBalance: customerInvoices.reduce((s, i) => s + i.balanceDue, 0), settings };
    }
    return null;
  }

  function buildAccountStatementHTML(settings: any, color: string, dateFrom: string, dateTo: string, customer: Customer, openingBalance: number, rows: StatementRow[], totalDebit: number, totalCredit: number, closingBalance: number) {
    const custName = customer.companyName || customer.contactPerson || "";
    const lightColor = color + "18"; // very light tint for alternating rows
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Arial', sans-serif; font-size: 11px; color: #1a1a1a; background: #fff; }
  .page { width: 648px; margin: 0 auto; padding: 24px 28px 32px; }

  /* ── Header ── */
  .header { display: table; width: 100%; margin-bottom: 28px; }
  .header-left { display: table-cell; vertical-align: top; width: 50%; }
  .header-right { display: table-cell; vertical-align: top; text-align: right; }
  .logo-img { max-height: 56px; max-width: 180px; }
  .company-name-text { font-size: 22px; font-weight: bold; color: ${color}; letter-spacing: -0.5px; }
  .company-details { font-size: 10px; line-height: 1.8; color: #555; margin-top: 4px; }

  /* ── Title bar ── */
  .title-bar { background: ${color}; color: #fff; padding: 12px 16px; border-radius: 5px; display: table; width: 100%; margin-bottom: 24px; }
  .title-bar-left { display: table-cell; vertical-align: middle; }
  .title-bar-left h1 { font-size: 18px; font-weight: bold; letter-spacing: 3px; }
  .title-bar-right { display: table-cell; vertical-align: middle; text-align: right; font-size: 10px; line-height: 1.9; opacity: 0.95; }

  /* ── Info grid ── */
  .info-grid { display: table; width: 100%; margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 5px; overflow: hidden; }
  .info-cell { display: table-cell; width: 33.33%; padding: 12px 14px; vertical-align: top; border-right: 1px solid #e5e7eb; }
  .info-cell:last-child { border-right: none; }
  .info-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: #888; margin-bottom: 5px; font-weight: bold; }
  .info-value { font-size: 11px; color: #1a1a1a; line-height: 1.65; }
  .info-value strong { font-size: 12px; display: block; margin-bottom: 2px; }

  /* ── Table ── */
  table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  .table-wrap { border: 1px solid #e5e7eb; border-radius: 5px; overflow: hidden; margin-bottom: 20px; }
  thead tr { background: ${color}; }
  thead th { color: #fff; font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.7px; padding: 9px 10px; text-align: left; white-space: nowrap; }
  thead th.r { text-align: right; }
  tbody tr { border-bottom: 1px solid #f0f0f0; page-break-inside: avoid; }
  tbody tr:nth-child(even) { background: ${lightColor}; }
  tbody tr.opening td { font-style: italic; color: #666; background: #fafafa; }
  tbody tr.total-row { background: #f1f5f9 !important; border-top: 2px solid #cbd5e1; page-break-inside: avoid; }
  tbody tr.total-row td { font-weight: bold; font-size: 11px; padding: 10px 10px; }
  td { padding: 8px 10px; font-size: 10.5px; vertical-align: middle; }
  td.r { text-align: right; white-space: nowrap; }
  td.mono { font-family: monospace; font-size: 10px; }
  .tag-inv { display: inline-block; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 3px; padding: 1px 5px; font-size: 9px; font-weight: bold; }
  .tag-pmt { display: inline-block; background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; border-radius: 3px; padding: 1px 5px; font-size: 9px; font-weight: bold; }
  .debit { color: #dc2626; font-weight: 600; }
  .credit { color: #16a34a; font-weight: 600; }
  .bal-owe { color: #dc2626; font-weight: 700; }
  .bal-ok { color: #16a34a; font-weight: 700; }

  /* ── Summary + Bank side by side ── */
  .bottom-grid { display: table; width: 100%; margin-top: 8px; }
  .bottom-left { display: table-cell; width: 55%; vertical-align: top; padding-right: 16px; }
  .bottom-right { display: table-cell; width: 45%; vertical-align: top; }
  .bank-box { border: 1px solid #e5e7eb; border-radius: 5px; padding: 12px 14px; background: #f9fafb; }
  .bank-box h4 { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: #888; font-weight: bold; margin-bottom: 8px; padding-bottom: 5px; border-bottom: 1px solid #e5e7eb; }
  .bank-row { display: table; width: 100%; margin-bottom: 3px; }
  .bank-row-label { display: table-cell; font-size: 10px; color: #555; }
  .bank-row-value { display: table-cell; font-size: 10px; font-weight: 600; text-align: right; color: #1a1a1a; }
  .amount-due-box { border: 2px solid ${color}; border-radius: 5px; padding: 14px 16px; background: #fff; }
  .amount-due-box h4 { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: #888; font-weight: bold; margin-bottom: 10px; }
  .amount-due-row { display: table; width: 100%; margin-bottom: 5px; }
  .amount-due-label { display: table-cell; font-size: 10.5px; color: #333; }
  .amount-due-value { display: table-cell; text-align: right; font-size: 10.5px; font-weight: 600; }
  .amount-due-total { display: table; width: 100%; margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb; }
  .amount-due-total .l { display: table-cell; font-size: 12px; font-weight: bold; color: #1a1a1a; }
  .amount-due-total .v { display: table-cell; text-align: right; font-size: 16px; font-weight: bold; color: ${color}; }

  /* ── Footer ── */
  .footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 9px; color: #aaa; }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-left">
      ${settings.logoUrl
        ? `<img src="${settings.logoUrl}" alt="logo" class="logo-img"/>`
        : `<div class="company-name-text">${settings.companyName || "Company"}</div>`
      }
    </div>
    <div class="header-right">
      <div class="company-details">
        <strong style="font-size:12px;color:#1a1a1a;">${settings.companyName || ""}</strong><br/>
        ${settings.companyAddress ? settings.companyAddress + "<br/>" : ""}
        ${settings.companyCity ? settings.companyCity + (settings.companyProvince ? ", " + settings.companyProvince : "") + "<br/>" : ""}
        ${settings.companyPhone ? "Tel: " + settings.companyPhone + "<br/>" : ""}
        ${settings.companyEmail ? settings.companyEmail + "<br/>" : ""}
        ${settings.vatRegistrationNumber ? "VAT Reg No: " + settings.vatRegistrationNumber : ""}
      </div>
    </div>
  </div>

  <!-- Title bar -->
  <div class="title-bar">
    <div class="title-bar-left"><h1>ACCOUNT STATEMENT</h1></div>
    <div class="title-bar-right">
      Period: ${fmtDate(dateFrom)} &ndash; ${fmtDate(dateTo)}<br/>
      Printed: ${fmtDate(new Date().toISOString())}
    </div>
  </div>

  <!-- Info grid -->
  <div class="info-grid">
    <div class="info-cell">
      <div class="info-label">Statement For</div>
      <div class="info-value">
        <strong>${custName}</strong>
        ${customer.email ? customer.email + "<br/>" : ""}
        ${customer.phone || ""}
      </div>
    </div>
    <div class="info-cell">
      <div class="info-label">Account Number</div>
      <div class="info-value">
        <strong>${customer.customerNumber || "—"}</strong>
        Currency: ZAR
      </div>
    </div>
    <div class="info-cell">
      <div class="info-label">Period Summary</div>
      <div class="info-value">
        Total Charges: <strong style="color:#dc2626">${fmt(totalDebit)}</strong><br/>
        Total Payments: <strong style="color:#16a34a">${fmt(totalCredit)}</strong>
      </div>
    </div>
  </div>

  <!-- Transactions table -->
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="width:10%">Date</th>
          <th style="width:12%">Invoice #</th>
          <th style="width:11%">Reference</th>
          <th style="width:22%">Description</th>
          <th class="r" style="width:15%">Charges</th>
          <th class="r" style="width:15%">Payments</th>
          <th class="r" style="width:15%">Balance</th>
        </tr>
      </thead>
      <tbody>
        <tr class="opening">
          <td>${fmtDate(dateFrom)}</td>
          <td>—</td>
          <td>—</td>
          <td>Opening Balance</td>
          <td class="r">—</td>
          <td class="r">—</td>
          <td class="r ${openingBalance > 0 ? "bal-owe" : "bal-ok"}">${fmt(openingBalance)}</td>
        </tr>
        ${rows.map(r => `
        <tr>
          <td>${fmtDate(r.date)}</td>
          <td class="mono">${r.type === "invoice"
            ? `<span class="tag-inv">${r.reference}</span>`
            : `<span class="tag-pmt">${r.reference}</span>`
          }</td>
          <td style="color:#555">${r.jobRef || "—"}</td>
          <td>${r.description}</td>
          <td class="r debit">${r.debit > 0 ? fmt(r.debit) : "—"}</td>
          <td class="r credit">${r.credit > 0 ? fmt(r.credit) : "—"}</td>
          <td class="r ${r.balance > 0 ? "bal-owe" : "bal-ok"}">${fmt(r.balance)}</td>
        </tr>`).join("")}
        <tr class="total-row">
          <td colspan="4">Period Totals</td>
          <td class="r debit">${fmt(totalDebit)}</td>
          <td class="r credit">${fmt(totalCredit)}</td>
          <td class="r ${closingBalance > 0 ? "bal-owe" : "bal-ok"}">${fmt(closingBalance)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Bottom: Amount Due + Bank details -->
  <div class="bottom-grid">
    <div class="bottom-left">
      ${settings.bankName ? `
      <div class="bank-box">
        <h4>Banking Details</h4>
        ${settings.bankAccountName ? `<div class="bank-row"><div class="bank-row-label">Account Name</div><div class="bank-row-value">${settings.bankAccountName}</div></div>` : ""}
        ${settings.bankName ? `<div class="bank-row"><div class="bank-row-label">Bank</div><div class="bank-row-value">${settings.bankName}</div></div>` : ""}
        ${settings.bankAccountNumber ? `<div class="bank-row"><div class="bank-row-label">Account Number</div><div class="bank-row-value">${settings.bankAccountNumber}</div></div>` : ""}
        ${settings.bankBranchCode ? `<div class="bank-row"><div class="bank-row-label">Branch Code</div><div class="bank-row-value">${settings.bankBranchCode}</div></div>` : ""}
        ${settings.bankAccountType ? `<div class="bank-row"><div class="bank-row-label">Account Type</div><div class="bank-row-value">${settings.bankAccountType}</div></div>` : ""}
      </div>` : ""}
    </div>
    <div class="bottom-right">
      <div class="amount-due-box">
        <h4>Account Balance</h4>
        <div class="amount-due-row">
          <div class="amount-due-label">Total Invoiced</div>
          <div class="amount-due-value debit">${fmt(totalDebit)}</div>
        </div>
        <div class="amount-due-row">
          <div class="amount-due-label">Total Payments</div>
          <div class="amount-due-value credit">${fmt(totalCredit)}</div>
        </div>
        <div class="amount-due-total">
          <div class="l">Amount Due</div>
          <div class="v ${closingBalance > 0 ? "bal-owe" : "bal-ok"}">${fmt(closingBalance)}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="footer">
    This is a computer-generated statement and does not require a signature.
    &nbsp;&bull;&nbsp; ${settings.companyName || ""}
    ${settings.companyEmail ? "&nbsp;&bull;&nbsp; " + settings.companyEmail : ""}
    ${settings.companyPhone ? "&nbsp;&bull;&nbsp; " + settings.companyPhone : ""}
  </div>

</div>
</body>
</html>`;
  }

  // ── Invoice Summary (charges only, no payments) ────────────────────────────
  function buildInvoiceSummaryHTML(settings: any, color: string, dateFrom: string, dateTo: string, custName: string, invoices: Invoice[]): string {
    const lightColor = color + "18";
    const totalAmount = invoices.reduce((s, i) => s + i.total, 0);
    const totalTax = invoices.reduce((s, i) => s + (i.tax || 0), 0);
    
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Arial', sans-serif; font-size: 11px; color: #1a1a1a; background: #fff; }
  .page { width: 648px; margin: 0 auto; padding: 24px 28px 32px; }
  .header { display: table; width: 100%; margin-bottom: 28px; }
  .header-left { display: table-cell; vertical-align: top; width: 50%; }
  .header-right { display: table-cell; vertical-align: top; text-align: right; }
  .logo-img { max-height: 56px; max-width: 180px; }
  .company-name-text { font-size: 22px; font-weight: bold; color: ${color}; letter-spacing: -0.5px; }
  .company-details { font-size: 10px; line-height: 1.8; color: #555; margin-top: 4px; }
  .title-bar { background: ${color}; color: #fff; padding: 12px 16px; border-radius: 5px; display: table; width: 100%; margin-bottom: 24px; }
  .title-bar-left { display: table-cell; vertical-align: middle; }
  .title-bar-left h1 { font-size: 18px; font-weight: bold; letter-spacing: 3px; }
  .title-bar-right { display: table-cell; vertical-align: middle; text-align: right; font-size: 10px; line-height: 1.9; opacity: 0.95; }
  .info-grid { display: table; width: 100%; margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 5px; overflow: hidden; }
  .info-cell { display: table-cell; width: 50%; padding: 12px 14px; vertical-align: top; border-right: 1px solid #e5e7eb; }
  .info-cell:last-child { border-right: none; }
  .info-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: #888; margin-bottom: 5px; font-weight: bold; }
  .info-value { font-size: 11px; color: #1a1a1a; line-height: 1.65; }
  .info-value strong { font-size: 12px; display: block; margin-bottom: 2px; }
  .table-wrap { border: 1px solid #e5e7eb; border-radius: 5px; overflow: hidden; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  thead tr { background: ${color}; }
  thead th { color: #fff; font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.7px; padding: 9px 10px; text-align: left; }
  thead th.r { text-align: right; }
  tbody tr { border-bottom: 1px solid #f0f0f0; page-break-inside: avoid; }
  tbody tr:nth-child(even) { background: ${lightColor}; }
  tbody tr.total-row { background: #f1f5f9 !important; border-top: 2px solid #cbd5e1; page-break-inside: avoid; }
  tbody tr.total-row td { font-weight: bold; font-size: 11px; padding: 10px 10px; }
  td { padding: 8px 10px; font-size: 10.5px; vertical-align: middle; }
  td.r { text-align: right; white-space: nowrap; }
  .footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 9px; color: #aaa; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-left">
      ${settings.logoUrl ? `<img src="${settings.logoUrl}" alt="logo" class="logo-img"/>` : `<div class="company-name-text">${settings.companyName || "Company"}</div>`}
    </div>
    <div class="header-right">
      <div class="company-details">
        <strong style="font-size:12px;color:#1a1a1a;">${settings.companyName || ""}</strong><br/>
        ${settings.companyAddress ? settings.companyAddress + "<br/>" : ""}
        ${settings.companyPhone ? "Tel: " + settings.companyPhone + "<br/>" : ""}
        ${settings.companyEmail ? settings.companyEmail + "<br/>" : ""}
      </div>
    </div>
  </div>

  <div class="title-bar">
    <div class="title-bar-left"><h1>INVOICE SUMMARY</h1></div>
    <div class="title-bar-right">
      Period: ${fmtDate(dateFrom)} &ndash; ${fmtDate(dateTo)}<br/>
      Printed: ${fmtDate(new Date().toISOString())}
    </div>
  </div>

  <div class="info-grid">
    <div class="info-cell">
      <div class="info-label">Summary For</div>
      <div class="info-value"><strong>${custName}</strong></div>
    </div>
    <div class="info-cell">
      <div class="info-label">Period Details</div>
      <div class="info-value">
        Total Invoices: <strong>${invoices.length}</strong><br/>
        Total Amount: <strong style="color:#dc2626">${fmt(totalAmount)}</strong>
      </div>
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="width:20%">Invoice Date</th>
          <th style="width:20%">Invoice #</th>
          <th style="width:40%">Description</th>
          <th class="r" style="width:20%">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${invoices.map(inv => `
        <tr>
          <td>${fmtDate(inv.invoiceDate)}</td>
          <td style="font-family:monospace;font-size:9px">${inv.invoiceNumber}</td>
          <td>${inv.items.map(i => i.productName).filter(Boolean).join(", ") || "Services"}</td>
          <td class="r" style="color:#dc2626;font-weight:600">${fmt(inv.total)}</td>
        </tr>`).join("")}
        <tr class="total-row">
          <td colspan="3">Total</td>
          <td class="r" style="color:#dc2626">${fmt(totalAmount)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    This is a computer-generated statement. &nbsp;&bull;&nbsp; ${settings.companyName || ""} &nbsp;&bull;&nbsp; ${settings.companyEmail || ""}
  </div>
</div>
</body>
</html>`;
  }

  // ── Outstanding Statement (unpaid invoices only) ───────────────────────────
  function buildOutstandingHTML(settings: any, color: string, custName: string, invoices: Invoice[]): string {
    const lightColor = color + "18";
    const totalBalance = invoices.reduce((s, i) => s + i.balanceDue, 0);
    const today = new Date();
    
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Arial', sans-serif; font-size: 11px; color: #1a1a1a; background: #fff; }
  .page { width: 648px; margin: 0 auto; padding: 24px 28px 32px; }
  .header { display: table; width: 100%; margin-bottom: 28px; }
  .header-left { display: table-cell; vertical-align: top; width: 50%; }
  .header-right { display: table-cell; vertical-align: top; text-align: right; }
  .logo-img { max-height: 56px; max-width: 180px; }
  .company-name-text { font-size: 22px; font-weight: bold; color: ${color}; letter-spacing: -0.5px; }
  .company-details { font-size: 10px; line-height: 1.8; color: #555; margin-top: 4px; }
  .title-bar { background: ${color}; color: #fff; padding: 12px 16px; border-radius: 5px; display: table; width: 100%; margin-bottom: 24px; }
  .title-bar-left { display: table-cell; vertical-align: middle; }
  .title-bar-left h1 { font-size: 18px; font-weight: bold; letter-spacing: 3px; }
  .info-grid { display: table; width: 100%; margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 5px; overflow: hidden; }
  .info-cell { display: table-cell; width: 50%; padding: 12px 14px; vertical-align: top; border-right: 1px solid #e5e7eb; }
  .info-cell:last-child { border-right: none; }
  .info-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: #888; margin-bottom: 5px; font-weight: bold; }
  .info-value { font-size: 11px; color: #1a1a1a; line-height: 1.65; }
  .table-wrap { border: 1px solid #e5e7eb; border-radius: 5px; overflow: hidden; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  thead tr { background: ${color}; }
  thead th { color: #fff; font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.7px; padding: 9px 10px; text-align: left; }
  thead th.r { text-align: right; }
  tbody tr { border-bottom: 1px solid #f0f0f0; page-break-inside: avoid; }
  tbody tr:nth-child(even) { background: ${lightColor}; }
  tbody tr.overdue { background: #fee2e2; }
  tbody tr.total-row { background: #f1f5f9 !important; border-top: 2px solid #cbd5e1; page-break-inside: avoid; }
  tbody tr.total-row td { font-weight: bold; font-size: 11px; padding: 10px 10px; }
  td { padding: 8px 10px; font-size: 10.5px; vertical-align: middle; }
  td.r { text-align: right; white-space: nowrap; }
  .overdue-badge { display: inline-block; background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; border-radius: 3px; padding: 2px 6px; font-size: 9px; font-weight: bold; }
  .footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 9px; color: #aaa; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-left">
      ${settings.logoUrl ? `<img src="${settings.logoUrl}" alt="logo" class="logo-img"/>` : `<div class="company-name-text">${settings.companyName || "Company"}</div>`}
    </div>
    <div class="header-right">
      <div class="company-details">
        <strong style="font-size:12px;color:#1a1a1a;">${settings.companyName || ""}</strong><br/>
        ${settings.companyEmail ? settings.companyEmail + "<br/>" : ""}
      </div>
    </div>
  </div>

  <div class="title-bar">
    <div class="title-bar-left"><h1>OUTSTANDING STATEMENT</h1></div>
  </div>

  <div class="info-grid">
    <div class="info-cell">
      <div class="info-label">For</div>
      <div class="info-value"><strong>${custName}</strong></div>
    </div>
    <div class="info-cell">
      <div class="info-label">Total Outstanding</div>
      <div class="info-value"><strong style="color:#dc2626;font-size:14px">${fmt(totalBalance)}</strong></div>
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="width:14%">Invoice Date</th>
          <th style="width:14%">Due Date</th>
          <th style="width:16%">Invoice #</th>
          <th class="r" style="width:16%">Amount</th>
          <th class="r" style="width:16%">Balance</th>
          <th style="width:24%">Status</th>
        </tr>
      </thead>
      <tbody>
        ${invoices.map(inv => {
          const isOverdue = new Date(inv.dueDate) < today && inv.balanceDue > 0;
          return `
        <tr${isOverdue ? ' class="overdue"' : ''}>
          <td>${fmtDate(inv.invoiceDate)}</td>
          <td>${fmtDate(inv.dueDate)}</td>
          <td style="font-family:monospace;font-size:9px">${inv.invoiceNumber}</td>
          <td class="r" style="color:#dc2626;font-weight:600">${fmt(inv.total)}</td>
          <td class="r" style="color:#dc2626;font-weight:600">${fmt(inv.balanceDue)}</td>
          <td>${isOverdue ? '<span class="overdue-badge">OVERDUE</span>' : '<span style="color:#16a34a;font-weight:bold">PENDING</span>'}</td>
        </tr>`;
        }).join("")}
        <tr class="total-row">
          <td colspan="4">Total Outstanding</td>
          <td class="r" style="color:#dc2626">${fmt(totalBalance)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    Please remit payment to the amount due above. &nbsp;&bull;&nbsp; ${settings.companyName || ""}
  </div>
</div>
</body>
</html>`;
  }

  // ── Ageing Summary (invoices by age) ──────────────────────────────────────
  function buildAgeingHTML(settings: any, color: string, custName: string, invoices: Invoice[]): string {
    const lightColor = color + "18";
    const today = new Date();
    const currentAge = invoices.filter(i => i.balanceDue > 0 && new Date(i.dueDate) >= today).reduce((s, i) => s + i.balanceDue, 0);
    const age30 = invoices.filter(i => i.balanceDue > 0 && new Date(i.dueDate) < today && new Date(i.dueDate) >= new Date(today.getTime() - 30*24*60*60*1000)).reduce((s, i) => s + i.balanceDue, 0);
    const age60 = invoices.filter(i => i.balanceDue > 0 && new Date(i.dueDate) < new Date(today.getTime() - 30*24*60*60*1000) && new Date(i.dueDate) >= new Date(today.getTime() - 60*24*60*60*1000)).reduce((s, i) => s + i.balanceDue, 0);
    const age90 = invoices.filter(i => i.balanceDue > 0 && new Date(i.dueDate) < new Date(today.getTime() - 60*24*60*60*1000)).reduce((s, i) => s + i.balanceDue, 0);
    const total = currentAge + age30 + age60 + age90;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Arial', sans-serif; font-size: 11px; color: #1a1a1a; background: #fff; }
  .page { width: 648px; margin: 0 auto; padding: 24px 28px 32px; }
  .header { display: table; width: 100%; margin-bottom: 28px; }
  .header-left { display: table-cell; vertical-align: top; width: 50%; }
  .header-right { display: table-cell; vertical-align: top; text-align: right; }
  .logo-img { max-height: 56px; max-width: 180px; }
  .company-name-text { font-size: 22px; font-weight: bold; color: ${color}; letter-spacing: -0.5px; }
  .company-details { font-size: 10px; line-height: 1.8; color: #555; margin-top: 4px; }
  .title-bar { background: ${color}; color: #fff; padding: 12px 16px; border-radius: 5px; display: table; width: 100%; margin-bottom: 24px; }
  .title-bar h1 { font-size: 18px; font-weight: bold; letter-spacing: 3px; }
  .info-grid { display: table; width: 100%; margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 5px; overflow: hidden; }
  .info-cell { display: table-cell; width: 50%; padding: 12px 14px; vertical-align: top; border-right: 1px solid #e5e7eb; }
  .info-cell:last-child { border-right: none; }
  .info-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: #888; margin-bottom: 5px; font-weight: bold; }
  .info-value { font-size: 11px; color: #1a1a1a; line-height: 1.65; }
  .ageing-grid { display: table; width: 100%; margin-bottom: 24px; }
  .ageing-cell { display: table-cell; width: 25%; border: 1px solid #e5e7eb; padding: 14px 12px; text-align: center; }
  .ageing-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: #888; font-weight: bold; margin-bottom: 6px; }
  .ageing-amount { font-size: 18px; font-weight: bold; color: ${color}; }
  .ageing-pct { font-size: 9px; color: #666; margin-top: 4px; }
  .table-wrap { border: 1px solid #e5e7eb; border-radius: 5px; overflow: hidden; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; }
  thead tr { background: ${color}; }
  thead th { color: #fff; font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.7px; padding: 9px 10px; text-align: left; }
  thead th.r { text-align: right; }
  tbody tr { border-bottom: 1px solid #f0f0f0; page-break-inside: avoid; }
  tbody tr:nth-child(even) { background: ${lightColor}; }
  tbody tr.total-row { background: #f1f5f9 !important; border-top: 2px solid #cbd5e1; page-break-inside: avoid; }
  tbody tr.total-row td { font-weight: bold; font-size: 11px; padding: 10px 10px; }
  td { padding: 8px 10px; font-size: 10.5px; vertical-align: middle; }
  td.r { text-align: right; white-space: nowrap; }
  .footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 9px; color: #aaa; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-left">
      ${settings.logoUrl ? `<img src="${settings.logoUrl}" alt="logo" class="logo-img"/>` : `<div class="company-name-text">${settings.companyName || "Company"}</div>`}
    </div>
    <div class="header-right">
      <div class="company-details">
        <strong style="font-size:12px;color:#1a1a1a;">${settings.companyName || ""}</strong><br/>
        ${settings.companyEmail ? settings.companyEmail + "<br/>" : ""}
      </div>
    </div>
  </div>

  <div class="title-bar">
    <h1>AGED RECEIVABLES SUMMARY</h1>
  </div>

  <div class="info-grid">
    <div class="info-cell">
      <div class="info-label">For</div>
      <div class="info-value"><strong>${custName}</strong></div>
    </div>
    <div class="info-cell">
      <div class="info-label">As of</div>
      <div class="info-value"><strong>${fmtDate(new Date().toISOString())}</strong></div>
    </div>
  </div>

  <div class="ageing-grid">
    <div class="ageing-cell">
      <div class="ageing-label">Current</div>
      <div class="ageing-amount">${fmt(currentAge)}</div>
      <div class="ageing-pct">${total > 0 ? ((currentAge/total)*100).toFixed(0) : 0}%</div>
    </div>
    <div class="ageing-cell" style="border-left:none">
      <div class="ageing-label">30 - 60 Days</div>
      <div class="ageing-amount">${fmt(age30)}</div>
      <div class="ageing-pct">${total > 0 ? ((age30/total)*100).toFixed(0) : 0}%</div>
    </div>
    <div class="ageing-cell" style="border-left:none">
      <div class="ageing-label">60 - 90 Days</div>
      <div class="ageing-amount">${fmt(age60)}</div>
      <div class="ageing-pct">${total > 0 ? ((age60/total)*100).toFixed(0) : 0}%</div>
    </div>
    <div class="ageing-cell" style="border-left:none">
      <div class="ageing-label">90+ Days</div>
      <div class="ageing-amount">${fmt(age90)}</div>
      <div class="ageing-pct">${total > 0 ? ((age90/total)*100).toFixed(0) : 0}%</div>
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="width:14%">Invoice Date</th>
          <th style="width:14%">Due Date</th>
          <th style="width:16%">Invoice #</th>
          <th class="r" style="width:16%">Amount</th>
          <th class="r" style="width:16%">Balance</th>
          <th style="width:24%">Age (days)</th>
        </tr>
      </thead>
      <tbody>
        ${invoices.filter(i => i.balanceDue > 0).map(inv => {
          const daysOverdue = Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / (1000*60*60*24));
          return `
        <tr>
          <td>${fmtDate(inv.invoiceDate)}</td>
          <td>${fmtDate(inv.dueDate)}</td>
          <td style="font-family:monospace;font-size:9px">${inv.invoiceNumber}</td>
          <td class="r" style="color:#dc2626;font-weight:600">${fmt(inv.total)}</td>
          <td class="r" style="color:#dc2626;font-weight:600">${fmt(inv.balanceDue)}</td>
          <td>${Math.max(0, daysOverdue)} days</td>
        </tr>`;
        }).join("")}
        <tr class="total-row">
          <td colspan="4">Total</td>
          <td class="r" style="color:#dc2626">${fmt(total)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    ${settings.companyName || ""}
  </div>
</div>
</body>
</html>`;
  }

  // ── Email ───────────────────────────────────────────────────────────────────
  function openEmailDialog() {
    setEmailTo(selectedCustomer?.email || "");
    setEmailCc("");
    setEmailDialogOpen(true);
  }

  async function handleSendEmail() {
    if (!emailTo || !selectedCustomer || !workspaceId) return;
    setSendingEmail(true);
    try {
      // Check user's personal sending account first, fall back to workspace settings
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const userSmtp = currentUser ? await getEffectiveSmtp(workspaceId, currentUser.id) : null;

      const result = await buildStatementHTML();
      if (!result) { setSendingEmail(false); return; }
      const { html, closingBalance, settings } = result;

      // Generate PDF blob
      const html2pdf = (await import("html2pdf.js")).default;
      const parser = new DOMParser();
      const parsed = parser.parseFromString(html, "text/html");
      const styleEl = parsed.querySelector("style");
      const pageEl = parsed.querySelector(".page") as HTMLElement;
      const wrapper = document.createElement("div");
      wrapper.style.position = "absolute";
      wrapper.style.left = "-9999px";
      wrapper.style.background = "#fff";
      if (styleEl) wrapper.appendChild(styleEl);
      wrapper.appendChild(pageEl);
      document.body.appendChild(wrapper);
      const pdfBlob: Blob = await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["avoid-all", "css"] },
        })
        .from(pageEl)
        .outputPdf("blob");
      document.body.removeChild(wrapper);

      // Convert PDF blob to base64 → send as attachment directly (no storage bucket needed)
      const pdfArrayBuffer = await pdfBlob.arrayBuffer();
      const pdfBytes = new Uint8Array(pdfArrayBuffer);
      let pdfBinary = "";
      for (let i = 0; i < pdfBytes.length; i += 8192) {
        pdfBinary += String.fromCharCode(...pdfBytes.subarray(i, i + 8192));
      }
      const pdfBase64 = btoa(pdfBinary);

      let fromName: string;
      let fromEmail: string;
      let smtpConfig: { host: string; port: number; secure: boolean; user: string; pass: string; fromName: string; fromEmail: string };
      if (userSmtp) {
        fromName = userSmtp.fromName;
        fromEmail = userSmtp.fromEmail;
        smtpConfig = { ...userSmtp, fromName, fromEmail };
      } else {
        const { data: emailRow } = await supabase.from('workspace_settings').select('data').eq('workspace_id', workspaceId).eq('category', 'email').single();
        if (!emailRow?.data) throw new Error("Email not configured. Set up email in Settings → Email Settings.");
        const es = emailRow.data as any;
        if (!es.enabled) throw new Error("Email disabled. Enable it in Settings → Email Settings.");
        fromName = es.fromName || settings.companyName || "Company";
        fromEmail = es.fromEmail || es.smtpUser || "";
        const host = es.provider === "gmail" ? "smtp.gmail.com" : (es.smtpHost ?? "");
        const port = es.provider === "gmail" ? 587 : (es.smtpPort ?? 465);
        const secure = es.provider === "gmail" ? false : (es.smtpSecure ?? (port === 465));
        smtpConfig = { host, port, secure, user: es.smtpUser, pass: es.smtpPassword, fromName, fromEmail };
      }

      const typeLabel = { account: "Account Statement", summary: "Invoice Summary", outstanding: "Outstanding Statement", ageing: "Ageing Summary" }[statementType];
      const customerSlug = (selectedCustomer.companyName || selectedCustomer.contactPerson).replace(/\s+/g, "-");

      const resp = await fetch(SMTP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smtpConfig,
          email: {
            from: `${fromName} <${fromEmail}>`,
            to: emailTo,
            ...(emailCc ? { cc: emailCc } : {}),
            subject: `${typeLabel} – ${customerSlug} (${fmtDate(dateFrom)} to ${fmtDate(dateTo)})`,
            text: `Please find your ${typeLabel?.toLowerCase()} attached.\nPeriod: ${fmtDate(dateFrom)} to ${fmtDate(dateTo)}\nBalance Due: ${fmt(closingBalance)}`,
            html: `<p>Dear ${selectedCustomer.companyName || selectedCustomer.contactPerson},</p><p>Please find your ${typeLabel?.toLowerCase()} for the period <strong>${fmtDate(dateFrom)}</strong> to <strong>${fmtDate(dateTo)}</strong> attached.</p><p><strong>Balance Due: ${fmt(closingBalance)}</strong></p>`,
            attachments: [{ filename: `${typeLabel?.replace(/\s+/g, "")}-${customerSlug}.pdf`, content: pdfBase64, contentType: "application/pdf" }],
          },
        }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.success) throw new Error(json.error || `HTTP ${resp.status}`);
      toast({ title: "Statement sent!", description: `Emailed to ${emailTo}` });
      setEmailDialogOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    } finally {
      setSendingEmail(false);
    }
  }

  // ── Invoice editor overlay ─────────────────────────────────────────────────
  if (editingInvoice) {
    return (
      <InvoiceCreationPage
        editingInvoice={editingInvoice}
        onClose={() => setEditingInvoice(null)}
        onSaved={() => {
          if (workspaceId) getInvoices(workspaceId).then(setInvoices);
          setEditingInvoice(null);
        }}
        type="invoice"
      />
    );
  }

  return (
    <div className="absolute inset-0 bg-background z-30 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b bg-background shrink-0">
        <Button variant="ghost" size="icon" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Customer Statements</h1>
          <p className="text-sm text-muted-foreground">Account statement per customer</p>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: customer list */}
        <div className="w-80 border-r flex flex-col shrink-0">
          <div className="p-4 border-b space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search customers…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-muted-foreground text-sm">Loading…</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">No customers with invoices</div>
            ) : (
              filteredCustomers.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCustomerId(c.id)}
                  className={`w-full text-left px-4 py-3 border-b hover:bg-muted/50 transition-colors ${selectedCustomerId === c.id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                >
                  <div className="font-medium text-sm truncate">{c.companyName || c.contactPerson}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-muted-foreground">{c.email || c.phone || "—"}</span>
                    <span className={`text-xs font-semibold ${c.outstanding > 0 ? "text-red-600" : "text-green-600"}`}>
                      {fmt(c.outstanding)}
                    </span>
                  </div>
                  {c.overdue > 0 && (
                    <div className="mt-0.5">
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                        Overdue {fmt(c.overdue)}
                      </Badge>
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: statement view */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedCustomerId === "all" ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-lg font-medium">Select a customer</p>
                <p className="text-sm">Choose a customer from the list to view their account statement</p>
              </div>
            </div>
          ) : (
            <>
              {/* Statement toolbar */}
              <div className="flex items-center justify-between gap-4 px-6 py-4 border-b bg-background shrink-0 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <Label className="text-sm whitespace-nowrap">From</Label>
                    <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm whitespace-nowrap">To</Label>
                    <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm whitespace-nowrap">Statement</Label>
                    <Select value={statementType} onValueChange={v => setStatementType(v as any)}>
                      <SelectTrigger className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="account">Account Statement</SelectItem>
                        <SelectItem value="summary">Invoice Summary</SelectItem>
                        <SelectItem value="outstanding">Outstanding Only</SelectItem>
                        <SelectItem value="ageing">Ageing Summary</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => openPaymentDialog()} disabled={outstandingInvoices.length === 0}>
                    <CreditCard className="h-4 w-4 mr-2" />
                    Receive Payment
                  </Button>
                  <Button variant="outline" onClick={openEmailDialog} disabled={selectedRows.length === 0}>
                    <Mail className="h-4 w-4 mr-2" />
                    Email Statement
                  </Button>
                  <Button onClick={handlePrint} disabled={printing || selectedRows.length === 0}>
                    <Download className="h-4 w-4 mr-2" />
                    {printing ? "Generating…" : "Download PDF"}
                  </Button>
                </div>
              </div>

              {/* Summary cards */}
              {(() => {
                const summary = customerSummaries.find(c => c.id === selectedCustomerId);
                if (!summary) return null;
                return (
                  <div className="grid grid-cols-3 gap-4 px-6 py-4 border-b bg-muted/20 shrink-0">
                    <div className="bg-background rounded-lg border p-4">
                      <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Invoiced</div>
                      <div className="text-xl font-bold">{fmt(summary.totalInvoiced)}</div>
                    </div>
                    <div className="bg-background rounded-lg border p-4">
                      <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Paid</div>
                      <div className="text-xl font-bold text-green-600">{fmt(summary.totalPaid)}</div>
                    </div>
                    <div className="bg-background rounded-lg border p-4">
                      <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Balance Due</div>
                      <div className={`text-xl font-bold ${summary.outstanding > 0 ? "text-red-600" : "text-green-600"}`}>
                        {fmt(summary.outstanding)}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Statement table */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {selectedRows.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p>No transactions in this date range</p>
                  </div>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-semibold text-muted-foreground">Date</th>
                          <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-semibold text-muted-foreground">Invoice #</th>
                          <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-semibold text-muted-foreground">Reference</th>
                          <th className="text-left px-4 py-3 text-xs uppercase tracking-wide font-semibold text-muted-foreground">Description</th>
                          <th className="text-right px-4 py-3 text-xs uppercase tracking-wide font-semibold text-muted-foreground">Charges</th>
                          <th className="text-right px-4 py-3 text-xs uppercase tracking-wide font-semibold text-muted-foreground">Payments</th>
                          <th className="text-right px-4 py-3 text-xs uppercase tracking-wide font-semibold text-muted-foreground">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRows.map((row, i) => (
                          <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(row.date)}</td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {row.type === "invoice" ? (
                                <button
                                  className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
                                  onClick={() => {
                                    const inv = invoices.find(i => i.invoiceNumber === row.reference);
                                    if (inv) setViewingInvoice(inv);
                                  }}
                                >
                                  {row.reference}
                                </button>
                              ) : (
                                row.reference
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs font-medium">{row.jobRef || <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-4 py-3">{row.description}</td>
                            <td className="px-4 py-3 text-right text-red-600">
                              {row.debit > 0 ? fmt(row.debit) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right text-green-600">
                              {row.credit > 0 ? fmt(row.credit) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className={`px-4 py-3 text-right font-semibold ${row.balance > 0 ? "text-red-600" : "text-green-600"}`}>
                              {fmt(row.balance)}
                            </td>
                          </tr>
                        ))}
                        {/* Totals row */}
                        <tr className="border-t-2 bg-muted/40 font-semibold">
                          <td colSpan={4} className="px-4 py-3">Period Total</td>
                          <td className="px-4 py-3 text-right text-red-600">
                            {fmt(selectedRows.reduce((s, r) => s + r.debit, 0))}
                          </td>
                          <td className="px-4 py-3 text-right text-green-600">
                            {fmt(selectedRows.reduce((s, r) => s + r.credit, 0))}
                          </td>
                          <td className={`px-4 py-3 text-right ${selectedRows[selectedRows.length - 1]?.balance > 0 ? "text-red-600" : "text-green-600"}`}>
                            {fmt(selectedRows[selectedRows.length - 1]?.balance || 0)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Receive Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={v => { if (!processingPayment) setPaymentDialogOpen(v); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Receive Payment
            </DialogTitle>
            <DialogDescription>
              {selectedCustomer?.companyName || selectedCustomer?.contactPerson}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Step 1 — Amount received */}
            <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-2">
              <Label className="text-sm font-semibold">Amount Received</Label>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold text-muted-foreground">R</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  className="text-xl font-bold h-12"
                  autoFocus
                  value={receivedAmount}
                  onChange={e => handleReceivedAmountChange(e.target.value)}
                />
              </div>
              {(() => {
                const received = parseFloat(receivedAmount) || 0;
                const totalOutstanding = outstandingInvoices.reduce((s, i) => s + i.balanceDue, 0);
                const unallocated = Math.round((received - paymentTotal) * 100) / 100;
                if (received <= 0) return (
                  <p className="text-xs text-muted-foreground">Enter the amount received — it will be allocated across invoices automatically</p>
                );
                return (
                  <div className="flex gap-4 text-xs mt-1">
                    <span className="text-muted-foreground">Total outstanding: <strong>{fmt(totalOutstanding)}</strong></span>
                    <span className="text-muted-foreground">Allocated: <strong className="text-green-600">{fmt(paymentTotal)}</strong></span>
                    {unallocated > 0.005 && <span className="text-amber-600 font-semibold">Unallocated: {fmt(unallocated)}</span>}
                    {unallocated < -0.005 && <span className="text-red-600 font-semibold">Over by: {fmt(Math.abs(unallocated))}</span>}
                  </div>
                );
              })()}
            </div>

            {/* Step 2 — Allocation breakdown (only shown when amount > 0) */}
            {(parseFloat(receivedAmount) || 0) > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">Allocation Breakdown</Label>
                  <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => handleReceivedAmountChange(receivedAmount)}>
                    Auto-allocate
                  </Button>
                </div>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Invoice</th>
                        <th className="text-left px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Date</th>
                        <th className="text-right px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Balance Due</th>
                        <th className="text-right px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Allocating</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outstandingInvoices.map(inv => {
                        const alloc = parseFloat(paymentAllocations[inv.id] || "0") || 0;
                        return (
                          <tr key={inv.id} className={`border-t ${alloc > 0 ? "" : "opacity-50"}`}>
                            <td className="px-3 py-2 font-mono text-xs font-semibold text-primary">{inv.invoiceNumber}</td>
                            <td className="px-3 py-2 text-muted-foreground text-xs">{fmtDate(inv.invoiceDate)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-red-600">{fmt(inv.balanceDue)}</td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                max={inv.balanceDue}
                                className="w-28 ml-auto text-right h-8"
                                placeholder="0.00"
                                value={paymentAllocations[inv.id] ?? ""}
                                onChange={e => setPaymentAllocations(prev => ({ ...prev, [inv.id]: e.target.value }))}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 bg-muted/30">
                        <td colSpan={3} className="px-3 py-2 font-semibold">Total Allocating</td>
                        <td className={`px-3 py-2 text-right font-bold text-base ${
                          paymentTotal > 0 ? "text-green-600" : "text-muted-foreground"
                        }`}>{fmt(paymentTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* Payment details */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="bank-transfer">Bank Transfer</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Reference Number</Label>
                <Input
                  placeholder="Transaction / cheque no."
                  value={paymentReference}
                  onChange={e => setPaymentReference(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                placeholder="Payment notes…"
                rows={2}
                value={paymentNotes}
                onChange={e => setPaymentNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)} disabled={processingPayment}>Cancel</Button>
            <Button onClick={handleReceivePayment} disabled={processingPayment || paymentTotal <= 0}>
              <CreditCard className="h-4 w-4 mr-2" />
              {processingPayment ? "Processing…" : `Record R${paymentTotal.toFixed(2)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Statement Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Email Statement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>To</Label>
              <Input
                type="email"
                placeholder="customer@example.com"
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>CC (optional)</Label>
              <Input
                type="email"
                placeholder="cc@example.com"
                value={emailCc}
                onChange={e => setEmailCc(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Statement for <strong>{selectedCustomer?.companyName || selectedCustomer?.contactPerson}</strong> –{" "}
              {fmtDate(dateFrom)} to {fmtDate(dateTo)} will be attached as a PDF.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)} disabled={sendingEmail}>Cancel</Button>
            <Button onClick={handleSendEmail} disabled={sendingEmail || !emailTo}>
              <Mail className="h-4 w-4 mr-2" />
              {sendingEmail ? "Sending…" : "Send Statement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice view dialog */}
      <Dialog open={!!viewingInvoice} onOpenChange={() => setViewingInvoice(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span>{viewingInvoice?.invoiceNumber}</span>
              {viewingInvoice && (
                <Badge variant={viewingInvoice.paymentStatus === "paid" ? "default" : viewingInvoice.paymentStatus === "partial" ? "secondary" : "destructive"}>
                  {viewingInvoice.paymentStatus.charAt(0).toUpperCase() + viewingInvoice.paymentStatus.slice(1)}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {viewingInvoice && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6 p-4 bg-muted/30 rounded-lg">
                <div>
                  <h3 className="font-semibold mb-2">Bill To</h3>
                  <p className="font-medium">{viewingInvoice.customerName}</p>
                  {viewingInvoice.customerEmail && <p className="text-sm text-muted-foreground">{viewingInvoice.customerEmail}</p>}
                  {viewingInvoice.customerPhone && <p className="text-sm text-muted-foreground">{viewingInvoice.customerPhone}</p>}
                </div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Invoice Date:</span><span>{fmtDate(viewingInvoice.invoiceDate)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Due Date:</span><span>{fmtDate(viewingInvoice.dueDate)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Terms:</span><span>{String(viewingInvoice.terms).replace(/-/g, " ")}</span></div>
                  {viewingInvoice.purchaseOrder && <div className="flex justify-between"><span className="text-muted-foreground">Reference:</span><span className="font-medium">{viewingInvoice.purchaseOrder}</span></div>}
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-3">Items</h3>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product / Service</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewingInvoice.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="font-medium">{item.productName}</div>
                            {item.description && <div className="text-xs text-muted-foreground">{item.description}</div>}
                          </TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">R{item.price.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium">R{item.total.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="border rounded-lg p-4 bg-muted/30">
                <div className="space-y-2 max-w-xs ml-auto text-sm">
                  <div className="flex justify-between"><span>Subtotal:</span><span>R{viewingInvoice.subtotal.toFixed(2)}</span></div>
                  {(viewingInvoice.discountAmount || 0) > 0 && (
                    <div className="flex justify-between"><span>Discount ({viewingInvoice.discountPercent}%):</span><span>-R{(viewingInvoice.discountAmount || 0).toFixed(2)}</span></div>
                  )}
                  <div className="flex justify-between"><span>Tax ({viewingInvoice.taxRate || 15}%):</span><span>R{viewingInvoice.tax.toFixed(2)}</span></div>
                  <div className="flex justify-between text-base font-bold border-t pt-2"><span>Total:</span><span>R{viewingInvoice.total.toFixed(2)}</span></div>
                  <div className="flex justify-between text-green-600 border-t pt-2"><span>Amount Paid:</span><span>R{viewingInvoice.amountPaid.toFixed(2)}</span></div>
                  <div className="flex justify-between font-bold text-amber-600"><span>Balance Due:</span><span>R{viewingInvoice.balanceDue.toFixed(2)}</span></div>
                </div>
              </div>

              {viewingInvoice.notes && (
                <div>
                  <h3 className="font-semibold mb-1">Notes</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{viewingInvoice.notes}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setViewingInvoice(null)}>Close</Button>
            <Button variant="outline" onClick={() => viewingInvoice && previewInvoice(viewingInvoice, workspaceId || undefined)}>
              <Eye className="h-4 w-4 mr-2" />Preview
            </Button>
            <Button variant="outline" onClick={() => viewingInvoice && printInvoice(viewingInvoice, workspaceId || undefined)}>
              <Printer className="h-4 w-4 mr-2" />Print
            </Button>
            <Button variant="outline" onClick={() => viewingInvoice && downloadInvoice(viewingInvoice, workspaceId || undefined)}>
              <Download className="h-4 w-4 mr-2" />Download
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!viewingInvoice) return;
                setSendingWhatsApp(true);
                try {
                  await sendInvoiceViaWhatsApp(viewingInvoice, workspaceId || undefined);
                  toast({ title: "PDF Downloaded", description: "Invoice PDF saved — attach it in WhatsApp" });
                } catch (e: any) {
                  toast({ title: "WhatsApp Failed", description: e.message || "Failed", variant: "destructive" });
                } finally {
                  setSendingWhatsApp(false);
                }
              }}
              disabled={sendingWhatsApp}
            >
              <MessageSquare className="h-4 w-4 mr-2" />{sendingWhatsApp ? "Sending..." : "WhatsApp"}
            </Button>
            {viewingInvoice && viewingInvoice.balanceDue > 0 && (
              <Button variant="outline" onClick={() => { openPaymentDialog(viewingInvoice); }}>
                <CreditCard className="h-4 w-4 mr-2" />Record Payment
              </Button>
            )}
            <Button onClick={() => { if (viewingInvoice) { setEditingInvoice(viewingInvoice); setViewingInvoice(null); } }}>
              <Pencil className="h-4 w-4 mr-2" />Edit Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
