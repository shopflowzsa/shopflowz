import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { uploadImageToCloudinary } from "@/lib/cloudinaryService";

export interface ExpenseSlipLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface ExpenseSlip {
  id: string;
  vendorName: string;
  slipNumber: string;
  date: string;          // ISO date (YYYY-MM-DD)
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  category: string;
  paymentMethod: string; // "cash" | "card" | "eft" | "other"
  notes?: string;
  imageUrl?: string;     // public URL or data URL
  imagePath?: string;    // storage path if uploaded
  lineItems: ExpenseSlipLineItem[];
  rawOcrText?: string;
  ocrConfidence?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type ExpenseSlipInput = Omit<ExpenseSlip, "id" | "createdAt" | "updatedAt">;

function genId(): string {
  return `eslip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const expenseSlipService = {
  async list(workspaceId: string): Promise<ExpenseSlip[]> {
    const { data, error } = await supabase
      .from("expense_slips")
      .select("id, data, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[expenseSlipService.list] error", error);
      return [];
    }
    return (data || []).map((r: any) => ({
      id: r.id,
      ...(r.data || {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })) as ExpenseSlip[];
  },

  async create(workspaceId: string, input: ExpenseSlipInput): Promise<ExpenseSlip> {
    const id = genId();
    const now = new Date().toISOString();
    const payload = { ...input, createdAt: now, updatedAt: now };
    const { error } = await supabaseServiceRole
      .from("expense_slips")
      .insert({ id, workspace_id: workspaceId, data: payload });
    if (error) throw error;
    return { id, ...payload } as ExpenseSlip;
  },

  async update(id: string, patch: Partial<ExpenseSlipInput>): Promise<void> {
    const { data: existing } = await supabase
      .from("expense_slips")
      .select("data")
      .eq("id", id)
      .single();
    const merged = { ...(existing?.data || {}), ...patch, updatedAt: new Date().toISOString() };
    const { error } = await supabaseServiceRole
      .from("expense_slips")
      .update({ data: merged, updated_at: merged.updatedAt })
      .eq("id", id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabaseServiceRole.from("expense_slips").delete().eq("id", id);
    if (error) throw error;
  },

  async uploadImage(workspaceId: string, file: File): Promise<{ url: string; path: string } | null> {
    try {
      const url = await uploadImageToCloudinary(file, `expense-slips/${workspaceId}`);
      return { url, path: url };
    } catch (err) {
      console.warn("[expenseSlipService.uploadImage] cloudinary upload failed", err);
      return null;
    }
  },
};

export const EXPENSE_CATEGORIES = [
  "General Expenses",
  "Stock / Purchases",
  "Travel & Transport",
  "Fuel",
  "Utilities",
  "Rent & Lease",
  "Insurance",
  "Professional Services",
  "Marketing & Advertising",
  "Office Supplies",
  "Equipment & Tools",
  "Repairs & Maintenance",
  "Bank Charges",
  "Other",
];

export const PAYMENT_METHODS = ["cash", "card", "eft", "other"];
