import React, { useEffect, useRef, useState } from 'react';
import { X, AlertCircle, Trash2, Camera, CheckCircle2, Volume2, VolumeX, Zap } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { playSuccessBeep, playErrorBuzz, playWarningBeep } from '../../../utils/scannerFeedback';

export interface ScanResult {
  code: string;
  success: boolean;
  message?: string;
  time: string;
}

export interface ScannerModalProps {
  initial?: string[];
  title?: string;
  targetQuantity?: number;
  onDone?: (codes: string[]) => void;
  onClose: () => void;
  /** Callback xác thực realtime từng mã khi camera nhận diện */
  onScanItem?: (code: string) => Promise<{ success: boolean; message?: string } | void>;
}

export function ScannerModal({
  initial = [],
  title = 'Quét mã Serial / Barcode',
  targetQuantity,
  onDone,
  onClose,
  onScanItem,
}: ScannerModalProps) {
  const [codes, setCodes] = useState<string[]>(initial);
  const codesRef = useRef<string[]>(initial);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [error, setError] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundEnabledRef = useRef(true);
  soundEnabledRef.current = soundEnabled;

  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);

  // Trạng thái phản hồi tức thì trên camera
  const [flashFeedback, setFlashFeedback] = useState<{
    type: 'success' | 'error' | 'warning' | null;
    code: string;
    message?: string;
  }>({ type: null, code: '' });

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const lastScannedCodeRef = useRef('');
  const lastScanTimeRef = useRef(0);

  // Khởi động Camera
  useEffect(() => {
    let cancelled = false;
    const scannerId = 'tl-serial-scanner-viewport';
    const scanner = new Html5Qrcode(scannerId);
    scannerRef.current = scanner;

    (async () => {
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cancelled) return;
        if (!cameras || cameras.length === 0) {
          setError('Không tìm thấy camera trên thiết bị hoặc quyền bị từ chối (yêu cầu HTTPS).');
          return;
        }

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 15,
            qrbox: { width: 260, height: 160 },
            aspectRatio: 1.25,
          },
          async (decodedText) => {
            const code = String(decodedText || '').trim();
            if (!code || processingRef.current) return;

            // Debounce: bỏ qua nếu vừa quét đúng mã này trong vòng 1.5 giây
            const now = Date.now();
            if (code === lastScannedCodeRef.current && now - lastScanTimeRef.current < 1500) {
              return;
            }
            lastScannedCodeRef.current = code;
            lastScanTimeRef.current = now;

            // Đang bận xử lý
            processingRef.current = true;
            const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            // 1. CHẾ ĐỘ XÁC THỰC REAL-TIME (Nếu có callback onScanItem)
            if (onScanItem) {
              try {
                const res = await onScanItem(code);
                const isFail = res && typeof res === 'object' && res.success === false;

                if (isFail) {
                  // Thất bại
                  if (soundEnabledRef.current) playErrorBuzz();
                  const errMsg = res?.message || 'Không thể chấp nhận mã này';
                  setFlashFeedback({ type: 'error', code, message: errMsg });
                  setHistory((prev) => [{ code, success: false, message: errMsg, time: timeStr }, ...prev.slice(0, 19)]);
                } else {
                  // Thành công
                  if (soundEnabledRef.current) playSuccessBeep();
                  setFlashFeedback({ type: 'success', code, message: 'Hợp lệ ✓' });
                  if (!codesRef.current.includes(code)) {
                    codesRef.current = [...codesRef.current, code];
                    setCodes(codesRef.current);
                  }
                  setHistory((prev) => [{ code, success: true, message: 'Hợp lệ', time: timeStr }, ...prev.slice(0, 19)]);
                }
              } catch (err: any) {
                if (soundEnabledRef.current) playErrorBuzz();
                const errMsg = err?.message || 'Lỗi khi gửi lên server';
                setFlashFeedback({ type: 'error', code, message: errMsg });
                setHistory((prev) => [{ code, success: false, message: errMsg, time: timeStr }, ...prev.slice(0, 19)]);
              } finally {
                processingRef.current = false;
              }
              return;
            }

            // 2. CHẾ ĐỘ BATCH TIÊU CHUẨN (Không có onScanItem)
            if (codesRef.current.includes(code)) {
              if (soundEnabledRef.current) playWarningBeep();
              setFlashFeedback({ type: 'warning', code, message: 'Mã đã quét trước đó' });
              processingRef.current = false;
              return;
            }

            if (soundEnabledRef.current) playSuccessBeep();
            codesRef.current = [...codesRef.current, code];
            setCodes(codesRef.current);
            setFlashFeedback({ type: 'success', code, message: 'Đã thêm' });
            setHistory((prev) => [{ code, success: true, message: 'Đã thêm', time: timeStr }, ...prev.slice(0, 19)]);
            processingRef.current = false;
          },
          () => { /* Bỏ qua frame không đọc được */ }
        );

        // Kiểm tra hỗ trợ đèn pin (Torch)
        try {
          const track = (scanner as any).getRunningTrackCameraCapabilities?.();
          if (track?.torch) setHasTorch(true);
        } catch { /* noop */ }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Không thể mở camera. Vui lòng cấp quyền camera trong trình duyệt.');
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      (async () => {
        try { await s?.stop(); } catch { /* noop */ }
        try { await s?.clear(); } catch { /* noop */ }
      })();
    };
  }, [onScanItem]);

  // Xóa flash feedback sau 1.2s
  useEffect(() => {
    if (!flashFeedback.type) return;
    const t = setTimeout(() => {
      setFlashFeedback({ type: null, code: '' });
    }, 1400);
    return () => clearTimeout(t);
  }, [flashFeedback]);

  // Thoát bằng phím Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Bật/tắt đèn pin
  const toggleTorch = async () => {
    const s = scannerRef.current;
    if (!s) return;
    try {
      await (s as any).applyVideoConstraints({
        advanced: [{ torch: !torchOn }],
      });
      setTorchOn(!torchOn);
    } catch { /* noop */ }
  };

  const removeAt = (index: number) => {
    const next = codes.filter((_, i) => i !== index);
    codesRef.current = next;
    setCodes(next);
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-150"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[94vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Camera size={18} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm leading-tight">{title}</h3>
              <p className="text-[11px] text-gray-500">
                {onScanItem ? 'Xác thực Real-time với máy chủ' : 'Chế độ quét liên tục'}
                {targetQuantity ? ` • Mục tiêu: ${codes.length}/${targetQuantity}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {hasTorch && (
              <button
                type="button"
                onClick={toggleTorch}
                className={`p-2 rounded-xl transition-colors ${torchOn ? 'bg-amber-100 text-amber-700' : 'text-gray-400 hover:bg-gray-100'}`}
                title="Bật/Tắt đèn pin"
              >
                <Zap size={16} />
              </button>
            )}

            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-xl transition-colors ${soundEnabled ? 'text-emerald-600 hover:bg-emerald-50' : 'text-gray-400 hover:bg-gray-100'}`}
              title={soundEnabled ? 'Đang bật âm thanh & rung' : 'Đã tắt âm thanh'}
            >
              {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors ml-1"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Camera Viewport & Phản hồi trực quan */}
        <div className="p-4 space-y-3 overflow-y-auto">
          {error ? (
            <div className="flex items-center gap-2 p-3.5 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="relative rounded-2xl overflow-hidden bg-black ring-2 ring-black/5 min-h-[220px]">
              <div id="tl-serial-scanner-viewport" className="w-full" />

              {/* Viền Flash phản hồi thời gian thực */}
              {flashFeedback.type && (
                <div
                  className={`absolute inset-0 pointer-events-none transition-all duration-200 flex flex-col justify-end p-3 ${
                    flashFeedback.type === 'success'
                      ? 'border-4 border-emerald-500 bg-emerald-500/15'
                      : flashFeedback.type === 'error'
                      ? 'border-4 border-red-500 bg-red-500/25'
                      : 'border-4 border-amber-500 bg-amber-500/20'
                  }`}
                >
                  <div
                    className={`rounded-xl px-3 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-md flex items-center justify-between animate-in slide-in-from-bottom-2 ${
                      flashFeedback.type === 'success'
                        ? 'bg-emerald-600/90'
                        : flashFeedback.type === 'error'
                        ? 'bg-red-600/90'
                        : 'bg-amber-600/90'
                    }`}
                  >
                    <span className="font-mono truncate max-w-[200px]">{flashFeedback.code}</span>
                    <span>{flashFeedback.message}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Thanh trạng thái đếm */}
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-gray-500">
              Đã nhận: <b className="text-emerald-700 font-mono text-sm">{codes.length}</b>
              {targetQuantity ? ` / ${targetQuantity} thiết bị` : ' mã'}
            </span>
            {targetQuantity && codes.length >= targetQuantity && (
              <span className="text-emerald-600 font-bold flex items-center gap-1">
                <CheckCircle2 size={13} /> Đã đủ số lượng
              </span>
            )}
          </div>

          {/* Lịch sử quét Real-time */}
          {history.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-1">
                Lịch sử quét vừa xong ({history.length})
              </p>
              <div className="max-h-36 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-2xl bg-gray-50/50">
                {history.map((h, i) => (
                  <div
                    key={`${h.code}-${i}`}
                    className={`flex items-center justify-between px-3 py-1.5 text-xs font-mono transition-colors ${
                      h.success ? 'text-gray-800' : 'bg-red-50/70 text-red-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {h.success ? (
                        <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                      ) : (
                        <AlertCircle size={13} className="text-red-500 shrink-0" />
                      )}
                      <span className="font-semibold truncate">{h.code}</span>
                      {h.message && h.message !== 'Hợp lệ' && (
                        <span className="text-[11px] text-gray-500 truncate">({h.message})</span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0 ml-2">{h.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Danh sách mã hợp lệ đã gom (nếu không dùng realtime) */}
          {!onScanItem && codes.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-1">
                Mã đã chọn ({codes.length})
              </p>
              <ul className="max-h-32 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-2xl">
                {codes.map((c, i) => (
                  <li key={`${c}-${i}`} className="flex items-center justify-between px-3 py-1.5 text-xs font-mono">
                    <span className="truncate">{c}</span>
                    <button
                      type="button"
                      onClick={() => removeAt(i)}
                      className="p-1 text-gray-300 hover:text-red-500 rounded"
                      title="Xóa mã này"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-gray-400 leading-relaxed px-1">
            💡 <b>Mẹo kho:</b> Đưa mã vạch hoặc QR vào khung ngắm. Hệ thống sẽ phát âm thanh và rung báo trạng thái ngay tức thì.
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200 rounded-xl transition-colors"
          >
            Đóng
          </button>

          <button
            type="button"
            onClick={() => {
              if (onDone) onDone(codes);
              onClose();
            }}
            className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-md hover:shadow-lg transition-all"
          >
            <CheckCircle2 size={14} />
            Hoàn tất ({codes.length})
          </button>
        </div>
      </div>
    </div>
  );
}
