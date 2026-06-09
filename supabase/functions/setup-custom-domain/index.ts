// setup-custom-domain Edge Function
//
// Registers a custom subdomain with Firebase Hosting via the REST API.
// Returns the DNS records the client needs to add at their registrar.
// Requires FIREBASE_SERVICE_ACCOUNT_JSON and FIREBASE_SITE_ID in Supabase vault secrets.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

// Firebase Hosting apex (root-domain) A-record IPs. Used only for fallback records
// when Firebase hasn't returned the real ones yet — the configured path uses
// whatever Firebase's customDomains API reports.
const FIREBASE_APEX_IPS = ["151.101.1.195", "151.101.65.195"];

// Common multi-level public suffixes so we can tell a root domain from a subdomain
// (e.g. business.co.za is a root, shop.business.co.za is a subdomain).
const TWO_LEVEL_SUFFIXES = new Set([
  "co.za", "org.za", "net.za", "web.za", "gov.za",
  "co.uk", "org.uk", "me.uk", "com.au", "net.au", "org.au",
  "co.nz", "co.in", "co.ke", "co.zw", "com.ng",
]);

function registrableLabelCount(domain: string): number {
  const parts = domain.split(".");
  const lastTwo = parts.slice(-2).join(".");
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? 3 : 2;
}

// True for a root/apex domain (business.com, business.co.za) — needs A records.
function isApexDomain(domain: string): boolean {
  return domain.split(".").length <= registrableLabelCount(domain);
}

// The DNS "Name"/host for a record: "@" for a root domain, else the host labels
// before the registrable domain (shop.business.co.za → "shop").
function dnsHostName(domain: string): string {
  const parts = domain.split(".");
  const hostParts = parts.slice(0, parts.length - registrableLabelCount(domain));
  return hostParts.length ? hostParts.join(".") : "@";
}

// Correct-shaped DNS records for when Firebase hasn't supplied them:
// A records for a root domain, a CNAME for a subdomain — plus a TXT verify record.
function fallbackDnsRecords(domain: string, siteId: string, txtValue: string) {
  const records = isApexDomain(domain)
    ? FIREBASE_APEX_IPS.map((ip) => ({ type: "A", name: "@", value: ip }))
    : [{ type: "CNAME", name: dnsHostName(domain), value: `${siteId}.web.app` }];
  records.push({ type: "TXT", name: `_firebase.${domain}`, value: txtValue });
  return records;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey    = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth check — only authenticated workspace owners can call this
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json() as { workspaceId?: string; domain?: string };
    const { workspaceId, domain } = body;
    if (!workspaceId || !domain) return json({ error: "workspaceId and domain are required" }, 400);

    // Verify caller belongs to this workspace
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: member } = await adminClient
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("uid", userData.user.id)
      .maybeSingle();
    if (!member || !["owner", "editor"].includes(member.role)) {
      return json({ error: "Forbidden" }, 403);
    }

    // ── Firebase Hosting API ───────────────────────────────────────────────────
    const serviceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    const siteId = Deno.env.get("FIREBASE_SITE_ID") || "shopflowz";

    if (!serviceAccountJson) {
      // No Firebase credentials configured — return placeholder DNS records
      // so the UI still shows something useful. Admin must configure the secret.
      return json({
        dnsRecords: fallbackDnsRecords(domain, siteId, "Configure FIREBASE_SERVICE_ACCOUNT_JSON secret to get real verification token"),
        isApex: isApexDomain(domain),
        note: "FIREBASE_SERVICE_ACCOUNT_JSON not configured — using placeholder records",
      });
    }

    // Get a Google OAuth token from the service account
    const serviceAccount = JSON.parse(serviceAccountJson);
    const accessToken = await getGoogleAccessToken(serviceAccount);

    // Resolve Firebase project number (needed for the v1beta1 customDomains API)
    // The project number differs from the project ID (e.g. 42929223606 vs "shopflowz")
    let projectNumber = Deno.env.get("FIREBASE_PROJECT_NUMBER") || "";
    if (!projectNumber) {
      const projRes = await fetch(
        `https://firebase.googleapis.com/v1beta1/projects/${serviceAccount.project_id}`,
        { headers: { "Authorization": `Bearer ${accessToken}` } },
      );
      const projData = await projRes.json() as { projectNumber?: string };
      projectNumber = projData.projectNumber ?? "";
    }

    const baseUrl = projectNumber
      ? `https://firebasehosting.googleapis.com/v1beta1/projects/${projectNumber}/sites/${siteId}`
      : `https://firebasehosting.googleapis.com/v1beta1/sites/${siteId}`;

    // Register the custom domain with Firebase Hosting.
    // Uses ?customDomainId= query param (the working v1beta1 format).
    // 409 = already registered — safe to proceed and fetch existing records.
    const fbRes = await fetch(
      `${baseUrl}/customDomains?customDomainId=${encodeURIComponent(domain)}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ certPreference: "GROUPED" }),
      },
    );

    if (!fbRes.ok && fbRes.status !== 409) {
      const fbErr = await fbRes.json().catch(() => ({}));
      console.error("Firebase Hosting API error:", fbRes.status, JSON.stringify(fbErr));
      // Fall through to fetch existing records or use fallback — don't block the user
    }

    // Fetch the domain's current state and required DNS records
    const detailRes = await fetch(
      `${baseUrl}/customDomains/${encodeURIComponent(domain)}`,
      { headers: { "Authorization": `Bearer ${accessToken}` } },
    );
    const detail = await detailRes.json() as {
      requiredDnsUpdates?: { desired?: { records?: { domainName?: string; type?: string; rdata?: string }[] }[] }[];
      hostState?: string;
      ownershipState?: string;
    };

    const dnsRecords: { type: string; name: string; value: string }[] = [];
    for (const update of detail.requiredDnsUpdates ?? []) {
      for (const set of update.desired ?? []) {
        for (const record of set.records ?? []) {
          dnsRecords.push({
            type: record.type ?? "A",
            name: record.domainName ?? domain,
            value: record.rdata ?? `${siteId}.web.app`,
          });
        }
      }
    }

    // Fallback: if Firebase returned no records (domain already active or API gap)
    // use well-known Firebase Hosting apex IPs so the UI always shows something useful
    if (dnsRecords.length === 0) {
      dnsRecords.push(...fallbackDnsRecords(domain, siteId, "firebase-verify=check-firebase-console"));
    }

    const hostState = detail.hostState ?? "UNKNOWN";
    const alreadyActive = hostState === "HOST_ACTIVE";

    return json({ dnsRecords, isApex: isApexDomain(domain), alreadyActive });

  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

// ── Google OAuth2 via service account (JWT flow) ───────────────────────────────

async function getGoogleAccessToken(sa: {
  client_email: string;
  private_key: string;
  token_uri?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.hosting",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  // Build JWT
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const payload = btoa(JSON.stringify(claim)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const signingInput = `${header}.${payload}`;

  // Import private key
  const pemContents = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryKey.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const jwt = `${signingInput}.${sig}`;

  // Exchange JWT for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
  if (!tokenData.access_token) throw new Error(tokenData.error || "Failed to get access token");
  return tokenData.access_token;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
