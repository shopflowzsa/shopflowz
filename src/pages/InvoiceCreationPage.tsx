/**
 * Invoice Creation Page - AI Stock Style
 * Comprehensive invoice creation with all fields
 */

import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, Copy, Printer, Eye, RefreshCw, Settings, Save, Send, X } from "lucide-react";
import { printInvoice, previewInvoice, generateInvoiceHTML, generateInvoicePDFBlob } from "@/lib/pdfService";
import { loadSalesSettings } from "@/lib/salesSettingsService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { getCustomers } from "@/lib/customerService";
import { getInventoryItems } from "@/lib/inventoryEcommerceSync";
import { createInvoice, updateInvoice } from "@/lib/invoiceService";
import { Customer, Quotation, Invoice } from "@/types/invoice";
import { Task, CustomFieldDefinition } from "@/types/crm";
import { FieldMapping, resolveField, resolveTemplate } from "@/lib/fieldMapperService";

import { SUPABASE_URL,  supabase, supabaseServiceRole } from "@/lib/supabase";
import { getEffectiveSmtp, saveSentEmail } from "@/lib/emailAccountService";

interface LineItem {
  serviceDate: string;
  productService: string;
  sku: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  vat: number;
  productId?: string; // For stock tracking
  isManual?: boolean; // true when user chose to type manually
}

interface InvoiceCreationPageProps {
  onClose: () => void;
  onSaved?: () => void;
  type?: "invoice" | "quote";
  fromQuotation?: Quotation;
  fromTask?: Task;
  editingInvoice?: Invoice;
  fieldMapping?: FieldMapping;
  customFields?: CustomFieldDefinition[];
}

const SMTP_URL = `${SUPABASE_URL}/functions/v1/send-email`;

async function sendInvoiceEmail(
  workspaceId: string,
  invoice: Invoice,
  toEmail: string,
  cc?: string
): Promise<void> {
  // Check if the logged-in user has a personal sending account configured
  const { data: { user: currentUser } } = await supabase.auth.getUser();
  const userSmtp = currentUser ? await getEffectiveSmtp(workspaceId, currentUser.id) : null;

  let smtpConfig: { host: string; port: number; secure: boolean; user: string; pass: string; fromName: string; fromEmail: string };
  let fromName: string;
  let fromEmail: string;

  const salesSettings = await loadSalesSettings(workspaceId);

  if (userSmtp) {
    fromName = userSmtp.fromName;
    fromEmail = userSmtp.fromEmail;
    smtpConfig = { ...userSmtp, fromName, fromEmail };
  } else {
    // Fall back to workspace email settings
    const { data: emailRow } = await supabase.from('workspace_settings').select('data').eq('workspace_id', workspaceId).eq('category', 'email').single();
    if (!emailRow) throw new Error("Email is not configured. Please set up email in Settings → Email Settings.");
    const es = emailRow.data as any;
    if (!es.enabled) throw new Error("Email is disabled. Please enable it in Settings → Email Settings.");
    fromName = es.fromName || salesSettings.companyName || "ShopFlowz";
    fromEmail = es.fromEmail || es.smtpUser || "";
    const host = es.provider === "gmail" ? "smtp.gmail.com" : (es.smtpHost ?? "");
    const port = es.provider === "gmail" ? 587 : (es.smtpPort ?? 465);
    const secure = es.provider === "gmail" ? false : (es.smtpSecure ?? (port === 465));
    smtpConfig = { host, port, secure, user: es.smtpUser, pass: es.smtpPassword, fromName, fromEmail };
  }

  const invoiceHtml = generateInvoiceHTML(invoice, salesSettings);

  // Generate PDF blob → convert to base64 → send as attachment directly (no storage bucket needed)
  const pdfBlob = await generateInvoicePDFBlob(invoice, salesSettings);
  const pdfArrayBuffer = await pdfBlob.arrayBuffer();
              const pdfBytes = new Uint8Array(pdfArrayBuffer);
              let pdfBinary = "";
              for (let i = 0; i < pdfBytes.length; i += 8192) {
                pdfBinary += String.fromCharCode(...pdfBytes.subarray(i, i + 8192));
              }
              const pdfBase64 = btoa(pdfBinary);

  try {
    const smtpController = new AbortController();
    const smtpTimer = setTimeout(() => smtpController.abort(), 20000);
    let resp: Response;
    try {
      resp = await fetch(SMTP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smtpConfig,
          email: {
            from: `${fromName} <${fromEmail}>`,
            to: toEmail,
            ...(cc ? { cc } : {}),
            subject: `${invoice.invoiceNumber} from ${fromName}`,
            text: `Please find your invoice ${invoice.invoiceNumber} attached.\nTotal: R${invoice.total.toFixed(2)}\nDue: ${invoice.dueDate}`,
            html: invoiceHtml,
            attachments: [
            {
              filename: `${invoice.invoiceNumber}.pdf`,
              content: pdfBase64,
              contentType: "application/pdf",
            },
          ],
        },
      }),
      signal: smtpController.signal,
    });
    } catch (e: any) {
      if (e.name === "AbortError") throw new Error("SMTP timed out — check your mail server hostname in Email Settings");
      throw e;
    } finally {
      clearTimeout(smtpTimer);
    }
    const json = await resp!.json();
    if (!resp!.ok || !json.success) throw new Error(json.error || `HTTP ${resp!.status}`);
    // Always save to sent folder so it appears in the email outbox
    if (currentUser) {
      saveSentEmail(workspaceId, currentUser.id, {
        from: `${fromName} <${fromEmail}>`,
        to: toEmail,
        subject: `${invoice.invoiceNumber} from ${fromName}`,
        text: `Please find your invoice ${invoice.invoiceNumber} attached.\nTotal: R${invoice.total.toFixed(2)}\nDue: ${invoice.dueDate}`,
        date: new Date(),
      }).catch(() => {});
    }
  } catch (err) {
    throw err;
  }
}

export function InvoiceCreationPage({ onClose, onSaved, type = "invoice", fromQuotation, fromTask, editingInvoice, fieldMapping, customFields = [] }: InvoiceCreationPageProps) {
  const { workspaceId, user } = useAuth();
  const { toast } = useToast();

  // Generate invoice number
  const [invoiceNumber] = useState(
    editingInvoice
      ? editingInvoice.invoiceNumber
      : fromQuotation 
        ? `INV-from-${fromQuotation.quotationNumber}` 
        : fromTask 
          ? (fromTask.jobNumber || fromTask.id)
          : `INV-${Date.now()}${Math.floor(Math.random() * 1000)}`
  );

  // Walk-in / Cash Sale virtual customer
  const WALKIN_ID = "__walkin__";

  // Customer fields
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(editingInvoice?.customerId || WALKIN_ID);
  const [walkinName, setWalkinName] = useState(
    editingInvoice?.customerId === WALKIN_ID ? (editingInvoice.customerName || "Cash Sale") : "Cash Sale"
  );
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [ccBcc, setCcBcc] = useState("");
  const [sendLater, setSendLater] = useState(false);

  // Address fields
  const [billingAddress, setBillingAddress] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");

  // Date and terms fields
  const [terms, setTerms] = useState("Due on receipt");
  const [reference, setReference] = useState(editingInvoice?.purchaseOrder || "");
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [dueDate, setDueDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().split("T")[0];
  });
  const [shippingDate, setShippingDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  // Shipping fields
  const [shipVia, setShipVia] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");

  // Items
  const [items, setItems] = useState<LineItem[]>([
    {
      serviceDate: new Date().toISOString().split("T")[0],
      productService: "",
      sku: "",
      description: "",
      quantity: 1,
      rate: 0,
      amount: 0,
      vat: 0,
    },
  ]);
  const [amountType, setAmountType] = useState<"Exclusive of Tax" | "Inclusive of Tax">(
    "Exclusive of Tax"
  );
  const [vatEnabled, setVatEnabled] = useState(false);
  const [vatRate, setVatRate] = useState(15); // Default 15% VAT
  const [defaultVatEnabled, setDefaultVatEnabled] = useState(false);
  const [defaultVatRate, setDefaultVatRate] = useState(15);

  // Messages
  const [messageOnInvoice, setMessageOnInvoice] = useState("Thanks for your business.");
  const [messageOnStatement, setMessageOnStatement] = useState(
    "Thanks for your business."
  );

  // Attachments
  const [attachments, setAttachments] = useState<File[]>([]);

  // Summary fields
  const [discountPercent, setDiscountPercent] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [deposit, setDeposit] = useState(0);

  const [inventory, setInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [classValue, setClassValue] = useState("");

  useEffect(() => {
    if (!workspaceId) return;
    loadData();
  }, [workspaceId]);

  async function loadData() {
    if (!workspaceId) return;
    try {
      const [customersData, inventoryData, salesSettings] = await Promise.all([
        getCustomers(workspaceId),
        getInventoryItems(workspaceId),
        loadSalesSettings(workspaceId),
      ]);
      setCustomers(customersData);
      setInventory(inventoryData.filter((item: any) => item.status === "active"));
      const gvat = salesSettings.defaultVatEnabled === true;
      const grate = salesSettings.defaultVatRate || 15;
      setDefaultVatEnabled(gvat);
      setDefaultVatRate(grate);
      // Apply global defaults for brand-new invoices only
      if (!editingInvoice && !fromQuotation) {
        setVatEnabled(gvat);
        setVatRate(grate);
      }
    } catch (error) {
      console.error("Error loading data:", error);
    }
  }

  // Update customer fields when a real customer is selected
  useEffect(() => {
    if (selectedCustomerId === WALKIN_ID) return; // walk-in: keep all fields freely editable
    const customer = customers.find((c) => c.id === selectedCustomerId);
    if (customer) {
      setCustomerEmail(customer.email || "");
      setCustomerPhone(customer.phone || "");
      setBillingAddress(
        customer.billingAddress
          ? `${customer.billingAddress.street || ""}\n${
              customer.billingAddress.city || ""
            }, ${customer.billingAddress.province || ""} ${
              customer.billingAddress.postalCode || ""
            }`
          : ""
      );
      setShippingAddress(
        customer.shippingAddress
          ? `${customer.shippingAddress.street || ""}\n${
              customer.shippingAddress.city || ""
            }, ${customer.shippingAddress.province || ""} ${
              customer.shippingAddress.postalCode || ""
            }`
          : billingAddress
      );
      // Apply per-customer VAT setting (only when NOT editing an existing invoice)
      if (!editingInvoice) {
        if (customer.vatEnabled !== undefined) {
          setVatEnabled(customer.vatEnabled);
        } else {
          setVatEnabled(defaultVatEnabled);
        }
      }
    }
  }, [selectedCustomerId, customers]);

  // Pre-populate from quotation if provided
  useEffect(() => {
    if (fromQuotation && customers.length > 0) {
      setSelectedCustomerId(fromQuotation.customerId);
      setCustomerEmail(fromQuotation.customerEmail || "");
      setCustomerPhone((fromQuotation as any).customerPhone || "");
      
      // Set VAT settings
      setVatEnabled(fromQuotation.taxRate !== undefined && fromQuotation.taxRate > 0);
      setVatRate(fromQuotation.taxRate || 15);
      
      // Set discount
      setDiscountPercent(fromQuotation.discountPercent || 0);
      
      // Set terms and notes
      setTerms(fromQuotation.terms || "Due on receipt");
      setMessageOnInvoice(fromQuotation.notes || "Thanks for your business.");
      
      // Set line items
      const mappedItems: LineItem[] = fromQuotation.items.map(item => ({
        serviceDate: new Date().toISOString().split("T")[0],
        productService: item.productName,
        sku: item.sku || "",
        description: item.description || "",
        quantity: item.quantity,
        rate: item.price,
        amount: item.quantity * item.price,
        vat: item.taxRate ? (item.quantity * item.price * item.taxRate / 100) : 0,
        productId: item.productId, // Preserve productId for stock tracking
      }));
      setItems(mappedItems);
      
      toast({
        title: "Quotation Loaded",
        description: `Converting ${fromQuotation.quotationNumber} to invoice`,
      });
    }
  }, [fromQuotation, customers]);

  // Pre-populate from task if provided
  useEffect(() => {
    if (!fromTask) return;
    const cfv = fromTask.customFieldValues ?? [];
    const today = new Date().toISOString().split("T")[0];
    // Resolve customer fields via mapper, falling back to heuristics
    const resolvedName = resolveField(
      cfv,
      fieldMapping?.customerNameFieldId ?? "",
      cf => typeof cf.value === "string" && cf.value.length > 0 && !String(cf.value).match(/^\d/)
    );
    const resolvedPhone = resolveField(
      cfv,
      fieldMapping?.customerPhoneFieldId ?? "",
      cf => typeof cf.value === "string" && String(cf.value).match(/^\d{3}/) !== null
    );
    const resolvedEmail = resolveField(cfv, fieldMapping?.customerEmailFieldId ?? "");
    const resolvedJobRef = resolveField(cfv, fieldMapping?.jobReferenceFieldId ?? "");
    const jobRef = resolvedJobRef || fromTask.jobNumber || "";

    if (resolvedName) { setSelectedCustomerId("__walkin__"); setWalkinName(resolvedName); }
    if (resolvedPhone) setCustomerPhone(resolvedPhone);
    if (resolvedEmail) setCustomerEmail(resolvedEmail);

    // Resolve deposit amount if mapped
    const resolvedDeposit = resolveField(cfv, fieldMapping?.depositFieldId ?? "");
    if (resolvedDeposit) {
      const depositAmount = parseFloat(resolvedDeposit) || 0;
      if (depositAmount > 0) setDeposit(depositAmount);
    }

    // Build line items: prefer configured templates, then spare parts
    if (fieldMapping?.lineItemTemplates && fieldMapping.lineItemTemplates.length > 0) {
      const templateLines: LineItem[] = fieldMapping.lineItemTemplates.map(tpl => {
        const service = tpl.serviceTemplate
          ? resolveTemplate(tpl.serviceTemplate, cfv, customFields)
          : (fromTask.title || "Repair Service");
        const desc = tpl.descriptionTemplate
          ? resolveTemplate(tpl.descriptionTemplate, cfv, customFields)
          : "";
        const rate = tpl.rateFieldId
          ? parseFloat(resolveField(cfv, tpl.rateFieldId) || "0") || tpl.defaultRate
          : tpl.defaultRate;
        const qty = tpl.quantityFieldId
          ? parseFloat(resolveField(cfv, tpl.quantityFieldId) || "0") || tpl.defaultQuantity
          : tpl.defaultQuantity;
        return {
          serviceDate: today,
          productService: service,
          sku: "",
          description: desc,
          quantity: qty,
          rate: rate,
          amount: qty * rate,
          vat: vatEnabled ? (qty * rate * vatRate / 100) : 0,
          isManual: true,
        };
      });
      setItems(templateLines);
    } else if (fromTask.sparePartsUsed && fromTask.sparePartsUsed.length > 0) {
      // Map spare parts to line items
      const mappedItems: LineItem[] = fromTask.sparePartsUsed.map(part => ({
        serviceDate: today,
        productService: part.productName + (part.variantName ? ` - ${part.variantName}` : ''),
        sku: part.sku,
        description: `Used in repair: ${fromTask.title}`,
        quantity: part.quantity,
        rate: part.unitCost,
        amount: part.quantity * part.unitCost,
        vat: vatEnabled ? (part.quantity * part.unitCost * (vatRate / 100)) : 0,
      }));
      setItems(mappedItems);

      toast({
        title: "Task Spare Parts Loaded",
        description: `Loaded ${fromTask.sparePartsUsed.length} spare part(s) from task`,
      });
    }

    setMessageOnInvoice(`Invoice for repair job: ${fromTask.title}${jobRef ? ` (Job #${jobRef})` : ''}`);
  }, [fromTask, vatEnabled, vatRate]);

  // Pre-populate from editing invoice
  useEffect(() => {
    if (editingInvoice && customers.length > 0) {
      // Find and set customer
      setSelectedCustomerId(editingInvoice.customerId);
      if (editingInvoice.customerId === WALKIN_ID) {
        setWalkinName(editingInvoice.customerName || "Cash Sale");
      }
      setCustomerEmail(editingInvoice.customerEmail || "");
      setCustomerPhone(editingInvoice.customerPhone || "");
      
      // Set addresses
      setBillingAddress(editingInvoice.billingAddress || "");
      setShippingAddress(editingInvoice.shippingAddress || "");
      
      // Set dates and terms
      setInvoiceDate(editingInvoice.invoiceDate);
      setDueDate(editingInvoice.dueDate);
      setTerms((editingInvoice.terms as any) || "Due on receipt");
      setReference(editingInvoice.purchaseOrder || "");
      
      // Set VAT
      setVatEnabled(editingInvoice.taxRate !== undefined && editingInvoice.taxRate > 0);
      setVatRate(editingInvoice.taxRate || 15);
      
      // Set discount
      setDiscountPercent(editingInvoice.discountPercent || 0);

      // Set deposit / amount already paid
      setDeposit(editingInvoice.amountPaid || 0);

      // Set messages
      setMessageOnInvoice(editingInvoice.notes || "Thanks for your business.");
      
      // Set line items - convert from invoice items to LineItem format
      const mappedItems: LineItem[] = editingInvoice.items.map(item => ({
        serviceDate: new Date().toISOString().split("T")[0],
        productService: item.productName,
        sku: item.sku || "",
        description: item.description || "",
        quantity: item.quantity,
        rate: item.price,
        amount: item.quantity * item.price,
        vat: vatEnabled ? (item.quantity * item.price * (vatRate / 100)) : 0,
        productId: item.productId,
      }));
      setItems(mappedItems);
    }
  }, [editingInvoice, customers]);

  // Calculate totals
  const { subtotal, discountAmount, vatTotal, total, balanceDue } = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const discountAmount = subtotal * (discountPercent / 100);
    const afterDiscount = subtotal - discountAmount;
    const vatTotal = vatEnabled ? items.reduce((sum, item) => sum + item.vat, 0) : 0;
    const total = afterDiscount + vatTotal + shipping;
    const balanceDue = total - deposit;

    return { subtotal, discountAmount, vatTotal, total, balanceDue };
  }, [items, discountPercent, shipping, deposit, vatEnabled]);

  function updateItem(index: number, field: keyof LineItem, value: any) {
    const updatedItems = [...items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };

    // Recalculate amount and VAT
    if (field === "quantity" || field === "rate") {
      const item = updatedItems[index];
      const amount = item.quantity * item.rate;
      const vat = vatEnabled && amountType === "Exclusive of Tax" ? amount * (vatRate / 100) : 0;
      updatedItems[index].amount = amount;
      updatedItems[index].vat = vat;
    }

    setItems(updatedItems);
  }

  function addLine() {
    setItems([
      ...items,
      {
        serviceDate: new Date().toISOString().split("T")[0],
        productService: "",
        sku: "",
        description: "",
        quantity: 1,
        rate: 0,
        amount: 0,
        vat: 0,
        isManual: false,
      },
    ]);
  }

  function addManualLine() {
    setItems([
      ...items,
      {
        serviceDate: new Date().toISOString().split("T")[0],
        productService: "",
        sku: "",
        description: "",
        quantity: 1,
        rate: 0,
        amount: 0,
        vat: 0,
        isManual: true,
      },
    ]);
  }

  function clearAllLines() {
    setItems([
      {
        serviceDate: new Date().toISOString().split("T")[0],
        productService: "",
        sku: "",
        description: "",
        quantity: 1,
        rate: 0,
        amount: 0,
        vat: 0,
        isManual: false,
      },
    ]);
  }

  function addSubtotal() {
    // Add a separator row (not implemented in this basic version)
    toast({
      title: "Feature coming soon",
      description: "Subtotal rows will be available in the next update",
    });
  }

  function buildCurrentInvoice() {
    if (!selectedCustomerId) return null;

    const isWalkin = selectedCustomerId === WALKIN_ID;
    const resolvedCustomerName = isWalkin
      ? (walkinName.trim() || "Cash Sale")
      : (() => { const c = customers.find(x => x.id === selectedCustomerId); return c ? (c.companyName || c.contactPerson) : null; })();
    if (!resolvedCustomerName) return null;

    const invoiceItems = items.map((item, index) => ({
      id: editingInvoice?.items[index]?.id || `item_${Date.now()}_${index}`,
      productName: item.productService,
      sku: item.sku || "",
      description: item.description || "",
      quantity: item.quantity,
      price: item.rate,
      total: item.quantity * item.rate,
      productId: item.productId,
    }));

    const currentTaxRate = vatEnabled ? vatRate : 0;
    const subtotal = invoiceItems.reduce((sum, item) => sum + item.total, 0);
    const discountAmount = (subtotal * discountPercent) / 100;
    const taxableAmount = subtotal - discountAmount;
    const tax = (taxableAmount * currentTaxRate) / 100;
    const total = taxableAmount + tax;
    const amountPaid = deposit;
    const balanceDue = total - deposit;

    return {
      id: editingInvoice?.id || "DRAFT",
      invoiceNumber: editingInvoice?.invoiceNumber || "DRAFT",
      customerId: selectedCustomerId,
      customerName: resolvedCustomerName,
      customerEmail: customerEmail,
      customerPhone: customerPhone,
      items: invoiceItems,
      invoiceDate,
      dueDate,
      terms: terms as any,
      taxRate: currentTaxRate,
      discountPercent,
      discountAmount,
      subtotal,
      tax,
      total,
      balanceDue,
      amountPaid,
      paymentStatus: (amountPaid === 0 ? "unpaid" : amountPaid >= total ? "paid" : "partial") as "unpaid" | "partial" | "paid",
      notes: messageOnInvoice,
      billingAddress,
      shippingAddress,
      status: editingInvoice?.status || "draft" as any,
      createdAt: editingInvoice?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: editingInvoice?.createdBy || user?.uid || "",
      createdByName: editingInvoice?.createdByName || user?.displayName || user?.email || "Unknown User",
      workspaceId: workspaceId || "",
    };
  }

  function handlePrint() {
    const invoice = buildCurrentInvoice();
    if (!invoice) {
      toast({
        title: "Error",
        description: "Please select a customer and add items first",
        variant: "destructive",
      });
      return;
    }
    printInvoice(invoice as any, workspaceId || undefined);
  }

  function handlePreview() {
    const invoice = buildCurrentInvoice();
    if (!invoice) {
      toast({
        title: "Error",
        description: "Please select a customer and add items first",
        variant: "destructive",
      });
      return;
    }
    previewInvoice(invoice as any, workspaceId || undefined);
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter((file) => file.size <= 25 * 1024 * 1024);
    setAttachments([...attachments, ...validFiles]);
  }

  async function handleSave(sendInvoice: boolean = false) {
    if (!selectedCustomerId) {
      toast({
        title: "Error",
        description: "Please select a customer",
        variant: "destructive",
      });
      return;
    }

    if (items.length === 0 || !items[0].productService) {
      toast({
        title: "Error",
        description: "Please add at least one line item",
        variant: "destructive",
      });
      return;
    }

    if (sendInvoice && !customerEmail) {
      toast({
        title: "Customer email required",
        description: "Please enter the customer's email address before sending the invoice",
        variant: "destructive",
      });
      return;
    }

    // Build customer object now (synchronous)
    const isWalkin = selectedCustomerId === WALKIN_ID;
    const customer = isWalkin
      ? { companyName: walkinName.trim() || "Cash Sale", contactPerson: walkinName.trim() || "Cash Sale", phone: customerPhone, email: customerEmail }
      : customers.find((c) => c.id === selectedCustomerId);
    if (!customer) {
      toast({ title: "Error", description: "Customer not found", variant: "destructive" });
      return;
    }

    // Snapshot all form state now before closing
    const snapshot = {
      isWalkin,
      customer,
      editingInvoice,
      selectedCustomerId,
      customerEmail,
      customerPhone,
      billingAddress,
      shippingAddress,
      invoiceDate,
      dueDate,
      terms,
      reference,
      vatEnabled,
      vatRate,
      discountPercent,
      deposit,
      messageOnInvoice,
      ccBcc,
      items: [...items],
      fromQuotation,
      fromTask,
      sendInvoice,
    };

    // Close immediately — work continues in background
    toast({ title: sendInvoice ? "Sending invoice…" : "Saving invoice…", description: "Working in the background" });
    onClose();

    // Fire-and-forget background task
    (async () => {
      try {
        const customerName = (snapshot.customer as any).companyName || (snapshot.customer as any).contactPerson;

        if (snapshot.editingInvoice) {
          const invoiceItems = snapshot.items.map((item, index) => ({
            id: snapshot.editingInvoice!.items[index]?.id || `item_${Date.now()}_${index}`,
            productName: item.productService,
            sku: item.sku || "",
            description: item.description || "",
            quantity: item.quantity,
            price: item.rate,
            total: item.quantity * item.rate,
            ...(item.productId ? { productId: item.productId } : {}),
          }));

          const currentTaxRate = snapshot.vatEnabled ? snapshot.vatRate : 0;
          const subtotal = invoiceItems.reduce((sum, item) => sum + item.total, 0);
          const discountAmount = (subtotal * snapshot.discountPercent) / 100;
          const taxableAmount = subtotal - discountAmount;
          const tax = (taxableAmount * currentTaxRate) / 100;
          const total = taxableAmount + tax;
          const amountPaid = snapshot.deposit ?? (snapshot.editingInvoice.amountPaid || 0);
          const balanceDue = total - amountPaid;
          let paymentStatus: "unpaid" | "partial" | "paid" = amountPaid === 0 ? "unpaid" : amountPaid >= total ? "paid" : "partial";

          await updateInvoice(workspaceId!, snapshot.editingInvoice.id, {
            customerId: snapshot.selectedCustomerId,
            customerName,
            customerEmail: snapshot.customerEmail || "",
            customerPhone: snapshot.customerPhone || "",
            items: invoiceItems,
            invoiceDate: snapshot.invoiceDate,
            dueDate: snapshot.dueDate,
            terms: snapshot.terms as any,
            taxRate: currentTaxRate,
            discountPercent: snapshot.discountPercent,
            discountAmount,
            subtotal,
            tax,
            total,
            amountPaid,
            balanceDue,
            paymentStatus,
            notes: snapshot.messageOnInvoice || "",
            billingAddress: snapshot.billingAddress || "",
            shippingAddress: snapshot.shippingAddress || "",
            ...(snapshot.reference ? { purchaseOrder: snapshot.reference } : { purchaseOrder: undefined }),
          });

          if (snapshot.sendInvoice && snapshot.customerEmail) {
            const updatedInvoice: Invoice = {
              ...snapshot.editingInvoice,
              customerEmail: snapshot.customerEmail,
              items: invoiceItems,
              subtotal, tax, total, balanceDue,
              taxRate: currentTaxRate,
              discountPercent: snapshot.discountPercent,
              discountAmount,
              dueDate: snapshot.dueDate,
              notes: snapshot.messageOnInvoice,
            };
            try {
              await sendInvoiceEmail(workspaceId!, updatedInvoice, snapshot.customerEmail, snapshot.ccBcc || undefined);
              toast({ title: "Invoice sent!", description: `${snapshot.editingInvoice.invoiceNumber} emailed to ${snapshot.customerEmail}` });
            } catch (emailErr: any) {
              toast({ title: "Saved — email failed", description: emailErr.message, variant: "destructive" });
            }
          } else {
            toast({ title: "Invoice updated", description: snapshot.editingInvoice.invoiceNumber });
          }
        } else {
          const invoice = await createInvoice(
            workspaceId!,
            user!.uid,
            user!.displayName || user!.email || "Unknown User",
            {
              customerId: snapshot.selectedCustomerId,
              customerName,
              customerEmail: snapshot.customerEmail || undefined,
              customerPhone: snapshot.customerPhone || undefined,
              items: snapshot.items.map((item) => ({
                productName: item.productService,
                sku: item.sku || "",
                description: item.description || "",
                quantity: item.quantity,
                price: item.rate,
                ...(item.productId ? { productId: item.productId } : {}),
              })),
              dueDate: snapshot.dueDate,
              terms: snapshot.terms as any,
              taxRate: snapshot.vatEnabled ? snapshot.vatRate : 0,
              discountPercent: snapshot.discountPercent,
              amountPaid: snapshot.deposit > 0 ? snapshot.deposit : undefined,
              notes: snapshot.messageOnInvoice || (snapshot.fromQuotation ? `Converted from ${snapshot.fromQuotation.quotationNumber}` : undefined),
              ...(snapshot.reference ? { purchaseOrder: snapshot.reference } : {}),
              ...(snapshot.fromTask ? { invoiceNumber: snapshot.fromTask.jobNumber || snapshot.fromTask.id } : {}),
            }
          );

          if (snapshot.fromQuotation) {
            try {
              const { data: qRow } = await supabase.from('quotes').select('data').eq('id', snapshot.fromQuotation.id).single();
              if (qRow) {
                await supabaseServiceRole.from('quotes').update({ data: { ...(qRow.data as object), convertedToInvoiceId: invoice.id, convertedDate: new Date().toISOString(), status: 'accepted', updatedAt: new Date().toISOString() } }).eq('id', snapshot.fromQuotation.id);
              }
            } catch (e) { console.error('Error updating quotation:', e); }
          }

          if (snapshot.sendInvoice && snapshot.customerEmail) {
            try {
              await sendInvoiceEmail(workspaceId!, invoice, snapshot.customerEmail, snapshot.ccBcc || undefined);
              toast({ title: "Invoice sent!", description: `${invoice.invoiceNumber} emailed to ${snapshot.customerEmail}` });
            } catch (emailErr: any) {
              toast({ title: "Saved — email failed", description: emailErr.message, variant: "destructive" });
            }
          } else {
            toast({
              title: "Invoice saved",
              description: snapshot.fromQuotation
                ? `${invoice.invoiceNumber} created from ${snapshot.fromQuotation.quotationNumber}`
                : invoice.invoiceNumber,
            });
          }
        }
        onSaved?.();
      } catch (error: any) {
        console.error("Error saving invoice:", error);
        toast({ title: "Save failed", description: error?.message || `Failed to save ${type}`, variant: "destructive" });
      }
    })();
  }

  return (
    <div className="absolute inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="border-b bg-card p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-primary">
              {editingInvoice
                ? `Edit Invoice ${invoiceNumber}`
                : fromQuotation 
                  ? `Create Invoice from ${fromQuotation.quotationNumber}` 
                  : fromTask 
                    ? `Create Invoice from Task ${fromTask.jobNumber || `#${fromTask.id.slice(0, 8)}`}` 
                    : `${type === "invoice" ? "Invoice" : "Quote"} no.${invoiceNumber}`
              }
            </h1>
            {fromQuotation && (
              <p className="text-sm text-muted-foreground">
                Customer: {fromQuotation.customerName} • Total: R{fromQuotation.total.toFixed(2)}
              </p>
            )}
            {fromTask && (
              <p className="text-sm text-muted-foreground">
                {fromTask.title} • {fromTask.sparePartsUsed?.length || 0} spare part(s)
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Copy className="h-4 w-4 mr-2" />
            Copy
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handlePreview}>
            <Eye className="h-4 w-4 mr-2" />
            Preview
          </Button>
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Make recurring
          </Button>
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-2" />
            Customise
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" onClick={() => handleSave(false)} disabled={loading}>
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
          <Button
            variant="default"
            className="bg-green-600 hover:bg-green-700"
            onClick={() => handleSave(true)}
            disabled={loading}
          >
            <Send className="h-4 w-4 mr-2" />
            Save and send
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="w-full px-6 py-4">
          <div className="flex gap-6">
            {/* Left Column - Form */}
            <div className="flex-1 min-w-0 space-y-6">
              {/* Customer Info */}
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <Label>Customer</Label>
                  <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={WALKIN_ID}>💵 Walk-in / Cash Sale</SelectItem>
                      {customers.length > 0 && (
                        <div className="px-2 py-1 text-xs text-muted-foreground border-t mt-1 pt-1">Saved customers</div>
                      )}
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.companyName || customer.contactPerson}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedCustomerId === WALKIN_ID && (
                    <div className="mt-2">
                      <Label className="text-xs text-muted-foreground">Customer name (optional)</Label>
                      <Input
                        className="mt-1"
                        value={walkinName}
                        onChange={(e) => setWalkinName(e.target.value)}
                        placeholder="Cash Sale"
                      />
                    </div>
                  )}
                </div>
                <div>
                  <Label>Customer email</Label>
                  <Input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Contact number</Label>
                  <Input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="e.g. 0821234567"
                  />
                </div>
                <div>
                  <Label>Cc/Bcc</Label>
                  <Input
                    type="email"
                    value={ccBcc}
                    onChange={(e) => setCcBcc(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox checked={sendLater} onCheckedChange={(checked) => setSendLater(checked as boolean)} />
                <Label>Send later</Label>
              </div>

              {/* Addresses */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Billing address</Label>
                  <Textarea
                    rows={4}
                    value={billingAddress}
                    onChange={(e) => setBillingAddress(e.target.value)}
                    placeholder="Enter billing address"
                  />
                </div>
                <div>
                  <Label>Shipping to</Label>
                  <Textarea
                    rows={4}
                    value={shippingAddress}
                    onChange={(e) => setShippingAddress(e.target.value)}
                    placeholder="Enter shipping address"
                  />
                </div>
              </div>

              {/* Dates and Terms */}
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <Label>Terms</Label>
                  <Select value={terms} onValueChange={setTerms}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Due on receipt">Due on receipt</SelectItem>
                      <SelectItem value="Net 15">Net 15</SelectItem>
                      <SelectItem value="Net 30">Net 30</SelectItem>
                      <SelectItem value="Net 60">Net 60</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Invoice date</Label>
                  <Input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Due date</Label>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Reference</Label>
                  <Input
                    placeholder="e.g. JBL, Bose, Job #123"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Ship via</Label>
                  <Input value={shipVia} onChange={(e) => setShipVia(e.target.value)} />
                </div>
                <div>
                  <Label>Shipping date</Label>
                  <Input
                    type="date"
                    value={shippingDate}
                    onChange={(e) => setShippingDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Tracking number</Label>
                  <Input
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                  />
                </div>
              </div>

              {/* Items and Services */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Items and Services</h3>
                <div className="grid grid-cols-3 gap-4 mb-2">
                  <div>
                    <Label>Amount are</Label>
                    <Select
                      value={amountType}
                      onValueChange={(val: any) => setAmountType(val)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Exclusive of Tax">Exclusive of Tax</SelectItem>
                        <SelectItem value="Inclusive of Tax">Inclusive of Tax</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>VAT/Tax</Label>
                    <div className="flex items-center gap-2 h-10">
                      <Checkbox 
                        checked={vatEnabled} 
                        onCheckedChange={(checked) => setVatEnabled(checked as boolean)} 
                        id="vat-enabled"
                      />
                      <label htmlFor="vat-enabled" className="text-sm cursor-pointer">
                        Include VAT
                      </label>
                    </div>
                  </div>
                  {vatEnabled && (
                    <div>
                      <Label>VAT Rate (%)</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={vatRate}
                        onChange={(e) => setVatRate(parseFloat(e.target.value) || 0)}
                        placeholder="15"
                      />
                    </div>
                  )}
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-2 w-[5%]">#</th>
                        <th className="text-left p-2 w-[12%]">SERVICE DATE</th>
                        <th className="text-left p-2 w-[15%]">PRODUCT/SERVICE</th>
                        <th className="text-left p-2 w-[10%]">SKU</th>
                        <th className="text-left p-2 w-[20%]">DESCRIPTION</th>
                        <th className="text-left p-2 w-[8%]">QTY</th>
                        <th className="text-left p-2 w-[10%]">RATE</th>
                        <th className="text-left p-2 w-[10%]">AMOUNT</th>
                        {vatEnabled && <th className="text-left p-2 w-[10%]">VAT</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, index) => (
                        <tr key={index} className="border-t">
                          <td className="p-2">{index + 1}</td>
                          <td className="p-2">
                            <Input
                              type="date"
                              value={item.serviceDate}
                              onChange={(e) =>
                                updateItem(index, "serviceDate", e.target.value)
                              }
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="p-2">
<Select
                              value={
                                item.isManual
                                  ? "_manual"
                                  : (inventory.find(inv => inv.name === item.productService)?.id ?? "")
                              }
                              onValueChange={(value) => {
                                if (value === "_manual") {
                                  const updatedItems = [...items];
                                  updatedItems[index] = { ...updatedItems[index], productService: "", isManual: true, productId: undefined };
                                  setItems(updatedItems);
                                } else {
                                  const inventoryItem = inventory.find(inv => inv.id === value);
                                  if (inventoryItem) {
                                    const updatedItems = [...items];
                                    updatedItems[index] = {
                                      ...updatedItems[index],
                                      isManual: false,
                                      productId: inventoryItem.id, // Required for stock deduction
                                      productService: inventoryItem.name,
                                      sku: inventoryItem.sku || "",
                                      description: inventoryItem.description || "",
                                      rate: inventoryItem.price || 0,
                                      amount: (updatedItems[index].quantity || 1) * (inventoryItem.price || 0),
                                      vat: vatEnabled && amountType === "Exclusive of Tax"
                                        ? ((updatedItems[index].quantity || 1) * (inventoryItem.price || 0)) * (vatRate / 100)
                                        : 0,
                                    };
                                    setItems(updatedItems);
                                  }
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Select from inventory or type manually" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_manual">
                                  <span className="italic">✏️ Enter manually</span>
                                </SelectItem>
                                {inventory.map((inv) => {
                                  const packInfo = (inv as any).packSize ? ` [${(inv as any).packSize}pk @ R${((inv as any).packPrice || inv.price * (inv as any).packSize).toFixed(2)}]` : '';
                                  return (
                                    <SelectItem key={inv.id} value={inv.id}>
                                      {inv.name} {inv.sku ? `(${inv.sku})` : ""}{packInfo}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            {(item.isManual || (item.productService && !inventory.find(inv => inv.name === item.productService))) && (
                              <Input
                                value={item.productService}
                                onChange={(e) =>
                                  updateItem(index, "productService", e.target.value)
                                }
                                placeholder="Product / Service name"
                                className="h-8 text-xs mt-1"
                                autoFocus={item.isManual && item.productService === ""}
                              />
                            )}
                          </td>
                          <td className="p-2">
                            <Input
                              value={item.sku}
                              onChange={(e) => updateItem(index, "sku", e.target.value)}
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              value={item.description}
                              onChange={(e) =>
                                updateItem(index, "description", e.target.value)
                              }
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) =>
                                updateItem(index, "quantity", parseInt(e.target.value) || 1)
                              }
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.rate}
                              onChange={(e) =>
                                updateItem(index, "rate", parseFloat(e.target.value) || 0)
                              }
                              placeholder="R0.00"
                              className="h-8 text-xs"
                              inputMode="decimal"
                            />
                          </td>
                          <td className="p-2 text-right">
                            R{item.amount.toFixed(2)}
                          </td>
                          {vatEnabled && (
                            <td className="p-2 text-right">
                              R{item.vat.toFixed(2)}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex gap-2 mt-2 flex-wrap">
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addLine}>
                    + From inventory
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addManualLine}>
                    + Manual item
                  </Button>
                  <Button variant="link" size="sm" onClick={clearAllLines}>
                    Clear all lines
                  </Button>
                  <Button variant="link" size="sm" onClick={addSubtotal}>
                    Add subtotal
                  </Button>
                </div>
              </div>

              {/* Messages */}
              <div>
                <Label>Message on invoice</Label>
                <Textarea
                  rows={2}
                  value={messageOnInvoice}
                  onChange={(e) => setMessageOnInvoice(e.target.value)}
                />
              </div>

              <div>
                <Label>Message on statement</Label>
                <Textarea
                  rows={2}
                  value={messageOnStatement}
                  onChange={(e) => setMessageOnStatement(e.target.value)}
                />
              </div>

              {/* Attachments */}
              <div>
                <Label>
                  📎 Attachments <span className="text-xs text-muted-foreground">Maximum size: 25MB</span>
                </Label>
                <div
                  onDrop={handleFileDrop}
                  onDragOver={(e) => e.preventDefault()}
                  className="border-2 border-dashed rounded-lg p-8 text-center text-muted-foreground hover:border-primary transition-colors cursor-pointer"
                >
                  Drag/Drop files here or click this area.
                </div>
                {attachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {attachments.map((file, index) => (
                      <div key={index} className="text-sm flex items-center justify-between bg-muted px-3 py-1 rounded">
                        <span>{file.name}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setAttachments(attachments.filter((_, i) => i !== index))
                          }
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Summary */}
            <div className="w-72 shrink-0 space-y-6">
              <div className="bg-card border rounded-lg p-4 sticky top-6 max-h-[calc(100vh-8rem)] overflow-y-auto">
                <div className="text-right mb-4">
                  <div className="text-sm text-muted-foreground">BALANCE DUE</div>
                  <div className="text-3xl font-bold text-red-600">
                    R{balanceDue.toFixed(2)}
                  </div>
                </div>

                <div className="space-y-2 text-sm mb-4">
                  <div>
                    <Label className="text-xs">Invoice no.</Label>
                    <div className="font-mono">{invoiceNumber}</div>
                  </div>
                  <div>
                    <Label className="text-xs">Class</Label>
                    <Select value={classValue} onValueChange={setClassValue}>
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="service">Service</SelectItem>
                        <SelectItem value="product">Product</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-3">Summary</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>R{subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Discount %</span>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={discountPercent}
                          onChange={(e) =>
                            setDiscountPercent(parseFloat(e.target.value) || 0)
                          }
                          placeholder="0"
                          className="w-16 h-7 text-xs text-right"
                          inputMode="decimal"
                        />
                        <span>%</span>
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span>Discount Amount</span>
                      <span>R{discountAmount.toFixed(2)}</span>
                    </div>
                    {vatEnabled && (
                      <div className="flex justify-between">
                        <span>VAT ({vatRate}%)</span>
                        <span>R{vatTotal.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span>Shipping</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={shipping}
                        onChange={(e) => setShipping(parseFloat(e.target.value) || 0)}
                        className="w-24 h-7 text-xs text-right"
                        placeholder="R0.00"
                        inputMode="decimal"
                      />
                    </div>
                    <div className="flex justify-between font-semibold border-t pt-2">
                      <span>Total</span>
                      <span>R{total.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Deposit</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={deposit}
                        onChange={(e) => setDeposit(parseFloat(e.target.value) || 0)}
                        className="w-24 h-7 text-xs text-right"
                        placeholder="R0.00"
                        inputMode="decimal"
                      />
                    </div>
                    <div className="flex justify-between font-bold text-red-600 border-t pt-2">
                      <span>Balance due</span>
                      <span>R{balanceDue.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
