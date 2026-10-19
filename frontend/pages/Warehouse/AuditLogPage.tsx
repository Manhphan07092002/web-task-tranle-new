import React, { useEffect, useState } from 'react';
import { RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { Card } from '../../components/UI';
import { getWarehouseActivityLogs, type WarehouseActivityLog } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

const ACTION_LABELS: Record<string, string> = {
  DOCUMENT_CREATED: 'Tạo chứng từ', DOCUMENT_UPDATED: 'Sửa chứng từ', PROCESSING_COMPLETED: 'Hoàn tất xử lý',
  QUANTITY_CONFIRMED: 'Xác nhận số lượng', SERIAL_SCANNED_IN: 'Quét Serial nhập', SERIAL_SCANNED_OUT: 'Quét Serial xuất',
  SERIAL_EDITED: 'Sửa Serial', SERIAL_REMOVED: 'Xóa Serial', SERIAL_SKIPPED: 'Bỏ qua Serial',
  RECEIPT_COMPLETED: 'Hoàn tất nhập', ISSUE_COMPLETED: 'Hoàn tất xuất', TRANSFER_SHIPPED: 'Điều chuyển đi', TRANSFER_RECEIVED: 'Điều chuyển đến',
};

export default function AuditLogPage({ deptKey }: { deptKey: DeptKey }) {
  const [rows, setRows] = useState<WarehouseActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [actionType, setActionType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  const load = async () => {
    setLoading(true); setError(null);
    try { const data = await getWarehouseActivityLogs({ q: q.trim(), actionType, from, to, limit, offset: page * limit }); setRows(data.rows); setTotal(data.total); }
    catch (e: any) { setError(e.message || 'Không tải được nhật ký'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, actionType, from, to]);
  const submit = (e: React.FormEvent) => { e.preventDefault(); setPage(0); void load(); };
  const pages = Math.max(1, Math.ceil(total / limit));

  return <div className="w-full max-w-[1500px] mx-auto space-y-4">
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div><p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Kiểm soát</p><h1 className="text-2xl font-bold text-gray-800 mt-1">Audit Log kho vận</h1><p className="text-gray-500 text-sm mt-1">Theo dõi ai đã tạo, sửa, xử lý và ghi nhận biến động kho.</p></div>
      <button onClick={() => void load()} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
    </div>
    <Card className="p-4"><form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-5 gap-2">
      <label className="md:col-span-2 relative"><Search size={16} className="absolute left-3 top-3 text-gray-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm phiếu, sản phẩm, Serial, người thực hiện..." className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-200" /></label>
      <select value={actionType} onChange={e => setActionType(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl"><option value="">Mọi thao tác</option>{Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl" /><input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl" />
      <button className="md:col-span-5 justify-self-end px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm">Lọc nhật ký</button>
    </form></Card>
    {error && <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>}
    <Card className="overflow-hidden"><div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 text-sm font-bold text-gray-700"><ShieldCheck size={17} className="text-emerald-600" /> {total.toLocaleString('vi-VN')} bản ghi</div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr><th className="text-left p-3">Thời gian</th><th className="text-left p-3">Thao tác</th><th className="text-left p-3">Đối tượng</th><th className="text-left p-3">Phiếu / hàng hóa</th><th className="text-left p-3">Kho</th><th className="text-left p-3">Người thực hiện</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-gray-100"><td className="p-3 whitespace-nowrap text-gray-500">{new Date(row.createdAt).toLocaleString('vi-VN')}</td><td className="p-3 font-semibold text-gray-700">{ACTION_LABELS[row.actionType] || row.actionType}</td><td className="p-3">{row.entityType}<div className="text-xs text-gray-400">{row.entityId || '—'}</div></td><td className="p-3">{row.documentCode || row.documentId || '—'}<div className="text-xs text-gray-500">{row.productName || row.productId || ''}</div></td><td className="p-3">{row.warehouseName || '—'}</td><td className="p-3">{row.userName || '—'}</td></tr>)}</tbody></table>{!loading && rows.length === 0 && <div className="p-8 text-center text-gray-400">Chưa có nhật ký phù hợp.</div>}</div>
      <div className="p-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500"><span>Trang {page + 1}/{pages}</span><div className="flex gap-2"><button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40">Trước</button><button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40">Sau</button></div></div>
    </Card>
    <a className="text-emerald-600 text-sm" href={getDeptHomePath(deptKey) || '/'}>← Về tổng quan kho vận</a>
  </div>;
}
