// Supabase Edge Function — replaces Firebase Cloud Function sendEmailHTTP
// Runtime: Deno (built into Supabase Edge Functions)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

interface SMTPConfig {
  host: string;
  port: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  auth?: { user: string; pass: string };
}

interface EmailAttachment {
  filename: string;
  content: string; // base64-encoded
  contentType?: string;
}

interface EmailData {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { smtpConfig, email, provider, resendApiKey } = await req.json() as {
      smtpConfig?: SMTPConfig;
      email: EmailData;
      provider?: string;
      resendApiKey?: string;
    };

    if (!email) {
      return new Response(
        JSON.stringify({ success: false, error: "email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Resend API provider ───────────────────────────────────────────────────────
    if (provider === "resend" || resendApiKey) {
      if (!resendApiKey) {
        return new Response(
          JSON.stringify({ success: false, error: "resendApiKey is required for Resend provider" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const resendBody: Record<string, unknown> = {
        from: email.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      };

      if (email.cc) resendBody.cc = [email.cc];

      if (email.attachments?.length) {
        resendBody.attachments = email.attachments.map(a => ({
          filename: a.filename,
          content: a.content, // Resend accepts base64 directly
        }));
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(resendBody),
      });

      const json = await res.json() as { id?: string; message?: string; error?: string };
      if (!res.ok) {
        const msg = json?.message || json?.error || `Resend API error (${res.status})`;
        return new Response(
          JSON.stringify({ success: false, error: msg }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, messageId: json.id ?? "sent" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── SMTP provider ─────────────────────────────────────────────────────────────
    if (!smtpConfig) {
      return new Response(
        JSON.stringify({ success: false, error: "smtpConfig is required for SMTP provider" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Accept both { auth: { user, pass } } and flat { user, pass }
    const authUser = smtpConfig.auth?.user ?? smtpConfig.user;
    const authPass = smtpConfig.auth?.pass ?? smtpConfig.pass;
    const secure = smtpConfig.secure !== undefined ? smtpConfig.secure : smtpConfig.port === 465;

    if (!smtpConfig.host || !authUser || !authPass) {
      return new Response(
        JSON.stringify({ success: false, error: "Incomplete SMTP configuration (host, user, pass required)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📧 SMTP: ${smtpConfig.host}:${smtpConfig.port} secure=${secure} user:${authUser}`);

    // Use Deno mailer (smtp)
    const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");

    const client = new SMTPClient({
      connection: {
        hostname: smtpConfig.host,
        port: smtpConfig.port,
        tls: secure,
        auth: {
          username: authUser,
          password: authPass,
        },
      },
    });

    const mailPayload: Record<string, unknown> = {
      from: email.from,
      to: email.to,
      subject: email.subject,
      content: email.text ?? "",
      html: email.html ?? "",
    };

    if (email.cc) mailPayload.cc = email.cc;

    if (email.attachments?.length) {
      mailPayload.attachments = email.attachments.map(a => ({
        filename: a.filename,
        contentType: a.contentType ?? "application/pdf",
        encoding: "base64",
        content: a.content,
      }));
    }

    await client.send(mailPayload as Parameters<typeof client.send>[0]);
    await client.close();

    console.log("✅ Email sent via SMTP");

    return new Response(
      JSON.stringify({ success: true, messageId: `smtp-${Date.now()}` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("❌ Email error:", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
