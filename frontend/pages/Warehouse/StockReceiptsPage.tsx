import { Fragment, useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, Plus } from 'lucide-react';
import { Card } from '../../components/UI';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import {
  cancelStockDocument, completeStockDocument, createStockDocument, getStockDocuments,
  getStockDocument, getWarehouses, getWarehouseLocations, receiveDocumentLine,
  updateStockDocument,
  type StockDocument, type StockProduct, type Warehouse, type WarehouseLocation,
} from '../../services/stockMasterService';
import { getStockProducts } from '../../services/stockMasterService';
import { DocLineSerials } from './DocLineSerials';

const NV_TABS = [
  { value: '', label: 'Chờ nhận', statuses: ['CONFIRMED'] },
  { value: 'RECEIVING', label: 'Đang nhận', statuses: ['RECEIVING'] },
  { value: 'DONE', label: 'Hoàn tất', statuses: ['DONE'] },
];
const TP_TABS = [
  { value: '', label: 'Tất cả', statuses: [] },
  { value: 'PENDING', label: 'Chờ nhận', statuses: ['CONFIRMED'] },
  { value: 'RECEIVING', label: 'Đang nhận', statuses: ['RECEIVING'] },
  { value: 'ACTION', label: 'Chờ xử lý', statuses: ['DRAFT'] },
  { value: 'DONE', label: 'Hoàn tất', statuses: ['DONE'] },
];

const STATUS_META: Record<string, { label: string; badge: string }> = {
  DRAFT: { label: 'Nháp', badge: 'bg-slate-100 text-slate-600' },
  CONFIRMED: { label: 'Chờ nhận', badge: 'bg-amber-100 text-amber-700' },
  RECEIVING: { label: 'Đang nhận', badge: 'bg-blue-100 text-blue-700' },
  DONE: { label: 'Hoàn tất', badge: 'bg-emerald-100 text-emerald-700' },
  CANCELLED: { label: 'Đã hủy', badge: 'bg-rose-100 text-rose-700' },
};

export default function StockReceiptsPage() {
  const { user } = useAuth();
  const { users } = useData();
  const isManager = (user?.permissions || []).includes('stock.manage');
  const [docs, setDocs] = useState<StockDocument[]>([]);
  const [tab, setTab] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StockDocument | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [products, setProducts] = useState<StockProduct[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ warehouseId: '', supplierName: '', assigneeId: '', notes: '' });
  const [formLines, setFormLines] = useState([{ productId: '', qtyOrdered: '1', locationId: '' }]);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [receiveLoc, setReceiveLoc] = useState<Record<string, string>>({});
  const [acting, setActing] = useState(false);

  const tabs = isManager ? TP_TABS : NV_TABS;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const active = tabs.find((t) => t.value === tab);
      const all = await getStockDocuments({ type: 'RECEIPT' });
      setDocs(!active || active.statuses.length === 0
        ? all
        : all.filter((d) => active.statuses.includes(d.status)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được phiếu nhập.');
    } finally {
      setLoading(false);
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const [wh, prods] = await Promise.all([getWarehouses(), getStockProducts()]);
        setWarehouses(wh.filter((w) => w.isActive));
        setProducts(prods);
        if (wh.length > 0) {
          setForm((f) => ({ ...f, warehouseId: f.warehouseId || wh[0].id }));
          setLocations(await getWarehouseLocations(wh[0].id));
        }
      } catch { /* optional */ }
    })();
  }, []);

  const onWarehouseChange = async (warehouseId: string) => {
    setForm((f) => ({ ...f, warehouseId }));
    try {
      setLocations(await getWarehouseLocations(warehouseId));
    } catch { setLocations([]); }
  };

  const openDetail = async (doc: StockDocument) => {
    if (expandedId === doc.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    try {
      setExpandedId(doc.id);
      setDetail(await getStockDocument(doc.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được chi tiết phiếu.');
    }
  };

  const refreshDetail = async (id: string) => {
    try {
      setDetail(await getStockDocument(id));
    } catch { /* keep old */ }
  };

  const runAction = async (fn: () => Promise<unknown>, detailId?: string) => {
    try {
      setActing(true);
      setError(null);
      await fn();
      await load();
      if (detailId) await refreshDetail(detailId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Thao tác thất bại');
    } finally {
      setActing(false);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    runAction(() => createStockDocument({
      warehouseId: form.warehouseId,
      supplierName: form.supplierName.trim() || undefined,
      assigneeId: form.assigneeId || undefined,
      notes: form.notes.trim() || undefined,
      lines: formLines.map((l) => ({
        productId: l.productId, qtyOrdered: Number(l.qtyOrdered),
        locationId: l.locationId || undefined,
      })),
    }).then(() => {
      setShowForm(false);
      setForm({ warehouseId: form.warehouseId, supplierName: '', assigneeId: '', notes: '' });
      setFormLines([{ productId: '', qtyOrdered: '1', locationId: '' }]);
    }));
  };

  const inputCls = 'px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <ArrowDownToLine className="text-emerald-500" /> Nhập kho
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">
            {docs.length} phiếu • Nhận hàng theo phiếu được giao, chốt số vào tồn
          </p>
        </div>
        {isManager && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1"
          >
            <Plus size={15} /> Tạo phiếu nhập
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      {showForm && (
        <Card className="p-4">
          <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">Tạo phiếu nhập mới</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                Kho nhập *
                <select value={form.warehouseId} onChange={(e) => onWarehouseChange(e.target.value)} className={inputCls}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                Nhà cung cấp
                <input value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })}
                  placeholder="VD: SAJ" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                Người nhận hàng
                <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} className={inputCls}>
                  <option value="">-- Chưa phân công --</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                Ghi chú
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} />
              </label>
            </div>
            <p className="text-xs font-bold text-gray-500 uppercase">Hàng hóa</p>
            {formLines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <select
                  value={line.productId}
                  onChange={(e) => setFormLines((prev) => prev.map((p, i) => i === idx ? { ...p, productId: e.target.value } : p))}
                  className={inputCls}
                >
                  <option value="">-- Chọn hàng hóa * --</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                </select>
                <input
                  type="number" min="0" step="any" placeholder="SL đặt *"
                  value={line.qtyOrdered}
                  onChange={(e) => setFormLines((prev) => prev.map((p, i) => i === idx ? { ...p, qtyOrdered: e.target.value } : p))}
                  className={inputCls}
                />
                <select
                  value={line.locationId}
                  onChange={(e) => setFormLines((prev) => prev.map((p, i) => i === idx ? { ...p, locationId: e.target.value } : p))}
                  className={inputCls}
                >
                  <option value="">-- Vị trí nhập --</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.code} - {l.name}</option>)}
                </select>
                <div className="flex gap-1">
                  {formLines.length > 1 && (
                    <button type="button"
                      onClick={() => setFormLines((prev) => prev.filter((_, i) => i !== idx))}
                      className="px-2 py-1 text-rose-500 hover:bg-rose-50 rounded-lg text-sm font-bold">×</button>
                  )}
                  {idx === formLines.length - 1 && (
                    <button type="button"
                      onClick={() => setFormLines((prev) => [...prev, { productId: '', qtyOrdered: '1', locationId: '' }])}
                      className="px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg">+ Thêm dòng</button>
                  )}
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm">Hủy</button>
              <button type="submit" disabled={acting || !form.warehouseId}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                Tạo phiếu (Nháp)
              </button>
            </div>
          </form>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.value || 'pending'}
            onClick={() => setTab(t.value)}
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

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Phiếu</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">NCC / Kho</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Người nhận</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Đã nhận / Đặt</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : docs.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Không có phiếu nào.</td></tr>
              ) : (
                docs.map((doc) => (
                  <Fragment key={doc.id}>
                    <tr key={doc.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer" onClick={() => openDetail(doc)}>
                      <td className="p-3 text-sm font-bold" title={doc.id}>{doc.code}</td>
                      <td className="p-3 text-sm text-gray-600 dark:text-slate-300">
                        {doc.supplierName || '-'}
                        <span className="block text-xs text-gray-400">{doc.warehouseName || doc.warehouseCode}</span>
                      </td>
                      <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{doc.assigneeName || '-'}</td>
                      <td className="p-3 text-sm text-center font-bold">
                        {Number(doc.qtyReceived).toLocaleString('vi-VN')} / {Number(doc.qtyOrdered).toLocaleString('vi-VN')}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded font-bold text-xs ${STATUS_META[doc.status]?.badge || ''}`}>
                          {STATUS_META[doc.status]?.label || doc.status}
                        </span>
                      </td>
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex gap-1 flex-wrap justify-center">
                          {isManager && doc.status === 'DRAFT' && (
                            <button disabled={acting}
                              onClick={() => runAction(() => updateStockDocument(doc.id, { status: 'CONFIRMED' }), expandedId === doc.id ? doc.id : undefined)}
                              className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[11px] font-bold disabled:opacity-50">
                              Xác nhận
                            </button>
                          )}
                          {(doc.status === 'CONFIRMED' || doc.status === 'RECEIVING') && (
                            <button disabled={acting}
                              onClick={() => runAction(() => completeStockDocument(doc.id), expandedId === doc.id ? doc.id : undefined)}
                              className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-[11px] font-bold disabled:opacity-50">
                              Hoàn tất
                            </button>
                          )}
                          {isManager && ['DRAFT', 'CONFIRMED'].includes(doc.status) && (
                            <button disabled={acting}
                              onClick={() => runAction(() => cancelStockDocument(doc.id), expandedId === doc.id ? doc.id : undefined)}
                              className="px-2 py-1 text-rose-500 hover:bg-rose-50 rounded-lg text-[11px] font-bold disabled:opacity-50">
                              Hủy
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                    {expandedId === doc.id && (
                      <tr key={`${doc.id}-lines`}>
                        <td colSpan={6} className="p-0 bg-gray-50/60 dark:bg-slate-800/40">
                          <div className="p-4">
                            <p className="text-xs font-bold text-gray-500 uppercase mb-2">
                              Hàng hóa ({detail?.lines?.length || 0})
                              {detail?.notes ? ` • Ghi chú: ${detail.notes}` : ''}
                            </p>
                            {!detail ? (
                              <p className="text-sm text-gray-400">Đang tải...</p>
                            ) : (
                              <ul className="divide-y divide-gray-100 dark:divide-slate-700/50 bg-white dark:bg-slate-800 rounded-xl overflow-hidden">
                                {detail.lines?.map((line) => (
                                  <li key={line.id} className="px-3 py-2 text-sm">
                                    <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-bold flex-1 min-w-[180px]">
                                      {line.productName}
                                      <span className="block text-xs font-normal text-gray-400">
                                        {line.productCode} • Đặt {Number(line.qtyOrdered)} • Đã nhận {Number(line.qtyReceived)}
                                      </span>
                                    </span>
                                    {(doc.status === 'CONFIRMED' || doc.status === 'RECEIVING') ? (
                                      <span className="inline-flex gap-1">
                                        <input
                                          type="number" min="0" step="any" placeholder="SL nhận"
                                          value={receiveQty[line.id] ?? ''}
                                          onChange={(e) => setReceiveQty((prev) => ({ ...prev, [line.id]: e.target.value }))}
                                          className="w-24 px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                                        />
                                        <button
                                          disabled={acting}
                                          onClick={() => {
                                            const val = Number(receiveQty[line.id]);
                                            if (!val || val <= 0) {
                                              setError('Nhập số lượng nhận hợp lệ.');
                                              return;
                                            }
                                            runAction(() => receiveDocumentLine(doc.id, line.id, { qty: val }), doc.id);
                                          }}
                                          className="px-2 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold disabled:opacity-50"
                                        >
                                          Nhận
                                        </button>
                                      </span>
                                    ) : (
                                      <span className="text-xs text-gray-400">
                                        {Number(line.qtyReceived)}/{Number(line.qtyOrdered)} {line.unit}
                                      </span>
                                    )}
                                    </div>
                                    <DocLineSerials
                                      docType="RECEIPT"
                                      docId={doc.id}
                                      lineId={line.id}
                                      productTracking={(line as any).productTracking}
                                      editable={doc.status === 'CONFIRMED' || doc.status === 'RECEIVING'}
                                    />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
