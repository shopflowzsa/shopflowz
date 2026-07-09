import { SUPABASE_URL } from "@/lib/supabase";
import { supabase, supabaseServiceRole, SUPABASE_ANON_KEY } from "./supabase";

const IMAP_URL = `${SUPABASE_URL}/functions/v1/imap-fetch`;
const SMTP_URL = `${SUPABASE_URL}/functions/v1/send-email`;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EmailAccount {
  id: string;
  workspaceId: string;
  userId: string;
  displayName: string;
  emailAddress: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  imapPassword: string;
  sentFolder: string;
  smtpPort: number;
  useForSending: boolean;
  signature: string;
  notificationSound: string; // "ding"|"chime"|"pop"|"none"|custom URL
  lastSyncedAt?: string | null;
}

export interface ResolvedSmtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
}

export async function getEffectiveSmtp(workspaceId: string, userId: string): Promise<ResolvedSmtp | null> {
  const account = await getEmailAccount(workspaceId, userId);
  if (!account || !account.useForSending) return null;
  return {
    host: account.imapHost,
    port: account.smtpPort,
    secure: account.smtpPort === 465,
    user: account.imapUsername,
    pass: account.imapPassword,
    fromEmail: account.emailAddress,
    fromName: account.displayName || account.emailAddress,
  };
}

export interface EmailAttachment {
  filename: string;
  content: string;   // base64
  contentType: string;
}

export interface EmailMessage {
  id?: string;
  uid: number;
  folder: string;
  subject: string;
  fromName?: string;
  fromEmail?: string;
  toRecipients: { name: string; email: string }[];
  sentDate?: string | null;
  bodyText?: string;
  bodyHtml?: string;
  isRead: boolean;
  attachments?: EmailAttachment[];
}

// ── Account CRUD ───────────────────────────────────────────────────────────────

export async function getEmailAccount(workspaceId: string, userId: string): Promise<EmailAccount | null> {
  const { data } = await supabaseServiceRole
    .from("user_email_accounts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return dbRowToAccount(data);
}

export async function saveEmailAccount(account: Omit<EmailAccount, "id" | "lastSyncedAt">): Promise<EmailAccount> {
  const row = accountToDbRow(account);
  const { data, error } = await supabaseServiceRole
    .from("user_email_accounts")
    .upsert(row, { onConflict: "workspace_id,user_id" })
    .select()
    .single();
  if (error) throw error;
  return dbRowToAccount(data);
}

// ── Cached messages ────────────────────────────────────────────────────────────

export async function getCachedMessages(
  workspaceId: string,
  userId: string,
  folder: string,
  limit = 100
): Promise<EmailMessage[]> {
  const { data } = await supabaseServiceRole
    .from("user_email_messages")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("folder", folder)
    .order("sent_date", { ascending: false })
    .limit(limit);
  return (data ?? []).map(dbRowToMessage);
}

export async function upsertMessages(
  workspaceId: string,
  userId: string,
  accountId: string,
  folder: string,
  messages: EmailMessage[]
): Promise<void> {
  if (!messages.length) return;
  const rows = messages.map((m) => ({
    workspace_id: workspaceId,
    user_id: userId,
    account_id: accountId,
    uid: m.uid,
    folder,
    subject: m.subject,
    from_name: m.fromName ?? null,
    from_email: m.fromEmail ?? null,
    to_recipients: m.toRecipients ?? [],
    sent_date: m.sentDate ?? null,
    is_read: m.isRead,
  }));
  await supabaseServiceRole
    .from("user_email_messages")
    .upsert(rows, { onConflict: "workspace_id,user_id,folder,uid" });
}

export async function updateMessageBody(
  workspaceId: string,
  userId: string,
  folder: string,
  uid: number,
  bodyText: string,
  bodyHtml: string,
  isRead: boolean
): Promise<void> {
  await supabaseServiceRole
    .from("user_email_messages")
    .update({ body_text: bodyText, body_html: bodyHtml, is_read: isRead })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("folder", folder)
    .eq("uid", uid);
}

export async function getUnreadCount(workspaceId: string, userId: string): Promise<number> {
  const { count } = await supabaseServiceRole
    .from("user_email_messages")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("is_read", false);
  return count ?? 0;
}

export async function markMessageRead(
  workspaceId: string,
  userId: string,
  folder: string,
  uid: number
): Promise<void> {
  await supabaseServiceRole
    .from("user_email_messages")
    .update({ is_read: true })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("folder", folder)
    .eq("uid", uid);
}

export async function updateAccountLastSynced(accountId: string): Promise<void> {
  await supabaseServiceRole
    .from("user_email_accounts")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", accountId);
}

// ── IMAP edge function calls ───────────────────────────────────────────────────

interface ImapConfig { host: string; port: number; secure: boolean; user: string; pass: string }

async function imapCall(config: ImapConfig, body: object): Promise<unknown> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(IMAP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ config, ...body }),
      signal: controller.signal,
    });
    const json = await res.json();
    if (!json.success && json.error) throw new Error(json.error);
    return json;
  } catch (e: any) {
    if (e.name === "AbortError") throw new Error("IMAP request timed out — check your mail server hostname in Email Settings");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function accountToImapConfig(account: EmailAccount): ImapConfig {
  return {
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    user: account.imapUsername,
    pass: account.imapPassword,
  };
}

export async function syncFolder(
  account: EmailAccount,
  folder: string,
  limit = 80
): Promise<EmailMessage[]> {
  const cfg = accountToImapConfig(account);
  const result = await imapCall(cfg, { action: "sync", folder, limit }) as {
    messages: {
      uid: number; isRead: boolean; subject: string;
      from: { name: string; email: string } | null;
      to: { name: string; email: string }[];
      date: string;
    }[];
    total: number;
  };
  return (result.messages ?? []).map((m) => ({
    uid: m.uid,
    folder,
    subject: m.subject,
    fromName: m.from?.name ?? "",
    fromEmail: m.from?.email ?? "",
    toRecipients: m.to ?? [],
    sentDate: m.date ?? null,
    isRead: m.isRead,
  }));
}

export async function fetchBody(
  account: EmailAccount,
  folder: string,
  uid: number
): Promise<{ text: string; html: string; isRead: boolean; attachments: EmailAttachment[] }> {
  const cfg = accountToImapConfig(account);
  const result = await imapCall(cfg, { action: "body", folder, uid }) as {
    text: string; html: string; isRead: boolean; attachments?: EmailAttachment[];
  };
  return {
    text: result.text ?? "",
    html: result.html ?? "",
    isRead: result.isRead ?? false,
    attachments: result.attachments ?? [],
  };
}

export async function imapMarkRead(account: EmailAccount, folder: string, uid: number): Promise<void> {
  const cfg = accountToImapConfig(account);
  await imapCall(cfg, { action: "markRead", folder, uid });
}

// ── Save a sent message to IMAP sent folder + DB cache ────────────────────────

export interface SentMessageParams {
  from: string;   // "Name <email>"
  to: string;
  cc?: string;
  subject: string;
  text?: string;
  date?: Date;
}

function buildRFC2822(p: SentMessageParams): string {
  const date = (p.date || new Date()).toUTCString();
  const lines = [
    `From: ${p.from}`,
    `To: ${p.to}`,
    ...(p.cc ? [`Cc: ${p.cc}`] : []),
    `Subject: ${p.subject}`,
    `Date: ${date}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    p.text || "",
  ];
  return lines.join("\r\n");
}

export async function saveSentEmail(
  workspaceId: string,
  userId: string,
  params: SentMessageParams
): Promise<void> {
  const account = await getEmailAccount(workspaceId, userId);
  if (!account) return;

  const sentFolder = account.sentFolder || "Sent";
  const date = params.date || new Date();
  const msgRaw = buildRFC2822({ ...params, date });
  const cfg = accountToImapConfig(account);

  let uid: number | null = null;
  try {
    const result = await imapCall(cfg, { action: "append", folder: sentFolder, messageRaw: msgRaw }) as { uid?: number };
    uid = result.uid ?? null;
  } catch { /* APPEND not supported — fall through to DB-only */ }

  // Parse from address
  const fromM = params.from.match(/^"?([^"<]*)"?\s*<([^>]+)>/);
  const fromName = fromM?.[1]?.trim() || "";
  const fromEmail = fromM?.[2]?.trim() || params.from;

  // Parse to recipients
  const toRecipients = params.to.split(",").map(t => {
    const m = t.trim().match(/^"?([^"<]*)"?\s*<([^>]+)>/);
    return m ? { name: m[1].trim(), email: m[2].trim() } : { name: "", email: t.trim() };
  });

  const syntheticUid = uid ?? (Math.floor(Date.now() / 1000) % 2000000000);

  await upsertMessages(workspaceId, userId, account.id, sentFolder, [{
    uid: syntheticUid,
    folder: sentFolder,
    subject: params.subject,
    fromName,
    fromEmail,
    toRecipients,
    sentDate: date.toISOString(),
    isRead: true,
  }]);
}

export async function listImapFolders(account: EmailAccount): Promise<string[]> {
  const cfg = accountToImapConfig(account);
  const result = await imapCall(cfg, { action: "listFolders" }) as { folders: string[] };
  return result.folders ?? [];
}

export async function imapMove(
  account: EmailAccount,
  folder: string,
  uid: number,
  targetFolder: string
): Promise<void> {
  const cfg = accountToImapConfig(account);
  await imapCall(cfg, { action: "move", folder, uid, targetFolder });
}

export async function deleteMessageFromCache(
  workspaceId: string,
  userId: string,
  folder: string,
  uid: number
): Promise<void> {
  await supabaseServiceRole
    .from("user_email_messages")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("folder", folder)
    .eq("uid", uid);
}

// ── Send email ─────────────────────────────────────────────────────────────────

export interface SendAttachment {
  filename: string;
  content: string; // base64-encoded
  contentType?: string;
}

export interface SendParams {
  smtpConfig: { host: string; port: number; secure: boolean; user: string; pass: string };
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  cc?: string;
  attachments?: SendAttachment[];
}

export async function sendEmail(params: SendParams): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await fetch(SMTP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      smtpConfig: params.smtpConfig,
      email: {
        from: params.from,
        to: params.to,
        cc: params.cc,
        subject: params.subject,
        text: params.text,
        html: params.html,
        attachments: params.attachments?.length ? params.attachments : undefined,
      },
    }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "Send failed");
}

// ── Row mappers ────────────────────────────────────────────────────────────────

function dbRowToAccount(row: Record<string, unknown>): EmailAccount {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    userId: row.user_id as string,
    displayName: (row.display_name as string) || "",
    emailAddress: row.email_address as string,
    imapHost: row.imap_host as string,
    imapPort: (row.imap_port as number) || 993,
    imapSecure: (row.imap_secure as boolean) !== false,
    imapUsername: row.imap_username as string,
    imapPassword: (() => { console.warn('[Security] Reading plaintext email password from DB - migrate to Supabase Vault'); return row.imap_password as string; })(),
    sentFolder: (row.sent_folder as string) || "Sent",
    smtpPort: (row.smtp_port as number) || 465,
    useForSending: (row.use_for_sending as boolean) === true,
    signature: (row.signature as string) || "",
    notificationSound: (row.notification_sound as string) || "ding",
    lastSyncedAt: row.last_synced_at as string | null,
  };
}

function accountToDbRow(account: Omit<EmailAccount, "id" | "lastSyncedAt">) {
  return {
    workspace_id: account.workspaceId,
    user_id: account.userId,
    display_name: account.displayName,
    email_address: account.emailAddress,
    imap_host: account.imapHost,
    imap_port: account.imapPort,
    imap_secure: account.imapSecure,
    imap_username: account.imapUsername,
    // SECURITY TODO: Password stored in plaintext. Migrate to Supabase Vault before production.
    imap_password: account.imapPassword,
    sent_folder: account.sentFolder,
    smtp_port: account.smtpPort,
    use_for_sending: account.useForSending,
    signature: account.signature,
    notification_sound: account.notificationSound,
  };
}

function dbRowToMessage(row: Record<string, unknown>): EmailMessage {
  return {
    id: row.id as string,
    uid: row.uid as number,
    folder: row.folder as string,
    subject: (row.subject as string) || "(no subject)",
    fromName: (row.from_name as string) || "",
    fromEmail: (row.from_email as string) || "",
    toRecipients: (row.to_recipients as { name: string; email: string }[]) || [],
    sentDate: row.sent_date as string | null,
    bodyText: (row.body_text as string) || "",
    bodyHtml: (row.body_html as string) || "",
    isRead: (row.is_read as boolean) || false,
  };
}
