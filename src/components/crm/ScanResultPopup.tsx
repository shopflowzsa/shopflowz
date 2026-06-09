import { useEffect, useState, useCallback } from "react";
import { X, Package, Wrench, AlertCircle } from "lucide-react";
import { Task } from "@/types/crm";
import { InventoryItem } from "@/lib/inventoryEcommerceSync";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type ScanResult =
  | { type: "task"; task: Task }
  | { type: "product"; product: InventoryItem }
  | { type: "notfound"; query: string };

interface Props {
  result: ScanResult;
  onClose: () => void;
  onOpenTask?: (task: Task) => void;
  autoDismissMs?: number;
}

const AUTO_DISMISS_MS = 8000;

export function ScanResultPopup({ result, onClose, onOpenTask, autoDismissMs = AUTO_DISMISS_MS }: Props) {
  const [remaining, setRemaining] = useState(autoDismissMs);

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining((r) => {
        if (r <= 100) { onClose(); return 0; }
        return r - 100;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const pct = (remaining / autoDismissMs) * 100;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-5 py-3 flex items-center justify-between ${
          result.type === "product" ? "bg-blue-50 border-b border-blue-100" :
          result.type === "task"    ? "bg-amber-50 border-b border-amber-100" :
                                      "bg-red-50 border-b border-red-100"
        }`}>
          <div className="flex items-center gap-2">
            {result.type === "product" && <Package className="h-4 w-4 text-blue-600" />}
            {result.type === "task"    && <Wrench   className="h-4 w-4 text-amber-600" />}
            {result.type === "notfound"&& <AlertCircle className="h-4 w-4 text-red-500" />}
            <span className="text-sm font-semibold text-gray-700">
              {result.type === "product"  ? "Product" :
               result.type === "task"     ? "Job / Task" :
                                            "Not found"}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {result.type === "product" && <ProductDetails product={result.product} />}
          {result.type === "task"    && <TaskDetails task={result.task} onOpen={() => { onOpenTask?.(result.task); onClose(); }} />}
          {result.type === "notfound"&& (
            <p className="text-sm text-muted-foreground">
              No task or product matched <span className="font-mono font-medium text-gray-700">{result.query}</span>
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-gray-100">
          <div
            className={`h-full transition-all ${result.type === "product" ? "bg-blue-400" : result.type === "task" ? "bg-amber-400" : "bg-red-400"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function ProductDetails({ product }: { product: InventoryItem }) {
  const price = (product as any).unitPrice ?? (product as any).price ?? product.price ?? 0;
  const stock = product.quantity ?? (product as any).currentStock ?? 0;
  const low = product.reorderLevel != null && stock <= product.reorderLevel && stock > 0;
  const out = stock === 0;

  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-lg font-bold text-gray-900 leading-tight">{product.name}</h2>
        {product.category && <p className="text-xs text-muted-foreground">{product.category}</p>}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {product.sku && (
          <>
            <span className="text-muted-foreground">SKU</span>
            <span className="font-mono font-medium">{product.sku}</span>
          </>
        )}
        {product.barcode && (
          <>
            <span className="text-muted-foreground">Barcode</span>
            <span className="font-mono text-xs">{product.barcode}</span>
          </>
        )}
        <span className="text-muted-foreground">Price</span>
        <span className="font-bold text-green-700 text-base">R {Number(price).toFixed(2)}</span>
        <span className="text-muted-foreground">Stock</span>
        <span className={`font-semibold ${out ? "text-red-600" : low ? "text-amber-600" : "text-gray-800"}`}>
          {stock} {out ? "— Out of stock" : low ? "— Low" : ""}
        </span>
        {(product as any).costPrice > 0 && (
          <>
            <span className="text-muted-foreground">Cost</span>
            <span className="text-gray-600">R {Number((product as any).costPrice).toFixed(2)}</span>
          </>
        )}
      </div>
    </div>
  );
}

function TaskDetails({ task, onOpen }: { task: Task; onOpen: () => void }) {
  return (
    <div className="space-y-2">
      {task.jobNumber && (
        <p className="text-xl font-bold text-amber-700">{task.jobNumber}</p>
      )}
      <h2 className="text-base font-semibold text-gray-900 leading-tight">{task.title}</h2>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <span className="text-muted-foreground">Status</span>
        <Badge variant="outline" className="w-fit capitalize text-xs">{task.status?.replace(/_/g, " ")}</Badge>
        {task.assignee && (
          <>
            <span className="text-muted-foreground">Assigned</span>
            <span>{task.assignee}</span>
          </>
        )}
        {task.dueDate && (
          <>
            <span className="text-muted-foreground">Due</span>
            <span>{new Date(task.dueDate).toLocaleDateString("en-ZA")}</span>
          </>
        )}
      </div>

      <Button size="sm" className="w-full mt-1" onClick={onOpen}>
        Open Task
      </Button>
    </div>
  );
}
