import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Verify caller using admin client (most reliable JWT verification in edge functions)
    const adminClient = createClient(supabaseUrl, serviceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await adminClient.auth.getUser(token);
    if (!caller) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Use admin client to check is_system_admin (avoids RLS blocking the read)
    const { data: profile } = await adminClient.from("user_profiles").select("is_system_admin").eq("id", caller.id).single();
    if (!profile?.is_system_admin) return new Response(JSON.stringify({ error: "Forbidden: not a system admin" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Get target email and new password from body
    const { targetEmail, newPassword } = await req.json();
    if (!targetEmail || !newPassword) return new Response(JSON.stringify({ error: "targetEmail and newPassword required" }), { status: 400, headers: corsHeaders });
    if (newPassword.length < 6) return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), { status: 400, headers: corsHeaders });

    // Find user by email using admin API (paginate to handle large user lists)
    const { data: userList, error: listErr } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) throw listErr;
    const targetUser = userList?.users?.find(u => u.email === targetEmail);
    if (!targetUser) return new Response(JSON.stringify({ error: `User not found: ${targetEmail}` }), { status: 404, headers: corsHeaders });

    const { error: updateErr } = await adminClient.auth.admin.updateUserById(targetUser.id, { password: newPassword });
    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
