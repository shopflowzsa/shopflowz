// Executes a previously-recorded AI action proposal after explicit user
// approval in the chat UI. The proxy never writes data; only this function
// does, and only for a proposal the same user created.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return jsonResponse({ error: "Server misconfigured" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;
    const userName = userData.user.user_metadata?.display_name || userData.user.email || "User";

    const body = await req.json() as { proposal_id?: string };
    const proposalId = body?.proposal_id;
    if (!proposalId) return jsonResponse({ error: "proposal_id is required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: proposal, error: pErr } = await admin
      .from("ai_action_proposals")
      .select("*")
      .eq("id", proposalId)
      .maybeSingle();
    if (pErr || !proposal) return jsonResponse({ error: "Proposal not found" }, 404);
    if (proposal.user_id !== userId) return jsonResponse({ error: "Not your proposal" }, 403);
    if (proposal.status !== "pending") {
      return jsonResponse({ error: `Proposal already ${proposal.status}`, current_status: proposal.status }, 409);
    }

    // Confirm workspace membership
    const { data: membership } = await admin
      .from("workspace_members")
      .select("uid")
      .eq("workspace_id", proposal.workspace_id)
      .eq("uid", userId)
      .maybeSingle();
    if (!membership) return jsonResponse({ error: "Not a member of this workspace" }, 403);

    let executionResult: unknown;
    try {
      switch (proposal.action_type) {
        case "create_task":
          executionResult = await executeCreateTask(admin, proposal.workspace_id, userId, proposal.params);
          break;
        case "update_task_status":
          executionResult = await executeUpdateTaskStatus(admin, proposal.workspace_id, userId, proposal.params);
          break;
        case "mark_invoice_paid":
          executionResult = await executeMarkInvoicePaid(admin, proposal.workspace_id, userId, userName, proposal.params);
          break;
        case "create_customer":
          executionResult = await executeCreateCustomer(admin, proposal.workspace_id, userId, proposal.params);
          break;
        case "update_customer":
          executionResult = await executeUpdateCustomer(admin, proposal.workspace_id, userId, proposal.params);
          break;
        default:
          throw new Error(`Unknown action_type: ${proposal.action_type}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin.from("ai_action_proposals").update({
        status: "failed",
        result: { error: message },
        resolved_at: new Date().toISOString(),
      }).eq("id", proposalId);
      return jsonResponse({ error: message }, 500);
    }

    await admin.from("ai_action_proposals").update({
      status: "executed",
      result: executionResult as object,
      resolved_at: new Date().toISOString(),
    }).eq("id", proposalId);

    return jsonResponse({ ok: true, result: executionResult });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

// ─── Action executors ──────────────────────────────────────────────────────

async function executeCreateTask(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
  params: any,
) {
  const title = String(params?.title || "").trim();
  const listId = String(params?.listId || "").trim();
  if (!title || !listId) throw new Error("title and listId are required");
  const priority = params?.priority || "normal";
  const dueDate = params?.dueDate || null;
  const description = params?.description || null;

  const { data: row } = await admin
    .from("workspace_state")
    .select("data")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!row?.data) throw new Error("Workspace state not found");
  const state = row.data as any;

  const list = (state.lists || []).find((l: any) => l.id === listId);
  if (!list) throw new Error(`List not found: ${listId}`);

  const newTask = {
    id: `t${Date.now()}`,
    title,
    status: "to do",
    priority,
    listId,
    customFieldValues: [],
    createdAt: new Date().toISOString().slice(0, 10),
    ...(dueDate && { dueDate }),
    ...(description && { description }),
  };

  const newState = { ...state, tasks: [...(state.tasks || []), newTask] };
  const { error } = await admin.from("workspace_state").update({ data: newState }).eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  await admin.from("user_activities").insert({
    workspace_id: workspaceId,
    user_id: userId,
    activity_type: "task_created",
    activity_date: new Date().toISOString(),
    entity_type: "task",
    entity_id: newTask.id,
    entity_title: newTask.title,
    metadata: { source: "ai_agent" },
  });

  return { task_id: newTask.id, title: newTask.title, listName: list.name };
}

async function executeUpdateTaskStatus(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
  params: any,
) {
  const taskId = String(params?.taskId || "").trim();
  const status = String(params?.status || "").trim();
  if (!taskId || !status) throw new Error("taskId and status are required");

  const { data: row } = await admin
    .from("workspace_state")
    .select("data")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!row?.data) throw new Error("Workspace state not found");
  const state = row.data as any;
  const tasks = state.tasks || [];
  const taskIndex = tasks.findIndex((t: any) => t.id === taskId);
  if (taskIndex < 0) throw new Error(`Task not found: ${taskId}`);
  const oldStatus = tasks[taskIndex].status;
  tasks[taskIndex] = { ...tasks[taskIndex], status };
  const newState = { ...state, tasks };
  const { error } = await admin.from("workspace_state").update({ data: newState }).eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  await admin.from("user_activities").insert({
    workspace_id: workspaceId,
    user_id: userId,
    activity_type: status.toLowerCase() === "done" ? "task_completed" : "task_status_changed",
    activity_date: new Date().toISOString(),
    entity_type: "task",
    entity_id: taskId,
    entity_title: tasks[taskIndex].title,
    metadata: { source: "ai_agent", oldStatus, newStatus: status },
  });

  return { task_id: taskId, oldStatus, newStatus: status };
}

async function executeMarkInvoicePaid(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
  _userName: string,
  params: any,
) {
  const invoiceId = String(params?.invoiceId || "").trim();
  const amount = Number(params?.amount);
  const method = String(params?.paymentMethod || "cash");
  const reference = params?.reference || null;
  if (!invoiceId || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("invoiceId and a positive amount are required");
  }

  const { data: invRow } = await admin
    .from("invoices")
    .select("id, data")
    .eq("id", invoiceId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!invRow) throw new Error(`Invoice not found: ${invoiceId}`);
  const invoice = invRow.data as any;

  const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const payment = {
    id: paymentId,
    invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    amount,
    paymentMethod: method,
    reference,
    paymentDate: new Date().toISOString().slice(0, 10),
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };
  await admin.from("payments").insert({ id: paymentId, workspace_id: workspaceId, data: payment });

  const amountPaid = Number(invoice.amountPaid || 0) + amount;
  const balanceDue = Number(invoice.total || 0) - amountPaid;
  const paymentStatus = balanceDue <= 0.0001 ? "paid" : amountPaid > 0 ? "partial" : "unpaid";
  const status = paymentStatus === "paid" ? "paid" : invoice.status;
  const merged = {
    ...invoice,
    amountPaid,
    balanceDue,
    paymentStatus,
    status,
    updatedAt: new Date().toISOString(),
    ...(paymentStatus === "paid" && { paidDate: new Date().toISOString() }),
  };
  await admin.from("invoices").update({ data: merged }).eq("id", invoiceId);

  await admin.from("user_activities").insert({
    workspace_id: workspaceId,
    user_id: userId,
    activity_type: "payment_recorded",
    activity_date: new Date().toISOString(),
    entity_type: "payment",
    entity_id: paymentId,
    entity_title: invoice.invoiceNumber,
    metadata: { source: "ai_agent", invoiceId, amount, method },
  });
  if (paymentStatus === "paid") {
    await admin.from("user_activities").insert({
      workspace_id: workspaceId,
      user_id: userId,
      activity_type: "invoice_paid",
      activity_date: new Date().toISOString(),
      entity_type: "invoice",
      entity_id: invoiceId,
      entity_title: invoice.invoiceNumber,
      metadata: { source: "ai_agent", total: invoice.total },
    });
  }

  return { invoice_id: invoiceId, payment_id: paymentId, amountPaid, balanceDue, paymentStatus };
}

async function executeCreateCustomer(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
  params: any,
) {
  const companyName = params?.companyName || null;
  const contactPerson = String(params?.contactPerson || "").trim();
  const email = params?.email || "";
  const phone = params?.phone || "";
  if (!contactPerson && !companyName) throw new Error("contactPerson or companyName required");

  // counterService doesn't exist server-side; generate a simple number
  const customerId = `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const customerNumber = `CUST-${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();

  const customer = {
    id: customerId,
    customerNumber,
    companyName,
    contactPerson,
    email,
    phone,
    currency: "ZAR",
    status: "active",
    tags: [],
    paymentTerms: "net-30",
    vatEnabled: true,
    totalInvoiced: 0,
    totalPaid: 0,
    outstandingBalance: 0,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  const { error } = await admin
    .from("customers")
    .insert({ id: customerId, workspace_id: workspaceId, data: customer });
  if (error) throw new Error(error.message);

  await admin.from("user_activities").insert({
    workspace_id: workspaceId,
    user_id: userId,
    activity_type: "customer_created",
    activity_date: new Date().toISOString(),
    entity_type: "customer",
    entity_id: customerId,
    entity_title: companyName || contactPerson,
    metadata: { source: "ai_agent" },
  });

  return { customer_id: customerId, customerNumber, name: companyName || contactPerson };
}

async function executeUpdateCustomer(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
  params: any,
) {
  const customerId = String(params?.customerId || "").trim();
  const updates = (params?.updates && typeof params.updates === "object") ? params.updates : null;
  if (!customerId || !updates) throw new Error("customerId and updates are required");

  const { data: row } = await admin
    .from("customers")
    .select("data")
    .eq("id", customerId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!row?.data) throw new Error(`Customer not found: ${customerId}`);

  const merged = { ...(row.data as any), ...updates, updatedAt: new Date().toISOString() };
  const { error } = await admin.from("customers").update({ data: merged }).eq("id", customerId);
  if (error) throw new Error(error.message);

  await admin.from("user_activities").insert({
    workspace_id: workspaceId,
    user_id: userId,
    activity_type: "customer_updated",
    activity_date: new Date().toISOString(),
    entity_type: "customer",
    entity_id: customerId,
    entity_title: merged.companyName || merged.contactPerson,
    metadata: { source: "ai_agent", fields: Object.keys(updates) },
  });

  return { customer_id: customerId, updated_fields: Object.keys(updates) };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
