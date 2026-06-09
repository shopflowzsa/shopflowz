// AI Chat Hook - State management for AI Assistant conversations
import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  getConversations,
  getMessages,
  createConversation,
  saveMessage,
  deleteConversation,
  sendMessageToAI,
  getAISettings,
  AISettings,
} from '@/lib/aiService';

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
}

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
  messages: ChatMessage[];
}

export function useAIChat(workspaceId: string) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AISettings | null>(null);

  // Load AI settings
  const loadSettings = useCallback(async () => {
    if (!workspaceId) return;
    const aiSettings = await getAISettings(workspaceId);
    setSettings(aiSettings);
  }, [workspaceId]);

  // Load conversations
  const loadConversations = useCallback(async () => {
    if (!user?.id) return;
    const convs = await getConversations(user.id);
    setConversations(convs);
  }, [user?.id]);

  // Load messages for a conversation
  const loadMessages = useCallback(async (conversationId: string) => {
    const msgs = await getMessages(conversationId);
    setMessages(msgs.map(m => ({
      ...m,
      timestamp: new Date(),
    })));
  }, []);

  // Select a conversation
  const selectConversation = useCallback(async (conversationId: string) => {
    setActiveConversationId(conversationId);
    await loadMessages(conversationId);
  }, [loadMessages]);

  // Start a new conversation
  const startNewConversation = useCallback(async () => {
    if (!user?.id || !workspaceId) return;
    
    const title = `Chat ${new Date().toLocaleString()}`;
    const conversationId = await createConversation(workspaceId, user.id, title);
    
    if (conversationId) {
      await loadConversations();
      setActiveConversationId(conversationId);
      setMessages([]);
    }
  }, [user?.id, workspaceId, loadConversations]);

  // Send a message and get AI response
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || !activeConversationId || !user) return;

    // Add user message to local state
    const userMessage: ChatMessage = {
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);
    setError(null);

    try {
      // Save user message to DB
      await saveMessage(activeConversationId, 'user', content.trim());

      // Get AI response
      const aiMessages = messages.concat(userMessage).map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await sendMessageToAI(
        aiMessages,
        settings?.system_prompt
      );

      // Add assistant message to local state
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response.content,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Save assistant message to DB
      await saveMessage(
        activeConversationId,
        'assistant',
        response.content,
        response.tokensUsed
      );
    } catch (err) {
      console.error('Error sending message:', err);
      setError('Failed to get response. Please try again.');
    } finally {
      setIsTyping(false);
    }
  }, [activeConversationId, user, messages, settings]);

  // Delete a conversation
  const removeConversation = useCallback(async (conversationId: string) => {
    const success = await deleteConversation(conversationId);
    if (success) {
      await loadConversations();
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
        setMessages([]);
      }
    }
  }, [activeConversationId, loadConversations]);

  // Update AI settings
  const updateSettings = useCallback(async (newSettings: Partial<AISettings>) => {
    const success = await saveAISettings(workspaceId, newSettings);
    if (success) {
      await loadSettings();
    }
    return success;
  }, [workspaceId, loadSettings]);

  // Initial load
  useEffect(() => {
    loadSettings();
    loadConversations();
  }, [loadSettings, loadConversations]);

  return {
    conversations,
    activeConversationId,
    messages,
    isLoading,
    isTyping,
    error,
    settings,
    selectConversation,
    startNewConversation,
    sendMessage,
    removeConversation,
    updateSettings,
    loadSettings,
  };
}

// Helper function to save AI settings (imported from aiService)
async function saveAISettings(workspaceId: string, settings: Partial<AISettings>) {
  const { error } = await (await import('@/lib/aiService')).saveAISettings(workspaceId, settings);
  return !error;
}