import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, ShoppingBag, MessageSquare, Info, CheckCheck, X, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getNotifications, markAllNotificationsRead, clearNotifications, type AppNotification } from "@/lib/notificationService";
import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const POLL_MS = 45_000;

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
}

const ICON: Record<string, typeof Bell> = { order: ShoppingBag, query: MessageSquare, info: Info };

export function NotificationsBell({ collapsed, onOpenLink }: { collapsed?: boolean; onOpenLink?: (link: string) => void }) {
  const { workspaceId } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [retryResult, setRetryResult] = useState<Map<string, "ok" | "not-found" | "error">>(new Map());
  const btnRef = useRef<HTMLButtonElement>(null);

  const unread = items.filter((i) => !i.read).length;

  const refresh = () => {
    if (!workspaceId) return;
    getNotifications(workspaceId).then(setItems).catch(() => {});
  };

  useEffect(() => {
    refresh();
    if (!workspaceId) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: Math.min(r.top, window.innerHeight - 460), left: r.right + 8 });
      refresh();
    }
    setOpen((o) => !o);
  };

  const handleMarkAllRead = async () => {
    if (!workspaceId) return;
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    await markAllNotificationsRead(workspaceId);
  };

  const handleClear = async () => {
    if (!workspaceId) return;
    setItems([]);
    await clearNotifications(workspaceId);
  };

  const handleRetryBooking = async (n: AppNotification) => {
    const jobNumber = n.meta?.jobNumber as string | undefined;
    if (!jobNumber || !workspaceId) return;
    setRetrying(prev => new Set(prev).add(n.id));
    try {
      const { data } = await supabaseServiceRole
        .from("job_log")
        .select("full_task")
        .eq("workspace_id", workspaceId)
        .eq("job_number", jobNumber)
        .maybeSingle();
      if (!data?.full_task) {
        setRetryResult(prev => new Map(prev).set(n.id, "not-found"));
        return;
      }
      const { error } = await supabase.rpc("append_task_to_workspace", {
        p_workspace_id: workspaceId,
        p_task: data.full_task,
        p_job_counter: 0,
      });
      if (error) throw error;
      setRetryResult(prev => new Map(prev).set(n.id, "ok"));
    } catch (err) {
      console.error("[NotifRetry] failed:", err);
      setRetryResult(prev => new Map(prev).set(n.id, "error"));
    } finally {
      setRetrying(prev => { const s = new Set(prev); s.delete(n.id); return s; });
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        title="Notifications"
        className={cn(
          "group flex items-center gap-2 w-full rounded-md px-2 py-2 text-sidebar-foreground hover:bg-sidebar-accent transition-colors",
          collapsed && "justify-center",
        )}
      >
        <span className="relative shrink-0">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
          )}
        </span>
        {!collapsed && (
          <>
            <span className="text-sm font-medium flex-1 text-left">Notifications</span>
            {unread > 0 && (
              <span className="ml-auto text-xs font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </>
        )}
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[91] w-80 max-h-[440px] flex flex-col rounded-xl bg-white text-gray-800 shadow-2xl border border-gray-200 overflow-hidden"
            style={{ top: Math.max(8, pos.top), left: pos.left }}
          >
            <div className="flex items-center justify-between px-3 py-2.5 border-b">
              <span className="font-bold text-sm flex items-center gap-1.5"><Bell className="h-4 w-4" /> Notifications</span>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button onClick={handleMarkAllRead} title="Mark all read" className="text-[11px] text-blue-600 hover:underline flex items-center gap-1">
                    <CheckCheck className="h-3.5 w-3.5" /> Mark read
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 p-1"><X className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm">
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  No notifications yet
                </div>
              ) : (
                items.map((n) => {
                  const Icon = ICON[n.type] || Info;
                  const canRetry = !!(n.meta?.jobNumber);
                  const isRetrying = retrying.has(n.id);
                  const result = retryResult.get(n.id);
                  return (
                    <div
                      key={n.id}
                      className={cn(
                        "group w-full text-left flex gap-2.5 px-3 py-2.5 border-b border-gray-100 hover:bg-gray-50 transition-colors relative",
                        !n.read && "bg-blue-50/60",
                      )}
                    >
                      <button
                        className="flex gap-2.5 flex-1 min-w-0 text-left"
                        onClick={() => { if (n.link && onOpenLink) onOpenLink(n.link); setOpen(false); }}
                      >
                        <span className={cn("mt-0.5 shrink-0 h-7 w-7 rounded-full flex items-center justify-center",
                          n.type === "order" ? "bg-emerald-100 text-emerald-600" : n.type === "query" ? "bg-violet-100 text-violet-600" : "bg-gray-100 text-gray-500")}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold truncate">{n.title}</p>
                            {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />}
                          </div>
                          {n.body && <p className="text-xs text-gray-500 truncate">{n.body}</p>}
                          <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                          {result === "ok" && <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">✓ Task re-added — refresh to see it</p>}
                          {result === "not-found" && <p className="text-[10px] text-amber-600 font-semibold mt-0.5">Task data not found in backup log</p>}
                          {result === "error" && <p className="text-[10px] text-red-500 font-semibold mt-0.5">Retry failed — try again</p>}
                        </div>
                      </button>
                      {canRetry && !result && (
                        <button
                          title="Task missing? Click to re-add it"
                          onClick={(e) => { e.stopPropagation(); handleRetryBooking(n); }}
                          disabled={isRetrying}
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 self-center ml-1 p-1.5 rounded-md bg-violet-100 hover:bg-violet-200 text-violet-600 disabled:opacity-50"
                        >
                          <RefreshCw className={cn("h-3.5 w-3.5", isRetrying && "animate-spin")} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {items.length > 0 && (
              <button onClick={handleClear} className="text-[11px] text-gray-400 hover:text-red-500 py-2 border-t text-center">
                Clear all
              </button>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
