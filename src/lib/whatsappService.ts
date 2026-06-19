import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { Task, CustomFieldDefinition, Invoice } from "@/types/crm";
import { getInvoiceDownloadURL } from "@/lib/pdfService";
import { loadWorkspaceState } from "@/lib/workspaceService";
import {
  WhatsAppSettings, DEFAULT_WHATSAPP_SETTINGS, TaskFieldKey, WhatsAppTemplate, WhatsAppLog, SecondMessageConfig, WhatsAppVariableMapping,
} from "@/types/whatsapp";

// ─── Template fetching ────────────────────────────────────────────────────────

/**
 * Fetches all APPROVED message templates for a WhatsApp Business Account.
 * Requires wabaId + accessToken.
 */
export async function fetchWhatsAppTemplates(
  wabaId: string,
  accessToken: string,
): Promise<WhatsAppTemplate[]> {
  const url =
    `https://graph.facebook.com/v19.0/${wabaId}/message_templates` +
    `?fields=name,language,status,category,components&limit=100` +
    `&access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Template fetch error ${res.status}: ${JSON.stringify(err)}`);
  }
  const json = await res.json();
  const all: WhatsAppTemplate[] = (json.data ?? []);
  // Return only approved templates, sorted by name
  return all
    .filter((t) => t.status === "APPROVED")
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Supabase persistence ────────────────────────────────────────────────────

async function sbAddLog(workspaceId: string, data: object): Promise<void> {
  const id = `wl_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;
  const { error } = await supabaseServiceRole.from('whatsapp_logs').insert({ id, workspace_id: workspaceId, data });
  if (error) console.error('[WhatsApp] Log save failed:', error.message, error);
}

export async function loadWhatsAppSettings(
  workspaceId: string,
): Promise<WhatsAppSettings> {
  const { data } = await supabase
    .from('workspace_settings')
    .select('data')
    .eq('workspace_id', workspaceId)
    .eq('category', 'whatsapp')
    .maybeSingle();
  return data ? (data.data as WhatsAppSettings) : { ...DEFAULT_WHATSAPP_SETTINGS };
}

export async function saveWhatsAppSettings(
  workspaceId: string,
  settings: WhatsAppSettings,
): Promise<void> {
  await supabaseServiceRole
    .from('workspace_settings')
    .upsert({ workspace_id: workspaceId, category: 'whatsapp', data: settings }, { onConflict: 'workspace_id,category' });
}

// ─── Field resolution ─────────────────────────────────────────────────────────

function resolveFieldValue(
  fieldKey: TaskFieldKey | `custom:${string}`,
  task: Task,
  listName: string,
  customFields: CustomFieldDefinition[],
): string {
  if (fieldKey.startsWith("custom:")) {
    const cfId = fieldKey.slice(7);
    const cfv = task.customFieldValues.find((v) => v.fieldId === cfId);
    return cfv ? String(cfv.value) : "";
  }
  switch (fieldKey as TaskFieldKey) {
    case "title":       return task.title;
    case "status":      return task.status.replace("_", " ");
    case "priority":    return task.priority;
    case "description": return task.description ?? "";
    case "listName":    return listName;
    case "createdAt":   return task.createdAt;
    case "dueDate":     return task.dueDate ?? "";
    case "assignee":    return task.assignee ?? "";
    default:            return "";
  }
}

// ─── Conversation upsert for outbound messages ───────────────────────────────

async function upsertOutboundConversation(
  workspaceId: string,
  recipientPhone: string,
  contactName: string,
  templateName: string,
  wamid: string | null,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const lastMsg = `[Template: ${templateName}]`;

    const { data: existing } = await supabaseServiceRole
      .from('whatsapp_conversations')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('contact_phone', recipientPhone)
      .maybeSingle();

    let convId: string;
    if (existing) {
      convId = existing.id;
      await supabaseServiceRole.from('whatsapp_conversations').update({
        last_message: lastMsg,
        last_message_at: now,
        last_replied_by_name: 'System',
      }).eq('id', convId);
    } else {
      const newId = `wc_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;
      const { data: created } = await supabaseServiceRole
        .from('whatsapp_conversations')
        .insert({
          id: newId,
          workspace_id: workspaceId,
          contact_phone: recipientPhone,
          contact_name: contactName,
          last_message: lastMsg,
          last_message_at: now,
          unread_count: 0,
          last_replied_by_name: 'System',
        })
        .select('id')
        .single();
      if (!created) return;
      convId = created.id;
    }

    const msgId = `wm_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;
    await supabaseServiceRole.from('whatsapp_messages').insert({
      id: msgId,
      workspace_id: workspaceId,
      conversation_id: convId,
      wamid: wamid ?? null,
      direction: 'outbound',
      message_type: 'template',
      content: lastMsg,
      status: 'sent',
      sent_by_name: 'System',
    });
  } catch (err) {
    console.error('[WhatsApp] Failed to upsert conversation for outbound:', err);
  }
}

// ─── Send via Meta Cloud API ──────────────────────────────────────────────────

export async function loadWhatsAppLogs(workspaceId: string, max = 50): Promise<WhatsAppLog[]> {
  const { data, error } = await supabase
    .from('whatsapp_logs')
    .select('id, data')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(max);
  if (error) throw error;
  return (data || []).map(r => ({ id: r.id, ...(r.data as object) }) as WhatsAppLog);
}

/** Format a raw phone number — strips non-digits, handles local 0-prefix SA numbers */
function formatPhone(raw: string): string {
  let phone = raw.replace(/\D/g, "");
  if (phone.startsWith("0") && phone.length <= 10) {
    phone = "27" + phone.substring(1);
  } else if (phone.length === 9 && !phone.startsWith("27")) {
    phone = "27" + phone;
  }
  return phone;
}

/** Send a single template message. Shared by primary + second message. */
async function sendOneTemplate(
  cfg: {
    templateName: string;
    languageCode: string;
    recipientField: string;
    variables: WhatsAppVariableMapping[];
    isFlowTemplate?: boolean;
    flowToken?: string;
  },
  phoneNumberId: string,
  accessToken: string,
  task: Task,
  listName: string,
  customFields: CustomFieldDefinition[],
  workspaceId: string,
  label: string,
  documentUrl?: string, // Optional PDF URL for templates with document headers
): Promise<void> {
  
  // Resolve recipient phone number with automatic fallback
  let recipientRaw = "";
  let phoneSource = "";
  
  if (cfg.recipientField.startsWith("fixed:")) {
    recipientRaw = cfg.recipientField.slice(6);
    phoneSource = "fixed number";
  } else {
    // Try the configured field first
    const cfv = task.customFieldValues.find(v => v.fieldId === cfg.recipientField);
    if (cfv && String(cfv.value).trim()) {
      recipientRaw = String(cfv.value);
      phoneSource = `configured field ${cfg.recipientField}`;
    } else {
      // Fallback: search for any phone field in the task
      console.log(`[${label}] Configured phone field ${cfg.recipientField} not found, searching for phone fields...`);
      console.log(`[${label}] Available fields in task:`, task.customFieldValues.map(v => ({ fieldId: v.fieldId, value: v.value, type: typeof v.value })));
      
      // Look for phone numbers with more flexible patterns
      for (const customFieldValue of task.customFieldValues) {
        const fieldValue = String(customFieldValue.value || '').trim();
        // More flexible phone detection: look for numbers, allow spaces/dashes/brackets
        const cleanValue = fieldValue.replace(/[\s\-\(\)]/g, ''); // Remove spaces, dashes, brackets
        if (fieldValue && /\d{9,15}/.test(cleanValue)) { // 9-15 digits after cleaning
          recipientRaw = fieldValue;
          phoneSource = `auto-detected from field ${customFieldValue.fieldId}`;
          console.log(`[${label}] Found phone number in field ${customFieldValue.fieldId}: "${fieldValue}" (cleaned: "${cleanValue}")`);
          break;
        }
      }
      
      // If still no phone found, log all field values for debugging
      if (!recipientRaw.trim()) {
        console.log(`[${label}] No phone number found. All field values:`, 
          task.customFieldValues.map(v => `${v.fieldId}: "${v.value}"`)
        );
      }
    }
  }
  
  if (!recipientRaw.trim()) {
    await sbAddLog(workspaceId, {
      timestamp: new Date().toISOString(), to: "", toOriginal: "",
      templateName: cfg.templateName, status: "skipped",
      error: `[${label}] No phone value found — checked recipientField="${cfg.recipientField}" and auto-detected fields`,
      taskId: task.id, taskTitle: task.title, parameters: [],
    }).catch(() => {});
    return;
  }

  const recipientPhone = formatPhone(recipientRaw);
  if (recipientPhone.length < 7) {
    await sbAddLog(workspaceId, {
      timestamp: new Date().toISOString(), to: recipientPhone, toOriginal: recipientRaw,
      templateName: cfg.templateName, status: "skipped",
      error: `[${label}] Phone "${recipientRaw}" → "${recipientPhone}" looks invalid`,
      taskId: task.id, taskTitle: task.title, parameters: [],
    }).catch(() => {});
    return;
  }

  console.log(`[WhatsApp][${label}] sending to ${recipientPhone} (from ${phoneSource})`);

  const sortedVars = [...cfg.variables].sort((a, b) => a.variableIndex - b.variableIndex);
  const parameters = sortedVars.map(v => ({
    type: "text",
    text: resolveFieldValue(v.fieldKey, task, listName, customFields) || "(empty)",
  }));

  const components: object[] = [];
  
  // Add document header if URL provided (for templates with document attachments)
  if (documentUrl) {
    console.log(`[WhatsApp][${label}] Adding document attachment: ${documentUrl}`);
    // Validate document URL
    try {
      new URL(documentUrl); // This will throw if URL is invalid
      components.push({
        type: "header",
        parameters: [{ type: "document", document: { link: documentUrl } }]
      });
    } catch (urlError) {
      console.error(`[WhatsApp][${label}] Invalid document URL: ${documentUrl}`, urlError);
      // Skip document attachment if URL is invalid
      console.log(`[WhatsApp][${label}] Sending without document attachment due to invalid URL`);
    }
  }
  
  if (parameters.length > 0) components.push({ type: "body", parameters });
  if (cfg.isFlowTemplate) {
    components.push({
      type: "button", sub_type: "flow", index: "0",
      parameters: [{ type: "action", action: { flow_token: cfg.flowToken || "unused" } }],
    });
  }

  const reqBody = {
    messaging_product: "whatsapp",
    to: recipientPhone,
    type: "template",
    template: {
      name: cfg.templateName,
      language: { code: cfg.languageCode },
      ...(components.length > 0 && { components }),
    },
  };

  console.log(`[WhatsApp][${label}] body:`, JSON.stringify(reqBody));

  // Retry logic for network failures with fallback options
  let res: Response;
  let lastError: any;
  const maxRetries = documentUrl ? 3 : 2; // Extra retry for document templates
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let currentReqBody = reqBody;
      
      // On final attempt for document templates, try without attachment
      if (documentUrl && attempt === maxRetries) {
        console.log(`[WhatsApp][${label}] Final attempt - trying without document attachment`);
        const fallbackComponents = components.filter(c => c.type !== "header");
        currentReqBody = {
          ...reqBody,
          template: {
            ...reqBody.template,
            ...(fallbackComponents.length > 0 && { components: fallbackComponents }),
          }
        };
      }
      
      console.log(`[WhatsApp][${label}] Attempt ${attempt}/${maxRetries} - sending to WhatsApp API...`);
      res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(currentReqBody),
      });
      
      // If successful, break out of retry loop
      break;
    } catch (networkErr) {
      lastError = networkErr;
      const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
      console.error(`[WhatsApp][${label}] Network error attempt ${attempt}/${maxRetries}:`, msg);
      
      // If this is the last attempt, log and throw
      if (attempt === maxRetries) {
        const errorMsg = `[${label}] Network error after ${maxRetries} attempts: ${msg}`;
        await sbAddLog(workspaceId, {
          timestamp: new Date().toISOString(), to: recipientPhone, toOriginal: recipientRaw,
          templateName: cfg.templateName, status: "failed", error: errorMsg,
          taskId: task.id, taskTitle: task.title, parameters,
        }).catch(() => {});
        throw new Error(errorMsg);
      }
      
      // Wait before retrying (exponential backoff: 1s, 2s, 4s)
      const delay = Math.pow(2, attempt - 1) * 1000;
      console.log(`[WhatsApp][${label}] Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  console.log(`[WhatsApp][${label}] response:`, res.status, JSON.stringify(json));

  if (!res.ok) {
    const errMsg = `[${label}] API error ${res.status}: ${JSON.stringify(json)}`;
    console.error(`[WhatsApp][${label}] API error details:`, {
      status: res.status,
      template: cfg.templateName,
      recipient: recipientPhone,
      hasDocumentAttachment: !!documentUrl,
      documentUrl: documentUrl,
      response: json
    });
    
    // Add specific error context for common issues
    let contextualError = errMsg;
    if (res.status === 400) {
      contextualError += ` | Check template parameters and document attachment format`;
    } else if (res.status === 401) {
      contextualError += ` | Invalid access token`;
    } else if (res.status === 403) {
      contextualError += ` | Template not approved or permissions issue`;
    } else if (res.status >= 500) {
      contextualError += ` | WhatsApp server error - try again later`;
    } else if (res.status === 429) {
      contextualError += ` | Rate limited - too many messages`;
    }
    
    await sbAddLog(workspaceId, {
      timestamp: new Date().toISOString(), to: recipientPhone, toOriginal: recipientRaw,
      templateName: cfg.templateName, status: "failed", error: contextualError,
      taskId: task.id, taskTitle: task.title, parameters,
    }).catch(() => {});
    throw new Error(contextualError);
  }

  const msgId = ((json.messages as Array<{id?: string}> | undefined)?.[0]?.id) ?? null;
  await sbAddLog(workspaceId, {
    timestamp: new Date().toISOString(), to: recipientPhone, toOriginal: recipientRaw,
    templateName: cfg.templateName, status: "sent", messageId: msgId,
    taskId: task.id, taskTitle: task.title, parameters,
  }).catch(() => {});
  console.log(`[WhatsApp][${label}] ✅ sent OK, messageId:`, msgId);

  // Create/update conversation in the Messenger inbox so staff can follow up
  if (label !== "cc") {
    await upsertOutboundConversation(workspaceId, recipientPhone, task.title, cfg.templateName, msgId);
  }
}

export async function sendTaskWhatsApp(
  settings: WhatsAppSettings,
  task: Task,
  listName: string,
  customFields: CustomFieldDefinition[],
  workspaceId: string,
): Promise<void> {
  if (!settings.enabled) return;
  if (!settings.phoneNumberId || !settings.accessToken || !settings.templateName) {
    console.warn("[WhatsApp] skipped: not fully configured");
      await sbAddLog(workspaceId, {
      timestamp: new Date().toISOString(), to: "", toOriginal: "",
      templateName: settings.templateName ?? "", status: "skipped",
      error: "Not fully configured (missing phoneNumberId / accessToken / templateName)",
      taskId: task.id, taskTitle: task.title, parameters: [],
    }).catch(() => {});
    return;
  }

  // Fire all messages simultaneously
  const sends: Promise<void>[] = [
    sendOneTemplate(settings, settings.phoneNumberId, settings.accessToken, task, listName, customFields, workspaceId, "msg1", undefined),
  ];

  const sec = settings.secondMessage;
  if (sec?.enabled && sec.templateName) {
    sends.push(
      sendOneTemplate(sec, settings.phoneNumberId, settings.accessToken, task, listName, customFields, workspaceId, "msg2", undefined),
    );
  }

  // CC copy to business number
  const ccNum = (settings.ccNumber ?? "").replace(/\D/g, "");
  if (ccNum.length >= 7) {
    sends.push(
      sendOneTemplate(
        { ...settings, recipientField: `fixed:${ccNum}` },
        settings.phoneNumberId,
        settings.accessToken,
        task, listName, customFields, workspaceId, "cc", undefined,
      ),
    );
  }

  await Promise.allSettled(sends);
}

/**
 * Find available phone fields in a task for debugging
 */
export function findPhoneFieldsInTask(task: Task): Array<{fieldId: string, value: string, cleaned: string}> {
  const phoneFields: Array<{fieldId: string, value: string, cleaned: string}> = [];
  
  for (const customFieldValue of task.customFieldValues) {
    const fieldValue = String(customFieldValue.value || '').trim();
    const cleanValue = fieldValue.replace(/[\s\-\(\)]/g, ''); // Remove spaces, dashes, brackets
    // Check if this looks like a phone number (9-15 digits after cleaning)
    if (fieldValue && /\d{9,15}/.test(cleanValue)) {
      phoneFields.push({
        fieldId: customFieldValue.fieldId,
        value: fieldValue,
        cleaned: cleanValue
      });
    }
  }
  
  return phoneFields;
}

/**
 * Debug task fields - log all fields in a task for troubleshooting
 */
export function debugTaskFields(task: Task, label = "DEBUG"): void {
  console.log(`[${label}] Task ${task.id} fields:`, 
    task.customFieldValues.map(v => ({
      fieldId: v.fieldId,
      value: v.value,
      type: typeof v.value,
      stringValue: String(v.value),
      hasDigits: /\d/.test(String(v.value)),
      digitCount: (String(v.value).match(/\d/g) || []).length
    }))
  );
}

/**
 * Resend a failed WhatsApp message from log entry
 */
export async function resendWhatsAppMessage(
  settings: WhatsAppSettings,
  log: WhatsAppLog,
  workspaceId: string,
): Promise<void> {
  if (!settings.enabled) {
    throw new Error("WhatsApp is not enabled");
  }
  
  if (!settings.phoneNumberId || !settings.accessToken) {
    throw new Error("WhatsApp not fully configured");
  }

  // Create a mock task from the log data for resending
  const mockTask = {
    id: log.taskId,
    title: log.taskTitle,
    customFieldValues: [
      // Add the phone number as a field if we have it
      ...(log.to ? [{ fieldId: 'phone_from_log', value: log.to }] : []),
      // Add parameters as fields
      ...log.parameters.map((p, i) => ({
        fieldId: `param_${i}`,
        value: p.text
      }))
    ]
  } as any;

  console.log('[WhatsApp Resend] Created mock task with fields:', mockTask.customFieldValues);

  // If no phone in log, try to find the original task for debugging
  if (!log.to || log.to === "—") {
    console.error('[WhatsApp Resend] No phone number in log entry, trying to find original task...');
    
    try {
      // Load workspace to find the actual task
      const workspace = await loadWorkspaceState(workspaceId);
      const originalTask = workspace.tasks.find(t => t.id === log.taskId);
      
      if (originalTask) {
        console.log('[WhatsApp Resend] Found original task:', originalTask.title);
        debugTaskFields(originalTask, 'RESEND_DEBUG');
        const availablePhones = findPhoneFieldsInTask(originalTask);
        console.log('[WhatsApp Resend] Available phone fields in original task:', availablePhones);
        
        if (availablePhones.length > 0) {
          console.log('[WhatsApp Resend] Using first available phone:', availablePhones[0].value);
          // Update the mock task with the found phone number
          mockTask.customFieldValues.unshift({
            fieldId: availablePhones[0].fieldId,
            value: availablePhones[0].value
          });
          // Update message config to use this field
          messageConfig.recipientField = availablePhones[0].fieldId;
        } else {
          throw new Error(`Cannot resend: Task "${originalTask.title}" has no phone number in any field. Available fields: ${originalTask.customFieldValues.map(v => `${v.fieldId}="${v.value}"`).join(', ')}`);
        }
      } else {
        throw new Error(`Cannot resend: Original task ${log.taskId} not found in workspace`);
      }
    } catch (error) {
      console.error('[WhatsApp Resend] Failed to find original task:', error);
      throw new Error(`Cannot resend: No phone number available. ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Determine which configuration to use based on the template
  const isSecondMessage = settings.secondMessage?.enabled && settings.secondMessage.templateName === log.templateName;
  const messageConfig = isSecondMessage ? settings.secondMessage : {
    templateName: log.templateName,
    languageCode: settings.languageCode,
    recipientField: `fixed:${log.to}`, // Use the original recipient from log
    variables: log.parameters.map((_, i) => ({ 
      variableIndex: i + 1, 
      fieldKey: 'title' as any 
    })),
    isFlowTemplate: settings.isFlowTemplate,
    flowToken: settings.flowToken
  };

  // Send the message with the same configuration
  await sendOneTemplate(
    messageConfig,
    settings.phoneNumberId,
    settings.accessToken,
    mockTask,
    'Resent', // List name
    [], // Custom fields
    workspaceId,
    "resend",
    undefined // No document URL for now
  );
}

/**
 * Send WhatsApp invoice notification
 */
export async function sendInvoiceWhatsApp(
  settings: WhatsAppSettings,
  invoice: Invoice,
  task: Task,
  workspaceId: string,
): Promise<void> {
  if (!settings.enabled) return;
  if (!settings.phoneNumberId || !settings.accessToken) {
    console.warn("[WhatsApp Invoice] skipped: not fully configured");
    return;
  }

  // Use a specific invoice template or fallback to second message template  
  const templateName = settings.templates?.depositInvoice || settings.secondMessage?.templateName;
  if (!templateName) {
    console.warn("[WhatsApp Invoice] skipped: no invoice template configured");
    return;
  }

  try {
    // Find customer phone using multiple fallback strategies:
    // 1. From invoice.customerPhone
    // 2. From configured recipientField in WhatsApp settings
    // 3. Auto-detect from task custom fields containing phone/contact/mobile
    let customerPhone = invoice.customerPhone || '';
    
    // If no phone in invoice, try the configured recipientField
    if (!customerPhone && settings.recipientField) {
      if (settings.recipientField.startsWith("fixed:")) {
        customerPhone = settings.recipientField.slice(6);
      } else {
        const cfv = task.customFieldValues.find(v => v.fieldId === settings.recipientField);
        if (cfv && String(cfv.value).trim()) {
          customerPhone = String(cfv.value);
          console.log(`[WhatsApp Invoice] Found phone from configured field "${settings.recipientField}": ${customerPhone}`);
        }
      }
    }
    
    // If still no phone, try auto-detect from task custom fields
    if (!customerPhone) {
      const phoneField = task.customFieldValues.find(v => 
        v.fieldId && ['phone', 'contact', 'mobile'].some(f => 
          v.fieldId.toLowerCase().includes(f)
        )
      );
      if (phoneField?.value) {
        customerPhone = String(phoneField.value);
        console.log(`[WhatsApp Invoice] Auto-detected phone from field "${phoneField.fieldId}": ${customerPhone}`);
      }
    }

    if (!customerPhone) {
      console.warn("[WhatsApp Invoice] No customer phone found - checked invoice.customerPhone, recipientField, and auto-detect");
      console.log("[WhatsApp Invoice] Available task fields:", task.customFieldValues.map(v => ({ fieldId: v.fieldId, value: v.value })));
      return;
    }

    console.log(`[WhatsApp Invoice] Sending invoice ${invoice.invoiceNumber} to ${customerPhone}`);
    
    // Generate invoice PDF URL for document attachment
    const invoiceDocumentUrl = getInvoiceDownloadURL(invoice);
    
    // Use second message configuration if available, otherwise use main settings
    const messageConfig = settings.secondMessage?.enabled ? settings.secondMessage : {
      templateName,
      languageCode: settings.languageCode,
      recipientField: settings.recipientField,
      variables: settings.variables,
      isFlowTemplate: settings.isFlowTemplate,
      flowToken: settings.flowToken
    };

    // Send using the second message template configuration with document attachment
    await sendOneTemplate(
      messageConfig, 
      settings.phoneNumberId, 
      settings.accessToken, 
      task, 
      'Invoice', 
      [], 
      workspaceId, 
      "invoice",
      invoiceDocumentUrl // Pass document URL for templates with document headers
    );
    
  } catch (error) {
    console.error('[WhatsApp Invoice] Send failed:', error);
  }
}
/**
 * Send WhatsApp quotation notification directly from UI
 * Used when manually sending quotations from quote management page
 */
export async function sendQuotationWhatsApp(
  workspaceId: string,
  quotation: any, // Quotation type from invoice.ts
  customerPhone: string,
): Promise<void> {
  if (!customerPhone) {
    throw new Error("Customer phone number is required");
  }

  const settings = await loadWhatsAppSettings(workspaceId);
  if (!settings.enabled || !settings.phoneNumberId || !settings.accessToken) {
    throw new Error("WhatsApp is not configured. Please configure WhatsApp settings first.");
  }

  // Use quotation template if available, otherwise use default template
  const templateName = settings.templates?.depositInvoice || settings.templateName;
  if (!templateName) {
    throw new Error("No WhatsApp template configured for quotations");
  }

  try {
    // Format phone number
    const recipientPhone = formatPhone(customerPhone);
    if (recipientPhone.length < 7) {
      throw new Error(`Invalid phone number: ${customerPhone}`);
    }

    console.log(`[WhatsApp Quotation] Sending quotation ${quotation.quotationNumber} to ${recipientPhone}`);

    // Build template parameters from quotation data
    const parameters = [
      { type: "text", text: quotation.customerName || "Customer" },
      { type: "text", text: quotation.quotationNumber || "N/A" },
      { type: "text", text: `R${quotation.total?.toFixed(2) || "0.00"}` },
    ];

    const components: object[] = [
      { type: "body", parameters }
    ];

    if (settings.isFlowTemplate) {
      components.push({
        type: "button", sub_type: "flow", index: "0",
        parameters: [{ type: "action", action: { flow_token: settings.flowToken || "unused" } }],
      });
    }

    const reqBody = {
      messaging_product: "whatsapp",
      to: recipientPhone,
      type: "template",
      template: {
        name: templateName,
        language: { code: settings.languageCode },
        components,
      },
    };

    console.log(`[WhatsApp Quotation] Request:`, JSON.stringify(reqBody));

    const res = await fetch(`https://graph.facebook.com/v19.0/${settings.phoneNumberId}/messages`, {
      method: "POST",
      headers: { 
        Authorization: `Bearer ${settings.accessToken}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify(reqBody),
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error?.message || `WhatsApp API error: ${res.status}`);
    }

    // Log success
      await sbAddLog(workspaceId, {
      timestamp: new Date().toISOString(),
      to: recipientPhone,
      toOriginal: customerPhone,
      templateName,
      status: "sent",
      quotationNumber: quotation.quotationNumber,
      quotationId: quotation.id,
      parameters,
    });

    console.log('[WhatsApp Quotation] Sent successfully:', result);
  } catch (error) {
    console.error('[WhatsApp Quotation] Send failed:', error);
    throw error;
  }
}

/**
 * Send invoice via WhatsApp directly from UI
 * Used when manually sending invoices from invoice management page
 */
export async function sendInvoiceWhatsAppDirect(
  workspaceId: string,
  invoice: Invoice,
  customerPhone: string,
): Promise<void> {
  if (!customerPhone) {
    throw new Error("Customer phone number is required");
  }

  const settings = await loadWhatsAppSettings(workspaceId);
  if (!settings.enabled || !settings.phoneNumberId || !settings.accessToken) {
    throw new Error("WhatsApp is not configured. Please configure WhatsApp settings first.");
  }

  // Use invoice template if available, otherwise use default template
  const templateName = settings.templates?.depositInvoice || settings.templateName;
  if (!templateName) {
    throw new Error("No WhatsApp template configured for invoices");
  }

  try {
    // Format phone number
    const recipientPhone = formatPhone(customerPhone);
    if (recipientPhone.length < 7) {
      throw new Error(`Invalid phone number: ${customerPhone}`);
    }

    console.log(`[WhatsApp Invoice Direct] Sending invoice ${invoice.invoiceNumber} to ${recipientPhone}`);

    // Build template parameters from invoice data
    const parameters = [
      { type: "text", text: invoice.customerName || "Customer" },
      { type: "text", text: invoice.invoiceNumber || "N/A" },
      { type: "text", text: `R${invoice.total?.toFixed(2) || "0.00"}` },
    ];

    const components: object[] = [];
    
    // Add document if available
    const invoiceDocumentUrl = getInvoiceDownloadURL(invoice);
    if (invoiceDocumentUrl) {
      try {
        new URL(invoiceDocumentUrl);
        components.push({
          type: "header",
          parameters: [{ type: "document", document: { link: invoiceDocumentUrl } }]
        });
      } catch {
        console.log('[WhatsApp Invoice Direct] Invalid document URL, skipping attachment');
      }
    }

    components.push({ type: "body", parameters });

    if (settings.isFlowTemplate) {
      components.push({
        type: "button", sub_type: "flow", index: "0",
        parameters: [{ type: "action", action: { flow_token: settings.flowToken || "unused" } }],
      });
    }

    const reqBody = {
      messaging_product: "whatsapp",
      to: recipientPhone,
      type: "template",
      template: {
        name: templateName,
        language: { code: settings.languageCode },
        ...(components.length > 0 && { components }),
      },
    };

    console.log(`[WhatsApp Invoice Direct] Request:`, JSON.stringify(reqBody));

    const res = await fetch(`https://graph.facebook.com/v19.0/${settings.phoneNumberId}/messages`, {
      method: "POST",
      headers: { 
        Authorization: `Bearer ${settings.accessToken}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify(reqBody),
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error?.message || `WhatsApp API error: ${res.status}`);
    }

    // Log success
      await sbAddLog(workspaceId, {
      timestamp: new Date().toISOString(),
      to: recipientPhone,
      toOriginal: customerPhone,
      templateName,
      status: "sent",
      invoiceNumber: invoice.invoiceNumber,
      invoiceId: invoice.id,
      parameters,
    });

    console.log('[WhatsApp Invoice Direct] Sent successfully:', result);
  } catch (error) {
    console.error('[WhatsApp Invoice Direct] Send failed:', error);
    throw error;
  }
}