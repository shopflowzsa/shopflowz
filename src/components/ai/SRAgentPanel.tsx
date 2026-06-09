// SR Management Agent Panel - Chat interface with API settings
import { useState, useEffect, useRef } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Send, Settings, Trash2, Plus, MessageSquare, X, Sparkles, Eye, EyeOff, Loader2 } from 'lucide-react';
import { 
  loadSRSettings, 
  saveSRSettings, 
  sendMessageToAI, 
  loadConversations, 
  loadMessages,
  saveMessage,
  createConversation,
  deleteConversation,
  SRBotSettings,
  ChatMessage,
  Conversation
} from '@/lib/srAgentService';

interface SRAgentPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  userId: string;
}

export function SRAgentPanel({ open, onOpenChange, workspaceId, userId }: SRAgentPanelProps) {
  const [settings, setSettings] = useState<SRBotSettings | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Settings form state
  const [editSettings, setEditSettings] = useState<Partial<SRBotSettings>>({});
  const [showApiKey, setShowApiKey] = useState(false);

  // Available speech synthesis voices (for the voice picker in settings)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const refresh = () => {
      const list = window.speechSynthesis.getVoices();
      if (list && list.length > 0) setVoices(list);
    };
    refresh();
    window.speechSynthesis.addEventListener?.('voiceschanged', refresh);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', refresh);
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load settings and conversations on mount
  useEffect(() => {
    if (open && workspaceId && userId) {
      loadData();
    }
  }, [open, workspaceId, userId]);

  const loadData = async () => {
    setIsLoading(true);
    const loadedSettings = await loadSRSettings(workspaceId);
    setSettings(loadedSettings);
    setEditSettings(loadedSettings || {});
    
    const loadedConversations = await loadConversations(workspaceId, userId);
    setConversations(loadedConversations);
    
    setIsLoading(false);
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load messages when active conversation changes
  useEffect(() => {
    if (activeConversationId) {
      loadConversationMessages();
    }
  }, [activeConversationId]);

  const loadConversationMessages = async () => {
    if (!activeConversationId) return;
    const loadedMessages = await loadMessages(activeConversationId);
    setMessages(loadedMessages);
  };

  const handleSaveSettings = async () => {
    if (!settings?.id || !workspaceId) return;
    
    const success = await saveSRSettings({
      ...editSettings,
      workspace_id: workspaceId,
      id: settings.id,
    } as SRBotSettings);
    
    if (success) {
      await loadData();
      setIsSettingsOpen(false);
    }
  };

  const handleStartNewConversation = async () => {
    const newConversation = await createConversation(
      workspaceId, 
      userId, 
      `Chat ${new Date().toLocaleDateString()}`
    );
    
    if (newConversation) {
      setConversations(prev => [newConversation, ...prev]);
      setActiveConversationId(newConversation.id);
      setMessages([]);
    }
  };

  const handleSelectConversation = (conversationId: string) => {
    setActiveConversationId(conversationId);
  };

  const handleDeleteConversation = async (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteConversation(conversationId);
    setConversations(prev => prev.filter(c => c.id !== conversationId));
    if (activeConversationId === conversationId) {
      setActiveConversationId(null);
      setMessages([]);
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !settings) return;
    
    const userMessage = inputValue.trim();
    setInputValue('');
    
    // Create new conversation if needed
    let convId = activeConversationId;
    if (!convId) {
      const newConversation = await createConversation(
        workspaceId,
        userId,
        userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '')
      );
      if (newConversation) {
        setConversations(prev => [newConversation, ...prev]);
        setActiveConversationId(newConversation.id);
        convId = newConversation.id;
      } else {
        return;
      }
    }

    // Add user message to UI
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);
    setError(null);

    try {
      // Build messages array with system prompt
      const allMessages: ChatMessage[] = [
        { role: 'system', content: settings.system_prompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage },
      ];

      const result = await sendMessageToAI(settings, allMessages);

      if (result.error) {
        setError(result.error);
        // Add error as assistant message
        const errorMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `⚠️ ${result.error}`,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, errorMsg]);
      } else {
        // Add assistant response
        const assistantMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: result.content,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMsg]);
      }
    } catch (err) {
      setError(`Failed to get response: ${err}`);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-5xl p-0 flex flex-col bg-background text-foreground">
        <SheetHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <SheetTitle className="text-foreground flex items-center gap-2">
                SR Management Agent
              </SheetTitle>
              <p className="text-xs text-muted-foreground">AI Assistant for staff</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSettingsOpen(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Settings className="w-5 h-5" />
          </Button>
        </SheetHeader>

        <div className="flex-1 flex overflow-hidden">
          {/* Conversations sidebar */}
          <div className="w-64 border-r border-border flex flex-col bg-card/50">
            <div className="p-3 border-b border-border">
              <Button
                onClick={handleStartNewConversation}
                className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                size="sm"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Chat
              </Button>
            </div>
            
            <div className="flex-1 overflow-y-auto">
              {conversations.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No conversations yet</p>
                  <p className="text-xs mt-1">Start a new chat to begin</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {conversations.map(conv => (
                    <div
                      key={conv.id}
                      onClick={() => handleSelectConversation(conv.id)}
                      className={`group p-3 rounded-lg cursor-pointer transition-colors ${
                        activeConversationId === conv.id
                          ? 'bg-violet-600/20 border border-violet-500/30'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{conv.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(conv.updated_at).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={(e) => handleDeleteConversation(conv.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-opacity"
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Chat area */}
          <div className="flex-1 flex flex-col">
            {!activeConversationId ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-4">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">SR Assistant</h3>
                <p className="text-sm text-center max-w-md">
                  Your AI-powered management assistant. Ask questions about tasks, workflows, 
                  or general office management.
                </p>
                <Button
                  onClick={handleStartNewConversation}
                  className="mt-4 bg-violet-600 hover:bg-violet-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Start a conversation
                </Button>
              </div>
            ) : (
              <>
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                      <p>Send a message to start the conversation</p>
                    </div>
                  )}
                  
                  {messages.map((msg, index) => (
                    <div
                      key={msg.id || index}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-4 py-2 ${
                          msg.role === 'user'
                            ? 'bg-violet-600 text-white'
                            : 'bg-slate-700 text-foreground'
                        }`}
                      >
                        <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                  
                  {isTyping && (
                    <div className="flex justify-start">
                      <div className="bg-slate-700 rounded-lg px-4 py-2">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-100" />
                          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-200" />
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {error && (
                    <div className="flex justify-center">
                      <div className="bg-red-500/20 border border-red-500/30 rounded-lg px-4 py-2 text-red-400 text-sm">
                        {error}
                      </div>
                    </div>
                  )}
                  
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-4 border-t border-border">
                  <div className="flex gap-2">
                    <Textarea
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Type your message..."
                      className="bg-card border-border text-foreground resize-none min-h-[44px] max-h-32"
                      rows={1}
                    />
                    <Button
                      onClick={handleSendMessage}
                      disabled={!inputValue.trim() || isTyping}
                      className="bg-violet-600 hover:bg-violet-700"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Settings Panel (overlay) */}
        {isSettingsOpen && settings && (
          <div className="absolute inset-0 bg-background/95 z-50 flex flex-col">
            <SheetHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
              <SheetTitle className="text-foreground">Agent Settings</SheetTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSettingsOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </Button>
            </SheetHeader>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Bot Name */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Bot Name</label>
                <Input
                  value={editSettings.bot_name || ''}
                  onChange={(e) => setEditSettings(prev => ({ ...prev, bot_name: e.target.value }))}
                  placeholder="SR Assistant"
                  className="bg-card border-border text-foreground"
                />
              </div>

              {/* Base URL */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">API Base URL</label>
                <Input
                  value={editSettings.base_url || ''}
                  onChange={(e) => setEditSettings(prev => ({ ...prev, base_url: e.target.value }))}
                  placeholder="https://integrate.api.nvidia.com/v1"
                  className="bg-card border-border text-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  NVIDIA/MiniMax API endpoint
                </p>
              </div>

              {/* API Key */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">API Key</label>
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    value={editSettings.api_key || ''}
                    onChange={(e) => setEditSettings(prev => ({ ...prev, api_key: e.target.value }))}
                    placeholder={settings?.has_api_key ? '•••••••• (leave blank to keep current key)' : 'nvapi-...'}
                    className="bg-card border-border text-foreground pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {settings?.has_api_key
                    ? 'A key is configured. Type a new one to replace it.'
                    : 'Paste your NVIDIA API key.'}
                </p>
              </div>

              {/* Model */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Model</label>
                <Input
                  value={editSettings.model || ''}
                  onChange={(e) => setEditSettings(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="minimaxai/minimax-m2.7"
                  className="bg-card border-border text-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  Model to use for chat completions
                </p>
              </div>

              {/* System Prompt */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">System Prompt</label>
                <Textarea
                  value={editSettings.system_prompt || ''}
                  onChange={(e) => setEditSettings(prev => ({ ...prev, system_prompt: e.target.value }))}
                  placeholder="You are a helpful assistant..."
                  rows={6}
                  className="bg-card border-border text-foreground resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Instructions that define the assistant's behavior and capabilities
                </p>
              </div>

              {/* Enabled Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-foreground">Enable Agent</label>
                  <p className="text-xs text-muted-foreground">Allow staff to chat with the agent</p>
                </div>
                <button
                  onClick={() => setEditSettings(prev => ({ ...prev, is_enabled: !prev.is_enabled }))}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    editSettings.is_enabled ? 'bg-violet-600' : 'bg-slate-600'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transition-transform ${
                      editSettings.is_enabled ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* ── Voice section ─────────────────────────────────────────── */}
              <div className="border-t border-border pt-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Voice</h3>
                  <p className="text-xs text-muted-foreground">Talk to the bot and let it speak answers (Chrome/Edge).</p>
                </div>

                {/* TTS toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm text-foreground">Speak answers aloud</label>
                    <p className="text-xs text-muted-foreground">Bot reads its replies using your browser's voice</p>
                  </div>
                  <button
                    onClick={() => setEditSettings(prev => ({ ...prev, tts_enabled: !prev.tts_enabled }))}
                    className={`w-12 h-6 rounded-full transition-colors ${editSettings.tts_enabled ? 'bg-violet-600' : 'bg-slate-600'}`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transition-transform ${editSettings.tts_enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                {/* Voice picker */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Voice</label>
                  <select
                    value={editSettings.voice_name || ''}
                    onChange={(e) => setEditSettings(prev => ({ ...prev, voice_name: e.target.value || null }))}
                    className="w-full bg-card border border-border text-foreground rounded-md px-3 py-2 text-sm"
                  >
                    <option value="">System default</option>
                    {voices.map(v => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang}){v.default ? ' — default' : ''}
                      </option>
                    ))}
                  </select>
                  {voices.length === 0 && (
                    <p className="text-xs text-amber-400">No voices detected. Some browsers load voices lazily — open this panel again after a moment.</p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const synth = window.speechSynthesis;
                      if (!synth) return;
                      synth.cancel();
                      const u = new SpeechSynthesisUtterance(`Hi, this is ${editSettings.bot_name || 'SR Assistant'}. How can I help?`);
                      if (editSettings.voice_name) {
                        const v = voices.find(vv => vv.voiceURI === editSettings.voice_name || vv.name === editSettings.voice_name);
                        if (v) u.voice = v;
                      }
                      synth.speak(u);
                    }}
                  >
                    Test voice
                  </Button>
                </div>

                {/* STT toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm text-foreground">Voice input</label>
                    <p className="text-xs text-muted-foreground">Mic button + wake-word listener</p>
                  </div>
                  <button
                    onClick={() => setEditSettings(prev => ({ ...prev, stt_enabled: !prev.stt_enabled }))}
                    className={`w-12 h-6 rounded-full transition-colors ${editSettings.stt_enabled ? 'bg-violet-600' : 'bg-slate-600'}`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transition-transform ${editSettings.stt_enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                {/* Wake word */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Wake word</label>
                  <Input
                    value={editSettings.wake_word || ''}
                    onChange={(e) => setEditSettings(prev => ({ ...prev, wake_word: e.target.value }))}
                    placeholder="hey shamia"
                    className="bg-card border-border text-foreground"
                    disabled={!editSettings.stt_enabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    Say this phrase aloud to trigger the bot. Keep it short and distinctive (2–3 words). Best-effort — may misfire on similar-sounding speech.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-border flex gap-3">
              <Button
                onClick={() => setIsSettingsOpen(false)}
                variant="outline"
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveSettings}
                className="flex-1 bg-violet-600 hover:bg-violet-700"
              >
                Save Settings
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}