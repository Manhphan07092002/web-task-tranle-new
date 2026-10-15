import React, { useEffect, useRef, useState } from 'react';
import { X, AlertCircle, Trash2, Camera } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

// Quét mã bằng camera (QR + barcode 1D/2D phổ biến). Mỗi mã lạ tự thêm 1 lần.
// Yêu cầu HTTPS hoặc localhost mới mở được camera.
export function ScannerModal({ initial, onDone, onClose }: {
  initial: string[];
  onDone: (codes: string[]) => void;
  onClose: () => void;
}) {
  const beep = () => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
      setTimeout(() => ctx.close().catch(() => {}), 250);
    } catch { /* thiết bị không có audio */ }
  };
  const [codes, setCodes] = useState<string[]>(initial);
  const codesRef = useRef(initial);
  const [error, setError] = useState('');
  const [lastScan, setLastScan] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    let cancelled = false;
    const scanner = new Html5Qrcode('tl-serial-scanner');
    scannerRef.current = scanner;
    (async () => {
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cancelled) return;
        if (!cameras || cameras.length === 0) {
          setError('Không tìm thấy camera. Kiểm tra quyền trình duyệt (cần HTTPS hoặc localhost).');
          return;
        }
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 260, height: 160 },
            aspectRatio: 1.2,
          },
          (decodedText) => {
            const code = String(decodedText || '').trim();
            if (!code || codesRef.current.includes(code)) return;
            codesRef.current = [...codesRef.current, code];
            setCodes(codesRef.current);
            setLastScan(code);
            beep();
          },
          () => { /* bỏ qua frame không đọc được */ }
        );
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Không mở được camera. Kiểm tra quyền trình duyệt (cần HTTPS hoặc localhost).');
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
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const removeAt = (i: number) => {
    const next = codes.filter((_, j) => j !== i);
    codesRef.current = next;
    setCodes(next);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><Camera size={16} /> Quét mã serial</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          {error ? (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              <AlertCircle size={14} />{error}
            </div>
          ) : (
            <div id="tl-serial-scanner" className="w-full rounded-xl overflow-hidden bg-black min-h-[220px]" />
          )}
          <div className="flex items-center justify-between text-sm">
            <p className="text-gray-500">Đã quét: <b className="text-emerald-700 font-mono">{codes.length}</b> mã</p>
            {lastScan && <p className="text-xs text-gray-400 font-mono truncate max-w-[200px]" title={lastScan}>Mới nhất: {lastScan}</p>}
          </div>
          {codes.length > 0 && (
            <ul className="max-h-36 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-xl">
              {codes.map((c, i) => (
                <li key={`${c}-${i}`} className="flex items-center justify-between px-3 py-1.5 text-sm font-mono">
                  <span className="truncate">{c}</span>
                  <button type="button" onClick={() => removeAt(i)} className="p-1 text-gray-300 hover:text-red-500" title="Xóa mã này">
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-400">Đưa mã vạch/QR vào khung hình — mã mới tự thêm, mã trùng bỏ qua. Không có camera thì đóng và nhập tay.</p>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-xl">Hủy</button>
          <button type="button" onClick={() => onDone(codes)} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm">
            Xong ({codes.length})
          </button>
        </div>
      </div>
    </div>
  );
}
