import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardList, RefreshCw, Search } from 'lucide-react';
import { Card } from '../../components/UI';
import { Pagination } from '../../components/Pagination';
import {
  getProcessingSummary,
  getStockDocuments,
  getWarehouses,
  type ProcessingSummary,
  type StockDocument,
  type Warehouse,
} from '../../services/stockService';
import { getDeptHomePath, getDeptModulePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';
import { useNavigate, useSearchParams } from 'react-router-dom';
import SerialDocMode from './SerialDocMode';

const TYPES = [
  { id: 'RECEIPT', label: 'Nhập kho', code: 'PNK' },
  { id: 'ISSUE', label: 'Xuất kho', code: 'PXK' },
  { id: 'TRANSFER', label: 'Điều chuyển', code: 'DCK' },
  { id: 'RETURN', label: 'Trả hàng', code: 'PTH' },
] as const;

function typeMeta(docType: string) {
  return TYPES.find((item) => item.id === docType) || { id: docType, label: docType, code: '' };
}

function statusLabel(status: string): string {
  if (status === 'PROCESSING') return 'Đang xử lý';
  if (status === 'DRAFT') return 'Phiếu nháp';
  if (status === 'READY') return 'Sẵn sàng hoàn tất';
  return status;
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
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [warehouseFilter, setWarehouseFilter] = useState('ALL');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [results, warehouseRows] = await Promise.all([
        Promise.all(TYPES.map(async (type) => {
          const [items, progress] = await Promise.all([
            getStockDocuments({ docType: type.id }),
            getProcessingSummary({ docType: type.id }).catch(() => ({} as ProcessingSummary)),
          ]);
          return { items, progress };
        })),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setDocs(results.flatMap((result) => result.items));
      setSummary(Object.assign({}, ...results.map((result) => result.progress)));
      setWarehouses(warehouseRows);
    } catch (e: any) {
      setError(e.message || 'Không tải được danh sách phiếu cần xử lý.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { setPage(1); }, [query, typeFilter, warehouseFilter]);

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

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Vận hành</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Xử lý phiếu</h1>
          <p className="text-sm text-gray-500 mt-1">Các phiếu cần xác nhận số lượng, Serial/Lô hoặc hoàn tất ghi nhận tồn kho.</p>
        </div>
        <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="flex flex-col lg:flex-row items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3.5 top-3 text-gray-400" size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã phiếu, đối tác, kho..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-emerald-200 outline-none shadow-sm" />
        </div>
        <select aria-label="Lọc loại phiếu" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}
          className="lg:w-44 px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm text-gray-700 outline-none shadow-sm focus:border-emerald-400">
          <option value="ALL">Tất cả phiếu</option>
          {TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
        </select>
        <select aria-label="Lọc kho" value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)}
          className="lg:w-56 px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm text-gray-700 outline-none shadow-sm focus:border-emerald-400">
          <option value="ALL">Tất cả kho</option>
          {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
        </select>
        {(typeFilter !== 'ALL' || warehouseFilter !== 'ALL' || query) && (
          <button type="button" onClick={() => { setQuery(''); setTypeFilter('ALL'); setWarehouseFilter('ALL'); }}
            className="px-3 py-2.5 text-sm text-gray-500 hover:text-emerald-700 font-medium whitespace-nowrap">Xóa lọc</button>
        )}
      </div>

      {error && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={15} />{error}</div>}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3"><div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" /><p className="text-gray-400 text-sm">Đang tải phiếu cần xử lý...</p></div>
      ) : pending.length === 0 ? (
        <Card className="py-16 text-center text-gray-400"><CheckCircle2 size={36} className="mx-auto mb-3 opacity-30" /><p className="font-medium">Không có phiếu nào đang chờ xử lý</p><p className="text-sm mt-1">Phiếu mới tạo sẽ xuất hiện tại đây.</p></Card>
      ) : (
        <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="wh-table w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200"><tr>
            <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Phiếu</th>
            <th className="text-left py-2 px-3 text-xs font-bold text-gray-500 uppercase">Loại</th>
            <th className="text-left py-2 px-3 text-xs font-bold text-gray-500 uppercase">Kho / Đối tác</th>
            <th className="text-center py-2 px-3 text-xs font-bold text-gray-500 uppercase">Tiến độ</th>
            <th className="text-center py-2 px-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
            <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase">Thao tác</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">{visiblePending.map((doc) => {
            const meta = typeMeta(doc.docType);
            const progress = summary[doc.id];
            const ready = progress && progress.total > 0 && progress.done >= progress.total;
            return <tr key={doc.id} className="hover:bg-emerald-50/40">
              <td className="py-3 px-4"><p className="font-bold text-gray-800 font-mono text-[13px]">{doc.code || doc.id.slice(0, 8)}</p><p className="text-xs text-gray-400">{doc.createdAt ? new Date(doc.createdAt).toLocaleString('vi-VN') : '—'}</p></td>
              <td className="py-3 px-3 text-xs text-gray-600"><span className="inline-flex items-center gap-1"><ClipboardList size={13} />{meta.label}</span></td>
              <td className="py-3 px-3 text-xs text-gray-600"><p>{doc.warehouseName || doc.sourceWarehouseName || doc.warehouseId || '—'}</p><p className="text-gray-400">{doc.partnerName || (doc.destWarehouseName ? `→ ${doc.destWarehouseName}` : '—')}</p></td>
              <td className="py-3 px-3 text-center text-xs">{progress ? <span className={ready ? 'font-bold text-emerald-700' : 'text-amber-700'}>{progress.done}/{progress.total} dòng</span> : <span className="text-gray-400">Chưa xử lý</span>}</td>
              <td className="py-3 px-3 text-center"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{ready ? statusLabel('READY') : statusLabel(doc.status)}</span></td>
              <td className="py-3 px-4 text-right"><button onClick={() => navigate(getDeptModulePath(deptKey, 'wh_processing', { documentId: doc.id }))} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold">{ready ? 'Xem chi tiết' : progress && progress.done > 0 ? 'Tiếp tục xử lý' : 'Xử lý hàng hóa'}</button></td>
            </tr>;
          })}</tbody>
        </table></div></Card>
      )}
      {!loading && pending.length > 0 && <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} totalItems={pending.length} itemsPerPage={pageSize} onItemsPerPageChange={(size) => { setPageSize(size); setPage(1); }} />}

      <a href={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">← Về tổng quan kho vận</a>

      {documentId && (
        <SerialDocMode
          deptKey={deptKey}
          embedded
          onClosed={() => { navigate(getDeptModulePath(deptKey, 'wh_processing')); void fetchAll(); }}
        />
      )}
    </div>
  );
}
