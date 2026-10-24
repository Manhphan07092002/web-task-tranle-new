import React, { useEffect, useState } from 'react';
import { X, AlertCircle, ShieldCheck, PackageCheck, Truck, Building2, User, Calendar, ArrowRight } from 'lucide-react';
import { getSerialTimeline, type SerialTimeline } from '../../../services/stockService';

// Vòng đời Serial: SP → nhập (NCC/kho/ngày) → kho hiện tại → xuất (KH/dự án/ngày) → bảo hành + lịch sử moves.
export function SerialTimelineModal({ serialNumber, onClose }: { serialNumber: string; onClose: () => void }) {
  const [data, setData] = useState<SerialTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    getSerialTimeline(serialNumber)
      .then((d) => { if (active) setData(d); })
      .catch((e: any) => { if (active) setErr(e.message || 'Không tải được vòng đời'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [serialNumber]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const w = data?.warranty;
  const daysLeft = w?.daysLeft;
  const warrantyCls = daysLeft === null || daysLeft === undefined
    ? 'bg-gray-100 text-gray-500'
    : daysLeft < 0 ? 'bg-red-50 text-red-600'
    : daysLeft <= 90 ? 'bg-amber-50 text-amber-700'
    : 'bg-emerald-50 text-emerald-700';
  const warrantyText = !w || !w.end
    ? 'Chưa xác định'
    : `${w.end}${daysLeft !== null && daysLeft !== undefined ? (daysLeft < 0 ? ` (hết hạn ${-daysLeft} ngày)` : ` (còn ${daysLeft} ngày)`) : ''}`;

  const steps: { icon: React.ReactNode; title: string; lines: (string | null | undefined)[] }[] = data ? [
    {
      icon: <PackageCheck size={15} className="text-emerald-600" />,
      title: 'Nhập kho',
      lines: data.receipt ? [
        `${data.receipt.code || ''}`,
        data.receipt.date ? `Ngày: ${data.receipt.date}` : null,
        data.receipt.supplier ? `NCC: ${data.receipt.supplier}` : null,
        data.receipt.warehouseName ? `Kho nhập: ${data.receipt.warehouseName}` : null,
      ] : ['Chưa ghi nhận phiếu nhập (hàng legacy)'],
    },
    {
      icon: <Building2 size={15} className="text-blue-600" />,
      title: 'Kho hiện tại',
      lines: [data.serial.warehouseName || data.serial.warehouseId, `Tồn: ${data.serial.stockStatus === 'OUT' ? 'Đã xuất' : 'Trong kho'} · Tình trạng: ${data.serial.status}`],
    },
    {
      icon: <Truck size={15} className="text-indigo-600" />,
      title: 'Xuất kho',
      lines: data.issue ? [
        `${data.issue.code || ''}`,
        data.issue.date ? `Ngày: ${data.issue.date}` : null,
        data.issue.customerName ? `Khách: ${data.issue.customerName}` : null,
        data.issue.projectId ? `Dự án: ${data.issue.projectId}` : null,
      ] : ['Chưa xuất'],
    },
    {
      icon: <ShieldCheck size={15} className="text-violet-600" />,
      title: 'Bảo hành',
      lines: [
        `Bắt đầu: ${w?.start || '—'} (${w?.startType || ''})`,
        `Hạn: ${w?.months || 0} tháng → ${warrantyText}`,
      ],
    },
  ] : [];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 font-mono text-sm truncate">{serialNumber}</h3>
            <p className="text-xs text-gray-500 truncate">{data?.serial.productName || ''}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0"><X size={20} /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          {loading && (
            <div className="flex flex-col items-center py-10 gap-3">
              <div className="w-8 h-8 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400 text-sm">Đang tải vòng đời...</p>
            </div>
          )}
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
          {!loading && !err && data && (
            <>
              <ol className="relative border-l-2 border-gray-100 ml-2 space-y-4">
                {steps.map((s, i) => (
                  <li key={i} className="ml-4">
                    <span className="absolute -left-[9px] mt-0.5 w-4 h-4 rounded-full bg-white border border-gray-200 flex items-center justify-center">{s.icon}</span>
                    <p className="font-bold text-gray-800 text-sm">{s.title}</p>
                    {s.lines.filter(Boolean).map((l, j) => (
                      <p key={j} className="text-xs text-gray-500 mt-0.5">{l}</p>
                    ))}
                  </li>
                ))}
              </ol>
              <div className={`p-3 rounded-xl text-sm font-bold flex items-center gap-2 ${warrantyCls}`}>
                <Calendar size={15} /> Bảo hành đến {warrantyText}
              </div>
              {data.moves.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    Lịch sử di chuyển <ArrowRight size={12} />
                  </p>
                  <ul className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
                    {data.moves.map((m) => (
                      <li key={m.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <span className="text-gray-600">{m.moveType}{m.warehouseName ? ` · ${m.warehouseName}` : ''}</span>
                        <span className="text-gray-400">{m.createdAt ? new Date(m.createdAt).toLocaleString('vi-VN') : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.serial.customerName || data.serial.projectId ? (
                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                  <User size={13} /> {data.serial.customerName || ''}{data.serial.customerName && data.serial.projectId ? ' · ' : ''}{data.serial.projectId || ''}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
