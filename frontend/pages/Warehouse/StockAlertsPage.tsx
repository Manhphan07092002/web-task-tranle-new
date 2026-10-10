import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TriangleAlert, Package, Truck, Clock, SlidersHorizontal } from 'lucide-react';
import { Card } from '../../components/UI';
import { StatCard } from '../../components/StatCard';
import {
  deleteStockPolicy, getAlerts, getStockPolicies, getStockProducts, getWarehouses, saveStockPolicy,
  searchSerials,
  type AlertsData, type StockPolicy, type StockProduct, type Warehouse,
} from '../../services/stockMasterService';

type Tab = 'alerts' | 'exceptions' | 'slow' | 'policies';

const TABS: { value: Tab; label: string }[] = [
  { value: 'alerts', label: 'Cảnh báo tồn kho' },
  { value: 'exceptions', label: 'Hàng ngoại lệ' },
  { value: 'slow', label: 'Tồn lâu' },
  { value: 'policies', label: 'Chính sách tồn' },
];

const EXCEPTION_TABS = [
  { value: 'QUARANTINE', label: 'Chờ kiểm tra' },
  { value: 'WARRANTY', label: 'Bảo hành' },
  { value: 'DAMAGED', label: 'Hàng lỗi' },
  { value: 'LOST', label: 'Mất' },
] as const;

export default function StockAlertsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = ((): Tab => {
    const t = searchParams.get('tab');
    return t === 'exceptions' || t === 'slow' || t === 'policies' ? t : 'alerts';
  })();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [error, setError] = useState<string | null>(null);

  const switchTab = (value: Tab) => {
    setTab(value);
    setSearchParams(value === 'alerts' ? {} : { tab: value }, { replace: true });
  };

  // ---- alerts ----
  const [alerts, setAlerts] = useState<AlertsData | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [slowDays, setSlowDays] = useState('90');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const loadAlerts = useCallback(async () => {
    try {
      setAlertsLoading(true);
      setError(null);
      const [data, wh] = await Promise.all([
        getAlerts({
          warehouseId: warehouseId || undefined,
          slowDays: Number(slowDays) || 90,
        }),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setAlerts(data);
      setWarehouses(wh.filter((w) => w.isActive));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được cảnh báo.');
    } finally {
      setAlertsLoading(false);
    }
  }, [warehouseId, slowDays]);

  useEffect(() => { if (tab === 'alerts' || tab === 'slow') loadAlerts(); }, [tab, loadAlerts]);

  // ---- exceptions (serial queue) ----
  const [excStatus, setExcStatus] = useState<(typeof EXCEPTION_TABS)[number]['value']>('QUARANTINE');
  const [excRows, setExcRows] = useState<{ serialNo: string; productName: string; productCode: string; warehouseCode?: string; notes?: string }[]>([]);
  const [excLoading, setExcLoading] = useState(false);

  const loadExceptions = useCallback(async () => {
    try {
      setExcLoading(true);
      setError(null);
      setExcRows(await searchSerials({ status: excStatus }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được hàng ngoại lệ.');
    } finally {
      setExcLoading(false);
    }
  }, [excStatus]);

  useEffect(() => { if (tab === 'exceptions') loadExceptions(); }, [tab, loadExceptions]);

  // ---- policies ----
  const [policies, setPolicies] = useState<StockPolicy[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [products, setProducts] = useState<StockProduct[]>([]);
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [policyForm, setPolicyForm] = useState({
    productId: '', warehouseId: '', minStock: '0', maxStock: '0',
    reorderPoint: '0', preferredQty: '0', leadTimeDays: '0',
  });

  const loadPolicies = useCallback(async () => {
    try {
      setPoliciesLoading(true);
      setError(null);
      const [list, prods, wh] = await Promise.all([
        getStockPolicies(),
        getStockProducts().catch(() => [] as StockProduct[]),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setPolicies(list);
      setProducts(prods);
      setWarehouses(wh.filter((w) => w.isActive));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được chính sách tồn.');
    } finally {
      setPoliciesLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === 'policies') loadPolicies(); }, [tab, loadPolicies]);

  const submitPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      await saveStockPolicy({
        productId: policyForm.productId,
        warehouseId: policyForm.warehouseId,
        minStock: Number(policyForm.minStock) || 0,
        maxStock: Number(policyForm.maxStock) || 0,
        reorderPoint: Number(policyForm.reorderPoint) || 0,
        preferredQty: Number(policyForm.preferredQty) || 0,
        leadTimeDays: Number(policyForm.leadTimeDays) || 0,
      });
      setShowPolicyForm(false);
      setPolicyForm({
        productId: '', warehouseId: '', minStock: '0', maxStock: '0',
        reorderPoint: '0', preferredQty: '0', leadTimeDays: '0',
      });
      await loadPolicies();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu chính sách thất bại');
    }
  };

  const removePolicy = async (id: string) => {
    if (!window.confirm('Xóa chính sách riêng? (sẽ dùng mặc định của hàng hóa)')) return;
    try {
      setError(null);
      await deleteStockPolicy(id);
      await loadPolicies();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xóa chính sách thất bại');
    }
  };

  const inputCls = 'px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm text-gray-800 dark:text-slate-100';
  const excCounts = alerts?.exceptions;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
          <TriangleAlert className="text-amber-500" /> Cảnh báo &amp; kiểm soát tồn kho
        </h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">
          Hết hàng, sắp hết, tồn lâu, hàng ngoại lệ và chính sách Min/Max theo kho
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => switchTab(t.value)}
            className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
              tab === t.value
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 border border-gray-200 dark:border-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'alerts' && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={inputCls} aria-label="Lọc kho">
              <option value="">Tất cả kho</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300">
              Tồn lâu quá
              <select value={slowDays} onChange={(e) => setSlowDays(e.target.value)} className={inputCls} aria-label="Ngưỡng tồn lâu">
                <option value="30">30 ngày</option>
                <option value="90">90 ngày</option>
                <option value="180">180 ngày</option>
              </select>
            </label>
          </div>

          {alertsLoading && !alerts ? (
            <p className="text-center text-gray-400 py-8">Đang tải...</p>
          ) : alerts ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Hết hàng" value={alerts.out.length} icon={TriangleAlert} color="from-rose-500 to-rose-400" subtitle="khả dụng bằng 0" alert={alerts.out.length > 0} />
                <StatCard label="Sắp hết" value={alerts.low.length} icon={TriangleAlert} color="from-amber-500 to-amber-400" subtitle="dưới điểm đặt lại" alert={alerts.low.length > 0} />
                <StatCard label="Nhập trễ hạn" value={alerts.incomingOverdue.length} icon={Truck} color="from-blue-500 to-blue-400" subtitle="phiếu nhập quá hạn" alert={alerts.incomingOverdue.length > 0} />
                <StatCard label="Giữ hàng sắp hết hạn" value={alerts.expiringReservations.length} icon={Clock} color="from-purple-500 to-purple-400" subtitle="trong 7 ngày" />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card className="overflow-hidden p-0">
                  <div className="p-4 border-b border-gray-100 dark:border-slate-700">
                    <h2 className="font-bold text-gray-800 dark:text-slate-100">Hết hàng ({alerts.out.length})</h2>
                  </div>
                  {alerts.out.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">Không có mặt hàng hết hàng. 🎉</p>
                  ) : (
                    <ul className="divide-y divide-gray-50 dark:divide-slate-700/50 max-h-[320px] overflow-y-auto">
                      {alerts.out.map((r) => (
                        <li key={`${r.productId}-${r.warehouseId}`} className="px-4 py-2.5 text-sm">
                          <Link
                            to={`/warehouse/stock?search=${encodeURIComponent(r.productCode)}`}
                            className="font-bold text-gray-800 dark:text-slate-100 hover:text-emerald-700"
                          >
                            {r.productName}
                          </Link>
                          <span className="block text-xs text-gray-400">{r.productCode} • {r.warehouseCode}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card className="overflow-hidden p-0">
                  <div className="p-4 border-b border-gray-100 dark:border-slate-700">
                    <h2 className="font-bold text-gray-800 dark:text-slate-100">Sắp hết ({alerts.low.length})</h2>
                  </div>
                  {alerts.low.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">Không có mặt hàng sắp hết.</p>
                  ) : (
                    <ul className="divide-y divide-gray-50 dark:divide-slate-700/50 max-h-[320px] overflow-y-auto">
                      {alerts.low.map((r) => (
                        <li key={`${r.productId}-${r.warehouseId}`} className="flex items-center justify-between px-4 py-2.5 text-sm">
                          <span>
                            <Link
                              to={`/warehouse/stock?search=${encodeURIComponent(r.productCode)}`}
                              className="font-bold text-gray-800 dark:text-slate-100 hover:text-emerald-700"
                            >
                              {r.productName}
                            </Link>
                            <span className="block text-xs text-gray-400">{r.productCode} • {r.warehouseCode} • đặt lại tại {r.reorderPoint}</span>
                          </span>
                          <span className="font-black text-amber-600">{Number(r.available).toLocaleString('vi-VN')}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              {(alerts.incomingOverdue.length > 0 || alerts.expiringReservations.length > 0) && (
                <Card className="p-4">
                  <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-2">Nhập trễ &amp; giữ hàng sắp hết hạn</h2>
                  <ul className="space-y-1.5 text-sm">
                    {alerts.incomingOverdue.map((d) => (
                      <li key={d.id} className="flex items-center gap-2">
                        <Truck size={14} className="text-blue-500 shrink-0" />
                        <span>Phiếu nhập <span className="font-bold">{d.code}</span> quá hạn ({d.dueDate}) • {d.warehouseCode} • {d.lineCount} dòng</span>
                      </li>
                    ))}
                    {alerts.expiringReservations.map((r) => (
                      <li key={r.id} className="flex items-center gap-2">
                        <Clock size={14} className="text-purple-500 shrink-0" />
                        <span>Giữ hàng <span className="font-bold">{r.productCode}</span> x{r.qty} hết hạn {r.expiresAt?.slice(0, 10)} • {r.warehouseCode}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          ) : null}
        </>
      )}

      {tab === 'exceptions' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {EXCEPTION_TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setExcStatus(t.value)}
                className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                  excStatus === t.value
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 border border-gray-200 dark:border-slate-700'
                }`}
              >
                {t.label}
                {excCounts && excCounts[t.value] > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-rose-500 text-white text-[10px]">{excCounts[t.value]}</span>
                )}
              </button>
            ))}
          </div>
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[680px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Serial</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hàng hóa</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kho</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Ghi chú</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Xử lý</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {excRows.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-gray-400">Không có hàng ngoại lệ ở nhóm này. 🎉</td></tr>
                  ) : (
                    excRows.map((r: any) => (
                      <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                        <td className="p-3 text-sm font-bold font-mono">{r.serialNo}</td>
                        <td className="p-3 text-sm">{r.productName}<span className="block text-xs text-gray-400">{r.productCode}</span></td>
                        <td className="p-3 text-sm text-gray-500">{r.warehouseCode || '-'}</td>
                        <td className="p-3 text-sm text-gray-500">{r.notes || '-'}</td>
                        <td className="p-3 text-center">
                          <Link to={`/warehouse/serials?search=${encodeURIComponent(r.serialNo)}`}
                            className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[11px] font-bold">
                            Mở serial
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="p-3 text-xs text-gray-400 border-t border-gray-100 dark:border-slate-700">
              Luồng xử lý: hàng trả về vào QUARANTINE → kiểm tra → đạt về IN_STOCK (SALEABLE) / lỗi sang DAMAGED. Đổi trạng thái ở trang Serial.
            </p>
          </Card>
        </div>
      )}

      {tab === 'slow' && (
        <Card className="overflow-hidden p-0">
          <div className="p-4 border-b border-gray-100 dark:border-slate-700">
            <h2 className="font-bold text-gray-800 dark:text-slate-100">
              Tồn lâu quá {alerts?.slowDays || 90} ngày ({alerts?.slow.length || 0})
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Còn thực tồn nhưng không phát sinh biến động nào.</p>
          </div>
          {!alerts || alerts.slow.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Không có tồn lâu.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[680px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mặt hàng</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kho</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thực tồn</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Nằm im</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {alerts.slow.map((r, idx) => (
                    <tr key={`${r.productId}-${r.warehouseId}-${idx}`} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                      <td className="p-3 text-sm font-bold">
                        {r.productName}
                        <span className="flex items-center gap-1 text-xs font-normal text-gray-400">
                          <Package size={12} /> {r.productCode} • {r.unit}
                        </span>
                      </td>
                      <td className="p-3 text-sm text-gray-500">{r.warehouseCode}</td>
                      <td className="p-3 text-sm text-center font-bold">{Number(r.onHand).toLocaleString('vi-VN')}</td>
                      <td className="p-3 text-sm text-center text-amber-600 font-bold">
                        {r.daysSinceMove === null ? 'Chưa từng động' : `${r.daysSinceMove} ngày`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'policies' && (
        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-800 dark:text-slate-100">Chính sách Min/Max theo kho ({policies.length})</h2>
                <p className="text-xs text-gray-400 mt-0.5">Không đặt riêng thì dùng mặc định của hàng hóa.</p>
              </div>
              <button
                onClick={() => setShowPolicyForm((v) => !v)}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold"
              >
                + Đặt chính sách
              </button>
            </div>
            {showPolicyForm && (
              <form
                onSubmit={submitPolicy}
                className="grid grid-cols-2 md:grid-cols-4 gap-2 p-4 border-b border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/40"
              >
                <select value={policyForm.productId} onChange={(e) => setPolicyForm({ ...policyForm, productId: e.target.value })} className={inputCls} aria-label="Hàng hóa">
                  <option value="">-- Hàng hóa * --</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                </select>
                <select value={policyForm.warehouseId} onChange={(e) => setPolicyForm({ ...policyForm, warehouseId: e.target.value })} className={inputCls} aria-label="Kho">
                  <option value="">-- Kho * --</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                </select>
                <input
                  type="number" min="0" step="any" placeholder="Tồn tối thiểu"
                  value={policyForm.minStock} onChange={(e) => setPolicyForm({ ...policyForm, minStock: e.target.value })} className={inputCls} />
                <input
                  type="number" min="0" step="any" placeholder="Tồn tối đa"
                  value={policyForm.maxStock} onChange={(e) => setPolicyForm({ ...policyForm, maxStock: e.target.value })} className={inputCls} />
                <input
                  type="number" min="0" step="any" placeholder="Điểm đặt lại"
                  value={policyForm.reorderPoint} onChange={(e) => setPolicyForm({ ...policyForm, reorderPoint: e.target.value })} className={inputCls} />
                <input
                  type="number" min="0" step="any" placeholder="SL đặt thêm"
                  value={policyForm.preferredQty} onChange={(e) => setPolicyForm({ ...policyForm, preferredQty: e.target.value })} className={inputCls} />
                <input
                  type="number" min="0" step="1" placeholder="Lead time (ngày)"
                  value={policyForm.leadTimeDays} onChange={(e) => setPolicyForm({ ...policyForm, leadTimeDays: e.target.value })} className={inputCls} />
                <div className="flex items-end gap-2">
                  <button type="button" onClick={() => setShowPolicyForm(false)}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs">Hủy</button>
                  <button type="submit" disabled={!policyForm.productId || !policyForm.warehouseId}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs disabled:opacity-50">
                    Lưu chính sách
                  </button>
                </div>
              </form>
            )}
            {policiesLoading ? (
              <p className="text-sm text-gray-400 text-center py-8">Đang tải...</p>
            ) : policies.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Chưa có chính sách riêng nào — đang dùng mặc định của hàng hóa.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[760px]">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hàng / Kho</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Min</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Max</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Điểm đặt lại</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">SL đặt thêm</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Lead time</th>
                      <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                    {policies.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                        <td className="p-3 text-sm font-bold">
                          {p.productCode}
                          <span className="block text-xs font-normal text-gray-400">{p.warehouseCode}</span>
                        </td>
                        <td className="p-3 text-sm text-center">{p.minStock}</td>
                        <td className="p-3 text-sm text-center">{p.maxStock}</td>
                        <td className="p-3 text-sm text-center font-bold">{p.reorderPoint}</td>
                        <td className="p-3 text-sm text-center">{p.preferredQty}</td>
                        <td className="p-3 text-sm text-center">{p.leadTimeDays} ngày</td>
                        <td className="p-3 text-center">
                          <button onClick={() => removePolicy(p.id)}
                            className="px-2 py-1 text-rose-500 hover:bg-rose-50 rounded-lg text-[11px] font-bold">
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
