import React, { useEffect, useState } from 'react';
import { X, AlertCircle, Camera, CheckCircle2, RefreshCw, ScanLine } from 'lucide-react';
import {
  getStockDocument, updateStockDocument, advanceDocument,
  type StockDocument, type StockDocDetailLine,
} from '../../../services/stockService';
import { parseSerialList, serialMatchState } from '../../../services/serialUtils';
import { SerialEditorModal } from './SerialEditorModal';

// Quét serial hàng loạt trước khi hoàn thành: liệt kê từng dòng thiếu,
// quét/nhập cho từng dòng, đủ hết mới bấm Hoàn tất được.
export function SerialBulkModal({ docId, kind, onClose, onCompleted }: {
  docId: string;
  kind: 'RECEIPT' | 'ISSUE';
  onClose: () => void;
  onCompleted: () => Promise<void>;
}) {
  const [doc, setDoc] = useState<(StockDocument & { lines?: StockDocDetailLine[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [completing, setCompleting] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      setDoc(await getStockDocument(docId));
    } catch (e: any) {
      setError(e.message || 'Không tải được phiếu.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [docId]);

  const lines = doc?.lines || [];
  const states = lines.map((l) => {
    const codes = parseSerialList((l as any).serialLot || '');
    return { line: l, codes, state: serialMatchState(codes, Number(l.quantity) || 0) };
  });
  const missing = states.filter((s) => s.state === 'empty').length;
  const mismatch = states.filter((s) => s.state === 'mismatch').length;
  const allGood = lines.length > 0 && missing === 0 && mismatch === 0;

  const toFormLines = () =>
    lines.map((l) => ({
      productId: l.productId,
      quantity: Number(l.quantity),
      unitPrice: Number((l as any).unitPrice) || 0,
      locationId: (l as any).locationId ?? null,
      note: (l as any).note ?? null,
      vatRate: Number((l as any).vatRate ?? 8),
      vatAmount: (l as any).vatAmount ?? undefined,
      totalAmount: (l as any).totalAmount ?? undefined,
      serialLot: (l as any).serialLot || undefined,
      accountDebit: (l as any).accountDebit || undefined,
      accountCredit: (l as any).accountCredit || undefined,
      projectId: (l as any).projectId || undefined,
      costItem: (l as any).costItem || undefined,
      costObjectId: (l as any).costObjectId || undefined,
    }));

  const saveLine = async (index: number, serialLot: string) => {
    if (!doc) return;
    const next = toFormLines();
    next[index] = { ...next[index], serialLot: serialLot || undefined };
    try {
      await updateStockDocument(doc.id, { lines: next });
      setEditing(null);
      await load();
    } catch (e: any) {
      setError(e.message || 'Lưu serial thất bại.');
    }
  };

  const complete = async () => {
    if (!doc) return;
    setCompleting(true); setError('');
    try {
      await advanceDocument(kind === 'RECEIPT' ? 'receipts' : 'issues', doc.id, 'complete');
      await onCompleted();
    } catch (e: any) {
      setError(e.message || 'Hoàn thành thất bại.');
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-900">Quét serial — {doc?.code || '...'}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {loading ? 'Đang tải...' : <>Còn <b className="text-amber-600">{missing} dòng thiếu</b>{mismatch > 0 && <>, <b className="text-red-600">{mismatch} dòng lệch số lượng</b></>}{missing === 0 && mismatch === 0 && lines.length > 0 && <span className="text-emerald-600 font-bold"> — đủ serial, bấm Hoàn tất được</span>}</>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-4 overflow-y-auto">
          {error && <div className="flex items-center gap-2 p-3 mb-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{error}</div>}
          {loading ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400 text-sm">Đang tải dòng hàng...</p>
            </div>
          ) : lines.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8 italic">Phiếu chưa có dòng hàng nào.</p>
          ) : (
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
              {states.map((s, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 text-sm truncate">{(s.line as any).productName || s.line.productId}</p>
                    <p className="text-xs text-gray-400 font-mono">
                      SL {Number(s.line.quantity)} ·
                      {s.state === 'empty' && <span className="text-amber-600 font-bold"> chưa nhập serial</span>}
                      {s.state === 'lot' && <span className="text-gray-500"> 1 mã lô</span>}
                      {s.state === 'match' && <span className="text-emerald-600 font-bold"> {s.codes.length}/{Number(s.line.quantity)} serial</span>}
                      {s.state === 'mismatch' && <span className="text-red-600 font-bold"> {s.codes.length}/{Number(s.line.quantity)} — lệch!</span>}
                    </p>
                  </div>
                  <button type="button" onClick={() => setEditing(i)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                      s.state === 'match' || s.state === 'lot'
                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-amber-500 hover:bg-amber-600 text-white'
                    }`}>
                    {s.state === 'match' || s.state === 'lot' ? <ScanLine size={13} /> : <Camera size={13} />}
                    {s.state === 'empty' ? 'Quét' : 'Sửa'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-xl">Đóng</button>
          <button type="button" onClick={complete} disabled={!allGood || completing || loading}
            className="flex items-center justify-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
            {completing ? <><RefreshCw size={14} className="animate-spin" />Đang hoàn tất...</> : <><CheckCircle2 size={14} /> Hoàn tất phiếu</>}
          </button>
        </div>
      </div>
      {editing !== null && lines[editing] && (
        <SerialEditorModal
          key={`bulk-${editing}`}
          initial={String((lines[editing] as any).serialLot || '')}
          quantity={Number(lines[editing].quantity) || 0}
          productId={lines[editing].productId}
          warehouseId={doc?.warehouseId || ''}
          mode={kind === 'ISSUE' ? 'issue' : 'receipt'}
          onSave={(v) => saveLine(editing, v)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
