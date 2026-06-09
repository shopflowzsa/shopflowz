// Registry of ecommerce payment methods shown in the store's Payment settings.
//
// `status`:
//   • "live"  — fully wired into checkout today (payment actually processes).
//   • "setup" — configurable now (credentials saved), but the checkout
//                integration is still being wired. Shown with a "Setup pending"
//                badge so clients aren't misled into thinking it's processing.

export type PaymentProviderKey =
  | "ikhokha" | "cash" | "payfast" | "yoco" | "stripe" | "eft" | "ozow" | "snapscan";

export interface PaymentField {
  key: string;
  label: string;
  secret?: boolean;     // render as a password input
  multiline?: boolean;  // render as a textarea
  placeholder?: string;
}

export interface PaymentProvider {
  key: PaymentProviderKey;
  name: string;
  blurb: string;
  status: "live" | "setup";
  fields: PaymentField[];
}

export const PAYMENT_PROVIDERS: PaymentProvider[] = [
  {
    key: "ikhokha", name: "iKhokha", status: "live",
    blurb: "Card payments via iKhokha PayLinks. Already wired into your checkout.",
    fields: [
      { key: "appId", label: "App ID", placeholder: "IK91VB0TW4CJ…" },
      { key: "appSecret", label: "App Secret", secret: true },
    ],
  },
  {
    key: "cash", name: "Cash on Collection", status: "live",
    blurb: "Customer pays in cash when they collect their order. No gateway or fees.",
    fields: [],
  },
  {
    key: "eft", name: "EFT / Bank Transfer", status: "setup",
    blurb: "Customer pays by manual bank transfer and you confirm it. No gateway fees.",
    fields: [
      { key: "bankDetails", label: "Bank account details (shown to the customer at checkout)", multiline: true, placeholder: "Bank: …\nAccount name: …\nAccount no: …\nBranch code: …" },
    ],
  },
  {
    key: "payfast", name: "PayFast", status: "setup",
    blurb: "Popular South African gateway — cards, instant EFT, and more.",
    fields: [
      { key: "merchantId", label: "Merchant ID" },
      { key: "merchantKey", label: "Merchant Key", secret: true },
      { key: "passphrase", label: "Passphrase", secret: true },
    ],
  },
  {
    key: "yoco", name: "Yoco", status: "setup",
    blurb: "Card payments via Yoco.",
    fields: [
      { key: "publicKey", label: "Public Key" },
      { key: "secretKey", label: "Secret Key", secret: true },
    ],
  },
  {
    key: "stripe", name: "Stripe", status: "setup",
    blurb: "International card payments.",
    fields: [
      { key: "publicKey", label: "Publishable Key" },
      { key: "secretKey", label: "Secret Key", secret: true },
    ],
  },
  {
    key: "ozow", name: "Ozow", status: "setup",
    blurb: "Instant EFT — pay directly from a bank account.",
    fields: [
      { key: "siteCode", label: "Site Code" },
      { key: "privateKey", label: "Private Key", secret: true },
      { key: "apiKey", label: "API Key", secret: true },
    ],
  },
  {
    key: "snapscan", name: "SnapScan", status: "setup",
    blurb: "QR-code payments via the SnapScan app.",
    fields: [
      { key: "merchantId", label: "Snap Code / Merchant ID" },
      { key: "apiKey", label: "API Key", secret: true },
    ],
  },
];
