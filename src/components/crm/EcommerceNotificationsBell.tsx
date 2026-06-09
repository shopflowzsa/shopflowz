import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, ShoppingBag, UserPlus, MessageSquare, CheckCheck, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getEcommerceNotifications, markAllEcommerceNotificationsRead, clearEcommerceNotifications, type AppNotification } from "@/lib/notificationService";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const TYPE_CONFIG: Record<string, { icon: typeof Bell; color: string; bg: string }> = {
  order:  { icon: ShoppingBag,   color: "text-emerald-600", bg: "bg-emerald-100" },
  client: { icon: UserPlus,      color: "text-blue-600",    bg: "bg-blue-100"    },
  query:  { icon: MessageSquare, color: "text-violet-600",  bg: "bg-violet-100"  },
};

export function EcommerceNotificationsBell({ collapsed, onOpenLink }: { collapsed?: boolean; onOpenLink?: (link: string) => void }) {
  const { workspaceId } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const unread = items.filter(n => !n.read).length;

  const refresh = () => {
    if (!workspaceId) return;
    getEcommerceNotifications(workspaceId).then(setItems).catch(() => {});
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
      setPos({ top: Math.min(r.top, window.innerHeight - 480), left: r.right + 8 });
      refresh();
    }
    setOpen(o => !o);
  };

  const handleMarkAllRead = async () => {
    if (!workspaceId) return;
    setItems(prev => prev.map(i => ({ ...i, read: true })));
    await markAllEcommerceNotificationsRead(workspaceId);
  };

  const handleClear = async () => {
    if (!workspaceId) return;
    setItems([]);
    await clearEcommerceNotifications(workspaceId);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-1.5 text-sm rounded text-sidebar-foreground hover:bg-sidebar-accent transition-colors",
          collapsed && "justify-center",
        )}
      >
        <span className="relative shrink-0">
          <Bell className="h-4 w-4 text-orange-400" />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500" />
            </span>
          )}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Notifications</span>
            {unread > 0 && (
              <span className="ml-auto text-xs font-bold bg-orange-500 text-white rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none">
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
            className="fixed z-[91] w-80 max-h-[480px] flex flex-col rounded-xl bg-white text-gray-800 shadow-2xl border border-gray-200 overflow-hidden"
            style={{ top: Math.max(8, pos.top), left: pos.left }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b bg-orange-50">
              <span className="font-bold text-sm flex items-center gap-1.5 text-orange-700">
                <Bell className="h-4 w-4" /> Ecommerce Notifications
              </span>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button onClick={handleMarkAllRead} className="text-[11px] text-blue-600 hover:underline flex items-center gap-1">
                    <CheckCheck className="h-3.5 w-3.5" /> Mark read
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 p-1">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Legend */}
            <div className="flex gap-3 px-3 py-1.5 border-b bg-gray-50 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><ShoppingBag className="h-3 w-3 text-emerald-600" /> Orders</span>
              <span className="flex items-center gap-1"><UserPlus className="h-3 w-3 text-blue-600" /> New clients</span>
              <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3 text-violet-600" /> Chat inquiries</span>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm">
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No ecommerce notifications yet
                </div>
              ) : (
                items.map(n => {
                  const cfg = TYPE_CONFIG[n.type] || { icon: Bell, color: "text-gray-500", bg: "bg-gray-100" };
                  const Icon = cfg.icon;
                  const clickable = !!(n.link && onOpenLink);
                  return (
                    <button
                      key={n.id}
                      onClick={() => {
                        if (n.link && onOpenLink) { onOpenLink(n.link); setOpen(false); }
                      }}
                      className={cn(
                        "w-full text-left flex gap-2.5 px-3 py-2.5 border-b border-gray-100 transition-colors",
                        clickable ? "hover:bg-orange-50 cursor-pointer" : "cursor-default hover:bg-gray-50",
                        !n.read && "bg-orange-50/50",
                      )}
                    >
                      <span className={cn("mt-0.5 shrink-0 h-7 w-7 rounded-full flex items-center justify-center", cfg.bg, cfg.color)}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold truncate">{n.title}</p>
                          {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-orange-500 shrink-0" />}
                        </div>
                        {n.body && <p className="text-xs text-gray-500 truncate">{n.body}</p>}
                        <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {items.length > 0 && (
              <button onClick={handleClear} className="text-[11px] text-gray-400 hover:text-red-500 py-2 border-t text-center">
                Clear ecommerce notifications
              </button>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
