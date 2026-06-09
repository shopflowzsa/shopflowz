import { supabase } from "@/lib/supabase";

export interface SalesSettings {
  // Company Info
  companyName: string;
  companyAddress: string;
  companyCity: string;
  companyProvince: string;
  companyPostalCode: string;
  companyPhone: string;
  companyEmail: string;
  companyWebsite: string;
  // Tax
  vatRegistrationNumber: string;
  businessRegistrationNumber: string;
  // Banking Details
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankBranchCode: string;
  bankAccountType: string;
  // Invoice/Quote Defaults
  defaultPaymentTerms: string;
  defaultInvoiceNotes: string;
  defaultQuoteNotes: string;
  defaultVatRate: number;
  defaultVatEnabled: boolean;
  // Template
  logoUrl: string;
  primaryColor: string;
  // Numbering
  invoicePrefix: string;
  quotationPrefix: string;
}

export const DEFAULT_SALES_SETTINGS: SalesSettings = {
  companyName: '',
  companyAddress: '',
  companyCity: '',
  companyProvince: '',
  companyPostalCode: '',
  companyPhone: '',
  companyEmail: '',
  companyWebsite: '',
  vatRegistrationNumber: '',
  businessRegistrationNumber: '',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  bankBranchCode: '',
  bankAccountType: 'Current',
  defaultPaymentTerms: 'due-on-receipt',
  defaultInvoiceNotes: 'Thanks for your business.',
  defaultQuoteNotes: 'Thanks for your business.',
  defaultVatRate: 15,
  defaultVatEnabled: false,
  logoUrl: '',
  primaryColor: '#2563eb',
  invoicePrefix: 'INV',
  quotationPrefix: 'QUO',
};

export async function loadSalesSettings(workspaceId: string): Promise<SalesSettings> {
  try {
    const { data: row } = await supabase
      .from('workspace_settings')
      .select('data')
      .eq('workspace_id', workspaceId)
      .eq('category', 'sales')
      .maybeSingle();
    if (row?.data) {
      return { ...DEFAULT_SALES_SETTINGS, ...(row.data as any) } as SalesSettings;
    }
    return DEFAULT_SALES_SETTINGS;
  } catch (error) {
    console.error('Error loading sales settings:', error);
    return DEFAULT_SALES_SETTINGS;
  }
}

export async function saveSalesSettings(
  workspaceId: string,
  settings: SalesSettings,
  userId: string
): Promise<void> {
  try {
    await supabase
      .from('workspace_settings')
      .upsert(
        { workspace_id: workspaceId, category: 'sales', data: { ...settings, updatedBy: userId } },
        { onConflict: 'workspace_id,category' }
      );
  } catch (error) {
    console.error('Error saving sales settings:', error);
    throw error;
  }
}
