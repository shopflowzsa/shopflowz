/**
 * WhatsApp Logs Dialog
 * Shows all WhatsApp messages sent with client info enriched from customer records
 */

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, Search, RefreshCw, Loader2, Phone, User, Package, Hash, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface WhatsAppLogsProps {
  open: boolean;
  onClose: () => void;
}

interface WaLog {
  id: string;
  workspace_id: string;
  created_at: string;
  data: {
    to?: string;
    toOriginal?: string;
    status?: string;
    taskId?: string;
    taskTitle?: string;
    timestamp?: string;
    templateName?: string;
    parameters?: Array<{ text: string; type: string }>;
    messageId?: string;
    error?: string;
  };
}

interface Customer {
  id: string;
  contactPerson?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  customerNumber?: string;
}

function formatPhone(raw?: string): string {
  if (!raw) return "—";
  // Convert 27xxxxxxxxx → +27 xx xxx xxxx
  const s = String(raw).replace(/\D/g, "");
  if (s.startsWith("27") && s.length === 11) {
    return `+27 ${s.slice(2, 4)} ${s.slice(4, 7)} ${s.slice(7)}`;
  }
  return `+${s}`;
}

function formatRelTime(ts?: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  if (status === "sent" || status === "delivered" || status === "read") {
    return (
      <Badge className="bg-green-900/50 text-green-300 border-green-700 text-[10px] gap-1">
        <CheckCircle className="h-2.5 w-2.5" /> {status}
      </Badge>
    );
  }
  if (status === "pending" || status === "queued") {
    return (
      <Badge className="bg-yellow-900/50 text-yellow-300 border-yellow-700 text-[10px] gap-1">
        <Clock className="h-2.5 w-2.5" /> {status}
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-900/50 text-red-300 border-red-700 text-[10px] gap-1">
      <AlertCircle className="h-2.5 w-2.5" /> {status}
    </Badge>
  );
}

export function WhatsAppLogsDialog({ open, onClose }: WhatsAppLogsProps) {
  const { workspaceId } = useAuth();
  const [logs, setLogs] = useState<WaLog[]>([]);
  const [customers, setCustomers] = useState<Map<string, Customer>>(new Map());
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (open && workspaceId) {
      loadData();
    }
  }, [open, workspaceId]);

  // Real-time subscription: auto-refresh when new logs arrive
  useEffect(() => {
    if (!open || !workspaceId) return;
    const channel = supabase
      .channel(`wa_logs_${workspaceId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "whatsapp_logs",
        filter: `workspace_id=eq.${workspaceId}`,
      }, () => {
        loadData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, workspaceId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [logsRes, custRes] = await Promise.all([
        supabase
          .from("whatsapp_logs")
          .select("id, workspace_id, data, created_at")
          .eq("workspace_id", workspaceId!)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("customers")
          .select("id, data")
          .eq("workspace_id", workspaceId!),
      ]);

      setLogs(logsRes.data || []);

      // Build phone → customer map for enrichment
      const phoneMap = new Map<string, Customer>();
      (custRes.data || []).forEach((row) => {
        const d = row.data as any;
        const cust: Customer = {
          id: row.id,
          contactPerson: d.contactPerson,
          companyName: d.companyName,
          phone: d.phone,
          email: d.email,
          customerNumber: d.customerNumber,
        };
        if (d.phone) {
          const clean = String(d.phone).replace(/\D/g, "");
          phoneMap.set(clean, cust);
          // Also try without leading 27 → 0xx format
          if (clean.startsWith("27")) phoneMap.set("0" + clean.slice(2), cust);
          if (clean.startsWith("0")) phoneMap.set("27" + clean.slice(1), cust);
        }
      });
      setCustomers(phoneMap);
    } catch (err) {
      console.error("Failed to load WhatsApp logs:", err);
    } finally {
      setLoading(false);
    }
  };

  const enrichedLogs = useMemo(() => {
    return logs.map((log) => {
      const d = log.data;
      const phone = String(d.to || d.toOriginal || "").replace(/\D/g, "");
      const customer = customers.get(phone) || customers.get("0" + phone.slice(2)) || null;
      const params = d.parameters || [];
      const customerNameParam = params[0]?.text;
      const productParam = params[1]?.text;
      const jobParam = params[2]?.text;
      return { ...log, customer, customerNameParam, productParam, jobParam };
    });
  }, [logs, customers]);

  const filtered = useMemo(() => {
    if (!search.trim()) return enrichedLogs;
    const q = search.toLowerCase();
    return enrichedLogs.filter((l) => {
      const d = l.data;
      return (
        String(d.to || "").includes(q) ||
        String(d.taskTitle || "").toLowerCase().includes(q) ||
        String(l.customerNameParam || "").toLowerCase().includes(q) ||
        String(l.customer?.contactPerson || "").toLowerCase().includes(q) ||
        String(l.customer?.companyName || "").toLowerCase().includes(q) ||
        String(l.customer?.phone || "").includes(q) ||
        String(l.customer?.email || "").toLowerCase().includes(q) ||
        String(l.jobParam || "").toLowerCase().includes(q)
      );
    });
  }, [enrichedLogs, search]);

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl w-full max-h-[90vh] flex flex-col bg-background text-foreground border-border p-0">
        <DialogHeader className="px-6 pt-5 pb-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2 text-white">
                <MessageSquare className="h-5 w-5 text-green-400" />
                WhatsApp Logs
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm mt-0.5">
                {logs.length} messages — click any row to see customer details
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadData}
              disabled={loading}
              className="text-muted-foreground hover:text-white"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>

          {/* Search */}
          <div className="relative mt-3 mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search by phone, name, job number, task…"
              className="pl-9 bg-card border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 pb-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : paginated.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {search ? "No messages match your search." : "No WhatsApp messages logged yet."}
            </div>
          ) : (
            <div className="space-y-2">
              {paginated.map((log) => (
                <Card key={log.id} className="bg-card border-border hover:border-green-600/50 transition-colors">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      {/* Left: phone + customer info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="flex items-center gap-1 text-green-400 text-sm font-mono">
                            <Phone className="h-3 w-3" />
                            {formatPhone(log.data.to || log.data.toOriginal)}
                          </span>
                          {log.data.templateName && (
                            <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                              {log.data.templateName}
                            </Badge>
                          )}
                          <StatusBadge status={log.data.status} />
                        </div>

                        {/* Customer enrichment */}
                        {(log.customer || log.customerNameParam) && (
                          <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-foreground/80">
                            {(log.customer?.contactPerson || log.customerNameParam) && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3 text-muted-foreground" />
                                <strong>{log.customer?.contactPerson || log.customerNameParam}</strong>
                                {log.customer?.companyName && (
                                  <span className="text-muted-foreground">· {log.customer.companyName}</span>
                                )}
                              </span>
                            )}
                            {log.customer?.email && (
                              <span className="text-muted-foreground">{log.customer.email}</span>
                            )}
                          </div>
                        )}

                        {/* Task / job info */}
                        {log.data.taskTitle && (
                          <div className="mt-1 flex flex-wrap gap-3 text-xs">
                            {log.jobParam && (
                              <span className="flex items-center gap-1 text-blue-400">
                                <Hash className="h-3 w-3" /> {log.jobParam}
                              </span>
                            )}
                            {log.productParam && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Package className="h-3 w-3" /> {log.productParam}
                              </span>
                            )}
                            <span className="text-muted-foreground truncate max-w-xs">{log.data.taskTitle}</span>
                          </div>
                        )}

                        {/* Error */}
                        {log.data.error && (
                          <p className="mt-1 text-xs text-red-400">{log.data.error}</p>
                        )}
                      </div>

                      {/* Right: time */}
                      <span className="text-[11px] text-muted-foreground shrink-0 mt-0.5">
                        {formatRelTime(log.data.timestamp || log.created_at)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3 text-sm text-muted-foreground">
              <span>{filtered.length} results</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="border-border text-foreground/80 hover:bg-muted"
                >
                  Previous
                </Button>
                <span className="px-2 py-1">
                  {page + 1} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  className="border-border text-foreground/80 hover:bg-muted"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
