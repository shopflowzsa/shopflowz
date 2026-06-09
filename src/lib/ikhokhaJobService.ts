/**
 * iKhokha CRM Job Deposit Payment Service
 *
 * Separate from the ecommerce iKhokha integration.
 * Credentials are stored per-workspace in Firestore: workspaces/{workspaceId}/settings/ikhokhaJob
 * The actual PayLink is created via a Cloud Function (so the AppSecret never touches the client).
 *
 * Flow:
 *  1. Staff submits drop-off form
 *  2. Job task is auto-created
 *  3. createJobDepositPaylink() is called with the deposit amount from the form
 *  4. Cloud Function creates PayLink via iKhokha API
 *  5. Returned URL opens in a new tab on the counter screen
 *  6. Staff taps "Pay" → customer taps/swipes their card on the connected iKhokha reader
 *
 * Collection flow:
 *  - Staff enters balance on iK Flyer with description = job number (e.g. "JOB-0042")
 *  - Scheduled Cloud Function polls iKhokha transaction history every 2 minutes
 *  - When a PAID transaction description matches a job number, task is moved to collectedStatusLabel
 */

import { supabase } from "@/lib/supabase";

export interface IkhokhaJobSettings {
  enabled: boolean;
  appId: string;
  appSecret: string;
  /** Label of the task status to move to when collection payment is detected (default: "Collected") */
  collectedStatusLabel: string;
}

const defaultSettings: IkhokhaJobSettings = {
  enabled: false,
  appId: "",
  appSecret: "",
  collectedStatusLabel: "Collected",
};

export async function loadIkhokhaJobSettings(workspaceId: string): Promise<IkhokhaJobSettings> {
  try {
    const { data: row } = await supabase
      .from('workspace_settings')
      .select('data')
      .eq('workspace_id', workspaceId)
      .eq('category', 'ikhokhaJob')
      .maybeSingle();
    if (!row?.data) return { ...defaultSettings };
    return { ...defaultSettings, ...(row.data as any) } as IkhokhaJobSettings;
  } catch (err) {
    console.error("[IkhokhaJob] Failed to load settings:", err);
    return { ...defaultSettings };
  }
}

export async function saveIkhokhaJobSettings(
  workspaceId: string,
  settings: IkhokhaJobSettings
): Promise<void> {
  await supabase
    .from('workspace_settings')
    .upsert(
      { workspace_id: workspaceId, category: 'ikhokhaJob', data: settings },
      { onConflict: 'workspace_id,category' }
    );
}

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
const CLOUD_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/create-job-paylink`;

interface CreateJobPaylinkResult {
  paylinkUrl: string;
  paylinkId: string;
}

/**
 * Creates an iKhokha PayLink for a CRM job deposit.
 * @param workspaceId  – current workspace
 * @param jobNumber    – e.g. "JOB-0042"
 * @param amountRands  – deposit amount in Rands (will be converted to cents)
 * @param description  – shown on the payment screen
 */
export async function createJobDepositPaylink(
  workspaceId: string,
  jobNumber: string,
  amountRands: number,
  description: string
): Promise<CreateJobPaylinkResult> {
  const amountCents = Math.round(amountRands * 100);

  const response = await fetch(CLOUD_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      workspaceId,
      jobNumber,
      amount: amountCents,
      description,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || `iKhokha Cloud Function returned ${response.status}`);
  }

  const data = await response.json();
  return { paylinkUrl: data.paylinkUrl, paylinkId: data.paylinkID };
}
