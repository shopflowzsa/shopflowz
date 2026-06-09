import { SUPABASE_URL } from "@/lib/supabase";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Smartphone, Download, QrCode, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export function MobileDownloadDialog() {
  const [open, setOpen] = useState(false);
  const [qrError, setQrError] = useState(false);
  const [qrService, setQrService] = useState(0); // 0 = qrserver.com, 1 = quickchart.io
  const apkUrl = `https://github.com/shopflowzsa/shopflowz/releases/download/v1.0/shopflowz.apk`;
  const appUrl = "https://shopflowz.web.app";
  
  // Multiple QR code services for fallback
  const qrServices = [
    `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(apkUrl)}`,
    `https://quickchart.io/qr?text=${encodeURIComponent(apkUrl)}&size=200`
  ];
  
  const qrCodeUrl = qrServices[qrService];

  const copyUrl = () => {
    navigator.clipboard.writeText(apkUrl);
    toast.success("APK URL copied to clipboard");
  };

  const handleQrError = () => {
    if (qrService < qrServices.length - 1) {
      setQrService(qrService + 1);
    } else {
      setQrError(true);
    }
  };

  const handleQrLoad = () => {
    setQrError(false);
  };

  const resetQr = () => {
    setQrError(false);
    setQrService(0);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Smartphone className="h-4 w-4" />
          Mobile App
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            SRClickUp Mobile
          </DialogTitle>
          <DialogDescription>
            Download the SRClickUp mobile app for Android devices. Scan the QR code or use the download button.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* QR Code */}
          <div className="text-center">
            <div className="inline-block p-4 bg-white rounded-lg border">
              {!qrError ? (
                <img 
                  src={qrCodeUrl}
                  alt="QR Code for SRClickUp APK"
                  className="w-48 h-48"
                  onError={handleQrError}
                  onLoad={handleQrLoad}
                />
              ) : (
                <div className="w-48 h-48 flex flex-col items-center justify-center bg-gray-100 rounded border-2 border-dashed border-gray-300">
                  <QrCode className="h-12 w-12 text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground text-center px-2">
                    QR Code unavailable
                  </p>
                  <Button 
                    variant="link" 
                    size="sm" 
                    className="text-xs mt-1"
                    onClick={resetQr}
                  >
                    Retry
                  </Button>
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              {qrError ? 'Use download button below' : 'Scan to download Android APK'}
            </p>
          </div>

          {/* Instructions */}
          <div className="space-y-3">
            <div className="flex items-start gap-3 text-sm">
              <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs font-bold">1</span>
              <div>
                <p className="font-medium">Scan QR Code</p>
                <p className="text-muted-foreground">Use your phone's camera to scan</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-sm">
              <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs font-bold">2</span>
              <div>
                <p className="font-medium">Download APK</p>
                <p className="text-muted-foreground">Tap the link to download the APK file</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-sm">
              <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs font-bold">3</span>
              <div>
                <p className="font-medium">Install App</p>
                <p className="text-muted-foreground">Open the APK and tap Install (allow unknown sources if needed)</p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button 
              variant="outline" 
              className="gap-2" 
              onClick={copyUrl}
            >
              <Copy className="h-4 w-4" />
              Copy URL
            </Button>
            <Button 
              variant="outline" 
              className="gap-2"
              onClick={() => window.open(apkUrl, '_blank')}
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
          </div>
          
          {/* Manual URL for fallback */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Manual Download:</p>
            <div className="bg-muted rounded-md p-2">
              <code className="text-xs break-all">{apkUrl}</code>
            </div>
          </div>

          {/* Features */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p>📱 SRClickUp Mobile (v-final)</p>
            <p>✅ Native camera &amp; photo upload</p>
            <p>✅ Mobile-responsive design</p>
            <p>🔄 Auto-updates with web deploys — no reinstall needed</p>
            <p>🔄 Real-time sync with desktop</p>
            <p>🔒 Secure Firebase authentication</p>
            <p>☁️ Firebase Storage for photos</p>
            <p>📱 Optimized mobile keyboard handling</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}