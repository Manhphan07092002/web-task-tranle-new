import { Fragment, useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Plus, Truck, TriangleAlert } from 'lucide-react';
import { Card } from '../../components/UI';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import {
  cancelStockDocument, completeStockDocument, createStockDocument, getStockDocuments,
  getStockDocument, getTransferSuggestions, getWarehouses, getWarehouseLocations, transferReceiveLine,
  updateStockDocument,
  type StockDocument, type StockProduct, type TransferSuggestion, type Warehouse, type WarehouseLocation,
} from '../../services/stockMasterService';
import { getStockProducts } from '../../services/stockMasterService';

const NV_TABS = [
  { value: '', label: 'Cần gửi', statuses: ['CONFIRMED'] },
  { value: 'IN_TRANSIT', label: 'Đang vận chuyển', statuses: ['IN_TRANSIT'] },
  { value: 'RECEIVED', label: 'Chờ nhận', statuses: ['RECEIVED'] },
  { value: 'DONE', label: 'Hoàn tất', statuses: ['DONE'] },
];
const TP_TABS = [
  { value: '', label: 'Tất cả', statuses: [] },
  { value: 'PENDING', label: 'Chờ gửi', statuses: ['CONFIRMED'] },
  { value: 'IN_TRANSIT', label: 'Đang vận chuyển', statuses: ['IN_TRANSIT'] },
  { value: 'RECEIVED', label: 'Chờ nhận', statuses: ['RECEIVED'] },
  { value: 'ACTION', label: 'Chờ xử lý', statuses: ['DRAFT'] },
  { value: 'OVERDUE', label: 'Quá hạn', statuses: ['IN_TRANSIT'] },
  { value: 'DONE', label: 'Hoàn tất', statuses: ['DONE'] },
];

const STATUS_META: Record<string, { label: string; badge: string }> = {
  DRAFT: { label: 'Nháp', badge: 'bg-slate-100 text-slate-600' },
  CONFIRMED: { label: 'Chờ gửi', badge: 'bg-amber-100 text-amber-700' },
  IN_TRANSIT: { label: 'Đang vận chuyển', badge: 'bg-blue-100 text-blue-700' },
  RECEIVED: { label: 'Chờ nhận', badge: 'bg-purple-100 text-purple-700' },
  DONE: { label: 'Hoàn tất', badge: 'bg-emerald-100 text-emerald-700' },
  CANCELLED: { label: 'Đã hủy', badge: 'bg-rose-100 text-rose-700' },
};

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function StockTransfersPage() {
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
  const [form, setForm] = useState({ fromId: '', toId: '', etaDate: '', senderId: '', receiverId: '', notes: '' });
  const [formLines, setFormLines] = useState([{ productId: '', qtyOrdered: '1' }]);
  const [recvQty, setRecvQty] = useState<Record<string, string>>({});
  const [recvNote, setRecvNote] = useState<Record<string, string>>({});
  const [acting, setActing] = useState(false);
  const [suggestions, setSuggestions] = useState<TransferSuggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const tabs = isManager ? [...TP_TABS, { value: 'SUGGEST', label: 'Đề xuất', statuses: [] as string[] }] : NV_TABS;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const active = tabs.find((t) => t.value === tab);
      let all = await getStockDocuments({ type: 'TRANSFER' });
      if (tab === 'OVERDUE') {
        const today = todayStr();
        all = all.filter((d) => d.status === 'IN_TRANSIT' && d.etaDate && d.etaDate < today);
      } else if (active && active.statuses.length > 0) {
        all = all.filter((d) => active.statuses.includes(d.status));
      }
      setDocs(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được phiếu điều chuyển.');
    } finally {
      setLoading(false);
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab !== 'SUGGEST' || !isManager) return;
    (async () => {
      try {
        setSuggestLoading(true);
        setSuggestions(await getTransferSuggestions());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Không tải được đề xuất.');
      } finally {
        setSuggestLoading(false);
      }
    })();
  }, [tab, isManager]);

  useEffect(() => {
    (async () => {
      try {
        const [wh, prods] = await Promise.all([getWarehouses(), getStockProducts()]);
        const active = wh.filter((w) => w.isActive);
        setWarehouses(active);
        setProducts(prods);
        if (active.length > 0) {
          setForm((f) => ({ ...f, fromId: f.fromId || active[0].id }));
          setLocations(await getWarehouseLocations(active[0].id));
        }
      } catch { /* optional */ }
    })();
  }, []);

  const openDetail = async (doc: StockDocument) => {
    if (expandedId === doc.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    try {
      setExpandedId(doc.id);
      const full = await getStockDocument(doc.id);
      setDetail(full);
      if (full.toWarehouseId) {
        try {
          setLocations(await getWarehouseLocations(full.toWarehouseId));
        } catch { /* keep */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được chi tiết phiếu.');
    }
  };

  const runAction = async (fn: () => Promise<unknown>, detailId?: string) => {
    try {
      setActing(true);
      setError(null);
      await fn();
      await load();
      if (detailId) {
        try {
          setDetail(await getStockDocument(detailId));
        } catch { /* keep old */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Thao tác thất bại');
    } finally {
      setActing(false);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    runAction(() => createStockDocument({
      type: 'TRANSFER',
      warehouseId: form.fromId,
      toWarehouseId: form.toId || undefined,
      etaDate: form.etaDate || undefined,
      assigneeId: form.senderId || undefined,
      receiverId: form.receiverId || undefined,
      notes: form.notes.trim() || undefined,
      lines: formLines.map((l) => ({ productId: l.productId, qtyOrdered: Number(l.qtyOrdered) })),
    }).then(() => {
      setShowForm(false);
      setForm({ fromId: form.fromId, toId: '', etaDate: '', senderId: '', receiverId: '', notes: '' });
      setFormLines([{ productId: '', qtyOrdered: '1' }]);
    }));
  };

  const confirmReceive = async (docId: string, lineId: string) => {
    const val = recvQty[lineId];
    if (val === undefined || val === '' || Number.isNaN(Number(val)) || Number(val) < 0) {
      setError('Nhập số lượng nhận hợp lệ (0 nếu thiếu toàn bộ).');
      return;
    }
    runAction(
      () => transferReceiveLine(docId, lineId, { qty: Number(val), notes: recvNote[lineId]?.trim() || undefined }),
      docId
    );
  };

  const inputCls = 'px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100';

  // KPI mini (TP): in-transit / overdue / awaiting / discrepancies
  const kpis = (() => {
    if (!isManager) return null;
    const today = todayStr();
    return {
      transit: docs.filter((d) => d.status === 'IN_TRANSIT').length,
      overdue: docs.filter((d) => d.status === 'IN_TRANSIT' && d.etaDate && d.etaDate < today).length,
      awaiting: docs.filter((d) => d.status === 'RECEIVED').length,
      partial: docs.filter((d) => d.status === 'RECEIVED' && Number(d.qtyReceived) < Number(d.qtyOrdered)).length,
    };
  })();

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <ArrowLeftRight className="text-emerald-500" /> Điều chuyển
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">
            {docs.length} phiếu • Gửi – vận chuyển – nhận 2 đầu, chốt chênh lệch
          </p>
        </div>
        {isManager && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1"
          >
            <Plus size={15} /> Tạo yêu cầu điều chuyển
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Đang vận chuyển', value: kpis.transit, icon: Truck, color: 'text-blue-600' },
            { label: 'Quá ETA', value: kpis.overdue, icon: TriangleAlert, color: 'text-rose-600' },
            { label: 'Chờ nhận', value: kpis.awaiting, icon: ArrowLeftRight, color: 'text-purple-600' },
            { label: 'Nhận thiếu', value: kpis.partial, icon: TriangleAlert, color: 'text-amber-600' },
          ].map((k) => (
            <div key={k.label} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-4 flex items-center gap-3">
              <k.icon size={22} className={k.color} />
              <div>
                <p className="text-2xl font-black text-gray-800 dark:text-slate-100">{k.value}</p>
                <p className="text-xs font-bold text-gray-500 uppercase">{k.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Card className="p-4">
          <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">Tạo yêu cầu điều chuyển</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                Kho nguồn *
                <select value={form.fromId} onChange={(e) => setForm({ ...form, fromId: e.target.value })} className={inputCls}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                Kho đích *
                <select value={form.toId} onChange={(e) => setForm({ ...form, toId: e.target.value })} className={inputCls}>
                  <option value="">-- Chọn kho đích --</option>
                  {warehouses.filter((w) => w.id !== form.fromId).map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                ETA dự kiến
                <input type="date" value={form.etaDate} onChange={(e) => setForm({ ...form, etaDate: e.target.value })} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                NV gửi (kho nguồn)
                <select value={form.senderId} onChange={(e) => setForm({ ...form, senderId: e.target.value })} className={inputCls}>
                  <option value="">-- Chưa phân công --</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                NV nhận (kho đích)
                <select value={form.receiverId} onChange={(e) => setForm({ ...form, receiverId: e.target.value })} className={inputCls}>
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
              <div key={idx} className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <select
                  value={line.productId}
                  onChange={(e) => setFormLines((prev) => prev.map((p, i) => i === idx ? { ...p, productId: e.target.value } : p))}
                  className={`${inputCls} md:col-span-2`}
                >
                  <option value="">-- Chọn hàng hóa * --</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                </select>
                <div className="flex gap-1">
                  <input
                    type="number" min="0" step="any" placeholder="SL chuyển *"
                    value={line.qtyOrdered}
                    onChange={(e) => setFormLines((prev) => prev.map((p, i) => i === idx ? { ...p, qtyOrdered: e.target.value } : p))}
                    className={`${inputCls} flex-1`}
                  />
                  {formLines.length > 1 && (
                    <button type="button"
                      onClick={() => setFormLines((prev) => prev.filter((_, i) => i !== idx))}
                      className="px-2 py-1 text-rose-500 hover:bg-rose-50 rounded-lg text-sm font-bold">×</button>
                  )}
                  {idx === formLines.length - 1 && (
                    <button type="button"
                      onClick={() => setFormLines((prev) => [...prev, { productId: '', qtyOrdered: '1' }])}
                      className="px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg">+ Dòng</button>
                  )}
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm">Hủy</button>
              <button type="submit" disabled={acting || !form.fromId || !form.toId}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                Tạo yêu cầu (Nháp)
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
        {tab === 'SUGGEST' ? (
          suggestLoading ? (
            <p className="text-center text-gray-400 py-8">Đang tính đề xuất...</p>
          ) : suggestions.length === 0 ? (
            <p className="text-center text-gray-400 py-8">Không có đề xuất nào — mọi kho đều đủ tồn theo điểm đặt lại. 🎉</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[680px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hàng hóa thiếu</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kho thiếu → Kho thừa</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thiếu / Đề xuất chuyển</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {suggestions.map((s, idx) => (
                    <tr key={`${s.productId}-${s.toWarehouseId}-${idx}`} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                      <td className="p-3 text-sm font-bold">
                        {s.productName}
                        <span className="block text-xs font-normal text-gray-400">{s.productCode}</span>
                      </td>
                      <td className="p-3 text-sm">{s.toWarehouseCode} ← {s.fromWarehouseCode}</td>
                      <td className="p-3 text-sm text-center">
                        thiếu <span className="font-bold text-rose-600">{s.shortageQty.toLocaleString('vi-VN')}</span>
                        {' → '}
                        <span className="font-bold text-emerald-700">{s.suggestQty.toLocaleString('vi-VN')}</span> {s.unit}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => {
                            setForm((f) => ({ ...f, fromId: s.fromWarehouseId, toId: s.toWarehouseId }));
                            setFormLines([{ productId: s.productId, qtyOrdered: String(s.suggestQty) }]);
                            setShowForm(true);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold"
                        >
                          Tạo phiếu
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Phiếu</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Nguồn → Đích</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Gửi / Nhận</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">ETA</th>
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
                docs.map((doc) => {
                  const overdue = doc.status === 'IN_TRANSIT' && doc.etaDate && doc.etaDate < todayStr();
                  return (
                    <Fragment key={doc.id}>
                      <tr className="hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer" onClick={() => openDetail(doc)}>
                        <td className="p-3 text-sm font-bold" title={doc.id}>{doc.code}</td>
                        <td className="p-3 text-sm text-gray-600 dark:text-slate-300">
                          {doc.warehouseCode || '?'} → {doc.toWarehouseCode || '?'}
                        </td>
                        <td className="p-3 text-sm text-gray-600 dark:text-slate-300">
                          {doc.assigneeName || '-'} / {doc.receiverName || '-'}
                        </td>
                        <td className="p-3 text-sm">
                          {doc.etaDate || '-'}
                          {overdue && <span className="ml-1 px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded text-[10px] font-bold">Quá hạn</span>}
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
                                Duyệt gửi
                              </button>
                            )}
                            {doc.status === 'CONFIRMED' && (
                              <button disabled={acting}
                                onClick={() => runAction(() => updateStockDocument(doc.id, { status: 'IN_TRANSIT' }), expandedId === doc.id ? doc.id : undefined)}
                                className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-[11px] font-bold disabled:opacity-50">
                                Xác nhận gửi
                              </button>
                            )}
                            {isManager && doc.status === 'RECEIVED' && (
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
                                            {line.productCode} • Gửi {Number(line.qtyOrdered)} • Đã nhận {Number(line.qtyReceived)}
                                          </span>
                                        </span>
                                        {(doc.status === 'IN_TRANSIT' || doc.status === 'RECEIVED') ? (
                                          <span className="inline-flex flex-wrap gap-1">
                                            <input
                                              type="number" min="0" step="any" placeholder="SL nhận"
                                              value={recvQty[line.id] ?? ''}
                                              onChange={(e) => setRecvQty((prev) => ({ ...prev, [line.id]: e.target.value }))}
                                              className="w-24 px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                                            />
                                            <input
                                              placeholder="Ghi chú thiếu/hư..."
                                              value={recvNote[line.id] ?? ''}
                                              onChange={(e) => setRecvNote((prev) => ({ ...prev, [line.id]: e.target.value }))}
                                              className="w-40 px-2 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
                                            />
                                            <button
                                              disabled={acting}
                                              onClick={() => confirmReceive(doc.id, line.id)}
                                              className="px-2 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-[11px] font-bold disabled:opacity-50"
                                            >
                                              Xác nhận nhận
                                            </button>
                                          </span>
                                        ) : (
                                          <span className="text-xs text-gray-400">
                                            {Number(line.qtyReceived)}/{Number(line.qtyOrdered)} {line.unit}
                                          </span>
                                        )}
                                      </div>
                                      {line.notes && (
                                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">⚠ {line.notes}</p>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        )}
      </Card>
    </div>
  );
}
