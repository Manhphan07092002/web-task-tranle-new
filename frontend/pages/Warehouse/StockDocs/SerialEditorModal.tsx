import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertCircle, Camera, CheckSquare, Square } from 'lucide-react';
import { getStockSerials, type StockSerial } from '../../../services/stockService';
import { parseSerialList } from '../../../services/serialUtils';
import { ScannerModal } from './ScannerModal';

export { parseSerialList };

// Nhập serial/lot cho 1 dòng hàng: gõ tay (mỗi dòng 1 mã), quét camera,
// hoặc (phiếu xuất) tick chọn từ tồn bán được.
export function SerialEditorModal({ initial, quantity, productId, warehouseId, mode, onSave, onClose }: {
  initial: string;
  quantity: number;
  productId: string;
  warehouseId: string;
  mode: 'receipt' | 'issue';
  onSave: (serialLot: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial || '');
  const [scanning, setScanning] = useState(false);
  const [available, setAvailable] = useState<StockSerial[]>([]);
  const [loadingAvail, setLoadingAvail] = useState(false);

  useEffect(() => {
    if (mode !== 'issue' || !productId || !warehouseId) return;
    let active = true;
    setLoadingAvail(true);
    getStockSerials({ productId, warehouseId, status: 'SALEABLE', limit: 200 })
      .then((rows) => { if (active) setAvailable(rows.filter((r) => r.serialNumber)); })
      .catch(() => {})
      .finally(() => { if (active) setLoadingAvail(false); });
    return () => { active = false; };
  }, [mode, productId, warehouseId]);

  const codes = useMemo(() => parseSerialList(text), [text]);
  const isLot = codes.length === 1 && quantity > 1;
  const match = isLot || codes.length === quantity;

  const toggleAvailable = (sn: string) => {
    const set = new Set(codes);
    if (set.has(sn)) set.delete(sn);
    else set.add(sn);
    setText(Array.from(set).join('\n'));
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Serial / Lô — SL cần: <span className="font-mono">{quantity}</span></h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Đã nhập: <b className={`font-mono ${match ? 'text-emerald-700' : 'text-amber-600'}`}>{codes.length}/{quantity}</b>
              {isLot && <span className="text-xs text-gray-400"> (1 mã lô cho cả dòng)</span>}
            </p>
            <button type="button" onClick={() => setScanning(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold">
              <Camera size={14} /> Quét mã
            </button>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
            placeholder={'Mỗi dòng 1 serial, hoặc phân tách bằng dấu phẩy/chấm phẩy.\nVD:\nSN001\nSN002'}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none font-mono focus:border-emerald-500" />
          {!match && codes.length > 0 && (
            <div className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-xs">
              <AlertCircle size={14} /> Số serial ({codes.length}) chưa khớp số lượng ({quantity}) — lúc hoàn thành sẽ báo thiếu.
            </div>
          )}
          {mode === 'issue' && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                {loadingAvail ? 'Đang tải tồn serial...' : `Chọn từ tồn bán được (${available.length})`}
              </p>
              {available.length === 0 && !loadingAvail ? (
                <p className="text-xs text-gray-400 italic">Không có serial bán được cho hàng này trong kho — gõ tay hoặc quét.</p>
              ) : (
                <ul className="max-h-40 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-xl">
                  {available.map((r) => {
                    const on = codes.includes(r.serialNumber!);
                    return (
                      <li key={r.id}>
                        <button type="button" onClick={() => toggleAvailable(r.serialNumber!)}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm font-mono text-left ${on ? 'bg-emerald-50 text-emerald-900' : 'hover:bg-gray-50'}`}>
                          {on ? <CheckSquare size={14} className="text-emerald-600 shrink-0" /> : <Square size={14} className="text-gray-300 shrink-0" />}
                          <span className="truncate">{r.serialNumber}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-xl">Hủy</button>
          <button type="button" onClick={() => onSave(parseSerialList(text).join('\n'))}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm">
            Lưu ({codes.length})
          </button>
        </div>
      </div>
      {scanning && (
        <ScannerModal
          initial={codes}
          title="Quét Serial / Lô"
          targetQuantity={quantity}
          onClose={() => setScanning(false)}
          onDone={(scanned) => { setScanning(false); setText(scanned.join('\n')); }}
        />
      )}
    </div>
  );
}
