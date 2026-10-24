import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, AlertCircle, RefreshCw, ChevronDown } from 'lucide-react';
import { Card } from '../../components/UI';
import { Pagination } from '../../components/Pagination';
import { getStockReport, type StockReportRow } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

const PERIODS = [{ days: 7, label: '7 ngày' }, { days: 30, label: '30 ngày' }, { days: 90, label: '90 ngày' }];

// Báo cáo riêng: tồn tổng hợp theo kho. Không gộp với Nhập – Xuất – Tồn.
export default function WarehouseStockReportPage({ deptKey }: { deptKey: DeptKey }) {
  const [rows, setRows] = useState<StockReportRow[]>([]);
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const to = new Date();
      setRows(await getStockReport(new Date(to.getTime() - days * 86400000).toISOString(), to.toISOString()));
    } catch (e: any) { setError(e.message || 'Không tải được báo cáo tồn theo kho'); }
    finally { setLoading(false); }
  };
  useEffect(() => { setPage(1); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days]);

  const grouped = useMemo(() => {
    const map = new Map<string, { warehouseId: string; warehouseName: string; opening: number; inbound: number; outbound: number; adjustment: number; closing: number; lines: number }>();
    rows.forEach((r) => {
      const current = map.get(r.warehouseId) || { warehouseId: r.warehouseId, warehouseName: r.warehouseName, opening: 0, inbound: 0, outbound: 0, adjustment: 0, closing: 0, lines: 0 };
      current.opening += Number(r.opening) || 0; current.inbound += Number(r.inbound) || 0; current.outbound += Number(r.outbound) || 0; current.adjustment += Number(r.adjustment) || 0; current.closing += Number(r.closing) || 0; current.lines += 1;
      map.set(r.warehouseId, current);
    });
    return [...map.values()].sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, 'vi'));
  }, [rows]);
  const totalPages = Math.max(1, Math.ceil(grouped.length / pageSize));
  const visible = grouped.slice((page - 1) * pageSize, page * pageSize);

  return <div className="w-full max-w-[1400px] mx-auto space-y-4">
    <div className="flex items-start justify-between gap-3 flex-wrap"><div><p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Báo cáo</p><h1 className="text-2xl font-bold text-gray-800 mt-1">Tồn theo kho</h1><p className="text-gray-500 text-sm mt-1">Tổng hợp tồn đầu, biến động và tồn cuối theo từng kho.</p></div><div className="flex gap-2"><div className="relative"><select value={days} onChange={(e) => setDays(Number(e.target.value))} className="pl-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">{PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}</select><ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} /></div><button onClick={load} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm"><RefreshCw size={16} /></button></div></div>
    {error && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={15} />{error}</div>}
    {loading ? <div className="flex flex-col items-center py-20 gap-3"><div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" /><p className="text-gray-400 text-sm">Đang tải báo cáo...</p></div> : <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="wh-table w-full text-sm"><thead className="bg-gray-50"><tr>{['Kho', 'Số dòng', 'Tồn đầu', 'Nhập', 'Xuất', 'Điều chỉnh', 'Tồn cuối'].map((x) => <th key={x} className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">{x}</th>)}</tr></thead><tbody className="divide-y divide-gray-50">{visible.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-gray-400"><BarChart3 className="mx-auto mb-2 opacity-30" />Chưa có dữ liệu.</td></tr> : visible.map((r) => <tr key={r.warehouseId}><td className="py-3 px-4 font-semibold text-gray-800">{r.warehouseName}</td><td className="py-3 px-4 text-gray-500">{r.lines}</td>{(['opening', 'inbound', 'outbound', 'adjustment', 'closing'] as const).map((k) => <td key={k} className="py-3 px-4 text-right tabular-nums">{r[k].toLocaleString('vi-VN')}</td>)}</tr>)}</tbody></table></div></Card>}
    {!loading && grouped.length > 0 && <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} totalItems={grouped.length} itemsPerPage={pageSize} onItemsPerPageChange={(s) => { setPageSize(s); setPage(1); }} />}
    <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">← Về tổng quan kho vận</Link>
  </div>;
}
