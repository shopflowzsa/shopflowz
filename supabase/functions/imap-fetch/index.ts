// IMAP fetch edge function — reads emails from a cPanel/Dovecot IMAP server
// Uses Deno native TLS (port 993) — no external npm dependency

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

// ── Minimal IMAP client ────────────────────────────────────────────────────────

const ENC = new TextEncoder();
const DEC = new TextDecoder();

class ImapClient {
  #reader: ReadableStreamDefaultReader<Uint8Array>;
  #writer: WritableStreamDefaultWriter<Uint8Array>;
  #buf = "";
  #tag = 0;

  constructor(conn: Deno.TlsConn) {
    this.#reader = conn.readable.getReader();
    this.#writer = conn.writable.getWriter();
  }

  async readGreeting() { await this.#line(); }

  async #fill() {
    const { value } = await this.#reader.read();
    if (value) this.#buf += DEC.decode(value, { stream: true });
  }

  async #line(): Promise<string> {
    while (!this.#buf.includes("\r\n")) await this.#fill();
    const i = this.#buf.indexOf("\r\n");
    const line = this.#buf.slice(0, i);
    this.#buf = this.#buf.slice(i + 2);
    return line;
  }

  async #readLiteral(n: number): Promise<string> {
    while (this.#buf.length < n) await this.#fill();
    const data = this.#buf.slice(0, n);
    this.#buf = this.#buf.slice(n);
    if (this.#buf.startsWith("\r\n")) this.#buf = this.#buf.slice(2);
    return data;
  }

  async cmd(command: string): Promise<{ ok: boolean; lines: string[]; literals: string[] }> {
    const tag = `A${String(++this.#tag).padStart(4, "0")}`;
    await this.#writer.write(ENC.encode(`${tag} ${command}\r\n`));
    const lines: string[] = [];
    const literals: string[] = [];
    while (true) {
      const line = await this.#line();
      const litM = line.match(/\{(\d+)\}$/);
      if (litM) {
        lines.push(line);
        literals.push(await this.#readLiteral(parseInt(litM[1])));
        continue;
      }
      if (line.startsWith(`${tag} `)) {
        return { ok: /^[A-Z0-9]+ OK/i.test(line), lines, literals };
      }
      lines.push(line);
    }
  }

  // APPEND cannot use cmd() because the server sends a + continuation before we send the literal
  async append(folder: string, message: string): Promise<number | null> {
    const tag = `A${String(++this.#tag).padStart(4, "0")}`;
    const normalized = message.replace(/\r?\n/g, "\r\n");
    const msgBytes = ENC.encode(normalized);
    await this.#writer.write(ENC.encode(`${tag} APPEND "${folder}" (\\Seen) {${msgBytes.length}}\r\n`));
    const cont = await this.#line();
    if (!cont.startsWith("+")) throw new Error(`APPEND: expected continuation, got: ${cont}`);
    await this.#writer.write(msgBytes);
    await this.#writer.write(ENC.encode("\r\n"));
    while (true) {
      const line = await this.#line();
      if (line.startsWith(`${tag} `)) {
        if (!/OK/i.test(line)) throw new Error(`APPEND failed: ${line}`);
        const uidM = line.match(/\[APPENDUID \d+ (\d+)\]/i);
        return uidM ? parseInt(uidM[1]) : null;
      }
    }
  }

  close() {
    try { this.#writer.releaseLock(); } catch { /**/ }
    try { this.#reader.releaseLock(); } catch { /**/ }
  }
}

// ── IMAP ENVELOPE parser ───────────────────────────────────────────────────────

function unquote(s: string): string {
  if (!s || s === "NIL") return "";
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return s;
}

function decodeMimeWord(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, text) => {
    try {
      if (enc.toUpperCase() === "B") {
        const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
        return new TextDecoder(charset).decode(bytes);
      }
      return text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    } catch { return text; }
  });
}

// Tokenise an IMAP parenthesised list into top-level tokens
function tokenise(s: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === " ") { i++; continue; }
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && (s[j] !== '"' || s[j - 1] === "\\")) j++;
      tokens.push(s.slice(i, j + 1)); i = j + 1;
    } else if (s[i] === "(") {
      let depth = 0, j = i;
      while (j < s.length) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")") { depth--; if (depth === 0) { j++; break; } }
        j++;
      }
      tokens.push(s.slice(i, j)); i = j;
    } else {
      let j = i;
      while (j < s.length && s[j] !== " " && s[j] !== ")") j++;
      tokens.push(s.slice(i, j)); i = j;
    }
  }
  return tokens;
}

function parseAddressList(raw: string): { name: string; email: string }[] {
  if (!raw || raw === "NIL") return [];
  const results: { name: string; email: string }[] = [];
  const addrRe = /\(([^()]*)\)/g;
  let m;
  while ((m = addrRe.exec(raw)) !== null) {
    const parts = tokenise(m[1]);
    const name = decodeMimeWord(unquote(parts[0] ?? "NIL"));
    const user = unquote(parts[2] ?? "NIL");
    const host = unquote(parts[3] ?? "NIL");
    if (user && host && host !== "NIL") results.push({ name, email: `${user}@${host}` });
  }
  return results;
}

interface ParsedEnvelope {
  date: string;
  subject: string;
  from: { name: string; email: string }[];
  to: { name: string; email: string }[];
}

function parseEnvelopeFromLine(line: string): ParsedEnvelope | null {
  // Extract the ENVELOPE (...) content
  const envM = line.match(/ENVELOPE\s+(\(.*)/i);
  if (!envM) return null;
  const raw = envM[1];
  // Strip outer parens
  const inner = raw.startsWith("(") ? raw.slice(1) : raw;
  const parts = tokenise(inner);
  return {
    date: unquote(parts[0] ?? "NIL"),
    subject: decodeMimeWord(unquote(parts[1] ?? "NIL")) || "(no subject)",
    from: parseAddressList(parts[2] ?? "NIL"),
    to: parseAddressList(parts[5] ?? "NIL"),
  };
}

// ── Main handler ───────────────────────────────────────────────────────────────

interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

interface FetchRequest {
  config: ImapConfig;
  action: "sync" | "body" | "markRead" | "listFolders" | "append" | "move";
  folder?: string;
  uid?: number;
  limit?: number;
  messageRaw?: string;
  targetFolder?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json() as FetchRequest;
    const { config, action, folder = "INBOX", uid, limit = 50, messageRaw, targetFolder } = body;

    if (!config?.host || !config?.user || !config?.pass) {
      return err("Missing IMAP config");
    }

    const conn = await Deno.connectTls({
      hostname: config.host,
      port: config.port ?? 993,
    });

    const imap = new ImapClient(conn);
    await imap.readGreeting();

    // Authenticate
    const loginRes = await imap.cmd(`LOGIN "${config.user.replace(/"/g, '\\"')}" "${config.pass.replace(/"/g, '\\"')}"`);
    if (!loginRes.ok) {
      imap.close(); conn.close();
      return err("Authentication failed — check username and password");
    }

    try {
      // ── List folders ──────────────────────────────────────────────────────────
      if (action === "listFolders") {
        const res = await imap.cmd('LIST "" "*"');
        const folders = res.lines
          .filter(l => l.startsWith('* LIST'))
          .map(l => {
            const m = l.match(/"([^"]+)"\s*$/) ?? l.match(/(\S+)\s*$/);
            return m?.[1] ?? "";
          })
          .filter(Boolean);
        return ok({ folders });
      }

      // ── Append to folder ─────────────────────────────────────────────────────
      if (action === "append") {
        if (!messageRaw) return err("messageRaw is required for append");
        const appendUid = await imap.append(folder, messageRaw);
        return ok({ uid: appendUid });
      }

      // ── Select folder ─────────────────────────────────────────────────────────
      const selRes = await imap.cmd(`SELECT "${folder}"`);
      if (!selRes.ok) return err(`Cannot open folder: ${folder}`);
      const existsLine = selRes.lines.find(l => l.includes("EXISTS"));
      const total = parseInt(existsLine?.match(/(\d+) EXISTS/)?.[1] ?? "0");

      // ── Mark read ────────────────────────────────────────────────────────────
      if (action === "markRead" && uid != null) {
        await imap.cmd(`UID STORE ${uid} +FLAGS (\\Seen)`);
        return ok({ success: true });
      }

      // ── Move message to another folder ────────────────────────────────────────
      if (action === "move" && uid != null && targetFolder) {
        // Try RFC 6851 MOVE first (widely supported on Dovecot/cPanel)
        const moveRes = await imap.cmd(`UID MOVE ${uid} "${targetFolder}"`);
        if (!moveRes.ok) {
          // Fallback: COPY then mark deleted + expunge
          await imap.cmd(`UID COPY ${uid} "${targetFolder}"`);
          await imap.cmd(`UID STORE ${uid} +FLAGS (\\Deleted)`);
          await imap.cmd("EXPUNGE");
        }
        return ok({ success: true });
      }

      // ── Fetch body ───────────────────────────────────────────────────────────
      if (action === "body" && uid != null) {
        const res = await imap.cmd(`UID FETCH ${uid} (BODY.PEEK[] FLAGS)`);
        const seen = res.lines.some(l => /\\Seen/i.test(l));
        const rawBody = res.literals[0] ?? "";
        const { text, html, attachments } = parseMimeBody(rawBody);
        return ok({ text, html, attachments, isRead: seen });
      }

      // ── Sync: fetch headers of most recent messages ──────────────────────────
      if (total === 0) return ok({ messages: [], total: 0 });

      const fetchFrom = Math.max(1, total - limit + 1);
      const fetchTo = total;
      const fetchRes = await imap.cmd(`FETCH ${fetchFrom}:${fetchTo} (UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])`);

      // Build a map from sequence number → accumulated data across lines/literals
      interface MsgAcc { seq: number; uid?: number; isRead?: boolean; internalDate?: string; headerLiteral?: string }
      const acc = new Map<number, MsgAcc>();
      let lastSeq: number | null = null;

      for (let li = 0; li < fetchRes.lines.length; li++) {
        const line = fetchRes.lines[li];
        if (line.startsWith("* ")) {
          const seqM = line.match(/^\* (\d+) FETCH/i);
          if (!seqM) continue;
          const seq = parseInt(seqM[1]);
          lastSeq = seq;
          const uidM = line.match(/UID (\d+)/i);
          const intdM = line.match(/INTERNALDATE "([^"]+)"/i);
          const isRead = /\\Seen/i.test(line);
          acc.set(seq, {
            seq,
            uid: uidM ? parseInt(uidM[1]) : seq,
            isRead,
            internalDate: intdM ? intdM[1] : undefined,
          });
        }
        // Pick up header literal from literals array — it corresponds to the
        // N-th literal encountered; we match by looking for the preceding line
        // that starts with "* N FETCH" or continuation lines with BODY[HEADER
        if (lastSeq !== null && line.match(/BODY\[HEADER/i)) {
          // The literal index equals the number of literals we've seen up to this line
          const litIdx = fetchRes.lines.slice(0, li).filter(l => /\{\d+\}$/.test(l)).length;
          const literal = fetchRes.literals[litIdx] ?? "";
          const entry = acc.get(lastSeq);
          if (entry) entry.headerLiteral = literal;
        }
      }

      const messages: unknown[] = [];
      for (const entry of acc.values()) {
        const headers = entry.headerLiteral ?? "";
        const subject = parseHeader(headers, "Subject") || "(no subject)";
        const fromRaw = parseHeader(headers, "From");
        const toRaw = parseHeader(headers, "To");
        const dateRaw = parseHeader(headers, "Date") || entry.internalDate || null;
        const fromParsed = parseAddressHeader(fromRaw);
        const toParsed = parseAddressHeader(toRaw);
        messages.push({
          seq: entry.seq,
          uid: entry.uid ?? entry.seq,
          isRead: entry.isRead ?? false,
          subject: decodeMimeWord(subject),
          from: fromParsed[0] ?? null,
          to: toParsed,
          date: dateRaw,
        });
      }

      console.log(`[imap-fetch] total=${total} fetched=${messages.length} lines=${fetchRes.lines.length} literals=${fetchRes.literals.length}`);

      return ok({ messages: messages.reverse(), total });
    } finally {
      try { await imap.cmd("LOGOUT"); } catch { /**/ }
      imap.close();
      conn.close();
    }
  } catch (e) {
    console.error("IMAP error:", e);
    return err(e instanceof Error ? e.message : String(e), 500);
  }
});

// ── Raw header parsers (used with BODY[HEADER.FIELDS]) ────────────────────────

function parseHeader(raw: string, name: string): string {
  // Headers can be folded (continuation lines start with whitespace)
  const re = new RegExp(`^${name}:\\s*(.*)`, "im");
  const m = raw.match(re);
  if (!m) return "";
  let val = m[1];
  // Unfold: continuation lines (lines starting with WSP after the matched line)
  const startIdx = raw.indexOf(m[0]);
  if (startIdx >= 0) {
    const rest = raw.slice(startIdx + m[0].length);
    const foldRe = /^(\r?\n[ \t]+[^\r\n]*)/;
    let more = rest;
    let fold: RegExpMatchArray | null;
    while ((fold = more.match(foldRe))) {
      val += " " + fold[1].replace(/^[\r\n]+/, "").trimStart();
      more = more.slice(fold[0].length);
    }
  }
  return val.trim();
}

function parseAddressHeader(raw: string): { name: string; email: string }[] {
  if (!raw) return [];
  const decoded = decodeMimeWord(raw);
  const results: { name: string; email: string }[] = [];
  // Match: "Display Name" <email> or display name <email> or plain email
  const re = /"?([^"<,]*)"?\s*<([^>]+)>|([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(decoded)) !== null) {
    if (m[3]) {
      results.push({ name: "", email: m[3].trim() });
    } else {
      results.push({ name: m[1].trim(), email: m[2].trim() });
    }
  }
  return results;
}

// ── MIME body parser ───────────────────────────────────────────────────────────

interface Attachment { filename: string; content: string; contentType: string }
interface ParsedBody { text: string; html: string; attachments: Attachment[] }

function parseMimeBody(raw: string): ParsedBody {
  // Detect MIME boundary
  const boundaryM = raw.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryM) {
    // Single-part message — no attachments possible
    const headerEnd = raw.indexOf("\r\n\r\n");
    const headers = headerEnd >= 0 ? raw.slice(0, headerEnd) : "";
    const body = headerEnd >= 0 ? raw.slice(headerEnd + 4) : raw;
    const decoded = decodeTransferEncoding(headers, body);
    const isHtml = /content-type:\s*text\/html/i.test(headers);
    return isHtml ? { text: "", html: decoded, attachments: [] } : { text: decoded, html: "", attachments: [] };
  }

  const boundary = boundaryM[1].trim();
  const parts = raw.split(new RegExp(`--${escapeRegex(boundary)}(?:--)?`));
  let text = "", html = "";
  const attachments: Attachment[] = [];

  for (const part of parts) {
    if (!part.trim() || part.trim() === "--") continue;
    const splitIdx = part.indexOf("\r\n\r\n");
    if (splitIdx < 0) continue;
    const pHeaders = part.slice(0, splitIdx);
    const pBody = part.slice(splitIdx + 4);
    const contentType = pHeaders.match(/content-type:\s*([^\r\n;]+)/i)?.[1]?.trim() ?? "";
    const disposition = pHeaders.match(/content-disposition:\s*([^\r\n;]+)/i)?.[1]?.trim().toLowerCase() ?? "";
    const filenameM = pHeaders.match(/filename\*?=(?:UTF-8''|")?([^";\r\n]+)"?/i);
    const filename = filenameM ? decodeURIComponent(filenameM[1].trim().replace(/^"|"$/g, "")) : "";
    const encoding = pHeaders.match(/content-transfer-encoding:\s*(\S+)/i)?.[1]?.toLowerCase() ?? "";

    const isAttachment = disposition.startsWith("attachment") || (filename && !contentType.startsWith("text/") && !contentType.startsWith("multipart/"));
    if (isAttachment) {
      // Keep base64 as-is; encode plain content to base64
      const b64 = encoding === "base64"
        ? pBody.replace(/\r?\n/g, "")
        : btoa(unescape(encodeURIComponent(pBody.replace(/\r\n/g, "\n").trim())));
      attachments.push({ filename: filename || "attachment", content: b64, contentType: contentType || "application/octet-stream" });
    } else if (contentType.startsWith("multipart/")) {
      // Recurse into nested multipart (e.g. multipart/alternative inside multipart/mixed)
      const nested = parseMimeBody(part);
      if (!html && nested.html) html = nested.html;
      if (!text && nested.text) text = nested.text;
      attachments.push(...nested.attachments);
    } else if (contentType.startsWith("text/html") && !html) {
      html = decodeTransferEncoding(pHeaders, pBody);
    } else if (contentType.startsWith("text/plain") && !text) {
      text = decodeTransferEncoding(pHeaders, pBody);
    }
  }

  return { text, html, attachments };
}

function decodeTransferEncoding(headers: string, body: string): string {
  const encoding = headers.match(/content-transfer-encoding:\s*(\S+)/i)?.[1]?.toLowerCase() ?? "";
  const charset = headers.match(/charset="?([^"\r\n;]+)"?/i)?.[1] ?? "utf-8";
  const clean = body.replace(/\r\n/g, "\n").trim();
  try {
    if (encoding === "base64") {
      const bytes = Uint8Array.from(atob(clean.replace(/\n/g, "")), c => c.charCodeAt(0));
      return new TextDecoder(charset).decode(bytes);
    }
    if (encoding === "quoted-printable") {
      return clean
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
    return clean;
  } catch { return clean; }
}

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function ok(data: unknown) {
  return new Response(JSON.stringify({ success: true, ...((data as object) ?? {}) }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function err(message: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
