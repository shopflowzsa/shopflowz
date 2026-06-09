import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ArrowLeft, CheckCircle2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getWorkspaceInfoByDomain } from "@/lib/storeService";
import { loadEcommerceSettings } from "@/lib/ecommerceSettingsService";

const BRAND_TEAL = "#1D9E75";

const MAIN_HOSTS = ["shopflowz.web.app", "shopflowz.firebaseapp.com", "shopflowz.co.za", "www.shopflowz.co.za", "localhost", "127.0.0.1"];
const isCustomDomain = !MAIN_HOSTS.some((h) => {
  const host = window.location.hostname;
  return host === h || host.endsWith(`.${h}`);
});

export default function LoginPage() {
  const { login, register, createGuestSession, workspaceId, workspace, isSystemAdmin, user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get("tab") === "register" ? "register" : "login";

  const [tenantName, setTenantName] = useState("");
  const [tenantLogo, setTenantLogo] = useState("");
  const [tenantAccent, setTenantAccent] = useState("");
  const [tenantWorkspaceId, setTenantWorkspaceId] = useState("");

  useEffect(() => {
    if (!isCustomDomain) return;
    (async () => {
      try {
        const info = await getWorkspaceInfoByDomain(window.location.hostname);
        if (!info) return;
        setTenantWorkspaceId(info.id);
        // Use workspace name as baseline, then override with ecommerce settings if available
        if (info.name) setTenantName(info.name);
        const settings = await loadEcommerceSettings(info.id);
        if (settings.storeName) setTenantName(settings.storeName);
        if (settings.storeLogo) setTenantLogo(settings.storeLogo);
        if ((settings as any).accentColor) setTenantAccent((settings as any).accentColor);
      } catch {
        // silently fall back to ShopFlowz branding
      }
    })();
  }, []);

  // Force light mode on this public page regardless of the user's CRM theme setting
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => { if (wasDark) root.classList.add("dark"); };
  }, []);

  // Login form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Register form
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regAddress, setRegAddress] = useState("");
  const [regSuburb, setRegSuburb] = useState("");
  const [regCity, setRegCity] = useState("");
  const [regPostalCode, setRegPostalCode] = useState("");
  const [regError, setRegError] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [regSuccess, setRegSuccess] = useState(false);
  const [regRetrySeconds, setRegRetrySeconds] = useState(0);

  // Forgot password
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState("");

  // Recovery mode — shown when user clicks the reset-password email link
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryDone, setRecoveryDone] = useState(false);

  // Track whether we just submitted a form — wait for workspaceId to resolve
  const [redirecting, setRedirecting] = useState(false);

  // Detect PASSWORD_RECOVERY event (user arrived via reset-password link)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Countdown timer for rate limit retry
  useEffect(() => {
    if (regRetrySeconds <= 0) return;
    const interval = setInterval(() => {
      setRegRetrySeconds(s => s - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [regRetrySeconds]);

  // Redirect after successful form submission only
  useEffect(() => {
    if (loading || recoveryMode || !redirecting) return;
    if (isCustomDomain) { navigate("/", { replace: true }); return; }
    if (user && isSystemAdmin) { navigate("/admin", { replace: true }); return; }
    if (workspaceId && workspace) navigate("/crm", { replace: true });
  }, [loading, recoveryMode, redirecting, user, workspaceId, workspace, isSystemAdmin, navigate]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      await login(loginEmail, loginPassword);
      setRedirecting(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login failed";
      setLoginError(friendlyError(msg));
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegError("");
    if (regPassword !== regConfirm) { setRegError("Passwords do not match"); return; }
    if (regPassword.length < 6) { setRegError("Password must be at least 6 characters"); return; }
    if (!regPhone.trim()) { setRegError("Phone number is required"); return; }
    if (!regAddress.trim()) { setRegError("Address is required"); return; }
    setRegLoading(true);
    try {
      // Register the account — will auto-authenticate if email verification is disabled
      const fullAddress = [regAddress, regSuburb, regCity, regPostalCode].filter(Boolean).join(', ');
      await register(regEmail, regPassword, regName, regPhone, fullAddress);
      setRegSuccess(true);
      setRegError("");
      // Don't call login again — just mark as redirecting and let onAuthStateChange handle it
      setRedirecting(true);
      // Auto-clear form after successful signup
      setTimeout(() => {
        setRegName("");
        setRegEmail("");
        setRegPassword("");
        setRegConfirm("");
        setRegPhone("");
        setRegAddress("");
        setRegSuburb("");
        setRegCity("");
        setRegPostalCode("");
      }, 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      const friendlyMsg = friendlyError(msg);
      setRegError(friendlyMsg);
      // Extract retry-after from rate limit error if available
      if ((msg.toLowerCase().includes("rate") || msg.toLowerCase().includes("too_many")) && msg.includes("retry")) {
        const retryMatch = msg.match(/(\d+)/);
        if (retryMatch) {
          setRegRetrySeconds(parseInt(retryMatch[1]));
        }
      }
    } finally {
      setRegLoading(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setForgotError("");
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: window.location.origin + "/login",
      });
      if (error) throw error;
      setForgotSent(true);
    } catch (err: unknown) {
      setForgotError(err instanceof Error ? err.message : "Failed to send reset email");
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleSetNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setRecoveryError("");
    if (newPassword !== newPasswordConfirm) { setRecoveryError("Passwords do not match"); return; }
    if (newPassword.length < 6) { setRecoveryError("Password must be at least 6 characters"); return; }
    setRecoveryLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setRecoveryDone(true);
    } catch (err: unknown) {
      setRecoveryError(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setRecoveryLoading(false);
    }
  }

  async function handleGuestCheckout() {
    try {
      await createGuestSession();
      navigate("/", { replace: true });
    } catch (err: unknown) {
      console.error("Guest session failed", err);
    }
  }

  // ── Recovery mode (arrived via password-reset email link) ──
  if (recoveryMode) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div
              className="inline-flex items-center justify-center h-12 w-12 rounded-xl text-white font-extrabold text-xl mb-4"
              style={{ background: BRAND_TEAL }}
            >
              S
            </div>
            <h1 className="text-2xl font-bold">Set New Password</h1>
          </div>
          <Card>
            <CardContent className="pt-6">
              {recoveryDone ? (
                <div className="text-center space-y-4">
                  <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
                  <p className="font-medium">Password updated!</p>
                  <Button
                    className="w-full text-white"
                    style={{ background: BRAND_TEAL }}
                    onClick={() => { setRecoveryMode(false); setRecoveryDone(false); }}
                  >
                    Sign In
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSetNewPassword} className="space-y-4">
                  {recoveryError && <Alert variant="destructive"><AlertDescription>{recoveryError}</AlertDescription></Alert>}
                  <div className="space-y-1.5">
                    <Label>New Password</Label>
                    <Input type="password" autoComplete="new-password" placeholder="6+ characters"
                      value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Confirm Password</Label>
                    <Input type="password" autoComplete="new-password" placeholder="••••••••"
                      value={newPasswordConfirm} onChange={(e) => setNewPasswordConfirm(e.target.value)} required />
                  </div>
                  <Button
                    type="submit"
                    className="w-full text-white"
                    style={{ background: BRAND_TEAL }}
                    disabled={recoveryLoading}
                  >
                    {recoveryLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Update Password
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-8 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>

        <div className="text-center mb-8">
          {isCustomDomain && tenantLogo ? (
            <img src={tenantLogo} alt={tenantName} className="h-12 w-12 rounded-xl object-cover mx-auto mb-4" />
          ) : (
            <div
              className="inline-flex items-center justify-center h-12 w-12 rounded-xl text-white font-extrabold text-xl mb-4"
              style={{ background: isCustomDomain && tenantAccent ? tenantAccent : BRAND_TEAL }}
            >
              {isCustomDomain && tenantName ? tenantName[0].toUpperCase() : "S"}
            </div>
          )}
          <h1 className="text-2xl font-bold">
            {isCustomDomain && tenantName
              ? tenantName
              : <><span>Shop</span><span style={{ color: BRAND_TEAL }}>Flowz</span></>}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isCustomDomain ? "Sign in to your account" : "Sign in to your business dashboard"}
          </p>
        </div>

        <Tabs defaultValue={defaultTab}>
          <TabsList className="w-full mb-6">
            <TabsTrigger value="login" className="flex-1">Sign In</TabsTrigger>
            <TabsTrigger value="register" className="flex-1">{isCustomDomain ? "Register" : "Start Free Trial"}</TabsTrigger>
          </TabsList>

          {/* ── LOGIN ── */}
          <TabsContent value="login">
            {forgotMode ? (
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Reset Password</CardTitle>
                  <CardDescription>Enter your email and we&apos;ll send a reset link</CardDescription>
                </CardHeader>
                <CardContent>
                  {forgotSent ? (
                    <div className="text-center space-y-4">
                      <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
                      <p className="text-sm">Check your inbox for a password reset link.</p>
                      <Button variant="outline" className="w-full" onClick={() => { setForgotMode(false); setForgotSent(false); }}>
                        Back to Sign In
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                      {forgotError && <Alert variant="destructive"><AlertDescription>{forgotError}</AlertDescription></Alert>}
                      <div className="space-y-1.5">
                        <Label htmlFor="forgot-email">Email</Label>
                        <Input id="forgot-email" type="email" autoComplete="email" placeholder="you@example.com"
                          value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} required />
                      </div>
                      <Button type="submit" className="w-full text-white" style={{ background: BRAND_TEAL }} disabled={forgotLoading}>
                        {forgotLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Send Reset Link
                      </Button>
                      <Button type="button" variant="ghost" className="w-full" onClick={() => setForgotMode(false)}>
                        Cancel
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            ) : (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Welcome back</CardTitle>
                <CardDescription>Enter your email and password to continue</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  {loginError && <Alert variant="destructive"><AlertDescription>{loginError}</AlertDescription></Alert>}
                  <div className="space-y-1.5">
                    <Label htmlFor="login-email">Email</Label>
                    <Input id="login-email" type="email" autoComplete="email" placeholder="you@example.com"
                      value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="login-password">Password</Label>
                      <button type="button" onClick={() => { setForgotEmail(loginEmail); setForgotMode(true); }}
                        className="text-xs hover:opacity-80 transition-opacity" style={{ color: BRAND_TEAL }}>
                        Forgot password?
                      </button>
                    </div>
                    <Input id="login-password" type="password" autoComplete="current-password" placeholder="••••••••"
                      value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required />
                  </div>
                  <Button type="submit" className="w-full text-white" style={{ background: BRAND_TEAL }} disabled={loginLoading}>
                    {loginLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Sign In
                  </Button>
                </form>
              </CardContent>
            </Card>
            )}
          </TabsContent>

          {/* ── REGISTER ── */}
          <TabsContent value="register">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Create your account</CardTitle>
                {!isCustomDomain && <CardDescription>14-day free trial — full access, no credit card required</CardDescription>}
              </CardHeader>
              <CardContent>
                {regSuccess ? (
                  <div className="text-center space-y-4">
                    <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
                    <div>
                      <p className="font-semibold text-lg">Account created!</p>
                      <p className="text-sm text-gray-600 mt-1">{isCustomDomain ? "Redirecting to the store..." : "Setting up your workspace and redirecting..."}</p>
                      {!isCustomDomain && <p className="text-xs text-gray-500 mt-2">Your 14-day free trial starts now!</p>}
                    </div>
                    <div className="flex justify-center">
                      <Loader2 className="h-5 w-5 animate-spin" style={{ color: BRAND_TEAL }} />
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleRegister} className="space-y-4">
                    {regError && (
                      <Alert variant="destructive">
                        <AlertDescription className="flex items-start justify-between gap-3">
                          <span>{regError}</span>
                          <button
                            type="button"
                            onClick={() => setRegError("")}
                            className="text-red-600 hover:text-red-800 flex-shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-name">Full Name</Label>
                      <Input id="reg-name" autoComplete="name" placeholder="Jane Smith"
                        value={regName} onChange={(e) => setRegName(e.target.value)} required disabled={regLoading} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-email">Email</Label>
                      <Input id="reg-email" type="email" autoComplete="email" placeholder="you@example.com"
                        value={regEmail} onChange={(e) => setRegEmail(e.target.value)} required disabled={regLoading} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-phone">Phone Number</Label>
                      <Input id="reg-phone" type="tel" autoComplete="tel" placeholder="0615010457"
                        value={regPhone} onChange={(e) => setRegPhone(e.target.value)} required disabled={regLoading} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-address">Street Address</Label>
                      <Input id="reg-address" autoComplete="address-line1" placeholder="123 Main Street"
                        value={regAddress} onChange={(e) => setRegAddress(e.target.value)} required disabled={regLoading} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="reg-suburb">Suburb</Label>
                        <Input id="reg-suburb" autoComplete="address-line2" placeholder="Suburb"
                          value={regSuburb} onChange={(e) => setRegSuburb(e.target.value)} disabled={regLoading} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="reg-city">City</Label>
                        <Input id="reg-city" autoComplete="address-level2" placeholder="City"
                          value={regCity} onChange={(e) => setRegCity(e.target.value)} disabled={regLoading} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-postal">Postal Code</Label>
                      <Input id="reg-postal" autoComplete="postal-code" placeholder="0000"
                        value={regPostalCode} onChange={(e) => setRegPostalCode(e.target.value)} disabled={regLoading} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-password">Password</Label>
                      <Input id="reg-password" type="password" autoComplete="new-password" placeholder="6+ characters"
                        value={regPassword} onChange={(e) => setRegPassword(e.target.value)} required disabled={regLoading} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-confirm">Confirm Password</Label>
                      <Input id="reg-confirm" type="password" autoComplete="new-password" placeholder="••••••••"
                        value={regConfirm} onChange={(e) => setRegConfirm(e.target.value)} required disabled={regLoading} />
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full text-white" style={{ background: BRAND_TEAL }} 
                      disabled={regLoading || regRetrySeconds > 0}
                    >
                      {regLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {regRetrySeconds > 0 
                        ? `Try again in ${regRetrySeconds}s` 
                        : regLoading 
                          ? "Creating account..." 
                          : "Create Account"
                      }
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}

function friendlyError(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes("invalid_credentials") || r.includes("invalid login") || r.includes("wrong-password") || r.includes("user-not-found") || r.includes("invalid-credential"))
    return "Incorrect email or password";
  if (r.includes("email-already-in-use") || r.includes("user_already_exists") || r.includes("already been registered"))
    return "An account with that email already exists";
  if (r.includes("too-many-requests") || r.includes("too_many_requests") || (r.includes("rate") && r.includes("limit"))) {
    // Extract seconds from error if available
    const retryMatch = raw.match(/(\d+)\s*s(econds?)?|retry after (\d+)/i);
    if (retryMatch) {
      const seconds = parseInt(retryMatch[1] || retryMatch[3]);
      return `Too many attempts. Please wait ${seconds} seconds before trying again`;
    }
    return "Too many signup attempts. Please wait a minute and try again";
  }
  if (r.includes("network") || r.includes("fetch"))
    return "Network error. Check your connection";
  if (r.includes("email not confirmed"))
    return "Please confirm your email before signing in";
  return raw.replace("Firebase:", "").replace(/\(.*?\)/g, "").trim();
}

