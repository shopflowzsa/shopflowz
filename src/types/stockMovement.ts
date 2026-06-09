// ═══════════════════════════════════════════════════════════════════════════
// STOCK MOVEMENT TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export type StockMovementType = 
  | 'purchase'        // Stock added via purchase
  | 'sale'            // Stock sold via invoice
  | 'adjustment-in'   // Manual increase (damaged, found, etc.)
  | 'adjustment-out'  // Manual decrease (damaged, lost, etc.)
  | 'return'          // Customer return (increases stock)
  | 'transfer-in'     // Transfer from another location
  | 'transfer-out'    // Transfer to another location
  | 'initial';        // Initial stock entry

export type StockMovementStatus = 'completed' | 'pending' | 'cancelled';

export interface StockMovement {
  id: string;
  
  // Product reference
  productId: string;
  productName: string;
  sku?: string;
  
  // Movement details
  type: StockMovementType;
  quantity: number; // Positive for IN, negative for OUT
  previousQuantity: number; // Stock level before movement
  newQuantity: number; // Stock level after movement
  
  // Cost tracking
  unitCost?: number; // Cost per unit (for purchases)
  totalCost?: number; // Total cost of movement
  
  // Reference documents
  referenceType?: 'invoice' | 'purchase-order' | 'manual' | 'return';
  referenceId?: string; // Invoice ID, PO ID, etc.
  referenceNumber?: string; // Invoice number for display
  
  // Location tracking (future feature)
  locationFrom?: string;
  locationTo?: string;
  
  // Audit trail
  reason?: string; // Explanation for adjustment
  notes?: string;
  status: StockMovementStatus;
  
  // Metadata
  createdBy: string; // User ID who created the movement
  createdByName?: string; // User name for display
  createdAt: string;
  updatedAt: string;
  
  // Approval workflow (optional)
  approvedBy?: string;
  approvedAt?: string;
}

export interface StockMovementSummary {
  productId: string;
  productName: string;
  currentStock: number;
  totalIn: number; // Total quantity added
  totalOut: number; // Total quantity removed
  totalMovements: number;
  lastMovement?: StockMovement;
  lowStockAlert?: boolean;
}

export interface CreateStockMovementData {
  productId: string;
  productName: string;
  sku?: string;
  type: StockMovementType;
  quantity: number;
  unitCost?: number;
  referenceType?: StockMovement['referenceType'];
  referenceId?: string;
  referenceNumber?: string;
  reason?: string;
  notes?: string;
}
