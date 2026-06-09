// SR Agent Service - NVIDIA/MiniMax API integration
import { supabase } from './supabase';

export interface SRBotSettings {
  id: string;
  workspace_id: string;
  bot_name: string;
  base_url: string;
  api_key: string;
  has_api_key?: boolean;
  model: string;
  system_prompt: string;
  is_enabled: boolean;
  tts_enabled: boolean;
  stt_enabled: boolean;
  wake_word: string;
  voice_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
}

export interface Conversation {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

// Default settings for NVIDIA-hosted models. The base system prompt is short;
// the Edge Function appends tool-usage rules at request time so the prompt
// stays manageable in the settings UI.
export const DEFAULT_SR_SETTINGS: Partial<SRBotSettings> = {
  bot_name: 'SR Assistant',
  base_url: 'https://integrate.api.nvidia.com/v1',
  api_key: '',
  model: 'meta/llama-3.3-70b-instruct',
  system_prompt:
    'You are a staff assistant. Help staff understand activity, tasks, customers, and inventory in this app. Be concise, accurate, and honest when you do not have data. Never fabricate.',
  is_enabled: true,
  tts_enabled: true,
  stt_enabled: true,
  wake_word: 'hey shamia',
  voice_name: null,
};

// Load settings from database. Does not expose api_key to the browser — the
// key only ever lives server-side. has_api_key tells the UI whether one is
// configured so it can show the right hint.
export async function loadSRSettings(workspaceId: string): Promise<SRBotSettings | null> {
  try {
    const { data, error } = await supabase
      .from('sr_bot_settings')
      .select('id, workspace_id, bot_name, base_url, model, system_prompt, is_enabled, tts_enabled, stt_enabled, wake_word, voice_name, created_at, updated_at, api_key')
      .eq('workspace_id', workspaceId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error loading SR settings:', error);
      return null;
    }

    if (data) {
      const has_api_key = !!data.api_key;
      return { ...data, api_key: '', has_api_key } as SRBotSettings;
    }

    // Create default settings if none exist
    const newSettings = {
      workspace_id: workspaceId,
      ...DEFAULT_SR_SETTINGS,
    };

    const { data: created, error: createError } = await supabase
      .from('sr_bot_settings')
      .insert(newSettings)
      .select('id, workspace_id, bot_name, base_url, model, system_prompt, is_enabled, tts_enabled, stt_enabled, wake_word, voice_name, created_at, updated_at')
      .single();

    if (createError) {
      console.error('Error creating SR settings:', createError);
      return null;
    }

    return { ...created, api_key: '', has_api_key: false } as SRBotSettings;
  } catch (err) {
    console.error('Error loading SR settings:', err);
    return null;
  }
}

// Save settings to database. An empty api_key is treated as "no change" —
// otherwise simply opening Settings and clicking Save would wipe the key
// (because we never load it into the form).
export async function saveSRSettings(settings: Partial<SRBotSettings> & { workspace_id: string }): Promise<boolean> {
  try {
    const payload: Record<string, any> = {
      ...settings,
      updated_at: new Date().toISOString(),
    };
    if (!payload.api_key) delete payload.api_key;
    delete payload.has_api_key;

    const { error } = await supabase
      .from('sr_bot_settings')
      .upsert(payload);

    if (error) {
      console.error('Error saving SR settings:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error saving SR settings:', err);
    return false;
  }
}

export interface AIProposal {
  id: string;
  action_type: string;
  summary: string;
  params: Record<string, any>;
  created_at: string;
}

// Send message to AI via the ai-proxy Edge Function. The browser can't call
// NVIDIA's API directly (CORS), and exposing the API key would be unsafe even
// if it could — so the call is proxied through Supabase, which reads the key
// server-side from sr_bot_settings.
export async function sendMessageToAI(
  settings: SRBotSettings,
  messages: ChatMessage[]
): Promise<{ content: string; error?: string; proposals?: AIProposal[] }> {
  try {
    if (!settings.is_enabled) {
      return { content: '', error: 'SR Assistant is currently disabled.' };
    }

    const { data, error } = await supabase.functions.invoke('ai-proxy', {
      body: {
        workspace_id: settings.workspace_id,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      },
    });

    if (error) {
      const detail = (error as any)?.context?.body ?? (error as any)?.message ?? String(error);
      return { content: '', error: typeof detail === 'string' ? detail : JSON.stringify(detail) };
    }

    if (data?.error) {
      return { content: '', error: data.error };
    }

    if (!data?.content) {
      return { content: '', error: 'Empty response from AI proxy' };
    }

    return { content: data.content, proposals: data.proposals || [] };
  } catch (err) {
    console.error('Error sending message to AI:', err);
    return { content: '', error: `Network error: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}

// Approve and execute a proposal. The Edge Function validates ownership and
// runs the action server-side. Returns { ok, result } or { error }.
export async function executeProposal(proposalId: string): Promise<{ ok: boolean; result?: any; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('execute-proposal', {
      body: { proposal_id: proposalId },
    });
    if (error) {
      const detail = (error as any)?.context?.body ?? (error as any)?.message ?? String(error);
      return { ok: false, error: typeof detail === 'string' ? detail : JSON.stringify(detail) };
    }
    if (data?.error) return { ok: false, error: data.error };
    return { ok: true, result: data?.result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// Cancel a pending proposal so it doesn't keep showing up in future turns.
export async function cancelProposal(proposalId: string): Promise<void> {
  await supabase
    .from('ai_action_proposals')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
    .eq('id', proposalId)
    .eq('status', 'pending');
}

// Load conversations
export async function loadConversations(workspaceId: string, userId: string): Promise<Conversation[]> {
  try {
    const { data, error } = await supabase
      .from('sr_conversations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error loading conversations:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Error loading conversations:', err);
    return [];
  }
}

// Load messages for a conversation
export async function loadMessages(conversationId: string): Promise<ChatMessage[]> {
  try {
    const { data, error } = await supabase
      .from('sr_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading messages:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Error loading messages:', err);
    return [];
  }
}

// Save a message
export async function saveMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<ChatMessage | null> {
  try {
    const { data, error } = await supabase
      .from('sr_messages')
      .insert({
        conversation_id: conversationId,
        role,
        content,
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving message:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Error saving message:', err);
    return null;
  }
}

// Create new conversation
export async function createConversation(
  workspaceId: string,
  userId: string,
  title: string
): Promise<Conversation | null> {
  try {
    const { data, error } = await supabase
      .from('sr_conversations')
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        title,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating conversation:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Error creating conversation:', err);
    return null;
  }
}

// Delete conversation
export async function deleteConversation(conversationId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('sr_conversations')
      .delete()
      .eq('id', conversationId);

    if (error) {
      console.error('Error deleting conversation:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error deleting conversation:', err);
    return false;
  }
}