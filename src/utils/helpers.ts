/**
 * Helper Utilities
 * Common helper functions for the application (structured like AI Stock)
 */

// Re-export comprehensive barcode functionality from barcodeService
export {
  generateBarcode,
  validateBarcode,
  formatBarcodeForDisplay,
  getBarcodeInfo,
  generateBarcodeFromSKU
} from '../lib/barcodeService';

// ─── Currency Formatting ─────────────────────────────────────────────────

export const CURRENCY_SYMBOLS = {
  USD: '$',
  ZAR: 'R',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  AED: 'د.إ',
  SGD: 'S$',
  AUD: 'A$',
} as const;

export type Currency = keyof typeof CURRENCY_SYMBOLS;

export const formatCurrency = (value: number, currency: Currency = 'ZAR'): string => {
  const symbol = CURRENCY_SYMBOLS[currency];
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  
  return `${symbol} ${formatted}`;
};

export const formatCurrencyWithCurrency = (
  value: number,
  currency: Currency
): string => {
  const symbol = CURRENCY_SYMBOLS[currency];
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  
  return `${symbol} ${formatted}`;
};

export const formatNumber = (value: number): string => {
  return new Intl.NumberFormat('en-US').format(value);
};

// ─── Stock Management ────────────────────────────────────────────────────

export const getStockStatus = (
  quantity: number,
  reorderLevel: number
): 'in-stock' | 'low-stock' | 'out-of-stock' => {
  if (quantity === 0) return 'out-of-stock';
  if (quantity <= reorderLevel) return 'low-stock';
  return 'in-stock';
};

export const getStockStatusColor = (
  status: 'in-stock' | 'low-stock' | 'out-of-stock'
) => {
  switch (status) {
    case 'in-stock':
      return '#43a047';
    case 'low-stock':
      return '#ffa726';
    case 'out-of-stock':
      return '#ef5350';
    default:
      return '#9e9e9e';
  }
};

// ─── Text Utilities ──────────────────────────────────────────────────────

export const truncateText = (text: string, maxLength: number = 50): string => {
  return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
};

// ─── SKU Generation ──────────────────────────────────────────────────────

export const generateSKU = (): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${timestamp}-${random}`;
};

// ─── Email Validation ────────────────────────────────────────────────────

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// ─── Phone Number Formatting ─────────────────────────────────────────────

export const formatPhoneNumber = (phone: string): string => {
  // Remove all non-numeric characters
  const cleaned = phone.replace(/\D/g, '');
  
  // Format as: +27 (82) 123-4567 for South African numbers
  if (cleaned.startsWith('27') && cleaned.length === 11) {
    return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  
  // Format as: (082) 123-4567 for local numbers
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  
  return phone;
};

// ─── Date Formatting ─────────────────────────────────────────────────────

export const formatDate = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
};

export const formatDateTime = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

// ─── File Size Formatting ────────────────────────────────────────────────

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

// ─── Percentage Calculation ──────────────────────────────────────────────

export const calculatePercentage = (value: number, total: number): number => {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
};

export const calculatePercentageChange = (
  oldValue: number,
  newValue: number
): number => {
  if (oldValue === 0) return newValue > 0 ? 100 : 0;
  return Math.round(((newValue - oldValue) / oldValue) * 100);
};

// ─── Array Utilities ─────────────────────────────────────────────────────

export const chunk = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

export const unique = <T>(array: T[]): T[] => {
  return [...new Set(array)];
};

// ─── String Utilities ────────────────────────────────────────────────────

export const capitalize = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

export const capitalizeWords = (str: string): string => {
  return str
    .split(' ')
    .map(word => capitalize(word))
    .join(' ');
};

export const slugify = (str: string): string => {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// ─── Number Utilities ────────────────────────────────────────────────────

export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

export const roundToDecimal = (value: number, decimals: number = 2): number => {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
};

// ─── Debounce & Throttle ─────────────────────────────────────────────────

export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

export const throttle = <T extends (...args: any[]) => any>(
  func: T,
  limit: number
): ((...args: Parameters<T>) => void) => {
  let inThrottle: boolean;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
};

// ─── Color Utilities ─────────────────────────────────────────────────────

export const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
};

export const rgbToHex = (r: number, g: number, b: number): string => {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
};

// ─── Local Storage Utilities ─────────────────────────────────────────────

export const getLocalStorage = <T>(key: string, defaultValue: T): T => {
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error(`Error reading localStorage key "${key}":`, error);
    return defaultValue;
  }
};

export const setLocalStorage = <T>(key: string, value: T): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error setting localStorage key "${key}":`, error);
  }
};

export const removeLocalStorage = (key: string): void => {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error(`Error removing localStorage key "${key}":`, error);
  }
};

// ─── Deep Clone ──────────────────────────────────────────────────────────

export const deepClone = <T>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};

// ─── Wait/Sleep Utility ──────────────────────────────────────────────────

export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// ─── Random Utilities ────────────────────────────────────────────────────

export const randomInt = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

export const randomColor = (): string => {
  return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
};

// ─── Object Utilities ────────────────────────────────────────────────────

export const omit = <T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> => {
  const result = { ...obj };
  keys.forEach(key => delete result[key]);
  return result;
};

export const pick = <T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> => {
  const result = {} as Pick<T, K>;
  keys.forEach(key => {
    if (key in obj) {
      result[key] = obj[key];
    }
  });
  return result;
};

// ─── Export All ──────────────────────────────────────────────────────────

export default {
  // Currency
  CURRENCY_SYMBOLS,
  formatCurrency,
  formatCurrencyWithCurrency,
  formatNumber,
  
  // Stock
  getStockStatus,
  getStockStatusColor,
  
  // Text
  truncateText,
  capitalize,
  capitalizeWords,
  slugify,
  
  // SKU & Barcode
  generateSKU,
  generateBarcode,
  validateBarcode,
  formatBarcodeForDisplay,
  getBarcodeInfo,
  generateBarcodeFromSKU,
  
  // Email
  validateEmail,
  
  // Phone
  formatPhoneNumber,
  
  // Date
  formatDate,
  formatDateTime,
  
  // File
  formatFileSize,
  
  // Percentage
  calculatePercentage,
  calculatePercentageChange,
  
  // Array
  chunk,
  unique,
  
  // Number
  clamp,
  roundToDecimal,
  randomInt,
  
  // Functions
  debounce,
  throttle,
  sleep,
  
  // Color
  hexToRgb,
  rgbToHex,
  randomColor,
  
  // Storage
  getLocalStorage,
  setLocalStorage,
  removeLocalStorage,
  
  // Object
  deepClone,
  omit,
  pick,
};
