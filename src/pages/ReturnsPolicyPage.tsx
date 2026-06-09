import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw, Mail } from "lucide-react";
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

export default function ReturnsPolicyPage() {
  const [settings, setSettings] = useState<EcommerceSettings>(DEFAULT_ECOMMERCE_SETTINGS);

  useEffect(() => {
    document.title = "Returns Policy";
    loadEcommerceSettings(WORKSPACE_ID).then(setSettings).catch(() => {});
  }, []);

  const returnsText = settings.returnsPolicy?.trim() || DEFAULT_ECOMMERCE_SETTINGS.returnsPolicy || "";
  const phone = settings.storePhone || settings.storeWhatsApp || "";
  const email = settings.storeEmail || "";
  const waPhone = (settings.storeWhatsApp || phone).replace(/\D/g, "").replace(/^0/, "27");

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <nav className="text-sm text-gray-500 mb-6">
          <Link to="/" className="hover:text-blue-600">Home</Link>
          <span className="mx-2">/</span>
          <Link to="/store" className="hover:text-blue-600">Shop</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-800">Returns Policy</span>
        </nav>

        <h1 className="text-3xl font-bold text-gray-900 mb-6 flex items-center gap-2">
          <RotateCcw className="h-8 w-8 text-blue-600" />
          Returns Policy
        </h1>

        <section className="space-y-4">
          {renderParagraphs(returnsText)}
        </section>

        <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-5 space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-blue-900">
            <Mail className="h-5 w-5" />
            Need help?
          </h2>
          <p className="text-blue-800">
            WhatsApp us on{" "}
            <a href={`https://wa.me/${waPhone}`} className="font-semibold underline">{phone}</a> or
            email <a href={`mailto:${email}`} className="font-semibold underline">{email}</a>.
          </p>
          <p className="text-blue-800">
            See our <Link to="/shipping-policy" className="font-semibold underline">Shipping Policy</Link> for delivery details.
          </p>
        </div>

        <div className="mt-10 text-sm text-gray-500">
          <Link to="/store" className="text-blue-600 hover:underline">← Back to shop</Link>
        </div>
      </div>
    </div>
  );
}
