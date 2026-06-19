/**
 * Quotation Creation Page - Matches Invoice Style
 * Comprehensive quotation creation with all fields
 */

import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, Save, Send, X, Download, ChevronDown, MessageCircle } from "lucide-react";
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
import { createQuotation, updateQuotation } from "@/lib/quotationService";
import { Customer, Quotation } from "@/types/invoice";
import { Task, CustomFieldDefinition } from "@/types/crm";
import { SUPABASE_URL,  supabase } from "@/lib/supabase";
import { getEffectiveSmtp, saveSentEmail } from "@/lib/emailAccountService";
import { generateQuotationHTML, downloadQuotation, generateQuotationPDFBlob } from "@/lib/pdfService";
import { sendPDFViaWhatsApp } from "@/lib/whatsappPdfService";
import { loadSalesSettings } from "@/lib/salesSettingsService";
import { FieldMapping, resolveField, resolveTemplate } from "@/lib/fieldMapperService";

const SMTP_URL = `${SUPABASE_URL}/functions/v1/send-email`;

interface LineItem {
  serviceDate: string;
  productService: string;
  sku: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  vat: number;
  isManual?: boolean; // true when user chose to type manually
}

interface QuotationCreationPageProps {
  onClose: () => void;
  onSaved?: (info: { id: string; quotationNumber: string; fromTaskId?: string }) => void;
  editingQuotation?: Quotation;
  fromTask?: Task;
  fieldMapping?: FieldMapping;
  customFields?: CustomFieldDefinition[];
}

export function QuotationCreationPage({ onClose, onSaved, editingQuotation, fromTask, fieldMapping, customFields = [] }: QuotationCreationPageProps) {
  const { workspaceId, user } = useAuth();
  const { toast } = useToast();

  // Generate quotation number
  const [quotationNumber] = useState(
    editingQuotation 
      ? editingQuotation.quotationNumber 
      : fromTask
        ? (fromTask.jobNumber || fromTask.id)
        : `QUO-${Date.now()}${Math.floor(Math.random() * 1000)}`
  );

  // Walk-in / Cash Sale virtual customer
  const WALKIN_ID = "__walkin__";

  // Customer fields
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(editingQuotation?.customerId || WALKIN_ID);
  const [walkinName, setWalkinName] = useState(
    editingQuotation?.customerId === WALKIN_ID ? (editingQuotation.customerName || "Cash Sale") : "Cash Sale"
  );
  const [customerCompanyName, setCustomerCompanyName] = useState(editingQuotation?.customerCompanyName || "");
  const [customerContactName, setCustomerContactName] = useState(editingQuotation?.customerContactName || "");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [ccBcc, setCcBcc] = useState("");
  const [sendLater, setSendLater] = useState(false);
  const [showBillingAddress, setShowBillingAddress] = useState(false);

  // Address fields
  const [billingAddress, setBillingAddress] = useState("");
  const [billingAddrObj, setBillingAddrObj] = useState<any>(null);
  const [shippingAddrObj, setShippingAddrObj] = useState<any>(null);
  const [customerAccountNum, setCustomerAccountNum] = useState("");

  // Date and terms fields
  const [quotationDate, setQuotationDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [validUntil, setValidUntil] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().split("T")[0];
  });

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
  const [terms, setTerms] = useState("This quotation is valid for 30 days.");
  const [notes, setNotes] = useState("");

  // Summary fields
  const [discountPercent, setDiscountPercent] = useState(editingQuotation?.discountPercent || 0);
  const [deposit, setDeposit] = useState(editingQuotation?.deposit || 0);

  const [inventory, setInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingWA, setSendingWA] = useState(false);

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
      // Apply global defaults for brand-new quotations only
      if (!editingQuotation) {
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
      setCustomerCompanyName(customer.companyName || "");
      setCustomerContactName(customer.contactPerson || "");
      setCustomerEmail(customer.email || "");
      setCustomerPhone(customer.phone || "");
      setBillingAddrObj(customer.billingAddress || null);
      setShippingAddrObj(customer.shippingAddress || null);
      setCustomerAccountNum(customer.customerNumber || "");
      setBillingAddress(
        customer.billingAddress
          ? `${customer.billingAddress.street || ""}\n${
              customer.billingAddress.city || ""
            }, ${customer.billingAddress.state || ""} ${
              customer.billingAddress.postalCode || ""
            }`
          : ""
      );
      // Apply per-customer VAT setting (only when NOT editing an existing quotation)
      if (!editingQuotation) {
        if (customer.vatEnabled !== undefined) {
          setVatEnabled(customer.vatEnabled);
        } else {
          setVatEnabled(defaultVatEnabled);
        }
      }
    }
  }, [selectedCustomerId, customers]);

  // Pre-populate from task (when launched from a CRM task "Generate Quote")
  useEffect(() => {
    if (!fromTask) return;
    if (editingQuotation) return; // Don't override quotation edit data with task data
    const today = new Date().toISOString().split("T")[0];
    const cfv = fromTask.customFieldValues ?? [];
    // Use walk-in customer; pre-fill name using mapped field or heuristic fallback
    setSelectedCustomerId("__walkin__");
    const resolvedName = resolveField(
      cfv,
      fieldMapping?.customerNameFieldId ?? "",
      cf => typeof cf.value === "string" && cf.value.length > 0 && !String(cf.value).match(/^\d/)
    );
    if (resolvedName) setWalkinName(resolvedName);
    // Pre-fill phone using mapped field or heuristic fallback
    const resolvedPhone = resolveField(
      cfv,
      fieldMapping?.customerPhoneFieldId ?? "",
      cf => typeof cf.value === "string" && String(cf.value).match(/^\d{3}/) !== null
    );
    if (resolvedPhone) setCustomerPhone(resolvedPhone);
    // Pre-fill email if mapped
    const resolvedEmail = resolveField(cfv, fieldMapping?.customerEmailFieldId ?? "");
    if (resolvedEmail) setCustomerEmail(resolvedEmail);
    // Resolve deposit amount if mapped
    const resolvedDeposit = resolveField(cfv, fieldMapping?.depositFieldId ?? "");
    if (resolvedDeposit) {
      const depositAmount = parseFloat(resolvedDeposit) || 0;
      if (depositAmount > 0) setDeposit(depositAmount);
    }
    // Resolve job reference override
    const resolvedJobRef = resolveField(cfv, fieldMapping?.jobReferenceFieldId ?? "");
    const jobRef = resolvedJobRef || fromTask.jobNumber || "";
    // Build line items: prefer configured templates, then spare parts, then task title
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
          vat: 0,
          isManual: true,
        };
      });
      setItems(templateLines);
    } else if (fromTask.sparePartsUsed && fromTask.sparePartsUsed.length > 0) {
      const partLines: LineItem[] = fromTask.sparePartsUsed.map(part => ({
        serviceDate: today,
        productService: part.productName + (part.variantName ? ` - ${part.variantName}` : ""),
        sku: part.sku || "",
        description: `SKU: ${part.sku}`,
        quantity: part.quantity,
        rate: part.unitCost,
        amount: part.quantity * part.unitCost,
        vat: 0,
        isManual: false,
      }));
      // Add a labour line
      partLines.push({
        serviceDate: today,
        productService: `Labour: ${fromTask.title}`,
        sku: "",
        description: jobRef ? `Job #${jobRef}` : "",
        quantity: 1,
        rate: 0,
        amount: 0,
        vat: 0,
        isManual: true,
      });
      setItems(partLines);
    } else {
      setItems([{
        serviceDate: today,
        productService: fromTask.title || "Repair Service",
        sku: "",
        description: jobRef ? `Job #${jobRef}` : "",
        quantity: 1,
        rate: 0,
        amount: 0,
        vat: 0,
        isManual: true,
      }]);
    }
    if (fromTask.description) setNotes(fromTask.description);
    if (jobRef) setTerms(`Job #${jobRef} – This quotation is valid for 30 days.`);
  }, [fromTask]);

  // Pre-populate from editing quotation
  useEffect(() => {
    if (editingQuotation && customers.length > 0) {
      // Set customer
      setSelectedCustomerId(editingQuotation.customerId);
      if (editingQuotation.customerId === WALKIN_ID) {
        setWalkinName(editingQuotation.customerName || "Cash Sale");
      }
      setCustomerCompanyName(editingQuotation.customerCompanyName || "");
      setCustomerContactName(editingQuotation.customerContactName || "");
      setCustomerEmail(editingQuotation.customerEmail || "");
      setCustomerPhone(editingQuotation.customerPhone || "");
      setBillingAddrObj(editingQuotation.billingAddress || null);
      if (editingQuotation.billingAddress?.street || editingQuotation.billingAddress?.city) setShowBillingAddress(true);
      setShippingAddrObj(editingQuotation.shippingAddress || null);
      setCustomerAccountNum(editingQuotation.customerAccountNumber || "");
      
      // Set dates
      setQuotationDate(editingQuotation.createdAt.split("T")[0]);
      setValidUntil(editingQuotation.validUntil);
      
      // Set VAT settings
      setVatEnabled(editingQuotation.taxRate !== undefined && editingQuotation.taxRate > 0);
      setVatRate(editingQuotation.taxRate || 15);
      
      // Set discount
      setDiscountPercent(editingQuotation.discountPercent || 0);
      
      // Set terms and notes
      setTerms(editingQuotation.terms || "This quotation is valid for 30 days.");
      setNotes(editingQuotation.notes || "");
      
      // Set line items
      const mappedItems: LineItem[] = editingQuotation.items.map(item => ({
        serviceDate: new Date().toISOString().split("T")[0],
        productService: item.productName,
        sku: item.sku || "",
        description: item.description || "",
        quantity: item.quantity,
        rate: item.price,
        amount: item.quantity * item.price,
        vat: vatEnabled ? (item.quantity * item.price * (vatRate / 100)) : 0,
      }));
      setItems(mappedItems);
    }
  }, [editingQuotation, customers]);

  // Calculate totals
  const { subtotal, discountAmount, vatTotal, total } = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const discountAmount = subtotal * (discountPercent / 100);
    const afterDiscount = subtotal - discountAmount;
    const vatTotal = vatEnabled ? items.reduce((sum, item) => sum + item.vat, 0) : 0;
    const total = afterDiscount + vatTotal;

    return { subtotal, discountAmount, vatTotal, total };
  }, [items, discountPercent, vatEnabled]);

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

  async function handleSave(sendQuotation: boolean = false) {
    if (!selectedCustomerId) {
      toast({ title: "Error", description: "Please select a customer", variant: "destructive" });
      return;
    }
    if (items.length === 0 || !items[0].productService) {
      toast({ title: "Error", description: "Please add at least one line item", variant: "destructive" });
      return;
    }

    const isWalkin = selectedCustomerId === WALKIN_ID;
    const customer = isWalkin
      ? { id: WALKIN_ID, companyName: walkinName.trim() || "Cash Sale", contactPerson: walkinName.trim() || "Cash Sale", phone: customerPhone, email: customerEmail }
      : customers.find((c) => c.id === selectedCustomerId);
    if (!customer) {
      toast({ title: "Error", description: "Customer not found", variant: "destructive" });
      return;
    }

    // Snapshot all form state before closing
    const snapshot = {
      isWalkin, customer, editingQuotation, selectedCustomerId,
      customerEmail, customerPhone, ccBcc, vatEnabled, vatRate, discountPercent,
      deposit,
      validUntil, terms, notes, items: [...items], sendQuotation,
      billingAddrObj, shippingAddrObj, customerAccountNum,
      customerCompanyName, customerContactName,
      fromTaskId: fromTask?.id,
      fromTask,
    };

    toast({ title: sendQuotation ? "Sending quotation…" : "Saving quotation…", description: "Working in the background" });
    onClose();

    (async () => {
      try {
        const customerName = (snapshot.customer as any).companyName || (snapshot.customer as any).contactPerson;
        const currentTaxRate = snapshot.vatEnabled ? snapshot.vatRate : 0;
        let savedId = '';
        let savedQuotationNumber = '';
        let quotationForEmail: any = null;

        if (snapshot.editingQuotation) {
          const quotationItems = snapshot.items.map((item, index) => ({
            id: snapshot.editingQuotation!.items[index]?.id || `item_${Date.now()}_${index}`,
            productName: item.productService,
            sku: item.sku || "",
            description: item.description || "",
            quantity: item.quantity,
            price: item.rate,
            total: item.amount,
            taxRate: currentTaxRate,
          }));
          const subtotal = quotationItems.reduce((sum, i) => sum + i.total, 0);
          const discountAmount = (subtotal * snapshot.discountPercent) / 100;
          const taxableAmount = subtotal - discountAmount;
          const tax = (taxableAmount * currentTaxRate) / 100;
          const total = taxableAmount + tax;

          const depositAmt = snapshot.deposit || 0;
          await updateQuotation(workspaceId!, snapshot.editingQuotation.id, {
            customerId: snapshot.selectedCustomerId,
            customerName,
            customerEmail: snapshot.customerEmail,
            customerPhone: snapshot.customerPhone,
            customerCompanyName: snapshot.customerCompanyName || undefined,
            customerContactName: snapshot.customerContactName || undefined,
            billingAddress: snapshot.billingAddrObj || undefined,
            shippingAddress: snapshot.shippingAddrObj || undefined,
            customerAccountNumber: snapshot.customerAccountNum || undefined,
            items: quotationItems as any,
            taxRate: currentTaxRate,
            discountPercent: snapshot.discountPercent,
            discountAmount,
            subtotal,
            tax,
            total,
            deposit: depositAmt,
            balanceDue: total - depositAmt,
            validUntil: snapshot.validUntil,
            terms: snapshot.terms,
            notes: snapshot.notes,
          });
          savedId = snapshot.editingQuotation.id;
          savedQuotationNumber = snapshot.editingQuotation.quotationNumber;
          quotationForEmail = { ...snapshot.editingQuotation, items: quotationItems, subtotal, discountAmount, tax, total, validUntil: snapshot.validUntil, customerEmail: snapshot.customerEmail };
          if (!snapshot.sendQuotation) toast({ title: "Quotation updated", description: savedQuotationNumber });
        } else {
          const quotation = await createQuotation(workspaceId!, user!.uid, {
            customerId: snapshot.selectedCustomerId,
            customerName,
            customerEmail: snapshot.customerEmail,
            customerPhone: snapshot.customerPhone,
            customerCompanyName: snapshot.customerCompanyName || undefined,
            customerContactName: snapshot.customerContactName || undefined,
            billingAddress: snapshot.billingAddrObj || undefined,
            shippingAddress: snapshot.shippingAddrObj || undefined,
            customerAccountNumber: snapshot.customerAccountNum || undefined,
            items: snapshot.items.map((item) => ({
              productName: item.productService,
              sku: item.sku || "",
              description: item.description || "",
              quantity: item.quantity,
              price: item.rate,
              total: item.amount,
              taxRate: currentTaxRate,
            })),
            taxRate: currentTaxRate,
            discountPercent: snapshot.discountPercent,
            validUntil: snapshot.validUntil,
            terms: snapshot.terms,
            notes: snapshot.notes,
            deposit: snapshot.deposit > 0 ? snapshot.deposit : undefined,
            ...(snapshot.fromTask ? { quotationNumber: snapshot.fromTask.jobNumber || snapshot.fromTask.id } : {}),
          });
          savedId = quotation.id;
          savedQuotationNumber = quotation.quotationNumber;
          quotationForEmail = quotation;
          if (!snapshot.sendQuotation) toast({ title: "Quotation saved", description: savedQuotationNumber });
        }

        if (snapshot.sendQuotation && snapshot.customerEmail && quotationForEmail) {
          try {
            const { data: { user: currentUser } } = await supabase.auth.getUser();
            const userSmtp = currentUser ? await getEffectiveSmtp(workspaceId!, currentUser.id) : null;
            const salesSettings = await loadSalesSettings(workspaceId!);
            let fromName: string;
            let fromEmail: string;
            let smtpConfig: { host: string; port: number; secure: boolean; user: string; pass: string; fromName: string; fromEmail: string };
            if (userSmtp) {
              fromName = userSmtp.fromName;
              fromEmail = userSmtp.fromEmail;
              smtpConfig = { ...userSmtp, fromName, fromEmail };
            } else {
              const { data: emailRow } = await supabase.from('workspace_settings').select('data').eq('workspace_id', workspaceId!).eq('category', 'email').single();
              if (!emailRow?.data) throw new Error("Email not configured");
              const es = emailRow.data as any;
              if (!es.enabled) throw new Error("Email disabled");
              fromName = es.fromName || salesSettings.companyName || "ShopFlowz";
              fromEmail = es.fromEmail || es.smtpUser || "";
              const host = es.provider === "gmail" ? "smtp.gmail.com" : (es.smtpHost ?? "");
              const port = es.provider === "gmail" ? 587 : (es.smtpPort ?? 465);
              const secure = es.provider === "gmail" ? false : (es.smtpSecure ?? (port === 465));
              smtpConfig = { host, port, secure, user: es.smtpUser, pass: es.smtpPassword, fromName, fromEmail };
            }
            const quotationHtml = generateQuotationHTML(quotationForEmail, salesSettings);
            const pdfBlob = await generateQuotationPDFBlob(quotationForEmail, salesSettings);
            const pdfArrayBuffer = await pdfBlob.arrayBuffer();
            const pdfBytes = new Uint8Array(pdfArrayBuffer);
            let pdfBinary = "";
            for (let i = 0; i < pdfBytes.length; i += 8192) {
              pdfBinary += String.fromCharCode(...pdfBytes.subarray(i, i + 8192));
            }
            const pdfBase64 = btoa(pdfBinary);
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
                    to: snapshot.customerEmail,
                    ...(snapshot.ccBcc ? { cc: snapshot.ccBcc } : {}),
                    subject: `${savedQuotationNumber} from ${fromName}`,
                    text: `Please find your quotation ${savedQuotationNumber} attached.\nTotal: R${quotationForEmail.total.toFixed(2)}\nValid until: ${quotationForEmail.validUntil}`,
                    html: quotationHtml,
                    attachments: [{ filename: `${savedQuotationNumber}.pdf`, content: pdfBase64, contentType: "application/pdf" }],
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
            const json = await resp.json();
            if (!resp.ok || !json.success) throw new Error(json.error || `HTTP ${resp.status}`);
            if (currentUser) {
              saveSentEmail(workspaceId!, currentUser.id, {
                from: `${fromName} <${fromEmail}>`,
                to: snapshot.customerEmail,
                ...(snapshot.ccBcc ? { cc: snapshot.ccBcc } : {}),
                subject: `${savedQuotationNumber} from ${fromName}`,
                text: `Please find your quotation ${savedQuotationNumber} attached.\nTotal: R${quotationForEmail.total.toFixed(2)}\nValid until: ${quotationForEmail.validUntil}`,
                date: new Date(),
              }).catch(() => {});
            }
            toast({ title: "Quotation sent!", description: `${savedQuotationNumber} emailed to ${snapshot.customerEmail}` });
          } catch (emailErr: any) {
            toast({ title: "Saved — email failed", description: emailErr.message, variant: "destructive" });
          }
        }
        onSaved?.({ id: savedId, quotationNumber: savedQuotationNumber, fromTaskId: snapshot.fromTaskId });
      } catch (error: any) {
        console.error("Error saving quotation:", error);
        toast({ title: "Save failed", description: error?.message || "Failed to save quotation", variant: "destructive" });
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
            <h1 className="text-2xl font-bold">
              {editingQuotation ? "Edit Quotation" : "Create Quotation"}
            </h1>
            <p className="text-sm text-muted-foreground">{quotationNumber}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={async () => {
            const isWalkin = selectedCustomerId === WALKIN_ID;
            const customer = isWalkin
              ? { id: WALKIN_ID, companyName: walkinName.trim() || "Cash Sale", contactPerson: walkinName.trim() || "Cash Sale", phone: customerPhone, email: customerEmail }
              : customers.find((c) => c.id === selectedCustomerId);
            const customerName = (customer as any)?.companyName || (customer as any)?.contactPerson || "Customer";
            const currentTaxRate = vatEnabled ? vatRate : 0;
            const qItems = items.map((item, i) => ({
              id: `item_${i}`,
              productName: item.productService,
              sku: item.sku || "",
              description: item.description || "",
              quantity: item.quantity,
              price: item.rate,
              total: item.amount,
              taxRate: currentTaxRate,
            }));
            const sub = qItems.reduce((s, i) => s + i.total, 0);
            const disc = (sub * discountPercent) / 100;
            const taxable = sub - disc;
            const tax = (taxable * currentTaxRate) / 100;
            const q = {
              id: editingQuotation?.id || `preview_${Date.now()}`,
              quotationNumber,
              customerId: selectedCustomerId,
              customerName,
              customerCompanyName: customerCompanyName || undefined,
              customerContactName: customerContactName || undefined,
              customerEmail,
              customerPhone,
              billingAddress: billingAddrObj || undefined,
              shippingAddress: shippingAddrObj || undefined,
              customerAccountNumber: customerAccountNum || undefined,
              items: qItems as any,
              subtotal: sub,
              discountPercent,
              discountAmount: disc,
              taxRate: currentTaxRate,
              taxAmount: tax,
              total: taxable + tax,
              deposit: deposit || undefined,
              balanceDue: deposit > 0 ? (taxable + tax) - deposit : undefined,
              status: (editingQuotation?.status || "draft") as any,
              validUntil,
              terms,
              notes,
              createdAt: editingQuotation?.createdAt || new Date().toISOString(),
              workspaceId: workspaceId || "",
            };
            try {
              await downloadQuotation(q, workspaceId || undefined);
              toast({ title: "PDF Downloaded", description: `Quotation-${quotationNumber}.pdf saved` });
            } catch (e: any) {
              toast({ title: "Download Failed", description: e.message || "Failed", variant: "destructive" });
            }
          }} disabled={loading}>
            <Download className="h-4 w-4 mr-2" />
            Download PDF
          </Button>
          <Button variant="outline" disabled={loading || sendingWA || !customerPhone} onClick={async () => {
            setSendingWA(true);
            try {
              const isWalkin = selectedCustomerId === WALKIN_ID;
              const customer = isWalkin
                ? { id: WALKIN_ID, companyName: walkinName.trim() || "Cash Sale", contactPerson: walkinName.trim() || "Cash Sale", phone: customerPhone, email: customerEmail }
                : customers.find((c) => c.id === selectedCustomerId);
              const customerName = (customer as any)?.companyName || (customer as any)?.contactPerson || "Customer";
              const currentTaxRate = vatEnabled ? vatRate : 0;
              const qItems = items.map((item, i) => ({
                id: `item_${i}`, productName: item.productService, sku: item.sku || "",
                description: item.description || "", quantity: item.quantity, price: item.rate,
                total: item.amount, taxRate: currentTaxRate,
              }));
              const sub = qItems.reduce((s, i) => s + i.total, 0);
              const disc = (sub * discountPercent) / 100;
              const taxable = sub - disc;
              const tax = (taxable * currentTaxRate) / 100;
              const q = {
                id: editingQuotation?.id || `preview_${Date.now()}`,
                quotationNumber, customerId: selectedCustomerId, customerName,
                customerCompanyName: customerCompanyName || undefined,
                customerContactName: customerContactName || undefined,
                customerEmail, customerPhone,
                billingAddress: billingAddrObj || undefined,
                shippingAddress: shippingAddrObj || undefined,
                customerAccountNumber: customerAccountNum || undefined,
                items: qItems as any, subtotal: sub, discountPercent, discountAmount: disc,
                taxRate: currentTaxRate, taxAmount: tax, total: taxable + tax,
                deposit: deposit || undefined,
                balanceDue: deposit > 0 ? (taxable + tax) - deposit : undefined,
                status: (editingQuotation?.status || "draft") as any,
                validUntil, terms, notes,
                createdAt: editingQuotation?.createdAt || new Date().toISOString(),
                workspaceId: workspaceId || "",
              };
              const salesSettings = await loadSalesSettings(workspaceId || "");
              const blob = await generateQuotationPDFBlob(q as any, salesSettings);
              const fname = `Quote-${quotationNumber}.pdf`;
              const result = await sendPDFViaWhatsApp({
                blob, filename: fname, phone: customerPhone,
                contactName: customerName, workspaceId: workspaceId || "",
                sentByName: user?.email ?? "Staff",
              });
              if (result.success) {
                toast({
                  title: result.queued ? "PDF Queued ✓" : "PDF Sent via WhatsApp ✓",
                  description: result.queued
                    ? "24hr window expired — re-opener sent. PDF will deliver when client replies."
                    : `${fname} sent to ${customerPhone}. Check WhatsApp Messenger to continue the chat.`,
                });
              } else {
                toast({ title: "WhatsApp Send Failed", description: result.error, variant: "destructive" });
              }
            } catch (e: any) {
              toast({ title: "WhatsApp Send Failed", description: e.message || "Failed", variant: "destructive" });
            } finally {
              setSendingWA(false);
            }
          }}>
            <MessageCircle className="h-4 w-4 mr-2" />
            {sendingWA ? "Sending…" : "WhatsApp PDF"}
          </Button>
          <Button variant="outline" onClick={() => handleSave(false)} disabled={loading}>
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
          <Button onClick={() => handleSave(true)} disabled={loading}>
            <Send className="h-4 w-4 mr-2" />
            {loading ? "Saving..." : "Send Quotation"}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="w-full px-2">
          <div className="flex gap-6">
            {/* Left Column - Form */}
            <div className="flex-1 min-w-0 space-y-6">
              {/* Customer Info */}
              <div className="grid grid-cols-3 gap-4">
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

              {/* Billing Address */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowBillingAddress(v => !v)}
                  className="flex items-center gap-2 text-base font-semibold hover:text-primary transition-colors w-full text-left"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${showBillingAddress ? 'rotate-180' : '-rotate-90'}`} />
                  Billing Address
                  {!showBillingAddress && (billingAddrObj?.street || billingAddrObj?.city) && (
                    <span className="text-xs font-normal text-muted-foreground ml-1 truncate">
                      {[billingAddrObj?.street, billingAddrObj?.city].filter(Boolean).join(', ')}
                    </span>
                  )}
                </button>
                {showBillingAddress && <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Company Name</Label>
                    <Input
                      value={customerCompanyName}
                      onChange={e => setCustomerCompanyName(e.target.value)}
                      placeholder="Company name"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Contact Name</Label>
                    <Input
                      value={customerContactName}
                      onChange={e => setCustomerContactName(e.target.value)}
                      placeholder="Contact person"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">Street</Label>
                    <Input
                      value={billingAddrObj?.street || ""}
                      onChange={e => setBillingAddrObj((prev: any) => ({ ...(prev || {}), street: e.target.value }))}
                      placeholder="Street address"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">City</Label>
                    <Input
                      value={billingAddrObj?.city || ""}
                      onChange={e => setBillingAddrObj((prev: any) => ({ ...(prev || {}), city: e.target.value }))}
                      placeholder="City"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">State / Province</Label>
                    <Input
                      value={billingAddrObj?.state || ""}
                      onChange={e => setBillingAddrObj((prev: any) => ({ ...(prev || {}), state: e.target.value }))}
                      placeholder="Province"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Postal Code</Label>
                    <Input
                      value={billingAddrObj?.postalCode || ""}
                      onChange={e => setBillingAddrObj((prev: any) => ({ ...(prev || {}), postalCode: e.target.value }))}
                      placeholder="0000"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Country</Label>
                    <Input
                      value={billingAddrObj?.country || ""}
                      onChange={e => setBillingAddrObj((prev: any) => ({ ...(prev || {}), country: e.target.value }))}
                      placeholder="South Africa"
                    />
                  </div>
                </div>}
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Quotation date</Label>
                  <Input
                    type="date"
                    value={quotationDate}
                    onChange={(e) => setQuotationDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Valid until</Label>
                  <Input
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
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
                                  updatedItems[index] = { ...updatedItems[index], productService: "", isManual: true };
                                  setItems(updatedItems);
                                } else {
                                  const inventoryItem = inventory.find(inv => inv.id === value);
                                  if (inventoryItem) {
                                    const updatedItems = [...items];
                                    updatedItems[index] = {
                                      ...updatedItems[index],
                                      isManual: false,
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
                </div>
              </div>

              {/* Terms & Conditions */}
              <div>
                <Label>Terms & Conditions</Label>
                <Textarea
                  rows={3}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                />
              </div>

              {/* Notes */}
              <div>
                <Label>Notes</Label>
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            {/* Right Column - Summary */}
            <div className="w-72 shrink-0 space-y-6">
              <div className="bg-card border rounded-lg p-4 sticky top-6">
                <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase">
                  Preview  
                </h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Quotation #</span>
                    <p className="font-mono font-semibold">{quotationNumber}</p>
                  </div>
                </div>

                <div className="border-t pt-4 mt-4">
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
                    {deposit > 0 && (
                      <div className="flex justify-between font-bold text-red-600 border-t pt-2">
                        <span>Balance due</span>
                        <span>R{(total - deposit).toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky footer — always-visible Save / Send bar */}
      <div className="sticky bottom-0 z-10 border-t bg-card px-4 py-3 flex items-center justify-between gap-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <span className="text-sm text-muted-foreground font-mono hidden sm:block">{quotationNumber}</span>
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" onClick={() => handleSave(false)} disabled={loading} className="gap-1.5">
            <Save className="h-4 w-4" />
            Save
          </Button>
          <Button onClick={() => handleSave(true)} disabled={loading} className="gap-1.5">
            <Send className="h-4 w-4" />
            {loading ? "Saving..." : "Send Quotation"}
          </Button>
        </div>
      </div>
    </div>
  );
}
