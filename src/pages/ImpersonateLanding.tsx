import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Landing page for admin impersonation sessions.
 * Called when admin clicks "Login as [client]".
 * Waits for Supabase to establish the session from the magic-link hash
 * before setting the impersonation flag and redirecting to /crm.
 */
export default function ImpersonateLanding() {
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase processes the magic-link tokens from the URL hash asynchronously.
    // We must wait for SIGNED_IN before navigating, otherwise /crm sees no session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        subscription.unsubscribe();
        sessionStorage.setItem("impersonated", "1");
        navigate("/crm", { replace: true });
      }
    });

    // Safety fallback: if already signed in (session already there), navigate immediately
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        subscription.unsubscribe();
        sessionStorage.setItem("impersonated", "1");
        navigate("/crm", { replace: true });
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Starting impersonation session...</span>
      </div>
    </div>
  );
}
