export type WorkspaceRole = "owner" | "editor" | "guest";

// Menu permission keys for sidebar visibility control
export type MenuPermission =
  | "customers"
  | "quotations"
  | "invoices"
  | "inventory"
  | "banking"
  | "business_planning"
  | "analytics_business"
  | "analytics_staff"
  | "analytics_performance"
  | "whatsapp"
  | "printer"
  | "settings"
  | "tech_assessment"
  | "outstanding_repairs"
  | "tech_datasheets"
  | "job_registry"
  | "crm"
  | "warnings";

export const ALL_MENU_PERMISSIONS: MenuPermission[] = [
  "customers",
  "quotations",
  "invoices",
  "inventory",
  "banking",
  "business_planning",
  "analytics_business",
  "analytics_staff",
  "analytics_performance",
  "whatsapp",
  "printer",
  "settings",
  "tech_assessment",
  "outstanding_repairs",
  "tech_datasheets",
  "job_registry",
  "crm",
  "warnings",
];

export const MENU_PERMISSION_LABELS: Record<MenuPermission, string> = {
  customers: "Customers",
  quotations: "Quotations",
  invoices: "Invoices",
  inventory: "Inventory",
  banking: "Banking & Matching",
  business_planning: "Business Planning",
  analytics_business: "Analytics - Business",
  analytics_staff: "Analytics - Staff",
  analytics_performance: "Analytics - Performance",
  whatsapp: "WhatsApp",
  printer: "Printer",
  settings: "Settings",
  tech_assessment: "Tech Assessment",
  outstanding_repairs: "Outstanding Repairs",
  tech_datasheets: "Tech Data Sheets",
  job_registry: "Job Registry",
  crm: "CRM (Tasks & Folders)",
  warnings: "Warnings & Alerts",
};

export interface WorkspaceMember {
  uid: string;
  email: string;
  displayName?: string;
  role: WorkspaceRole;
  joinedAt: string;
  // Permissions for sidebar visibility
  permissions?: MenuPermission[];
}

export interface Invitation {
  id: string;
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
  workspaceId: string;
  invitedBy: string; // uid
  createdAt: string;
  status: "pending" | "accepted";
  permissions?: MenuPermission[]; // For guest invitations
}

export interface EmailServiceSettings {
  provider: "sendgrid" | "resend" | "mailgun" | "smtp";
  apiKey?: string;
  fromEmail?: string;
  fromName?: string;
  // SMTP specific
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure?: boolean; // SSL/TLS
  // IMAP/POP3 settings for email client configuration
  incomingServer?: string;
  imapPort?: number;
  imapSecure?: boolean;
  pop3Port?: number;
  pop3Secure?: boolean;
  useImap?: boolean; // true for IMAP, false for POP3
  enabled: boolean;
}

export interface AppUser {
  uid: string;
  email: string;
  displayName?: string;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  // CRM Access & Subscription
  plan?: string; // 'free' | 'starter' | 'growth' | 'pro'
  hasCrmAccess: boolean; // Can this workspace use CRM features?
  subscriptionStatus: 'trial' | 'active' | 'suspended' | 'expired' | 'none';
  subscriptionTier: 'none' | 'basic' | 'professional' | 'enterprise';
  trialEndsAt?: string;
  subscriptionEndsAt?: string;
  subscriptionExpiresAt?: string; // ISO date — when current paid plan expires
  monthlyPrice?: number;
  // Feature Toggles
  hiddenFeatures: string[]; // Features to hide: 'inventory', 'ecommerce', 'whatsapp', etc.
  // Branding (optional for white-label)
  brandName?: string;
  brandLogo?: string;
  // Ecommerce store
  storeSlug?: string;       // e.g. "audiocity" → shopflowz.web.app/store/audiocity
  storeEnabled?: boolean;
  customDomain?: string;    // e.g. "shop.audiocity.co.za"
  customDomainStatus?: 'none' | 'pending' | 'active';
  customDomainEnabled?: boolean; // ShopFlowz admin grants this per client workspace
}
