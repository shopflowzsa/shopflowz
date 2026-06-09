// Supabase Edge Function to get invitation details without RLS
// This allows invited users to view their invitation before creating an account

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Use service role to bypass RLS
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { invitationId } = await req.json();

    if (!invitationId) {
      return new Response(
        JSON.stringify({ error: "Invitation ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the invitation
    const { data: invitation, error } = await supabase
      .from("invitations")
      .select("*")
      .eq("id", invitationId)
      .eq("status", "pending")
      .single();

    if (error || !invitation) {
      return new Response(
        JSON.stringify({ error: "Invitation not found or already used" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch workspace name
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("name")
      .eq("id", invitation.workspace_id)
      .single();

    return new Response(
      JSON.stringify({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        workspace_id: invitation.workspace_id,
        workspace_name: workspace?.name || "Workspace",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});