import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { XCircle, Phone, MessageCircle, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function OrderFailed() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(15);
  const orderId = searchParams.get('orderId');

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          navigate('/store');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="bg-red-100 rounded-full p-4">
            <XCircle className="h-16 w-16 text-red-600" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-800">Payment Failed</h1>
          <p className="text-gray-600">
            We couldn't process your payment. This could be due to:
          </p>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 text-left space-y-2">
          <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
            <li>Insufficient funds</li>
            <li>Incorrect card details</li>
            <li>Bank declined the transaction</li>
            <li>Connection issue</li>
          </ul>
        </div>

        {orderId && (
          <div className="text-sm text-gray-500">
            Order ID: <span className="font-mono font-semibold">{orderId}</span>
          </div>
        )}

        <div className="pt-4 space-y-3">
          <Button
            onClick={() => navigate('/store')}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white"
          >
            <RefreshCcw className="h-4 w-4 mr-2" />
            Try Again
          </Button>

          <div className="grid grid-cols-2 gap-3">
            <a
              href="https://wa.me/27615010457?text=I%20had%20trouble%20with%20my%20online%20payment"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" className="w-full text-green-600 border-green-300 hover:bg-green-50">
                <MessageCircle className="h-4 w-4 mr-2" />
                WhatsApp
              </Button>
            </a>
            <a href="tel:0748528191">
              <Button variant="outline" className="w-full">
                <Phone className="h-4 w-4 mr-2" />
                Call Us
              </Button>
            </a>
          </div>

          <p className="text-xs text-gray-400">
            Redirecting to store in {countdown} seconds...
          </p>
        </div>
      </div>
    </div>
  );
}
