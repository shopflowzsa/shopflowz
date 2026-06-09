import { useEffect, useRef, useState, useCallback } from "react";
import { Send, X, Minus, RotateCcw, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { addEcommerceNotification } from "@/lib/notificationService";
import { cn } from "@/lib/utils";
import {
  loadEcommerceBotSettings,
  findBestQA,
  searchProducts,
  fetchInStockSnapshot,
  type EcommerceBotSettings,
  type BotProductResult,
} from "@/lib/ecommerceBotService";

interface Props {
  workspaceId: string;
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  products?: BotProductResult[];
  ts: number;
};

const newId = () => `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export function EcommerceChatBubble({ workspaceId }: Props) {
  const [settings, setSettings] = useState<EcommerceBotSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load settings on mount; hide bubble if disabled
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const s = await loadEcommerceBotSettings(workspaceId);
      if (cancelled) return;
      if (s?.enabled) {
        setSettings(s);
        setMessages([{
          id: newId(),
          role: "assistant",
          content: s.welcome_message,
          ts: Date.now(),
        }]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const pushAssistant = useCallback((content: string, products?: BotProductResult[]) => {
    setMessages((prev) => [...prev, { id: newId(), role: "assistant", content, products, ts: Date.now() }]);
  }, []);

  const pushUser = useCallback((content: string) => {
    setMessages((prev) => [...prev, { id: newId(), role: "user", content, ts: Date.now() }]);
  }, []);

  // ── The decision tree ────────────────────────────────────────────────────
  const answer = useCallback(async (rawText: string, opts?: { fromButton?: boolean }) => {
    if (!settings) return;
    const text = rawText.trim();
    if (!text) return;
    setError(null);
    setThinking(true);

    try {
      // 1. Q&A keyword match (admin-trained answers)
      if (settings.enable_qa) {
        const qa = findBestQA(text, settings);
        if (qa) {
          pushAssistant(qa.entry.answer);
          return;
        }
      }

      // 2. Live product search — the bot acts like a smart search bar over
      //    the live inventory. No guessing equivalents, no substitutes — we
      //    only ever show parts we actually stock.
      if (settings.enable_product_search && !opts?.fromButton) {
        const directHits = await searchProducts(workspaceId, text, 5);
        if (directHits.length > 0) {
          pushAssistant(`Here's what I found:`, directHits);
          return;
        }
      }

      // 3. General LLM fallback (for paraphrased FAQ-style questions only,
      //    e.g. "can I pay on collection?"). Grounded with a small stock
      //    snapshot so the model is anchored in reality.
      if (settings.enable_llm_fallback) {
        const snapshot = await fetchInStockSnapshot(workspaceId, null, 40);
        const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
        const { data, error: invokeErr } = await supabase.functions.invoke("ecommerce-bot", {
          body: {
            workspace_id: workspaceId,
            mode: "general",
            stock_snapshot: snapshot,
            messages: [...history, { role: "user", content: text }],
          },
        });
        if (invokeErr || data?.error) {
          pushAssistant(settings.fallback_message);
          return;
        }
        pushAssistant(data.content || settings.fallback_message);
        return;
      }

      // 5. Nothing matched
      pushAssistant(settings.fallback_message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      pushAssistant(settings.fallback_message);
    } finally {
      setThinking(false);
    }
  }, [settings, messages, pushAssistant, workspaceId]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || !settings || thinking) return;
    setInput("");
    pushUser(text);
    void answer(text);
    // Notify store owner of chatbot inquiry (only on first message per session)
    const userMsgCount = messages.filter(m => m.role === 'user').length;
    if (userMsgCount === 0) {
      void addEcommerceNotification(workspaceId, {
        type: 'query',
        title: 'New store chat inquiry',
        body: text.length > 80 ? text.slice(0, 80) + '…' : text,
        link: 'ecommerce',
      }).catch(() => {});
    }
  };

  const handleQuickButton = (label: string, presetAnswer: string) => {
    pushUser(label);
    // Buttons have a pre-written answer — show it directly, skip the brain.
    pushAssistant(presetAnswer);
  };

  const resetChat = () => {
    if (!settings) return;
    setMessages([{ id: newId(), role: "assistant", content: settings.welcome_message, ts: Date.now() }]);
    setInput("");
    setError(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) return null;
  if (!settings) return null;

  // Collapsed bubble — SR Assistant avatar, matches the staff bot
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open ${settings.bot_name}`}
        className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full overflow-hidden bg-white ring-2 ring-cyan-400/50 shadow-lg shadow-cyan-500/30 transition-transform hover:scale-105 active:scale-95 flex items-center justify-center"
      >
        <img
          src="/sr-bot.jpg"
          alt=""
          aria-hidden
          className="h-full w-full object-contain select-none pointer-events-none"
          draggable={false}
        />
        <span aria-hidden className="absolute inset-2 rounded-full bg-cyan-300/30 blur-md -z-10 animate-pulse" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "fixed bottom-5 right-5 z-50",
        "w-[360px] sm:w-[400px] h-[560px]",
        "flex flex-col rounded-2xl bg-white overflow-hidden",
        "shadow-2xl ring-1 ring-black/10",
        "animate-in slide-in-from-bottom-2 fade-in duration-200",
      )}
    >
      {/* Header — matches the staff SR Assistant style */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-cyan-500 to-emerald-500 text-white">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src="/sr-bot.jpg"
            alt=""
            aria-hidden
            className="h-8 w-8 rounded-full bg-white object-cover shrink-0 ring-1 ring-white/40"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">{settings.bot_name}</p>
            <p className="text-[10px] opacity-90 leading-tight">Online support</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={resetChat} title="Start over" className="p-1 rounded-md hover:bg-white/15">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setOpen(false)} title="Minimise" className="p-1 rounded-md hover:bg-white/15">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setOpen(false)} title="Close" className="p-1 rounded-md hover:bg-white/15">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-slate-50">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
                m.role === "user"
                  ? "bg-cyan-500 text-white rounded-br-sm"
                  : "bg-white text-slate-800 rounded-bl-sm shadow-sm ring-1 ring-black/5",
              )}
            >
              {m.content}
              {m.products && m.products.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {m.products.map((p) => (
                    <a
                      key={p.id}
                      href={`/store/product/${p.id}`}
                      className="flex items-center gap-2 p-2 rounded-md bg-slate-50 hover:bg-slate-100 transition-colors text-slate-800"
                    >
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" className="h-10 w-10 object-cover rounded bg-white shrink-0" />
                      ) : (
                        <div className="h-10 w-10 bg-slate-200 rounded shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{p.name}</p>
                        <p className="text-[10px] text-slate-500">{p.sku}{p.quantity > 0 ? ` · ${p.quantity} in stock` : " · out of stock"}</p>
                      </div>
                      <span className="text-xs font-bold text-orange-600">R{p.price.toFixed(2)}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="bg-white rounded-2xl rounded-bl-sm px-3 py-2 flex gap-1 shadow-sm ring-1 ring-black/5">
              <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
              <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-100" />
              <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-200" />
            </div>
          </div>
        )}
        {error && (
          <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-md px-2 py-1">
            {error}
          </div>
        )}
      </div>

      {/* Quick buttons */}
      {settings.enable_quick_buttons && settings.quick_buttons.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 py-2 border-t bg-white">
          {settings.quick_buttons.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => handleQuickButton(b.label, b.answer)}
              disabled={thinking}
              className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200 hover:bg-cyan-100 disabled:opacity-50"
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-2.5 border-t bg-white flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={thinking ? "Thinking…" : "Type a message…"}
          rows={1}
          className="flex-1 resize-none min-h-[36px] max-h-24 text-sm bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-cyan-400"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || thinking}
          className="h-9 w-9 rounded-full bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-300 text-white flex items-center justify-center transition-colors shrink-0"
        >
          {thinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
