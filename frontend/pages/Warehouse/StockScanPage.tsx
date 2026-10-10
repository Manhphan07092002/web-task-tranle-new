import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScanLine, Camera, CameraOff, Keyboard } from 'lucide-react';
import { Card } from '../../components/UI';
import { getSerialDetail, type SerialItem } from '../../services/stockMasterService';

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
    };
  }
}

export default function StockScanPage() {
  const supported = typeof window !== 'undefined' && !!window.BarcodeDetector;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastCodeRef = useRef<string>('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [result, setResult] = useState<SerialItem | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const stopCamera = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const lookup = useCallback(async (code: string) => {
    const value = code.trim();
    if (!value || value === lastCodeRef.current) return;
    lastCodeRef.current = value;
    try {
      setLookingUp(true);
      setNotFound(null);
      setResult(await getSerialDetail(value));
      stopCamera();
    } catch {
      setResult(null);
      setNotFound(value);
    } finally {
      setLookingUp(false);
      window.setTimeout(() => { lastCodeRef.current = ''; }, 3000);
    }
  }, [stopCamera]);

  const startCamera = async () => {
    if (!supported || !window.BarcodeDetector) return;
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      const detector = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] });
      timerRef.current = window.setInterval(async () => {
        try {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0 && codes[0].rawValue) {
            await lookup(codes[0].rawValue);
          }
        } catch { /* keep scanning */ }
      }, 600);
    } catch {
      setCameraError('Không mở được camera. Kiểm tra quyền trình duyệt (cần HTTPS hoặc localhost).');
    }
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) lookup(manualCode.trim());
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
          <ScanLine className="text-emerald-500" /> Quét mã
        </h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">
          Quét QR serial để mở nhanh hồ sơ. Không có camera thì nhập tay.
        </p>
      </div>

      <Card className="p-4 space-y-4">
        {supported ? (
          <>
            {!cameraOn ? (
              <button
                onClick={startCamera}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm inline-flex items-center justify-center gap-2"
              >
                <Camera size={16} /> Bật camera quét
              </button>
            ) : (
              <button
                onClick={stopCamera}
                className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm inline-flex items-center justify-center gap-2"
              >
                <CameraOff size={15} /> Tắt camera
              </button>
            )}
            {cameraError && <p className="text-xs font-bold text-rose-600">{cameraError}</p>}
            <div className={`rounded-xl overflow-hidden bg-black ${cameraOn ? '' : 'hidden'}`}>
              <video ref={videoRef} playsInline muted className="w-full max-h-[320px] object-cover" />
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-500">
            Trình duyệt không hỗ trợ quét camera — dùng nhập tay bên dưới.
          </p>
        )}

        <form onSubmit={submitManual} className="flex gap-2">
          <div className="relative flex-1">
            <Keyboard size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={manualCode} onChange={(e) => setManualCode(e.target.value)}
              placeholder="Nhập serial (VD: SN-...)"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 text-sm focus:ring-2 focus:ring-emerald-500 text-gray-800 dark:text-slate-100"
            />
          </div>
          <button type="submit" disabled={lookingUp}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold disabled:opacity-50">
            Tra cứu
          </button>
        </form>

        {lookingUp && <p className="text-sm text-gray-400 text-center">Đang tra cứu...</p>}
        {notFound && (
          <p className="text-sm text-center px-4 py-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl font-medium">
            Không tìm thấy serial '{notFound}'.
          </p>
        )}
        {result && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 dark:bg-emerald-900/10 p-4 text-sm space-y-1">
            <p className="font-bold font-mono text-base">{result.serialNo}</p>
            <p>{result.productName} ({result.productCode})</p>
            <p className="text-gray-500">
              Kho: {result.warehouseCode || '-'} • Vị trí: {result.locationCode || '-'} • Trạng thái: {result.status}
            </p>
            <Link
              to={`/warehouse/serials?search=${encodeURIComponent(result.serialNo)}`}
              className="inline-block mt-1 font-bold text-emerald-700 hover:underline"
            >
              Mở hồ sơ đầy đủ →
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
