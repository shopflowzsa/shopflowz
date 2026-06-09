import { supabase } from "@/lib/supabase";

export interface SupervisorSecuritySettings {
  passwordHash?: string;
  salt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

const CATEGORY = "supervisor_security";

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashSupervisorPassword(password: string, salt: string): Promise<string> {
  return sha256(`${salt}:${password}`);
}

export async function loadSupervisorSecuritySettings(workspaceId: string): Promise<SupervisorSecuritySettings> {
  const { data, error } = await supabase
    .from("workspace_settings")
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("category", CATEGORY)
    .maybeSingle();

  if (error) throw error;
  return (data?.data as SupervisorSecuritySettings) || {};
}

export async function saveSupervisorPassword(workspaceId: string, password: string, userId: string): Promise<void> {
  const salt = crypto.randomUUID();
  const passwordHash = await hashSupervisorPassword(password, salt);
  const data: SupervisorSecuritySettings = {
    passwordHash,
    salt,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };

  const { error } = await supabase
    .from("workspace_settings")
    .upsert(
      { workspace_id: workspaceId, category: CATEGORY, data },
      { onConflict: "workspace_id,category" }
    );

  if (error) throw error;
}

export async function verifySupervisorPassword(workspaceId: string, password: string): Promise<boolean> {
  const settings = await loadSupervisorSecuritySettings(workspaceId);
  if (!settings.passwordHash || !settings.salt) return false;
  const passwordHash = await hashSupervisorPassword(password, settings.salt);
  return passwordHash === settings.passwordHash;
}
