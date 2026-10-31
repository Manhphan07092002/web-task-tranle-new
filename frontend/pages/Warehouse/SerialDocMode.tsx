import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ScanLine, RefreshCw, AlertCircle, CheckCircle2, ArrowLeft, Boxes, Hash, Camera, Pencil, Trash2, PackageCheck, X } from 'lucide-react';
import { Card } from '../../components/UI';
import {
  getStockDocument, getDocumentProgress, scanSerial, scanOutSerial, scanReturnSerial, editLineSerial, registerLot, allocateLot, confirmLineQty, confirmLineWithoutSerial, enableLineSerial, smartScanSerial,
  getLotTracking, confirmLooseLot,
  type DocProgress, type DocLineProgress, type LotTracking,
} from '../../services/stockService';
import { getDeptHomePath, getDeptModulePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';
import { ScannerModal } from './StockDocs/ScannerModal';
import { resolveTracking } from '../../utils/tracking';
import { resolveLineProcessingMode } from '../../utils/lineProcessing';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
import { playSuccessBeep, playErrorBuzz, playWarningBeep } from '../../utils/scannerFeedback';

const TRACK_LABEL: Record<string, string> = { SERIAL: 'Serial', LOT: 'Lô/Cuộn', QUANTITY: 'Số lượng' };

// Chế độ xử lý Serial/Lô theo phiếu (?documentId=): tiến độ từng dòng,
// quét serial, đăng ký lô, xác nhận số lượng. Không động vào danh sách chung.
export default function SerialDocMode({
  deptKey,
  embedded = false,
  docId,
  onClosed,
}: {
  deptKey: DeptKey;
  embedded?: boolean;
  docId?: string;
  onClosed?: () => void;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const documentId = docId || params.get('documentId') || '';
  const [doc, setDoc] = useState<{ code?: string | null; docType: string; status: string; warehouseName?: string | null; sourceWarehouseName?: string | null; destWarehouseName?: string | null; partnerName?: string | null } | null>(null);
  const [progress, setProgress] = useState<DocProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Trạng thái Quét thông minh tự khớp dòng
  const [smartScanInput, setSmartScanInput] = useState('');
  const [smartScanBusy, setSmartScanBusy] = useState(false);
  const [smartScanSuccess, setSmartScanSuccess] = useState<string | null>(null);
  const [showSmartScanner, setShowSmartScanner] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!documentId) return;
    setLoading(true); setError(null);
    try {
      const [d, p] = await Promise.all([getStockDocument(documentId), getDocumentProgress(documentId)]);
      setDoc(d);
      setProgress(p);
    } catch (e: any) {
      setError(e.message || 'Không tải được phiếu');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Phiếu chỉ hiện quét thông minh khi còn dòng Serial cần xử lý.
  const hasSerialLines = Boolean(progress?.lines.some((line) => line.tracking === 'SERIAL' && line.status !== 'COMPLETED'));

  // Lắng nghe súng bắn barcode phần cứng toàn trang (USB / Bluetooth / PDA)
  useBarcodeScanner({
    enabled: hasSerialLines && Boolean(doc?.status === 'DRAFT' || doc?.status === 'PROCESSING' || doc?.status === 'READY') && !showSmartScanner,
    onScan: async (scannedCode) => {
      if (!progress || loading) return;
      setError(null);
      setSmartScanSuccess(null);
      try {
        const res = await smartScanSerial(documentId, scannedCode);
        playSuccessBeep();
        setSmartScanSuccess(`✓ Quét súng thành công: [${scannedCode}] → Khớp vào "${res.productName}" (${res.count}/${res.required})`);
        await fetchAll();
      } catch (err: any) {
        playErrorBuzz();
        setError(`Lỗi quét súng mã [${scannedCode}]: ${err?.message || 'Không thể gán vào phiếu'}`);
      }
    },
  });

  const handleSmartScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = smartScanInput.trim();
    if (!code || smartScanBusy) return;
    setSmartScanBusy(true);
    setError(null);
    setSmartScanSuccess(null);
    try {
      const res = await smartScanSerial(documentId, code);
      playSuccessBeep();
      setSmartScanInput('');
      setSmartScanSuccess(`✓ Đã gán [${code}] vào sản phẩm "${res.productName}" (${res.count}/${res.required})`);
      await fetchAll();
    } catch (err: any) {
      playErrorBuzz();
      setError(`Lỗi quét mã [${code}]: ${err?.message || 'Không thể gán vào phiếu'}`);
    } finally {
      setSmartScanBusy(false);
    }
  };

  const backPath = getDeptModulePath(
    deptKey,
    doc?.docType === 'ISSUE' ? 'wh_issue' : doc?.docType === 'TRANSFER' ? 'wh_transfer' : 'wh_receipt'
  );
  const insufficientStock = doc?.docType === 'ISSUE' && Boolean(progress?.lines.some((line) => Number(line.availability?.afterIssue) < 0));

  if (!documentId) {
    return (
      <div className="w-full max-w-[1400px] mx-auto space-y-4">
        <Card className="py-16 text-center text-gray-400">
          <p className="font-medium">Thiếu mã phiếu — mở từ nút “Xử lý Serial/Lô” trên phiếu.</p>
          <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block mt-3 text-sm text-emerald-600 hover:underline font-medium">← Về tổng quan kho vận</Link>
        </Card>
      </div>
    );
  }

  const content = (
    <div className="w-full max-w-[1400px] mx-auto space-y-3.5 sm:space-y-4">
      {/* Header phiếu: Tối ưu responsive trên màn hình nhỏ & di động */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Xử lý hàng hóa</p>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800 mt-0.5 sm:mt-1 truncate">
            {embedded ? 'Xử lý phiếu' : 'Đang xử lý phiếu'} {doc?.code || '…'}
          </h1>
          {doc && (
            <p className="text-xs text-gray-500 mt-1">
              Kho: <span className="font-semibold text-gray-700">{doc.docType === 'TRANSFER' ? `${doc.sourceWarehouseName || '—'} → ${doc.destWarehouseName || '—'}` : doc.warehouseName || '—'}</span>
              {doc.partnerName ? ` · Đối tác: ${doc.partnerName}` : ''}
            </p>
          )}
          {progress && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-xs sm:text-sm font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                {progress.lines.filter((l) => l.status === 'COMPLETED').length}/{progress.lines.length} dòng đã đủ
              </span>
              {progress.allCompleted && (
                <span className="text-xs font-bold text-emerald-800">
                  ✓ Sẵn sàng hoàn tất
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-start w-full sm:w-auto justify-end">
          <button
            onClick={() => embedded ? onClosed?.() : navigate(backPath)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 border border-gray-200 hover:bg-gray-100 active:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs sm:text-sm shadow-xs transition-colors cursor-pointer min-h-[38px] sm:min-h-[42px]"
          >
            <ArrowLeft size={16} /> <span>{embedded ? 'Đóng xử lý' : 'Quay lại phiếu'}</span>
          </button>
          <button
            onClick={fetchAll}
            className="p-2 sm:p-2.5 border border-gray-200 rounded-xl hover:bg-gray-100 active:bg-gray-200 text-gray-500 shadow-xs cursor-pointer min-h-[38px] sm:min-h-[42px]"
            title="Tải lại"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs sm:text-sm">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải tiến độ...</p>
        </div>
      ) : progress && (
        <div className="space-y-3">
          {progress.allCompleted && (
            <div className="flex items-center gap-2 p-3 sm:p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 font-bold text-xs sm:text-sm">
              <CheckCircle2 size={18} className="shrink-0" />
              <span>Các dòng hàng đã đủ — phiếu đã tự chuyển sang trạng thái sẵn sàng hoàn tất.</span>
            </div>
          )}
          {insufficientStock && (
            <div className="flex items-center gap-2 p-3 sm:p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 font-bold text-xs sm:text-sm">
              <AlertCircle size={18} className="shrink-0" />
              <span>Tồn khả dụng không đủ cho ít nhất một dòng hàng. Hãy giảm số lượng, đổi kho xuất hoặc bổ sung tồn trước khi hoàn tất xử lý.</span>
            </div>
          )}

          {/* Thanh Quét thông minh tự khớp sản phẩm - Thiết kế Responsive & Mobile-first */}
          {doc && hasSerialLines && (doc.status === 'DRAFT' || doc.status === 'PROCESSING' || doc.status === 'READY') && !progress.allCompleted && (
            <Card className="p-3.5 sm:p-4 bg-gradient-to-r from-emerald-50/90 via-teal-50/50 to-white border border-emerald-200 shadow-xs rounded-2xl">
              <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 sm:gap-3">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs shrink-0">
                    <ScanLine size={18} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-900 text-xs sm:text-sm flex items-center gap-1.5 flex-wrap">
                      <span>Quét thông minh tự khớp dòng</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                        Auto-Match
                      </span>
                    </h3>
                    <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5 line-clamp-1 sm:line-clamp-none">
                      Bắn hoặc quét mã bất kỳ, hệ thống sẽ tự động tìm đúng mặt hàng để gán Serial
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
                  <form onSubmit={handleSmartScanSubmit} className="flex-1 flex gap-1.5">
                    <div className="relative flex-1 min-w-0">
                      <input
                        type="text"
                        value={smartScanInput}
                        onChange={(e) => setSmartScanInput(e.target.value)}
                        placeholder="Bắn súng hoặc gõ Serial..."
                        className="w-full pl-3 pr-8 py-2 sm:py-2.5 bg-white border border-emerald-300 rounded-xl text-xs sm:text-sm font-mono outline-none focus:ring-2 focus:ring-emerald-500 shadow-2xs"
                      />
                      {smartScanInput && (
                        <button
                          type="button"
                          onClick={() => setSmartScanInput('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={smartScanBusy || !smartScanInput.trim()}
                      className="px-4 py-2 sm:py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-bold shrink-0 transition-all shadow-2xs cursor-pointer min-h-[38px] sm:min-h-[42px]"
                    >
                      {smartScanBusy ? '...' : 'Gán'}
                    </button>
                  </form>

                  <button
                    type="button"
                    onClick={() => setShowSmartScanner(true)}
                    className="flex items-center justify-center gap-1.5 px-3.5 py-2 sm:py-2.5 bg-white border border-emerald-300 hover:bg-emerald-50 active:bg-emerald-100 text-emerald-800 rounded-xl text-xs sm:text-sm font-bold shrink-0 transition-all shadow-2xs cursor-pointer min-h-[38px] sm:min-h-[42px]"
                  >
                    <Camera size={16} className="text-emerald-600" />
                    <span>Quét Camera</span>
                  </button>
                </div>
              </div>

              {smartScanSuccess && (
                <div className="mt-2.5 flex items-center gap-2 text-xs font-bold text-emerald-800 bg-white/95 px-3 py-2 rounded-xl border border-emerald-200 animate-in fade-in shadow-2xs">
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                  <span className="truncate">{smartScanSuccess}</span>
                </div>
              )}
            </Card>
          )}

          {showSmartScanner && (
            <ScannerModal
              title={`Quét thông minh toàn phiếu: ${doc?.code || ''}`}
              onClose={() => setShowSmartScanner(false)}
              onScanItem={async (code) => {
                const res = await smartScanSerial(documentId, code);
                setSmartScanSuccess(`✓ Đã nhận [${code}] → Khớp vào "${res.productName}" (${res.count}/${res.required})`);
                await fetchAll();
                return { success: true };
              }}
            />
          )}

          <div className={embedded ? 'rounded-2xl border border-gray-100 overflow-hidden bg-white' : 'space-y-3'}>
            {progress.lines.map((line) => (
              <LineCard key={line.lineId} line={line} docType={doc?.docType || ''} warehouseId={progress.warehouseId || null} documentId={progress.documentId} onDone={fetchAll} compact={embedded} canEdit={doc?.status === 'DRAFT' || doc?.status === 'PROCESSING' || doc?.status === 'READY'} />
            ))}
          </div>
        </div>
      )}

      {/* Floating Action Button (FAB) cho Mobile: Bấm quét nhanh bằng ngón cái bất cứ lúc nào */}
      {doc && hasSerialLines && (doc.status === 'DRAFT' || doc.status === 'PROCESSING' || doc.status === 'READY') && !progress?.allCompleted && (
        <div className="sm:hidden fixed bottom-4 right-4 z-40">
          <button
            type="button"
            onClick={() => setShowSmartScanner(true)}
            className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 text-white rounded-full font-bold text-xs shadow-xl border-2 border-white transition-transform active:scale-95 cursor-pointer"
          >
            <Camera size={18} />
            <span>Quét Camera</span>
          </button>
        </div>
      )}

      {!embedded && (
        <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
          ← Về tổng quan kho vận
        </Link>
      )}
    </div>
  );
  if (!embedded) return content;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[2px] p-2 sm:p-4 md:p-6 flex items-center justify-center" role="dialog" aria-modal="true" aria-label={`Xử lý phiếu ${doc?.code || ''}`}>
      <div className="w-full max-w-6xl max-h-[96vh] sm:max-h-[92vh] overflow-y-auto rounded-2xl sm:rounded-3xl bg-slate-50 shadow-2xl p-3 sm:p-5 md:p-6">
        {content}
      </div>
    </div>
  );
}

function statusBadge(status: string) {
  if (status === 'COMPLETED') return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">Đủ</span>;
  if (status === 'PARTIAL') return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold border bg-amber-50 text-amber-700 border-amber-200">Chưa đủ</span>;
  return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold border bg-gray-100 text-gray-500 border-gray-200">Chưa xử lý</span>;
}

function LineCard({ line, docType, warehouseId, documentId, onDone, compact = false, canEdit = true }: { line: DocLineProgress; docType: string; warehouseId?: string | null; documentId: string; onDone: () => Promise<void>; compact?: boolean; canEdit?: boolean }) {
  const isIssue = docType === 'ISSUE' || docType === 'TRANSFER';
  const tracking = resolveTracking(line.tracking);
  const looseIssue = docType === 'ISSUE' && tracking === 'LOT' && Boolean(line.lotIssueMode === 'LOOSE' || line.lotBroken);
  const mode = resolveLineProcessingMode(line.tracking, docType, looseIssue);
  const remaining = Math.max(0, line.required - line.processed);
  const percent = line.required > 0 ? Math.min(100, Math.round((line.processed / line.required) * 100)) : 100;
  const isDone = line.status === 'COMPLETED';

  return (
    <Card className={`${compact ? 'rounded-xl sm:rounded-2xl border border-gray-100 p-3.5 sm:p-5 shadow-2xs mb-2.5' : 'p-3.5 sm:p-5 shadow-xs rounded-2xl mb-3'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-gray-900 text-sm sm:text-base leading-snug">{line.productName}</p>
          <p className="text-xs text-gray-400 font-mono mt-0.5">{line.productId}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold bg-gray-100 text-gray-600">
            {TRACK_LABEL[tracking] || tracking}
          </span>
          {line.lotBroken && (
            <span className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200" title="Lô của toàn bộ mã hàng đã được tách; xuất theo số lượng.">
              Đã tách lô
            </span>
          )}
          {statusBadge(line.status)}
        </div>
      </div>

      {looseIssue && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            {line.lotBroken
              ? 'Kho đang xuất lẻ cho mã hàng này — lô đã tách, xử lý theo số lượng.'
              : 'Dòng hàng đã xác nhận xuất lẻ — xử lý theo số lượng; lô của mã hàng sẽ tách khi ghi sổ.'}
          </span>
        </div>
      )}

      {/* Tiến độ chi tiết & thanh trực quan */}
      <div className="mt-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap text-xs">
          <span className="bg-slate-50 border border-slate-200/80 px-2 py-0.5 rounded-lg text-slate-700">
            Yêu cầu: <b className="font-mono text-gray-900">{line.required.toLocaleString('vi-VN')}</b>
          </span>
          <span className="bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-lg text-emerald-800">
            Đã xử lý: <b className="font-mono">{line.processed.toLocaleString('vi-VN')}</b>
          </span>
          <span className={`px-2 py-0.5 rounded-lg border ${
            remaining > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-gray-50 border-gray-200 text-gray-500'
          }`}>
            Còn thiếu: <b className="font-mono">{remaining.toLocaleString('vi-VN')}</b>
          </span>
        </div>

        {/* Mini progress bar trực quan */}
        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${isDone ? 'bg-emerald-500' : 'bg-amber-500'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {isIssue && line.availability && (
        <div className={`mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl border p-2.5 text-xs ${line.availability.afterIssue < 0 ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'}`}>
          <div><span className="block text-gray-500">Tồn thực tế</span><b>{Number(line.availability.onHand).toLocaleString('vi-VN')}</b></div>
          <div><span className="block text-gray-500">Đang giữ</span><b className="text-amber-700">{Number(line.availability.reserved).toLocaleString('vi-VN')}</b></div>
          <div><span className="block text-gray-500">Khả dụng</span><b className="text-emerald-700">{Number(line.availability.available).toLocaleString('vi-VN')}</b></div>
          <div><span className="block text-gray-500">Sau xuất</span><b className={line.availability.afterIssue < 0 ? 'text-red-700' : 'text-gray-800'}>{Number(line.availability.afterIssue).toLocaleString('vi-VN')}</b></div>
          {line.availability.afterIssue < 0 && <p className="col-span-2 sm:col-span-4 text-red-700 font-semibold">Kho hiện tại chỉ có {Number(line.availability.available).toLocaleString('vi-VN')} sản phẩm khả dụng, không đủ số lượng cần xuất.</p>}
        </div>
      )}
      <div className="mt-3">
        {mode === 'SERIAL' && (
          <SerialBox
            line={line}
            scanMode={docType === 'RETURN' ? 'return' : isIssue ? 'out' : 'in'}
            documentId={documentId}
            onDone={onDone}
            canEdit={canEdit}
          />
        )}
        {mode === 'LOT_RECEIPT' && <LotBox line={line} documentId={documentId} onDone={onDone} />}
        {mode === 'LOT_ISSUE' && (
          <>
            <LotIssueBox line={line} documentId={documentId} onDone={onDone} />
            {line.canLooseLot && canEdit && warehouseId && (
              <LooseLotAction line={line} warehouseId={warehouseId} onDone={onDone} />
            )}
          </>
        )}
        {mode === 'QUANTITY' && (
          <>
            {tracking === 'LOT' && docType === 'RETURN' && (
              <p className="text-xs text-gray-500 mb-2">Lô trả được ghi nhận tự động khi hoàn tất phiếu.</p>
            )}
            {looseIssue && (
              <p className="text-xs text-gray-500 mb-2">Xuất lẻ theo số lượng — lô của toàn bộ mã hàng sẽ được tách khi hoàn tất phiếu.</p>
            )}
            <QuantityBox line={line} onDone={onDone} />
          </>
        )}
      </div>
    </Card>
  );
}

function EnableSerialBox({ line, onDone }: { line: DocLineProgress; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const enable = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      await enableLineSerial(line.lineId);
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Không thể chuyển sang quét Serial');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-dashed border-gray-200 pt-3">
      <p className="text-xs text-gray-500">Cần đối chiếu từng thiết bị? Chuyển dòng này sang quy trình quét Serial.</p>
      <button type="button" onClick={enable} disabled={busy}
        className="mt-2 flex items-center gap-1.5 px-4 py-2 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 rounded-xl font-bold text-sm disabled:opacity-60">
        <ScanLine size={15} /> {busy ? 'Đang chuẩn bị...' : 'Quét Serial cho dòng này'}
      </button>
      {err && <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
    </div>
  );
}

function NoSerialConfirm({ line, onDone, onCancel }: { line: DocLineProgress; onDone: () => Promise<void>; onCancel: () => void }) {
  const [actual, setActual] = useState(String(line.required));
  const [reason, setReason] = useState('Hàng hóa không có Serial');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const needReason = Number(actual) !== line.required;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !(Number(actual) >= 0) || (needReason && !reason.trim())) return;
    setBusy(true); setErr('');
    try {
      await confirmLineWithoutSerial(line.lineId, { actualQty: Number(actual), varianceReason: reason.trim() || undefined });
      await onDone();
    } catch (e: any) { setErr(e.message || 'Không thể xác nhận dòng không có Serial'); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-2">
      <p className="text-xs font-bold text-amber-800">Xác nhận sản phẩm không có số Serial</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <span>Số lượng trên phiếu: <b>{line.required.toLocaleString('vi-VN')}</b></span>
        <label className="flex items-center gap-1">Thực nhận:
          <input value={actual} onChange={(e) => setActual(e.target.value)} inputMode="decimal" className="w-24 px-2 py-1.5 border border-gray-200 rounded-lg bg-white text-right" />
        </label>
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do" className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-xs" />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold disabled:opacity-60">{busy ? 'Đang lưu...' : 'Xác nhận không có Serial'}</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-800">Hủy</button>
      </div>
      {err && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
    </form>
  );
}

function SerialBox({ line, scanMode, documentId, onDone, canEdit }: { line: DocLineProgress; scanMode: 'in' | 'out' | 'return'; documentId: string; onDone: () => Promise<void>; canEdit: boolean }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [scanning, setScanning] = useState(false);
  const [okMsg, setOkMsg] = useState('');
  const [editingSerial, setEditingSerial] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const editSerial = async (serial: string, replacement?: string) => {
    if (!canEdit || busy) return;
    setBusy(true); setErr(''); setOkMsg('');
    try {
      await editLineSerial(documentId, line.lineId, serial, replacement);
      setEditingSerial(null); setEditingValue('');
      setOkMsg(replacement ? '✓ Đã sửa Serial' : '✓ Đã xóa Serial khỏi dòng hàng');
      await onDone();
    } catch (e: any) { setErr(e.message || 'Không thể sửa Serial'); }
    finally { setBusy(false); }
  };

  const submitOne = async (code: string): Promise<string | null> => {
    try {
      await (scanMode === 'out' ? scanOutSerial : scanMode === 'return' ? scanReturnSerial : scanSerial)(documentId, line.lineId, code);
      return null;
    } catch (e: any) {
      return `${code}: ${e.message || 'thất bại'}`;
    }
  };

  const handleScannerDone = async (codes: string[]) => {
    setScanning(false);
    const fresh = codes.filter((c) => !line.serials.includes(c));
    if (fresh.length === 0) return;
    setBusy(true); setErr(''); setOkMsg('');
    const errs: string[] = [];
    let added = 0;
    for (const code of fresh) {
      const errMsg = await submitOne(code);
      if (errMsg) errs.push(errMsg);
      else added++;
    }
    if (added > 0) setOkMsg(`✓ Đã thêm ${added} serial`);
    if (errs.length > 0) setErr(errs.slice(0, 3).join(' | ') + (errs.length > 3 ? ` (+${errs.length - 3} lỗi khác)` : ''));
    setBusy(false);
    await onDone();
  };

  const handleRealtimeScan = async (code: string) => {
    try {
      await (scanMode === 'out' ? scanOutSerial : scanMode === 'return' ? scanReturnSerial : scanSerial)(documentId, line.lineId, code);
      await onDone();
      return { success: true };
    } catch (e: any) {
      return { success: false, message: e.message || 'Thất bại' };
    }
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const code = value.trim();
    if (!code || busy) return;
    setBusy(true); setErr(''); setOkMsg('');
    try {
      await (scanMode === 'out' ? scanOutSerial : scanMode === 'return' ? scanReturnSerial : scanSerial)(documentId, line.lineId, code);
      setValue('');
      playSuccessBeep();
      await onDone();
    } catch (e: any) {
      playErrorBuzz();
      setErr(e.message || 'Thêm serial thất bại');
    } finally {
      setBusy(false);
    }
  };

  const errorTitle = /chưa từng nhập|không tìm thấy serial/i.test(err)
    ? 'Serial chưa có trong lịch sử nhập kho'
    : /sản phẩm khác/i.test(err)
      ? 'Serial không đúng sản phẩm'
      : /không nằm tại kho|sai kho/i.test(err)
        ? 'Serial không đúng kho xuất'
        : /đang được giữ/i.test(err)
          ? 'Serial đang được giữ cho phiếu khác'
          : /đã được xuất/i.test(err)
            ? 'Serial đã được xuất'
            : 'Serial không hợp lệ';

  return (
    <div>
      {line.serials.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {line.serials.map((s) => (
            editingSerial === s ? (
              <span key={s} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-1.5 py-0.5">
                <input autoFocus value={editingValue} onChange={(e) => setEditingValue(e.target.value)} className="w-24 px-1 py-0.5 text-xs font-mono outline-none" />
                <button type="button" onClick={() => editSerial(s, editingValue.trim())} className="text-emerald-600 text-xs font-bold">Lưu</button>
                <button type="button" onClick={() => setEditingSerial(null)} className="text-gray-400 text-xs">Hủy</button>
              </span>
            ) : (
              <span key={s} className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-0.5 text-gray-700 font-mono text-xs">
                <CheckCircle2 size={12} className="text-emerald-500" />{s}
                {canEdit && <>
                  <button type="button" title="Sửa Serial" aria-label={`Sửa Serial ${s}`} onClick={() => { setEditingSerial(s); setEditingValue(s); }} className="ml-1 inline-flex items-center gap-0.5 rounded px-1 text-[11px] font-semibold text-gray-500 hover:bg-emerald-50 hover:text-emerald-600">
                    <Pencil size={11} /> Sửa
                  </button>
                  <button type="button" title="Xóa Serial" aria-label={`Xóa Serial ${s}`} onClick={() => editSerial(s)} className="inline-flex items-center gap-0.5 rounded px-1 text-[11px] font-semibold text-gray-500 hover:bg-red-50 hover:text-red-600">
                    <Trash2 size={11} /> Xóa
                  </button>
                </>}
              </span>
            )
          ))}
        </div>
      )}
      {line.status !== 'COMPLETED' && (
        <>
          <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0 relative">
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Quét hoặc gõ serial..."
                className="w-full pl-3 pr-8 py-2.5 sm:py-2 border border-gray-200 rounded-xl bg-white text-xs sm:text-sm outline-none focus:border-emerald-500 font-mono shadow-2xs"
              />
              {value && (
                <button
                  type="button"
                  onClick={() => setValue('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => { setErr(''); setOkMsg(''); setScanning(true); }}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2.5 sm:py-2 border border-emerald-300 bg-white hover:bg-emerald-50 active:bg-emerald-100 text-emerald-700 rounded-xl font-bold text-xs sm:text-sm transition-colors shadow-2xs cursor-pointer min-h-[42px] sm:min-h-[38px]"
                title="Mở camera quét serial mặt hàng này"
              >
                <Camera size={16} />
                <span>Quét Camera</span>
              </button>
              <button
                type="submit"
                disabled={busy || !value.trim()}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl font-bold text-xs sm:text-sm disabled:opacity-50 transition-colors shadow-2xs cursor-pointer min-h-[42px] sm:min-h-[38px]"
              >
                <ScanLine size={16} />
                <span>{busy ? '...' : 'Thêm'}</span>
              </button>
            </div>
          </form>
          {scanning && (
            <ScannerModal
              initial={line.serials}
              title={`Quét Serial: ${line.productName}`}
              targetQuantity={line.required}
              onClose={() => setScanning(false)}
              onScanItem={handleRealtimeScan}
              onDone={handleScannerDone}
            />
          )}
        </>
      )}
      {okMsg && <p className="text-xs text-emerald-600 font-bold mt-1.5">{okMsg}</p>}
      {err && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div><b className="block">{errorTitle}</b><span>{err}</span></div>
        </div>
      )}
    </div>
  );
}

function LotBox({ line, documentId, onDone }: { line: DocLineProgress; documentId: string; onDone: () => Promise<void> }) {
  const [lotCode, setLotCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hasRecorded = line.lots.some((lot) => lot.status === 'RECORDED');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !lotCode.trim() || !(Number(quantity) > 0)) return;
    setBusy(true); setErr('');
    try {
      await registerLot({
        documentId,
        documentLineId: line.lineId,
        lotCode: lotCode.trim(),
        quantity: Number(quantity),
        unit: unit.trim() || undefined,
      });
      setLotCode(''); setQuantity(''); setUnit('');
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Đăng ký lô thất bại');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {hasRecorded && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>Kho đang xuất lẻ — các lô dưới đây chỉ lưu vết, không dùng để phân bổ khi xuất.</span>
        </div>
      )}
      {line.lots.length > 0 && (
        <div className="mb-2 border border-gray-100 rounded-xl overflow-hidden">
          <table className="wh-table wh-table-compact w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-1.5 px-3 font-bold text-gray-500 uppercase">Mã lô/cuộn</th>
                <th className="text-right py-1.5 px-3 font-bold text-gray-500 uppercase">Số lượng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {line.lots.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5 px-3 font-mono font-bold text-gray-800">
                    {l.lotCode}{l.coilCode ? ` · ${l.coilCode}` : ''}
                    {l.status === 'RECORDED' && <span className="ml-1 text-[10px] font-bold text-amber-700">(lưu vết)</span>}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{Number(l.initialQty).toLocaleString('vi-VN')}{l.unit ? ` ${l.unit}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {line.status !== 'COMPLETED' && (
        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
          <input
            value={lotCode}
            onChange={(e) => setLotCode(e.target.value)}
            placeholder="Mã lô/cuộn *"
            className="flex-1 min-w-0 px-3 py-2.5 sm:py-2 border border-gray-200 rounded-xl bg-white text-xs sm:text-sm outline-none focus:border-emerald-500 font-mono shadow-2xs"
          />
          <div className="flex items-center gap-2">
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="SL *"
              inputMode="decimal"
              className="flex-1 sm:w-28 px-3 py-2.5 sm:py-2 border border-gray-200 rounded-xl bg-white text-xs sm:text-sm outline-none text-right tabular-nums focus:border-emerald-500 shadow-2xs"
            />
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="ĐVT"
              className="w-16 sm:w-20 px-2 sm:px-3 py-2.5 sm:py-2 border border-gray-200 rounded-xl bg-white text-xs sm:text-sm outline-none focus:border-emerald-500 text-center shadow-2xs"
            />
            <button
              type="submit"
              disabled={busy}
              className="flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2.5 sm:py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs sm:text-sm disabled:opacity-60 shrink-0 min-h-[42px] sm:min-h-[38px] shadow-2xs cursor-pointer"
            >
              <Boxes size={15} /> <span>{busy ? '...' : 'Thêm lô'}</span>
            </button>
          </div>
        </form>
      )}
      {err && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
    </div>
  );
}

function LotIssueBox({ line, documentId, onDone }: { line: DocLineProgress; documentId: string; onDone: () => Promise<void> }) {
  const [lotCode, setLotCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const allocated = line.lots.reduce((sum, lot) => sum + Number(lot.allocatedQty || 0), 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(quantity);
    if (busy || !lotCode.trim() || !(qty > 0)) return;
    setBusy(true); setErr('');
    try {
      await allocateLot({ documentId, documentLineId: line.lineId, lotCode: lotCode.trim(), quantity: qty });
      setLotCode(''); setQuantity('');
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Phân bổ lô thất bại');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {line.lots.length > 0 && (
        <div className="mb-2 border border-gray-100 rounded-xl overflow-hidden">
          <table className="wh-table wh-table-compact w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-1.5 px-3 font-bold text-gray-500 uppercase">Lô/cuộn nguồn</th>
                <th className="text-right py-1.5 px-3 font-bold text-gray-500 uppercase">Phân bổ</th>
                <th className="text-right py-1.5 px-3 font-bold text-gray-500 uppercase">Còn lại</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {line.lots.map((lot) => (
                <tr key={lot.id}>
                  <td className="py-1.5 px-3 font-mono font-bold text-gray-800">{lot.lotCode}{lot.coilCode ? ` · ${lot.coilCode}` : ''}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{Number(lot.allocatedQty || 0).toLocaleString('vi-VN')}{lot.unit ? ` ${lot.unit}` : ''}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{Number(lot.remainingQty || 0).toLocaleString('vi-VN')}{lot.unit ? ` ${lot.unit}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500 mb-2">Đã phân bổ: <b>{allocated.toLocaleString('vi-VN')}</b> / {line.required.toLocaleString('vi-VN')}</p>
      {line.status !== 'COMPLETED' && (
        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
          <input
            value={lotCode}
            onChange={(e) => setLotCode(e.target.value)}
            placeholder="Mã lô/cuộn nguồn *"
            className="flex-1 min-w-0 px-3 py-2.5 sm:py-2 border border-gray-200 rounded-xl bg-white text-xs sm:text-sm outline-none focus:border-emerald-500 font-mono shadow-2xs"
          />
          <div className="flex items-center gap-2">
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Số lượng *"
              inputMode="decimal"
              className="flex-1 sm:w-28 px-3 py-2.5 sm:py-2 border border-gray-200 rounded-xl bg-white text-xs sm:text-sm outline-none text-right tabular-nums focus:border-emerald-500 shadow-2xs"
            />
            <button
              type="submit"
              disabled={busy}
              className="flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2.5 sm:py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs sm:text-sm disabled:opacity-60 shrink-0 min-h-[42px] sm:min-h-[38px] shadow-2xs cursor-pointer"
            >
              <Boxes size={15} /> <span>{busy ? '...' : 'Phân bổ lô'}</span>
            </button>
          </div>
        </form>
      )}
      {err && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
    </div>
  );
}

function LooseLotAction({ line, warehouseId, onDone }: { line: DocLineProgress; warehouseId: string; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [tracking, setTracking] = useState<LotTracking | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const openPanel = async () => {
    setOpen(true); setErr(''); setLoading(true);
    try {
      setTracking(await getLotTracking(line.productId, warehouseId));
    } catch (e: any) {
      setErr(e.message || 'Không tải được trạng thái lô');
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      await confirmLooseLot(line.lineId);
      setOpen(false);
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Không thể xác nhận xuất lẻ');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-3 border-t border-dashed border-gray-200 pt-3">
        <p className="text-xs text-gray-500">Không đủ lô để xuất? Chuyển mã hàng sang xuất lẻ theo số lượng.</p>
        <button
          type="button"
          onClick={openPanel}
          className="mt-2 flex items-center gap-1.5 px-4 py-2 border border-amber-500 text-amber-700 hover:bg-amber-50 rounded-xl font-bold text-sm cursor-pointer"
        >
          <AlertCircle size={15} /> Xuất lẻ theo số lượng
        </button>
      </div>
    );
  }

  const affected = tracking?.lots || [];
  const quantity = Number(tracking?.affectedQuantity || 0);

  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50/70 p-3 space-y-2">
      <p className="text-xs font-bold text-amber-900">Xác nhận xuất lẻ cho toàn bộ mã hàng</p>
      {loading ? (
        <p className="text-xs text-amber-700">Đang kiểm tra lô còn lại...</p>
      ) : (
        <>
          <p className="text-xs text-amber-800">
            Khi hoàn tất phiếu, toàn bộ lô còn lại của mã hàng này trong kho sẽ bị tách (về 0) và chuyển sang xuất lẻ
            cho đến khi hết tồn. Áp dụng cho mọi dòng cùng mã hàng trên phiếu.
          </p>
          {affected.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-white overflow-hidden">
              <table className="wh-table wh-table-compact w-full text-xs">
                <thead className="bg-amber-50">
                  <tr>
                    <th className="text-left py-1.5 px-3 font-bold text-amber-700 uppercase">Lô sẽ tách</th>
                    <th className="text-right py-1.5 px-3 font-bold text-amber-700 uppercase">Còn lại</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-50">
                  {affected.map((lot) => (
                    <tr key={lot.id}>
                      <td className="py-1.5 px-3 font-mono font-bold text-gray-800">{lot.lotCode}{lot.coilCode ? ` · ${lot.coilCode}` : ''}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{Number(lot.remainingQty).toLocaleString('vi-VN')}{lot.unit ? ` ${lot.unit}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 py-1.5 text-xs font-bold text-amber-800 border-t border-amber-100">
                Tổng còn lại: {quantity.toLocaleString('vi-VN')}
              </p>
            </div>
          ) : (
            <p className="text-xs text-amber-700">Không còn lô nào có tồn — xác nhận để chuyển mã hàng sang xuất lẻ.</p>
          )}
        </>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={busy || loading}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold disabled:opacity-60 cursor-pointer"
        >
          {busy ? 'Đang lưu...' : 'Xác nhận xuất lẻ'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-800 cursor-pointer">Hủy</button>
      </div>
      {err && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
    </div>
  );
}

function QuantityBox({ line, onDone }: { line: DocLineProgress; onDone: () => Promise<void> }) {
  const [actual, setActual] = useState(line.actualQty !== null && line.actualQty !== undefined ? String(line.actualQty) : String(line.required));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const needReason = Number(actual) !== line.required;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !(Number(actual) >= 0)) return;
    setBusy(true); setErr('');
    try {
      await confirmLineQty(line.lineId, { actualQty: Number(actual), varianceReason: needReason ? reason.trim() : undefined });
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Xác nhận thất bại');
    } finally {
      setBusy(false);
    }
  };

  if (line.status === 'COMPLETED') {
    return (
      <p className="text-xs text-gray-500 flex items-center gap-1.5">
        <PackageCheck size={14} className="text-emerald-500" />
        Đã xác nhận: <b className="font-mono">{Number(line.actualQty).toLocaleString('vi-VN')}</b>
        {Number(line.varianceQty) !== 0 ? <span className="text-amber-600">(chênh {Number(line.varianceQty) > 0 ? '+' : ''}{Number(line.varianceQty).toLocaleString('vi-VN')})</span> : null}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <label className="text-xs text-gray-500 flex items-center gap-1 shrink-0"><Hash size={13} /> Số thực nhận:</label>
        <div className="flex items-center gap-2 flex-1 sm:flex-none">
          <input
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            inputMode="decimal"
            className="flex-1 sm:w-32 px-3 py-2.5 sm:py-2 border border-gray-200 rounded-xl bg-white text-xs sm:text-sm outline-none text-right tabular-nums focus:border-emerald-500 shadow-2xs"
          />
          <button
            type="submit"
            disabled={busy}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs sm:text-sm disabled:opacity-60 min-h-[42px] sm:min-h-[38px] shadow-2xs cursor-pointer"
          >
            <PackageCheck size={15} /> <span>{busy ? '...' : 'Xác nhận số lượng'}</span>
          </button>
        </div>
      </div>
      {needReason && (
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Lý do chênh lệch so với chứng từ *"
          className="w-full px-3 py-2.5 sm:py-2 border border-amber-300 bg-amber-50/50 rounded-xl text-xs sm:text-sm outline-none focus:border-amber-500 shadow-2xs"
        />
      )}
      {err && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12} />{err}</p>}
    </form>
  );
}
