import {
  createContext, useContext, useEffect, useState, ReactNode,
} from "react";
import { User as SBUser } from "@supabase/supabase-js";
import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { AppUser, WorkspaceMember, WorkspaceRole, Invitation, Workspace, MenuPermission } from "@/types/auth";
import { logActivity } from "@/lib/activityTrackingService";
import { getGlobalDisabledModules, getPlanModuleMap } from "@/lib/modules";

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  workspaceId: string | null;
  workspace: Workspace | null;
  myRole: WorkspaceRole | null;
  members: WorkspaceMember[];
  invitations: Invitation[];
  isSystemAdmin: boolean;
  globalDisabledModules: string[];
  planModules: Record<string, string[]>;
  accessPreviewMemberUid: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string, phone: string, address: string, userType?: 'crm_user' | 'store_customer') => Promise<void>;
  logout: () => Promise<void>;
  createGuestSession: () => Promise<void>;
  inviteUser: (email: string, role: Exclude<WorkspaceRole, "owner">, permissions?: MenuPermission[], skipDuplicateCheck?: boolean) => Promise<void>;
  updateMemberRole: (uid: string, role: Exclude<WorkspaceRole, "owner">, permissions?: MenuPermission[]) => Promise<void>;
  removeMember: (uid: string) => Promise<void>;
  cancelInvitation: (invitationId: string) => Promise<void>;
  fixOwnerRole: () => Promise<void>;
  startAccessPreview: (uid: string) => void;
  stopAccessPreview: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const WS_CACHE_KEY = 'sr_ws_cache';
const ACCESS_PREVIEW_KEY = 'sr_access_preview_uid';

function readWsCache(): Workspace | null {
  try { const v = localStorage.getItem(WS_CACHE_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}
function writeWsCache(ws: Workspace | null) {
  try { ws ? localStorage.setItem(WS_CACHE_KEY, JSON.stringify(ws)) : localStorage.removeItem(WS_CACHE_KEY); } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sbUser, setSbUser] = useState<SBUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  // Pre-populate with cache so ProtectedRoute never sees user+null workspace on refresh
  const [workspace, setWorkspace] = useState<Workspace | null>(readWsCache);
  const [myRole, setMyRole] = useState<WorkspaceRole | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [isSystemAdmin, setIsSystemAdmin] = useState<boolean>(false);
  const [globalDisabledModules, setGlobalDisabledModules] = useState<string[]>([]);
  const [planModules, setPlanModules] = useState<Record<string, string[]>>({});
  const [accessPreviewMemberUid, setAccessPreviewMemberUid] = useState<string | null>(() => {
    try { return localStorage.getItem(ACCESS_PREVIEW_KEY); } catch { return null; }
  });

  async function resolveWorkspace(u: SBUser): Promise<{ id: string; wsData: Record<string, unknown> }> {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("workspace_id, is_system_admin")
      .eq("id", u.id)
      .maybeSingle();

    // Set system admin flag immediately from profile
    setIsSystemAdmin((profile as any)?.is_system_admin === true);

    if (profile?.workspace_id) {
      // Ensure member row exists
      const { data: member } = await supabase
        .from("workspace_members")
        .select("uid")
        .eq("workspace_id", profile.workspace_id)
        .eq("uid", u.id)
        .maybeSingle();
      if (!member) {
        await supabase.from("workspace_members").insert({
          workspace_id: profile.workspace_id,
          uid: u.id,
          email: u.email!,
          display_name: u.user_metadata?.displayName || u.email!.split("@")[0],
          role: "owner",
          joined_at: new Date().toISOString(),
        });
      }
      // Fetch workspace data in same resolution step to avoid separate RLS query
      const { data: wsData } = await supabase
        .from("workspaces")
        .select("*")
        .eq("id", profile.workspace_id)
        .single();
      // Also fetch subscription settings (contains hiddenFeatures, hasCrmAccess, etc.)
      const { data: subData } = await supabase
        .from("workspace_settings")
        .select("data")
        .eq("workspace_id", profile.workspace_id)
        .eq("category", "subscription")
        .maybeSingle();
      // Merge subscription settings into wsData so mapWorkspace can read hiddenFeatures
      const merged = { ...(wsData || {}), ...((subData?.data as Record<string, unknown>) || {}) };
      return { id: profile.workspace_id, wsData: merged };
    }

    // Check for pending invitation
    const { data: inv } = await supabase
      .from("invitations")
      .select("*")
      .eq("email", u.email!)
      .eq("status", "pending")
      .maybeSingle();

    if (inv) {
      await supabase.from("workspace_members").upsert({
        workspace_id: inv.workspace_id,
        uid: u.id,
        email: u.email!,
        display_name: u.user_metadata?.displayName || u.email!.split("@")[0],
        role: inv.role,
        joined_at: new Date().toISOString(),
      });
      await supabase.from("invitations").update({ status: "accepted" }).eq("id", inv.id);
      await supabase.from("user_profiles").upsert({ id: u.id, email: u.email!, workspace_id: inv.workspace_id });
      const { data: wsData } = await supabase.from("workspaces").select("*").eq("id", inv.workspace_id).single();
      // Also fetch subscription settings
      const { data: invSubData } = await supabase
        .from("workspace_settings")
        .select("data")
        .eq("workspace_id", inv.workspace_id)
        .eq("category", "subscription")
        .maybeSingle();
      const invMerged = { ...(wsData || {}), ...((invSubData?.data as Record<string, unknown>) || {}) };
      return { id: inv.workspace_id, wsData: invMerged };
    }

    // Safety check: user may already belong to a workspace via workspace_members
    // (profile.workspace_id was null/missing but member row exists)
    const { data: existingMember } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("uid", u.id)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existingMember?.workspace_id) {
      const { data: wsData } = await supabase.from("workspaces").select("*").eq("id", existingMember.workspace_id).single();
      const { data: subData } = await supabase.from("workspace_settings").select("data").eq("workspace_id", existingMember.workspace_id).eq("category", "subscription").maybeSingle();
      const merged = { ...(wsData || {}), ...((subData?.data as Record<string, unknown>) || {}) };
      // Fix the profile so it points to the right workspace going forward
      await supabase.from("user_profiles").upsert({ id: u.id, email: u.email!, workspace_id: existingMember.workspace_id });
      return { id: existingMember.workspace_id, wsData: merged };
    }

    // Store customers (registered via the public store) should never get a CRM workspace.
    if (u.user_metadata?.user_type === 'store_customer') {
      return { id: '', wsData: { has_crm_access: false } };
    }

    // New owner — create workspace (only columns that actually exist)
    const wid = crypto.randomUUID();
    await supabase.from("workspaces").insert({
      id: wid,
      name: "My Workspace",
      owner_uid: u.id,
      plan: "free",
      has_crm_access: true,
      created_at: new Date().toISOString(),
    });
    await supabase.from("workspace_members").insert({
      workspace_id: wid,
      uid: u.id,
      email: u.email!,
      display_name: u.user_metadata?.displayName || u.email!.split("@")[0],
      role: "owner",
      joined_at: new Date().toISOString(),
    });
    await supabase.from("user_profiles").upsert({
      id: u.id,
      email: u.email!,
      display_name: u.user_metadata?.displayName,
      workspace_id: wid,
      created_at: new Date().toISOString(),
    });
    const { data: wsData } = await supabase.from("workspaces").select("*").eq("id", wid).single();
    // Also fetch subscription settings
    const { data: newSubData } = await supabase
      .from("workspace_settings")
      .select("data")
      .eq("workspace_id", wid)
      .eq("category", "subscription")
      .maybeSingle();
    const newMerged = { ...(wsData || {}), ...((newSubData?.data as Record<string, unknown>) || {}) };
    return { id: wid, wsData: newMerged };
  }

  useEffect(() => {
    // onAuthStateChange fires INITIAL_SESSION on page load — covers the session
    // check without the double-call bug of using getSession() in parallel.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user || null;
      setSbUser(u);

      if (u) {
        // Unblock the UI immediately — cached workspace is already in state
        setLoading(false);

        // Resolve workspace from DB in background (updates cache for next refresh)
        resolveWorkspace(u)
          .then(({ id, wsData }) => {
            // Store customers must never have CRM access regardless of workspace data.
            if (u.user_metadata?.user_type === 'store_customer') {
              wsData = { ...wsData, has_crm_access: false };
            }
            const ws = mapWorkspace(wsData, u.id);
            setWorkspaceId(id || null);
            setWorkspace(id ? ws : null);
            writeWsCache(id ? ws : null);
            if (id) {
              loadMembers(id, u.id);
              loadInvitations(id);
            }
          })
          .catch(e => {
            console.error("Workspace resolve error", e);
            // Only overwrite if we have no cached workspace at all
            setWorkspace(prev => prev ?? { id: "", name: "My Workspace", createdAt: new Date().toISOString(), createdBy: u.id, hasCrmAccess: false, subscriptionStatus: "none", subscriptionTier: "none", hiddenFeatures: [] });
          });
      } else {
        setWorkspaceId(null);
        setWorkspace(null);
        writeWsCache(null);
        setMyRole(null);
        setMembers([]);
        setInvitations([]);
        setIsSystemAdmin(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load platform-wide module flags ("in development" modules hidden from clients)
  // and the per-plan module entitlements (which modules each tier includes).
  useEffect(() => {
    getGlobalDisabledModules()
      .then(setGlobalDisabledModules)
      .catch((e) => console.error("Failed to load global module flags", e));
    getPlanModuleMap()
      .then(setPlanModules)
      .catch((e) => console.error("Failed to load plan module map", e));
  }, []);

  async function loadMembers(wid: string, uid: string) {
    const { data, error } = await supabase.from("workspace_members").select("*").eq("workspace_id", wid);
    if (error) { console.error("[loadMembers] error:", error.message); return; }
    if (data) {
      const list = data.map(d => ({
        uid: d.uid, email: d.email, displayName: d.display_name,
        role: d.role as WorkspaceRole, joinedAt: d.joined_at, permissions: (d.permissions ?? undefined) as MenuPermission[] | undefined,
      } as WorkspaceMember));
      setMembers(list);
      setMyRole(list.find(m => m.uid === uid)?.role ?? null);
    }
  }

  // Re-load members whenever workspaceId resolves (covers the cache-restore path)
  useEffect(() => {
    if (workspaceId && sbUser) {
      loadMembers(workspaceId, sbUser.id);
      loadInvitations(workspaceId);
    }
  }, [workspaceId]);

  async function loadInvitations(wid: string) {
    const { data } = await supabase.from("invitations").select("*").eq("workspace_id", wid).eq("status", "pending");
    if (data) {
      setInvitations(data.map(d => ({
        id: d.id, email: d.email, role: d.role, workspaceId: d.workspace_id,
        invitedBy: d.invited_by, createdAt: d.created_at, status: d.status, permissions: d.permissions,
      } as Invitation)));
    }
  }

  function mapWorkspace(data: Record<string, unknown>, fallbackUid: string): Workspace {
    const expiresAt = data.subscription_expires_at as string | undefined;
    const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;

    // Auto-revert expired plan in DB (fire-and-forget)
    if (isExpired && data.plan && data.plan !== "free") {
      supabase.from("workspaces").update({
        plan: "free",
        subscription_status: "none",
        subscription_expires_at: null,
      }).eq("id", data.id as string).then(() => {});
    }

    return {
      id: data.id as string,
      name: (data.name as string) || "My Workspace",
      createdAt: (data.created_at as string) || new Date().toISOString(),
      createdBy: (data.owner_uid as string) || fallbackUid,
      hasCrmAccess: (data.has_crm_access as boolean) ?? false,
      subscriptionStatus: isExpired ? "none" : ((data.subscription_status as string) || "none"),
      subscriptionTier: (data.subscription_tier as string) || "none",
      trialEndsAt: data.trial_ends_at as string | undefined,
      subscriptionEndsAt: data.subscription_ends_at as string | undefined,
      subscriptionExpiresAt: isExpired ? undefined : expiresAt,
      monthlyPrice: data.monthly_price as number | undefined,
      hiddenFeatures: ((data.hidden_features as string[]) || (data.hiddenFeatures as string[]) || []),
      brandName: data.brand_name as string | undefined,
      brandLogo: data.brand_logo as string | undefined,
      storeSlug: data.store_slug as string | undefined,
      storeEnabled: (data.store_enabled as boolean) ?? false,
      customDomain: data.custom_domain as string | undefined,
      customDomainStatus: (data.custom_domain_status as Workspace['customDomainStatus']) || 'none',
      customDomainEnabled: (data.custom_domain_enabled as boolean) ?? false,
      plan: isExpired ? "free" : ((data.plan as string) || "free"),
    } as Workspace;
  }

  useEffect(() => {
    if (!workspaceId || !sbUser) return;

    // Realtime subscription for live updates (initial data already loaded in resolveWorkspace)
    const channel = supabase
      .channel(`workspace:${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "workspaces", filter: `id=eq.${workspaceId}` }, () => {
        supabase.from("workspaces").select("*").eq("id", workspaceId).single()
          .then(({ data }) => { if (data) setWorkspace(mapWorkspace(data, sbUser.id)); });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "workspace_members", filter: `workspace_id=eq.${workspaceId}` },
        () => loadMembers(workspaceId, sbUser.id))
      .on("postgres_changes", { event: "*", schema: "public", table: "invitations", filter: `workspace_id=eq.${workspaceId}` },
        () => loadInvitations(workspaceId))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [workspaceId, sbUser]);

  const user: AppUser | null = sbUser
    ? { uid: sbUser.id, email: sbUser.email!, displayName: sbUser.user_metadata?.displayName }
    : null;

  async function login(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    
    // Track login activity (done after authentication to ensure we have the user ID)
    try {
      const currentUser = (await supabase.auth.getUser()).data.user;
      if (currentUser?.id) {
        // Get workspace ID from user profile if not yet available in context
        let wsId = workspaceId;
        if (!wsId) {
          const { data: profile } = await supabase
            .from("user_profiles")
            .select("workspace_id")
            .eq("id", currentUser.id)
            .maybeSingle();
          wsId = profile?.workspace_id;
        }
        
        if (wsId) {
          await logActivity(
            wsId,
            currentUser.id,
            'user_logged_in',
            'user',
            currentUser.id,
            currentUser.user_metadata?.displayName,
            { email }
          );
        }
      }
    } catch (e) {
      console.error('Failed to track login activity', e);
    }
  }

  async function register(email: string, password: string, displayName: string, phone: string, address: string, userType: 'crm_user' | 'store_customer' = 'crm_user') {
    // Use admin API — bypasses Supabase rate limits and email confirmation requirement
    // so accounts are created instantly without any "too many attempts" errors.
    const { data, error } = await supabaseServiceRole.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { displayName, user_type: userType },
    });
    if (error) throw error;
    if (data.user) {
      await supabaseServiceRole.from("user_profiles").upsert({
        id: data.user.id, email, display_name: displayName, phone, address,
        created_at: new Date().toISOString(),
      });
    }
  }

  async function createGuestSession(): Promise<void> {
    // Create a temporary guest user with readonly access
    // Store guest session in localStorage for ephemeral shopping experience
    const guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const guestSession = {
      id: guestId,
      email: `guest_${guestId}@guest.local`,
      isGuest: true,
      createdAt: new Date().toISOString(),
      displayName: "Guest User",
    };
    localStorage.setItem("guestSession", JSON.stringify(guestSession));
    setSbUser(null); // No authenticated Supabase user
    setWorkspaceId(null);
    setWorkspace(null);
    setLoading(false);
  }

  async function logout() {
    // Track logout activity before clearing anything
    if (workspaceId && user?.uid) {
      try {
        // Use the activity tracking service to log the logout
        await logActivity(
          workspaceId,
          user.uid,
          'user_logged_out', 
          'user',
          user.uid,
          user.displayName || user.email
        );
        
        // Generate activity summary for the day when logging out
        const today = new Date().toISOString().split('T')[0];
        await supabase.rpc('generate_user_activity_summary', { 
          p_workspace_id: workspaceId, 
          p_user_id: user.uid,
          p_date: today
        });
      } catch (e) {
        console.error('Failed to track logout activity', e);
      }
    }
    
    // Do NOT call supabase.auth.signOut() — it requires the Web Lock and can hang.
    // Instead, manually delete the token from storage so Supabase has nothing to restore.
    const projectRef = (import.meta.env.VITE_SUPABASE_URL as string || '').replace('https://', '').replace('.supabase.co', '');
    const SUPABASE_KEY = `sb-${projectRef}-auth-token`;
    const preservedLocalStorage: Array<[string, string]> = [];
    try {
      const browserId = localStorage.getItem('browser_id');
      if (browserId !== null) preservedLocalStorage.push(['browser_id', browserId]);
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith('cart_')) {
          const value = localStorage.getItem(key);
          if (value !== null) preservedLocalStorage.push([key, value]);
        }
      }
    } catch (_) {}

    try { localStorage.removeItem(SUPABASE_KEY); } catch (_) {}
    try { sessionStorage.removeItem(SUPABASE_KEY); } catch (_) {}
    writeWsCache(null);
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    try {
      preservedLocalStorage.forEach(([key, value]) => localStorage.setItem(key, value));
    } catch (_) {}
    window.location.replace('/login');
  }

  async function inviteUser(email: string, role: Exclude<WorkspaceRole, "owner">, permissions?: MenuPermission[], skipDuplicateCheck = false) {
    console.log("📧 inviteUser called:", { email, role, workspaceId, userId: user?.uid, myRole });
    
    if (!workspaceId || !user) {
      console.error("❌ Not authenticated or no workspace");
      throw new Error("Not authenticated");
    }
    
    if (!myRole) {
      console.error("❌ No role assigned to current user");
      throw new Error("Your role is not loaded. Please refresh the page and try again.");
    }
    
    if (myRole !== "owner") {
      console.error("❌ User is not an owner:", myRole);
      throw new Error("Permission denied. Only workspace owners can invite users.");
    }
    
    // Check if user is already a member
    const existingMember = members.find(m => m.email.toLowerCase() === email.toLowerCase());
    if (existingMember) {
      console.error("❌ User is already a member:", existingMember);
      throw new Error("User is already a member of this workspace");
    }
    
    // Check if invitation already exists (skip when called from resend — the old
    // invite was just deleted but in-memory state hasn't refreshed yet)
    if (!skipDuplicateCheck) {
      const existingInvite = invitations.find(i => i.email.toLowerCase() === email.toLowerCase());
      if (existingInvite) {
        console.error("❌ Invitation already exists:", existingInvite);
        throw new Error("An invitation has already been sent to this email");
      }
    }
    
    const invitationId = crypto.randomUUID();
    const invitationData = {
      id: invitationId,
      workspace_id: workspaceId,
      email: email.toLowerCase().trim(),
      role,
      invited_by: user.uid,
      created_at: new Date().toISOString(),
      status: "pending",
      ...(permissions && { permissions: permissions }),
    };
    
    console.log("📝 Creating invitation:", invitationData);
    
    const { data, error } = await supabase
      .from("invitations")
      .insert(invitationData)
      .select()
      .single();
    
    if (error) {
      console.error("❌ Supabase error inserting invitation:", error);
      throw new Error(`Failed to send invitation: ${error.message}`);
    }
    
    console.log("✅ Invitation created successfully:", data);
    
    // Send invitation email
    try {
      const { data: emailSettings } = await supabase
        .from('workspace_settings')
        .select('data')
        .eq('workspace_id', workspaceId)
        .eq('category', 'email')
        .single();
      
      if (emailSettings?.data) {
        const es = emailSettings.data as any;
        const SMTP_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`;
        
        const host = es.provider === "gmail" ? "smtp.gmail.com" : (es.smtpHost ?? "");
        const port = es.provider === "gmail" ? 587 : (es.smtpPort ?? 465);
        const secure = es.provider === "gmail" ? false : (es.smtpSecure ?? (port === 465));
        
        const workspaceName = workspace?.name || "Our Workspace";
        const invitationUrl = `${window.location.origin}/invite/${invitationId}`;
        
        // Fire-and-forget — invitation record is already saved, email is best-effort
        fetch(SMTP_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            smtpConfig: {
              host,
              port,
              secure,
              user: es.smtpUser,
              pass: es.smtpPassword,
              fromName: es.fromName || workspaceName,
              fromEmail: es.fromEmail || es.smtpUser,
            },
            email: {
              from: `${es.fromName || workspaceName} <${es.fromEmail || es.smtpUser}>`,
              to: email,
              subject: `You've been invited to join ${workspaceName}`,
              text: `You've been invited to join ${workspaceName} as a ${role}.

Click the link below to accept the invitation and set your password:
${invitationUrl}

If you didn't expect this invitation, you can safely ignore this email.`,
              html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
<h2>You've been invited!</h2>
<p>You've been invited to join <strong>${workspaceName}</strong> as a <strong>${role}</strong>.</p>
<p style="margin: 24px 0;">
  <a href="${invitationUrl}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
    Accept Invitation & Set Password
  </a>
</p>
<p style="color: #666; font-size: 14px;">Or copy this link into your browser:<br>
<a href="${invitationUrl}">${invitationUrl}</a></p>
<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
<p style="color: #999; font-size: 12px;">If you didn't expect this invitation, you can safely ignore this email.</p>
</div>`,
            },
          }),
        });
        
        console.log("📧 Invitation email sent to:", email);
      } else {
        console.log("📧 No email settings configured - skipping invitation email. User can still accept via direct link.");
      }
    } catch (emailError) {
      console.error("⚠️ Failed to send invitation email:", emailError);
      // Don't throw - the invitation was created successfully, email is optional
    }
  }

  async function updateMemberRole(uid: string, role: Exclude<WorkspaceRole, "owner">, permissions?: MenuPermission[]) {
    if (!workspaceId) return;
    const update: Record<string, unknown> = { role };
    if (permissions !== undefined) update.permissions = permissions;
    // Use service role to bypass RLS for admin operations
    const { data, error } = await supabaseServiceRole
      .from("workspace_members")
      .update(update)
      .eq("workspace_id", workspaceId)
      .eq("uid", uid)
      .select("*")
      .single();

    if (error) {
      console.error("[updateMemberRole] error:", error.message);
      throw new Error(`Failed to update member: ${error.message}`);
    }

    const updatedMember: WorkspaceMember = {
      uid: data.uid,
      email: data.email,
      displayName: data.display_name,
      role: data.role as WorkspaceRole,
      joinedAt: data.joined_at,
      permissions: (data.permissions ?? undefined) as MenuPermission[] | undefined,
    };

    setMembers(prev => prev.map(member => member.uid === uid ? updatedMember : member));
    if (sbUser) setMyRole(prev => uid === sbUser.id ? updatedMember.role : prev);
  }

  async function removeMember(uid: string) {
    if (!workspaceId) return;
    await supabase.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("uid", uid);
    await supabase.from("user_profiles").delete().eq("id", uid);
  }

  async function cancelInvitation(invitationId: string) {
    console.log("🗑️ Cancelling invitation:", invitationId);
    const { error } = await supabase.from("invitations").delete().eq("id", invitationId);
    if (error) {
      console.error("❌ Error cancelling invitation:", error);
      throw error;
    }
    console.log("✅ Invitation cancelled successfully");
  }

  async function fixOwnerRole() {
    if (!workspaceId || !user) throw new Error("Not authenticated");
    await supabase.from("workspace_members").upsert({
      workspace_id: workspaceId, uid: user.uid, email: user.email,
      display_name: user.displayName || user.email.split("@")[0],
      role: "owner", joined_at: new Date().toISOString(),
    });
  }

  function startAccessPreview(uid: string) {
    setAccessPreviewMemberUid(uid);
    try { localStorage.setItem(ACCESS_PREVIEW_KEY, uid); } catch {}
  }

  function stopAccessPreview() {
    setAccessPreviewMemberUid(null);
    try { localStorage.removeItem(ACCESS_PREVIEW_KEY); } catch {}
  }

  return (
    <AuthContext.Provider value={{
      user, loading, workspaceId, workspace, myRole, members, invitations, isSystemAdmin, globalDisabledModules, planModules, accessPreviewMemberUid,
      login, register, logout, createGuestSession,
      inviteUser, updateMemberRole, removeMember, cancelInvitation, fixOwnerRole,
      startAccessPreview, stopAccessPreview,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
