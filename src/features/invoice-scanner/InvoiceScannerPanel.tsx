/**
 * Invoice Scanner - Side Panel Component
 * Slides in from the right side of the screen
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
  FileText,
  ChevronRight,
  Trash2,
  Save,
} from "lucide-react";
import { scanInvoiceImage, isOCRSupported } from "./ocrService";
import { ScannedInvoiceData, ExpenseEntry } from "./types";

interface InvoiceScannerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveExpense?: (expense: ExpenseEntry) => void;
  workspaceId?: string;
}

export function InvoiceScannerPanel({ isOpen, onClose, onSaveExpense, workspaceId }: InvoiceScannerPanelProps) {
  // State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scannedData, setScannedData] = useState<ScannedInvoiceData | null>(null);
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [progress, setProgress] = useState({ stage: '', percent: 0 });
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    vendorName: '',
    invoiceNumber: '',
    date: new Date().toISOString().split('T')[0],
    amount: '',
    category: 'Stock/Purchases',
    notes: '',
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  
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

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleCameraCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

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
        setError(result.error || 'Failed to extract data');
        setStatus('error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setStatus('error');
    }
  }, [selectedFile]);

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
    handleReset();
    onClose();
  }, [formData, previewUrl, workspaceId, onSaveExpense, onClose, handleReset]);

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      
      {/* Side Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-slate-900 border-l border-slate-700 z-50 flex flex-col shadow-2xl">
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
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* OCR not supported warning */}
          {!isOCRSupported() && (
            <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-yellow-400 text-sm">
                <AlertCircle className="h-4 w-4" />
                <span>Browser may not support all features</span>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Image Preview */}
          {previewUrl && (
            <div className="space-y-3">
              <div className="relative aspect-[4/3] bg-slate-800 rounded-lg overflow-hidden">
                <img 
                  src={previewUrl} 
                  alt="Invoice preview" 
                  className="w-full h-full object-contain"
                />
                <button
                  onClick={handleReset}
                  className="absolute top-2 right-2 p-1.5 bg-slate-900/80 hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <Trash2 className="h-4 w-4 text-slate-300" />
                </button>
              </div>

              {/* Confidence indicator */}
              {scannedData && (
                <div className="flex items-center gap-2 text-sm">
                  <div className={`w-2 h-2 rounded-full ${
                    scannedData.confidence >= 70 ? 'bg-green-500' : 
                    scannedData.confidence >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                  }`} />
                  <span className="text-slate-400">
                    Confidence: {scannedData.confidence}%
                  </span>
                </div>
              )}

              {/* Scan button */}
              {!scannedData && status !== 'processing' && (
                <button
                  onClick={handleScan}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Camera className="h-4 w-4" />
                  Scan Invoice
                </button>
              )}

              {/* Processing state */}
              {status === 'processing' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="capitalize">{progress.stage}...</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-indigo-500 transition-all duration-300"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* File Selection (when no image) */}
          {!previewUrl && (
            <div className="space-y-3">
              {/* Upload */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full p-4 border-2 border-dashed border-slate-600 rounded-lg hover:border-indigo-500 transition-colors flex flex-col items-center gap-2"
              >
                <Upload className="h-8 w-8 text-slate-400" />
                <span className="text-slate-300 font-medium">Upload Invoice Image</span>
                <span className="text-xs text-slate-500">JPG, PNG, WebP</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </button>

              {/* Camera */}
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="w-full p-4 border border-slate-600 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-3"
              >
                <Camera className="h-6 w-6 text-slate-400" />
                <span className="text-slate-300">Take Photo</span>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleCameraCapture}
                  className="hidden"
                />
              </button>

              {/* Tips */}
              <div className="bg-slate-800/50 rounded-lg p-3">
                <p className="text-xs text-slate-400">
                  <span className="font-medium text-slate-300">Tips:</span> Ensure good lighting and a clear image for best results.
                </p>
              </div>
            </div>
          )}

          {/* Extracted Data Form */}
          {scannedData && (
            <div className="space-y-3 pt-2">
              <h4 className="text-sm font-medium text-slate-300">Extracted Data</h4>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Vendor / Company</label>
                  <input
                    type="text"
                    value={formData.vendorName}
                    onChange={(e) => updateField('vendorName', e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Invoice #</label>
                    <input
                      type="text"
                      value={formData.invoiceNumber}
                      onChange={(e) => updateField('invoiceNumber', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Date</label>
                    <input
                      type="date"
                      value={formData.date}
                      onChange={(e) => updateField('date', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Amount (ZAR)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.amount}
                      onChange={(e) => updateField('amount', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Category</label>
                    <select
                      value={formData.category}
                      onChange={(e) => updateField('category', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      {categories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => updateField('notes', e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                    placeholder="Optional notes..."
                  />
                </div>
              </div>

              {/* Line items */}
              {scannedData.lineItems.length > 0 && (
                <div>
                  <h5 className="text-xs text-slate-400 mb-2">Detected Items</h5>
                  <div className="bg-slate-800 rounded-lg divide-y divide-slate-700 max-h-32 overflow-y-auto">
                    {scannedData.lineItems.map((item, idx) => (
                      <div key={idx} className="p-2 flex justify-between text-sm">
                        <span className="text-slate-300 truncate flex-1">{item.description}</span>
                        <span className="text-slate-400 ml-2">R {item.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw text toggle */}
              {scannedData && (
                <details className="group">
                  <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-400">
                    View raw OCR text
                  </summary>
                  <pre className="mt-2 p-2 bg-slate-800 rounded text-xs text-slate-500 overflow-auto max-h-24 whitespace-pre-wrap">
                    {scannedData.rawText}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {scannedData && (
          <div className="px-4 py-3 border-t border-slate-700 bg-slate-950 flex gap-3">
            <button
              onClick={handleReset}
              className="flex-1 py-2 text-slate-400 hover:text-slate-200 transition-colors text-sm"
            >
              Scan Another
            </button>
            <button
              onClick={handleSave}
              className="flex-1 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors text-sm flex items-center justify-center gap-2"
            >
              <Save className="h-4 w-4" />
              Save Expense
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default InvoiceScannerPanel;