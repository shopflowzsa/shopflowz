// Custom AI Agents Service — bring-your-own-Claude-API-key bots.
// Separate from srAgentService.ts (standard NVIDIA-backed assistant); does
// not read or write sr_bot_settings / ai_assistant_settings.
import { supabase } from './supabase';

export type AgentVisibility = 'all' | 'selected';

export interface CustomAgent {
  id: string;
  workspace_id: string;
  agent_name: string;
  avatar_emoji: string;
  model: string;
  system_prompt: string;
  has_api_key: boolean;
  is_enabled: boolean;
  visibility_mode: AgentVisibility;
  position_index: number;
  created_at: string;
  updated_at: string;
}

export interface CustomAgentBubbleInfo {
  id: string;
  agent_name: string;
  avatar_emoji: string;
  position_index: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const DEFAULT_CUSTOM_AGENT = {
  agent_name: 'Custom Agent',
  avatar_emoji: '🤖',
  model: 'claude-3-5-haiku-20241022',
  system_prompt: 'You are a helpful assistant for a workspace management app. Be concise and honest.',
  is_enabled: true,
  visibility_mode: 'all' as AgentVisibility,
};

const OWNER_COLUMNS =
  'id, workspace_id, agent_name, avatar_emoji, model, system_prompt, is_enabled, has_api_key, visibility_mode, position_index, created_at, updated_at';

// Owner-facing list — never selects api_key.
export async function listAgentsForOwner(workspaceId: string): Promise<CustomAgent[]> {
  const { data, error } = await supabase
    .from('custom_ai_agents')
    .select(OWNER_COLUMNS)
    .eq('workspace_id', workspaceId)
    .order('position_index', { ascending: true });

  if (error) {
    console.error('Error loading custom agents:', error);
    return [];
  }
  return (data ?? []) as CustomAgent[];
}

// Staff-facing list of enabled, visible bubbles — routed through the Edge
// Function so visibility (everyone vs. specific staff) is enforced
// consistently regardless of the caller's role.
export async function listEnabledAgentsForBubbles(workspaceId: string): Promise<CustomAgentBubbleInfo[]> {
  try {
    const { data, error } = await supabase.functions.invoke('claude-agent-proxy', {
      body: { action: 'list', workspace_id: workspaceId },
    });
    if (error) {
      console.error('Error listing custom agent bubbles:', error);
      return [];
    }
    return (data?.agents ?? []) as CustomAgentBubbleInfo[];
  } catch (err) {
    console.error('Error listing custom agent bubbles:', err);
    return [];
  }
}

export interface SaveAgentInput {
  agent_name: string;
  avatar_emoji: string;
  model: string;
  system_prompt: string;
  api_key?: string; // blank/omitted = "no change" on update
  is_enabled: boolean;
  visibility_mode: AgentVisibility;
  selectedUids?: string[]; // used when visibility_mode === 'selected'
  position_index?: number;
}

export async function createAgent(workspaceId: string, input: SaveAgentInput): Promise<CustomAgent | null> {
  const payload: Record<string, any> = {
    workspace_id: workspaceId,
    agent_name: input.agent_name,
    avatar_emoji: input.avatar_emoji,
    model: input.model,
    system_prompt: input.system_prompt,
    is_enabled: input.is_enabled,
    visibility_mode: input.visibility_mode,
    position_index: input.position_index ?? 0,
    api_key: input.api_key || '',
    has_api_key: !!input.api_key,
  };

  const { data, error } = await supabase
    .from('custom_ai_agents')
    .insert(payload)
    .select(OWNER_COLUMNS)
    .single();

  if (error || !data) {
    console.error('Error creating custom agent:', error);
    return null;
  }

  if (input.visibility_mode === 'selected') {
    await replaceAgentAccess(data.id, input.selectedUids ?? []);
  }

  return data as CustomAgent;
}

export async function updateAgent(agentId: string, input: SaveAgentInput): Promise<boolean> {
  const payload: Record<string, any> = {
    agent_name: input.agent_name,
    avatar_emoji: input.avatar_emoji,
    model: input.model,
    system_prompt: input.system_prompt,
    is_enabled: input.is_enabled,
    visibility_mode: input.visibility_mode,
    updated_at: new Date().toISOString(),
  };
  if (input.position_index !== undefined) payload.position_index = input.position_index;

  // Empty/omitted api_key = "no change" — don't send the column at all.
  if (input.api_key) {
    payload.api_key = input.api_key;
    payload.has_api_key = true;
  }

  const { error } = await supabase.from('custom_ai_agents').update(payload).eq('id', agentId);
  if (error) {
    console.error('Error updating custom agent:', error);
    return false;
  }

  if (input.visibility_mode === 'selected') {
    await replaceAgentAccess(agentId, input.selectedUids ?? []);
  }

  return true;
}

async function replaceAgentAccess(agentId: string, uids: string[]): Promise<void> {
  const { error: delError } = await supabase.from('custom_ai_agent_access').delete().eq('agent_id', agentId);
  if (delError) {
    console.error('Error clearing custom agent access list:', delError);
    return;
  }
  if (uids.length === 0) return;

  const { error: insError } = await supabase
    .from('custom_ai_agent_access')
    .insert(uids.map((uid) => ({ agent_id: agentId, uid })));
  if (insError) console.error('Error saving custom agent access list:', insError);
}

export async function deleteAgent(agentId: string): Promise<boolean> {
  const { error } = await supabase.from('custom_ai_agents').delete().eq('id', agentId);
  if (error) {
    console.error('Error deleting custom agent:', error);
    return false;
  }
  return true;
}

export async function toggleAgentEnabled(agentId: string, isEnabled: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('custom_ai_agents')
    .update({ is_enabled: isEnabled, updated_at: new Date().toISOString() })
    .eq('id', agentId);
  if (error) {
    console.error('Error toggling custom agent:', error);
    return false;
  }
  return true;
}

export async function getAgentSelectedUids(agentId: string): Promise<string[]> {
  const { data, error } = await supabase.from('custom_ai_agent_access').select('uid').eq('agent_id', agentId);
  if (error) {
    console.error('Error loading custom agent access list:', error);
    return [];
  }
  return (data ?? []).map((r) => r.uid as string);
}

// Send a message to a custom agent via the claude-agent-proxy Edge Function.
// The browser never sees the Anthropic key — it stays server-side.
export async function sendMessage(
  workspaceId: string,
  agentId: string,
  messages: ChatMessage[],
): Promise<{ answer: string; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('claude-agent-proxy', {
      body: { action: 'chat', workspace_id: workspaceId, agent_id: agentId, messages },
    });
    if (error) return { answer: '', error: error.message };
    if (data?.error) return { answer: '', error: data.error };
    return { answer: data?.answer ?? '' };
  } catch (err) {
    return { answer: '', error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
