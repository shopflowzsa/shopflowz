import { supabase } from "@/lib/supabase";

export interface ExtractedSlipData {
  vendorName: string;
  slipNumber: string;
  date: string;            // YYYY-MM-DD
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  paymentMethod: "cash" | "card" | "eft" | "other";
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
  confidence: number;       // 0-100
}

export interface AiOcrResult {
  success: boolean;
  data?: ExtractedSlipData;
  model?: string;
  raw?: string;
  error?: string;
}

/**
 * Compress an image File to fit within NVIDIA's inline image payload limit.
 * Resizes to max 1024px on the long edge and encodes JPEG at 70% quality.
 * NVIDIA's vision endpoint accepts base64 images up to ~180KB; we aim for ~140KB
 * to leave headroom for the JSON envelope.
 */
async function compressToDataUrl(file: File, maxBytes = 140_000): Promise<string> {
  const img = await loadImage(file);
  // Start with max 1024 long-edge and reduce until we fit
  let maxEdge = 1024;
  let quality = 0.75;
  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    // base64 length × 0.75 ≈ bytes
    const bytes = Math.floor((dataUrl.length - "data:image/jpeg;base64,".length) * 0.75);
    if (bytes <= maxBytes) return dataUrl;
    // Tighten — shrink dimensions first, then quality
    if (attempt < 2) maxEdge = Math.round(maxEdge * 0.8);
    else quality = Math.max(0.4, quality - 0.15);
  }
  // Final fallback — return whatever we have
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 640 / Math.max(img.width, img.height));
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.5);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
  });
}

export async function extractSlipWithAi(
  workspaceId: string,
  file: File,
  onProgress?: (stage: string, percent: number) => void,
): Promise<AiOcrResult> {
  try {
    onProgress?.("preparing", 10);
    const dataUrl = await compressToDataUrl(file);
    onProgress?.("uploading", 50);

    const { data, error } = await supabase.functions.invoke("ocr-extract", {
      body: { workspace_id: workspaceId, image_data_url: dataUrl },
    });

    if (error) {
      const detail = (error as any)?.context?.body ?? (error as any)?.message ?? String(error);
      return { success: false, error: typeof detail === "string" ? detail : JSON.stringify(detail) };
    }
    if (data?.error) return { success: false, error: data.error };
    if (!data?.data) return { success: false, error: "Empty response from OCR service" };

    onProgress?.("done", 100);
    return { success: true, data: data.data as ExtractedSlipData, model: data.model_used, raw: data.raw };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown OCR error" };
  }
}
