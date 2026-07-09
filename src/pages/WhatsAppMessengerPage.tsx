import { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowLeft, Search, Send, MessageCircle, Check, CheckCheck,
  Clock, AlertTriangle, Phone, X, Settings, Volume2, Bell, VolumeX, ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { loadWhatsAppSettings } from "@/lib/whatsappService";
import { WhatsAppContactTaskPanel } from "@/components/crm/WhatsAppContactTaskPanel";
import { format, isToday, isYesterday, formatDistanceToNow, isPast } from "date-fns";
import { cn } from "@/lib/utils";
import {
  getWaNotifSettings, saveWaNotifSettings, playWaSound,
  WA_SOUNDS, WA_REMINDER_OPTIONS, type WaNotifSettings,
} from "@/lib/waNotificationService";

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
  last_replied_by_name: string | null;
  pending_message: string | null;
  pending_message_by: string | null;
  created_at: string;
}

interface WaMessage {
  id: string;
  conversation_id: string;
  wamid: string | null;
  direction: "inbound" | "outbound";
  message_type: string;
  content: string | null;
  media_url: string | null;
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
  onUnreadCountChange?: (count: number) => void;
  onSettingsChange?: (s: WaNotifSettings) => void;
}

export function WhatsAppMessengerPage({ onClose, onUnreadCountChange, onSettingsChange }: Props) {
  const { workspaceId, user, members } = useAuth();

  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [messages, setMessages]           = useState<WaMessage[]>([]);
  const [input, setInput]                 = useState("");
  const [search, setSearch]               = useState("");
  const [loadingConvs, setLoadingConvs]   = useState(true);
  const [sending, setSending]             = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [showSettings, setShowSettings]   = useState(false);
  const [notifSettings, setNotifSettings] = useState<WaNotifSettings>(getWaNotifSettings);
  const [showTaskPanel, setShowTaskPanel] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  const selectedConv = conversations.find(c => c.id === selectedId) ?? null;
  const displayName  = members.find(m => m.uid === user?.uid)?.displayName ?? user?.email ?? "Staff";

  const windowExpired = selectedConv?.window_expires_at
    ? isPast(new Date(selectedConv.window_expires_at))
    : true;

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
        setSelectedId(prev => {
          if (msg.conversation_id === prev) {
            setMessages(m => {
              // Replace optimistic (tmp_) entry if wamid matches, otherwise append
              if (msg.wamid && m.some(x => x.wamid === msg.wamid)) {
                return m.map(x => x.wamid === msg.wamid ? msg : x);
              }
              if (m.some(x => x.id === msg.id)) return m;
              return [...m, msg];
            });
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

      // ── Window expired: send re-opener template first, queue the message ──
      if (windowExpired && selectedConv.window_expires_at) {
        const reopenerTemplate = settings.reopenerTemplate?.trim();
        if (!reopenerTemplate) {
          setSettingsError("24-hour window expired. Set a Re-opener Template in Settings → WhatsApp to auto-queue messages.");
          setSending(false);
          return;
        }

        // Send the re-opener template
        const contactName = selectedConv.contact_name ?? selectedConv.contact_phone;
        const tplBody: any = {
          messaging_product: "whatsapp",
          to: selectedConv.contact_phone,
          type: "template",
          template: {
            name: reopenerTemplate,
            language: { code: settings.languageCode ?? "en_US" },
            components: [{
              type: "body",
              parameters: [{ type: "text", text: contactName }],
            }],
          },
        };

        const tplRes = await fetch(
          `https://graph.facebook.com/v19.0/${settings.phoneNumberId}/messages`,
          { method: "POST", headers: { Authorization: `Bearer ${settings.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(tplBody) },
        );
        const tplData = await tplRes.json();
        if (!tplRes.ok) throw new Error(tplData?.error?.message ?? `Re-opener failed: ${tplRes.status}`);

        const tplWamid: string | undefined = tplData.messages?.[0]?.id;

        // Save re-opener as a sent message
        await supabaseServiceRole.from("whatsapp_messages").insert({
          workspace_id: workspaceId, conversation_id: selectedConv.id,
          wamid: tplWamid ?? null, direction: "outbound", message_type: "template",
          content: `[Re-opener: ${reopenerTemplate}]`, status: "sent", sent_by_name: displayName,
        });

        // Queue the actual message
        await supabaseServiceRole.from("whatsapp_conversations").update({
          pending_message:    text,
          pending_message_by: displayName,
          last_message:       `[Re-opener sent — awaiting reply]`,
          last_message_at:    new Date().toISOString(),
          last_replied_by_name: displayName,
        }).eq("id", selectedConv.id);

        setConversations(prev => prev.map(c =>
          c.id === selectedConv.id
            ? { ...c, pending_message: text, pending_message_by: displayName, last_replied_by_name: displayName }
            : c
        ));
        loadMessages(selectedConv.id);
        loadConversations();
        setSending(false);
        setTimeout(() => inputRef.current?.focus(), 50);
        return;
      }

      // ── Normal send ────────────────────────────────────────────────────────
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${settings.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${settings.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: selectedConv.contact_phone, type: "text", text: { body: text } }),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `Meta API error ${res.status}`);

      const wamid: string | undefined = data.messages?.[0]?.id;

      const optimistic: WaMessage = {
        id: `tmp_${Date.now()}`, conversation_id: selectedConv.id,
        wamid: wamid ?? null, direction: "outbound", message_type: "text",
        content: text, status: "sent", sent_by_name: displayName, created_at: new Date().toISOString(),
        media_url: null,
      };
      setMessages(prev => [...prev, optimistic]);

      await supabaseServiceRole.from("whatsapp_messages").insert({
        workspace_id: workspaceId, conversation_id: selectedConv.id,
        wamid: wamid ?? null, direction: "outbound", message_type: "text",
        content: text, status: "sent", sent_by_id: user?.uid, sent_by_name: displayName,
      });

      await supabaseServiceRole.from("whatsapp_conversations").update({
        last_message: text, last_message_at: new Date().toISOString(), last_replied_by_name: displayName,
      }).eq("id", selectedConv.id);

      setConversations(prev => prev.map(c =>
        c.id === selectedConv.id ? { ...c, last_message: text, last_replied_by_name: displayName } : c
      ));
      loadConversations();
    } catch (err: any) {
      setSettingsError(err?.message ?? "Failed to send message. Check your WhatsApp settings.");
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function cancelPendingMessage() {
    if (!selectedConv) return;
    await supabaseServiceRole.from("whatsapp_conversations").update({
      pending_message: null, pending_message_by: null,
    }).eq("id", selectedConv.id);
    setConversations(prev => prev.map(c =>
      c.id === selectedConv.id ? { ...c, pending_message: null, pending_message_by: null } : c
    ));
  }

  // ── Notification settings ──────────────────────────────────────────────────

  function updateNotifSettings(patch: Partial<WaNotifSettings>) {
    const next = { ...notifSettings, ...patch };
    setNotifSettings(next);
    saveWaNotifSettings(next);
    onSettingsChange?.(next);
  }

  // ── Filter conversations ───────────────────────────────────────────────────

  const filtered = search
    ? conversations.filter(c =>
        (c.contact_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        c.contact_phone.includes(search)
      )
    : conversations;

  const totalUnread = conversations.reduce((n, c) => n + (c.unread_count ?? 0), 0);

  useEffect(() => {
    onUnreadCountChange?.(totalUnread);
  }, [totalUnread]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="absolute inset-0 z-30 flex overflow-hidden bg-background">

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
          {/* Notification settings button */}
          <Button
            variant="ghost" size="icon"
            onClick={() => setShowSettings(s => !s)}
            className={cn(
              "shrink-0 text-muted-foreground hover:text-foreground",
              showSettings && "bg-accent text-foreground"
            )}
            title="Notification settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        {/* Notification settings panel */}
        {showSettings && (
          <div className="border-b border-border bg-background px-4 py-4 space-y-4 shrink-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notification Settings</p>

            {/* Sound selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5 text-green-500" /> Message Sound
              </label>
              <div className="flex flex-wrap gap-1.5">
                {WA_SOUNDS.map(s => (
                  <button
                    key={s.id}
                    onClick={() => updateNotifSettings({ sound: s.id })}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                      notifSettings.sound === s.id
                        ? "bg-green-500 text-white border-green-500"
                        : "border-border text-muted-foreground hover:border-green-500 hover:text-foreground"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {notifSettings.sound !== "none" && (
                <button
                  onClick={() => playWaSound(notifSettings.sound)}
                  className="text-xs text-green-500 hover:text-green-400 underline underline-offset-2"
                >
                  Test sound
                </button>
              )}
            </div>

            {/* Recurring reminder */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5 text-green-500" /> Unanswered Message Reminder
              </label>
              <div className="flex flex-wrap gap-1.5">
                {WA_REMINDER_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    onClick={() => updateNotifSettings({ reminderMinutes: o.value })}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                      notifSettings.reminderMinutes === o.value
                        ? "bg-green-500 text-white border-green-500"
                        : "border-border text-muted-foreground hover:border-green-500 hover:text-foreground"
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Plays sound again if there are unread messages after the set time
              </p>
            </div>

            {notifSettings.sound === "none" && notifSettings.reminderMinutes === 0 && (
              <div className="flex items-center gap-1.5 text-xs text-amber-400">
                <VolumeX className="h-3.5 w-3.5" /> All notifications are off
              </div>
            )}
          </div>
        )}

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
                    {/* Who last replied */}
                    {conv.last_replied_by_name && conv.unread_count === 0 && (
                      <p className="text-[11px] text-green-500/80 truncate mt-0.5">
                        ✓ Replied by {conv.last_replied_by_name}
                      </p>
                    )}
                    {!conv.last_replied_by_name && conv.unread_count > 0 && (
                      <p className="text-[11px] text-amber-400 truncate mt-0.5">
                        ⚠ Awaiting reply
                      </p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ══ RIGHT PANEL — Chat view ══════════════════════════════════════════════ */}
      <div className={cn(
        "flex-1 flex min-w-0 bg-background",
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
          <div className="flex flex-1 min-w-0">
            {/* ── Chat column ──────────────────────────────────────────────────── */}
            <div className="flex flex-col flex-1 min-w-0">
            {/* ── Chat header ──────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border shrink-0">
              <Button variant="ghost" size="icon"
                className="md:hidden text-muted-foreground shrink-0"
                onClick={() => setSelectedId(null)}>
                <ArrowLeft className="h-5 w-5" />
              </Button>

              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-white font-semibold text-base shrink-0"
                style={{ backgroundColor: avatarColor(selectedConv.contact_name ?? selectedConv.contact_phone) }}
              >
                {(selectedConv.contact_name ?? selectedConv.contact_phone).charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground leading-tight">
                  {selectedConv.contact_name ?? selectedConv.contact_phone}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {selectedConv.contact_name && (
                    <p className="text-xs text-muted-foreground leading-tight">
                      {selectedConv.contact_phone}
                    </p>
                  )}
                  {selectedConv.last_replied_by_name ? (
                    <p className="text-[11px] text-green-500/80 leading-tight">
                      · Last replied by <strong>{selectedConv.last_replied_by_name}</strong>
                    </p>
                  ) : (
                    <p className="text-[11px] text-amber-400 leading-tight">· No reply yet</p>
                  )}
                </div>
              </div>

              {/* Task panel toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowTaskPanel(s => !s)}
                className={cn(
                  "shrink-0 text-muted-foreground hover:text-foreground",
                  showTaskPanel && "bg-green-500/10 text-green-500"
                )}
                title="Show linked tasks"
              >
                <ClipboardList className="h-4 w-4" />
              </Button>

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

            {/* ── Error banner ─────────────────────────────────────────────────── */}
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
                            "max-w-[72%] rounded-2xl px-3 py-2 shadow-sm",
                            isOut
                              ? "bg-[#005c4b] text-white rounded-tr-sm"
                              : "bg-card border border-border/60 text-foreground rounded-tl-sm"
                          )}>
                            {isOut && msg.sent_by_name && (
                              <p className="text-[10px] font-semibold text-green-200/90 mb-0.5">
                                {msg.sent_by_name}
                              </p>
                            )}

                            {/* Media */}
                            {msg.media_url && msg.message_type === "image" && (
                              <img
                                src={msg.media_url}
                                alt="Image"
                                className="max-w-full rounded-lg max-h-64 object-contain mb-1 cursor-pointer"
                                onClick={() => window.open(msg.media_url!, "_blank")}
                              />
                            )}
                            {msg.media_url && msg.message_type === "video" && (
                              <video src={msg.media_url} controls className="max-w-full rounded-lg max-h-48 mb-1" />
                            )}
                            {msg.media_url && msg.message_type === "audio" && (
                              <audio src={msg.media_url} controls className="w-full mb-1" />
                            )}
                            {msg.media_url && msg.message_type === "document" && (
                              <a href={msg.media_url} target="_blank" rel="noreferrer"
                                className="flex items-center gap-2 text-xs underline mb-1 opacity-80">
                                📎 Download document
                              </a>
                            )}
                            {/* Text / caption */}
                            {msg.content ? (
                              <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                            ) : !msg.media_url ? (
                              <p className="text-sm italic opacity-60">
                                {msg.message_type === "unsupported"
                                  ? "🔒 View-once or unsupported message"
                                  : msg.message_type === "sticker"
                                  ? "🪄 Sticker"
                                  : msg.message_type === "location"
                                  ? "📍 Location (open WhatsApp to view)"
                                  : msg.message_type === "contacts"
                                  ? "👤 Contact card"
                                  : msg.message_type === "reaction"
                                  ? "👍 Reaction"
                                  : `[${msg.message_type}]`}
                              </p>
                            ) : null}

                            <div className="flex items-center gap-1 mt-1 justify-end">
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
            <div className="shrink-0 border-t border-border bg-card px-4 py-3 space-y-2">
              {/* Pending message notice */}
              {selectedConv.pending_message && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                  <Clock className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-amber-400">Message queued — waiting for reply to re-opener</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">"{selectedConv.pending_message}"</p>
                  </div>
                  <button onClick={cancelPendingMessage} className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5" title="Cancel queued message">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {/* Expired window hint (only if no pending message already) */}
              {windowExpired && selectedConv.window_expires_at && !selectedConv.pending_message && (
                <div className="flex items-center gap-2 text-xs text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Window expired — a re-opener template will be sent automatically before your message.
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  rows={1}
                  placeholder={selectedConv.pending_message ? "Message queued — waiting for client reply…" : "Type a message"}
                  disabled={!!selectedConv.pending_message}
                  onChange={e => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 128) + "px";
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                  }}
                  className={cn(
                    "flex-1 resize-none rounded-2xl bg-background border border-border",
                    "px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground",
                    "focus:outline-none focus:ring-1 focus:ring-green-500",
                    "min-h-[40px] max-h-32 overflow-y-auto",
                    selectedConv.pending_message && "opacity-50 cursor-not-allowed",
                  )}
                />
                <Button
                  onClick={sendMessage}
                  disabled={!input.trim() || sending || !!selectedConv.pending_message}
                  size="icon"
                  className="h-10 w-10 rounded-full bg-green-500 hover:bg-green-600 text-white shrink-0 disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground/50 text-center">
                Press Enter to send · Shift+Enter for new line
              </p>
            </div>
            </div>{/* end chat column */}

            {/* ── Linked task panel ──────────────────────────────────────────── */}
            {showTaskPanel && workspaceId && (
              <WhatsAppContactTaskPanel
                workspaceId={workspaceId}
                contactPhone={selectedConv.contact_phone}
                contactName={selectedConv.contact_name}
                onClose={() => setShowTaskPanel(false)}
                onTaskClick={_taskId => {
                  setShowTaskPanel(false);
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
