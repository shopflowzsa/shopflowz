import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller using admin client (most reliable JWT verification in edge functions)
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authErr } = await adminClient.auth.getUser(token);
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is a system admin
    const { data: profile } = await adminClient
      .from("user_profiles")
      .select("is_system_admin")
      .eq("id", caller.id)
      .maybeSingle();

    if (!profile?.is_system_admin) {
      return new Response(JSON.stringify({ error: "Forbidden: not a system admin" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get target email from request body
    const { targetEmail } = await req.json();
    if (!targetEmail) {
      return new Response(JSON.stringify({ error: "targetEmail required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find target user by email
    // TODO: paginate for workspaces with >1000 users
    const { data: users } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const targetUser = users?.users?.find(u => u.email === targetEmail);
    if (!targetUser) {
      return new Response(JSON.stringify({ error: `No user found with email: ${targetEmail}` }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate a magic link (OTP link) for the target user
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: targetEmail,
      options: {
        redirectTo: `${req.headers.get("origin") || "https://srcomponents.co.za"}/impersonate-landing`,
      },
    });

    if (linkErr || !linkData?.properties?.action_link) {
      return new Response(JSON.stringify({ error: linkErr?.message || "Failed to generate link" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const auditClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await auditClient.from('admin_audit_log').insert({
        action: 'impersonate',
        target_email: targetEmail,
        performed_by: caller.id ?? 'unknown',
        ip: req.headers.get('x-forwarded-for') ?? '',
        metadata: { userAgent: req.headers.get('user-agent') ?? '' }
      });
    } catch (auditErr) {
      console.error('[Audit] Failed to log impersonation:', auditErr);
    }

    return new Response(
      JSON.stringify({ url: linkData.properties.action_link }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
