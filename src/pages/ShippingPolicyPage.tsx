import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Truck, MapPin, Clock } from "lucide-react";
import { loadEcommerceSettings } from "@/lib/ecommerceSettingsService";
import { EcommerceSettings, DEFAULT_ECOMMERCE_SETTINGS } from "@/types/ecommerce";

const WORKSPACE_ID = "uQBVeKWfrv9eG7SWspVt";

function renderParagraphs(text: string) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((para, i) => (
      <p key={i} className="text-gray-700 leading-relaxed whitespace-pre-line">{para.trim()}</p>
    ));
}

export default function ShippingPolicyPage() {
  const [settings, setSettings] = useState<EcommerceSettings>(DEFAULT_ECOMMERCE_SETTINGS);

  useEffect(() => {
    document.title = "Shipping Policy";
    loadEcommerceSettings(WORKSPACE_ID).then(setSettings).catch(() => {});
  }, []);

  const shippingText = settings.shippingPolicy?.trim() || DEFAULT_ECOMMERCE_SETTINGS.shippingPolicy || "";
  const hours = settings.businessHours || DEFAULT_ECOMMERCE_SETTINGS.businessHours || "";
  const address = settings.storeAddress || "";
  const phone = settings.storePhone || settings.storeWhatsApp || "";
  const waPhone = (settings.storeWhatsApp || phone).replace(/\D/g, "").replace(/^0/, "27");

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <nav className="text-sm text-gray-500 mb-6">
          <Link to="/" className="hover:text-blue-600">Home</Link>
          <span className="mx-2">/</span>
          <Link to="/store" className="hover:text-blue-600">Shop</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-800">Shipping Policy</span>
        </nav>

        <h1 className="text-3xl font-bold text-gray-900 mb-3 flex items-center gap-2">
          <Truck className="h-8 w-8 text-blue-600" />
          Shipping Policy
        </h1>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 mb-6 space-y-1 text-sm">
          <p className="flex items-center gap-2 text-gray-800"><MapPin className="h-4 w-4 text-emerald-600" /><strong>Address:</strong> {address}</p>
          <p className="flex items-center gap-2 text-gray-800"><Clock className="h-4 w-4 text-emerald-600" /><strong>Hours:</strong> {hours}</p>
          <p className="text-gray-800"><strong>Phone:</strong> {phone}</p>
        </div>

        <section className="space-y-4">
          {renderParagraphs(shippingText)}
        </section>

        <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-5">
          <p className="text-blue-900">
            Questions? WhatsApp us on{" "}
            <a href={`https://wa.me/${waPhone}`} className="font-semibold underline">
              {phone}
            </a>{" "}
            or see our{" "}
            <Link to="/returns-policy" className="font-semibold underline">Returns Policy</Link>.
          </p>
        </div>

        <div className="mt-10 text-sm text-gray-500">
          <Link to="/store" className="text-blue-600 hover:underline">← Back to shop</Link>
        </div>
      </div>
    </div>
  );
}
