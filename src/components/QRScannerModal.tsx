import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, RefreshCw } from 'lucide-react';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (scannedText: string) => void;
  title?: string;
}

export default function QRScannerModal({
  isOpen,
  onClose,
  onScanSuccess,
  title = 'Scan Pre-printed QR / Tracking Code'
}: QRScannerModalProps) {
  const scannerContainerId = 'qr-reader-container';
  const html5QrcodeRef = useRef<Html5Qrcode | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [manualCode, setManualCode] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setErrorMsg('');

    const startScanner = async () => {
      try {
        // Small timeout to allow DOM container to render
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (!isMounted) return;

        const html5Qrcode = new Html5Qrcode(scannerContainerId);
        html5QrcodeRef.current = html5Qrcode;

        await html5Qrcode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 }
          },
          (decodedText) => {
            // Extracted code (if full URL, extract last path segment)
            let cleanText = decodedText.trim();
            if (cleanText.includes('/view-job/')) {
              cleanText = cleanText.split('/view-job/')[1].split('/')[0].split('?')[0];
            } else if (cleanText.includes('http://') || cleanText.includes('https://')) {
              const parts = cleanText.split('/');
              cleanText = parts[parts.length - 1] || cleanText;
            }

            if (isMounted) {
              onScanSuccess(cleanText);
              stopScanner();
              onClose();
            }
          },
          () => {
            // Ignore scan failure frame callback
          }
        );

        if (isMounted) {
          setIsScanning(true);
        }
      } catch (err: any) {
        console.error('Failed to start camera scanner', err);
        if (isMounted) {
          setErrorMsg('Camera access failed or permission denied. You can type the QR code manually below.');
        }
      }
    };

    startScanner();

    return () => {
      isMounted = false;
      stopScanner();
    };
  }, [isOpen]);

  const stopScanner = async () => {
    if (html5QrcodeRef.current) {
      try {
        if (html5QrcodeRef.current.isScanning) {
          await html5QrcodeRef.current.stop();
        }
        html5QrcodeRef.current.clear();
      } catch (err) {
        console.error('Error stopping scanner', err);
      } finally {
        html5QrcodeRef.current = null;
        setIsScanning(false);
      }
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    let cleanText = manualCode.trim();
    if (cleanText.includes('/view-job/')) {
      cleanText = cleanText.split('/view-job/')[1].split('/')[0].split('?')[0];
    }
    onScanSuccess(cleanText);
    stopScanner();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 bg-white border-b border-slate-200 text-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900">{title}</h3>
          </div>
          <button
            onClick={() => {
              stopScanner();
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Camera Viewport */}
        <div className="p-4 bg-slate-950 flex flex-col items-center justify-center min-h-[280px] relative">
          <div id={scannerContainerId} className="w-full max-w-[280px] rounded-xl overflow-hidden border-2 border-blue-500/50"></div>

          {!isScanning && !errorMsg && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-white gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
              <span className="text-xs text-slate-300">Initializing Camera...</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs rounded-xl text-center my-2">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Manual Fallback Entry */}
        <div className="p-4 bg-slate-50 border-t border-slate-200">
          <form onSubmit={handleManualSubmit} className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700">Or Type Code Manually:</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="e.g. TAG-1004 or JS-2026..."
                className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm font-mono"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700"
              >
                Apply
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
