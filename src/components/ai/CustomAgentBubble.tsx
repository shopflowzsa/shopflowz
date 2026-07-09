import { useEffect, useRef, useState } from "react";
import { Send, RotateCcw, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { sendMessage, type CustomAgentBubbleInfo, type ChatMessage } from "@/lib/customAgentService";

interface CustomAgentBubbleProps {
  agent: CustomAgentBubbleInfo;
  workspaceId: string;
  userId: string;
  index: number;
}

export function CustomAgentBubble({ agent, workspaceId, index }: CustomAgentBubbleProps) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const posKey = `customBot_${agent.id}_pos`;
  const minimizedKey = `customBot_${agent.id}_minimized`;

  const [minimized, setMinimized] = useState<boolean>(() => {
    try { return window.localStorage.getItem(minimizedKey) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(minimizedKey, minimized ? "1" : "0"); } catch { /**/ }
  }, [minimized, minimizedKey]);

  const [hasUnread, setHasUnread] = useState(false);

  const defaultRight = 24 + (index + 1) * 90;
  const [pos, setPos] = useState<{ right: number; bottom: number }>(() => {
    try {
      const saved = window.localStorage.getItem(posKey);
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p?.right === "number" && typeof p?.bottom === "number") return p;
      }
    } catch { /**/ }
    return { right: defaultRight, bottom: 24 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startRight: number; startBottom: number; moved: boolean } | null>(null);

  const answerScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    answerScrollRef.current?.scrollTo({ top: answerScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history, isTyping]);

  useEffect(() => {
    if (history.length === 0) return;
    if (minimized) setHasUnread(true);
  }, [history, minimized]);

  useEffect(() => {
    if (!minimized) setHasUnread(false);
  }, [minimized]);

  const sendQuestion = async (text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    const nextHistory = [...history, userMsg];
    setHistory(nextHistory);
    setIsTyping(true);
    setError(null);

    const result = await sendMessage(workspaceId, agent.id, nextHistory);
    setIsTyping(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setHistory((prev) => [...prev, { role: "assistant", content: result.answer }]);
  };

  const handleSend = () => {
    const t = input.trim();
    if (!t) return;
    setInput("");
    sendQuestion(t);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const resetChat = () => {
    setHistory([]);
    setInput("");
    setError(null);
    setIsTyping(false);
  };

  // ── Drag ──────────────────────────────────────────────────────────────────
  const DRAG_THRESHOLD = 4;
  const suppressNextClickRef = useRef(false);

  const onBotPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLButtonElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startRight: pos.right, startBottom: pos.bottom, moved: false };
  };

  const onBotPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    if (!isDragging) setIsDragging(true);
    const BOT_SIZE = 160;
    const MARGIN = 8;
    setPos({
      right: clamp(d.startRight - dx, MARGIN, window.innerWidth - BOT_SIZE - MARGIN),
      bottom: clamp(d.startBottom - dy, MARGIN, window.innerHeight - BOT_SIZE - MARGIN),
    });
  };

  const onBotPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    (e.currentTarget as HTMLButtonElement).releasePointerCapture?.(e.pointerId);
    if (d.moved) {
      try { window.localStorage.setItem(posKey, JSON.stringify(pos)); } catch { /**/ }
      suppressNextClickRef.current = true;
    }
    setIsDragging(false);
    dragRef.current = null;
  };

  const onBotClick = () => {
    if (suppressNextClickRef.current) { suppressNextClickRef.current = false; return; }
    resetChat();
  };

  const showChat = history.length > 0 || isTyping;

  // ── Minimized ─────────────────────────────────────────────────────────────
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        aria-label={`Open ${agent.agent_name}`}
        style={{ right: `${pos.right}px` }}
        className={cn(
          "fixed bottom-6 z-50 h-12 w-12 rounded-full overflow-hidden bg-white",
          "flex items-center justify-center ring-2 ring-violet-400/50 text-2xl",
          "shadow-lg shadow-violet-500/30 transition-transform duration-150 hover:scale-110 active:scale-95 pointer-events-auto",
        )}
      >
        {agent.avatar_emoji}
        {hasUnread && <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-rose-500 ring-2 ring-white" aria-hidden />}
      </button>
    );
  }

  return (
    <div className="fixed z-50 flex items-end gap-3 pointer-events-none" style={{ right: `${pos.right}px`, bottom: `${pos.bottom}px` }}>
      <div className="flex flex-col items-end gap-2 max-w-[420px] pointer-events-auto">
        {showChat && (
          <div className="w-[380px] max-h-[460px] flex flex-col rounded-2xl rounded-br-sm bg-white text-slate-800 shadow-2xl shadow-violet-500/20 ring-1 ring-violet-200 animate-in slide-in-from-bottom-2 fade-in duration-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-2 pb-1 border-b border-slate-100">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-violet-600 truncate">{agent.agent_name}</span>
              <div className="flex items-center gap-0.5 shrink-0">
                <button type="button" onClick={resetChat} title="Start over" className="p-1 rounded-md hover:bg-slate-100 text-slate-400">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setMinimized(true)} title="Minimise" className="p-1 rounded-md hover:bg-slate-100 text-slate-400">
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div ref={answerScrollRef} className="flex-1 overflow-y-auto px-4 py-3 text-sm break-words space-y-3">
              {history.map((m, i) => (
                <div key={i} className={cn("whitespace-pre-wrap leading-relaxed", m.role === "user" ? "text-right text-violet-700" : "text-slate-800")}>
                  {m.content}
                </div>
              ))}
              {isTyping && (
                <div className="flex items-center gap-2 text-slate-400 py-1">
                  <span className="flex gap-1">
                    {[0, 150, 300].map((d) => (
                      <span key={d} className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </span>
                  <span className="text-xs">Thinking…</span>
                </div>
              )}
              {error && <div className="text-xs text-red-500">⚠️ {error}</div>}
            </div>

            <div className="px-3 pb-3 pt-2 border-t border-slate-100">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a follow-up question…"
                  rows={1}
                  className="flex-1 resize-none min-h-[36px] max-h-24 text-sm bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className="h-9 w-9 rounded-full flex items-center justify-center bg-violet-500 text-white hover:bg-violet-600 disabled:bg-slate-300 transition-colors shrink-0"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ) }

        {!showChat && (
          <div className="relative w-[340px] flex flex-col rounded-2xl rounded-br-sm bg-gradient-to-br from-violet-50 to-fuchsia-50 shadow-2xl shadow-violet-500/20 ring-1 ring-violet-200 animate-in slide-in-from-bottom-2 fade-in duration-300">
            <button type="button" onClick={() => setMinimized(true)} title="Minimise" className="absolute top-2 right-2 p-1 rounded-md hover:bg-white/60 text-violet-700/70">
              <Minus className="h-3.5 w-3.5" />
            </button>
            <div className="px-4 pt-3 pb-1 pr-10 text-violet-700 font-bold text-sm truncate">
              {agent.agent_name}
            </div>
            <div className="px-3 pb-3 pt-2">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a question…"
                  rows={1}
                  className="flex-1 resize-none min-h-[36px] max-h-24 text-sm bg-white/80 border border-violet-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className="h-9 w-9 rounded-full flex items-center justify-center bg-violet-500 text-white hover:bg-violet-600 disabled:bg-slate-300 transition-colors shrink-0"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onBotClick}
        onPointerDown={onBotPointerDown}
        onPointerMove={onBotPointerMove}
        onPointerUp={onBotPointerUp}
        onPointerCancel={onBotPointerUp}
        aria-label={agent.agent_name}
        title="Click to start over · drag to move"
        className={cn(
          "relative h-16 w-16 rounded-full overflow-hidden bg-white flex items-center justify-center text-3xl",
          "ring-2 ring-violet-400/50 transition-transform duration-200",
          isDragging ? "cursor-grabbing scale-105" : "cursor-grab hover:scale-105 active:scale-95",
          "drop-shadow-[0_14px_24px_rgba(167,139,250,0.5)] pointer-events-auto touch-none select-none",
        )}
      >
        {agent.avatar_emoji}
      </button>
    </div>
  );
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
