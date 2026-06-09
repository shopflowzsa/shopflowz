import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import { ReactNode } from "react";

// Protected route for CRM business clients
export function ProtectedCrmRoute({ children }: { children: ReactNode }) {
  const { user, loading, workspace, isSystemAdmin } = useAuth();

  // Still resolving auth or workspace
  if (loading || (user && !workspace)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading your CRM...</p>
        </div>
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // System admins always have access
  if (isSystemAdmin) {
    return <>{children}</>;
  }

  // Check if workspace has CRM access
  if (!workspace?.hasCrmAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-4">
          <h2 className="text-2xl font-bold">CRM Access Required</h2>
          <p className="text-muted-foreground">
            Your account doesn't have access to the CRM system. Please contact support to upgrade your account.
          </p>
          <button
            onClick={() => window.location.href = '/'}
            className="mt-4 px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
          >
            Back to Store
          </button>
        </div>
      </div>
    );
  }

  // Check subscription status
  if (workspace.subscriptionStatus === 'expired' || workspace.subscriptionStatus === 'suspended') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-4">
          <h2 className="text-2xl font-bold">Subscription {workspace.subscriptionStatus === 'expired' ? 'Expired' : 'Suspended'}</h2>
          <p className="text-muted-foreground">
            Your CRM subscription is {workspace.subscriptionStatus}. Please contact support to renew your access.
          </p>
          <button
            onClick={() => window.location.href = '/'}
            className="mt-4 px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
          >
            Back to Store
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
