import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { levelOf, LEVELS } from '../../utils/rbac';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ClipboardCheck, PlusCircle, RefreshCw, AlertCircle, X, CheckCircle2, RotateCcw,
  Camera, Scan, Plus, Minus, Barcode, Sparkles, ArrowLeft,
} from 'lucide-react';
import { Card } from '../../components/UI';
import { Pagination } from '../../components/Pagination';
import { ScannerModal } from './StockDocs/ScannerModal';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
import { parseBarcodeData } from '../../utils/barcodeParser';
import { playSuccessBeep, playErrorBuzz } from '../../utils/scannerFeedback';
import {
  getStockCounts, getStockCount, openStockCount, submitCountLines,
  requestRecount, approveCount, cancelCount, getWarehouses, getSerialTimeline,
  type StockCount, type Warehouse,
} from '../../services/stockService';
import { getDeptHomePath, getDeptModulePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

// Kiểm kê blind-count (§19–20): NV đếm không thấy số hệ thống,
// TP đối chiếu/duyệt chênh lệch → sinh điều chỉnh tồn.
export default function CountPage({ deptKey }: { deptKey: DeptKey }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const fromProcessing = searchParams.get('from') === 'wh_processing';
  const { user } = useAuth();
  const canManage = levelOf(user) >= LEVELS.MANAGER && levelOf(user) !== LEVELS.ADMIN;
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StockCount | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [hasMore, setHasMore] = useState(false);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [c, w] = await Promise.all([
        getStockCounts(undefined, undefined, { limit: pageSize + 1, offset: (page - 1) * pageSize }),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setHasMore(c.length > pageSize); setCounts(c.slice(0, pageSize)); setWarehouses(w);
    } catch (e: any) {
      setError(e.message || 'Không tải được kiểm kê');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, pageSize]);
  const visibleCounts = counts;

  const openDetail = async (id: string) => {
    try {
      setSelected(await getStockCount(id));
    } catch (e: any) {
      setError(e.message || 'Không mở được đợt kiểm kê');
    }
  };

  useEffect(() => {
    const countId = searchParams.get('countId') || searchParams.get('documentId');
    if (countId) openDetail(countId);
    // Deep-link từ trang Chênh lệch kiểm kê hoặc Xử lý phiếu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const refreshSelected = async (id: string) => {
    try {
      setSelected(await getStockCount(id));
      await fetchAll();
    } catch (e: any) {
      setError(e.message || 'Tải lại thất bại');
    }
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      {fromProcessing && (
        <div className="flex items-center justify-between p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-950 text-sm shadow-xs flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-medium">
              Bạn đang kiểm đếm phiếu từ danh sách <b>Xử lý phiếu</b>.
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate(getDeptModulePath(deptKey, 'wh_processing'))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <ArrowLeft size={14} /> Quay lại Xử lý phiếu
          </button>
        </div>
      )}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kho vận · Vận hành</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Kiểm kê</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
            <RefreshCw size={16} />
          </button>
          <button hidden={!canManage} onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-md transition-colors">
            <PlusCircle size={16} /> Mở đợt kiểm kê
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          <AlertCircle size={15} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải kiểm kê...</p>
        </div>
      ) : counts.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <ClipboardCheck size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Chưa có đợt kiểm kê nào</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleCounts.map((c) => (
            <button key={c.id} onClick={() => openDetail(c.id)} className="text-left">
              <Card className="p-5 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono font-bold text-gray-800">{c.code || c.id.slice(0, 8)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${c.status === 'DONE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                    {c.status === 'DONE' ? 'Đã đóng' : c.status === 'CANCELLED' ? 'Đã hủy' : 'Đang đếm'}
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  {c.warehouseName || c.warehouseId} · {c.blindCount ? 'Đếm mù' : 'Hiện số hệ thống'} · {c.createdAt ? new Date(c.createdAt).toLocaleString('vi-VN') : ''}
                </p>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                  <span className="text-gray-500">Tiến độ: <b className="text-gray-700">{Number(c.countedLines || 0)}/{Number(c.totalLines || 0)}</b> dòng</span>
                  {Number(c.varianceLines || 0) > 0 && <span className="font-bold text-amber-700">{Number(c.varianceLines)} dòng lệch</span>}
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
      {!loading && counts.length > 0 && <Pagination currentPage={page} totalPages={hasMore ? page + 1 : page} onPageChange={setPage} itemsPerPage={pageSize} onItemsPerPageChange={(size) => { setPageSize(size); setPage(1); }} />}

      {selected && (
        <CountDetailModal
          count={selected}
          deptKey={deptKey}
          fromProcessing={fromProcessing}
          onClose={() => {
            setSelected(null);
            if (searchParams.get('countId') || searchParams.get('documentId')) {
              const next = new URLSearchParams(searchParams);
              next.delete('countId');
              next.delete('documentId');
              setSearchParams(next, { replace: true });
            }
          }}
          onChanged={() => refreshSelected(selected.id)}
          onError={setError}
        />
      )}
      {showCreate && (
        <CountCreateModal warehouses={warehouses}
          onClose={() => setShowCreate(false)}
          onDone={async () => { setShowCreate(false); await fetchAll(); }} />
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}

function CountDetailModal({
  count, onClose, onChanged, onError, deptKey, fromProcessing,
}: {
  count: StockCount;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
  deptKey: DeptKey;
  fromProcessing?: boolean;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = levelOf(user) >= LEVELS.MANAGER && levelOf(user) !== LEVELS.ADMIN;
  const [actuals, setActuals] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    count.lines?.forEach((l) => {
      if (l.actualQty != null) {
        init[l.id] = String(l.actualQty);
      }
    });
    return init;
  });
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const open = count.status === 'COUNTING';
  const blind = count.blindCount;

  // Trạng thái quét kiểm kê liên tục (Continuous Cycle Count)
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [scanMode, setScanMode] = useState<'add' | 'subtract'>('add');
  const [scannedSerials, setScannedSerials] = useState<Set<string>>(new Set());
  const [highlightedLineId, setHighlightedLineId] = useState<string | null>(null);
  const [lastScannedInfo, setLastScannedInfo] = useState<{
    text: string;
    success: boolean;
    lineId?: string;
  } | null>(null);

  const fail = (m: string) => { setErr(m); onError(m); };

  // Xử lý khi nhận được mã quét từ Súng Barcode hoặc Camera
  const handleScanCode = async (rawCode: string) => {
    if (!open) return;
    const parsed = parseBarcodeData(rawCode);
    const serialOrSku = (parsed.serial || rawCode).trim();
    if (!serialOrSku) return;

    const targetUpper = serialOrSku.toUpperCase();

    // 1. Kiểm tra chống quét trùng serial trong cùng một đợt kiểm kê
    if (scanMode === 'add' && scannedSerials.has(targetUpper)) {
      playErrorBuzz();
      setLastScannedInfo({
        text: `Serial "${serialOrSku}" đã được quét trước đó trong đợt kiểm kê này!`,
        success: false,
      });
      return;
    }

    const lines = count.lines || [];

    // 2. Thử khớp trực tiếp với productCode (SKU) hoặc productId của các dòng kiểm kê
    let matchedLine = lines.find((l) => {
      const sku = (l.productCode || '').trim().toUpperCase();
      const pid = (l.productId || '').trim().toUpperCase();
      return sku === targetUpper || pid === targetUpper || (parsed.sku && sku === parsed.sku.toUpperCase());
    });

    // 3. Nếu không khớp trực tiếp với SKU/Mã sản phẩm, kiểm tra xem có phải là Số Serial thiết bị trong kho không
    if (!matchedLine) {
      try {
        const timeline = await getSerialTimeline(serialOrSku).catch(() => null);
        if (timeline && timeline.serial) {
          const snProdId = timeline.serial.productId;
          matchedLine = lines.find((l) => l.productId === snProdId);

          if (matchedLine && timeline.serial.warehouseId && timeline.serial.warehouseId !== count.warehouseId) {
            playErrorBuzz();
            setLastScannedInfo({
              text: `Serial "${serialOrSku}" thuộc ${timeline.serial.warehouseName || 'kho khác'}, không thuộc kho đang kiểm kê!`,
              success: false,
            });
            return;
          }
        }
      } catch (e) {
        // bỏ qua lỗi API
      }
    }

    // 4. Nếu tìm thấy dòng hàng phù hợp
    if (matchedLine) {
      const currentVal = actuals[matchedLine.id] !== undefined
        ? Number(actuals[matchedLine.id]) || 0
        : (matchedLine.actualQty != null ? Number(matchedLine.actualQty) : 0);

      const delta = scanMode === 'add' ? 1 : -1;
      const nextVal = Math.max(0, currentVal + delta);

      setActuals((prev) => ({
        ...prev,
        [matchedLine.id]: String(nextVal),
      }));

      if (scanMode === 'add') {
        setScannedSerials((prev) => new Set(prev).add(targetUpper));
        playSuccessBeep();
      } else {
        setScannedSerials((prev) => {
          const next = new Set(prev);
          next.delete(targetUpper);
          return next;
        });
        playSuccessBeep();
      }

      setHighlightedLineId(matchedLine.id);
      setTimeout(() => setHighlightedLineId(null), 2500);

      // Tự động cuộn tới dòng vừa được quét
      const rowEl = document.getElementById(`count-line-row-${matchedLine.id}`);
      if (rowEl) {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      setLastScannedInfo({
        text: `${scanMode === 'add' ? '+1' : '-1'} ${matchedLine.productName || matchedLine.productCode || 'Sản phẩm'} • Thực tế: ${nextVal}`,
        success: true,
        lineId: matchedLine.id,
      });
    } else {
      // Không tìm thấy sản phẩm nào
      playErrorBuzz();
      setLastScannedInfo({
        text: `Mã "${serialOrSku}" không có trong danh sách kiểm kê của kho này!`,
        success: false,
      });
    }
  };

  // Lắng nghe súng quét mã vạch chuyên dụng trên toàn bộ modal
  useBarcodeScanner({
    onScan: handleScanCode,
    enabled: open,
  });

  const submitActuals = async () => {
    const lines = Object.entries(actuals)
      .filter(([, v]) => v !== '')
      .map(([key, v]) => {
        const line = count.lines?.find((l) => l.id === key);
        return { productId: line?.productId || '', locationId: line?.locationId || null, actualQty: Number(v) };
      })
      .filter((l) => l.productId && l.actualQty >= 0);
    if (lines.length === 0) { setErr('Nhập ít nhất 1 số đếm.'); return; }
    setBusy(true); setErr('');
    try {
      await submitCountLines(count.id, lines);
      setActuals({});
      await onChanged();
    } catch (e: any) {
      fail(e.message || 'Gửi số đếm thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const doRecount = async () => {
    if (checked.length === 0) { setErr('Chọn dòng cần kiểm lại.'); return; }
    setBusy(true); setErr('');
    try {
      await requestRecount(count.id, checked);
      setChecked([]);
      await onChanged();
    } catch (e: any) {
      fail(e.message || 'Yêu cầu kiểm lại thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const doApprove = async () => {
    setBusy(true); setErr('');
    try {
      await approveCount(count.id);
      await onChanged();
    } catch (e: any) {
      fail(e.message || 'Duyệt thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    setBusy(true); setErr('');
    try { await cancelCount(count.id); await onChanged(); }
    catch (e: any) { fail(e.message || 'Hủy kiểm kê thất bại.'); }
    finally { setBusy(false); }
  };

  const varianceOf = (l: { expectedQty: number | null; actualQty: number | null }) =>
    l.actualQty == null || l.expectedQty == null ? null : Number(l.actualQty) - Number(l.expectedQty);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col" style={{ maxHeight: '94vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-gray-900 font-mono text-base">{count.code || count.id.slice(0, 8)}</h3>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                open ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {open ? 'Đang kiểm đếm' : 'Hoàn tất'}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Kho: <b className="text-gray-600">{count.warehouseName || count.warehouseId}</b> · {blind ? 'Đếm mù (ẩn số hệ thống)' : 'Hiện số hệ thống'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {fromProcessing && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate(getDeptModulePath(deptKey, 'wh_processing'));
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-900 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer"
                title="Quay lại danh sách Xử lý phiếu"
              >
                <ArrowLeft size={14} />
                <span className="hidden sm:inline">Quay lại</span> Xử lý phiếu
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer p-1 rounded-lg">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-auto px-6 py-4 space-y-3">
          {err && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              <AlertCircle size={15} />{err}
            </div>
          )}

          {/* Thanh công cụ Quét kiểm kê thực địa liên tục */}
          {open && (
            <div className="p-3 bg-gradient-to-r from-emerald-50/70 via-blue-50/50 to-purple-50/40 border border-emerald-200/70 rounded-2xl shadow-2xs space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold shadow-xs">
                    <Scan size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-800">Quét kiểm kê thực địa</span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Súng quét tự động
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      Bắn mã Barcode/QR hoặc mở camera để tự động khớp sản phẩm &amp; đếm số lượng
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-white border border-gray-200 rounded-xl p-0.5 shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setScanMode('add')}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        scanMode === 'add'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                      title="Chế độ quét cộng dồn số lượng"
                    >
                      <Plus size={13} />
                      Cộng (+1)
                    </button>
                    <button
                      type="button"
                      onClick={() => setScanMode('subtract')}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        scanMode === 'subtract'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                      title="Chế độ quét giảm bớt số lượng (khi quét nhầm)"
                    >
                      <Minus size={13} />
                      Trừ (-1)
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowCameraScanner(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                  >
                    <Camera size={14} />
                    Mở Camera
                  </button>
                </div>
              </div>

              {/* Thông báo kết quả quét tức thì */}
              {lastScannedInfo && (
                <div
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold animate-in fade-in duration-150 ${
                    lastScannedInfo.success
                      ? 'bg-emerald-500/15 text-emerald-900 border border-emerald-300'
                      : 'bg-red-500/15 text-red-900 border border-red-300'
                  }`}
                >
                  {lastScannedInfo.success ? (
                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle size={16} className="text-red-600 shrink-0" />
                  )}
                  <span className="truncate">{lastScannedInfo.text}</span>
                  {scannedSerials.size > 0 && (
                    <span className="ml-auto text-[11px] font-mono text-gray-500 shrink-0">
                      Đã quét: {scannedSerials.size} SN
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <table className="wh-table w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase">
                <th className="py-2">Hàng / Vị trí</th>
                {!blind && <th className="py-2 text-right">Hệ thống</th>}
                <th className="py-2 text-right">Thực tế</th>
                <th className="py-2 text-right">Chênh lệch</th>
                <th className="py-2 text-right">Kiểm lại</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(count.lines || []).map((l) => {
                const v = varianceOf(l);
                const isHighlighted = highlightedLineId === l.id;
                return (
                  <tr
                    key={l.id}
                    id={`count-line-row-${l.id}`}
                    className={`transition-colors duration-500 ${
                      isHighlighted ? 'bg-emerald-100/80 ring-2 ring-emerald-400 rounded-lg' : 'hover:bg-gray-50/70'
                    }`}
                  >
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-800 text-[13px]">{l.productName || l.productId}</p>
                        {l.productCode && (
                          <span className="font-mono text-[11px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                            {l.productCode}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        Mã: {l.productId} · Kệ: <b className="text-gray-600">{l.locationId || 'Chưa xếp kệ'}</b>
                        {l.productUnit ? ` · ĐVT: ${l.productUnit}` : ''}
                      </p>
                    </td>
                    {!blind && <td className="py-2 text-right text-gray-500 font-mono">{l.expectedQty ?? '—'}</td>}
                    <td className="py-2 text-right">
                      {l.actualQty != null && !open ? (
                        <span className="font-bold font-mono text-gray-800">{l.actualQty}</span>
                      ) : open ? (
                        <input
                          type="number"
                          min={0}
                          step="any"
                          placeholder={l.actualQty?.toString() || '0'}
                          value={actuals[l.id] ?? ''}
                          onChange={(e) => setActuals((a) => ({ ...a, [l.id]: e.target.value }))}
                          className="w-24 px-2 py-1.5 border border-gray-200 focus:border-emerald-500 rounded-lg text-sm text-right font-mono font-bold outline-none shadow-2xs"
                        />
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {v == null ? (
                        <span className="text-gray-300">—</span>
                      ) : v === 0 ? (
                        <span className="text-emerald-600 font-bold text-xs bg-emerald-50 px-2 py-0.5 rounded-full">Khớp</span>
                      ) : (
                        <span className={`font-bold text-xs px-2 py-0.5 rounded-full ${
                          v > 0 ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600'
                        }`}>
                          {v > 0 ? '+' : ''}{v}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {open && (
                        <input
                          type="checkbox"
                          checked={checked.includes(l.id)}
                          onChange={() => setChecked((c) => (c.includes(l.id) ? c.filter((x) => x !== l.id) : [...c, l.id]))}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {open && (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0 flex-wrap">
            <button
              onClick={submitActuals}
              disabled={busy}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60 shadow-sm cursor-pointer"
            >
              {busy ? 'Đang gửi...' : 'Gửi số đếm'}
            </button>
            {canManage && (
              <>
                <button
                  onClick={doRecount}
                  disabled={busy}
                  className="px-4 py-2 border border-gray-200 hover:bg-gray-100 rounded-xl font-bold text-sm text-gray-600 disabled:opacity-60 flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw size={14} />Yêu cầu kiểm lại
                </button>
                <button
                  onClick={doApprove}
                  disabled={busy || (count.lines || []).some((line) => line.actualQty == null)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm disabled:opacity-60 flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <CheckCircle2 size={14} />Duyệt chênh lệch
                </button>
                <button
                  onClick={doCancel}
                  disabled={busy}
                  className="px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-xl text-sm font-semibold cursor-pointer"
                >
                  Hủy đợt kiểm kê
                </button>
              </>
            )}
          </div>
        )}
        {open && (count.lines || []).some((line) => line.actualQty == null) && (
          <p className="px-6 pb-3 text-right text-xs text-amber-700">
            Còn {(count.lines || []).filter((line) => line.actualQty == null).length} dòng chưa nhập số đếm.
          </p>
        )}
      </div>

      {/* Modal Quét bằng Camera */}
      {showCameraScanner && (
        <ScannerModal
          title={`Quét kiểm kê thực địa: ${count.code || count.id.slice(0, 8)}`}
          onScanItem={async (code) => {
            await handleScanCode(code);
            return { success: true };
          }}
          onClose={() => setShowCameraScanner(false)}
        />
      )}
    </div>
  );
}

function CountCreateModal({ warehouses, onClose, onDone }: {
  warehouses: { id: string; name: string }[];
  onClose: () => void; onDone: () => Promise<void>;
}) {
  const [warehouseId, setWarehouseId] = useState('');
  const [blind, setBlind] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouseId) { setErr('Chọn kho kiểm kê.'); return; }
    setSaving(true); setErr('');
    try {
      await openStockCount({ warehouseId, blindCount: blind });
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Mở đợt thất bại (cần cấp TP).');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Mở đợt kiểm kê</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Kho</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
              <option value="">-- Chọn kho --</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} className="w-4 h-4 rounded border-gray-300" />
            Đếm mù (NV không thấy số hệ thống)
          </label>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
              {saving ? 'Đang mở...' : 'Mở đợt (chụp tồn hiện tại)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
