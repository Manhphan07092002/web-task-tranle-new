import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Boxes, Calendar, PackageCheck, X } from 'lucide-react';
import { getLotTimeline, type LotTimeline } from '../../../services/stockService';

const fmtDate = (value?: string | null) => value ? new Date(value).toLocaleString('vi-VN') : '—';

// Lô không có vòng đời bảo hành riêng như Serial. Modal tập trung vào số lượng và các lần biến động.
export function LotTimelineModal({ lotId, onClose }: { lotId: string; onClose: () => void }) {
  const [data, setData] = useState<LotTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setErr('');
    getLotTimeline(lotId)
      .then((value) => { if (active) setData(value); })
      .catch((e: any) => { if (active) setErr(e.message || 'Không tải được lịch sử Lô'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [lotId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lot = data?.lot;
  const unit = lot?.unit || '';
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 font-mono text-sm truncate">Lô {lot?.lotCode || '...'}</h3>
            <p className="text-xs text-gray-500 truncate">{lot?.productName || ''}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0"><X size={20} /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          {loading && <div className="flex flex-col items-center py-10 gap-3"><div className="w-8 h-8 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" /><p className="text-gray-400 text-sm">Đang tải lịch sử Lô...</p></div>}
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
          {!loading && !err && data && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-gray-500">Số lượng ban đầu</p><p className="font-bold text-gray-800">{lot!.initialQty.toLocaleString('vi-VN')} {unit}</p></div>
                <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[11px] text-emerald-700">Còn trong kho</p><p className="font-bold text-emerald-800">{lot!.remainingQty.toLocaleString('vi-VN')} {unit}</p></div>
              </div>
              <div className="rounded-xl border border-gray-100 p-3 text-xs space-y-1 text-gray-600">
                <p className="font-bold text-gray-800 flex items-center gap-1.5"><Boxes size={14} /> {lot!.warehouseName || lot!.warehouseId}</p>
                {lot!.supplier && <p>Nhà cung cấp: {lot!.supplier}</p>}
                {lot!.manufacturedAt && <p>Ngày sản xuất: {fmtDate(lot!.manufacturedAt)}</p>}
              </div>
              <div className="rounded-xl border border-gray-100 p-3 text-xs space-y-1 text-gray-600">
                <p className="font-bold text-gray-800 flex items-center gap-1.5"><PackageCheck size={14} className="text-emerald-600" /> Phiếu nhập</p>
                {data.receipt ? <><p>{data.receipt.code || '—'}</p><p>{fmtDate(data.receipt.date)}{data.receipt.warehouseName ? ` · ${data.receipt.warehouseName}` : ''}</p></> : <p>Chưa liên kết phiếu nhập (dữ liệu cũ).</p>}
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">Biến động Lô <ArrowRight size={12} /></p>
                {data.moves.length === 0 ? <p className="text-xs text-gray-400 border border-gray-100 rounded-xl p-3">Chưa có biến động Lô được ghi nhận.</p> : <ul className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">{data.moves.map((move) => <li key={move.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs"><div><p className="font-medium text-gray-700">{move.moveType} · {Number(move.quantity).toLocaleString('vi-VN')} {unit}</p><p className="text-gray-400">{move.warehouseName || ''}{move.referenceType ? ` · ${move.referenceType}` : ''}</p></div><span className="text-gray-400 shrink-0 flex items-center gap-1"><Calendar size={11} />{fmtDate(move.createdAt)}</span></li>)}</ul>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
