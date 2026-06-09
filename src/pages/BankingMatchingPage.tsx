import { useState, useEffect, useCallback, useRef } from "react";
import {
  Landmark, X, Upload, RefreshCw, CheckCircle2, XCircle,
  MinusCircle, Settings, ArrowLeftRight, AlertCircle, Search,
  ChevronRight, Zap, Info, Save
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { getInvoices } from "@/lib/invoiceService";
import { Invoice } from "@/types/invoice";
import {
  BankingTransaction,
  BankingSettings,
  MatchStatus,
  getBankingTransactions,
  importTransactions,
  updateMatchStatus,
  deleteTransaction,
  loadBankingSettings,
  saveBankingSettings,
  parseIkhokhaCSV,
  autoMatch,
  fetchAndImportFromAPI,
  InvoiceSummary,
} from "@/lib/bankingService";
import { cn } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────
// v2 - iKhokha API import 2026-04-24

type Tab = "transactions" | "match" | "settings";

const STATUS_CONFIG: Record<MatchStatus, { label: string; icon: React.ReactNode; classes: string }> = {
  unmatched: {
    label: "Unmatched",
    icon: <AlertCircle className="h-3 w-3" />,
    classes: "bg-red-100 text-red-700 border-red-200",
  },
  matched: {
    label: "Matched",
    icon: <CheckCircle2 className="h-3 w-3" />,
    classes: "bg-green-100 text-green-700 border-green-200",
  },
  ignored: {
    label: "Ignored",
    icon: <MinusCircle className="h-3 w-3" />,
    classes: "bg-slate-100 text-slate-500 border-slate-200",
  },
};

function fmt(amount: number) {
  return `R ${amount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Props ─────────────────────────────────────────────────────────────────

interface BankingMatchingPageProps {
  onClose: () => void;
}

// ── Main Component ────────────────────────────────────────────────────────

export function BankingMatchingPage({ onClose }: BankingMatchingPageProps) {
  const { workspaceId } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<Tab>("transactions");
  const [transactions, setTransactions] = useState<BankingTransaction[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [settings, setSettings] = useState<BankingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);

  // Date range for API fetch (default: last 30 days)
  const todayStr = new Date().toISOString().split("T")[0];
  const thirtyAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const [fetchStart, setFetchStart] = useState(thirtyAgo);
  const [fetchEnd, setFetchEnd] = useState(todayStr);

  const [showSecret, setShowSecret] = useState(false);

  // Filter
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<MatchStatus | "all">("all");

  // Match mode
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [invoiceSearch, setInvoiceSearch] = useState("");

  // Auto-match preview
  const [autoMatchPairs, setAutoMatchPairs] = useState<
    Array<{ transactionId: string; invoiceId: string; confidence: "exact" | "fuzzy" }> | null
  >(null);

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Settings draft
  const [settingsDraft, setSettingsDraft] = useState<BankingSettings | null>(null);

  // File input
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load data ──────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [txs, invs, cfg] = await Promise.all([
        getBankingTransactions(workspaceId),
        getInvoices(workspaceId),
        loadBankingSettings(workspaceId),
      ]);
      setTransactions(txs);
      setInvoices(invs);
      setSettings(cfg);
      setSettingsDraft(cfg);
    } catch (err) {
      toast({ variant: "destructive", title: "Load failed", description: String(err) });
    } finally {
      setLoading(false);
    }
  }, [workspaceId, toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── CSV Import ─────────────────────────────────────────────────────────

  const handleCSVFile = useCallback(async (file: File) => {
    if (!workspaceId) return;
    const text = await file.text();
    const parsed = parseIkhokhaCSV(text);
    if (!parsed.length) {
      toast({ variant: "destructive", title: "No rows found", description: "Check CSV format — headers must include Date, Amount columns." });
      return;
    }
    try {
      const count = await importTransactions(workspaceId, parsed);
      toast({ title: `Imported ${count} transaction${count !== 1 ? "s" : ""}` });
      await loadAll();
    } catch (err) {
      toast({ variant: "destructive", title: "Import failed", description: String(err) });
    }
  }, [workspaceId, toast, loadAll]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleCSVFile(file);
    e.target.value = "";
  };

  // ── Match / Unmatch ────────────────────────────────────────────────────

  const matchTxToInvoice = useCallback(async (txId: string, invoiceId: string) => {
    try {
      await updateMatchStatus(txId, "matched", invoiceId);
      setTransactions(prev => prev.map(t =>
        t.id === txId ? { ...t, matchStatus: "matched", matchedInvoiceId: invoiceId } : t
      ));
      setSelectedTxId(null);
      toast({ title: "Transaction matched ✓" });
    } catch (err) {
      toast({ variant: "destructive", title: "Match failed", description: String(err) });
    }
  }, [toast]);

  const unmatchTx = useCallback(async (txId: string) => {
    try {
      await updateMatchStatus(txId, "unmatched", null);
      setTransactions(prev => prev.map(t =>
        t.id === txId ? { ...t, matchStatus: "unmatched", matchedInvoiceId: null } : t
      ));
      toast({ title: "Transaction unmatched" });
    } catch (err) {
      toast({ variant: "destructive", title: "Unmatch failed", description: String(err) });
    }
  }, [toast]);

  const ignoreTx = useCallback(async (txId: string) => {
    try {
      await updateMatchStatus(txId, "ignored", null);
      setTransactions(prev => prev.map(t =>
        t.id === txId ? { ...t, matchStatus: "ignored", matchedInvoiceId: null } : t
      ));
    } catch (err) {
      toast({ variant: "destructive", title: "Failed", description: String(err) });
    }
  }, [toast]);

  const deleteTx = useCallback(async (txId: string) => {
    try {
      await deleteTransaction(txId);
      setTransactions(prev => prev.filter(t => t.id !== txId));
      setConfirmDeleteId(null);
      toast({ title: "Transaction deleted" });
    } catch (err) {
      toast({ variant: "destructive", title: "Delete failed", description: String(err) });
    }
  }, [toast]);

  // ── Auto-match ─────────────────────────────────────────────────────────

  const runAutoMatch = useCallback(() => {
    if (!settings) return;
    const invSummaries: InvoiceSummary[] = invoices
      .filter(inv => inv.paymentStatus !== "paid")
      .map(inv => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        total: inv.total,
        invoiceDate: inv.invoiceDate,
        customerName: inv.customerName,
      }));
    const pairs = autoMatch(transactions, invSummaries, settings);
    if (!pairs.length) {
      toast({ title: "No auto-matches found", description: "Try adjusting tolerance settings." });
      return;
    }
    setAutoMatchPairs(pairs);
  }, [settings, invoices, transactions, toast]);

  const confirmAutoMatch = useCallback(async () => {
    if (!autoMatchPairs) return;
    try {
      await Promise.all(autoMatchPairs.map(p => updateMatchStatus(p.transactionId, "matched", p.invoiceId)));
      setTransactions(prev => {
        const map = new Map(autoMatchPairs.map(p => [p.transactionId, p.invoiceId]));
        return prev.map(t => map.has(t.id)
          ? { ...t, matchStatus: "matched" as MatchStatus, matchedInvoiceId: map.get(t.id)! }
          : t
        );
      });
      toast({ title: `${autoMatchPairs.length} transaction${autoMatchPairs.length !== 1 ? "s" : ""} matched ✓` });
    } catch (err) {
      toast({ variant: "destructive", title: "Auto-match failed", description: String(err) });
    } finally {
      setAutoMatchPairs(null);
    }
  }, [autoMatchPairs, toast]);

  // ── Save settings ──────────────────────────────────────────────────────

  const saveSettings = useCallback(async () => {
    if (!workspaceId || !settingsDraft) return;
    setSaving(true);
    try {
      await saveBankingSettings(workspaceId, settingsDraft);
      setSettings(settingsDraft);
      toast({ title: "Settings saved ✓" });
    } catch (err) {
      toast({ variant: "destructive", title: "Save failed", description: String(err) });
    } finally {
      setSaving(false);
    }
  }, [workspaceId, settingsDraft, toast]);

  const handleFetchFromAPI = useCallback(async () => {
    if (!workspaceId || !settingsDraft) return;
    // Save credentials first so the edge function can read them
    setSaving(true);
    try {
      await saveBankingSettings(workspaceId, settingsDraft);
      setSettings(settingsDraft);
    } catch {
      toast({ variant: "destructive", title: "Failed to save credentials before fetch" });
      setSaving(false);
      return;
    }
    setSaving(false);
    setFetching(true);
    try {
      const { imported, total } = await fetchAndImportFromAPI(workspaceId, fetchStart, fetchEnd);
      toast({
        title: `Fetched ${total} transaction${total !== 1 ? "s" : ""} from iKhokha`,
        description: imported > 0 ? `${imported} new transaction${imported !== 1 ? "s" : ""} imported.` : "No new transactions (all already imported).",
      });
      await loadAll();
    } catch (err) {
      const msg = String(err);
      const isSignatureErr = msg.toLowerCase().includes("signature");
      toast({
        variant: "destructive",
        title: isSignatureErr ? "Invalid API credentials" : "Fetch failed",
        description: isSignatureErr
          ? "iKhokha rejected the signature. Check that your Application Key ID and Secret are correct (iKhokha Merchant Portal → My Account → API Keys)."
          : msg,
      });
    } finally {
      setFetching(false);
    }
  }, [workspaceId, settingsDraft, fetchStart, fetchEnd, toast, loadAll]);

  // ── Derived ────────────────────────────────────────────────────────────

  const filteredTxs = transactions.filter(tx => {
    if (filterStatus !== "all" && tx.matchStatus !== filterStatus) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return (
        tx.reference?.toLowerCase().includes(q) ||
        tx.description?.toLowerCase().includes(q) ||
        String(tx.amount).includes(q) ||
        tx.transactionDate.includes(q)
      );
    }
    return true;
  });

  const unmatchedTxs = transactions.filter(t => t.matchStatus === "unmatched");
  const openInvoices = invoices.filter(inv => inv.paymentStatus !== "paid");
  const filteredOpenInvoices = openInvoices.filter(inv => {
    if (!invoiceSearch) return true;
    const q = invoiceSearch.toLowerCase();
    return inv.invoiceNumber.toLowerCase().includes(q) || inv.customerName.toLowerCase().includes(q);
  });

  const selectedTx = transactions.find(t => t.id === selectedTxId) ?? null;
  const matchedCount  = transactions.filter(t => t.matchStatus === "matched").length;
  const ignoredCount  = transactions.filter(t => t.matchStatus === "ignored").length;
  const unmatchedCount = transactions.filter(t => t.matchStatus === "unmatched").length;

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="absolute inset-0 bg-background z-30 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-background z-30 flex flex-col">
      {/* ── Header ── */}
      <div className="border-b bg-card flex-shrink-0">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Landmark className="h-6 w-6 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Banking &amp; Matching</h1>
              <p className="text-sm text-muted-foreground">Match iKhokha card payments to invoices</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadAll} className="hidden sm:flex gap-1">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* ── Stats Bar ── */}
        <div className="grid grid-cols-4 gap-3 px-4 pb-3">
          <div className="bg-background rounded-lg p-2.5 border text-center">
            <div className="text-xs text-muted-foreground mb-0.5">Total</div>
            <div className="text-xl font-bold">{transactions.length}</div>
          </div>
          <div className="bg-background rounded-lg p-2.5 border text-center">
            <div className="text-xs text-muted-foreground mb-0.5">Unmatched</div>
            <div className="text-xl font-bold text-red-600">{unmatchedCount}</div>
          </div>
          <div className="bg-background rounded-lg p-2.5 border text-center">
            <div className="text-xs text-muted-foreground mb-0.5">Matched</div>
            <div className="text-xl font-bold text-green-600">{matchedCount}</div>
          </div>
          <div className="bg-background rounded-lg p-2.5 border text-center">
            <div className="text-xs text-muted-foreground mb-0.5">Ignored</div>
            <div className="text-xl font-bold text-slate-500">{ignoredCount}</div>
          </div>
        </div>

        {/* ── Tab Nav ── */}
        <div className="flex gap-1 px-4 pb-0 border-t pt-2">
          {(["transactions", "match", "settings"] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-t-md transition-colors capitalize flex items-center gap-1.5",
                activeTab === tab
                  ? "bg-background border border-b-background text-foreground -mb-px"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "transactions" && <ArrowLeftRight className="h-3.5 w-3.5" />}
              {tab === "match" && <CheckCircle2 className="h-3.5 w-3.5" />}
              {tab === "settings" && <Settings className="h-3.5 w-3.5" />}
              {tab === "transactions" ? "Transactions" : tab === "match" ? "Match Invoices" : "Settings"}
              {tab === "transactions" && unmatchedCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-red-500 text-white">{unmatchedCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* ══ Transactions Tab ══ */}
        {activeTab === "transactions" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* toolbar */}
            <div className="flex items-center gap-2 p-3 border-b flex-shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8 h-8"
                  placeholder="Search transactions..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
              <Select value={filterStatus} onValueChange={v => setFilterStatus(v as MatchStatus | "all")}>
                <SelectTrigger className="h-8 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="unmatched">Unmatched</SelectItem>
                  <SelectItem value="matched">Matched</SelectItem>
                  <SelectItem value="ignored">Ignored</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                <Upload className="h-4 w-4" />
                Import CSV
              </Button>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
            </div>

            {/* list */}
            <div className="flex-1 overflow-y-auto">
              {filteredTxs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                  <Landmark className="h-10 w-10 opacity-30" />
                  <p className="text-sm">
                    {transactions.length === 0
                      ? "No transactions imported yet. Click \"Import CSV\" to get started."
                      : "No transactions match your filter."}
                  </p>
                  {transactions.length === 0 && (
                    <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                      <Upload className="h-4 w-4" />
                      Import iKhokha CSV
                    </Button>
                  )}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr className="text-left">
                      <th className="px-4 py-2 font-medium text-muted-foreground">Date</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">Amount</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">Reference</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">Description</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">Card Type</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground">Matched Invoice</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground w-28">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTxs.map(tx => {
                      const sc = STATUS_CONFIG[tx.matchStatus];
                      const matchedInv = tx.matchedInvoiceId
                        ? invoices.find(i => i.id === tx.matchedInvoiceId)
                        : null;
                      return (
                        <tr key={tx.id} className="border-b hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2 font-mono text-xs">{tx.transactionDate}</td>
                          <td className="px-4 py-2 font-semibold">{fmt(tx.amount)}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{tx.reference ?? "—"}</td>
                          <td className="px-4 py-2 text-xs max-w-[160px] truncate">{tx.description ?? "—"}</td>
                          <td className="px-4 py-2 text-xs">{tx.cardType ?? "—"}</td>
                          <td className="px-4 py-2">
                            <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-medium", sc.classes)}>
                              {sc.icon}{sc.label}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs">
                            {matchedInv
                              ? <span className="text-green-700 font-medium">{matchedInv.invoiceNumber} — {matchedInv.customerName}</span>
                              : "—"}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex gap-1">
                              {tx.matchStatus === "unmatched" && (
                                <>
                                  <Button size="sm" variant="outline" className="h-6 px-2 text-xs"
                                    onClick={() => { setSelectedTxId(tx.id); setActiveTab("match"); }}>
                                    Match
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground"
                                    onClick={() => ignoreTx(tx.id)}>
                                    Ignore
                                  </Button>
                                </>
                              )}
                              {tx.matchStatus === "matched" && (
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground"
                                  onClick={() => unmatchTx(tx.id)}>
                                  Unmatch
                                </Button>
                              )}
                              {tx.matchStatus === "ignored" && (
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                                  onClick={() => unmatchTx(tx.id)}>
                                  Restore
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-red-500 hover:text-red-700"
                                onClick={() => setConfirmDeleteId(tx.id)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ══ Match Invoices Tab ══ */}
        {activeTab === "match" && (
          <div className="flex flex-1 overflow-hidden">
            {/* Left: unmatched transactions */}
            <div className="w-1/2 flex flex-col border-r overflow-hidden">
              <div className="p-3 border-b flex items-center justify-between flex-shrink-0">
                <h2 className="text-sm font-semibold">Unmatched Transactions ({unmatchedTxs.length})</h2>
                <Button size="sm" variant="default" onClick={runAutoMatch} disabled={!unmatchedTxs.length} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                  <Zap className="h-3.5 w-3.5" />
                  Auto-Match
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {unmatchedTxs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 text-green-500 opacity-60" />
                    <p className="text-sm">All transactions are matched!</p>
                  </div>
                ) : (
                  unmatchedTxs.map(tx => (
                    <button
                      key={tx.id}
                      onClick={() => setSelectedTxId(selectedTxId === tx.id ? null : tx.id)}
                      className={cn(
                        "w-full text-left p-3 border-b hover:bg-muted/30 transition-colors flex items-center justify-between",
                        selectedTxId === tx.id && "bg-emerald-50 border-l-4 border-l-emerald-500"
                      )}
                    >
                      <div>
                        <div className="font-semibold text-sm">{fmt(tx.amount)}</div>
                        <div className="text-xs text-muted-foreground">{tx.transactionDate} · {tx.reference ?? tx.description ?? "No reference"}</div>
                      </div>
                      <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", selectedTxId === tx.id && "rotate-90")} />
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right: open invoices */}
            <div className="w-1/2 flex flex-col overflow-hidden">
              <div className="p-3 border-b flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold">
                    {selectedTx
                      ? <span>Select invoice for <span className="text-emerald-600">{fmt(selectedTx.amount)}</span></span>
                      : <span>Open Invoices ({openInvoices.length})</span>}
                  </h2>
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="pl-7 h-7 text-xs"
                    placeholder="Search invoices..."
                    value={invoiceSearch}
                    onChange={e => setInvoiceSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {!selectedTx && (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                    <Info className="h-8 w-8 opacity-30" />
                    <p className="text-sm text-center px-4">Select an unmatched transaction on the left, then click an invoice to match it.</p>
                  </div>
                )}
                {selectedTx && filteredOpenInvoices.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                    <p className="text-sm">No open invoices found.</p>
                  </div>
                )}
                {selectedTx && filteredOpenInvoices.map(inv => {
                  const diff = Math.abs(inv.total - selectedTx.amount);
                  const exact = diff === 0;
                  return (
                    <button
                      key={inv.id}
                      onClick={() => matchTxToInvoice(selectedTx.id, inv.id)}
                      className="w-full text-left p-3 border-b hover:bg-emerald-50 transition-colors flex items-center justify-between group"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{inv.invoiceNumber}</span>
                          {exact && <span className="text-xs bg-green-100 text-green-700 px-1.5 rounded">Exact match</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">{inv.customerName} · {inv.invoiceDate}</div>
                        <div className="text-xs mt-0.5">
                          <span className="font-semibold">{fmt(inv.total)}</span>
                          {!exact && <span className="text-muted-foreground ml-1">(diff {fmt(diff)})</span>}
                        </div>
                      </div>
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ══ Settings Tab ══ */}
        {activeTab === "settings" && settingsDraft && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-xl space-y-6">

              {/* ── CSV Import ── */}
              <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-5 space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Upload className="h-4 w-4 text-blue-500" />
                  Import from CSV
                </h3>
                <p className="text-xs text-muted-foreground">
                  Export your transaction history from the iKhokha Merchant Portal, then upload the CSV file here.
                </p>
                <div
                  className="border-2 border-dashed border-blue-200 rounded-lg p-6 text-center cursor-pointer hover:bg-blue-50/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleCSVFile(f); }}
                >
                  <Upload className="h-8 w-8 mx-auto mb-2 text-blue-400 opacity-60" />
                  <p className="text-sm text-muted-foreground">Drag & drop a CSV file, or <span className="text-blue-500 underline">browse</span></p>
                  <p className="text-xs text-muted-foreground mt-1">iKhokha CSV export (.csv)</p>
                </div>
                <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-3 space-y-1">
                  <p className="font-medium text-foreground">How to get the CSV from iKhokha</p>
                  <p>Log in to <strong>portal.ikhokha.com</strong> → Transactions → select a date range → <strong>Export CSV</strong></p>
                </div>
              </div>

              {/* ── Live API Import ── */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-5 space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Zap className="h-4 w-4 text-emerald-500" />
                  Import from iKhokha API
                </h3>
                <p className="text-xs text-muted-foreground">
                  Enter your iKhokha Merchant Portal API keys below. Click <strong>Fetch Transactions</strong> to pull payment history directly — no CSV needed.
                </p>
                <div className="grid gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Application Key ID</Label>
                    <Input
                      placeholder="e.g. IKVNLT…"
                      value={settingsDraft.ikAppId}
                      onChange={e => setSettingsDraft(s => s ? { ...s, ikAppId: e.target.value } : s)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">iKhokha Merchant Portal → My Account → Your secure key → <strong>Application Key ID</strong>.</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Application Key Secret</Label>
                    <div className="flex gap-2">
                      <Input
                        type={showSecret ? "text" : "password"}
                        placeholder="Paste your secret here"
                        value={settingsDraft.ikAppSecret}
                        onChange={e => setSettingsDraft(s => s ? { ...s, ikAppSecret: e.target.value } : s)}
                        className="flex-1"
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowSecret(v => !v)}>
                        {showSecret ? "Hide" : "Show"}
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">From date</Label>
                      <Input type="date" value={fetchStart} onChange={e => setFetchStart(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">To date</Label>
                      <Input type="date" value={fetchEnd} onChange={e => setFetchEnd(e.target.value)} />
                    </div>
                  </div>
                </div>
                <Button
                  onClick={handleFetchFromAPI}
                  disabled={fetching || saving || !settingsDraft.ikAppId || !settingsDraft.ikAppSecret}
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 w-full"
                >
                  {fetching
                    ? <><RefreshCw className="h-4 w-4 animate-spin" /> Fetching…</>
                    : <><Zap className="h-4 w-4" /> Fetch Transactions</>}
                </Button>
              </div>

              <div className="rounded-lg border p-5 space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-emerald-500" />
                  iKhokha Terminal
                </h3>
                <div className="grid gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Terminal Label</Label>
                    <Input
                      placeholder="e.g. Counter Terminal"
                      value={settingsDraft.terminalLabel}
                      onChange={e => setSettingsDraft(s => s ? { ...s, terminalLabel: e.target.value } : s)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Terminal ID (optional)</Label>
                    <Input
                      placeholder="e.g. TID12345678"
                      value={settingsDraft.terminalId}
                      onChange={e => setSettingsDraft(s => s ? { ...s, terminalId: e.target.value } : s)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Found on your iKhokha device or merchant portal.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-5 space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  Auto-Match Settings
                </h3>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Enable Auto-Match</Label>
                    <p className="text-xs text-muted-foreground">Automatically suggest matches when you run Auto-Match</p>
                  </div>
                  <Switch
                    checked={settingsDraft.autoMatchEnabled}
                    onCheckedChange={v => setSettingsDraft(s => s ? { ...s, autoMatchEnabled: v } : s)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Date Tolerance (days)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={30}
                      value={settingsDraft.autoMatchDaysTolerance}
                      onChange={e => setSettingsDraft(s => s ? { ...s, autoMatchDaysTolerance: Number(e.target.value) } : s)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Max days between payment and invoice date.</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Amount Tolerance (R)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={settingsDraft.autoMatchAmountTolerance}
                      onChange={e => setSettingsDraft(s => s ? { ...s, autoMatchAmountTolerance: Number(e.target.value) } : s)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">0 = exact amount only.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4 bg-muted/30 flex items-start gap-3">
                <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">How to import transactions</p>
                  <p>Log in to the iKhokha Merchant Portal → Reports → export as CSV. Then use the <strong>Import CSV</strong> button on the Transactions tab.</p>
                  <p>The CSV must include at minimum a <strong>Date</strong> and <strong>Amount</strong> column.</p>
                </div>
              </div>

              <Button onClick={saveSettings} disabled={saving} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Settings
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Auto-match confirmation dialog ── */}
      <Dialog open={!!autoMatchPairs} onOpenChange={open => !open && setAutoMatchPairs(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Auto-Match</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-3">
            Found <strong>{autoMatchPairs?.length ?? 0}</strong> potential match{(autoMatchPairs?.length ?? 0) !== 1 ? "es" : ""}:
          </p>
          <div className="max-h-64 overflow-y-auto space-y-2">
            {autoMatchPairs?.map(pair => {
              const tx = transactions.find(t => t.id === pair.transactionId);
              const inv = invoices.find(i => i.id === pair.invoiceId);
              if (!tx || !inv) return null;
              return (
                <div key={pair.transactionId} className="flex items-center justify-between text-xs border rounded p-2 gap-2">
                  <div>
                    <span className="font-semibold">{fmt(tx.amount)}</span>
                    <span className="text-muted-foreground ml-1">{tx.transactionDate}</span>
                  </div>
                  <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <div className="text-right">
                    <span className="font-semibold">{inv.invoiceNumber}</span>
                    <span className="text-muted-foreground ml-1">{inv.customerName}</span>
                  </div>
                  <span className={cn(
                    "px-1.5 py-0.5 rounded-full text-xs border",
                    pair.confidence === "exact" ? "bg-green-100 text-green-700 border-green-200" : "bg-amber-100 text-amber-700 border-amber-200"
                  )}>
                    {pair.confidence}
                  </span>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutoMatchPairs(null)}>Cancel</Button>
            <Button onClick={confirmAutoMatch} className="bg-emerald-600 hover:bg-emerald-700">Apply Matches</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ── */}
      <Dialog open={!!confirmDeleteId} onOpenChange={open => !open && setConfirmDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Transaction?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This transaction will be permanently deleted. This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmDeleteId && deleteTx(confirmDeleteId)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
