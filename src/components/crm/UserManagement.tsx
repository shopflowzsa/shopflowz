import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabaseServiceRole } from "@/lib/supabase";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2, UserPlus, Trash2, Mail, Shield, Send, Settings2,
  Eye, KeyRound, Globe, Check, X,
} from "lucide-react";
import { WorkspaceRole, MenuPermission, ALL_MENU_PERMISSIONS, MENU_PERMISSION_LABELS } from "@/types/auth";
import { getAllWorkspacesForAdmin, setCustomDomainEnabled } from "@/lib/storeService";

interface UserManagementProps {
  open: boolean;
  onClose: () => void;
}

const roleColors: Record<WorkspaceRole, string> = {
  owner: "bg-purple-100 text-purple-800 border-purple-200",
  editor: "bg-blue-100 text-blue-800 border-blue-200",
  guest: "bg-gray-100 text-gray-700 border-gray-200",
};

const roleDescriptions = {
  editor: {
    title: "Editor (Team Member)",
    description: "Internal team member with access to all workspace content. Consumes a paid seat."
  },
  guest: {
    title: "Guest (External Partner)",  
    description: "External partner/client with restricted access to specific items only."
  }
};

export function UserManagement({ open, onClose }: UserManagementProps) {
  const {
    user, myRole, members, invitations, isSystemAdmin,
    inviteUser, updateMemberRole, removeMember, cancelInvitation, fixOwnerRole,
    startAccessPreview,
  } = useAuth();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<WorkspaceRole, "owner">>("editor");
  const [inviteError, setInviteError] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [fixingRole, setFixingRole] = useState(false);
  const [editingPermissions, setEditingPermissions] = useState<string | null>(null);
  const [memberPermissions, setMemberPermissions] = useState<MenuPermission[]>([]);
  const [settingPasswordFor, setSettingPasswordFor] = useState<string | null>(null);
  const [newPasswordValue, setNewPasswordValue] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  // System admin: workspace store management
  const [allWorkspaces, setAllWorkspaces] = useState<Awaited<ReturnType<typeof getAllWorkspacesForAdmin>>>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [togglingDomain, setTogglingDomain] = useState<string | null>(null);

  const isOwner = myRole === "owner";
  
  console.log("🎭 UserManagement - Current role:", myRole, "isOwner:", isOwner, "user:", user?.uid);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError("");
    setInviteLoading(true);
    console.log("🚀 Starting invitation process for:", inviteEmail);
    
    // Validate email
    if (!inviteEmail || !inviteEmail.includes("@")) {
      setInviteError("Please enter a valid email address");
      setInviteLoading(false);
      return;
    }
    
    try {
      await inviteUser(inviteEmail.trim().toLowerCase(), inviteRole);
      console.log("✅ Invitation sent successfully!");
      setInviteEmail("");
      setInviteError("");
    } catch (err: unknown) {
      console.error("❌ Invitation failed:", err);
      let errorMessage = "Failed to send invitation. Please try again.";
      
      if (err instanceof Error) {
        errorMessage = err.message;
        
        // Add more specific error handling
        if (err.message.includes("permission") || err.message.includes("owner")) {
          errorMessage = "Permission denied. Only workspace owners can invite users. Try clicking 'Fix My Role' below.";
        } else if (err.message.includes("network")) {
          errorMessage = "Network error. Please check your internet connection.";
        } else if (err.message.includes("auth")) {
          errorMessage = "Authentication error. Please log out and log in again.";
        } else if (err.message.includes("already")) {
          errorMessage = err.message; // Keep the specific message about already member/invited
        } else if (err.message.includes("role is not loaded")) {
          errorMessage = "Your role is not loaded. Please refresh the page and try again.";
        }
      }
      
      setInviteError(errorMessage);
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleRoleChange(uid: string, role: string) {
    setActionLoading(uid);
    try {
      await updateMemberRole(uid, role as Exclude<WorkspaceRole, "owner">);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRemove(uid: string) {
    if (!confirm("Remove this member? They will lose access to the workspace.")) return;
    setActionLoading(uid);
    try {
      await removeMember(uid);
    } finally {
      setActionLoading(null);
    }
  }

  function handleViewAs(uid: string) {
    startAccessPreview(uid);
    onClose();
  }

  async function handleCancelInvite(id: string) {
    if (!confirm("Cancel this invitation? The person will no longer be able to join with this invite.")) return;
    setActionLoading(id);
    try {
      await cancelInvitation(id);
      console.log("✅ Invitation cancelled");
    } catch (error) {
      console.error("❌ Failed to cancel invitation:", error);
      alert("Failed to cancel invitation. Please try again.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResendInvite(inv: typeof invitations[0]) {
    setActionLoading(inv.id);
    try {
      // Cancel the existing invitation first
      await cancelInvitation(inv.id);
      // Pass skipDuplicateCheck=true because the old invite was just deleted but
      // in-memory state hasn't refreshed yet — the duplicate guard would false-positive.
      await inviteUser(inv.email, inv.role as Exclude<WorkspaceRole, "owner">, undefined, true);
      console.log("✅ Invitation resent successfully!");
    } catch (error) {
      console.error("❌ Failed to resend invitation:", error);
      alert("Failed to resend invitation. Please try again.");
    } finally {
      setActionLoading(null);
    }
  }

  function openPermissionsEditor(member: typeof members[0]) {
    setEditingPermissions(member.uid);
    setMemberPermissions(member.permissions || []);
  }

  function closePermissionsEditor() {
    setEditingPermissions(null);
    setMemberPermissions([]);
  }

  function togglePermission(perm: MenuPermission) {
    setMemberPermissions(prev =>
      prev.includes(perm)
        ? prev.filter(p => p !== perm)
        : [...prev, perm]
    );
  }

  async function handleSavePermissions(uid: string) {
    setActionLoading(uid);
    try {
      const member = members.find(m => m.uid === uid);
      if (member && member.role !== "owner") {
        await updateMemberRole(uid, member.role as Exclude<WorkspaceRole, "owner">, memberPermissions);
      }
      closePermissionsEditor();
    } catch (error) {
      console.error("❌ Failed to save permissions:", error);
      alert("Failed to save permissions. Please try again.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleFixRole() {
    setFixingRole(true);
    try {
      await fixOwnerRole();
      console.log("✅ Owner role fixed, UI should update automatically");
    } catch (error) {
      console.error("❌ Failed to fix role:", error);
    } finally {
      setFixingRole(false);
    }
  }

  async function loadAllWorkspaces() {
    setLoadingWorkspaces(true);
    try {
      const ws = await getAllWorkspacesForAdmin();
      setAllWorkspaces(ws);
    } finally {
      setLoadingWorkspaces(false);
    }
  }

  async function handleToggleCustomDomain(workspaceId: string, current: boolean) {
    setTogglingDomain(workspaceId);
    try {
      await setCustomDomainEnabled(workspaceId, !current);
      setAllWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, customDomainEnabled: !current } : w));
    } catch {
      alert("Failed to update. Please try again.");
    } finally {
      setTogglingDomain(null);
    }
  }

  function initials(name?: string, email?: string) {
    const s = name || email || "?";
    return s.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);
  }

  function openSetPassword(uid: string) {
    setSettingPasswordFor(uid);
    setNewPasswordValue("");
    setPasswordError("");
    setPasswordSuccess("");
  }

  function closeSetPassword() {
    setSettingPasswordFor(null);
    setNewPasswordValue("");
    setPasswordError("");
    setPasswordSuccess("");
  }

  async function handleSetPassword(uid: string) {
    if (newPasswordValue.length < 6) {
      setPasswordError("Password must be at least 6 characters");
      return;
    }
    setActionLoading(uid);
    setPasswordError("");
    try {
      const { error } = await supabaseServiceRole.auth.admin.updateUserById(uid, { password: newPasswordValue, email_confirm: true });
      if (error) { setPasswordError(error.message); return; }
      setPasswordSuccess("Password updated!");
      setTimeout(closeSetPassword, 1500);
    } catch (e: any) {
      setPasswordError(e.message || "Failed to update password");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" /> Manage Users
          </DialogTitle>
          <DialogDescription>
            Invite people and control their access to this workspace.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="members">
          <TabsList className="w-full">
            <TabsTrigger value="members" className="flex-1">
              Members ({members.length})
            </TabsTrigger>
            {isOwner && (
              <TabsTrigger value="invite" className="flex-1">
                Invite
              </TabsTrigger>
            )}
            {isOwner && invitations.length > 0 && (
              <TabsTrigger value="pending" className="flex-1">
                Pending ({invitations.length})
              </TabsTrigger>
            )}
            {isSystemAdmin && (
              <TabsTrigger value="workspaces" className="flex-1" onClick={loadAllWorkspaces}>
                <Globe className="h-3.5 w-3.5 mr-1" />
                Stores
              </TabsTrigger>
            )}
          </TabsList>

          {/* Debug Info & Fix Role - Show when not owner OR when there's an issue */}
          {(myRole !== "owner" || inviteError) && (
            <Alert className="mt-4" variant={myRole !== "owner" ? "warning" : "destructive"}>
              <AlertDescription className="space-y-3">
                <div>
                  <strong>⚠️ {myRole !== "owner" ? "Missing Owner Permissions" : "Invitation Failed"}</strong><br/>
                  Current role: <Badge variant="outline">{myRole || "null"}</Badge><br/>
                  User ID: {user?.uid?.slice(0, 8) || "none"}<br/>
                  {myRole !== "owner" && "You need 'owner' role to invite users."}
                </div>
                {inviteError && (
                  <div className="text-sm">
                    <strong>Error:</strong> {inviteError}
                  </div>
                )}
                <div>
                  <strong>🔧 Fix This Issue:</strong><br/>
                  If you registered this app or should be the owner, click below:
                </div>
                <Button
                  onClick={handleFixRole}
                  disabled={fixingRole}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  {fixingRole ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Setting Owner Role...
                    </>
                  ) : (
                    <>
                      <Shield className="h-4 w-4" />
                      I Am The Owner - Fix My Role
                    </>
                  )}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* ── MEMBERS ── */}
          <TabsContent value="members" className="mt-4 space-y-2">
            {members.map((m) => (
              <div key={m.uid}>
              <div
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">
                    {initials(m.displayName, m.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {m.displayName || m.email}
                    {m.uid === user?.uid && (
                      <span className="text-muted-foreground font-normal"> (you)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                </div>

                {isOwner && m.uid !== user?.uid ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={m.role}
                      onValueChange={(v) => handleRoleChange(m.uid, v)}
                      disabled={actionLoading === m.uid}
                    >
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="guest">Guest</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-blue-600 hover:text-blue-700"
                      onClick={() => openPermissionsEditor(m)}
                      title="Manage permissions"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-emerald-600 hover:text-emerald-700"
                      onClick={() => handleViewAs(m.uid)}
                      title="View as this user"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-indigo-600 hover:text-indigo-700"
                      onClick={() => openSetPassword(m.uid)}
                      title="Set password"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleRemove(m.uid)}
                      disabled={actionLoading === m.uid}
                    >
                      {actionLoading === m.uid
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                ) : (
                  <Badge variant="outline" className={`text-xs ${roleColors[m.role]}`}>
                    {m.role}
                  </Badge>
                )}
              </div>

              {/* Inline set-password form */}
              {settingPasswordFor === m.uid && (
                <div className="ml-11 mt-1 mb-2 p-3 bg-muted/50 rounded-lg space-y-2">
                  {passwordSuccess ? (
                    <p className="text-sm text-green-600 font-medium">{passwordSuccess}</p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">Set new password for <strong>{m.displayName || m.email}</strong></p>
                      <div className="flex gap-2">
                        <Input
                          type="password"
                          placeholder="New password (min 6 chars)"
                          value={newPasswordValue}
                          onChange={e => setNewPasswordValue(e.target.value)}
                          className="h-8 text-sm"
                          autoFocus
                        />
                        <Button size="sm" className="h-8 bg-indigo-600 hover:bg-indigo-700" onClick={() => handleSetPassword(m.uid)} disabled={actionLoading === m.uid}>
                          {actionLoading === m.uid ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={closeSetPassword}>Cancel</Button>
                      </div>
                      {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
                    </>
                  )}
                </div>
              )}
              </div>
            ))}
          </TabsContent>

          {/* ── INVITE ── */}
          {isOwner && (
            <TabsContent value="invite" className="mt-4">
              <form onSubmit={handleInvite} className="space-y-4">
                {inviteError && (
                  <Alert variant="destructive">
                    <AlertDescription>{inviteError}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-1.5">
                  <Label>Email address</Label>
                  <Input
                    type="email"
                    placeholder="colleague@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as typeof inviteRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="editor">
                        <div>
                          <div className="font-medium">{roleDescriptions.editor.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {roleDescriptions.editor.description}
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="guest">
                        <div>
                          <div className="font-medium">{roleDescriptions.guest.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {roleDescriptions.guest.description}
                          </div>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">How invitations work</p>
                  <p>Click the link in the invitation email to set your password and join the workspace.</p>
                  <p className="text-orange-600">💡 <strong>Tip:</strong> Configure email settings in the sidebar to automatically send invitation emails!</p>
                </div>

                <Button type="submit" className="w-full gap-2" disabled={inviteLoading}>
                  {inviteLoading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <UserPlus className="h-4 w-4" />}
                  Send Invitation
                </Button>
              </form>
            </TabsContent>
          )}

          {/* ── PENDING ── */}
          {isOwner && invitations.length > 0 && (
            <TabsContent value="pending" className="mt-4 space-y-2">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50"
                >
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Invited as{" "}
                      <span className="font-medium">{inv.role}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                      onClick={() => handleResendInvite(inv)}
                      disabled={actionLoading === inv.id}
                      title="Resend invitation"
                    >
                      {actionLoading === inv.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Send className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleCancelInvite(inv.id)}
                      disabled={actionLoading === inv.id}
                      title="Delete invitation"
                    >
                      {actionLoading === inv.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              ))}
            </TabsContent>
          )}
          {/* ── WORKSPACES (system admin only) ── */}
          {isSystemAdmin && (
            <TabsContent value="workspaces" className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground pb-1">
                Toggle custom domain linking per client workspace. Clients only see the option when enabled.
              </p>
              {loadingWorkspaces ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : allWorkspaces.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Click the Stores tab to load workspaces.</p>
              ) : (
                allWorkspaces.map((ws) => (
                  <div key={ws.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ws.name}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {ws.storeSlug ? `shopflowz.web.app/store/${ws.storeSlug}` : "No store slug set"}
                        {ws.customDomain ? ` · ${ws.customDomain}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {ws.customDomainEnabled ? (
                        <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">Domain enabled</span>
                      ) : (
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full border">Domain off</span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-7 w-7 ${ws.customDomainEnabled ? "text-green-600 hover:text-destructive" : "text-muted-foreground hover:text-green-600"}`}
                        title={ws.customDomainEnabled ? "Disable custom domain" : "Enable custom domain"}
                        onClick={() => handleToggleCustomDomain(ws.id, ws.customDomainEnabled)}
                        disabled={togglingDomain === ws.id}
                      >
                        {togglingDomain === ws.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : ws.customDomainEnabled
                            ? <Check className="h-3.5 w-3.5" />
                            : <Globe className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>

      {/* Permissions Editor Dialog */}
      {editingPermissions && (
        <Dialog open={!!editingPermissions} onOpenChange={() => closePermissionsEditor()}>
          <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Manage User Permissions</DialogTitle>
              <DialogDescription>
                Select which menu items this user can see. Leave all unchecked for full access.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4 overflow-y-auto pr-1">
              {ALL_MENU_PERMISSIONS.map((perm) => (
                <label key={perm} className="flex items-center gap-3 cursor-pointer hover:bg-slate-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={memberPermissions.includes(perm)}
                    onChange={() => togglePermission(perm)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium">{MENU_PERMISSION_LABELS[perm]}</span>
                </label>
              ))}
            </div>
            <div className="flex shrink-0 justify-end gap-2 pt-3 border-t bg-background">
              <Button variant="outline" onClick={closePermissionsEditor}>
                Cancel
              </Button>
              <Button onClick={() => handleSavePermissions(editingPermissions)} disabled={actionLoading === editingPermissions}>
                {actionLoading === editingPermissions ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Save Permissions"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
