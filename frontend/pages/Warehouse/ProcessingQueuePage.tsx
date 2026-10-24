import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardList, RefreshCw, Search } from 'lucide-react';
import { Card } from '../../components/UI';
import { Pagination } from '../../components/Pagination';
import {
  getProcessingSummary,
  getStockDocuments,
  getStockCounts,
  getStockDocument,
  getStockCount,
  getWarehouses,
  type ProcessingSummary,
  type StockDocument,
  type StockCount,
  type Warehouse,
} from '../../services/stockService';
import { getDeptHomePath, getDeptModulePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';
import { useNavigate, useSearchParams } from 'react-router-dom';

const STORAGE_KEY = 'wh_processing_state';

const TYPES = [
  { id: 'RECEIPT', label: 'Nhập kho', code: 'PNK', module: 'wh_receipt' },
  { id: 'ISSUE', label: 'Xuất kho', code: 'PXK', module: 'wh_issue' },
  { id: 'TRANSFER', label: 'Điều chuyển', code: 'DCK', module: 'wh_transfer' },
  { id: 'RETURN', label: 'Trả hàng', code: 'PTH', module: 'wh_return' },
  { id: 'COUNT', label: 'Kiểm kê', code: 'PKK', module: 'wh_count' },
] as const;

function typeMeta(docType: string) {
  return TYPES.find((item) => item.id === docType) || { id: docType, label: docType, code: '', module: 'wh_receipt' };
}

function statusLabel(status: string): string {
  if (status === 'PROCESSING') return 'Đang xử lý';
  if (status === 'DRAFT') return 'Phiếu nháp';
  if (status === 'READY') return 'Sẵn sàng hoàn tất';
  return status;
}

function loadSavedState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function ProcessingQueuePage({ deptKey }: { deptKey: DeptKey }) {
  const [params] = useSearchParams();
  const documentId = params.get('documentId');
  return <ProcessingQueueList deptKey={deptKey} documentId={documentId} />;
}

function ProcessingQueueList({ deptKey, documentId }: { deptKey: DeptKey; documentId: string | null }) {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<StockDocument[]>([]);
  const [summary, setSummary] = useState<ProcessingSummary>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const savedState = useMemo(() => loadSavedState(), []);
  const [query, setQuery] = useState(savedState?.query || '');
  const [typeFilter, setTypeFilter] = useState(savedState?.typeFilter || 'ALL');
  const [warehouseFilter, setWarehouseFilter] = useState(savedState?.warehouseFilter || 'ALL');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [page, setPage] = useState(savedState?.page || 1);
  const [pageSize, setPageSize] = useState(savedState?.pageSize || 10);

  // Lưu bộ lọc & phân trang vào sessionStorage để giữ nguyên khi quay lại
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ query, typeFilter, warehouseFilter, page, pageSize }));
  }, [query, typeFilter, warehouseFilter, page, pageSize]);

  // Nếu người dùng truy cập trực tiếp bằng URL có ?documentId=xxx, tự động điều hướng sang trang gốc tương ứng
  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    const redirectTarget = async () => {
      try {
        const doc = await getStockDocument(documentId);
        if (cancelled) return;
        const meta = typeMeta(doc.docType);
        navigate(getDeptModulePath(deptKey, meta.module || 'wh_receipt', { documentId: doc.id, from: 'wh_processing' }), { replace: true });
      } catch {
        try {
          const count = await getStockCount(documentId);
          if (cancelled) return;
          navigate(getDeptModulePath(deptKey, 'wh_count', { documentId: count.id, from: 'wh_processing' }), { replace: true });
        } catch {
          // Phiếu không tồn tại hoặc lỗi mạng, giữ ở trang hiện tại
        }
      }
    };
    redirectTarget();
    return () => { cancelled = true; };
  }, [documentId, deptKey, navigate]);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [results, warehouseRows, countRows] = await Promise.all([
        Promise.all(TYPES.filter((t) => t.id !== 'COUNT').map(async (type) => {
          const [items, progress] = await Promise.all([
            getStockDocuments({ docType: type.id }),
            getProcessingSummary({ docType: type.id }).catch(() => ({} as ProcessingSummary)),
          ]);
          return { items, progress };
        })),
        getWarehouses().catch(() => [] as Warehouse[]),
        getStockCounts(undefined, 'COUNTING').catch(() => [] as StockCount[]),
      ]);

      const baseDocs = results.flatMap((result) => result.items);
      const baseSummary: ProcessingSummary = Object.assign({}, ...results.map((result) => result.progress));

      // Bổ sung các phiếu kiểm kê đang diễn ra (COUNTING) vào danh sách xử lý
      const countDocs: StockDocument[] = countRows.map((c) => ({
        id: c.id,
        code: c.code || null,
        docType: 'COUNT' as any,
        warehouseId: c.warehouseId,
        sourceWarehouseId: null,
        destWarehouseId: null,
        warehouseName: c.warehouseName || null,
        partnerName: null,
        status: 'PROCESSING',
        createdAt: c.createdAt,
        lines: c.lines as any,
      }));

      countRows.forEach((c) => {
        const total = c.lines?.length || 0;
        const done = (c.lines || []).filter((l) => l.actualQty != null).length;
        baseSummary[c.id] = { total, done };
      });

      setDocs([...baseDocs, ...countDocs]);
      setSummary(baseSummary);
      setWarehouses(warehouseRows);
    } catch (e: any) {
      setError(e.message || 'Không tải được danh sách phiếu cần xử lý.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const pending = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return docs
      .filter((doc) => doc.status === 'DRAFT' || doc.status === 'PROCESSING' || doc.status === 'READY')
      .filter((doc) => typeFilter === 'ALL' || doc.docType === typeFilter)
      .filter((doc) => warehouseFilter === 'ALL'
        || (doc.docType === 'TRANSFER'
          ? doc.sourceWarehouseId === warehouseFilter || doc.destWarehouseId === warehouseFilter
          : doc.warehouseId === warehouseFilter))
      .filter((doc) => !needle || [doc.code, doc.partnerName, doc.warehouseName, doc.id].some((value) => String(value || '').toLowerCase().includes(needle)))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [docs, query, typeFilter, warehouseFilter]);

  const totalPages = Math.max(1, Math.ceil(pending.length / pageSize));
  const visiblePending = pending.slice((page - 1) * pageSize, page * pageSize);

  // Điều hướng người dùng tới trang nghiệp vụ gốc tương ứng (Nhập/Xuất/Điều chuyển/Trả hàng/Kiểm kê)
  const navigateToDoc = (doc: StockDocument) => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ query, typeFilter, warehouseFilter, page, pageSize }));
    const meta = typeMeta(doc.docType);
    const targetModule = meta.module || 'wh_receipt';
    navigate(getDeptModulePath(deptKey, targetModule, { documentId: doc.id, from: 'wh_processing' }));
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Vận hành</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Xử lý phiếu</h1>
          <p className="text-sm text-gray-500 mt-1">Nơi tổng hợp các phiếu đang chờ xử lý số lượng, quét Serial/Lô hoặc hoàn tất tồn kho.</p>
        </div>
        <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm cursor-pointer" title="Tải lại">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="flex flex-col lg:flex-row items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3.5 top-3 text-gray-400" size={16} />
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder="Tìm mã phiếu, đối tác, kho..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-emerald-200 outline-none shadow-xs"
          />
        </div>
        <div className="grid grid-cols-2 lg:flex lg:items-center gap-2">
          <select
            aria-label="Lọc loại phiếu"
            value={typeFilter}
            onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}
            className="w-full lg:w-44 px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-xs sm:text-sm text-gray-700 outline-none shadow-xs focus:border-emerald-400 cursor-pointer"
          >
            <option value="ALL">Tất cả phiếu</option>
            {TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
          </select>
          <select
            aria-label="Lọc kho"
            value={warehouseFilter}
            onChange={(event) => { setWarehouseFilter(event.target.value); setPage(1); }}
            className="w-full lg:w-56 px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-xs sm:text-sm text-gray-700 outline-none shadow-xs focus:border-emerald-400 cursor-pointer truncate"
          >
            <option value="ALL">Tất cả kho</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
        </div>
        {(typeFilter !== 'ALL' || warehouseFilter !== 'ALL' || query) && (
          <button
            type="button"
            onClick={() => { setQuery(''); setTypeFilter('ALL'); setWarehouseFilter('ALL'); setPage(1); }}
            className="px-3 py-2 text-xs sm:text-sm text-gray-500 hover:text-emerald-700 font-medium whitespace-nowrap cursor-pointer text-center"
          >
            Xóa lọc
          </button>
        )}
      </div>

      {error && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={15} />{error}</div>}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3"><div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" /><p className="text-gray-400 text-sm">Đang tải phiếu cần xử lý...</p></div>
      ) : pending.length === 0 ? (
        <Card className="py-16 text-center text-gray-400"><CheckCircle2 size={36} className="mx-auto mb-3 opacity-30" /><p className="font-medium">Không có phiếu nào đang chờ xử lý</p><p className="text-sm mt-1">Phiếu mới tạo sẽ xuất hiện tại đây.</p></Card>
      ) : (
        <div>
          {/* Giao diện Dạng Thẻ tối ưu riêng cho Điện thoại & Màn hình di động */}
          <div className="sm:hidden space-y-3">
            {visiblePending.map((doc) => {
              const meta = typeMeta(doc.docType);
              const progress = summary[doc.id];
              const ready = progress && progress.total > 0 && progress.done >= progress.total;
              const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
              return (
                <div
                  key={doc.id}
                  onClick={() => navigateToDoc(doc)}
                  className="bg-white rounded-2xl border border-gray-200/90 p-4 shadow-xs active:bg-emerald-50/30 transition-all cursor-pointer space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-gray-900 font-mono text-base">{doc.code || doc.id.slice(0, 8)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {doc.createdAt ? new Date(doc.createdAt).toLocaleString('vi-VN') : '—'}
                      </p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      ready ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      {ready ? statusLabel('READY') : statusLabel(doc.status)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
                    <span className="inline-flex items-center gap-1 font-semibold px-2 py-0.5 bg-gray-100 rounded-lg text-gray-700">
                      <ClipboardList size={12} className="text-emerald-600" />
                      {meta.label}
                    </span>
                    <span className="text-gray-400">•</span>
                    <span className="truncate font-medium">{doc.warehouseName || doc.sourceWarehouseName || doc.warehouseId || '—'}</span>
                    {doc.partnerName && (
                      <>
                        <span className="text-gray-400">•</span>
                        <span className="text-gray-500 truncate">{doc.partnerName}</span>
                      </>
                    )}
                  </div>

                  {/* Tiến độ xử lý */}
                  <div className="space-y-1.5 pt-1 border-t border-gray-100">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500 font-medium">Tiến độ xác nhận:</span>
                      {progress ? (
                        <span className={`font-bold font-mono ${ready ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {progress.done}/{progress.total} dòng
                        </span>
                      ) : (
                        <span className="text-gray-400">Chưa xử lý</span>
                      )}
                    </div>
                    {progress && progress.total > 0 && (
                      <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${ready ? 'bg-emerald-500' : 'bg-amber-500'}`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateToDoc(doc);
                    }}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-colors shadow-2xs cursor-pointer flex items-center justify-center gap-1.5 min-h-[42px]"
                  >
                    <span>{ready ? 'Xem chi tiết phiếu' : progress && progress.done > 0 ? 'Tiếp tục xử lý hàng' : 'Bắt đầu xử lý hàng'}</span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Giao diện Bảng hiển thị trên Máy tính bảng & Màn hình lớn */}
          <Card className="hidden sm:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="wh-table w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Phiếu</th>
                    <th className="text-left py-2 px-3 text-xs font-bold text-gray-500 uppercase">Loại</th>
                    <th className="text-left py-2 px-3 text-xs font-bold text-gray-500 uppercase">Kho / Đối tác</th>
                    <th className="text-center py-2 px-3 text-xs font-bold text-gray-500 uppercase">Tiến độ</th>
                    <th className="text-center py-2 px-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                    <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {visiblePending.map((doc) => {
                    const meta = typeMeta(doc.docType);
                    const progress = summary[doc.id];
                    const ready = progress && progress.total > 0 && progress.done >= progress.total;
                    return (
                      <tr
                        key={doc.id}
                        onClick={() => navigateToDoc(doc)}
                        className="hover:bg-emerald-50/50 cursor-pointer transition-colors group"
                        title="Bấm để chuyển đến trang nghiệp vụ và mở chi tiết phiếu"
                      >
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateToDoc(doc);
                            }}
                            className="font-bold text-gray-800 group-hover:text-emerald-700 font-mono text-[13px] hover:underline text-left block cursor-pointer"
                          >
                            {doc.code || doc.id.slice(0, 8)}
                          </button>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {doc.createdAt ? new Date(doc.createdAt).toLocaleString('vi-VN') : '—'}
                          </p>
                        </td>
                        <td className="py-3 px-3 text-xs text-gray-600">
                          <span className="inline-flex items-center gap-1 font-medium">
                            <ClipboardList size={13} className="text-emerald-600" />
                            {meta.label}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs text-gray-600">
                          <p className="font-medium text-gray-700">{doc.warehouseName || doc.sourceWarehouseName || doc.warehouseId || '—'}</p>
                          <p className="text-gray-400">{doc.partnerName || (doc.destWarehouseName ? `→ ${doc.destWarehouseName}` : '—')}</p>
                        </td>
                        <td className="py-3 px-3 text-center text-xs">
                          {progress ? (
                            <span className={ready ? 'font-bold text-emerald-700' : 'text-amber-700'}>
                              {progress.done}/{progress.total} dòng
                            </span>
                          ) : (
                            <span className="text-gray-400">Chưa xử lý</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                          }`}>
                            {ready ? statusLabel('READY') : statusLabel(doc.status)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateToDoc(doc);
                            }}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer"
                          >
                            {ready ? 'Xem chi tiết' : progress && progress.done > 0 ? 'Tiếp tục xử lý' : 'Xử lý hàng hóa'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
      {!loading && pending.length > 0 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
          totalItems={pending.length}
          itemsPerPage={pageSize}
          onItemsPerPageChange={(size) => { setPageSize(size); setPage(1); }}
        />
      )}

      <a href={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">← Về tổng quan kho vận</a>
    </div>
  );
}
