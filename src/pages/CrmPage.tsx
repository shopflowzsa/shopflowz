/**
 * CRM Page for Business Clients
 * Multi-tenant CRM with workspace-specific features
 */

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { CrmLayout } from "@/components/crm/CrmLayout";
import { WorkspaceState } from "@/types/crm";
import { getWorkspaceState, saveWorkspaceState } from "@/lib/workspaceService";
import { Loader2 } from "lucide-react";

export default function CrmPage() {
  const { workspaceId, workspace } = useAuth();
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;

    const loadState = async () => {
      try {
        const state = await getWorkspaceState(workspaceId);
        setWorkspaceState(state);
      } catch (error) {
        console.error("Failed to load workspace:", error);
      } finally {
        setLoading(false);
      }
    };

    loadState();
  }, [workspaceId]);

  const handleStateChange = async (newState: WorkspaceState) => {
    setWorkspaceState(newState);
    if (workspaceId) {
      await saveWorkspaceState(workspaceId, newState);
    }
  };

  if (loading || !workspaceState || !workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading your CRM...</p>
        </div>
      </div>
    );
  }

  return (
    <WorkspaceProvider workspaceState={workspaceState} onStateChange={handleStateChange}>
      <CrmLayout 
        hiddenFeatures={workspace.hiddenFeatures || []}
        brandName={workspace.brandName}
        subscriptionTier={workspace.subscriptionTier}
      />
    </WorkspaceProvider>
  );
}
