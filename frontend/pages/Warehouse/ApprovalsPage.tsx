import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, RefreshCw, AlertCircle, CheckCircle2, Truck, PackageCheck, ChevronDown } from 'lucide-react';
import { Card } from '../../components/UI';
import {
  getStockDocuments, getWarehouses, advanceDocument, advanceTransfer,
  type StockDocument, type Warehouse,
} from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

const TYPE_LABEL: Record<string, string> = { RECEIPT: 'Nhập kho', ISSUE: 'Xuất kho', TRANSFER: 'Điều chuyển' };

// Hàng chờ duyệt TP (§28.1): phiếu nháp + điều chuyển quá hạn/chờ nhận.
// Chênh lệch kiểm kê + điều chỉnh tồn thuộc Phase B (cần stock_counts).
export default function ApprovalsPage({ deptKey }: { deptKey: DeptKey }) {
  const [docs, setDocs] = useState<StockDocument[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState('');

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [d, w] = await Promise.all([
        getStockDocuments(warehouseId ? { warehouseId } : {}),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setDocs(d.filter((x) => x.status === 'DRAFT' || x.status === 'IN_TRANSIT'));
      setWarehouses(w);
    } catch (e: any) {
      setError(e.message || 'Không tải được hàng chờ duyệt');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [warehouseId]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setActingId(id); setError(null);
    try {
      await fn();
      await fetchAll();
    } catch (e: any) {
      setError(e.message || 'Thao tác thất bại');
    } finally {
      setActingId(null);
    }
  };

  const whName = (id: string | null) => warehouses.find((w) => w.id === id)?.name || id || '—';

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kho vận · Phê duyệt</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Chờ duyệt</h1>
          <p className="text-gray-500 text-sm mt-1">Phiếu nháp và điều chuyển đang đi trong phạm vi của bạn.</p>
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
          <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải hàng chờ...</p>
        </div>
      ) : docs.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <Inbox size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Không có gì chờ duyệt</p>
          <p className="text-sm mt-1">Mọi phiếu đã xử lý xong.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-5 text-xs font-bold text-gray-500 uppercase">Phiếu</th>
                  <th className="text-left py-3 px-4 text-xs font-bold text-gray-500 uppercase">Loại / Tuyến</th>
                  <th className="text-center py-3 px-4 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                  <th className="text-right py-3 px-5 text-xs font-bold text-gray-500 uppercase">Duyệt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {docs.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50/70">
                    <td className="py-3 px-5">
                      <p className="font-bold text-gray-800 font-mono text-[13px]">{d.code || d.id.slice(0, 8)}</p>
                      <p className="text-xs text-gray-400">{d.createdAt ? new Date(d.createdAt).toLocaleString('vi-VN') : ''}</p>
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-500">
                      {TYPE_LABEL[d.docType] || d.docType}
                      <span className="block text-gray-400">
                        {d.docType === 'TRANSFER'
                          ? `${whName(d.sourceWarehouseId)} → ${whName(d.destWarehouseId)}`
                          : whName(d.warehouseId)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${d.status === 'DRAFT' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                        {d.status === 'DRAFT' ? 'Nháp' : 'Đang vận chuyển'}
                      </span>
                    </td>
                    <td className="py-3 px-5">
                      <div className="flex justify-end gap-2">
                        {d.status === 'DRAFT' && d.docType !== 'TRANSFER' && (
                          <button disabled={actingId === d.id}
                            onClick={() => act(d.id, () => advanceDocument(d.docType === 'RECEIPT' ? 'receipts' : 'issues', d.id, 'complete'))}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-60">
                            {actingId === d.id ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}Duyệt hoàn tất
                          </button>
                        )}
                        {d.status === 'DRAFT' && d.docType === 'TRANSFER' && (
                          <button disabled={actingId === d.id} onClick={() => act(d.id, () => advanceTransfer(d.id, 'ship'))}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold disabled:opacity-60">
                            {actingId === d.id ? <RefreshCw size={13} className="animate-spin" /> : <Truck size={13} />}Duyệt gửi
                          </button>
                        )}
                        {d.status === 'IN_TRANSIT' && (
                          <button disabled={actingId === d.id} onClick={() => act(d.id, () => advanceTransfer(d.id, 'receive'))}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-60">
                            {actingId === d.id ? <RefreshCw size={13} className="animate-spin" /> : <PackageCheck size={13} />}Duyệt nhận
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}
