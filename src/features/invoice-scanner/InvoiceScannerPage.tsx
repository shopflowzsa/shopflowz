/**
 * Invoice Scanner Page Component
 * Standalone feature for scanning invoices with OCR
 * Isolated from main codebase for easy integration/removal
 */

import { useState, useCallback, useRef } from "react";
import { 
  Camera, 
  Upload, 
  X, 
  Check, 
  AlertCircle, 
  Loader2, 
  Edit3, 
  Save,
  Trash2,
  FileText,
  Plus
} from "lucide-react";
import { scanInvoiceImage, isOCRSupported } from "./ocrService";
import { ScannedInvoiceData, ExpenseEntry, OCRProcessingStatus } from "./types";

interface InvoiceScannerPageProps {
  onClose: () => void;
  onSaveExpense?: (expense: ExpenseEntry) => void;
  workspaceId?: string;
}

export function InvoiceScannerPage({ onClose, onSaveExpense, workspaceId }: InvoiceScannerPageProps) {
  // State
  const [status, setStatus] = useState<OCRProcessingStatus>('idle');
  const [progress, setProgress] = useState({ stage: '', percent: 0 });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scannedData, setScannedData] = useState<ScannedInvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Editable form state
  const [formData, setFormData] = useState({
    vendorName: '',
    invoiceNumber: '',
    date: '',
    amount: '',
    category: 'General Expenses',
    notes: '',
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  
  // Predefined expense categories
  const categories = [
    'General Expenses',
    'Stock/Purchases',
    'Travel & Transport',
    'Utilities',
    'Rent & Lease',
    'Insurance',
    'Professional Services',
    'Marketing & Advertising',
    'Office Supplies',
    'Equipment & Tools',
    'Repairs & Maintenance',
    'Other',
  ];

  // Handle file selection
  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }
    
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setScannedData(null);
    setError(null);
    setStatus('idle');
  }, []);

  // Handle file input change
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  // Handle camera capture
  const handleCameraCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  // Start OCR processing
  const handleScan = useCallback(async () => {
    if (!selectedFile) return;
    
    setStatus('processing');
    setError(null);
    
    try {
      const result = await scanInvoiceImage(selectedFile, (stage, percent) => {
        setProgress({ stage, percent });
      });
      
      if (result.success && result.data) {
        setScannedData(result.data);
        setFormData({
          vendorName: result.data.companyName || '',
          invoiceNumber: result.data.invoiceNumber || '',
          date: result.data.date ? result.data.date.split('T')[0] : new Date().toISOString().split('T')[0],
          amount: result.data.totalAmount > 0 ? result.data.totalAmount.toString() : '',
          category: 'Stock/Purchases',
          notes: '',
        });
        setStatus('success');
      } else {
        setError(result.error || 'Failed to extract data from image');
        setStatus('error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setStatus('error');
    }
  }, [selectedFile]);

  // Reset and scan another
  const handleReset = useCallback(() => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setScannedData(null);
    setError(null);
    setStatus('idle');
    setProgress({ stage: '', percent: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  }, []);

  // Save expense
  const handleSave = useCallback(() => {
    if (!formData.vendorName || !formData.amount) {
      setError('Please fill in vendor name and amount');
      return;
    }
    
    const expense: ExpenseEntry = {
      id: `exp_${Date.now()}`,
      vendorName: formData.vendorName,
      invoiceNumber: formData.invoiceNumber,
      amount: parseFloat(formData.amount),
      date: formData.date,
      category: formData.category,
      accountId: workspaceId || 'default',
      notes: formData.notes,
      imageUrl: previewUrl || undefined,
      createdAt: new Date().toISOString(),
    };
    
    onSaveExpense?.(expense);
    onClose();
  }, [formData, previewUrl, workspaceId, onSaveExpense, onClose]);

  // Update form field
  const updateFormField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Render loading state
  const renderLoading = () => (
    <div className="flex flex-col items-center justify-center py-12 space-y-4">
      <Loader2 className="h-12 w-12 animate-spin text-indigo-500" />
      <div className="text-center">
        <p className="font-medium text-slate-200 capitalize">{progress.stage}</p>
        <div className="w-64 h-2 bg-slate-700 rounded-full mt-2 overflow-hidden">
          <div 
            className="h-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <p className="text-sm text-slate-400 mt-1">{progress.percent}%</p>
      </div>
    </div>
  );

  // Render error state
  const renderError = () => (
    <div className="flex flex-col items-center justify-center py-12 space-y-4">
      <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center">
        <AlertCircle className="h-8 w-8 text-red-400" />
      </div>
      <p className="text-red-400 text-center max-w-md">{error}</p>
      <button
        onClick={handleReset}
        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 transition-colors"
      >
        Try Another Image
      </button>
    </div>
  );

  // Render results/edit form
  const renderResults = () => (
    <div className="space-y-6">
      {/* Confidence indicator */}
      {scannedData && (
        <div className="flex items-center gap-2 p-3 bg-slate-800 rounded-lg">
          <div className={`w-3 h-3 rounded-full ${
            scannedData.confidence >= 70 ? 'bg-green-500' : 
            scannedData.confidence >= 40 ? 'bg-yellow-500' : 'bg-red-500'
          }`} />
          <span className="text-sm text-slate-300">
            Confidence: {scannedData.confidence}%
          </span>
          {scannedData.lineItems.length > 0 && (
            <span className="text-sm text-slate-400 ml-2">
              ({scannedData.lineItems.length} line items detected)
            </span>
          )}
        </div>
      )}

      {/* Editable form */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Vendor / Company Name
          </label>
          <input
            type="text"
            value={formData.vendorName}
            onChange={(e) => updateFormField('vendorName', e.target.value)}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Enter vendor name"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Invoice Number
            </label>
            <input
              type="text"
              value={formData.invoiceNumber}
              onChange={(e) => updateFormField('invoiceNumber', e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="INV-001"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Date
            </label>
            <input
              type="date"
              value={formData.date}
              onChange={(e) => updateFormField('date', e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Amount (ZAR)
            </label>
            <input
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) => updateFormField('amount', e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Category
            </label>
            <select
              value={formData.category}
              onChange={(e) => updateFormField('category', e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Notes
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => updateFormField('notes', e.target.value)}
            rows={2}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            placeholder="Additional notes..."
          />
        </div>
      </div>

      {/* Detected line items */}
      {scannedData && scannedData.lineItems.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-slate-300 mb-2">Detected Line Items</h4>
          <div className="bg-slate-800 rounded-lg divide-y divide-slate-700">
            {scannedData.lineItems.map((item, idx) => (
              <div key={idx} className="p-3 flex justify-between items-center">
                <span className="text-slate-200">{item.description}</span>
                <span className="text-slate-300">R {item.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw text (collapsible) */}
      {scannedData && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-slate-400 hover:text-slate-300">
            View raw OCR text
          </summary>
          <pre className="mt-2 p-3 bg-slate-800 rounded-lg text-xs text-slate-400 overflow-auto max-h-40 whitespace-pre-wrap">
            {scannedData.rawText}
          </pre>
        </details>
      )}
    </div>
  );

  // Render file selection UI
  const renderFileSelection = () => (
    <div className="space-y-6">
      {/* Upload area */}
      <div 
        className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center hover:border-indigo-500 transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileInputChange}
          className="hidden"
        />
        <Upload className="h-12 w-12 mx-auto text-slate-400 mb-3" />
        <p className="text-slate-300 font-medium">Click to upload invoice image</p>
        <p className="text-sm text-slate-500 mt-1">or drag and drop</p>
        <p className="text-xs text-slate-600 mt-2">Supports: JPG, PNG, HEIC, WebP</p>
      </div>

      {/* Camera capture */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-slate-700" />
        <span className="text-sm text-slate-500">or</span>
        <div className="flex-1 h-px bg-slate-700" />
      </div>

      <button
        onClick={() => cameraInputRef.current?.click()}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg text-slate-200 transition-colors"
      >
        <Camera className="h-5 w-5" />
        <span>Take Photo with Camera</span>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleCameraCapture}
          className="hidden"
        />
      </button>

      {/* Info text */}
      <div className="bg-slate-800/50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-slate-300 mb-2">Tips for best results:</h4>
        <ul className="text-xs text-slate-400 space-y-1">
          <li>• Ensure good lighting on the invoice</li>
          <li>• Keep the image sharp and in focus</li>
          <li>• Include the entire invoice in the frame</li>
          <li>• Avoid shadows and glare on the document</li>
        </ul>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-950">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-indigo-400" />
          <h2 className="font-semibold">Invoice Scanner</h2>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-xl mx-auto">
          {/* Check OCR support */}
          {!isOCRSupported() && (
            <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-2 text-yellow-400">
                <AlertCircle className="h-5 w-5" />
                <span className="font-medium">Browser not fully supported</span>
              </div>
              <p className="text-sm text-yellow-300/80 mt-1">
                Your browser may not support all OCR features. Please use a modern browser like Chrome or Firefox.
              </p>
            </div>
          )}

          {/* Preview + results layout */}
          {(previewUrl || scannedData) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* Image preview */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-slate-300">Invoice Image</h4>
                <div className="relative aspect-[3/4] bg-slate-800 rounded-lg overflow-hidden">
                  {previewUrl && (
                    <img 
                      src={previewUrl} 
                      alt="Invoice preview" 
                      className="w-full h-full object-contain"
                    />
                  )}
                </div>
              </div>

              {/* Results / form */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-slate-300">Extracted Data</h4>
                {status === 'processing' ? renderLoading() :
                 status === 'error' ? renderError() :
                 scannedData ? renderResults() : null}
              </div>
            </div>
          )}

          {/* File selection (when no image selected) */}
          {!previewUrl && !scannedData && renderFileSelection()}

          {/* Error message (when not processing results) */}
          {error && status !== 'error' && status !== 'processing' && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 mb-6">
              <div className="flex items-center gap-2 text-red-400">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div className="px-4 py-3 border-t border-slate-700 bg-slate-950 flex items-center justify-between gap-3">
        <button
          onClick={handleReset}
          className="px-4 py-2 text-slate-400 hover:text-slate-200 transition-colors"
        >
          {previewUrl ? 'Start Over' : 'Cancel'}
        </button>

        <div className="flex items-center gap-3">
          {previewUrl && !scannedData && status !== 'processing' && (
            <button
              onClick={handleScan}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <Camera className="h-4 w-4" />
              Scan Invoice
            </button>
          )}

          {scannedData && (
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              Save Expense
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default InvoiceScannerPage;