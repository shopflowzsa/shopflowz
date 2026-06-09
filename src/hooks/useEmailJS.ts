import { useCallback, useEffect, useState } from "react";
import emailjs from "@emailjs/browser";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import type { EmailJSSettings } from "@/components/crm/EmailSettingsDialog";

interface SendEmailParams {
  to: string;
  toName?: string;
  subject: string;
  message: string;
  /** Any extra template variables to merge in */
  extras?: Record<string, string>;
}

interface UseEmailJSReturn {
  ready: boolean;
  settings: EmailJSSettings | null;
  sendEmail: (params: SendEmailParams) => Promise<void>;
}

/**
 * Hook for sending emails via EmailJS.
 * Loads settings from Firestore and wraps emailjs.send().
 *
 * Usage:
 *   const { sendEmail, ready } = useEmailJS();
 *   await sendEmail({ to: "customer@example.com", subject: "Invoice", message: "..." });
 */
export function useEmailJS(): UseEmailJSReturn {
  const { workspaceId } = useAuth();
  const [settings, setSettings] = useState<EmailJSSettings | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    (async () => {
      try {
        const { data: row } = await supabase
          .from('workspace_settings')
          .select('data')
          .eq('workspace_id', workspaceId)
          .eq('category', 'email')
          .maybeSingle();
        if (row?.data) setSettings(row.data as EmailJSSettings);
      } catch (err) {
        console.warn("useEmailJS: failed to load settings", err);
      }
    })();
  }, [workspaceId]);

  const sendEmail = useCallback(
    async ({ to, toName, subject, message, extras = {} }: SendEmailParams) => {
      if (!settings?.publicKey || !settings?.serviceId || !settings?.templateId) {
        throw new Error(
          "Email is not configured. Please set up EmailJS in Settings → Email Settings."
        );
      }

      await emailjs.send(
        settings.serviceId,
        settings.templateId,
        {
          to_email: to,
          to_name: toName || to,
          from_name: settings.fromName || "My Business",
          reply_to: settings.replyTo || "",
          subject,
          message,
          ...extras,
        },
        settings.publicKey
      );
    },
    [settings]
  );

  const ready = Boolean(
    settings?.publicKey && settings?.serviceId && settings?.templateId && settings?.enabled
  );

  return { ready, settings, sendEmail };
}
