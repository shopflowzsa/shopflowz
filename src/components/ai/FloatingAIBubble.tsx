import { useEffect, useRef, useState } from "react";
import { Send, RotateCcw, Minus, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";
import { askInternalBot, type BotResponse } from "@/lib/internalBotService";

interface FloatingAIBubbleProps {
  open?: boolean;
  workspaceId?: string;
  userId?: string;
}

const GREETING = "Hello! Ask me anything about the app.";

export function FloatingAIBubble(_props: FloatingAIBubbleProps) {
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [currentResponse, setCurrentResponse] = useState<BotResponse | null>(null);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [typedGreeting, setTypedGreeting] = useState("");
  const [navConfirm, setNavConfirm] = useState(false); // "Should I take you there?" mode

  const [minimized, setMinimized] = useState<boolean>(() => {
    try { return window.localStorage.getItem("srBotMinimized") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("srBotMinimized", minimized ? "1" : "0"); } catch { /**/ }
  }, [minimized]);

  const [hasUnread, setHasUnread] = useState(false);

  const [pos, setPos] = useState<{ right: number; bottom: number }>(() => {
    try {
      const saved = window.localStorage.getItem("srBotPos");
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p?.right === "number" && typeof p?.bottom === "number") return p;
      }
    } catch { /**/ }
    return { right: 24, bottom: 24 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startRight: number; startBottom: number; moved: boolean } | null>(null);

  const answerScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Typewriter greeting
  useEffect(() => {
    if (currentResponse || currentQuestion || isTyping) return;
    setTypedGreeting("");
    let i = 0;
    const t = setTimeout(() => {
      const iv = setInterval(() => {
        i += 1;
        setTypedGreeting(GREETING.slice(0, i));
        if (i >= GREETING.length) clearInterval(iv);
      }, 35);
      return () => clearInterval(iv);
    }, 400);
    return () => clearTimeout(t);
  }, [currentResponse, currentQuestion, isTyping]);

  useEffect(() => {
    answerScrollRef.current?.scrollTo({ top: answerScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [currentResponse, isTyping]);

  useEffect(() => {
    if (!currentResponse) return;
    if (minimized) setHasUnread(true);
  }, [currentResponse, minimized]);

  useEffect(() => {
    if (!minimized) setHasUnread(false);
  }, [minimized]);

  const sendQuestion = (text: string) => {
    if (!text.trim()) return;
    setCurrentQuestion(text);
    setCurrentResponse(null);
    setNavConfirm(false);
    setIsTyping(true);
    setTimeout(() => {
      const res = askInternalBot(text);
      setCurrentResponse(res);
      setIsTyping(false);
      // If the response has a navigate target, ask if they want to go there
      if (res.navigate) setNavConfirm(true);
    }, 380);
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
    setCurrentQuestion("");
    setCurrentResponse(null);
    setNavConfirm(false);
    setIsTyping(false);
    setInput("");
  };

  const handleNavigate = () => {
    if (!currentResponse?.navigate) return;
    window.dispatchEvent(new CustomEvent("shopflowz-navigate", { detail: { target: currentResponse.navigate } }));
    setNavConfirm(false);
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
    const BOT_SIZE = 224;
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
      try { window.localStorage.setItem("srBotPos", JSON.stringify(pos)); } catch { /**/ }
      suppressNextClickRef.current = true;
    }
    setIsDragging(false);
    dragRef.current = null;
  };

  const onBotClick = () => {
    if (suppressNextClickRef.current) { suppressNextClickRef.current = false; return; }
    resetChat();
  };

  const showAnswerBalloon = !!currentResponse || isTyping;
  const showQuestionBalloon = !!currentQuestion;

  // ── Minimized ─────────────────────────────────────────────────────────────
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        aria-label="Open ShopFlowz Assistant"
        className={cn(
          "fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full overflow-hidden bg-white",
          "flex items-center justify-center ring-2 ring-cyan-400/50",
          "shadow-lg shadow-cyan-500/30 transition-transform duration-150 hover:scale-110 active:scale-95 pointer-events-auto",
        )}
      >
        <img src="/sr-bot.jpg" alt="" aria-hidden className="h-full w-full object-contain select-none pointer-events-none" draggable={false} />
        {hasUnread && <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-rose-500 ring-2 ring-white" aria-hidden />}
      </button>
    );
  }

  return (
    <div className="fixed z-50 flex items-end gap-3 pointer-events-none" style={{ right: `${pos.right}px`, bottom: `${pos.bottom}px` }}>
      <div className="flex flex-col items-end gap-2 max-w-[420px] pointer-events-auto">

        {/* Question balloon */}
        {showQuestionBalloon && (
          <div className="px-4 py-2.5 rounded-2xl rounded-br-sm bg-cyan-500 text-white text-sm font-medium shadow-lg shadow-cyan-500/30 ring-1 ring-white/20 animate-in slide-in-from-bottom-2 fade-in duration-200 max-w-[420px] break-words whitespace-pre-wrap">
            {currentQuestion}
          </div>
        )}

        {/* Answer balloon */}
        {showAnswerBalloon ? (
          <div className="w-[420px] max-h-[500px] flex flex-col rounded-2xl rounded-br-sm bg-white text-slate-800 shadow-2xl shadow-cyan-500/20 ring-1 ring-cyan-200 animate-in slide-in-from-bottom-2 fade-in duration-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-2 pb-1 border-b border-slate-100">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-cyan-600">ShopFlowz Assistant</span>
              <div className="flex items-center gap-0.5">
                <button type="button" onClick={resetChat} title="Start over" className="p-1 rounded-md hover:bg-slate-100 text-slate-400">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setMinimized(true)} title="Minimise" className="p-1 rounded-md hover:bg-slate-100 text-slate-400">
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Answer body */}
            <div ref={answerScrollRef} className="flex-1 overflow-y-auto px-4 py-3 text-sm break-words">
              {isTyping && (
                <div className="flex items-center gap-2 text-slate-400 py-1">
                  <span className="flex gap-1">
                    {[0, 150, 300].map((d) => (
                      <span key={d} className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </span>
                  <span className="text-xs">Thinking…</span>
                </div>
              )}
              {currentResponse && (
                <div className="whitespace-pre-wrap leading-relaxed">
                  {currentResponse.answer}
                </div>
              )}

              {/* Navigation CTA — appears below the answer */}
              {currentResponse?.navigate && navConfirm && (
                <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5 flex items-center justify-between gap-3">
                  <p className="text-xs text-cyan-800 font-medium">Should I take you there?</p>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleNavigate}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 text-white text-xs font-semibold hover:bg-cyan-600 transition-colors"
                    >
                      <Navigation className="h-3 w-3" />
                      Yes, take me there
                    </button>
                    <button
                      type="button"
                      onClick={() => setNavConfirm(false)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs hover:bg-slate-50 transition-colors"
                    >
                      No thanks
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Follow-up input */}
            <div className="px-3 pb-3 pt-2 border-t border-slate-100">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a follow-up question…"
                  rows={1}
                  className="flex-1 resize-none min-h-[36px] max-h-24 text-sm bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-cyan-400"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className="h-9 w-9 rounded-full flex items-center justify-center bg-cyan-500 text-white hover:bg-cyan-600 disabled:bg-slate-300 transition-colors shrink-0"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

        ) : (
          /* Idle / greeting balloon */
          <div className="relative w-[420px] flex flex-col rounded-2xl rounded-br-sm bg-gradient-to-br from-cyan-50 to-emerald-50 shadow-2xl shadow-cyan-500/20 ring-1 ring-cyan-200 animate-in slide-in-from-bottom-2 fade-in duration-300">
            <button type="button" onClick={() => setMinimized(true)} title="Minimise" className="absolute top-2 right-2 p-1 rounded-md hover:bg-white/60 text-cyan-700/70">
              <Minus className="h-3.5 w-3.5" />
            </button>
            <div className="px-4 pt-3 pb-1 pr-10 text-cyan-700 font-bold text-base">
              {typedGreeting}
              <span className="inline-block w-[2px] h-4 ml-0.5 align-middle bg-cyan-600" style={{ animation: "blink 1s step-end infinite" }} />
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
                  className="flex-1 resize-none min-h-[36px] max-h-24 text-sm bg-white/80 border border-cyan-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-cyan-400"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className="h-9 w-9 rounded-full flex items-center justify-center bg-cyan-500 text-white hover:bg-cyan-600 disabled:bg-slate-300 transition-colors shrink-0"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Draggable bot image */}
      <button
        type="button"
        onClick={onBotClick}
        onPointerDown={onBotPointerDown}
        onPointerMove={onBotPointerMove}
        onPointerUp={onBotPointerUp}
        onPointerCancel={onBotPointerUp}
        aria-label="ShopFlowz Assistant"
        title="Click to start over · drag to move"
        className={cn(
          "relative h-56 w-56 rounded-full overflow-hidden bg-white flex items-center justify-center",
          "ring-2 ring-cyan-400/50 transition-transform duration-200",
          isDragging ? "cursor-grabbing scale-105" : "cursor-grab hover:scale-105 active:scale-95",
          "drop-shadow-[0_14px_24px_rgba(74,222,222,0.5)] pointer-events-auto touch-none select-none",
        )}
      >
        <span className="absolute inset-4 rounded-full bg-cyan-300/30 blur-md -z-10 animate-pulse" aria-hidden />
        <img src="/sr-bot.jpg" alt="" aria-hidden className="h-full w-full object-contain select-none pointer-events-none" draggable={false} />
      </button>

      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
    </div>
  );
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
