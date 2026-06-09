/**
 * Ecommerce Bot Service
 *
 * Public-facing customer support chat with a hybrid brain:
 *  1. Quick-reply buttons (instant, free)
 *  2. Q&A keyword match against the admin-trained library (instant, free)
 *  3. Live product search in inventory (instant, free)
 *  4. LLM fallback via the existing ai-proxy in "ecommerce" mode — used for
 *     paraphrased questions AND for suggesting in-stock equivalents when the
 *     customer asks for a part we don't have.
 *
 * Settings live in workspace_settings(category='ecommerce_bot'). The bot brain
 * is intentionally split across two layers (rules first, LLM only on miss) so
 * common questions stay cheap and predictable, and the LLM is reserved for the
 * cases where it genuinely adds value (equivalent parts, fuzzy intent).
 */

import { supabase } from "@/lib/supabase";

export interface BotQuickButton {
  id: string;
  label: string;
  answer: string;
}

export interface BotQAEntry {
  id: string;
  title: string;          // admin-only label, e.g. "Refund requests"
  questions: string[];    // alternative phrasings of the question
  answer: string;         // can include simple markdown — rendered as text + links
}

export interface EcommerceBotSettings {
  enabled: boolean;
  bot_name: string;
  welcome_message: string;
  quick_buttons: BotQuickButton[];
  qa_entries: BotQAEntry[];
  fallback_message: string;

  // Per-layer kill switches. Each layer in the decision tree can be turned
  // on/off independently so the admin can isolate behaviour without
  // disabling the whole bot.
  enable_quick_buttons: boolean;
  enable_qa: boolean;
  enable_product_search: boolean;
  enable_llm_fallback: boolean;       // general LLM fallback for paraphrased Qs

  llm_system_prompt?: string;         // override the default system prompt
}

export const DEFAULT_BOT_SETTINGS: EcommerceBotSettings = {
  enabled: false,
  bot_name: "Sammy",
  welcome_message: "Hi! I'm Sammy, your store assistant. How can I help?",
  quick_buttons: [
    { id: "qb_hours", label: "Opening hours", answer: "Please contact us for our current trading hours." },
    { id: "qb_location", label: "Where are you?", answer: "Please contact us for our location details." },
    { id: "qb_payment", label: "How can I pay?", answer: "We accept EFT, card payments and cash at the store. Online orders are paid via iKhokha (card / instant EFT)." },
    { id: "qb_shipping", label: "Do you ship?", answer: "Yes — we ship countrywide. Contact us for more shipping details." },
  ],
  qa_entries: [
    {
      id: "qa_returns",
      title: "Returns & warranty",
      questions: ["How do I return an item?", "What's your return policy?", "Can I get a refund?", "Item is faulty"],
      answer: "Faulty items can be returned within 7 days with proof of purchase. We test, repair or replace at our discretion. Contact us using the details on our store page to start a return.",
    },
    {
      id: "qa_contact",
      title: "Contact us",
      questions: ["How do I contact you?", "What's your number?", "Phone", "Email"],
      answer: "Please use the contact details on our store page to reach us.",
    },
    {
      id: "qa_repair",
      title: "Repair services",
      questions: ["Do you repair speakers?", "Can you fix amps?", "Do you do audio repairs?"],
      answer: "Yes — we repair speakers, amps and most audio gear. Bring the unit to the shop or WhatsApp us a description for a quote.",
    },
  ],
  fallback_message: "I'm not sure about that one. Please contact us using the details on our store page and we'll help right away.",
  enable_quick_buttons: true,
  enable_qa: true,
  enable_product_search: true,
  enable_llm_fallback: true,
};

// ─── Settings I/O ──────────────────────────────────────────────────────────

export async function loadEcommerceBotSettings(workspaceId: string): Promise<EcommerceBotSettings | null> {
  try {
    const { data } = await supabase
      .from("workspace_settings")
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("category", "ecommerce_bot")
      .maybeSingle();
    if (!data?.data) return null;
    return { ...DEFAULT_BOT_SETTINGS, ...(data.data as Partial<EcommerceBotSettings>) };
  } catch (err) {
    console.error("[ecommerceBotService] load failed:", err);
    return null;
  }
}

export async function saveEcommerceBotSettings(
  workspaceId: string,
  settings: EcommerceBotSettings,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("workspace_settings")
      .upsert(
        { workspace_id: workspaceId, category: "ecommerce_bot", data: settings as unknown as Record<string, unknown> },
        { onConflict: "workspace_id,category" },
      );
    if (error) {
      console.error("[ecommerceBotService] save error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[ecommerceBotService] save threw:", err);
    return false;
  }
}

// ─── Matching engine ───────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "is", "are",
  "i", "me", "my", "you", "your", "do", "does", "did", "have", "has", "had",
  "what", "where", "when", "how", "why", "can", "could", "would", "will",
  "be", "for", "with", "this", "that", "it", "its",
]);

function tokenise(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

function scoreEntry(entry: BotQAEntry, tokens: string[]): number {
  if (!entry.questions || entry.questions.length === 0) return 0;
  const tokenSet = new Set(tokens);
  let best = 0;
  for (const q of entry.questions) {
    const qTokens = tokenise(q);
    if (qTokens.length === 0) continue;
    let matches = 0;
    for (const qt of qTokens) {
      if (tokenSet.has(qt)) matches += qt.length >= 4 ? 1.2 : 1;
    }
    // Normalise so very long stored questions don't unfairly outrank short ones
    const score = matches / Math.max(1, Math.sqrt(qTokens.length));
    if (score > best) best = score;
  }
  return best;
}

/**
 * Best Q&A match. Returns the highest-scoring entry whose score crosses a
 * minimum threshold. Threshold is intentionally loose (0.4) since admins can
 * always add more phrasings of common questions to improve recall.
 */
export function findBestQA(
  message: string,
  settings: EcommerceBotSettings,
): { entry: BotQAEntry; score: number } | null {
  const tokens = tokenise(message);
  if (tokens.length === 0) return null;

  let best: { entry: BotQAEntry; score: number } | null = null;
  for (const entry of settings.qa_entries) {
    const score = scoreEntry(entry, tokens);
    if (score > 0 && (!best || score > best.score)) best = { entry, score };
  }
  if (!best || best.score < 0.4) return null;
  return best;
}

// ─── Inventory helpers (live product search + part-query detection) ────────

export interface BotProductResult {
  id: string;
  name: string;
  sku: string;
  price: number;
  imageUrl?: string;
  quantity: number;
  category?: string;
}

/**
 * Search inventory for matching products. Reads the same `inventory` table
 * the public store uses. Returns up to `limit` active items where name, sku
 * or category contains the query (case-insensitive).
 */
export async function searchProducts(
  workspaceId: string,
  query: string,
  limit = 5,
): Promise<BotProductResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  try {
    // Page through inventory rather than relying on an undefined order +
    // 800-row limit (which silently missed matches further down the table).
    // Capped at 4000 rows to bound memory; 1.9k items is well within that.
    const PAGE = 1000;
    const MAX = 4000;
    let from = 0;
    const all: any[] = [];
    while (all.length < MAX) {
      const { data, error } = await supabase
        .from("inventory")
        .select("id, data")
        .eq("workspace_id", workspaceId)
        .range(from, from + PAGE - 1);
      if (error) break;
      const batch = data || [];
      all.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }

    const lower = trimmed.toLowerCase();
    return all
      .map((r: any) => ({ id: r.id, ...(r.data || {}) }))
      .filter((p: any) => (p.status ?? "active") === "active")
      .filter((p: any) => {
        const name = String(p.name || "").toLowerCase();
        const sku = String(p.sku || "").toLowerCase();
        const cat = String(p.category || "").toLowerCase();
        return name.includes(lower) || sku.includes(lower) || cat.includes(lower);
      })
      .slice(0, limit)
      .map((p: any) => ({
        id: p.id,
        name: p.name || p.sku || "Product",
        sku: p.sku || "",
        price: Number(p.price ?? p.unitPrice ?? 0),
        imageUrl: p.imageUrl || p.images?.[0]?.url,
        quantity: Number(p.quantity ?? 0),
        category: p.category,
      }));
  } catch (err) {
    console.error("[ecommerceBotService] product search failed:", err);
    return [];
  }
}

/**
 * Fetch a compact, LLM-friendly snapshot of in-stock parts in a given category
 * (or all categories). Used as grounding for the general LLM fallback so the
 * model can reference what's actually available when answering paraphrased
 * questions like "do you have anything for fixing speakers?".
 */
export async function fetchInStockSnapshot(
  workspaceId: string,
  category: string | null,
  limit = 80,
): Promise<Array<{ name: string; sku: string; price: number; quantity: number; category?: string }>> {
  try {
    const { data } = await supabase
      .from("inventory")
      .select("data")
      .eq("workspace_id", workspaceId)
      .limit(2000);
    return (data || [])
      .map((r: any) => r.data || {})
      .filter((p: any) => (p.status ?? "active") === "active" && Number(p.quantity ?? 0) > 0)
      .filter((p: any) => !category || String(p.category || "").toLowerCase() === category.toLowerCase())
      .slice(0, limit)
      .map((p: any) => ({
        name: p.name || p.sku || "Unknown",
        sku: p.sku || "",
        price: Number(p.price ?? 0),
        quantity: Number(p.quantity ?? 0),
        category: p.category,
      }));
  } catch (err) {
    console.error("[ecommerceBotService] snapshot failed:", err);
    return [];
  }
}
