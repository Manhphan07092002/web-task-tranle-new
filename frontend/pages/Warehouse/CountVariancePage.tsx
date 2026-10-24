import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Scale, RefreshCw, AlertCircle } from 'lucide-react';
import { Card } from '../../components/UI';
import { Pagination } from '../../components/Pagination';
import { getStockCountVariances, type StockCount } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

// Trang riêng cho chênh lệch: chỉ đọc các đợt đã có dòng lệch, không thay thế màn Kiểm kê.
export default function CountVariancePage({ deptKey }: { deptKey: DeptKey }) {
  const [rows, setRows] = useState<StockCount[]>([]); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const load = async () => { setLoading(true); setError(null); try { const data = await getStockCountVariances({ limit: pageSize + 1, offset: (page - 1) * pageSize }); setHasMore(data.length > pageSize); setRows(data.slice(0, pageSize)); } catch (e: any) { setError(e.message || 'Không tải được chênh lệch kiểm kê'); } finally { setLoading(false); } };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, pageSize]);
  const visible = rows;
  return <div className="w-full max-w-[1400px] mx-auto space-y-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kho vận · Phê duyệt</p><h1 className="text-2xl font-bold text-gray-800 mt-1">Chênh lệch kiểm kê</h1><p className="text-gray-500 text-sm mt-1">Các đợt có số thực tế khác số snapshot; mở chi tiết để kiểm tra và duyệt.</p></div><button onClick={load} className="p-2.5 border border-gray-200 rounded-xl text-gray-500"><RefreshCw size={16} /></button></div>{error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={15} /> {error}</div>}{loading ? <p className="py-20 text-center text-gray-400">Đang tải...</p> : <Card className="overflow-hidden"><table className="wh-table w-full text-sm"><thead className="bg-gray-50"><tr><th className="text-left p-3">Đợt kiểm kê</th><th className="text-left p-3">Kho</th><th className="text-right p-3">Dòng lệch</th><th className="text-right p-3">Trạng thái</th></tr></thead><tbody className="divide-y divide-gray-50">{visible.map((r) => <tr key={r.id}><td className="p-3 font-mono font-bold">{r.code || r.id.slice(0, 8)}</td><td className="p-3">{r.warehouseName || r.warehouseId}</td><td className="p-3 text-right font-bold text-amber-700">{r.varianceLines}</td><td className="p-3 text-right"><Link to={`/dept/warehouse?m=wh_count&countId=${encodeURIComponent(r.id)}`} className="text-emerald-700 font-bold hover:underline">Mở kiểm kê</Link></td></tr>)}</tbody></table>{visible.length === 0 && <div className="p-10 text-center text-gray-400"><Scale className="mx-auto mb-2 opacity-30" />Không có chênh lệch kiểm kê.</div>}</Card>}{!loading && rows.length > 0 && <Pagination currentPage={page} totalPages={hasMore ? page + 1 : page} onPageChange={setPage} itemsPerPage={pageSize} onItemsPerPageChange={(s) => { setPageSize(s); setPage(1); }} />}<Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">← Về tổng quan kho vận</Link></div>;
}
