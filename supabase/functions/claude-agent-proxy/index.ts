// Claude Agent Proxy Edge Function
//
// Backs the "Custom AI Agents" feature: workspace owners create one or more
// bots, each configured with their own Anthropic (Claude) API key. Browser
// cannot call Anthropic directly (CORS-blocked, and the key must never reach
// the client). This function:
//   1. Authenticates the caller and verifies workspace membership.
//   2. For action "list": returns the safe, non-secret columns of every
//      enabled agent the caller is allowed to see (respects visibility_mode
//      / custom_ai_agent_access), for rendering bubbles.
//   3. For action "chat" (default): loads one agent's settings server-side
//      (api_key never returned to the browser) and calls Anthropic's
//      Messages API on the caller's behalf.
//
// Fully separate from ai-proxy/sr_bot_settings (the standard NVIDIA-backed
// assistant) — does not read or write those tables.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ProxyRequest {
  action?: "chat" | "list";
  workspace_id: string;
  agent_id?: string;
  messages?: ChatMessage[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }

    // Authenticate caller
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json() as ProxyRequest;
    const { workspace_id } = body;
    if (!workspace_id) return jsonResponse({ error: "workspace_id is required" }, 400);

    // Service-role client used for all privileged reads/writes
    const admin = createClient(supabaseUrl, serviceKey);

    // Verify workspace membership
    const { data: membership } = await admin
      .from("workspace_members")
      .select("uid")
      .eq("workspace_id", workspace_id)
      .eq("uid", userId)
      .maybeSingle();
    if (!membership) return jsonResponse({ error: "Not a member of this workspace" }, 403);

    if (body.action === "list") {
      return await handleList(admin, workspace_id, userId);
    }
    return await handleChat(admin, workspace_id, userId, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});

async function handleList(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
): Promise<Response> {
  const { data: agents, error } = await admin
    .from("custom_ai_agents")
    .select("id, agent_name, avatar_emoji, position_index, visibility_mode")
    .eq("workspace_id", workspaceId)
    .eq("is_enabled", true);
  if (error) return jsonResponse({ error: error.message }, 500);
  if (!agents || agents.length === 0) return jsonResponse({ agents: [] });

  const selectedIds = agents.filter((a) => a.visibility_mode === "selected").map((a) => a.id);
  let allowedIds = new Set<string>();
  if (selectedIds.length > 0) {
    const { data: access } = await admin
      .from("custom_ai_agent_access")
      .select("agent_id")
      .in("agent_id", selectedIds)
      .eq("uid", userId);
    allowedIds = new Set((access ?? []).map((r) => r.agent_id as string));
  }

  const visible = agents
    .filter((a) => a.visibility_mode === "all" || allowedIds.has(a.id as string))
    .map((a) => ({
      id: a.id,
      agent_name: a.agent_name,
      avatar_emoji: a.avatar_emoji,
      position_index: a.position_index,
    }));

  return jsonResponse({ agents: visible });
}

async function handleChat(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
  body: ProxyRequest,
): Promise<Response> {
  const { agent_id, messages } = body;
  if (!agent_id || !Array.isArray(messages) || messages.length === 0) {
    return jsonResponse({ error: "agent_id and non-empty messages are required" }, 400);
  }

  const { data: agent } = await admin
    .from("custom_ai_agents")
    .select("api_key, model, system_prompt, is_enabled, visibility_mode")
    .eq("id", agent_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!agent) return jsonResponse({ error: "Agent not found" }, 404);
  if (!agent.is_enabled) return jsonResponse({ error: "Agent is disabled" }, 403);
  if (!agent.api_key) return jsonResponse({ error: "API key not configured" }, 400);

  if (agent.visibility_mode === "selected") {
    const { data: access } = await admin
      .from("custom_ai_agent_access")
      .select("uid")
      .eq("agent_id", agent_id)
      .eq("uid", userId)
      .maybeSingle();
    if (!access) return jsonResponse({ error: "Not permitted to use this agent" }, 403);
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": agent.api_key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: agent.model,
      system: agent.system_prompt || "You are a helpful assistant.",
      max_tokens: 1024,
      messages,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return jsonResponse({ error: `Upstream ${resp.status}: ${text.slice(0, 500)}` }, 502);
  }

  const data = await resp.json();
  const answer = data?.content?.[0]?.text ?? "";
  if (!answer) return jsonResponse({ error: "Empty response from upstream" }, 502);

  return jsonResponse({ answer });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
