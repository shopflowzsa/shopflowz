/**
 * Workspace Management - Admin panel to manage business client CRM subscriptions
 */

import { useState, useEffect } from "react";
import { SUPABASE_URL,  supabase, supabaseServiceRole } from "@/lib/supabase";
import { Workspace } from "@/types/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Building2, CheckCircle2, XCircle, Clock, Loader2, Save, RefreshCw, LogIn, KeyRound } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/contexts/AuthContext";

export function WorkspaceManagement() {
  const { workspaceId: currentWorkspaceId } = useAuth();
  const [workspaces, setWorkspaces] = useState<(Workspace & { memberCount: number; ownerEmail?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [missingCount, setMissingCount] = useState<number>(0);
  const [pwMap, setPwMap] = useState<Record<string, string>>({});
  const [pwSaving, setPwSaving] = useState<string | null>(null);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const checkMissingWorkspaces = async () => {
    try {
      console.log('🔍 Checking for users without workspaces...');
      const [{ data: usersRows }, { data: wsRows }] = await Promise.all([
        supabase.from('user_profiles').select('id, email, workspace_id'),
        supabase.from('workspaces').select('id'),
      ]);
      const existingWsIds = new Set((wsRows || []).map(w => w.id));
      let missing = 0;
      (usersRows || []).forEach(u => {
        if (!u.workspace_id) {
          console.warn(`⚠️ User ${u.id} (${u.email}) has no workspace assigned`);
          missing++;
        } else if (!existingWsIds.has(u.workspace_id)) {
          console.warn(`⚠️ User ${u.id} (${u.email}) has invalid workspace: ${u.workspace_id}`);
          missing++;
        }
      });
      setMissingCount(missing);
      console.log(`📊 Total users: ${(usersRows || []).length}, Total workspaces: ${(wsRows || []).length}, Missing: ${missing}`);
    } catch (error) {
      console.error('❌ Error checking missing workspaces:', error);
    }
  };

  const createMissingWorkspaces = async () => {
    try {
      setSaving('creating-workspaces');
      console.log('🔧 Creating missing workspaces...');
      const [{ data: usersRows }, { data: wsRows }] = await Promise.all([
        supabase.from('user_profiles').select('id, email, display_name, workspace_id'),
        supabase.from('workspaces').select('id'),
      ]);
      const existingWsIds = new Set((wsRows || []).map(w => w.id));
      let created = 0;
      for (const u of (usersRows || [])) {
        if (u.workspace_id && existingWsIds.has(u.workspace_id)) continue;
        console.log(`🏗️ Creating workspace for user: ${u.email}`);
        const newWsId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await supabaseServiceRole.from('workspaces').insert({ id: newWsId, name: u.display_name ? `${u.display_name}'s Workspace` : 'My Workspace', owner_uid: u.id, has_crm_access: false, created_at: new Date().toISOString() });
        await supabaseServiceRole.from('workspace_members').upsert({ workspace_id: newWsId, uid: u.id, email: u.email, display_name: u.display_name || u.email?.split('@')[0], role: 'owner' });
        await supabaseServiceRole.from('user_profiles').update({ workspace_id: newWsId }).eq('id', u.id);
        console.log(`✅ Created workspace: ${newWsId}`);
        created++;
      }
      console.log(`✅ Created ${created} workspace(s)`);
      alert(`Successfully created ${created} workspace(s)`);
      await loadWorkspaces();
    } catch (error) {
      console.error('❌ Error creating missing workspaces:', error);
      alert(`Failed to create workspaces: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSaving(null);
    }
  };

  const loadWorkspaces = async () => {
    try {
      console.log('🔍 Loading workspaces...');
      await checkMissingWorkspaces();

      const [wsRes, membersRes, subRes, usersRes] = await Promise.all([
        supabase.from('workspaces').select('*'),
        supabase.from('workspace_members').select('*'),
        supabase.from('workspace_settings').select('workspace_id, data').eq('category', 'subscription'),
        supabase.from('user_profiles').select('id, email'),
      ]);
      const wsRows = wsRes.data || [];
      const memberRows = membersRes.data || [];
      const subRows = subRes.data || [];
      const userRows = usersRes.data || [];

      console.log(`📊 Found ${wsRows.length} workspace rows in Supabase`);

      const workspacesList = wsRows.map(w => {
        const members = memberRows.filter(m => m.workspace_id === w.id);
        const ownerMember = members.find(m => m.role === 'owner');
        let ownerEmail = ownerMember?.email || 'No owner found';
        if (ownerEmail === 'No owner found' && w.owner_uid) {
          const u = userRows.find(u => u.id === w.owner_uid);
          ownerEmail = u?.email || w.owner_uid;
        }
        const subData = (subRows.find(s => s.workspace_id === w.id)?.data as any) || {};
        return {
          id: w.id,
          name: w.name,
          createdAt: w.created_at,
          createdBy: w.owner_uid,
          hasCrmAccess: subData.hasCrmAccess ?? false,
          subscriptionStatus: subData.subscriptionStatus || 'none',
          subscriptionTier: subData.subscriptionTier || 'none',
          trialEndsAt: subData.trialEndsAt,
          subscriptionEndsAt: subData.subscriptionEndsAt,
          monthlyPrice: subData.monthlyPrice || 0,
          hiddenFeatures: subData.hiddenFeatures || [],
          brandName: subData.brandName,
          brandLogo: subData.brandLogo,
          memberCount: members.length,
          ownerEmail,
        };
      });

      const sortedWorkspaces = workspacesList.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      console.log(`✅ Setting ${sortedWorkspaces.length} workspaces to state`);
      setWorkspaces(sortedWorkspaces as any);
    } catch (error) {
      console.error("❌ Error loading workspaces:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateWorkspace = async (workspaceId: string, updates: Partial<Workspace>) => {
    setSaving(workspaceId);
    try {
      // Core workspace fields (including has_crm_access for instant effect on user login)
      const coreFields: any = {};
      if ((updates as any).name !== undefined) coreFields.name = (updates as any).name;
      if ((updates as any).hasCrmAccess !== undefined) coreFields.has_crm_access = (updates as any).hasCrmAccess;
      if (Object.keys(coreFields).length > 0) {
        await supabaseServiceRole.from('workspaces').update(coreFields).eq('id', workspaceId);
      }
      // Subscription fields → workspace_settings category='subscription'
      const subKeys = ['hasCrmAccess','subscriptionStatus','subscriptionTier','trialEndsAt','subscriptionEndsAt','monthlyPrice','hiddenFeatures','brandName','brandLogo'];
      const subUpdates: Record<string, any> = {};
      subKeys.forEach(k => { if ((updates as any)[k] !== undefined) subUpdates[k] = (updates as any)[k]; });
      if (Object.keys(subUpdates).length > 0) {
        const { data: existing } = await supabase.from('workspace_settings').select('data').eq('workspace_id', workspaceId).eq('category', 'subscription').single();
        const merged = { ...((existing?.data as any) || {}), ...subUpdates };
        await supabaseServiceRole.from('workspace_settings').upsert({ workspace_id: workspaceId, category: 'subscription', data: merged }, { onConflict: 'workspace_id,category' });
      }
      await loadWorkspaces();
    } catch (error) {
      console.error("Error updating workspace:", error);
      alert("Failed to update workspace");
    } finally {
      setSaving(null);
    }
  };

  const resetPassword = async (workspaceId: string, email: string) => {
    const newPassword = pwMap[workspaceId]?.trim();
    if (!newPassword || newPassword.length < 6) { alert('Password must be at least 6 characters'); return; }
    setPwSaving(workspaceId);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/set-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({ targetEmail: email, newPassword }),
      });
      const json = await res.json();
      if (json.success) {
        alert(`✅ Password updated for ${email}`);
        setPwMap(prev => ({ ...prev, [workspaceId]: '' }));
      } else {
        alert('Failed: ' + (json.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    } finally {
      setPwSaving(null);
    }
  };

  const toggleHiddenFeature = (workspaceId: string, feature: string) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) return;

    const hiddenFeatures = workspace.hiddenFeatures || [];
    const newHiddenFeatures = hiddenFeatures.includes(feature)
      ? hiddenFeatures.filter(f => f !== feature)
      : [...hiddenFeatures, feature];

    updateWorkspace(workspaceId, { hiddenFeatures: newHiddenFeatures });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle2 className="h-3 w-3" /> Active</span>;
      case 'trial':
        return <span className="flex items-center gap-1 text-blue-600 text-xs"><Clock className="h-3 w-3" /> Trial</span>;
      case 'expired':
        return <span className="flex items-center gap-1 text-red-600 text-xs"><XCircle className="h-3 w-3" /> Expired</span>;
      case 'suspended':
        return <span className="flex items-center gap-1 text-orange-600 text-xs"><XCircle className="h-3 w-3" /> Suspended</span>;
      default:
        return <span className="text-gray-500 text-xs">None</span>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6" />
            Workspace Management
          </h2>
          <p className="text-muted-foreground mt-1">
            Manage CRM access and subscriptions for all registered users. Your workspace is marked with a green badge.
          </p>
        </div>
        <Button 
          onClick={() => {
            setLoading(true);
            loadWorkspaces();
          }}
          variant="outline"
          size="sm"
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {missingCount > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-orange-900">
                    {missingCount} user{missingCount !== 1 ? 's' : ''} without workspace{missingCount !== 1 ? 's' : ''}
                  </p>
                  <p className="text-sm text-orange-700 mt-1">
                    Some registered users haven't logged in yet or their workspace creation failed. 
                    Check the browser console for details.
                  </p>
                </div>
              </div>
              <Button
                onClick={createMissingWorkspaces}
                disabled={saving === 'creating-workspaces'}
                size="sm"
                variant="outline"
                className="bg-white hover:bg-orange-100 border-orange-300"
              >
                {saving === 'creating-workspaces' ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Create Workspaces
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="text-sm text-muted-foreground mb-2">
        Showing {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}
      </div>

      <div className="grid gap-4">
        {workspaces.map((workspace, index) => {
          console.log(`Rendering workspace ${index + 1}/${workspaces.length}:`, workspace.id, workspace.ownerEmail);
          return (
          <Card key={workspace.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="flex items-center gap-2 flex-wrap">
                    {workspace.brandName || workspace.name}
                    {workspace.id === currentWorkspaceId && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-normal">Your Workspace</span>
                    )}
                    {workspace.hasCrmAccess && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">CRM Enabled</span>
                    )}
                  </CardTitle>
                  <CardDescription className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{workspace.ownerEmail}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      ID: {workspace.id} · {workspace.memberCount} member{workspace.memberCount !== 1 ? 's' : ''} · Created {new Date(workspace.createdAt).toLocaleDateString()}
                    </div>
                  </CardDescription>
                </div>
                {getStatusBadge(workspace.subscriptionStatus)}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>CRM Access</Label>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={workspace.hasCrmAccess}
                      onCheckedChange={(checked) => {
                        const updates: any = { hasCrmAccess: !!checked };
                        // Auto-set price to R999 when enabling CRM
                        if (checked && !workspace.monthlyPrice) {
                          updates.monthlyPrice = 999;
                        }
                        updateWorkspace(workspace.id, updates);
                      }}
                    />
                    <span className="text-sm">Enable CRM Features</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Subscription Status</Label>
                  <Select
                    value={workspace.subscriptionStatus}
                    onValueChange={(value) => 
                      updateWorkspace(workspace.id, { subscriptionStatus: value as any })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="trial">Trial</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-blue-900">CRM Subscription</p>
                    <p className="text-sm text-blue-700">R999/month — toggle modules below</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-blue-900">R999</p>
                    <p className="text-xs text-blue-600">per month</p>
                  </div>
                </div>
              </div>

              {/* Module toggles */}
              <div>
                <p className="text-sm font-medium mb-2">Enabled Modules</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: 'sales', label: 'Sales & Invoicing' },
                    { key: 'inventory', label: 'Inventory' },
                    { key: 'analytics', label: 'Analytics' },
                    { key: 'tech_assessment', label: 'Tech Assessment' },
                  ] as const).map(({ key, label }) => {
                    const hidden = (workspace.hiddenFeatures || []).includes(key);
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <Checkbox
                          checked={!hidden}
                          onCheckedChange={() => toggleHiddenFeature(workspace.id, key)}
                        />
                        <span className="text-sm">{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {saving === workspace.id && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </div>
              )}

              {/* Reset Password */}
              <div className="pt-2 border-t">
                <p className="text-sm font-medium mb-2 flex items-center gap-1.5"><KeyRound className="h-4 w-4" /> Set Password</p>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="New password (min 6 chars)"
                    value={pwMap[workspace.id] ?? ''}
                    onChange={e => setPwMap(prev => ({ ...prev, [workspace.id]: e.target.value }))}
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    disabled={pwSaving === workspace.id || !pwMap[workspace.id]}
                    onClick={() => resetPassword(workspace.id, workspace.ownerEmail!)}
                  >
                    {pwSaving === workspace.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Set'}
                  </Button>
                </div>
              </div>

              {/* Impersonation */}
              <div className="pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2 text-amber-700 border-amber-300 hover:bg-amber-50"
                  onClick={async () => {
                    try {
                      const res = await fetch(
                        `${SUPABASE_URL}/functions/v1/impersonate`,
                        {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
                          },
                          body: JSON.stringify({ targetEmail: workspace.ownerEmail }),
                        }
                      );
                      const json = await res.json();
                      if (json.url) {
                        window.open(json.url, '_blank');
                      } else {
                        alert('Impersonation failed: ' + (json.error || 'Unknown error'));
                      }
                    } catch (e: any) {
                      alert('Error: ' + e.message);
                    }
                  }}
                >
                  <LogIn className="h-4 w-4" />
                  Login as {workspace.ownerEmail}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
        })}
      </div>

      {workspaces.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No workspaces found</p>
          <p className="text-sm mt-2">Workspaces are created automatically when users register.</p>
        </div>
      )}
    </div>
  );
}
