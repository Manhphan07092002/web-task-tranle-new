import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { History, RefreshCw, AlertCircle, ChevronDown, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, ClipboardCheck, Undo2, Download } from 'lucide-react';
import { Card } from '../../components/UI';
import { getStockMoves, getWarehouses, type StockMove, type Warehouse } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';
import { exportXlsx } from '../../utils/exportXlsx';
import { DocDetailModal } from './StockDocs/DocDetailModal';
import type { Kind } from './StockDocs/meta';

const MOVE_META: Record<string, { label: string; Icon: typeof History; cls: string }> = {
  RECEIPT: { label: 'Nhập kho', Icon: ArrowDownToLine, cls: 'bg-emerald-50 text-emerald-700' },
  ISSUE: { label: 'Xuất kho', Icon: ArrowUpFromLine, cls: 'bg-rose-50 text-rose-600' },
  TRANSFER_OUT: { label: 'Điều đi', Icon: ArrowLeftRight, cls: 'bg-blue-50 text-blue-700' },
  TRANSFER_IN: { label: 'Điều đến', Icon: ArrowLeftRight, cls: 'bg-indigo-50 text-indigo-700' },
  RETURN: { label: 'Trả hàng', Icon: Undo2, cls: 'bg-amber-50 text-amber-700' },
  ADJUSTMENT: { label: 'Điều chỉnh', Icon: ClipboardCheck, cls: 'bg-violet-50 text-violet-700' },
  RECOUNT_ADJUSTMENT: { label: 'Điều chỉnh kiểm kê', Icon: ClipboardCheck, cls: 'bg-violet-50 text-violet-700' },
  INTERNAL_MOVE: { label: 'Di chuyển nội bộ', Icon: ArrowLeftRight, cls: 'bg-slate-50 text-slate-700' },
  KIT_IN: { label: 'Lắp bộ', Icon: ArrowDownToLine, cls: 'bg-cyan-50 text-cyan-700' },
  KIT_OUT: { label: 'Tách bộ', Icon: ArrowUpFromLine, cls: 'bg-orange-50 text-orange-700' },
};

const MOVE_TYPES = ['RECEIPT', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN', 'ADJUSTMENT', 'RECOUNT_ADJUSTMENT', 'INTERNAL_MOVE', 'KIT_IN', 'KIT_OUT'];

// Lịch sử hàng hóa (§30.5): timeline moves theo kho/hàng/loại.
export default function MovesPage({ deptKey }: { deptKey: DeptKey }) {
  const [rows, setRows] = useState<StockMove[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [moveType, setMoveType] = useState('');
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<'all' | 'day' | 'month' | 'year'>('all');
  const [periodDate, setPeriodDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<{ id: string; kind: Kind } | null>(null);
  const PAGE_SIZE = 100;

  const periodRange = () => {
    if (period === 'all' || !periodDate) return {};
    const [year, month, day] = periodDate.split('-').map(Number);
    const start = period === 'year' ? new Date(year, 0, 1) : period === 'month' ? new Date(year, month - 1, 1) : new Date(year, month - 1, day);
    const end = period === 'year' ? new Date(year + 1, 0, 1) : period === 'month' ? new Date(year, month, 1) : new Date(year, month - 1, day + 1);
    return { from: start.toISOString(), to: end.toISOString() };
  };

  const fetchAll = async (append = false) => {
    if (append) setLoadingMore(true);
    else { setLoading(true); setError(null); }
    try {
      const movesParams = { warehouseId: warehouseId || undefined, moveType: moveType || undefined, q: q.trim() || undefined, ...periodRange(), limit: PAGE_SIZE, offset: append ? rows.length : 0 };
      if (append) {
        const m = await getStockMoves(movesParams);
        setRows((prev) => [...prev, ...m]);
        setHasMore(m.length === PAGE_SIZE);
      } else {
        const [m, w] = await Promise.all([
          getStockMoves(movesParams),
          (warehouses.length > 0 ? Promise.resolve(warehouses) : getWarehouses().catch(() => [] as Warehouse[])),
        ]);
        setRows(m); setWarehouses(w);
        setHasMore(m.length === PAGE_SIZE);
      }
    } catch (e: any) {
      if (!append) setError(e.message || 'Không tải được lịch sử');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [warehouseId, moveType, period, periodDate, q]);

  const filtered = rows;

  const summary = filtered.reduce((acc, row) => {
    const qty = Number(row.quantity) || 0;
    if (row.moveType === 'RECEIPT' || row.moveType === 'RETURN' || row.moveType === 'TRANSFER_IN') acc.inbound += Math.abs(qty);
    else if (row.moveType === 'ISSUE' || row.moveType === 'TRANSFER_OUT') acc.outbound += Math.abs(qty);
    else acc.adjustment += qty;
    if (row.moveType === 'TRANSFER_IN' || row.moveType === 'TRANSFER_OUT') acc.transfers += Math.abs(qty);
    return acc;
  }, { inbound: 0, outbound: 0, transfers: 0, adjustment: 0 });

  const exportHistory = () => {
    if (!filtered.length) return;
    const data = filtered.map((m) => ({
      'Thời gian': m.createdAt ? new Date(m.createdAt).toLocaleString('vi-VN') : '',
      'Loại giao dịch': MOVE_META[m.moveType]?.label || m.moveType,
      'Sản phẩm': m.productName || m.productId,
      'Số lượng': Number(m.quantity),
      'Kho': m.warehouseName || m.warehouseId,
      'Phiếu tham chiếu': m.referenceId || '',
      'Người thực hiện': m.createdByName || m.createdBy || '',
    }));
    void exportXlsx(data, `Lich_su_kho_van_${new Date().toISOString().slice(0, 10)}.xlsx`, 'Lịch sử kho vận');
  };

  const documentKind = (moveType: string): Kind => moveType === 'ISSUE' || moveType === 'TRANSFER_OUT' ? 'ISSUE' : moveType === 'TRANSFER_IN' ? 'TRANSFER' : 'RECEIPT';

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Báo cáo</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Lịch sử hàng hóa</h1>
          <p className="text-gray-500 text-sm mt-1">Mọi biến động tồn đều để lại dấu vết (100 dòng/trang).</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lọc theo hàng / người tạo..."
            className="px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm" />
          <div className="relative">
            <select value={moveType} onChange={(e) => setMoveType(e.target.value)}
              className="pl-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">
              <option value="">Mọi loại</option>
              {MOVE_TYPES.map((t) => <option key={t} value={t}>{MOVE_META[t]?.label || t}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
          </div>
          <select aria-label="Lịch sử theo" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}
            className="px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm">
            <option value="all">Tất cả thời gian</option><option value="day">Theo ngày</option><option value="month">Theo tháng</option><option value="year">Theo năm</option>
          </select>
          {period !== 'all' && <input aria-label="Ngày lọc lịch sử" type={period === 'year' ? 'number' : period === 'month' ? 'month' : 'date'} value={period === 'year' ? periodDate.slice(0, 4) : period === 'month' ? periodDate.slice(0, 7) : periodDate} min={period === 'year' ? '2000' : undefined} max={period === 'year' ? '2100' : undefined}
            onChange={(e) => setPeriodDate(period === 'year' ? `${e.target.value}-01-01` : period === 'month' ? `${e.target.value}-01` : e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm" />}
          <div className="relative">
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
              className="pl-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">
              <option value="">Tất cả kho (phạm vi của tôi)</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
          </div>
          <button onClick={() => fetchAll()} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
            <RefreshCw size={16} />
          </button>
          <button onClick={exportHistory} disabled={!filtered.length} className="flex items-center gap-1.5 px-3 py-2.5 border border-emerald-200 rounded-xl hover:bg-emerald-50 text-emerald-700 text-sm font-bold shadow-sm disabled:opacity-50" title="Xuất dữ liệu đang lọc">
            <Download size={15} /> Xuất Excel
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          <AlertCircle size={15} />{error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4"><p className="text-xs font-bold text-gray-400 uppercase">Nhập kho</p><p className="mt-1 text-xl font-black text-emerald-700">+{summary.inbound.toLocaleString('vi-VN')}</p></Card>
        <Card className="p-4"><p className="text-xs font-bold text-gray-400 uppercase">Xuất kho</p><p className="mt-1 text-xl font-black text-rose-600">-{summary.outbound.toLocaleString('vi-VN')}</p></Card>
        <Card className="p-4"><p className="text-xs font-bold text-gray-400 uppercase">Điều chuyển</p><p className="mt-1 text-xl font-black text-blue-700">{summary.transfers.toLocaleString('vi-VN')}</p></Card>
        <Card className="p-4"><p className="text-xs font-bold text-gray-400 uppercase">Điều chỉnh</p><p className={`mt-1 text-xl font-black ${summary.adjustment >= 0 ? 'text-violet-700' : 'text-rose-600'}`}>{summary.adjustment >= 0 ? '+' : ''}{summary.adjustment.toLocaleString('vi-VN')}</p></Card>
      </div>

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải lịch sử...</p>
        </div>
      ) : filtered.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <History size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Chưa có biến động nào</p>
        </Card>
      ) : (
        <Card className="p-5">
          <ol className="relative border-l-2 border-gray-100 ml-2 space-y-4">
            {filtered.map((m) => {
              const meta = MOVE_META[m.moveType] || { label: m.moveType, Icon: History, cls: 'bg-gray-100 text-gray-600' };
              const qty = Number(m.quantity);
              return (
                <li key={m.id} className={`ml-4 ${m.referenceId ? 'cursor-pointer rounded-lg hover:bg-gray-50' : ''}`} onClick={() => m.referenceId && setSelectedDocument({ id: m.referenceId, kind: documentKind(m.moveType) })} title={m.referenceId ? 'Bấm để xem phiếu liên quan' : undefined}>
                  <span className={`absolute -left-[9px] mt-0.5 w-4 h-4 rounded-full flex items-center justify-center ${meta.cls}`}>
                    <meta.Icon size={10} />
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-800 text-sm">{m.productName || m.productId}</span>
                    <span className={`text-xs font-black ${qty >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {qty >= 0 ? '+' : ''}{qty.toLocaleString('vi-VN')}
                    </span>
                    <span className="text-xs text-gray-400">{meta.label} · {m.warehouseName || m.warehouseId}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {m.createdAt ? new Date(m.createdAt).toLocaleString('vi-VN') : ''}{m.createdByName ? ` · bởi ${m.createdByName}` : ''}
                    {m.referenceId ? ` · ref ${m.referenceId.slice(0, 8)}` : ''}{m.serialId ? ` · Serial ${m.serialId}` : ''}{m.lotId ? ` · Lô ${m.lotId}` : ''}
                  </p>
                </li>
              );
            })}
          </ol>
          {hasMore && !q.trim() && (
            <div className="pt-4 text-center">
              <button onClick={() => fetchAll(true)} disabled={loadingMore}
                className="px-5 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 rounded-xl hover:bg-emerald-100 disabled:opacity-50">
                {loadingMore ? 'Đang tải...' : `Xem thêm (${rows.length} dòng)`}
              </button>
            </div>
          )}
        </Card>
      )}

      {selectedDocument && <DocDetailModal
        docId={selectedDocument.id}
        warehouses={warehouses}
        kind={selectedDocument.kind}
        readOnly
        onClose={() => setSelectedDocument(null)}
        onUpdated={async () => undefined}
        deptKey={deptKey}
      />}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}
