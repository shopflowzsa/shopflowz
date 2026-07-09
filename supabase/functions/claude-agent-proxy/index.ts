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

const SAVE_MEMORY_TOOL = {
  name: "save_memory",
  description:
    "Save a durable fact for future conversations — a product's price, a pricing formula, a policy someone told you, etc. Call this whenever you learn something worth remembering long-term, not just for this one reply. Reusing the same topic overwrites the previous value with the new one.",
  input_schema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "Short label for this fact, e.g. 'Targa Street 12 pricing' or 'voice coil repair formula'.",
      },
      content: {
        type: "string",
        description: "The fact to remember, written so it makes sense on its own later without today's conversation for context.",
      },
    },
    required: ["topic", "content"],
  },
};

const MAX_TOOL_ITERATIONS = 4;

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
    .select("api_key, model, system_prompt, is_enabled, visibility_mode, web_search_enabled")
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

  // Re-inject everything this agent has previously saved to memory so it
  // actually persists across chats, instead of only "remembering" whatever
  // happens to still be in the current conversation's visible history.
  const { data: memoryRows } = await admin
    .from("custom_agent_memory")
    .select("topic, content")
    .eq("agent_id", agent_id)
    .order("updated_at", { ascending: false })
    .limit(50);
  const memoryBlock =
    memoryRows && memoryRows.length > 0
      ? "\n\nThings you've previously learned and saved for this workspace:\n" +
        memoryRows.map((m) => `- ${m.topic}: ${m.content}`).join("\n")
      : "";
  const systemPrompt = (agent.system_prompt || "You are a helpful assistant.") + memoryBlock;

  // Basic (non-dynamic-filtering) web search — works across every Claude
  // model, since the agent's model is a free-text field the owner controls.
  const tools: Record<string, unknown>[] = [SAVE_MEMORY_TOOL];
  if (agent.web_search_enabled) {
    tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 5 });
  }

  const conversation: unknown[] = [...messages];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": agent.api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: agent.model,
        system: systemPrompt,
        max_tokens: 1024,
        messages: conversation,
        tools,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return jsonResponse({ error: `Upstream ${resp.status}: ${text.slice(0, 500)}` }, 502);
    }

    const data = await resp.json();
    const content = (data?.content ?? []) as Array<Record<string, any>>;
    const toolUses = content.filter((block) => block.type === "tool_use");

    if (data.stop_reason !== "tool_use" || toolUses.length === 0) {
      // With web search enabled, content interleaves text blocks with
      // server_tool_use / web_search_tool_result blocks — concatenate every
      // text block in order rather than assuming content[0] is the answer.
      const answer = content
        .filter((block) => block.type === "text")
        .map((block) => block.text as string)
        .join("\n")
        .trim();
      if (!answer) return jsonResponse({ error: "Empty response from upstream" }, 502);
      return jsonResponse({ answer });
    }

    conversation.push({ role: "assistant", content });

    const toolResults = [];
    for (const toolUse of toolUses) {
      if (toolUse.name === "save_memory") {
        const { topic, content: memoryContent } = toolUse.input ?? {};
        if (typeof topic === "string" && typeof memoryContent === "string" && topic.trim()) {
          await admin.from("custom_agent_memory").upsert(
            {
              agent_id,
              workspace_id: workspaceId,
              topic: topic.trim(),
              content: memoryContent,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "agent_id,topic" },
          );
          toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: "Saved." });
        } else {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: "Missing topic or content.",
            is_error: true,
          });
        }
      } else {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `Unknown tool: ${toolUse.name}`,
          is_error: true,
        });
      }
    }
    conversation.push({ role: "user", content: toolResults });
  }

  return jsonResponse({ error: `Tool loop did not terminate within ${MAX_TOOL_ITERATIONS} iterations` }, 502);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
