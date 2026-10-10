import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, ClipboardCheck,
  Package, TriangleAlert, Truck, CheckCircle2, Clock,
} from 'lucide-react';
import { Card } from '../../components/UI';
import { StatCard } from '../../components/StatCard';
import { useAuth } from '../../contexts/AuthContext';
import {
  getDashboardOverview, getWarehouses,
  type ManagerOverview, type StaffOverview, type Warehouse,
} from '../../services/stockMasterService';

const DOC_TYPE_LABELS: Record<string, string> = {
  RECEIPT: 'Nhập kho', ISSUE: 'Xuất kho', TRANSFER: 'Điều chuyển',
};
const DOC_STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Chờ xử lý', RECEIVING: 'Đang nhận', PICKING: 'Đang soạn',
  READY: 'Chờ bàn giao', IN_TRANSIT: 'Đang vận chuyển', RECEIVED: 'Chờ nhận',
};
const DOC_ROUTES: Record<string, string> = {
  RECEIPT: '/warehouse/receipts', ISSUE: '/warehouse/issues', TRANSFER: '/warehouse/transfers',
};

function todayLabel(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString('vi-VN', { weekday: 'long' });
  const date = now.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)}, ${date}`;
}

export default function WarehouseOverviewPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isManager = (user?.permissions || []).includes('stock.manage');
  const [data, setData] = useState<StaffOverview | ManagerOverview | { role: 'none' } | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [overview, wh] = await Promise.all([
        getDashboardOverview(isManager && warehouseId ? warehouseId : undefined),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setData(overview);
      setWarehouses(wh.filter((w) => w.isActive));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được tổng quan kho.');
    } finally {
      setLoading(false);
    }
  }, [isManager, warehouseId]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return <div className="max-w-7xl mx-auto p-8 text-center text-gray-400">Đang tải tổng quan kho...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100">
            {isManager ? 'Tổng quan kho' : 'Tổng quan của tôi'}
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">
            {isManager
              ? 'Toàn bộ hoạt động kho trong tầm nhìn 10–20 giây: tồn, chờ xử lý, cảnh báo.'
              : `Xin chào, ${user?.name || ''}! Hôm nay bạn cần xử lý những việc sau. • ${todayLabel()}`}
          </p>
        </div>
        {isManager && (
          <label className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-bold text-gray-600 dark:text-slate-300 shadow-sm">
            Kho
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="bg-transparent outline-none cursor-pointer"
              aria-label="Lọc theo kho"
            >
              <option value="">Tất cả kho</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error} <button onClick={load} className="font-bold underline ml-2">Thử lại</button>
        </div>
      )}

      {data && data.role === 'staff' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Cần nhập" value={data.kpis.pendingReceipts} icon={ArrowDownToLine} color="from-blue-500 to-blue-400" subtitle="phiếu được giao" />
            <StatCard label="Cần xuất" value={data.kpis.pendingIssues} icon={ArrowUpFromLine} color="from-emerald-500 to-emerald-400" subtitle="phiếu được giao" />
            <StatCard label="Điều chuyển" value={data.kpis.pendingTransfers} icon={ArrowLeftRight} color="from-orange-500 to-orange-400" subtitle="gửi / nhận" />
            <StatCard label="Kiểm kê" value={data.kpis.pendingCounts} icon={ClipboardCheck} color="from-purple-500 to-purple-400" subtitle="Phase B" />
          </div>

          <Card className="overflow-hidden p-0">
            <div className="p-4 border-b border-gray-100 dark:border-slate-700">
              <h2 className="font-bold text-gray-800 dark:text-slate-100">Việc cần xử lý hôm nay</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[680px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Loại</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Nội dung</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">SL</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hạn xử lý</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {data.todayTasks.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-gray-400">Hôm nay bạn không có việc tồn đọng. 🎉</td></tr>
                  ) : (
                    data.todayTasks.map((t) => (
                      <tr
                        key={t.id}
                        className="hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer"
                        onClick={() => navigate(DOC_ROUTES[t.type] || '/warehouse/stock')}
                      >
                        <td className="p-3 text-sm font-bold">{t.code}</td>
                        <td className="p-3 text-sm">{DOC_TYPE_LABELS[t.type] || t.type}</td>
                        <td className="p-3 text-sm">
                          {t.firstProduct || '-'}
                          <span className="block text-xs text-gray-400">
                            {t.lineCount} dòng • {t.warehouseCode}
                          </span>
                        </td>
                        <td className="p-3 text-sm text-center font-bold">{Number(t.qtyOrdered).toLocaleString('vi-VN')}</td>
                        <td className="p-3 text-sm">
                          <span className="px-2 py-1 rounded font-bold text-xs bg-blue-100 text-blue-700">
                            {DOC_STATUS_LABELS[t.status] || t.status}
                          </span>
                        </td>
                        <td className="p-3 text-sm">{t.dueDate || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {(data.alerts.overdue.length > 0 || data.alerts.awaitingTransfers.length > 0) && (
            <Card className="p-4">
              <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-2 flex items-center gap-2">
                <TriangleAlert size={16} className="text-amber-500" /> Cảnh báo của bạn
              </h2>
              <ul className="space-y-1.5 text-sm">
                {data.alerts.overdue.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-gray-700 dark:text-slate-200">
                    <Clock size={14} className="text-rose-500 shrink-0" />
                    Phiếu {a.code} quá hạn xử lý ({a.dueDate})
                  </li>
                ))}
                {data.alerts.awaitingTransfers.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-gray-700 dark:text-slate-200">
                    <Truck size={14} className="text-blue-500 shrink-0" />
                    Điều chuyển {a.code} đang về, cần xác nhận nhận{a.etaDate ? ` (ETA ${a.etaDate})` : ''}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {data && data.role === 'manager' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-4">
            <StatCard label="SKU đang tồn" value={data.kpis.skuCount} icon={Package} color="from-blue-500 to-blue-400" subtitle="mã có thực tồn" />
            <StatCard label="Sắp hết hàng" value={data.kpis.lowStock} icon={TriangleAlert} color="from-amber-500 to-amber-400" subtitle="dưới điểm đặt lại" alert={data.kpis.lowStock > 0} />
            <StatCard label="Hết hàng" value={data.kpis.outOfStock} icon={TriangleAlert} color="from-rose-500 to-rose-400" subtitle="khả dụng bằng 0" alert={data.kpis.outOfStock > 0} />
            <StatCard label="Chờ xuất" value={data.kpis.pendingIssues} icon={ArrowUpFromLine} color="from-emerald-500 to-emerald-400" subtitle="phiếu xuất mở" />
            <StatCard label="Đang vận chuyển" value={data.kpis.inTransit} icon={Truck} color="from-purple-500 to-purple-400" subtitle="điều chuyển" />
            <StatCard label="Chênh lệch chưa xử lý" value={data.kpis.openVariances} icon={ClipboardCheck} color="from-orange-500 to-orange-400" subtitle="Phase B" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card className="overflow-hidden p-0">
              <div className="p-4 border-b border-gray-100 dark:border-slate-700">
                <h2 className="font-bold text-gray-800 dark:text-slate-100">Tình hình các kho</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[520px]">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kho</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">SKU</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Chờ nhập</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Chờ xuất</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Cảnh báo</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                    {data.warehouses.length === 0 ? (
                      <tr><td colSpan={6} className="p-8 text-center text-gray-400">Chưa có kho nào.</td></tr>
                    ) : (
                      data.warehouses.map((w) => (
                        <tr key={w.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                          <td className="p-3 text-sm font-bold">{w.code} - {w.name}</td>
                          <td className="p-3 text-sm text-center">{w.sku}</td>
                          <td className="p-3 text-sm text-center">{w.pendingReceipts}</td>
                          <td className="p-3 text-sm text-center">{w.pendingIssues}</td>
                          <td className="p-3 text-sm text-center font-bold">{w.alerts}</td>
                          <td className="p-3 text-sm">
                            <span className={`px-2 py-1 rounded font-bold text-xs ${
                              w.status === 'action' ? 'bg-rose-100 text-rose-700'
                              : w.status === 'attention' ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'}`}>
                              {w.status === 'action' ? 'Cần xử lý' : w.status === 'attention' ? 'Cần chú ý' : 'Bình thường'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-2 flex items-center gap-2">
                <TriangleAlert size={16} className="text-amber-500" /> Cảnh báo quản trị
              </h2>
              <ul className="space-y-2 text-sm max-h-[320px] overflow-y-auto">
                {data.alerts.outItems.map((i, idx) => (
                  <li key={`out-${idx}`} className="flex items-start gap-2">
                    <TriangleAlert size={14} className="text-rose-500 shrink-0 mt-0.5" />
                    <span><span className="font-bold">Hết hàng:</span> {i.productName} ({i.productCode}) tại {i.warehouseCode}</span>
                  </li>
                ))}
                {data.alerts.overdueDocs.map((d) => (
                  <li key={d.id} className="flex items-start gap-2">
                    <Clock size={14} className="text-rose-500 shrink-0 mt-0.5" />
                    <span><span className="font-bold">Quá hạn:</span> {d.code} ({d.dueDate})</span>
                  </li>
                ))}
                {data.alerts.overdueTransfers.map((t) => (
                  <li key={t.id} className="flex items-start gap-2">
                    <Truck size={14} className="text-orange-500 shrink-0 mt-0.5" />
                    <span><span className="font-bold">Vận chuyển trễ ETA:</span> {t.code} ({t.etaDate})</span>
                  </li>
                ))}
                {data.alerts.expiringReservations.map((r) => (
                  <li key={r.id} className="flex items-start gap-2">
                    <Clock size={14} className="text-amber-500 shrink-0 mt-0.5" />
                    <span><span className="font-bold">Giữ hàng sắp hết hạn:</span> {r.productCode} x{r.qty} ({r.expiresAt?.slice(0, 10)})</span>
                  </li>
                ))}
                {data.alerts.outItems.length === 0 && data.alerts.overdueDocs.length === 0
                  && data.alerts.overdueTransfers.length === 0 && data.alerts.expiringReservations.length === 0 && (
                  <li className="text-gray-400">Không có cảnh báo nào. 🎉</li>
                )}
              </ul>
            </Card>
          </div>

          <Card className="overflow-hidden p-0">
            <div className="p-4 border-b border-gray-100 dark:border-slate-700">
              <h2 className="font-bold text-gray-800 dark:text-slate-100">Hiệu suất xử lý</h2>
              <p className="text-xs text-gray-400 mt-0.5">Số liệu nghiệp vụ kiểm chứng được (phiếu DONE theo người xử lý).</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[520px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Nhân viên</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Phiếu xử lý</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Đúng hạn</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Quá hạn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {data.performance.length === 0 ? (
                    <tr><td colSpan={4} className="p-8 text-center text-gray-400">Chưa có dữ liệu.</td></tr>
                  ) : (
                    data.performance.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                        <td className="p-3 text-sm font-bold">{p.name}</td>
                        <td className="p-3 text-sm text-center">{p.handled}</td>
                        <td className="p-3 text-sm text-center">
                          {p.onTimeRate !== null ? `${p.onTimeRate}%` : '-'}
                        </td>
                        <td className="p-3 text-sm text-center font-bold">{p.overdue}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {data && data.role === 'none' && (
        <Card className="p-8 text-center text-gray-400 text-sm">
          Tài khoản quản trị không xem dữ liệu vận hành kho.
        </Card>
      )}

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <CheckCircle2 size={13} className="text-emerald-500" />
        Số liệu đọc trực tiếp từ chứng từ, tồn và giữ hàng — không hard-code.
      </div>
    </div>
  );
}
