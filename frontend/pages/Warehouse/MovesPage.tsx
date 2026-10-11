import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { History, RefreshCw, AlertCircle, ChevronDown, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, ClipboardCheck, Undo2 } from 'lucide-react';
import { Card } from '../../components/UI';
import { getStockMoves, getWarehouses, type StockMove, type Warehouse } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

const MOVE_META: Record<string, { label: string; Icon: typeof History; cls: string }> = {
  RECEIPT: { label: 'Nhập kho', Icon: ArrowDownToLine, cls: 'bg-emerald-50 text-emerald-700' },
  ISSUE: { label: 'Xuất kho', Icon: ArrowUpFromLine, cls: 'bg-rose-50 text-rose-600' },
  TRANSFER_OUT: { label: 'Điều đi', Icon: ArrowLeftRight, cls: 'bg-blue-50 text-blue-700' },
  TRANSFER_IN: { label: 'Điều đến', Icon: ArrowLeftRight, cls: 'bg-indigo-50 text-indigo-700' },
  RETURN: { label: 'Trả hàng', Icon: Undo2, cls: 'bg-amber-50 text-amber-700' },
  ADJUSTMENT: { label: 'Điều chỉnh', Icon: ClipboardCheck, cls: 'bg-violet-50 text-violet-700' },
};

const MOVE_TYPES = ['RECEIPT', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN', 'ADJUSTMENT'];

// Lịch sử hàng hóa (§30.5): timeline moves theo kho/hàng/loại.
export default function MovesPage({ deptKey }: { deptKey: DeptKey }) {
  const [rows, setRows] = useState<StockMove[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [moveType, setMoveType] = useState('');
  const [q, setQ] = useState('');

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [m, w] = await Promise.all([
        getStockMoves({ warehouseId: warehouseId || undefined, moveType: moveType || undefined }),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setRows(m); setWarehouses(w);
    } catch (e: any) {
      setError(e.message || 'Không tải được lịch sử');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [warehouseId, moveType]);

  const filtered = q.trim()
    ? rows.filter((r) => `${r.productName || ''} ${r.productId} ${r.createdByName || ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    : rows;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Báo cáo</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Lịch sử hàng hóa</h1>
          <p className="text-gray-500 text-sm mt-1">Mọi biến động tồn đều để lại dấu vết (tối đa 500 dòng mới nhất).</p>
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
          <div className="relative">
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
              className="pl-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">
              <option value="">Tất cả kho (phạm vi của tôi)</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
          </div>
          <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
            <RefreshCw size={16} />
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
                <li key={m.id} className="ml-4">
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
                    {m.referenceId ? ` · ref ${m.referenceId.slice(0, 8)}` : ''}
                  </p>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}
