import { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowLeft, Search, Send, MessageCircle, Check, CheckCheck,
  Clock, AlertTriangle, Phone, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { loadWhatsAppSettings } from "@/lib/whatsappService";
import { format, isToday, isYesterday, formatDistanceToNow, isPast, addHours } from "date-fns";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WaConversation {
  id: string;
  workspace_id: string;
  contact_phone: string;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string;
  unread_count: number;
  window_expires_at: string | null;
  created_at: string;
}

interface WaMessage {
  id: string;
  conversation_id: string;
  wamid: string | null;
  direction: "inbound" | "outbound";
  message_type: string;
  content: string | null;
  status: string;
  sent_by_name: string | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "#25D366", "#128C7E", "#075E54", "#34B7F1",
  "#9B59B6", "#E67E22", "#E74C3C", "#1ABC9C",
];

function avatarColor(str: string): string {
  let h = 0;
  for (const c of str) h = c.charCodeAt(0) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function convTime(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "dd/MM/yy");
}

function msgTime(iso: string): string {
  return format(new Date(iso), "HH:mm");
}

function dateDivider(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "d MMMM yyyy");
}

function groupMessages(msgs: WaMessage[]): { label: string; msgs: WaMessage[] }[] {
  const groups: { label: string; msgs: WaMessage[] }[] = [];
  let lastLabel = "";
  for (const m of msgs) {
    const label = dateDivider(m.created_at);
    if (label !== lastLabel) {
      groups.push({ label, msgs: [] });
      lastLabel = label;
    }
    groups[groups.length - 1].msgs.push(m);
  }
  return groups;
}

function StatusTick({ status }: { status: string }) {
  if (status === "read")
    return <CheckCheck className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
  if (status === "delivered")
    return <CheckCheck className="h-3.5 w-3.5 text-white/50 shrink-0" />;
  if (status === "sent" || status === "received")
    return <Check className="h-3.5 w-3.5 text-white/50 shrink-0" />;
  return <Clock className="h-3 w-3 text-white/40 shrink-0" />;
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function WhatsAppMessengerPage({ onClose }: Props) {
  const { workspaceId, user, members } = useAuth();

  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [messages, setMessages]           = useState<WaMessage[]>([]);
  const [input, setInput]                 = useState("");
  const [search, setSearch]               = useState("");
  const [loadingConvs, setLoadingConvs]   = useState(true);
  const [sending, setSending]             = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  const selectedConv = conversations.find(c => c.id === selectedId) ?? null;
  const displayName  = members.find(m => m.uid === user?.uid)?.displayName ?? user?.email ?? "Staff";

  const windowExpired = selectedConv?.window_expires_at
    ? isPast(new Date(selectedConv.window_expires_at))
    : true; // if no window on record, require template

  const windowExpiresIn = selectedConv?.window_expires_at && !windowExpired
    ? formatDistanceToNow(new Date(selectedConv.window_expires_at), { addSuffix: true })
    : null;

  const windowSoonExpiring = selectedConv?.window_expires_at && !windowExpired
    ? new Date(selectedConv.window_expires_at).getTime() - Date.now() < 2 * 60 * 60 * 1000
    : false;

  // ── Load conversations ─────────────────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("last_message_at", { ascending: false });
    if (data) setConversations(data as WaConversation[]);
    setLoadingConvs(false);
  }, [workspaceId]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // ── Load messages for selected conversation ────────────────────────────────

  const loadMessages = useCallback(async (convId: string) => {
    const { data } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    if (data) setMessages(data as WaMessage[]);

    // Mark as read
    await supabaseServiceRole
      .from("whatsapp_conversations")
      .update({ unread_count: 0 })
      .eq("id", convId);
    setConversations(prev =>
      prev.map(c => c.id === convId ? { ...c, unread_count: 0 } : c)
    );
  }, []);

  useEffect(() => {
    if (selectedId) loadMessages(selectedId);
    else setMessages([]);
  }, [selectedId, loadMessages]);

  // ── Scroll to bottom on new messages ──────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Realtime subscription ──────────────────────────────────────────────────

  useEffect(() => {
    if (!workspaceId) return;

    const channel = supabase
      .channel(`wa_messenger_${workspaceId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "whatsapp_messages",
        filter: `workspace_id=eq.${workspaceId}`,
      }, payload => {
        const msg = payload.new as WaMessage;
        // Add to current chat if it belongs here
        setSelectedId(prev => {
          if (msg.conversation_id === prev) {
            setMessages(m => [...m, msg]);
          }
          return prev;
        });
        loadConversations();
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "whatsapp_messages",
        filter: `workspace_id=eq.${workspaceId}`,
      }, payload => {
        const msg = payload.new as WaMessage;
        setMessages(prev => prev.map(m => m.id === msg.id ? msg : m));
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "whatsapp_conversations",
        filter: `workspace_id=eq.${workspaceId}`,
      }, () => { loadConversations(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [workspaceId, loadConversations]);

  // ── Send message ───────────────────────────────────────────────────────────

  async function sendMessage() {
    const text = input.trim();
    if (!text || !selectedConv || sending) return;
    setInput("");
    setSending(true);
    setSettingsError(null);

    try {
      const settings = await loadWhatsAppSettings(workspaceId!);
      if (!settings.phoneNumberId || !settings.accessToken) {
        setSettingsError("WhatsApp is not fully configured. Go to Settings → WhatsApp to add your Phone Number ID and Access Token.");
        setSending(false);
        return;
      }

      const res = await fetch(
        `https://graph.facebook.com/v19.0/${settings.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${settings.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: selectedConv.contact_phone,
            type: "text",
            text: { body: text },
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `Meta API error ${res.status}`);
      }

      const wamid: string | undefined = data.messages?.[0]?.id;

      // Optimistically add message to UI
      const optimistic: WaMessage = {
        id: `tmp_${Date.now()}`,
        conversation_id: selectedConv.id,
        wamid: wamid ?? null,
        direction: "outbound",
        message_type: "text",
        content: text,
        status: "sent",
        sent_by_name: displayName,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, optimistic]);

      // Persist to database
      await supabaseServiceRole.from("whatsapp_messages").insert({
        workspace_id:    workspaceId,
        conversation_id: selectedConv.id,
        wamid:           wamid ?? null,
        direction:       "outbound",
        message_type:    "text",
        content:         text,
        status:          "sent",
        sent_by_id:      user?.uid,
        sent_by_name:    displayName,
      });

      // Update conversation last message
      await supabaseServiceRole.from("whatsapp_conversations").update({
        last_message:    text,
        last_message_at: new Date().toISOString(),
      }).eq("id", selectedConv.id);

      loadConversations();
    } catch (err: any) {
      setSettingsError(err?.message ?? "Failed to send message. Check your WhatsApp settings.");
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  // ── Filter conversations ───────────────────────────────────────────────────

  const filtered = search
    ? conversations.filter(c =>
        (c.contact_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        c.contact_phone.includes(search)
      )
    : conversations;

  const totalUnread = conversations.reduce((n, c) => n + (c.unread_count ?? 0), 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-40 flex overflow-hidden" style={{ background: "var(--background)" }}>

      {/* ══ LEFT PANEL — Conversation list ══════════════════════════════════════ */}
      <div className={cn(
        "flex flex-col border-r border-border shrink-0 bg-card",
        "w-full md:w-[360px] lg:w-[380px]",
        selectedId && "hidden md:flex",
      )}>

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Button variant="ghost" size="icon" onClick={onClose}
            className="text-muted-foreground hover:text-foreground shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2 flex-1">
            <div className="h-8 w-8 rounded-full bg-green-500 flex items-center justify-center shrink-0">
              <Phone className="h-4 w-4 text-white" />
            </div>
            <span className="font-semibold text-foreground">WhatsApp Messenger</span>
            {totalUnread > 0 && (
              <Badge className="bg-green-500 text-white text-xs px-1.5 h-5 rounded-full">
                {totalUnread}
              </Badge>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search conversations…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 rounded-full text-sm bg-background border-border"
            />
            {search && (
              <button onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {loadingConvs ? (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-sm gap-2">
              <Clock className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 px-8 text-center">
              <MessageCircle className="h-14 w-14 text-green-500/20" />
              <p className="font-medium text-foreground">
                {search ? "No conversations found" : "No messages yet"}
              </p>
              <p className="text-xs text-muted-foreground">
                {search
                  ? "Try a different name or number"
                  : "When customers WhatsApp you, their messages will appear here in real-time"
                }
              </p>
            </div>
          ) : (
            filtered.map(conv => {
              const name  = conv.contact_name ?? conv.contact_phone;
              const color = avatarColor(name);
              const active = conv.id === selectedId;
              return (
                <button
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 border-b border-border/40 text-left transition-colors",
                    active
                      ? "bg-green-500/10 border-l-2 border-l-green-500"
                      : "hover:bg-accent/60"
                  )}
                >
                  {/* Avatar */}
                  <div
                    className="h-11 w-11 rounded-full flex items-center justify-center text-white font-semibold text-base shrink-0 shadow-sm"
                    style={{ backgroundColor: color }}
                  >
                    {name.charAt(0).toUpperCase()}
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn(
                        "text-sm font-medium truncate",
                        conv.unread_count > 0 ? "text-foreground" : "text-foreground/80"
                      )}>
                        {name}
                      </span>
                      <span className={cn(
                        "text-[11px] shrink-0",
                        conv.unread_count > 0 ? "text-green-500" : "text-muted-foreground"
                      )}>
                        {convTime(conv.last_message_at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className={cn(
                        "text-xs truncate",
                        conv.unread_count > 0 ? "text-foreground/70 font-medium" : "text-muted-foreground"
                      )}>
                        {conv.last_message ?? ""}
                      </span>
                      {conv.unread_count > 0 && (
                        <span className="h-5 min-w-5 px-1.5 bg-green-500 text-white text-[11px] font-semibold rounded-full flex items-center justify-center shrink-0">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ══ RIGHT PANEL — Chat view ══════════════════════════════════════════════ */}
      <div className={cn(
        "flex-1 flex flex-col min-w-0",
        !selectedId && "hidden md:flex",
      )}>

        {/* Empty state */}
        {!selectedConv ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 text-muted-foreground">
            <div className="h-24 w-24 rounded-full bg-green-500/10 flex items-center justify-center">
              <MessageCircle className="h-12 w-12 text-green-400" />
            </div>
            <div className="text-center max-w-xs">
              <p className="text-xl font-semibold text-foreground">WhatsApp Messenger</p>
              <p className="text-sm mt-2 text-muted-foreground">
                Select a conversation from the left to view messages and reply
              </p>
              <p className="text-xs mt-3 opacity-60">
                All messages update in real-time across all staff
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* ── Chat header ──────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border shrink-0">
              {/* Back button (mobile) */}
              <Button variant="ghost" size="icon"
                className="md:hidden text-muted-foreground shrink-0"
                onClick={() => setSelectedId(null)}>
                <ArrowLeft className="h-5 w-5" />
              </Button>

              {/* Avatar */}
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-white font-semibold text-base shrink-0"
                style={{ backgroundColor: avatarColor(selectedConv.contact_name ?? selectedConv.contact_phone) }}
              >
                {(selectedConv.contact_name ?? selectedConv.contact_phone).charAt(0).toUpperCase()}
              </div>

              {/* Name + number */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground leading-tight">
                  {selectedConv.contact_name ?? selectedConv.contact_phone}
                </p>
                {selectedConv.contact_name && (
                  <p className="text-xs text-muted-foreground leading-tight">
                    {selectedConv.contact_phone}
                  </p>
                )}
              </div>

              {/* Window status */}
              {windowExpiresIn && (
                <div className={cn(
                  "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full shrink-0",
                  windowSoonExpiring
                    ? "bg-amber-500/15 text-amber-400"
                    : "bg-green-500/10 text-green-400"
                )}>
                  <Clock className="h-3 w-3" />
                  Window closes {windowExpiresIn}
                </div>
              )}
              {windowExpired && selectedConv.window_expires_at && (
                <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground shrink-0">
                  <AlertTriangle className="h-3 w-3" />
                  Window closed
                </div>
              )}
            </div>

            {/* ── Error / settings banner ───────────────────────────────────────── */}
            {settingsError && (
              <div className="flex items-start gap-2 px-4 py-2.5 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs shrink-0">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{settingsError}</span>
                <button onClick={() => setSettingsError(null)} className="ml-auto shrink-0">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* ── 24h expired warning ───────────────────────────────────────────── */}
            {windowExpired && selectedConv.window_expires_at && (
              <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs shrink-0">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  The 24-hour messaging window has expired. Only pre-approved WhatsApp templates can be sent now.
                  Use <strong>Settings → WhatsApp</strong> to send a template.
                </span>
              </div>
            )}

            {/* ── Messages area ─────────────────────────────────────────────────── */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4 space-y-0.5"
              style={{ background: "var(--background)" }}
            >
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  No messages yet
                </div>
              ) : (
                groupMessages(messages).map(group => (
                  <div key={group.label}>
                    {/* Date divider */}
                    <div className="flex items-center justify-center my-4">
                      <span className="bg-card border border-border text-xs text-muted-foreground px-3 py-1 rounded-full">
                        {group.label}
                      </span>
                    </div>

                    {group.msgs.map((msg, i) => {
                      const isOut = msg.direction === "outbound";
                      const prevMsg = i > 0 ? group.msgs[i - 1] : null;
                      const sameDirection = prevMsg?.direction === msg.direction;
                      return (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex",
                            isOut ? "justify-end" : "justify-start",
                            sameDirection ? "mt-0.5" : "mt-2"
                          )}
                        >
                          <div className={cn(
                            "max-w-[72%] rounded-2xl px-3 py-2 shadow-sm relative",
                            isOut
                              ? "bg-[#005c4b] text-white rounded-tr-sm"
                              : "bg-card border border-border/60 text-foreground rounded-tl-sm"
                          )}>
                            {/* Staff name on outbound (multi-staff context) */}
                            {isOut && msg.sent_by_name && (
                              <p className="text-[10px] font-medium text-green-200/80 mb-0.5">
                                {msg.sent_by_name}
                              </p>
                            )}

                            {/* Message content */}
                            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                              {msg.content ?? `[${msg.message_type}]`}
                            </p>

                            {/* Timestamp + status */}
                            <div className={cn(
                              "flex items-center gap-1 mt-1",
                              isOut ? "justify-end" : "justify-end"
                            )}>
                              <span className={cn(
                                "text-[10px]",
                                isOut ? "text-white/50" : "text-muted-foreground/60"
                              )}>
                                {msgTime(msg.created_at)}
                              </span>
                              {isOut && <StatusTick status={msg.status} />}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* ── Input area ───────────────────────────────────────────────────── */}
            <div className="shrink-0 border-t border-border bg-card px-4 py-3">
              {windowExpired && selectedConv.window_expires_at ? (
                <div className="flex items-center justify-center py-2 text-sm text-muted-foreground gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  24-hour window expired — go to{" "}
                  <strong className="text-foreground">Settings → WhatsApp</strong>{" "}
                  to send a template
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    rows={1}
                    placeholder="Type a message"
                    onChange={e => {
                      setInput(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = Math.min(e.target.scrollHeight, 128) + "px";
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    className={cn(
                      "flex-1 resize-none rounded-2xl bg-background border border-border",
                      "px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground",
                      "focus:outline-none focus:ring-1 focus:ring-green-500",
                      "min-h-[40px] max-h-32 overflow-y-auto"
                    )}
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={!input.trim() || sending}
                    size="icon"
                    className="h-10 w-10 rounded-full bg-green-500 hover:bg-green-600 text-white shrink-0 disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
                Press Enter to send · Shift+Enter for new line
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
