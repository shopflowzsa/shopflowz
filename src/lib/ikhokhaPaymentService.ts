import { SUPABASE_URL,  SUPABASE_ANON_KEY } from "@/lib/supabase";

// Cloud Function endpoint — Using Supabase Edge Function for proper CORS support
// The Firebase Cloud Function blocks requests from custom domains (CORS issue)
// Supabase Edge Function handles CORS properly and proxies to iKhokha API
const PAYMENT_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/create-ecommerce-paylink`;

// Direct iKhokha API access (if Supabase function fails)
const IKHOKHA_API_URL = 'https://api.ikhokha.com/public-api/v1/api/payment';

// iKhokha API Configuration (public info only)
const IKHOKHA_CONFIG = {
  applicationId: 'IK91VB0TW4CJ2PJGUFGMGOKI2N5WEPI2',
  // Note: Application secret is stored securely in Firebase Functions, not exposed to client
};

export interface IKhokhaPaymentRequest {
  amount: number; // Amount in cents (e.g., 10000 = R100.00)
  currency: string; // 'ZAR'
  description?: string;
  externalTransactionID: string; // Your unique transaction ID
  externalEntityID?: string; // Optional account identifier
  callbackUrl: string;
  successPageUrl: string;
  failurePageUrl: string;
  cancelUrl?: string;
  orderData?: any; // Order data for ecommerce
}

export interface IKhokhaPaymentResponse {
  responseCode: string;
  message?: string;
  paylinkUrl?: string;
  paylinkID?: string;
  externalTransactionID?: string;
}

/**
 * Create a payment link with iKhokha (via Cloud Function for security)
 */
export async function createPaymentLink(
  workspaceId: string,
  paymentRequest: IKhokhaPaymentRequest
): Promise<IKhokhaPaymentResponse> {
  try {
    // First attempt: Use the Supabase function
    const response = await fetch(PAYMENT_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        workspaceId,
        ...paymentRequest,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('Error from Supabase function:', errorData);
      
      // Fallback to direct API access
      return createDirectPaymentLink(workspaceId, paymentRequest);
    }

    return await response.json() as IKhokhaPaymentResponse;
  } catch (error) {
    console.error('Error creating payment link via Supabase:', error);
    
    // Try direct API as fallback
    return createDirectPaymentLink(workspaceId, paymentRequest);
  }
}

/**
 * Direct iKhokha API access as fallback (if Supabase function fails)
 * NOTE: This requires credentials to be stored in local storage first using the "IK-Configure" page
 */
async function createDirectPaymentLink(
  workspaceId: string,
  paymentRequest: IKhokhaPaymentRequest
): Promise<IKhokhaPaymentResponse> {
  try {
    // Get credentials from localStorage (must be configured first via settings)
    const ikConfig = JSON.parse(localStorage.getItem('ikhokha-config') || '{}');
    
    if (!ikConfig.appId || !ikConfig.appSecret) {
      throw new Error('iKhokha credentials not found. Please configure via settings first.');
    }
    
    const { appId, appSecret } = ikConfig;
    
    // Create request body
    const requestBody = {
      entityID: appId,
      externalEntityID: workspaceId,
      amount: Math.round(paymentRequest.amount), // Must be in cents
      currency: paymentRequest.currency || 'ZAR',
      requesterUrl: window.location.origin,
      mode: 'live',
      description: paymentRequest.description || 'Online purchase',
      externalTransactionID: paymentRequest.externalTransactionID,
      urls: {
        callbackUrl: paymentRequest.callbackUrl,
        successPageUrl: paymentRequest.successPageUrl,
        failurePageUrl: paymentRequest.failurePageUrl,
        cancelUrl: paymentRequest.cancelUrl,
      },
    };
    
    // Generate signature (HMAC SHA-256)
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(appSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    // Create payload to sign
    const urlPath = new URL(IKHOKHA_API_URL).pathname;
    const payloadToSign = urlPath + JSON.stringify(requestBody).replace(/[\\"']/g, "\\$&").replace(/\u0000/g, "\\0");
    
    // Generate signature
    const signatureArray = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadToSign));
    const signature = Array.from(new Uint8Array(signatureArray))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
      
    // Make API request
    const response = await fetch(IKHOKHA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'IK-APP-ID': appId.trim(),
        'IK-SIGNATURE': signature.trim(),
      },
      body: JSON.stringify(requestBody),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Direct iKhokha API error:', data);
      throw new Error(`iKhokha API error: ${data.message || 'Unknown error'}`);
    }
    
    return data;
  } catch (error) {
    console.error('Error creating direct payment link:', error);
    throw error;
  }
}

/**
 * Create payment link for an invoice
 */
export async function createInvoicePaymentLink(
  workspaceId: string,
  invoiceId: string,
  invoiceNumber: string,
  totalAmount: number, // In rands
  customerName: string
): Promise<IKhokhaPaymentResponse> {
  const amountInCents = Math.round(totalAmount * 100);
  const baseUrl = window.location.origin;

  return createPaymentLink(workspaceId, {
    amount: amountInCents,
    currency: 'ZAR',
    description: `Invoice ${invoiceNumber} - ${customerName}`,
    externalTransactionID: `INV-${invoiceId}-${Date.now()}`,
    externalEntityID: workspaceId,
    callbackUrl: `https://omqqbinhevyuyfgqvkqk.supabase.co/functions/v1/ikhokha-webhook`,
    successPageUrl: `${baseUrl}/invoice/${invoiceId}/payment-success`,
    failurePageUrl: `${baseUrl}/invoice/${invoiceId}/payment-failed`,
    cancelUrl: `${baseUrl}/invoice/${invoiceId}`,
  });
}

/**
 * Create payment link for a quotation
 */
export async function createQuotationPaymentLink(
  workspaceId: string,
  quotationId: string,
  quotationNumber: string,
  totalAmount: number, // In rands
  customerName: string
): Promise<IKhokhaPaymentResponse> {
  const amountInCents = Math.round(totalAmount * 100);
  const baseUrl = window.location.origin;

  return createPaymentLink(workspaceId, {
    amount: amountInCents,
    currency: 'ZAR',
    description: `Quotation ${quotationNumber} - ${customerName}`,
    externalTransactionID: `QUOT-${quotationId}-${Date.now()}`,
    externalEntityID: workspaceId,
    callbackUrl: `https://omqqbinhevyuyfgqvkqk.supabase.co/functions/v1/ikhokha-webhook`,
    successPageUrl: `${baseUrl}/quotation/${quotationId}/payment-success`,
    failurePageUrl: `${baseUrl}/quotation/${quotationId}/payment-failed`,
    cancelUrl: `${baseUrl}/quotation/${quotationId}`,
  });
}

/**
 * Create payment link for an ecommerce order
 */
export async function createEcommercePaymentLink(
  workspaceId: string,
  orderId: string,
  totalAmount: number, // In rands (including VAT and delivery)
  customerName: string,
  customerEmail: string,
  customerPhone: string,
  customerAddress: string,
  orderDescription: string,
  cartItems: any[],
  userId?: string,
  deliveryOption?: 'pickup' | 'delivery',
  deliveryFee?: number
): Promise<IKhokhaPaymentResponse> {
  const amountInCents = Math.round(totalAmount * 100);
  const baseUrl = window.location.origin;

  // Order will be created by Cloud Function to avoid permission issues
  return createPaymentLink(workspaceId, {
    amount: amountInCents,
    currency: 'ZAR',
    description: `Order ${orderId} - ${orderDescription.substring(0, 100)}`,
    externalTransactionID: `ORDER-${orderId}`,
    externalEntityID: customerEmail,
    callbackUrl: `https://omqqbinhevyuyfgqvkqk.supabase.co/functions/v1/ikhokha-webhook`,
    successPageUrl: `${baseUrl}/store/order-success?orderId=${orderId}&workspaceId=${workspaceId}`,
    failurePageUrl: `${baseUrl}/store/order-failed?orderId=${orderId}`,
    cancelUrl: `${baseUrl}/store`,
    // Pass order data to Cloud Function to store
    orderData: {
      orderId,
      userId,
      customerName,
      customerEmail,
      customerPhone,
      address: customerAddress,
      items: cartItems,
      totalAmount,
      description: orderDescription,
      deliveryOption: deliveryOption || 'pickup',
      deliveryFee: deliveryFee || 0,
    },
  });
}
