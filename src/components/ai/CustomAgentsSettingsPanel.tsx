// Custom AI Agents Settings Panel — owner-only CRUD for bring-your-own-Claude
// bots. Separate from SRAgentPanel (standard NVIDIA-backed assistant).
import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sparkles, Plus, Trash2, Pencil, Eye, EyeOff, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  listAgentsForOwner,
  createAgent,
  updateAgent,
  deleteAgent,
  toggleAgentEnabled,
  getAgentSelectedUids,
  DEFAULT_CUSTOM_AGENT,
  type CustomAgent,
  type AgentVisibility,
} from '@/lib/customAgentService';

interface CustomAgentsSettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

interface EditState {
  id?: string;
  agent_name: string;
  avatar_emoji: string;
  model: string;
  system_prompt: string;
  api_key: string;
  has_api_key: boolean;
  is_enabled: boolean;
  visibility_mode: AgentVisibility;
  selectedUids: string[];
}

function blankEditState(): EditState {
  return {
    agent_name: DEFAULT_CUSTOM_AGENT.agent_name,
    avatar_emoji: DEFAULT_CUSTOM_AGENT.avatar_emoji,
    model: DEFAULT_CUSTOM_AGENT.model,
    system_prompt: DEFAULT_CUSTOM_AGENT.system_prompt,
    api_key: '',
    has_api_key: false,
    is_enabled: true,
    visibility_mode: 'all',
    selectedUids: [],
  };
}

export function CustomAgentsSettingsPanel({ open, onOpenChange, workspaceId }: CustomAgentsSettingsPanelProps) {
  const { members } = useAuth();
  const [agents, setAgents] = useState<CustomAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (open && workspaceId) loadAgents();
  }, [open, workspaceId]);

  const loadAgents = async () => {
    setLoading(true);
    setAgents(await listAgentsForOwner(workspaceId));
    setLoading(false);
  };

  const startCreate = () => {
    setShowApiKey(false);
    setEditing(blankEditState());
  };

  const startEdit = async (agent: CustomAgent) => {
    setShowApiKey(false);
    const selectedUids = agent.visibility_mode === 'selected' ? await getAgentSelectedUids(agent.id) : [];
    setEditing({
      id: agent.id,
      agent_name: agent.agent_name,
      avatar_emoji: agent.avatar_emoji,
      model: agent.model,
      system_prompt: agent.system_prompt,
      api_key: '',
      has_api_key: agent.has_api_key,
      is_enabled: agent.is_enabled,
      visibility_mode: agent.visibility_mode,
      selectedUids,
    });
  };

  const handleSave = async () => {
    if (!editing || !editing.agent_name.trim()) return;
    setSaving(true);
    const input = {
      agent_name: editing.agent_name.trim(),
      avatar_emoji: editing.avatar_emoji.trim() || '🤖',
      model: editing.model.trim() || DEFAULT_CUSTOM_AGENT.model,
      system_prompt: editing.system_prompt.trim() || DEFAULT_CUSTOM_AGENT.system_prompt,
      api_key: editing.api_key.trim(),
      is_enabled: editing.is_enabled,
      visibility_mode: editing.visibility_mode,
      selectedUids: editing.selectedUids,
    };
    const ok = editing.id ? await updateAgent(editing.id, input) : !!(await createAgent(workspaceId, input));
    setSaving(false);
    if (ok) {
      setEditing(null);
      await loadAgents();
    }
  };

  const handleDelete = async (agent: CustomAgent) => {
    if (!window.confirm(`Delete "${agent.agent_name}"? This can't be undone.`)) return;
    if (await deleteAgent(agent.id)) await loadAgents();
  };

  const handleToggle = async (agent: CustomAgent) => {
    if (await toggleAgentEnabled(agent.id, !agent.is_enabled)) await loadAgents();
  };

  const toggleSelectedUid = (uid: string) => {
    if (!editing) return;
    const has = editing.selectedUids.includes(uid);
    setEditing({
      ...editing,
      selectedUids: has ? editing.selectedUids.filter((u) => u !== uid) : [...editing.selectedUids, uid],
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto bg-background text-foreground border-l-slate-700">
        <SheetHeader>
          <SheetTitle className="text-foreground flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-400" />
            Custom AI Agents
          </SheetTitle>
          <SheetDescription>
            Bring your own Claude (Anthropic) API key and create extra chat bots for your workspace. Each enabled
            agent shows as its own floating bubble alongside the standard assistant.
          </SheetDescription>
        </SheetHeader>

        {!editing ? (
          <div className="mt-6 space-y-4">
            <Button onClick={startCreate} className="w-full bg-violet-600 hover:bg-violet-700 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Add Agent
            </Button>

            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
            ) : agents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No custom agents yet. Add one to get started.
              </p>
            ) : (
              <div className="space-y-2">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50"
                  >
                    <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-lg shrink-0">
                      {agent.avatar_emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{agent.agent_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {agent.model} · {agent.visibility_mode === 'all' ? 'Everyone' : 'Specific staff'}
                        {!agent.has_api_key && ' · No API key'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggle(agent)}
                      title={agent.is_enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                      className={`w-11 h-6 rounded-full transition-colors shrink-0 ${
                        agent.is_enabled ? 'bg-violet-600' : 'bg-slate-600'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 bg-white rounded-full transition-transform ${
                          agent.is_enabled ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(agent)}
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(agent)}
                      className="p-1.5 rounded-md hover:bg-red-500/20 text-red-400 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{editing.id ? 'Edit Agent' : 'New Agent'}</h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-3">
              <div className="w-20 space-y-2">
                <Label>Icon</Label>
                <Input
                  value={editing.avatar_emoji}
                  onChange={(e) => setEditing({ ...editing, avatar_emoji: e.target.value })}
                  maxLength={4}
                  className="bg-card border-border text-foreground text-center text-lg"
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label>Agent Name</Label>
                <Input
                  value={editing.agent_name}
                  onChange={(e) => setEditing({ ...editing, agent_name: e.target.value })}
                  placeholder="Sales Assistant"
                  className="bg-card border-border text-foreground"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>API Key</Label>
              <div className="relative">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={editing.api_key}
                  onChange={(e) => setEditing({ ...editing, api_key: e.target.value })}
                  placeholder={editing.has_api_key ? '•••••••• (leave blank to keep current key)' : 'sk-ant-...'}
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
                {editing.has_api_key ? 'A key is configured. Type a new one to replace it.' : 'Paste your Anthropic (Claude) API key.'}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Input
                value={editing.model}
                onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                placeholder="claude-3-5-haiku-20241022"
                className="bg-card border-border text-foreground"
              />
              <p className="text-xs text-muted-foreground">Any Claude model ID your API key has access to.</p>
            </div>

            <div className="space-y-2">
              <Label>System Prompt</Label>
              <Textarea
                value={editing.system_prompt}
                onChange={(e) => setEditing({ ...editing, system_prompt: e.target.value })}
                rows={5}
                className="bg-card border-border text-foreground resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label>Visible to</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing({ ...editing, visibility_mode: 'all' })}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    editing.visibility_mode === 'all'
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-slate-700 border-border text-foreground/70 hover:border-violet-400'
                  }`}
                >
                  Everyone
                </button>
                <button
                  type="button"
                  onClick={() => setEditing({ ...editing, visibility_mode: 'selected' })}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    editing.visibility_mode === 'selected'
                      ? 'bg-violet-600 border-violet-500 text-white'
                      : 'bg-slate-700 border-border text-foreground/70 hover:border-violet-400'
                  }`}
                >
                  Specific staff
                </button>
              </div>
              {editing.visibility_mode === 'selected' && (
                <div className="pt-2 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => {
                      const selected = editing.selectedUids.includes(m.uid);
                      return (
                        <button
                          key={m.uid}
                          type="button"
                          onClick={() => toggleSelectedUid(m.uid)}
                          className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                            selected
                              ? 'bg-violet-600 border-violet-500 text-white'
                              : 'bg-slate-700 border-border text-foreground/70 hover:border-violet-400'
                          }`}
                        >
                          {m.displayName || m.email}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {editing.selectedUids.length === 0
                      ? 'No staff selected — nobody can see this agent yet.'
                      : `Only the selected ${editing.selectedUids.length} staff member(s) will see this agent.`}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              <div>
                <Label>Enabled</Label>
                <p className="text-xs text-muted-foreground">Show the floating bubble to allowed staff</p>
              </div>
              <button
                type="button"
                onClick={() => setEditing({ ...editing, is_enabled: !editing.is_enabled })}
                className={`w-12 h-6 rounded-full transition-colors ${editing.is_enabled ? 'bg-violet-600' : 'bg-slate-600'}`}
              >
                <div
                  className={`w-5 h-5 bg-white rounded-full transition-transform ${
                    editing.is_enabled ? 'translate-x-6' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            <div className="flex gap-3 pt-2">
              <Button onClick={() => setEditing(null)} variant="outline" className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !editing.agent_name.trim()}
                className="flex-1 bg-violet-600 hover:bg-violet-700"
              >
                {saving ? 'Saving…' : 'Save Agent'}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
