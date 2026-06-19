import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "shopflowz_wa_verify";

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"];

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

    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        if (change.field !== "messages") continue;

        const value         = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id as string | undefined;
        if (!phoneNumberId) continue;

        // ── Find workspace that owns this phone number ─────────────────────
        const { data: allSettings } = await supabase
          .from("workspace_settings")
          .select("workspace_id, data")
          .eq("category", "whatsapp");

        const workspaceRow = (allSettings ?? []).find(
          (s: any) => (s.data as any)?.phoneNumberId === phoneNumberId,
        );
        if (!workspaceRow) {
          console.log("[wa-webhook] No workspace for phoneNumberId:", phoneNumberId);
          continue;
        }
        const workspaceId: string = workspaceRow.workspace_id;
        const accessToken: string = (workspaceRow.data as any)?.accessToken ?? "";

        // ── Process incoming messages ──────────────────────────────────────
        for (const msg of value?.messages ?? []) {
          const contactPhone: string = msg.from;
          const contactName: string  =
            value.contacts?.find((c: any) => c.wa_id === contactPhone)?.profile?.name
            ?? contactPhone;
          const msgTime = new Date(parseInt(msg.timestamp) * 1000);
          const windowExpires = new Date(msgTime.getTime() + 24 * 60 * 60 * 1000);

          // ── Resolve media for image/video/audio/document/sticker ──────────
          let content: string | null = msg.text?.body ?? null;
          let mediaUrl: string | null = null;

          if (MEDIA_TYPES.includes(msg.type)) {
            const mediaObj = msg[msg.type]; // e.g. msg.image, msg.video
            content = mediaObj?.caption ?? content;

            if (mediaObj?.id && accessToken) {
              try {
                // Step 1: get temporary download URL from Meta
                const infoRes = await fetch(
                  `https://graph.facebook.com/v19.0/${mediaObj.id}`,
                  { headers: { Authorization: `Bearer ${accessToken}` } },
                );
                const info = await infoRes.json();

                if (info.url) {
                  // Step 2: download the media bytes
                  const dlRes = await fetch(info.url, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                  });
                  if (dlRes.ok) {
                    const mimeType   = info.mime_type ?? "image/jpeg";
                    const ext        = mimeType.split("/")[1]?.split(";")[0] ?? "bin";
                    const filePath   = `${workspaceId}/${mediaObj.id}.${ext}`;
                    const fileBytes  = await dlRes.arrayBuffer();

                    // Step 3: upload to Supabase Storage
                    const { error: upErr } = await supabase.storage
                      .from("whatsapp-media")
                      .upload(filePath, fileBytes, { contentType: mimeType, upsert: true });

                    if (!upErr) {
                      const { data: pub } = supabase.storage
                        .from("whatsapp-media")
                        .getPublicUrl(filePath);
                      mediaUrl = pub.publicUrl;
                    } else {
                      console.error("[wa-webhook] Storage upload error:", upErr);
                    }
                  }
                }
              } catch (e) {
                console.error("[wa-webhook] Media download failed:", e);
              }
            }
          }

          // ── Upsert conversation ────────────────────────────────────────────
          const lastMsg = content ?? (mediaUrl ? `[${msg.type}]` : `[${msg.type}]`);
          const { data: existing } = await supabase
            .from("whatsapp_conversations")
            .select("id, unread_count, pending_message, pending_message_by, pending_media_url, pending_media_filename")
            .eq("workspace_id", workspaceId)
            .eq("contact_phone", contactPhone)
            .maybeSingle();

          let convId: string;
          const pendingMessage:       string | null = existing?.pending_message        ?? null;
          const pendingBy:            string | null = existing?.pending_message_by     ?? null;
          const pendingMediaUrl:      string | null = existing?.pending_media_url      ?? null;
          const pendingMediaFilename: string | null = existing?.pending_media_filename ?? null;

          if (existing) {
            convId = existing.id;
            await supabase.from("whatsapp_conversations").update({
              contact_name:         contactName,
              last_message:         lastMsg,
              last_message_at:      msgTime.toISOString(),
              window_expires_at:    windowExpires.toISOString(),
              unread_count:         (existing.unread_count ?? 0) + 1,
              last_replied_by_name: null,
            }).eq("id", convId);
          } else {
            const { data: created, error: createErr } = await supabase
              .from("whatsapp_conversations")
              .insert({
                workspace_id:      workspaceId,
                contact_phone:     contactPhone,
                contact_name:      contactName,
                last_message:      lastMsg,
                last_message_at:   msgTime.toISOString(),
                window_expires_at: windowExpires.toISOString(),
                unread_count:      1,
              })
              .select("id")
              .single();
            if (createErr || !created) { console.error("[wa-webhook] Create conv error:", createErr); continue; }
            convId = created.id;
          }

          // ── Insert inbound message ─────────────────────────────────────────
          if (msg.id) {
            await supabase.from("whatsapp_messages").upsert({
              workspace_id:    workspaceId,
              conversation_id: convId,
              wamid:           msg.id,
              direction:       "inbound",
              message_type:    msg.type ?? "text",
              content:         content,
              media_url:       mediaUrl,
              status:          "received",
              created_at:      msgTime.toISOString(),
            }, { onConflict: "wamid" });
          }

          // ── Auto-send queued pending text message ──────────────────────────
          if (pendingMessage && accessToken) {
            try {
              const sendRes = await fetch(
                `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
                {
                  method: "POST",
                  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to: contactPhone,
                    type: "text",
                    text: { body: pendingMessage },
                  }),
                },
              );
              const sendData = await sendRes.json();
              if (sendRes.ok) {
                const sentWamid: string | null = sendData.messages?.[0]?.id ?? null;
                await supabase.from("whatsapp_messages").insert({
                  workspace_id:    workspaceId,
                  conversation_id: convId,
                  wamid:           sentWamid,
                  direction:       "outbound",
                  message_type:    "text",
                  content:         pendingMessage,
                  status:          "sent",
                  sent_by_name:    pendingBy ?? "Staff",
                });
                await supabase.from("whatsapp_conversations").update({
                  pending_message:      null,
                  pending_message_by:   null,
                  last_message:         pendingMessage,
                  last_message_at:      new Date().toISOString(),
                  last_replied_by_name: pendingBy ?? "Staff",
                  unread_count:         0,
                }).eq("id", convId);
                console.log("[wa-webhook] Pending text auto-sent for conv:", convId);
              } else {
                console.error("[wa-webhook] Failed to send pending message:", sendData);
              }
            } catch (e) {
              console.error("[wa-webhook] Error sending pending message:", e);
            }
          }

          // ── Auto-send queued pending PDF document ───────────────────────────
          if (pendingMediaUrl && accessToken) {
            try {
              const pdfRes = await fetch(pendingMediaUrl);
              if (pdfRes.ok) {
                const pdfBlob = await pdfRes.blob();
                const fname   = pendingMediaFilename ?? "document.pdf";

                const form = new FormData();
                form.append("messaging_product", "whatsapp");
                form.append("file", new Blob([pdfBlob], { type: "application/pdf" }), fname);
                form.append("type", "document");

                const uploadRes = await fetch(
                  `https://graph.facebook.com/v19.0/${phoneNumberId}/media`,
                  { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: form },
                );
                const uploadData = await uploadRes.json();

                if (uploadRes.ok) {
                  const mediaId = uploadData.id;
                  const docRes  = await fetch(
                    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
                    {
                      method: "POST",
                      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                      body: JSON.stringify({
                        messaging_product: "whatsapp",
                        to: contactPhone,
                        type: "document",
                        document: { id: mediaId, filename: fname },
                      }),
                    },
                  );
                  const docData = await docRes.json();
                  if (docRes.ok) {
                    const sentWamid: string | null = docData.messages?.[0]?.id ?? null;
                    await supabase.from("whatsapp_messages").insert({
                      workspace_id:    workspaceId,
                      conversation_id: convId,
                      wamid:           sentWamid,
                      direction:       "outbound",
                      message_type:    "document",
                      content:         `[Document: ${fname}]`,
                      status:          "sent",
                      sent_by_name:    pendingBy ?? "Staff",
                    });
                    await supabase.from("whatsapp_conversations").update({
                      pending_media_url:      null,
                      pending_media_filename: null,
                      pending_message_by:     null,
                      last_message:           `[Document: ${fname}]`,
                      last_message_at:        new Date().toISOString(),
                      last_replied_by_name:   pendingBy ?? "Staff",
                      unread_count:           0,
                    }).eq("id", convId);
                    console.log("[wa-webhook] Pending PDF auto-sent for conv:", convId);
                  } else {
                    console.error("[wa-webhook] Failed to send pending PDF:", docData);
                  }
                } else {
                  console.error("[wa-webhook] Failed to upload pending PDF:", uploadData);
                }
              }
            } catch (e) {
              console.error("[wa-webhook] Error sending pending PDF:", e);
            }
          }
        }

        // ── Process status updates ─────────────────────────────────────────
        for (const status of value?.statuses ?? []) {
          if (!status.id) continue;
          await supabase.from("whatsapp_messages")
            .update({ status: status.status })
            .eq("wamid", status.id);
        }
      }
    }

    return new Response("OK", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
});
