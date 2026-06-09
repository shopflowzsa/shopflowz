import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import { ReactNode } from "react";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, workspace, isSystemAdmin, myRole } = useAuth();

  // Show spinner while auth is loading OR while user is authenticated but workspace hasn't resolved yet
  if (loading || (user && !workspace)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const isStaff = isSystemAdmin || myRole === "owner" || myRole === "admin" || myRole === "member";
  if (!isStaff && !workspace?.hasCrmAccess) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
