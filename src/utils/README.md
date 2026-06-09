# Helpers Utilities

Comprehensive utility functions for the application (structured like AI Stock). This module provides common helper functions for barcode generation, currency formatting, stock management, and more.

## 📦 Installation

The helpers are already included in the project. Import them from `@/utils/helpers`:

```typescript
import { generateBarcode, formatCurrency, generateSKU } from '@/utils/helpers';
```

## 🏷️ Barcode Generation

Generate barcodes in multiple formats with validation and formatting.

### Functions

#### `generateBarcode(format?: 'CODE128' | 'EAN13' | 'UPC')`
Generate a new barcode in the specified format.

```typescript
const code128 = generateBarcode(); // Default: CODE128
const ean13 = generateBarcode('EAN13');
const upc = generateBarcode('UPC');
```

#### `generateBarcodeFromSKU(sku: string, format?: 'CODE128' | 'EAN13' | 'UPC')`
Generate a deterministic barcode from an SKU.

```typescript
const barcode = generateBarcodeFromSKU('PROD-001', 'CODE128');
```

#### `validateBarcode(barcode: string, format?: string)`
Validate a barcode with optional format specification.

```typescript
const isValid = validateBarcode('2001234567890', 'EAN13');
```

#### `formatBarcodeForDisplay(barcode: string)`
Format a barcode for better readability.

```typescript
const formatted = formatBarcodeForDisplay('2001234567890');
// Returns: "200 1234567890"
```

#### `getBarcodeInfo(barcode: string)`
Get comprehensive information about a barcode.

```typescript
const info = getBarcodeInfo('2001234567890');
// Returns: { format: 'EAN13', valid: true, formatted: '200 1234567890' }
```

## 💰 Currency Formatting

Format numbers as currency with support for multiple currencies.

### Constants

```typescript
CURRENCY_SYMBOLS = {
  USD: '$',
  ZAR: 'R',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  AED: 'د.إ',
  SGD: 'S$',
  AUD: 'A$',
}
```

### Functions

#### `formatCurrency(value: number, currency?: Currency)`
Format a number as currency (default: ZAR).

```typescript
formatCurrency(1299.99);         // "R 1,299.99"
formatCurrency(1299.99, 'USD');  // "$ 1,299.99"
```

#### `formatCurrencyWithCurrency(value: number, currency: Currency)`
Explicit currency formatting.

```typescript
formatCurrencyWithCurrency(1299.99, 'EUR'); // "€ 1,299.99"
```

#### `formatNumber(value: number)`
Format a number with thousand separators.

```typescript
formatNumber(1234567); // "1,234,567"
```

## 📦 Stock Management

Utilities for managing inventory stock levels.

### Functions

#### `getStockStatus(quantity: number, reorderLevel: number)`
Get the stock status based on quantity and reorder level.

```typescript
getStockStatus(50, 20);  // "in-stock"
getStockStatus(15, 20);  // "low-stock"
getStockStatus(0, 20);   // "out-of-stock"
```

#### `getStockStatusColor(status: 'in-stock' | 'low-stock' | 'out-of-stock')`
Get the color code for a stock status.

```typescript
getStockStatusColor('in-stock');      // "#43a047" (green)
getStockStatusColor('low-stock');     // "#ffa726" (orange)
getStockStatusColor('out-of-stock');  // "#ef5350" (red)
```

## 🏷️ SKU Generation

Generate unique Stock Keeping Units.

#### `generateSKU()`
Generate a unique SKU.

```typescript
const sku = generateSKU(); // "LNQR2K3P-XY7Z9A"
```

## 📝 Text Utilities

Text manipulation and formatting functions.

#### `truncateText(text: string, maxLength?: number)`
Truncate text to specified length (default: 50).

```typescript
truncateText('Long text...', 20); // "Long text..."
```

#### `capitalize(str: string)`
Capitalize first letter.

```typescript
capitalize('hello world'); // "Hello world"
```

#### `capitalizeWords(str: string)`
Capitalize every word.

```typescript
capitalizeWords('hello world'); // "Hello World"
```

#### `slugify(str: string)`
Convert string to URL-friendly slug.

```typescript
slugify('Hello World!'); // "hello-world"
```

## 📅 Date Formatting

Date and time formatting utilities.

#### `formatDate(date: Date | string)`
Format date in short format.

```typescript
formatDate(new Date());      // "Apr 7, 2026"
formatDate('2026-04-07');    // "Apr 7, 2026"
```

#### `formatDateTime(date: Date | string)`
Format date with time.

```typescript
formatDateTime(new Date()); // "Apr 7, 2026, 14:30"
```

## 📞 Phone Number Formatting

#### `formatPhoneNumber(phone: string)`
Format phone numbers (optimized for South African numbers).

```typescript
formatPhoneNumber('0821234567');   // "(082) 123-4567"
formatPhoneNumber('27821234567');  // "+27 (82) 123-4567"
```

## ✉️ Email Validation

#### `validateEmail(email: string)`
Validate email address format.

```typescript
validateEmail('user@example.com'); // true
validateEmail('invalid');          // false
```

## 📁 File Utilities

#### `formatFileSize(bytes: number)`
Format file size in human-readable format.

```typescript
formatFileSize(1024);       // "1 KB"
formatFileSize(1048576);    // "1 MB"
formatFileSize(25000000);   // "23.84 MB"
```

## 📊 Percentage Utilities

#### `calculatePercentage(value: number, total: number)`
Calculate percentage of value from total.

```typescript
calculatePercentage(25, 100);  // 25
calculatePercentage(333, 1000); // 33
```

#### `calculatePercentageChange(oldValue: number, newValue: number)`
Calculate percentage change between two values.

```typescript
calculatePercentageChange(100, 150); // 50 (increase)
calculatePercentageChange(100, 75);  // -25 (decrease)
```

## 🔢 Number Utilities

#### `clamp(value: number, min: number, max: number)`
Constrain a value between min and max.

```typescript
clamp(150, 0, 100); // 100
clamp(-10, 0, 100); // 0
```

#### `roundToDecimal(value: number, decimals?: number)`
Round to specified decimal places (default: 2).

```typescript
roundToDecimal(3.14159, 2); // 3.14
roundToDecimal(3.14159, 4); // 3.1416
```

#### `randomInt(min: number, max: number)`
Generate random integer between min and max (inclusive).

```typescript
randomInt(1, 10); // Random number between 1 and 10
```

## 🎨 Color Utilities

#### `hexToRgb(hex: string)`
Convert hex color to RGB object.

```typescript
hexToRgb('#ff5733'); // { r: 255, g: 87, b: 51 }
```

#### `rgbToHex(r: number, g: number, b: number)`
Convert RGB values to hex color.

```typescript
rgbToHex(255, 87, 51); // "#ff5733"
```

#### `randomColor()`
Generate random hex color.

```typescript
randomColor(); // "#a3f2b4"
```

## 📦 Array Utilities

#### `chunk<T>(array: T[], size: number)`
Split array into chunks of specified size.

```typescript
chunk([1, 2, 3, 4, 5], 2); // [[1, 2], [3, 4], [5]]
```

#### `unique<T>(array: T[])`
Remove duplicates from array.

```typescript
unique([1, 2, 2, 3, 3, 4]); // [1, 2, 3, 4]
```

## ⚡ Performance Utilities

#### `debounce<T>(func: T, wait: number)`
Debounce function execution.

```typescript
const debouncedSearch = debounce(search, 300);
```

#### `throttle<T>(func: T, limit: number)`
Throttle function execution.

```typescript
const throttledScroll = throttle(handleScroll, 100);
```

#### `sleep(ms: number)`
Wait for specified milliseconds.

```typescript
await sleep(1000); // Wait 1 second
```

## 💾 Local Storage Utilities

#### `getLocalStorage<T>(key: string, defaultValue: T)`
Get item from local storage with default value.

```typescript
const settings = getLocalStorage('settings', { theme: 'light' });
```

#### `setLocalStorage<T>(key: string, value: T)`
Save item to local storage.

```typescript
setLocalStorage('settings', { theme: 'dark' });
```

#### `removeLocalStorage(key: string)`
Remove item from local storage.

```typescript
removeLocalStorage('settings');
```

## 🔧 Object Utilities

#### `deepClone<T>(obj: T)`
Create deep clone of object.

```typescript
const clone = deepClone(originalObject);
```

#### `omit<T>(obj: T, keys: K[])`
Create object without specified keys.

```typescript
const user = { id: 1, name: 'John', password: 'secret' };
const publicUser = omit(user, ['password']); // { id: 1, name: 'John' }
```

#### `pick<T>(obj: T, keys: K[])`
Create object with only specified keys.

```typescript
const user = { id: 1, name: 'John', email: 'john@example.com', password: 'secret' };
const basicInfo = pick(user, ['id', 'name']); // { id: 1, name: 'John' }
```

## 📚 Usage Example

Complete example of creating a product with helpers:

```typescript
import {
  generateSKU,
  generateBarcode,
  formatCurrency,
  getStockStatus,
  truncateText,
} from '@/utils/helpers';

const product = {
  id: Date.now().toString(),
  sku: generateSKU(),
  barcode: generateBarcode('CODE128'),
  name: 'Sample Product',
  description: truncateText('Very long description...', 100),
  price: formatCurrency(299.99, 'ZAR'),
  quantity: 45,
  reorderLevel: 20,
  stockStatus: getStockStatus(45, 20),
};
```

## 🔗 Related

- [barcodeService.ts](../lib/barcodeService.ts) - Comprehensive barcode service
- [BarcodePrinting.tsx](../components/crm/BarcodePrinting.tsx) - Barcode printing component
- [helpers.examples.ts](./helpers.examples.ts) - More usage examples

## 📝 Notes

- All functions are tree-shakeable - only imported functions are included in the bundle
- Currency formatting uses the user's locale for number formatting
- Barcode generation includes check digit calculation for EAN13 and UPC
- All helpers are fully typed with TypeScript

## 🆕 AI Stock Compatibility

This helpers module is structured to match AI Stock's implementation while providing enhanced functionality:

- ✅ Same function names and signatures as AI Stock
- ✅ Additional features: UPC support, SKU-to-barcode conversion, advanced validation
- ✅ Re-exports from comprehensive barcodeService for maximum functionality
- ✅ Extended utility functions for common operations

You can import and use these helpers exactly as you would in AI Stock!
