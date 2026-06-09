# ShopFlowz — Project Context for Claude Code

## DEPLOYMENT — READ THIS FIRST

**This repo is ShopFlowz only. Do NOT deploy to srclickup.**

- Firebase account: `shopflowzsa@gmail.com`
- Firebase project: `shopflowz`
- Hosting URL: `shopflowz.web.app`
- GitHub remote: `github.com/shopflowzsa/shopflowz`

To deploy:
```
firebase login:use shopflowzsa@gmail.com
npm run build
firebase deploy --only hosting
```

**srclickup is a completely separate app** (SR Components' internal CRM). Never deploy this codebase there.

## What this project is
ShopFlowz is a multi-tenant SaaS CRM + ecommerce platform. It is a fork of SR Components' internal CRM (`srclickup`), rebranded and extended to be sold to other businesses as their own CRM + public store.

SR Components (the owner) uses `srclickup.web.app` as their own internal CRM — that version has NO multi-tenant store features. ShopFlowz is the product version that gives each client workspace their own public store.

## What's already built in this repo (vs the SR Components version)

### Multi-tenant ecommerce stores
Each client workspace gets a public store URL. Two mechanisms:

1. **Slug-based**: `shopflowz.web.app/store/{slug}` — default for all clients
2. **Custom domain**: `shop.theirclient.co.za` — opt-in, enabled per workspace by SR Components admin

### Files added/modified for multi-tenant stores
- `src/lib/storeService.ts` — `getWorkspaceBySlug`, `getWorkspaceByDomain`, `updateStoreSlug`, `saveCustomDomain`, `setCustomDomainEnabled`, `getAllWorkspacesForAdmin`. Uses `supabaseServiceRole` for lookups (RLS blocks anon client).
- `src/pages/TenantStorePage.tsx` — Resolver component. Checks hostname first (custom domain), falls back to `:storeSlug` URL param. Renders `<PublicStore workspaceId={resolvedId} />`.
- `src/App.tsx` — Routes: `/store/:storeSlug`, `/store/:storeSlug/product/:productId`, `/store/:storeSlug/order-success`, `/store/:storeSlug/order-failed`. Hostname detection at root for custom domain clients.
- `src/types/auth.ts` — `Workspace` interface has: `storeSlug`, `storeEnabled`, `customDomain`, `customDomainStatus`, `customDomainEnabled`
- `src/contexts/AuthContext.tsx` — `mapWorkspace()` maps those fields from Supabase
- `src/components/crm/EcommerceSettingsDialog.tsx` — "Store URL" tab: slug editor + custom domain linking UI
- `src/components/crm/UserManagement.tsx` — "Workspaces" tab (system admin only): toggle `customDomainEnabled` per workspace
- `supabase/functions/setup-custom-domain/index.ts` — Edge function: registers custom domain with Firebase Hosting REST API using service account JWT, returns DNS records to client

## Database migrations needed (Supabase)
These SQL columns must exist on the `workspaces` table — run in Supabase dashboard SQL editor if not already done:

```sql
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS store_slug TEXT UNIQUE;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS custom_domain_status TEXT DEFAULT 'none';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS store_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS custom_domain_enabled BOOLEAN DEFAULT FALSE;

-- Public read access for slug/domain lookup
CREATE POLICY IF NOT EXISTS "public_store_lookup" ON workspaces
  FOR SELECT TO anon
  USING (store_enabled = true)
  WITH CHECK (false);
```

## Environment / deployment
- This repo deploys to a **separate Firebase project** from srclickup (needs its own Firebase project set up)
- `.env` is gitignored — copy from SR Components `.env` and update keys for ShopFlowz's own Supabase + Firebase project
- Supabase Edge Function `setup-custom-domain` needs `FIREBASE_SERVICE_ACCOUNT_JSON` secret in Supabase vault

## What still needs doing
1. **Rebrand UI** — replace SR Components branding (logo, colors, name) with ShopFlowz branding
2. **Set up Firebase project** for ShopFlowz and configure hosting
3. **Set up Supabase project** for ShopFlowz (or decide to share SR Components' Supabase)
4. **Deploy** the Edge Function (`supabase functions deploy setup-custom-domain`)
5. **Run DB migrations** on the ShopFlowz Supabase project
6. **Test** slug-based stores end-to-end

## Key technical notes
- `supabaseServiceRole` must be used for store slug/domain lookups — anon client is blocked by RLS
- `TenantStorePage` MAIN_HOSTS list must match whatever the ShopFlowz production domain is
- The `setup-custom-domain` edge function falls back to placeholder DNS records if `FIREBASE_SERVICE_ACCOUNT_JSON` is not configured
- SR Components' `/store` route redirects to `/store/srcomponents` in their version; in ShopFlowz each client has their own slug
