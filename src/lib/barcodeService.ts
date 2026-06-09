/**
 * Barcode Generation Service
 * Generates and manages barcodes for inventory items
 */

// ─── Barcode Generation ──────────────────────────────────────────────────

export function generateBarcode(format: 'CODE128' | 'EAN13' | 'UPC' = 'CODE128'): string {
  switch (format) {
    case 'CODE128':
      return generateCode128();
    case 'EAN13':
      return generateEAN13();
    case 'UPC':
      return generateUPC();
    default:
      return generateCode128();
  }
}

function generateCode128(): string {
  // Generate a 12-digit CODE128 barcode
  const timestamp = Date.now().toString();
  const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${timestamp.slice(-8)}${randomNum}`;
}

function generateEAN13(): string {
  // Generate a 13-digit EAN barcode with check digit
  let barcode = '200'; // Country code for restricted circulation
  
  // Add 9 random digits
  for (let i = 0; i < 9; i++) {
    barcode += Math.floor(Math.random() * 10).toString();
  }
  
  // Calculate and add check digit
  const checkDigit = calculateEAN13CheckDigit(barcode);
  return barcode + checkDigit;
}

function generateUPC(): string {
  // Generate a 12-digit UPC barcode
  let barcode = '0'; // System digit for standard UPC
  
  // Add 10 random digits
  for (let i = 0; i < 10; i++) {
    barcode += Math.floor(Math.random() * 10).toString();
  }
  
  // Calculate and add check digit
  const checkDigit = calculateUPCCheckDigit(barcode);
  return barcode + checkDigit;
}

function calculateEAN13CheckDigit(barcode: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(barcode[i]);
    // Odd positions (1st, 3rd, 5th, etc.) are multiplied by 1
    // Even positions (2nd, 4th, 6th, etc.) are multiplied by 3
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit.toString();
}

function calculateUPCCheckDigit(barcode: string): string {
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const digit = parseInt(barcode[i]);
    // Odd positions are multiplied by 3, even positions by 1
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit.toString();
}

// ─── Barcode Validation ──────────────────────────────────────────────────

export function validateBarcode(barcode: string, format?: string): boolean {
  if (!barcode) return false;
  
  // Remove spaces and convert to string
  const cleanBarcode = barcode.replace(/\s/g, '').toString();
  
  switch (format) {
    case 'EAN13':
      return validateEAN13(cleanBarcode);
    case 'UPC':
      return validateUPC(cleanBarcode);
    case 'CODE128':
      return validateCode128(cleanBarcode);
    default:
      // Try to auto-detect format
      if (cleanBarcode.length === 13) return validateEAN13(cleanBarcode);
      if (cleanBarcode.length === 12) return validateUPC(cleanBarcode);
      return validateCode128(cleanBarcode);
  }
}

function validateEAN13(barcode: string): boolean {
  if (!/^\d{13}$/.test(barcode)) return false;
  
  const checkDigit = barcode.slice(-1);
  const calculatedCheckDigit = calculateEAN13CheckDigit(barcode.slice(0, 12));
  return checkDigit === calculatedCheckDigit;
}

function validateUPC(barcode: string): boolean {
  if (!/^\d{12}$/.test(barcode)) return false;
  
  const checkDigit = barcode.slice(-1);
  const calculatedCheckDigit = calculateUPCCheckDigit(barcode.slice(0, 11));
  return checkDigit === calculatedCheckDigit;
}

function validateCode128(barcode: string): boolean {
  // CODE128 can contain letters and numbers
  return /^[\x20-\x7E]+$/.test(barcode) && barcode.length >= 1;
}

// ─── Barcode Formatting ──────────────────────────────────────────────────

export function formatBarcodeForDisplay(barcode: string, format?: string): string {
  if (!barcode) return '';
  
  const cleanBarcode = barcode.replace(/\s/g, '');
  
  switch (format) {
    case 'EAN13':
      // Format: 1 234567 890123
      if (cleanBarcode.length === 13) {
        return `${cleanBarcode[0]} ${cleanBarcode.slice(1, 7)} ${cleanBarcode.slice(7)}`;
      }
      break;
    case 'UPC':
      // Format: 0 12345 67890 1
      if (cleanBarcode.length === 12) {
        return `${cleanBarcode[0]} ${cleanBarcode.slice(1, 6)} ${cleanBarcode.slice(6, 11)} ${cleanBarcode[11]}`;
      }
      break;
  }
  
  return cleanBarcode;
}

// ─── Barcode Metadata ────────────────────────────────────────────────────

export function getBarcodeFormat(barcode: string): string {
  if (!barcode) return 'Unknown';
  
  const cleanBarcode = barcode.replace(/\s/g, '');
  
  if (/^\d{13}$/.test(cleanBarcode) && validateEAN13(cleanBarcode)) return 'EAN13';
  if (/^\d{12}$/.test(cleanBarcode) && validateUPC(cleanBarcode)) return 'UPC';
  if (validateCode128(cleanBarcode)) return 'CODE128';
  
  return 'Invalid';
}

export function getBarcodeInfo(barcode: string): {
  format: string;
  isValid: boolean;
  displayFormat: string;
  length: number;
} {
  const format = getBarcodeFormat(barcode);
  const isValid = validateBarcode(barcode, format);
  const displayFormat = formatBarcodeForDisplay(barcode, format);
  const length = barcode?.replace(/\s/g, '').length || 0;
  
  return {
    format,
    isValid,
    displayFormat,
    length
  };
}

// ─── SKU to Barcode Conversion ───────────────────────────────────────────

export function generateBarcodeFromSKU(sku: string, format: 'CODE128' | 'EAN13' | 'UPC' = 'CODE128'): string {
  if (!sku) return generateBarcode(format);
  
  // Create a deterministic barcode based on SKU
  const cleanSku = sku.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  
  switch (format) {
    case 'CODE128':
      // Use SKU directly for CODE128 (supports alphanumeric)
      return cleanSku.length > 0 ? cleanSku : generateBarcode(format);
      
    case 'EAN13':
      // Convert SKU to numeric for EAN13
      return skuToNumericBarcode(cleanSku, 13);
      
    case 'UPC':
      // Convert SKU to numeric for UPC  
      return skuToNumericBarcode(cleanSku, 12);
      
    default:
      return generateBarcode(format);
  }
}

function skuToNumericBarcode(sku: string, length: number): string {
  // Convert alphanumeric SKU to numeric barcode
  let numericString = '';
  
  for (let char of sku) {
    if (/\d/.test(char)) {
      numericString += char;
    } else {
      // Convert letters to numbers: A=10, B=11, ..., Z=35
      const charCode = char.charCodeAt(0);
      if (charCode >= 65 && charCode <= 90) { // A-Z
        numericString += (charCode - 55).toString();
      }
    }
  }
  
  // Pad with timestamp if too short
  while (numericString.length < length - 1) {
    numericString += Date.now().toString().slice(-1);
  }
  
  // Truncate if too long
  if (numericString.length >= length) {
    numericString = numericString.slice(0, length - 1);
  }
  
  // Add appropriate prefix and calculate check digit
  if (length === 13) {
    const barcode = '2' + numericString.padEnd(11, '0').slice(0, 11);
    return barcode + calculateEAN13CheckDigit(barcode);
  } else if (length === 12) {
    const barcode = '2' + numericString.padEnd(10, '0').slice(0, 10);
    return barcode + calculateUPCCheckDigit(barcode);
  }
  
  return numericString;
}

// ─── Barcode Search and Matching ─────────────────────────────────────────

export function searchBarcodeVariations(searchTerm: string): string[] {
  const variations = [searchTerm];
  const clean = searchTerm.replace(/\s/g, '');
  
  if (clean !== searchTerm) {
    variations.push(clean);
  }
  
  // Add formatted variations
  const formatted = formatBarcodeForDisplay(clean);
  if (formatted !== searchTerm && formatted !== clean) {
    variations.push(formatted);
  }
  
  return [...new Set(variations)];
}