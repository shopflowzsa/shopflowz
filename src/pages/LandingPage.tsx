import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabaseServiceRole } from "@/lib/supabase";
import { MODULE_LABELS } from "@/lib/modules";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingBag,
  BarChart3,
  FileText,
  Users,
  Package,
  Bell,
  Printer,
  Mail,
  CheckCircle,
  ArrowRight,
  Zap,
  Globe,
  Shield,
  ChevronRight,
  Star,
  TrendingUp,
  Layers,
} from "lucide-react";

const BRAND_TEAL = "#1D9E75";

const features = [
  {
    icon: ShoppingBag,
    title: "Your Own Online Store",
    description:
      "Launch a public ecommerce storefront instantly. Sell products, manage orders, and accept payments — all under your own brand.",
  },
  {
    icon: Users,
    title: "Built-in CRM",
    description:
      "Track leads, customers, and jobs. Assign tasks, set statuses, and never lose track of a customer again.",
  },
  {
    icon: FileText,
    title: "Invoicing & Quoting",
    description:
      "Generate professional invoices and quotes in seconds. Send via email or WhatsApp and track payment status.",
  },
  {
    icon: Package,
    title: "Stock & Inventory",
    description:
      "Manage your product catalogue, track stock levels, and link inventory directly to your store and invoices.",
  },
  {
    icon: BarChart3,
    title: "Analytics Dashboard",
    description:
      "Real-time insights on sales, staff performance, and business health. Make decisions based on data, not guesswork.",
  },
  {
    icon: Mail,
    title: "Email & WhatsApp",
    description:
      "Send quotes, invoices, and notifications directly from the platform. Integrated email accounts and WhatsApp messaging.",
  },
  {
    icon: Printer,
    title: "Thermal Printing",
    description:
      "Print receipts, labels, and job cards directly from the app via Bluetooth or network thermal printers.",
  },
  {
    icon: Bell,
    title: "Notifications & Alerts",
    description:
      "Stay on top of orders, overdue invoices, low stock alerts, and team updates in real time.",
  },
];

type PlanDisplay = {
  name: string;
  price: string;
  period: string;
  description: string;
  highlight: boolean;
  cta: string;
  badge: string | null;
  features: string[];
  modules: string[];
};

const DEFAULT_PLANS: PlanDisplay[] = [
  {
    name: "Free Forever", price: "R0", period: "/ month",
    description: "All features included — free for solo businesses, forever.",
    highlight: false, cta: "Get Started Free", badge: "No credit card",
    features: ["All platform features included", "1 admin (no staff members)", "30 products", "30 invoices / month", "30 quotes / month", "30 tasks / month", "Email support"],
    modules: ["crm", "email", "ecommerce", "settings", "sales", "inventory", "job_register"],
  },
  {
    name: "Starter", price: "R299", period: "/ month",
    description: "Perfect for new businesses getting started.",
    highlight: false, cta: "Get Started", badge: null,
    features: ["All platform features", "1 admin + 1 staff member", "Up to 500 products", "Unlimited invoices & quotes", "Unlimited tasks & orders", "Email support"],
    modules: ["crm", "email", "ecommerce", "settings", "sales", "inventory", "job_register", "business_planning", "outstanding_tasks", "ai_assistant"],
  },
  {
    name: "Growth", price: "R799", period: "/ month",
    description: "For growing businesses that need more power.",
    highlight: true, cta: "Get Started", badge: "Most popular",
    features: ["Everything in Starter", "1 admin + 4 staff members", "Unlimited products", "Analytics dashboard", "WhatsApp integration", "Priority support"],
    modules: ["crm", "email", "ecommerce", "settings", "sales", "inventory", "job_register", "business_planning", "outstanding_tasks", "ai_assistant", "banking", "analytics", "staff_reports", "performance_analytics", "ai_bot_warnings"],
  },
  {
    name: "Pro", price: "R1,499", period: "/ month",
    description: "High-volume stores and multi-location businesses.",
    highlight: false, cta: "Get Started", badge: null,
    features: ["Everything in Growth", "1 admin + 9 staff members", "Custom domain for your store", "Advanced analytics", "Dedicated support"],
    modules: ["crm", "email", "ecommerce", "settings", "sales", "banking", "inventory", "business_planning", "job_register", "outstanding_tasks", "analytics", "staff_reports", "performance_analytics", "tech_assessment", "tech_datasheets", "ai_bot_warnings", "ai_assistant"],
  },
];

const testimonials = [
  {
    name: "Thabo M.",
    business: "Cape Town Electronics",
    quote:
      "ShopFlowz replaced 4 different tools we were paying for. Now everything — store, invoices, stock, WhatsApp — is in one place. Game changer.",
    rating: 5,
  },
  {
    name: "Priya N.",
    business: "Durbans Auto Parts",
    quote:
      "The CRM and invoicing alone are worth it. We cut admin time by 60% in the first month. Our customers love the professional invoices.",
    rating: 5,
  },
  {
    name: "Werner S.",
    business: "WS Repairs",
    quote:
      "The thermal printer integration is perfect for our repair shop. Job cards print automatically when we create a task. Simple and efficient.",
    rating: 5,
  },
];

export default function LandingPage() {
  const [plans, setPlans] = useState<PlanDisplay[]>(DEFAULT_PLANS);

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => { if (wasDark) root.classList.add("dark"); };
  }, []);

  useEffect(() => {
    supabaseServiceRole
      .from("platform_settings")
      .select("value")
      .eq("key", "subscription_billing")
      .maybeSingle()
      .then(({ data }) => {
        if (Array.isArray(data?.value?.plans) && data.value.plans.length > 0) {
          setPlans(
            data.value.plans.map((p: { name: string; price: number; badge?: string; description: string; features: string[]; highlight: boolean; cta: string; modules?: string[] }) => ({
              name: p.name,
              price: p.price === 0 ? "R0" : `R${p.price.toLocaleString()}`,
              period: "/ month",
              description: p.description,
              highlight: p.highlight,
              cta: p.cta,
              badge: p.badge || null,
              features: p.features,
              modules: Array.isArray(p.modules) ? p.modules : [],
            }))
          );
        }
      });
  }, []);

  return (
    <div className="min-h-screen font-sans" style={{ background: "#ffffff", color: "#111827" }}>
      {/* ── TOP NAV ── */}
      <header style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,0.97)", backdropFilter: "blur(8px)", borderBottom: "1px solid #f3f4f6", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2" style={{ textDecoration: "none" }}>
            <div
              className="h-9 w-9 rounded-lg flex items-center justify-center font-extrabold text-lg"
              style={{ background: BRAND_TEAL, color: "#fff" }}
            >
              S
            </div>
            <span className="font-extrabold text-lg tracking-tight" style={{ color: "#111827" }}>
              Shop<span style={{ color: BRAND_TEAL }}>Flowz</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium" style={{ color: "#4b5563" }}>
            <a href="#features" style={{ color: "#4b5563", textDecoration: "none" }}>Features</a>
            <a href="#pricing" style={{ color: "#4b5563", textDecoration: "none" }}>Pricing</a>
            <a href="#testimonials" style={{ color: "#4b5563", textDecoration: "none" }}>Reviews</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              to="/login"
              style={{
                display: "inline-flex", alignItems: "center", padding: "7px 16px",
                border: "1px solid #d1d5db", borderRadius: "6px",
                fontSize: "14px", fontWeight: 500, color: "#374151",
                background: "#fff", textDecoration: "none",
              }}
            >
              Sign In
            </Link>
            <Link
              to="/login?tab=register"
              style={{
                display: "inline-flex", alignItems: "center", padding: "8px 18px",
                borderRadius: "6px", fontSize: "14px", fontWeight: 700,
                color: "#fff", background: BRAND_TEAL, textDecoration: "none",
              }}
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      </header>

      {/* ── HERO ── */}
      <section
        className="relative overflow-hidden text-white"
        style={{ background: "linear-gradient(135deg, #0f2027 0%, #1a3a2a 60%, #1D9E75 100%)" }}
      >
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-24 md:py-36 text-center">
          <Badge
            className="mb-6 border"
            style={{ background: "rgba(29,158,117,0.2)", color: "#6ee7c7", borderColor: "rgba(29,158,117,0.4)" }}
          >
            <Zap className="h-3 w-3 mr-1" /> All-in-one business platform for South African SMEs
          </Badge>
          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight mb-6 max-w-4xl mx-auto">
            Run Your Entire Business
            <br />
            <span style={{ color: "#6ee7c7" }}>From One Platform</span>
          </h1>
          <p className="text-lg md:text-xl text-gray-300 mb-10 max-w-2xl mx-auto leading-relaxed">
            ShopFlowz gives your business a branded online store, CRM, invoicing, stock
            management, analytics, and more — all connected, all in one place.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/login?tab=register">
              <Button
                size="lg"
                className="text-white font-bold gap-2 px-8 shadow-lg"
                style={{ background: BRAND_TEAL }}
              >
                Start Free 14-Day Trial <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <a href="#features">
              <Button
                size="lg"
                variant="outline"
                className="border-white/30 text-white hover:bg-white/10 gap-2"
              >
                See All Features
              </Button>
            </a>
          </div>
          <p className="mt-4 text-sm text-gray-400">
            No credit card required · Cancel anytime · Setup in minutes
          </p>
        </div>
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 60" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 60L1440 60L1440 20C1200 60 900 0 720 20C540 40 240 0 0 20L0 60Z" fill="white" />
          </svg>
        </div>
      </section>

      {/* ── TRUST STRIP ── */}
      <section className="bg-white py-10 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16 text-gray-400 text-sm font-medium">
            {[
              { icon: Globe, label: "Works on any device" },
              { icon: Shield, label: "Secure & POPIA compliant" },
              { icon: Zap, label: "Set up in under 10 minutes" },
              { icon: Layers, label: "Replaces 4-6 separate tools" },
              { icon: TrendingUp, label: "Built for SA businesses" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2">
                <Icon className="h-4 w-4" style={{ color: BRAND_TEAL }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <Badge className="mb-4" style={{ background: "rgba(29,158,117,0.1)", color: BRAND_TEAL }}>
              Everything you need
            </Badge>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">
              One platform. Every tool your business needs.
            </h2>
            <p className="text-gray-500 text-lg max-w-2xl mx-auto">
              Stop juggling 5 different apps. ShopFlowz brings your store, CRM, invoicing,
              stock, and communications into one connected platform.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
              >
                <div
                  className="h-11 w-11 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: "rgba(29,158,117,0.1)" }}
                >
                  <Icon className="h-5 w-5" style={{ color: BRAND_TEAL }} />
                </div>
                <h3 className="font-bold text-gray-900 mb-2">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PROMO VIDEO ── */}
      <section className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <Badge className="mb-4" style={{ background: "rgba(29,158,117,0.1)", color: BRAND_TEAL }}>
            See it in action
          </Badge>
          <h2 className="text-3xl md:text-4xl font-extrabold mb-4">
            Everything your business needs, in one place
          </h2>
          <p className="text-gray-500 text-lg mb-10 max-w-2xl mx-auto">
            Watch how ShopFlowz brings together your store, CRM, invoicing, and more.
          </p>
          <div className="rounded-2xl overflow-hidden shadow-2xl border border-gray-100 bg-black">
            <video
              src="/promo.mp4"
              controls
              autoPlay
              muted
              loop
              playsInline
              className="w-full"
              style={{ display: "block", maxHeight: "540px", objectFit: "contain" }}
            />
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">Up and running in 3 steps</h2>
            <p className="text-gray-500 text-lg">No IT team needed. No technical knowledge required.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {[
              {
                step: "01",
                title: "Sign up & choose your plan",
                description:
                  "Create your account in under 2 minutes. Start with the free 14-day trial — full access, no card needed.",
              },
              {
                step: "02",
                title: "Set up your store & products",
                description:
                  "Add your products, set prices, upload photos. Your public online store is live the moment you publish.",
              },
              {
                step: "03",
                title: "Sell, manage, and grow",
                description:
                  "Take orders, send invoices, track stock, and get insights — all from your ShopFlowz dashboard.",
              },
            ].map(({ step, title, description }) => (
              <div key={step} className="flex gap-5">
                <div
                  className="shrink-0 h-12 w-12 rounded-full flex items-center justify-center font-extrabold text-white text-sm"
                  style={{ background: BRAND_TEAL }}
                >
                  {step}
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-2">{title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <Badge className="mb-4" style={{ background: "rgba(29,158,117,0.1)", color: BRAND_TEAL }}>
              Simple pricing
            </Badge>
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">
              Transparent, all-inclusive pricing
            </h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">
              No hidden app fees. No transaction cuts. One price — every feature included.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-start">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl p-7 border flex flex-col gap-5 ${
                  plan.highlight
                    ? "border-transparent shadow-xl text-white"
                    : "bg-white border-gray-100 shadow-sm"
                }`}
                style={plan.highlight ? { background: BRAND_TEAL } : {}}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
                    <Badge
                      className="text-xs font-bold px-3 py-1 rounded-full shadow"
                      style={
                        plan.highlight
                          ? { background: "#facc15", color: "#713f12" }
                          : { background: BRAND_TEAL, color: "white" }
                      }
                    >
                      {plan.badge}
                    </Badge>
                  </div>
                )}
                <div>
                  <p className={`text-sm font-bold uppercase tracking-wider mb-1 ${plan.highlight ? "text-green-100" : "text-gray-400"}`}>
                    {plan.name}
                  </p>
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-extrabold">{plan.price}</span>
                    <span className={`text-sm mb-1 ${plan.highlight ? "text-green-100" : "text-gray-400"}`}>
                      {plan.period}
                    </span>
                  </div>
                  <p className={`text-sm mt-1 ${plan.highlight ? "text-green-100" : "text-gray-500"}`}>
                    {plan.description}
                  </p>
                </div>

                <ul className="flex flex-col gap-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle
                        className="h-4 w-4 shrink-0 mt-0.5"
                        style={{ color: plan.highlight ? "#a7f3d0" : BRAND_TEAL }}
                      />
                      <span className={plan.highlight ? "text-green-50" : "text-gray-600"}>{f}</span>
                    </li>
                  ))}
                </ul>

                {plan.modules.length > 0 && (
                  <div className="mt-4">
                    <div
                      className={`text-xs font-bold uppercase tracking-wider mb-2 ${plan.highlight ? "text-green-100/80" : "text-gray-400"}`}
                    >
                      Modules included
                    </div>
                    <ul className="flex flex-col gap-2">
                      {plan.modules.map((key) => (
                        <li key={key} className="flex items-start gap-2 text-sm">
                          <CheckCircle
                            className="h-4 w-4 shrink-0 mt-0.5"
                            style={{ color: plan.highlight ? "#a7f3d0" : BRAND_TEAL }}
                          />
                          <span className={plan.highlight ? "text-green-50" : "text-gray-600"}>
                            {MODULE_LABELS[key] ?? key}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Link to="/login?tab=register" className="mt-auto">
                  <Button
                    className="w-full font-bold"
                    style={
                      plan.highlight
                        ? { background: "white", color: BRAND_TEAL }
                        : { background: BRAND_TEAL, color: "white" }
                    }
                  >
                    {plan.cta} <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </Link>
              </div>
            ))}
          </div>

          <p className="text-center text-gray-400 text-sm mt-8">
            Need more? <a href="mailto:hello@shopflowz.co.za" className="underline">Contact us</a> for Enterprise pricing.
          </p>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section id="testimonials" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">Loved by SA businesses</h2>
            <p className="text-gray-500 text-lg">Real results from real ShopFlowz customers.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map(({ name, business, quote, rating }) => (
              <div key={name} className="bg-gray-50 rounded-2xl p-7 border border-gray-100">
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: rating }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <p className="text-gray-700 text-sm leading-relaxed mb-5">"{quote}"</p>
                <div>
                  <p className="font-bold text-gray-900 text-sm">{name}</p>
                  <p className="text-gray-400 text-xs">{business}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section
        className="py-24 text-white text-center"
        style={{ background: "linear-gradient(135deg, #0f2027 0%, #1a3a2a 60%, #1D9E75 100%)" }}
      >
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="text-3xl md:text-4xl font-extrabold mb-4">
            Ready to take control of your business?
          </h2>
          <p className="text-gray-300 text-lg mb-10">
            Join hundreds of South African businesses running on ShopFlowz.
            Start your free 14-day trial today — no credit card needed.
          </p>
          <Link to="/login?tab=register">
            <Button
              size="lg"
              className="text-white font-bold px-10 gap-2 shadow-lg"
              style={{ background: BRAND_TEAL }}
            >
              Start Free Trial <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
          <p className="mt-4 text-sm text-gray-400">Setup takes less than 10 minutes.</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row justify-between gap-8 mb-10">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-extrabold text-sm"
                  style={{ background: BRAND_TEAL }}
                >
                  S
                </div>
                <span className="font-extrabold text-white text-base">
                  Shop<span style={{ color: "#6ee7c7" }}>Flowz</span>
                </span>
              </div>
              <p className="text-sm max-w-xs leading-relaxed">
                Your complete commerce platform. Sell. Manage. Grow.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-sm">
              <div>
                <p className="text-white font-semibold mb-3">Product</p>
                <ul className="space-y-2">
                  <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                  <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                  <li><Link to="/login?tab=register" className="hover:text-white transition-colors">Sign Up</Link></li>
                </ul>
              </div>
              <div>
                <p className="text-white font-semibold mb-3">Support</p>
                <ul className="space-y-2">
                  <li><a href="mailto:hello@shopflowz.co.za" className="hover:text-white transition-colors">Contact Us</a></li>
                  <li><Link to="/shipping-policy" className="hover:text-white transition-colors">Shipping Policy</Link></li>
                  <li><Link to="/returns-policy" className="hover:text-white transition-colors">Returns Policy</Link></li>
                </ul>
              </div>
              <div>
                <p className="text-white font-semibold mb-3">Legal</p>
                <ul className="space-y-2">
                  <li><span className="cursor-default">Privacy Policy</span></li>
                  <li><span className="cursor-default">Terms of Service</span></li>
                  <li><span className="cursor-default">POPIA Compliance</span></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs">
            <p>© {new Date().getFullYear()} ShopFlowz. All rights reserved.</p>
            <p>Built for South African businesses.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
