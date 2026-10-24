import React, { useState, useEffect } from 'react';
import {
  X, Search, Camera, AlertCircle, CheckCircle2, ShieldCheck,
  Building2, Calendar, User, Truck, Box, ArrowRight, Clock,
  ExternalLink, Copy, Check, ShieldAlert, ShieldX, MapPin
} from 'lucide-react';
import { getSerialTimeline, type SerialTimeline } from '../../../services/stockService';
import { ScannerModal } from './ScannerModal';
import { useBarcodeScanner } from '../../../hooks/useBarcodeScanner';
import { playSuccessBeep, playErrorBuzz } from '../../../utils/scannerFeedback';

function formatWarrantyRemaining(daysLeft: number | null): {
  badgeLabel: string;
  badgeClass: string;
  detailText: string;
  approxText: string;
  statusType: 'ACTIVE' | 'URGENT' | 'EXPIRED' | 'UNKNOWN';
} {
  if (daysLeft == null) {
    return {
      badgeLabel: 'Chưa có thông tin BH',
      badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
      detailText: 'Chưa kích hoạt hoặc chưa thiết lập thời hạn bảo hành cho thiết bị',
      approxText: 'Chưa xác định',
      statusType: 'UNKNOWN',
    };
  }

  if (daysLeft < 0) {
    const absDays = Math.abs(daysLeft);
    const y = Math.floor(absDays / 365);
    const m = Math.floor((absDays % 365) / 30);
    const d = (absDays % 365) % 30;
    const parts = [
      y > 0 ? `${y} năm` : '',
      m > 0 ? `${m} tháng` : '',
      d > 0 && y === 0 ? `${d} ngày` : '',
    ].filter(Boolean).join(' ');

    return {
      badgeLabel: 'Đã hết hạn bảo hành',
      badgeClass: 'bg-red-50 text-red-700 border-red-200',
      detailText: `Hết hạn cách đây ${absDays.toLocaleString('vi-VN')} ngày (${parts || `${absDays} ngày`})`,
      approxText: `Hết hạn ${parts || `${absDays} ngày`} trước`,
      statusType: 'EXPIRED',
    };
  }

  if (daysLeft === 0) {
    return {
      badgeLabel: 'Hết hạn hôm nay',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
      detailText: 'Hôm nay là ngày cuối cùng trong thời hạn bảo hành',
      approxText: 'Hết hạn trong hôm nay',
      statusType: 'URGENT',
    };
  }

  const y = Math.floor(daysLeft / 365);
  const m = Math.floor((daysLeft % 365) / 30);
  const d = (daysLeft % 365) % 30;
  const parts = [
    y > 0 ? `${y} năm` : '',
    m > 0 ? `${m} tháng` : '',
    d > 0 && y === 0 ? `${d} ngày` : '',
  ].filter(Boolean).join(' ');

  const isUrgent = daysLeft <= 30;

  return {
    badgeLabel: isUrgent ? `Sắp hết hạn (${daysLeft} ngày)` : `Còn bảo hành (${daysLeft.toLocaleString('vi-VN')} ngày)`,
    badgeClass: isUrgent
      ? 'bg-amber-50 text-amber-800 border-amber-300'
      : 'bg-emerald-50 text-emerald-800 border-emerald-300',
    detailText: `Thời hạn còn lại: khoảng ${parts || `${daysLeft} ngày`} (${daysLeft.toLocaleString('vi-VN')} ngày)`,
    approxText: `Còn khoảng ${parts || `${daysLeft} ngày`}`,
    statusType: isUrgent ? 'URGENT' : 'ACTIVE',
  };
}

function getWarrantyProgress(startStr?: string | null, endStr?: string | null): {
  percentUsed: number;
  percentRemaining: number;
} | null {
  if (!startStr || !endStr) return null;
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  const now = Date.now();

  if (isNaN(start) || isNaN(end) || end <= start) return null;

  if (now <= start) return { percentUsed: 0, percentRemaining: 100 };
  if (now >= end) return { percentUsed: 100, percentRemaining: 0 };

  const total = end - start;
  const used = Math.min(total, Math.max(0, now - start));
  const percentUsed = Math.round((used / total) * 100);
  return {
    percentUsed,
    percentRemaining: 100 - percentUsed,
  };
}

function getDeviceStatusMeta(stockStatus?: string, status?: string) {
  if (stockStatus === 'IN_STOCK' || status === 'SALEABLE') {
    return {
      label: 'Trong kho (Sẵn sàng xuất)',
      badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300',
      icon: CheckCircle2,
      sub: 'Thiết bị đang lưu kho và sẵn sàng cấp phát / xuất dùng',
    };
  }
  if (stockStatus === 'RESERVED') {
    return {
      label: 'Đang giữ chỗ (Reserved)',
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-300',
      icon: Clock,
      sub: 'Thiết bị đang được gán tạm giữ cho phiếu xuất / dự án',
    };
  }
  if (stockStatus === 'OUT' || status === 'SOLD') {
    return {
      label: 'Đã xuất kho',
      badgeClass: 'bg-blue-50 text-blue-800 border-blue-300',
      icon: Truck,
      sub: 'Thiết bị đã xuất kho giao cho khách hàng hoặc đưa vào dự án',
    };
  }
  if (status === 'DAMAGED' || status === 'DEFECTIVE') {
    return {
      label: 'Lỗi / Hỏng hóc',
      badgeClass: 'bg-red-50 text-red-800 border-red-300',
      icon: AlertCircle,
      sub: 'Thiết bị đang trong khu vực hàng lỗi / chờ xử lý bảo hành',
    };
  }
  return {
    label: stockStatus || status || 'Không xác định',
    badgeClass: 'bg-gray-100 text-gray-700 border-gray-300',
    icon: Box,
    sub: 'Trạng thái lưu kho hiện hành',
  };
}

export function QuickScanLookupModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<SerialTimeline | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const handleCopySerial = (sn: string) => {
    navigator.clipboard.writeText(sn);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  const warrantyInfo = timeline ? formatWarrantyRemaining(timeline.warranty.daysLeft) : null;
  const warrantyProgress = timeline ? getWarrantyProgress(timeline.warranty.start, timeline.warranty.end) : null;
  const statusMeta = timeline ? getDeviceStatusMeta(timeline.serial.stockStatus, timeline.serial.status) : null;
  const StatusIcon = statusMeta?.icon || Box;

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
                Bắn mã bằng súng quét, quét camera hoặc nhập mã Serial để kiểm tra tình trạng & bảo hành
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Input Bar */}
        <div className="p-4 sm:p-5 border-b border-gray-100 bg-white">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nhập hoặc quét số Serial thiết bị (VD: pin1, SG110CX-001...)"
                className="w-full pl-4 pr-10 py-3 bg-gray-50 hover:bg-white focus:bg-white border border-gray-200 focus:border-blue-500 rounded-2xl text-sm font-mono outline-none transition-all focus:ring-4 focus:ring-blue-500/10"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setTimeline(null); setError(null); }}
                  className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600 cursor-pointer"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowCamera(true)}
              className="flex items-center gap-1.5 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl text-xs font-bold transition-colors shrink-0 cursor-pointer"
              title="Quét bằng camera"
            >
              <Camera size={16} />
              <span className="hidden sm:inline">Camera</span>
            </button>

            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="flex items-center gap-1.5 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-2xl text-xs font-bold transition-all shadow-md hover:shadow-lg shrink-0 cursor-pointer"
            >
              {loading ? <Clock className="animate-spin" size={16} /> : <Search size={16} />}
              <span>Tra cứu</span>
            </button>
          </form>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50/90 border border-red-200 rounded-2xl text-red-700 text-xs animate-in fade-in duration-150">
              <AlertCircle size={18} className="shrink-0 mt-0.5 text-red-600" />
              <div className="space-y-1">
                <b className="block text-sm font-semibold text-red-800">Không tìm thấy thông tin thiết bị</b>
                <p className="text-red-700">{error}</p>
                <p className="text-gray-500 text-[11px] mt-1">
                  💡 Gợi ý: Hãy kiểm tra lại số Serial trên nhãn tem của thiết bị hoặc dùng nút Camera để quét mã vạch / QR Code trực tiếp.
                </p>
              </div>
            </div>
          )}

          {timeline && statusMeta && warrantyInfo && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Card 1: Tình trạng thiết bị */}
              <div className="p-5 rounded-2xl border border-gray-200/90 bg-gradient-to-br from-white to-gray-50/60 shadow-xs space-y-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 uppercase tracking-wider">
                        {timeline.serial.tracking || 'SERIAL'}
                      </span>
                      <span className="text-xs font-medium text-gray-500">
                        Mã SP (SKU): <strong className="font-mono text-gray-700">{timeline.serial.productId}</strong>
                      </span>
                      {timeline.serial.unit && (
                        <span className="text-xs text-gray-400">· ĐVT: {timeline.serial.unit}</span>
                      )}
                    </div>

                    <h3 className="text-lg font-bold text-gray-900 leading-snug">
                      {timeline.serial.productName || timeline.serial.productId}
                    </h3>

                    <div className="flex items-center gap-2 pt-0.5">
                      <span className="text-sm font-mono font-bold text-blue-700 flex items-center gap-1.5 bg-blue-50 px-2.5 py-1 rounded-xl border border-blue-200">
                        <Box size={14} className="text-blue-600" />
                        SN: {timeline.serial.serialNumber}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopySerial(timeline.serial.serialNumber)}
                        className="p-1.5 text-gray-400 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                        title="Sao chép số Serial"
                      >
                        {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Huy hiệu tình trạng thiết bị */}
                  <div className="flex flex-col items-start sm:items-end gap-1">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border shadow-2xs ${statusMeta.badgeClass}`}>
                      <StatusIcon size={14} />
                      <span>{statusMeta.label}</span>
                    </span>
                    <span className="text-[11px] text-gray-500 max-w-xs sm:text-right">
                      {statusMeta.sub}
                    </span>
                  </div>
                </div>

                {/* Chi tiết vị trí và kho lưu trữ */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-gray-100 text-xs">
                  <div className="bg-white/80 p-2.5 rounded-xl border border-gray-100">
                    <span className="text-gray-400 block mb-0.5">Kho lưu trữ</span>
                    <b className="text-gray-800 flex items-center gap-1">
                      <Building2 size={13} className="text-gray-400 shrink-0" />
                      <span className="truncate">{timeline.serial.warehouseName || '—'}</span>
                    </b>
                  </div>
                  <div className="bg-white/80 p-2.5 rounded-xl border border-gray-100">
                    <span className="text-gray-400 block mb-0.5">Ngày nhập kho</span>
                    <b className="text-gray-800 flex items-center gap-1">
                      <Calendar size={13} className="text-gray-400 shrink-0" />
                      <span>{timeline.serial.receivedAt ? new Date(timeline.serial.receivedAt).toLocaleDateString('vi-VN') : '—'}</span>
                    </b>
                  </div>
                  <div className="bg-white/80 p-2.5 rounded-xl border border-gray-100 col-span-2 sm:col-span-1">
                    <span className="text-gray-400 block mb-0.5">Nhà cung cấp</span>
                    <b className="text-gray-800 truncate block" title={timeline.serial.supplier || ''}>
                      {timeline.serial.supplier || '—'}
                    </b>
                  </div>
                </div>
              </div>

              {/* Card 2: Thời hạn bảo hành & Thời gian bảo hành còn lại */}
              <div className={`p-5 rounded-2xl border text-xs space-y-3.5 ${
                warrantyInfo.statusType === 'EXPIRED'
                  ? 'border-red-200 bg-red-50/40'
                  : warrantyInfo.statusType === 'URGENT'
                  ? 'border-amber-200 bg-amber-50/40'
                  : warrantyInfo.statusType === 'ACTIVE'
                  ? 'border-emerald-200 bg-emerald-50/40'
                  : 'border-gray-200 bg-gray-50/60'
              }`}>
                {/* Header Bảo hành */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 font-bold text-gray-900 text-sm">
                    {warrantyInfo.statusType === 'EXPIRED' ? (
                      <ShieldX size={18} className="text-red-600" />
                    ) : warrantyInfo.statusType === 'URGENT' ? (
                      <ShieldAlert size={18} className="text-amber-600" />
                    ) : (
                      <ShieldCheck size={18} className="text-emerald-600" />
                    )}
                    <span>Hồ sơ & Thời hạn bảo hành</span>
                  </div>

                  <span className={`font-bold px-3 py-1 rounded-full text-xs border shadow-2xs ${warrantyInfo.badgeClass}`}>
                    {warrantyInfo.badgeLabel}
                  </span>
                </div>

                {/* Thông báo thời gian còn lại nổi bật */}
                <div className="p-3 bg-white/90 rounded-xl border border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <span className="text-gray-500 block text-[11px]">Tình trạng thời hạn bảo hành:</span>
                    <strong className={`text-sm font-bold ${
                      warrantyInfo.statusType === 'EXPIRED'
                        ? 'text-red-700'
                        : warrantyInfo.statusType === 'URGENT'
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}>
                      {warrantyInfo.approxText}
                    </strong>
                  </div>
                  <span className="text-xs text-gray-500">{warrantyInfo.detailText}</span>
                </div>

                {/* Thanh đo thời hạn bảo hành (Progress Bar) */}
                {warrantyProgress && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-[11px] text-gray-500 font-medium">
                      <span>Bắt đầu: {timeline.warranty.start ? new Date(timeline.warranty.start).toLocaleDateString('vi-VN') : '—'}</span>
                      <span>Hết hạn: {timeline.warranty.end ? new Date(timeline.warranty.end).toLocaleDateString('vi-VN') : '—'}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden flex shadow-inner">
                      <div
                        className={`h-full transition-all duration-500 ${
                          warrantyInfo.statusType === 'EXPIRED'
                            ? 'bg-red-500'
                            : warrantyInfo.statusType === 'URGENT'
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${warrantyProgress.percentUsed}%` }}
                        title={`Đã qua ${warrantyProgress.percentUsed}%`}
                      />
                      <div
                        className="h-full bg-emerald-200 transition-all duration-500"
                        style={{ width: `${warrantyProgress.percentRemaining}%` }}
                        title={`Còn lại ${warrantyProgress.percentRemaining}%`}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-400">
                      <span>Đã sử dụng: {warrantyProgress.percentUsed}%</span>
                      <span>Thời hạn còn lại: {warrantyProgress.percentRemaining}%</span>
                    </div>
                  </div>
                )}

                {/* 3 Thông số bảo hành chính */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-gray-200/60">
                  <div className="bg-white/80 p-2.5 rounded-xl border border-gray-100">
                    <span className="text-gray-400 block mb-0.5">Thời hạn gói BH</span>
                    <b className="text-gray-800 text-xs">
                      {timeline.warranty.months ? `${timeline.warranty.months} tháng${timeline.warranty.months >= 12 ? ` (~${Math.round(timeline.warranty.months / 12)} năm)` : ''}` : 'Chưa thiết lập'}
                    </b>
                  </div>
                  <div className="bg-white/80 p-2.5 rounded-xl border border-gray-100">
                    <span className="text-gray-400 block mb-0.5">Ngày kích hoạt</span>
                    <b className="text-gray-800 text-xs">
                      {timeline.warranty.start ? new Date(timeline.warranty.start).toLocaleDateString('vi-VN') : '—'}
                    </b>
                  </div>
                  <div className="bg-white/80 p-2.5 rounded-xl border border-gray-100 col-span-2 sm:col-span-1">
                    <span className="text-gray-400 block mb-0.5">Ngày kết thúc</span>
                    <b className={`text-xs ${warrantyInfo.statusType === 'EXPIRED' ? 'text-red-700' : 'text-gray-800'}`}>
                      {timeline.warranty.end ? new Date(timeline.warranty.end).toLocaleDateString('vi-VN') : '—'}
                    </b>
                  </div>
                </div>
              </div>

              {/* Card 3: Chứng từ Nhập & Xuất */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {/* Nguồn nhập */}
                <div className="p-4 rounded-2xl border border-gray-200 bg-white space-y-1.5 shadow-2xs">
                  <div className="flex items-center gap-1.5 text-emerald-700 font-bold uppercase text-[11px] tracking-wider">
                    <Box size={14} />
                    <span>Nguồn nhập kho</span>
                  </div>
                  {timeline.receipt ? (
                    <div className="space-y-1 pt-1">
                      <p className="font-bold text-gray-900 font-mono text-xs">Phiếu: {timeline.receipt.code || '—'}</p>
                      <p className="text-gray-600">NCC: {timeline.receipt.supplier || '—'}</p>
                      <p className="text-gray-400 text-[11px]">
                        Ngày nhập: {timeline.receipt.date ? new Date(timeline.receipt.date).toLocaleDateString('vi-VN') : '—'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-gray-400 italic pt-1">Chưa liên kết phiếu nhập kho</p>
                  )}
                </div>

                {/* Nguồn xuất */}
                <div className="p-4 rounded-2xl border border-gray-200 bg-white space-y-1.5 shadow-2xs">
                  <div className="flex items-center gap-1.5 text-blue-700 font-bold uppercase text-[11px] tracking-wider">
                    <Truck size={14} />
                    <span>Thông tin xuất kho / Dự án</span>
                  </div>
                  {timeline.issue ? (
                    <div className="space-y-1 pt-1">
                      <p className="font-bold text-gray-900 font-mono text-xs">Phiếu: {timeline.issue.code || '—'}</p>
                      <p className="text-gray-600">Khách hàng: {timeline.issue.customerName || '—'}</p>
                      <p className="text-gray-600">Dự án: {timeline.issue.projectId || '—'}</p>
                      <p className="text-gray-400 text-[11px]">
                        Ngày xuất: {timeline.issue.date ? new Date(timeline.issue.date).toLocaleDateString('vi-VN') : '—'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-emerald-700 font-medium pt-1 flex items-center gap-1">
                      <CheckCircle2 size={13} />
                      <span>Chưa xuất kho (Vẫn nằm trong kho)</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Card 4: Lịch sử di chuyển kho (Stock Moves) */}
              {timeline.moves.length > 0 && (
                <div className="space-y-2 pt-1">
                  <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">
                    Nhật ký luân chuyển ({timeline.moves.length} giao dịch)
                  </span>
                  <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-2xl bg-gray-50/50">
                    {timeline.moves.map((m) => (
                      <div key={m.id} className="p-2.5 flex items-center justify-between text-xs hover:bg-white transition-colors">
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
            className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-bold text-xs transition-colors cursor-pointer"
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
