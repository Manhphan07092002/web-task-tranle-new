import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TriangleAlert, RefreshCw, AlertCircle, ChevronDown } from 'lucide-react';
import { Card } from '../../components/UI';
import { getStockBalances, getWarehouses, type StockBalanceRow, type Warehouse } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

const GROUPS: { purpose: string; label: string; hint: string; cls: string }[] = [
  { purpose: 'QUARANTINE', label: 'Chờ kiểm tra (cách ly)', hint: 'Return → cách ly → kiểm tra → SALEABLE / DAMAGED / trả NCC', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { purpose: 'WARRANTY', label: 'Bảo hành', hint: 'Giữ chờ đổi/trả bảo hành, không tính tồn bán được', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  { purpose: 'DAMAGED', label: 'Hàng lỗi', hint: 'Chờ thanh lý / trả nhà cung cấp', cls: 'bg-red-50 text-red-600 border-red-200' },
  { purpose: 'DEMO', label: 'Demo / trưng bày', hint: 'Hàng trưng bày, không bán', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
];

// Hàng ngoại lệ TP (§27): hàng không SALEABLE, NV chỉ xử lý bước được giao.
export default function ExceptionsPage({ deptKey }: { deptKey: DeptKey }) {
  const [rows, setRows] = useState<StockBalanceRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState('');

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [b, w] = await Promise.all([
        getStockBalances(warehouseId ? { warehouseId } : {}),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setRows(b.filter((r) => r.locationPurpose && r.locationPurpose !== 'SALEABLE' && ['QUARANTINE', 'WARRANTY', 'DAMAGED', 'DEMO'].includes(r.locationPurpose)));
      setWarehouses(w);
    } catch (e: any) {
      setError(e.message || 'Không tải được hàng ngoại lệ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [warehouseId]);

  const counts = useMemo(() => GROUPS.map((g) => ({
    ...g,
    lines: rows.filter((r) => r.locationPurpose === g.purpose).length,
    qty: rows.filter((r) => r.locationPurpose === g.purpose).reduce((s, r) => s + Number(r.onHand), 0),
  })), [rows]);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kho vận · Kiểm soát</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Hàng ngoại lệ</h1>
          <p className="text-gray-500 text-sm mt-1">Hàng trả về không tự trở lại bán được — phải qua kiểm tra.</p>
        </div>
        <div className="flex gap-2">
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
          <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải hàng ngoại lệ...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {counts.map((g) => {
            const lines = rows.filter((r) => r.locationPurpose === g.purpose).slice(0, 6);
            return (
              <Card key={g.purpose} className="p-5">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="font-bold text-gray-800 text-sm uppercase tracking-wider">{g.label}</h2>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${g.cls}`}>{g.lines} dòng · {g.qty.toLocaleString('vi-VN')}</span>
                </div>
                <p className="text-xs text-gray-400 mb-3">{g.hint}</p>
                {lines.length === 0 ? (
                  <p className="text-sm text-gray-300">Không có hàng nhóm này.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {lines.map((r) => (
                      <li key={`${r.productId}|${r.warehouseId}|${r.locationId}`} className="flex items-center gap-2 text-sm">
                        <TriangleAlert size={13} className="text-gray-300 flex-shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-gray-700">{r.productName || r.productId}</span>
                        <span className="text-xs text-gray-400">{r.warehouseName || ''}{r.locationCode ? ` · ${r.locationCode}` : ''}</span>
                        <span className="font-black text-gray-900 text-xs">×{Number(r.onHand).toLocaleString('vi-VN')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}
