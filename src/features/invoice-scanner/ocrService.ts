/**
 * Invoice Scanner OCR Service
 * Uses Tesseract.js for client-side OCR processing
 * Isolated from main codebase
 */

import { ScannedInvoiceData, OCRResult } from './types';

// Tesseract.js import - dynamically loaded to reduce initial bundle size
let Tesseract: typeof import('tesseract.js').Tesseract | null = null;

/**
 * Load Tesseract.js library (lazy loading)
 */
async function loadTesseract() {
  if (!Tesseract) {
    const tesseractModule = await import('tesseract.js');
    Tesseract = tesseractModule.default;
  }
  return Tesseract;
}

/**
 * Preprocess image for better OCR results
 * Converts to grayscale and enhances contrast
 */
async function preprocessImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    
    reader.onload = (e) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        
        // Resize if too large (max 2000px)
        const maxSize = 2000;
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          const scale = maxSize / Math.max(width, height);
          width *= scale;
          height *= scale;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Draw original image
        ctx.drawImage(img, 0, 0, width, height);
        
        // Get image data and apply contrast enhancement
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        
        // Convert to grayscale and increase contrast
        for (let i = 0; i < data.length; i += 4) {
          // Grayscale using luminance formula
          const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          
          // Increase contrast
          const contrast = 1.3;
          const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
          const newGray = Math.min(255, Math.max(0, factor * (gray - 128) + 128));
          
          data[i] = newGray;     // R
          data[i + 1] = newGray; // G
          data[i + 2] = newGray; // B
        }
        
        ctx.putImageData(imageData, 0, 0);
        
        // Convert to data URL
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Extract text from image using Tesseract.js OCR
 */
async function performOCR(imageDataUrl: string, onProgress?: (progress: number) => void): Promise<string> {
  const TesseractLib = await loadTesseract();
  
  const result = await TesseractLib.recognize(imageDataUrl, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });
  
  return result.data.text;
}

/**
 * Parse extracted text to find invoice data
 */
function parseInvoiceText(text: string): Partial<ScannedInvoiceData> {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  // Initialize result
  const result: Partial<ScannedInvoiceData> = {
    companyName: '',
    invoiceNumber: '',
    date: '',
    totalAmount: 0,
    lineItems: [],
    rawText: text,
    confidence: 0,
  };
  
  // Patterns for common invoice fields
  const invoiceNumberPatterns = [
    /invoice\s*#?\s*:?\s*([A-Z0-9-]+)/i,
    /inv\s*#?\s*:?\s*([A-Z0-9-]+)/i,
    /number\s*:?\s*([A-Z0-9-]+)/i,
    /#\s*([A-Z0-9-]{4,})/i,
  ];
  
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s*(\d{4})/i,
  ];
  
  const amountPatterns = [
    /total\s*:?\s*R?\s*([\d,]+\.?\d*)/i,
    /amount\s*:?\s*R?\s*([\d,]+\.?\d*)/i,
    /grand\s*total\s*:?\s*R?\s*([\d,]+\.?\d*)/i,
    /balance\s*due\s*:?\s*R?\s*([\d,]+\.?\d*)/i,
    /R\s*([\d,]+\.?\d*)/,
  ];
  
  const subtotalPatterns = [
    /subtotal\s*:?\s*R?\s*([\d,]+\.?\d*)/i,
    /sub-total\s*:?\s*R?\s*([\d,]+\.?\d*)/i,
  ];
  
  const taxPatterns = [
    /vat\s*:?\s*R?\s*([\d,]+\.?\d*)/i,
    /tax\s*:?\s*R?\s*([\d,]+\.?\d*)/i,
    /gst\s*:?\s*R?\s*([\d,]+\.?\d*)/i,
  ];
  
  // Extract invoice number
  for (const pattern of invoiceNumberPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.invoiceNumber = match[1].toUpperCase();
      break;
    }
  }
  
  // Extract date
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        const dateStr = match[0];
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          result.date = date.toISOString();
        }
      } catch {
        // Try manual parsing if Date fails
      }
      break;
    }
  }
  
  // Extract total amount (look for largest amount as fallback)
  let largestAmount = 0;
  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (amount > largestAmount) {
        largestAmount = amount;
        result.totalAmount = amount;
      }
    }
  }
  
  // Extract subtotal
  for (const pattern of subtotalPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.subtotal = parseFloat(match[1].replace(/,/g, ''));
      break;
    }
  }
  
  // Extract tax
  for (const pattern of taxPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.taxAmount = parseFloat(match[1].replace(/,/g, ''));
      break;
    }
  }
  
  // Extract company name (usually first non-empty line or line with common keywords)
  const companyKeywords = ['pty', 'ltd', 'cc', 'inc', 'corp', 'company', 'enterprises', 'trading'];
  for (const line of lines.slice(0, 5)) {
    const lowerLine = line.toLowerCase();
    if (companyKeywords.some(k => lowerLine.includes(k))) {
      result.companyName = line;
      break;
    }
  }
  
  // If no company name found, use first substantial line
  if (!result.companyName && lines.length > 0) {
    const firstSubstantial = lines.find(l => l.length > 3 && !/^\d+$/.test(l));
    if (firstSubstantial) {
      result.companyName = firstSubstantial;
    }
  }
  
  // Extract line items (simple pattern: description followed by amount)
  const lineItemPatterns = [
    /^([A-Za-z\s&]+)\s+([\d,]+\.?\d*)\s*$/,
    /^([A-Za-z\s&]+)\s+R\s*([\d,]+\.?\d*)/i,
  ];
  
  for (const line of lines) {
    for (const pattern of lineItemPatterns) {
      const match = line.match(pattern);
      if (match && match[1].length > 2) {
        const description = match[1].trim();
        const amount = parseFloat(match[2].replace(/,/g, ''));
        
        // Skip if this looks like a total or subtotal
        if (!/total|subtotal|vat|tax|amount|sub-total/i.test(description)) {
          result.lineItems.push({
            description,
            quantity: 1,
            unitPrice: amount,
            amount,
          });
        }
        break;
      }
    }
  }
  
  // Calculate confidence based on what we found
  let confidence = 0;
  if (result.invoiceNumber) confidence += 25;
  if (result.date) confidence += 15;
  if (result.totalAmount > 0) confidence += 30;
  if (result.companyName) confidence += 15;
  if (result.lineItems.length > 0) confidence += 15;
  
  result.confidence = confidence;
  
  return result;
}

/**
 * Main OCR function - processes an invoice image and extracts data
 */
export async function scanInvoiceImage(
  file: File,
  onProgress?: (stage: string, progress: number) => void
): Promise<OCRResult> {
  try {
    // Stage 1: Preprocessing
    onProgress?.('preprocessing', 0);
    const preprocessedImage = await preprocessImage(file);
    onProgress?.('preprocessing', 100);
    
    // Stage 2: OCR
    onProgress?.('ocr', 0);
    const rawText = await performOCR(preprocessedImage, (p) => {
      onProgress?.('ocr', p);
    });
    onProgress?.('ocr', 100);
    
    // Stage 3: Parsing
    onProgress?.('parsing', 0);
    const parsedData = parseInvoiceText(rawText);
    onProgress?.('parsing', 100);
    
    // Validate we got meaningful data
    if (!parsedData.invoiceNumber && !parsedData.companyName && !parsedData.totalAmount) {
      return {
        success: false,
        error: 'Could not extract meaningful data from the image. Please ensure the invoice is clear and readable.',
      };
    }
    
    return {
      success: true,
      data: parsedData as ScannedInvoiceData,
    };
  } catch (error) {
    console.error('OCR Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process image',
    };
  }
}

/**
 * Check if browser supports required APIs
 */
export function isOCRSupported(): boolean {
  return typeof window !== 'undefined' && 
         typeof FileReader !== 'undefined' &&
         typeof CanvasRenderingContext2D !== 'undefined';
}