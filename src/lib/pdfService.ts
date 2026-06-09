import { Invoice, Quotation } from "@/types/invoice";
import { SalesSettings, DEFAULT_SALES_SETTINGS, loadSalesSettings } from "@/lib/salesSettingsService";

function fmt(n: number) { return `R${(n || 0).toFixed(2)}`; }
function fmtDate(d: string) { try { return new Date(d).toLocaleDateString('en-ZA'); } catch { return d; } }

function getStyles(color: string) {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 13px; color: #222; background: #fff; }
    .page { max-width: 765px; margin: 0 auto; padding: 36px 40px; }

    /* TOP HEADER */
    .top-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .logo-block img { max-height: 70px; max-width: 200px; object-fit: contain; }
    .logo-block .company-name { font-size: 18px; font-weight: bold; color: ${color}; }
    .company-info { font-size: 12px; line-height: 1.7; color: #444; text-align: right; }
    .company-info strong { color: #222; font-size: 13px; display: block; }
    .company-reg { font-size: 11px; color: #777; margin-top: 4px; }

    /* TITLE BAND */
    .title-band { background: ${color}; color: #fff; padding: 10px 18px; display: flex; justify-content: space-between; align-items: center; border-radius: 4px; margin-bottom: 20px; }
    .title-band h1 { font-size: 22px; letter-spacing: 2px; font-weight: bold; }
    .title-band .inv-meta { text-align: right; font-size: 12px; line-height: 1.7; }
    .title-band .inv-meta strong { font-size: 14px; }

    /* BILL/SHIP */
    .addresses { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .addr-box h4 { font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; margin-bottom: 6px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
    .addr-box p { font-size: 12px; line-height: 1.6; color: #333; }
    .addr-box p strong { color: #111; font-size: 13px; }

    /* LINE ITEMS */
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    .items-table th { background: ${color}; color: #fff; padding: 9px 10px; text-align: left; font-size: 12px; font-weight: 600; }
    .items-table th.right { text-align: right; }
    .items-table td { padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 12px; vertical-align: top; }
    .items-table td.right { text-align: right; }
    .items-table tr:nth-child(even) td { background: #fafafa; }
    .items-table td .desc { font-size: 11px; color: #666; margin-top: 2px; }

    /* TOTALS */
    .totals-wrap { display: flex; justify-content: flex-end; margin-bottom: 24px; }
    .totals-box { width: 300px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
    .totals-row { display: flex; justify-content: space-between; padding: 7px 14px; font-size: 13px; border-bottom: 1px solid #eee; }
    .totals-row:last-child { border-bottom: none; }
    .totals-row.subtotal { background: #f9fafb; }
    .totals-row.tax { background: #f9fafb; }
    .totals-row.total { background: ${color}; color: #fff; font-weight: bold; font-size: 14px; }
    .totals-row.balance { background: #fee2e2; color: #991b1b; font-weight: bold; font-size: 15px; }
    .totals-row.paid-row { background: #dcfce7; color: #166534; }

    /* TAX SUMMARY */
    .tax-summary { margin-bottom: 20px; }
    .tax-summary h4 { font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; margin-bottom: 6px; }
    .tax-summary table { border-collapse: collapse; font-size: 12px; }
    .tax-summary th, .tax-summary td { border: 1px solid #e5e7eb; padding: 5px 12px; }
    .tax-summary th { background: #f3f4f6; }

    /* BANKING */
    .banking { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px; }
    .banking h4 { font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; margin-bottom: 8px; }
    .banking-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; font-size: 12px; }
    .banking-grid .lbl { color: #666; }
    .banking-grid .val { font-weight: 600; color: #111; }

    /* NOTES */
    .notes { font-size: 12px; color: #555; margin-bottom: 16px; border-left: 3px solid ${color}; padding-left: 10px; }
    .notes h4 { font-weight: 600; color: #333; margin-bottom: 4px; }

    /* FOOTER */
    .footer { text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; }

    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  `;
}

// Strip trailing whitespace from every line so quoted-printable email encoding
// doesn't turn those trailing spaces into visible =20 artifacts in some clients.
function cleanEmailHtml(html: string): string {
  return html.replace(/[ \t]+$/gm, '');
}

/**
 * Generate HTML for invoice printing/preview
 */
export function generateInvoiceHTML(invoice: Invoice, s: SalesSettings = DEFAULT_SALES_SETTINGS): string {
  const color = s.primaryColor || '#2563eb';
  const billingAddr = invoice.billingAddress;
  const shippingAddr = invoice.shippingAddress;

  return cleanEmailHtml(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tax Invoice ${invoice.invoiceNumber}</title>
  <style>${getStyles(color)}</style>
</head>
<body>
<div class="page">

  <!-- TOP HEADER -->
  <div class="top-header">
    <div class="logo-block">
      ${s.logoUrl ? `<img src="${s.logoUrl}" alt="Logo" />` : `<div class="company-name">${s.companyName || 'Your Company'}</div>`}
    </div>
    <div class="company-info">
      <strong>${s.companyName || ''}</strong>
      ${s.companyAddress ? `${s.companyAddress}<br/>` : ''}
      ${s.companyCity ? `${s.companyCity}, ${s.companyProvince || ''} ${s.companyPostalCode || ''}<br/>` : ''}
      ${s.companyPhone ? `${s.companyPhone}<br/>` : ''}
      ${s.companyEmail ? `${s.companyEmail}<br/>` : ''}
      ${s.companyWebsite ? `${s.companyWebsite}<br/>` : ''}
      <span class="company-reg">
        ${s.vatRegistrationNumber ? `VAT Registration No. ${s.vatRegistrationNumber}` : ''}
        ${s.vatRegistrationNumber && s.businessRegistrationNumber ? ' &nbsp;|&nbsp; ' : ''}
        ${s.businessRegistrationNumber ? `Business ID No. ${s.businessRegistrationNumber}` : ''}
      </span>
    </div>
  </div>

  <!-- TITLE BAND -->
  <div class="title-band">
    <h1>${(invoice.taxRate ?? 0) > 0 ? 'TAX INVOICE' : 'INVOICE'}</h1>
    <div class="inv-meta">
      <div>INVOICE NO. <strong>${invoice.invoiceNumber}</strong></div>
      <div>DATE ${fmtDate(invoice.invoiceDate)}</div>
      <div>DUE DATE ${fmtDate(invoice.dueDate)}</div>
      ${invoice.terms ? `<div>TERMS ${invoice.terms.replace(/-/g, ' ').toUpperCase()}</div>` : ''}
    </div>
  </div>

  <!-- BILL TO / SHIP TO / PO -->
  <div class="addresses">
    <div class="addr-box">
      <h4>Bill To</h4>
      <p>
        <strong>${invoice.customerName}</strong><br/>
        ${billingAddr?.street ? billingAddr.street + '<br/>' : ''}
        ${billingAddr?.city ? billingAddr.city + (billingAddr.state ? ', ' + billingAddr.state : '') + '<br/>' : ''}
        ${billingAddr?.postalCode ? billingAddr.postalCode + '<br/>' : ''}
        ${invoice.customerEmail ? invoice.customerEmail + '<br/>' : ''}
        ${invoice.customerPhone ? invoice.customerPhone : ''}
      </p>
    </div>
    <div class="addr-box">
      <h4>Ship To</h4>
      <p>
        <strong>${invoice.customerName}</strong><br/>
        ${shippingAddr?.street ? shippingAddr.street + '<br/>' : (billingAddr?.street ? billingAddr.street + '<br/>' : '')}
        ${shippingAddr?.city ? shippingAddr.city + (shippingAddr.state ? ', ' + shippingAddr.state : '') + '<br/>' : (billingAddr?.city ? billingAddr.city + '<br/>' : '')}
        ${shippingAddr?.postalCode ? shippingAddr.postalCode : (billingAddr?.postalCode || '')}
      </p>
    </div>
    <div class="addr-box">
      <h4>Details</h4>
      <p>
        ${invoice.customerVatNumber ? `<div>VAT Reg. No.<br/><strong>${invoice.customerVatNumber}</strong></div>` : ''}
        ${invoice.purchaseOrderNumber ? `<div style="margin-top:6px">PURCHASE ORDER<br/><strong>${invoice.purchaseOrderNumber}</strong></div>` : ''}
      </p>
    </div>
  </div>

  <!-- LINE ITEMS -->
  <table class="items-table">
    <thead>
      <tr>
        <th>DATE</th>
        <th>ACTIVITY</th>
        <th>DESCRIPTION</th>
        <th class="right">QTY</th>
        <th class="right">RATE</th>
        <th class="right">AMOUNT</th>
      </tr>
    </thead>
    <tbody>
      ${invoice.items.map(item => `
        <tr>
          <td>${fmtDate(invoice.invoiceDate)}</td>
          <td>${item.productName}</td>
          <td>
            ${item.description || ''}
            ${item.sku ? `<div class="desc">SKU: ${item.sku}</div>` : ''}
          </td>
          <td class="right">${item.quantity}</td>
          <td class="right">${fmt(item.price)}</td>
          <td class="right">${fmt(item.total)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <!-- TOTALS -->
  <div class="totals-wrap">
    <div class="totals-box">
      <div class="totals-row subtotal">
        <span>SUBTOTAL</span><span>${fmt(invoice.subtotal)}</span>
      </div>
      ${invoice.discountAmount && invoice.discountAmount > 0 ? `
      <div class="totals-row">
        <span>DISCOUNT (${invoice.discountPercent || 0}%)</span><span>-${fmt(invoice.discountAmount)}</span>
      </div>` : ''}
      ${(invoice.taxRate ?? 0) > 0 ? `<div class="totals-row tax"><span>VAT (${invoice.taxRate}%)</span><span>${fmt(invoice.tax)}</span></div>` : ''}
      <div class="totals-row total">
        <span>TOTAL</span><span>${fmt(invoice.total)}</span>
      </div>
      ${(invoice.amountPaid || 0) > 0 ? `
      <div class="totals-row paid-row">
        <span>AMOUNT PAID</span><span>${fmt(invoice.amountPaid)}</span>
      </div>` : ''}
      <div class="totals-row balance">
        <span>BALANCE DUE</span><span>${fmt(invoice.balanceDue)}</span>
      </div>
    </div>
  </div>

  ${(invoice.taxRate ?? 0) > 0 ? `
  <!-- TAX SUMMARY -->
  <div class="tax-summary">
    <h4>Tax Summary</h4>
    <table>
      <thead><tr><th>RATE</th><th>TAX</th><th>NET</th></tr></thead>
      <tbody>
        <tr>
          <td>VAT @ ${invoice.taxRate}%</td>
          <td>${fmt(invoice.tax)}</td>
          <td>${fmt(invoice.subtotal - (invoice.discountAmount || 0))}</td>
        </tr>
      </tbody>
    </table>
  </div>` : ''}

  <!-- BANKING DETAILS -->
  ${s.bankName || s.bankAccountNumber ? `
  <div class="banking">
    <h4>Banking Details</h4>
    <div class="banking-grid">
      ${s.bankAccountName ? `<span class="lbl">Account Name</span><span class="val">${s.bankAccountName}</span>` : ''}
      ${s.bankName ? `<span class="lbl">Bank</span><span class="val">${s.bankName}</span>` : ''}
      ${s.bankAccountNumber ? `<span class="lbl">Account Number</span><span class="val">${s.bankAccountNumber}</span>` : ''}
      ${s.bankBranchCode ? `<span class="lbl">Branch Code</span><span class="val">${s.bankBranchCode}</span>` : ''}
      ${s.bankAccountType ? `<span class="lbl">Account Type</span><span class="val">${s.bankAccountType}</span>` : ''}
    </div>
  </div>` : ''}

  <!-- NOTES -->
  ${invoice.notes || invoice.messageOnInvoice ? `
  <div class="notes">
    <h4>Notes</h4>
    <p>${invoice.notes || invoice.messageOnInvoice || ''}</p>
  </div>` : ''}

  <div class="footer">Thank you for your business!</div>
</div>
</body>
</html>`);
}

/**
 * Generate HTML for quotation printing/preview
 */
export function generateQuotationHTML(quotation: Quotation, s: SalesSettings = DEFAULT_SALES_SETTINGS): string {
  const color = s.primaryColor || '#2563eb';

  return cleanEmailHtml(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Quotation ${quotation.quotationNumber}</title>
  <style>${getStyles(color)}</style>
</head>
<body>
<div class="page">

  <!-- TOP HEADER -->
  <div class="top-header">
    <div class="logo-block">
      ${s.logoUrl ? `<img src="${s.logoUrl}" alt="Logo" />` : `<div class="company-name">${s.companyName || 'Your Company'}</div>`}
    </div>
    <div class="company-info">
      <strong>${s.companyName || ''}</strong>
      ${s.companyAddress ? `${s.companyAddress}<br/>` : ''}
      ${s.companyCity ? `${s.companyCity}, ${s.companyProvince || ''} ${s.companyPostalCode || ''}<br/>` : ''}
      ${s.companyPhone ? `${s.companyPhone}<br/>` : ''}
      ${s.companyEmail ? `${s.companyEmail}<br/>` : ''}
      ${s.companyWebsite ? `${s.companyWebsite}<br/>` : ''}
      <span class="company-reg">
        ${s.vatRegistrationNumber ? `VAT Registration No. ${s.vatRegistrationNumber}` : ''}
        ${s.vatRegistrationNumber && s.businessRegistrationNumber ? ' &nbsp;|&nbsp; ' : ''}
        ${s.businessRegistrationNumber ? `Business ID No. ${s.businessRegistrationNumber}` : ''}
      </span>
    </div>
  </div>

  <!-- TITLE BAND -->
  <div class="title-band">
    <h1>QUOTATION</h1>
    <div class="inv-meta">
      <div>QUOTE NO. <strong>${quotation.quotationNumber}</strong></div>
      <div>DATE ${fmtDate(quotation.createdAt)}</div>
      <div>VALID UNTIL ${fmtDate(quotation.validUntil)}</div>
    </div>
  </div>

  <!-- PREPARED FOR -->
  <div class="addresses">
    <div class="addr-box">
      <h4>Prepared For</h4>
      <p>
        ${quotation.customerCompanyName ? `<strong>${quotation.customerCompanyName}</strong><br/>` : ''}
        ${quotation.customerContactName ? `${quotation.customerContactName}<br/>` : `<strong>${quotation.customerName}</strong><br/>`}
        ${quotation.billingAddress?.street ? quotation.billingAddress.street + '<br/>' : ''}
        ${quotation.billingAddress?.city ? quotation.billingAddress.city + (quotation.billingAddress.state ? ', ' + quotation.billingAddress.state : '') + '<br/>' : ''}
        ${quotation.billingAddress?.postalCode ? quotation.billingAddress.postalCode + '<br/>' : ''}
        ${quotation.customerEmail ? quotation.customerEmail + '<br/>' : ''}
        ${quotation.customerPhone ? quotation.customerPhone + '<br/>' : ''}
        ${quotation.customerAccountNumber ? '<span style="font-size:11px;color:#666">Account: </span>' + quotation.customerAccountNumber : ''}
      </p>
    </div>
    <div class="addr-box"></div>
    <div class="addr-box"></div>
  </div>

  <!-- LINE ITEMS -->
  <table class="items-table">
    <thead>
      <tr>
        <th>DESCRIPTION</th>
        <th class="right">QTY</th>
        <th class="right">RATE</th>
        <th class="right">AMOUNT</th>
      </tr>
    </thead>
    <tbody>
      ${quotation.items.map(item => `
        <tr>
          <td>
            ${item.productName}
            ${item.description ? `<div class="desc">${item.description}</div>` : ''}
            ${item.sku ? `<div class="desc">SKU: ${item.sku}</div>` : ''}
          </td>
          <td class="right">${item.quantity}</td>
          <td class="right">${fmt(item.price)}</td>
          <td class="right">${fmt(item.total)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <!-- TOTALS -->
  <div class="totals-wrap">
    <div class="totals-box">
      <div class="totals-row subtotal">
        <span>SUBTOTAL</span><span>${fmt(quotation.subtotal)}</span>
      </div>
      ${quotation.discountAmount && quotation.discountAmount > 0 ? `
      <div class="totals-row">
        <span>DISCOUNT (${quotation.discountPercent || 0}%)</span><span>-${fmt(quotation.discountAmount)}</span>
      </div>` : ''}
      ${(quotation.taxRate ?? 0) > 0 ? `<div class="totals-row tax"><span>VAT (${quotation.taxRate}%)</span><span>${fmt(quotation.tax)}</span></div>` : ''}
      <div class="totals-row total">
        <span>TOTAL</span><span>${fmt(quotation.total)}</span>
      </div>
      ${(quotation.deposit || 0) > 0 ? `
      <div class="totals-row paid-row">
        <span>DEPOSIT</span><span>${fmt(quotation.deposit)}</span>
      </div>
      <div class="totals-row balance">
        <span>BALANCE DUE</span><span>${fmt((quotation.total || 0) - (quotation.deposit || 0))}</span>
      </div>` : ''}
    </div>
  </div>

  <!-- VALIDITY NOTICE -->
  <div style="background:#fef3c7;border:1px solid #f59e0b;padding:12px 16px;border-radius:6px;text-align:center;font-size:13px;margin-bottom:20px;">
    This quotation is valid until <strong>${fmtDate(quotation.validUntil)}</strong>
  </div>

  <!-- TERMS / NOTES -->
  ${quotation.terms || quotation.notes ? `
  <div class="notes">
    ${quotation.terms ? `<h4>Terms &amp; Conditions</h4><p>${quotation.terms}</p>` : ''}
    ${quotation.notes ? `<p style="margin-top:6px">${quotation.notes}</p>` : ''}
  </div>` : ''}

  <!-- BANKING DETAILS -->
  ${s.bankName || s.bankAccountNumber ? `
  <div class="banking">
    <h4>Banking Details</h4>
    <div class="banking-grid">
      ${s.bankAccountName ? `<span class="lbl">Account Name</span><span class="val">${s.bankAccountName}</span>` : ''}
      ${s.bankName ? `<span class="lbl">Bank</span><span class="val">${s.bankName}</span>` : ''}
      ${s.bankAccountNumber ? `<span class="lbl">Account Number</span><span class="val">${s.bankAccountNumber}</span>` : ''}
      ${s.bankBranchCode ? `<span class="lbl">Branch Code</span><span class="val">${s.bankBranchCode}</span>` : ''}
    </div>
  </div>` : ''}

  <div class="footer">Thank you for considering our services!</div>
</div>
</body>
</html>`);
}

/**
 * Print invoice - loads sales settings first
 */
export async function printInvoice(invoice: Invoice, workspaceId?: string): Promise<void> {
  let s = DEFAULT_SALES_SETTINGS;
  if (workspaceId) {
    s = await loadSalesSettings(workspaceId);
  }
  const html = generateInvoiceHTML(invoice, s);
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); }
}

/**
 * Preview invoice - loads sales settings first
 */
export async function previewInvoice(invoice: Invoice, workspaceId?: string): Promise<void> {
  let s = DEFAULT_SALES_SETTINGS;
  if (workspaceId) {
    s = await loadSalesSettings(workspaceId);
  }
  const html = generateInvoiceHTML(invoice, s);
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

/**
 * Print quotation - loads sales settings first
 */
export async function printQuotation(quotation: Quotation, workspaceId?: string): Promise<void> {
  let s = DEFAULT_SALES_SETTINGS;
  if (workspaceId) {
    s = await loadSalesSettings(workspaceId);
  }
  const html = generateQuotationHTML(quotation, s);
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); }
}

/**
 * Preview quotation - loads sales settings first
 */
export async function previewQuotation(quotation: Quotation, workspaceId?: string): Promise<void> {
  let s = DEFAULT_SALES_SETTINGS;
  if (workspaceId) {
    s = await loadSalesSettings(workspaceId);
  }
  const html = generateQuotationHTML(quotation, s);
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

/**
 * Get invoice download URL for WhatsApp attachment
 * Returns null for now - PDF generation can be implemented later
 */
export function getInvoiceDownloadURL(invoice: Invoice): string | null {
  // TODO: Generate and upload actual invoice PDF to cloud storage
  // For now, WhatsApp messages will send without PDF attachment
  return null;
}

/**
 * Shared: parse a full HTML document string, inject .page + styles into the
 * main document (so html2canvas can render it), generate a PDF Blob, then clean up.
 */
async function renderHTMLToPDFBlob(html: string): Promise<Blob> {
  const html2pdf = (await import('html2pdf.js')).default;

  // DOMParser keeps styles/layout intact and puts the element in the main document
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const page = parsed.querySelector('.page')!.cloneNode(true) as HTMLElement;
  const styleText = Array.from(parsed.querySelectorAll('style'))
    .map(s => s.textContent || '')
    .join('\n');

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:absolute;left:-9999px;top:0;width:210mm;';
  const styleEl = document.createElement('style');
  styleEl.textContent = styleText;
  wrapper.appendChild(styleEl);
  wrapper.appendChild(page);
  document.body.appendChild(wrapper);

  try {
    const blob: Blob = await html2pdf()
      .set({
        margin: [8, 8, 8, 8],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(page)
      .output('blob');
    return blob;
  } finally {
    document.body.removeChild(wrapper);
  }
}

/**
 * Generate invoice PDF as a Blob (for upload / email attachment)
 */
export async function generateInvoicePDFBlob(invoice: Invoice, s: SalesSettings = DEFAULT_SALES_SETTINGS): Promise<Blob> {
  return renderHTMLToPDFBlob(generateInvoiceHTML(invoice, s));
}

/**
 * Generate quotation PDF as a Blob (for upload / email attachment)
 */
export async function generateQuotationPDFBlob(quotation: Quotation, s: SalesSettings = DEFAULT_SALES_SETTINGS): Promise<Blob> {
  return renderHTMLToPDFBlob(generateQuotationHTML(quotation, s));
}

/**
 * Generate invoice as base64 PDF string (kept for compatibility)
 */
export async function generateInvoicePDFBase64(invoice: Invoice, s: SalesSettings = DEFAULT_SALES_SETTINGS): Promise<string> {
  const blob = await generateInvoicePDFBlob(invoice, s);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Generate quotation as base64 PDF string (kept for compatibility)
 */
export async function generateQuotationPDFBase64(quotation: Quotation, s: SalesSettings = DEFAULT_SALES_SETTINGS): Promise<string> {
  const blob = await generateQuotationPDFBlob(quotation, s);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Download HTML as a PDF file using html2pdf.js
 */
async function downloadAsPdf(html: string, filename: string): Promise<void> {
  const blob = await renderHTMLToPDFBlob(html);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download invoice as a PDF file (no WhatsApp)
 */
export async function downloadInvoice(invoice: Invoice, workspaceId?: string): Promise<void> {
  let s = DEFAULT_SALES_SETTINGS;
  if (workspaceId) {
    s = await loadSalesSettings(workspaceId);
  }
  const html = generateInvoiceHTML(invoice, s);
  const filename = `Invoice-${invoice.invoiceNumber}.pdf`;
  await downloadAsPdf(html, filename);
}

/**
 * Send invoice via WhatsApp:
 * 1. Downloads the invoice as a PDF
 * 2. Opens WhatsApp Web so user can choose the chat and attach the PDF
 */
export async function sendInvoiceViaWhatsApp(invoice: Invoice, workspaceId?: string): Promise<void> {
  let s = DEFAULT_SALES_SETTINGS;
  if (workspaceId) {
    s = await loadSalesSettings(workspaceId);
  }

  const html = generateInvoiceHTML(invoice, s);
  const filename = `Invoice-${invoice.invoiceNumber}.pdf`;

  await downloadAsPdf(html, filename);

  // Small delay to let the download start, then open WhatsApp Web
  setTimeout(() => {
    window.open('https://web.whatsapp.com/', '_blank');
  }, 800);
}

/**
 * Download quotation as a PDF file (no WhatsApp)
 */
export async function downloadQuotation(quotation: Quotation, workspaceId?: string): Promise<void> {
  let s = DEFAULT_SALES_SETTINGS;
  if (workspaceId) {
    s = await loadSalesSettings(workspaceId);
  }
  const html = generateQuotationHTML(quotation, s);
  const filename = `Quotation-${quotation.quotationNumber}.pdf`;
  await downloadAsPdf(html, filename);
}

/**
 * Send quotation via WhatsApp:
 * 1. Downloads the quotation as a PDF
 * 2. Opens WhatsApp Web so user can choose the chat and attach the PDF
 */
export async function sendQuotationViaWhatsApp(quotation: Quotation, workspaceId?: string): Promise<void> {
  let s = DEFAULT_SALES_SETTINGS;
  if (workspaceId) {
    s = await loadSalesSettings(workspaceId);
  }

  const html = generateQuotationHTML(quotation, s);
  const filename = `Quotation-${quotation.quotationNumber}.pdf`;

  await downloadAsPdf(html, filename);

  // Small delay to let the download start, then open WhatsApp Web
  setTimeout(() => {
    window.open('https://web.whatsapp.com/', '_blank');
  }, 800);
}

// ─────────────────────────────────────────────────────────────────────────────
// FAULT REPORT
// ─────────────────────────────────────────────────────────────────────────────

export interface FaultReportData {
  jobNumber: string;
  jobTitle: string;
  customerName: string;
  customerPhone: string;
  deviceBrand: string;
  deviceModel: string;
  serialNum: string;
  faultReported: string;
  technician: string;
  dateReceived: string;
  deposit: string;
  repairCost: string;
  testsPerformed: string[];
  visualFindings: string;
  diagnosisFault: string;
  faultStage: string;
  rootCause: string;
  componentsTested: string;
  componentsReplaced: string;
  repairCarriedOut: string;
  postRepairTests: string;
  outcome: string;
  recommendations: string;
  generatedAt: string;
}

export function generateFaultReportHTML(d: FaultReportData, s: SalesSettings = DEFAULT_SALES_SETTINGS): string {
  const color = s.primaryColor || '#1a1a2e';
  const fd = (ts: string) => { try { return new Date(ts).toLocaleDateString('en-ZA'); } catch { return ts; } };
  const row = (label: string, value: string, full = false) => value ? `
    <tr>
      <td class="lbl">${label}</td>
      <td class="${full ? 'val-full' : 'val'}">${value}</td>
    </tr>` : '';
  const section = (title: string, content: string) => `
    <div class="section">
      <div class="section-title">${title}</div>
      ${content}
    </div>`;

  const outcomeBg: Record<string, string> = {
    'Successfully Repaired': '#d1fae5',
    'Partially Repaired': '#fef3c7',
    'Unrepairable': '#fee2e2',
    'Pending Parts': '#dbeafe',
    'Customer Declined Repair': '#f3f4f6',
  };
  const outcomeColor: Record<string, string> = {
    'Successfully Repaired': '#065f46',
    'Partially Repaired': '#92400e',
    'Unrepairable': '#991b1b',
    'Pending Parts': '#1e40af',
    'Customer Declined Repair': '#374151',
  };
  const obg = outcomeBg[d.outcome] || '#f3f4f6';
  const oc = outcomeColor[d.outcome] || '#374151';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>Fault Report – ${d.jobNumber}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, sans-serif; font-size:13px; color:#222; background:#fff; }
.page { max-width:850px; margin:0 auto; padding:36px 40px; }
.top-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; }
.logo-block .company-name { font-size:18px; font-weight:bold; color:${color}; }
.company-info { font-size:12px; line-height:1.7; color:#444; text-align:right; }
.company-info strong { color:#222; font-size:13px; display:block; }
.title-band { background:${color}; color:#fff; padding:10px 18px; display:flex; justify-content:space-between; align-items:center; border-radius:4px; margin-bottom:20px; }
.title-band h1 { font-size:20px; letter-spacing:2px; font-weight:bold; }
.title-band .meta { text-align:right; font-size:12px; line-height:1.8; }
.title-band .meta strong { font-size:14px; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
.info-box { border:1px solid #e5e7eb; border-radius:6px; overflow:hidden; }
.info-box .box-title { background:#f3f4f6; font-size:11px; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; color:#555; padding:6px 12px; border-bottom:1px solid #e5e7eb; }
table.props { width:100%; border-collapse:collapse; }
table.props td { padding:6px 12px; font-size:12px; border-bottom:1px solid #f0f0f0; vertical-align:top; }
table.props td.lbl { color:#777; width:40%; white-space:nowrap; }
table.props td.val { color:#222; font-weight:500; }
table.props td.val-full { color:#222; }
table.props tr:last-child td { border-bottom:none; }
.section { margin-bottom:16px; border:1px solid #e5e7eb; border-radius:6px; overflow:hidden; }
.section-title { background:${color}; color:#fff; font-size:12px; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; padding:6px 14px; }
.section-body { padding:10px 14px; font-size:12px; line-height:1.7; color:#333; white-space:pre-wrap; }
.section-body.empty { color:#999; font-style:italic; }
.chips { display:flex; flex-wrap:wrap; gap:6px; padding:10px 14px; }
.chip { background:#e5e7eb; color:#374151; font-size:11px; padding:3px 10px; border-radius:99px; font-weight:500; }
.outcome-band { border-radius:6px; padding:12px 18px; display:flex; align-items:center; gap:10px; margin-bottom:16px; background:${obg}; color:${oc}; font-weight:bold; font-size:15px; }
.footer { margin-top:24px; border-top:1px solid #e5e7eb; padding-top:12px; text-align:center; font-size:11px; color:#aaa; }
@media print { body { margin:0; } .page { padding:20px 24px; } }
</style>
</head><body><div class="page">

<!-- HEADER -->
<div class="top-header">
  <div class="logo-block">
    ${s.logoUrl ? `<img src="${s.logoUrl}" alt="logo" style="max-height:60px;max-width:180px;object-fit:contain;display:block;margin-bottom:4px;" />` : ''}
    <div class="company-name">${s.companyName || 'Company'}</div>
  </div>
  <div class="company-info">
    <strong>${s.companyName || ''}</strong>
    ${s.address ? s.address.replace(/\n/g, '<br/>') : ''}
    ${s.phone ? `<br/>${s.phone}` : ''}
    ${s.email ? `<br/>${s.email}` : ''}
    ${s.vatNumber ? `<br/>VAT No. ${s.vatNumber}` : ''}
  </div>
</div>

<!-- TITLE BAND -->
<div class="title-band">
  <h1>FAULT ASSESSMENT REPORT</h1>
  <div class="meta">
    <div>JOB NO. <strong>${d.jobNumber}</strong></div>
    <div>DATE RECEIVED ${fd(d.dateReceived)}</div>
    <div>REPORT GENERATED ${fd(d.generatedAt)}</div>
  </div>
</div>

<!-- JOB + CUSTOMER INFO -->
<div class="grid2">
  <div class="info-box">
    <div class="box-title">Device Information</div>
    <table class="props">
      ${row('Description', d.jobTitle)}
      ${row('Brand', d.deviceBrand)}
      ${row('Model', d.deviceModel)}
      ${row('Serial No.', d.serialNum)}
    </table>
  </div>
  <div class="info-box">
    <div class="box-title">Customer Information</div>
    <table class="props">
      ${row('Name', d.customerName)}
      ${row('Phone', d.customerPhone)}
      ${row('Technician', d.technician)}
      ${row('Deposit Paid', d.deposit ? `R${parseFloat(d.deposit).toFixed(2)}` : '')}
      ${row('Repair Cost', d.repairCost ? `R${parseFloat(d.repairCost).toFixed(2)}` : '')}
    </table>
  </div>
</div>

<!-- FAULT REPORTED -->
${d.faultReported ? section('Fault Reported by Customer', `<div class="section-body">${d.faultReported}</div>`) : ''}

<!-- TESTS -->
${d.testsPerformed.length ? section('Tests Performed', `<div class="chips">${d.testsPerformed.map(t => `<span class="chip">${t}</span>`).join('')}</div>`) : ''}

<!-- VISUAL -->
${section('Visual Inspection Findings', `<div class="section-body${!d.visualFindings ? ' empty' : ''}">${d.visualFindings || 'Not recorded'}</div>`)}

<!-- DIAGNOSIS -->
${section('Fault Diagnosis', `<div class="section-body${!d.diagnosisFault ? ' empty' : ''}">${d.diagnosisFault || 'Not recorded'}</div>`)}

<!-- FAULT LOCATION + ROOT CAUSE -->
<div class="grid2">
  <div class="info-box">
    <div class="box-title">Fault Location / Stage</div>
    <table class="props"><tr><td class="val" style="padding:10px 14px">${d.faultStage || '—'}</td></tr></table>
  </div>
  <div class="info-box">
    <div class="box-title">Root Cause</div>
    <table class="props"><tr><td class="val" style="padding:10px 14px">${d.rootCause || '—'}</td></tr></table>
  </div>
</div>

<!-- COMPONENTS -->
${d.componentsTested ? section('Components Tested', `<div class="section-body">${d.componentsTested}</div>`) : ''}
${d.componentsReplaced ? section('Components Replaced', `<div class="section-body">${d.componentsReplaced}</div>`) : ''}

<!-- REPAIR -->
${section('Repair Carried Out', `<div class="section-body${!d.repairCarriedOut ? ' empty' : ''}">${d.repairCarriedOut || 'Not recorded'}</div>`)}

<!-- POST REPAIR -->
${d.postRepairTests ? section('Post-Repair Test Results', `<div class="section-body">${d.postRepairTests}</div>`) : ''}

<!-- OUTCOME -->
${d.outcome ? `<div class="outcome-band">✅ Outcome: ${d.outcome}</div>` : ''}

<!-- RECOMMENDATIONS -->
${d.recommendations ? section('Recommendations & Notes', `<div class="section-body">${d.recommendations}</div>`) : ''}

<div class="footer">This report was generated by ${s.companyName || 'ShopFlowz'} — ${new Date(d.generatedAt).toLocaleString('en-ZA')}</div>
</div></body></html>`;
}
