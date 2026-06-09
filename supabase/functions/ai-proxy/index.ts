// AI Proxy Edge Function
//
// Browser cannot call NVIDIA's API directly (CORS-blocked). This function:
//   1. Authenticates the caller and verifies workspace membership.
//   2. Loads bot settings (API key stays server-side).
//   3. Runs a tool-calling loop: if the LLM asks for a tool, we execute it
//      against Supabase and feed the result back.
//
// The brain (LLM) is pluggable — change the workspace's model setting. The
// tools layer below is shared across models.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface ProxyRequest {
  workspace_id: string;
  messages: ChatMessage[];
}

const MAX_TOOL_ITERATIONS = 5;

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "now",
      description:
        "Internal: resolve the current date so you can interpret 'today'/'yesterday'/'this week'. Do not announce that you are using this tool. Do not describe what it returns. Use the result internally and proceed silently to the next step (usually another tool call to answer the user's actual question).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_directory",
      description:
        "Returns the workspace's members (display_name, email, uid, role). Call this when the user references someone by name and you need to map the name to a uid for filtering, or when summarising 'who did what'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_activity_log",
      description:
        "Returns the recent activity log for this workspace. Each entry has a user (with display_name), an activity_type (e.g. task_created, invoice_paid), an entity_type/title (what was acted on), and a timestamp. Filter by date range and optionally by user. Use this for 'what happened today', 'what did Sarah do this week', etc.",
      parameters: {
        type: "object",
        properties: {
          date_from: { type: "string", description: "ISO 8601 datetime or date. Defaults to start of today." },
          date_to: { type: "string", description: "ISO 8601 datetime or date. Defaults to now." },
          user_id: { type: "string", description: "Optional: filter to a single user's uid." },
          activity_types: { type: "array", items: { type: "string" }, description: "Optional: filter activity_type list." },
          limit: { type: "number", description: "Max rows (default 50, hard cap 200)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tasks",
      description:
        "Returns tasks (jobs) currently in the workspace. Each task has id, title, status, priority, listId, dueDate, createdAt, jobNumber. Use this for 'what tasks are open?', 'what's due today?', 'show me jobs in progress'. Tasks are the same as 'jobs' / 'bookings' in this app.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Optional filter: 'to do', 'in progress', 'review', 'done'." },
          due_date: { type: "string", description: "Optional: 'today', 'overdue', or an ISO date (YYYY-MM-DD)." },
          list_id: { type: "string", description: "Optional: filter to a specific list." },
          limit: { type: "number", description: "Max rows (default 50, hard cap 200)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_customers",
      description:
        "Returns customers in this workspace. Each has id, customerNumber, companyName, contactPerson, email, phone, totalInvoiced, totalPaid, outstandingBalance, status, createdAt. Use this for 'who are our top customers?', 'who has outstanding balances?', 'how many customers?'.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Optional: substring match on company name or contact name." },
          has_outstanding: { type: "boolean", description: "If true, only customers with outstandingBalance > 0." },
          limit: { type: "number", description: "Max rows (default 50, hard cap 200)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_inventory",
      description:
        "Returns inventory items. Each has id, name, sku, category, price, costPrice, quantity, reorderLevel, supplier. Use this for 'what's low on stock?', 'how many items do we have?', 'show me inventory under R100'.",
      parameters: {
        type: "object",
        properties: {
          low_stock: { type: "boolean", description: "If true, only items where quantity <= reorderLevel and quantity > 0." },
          out_of_stock: { type: "boolean", description: "If true, only items with quantity = 0." },
          category: { type: "string", description: "Optional: filter by category exact match." },
          search: { type: "string", description: "Optional: substring match on name or sku." },
          limit: { type: "number", description: "Max rows (default 50, hard cap 200)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_invoices",
      description:
        "Returns invoices. Each has id, invoiceNumber, customerName, total, amountPaid, balanceDue, status, paymentStatus, invoiceDate, dueDate. Use this for 'what's overdue?', 'how much outstanding?', 'show me unpaid invoices'.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Optional: draft, sent, viewed, partial, paid, overdue, cancelled." },
          payment_status: { type: "string", description: "Optional: unpaid, partial, paid." },
          overdue_only: { type: "boolean", description: "If true, only invoices with dueDate < today and balanceDue > 0." },
          customer_id: { type: "string", description: "Optional: filter to a specific customer." },
          limit: { type: "number", description: "Max rows (default 50, hard cap 200)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_quotations",
      description:
        "Returns quotations (quotes). Each has id, quotationNumber, customerName, total, status, validUntil, createdAt. Use for 'how many open quotes', 'show me accepted quotations'.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Optional: draft, sent, accepted, declined, expired." },
          customer_id: { type: "string", description: "Optional: filter to a specific customer." },
          expiring_soon: { type: "boolean", description: "If true, only quotes with validUntil within next 7 days." },
          limit: { type: "number", description: "Max rows (default 50, hard cap 200)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_payments",
      description:
        "Returns payments received. Each has id, invoiceNumber, customerName, amount, paymentMethod, reference, paymentDate. Use for 'payments today/this week', 'how was the cash flow yesterday'.",
      parameters: {
        type: "object",
        properties: {
          date_from: { type: "string", description: "ISO date. Defaults to start of today." },
          date_to: { type: "string", description: "ISO date. Defaults to now." },
          method: { type: "string", description: "Optional: cash, card, bank-transfer, cheque, other." },
          customer_id: { type: "string", description: "Optional: filter to one customer." },
          limit: { type: "number", description: "Max rows (default 50, hard cap 200)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_stock_movements",
      description:
        "Returns stock movements (in/out history). Each has productName, sku, quantity, movementType (in/out/adjustment), reason, createdAt. Use for 'what stock changed today', 'why did SKU X drop?'.",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "Optional: filter to one inventory item." },
          date_from: { type: "string", description: "ISO date. Defaults to start of today." },
          date_to: { type: "string", description: "ISO date. Defaults to now." },
          limit: { type: "number", description: "Max rows (default 50, hard cap 200)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_form_submissions",
      description:
        "Returns pending form submissions waiting to be processed into tasks. Each has id, formId, formName, submittedAt, status, taskTitle. Use for 'any unprocessed form submissions?' or 'how many bookings came in via the form today?'.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Optional: pending, processed, failed." },
          limit: { type: "number", description: "Max rows (default 50, hard cap 100)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_suppliers",
      description:
        "Returns distinct supplier names derived from inventory rows, with item counts. This app does not have a dedicated suppliers table.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_tasks",
      description:
        "Free-text search across task titles, descriptions, and job numbers. Use when the user names a task or refers to one by partial title/job number.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Substring to match. Required." },
          limit: { type: "number", description: "Max rows (default 20, hard cap 100)." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_action",
      description:
        "Propose an action that modifies app data. Does NOT execute. Returns a proposal_id and a summary. The frontend will render an approval card to the user. Only call this when the user has clearly asked you to do something (create a task, mark an invoice paid, add a customer, etc.). Never auto-execute, never invent actions the user didn't request.",
      parameters: {
        type: "object",
        properties: {
          action_type: {
            type: "string",
            enum: [
              "create_task",
              "update_task_status",
              "mark_invoice_paid",
              "create_customer",
              "update_customer",
            ],
            description: "The action to propose.",
          },
          params: {
            type: "object",
            description:
              "Parameters for the action. For create_task: { title, listId, priority?, dueDate?, description? }. For update_task_status: { taskId, status }. For mark_invoice_paid: { invoiceId, amount, paymentMethod, reference? }. For create_customer: { companyName?, contactPerson, email?, phone? }. For update_customer: { customerId, updates: {...} }.",
          },
          summary: {
            type: "string",
            description:
              "One-line human-readable summary of what will happen if approved. The user will see this exactly. Example: 'Create task \"Fix amp Mark-300\" in New Drop Offs list with priority high.'",
          },
        },
        required: ["action_type", "params", "summary"],
      },
    },
  },
];

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
    const { workspace_id, messages } = body;
    if (!workspace_id || !Array.isArray(messages) || messages.length === 0) {
      return jsonResponse({ error: "workspace_id and non-empty messages are required" }, 400);
    }

    // Service-role client used for all tool execution and settings read
    const admin = createClient(supabaseUrl, serviceKey);

    // Verify workspace membership
    const { data: membership } = await admin
      .from("workspace_members")
      .select("uid")
      .eq("workspace_id", workspace_id)
      .eq("uid", userId)
      .maybeSingle();
    if (!membership) return jsonResponse({ error: "Not a member of this workspace" }, 403);

    // Load bot settings
    const { data: settings } = await admin
      .from("sr_bot_settings")
      .select("base_url, api_key, model, system_prompt, is_enabled")
      .eq("workspace_id", workspace_id)
      .maybeSingle();
    if (!settings) return jsonResponse({ error: "Bot settings not found for this workspace" }, 404);
    if (!settings.is_enabled) return jsonResponse({ error: "AI assistant is disabled" }, 403);
    if (!settings.api_key) return jsonResponse({ error: "API key not configured" }, 400);

    // Ensure a system prompt is present; if the client didn't send one, use the
    // workspace's stored system_prompt (augmented with tool guidance).
    const hasSystem = messages.some((m) => m.role === "system");
    const systemPrompt = augmentSystemPrompt(settings.system_prompt || "You are a helpful assistant.");
    const conversation: ChatMessage[] = hasSystem
      ? messages
      : [{ role: "system", content: systemPrompt }, ...messages];

    // Tool-calling loop
    let iterations = 0;
    let lastToolName: string | null = null;
    let nowNudgeUsed = false;
    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      const upstreamResp = await callUpstream(settings.base_url, settings.api_key, {
        model: settings.model,
        messages: conversation,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        temperature: 0.4,
        top_p: 0.95,
        max_tokens: 4096,
        stream: false,
      });

      if (!upstreamResp.ok) {
        const text = await upstreamResp.text();
        return jsonResponse(
          { error: `Upstream ${upstreamResp.status}: ${text.slice(0, 500)}` },
          502,
        );
      }

      const upstream = await upstreamResp.json();
      const choice = upstream?.choices?.[0];
      const messageOut = choice?.message;
      if (!messageOut) {
        return jsonResponse({ error: "Upstream returned no message" }, 502);
      }

      const toolCalls = messageOut.tool_calls as ChatMessage["tool_calls"];
      // No tool calls → final answer (with one safety net)
      if (!toolCalls || toolCalls.length === 0) {
        const content = (messageOut.content as string) || "";

        // Safety net: model called `now` then tried to stop. Force another
        // iteration with an explicit nudge so it produces a real answer.
        if (!nowNudgeUsed && lastToolName === "now") {
          nowNudgeUsed = true;
          conversation.push({
            role: "assistant",
            content: content || null,
          });
          conversation.push({
            role: "system",
            content:
              "You stopped after calling now. now is never the final step. Either call the right query tool for the user's question, or directly answer using the timestamp you already have. Do not describe what now returned. Do not narrate.",
          });
          lastToolName = null;
          continue;
        }

        if (!content) return jsonResponse({ error: "Empty response from upstream" }, 502);

        // Return any pending proposals created during this turn so the UI can
        // render approval cards next to the assistant message.
        const { data: pending } = await admin
          .from("ai_action_proposals")
          .select("id, action_type, summary, params, created_at")
          .eq("workspace_id", workspace_id)
          .eq("user_id", userId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(5);

        return jsonResponse({
          content,
          tokensUsed: upstream?.usage?.total_tokens ?? 0,
          iterations,
          proposals: pending || [],
        });
      }

      // Append the assistant message (with tool_calls) to the conversation
      conversation.push({
        role: "assistant",
        content: messageOut.content ?? null,
        tool_calls: toolCalls,
      });

      // Execute each tool call
      for (const call of toolCalls) {
        const name = call.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await executeTool(name, args, { admin, workspace_id, user_id: userId });
        lastToolName = name;
        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: JSON.stringify(result),
        });
      }
      // loop again — feed results back to the model
    }

    return jsonResponse({ error: `Tool loop did not terminate within ${MAX_TOOL_ITERATIONS} iterations` }, 502);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});

async function callUpstream(baseUrl: string, apiKey: string, body: unknown): Promise<Response> {
  return await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

function augmentSystemPrompt(base: string): string {
  return `${base}

# How to use tools (CRITICAL)
Tools return data for you to *use*, not to describe.
- NEVER announce or describe a tool call. Don't say "Let me check…", "I've called the now tool", "I have provided the current date", "let me look that up", "I'll use get_tasks".
- After calling a tool, the next thing you produce must be EITHER (a) another tool call, OR (b) the actual answer for the user — built from the data, in plain English. Nothing in between.
- If you called \`now\` to resolve "today/yesterday", IMMEDIATELY chain to the real query tool (\`get_activity_log\`, \`get_invoices\`, etc.). The \`now\` tool is NEVER your final step.
- The user does not know or care what tools exist. They want answers, not status updates about tools.

# Tools
- \`now\` — internal date resolver. Always followed by another tool. Never the final step.
- \`get_user_directory\` — workspace members. Map a name to a uid before filtering.
- \`get_activity_log\` — audit log. Filter by date/user/type.
- \`get_tasks\` — current tasks/jobs/bookings.
- \`search_tasks\` — free-text search of task titles, descriptions, job numbers.
- \`get_customers\` — customer list, outstanding balances.
- \`get_inventory\` — inventory items (low-stock / out-of-stock filters).
- \`get_invoices\` — invoices (overdue_only / status filters).
- \`get_quotations\` — quotations (status, expiring_soon).
- \`get_payments\` — payments received in a date range.
- \`get_stock_movements\` — stock in/out history.
- \`get_form_submissions\` — pending form submissions.
- \`get_suppliers\` — distinct supplier names from inventory.

# Write actions
- \`propose_action\` — for any *change*. The user must approve on screen.
- Allowed action_types: create_task, update_task_status, mark_invoice_paid, create_customer, update_customer.
- Never assume approval. After proposing, briefly tell the user to approve the card.

# Answer style
- No preamble. No "Sure!", "Of course", "Let me know if you need anything else!".
- Plain answer first. Short bullets or one short paragraph. Real names, real counts.
- If a tool returns nothing: "No records found." — don't pad.
- Never invent data. Never restate tool descriptions.

# Examples
User: "what time is it"
After \`now\` → "It's 14:32 on Thursday, 14 May 2026."
Wrong: "I have provided the current date and time in ISO 8601 format..."

User: "what happened today"
After \`now\` → \`get_activity_log\` → "Today: Sarah created 3 tasks, Mark recorded 1 payment (R1,200 cash)."
Wrong: "Let me check the activity log for you..."
`;
}

interface ToolContext {
  admin: ReturnType<typeof createClient>;
  workspace_id: string;
  user_id: string;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  try {
    switch (name) {
      case "now":
        return toolNow();
      case "get_user_directory":
        return await toolGetUserDirectory(ctx);
      case "get_activity_log":
        return await toolGetActivityLog(args, ctx);
      case "get_tasks":
        return await toolGetTasks(args, ctx);
      case "get_customers":
        return await toolGetCustomers(args, ctx);
      case "get_inventory":
        return await toolGetInventory(args, ctx);
      case "get_invoices":
        return await toolGetInvoices(args, ctx);
      case "get_quotations":
        return await toolGetQuotations(args, ctx);
      case "get_payments":
        return await toolGetPayments(args, ctx);
      case "get_stock_movements":
        return await toolGetStockMovements(args, ctx);
      case "get_form_submissions":
        return await toolGetFormSubmissions(args, ctx);
      case "get_suppliers":
        return await toolGetSuppliers(ctx);
      case "search_tasks":
        return await toolSearchTasks(args, ctx);
      case "propose_action":
        return await toolProposeAction(args, ctx);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function toolNow() {
  const d = new Date();
  return {
    iso: d.toISOString(),
    date: d.toISOString().slice(0, 10),
    weekday: d.toLocaleDateString("en-ZA", { weekday: "long" }),
    timezone: "UTC (server). The workspace is in South Africa (UTC+2). Treat 'today' as the current SAST day.",
    epoch_ms: d.getTime(),
  };
}

async function toolGetUserDirectory(ctx: ToolContext) {
  const { data, error } = await ctx.admin
    .from("workspace_members")
    .select("uid, email, display_name, role")
    .eq("workspace_id", ctx.workspace_id);
  if (error) return { error: error.message };
  return { members: data || [] };
}

async function toolGetActivityLog(args: Record<string, unknown>, ctx: ToolContext) {
  const date_from = typeof args.date_from === "string" ? args.date_from : startOfToday();
  const date_to = typeof args.date_to === "string" ? args.date_to : new Date().toISOString();
  const userIdFilter = typeof args.user_id === "string" ? args.user_id : null;
  const typesFilter = Array.isArray(args.activity_types) ? args.activity_types as string[] : null;
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 50, 200);

  let q = ctx.admin
    .from("user_activities")
    .select("user_id, activity_type, description, entity_type, entity_title, activity_date, metadata")
    .eq("workspace_id", ctx.workspace_id)
    .gte("activity_date", normaliseDate(date_from))
    .lte("activity_date", normaliseDate(date_to, true))
    .order("activity_date", { ascending: false })
    .limit(limit);

  if (userIdFilter) q = q.eq("user_id", userIdFilter);
  if (typesFilter && typesFilter.length > 0) q = q.in("activity_type", typesFilter);

  const { data, error } = await q;
  if (error) return { error: error.message };

  // Join with member display_names for readability
  const { data: members } = await ctx.admin
    .from("workspace_members")
    .select("uid, display_name, email")
    .eq("workspace_id", ctx.workspace_id);
  const memberMap = new Map((members || []).map((m: any) => [m.uid, m.display_name || m.email || m.uid]));

  const rows = (data || []).map((r: any) => ({
    user: memberMap.get(r.user_id) || r.user_id,
    activity_type: r.activity_type,
    description: r.description,
    entity_type: r.entity_type,
    entity_title: r.entity_title,
    at: r.activity_date,
  }));

  return { count: rows.length, activities: rows };
}

async function toolGetTasks(args: Record<string, unknown>, ctx: ToolContext) {
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 50, 200);
  const statusFilter = typeof args.status === "string" ? args.status.toLowerCase() : null;
  const listFilter = typeof args.list_id === "string" ? args.list_id : null;
  const dueFilter = typeof args.due_date === "string" ? args.due_date.toLowerCase() : null;

  const { data: row, error } = await ctx.admin
    .from("workspace_state")
    .select("data")
    .eq("workspace_id", ctx.workspace_id)
    .maybeSingle();
  if (error) return { error: error.message };
  const tasks = ((row?.data as any)?.tasks || []) as any[];
  const lists = ((row?.data as any)?.lists || []) as any[];
  const listMap = new Map(lists.map((l) => [l.id, l.name]));

  const todayIso = new Date().toISOString().slice(0, 10);
  let filtered = tasks;
  if (statusFilter) {
    filtered = filtered.filter((t) => (t.status || "").toLowerCase() === statusFilter);
  }
  if (listFilter) {
    filtered = filtered.filter((t) => t.listId === listFilter);
  }
  if (dueFilter === "today") {
    filtered = filtered.filter((t) => t.dueDate && t.dueDate.slice(0, 10) === todayIso);
  } else if (dueFilter === "overdue") {
    filtered = filtered.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < todayIso && (t.status || "").toLowerCase() !== "done");
  } else if (dueFilter && /^\d{4}-\d{2}-\d{2}/.test(dueFilter)) {
    const dayKey = dueFilter.slice(0, 10);
    filtered = filtered.filter((t) => t.dueDate && t.dueDate.slice(0, 10) === dayKey);
  }

  const out = filtered.slice(0, limit).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    listId: t.listId,
    listName: listMap.get(t.listId) || null,
    dueDate: t.dueDate || null,
    jobNumber: t.jobNumber || null,
    createdAt: t.createdAt || null,
  }));

  return { total: tasks.length, returned: out.length, tasks: out };
}

async function toolGetCustomers(args: Record<string, unknown>, ctx: ToolContext) {
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 50, 200);
  const search = typeof args.search === "string" ? args.search.toLowerCase() : null;
  const hasOutstanding = args.has_outstanding === true;

  const { data, error } = await ctx.admin
    .from("customers")
    .select("id, data")
    .eq("workspace_id", ctx.workspace_id)
    .limit(500);
  if (error) return { error: error.message };

  let rows = (data || []).map((r: any) => ({ id: r.id, ...r.data }));
  if (search) {
    rows = rows.filter((c: any) =>
      (c.companyName || "").toLowerCase().includes(search) ||
      (c.contactPerson || "").toLowerCase().includes(search),
    );
  }
  if (hasOutstanding) {
    rows = rows.filter((c: any) => Number(c.outstandingBalance || 0) > 0);
  }
  rows = rows
    .sort((a: any, b: any) => Number(b.outstandingBalance || 0) - Number(a.outstandingBalance || 0))
    .slice(0, limit)
    .map((c: any) => ({
      id: c.id,
      customerNumber: c.customerNumber,
      companyName: c.companyName,
      contactPerson: c.contactPerson,
      email: c.email,
      phone: c.phone,
      totalInvoiced: Number(c.totalInvoiced || 0),
      totalPaid: Number(c.totalPaid || 0),
      outstandingBalance: Number(c.outstandingBalance || 0),
      status: c.status,
    }));

  return { count: rows.length, customers: rows };
}

async function toolGetInventory(args: Record<string, unknown>, ctx: ToolContext) {
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 50, 200);
  const lowStock = args.low_stock === true;
  const outOfStock = args.out_of_stock === true;
  const category = typeof args.category === "string" ? args.category : null;
  const search = typeof args.search === "string" ? args.search.toLowerCase() : null;

  const { data, error } = await ctx.admin
    .from("inventory")
    .select("id, data")
    .eq("workspace_id", ctx.workspace_id)
    .limit(1000);
  if (error) return { error: error.message };

  let rows = (data || []).map((r: any) => ({ id: r.id, ...r.data }));
  if (category) rows = rows.filter((i: any) => i.category === category);
  if (search) {
    rows = rows.filter((i: any) =>
      (i.name || "").toLowerCase().includes(search) ||
      (i.sku || "").toLowerCase().includes(search),
    );
  }
  if (outOfStock) {
    rows = rows.filter((i: any) => Number(i.quantity || 0) === 0);
  } else if (lowStock) {
    rows = rows.filter((i: any) => {
      const q = Number(i.quantity || 0);
      const r = Number(i.reorderLevel || 0);
      return q > 0 && q <= r;
    });
  }
  rows = rows.slice(0, limit).map((i: any) => ({
    id: i.id,
    name: i.name,
    sku: i.sku,
    category: i.category,
    price: Number(i.price || 0),
    costPrice: Number(i.costPrice || 0),
    quantity: Number(i.quantity || 0),
    reorderLevel: Number(i.reorderLevel || 0),
    supplier: i.supplier || null,
  }));

  return { count: rows.length, items: rows };
}

async function toolGetInvoices(args: Record<string, unknown>, ctx: ToolContext) {
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 50, 200);
  const status = typeof args.status === "string" ? args.status : null;
  const paymentStatus = typeof args.payment_status === "string" ? args.payment_status : null;
  const overdueOnly = args.overdue_only === true;
  const customerId = typeof args.customer_id === "string" ? args.customer_id : null;

  const { data, error } = await ctx.admin
    .from("invoices")
    .select("id, data")
    .eq("workspace_id", ctx.workspace_id)
    .limit(500);
  if (error) return { error: error.message };

  const todayIso = new Date().toISOString().slice(0, 10);
  let rows = (data || []).map((r: any) => ({ id: r.id, ...r.data }));
  if (status) rows = rows.filter((i: any) => i.status === status);
  if (paymentStatus) rows = rows.filter((i: any) => i.paymentStatus === paymentStatus);
  if (customerId) rows = rows.filter((i: any) => i.customerId === customerId);
  if (overdueOnly) {
    rows = rows.filter((i: any) => i.dueDate && i.dueDate.slice(0, 10) < todayIso && Number(i.balanceDue || 0) > 0);
  }
  rows = rows
    .sort((a: any, b: any) => (b.invoiceDate || "").localeCompare(a.invoiceDate || ""))
    .slice(0, limit)
    .map((i: any) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      customerName: i.customerName,
      total: Number(i.total || 0),
      amountPaid: Number(i.amountPaid || 0),
      balanceDue: Number(i.balanceDue || 0),
      status: i.status,
      paymentStatus: i.paymentStatus,
      invoiceDate: i.invoiceDate,
      dueDate: i.dueDate,
    }));

  return { count: rows.length, invoices: rows };
}

async function toolGetQuotations(args: Record<string, unknown>, ctx: ToolContext) {
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 50, 200);
  const status = typeof args.status === "string" ? args.status : null;
  const customerId = typeof args.customer_id === "string" ? args.customer_id : null;
  const expiringSoon = args.expiring_soon === true;

  const { data, error } = await ctx.admin
    .from("quotes")
    .select("id, data")
    .eq("workspace_id", ctx.workspace_id)
    .limit(500);
  if (error) return { error: error.message };

  let rows = (data || []).map((r: any) => ({ id: r.id, ...r.data }));
  if (status) rows = rows.filter((q: any) => q.status === status);
  if (customerId) rows = rows.filter((q: any) => q.customerId === customerId);
  if (expiringSoon) {
    const now = Date.now();
    const sevenDays = now + 7 * 24 * 3600 * 1000;
    rows = rows.filter((q: any) => {
      if (!q.validUntil) return false;
      const t = new Date(q.validUntil).getTime();
      return t >= now && t <= sevenDays;
    });
  }
  rows = rows
    .sort((a: any, b: any) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, limit)
    .map((q: any) => ({
      id: q.id,
      quotationNumber: q.quotationNumber,
      customerName: q.customerName,
      total: Number(q.total || 0),
      status: q.status,
      validUntil: q.validUntil,
      createdAt: q.createdAt,
    }));
  return { count: rows.length, quotations: rows };
}

async function toolGetPayments(args: Record<string, unknown>, ctx: ToolContext) {
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 50, 200);
  const dateFrom = typeof args.date_from === "string" ? args.date_from : startOfToday().slice(0, 10);
  const dateTo = typeof args.date_to === "string" ? args.date_to : new Date().toISOString().slice(0, 10);
  const method = typeof args.method === "string" ? args.method : null;
  const customerId = typeof args.customer_id === "string" ? args.customer_id : null;

  const { data, error } = await ctx.admin
    .from("payments")
    .select("id, data")
    .eq("workspace_id", ctx.workspace_id)
    .limit(1000);
  if (error) return { error: error.message };

  let rows = (data || []).map((r: any) => ({ id: r.id, ...r.data }));
  rows = rows.filter((p: any) => p.paymentDate && p.paymentDate >= dateFrom.slice(0, 10) && p.paymentDate <= dateTo.slice(0, 10));
  if (method) rows = rows.filter((p: any) => p.paymentMethod === method);
  if (customerId) rows = rows.filter((p: any) => p.customerId === customerId);
  rows = rows
    .sort((a: any, b: any) => (b.paymentDate || "").localeCompare(a.paymentDate || ""))
    .slice(0, limit)
    .map((p: any) => ({
      id: p.id,
      invoiceNumber: p.invoiceNumber,
      customerName: p.customerName,
      amount: Number(p.amount || 0),
      paymentMethod: p.paymentMethod,
      reference: p.reference || null,
      paymentDate: p.paymentDate,
    }));
  const total = rows.reduce((s: number, p: any) => s + p.amount, 0);
  return { count: rows.length, total_received: total, payments: rows };
}

async function toolGetStockMovements(args: Record<string, unknown>, ctx: ToolContext) {
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 50, 200);
  const productId = typeof args.product_id === "string" ? args.product_id : null;
  const dateFrom = typeof args.date_from === "string" ? args.date_from : startOfToday();
  const dateTo = typeof args.date_to === "string" ? args.date_to : new Date().toISOString();

  let q = ctx.admin
    .from("stock_movements")
    .select("id, data, created_at")
    .eq("workspace_id", ctx.workspace_id)
    .gte("created_at", normaliseDate(dateFrom))
    .lte("created_at", normaliseDate(dateTo, true))
    .order("created_at", { ascending: false })
    .limit(limit);

  const { data, error } = await q;
  if (error) return { error: error.message };

  let rows = (data || []).map((r: any) => ({ id: r.id, createdAt: r.created_at, ...r.data }));
  if (productId) rows = rows.filter((m: any) => m.productId === productId);
  rows = rows.map((m: any) => ({
    id: m.id,
    productId: m.productId,
    productName: m.productName,
    sku: m.sku,
    quantity: Number(m.quantity || 0),
    movementType: m.movementType,
    reason: m.reason || null,
    createdAt: m.createdAt,
  }));
  return { count: rows.length, movements: rows };
}

async function toolGetFormSubmissions(args: Record<string, unknown>, ctx: ToolContext) {
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 50, 100);
  const status = typeof args.status === "string" ? args.status : null;

  let q = ctx.admin
    .from("form_submissions")
    .select("id, form_id, status, submitted_at, data")
    .eq("workspace_id", ctx.workspace_id)
    .order("submitted_at", { ascending: false })
    .limit(limit);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return { error: error.message };

  // Get form names from workspace_state
  const { data: stateRow } = await ctx.admin
    .from("workspace_state")
    .select("data")
    .eq("workspace_id", ctx.workspace_id)
    .maybeSingle();
  const forms = ((stateRow?.data as any)?.forms || []) as any[];
  const formMap = new Map(forms.map((f) => [f.id, f.name]));

  const rows = (data || []).map((r: any) => ({
    id: r.id,
    formId: r.form_id,
    formName: formMap.get(r.form_id) || null,
    status: r.status,
    submittedAt: r.submitted_at,
    taskTitle: (r.data as any)?.task?.title || null,
  }));
  return { count: rows.length, submissions: rows };
}

async function toolGetSuppliers(ctx: ToolContext) {
  const { data, error } = await ctx.admin
    .from("inventory")
    .select("data")
    .eq("workspace_id", ctx.workspace_id)
    .limit(2000);
  if (error) return { error: error.message };

  const counts = new Map<string, number>();
  for (const r of data || []) {
    const s = ((r.data as any)?.supplier || "").trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const suppliers = Array.from(counts.entries())
    .map(([name, item_count]) => ({ name, item_count }))
    .sort((a, b) => b.item_count - a.item_count);
  return { count: suppliers.length, suppliers };
}

async function toolSearchTasks(args: Record<string, unknown>, ctx: ToolContext) {
  const query = typeof args.query === "string" ? args.query.toLowerCase().trim() : "";
  if (!query) return { error: "query is required" };
  const limit = Math.min(typeof args.limit === "number" ? args.limit : 20, 100);

  const { data: row, error } = await ctx.admin
    .from("workspace_state")
    .select("data")
    .eq("workspace_id", ctx.workspace_id)
    .maybeSingle();
  if (error) return { error: error.message };
  const tasks = ((row?.data as any)?.tasks || []) as any[];
  const lists = ((row?.data as any)?.lists || []) as any[];
  const listMap = new Map(lists.map((l) => [l.id, l.name]));

  const matches = tasks.filter((t) => {
    return (
      (t.title || "").toLowerCase().includes(query) ||
      (t.description || "").toLowerCase().includes(query) ||
      String(t.jobNumber || "").toLowerCase().includes(query)
    );
  }).slice(0, limit).map((t) => ({
    id: t.id,
    title: t.title,
    description: (t.description || "").slice(0, 200),
    status: t.status,
    priority: t.priority,
    listName: listMap.get(t.listId) || null,
    jobNumber: t.jobNumber || null,
    dueDate: t.dueDate || null,
  }));

  return { count: matches.length, tasks: matches };
}

async function toolProposeAction(args: Record<string, unknown>, ctx: ToolContext) {
  const actionType = typeof args.action_type === "string" ? args.action_type : "";
  const params = (args.params && typeof args.params === "object") ? args.params : {};
  const summary = typeof args.summary === "string" ? args.summary : "";

  const ALLOWED = new Set([
    "create_task",
    "update_task_status",
    "mark_invoice_paid",
    "create_customer",
    "update_customer",
  ]);
  if (!ALLOWED.has(actionType)) return { error: `Unknown action_type: ${actionType}` };
  if (!summary) return { error: "summary is required" };

  // Persist the proposal so execute-proposal can validate it later
  const proposalId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await ctx.admin.from("ai_action_proposals").insert({
    id: proposalId,
    workspace_id: ctx.workspace_id,
    user_id: ctx.user_id,
    action_type: actionType,
    params,
    summary,
    status: "pending",
  });
  if (error) return { error: `Failed to record proposal: ${error.message}` };

  // The frontend listens for "proposal" markers in tool results and renders a
  // confirmation card. We mark it explicitly so the bot doesn't have to.
  return {
    proposal: {
      proposal_id: proposalId,
      action_type: actionType,
      summary,
    },
    instructions_for_assistant:
      "Tell the user briefly that you've prepared this action and they should approve it on the card that appeared. Do NOT pretend it's been done.",
  };
}

function normaliseDate(input: string, endOfDay = false): string {
  // Accepts "YYYY-MM-DD" or ISO datetime
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return endOfDay ? `${input}T23:59:59.999Z` : `${input}T00:00:00.000Z`;
  }
  return input;
}

function startOfToday(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).toISOString();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
