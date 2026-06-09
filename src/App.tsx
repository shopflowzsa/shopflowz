import React from "react";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { ProtectedCrmRoute } from "@/components/auth/ProtectedCrmRoute";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-muted-foreground max-w-md">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            className="rounded bg-primary px-4 py-2 text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import Index from "./pages/Index.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import LandingPage from "./pages/LandingPage.tsx";
import ImpersonateLanding from "./pages/ImpersonateLanding.tsx";
import { PublicStorePage } from "./pages/PublicStorePage.tsx";
import { TenantStorePage } from "./pages/TenantStorePage.tsx";
import PublicForm from "./pages/PublicForm.tsx";
import OrderSuccess from "./pages/OrderSuccess.tsx";
import OrderFailed from "./pages/OrderFailed.tsx";
import ShippingPolicyPage from "./pages/ShippingPolicyPage.tsx";
import ReturnsPolicyPage from "./pages/ReturnsPolicyPage.tsx";
import NotFound from "./pages/NotFound.tsx";
import AcceptInvitationPage from "./pages/AcceptInvitationPage.tsx";
import AdminPage from "./pages/AdminPage.tsx";
import { useAndroidBackButton } from "@/hooks/useAndroidBackButton";

// Detect native Capacitor app (Android / iOS)
const isNativeApp = !!(window as any).Capacitor?.isNativePlatform?.() ||
  window.location.href.startsWith('capacitor://') ||
  window.location.href.startsWith('https://localhost') ||
  navigator.userAgent.includes('CapacitorWebView');

// Detect custom tenant domain (anything that isn't the main ShopFlowz hosting domain)
const MAIN_HOSTS = [
  "shopflowz.web.app",
  "shopflowz.firebaseapp.com",
  "shopflowz.co.za",
  "www.shopflowz.co.za",
  "localhost",
  "127.0.0.1",
];
const isCustomDomain = !MAIN_HOSTS.some((h) => {
  const host = window.location.hostname;
  return host === h || host.endsWith(`.${h}`);
});

const queryClient = new QueryClient();

function AppShell({ children }: { children: React.ReactNode }) {
  useAndroidBackButton();
  return <>{children}</>;
}

const App = () => (
  <ThemeProvider>
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppShell>
        <AuthProvider>
          <Routes>
            {/* Root: native app → CRM, custom domain → tenant store, main domain → ShopFlowz landing */}
            <Route path="/" element={isNativeApp ? <Navigate to="/crm" replace /> : (isCustomDomain ? <TenantStorePage /> : <LandingPage />)} />

            {/* Custom domain: all paths go to the tenant store (order pages keep their paths) */}
            {isCustomDomain && <Route path="/store/product/:productId" element={<TenantStorePage />} />}
            {isCustomDomain && <Route path="/store/order-success" element={<OrderSuccess />} />}
            {isCustomDomain && <Route path="/store/order-failed" element={<OrderFailed />} />}
            {isCustomDomain && <Route path="*" element={<TenantStorePage />} />}

            {/* Slug-based multi-tenant store routes */}
            <Route path="/store/:storeSlug" element={<TenantStorePage />} />
            <Route path="/store/:storeSlug/product/:productId" element={<TenantStorePage />} />
            <Route path="/store/:storeSlug/order-success" element={<OrderSuccess />} />
            <Route path="/store/:storeSlug/order-failed" element={<OrderFailed />} />

            {/* /store with no slug → back to landing */}
            <Route path="/store" element={<Navigate to="/" replace />} />
            <Route path="/store/product/:productId" element={<PublicStorePage />} />
            <Route path="/store/order-success" element={<OrderSuccess />} />
            <Route path="/store/order-failed" element={<OrderFailed />} />
            <Route path="/shipping-policy" element={<ShippingPolicyPage />} />
            <Route path="/returns-policy" element={<ReturnsPolicyPage />} />
            <Route path="/form/:formId" element={<PublicForm />} />
            {/* Admin login */}
            <Route path="/login" element={<LoginPage />} />
            {/* Invitation acceptance */}
            <Route path="/invite/:invitationId" element={<AcceptInvitationPage />} />
            {/* ShopFlowz platform admin portal */}
            <Route path="/admin" element={<AdminPage />} />
            {/* System admin CRM (fallback for deep links) */}
            <Route path="/admin/crm" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/admin/crm/*" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            {/* Business Client CRM */}
            <Route path="/impersonate-landing" element={<ImpersonateLanding />} />
            <Route path="/crm" element={<ProtectedCrmRoute><Index /></ProtectedCrmRoute>} />
            <Route path="/crm/*" element={<ProtectedCrmRoute><Index /></ProtectedCrmRoute>} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
        </AppShell>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
  </ThemeProvider>
);

export default App;
