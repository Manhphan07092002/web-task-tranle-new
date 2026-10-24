import { useEffect, useRef } from 'react';

interface UseBarcodeScannerOptions {
  onScan: (code: string) => void;
  enabled?: boolean;
  minChars?: number;
  maxIntervalMs?: number;
  preventDefault?: boolean;
}

/**
 * Hook lắng nghe sự kiện từ súng quét mã vạch chuyên dụng (USB / Bluetooth / PDA)
 * Cơ chế: Phát hiện chuỗi ký tự gõ cực nhanh (< 40ms/ký tự) kết thúc bằng phím Enter.
 * Cho phép thủ kho quét mã ở bất kỳ đâu trên màn hình mà không cần click chuột vào ô input.
 */
export function useBarcodeScanner({
  onScan,
  enabled = true,
  minChars = 3,
  maxIntervalMs = 45,
  preventDefault = true,
}: UseBarcodeScannerOptions) {
  const bufferRef = useRef<string[]>([]);
  const lastKeyTimeRef = useRef<number>(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Bỏ qua các phím điều khiển đặc biệt
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable);

      // Nếu đang gõ trong textarea hoặc input bình thường (không phải ô scan),
      // chỉ coi là máy quét nếu tốc độ gõ thực sự siêu nhanh
      const now = Date.now();
      const interval = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === 'Enter') {
        if (bufferRef.current.length >= minChars) {
          const barcode = bufferRef.current.join('').trim();
          bufferRef.current = [];
          if (barcode) {
            if (preventDefault) {
              e.preventDefault();
              e.stopPropagation();
            }
            onScanRef.current(barcode);
          }
        } else {
          bufferRef.current = [];
        }
        return;
      }

      // Chỉ nhận các ký tự nhìn thấy được (độ dài 1 ký tự)
      if (e.key.length === 1) {
        // Nếu khoảng cách giữa 2 phím quá lâu (> maxIntervalMs), đây là người gõ tay -> reset buffer
        if (interval > maxIntervalMs && bufferRef.current.length > 0) {
          bufferRef.current = [];
        }

        bufferRef.current.push(e.key);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      bufferRef.current = [];
    };
  }, [enabled, minChars, maxIntervalMs, preventDefault]);
}
