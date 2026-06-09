/**
 * Public Store Page — Main public-facing ecommerce site
 * Includes online store + repair services info + contact
 */

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { PublicStore } from "@/components/ecommerce/PublicStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Phone,
  Mail,
  MapPin,
  Clock,
  Wrench,
  Zap,
  Speaker,
  MessageCircle,
  CheckCircle,
  ChevronRight,
  Facebook,
  Instagram,
} from "lucide-react";
import { loadEcommerceSettings } from "@/lib/ecommerceSettingsService";
import { EcommerceSettings, DEFAULT_ECOMMERCE_SETTINGS } from "@/types/ecommerce";

// Inventory data workspace ID (where all products/customers/invoices are stored in Supabase)
const SRCOMPONENTS_WORKSPACE_ID = "uQBVeKWfrv9eG7SWspVt";

export function PublicStorePage() {
  const [storeSettings, setStoreSettings] = useState<EcommerceSettings>(DEFAULT_ECOMMERCE_SETTINGS);

  useEffect(() => {
    loadEcommerceSettings(SRCOMPONENTS_WORKSPACE_ID).then(setStoreSettings).catch(() => {});
  }, []);

  const phone = (storeSettings as any).storePhone || '';
  const whatsapp = (storeSettings as any).storeWhatsApp || '';
  const whatsappDisplay = phone;
  const email = storeSettings.storeEmail || '';
  const address = storeSettings.storeAddress || '';
  const phoneTel = phone.replace(/\s/g, '');

  return (
    <div className="min-h-screen bg-white font-sans">
      {/* ── STORE (main content) ── */}
      <PublicStore workspaceId={SRCOMPONENTS_WORKSPACE_ID} />

      {/* ── REPAIR SERVICES SECTION ── */}
      <section id="services" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <Badge className="mb-3 bg-orange-100 text-orange-700 border-orange-200">Repair Services</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Audio Repair Experts</h2>
            <p className="text-gray-500 max-w-xl mx-auto">
              DIY with parts from our store, or bring your equipment in and let us handle it for you.
              20+ years of audio repair expertise, based in Lotus River, Cape Town.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: <Speaker className="h-8 w-8 text-orange-500" />,
                title: "Speaker Repair",
                desc: "Full speaker restoration — re-coning, voice coil replacement, surround and spider repairs for all makes and sizes.",
                items: ["Re-coning & recapping", "Voice coil replacement", "Surround & spider repair", "Cabinet restoration"],
              },
              {
                icon: <Zap className="h-8 w-8 text-orange-500" />,
                title: "Amplifier Repair",
                desc: "Component-level amp diagnostics and repair for home audio, car audio, PA systems, and studio equipment.",
                items: ["Power amp repairs", "Pre-amp & mixer service", "Car audio amplifiers", "PA & stage amplifiers"],
              },
              {
                icon: <Wrench className="h-8 w-8 text-orange-500" />,
                title: "All Audio Equipment",
                desc: "Servicing and repair of all audio electronics — vintage hi-fi to modern studio and live sound gear.",
                items: ["Hi-fi & home cinema", "Subwoofer service", "Crossover repair", "Site inspections available"],
              },
            ].map((s, i) => (
              <div key={i} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="h-14 w-14 rounded-xl bg-orange-50 flex items-center justify-center mb-4">{s.icon}</div>
                <h3 className="text-xl font-bold mb-2">{s.title}</h3>
                <p className="text-gray-500 text-sm mb-4 leading-relaxed">{s.desc}</p>
                <ul className="space-y-1">
                  {s.items.map((item, j) => (
                    <li key={j} className="flex items-center gap-2 text-sm text-gray-700">
                      <ChevronRight className="h-3 w-3 text-orange-400 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <a href="#contact">
              <Button size="lg" className="bg-orange-500 hover:bg-orange-600 text-white gap-2">
                <Phone className="h-4 w-4" /> Book a Repair Assessment
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ── CONTACT ── */}
      <section id="contact" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Get In Touch</h2>
            <p className="text-gray-500 max-w-xl mx-auto">
              {address} · Mon–Fri 9AM–5PM
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            <a href={`tel:${phoneTel}`}
              className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-gray-200 hover:border-orange-300 hover:bg-orange-50 transition-all">
              <div className="h-12 w-12 rounded-xl bg-orange-100 flex items-center justify-center">
                <Phone className="h-6 w-6 text-orange-500" />
              </div>
              <p className="font-semibold text-gray-900">Call Us</p>
              <p className="text-sm text-orange-600 font-medium">{phone}</p>
            </a>
            <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer"
              className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-all">
              <div className="h-12 w-12 rounded-xl bg-green-100 flex items-center justify-center">
                <MessageCircle className="h-6 w-6 text-green-600" />
              </div>
              <p className="font-semibold text-gray-900">WhatsApp</p>
              <p className="text-sm text-green-600 font-medium">{whatsappDisplay}</p>
            </a>
            <a href={`mailto:${email}`}
              className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all">
              <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center">
                <Mail className="h-6 w-6 text-blue-600" />
              </div>
              <p className="font-semibold text-gray-900">Email Us</p>
              <p className="text-sm text-blue-600 font-medium">{email}</p>
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-gray-950 text-gray-400 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-orange-500 flex items-center justify-center">
                <Speaker className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-white">ShopFlowz</span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <a href="#services" className="hover:text-white transition-colors">Repair Services</a>
              <a href="#contact" className="hover:text-white transition-colors">Contact</a>
              <Link to="/about" className="hover:text-white transition-colors">About</Link>
              <Link to="/login" className="hover:text-white transition-colors">Admin</Link>
            </div>
            <div className="flex items-center gap-3">
              <a href="https://facebook.com/speakerrepairscpt" target="_blank" rel="noopener noreferrer"
                className="hover:text-white transition-colors">
                <Facebook className="h-5 w-5" />
              </a>
              <a href="https://instagram.com/speakerrepairssa" target="_blank" rel="noopener noreferrer"
                className="hover:text-white transition-colors">
                <Instagram className="h-5 w-5" />
              </a>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-6 pt-6 text-center text-xs text-gray-600">
            © {new Date().getFullYear()} ShopFlowz · {address}
          </div>
        </div>
      </footer>
    </div>
  );
}