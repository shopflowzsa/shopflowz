import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle, XCircle, Shield, Users } from "lucide-react";

interface InvitationDetails {
  id: string;
  email: string;
  role: string;
  workspace_id: string;
  workspace_name?: string;
}

export default function AcceptInvitationPage() {
  const { invitationId } = useParams<{ invitationId: string }>();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  
  useEffect(() => {
    if (!invitationId) {
      setError("Invalid invitation link");
      setLoading(false);
      return;
    }
    
    loadInvitation();
  }, [invitationId]);
  
  async function loadInvitation() {
    try {
      // First check if user is already logged in - if so, they might be trying to accept with wrong account
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      // Use service role client to bypass RLS (invitation data is not sensitive)
      const { data: inv, error: invError } = await supabaseServiceRole
        .from("invitations")
        .select("*")
        .eq("id", invitationId)
        .eq("status", "pending")
        .single();
      
      if (invError || !inv) {
        setError("This invitation is invalid or has already been used");
        setLoading(false);
        return;
      }
      
      // Fetch workspace name
      let workspaceName = "Your Workspace";
      const { data: ws } = await supabase
        .from("workspaces")
        .select("name")
        .eq("id", inv.workspace_id)
        .single();
      
      if (ws) {
        workspaceName = ws.name;
      }
      
      setInvitation({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        workspace_id: inv.workspace_id,
        workspace_name: workspaceName,
      });
      
      // Pre-fill display name from email
      const suggestedName = inv.email.split("@")[0];
      setDisplayName(suggestedName);
      
      // Check if this email matches the logged-in user
      if (currentUser && currentUser.email?.toLowerCase() !== inv.email.toLowerCase()) {
        setError(`You are logged in as ${currentUser.email}. Please log out and use the correct account, or open this link in an incognito window.`);
      }
    } catch (err) {
      console.error("Error loading invitation:", err);
      setError("Failed to load invitation details");
    } finally {
      setLoading(false);
    }
  }
  
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    
    if (!invitation) return;
    
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    
    setSubmitting(true);
    
    try {
      // Create the user account via admin API — bypasses email confirmation & rate limits.
      // If the account already exists (from a previous attempt), look it up and reuse it.
      let userId: string;
      const { data: authData, error: authError } = await supabaseServiceRole.auth.admin.createUser({
        email: invitation.email,
        password: password,
        email_confirm: true,
        user_metadata: { displayName },
      });

      if (authError) {
        const alreadyExists = authError.message.toLowerCase().includes("already been registered")
          || authError.message.toLowerCase().includes("already registered")
          || authError.message.toLowerCase().includes("already exists");
        if (!alreadyExists) throw authError;

        // User exists — find their ID. Try user_profiles first (fast path).
        let foundId: string | null = null;
        const { data: profile } = await supabaseServiceRole
          .from("user_profiles")
          .select("id")
          .eq("email", invitation.email.toLowerCase())
          .maybeSingle();
        if (profile?.id) {
          foundId = profile.id;
        } else {
          // Profile wasn't created in a prior attempt — search Supabase Auth directly
          const { data: listData } = await supabaseServiceRole.auth.admin.listUsers({ page: 1, perPage: 1000 });
          const found = listData?.users?.find(u => u.email?.toLowerCase() === invitation.email.toLowerCase());
          if (found) foundId = found.id;
        }

        if (!foundId) throw new Error("Could not locate your account. Please contact support.");
        userId = foundId;

        // Update password and confirm email (account may have been created unconfirmed)
        await supabaseServiceRole.auth.admin.updateUserById(userId, { password, email_confirm: true });
      } else {
        if (!authData.user) throw new Error("Failed to create account");
        userId = authData.user.id;
      }

      // Add user to workspace_members
      const { error: memberError } = await supabaseServiceRole
        .from("workspace_members")
        .upsert({
          workspace_id: invitation.workspace_id,
          uid: userId,
          email: invitation.email,
          display_name: displayName,
          role: invitation.role,
          joined_at: new Date().toISOString(),
        }, { onConflict: "workspace_id,uid" });

      if (memberError) throw memberError;

      // Create user profile
      const { error: profileError } = await supabaseServiceRole
        .from("user_profiles")
        .upsert({
          id: userId,
          email: invitation.email,
          display_name: displayName,
          workspace_id: invitation.workspace_id,
          created_at: new Date().toISOString(),
        });

      if (profileError) throw profileError;
      
      // Mark invitation as accepted
      await supabaseServiceRole
        .from("invitations")
        .update({ status: "accepted" })
        .eq("id", invitation.id);
      
      setSuccess(true);
      
      // Redirect to login after a moment
      setTimeout(() => {
        navigate("/login");
      }, 3000);
      
    } catch (err: any) {
      console.error("Error accepting invitation:", err);
      setError(err.message || "Failed to create account. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-orange-500" />
          <p className="mt-2 text-gray-600">Loading invitation...</p>
        </div>
      </div>
    );
  }
  
  if (error && !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
              <XCircle className="h-6 w-6 text-red-500" />
            </div>
            <CardTitle className="text-xl">Invalid Invitation</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate("/login")} className="bg-orange-500 hover:bg-orange-600">
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-500" />
            </div>
            <CardTitle className="text-xl text-green-700">Account Created!</CardTitle>
            <CardDescription>
              You've successfully joined <strong>{invitation?.workspace_name}</strong> as an <strong>{invitation?.role}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-gray-600 mb-4">Redirecting you to login...</p>
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-orange-500" />
          </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center">
            <Users className="h-8 w-8 text-orange-500" />
          </div>
          <CardTitle className="text-2xl">You're Invited!</CardTitle>
          <CardDescription>
            Join <strong>{invitation?.workspace_name}</strong> as <strong>{invitation?.role}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 p-3 bg-gray-50 rounded-lg text-sm">
            <p><strong>Email:</strong> {invitation?.email}</p>
            <p><strong>Role:</strong> {invitation?.role}</p>
          </div>
          
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Your Name</Label>
              <Input
                id="displayName"
                type="text"
                placeholder="John Smith"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>
            
            <div className="space-y-1.5">
              <Label htmlFor="password">Create Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            
            <Button
              type="submit"
              className="w-full bg-orange-500 hover:bg-orange-600"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Account...
                </>
              ) : (
                <>
                  <Shield className="mr-2 h-4 w-4" />
                  Join Workspace
                </>
              )}
            </Button>
          </form>
          
          <p className="text-xs text-gray-500 text-center mt-4">
            By joining, you agree to the workspace terms and conditions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}