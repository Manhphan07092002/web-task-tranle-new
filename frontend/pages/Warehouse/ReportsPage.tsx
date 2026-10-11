import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, RefreshCw, AlertCircle, ChevronDown } from 'lucide-react';
import { Card } from '../../components/UI';
import { getStockBalances, getStockMoves, getWarehouses, type Warehouse } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

const PERIODS = [
  { days: 7, label: '7 ngày' },
  { days: 30, label: '30 ngày' },
  { days: 90, label: '90 ngày' },
];

// Báo cáo kho (§30.1–30.2): Nhập–Xuất–Tồn theo kỳ + tồn theo kho.
// moves: RECEIPT/TRANSFER_IN (+), ISSUE/TRANSFER_OUT (−).
export default function WarehouseReportsPage({ deptKey }: { deptKey: DeptKey }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [nxt, setNxt] = useState<{ warehouseId: string; warehouseName: string; inbound: number; outbound: number }[]>([]);
  const [stock, setStock] = useState<{ warehouseId: string; warehouseName: string; sku: number; onHand: number; reserved: number; available: number }[]>([]);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const since = Date.now() - days * 86_400_000;
      const [moves, balances, w] = await Promise.all([
        getStockMoves(),
        getStockBalances(),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setWarehouses(w);
      const inWindow = moves.filter((m) => new Date(m.createdAt).getTime() >= since);
      const byWh = new Map<string, { inbound: number; outbound: number }>();
      for (const m of inWindow) {
        const qty = Number(m.quantity) || 0;
        const slot = byWh.get(m.warehouseId) || { inbound: 0, outbound: 0 };
        if (qty >= 0) slot.inbound += qty;
        else slot.outbound += -qty;
        byWh.set(m.warehouseId, slot);
      }
      const wName = (id: string) => w.find((x) => x.id === id)?.name || id;
      setNxt([...byWh.entries()].map(([warehouseId, v]) => ({ warehouseId, warehouseName: wName(warehouseId), ...v })));

      const byStock = new Map<string, { sku: Set<string>; onHand: number; reserved: number }>();
      for (const b of balances) {
        const slot = byStock.get(b.warehouseId) || { sku: new Set<string>(), onHand: 0, reserved: 0 };
        slot.sku.add(b.productId);
        slot.onHand += Number(b.onHand) || 0;
        slot.reserved += Number(b.reserved) || 0;
        byStock.set(b.warehouseId, slot);
      }
      setStock([...byStock.entries()].map(([warehouseId, v]) => ({
        warehouseId, warehouseName: wName(warehouseId),
        sku: v.sku.size, onHand: v.onHand, reserved: v.reserved, available: v.onHand - v.reserved,
      })));
    } catch (e: any) {
      setError(e.message || 'Không tải được báo cáo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days]);

  const totals = useMemo(() => ({
    inbound: nxt.reduce((s, r) => s + r.inbound, 0),
    outbound: nxt.reduce((s, r) => s + r.outbound, 0),
    sku: stock.reduce((s, r) => s + r.sku, 0),
    available: stock.reduce((s, r) => s + r.available, 0),
  }), [nxt, stock]);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Báo cáo</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Nhập – Xuất – Tồn</h1>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}
              className="pl-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">
              {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
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
          <p className="text-gray-400 text-sm">Đang tải báo cáo...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: `Nhập (${days} ngày)`, value: totals.inbound },
              { label: `Xuất (${days} ngày)`, value: totals.outbound },
              { label: 'SKU đang tồn', value: totals.sku },
              { label: 'Khả dụng', value: totals.available },
            ].map((s) => (
              <Card key={s.label} className="p-4">
                <p className="text-xl font-black text-gray-900">{s.value.toLocaleString('vi-VN')}</p>
                <p className="text-xs text-gray-500">{s.label}</p>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 font-bold text-gray-700 text-sm flex items-center gap-2">
              <BarChart3 size={15} /> Tồn theo kho
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="py-2.5 px-5">Kho</th>
                    <th className="py-2.5 px-4 text-right">Nhập</th>
                    <th className="py-2.5 px-4 text-right">Xuất</th>
                    <th className="py-2.5 px-4 text-right">SKU</th>
                    <th className="py-2.5 px-5 text-right">Khả dụng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {stock.length === 0 && (
                    <tr><td colSpan={5} className="py-10 text-center text-gray-400">Chưa có số liệu tồn.</td></tr>
                  )}
                  {stock.map((r) => {
                    const flow = nxt.find((n) => n.warehouseId === r.warehouseId);
                    return (
                      <tr key={r.warehouseId} className="hover:bg-gray-50/70">
                        <td className="py-2.5 px-5 font-semibold text-gray-800">{r.warehouseName}</td>
                        <td className="py-2.5 px-4 text-right text-emerald-600 font-bold">+{(flow?.inbound || 0).toLocaleString('vi-VN')}</td>
                        <td className="py-2.5 px-4 text-right text-rose-500 font-bold">−{(flow?.outbound || 0).toLocaleString('vi-VN')}</td>
                        <td className="py-2.5 px-4 text-right text-gray-500">{r.sku}</td>
                        <td className="py-2.5 px-5 text-right font-black text-gray-900">{r.available.toLocaleString('vi-VN')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}
