// AI Service for MiniMax M2.7 API (OpenAI-compatible)
import { supabase, supabaseServiceRole } from './supabase';

const MINIMAX_API_URL = 'https://api.minimax.chat/v1/text/chatcompletion_v2';
const MINIMAX_API_KEY = import.meta.env.VITE_MINIMAX_API_KEY || '';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  tokensUsed: number;
}

export interface AISettings {
  bot_name: string;
  bot_personality: string;
  system_prompt: string;
  is_enabled: boolean;
}

// Get AI settings for a workspace
export async function getAISettings(workspaceId: string): Promise<AISettings | null> {
  const { data, error } = await supabase
    .from('ai_assistant_settings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching AI settings:', error);
    return null;
  }
  
  return data || null;
}

// Save AI settings for a workspace
export async function saveAISettings(
  workspaceId: string, 
  settings: Partial<AISettings>
): Promise<boolean> {
  const { error } = await supabaseServiceRole
    .from('ai_assistant_settings')
    .upsert({
      workspace_id: workspaceId,
      ...settings,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.error('Error saving AI settings:', error);
    return false;
  }
  return true;
}

// Send message to MiniMax API
export async function sendMessageToAI(
  messages: ChatMessage[],
  systemPrompt?: string
): Promise<AIResponse> {
  // Build the full message array with system prompt
  const fullMessages: ChatMessage[] = [];
  
  if (systemPrompt) {
    fullMessages.push({ role: 'system', content: systemPrompt });
  }
  
  fullMessages.push(...messages);

  try {
    const response = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-Text-01',
        messages: fullMessages,
        max_tokens: 1000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Extract the response content
    const content = data.choices?.[0]?.message?.content || '';
    const tokensUsed = data.usage?.total_tokens || 0;

    return { content, tokensUsed };
  } catch (error) {
    console.error('Error calling MiniMax API:', error);
    throw error;
  }
}

// Create a new conversation
export async function createConversation(
  workspaceId: string,
  userId: string,
  title?: string
): Promise<string | null> {
  const { data, error } = await supabaseServiceRole
    .from('ai_conversations')
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      title: title || 'New Chat',
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error creating conversation:', error);
    return null;
  }
  return data.id;
}

// Get conversations for a user
export async function getConversations(userId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('ai_conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching conversations:', error);
    return [];
  }
  return data || [];
}

// Get messages for a conversation
export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('ai_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching messages:', error);
    return [];
  }
  return data || [];
}

// Save a message
export async function saveMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  tokensUsed?: number
): Promise<boolean> {
  const { error } = await supabaseServiceRole.from('ai_messages').insert({
    conversation_id: conversationId,
    role,
    content,
    tokens_used: tokensUsed,
  });

  if (error) {
    console.error('Error saving message:', error);
    return false;
  }
  
  // Update conversation timestamp
  await supabaseServiceRole
    .from('ai_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  return true;
}

// Delete a conversation and its messages
export async function deleteConversation(conversationId: string): Promise<boolean> {
  const { error } = await supabaseServiceRole
    .from('ai_conversations')
    .delete()
    .eq('id', conversationId);

  if (error) {
    console.error('Error deleting conversation:', error);
    return false;
  }
  return true;
}