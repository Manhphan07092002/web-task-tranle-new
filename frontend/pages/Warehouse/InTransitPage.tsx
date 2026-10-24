import { ReceiveTransferButton } from './ReceiveTransferButton';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Truck, RefreshCw, AlertCircle, PackageCheck } from 'lucide-react';
import { Card } from '../../components/UI';
import { Pagination } from '../../components/Pagination';
import { getStockDocuments, advanceTransfer, type StockDocument } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

// Đang vận chuyển (§30.4): điều chuyển IN_TRANSIT + nút nhận.
export default function InTransitPage({ deptKey }: { deptKey: DeptKey }) {
  const [rows, setRows] = useState<StockDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [hasMore, setHasMore] = useState(false);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const data = await getStockDocuments({ docType: 'TRANSFER', status: 'IN_TRANSIT', limit: pageSize + 1, offset: (page - 1) * pageSize });
      setHasMore(data.length > pageSize); setRows(data.slice(0, pageSize));
    } catch (e: any) {
      setError(e.message || 'Không tải được điều chuyển');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/await-in-effect */ }, [page, pageSize]);

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kho vận · Báo cáo</p>
        <h1 className="text-2xl font-bold text-gray-800 mt-1">Đang vận chuyển</h1>
        <p className="text-gray-500 text-sm mt-1">Điều chuyển đã gửi, chờ kho nhận xác nhận.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          <AlertCircle size={15} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải...</p>
        </div>
      ) : rows.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <Truck size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Không có điều chuyển nào đang đi</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="wh-table w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-5 text-xs font-bold text-gray-500 uppercase">Mã phiếu</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Ngày gửi</th>
                  <th className="text-right py-2 px-5 text-xs font-bold text-gray-500 uppercase">Nhận hàng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50/70">
                    <td className="py-2 px-5 font-mono font-bold text-gray-800 text-[13px]">{d.code || d.id.slice(0, 8)}</td>
                    <td className="py-2 px-4 text-xs text-gray-400">{d.createdAt ? new Date(d.createdAt).toLocaleString('vi-VN') : ''}</td>
                    <td className="py-2 px-5 text-right">
                      <ReceiveTransferButton id={d.id} warehouseId={d.destWarehouseId!} onDone={fetchAll} />
                    </td>
                  </tr>
                ))}
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
