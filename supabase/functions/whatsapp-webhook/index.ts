import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Set this in Supabase Dashboard → Project Settings → Edge Functions → Secrets
// Name: WHATSAPP_WEBHOOK_VERIFY_TOKEN  Value: any string you choose (e.g. "shopflowz_wa_2024")
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "shopflowz_wa_verify";

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── GET — Meta webhook verification ────────────────────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // ── POST — Incoming messages / status updates ───────────────────────────────
  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return new Response("OK", { status: 200 }); }

    // Always return 200 immediately so Meta doesn't retry
    // (processing happens inline — fast enough for webhook SLA)

    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        if (change.field !== "messages") continue;

        const value         = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id as string | undefined;
        if (!phoneNumberId) continue;

        // ── Find workspace that owns this phone number ────────────────────────
        const { data: allSettings } = await supabase
          .from("workspace_settings")
          .select("workspace_id, data")
          .eq("category", "whatsapp");

        const workspaceRow = (allSettings ?? []).find(
          (s: any) => (s.data as any)?.phoneNumberId === phoneNumberId,
        );
        if (!workspaceRow) {
          console.log("[wa-webhook] No workspace found for phoneNumberId:", phoneNumberId);
          continue;
        }
        const workspaceId: string = workspaceRow.workspace_id;

        // ── Process incoming messages ─────────────────────────────────────────
        for (const msg of value?.messages ?? []) {
          const contactPhone: string = msg.from;
          const contactName: string  =
            value.contacts?.find((c: any) => c.wa_id === contactPhone)?.profile?.name
            ?? contactPhone;
          const msgText: string | null = msg.text?.body ?? null;
          const msgTime = new Date(parseInt(msg.timestamp) * 1000);
          const windowExpires = new Date(msgTime.getTime() + 24 * 60 * 60 * 1000);

          // Upsert conversation (find or create)
          const { data: existing } = await supabase
            .from("whatsapp_conversations")
            .select("id, unread_count")
            .eq("workspace_id", workspaceId)
            .eq("contact_phone", contactPhone)
            .maybeSingle();

          let convId: string;
          if (existing) {
            convId = existing.id;
            await supabase
              .from("whatsapp_conversations")
              .update({
                contact_name:      contactName,
                last_message:      msgText ?? `[${msg.type}]`,
                last_message_at:   msgTime.toISOString(),
                window_expires_at: windowExpires.toISOString(),
                unread_count:      (existing.unread_count ?? 0) + 1,
              })
              .eq("id", convId);
          } else {
            const { data: created, error: createErr } = await supabase
              .from("whatsapp_conversations")
              .insert({
                workspace_id:      workspaceId,
                contact_phone:     contactPhone,
                contact_name:      contactName,
                last_message:      msgText ?? `[${msg.type}]`,
                last_message_at:   msgTime.toISOString(),
                window_expires_at: windowExpires.toISOString(),
                unread_count:      1,
              })
              .select("id")
              .single();

            if (createErr || !created) {
              console.error("[wa-webhook] Failed to create conversation:", createErr);
              continue;
            }
            convId = created.id;
          }

          // Insert message (ignore duplicates via wamid unique constraint)
          if (msg.id) {
            await supabase
              .from("whatsapp_messages")
              .upsert({
                workspace_id:    workspaceId,
                conversation_id: convId,
                wamid:           msg.id,
                direction:       "inbound",
                message_type:    msg.type ?? "text",
                content:         msgText,
                status:          "received",
                created_at:      msgTime.toISOString(),
              }, { onConflict: "wamid" });
          }
        }

        // ── Process delivery / read status updates ─────────────────────────────
        for (const status of value?.statuses ?? []) {
          if (!status.id) continue;
          await supabase
            .from("whatsapp_messages")
            .update({ status: status.status })
            .eq("wamid", status.id);
        }
      }
    }

    return new Response("OK", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
});
