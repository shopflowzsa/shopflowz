import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { PublicStore } from "@/components/ecommerce/PublicStore";
import { getWorkspaceBySlug, getWorkspaceByDomain } from "@/lib/storeService";
import { Loader2 } from "lucide-react";

const MAIN_HOSTS = ["shopflowz.web.app", "shopflowz.firebaseapp.com", "shopflowz.co.za", "www.shopflowz.co.za", "localhost", "127.0.0.1"];

function isCustomDomainHost(): boolean {
  const h = window.location.hostname;
  return !MAIN_HOSTS.some((m) => h === m || h.endsWith(`.${m}`));
}

export function TenantStorePage() {
  const { storeSlug } = useParams<{ storeSlug?: string }>();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function resolve() {
      let id: string | null = null;
      if (isCustomDomainHost()) {
        id = await getWorkspaceByDomain(window.location.hostname);
      } else if (storeSlug) {
        id = await getWorkspaceBySlug(storeSlug);
      }
      if (id) setWorkspaceId(id);
      else setNotFound(true);
    }
    resolve();
  }, [storeSlug]);

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-6">
        <h1 className="text-2xl font-bold">Store not found</h1>
        <p className="text-muted-foreground max-w-sm">
          The store you're looking for doesn't exist or hasn't been set up yet.
        </p>
      </div>
    );
  }

  if (!workspaceId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <PublicStore workspaceId={workspaceId} />;
}
