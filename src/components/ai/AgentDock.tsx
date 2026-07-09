// Agent Dock — a single right-edge rail listing every available bot (the
// standard assistant + any enabled Custom AI Agents). Each entry is a small
// icon; clicking one opens its chat window. Only one chat is open at a time.
import { useEffect, useRef, useState } from "react";
import { Send, X, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";
import { askInternalBot } from "@/lib/internalBotService";
import { sendMessage as sendCustomAgentMessage, type CustomAgentBubbleInfo } from "@/lib/customAgentService";

interface AgentDockProps {
  workspaceId: string;
  customAgents: CustomAgentBubbleInfo[];
}

interface DockItem {
  key: string; // "standard" or a custom agent's id
  name: string;
  isStandard: boolean;
  avatarEmoji?: string;
}

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  navigate?: string;
  navigateLabel?: string;
}

export function AgentDock({ workspaceId, customAgents }: AgentDockProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const items: DockItem[] = [
    { key: "standard", name: "ShopFlowz Assistant", isStandard: true },
    ...customAgents.map((a) => ({ key: a.id, name: a.agent_name, isStandard: false, avatarEmoji: a.avatar_emoji })),
  ];

  const openItem = items.find((i) => i.key === openKey) || null;

  return (
    <div className="fixed right-3 top-1/2 -translate-y-1/2 z-50 flex items-center gap-3 pointer-events-none">
      {openItem && (
        <div className="pointer-events-auto">
          <AgentChatWindow
            key={openItem.key}
            item={openItem}
            workspaceId={workspaceId}
            onClose={() => setOpenKey(null)}
          />
        </div>
      )}

      <div className="flex flex-col items-center gap-2 pointer-events-auto">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setOpenKey(openKey === item.key ? null : item.key)}
            title={item.name}
            className={cn(
              "h-11 w-11 rounded-full overflow-hidden bg-white flex items-center justify-center text-xl",
              "ring-2 transition-transform hover:scale-110 active:scale-95 shadow-lg",
              openKey === item.key
                ? "ring-cyan-400 shadow-cyan-500/40"
                : item.isStandard
                ? "ring-cyan-400/40 shadow-cyan-500/20"
                : "ring-violet-400/40 shadow-violet-500/20",
            )}
          >
            {item.isStandard ? (
              <img src="/sr-bot.jpg" alt="" className="h-full w-full object-contain" draggable={false} />
            ) : (
              item.avatarEmoji
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentChatWindow({
  item,
  workspaceId,
  onClose,
}: {
  item: DockItem;
  workspaceId: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [navConfirm, setNavConfirm] = useState<{ target: string; label?: string } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  const accentText = item.isStandard ? "text-cyan-600" : "text-violet-600";
  const accentBg = item.isStandard ? "bg-cyan-500 hover:bg-cyan-600" : "bg-violet-500 hover:bg-violet-600";
  const accentRing = item.isStandard ? "focus:ring-cyan-400/40 focus:border-cyan-400" : "focus:ring-violet-400/40 focus:border-violet-400";

  const sendQuestion = async (text: string) => {
    if (!text.trim()) return;
    setMessages((prev) => [...prev, { role: "user", content: text.trim() }]);
    setIsTyping(true);
    setError(null);
    setNavConfirm(null);

    if (item.isStandard) {
      setTimeout(() => {
        const res = askInternalBot(text.trim());
        setMessages((prev) => [...prev, { role: "assistant", content: res.answer }]);
        setIsTyping(false);
        if (res.navigate) setNavConfirm({ target: res.navigate, label: res.navigateLabel });
      }, 380);
      return;
    }

    const history = [...messages, { role: "user" as const, content: text.trim() }].map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const result = await sendCustomAgentMessage(workspaceId, item.key, history);
    setIsTyping(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessages((prev) => [...prev, { role: "assistant", content: result.answer }]);
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

  const handleNavigate = () => {
    if (!navConfirm) return;
    window.dispatchEvent(new CustomEvent("shopflowz-navigate", { detail: { target: navConfirm.target } }));
    setNavConfirm(null);
  };

  return (
    <div className="w-[380px] max-h-[480px] flex flex-col rounded-2xl bg-white text-slate-800 shadow-2xl ring-1 ring-slate-200 animate-in slide-in-from-right-2 fade-in duration-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-2 pb-1 border-b border-slate-100">
        <span className={cn("text-[10px] uppercase tracking-wider font-semibold truncate", accentText)}>{item.name}</span>
        <button type="button" onClick={onClose} title="Close" className="p-1 rounded-md hover:bg-slate-100 text-slate-400 shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 text-sm break-words space-y-3 min-h-[160px]">
        {messages.length === 0 && !isTyping && (
          <p className="text-slate-400 text-xs pt-2">Ask {item.name} anything to get started.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("whitespace-pre-wrap leading-relaxed", m.role === "user" ? "text-right text-slate-500" : "text-slate-800")}>
            {m.content}
          </div>
        ))}
        {isTyping && (
          <div className="flex items-center gap-2 text-slate-400 py-1">
            <span className="flex gap-1">
              {[0, 150, 300].map((d) => (
                <span key={d} className={cn("w-1.5 h-1.5 rounded-full animate-bounce", item.isStandard ? "bg-cyan-400" : "bg-violet-400")} style={{ animationDelay: `${d}ms` }} />
              ))}
            </span>
            <span className="text-xs">Thinking…</span>
          </div>
        )}
        {error && <div className="text-xs text-red-500">⚠️ {error}</div>}
        {navConfirm && (
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5 flex items-center justify-between gap-3">
            <p className="text-xs text-cyan-800 font-medium">Should I take you there?</p>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={handleNavigate} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 text-white text-xs font-semibold hover:bg-cyan-600 transition-colors">
                <Navigation className="h-3 w-3" />
                {navConfirm.label || "Yes, take me there"}
              </button>
              <button type="button" onClick={() => setNavConfirm(null)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs hover:bg-slate-50 transition-colors">
                No thanks
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="px-3 pb-3 pt-2 border-t border-slate-100">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a question…"
            rows={1}
            className={cn("flex-1 resize-none min-h-[36px] max-h-24 text-sm bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2", accentRing)}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className={cn("h-9 w-9 rounded-full flex items-center justify-center text-white disabled:bg-slate-300 transition-colors shrink-0", accentBg)}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
