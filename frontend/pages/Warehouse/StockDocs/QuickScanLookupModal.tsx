import React, { useState, useEffect } from 'react';
import {
  X, Search, Camera, AlertCircle, CheckCircle2, ShieldCheck,
  Building2, Calendar, User, Truck, Box, ArrowRight, Clock, ExternalLink
} from 'lucide-react';
import { getSerialTimeline, type SerialTimeline } from '../../../services/stockService';
import { ScannerModal } from './ScannerModal';
import { useBarcodeScanner } from '../../../hooks/useBarcodeScanner';
import { playSuccessBeep, playErrorBuzz } from '../../../utils/scannerFeedback';

export function QuickScanLookupModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<SerialTimeline | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  // Tra cứu theo mã serial
  const handleLookup = async (codeToLookup: string) => {
    const code = codeToLookup.trim();
    if (!code) return;
    setLoading(true);
    setError(null);
    setTimeline(null);

    try {
      const data = await getSerialTimeline(code);
      setTimeline(data);
      playSuccessBeep();
    } catch (err: any) {
      playErrorBuzz();
      setError(err?.message || `Không tìm thấy hồ sơ cho Serial "${code}"`);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleLookup(query);
  };

  // Lắng nghe súng quét barcode khi modal đang mở
  useBarcodeScanner({
    enabled: !showCamera,
    onScan: (scannedCode) => {
      setQuery(scannedCode);
      handleLookup(scannedCode);
    },
  });

  // Phím Esc để đóng
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showCamera) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, showCamera]);

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-150"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
              <Search size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-tight">
                Tra cứu nhanh Serial & Hồ sơ thiết bị
              </h2>
              <p className="text-xs text-gray-500">
                Bắn mã bằng súng quét, quét camera hoặc nhập mã Serial để tra cứu
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Input Bar */}
        <div className="p-5 border-b border-gray-100 bg-white">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nhập hoặc quét số Serial thiết bị (VD: SG110CX-001, CANADIAN...)"
                className="w-full pl-4 pr-10 py-3 bg-gray-50 hover:bg-white focus:bg-white border border-gray-200 focus:border-blue-500 rounded-2xl text-sm font-mono outline-none transition-all focus:ring-4 focus:ring-blue-500/10"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setTimeline(null); setError(null); }}
                  className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowCamera(true)}
              className="flex items-center gap-1.5 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl text-xs font-bold transition-colors shrink-0"
              title="Quét bằng camera"
            >
              <Camera size={16} />
              <span className="hidden sm:inline">Camera</span>
            </button>

            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="flex items-center gap-1.5 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-2xl text-xs font-bold transition-all shadow-md hover:shadow-lg shrink-0"
            >
              {loading ? <Clock className="animate-spin" size={16} /> : <Search size={16} />}
              <span>Tra cứu</span>
            </button>
          </form>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <div>
                <b className="block text-sm font-semibold mb-0.5">Không tìm thấy thiết bị</b>
                <span>{error}</span>
              </div>
            </div>
          )}

          {timeline && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Card Thông tin chính */}
              <div className="p-5 rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 shadow-xs space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                      {timeline.serial.tracking || 'SERIAL'} • SKU: {timeline.serial.productId}
                    </span>
                    <h3 className="text-lg font-bold text-gray-900 mt-0.5">
                      {timeline.serial.productName || timeline.serial.productId}
                    </h3>
                    <p className="text-sm font-mono font-bold text-blue-700 mt-1 flex items-center gap-1.5">
                      <Box size={15} />
                      SN: {timeline.serial.serialNumber}
                    </p>
                  </div>

                  <div>
                    {timeline.serial.stockStatus === 'IN_STOCK' && (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        <CheckCircle2 size={13} /> Trong kho (Sẵn sàng)
                      </span>
                    )}
                    {timeline.serial.stockStatus === 'RESERVED' && (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                        <Clock size={13} /> Đang giữ (Reserved)
                      </span>
                    )}
                    {timeline.serial.stockStatus === 'OUT' && (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
                        <Truck size={13} /> Đã xuất kho
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-gray-100 text-xs">
                  <div>
                    <span className="text-gray-400 block mb-0.5">Kho hiện tại</span>
                    <b className="text-gray-800 flex items-center gap-1">
                      <Building2 size={13} className="text-gray-400" />
                      {timeline.serial.warehouseName || '—'}
                    </b>
                  </div>
                  <div>
                    <span className="text-gray-400 block mb-0.5">Ngày nhập kho</span>
                    <b className="text-gray-800 flex items-center gap-1">
                      <Calendar size={13} className="text-gray-400" />
                      {timeline.serial.receivedAt ? new Date(timeline.serial.receivedAt).toLocaleDateString('vi-VN') : '—'}
                    </b>
                  </div>
                  <div>
                    <span className="text-gray-400 block mb-0.5">Nhà cung cấp</span>
                    <b className="text-gray-800 truncate block">
                      {timeline.serial.supplier || '—'}
                    </b>
                  </div>
                </div>
              </div>

              {/* Thông tin Bảo hành */}
              <div className="p-4 rounded-2xl border border-emerald-100 bg-emerald-50/40 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-emerald-900">
                    <ShieldCheck size={16} className="text-emerald-600" />
                    <span>Hồ sơ bảo hành thiết bị</span>
                  </div>
                  {timeline.warranty.daysLeft !== null && (
                    <span className={`font-bold px-2.5 py-0.5 rounded-full text-[11px] ${
                      timeline.warranty.daysLeft > 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {timeline.warranty.daysLeft > 0 ? `Còn ${timeline.warranty.daysLeft} ngày` : 'Đã hết hạn'}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                  <div>
                    <span className="text-gray-500">Thời hạn:</span>{' '}
                    <b>{timeline.warranty.months ? `${timeline.warranty.months} tháng` : 'Chưa thiết lập'}</b>
                  </div>
                  <div>
                    <span className="text-gray-500">Kích hoạt từ:</span>{' '}
                    <b>{timeline.warranty.start ? new Date(timeline.warranty.start).toLocaleDateString('vi-VN') : '—'}</b>
                  </div>
                  <div>
                    <span className="text-gray-500">Hết hạn:</span>{' '}
                    <b>{timeline.warranty.end ? new Date(timeline.warranty.end).toLocaleDateString('vi-VN') : '—'}</b>
                  </div>
                </div>
              </div>

              {/* Chứng từ Nhập & Xuất */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {/* Nguồn nhập */}
                <div className="p-3.5 rounded-2xl border border-gray-200 bg-white space-y-1.5">
                  <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">
                    Nguồn nhập kho
                  </span>
                  {timeline.receipt ? (
                    <>
                      <p className="font-bold text-gray-900">Phiếu: {timeline.receipt.code || '—'}</p>
                      <p className="text-gray-500">NCC: {timeline.receipt.supplier || '—'}</p>
                      <p className="text-gray-400 text-[11px]">
                        Ngày: {timeline.receipt.date ? new Date(timeline.receipt.date).toLocaleDateString('vi-VN') : '—'}
                      </p>
                    </>
                  ) : (
                    <p className="text-gray-400 italic">Chưa liên kết phiếu nhập</p>
                  )}
                </div>

                {/* Nguồn xuất */}
                <div className="p-3.5 rounded-2xl border border-gray-200 bg-white space-y-1.5">
                  <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wider block">
                    Thông tin xuất kho / Dự án
                  </span>
                  {timeline.issue ? (
                    <>
                      <p className="font-bold text-gray-900">Phiếu: {timeline.issue.code || '—'}</p>
                      <p className="text-gray-500">Khách hàng: {timeline.issue.customerName || '—'}</p>
                      <p className="text-gray-500">Dự án: {timeline.issue.projectId || '—'}</p>
                      <p className="text-gray-400 text-[11px]">
                        Ngày xuất: {timeline.issue.date ? new Date(timeline.issue.date).toLocaleDateString('vi-VN') : '—'}
                      </p>
                    </>
                  ) : (
                    <p className="text-gray-400 italic">Chưa xuất kho (Vẫn nằm trong kho)</p>
                  )}
                </div>
              </div>

              {/* Lịch sử di chuyển kho (Stock Moves) */}
              {timeline.moves.length > 0 && (
                <div className="space-y-2 pt-2">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                    Nhật ký luân chuyển ({timeline.moves.length})
                  </span>
                  <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-2xl bg-gray-50/50">
                    {timeline.moves.map((m) => (
                      <div key={m.id} className="p-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                            m.moveType === 'IN' ? 'bg-emerald-100 text-emerald-800' :
                            m.moveType === 'OUT' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {m.moveType}
                          </span>
                          <span className="font-semibold text-gray-800">{m.referenceType || 'Giao dịch'}</span>
                          <span className="text-gray-500 font-mono text-[11px]">{m.warehouseName || ''}</span>
                        </div>
                        <span className="text-[11px] text-gray-400">
                          {new Date(m.createdAt).toLocaleDateString('vi-VN')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!timeline && !error && !loading && (
            <div className="py-12 text-center text-gray-400 space-y-2">
              <Box size={36} className="mx-auto opacity-30" />
              <p className="text-sm font-medium">Sẵn sàng tra cứu</p>
              <p className="text-xs text-gray-400 max-w-sm mx-auto">
                Bắn mã vạch bằng máy quét cầm tay hoặc bấm nút Camera để quét trực tiếp mã dán trên thiết bị
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-3.5 border-t border-gray-100 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-bold text-xs transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>

      {showCamera && (
        <ScannerModal
          title="Quét mã Serial để tra cứu"
          onClose={() => setShowCamera(false)}
          onDone={(codes) => {
            setShowCamera(false);
            if (codes.length > 0) {
              const code = codes[codes.length - 1];
              setQuery(code);
              handleLookup(code);
            }
          }}
        />
      )}
    </div>
  );
}
