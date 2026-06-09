import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, Package, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, supabaseServiceRole } from '@/lib/supabase';

declare global {
  interface Window {
    gapi?: any;
    renderOptIn?: () => void;
  }
}

const GCR_MERCHANT_ID = 5589844619;
const GCR_ESTIMATED_DELIVERY_DAYS = 7;

export default function OrderSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const orderId = searchParams.get('orderId');
  const workspaceId = searchParams.get('workspaceId');
  const optInRendered = useRef(false);

  // Clear the cart when landing on success page
  useEffect(() => {
    if (workspaceId) {
      try {
        Object.keys(localStorage)
          .filter((key) => key.startsWith(`cart_${workspaceId}_`))
          .forEach((key) => localStorage.removeItem(key));
      } catch (error) {
        console.error('Error clearing cart:', error);
      }
    }
  }, [workspaceId, user]);

  // Mark order as paid immediately when customer lands on success page.
  // This is the primary mechanism — the iKhokha webhook is a secondary backup.
  useEffect(() => {
    if (!orderId || !workspaceId) return;
    (async () => {
      try {
        const { data: row } = await supabaseServiceRole
          .from('orders')
          .select('data')
          .eq('id', orderId)
          .eq('workspace_id', workspaceId)
          .maybeSingle();
        if (!row?.data) return;
        const order: any = row.data;
        // Only update if not already marked paid
        if (order.paymentStatus !== 'paid') {
          const now = new Date().toISOString();
          await supabaseServiceRole
            .from('orders')
            .update({
              data: {
                ...order,
                paymentStatus: 'paid',
                status: order.status === 'pending' ? 'confirmed' : order.status,
                paidAt: now,
                updatedAt: now,
              },
              updated_at: now,
            })
            .eq('id', orderId);
        }
      } catch (err) {
        console.error('[OrderSuccess] Failed to mark order as paid:', err);
      }
    })();
  }, [orderId, workspaceId]);

  // Load the order, then render the Google Customer Reviews opt-in once
  useEffect(() => {
    if (optInRendered.current) return;
    if (!orderId || !workspaceId) return;

    let cancelled = false;

    (async () => {
      try {
        const { data: row } = await supabase
          .from('orders')
          .select('data')
          .eq('id', orderId)
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        const order: any = row?.data;
        const email = order?.customerInfo?.email;
        if (!email) return;

        const countryRaw =
          order?.shippingAddress?.country ||
          order?.shippingAddress?.countryCode ||
          'ZA';
        const country = String(countryRaw).slice(0, 2).toUpperCase();

        const eta = new Date();
        eta.setDate(eta.getDate() + GCR_ESTIMATED_DELIVERY_DAYS);
        const estimatedDeliveryDate = eta.toISOString().slice(0, 10);

        const products = Array.isArray(order?.items)
          ? order.items
              .map((it: any) => it?.sku || it?.barcode || it?.gtin)
              .filter(Boolean)
              .map((gtin: string) => ({ gtin: String(gtin) }))
          : [];

        if (cancelled) return;

        window.renderOptIn = () => {
          window.gapi?.load('surveyoptin', () => {
            window.gapi.surveyoptin.render({
              merchant_id: GCR_MERCHANT_ID,
              order_id: orderId,
              email,
              delivery_country: country,
              estimated_delivery_date: estimatedDeliveryDate,
              ...(products.length > 0 ? { products } : {}),
            });
          });
        };

        if (document.getElementById('gcr-platform-js')) {
          if (window.gapi) window.renderOptIn();
        } else {
          const s = document.createElement('script');
          s.id = 'gcr-platform-js';
          s.src = 'https://apis.google.com/js/platform.js?onload=renderOptIn';
          s.async = true;
          s.defer = true;
          document.head.appendChild(s);
        }
        optInRendered.current = true;
      } catch (err) {
        console.error('[GCR] failed to render opt-in:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, workspaceId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="bg-green-100 rounded-full p-4">
            <CheckCircle2 className="h-16 w-16 text-green-600" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-800">Payment Successful!</h1>
          <p className="text-gray-600">
            Thank you for your order. Your payment has been processed successfully.
          </p>
        </div>

        {orderId && (
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
              <Package className="h-4 w-4" />
              <span>Order ID:</span>
            </div>
            <p className="font-mono text-lg font-semibold text-gray-800">{orderId}</p>
          </div>
        )}

        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            You will receive an order confirmation email shortly.
          </p>
          <p className="text-sm text-gray-500">
            We'll contact you to arrange delivery or pickup.
          </p>
        </div>

        <div className="pt-4 space-y-3">
          <Button
            onClick={() => navigate('/store')}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white"
          >
            <ArrowRight className="h-4 w-4 mr-2" />
            Continue Shopping
          </Button>
        </div>
      </div>
    </div>
  );
}
