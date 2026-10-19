import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, RefreshCw, AlertCircle, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Card } from '../../components/UI';
import { Pagination } from '../../components/Pagination';
import { getStockAlerts, getWarehouses, saveStockPolicy, type StockAlertRow, type Warehouse } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

function classify(r: StockAlertRow): { label: string; cls: string }[] {
  const out: { label: string; cls: string }[] = [];
  const available = Number(r.available);
  if (available <= 0) out.push({ label: 'Hết hàng', cls: 'bg-red-50 text-red-600 border-red-200' });
  if (Number(r.reorderPoint) > 0 && available < Number(r.reorderPoint)) {
    out.push({ label: 'Sắp hết (dưới điểm đặt)', cls: 'bg-amber-50 text-amber-700 border-amber-200' });
  } else if (Number(r.minStock) > 0 && available < Number(r.minStock)) {
    out.push({ label: 'Dưới tồn Min', cls: 'bg-amber-50 text-amber-700 border-amber-200' });
  }
  if (Number(r.maxStock) > 0 && Number(r.onHand) > Number(r.maxStock)) {
    out.push({ label: 'Vượt tồn Max', cls: 'bg-blue-50 text-blue-700 border-blue-200' });
  }
  return out;
}

// Trang Cảnh báo tồn kho TP (§26): hết / sắp hết / dưới Min / vượt Max,
// drill-down đặt Min/Max/reorder ngay trên từng dòng.
export default function AlertsPage({ deptKey }: { deptKey: DeptKey }) {
  const [rows, setRows] = useState<StockAlertRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [hasMore, setHasMore] = useState(false);
  const [editing, setEditing] = useState<Record<string, { minStock: string; maxStock: string; reorderPoint: string; leadTimeDays: string; saving: boolean; err: string }>>({});

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [a, w] = await Promise.all([
        getStockAlerts(warehouseId || undefined, { limit: pageSize + 1, offset: (page - 1) * pageSize }),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setHasMore(a.length > pageSize); setRows(a.slice(0, pageSize)); setWarehouses(w);
    } catch (e: any) {
      setError(e.message || 'Không tải được cảnh báo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [warehouseId, page, pageSize]);
  useEffect(() => { setPage(1); }, [warehouseId]);
  const visibleRows = rows;

  const keyOf = (r: StockAlertRow) => `${r.productId}|${r.warehouseId}`;

  const openEditor = (r: StockAlertRow) => {
    const k = keyOf(r);
    if (editing[k]) return;
    setEditing((e) => ({
      ...e,
      [k]: {
        minStock: String(r.minStock ?? 0), maxStock: String(r.maxStock ?? 0),
        reorderPoint: String(r.reorderPoint ?? 0), leadTimeDays: '0', saving: false, err: '',
      },
    }));
  };

  const saveEditor = async (r: StockAlertRow) => {
    const k = keyOf(r);
    const ed = editing[k];
    if (!ed) return;
    const body = {
      productId: r.productId, warehouseId: r.warehouseId,
      minStock: Number(ed.minStock) || 0, maxStock: Number(ed.maxStock) || 0,
      reorderPoint: Number(ed.reorderPoint) || 0, leadTimeDays: Number(ed.leadTimeDays) || 0,
    };
    if (body.maxStock > 0 && body.minStock > body.maxStock) {
      setEditing((e) => ({ ...e, [k]: { ...ed, err: 'Min không được vượt Max.' } }));
      return;
    }
    setEditing((prev) => ({ ...prev, [k]: { ...ed, saving: true, err: '' } }));
    try {
      await saveStockPolicy(body);
      setEditing((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
      await fetchAll();
    } catch (err: any) {
      setEditing((prev) => ({ ...prev, [k]: { ...ed, saving: false, err: err.message || 'Lưu thất bại.' } }));
    }
  };

  const counts = useMemo(() => {
    let out = 0, low = 0, over = 0;
    for (const r of rows) {
      const tags = classify(r).map((t) => t.label);
      if (tags.includes('Hết hàng')) out++;
      else if (tags.some((t) => t !== 'Vượt tồn Max')) low++;
      if (tags.includes('Vượt tồn Max')) over++;
    }
    return [
      { label: 'Hết hàng', value: out },
      { label: 'Sắp hết / dưới Min', value: low },
      { label: 'Vượt Max', value: over },
    ];
  }, [rows]);

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kho vận · Kiểm soát</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Cảnh báo tồn kho</h1>
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

      <div className="grid grid-cols-3 gap-3">
        {counts.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xl font-black text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </Card>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          <AlertCircle size={15} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải cảnh báo...</p>
        </div>
      ) : rows.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <Bell size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Không có cảnh báo tồn kho</p>
          <p className="text-sm mt-1">Mọi mặt hàng đều trong ngưỡng (hoặc chưa đặt Min/Max).</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-5 text-xs font-bold text-gray-500 uppercase">Sản phẩm / Kho</th>
                  <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase">Khả dụng</th>
                  <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase">Min / Đặt / Max</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Cảnh báo</th>
                  <th className="text-right py-2 px-5 text-xs font-bold text-gray-500 uppercase">Chính sách</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visibleRows.map((r) => {
                  const k = keyOf(r);
                  const ed = editing[k];
                  return (
                    <React.Fragment key={k}>
                      <tr className="hover:bg-gray-50/70">
                        <td className="py-2 px-5">
                          <p className="font-semibold text-gray-800">{r.productName || r.productId}</p>
                          <p className="text-xs text-gray-400">{r.warehouseName || r.warehouseId}</p>
                        </td>
                        <td className="py-2 px-4 text-right font-black text-gray-900">{Number(r.available).toLocaleString('vi-VN')}</td>
                        <td className="py-2 px-4 text-right text-xs text-gray-500">
                          {r.minStock ?? 0} / {r.reorderPoint ?? 0} / {r.maxStock ?? 0}
                        </td>
                        <td className="py-2 px-4">
                          <div className="flex flex-wrap gap-1">
                            {classify(r).map((t) => (
                              <span key={t.label} className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${t.cls}`}>{t.label}</span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 px-5 text-right">
                          <button onClick={() => openEditor(r)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                            <SlidersHorizontal size={13} />Đặt ngưỡng
                          </button>
                        </td>
                      </tr>
                      {ed && (
                        <tr className="bg-blue-50/40">
                          <td colSpan={5} className="px-5 py-2">
                            {ed.err && <p className="text-xs text-red-600 mb-2">{ed.err}</p>}
                            <div className="flex flex-wrap items-end gap-2">
                              {([['minStock', 'Min'], ['reorderPoint', 'Điểm đặt'], ['maxStock', 'Max'], ['leadTimeDays', 'Lead (ngày)']] as const).map(([f, label]) => (
                                <label key={f} className="text-xs text-gray-500">
                                  {label}
                                  <input type="number" min={0} value={(ed as any)[f]}
                                    onChange={(e) => setEditing((prev) => ({ ...prev, [k]: { ...ed, [f]: e.target.value } }))}
                                    className="ml-1.5 w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-sm outline-none" />
                                </label>
                              ))}
                              <button disabled={ed.saving} onClick={() => saveEditor(r)}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold disabled:opacity-60">
                                {ed.saving ? 'Đang lưu...' : 'Lưu'}
                              </button>
                              <button onClick={() => setEditing((prev) => { const n = { ...prev }; delete n[k]; return n; })}
                                className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg">
                                Đóng
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {!loading && rows.length > 0 && <Pagination currentPage={page} totalPages={hasMore ? page + 1 : page} onPageChange={setPage} itemsPerPage={pageSize} onItemsPerPageChange={(s) => { setPageSize(s); setPage(1); }} />}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}
