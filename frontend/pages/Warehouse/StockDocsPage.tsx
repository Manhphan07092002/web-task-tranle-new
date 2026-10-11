import { getStockLocations, type StockLocation } from '../../services/locationService';
import { ReceiveTransferButton } from './ReceiveTransferButton';
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, RefreshCw, AlertCircle, X, CheckCircle2, Truck, PackageCheck } from 'lucide-react';
import { Card } from '../../components/UI';
import {
  getStockDocuments, getWarehouses, createReceipt, createIssue, createTransfer,
  advanceDocument, advanceTransfer,
  type StockDocument, type StockDocLine, type Warehouse,
} from '../../services/stockService';
import { getProducts, type Product } from '../../services/productService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

type Kind = 'RECEIPT' | 'ISSUE' | 'TRANSFER';

const KIND_META: Record<Kind, { title: string; code: string; actionDone: string }> = {
  RECEIPT: { title: 'Nhập kho', code: 'PNK', actionDone: 'Hoàn tất nhận hàng' },
  ISSUE: { title: 'Xuất kho', code: 'PXK', actionDone: 'Hoàn tất xuất hàng' },
  TRANSFER: { title: 'Điều chuyển', code: 'DCK', actionDone: 'Xác nhận' },
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Nháp', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  IN_TRANSIT: { label: 'Đang vận chuyển', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  DONE: { label: 'Hoàn tất', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCELLED: { label: 'Đã hủy', cls: 'bg-red-50 text-red-600 border-red-200' },
};

// Trang chứng từ kho dùng chung cho Nhập/Xuất/Điều chuyển (§13–18).
export default function StockDocsPage({ deptKey, kind }: { deptKey: DeptKey; kind: Kind }) {
  const meta = KIND_META[kind];
  const [docs, setDocs] = useState<StockDocument[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [d, w] = await Promise.all([
        getStockDocuments({ docType: kind }),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setDocs(d); setWarehouses(w);
      getProducts().then(setProducts).catch(() => {});
    } catch (e: any) {
      setError(e.message || 'Không tải được chứng từ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind]);

  const act = async (id: string, fn: () => Promise<unknown>, doneMsg: string) => {
    setActingId(id); setError(null);
    try {
      await fn();
      await fetchAll();
    } catch (e: any) {
      setError(e.message || doneMsg);
    } finally {
      setActingId(null);
    }
  };

  const whName = (id: string | null) => warehouses.find((w) => w.id === id)?.name || id || '—';

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kho vận · {meta.title}</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Phiếu {meta.title.toLowerCase()}</h1>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-md transition-colors">
          <PlusCircle size={16} /> Tạo phiếu
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          <AlertCircle size={15} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải chứng từ...</p>
        </div>
      ) : docs.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <p className="font-medium">Chưa có phiếu {meta.title.toLowerCase()} nào</p>
          <p className="text-sm mt-1">Nhấn “Tạo phiếu” để bắt đầu.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-5 text-xs font-bold text-gray-500 uppercase">Mã phiếu</th>
                  <th className="text-left py-3 px-4 text-xs font-bold text-gray-500 uppercase">Tuyến</th>
                  <th className="text-center py-3 px-4 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                  <th className="text-left py-3 px-4 text-xs font-bold text-gray-500 uppercase">Ngày tạo</th>
                  <th className="text-right py-3 px-5 text-xs font-bold text-gray-500 uppercase">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {docs.map((d) => {
                  const st = STATUS_LABEL[d.status] || STATUS_LABEL.DRAFT;
                  const route = d.docType === 'TRANSFER' ? `${whName(d.sourceWarehouseId)} → ${whName(d.destWarehouseId)}` : whName(d.warehouseId);
                  return (
                    <tr key={d.id} className="hover:bg-gray-50/70">
                      <td className="py-3 px-5 font-bold text-gray-800 font-mono text-[13px]">{d.code || d.id.slice(0, 8)}</td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{route}</td>
                      <td className="py-3 px-4 text-center"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${st.cls}`}>{st.label}</span></td>
                      <td className="py-3 px-4 text-gray-400 text-xs">{d.createdAt ? new Date(d.createdAt).toLocaleString('vi-VN') : '—'}</td>
                      <td className="py-3 px-5">
                        <div className="flex justify-end gap-2">
                          {d.status === 'DRAFT' && kind !== 'TRANSFER' && (
                            <button disabled={actingId === d.id} onClick={() => act(d.id, () => advanceDocument(kind === 'RECEIPT' ? 'receipts' : 'issues', d.id, 'complete'), 'Hoàn tất thất bại')}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-60 transition-colors">
                              {actingId === d.id ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}{meta.actionDone}
                            </button>
                          )}
                          {d.status === 'DRAFT' && kind === 'TRANSFER' && (
                            <button disabled={actingId === d.id} onClick={() => act(d.id, () => advanceTransfer(d.id, 'ship'), 'Gửi hàng thất bại')}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold disabled:opacity-60 transition-colors">
                              {actingId === d.id ? <RefreshCw size={13} className="animate-spin" /> : <Truck size={13} />}Xác nhận gửi
                            </button>
                          )}
                          {d.status === 'IN_TRANSIT' && kind === 'TRANSFER' && (
                            <ReceiveTransferButton id={d.id} warehouseId={d.destWarehouseId!} onDone={fetchAll} />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showCreate && (
        <DocCreateModal
          kind={kind} warehouses={warehouses} products={products}
          onClose={() => setShowCreate(false)}
          onDone={async () => { setShowCreate(false); await fetchAll(); }}
          onError={setError}
        />
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}

function DocCreateModal({ kind, warehouses, products, onClose, onDone, onError }: {
  kind: Kind; warehouses: Warehouse[]; products: Product[];
  onClose: () => void; onDone: () => Promise<void>; onError: (m: string) => void;
}) {
  const [warehouseId, setWarehouseId] = useState('');
  const [destWarehouseId, setDestWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<StockDocLine[]>([{ productId: '', quantity: 1 }]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [locations, setLocations] = useState<StockLocation[]>([]);
  useEffect(() => {
    let active = true;
    setLocations([]);
    setLines(lines => lines.map(line => ({ ...line, locationId: '' })));
    if (warehouseId) getStockLocations(warehouseId)
      .then(rows => { if (active) setLocations(rows.filter(row => row.isActive)); })
      .catch(error => { if (active) setErr(error.message); });
    return () => { active = false; };
  }, [warehouseId]);

  const setLine = (i: number, patch: Partial<StockDocLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = lines.filter((l) => l.productId && Number(l.quantity) > 0).map((l) => ({ ...l, quantity: Number(l.quantity) }));
    if (clean.length === 0) { setErr('Thêm ít nhất 1 dòng hàng hợp lệ.'); return; }
    if (kind === 'TRANSFER' && (!warehouseId || !destWarehouseId || warehouseId === destWarehouseId)) {
      setErr('Chọn kho gửi và kho nhận khác nhau.'); return;
    }
    if (kind !== 'TRANSFER' && !warehouseId) { setErr('Chọn kho.'); return; }
    setSaving(true); setErr('');
    try {
      if (kind === 'RECEIPT') await createReceipt({ warehouseId, lines: clean, notes: notes || undefined });
      else if (kind === 'ISSUE') await createIssue({ warehouseId, lines: clean, notes: notes || undefined });
      else await createTransfer({ sourceWarehouseId: warehouseId, destWarehouseId, lines: clean, notes: notes || undefined });
      await onDone();
    } catch (e: any) {
      const msg = e.message || 'Tạo phiếu thất bại.';
      setErr(msg); onError(msg);
    } finally {
      setSaving(false);
    }
  };

  const productName = (id: string) => products.find((p) => p.id === id)?.name || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: '92vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900">Tạo phiếu {KIND_META[kind].title.toLowerCase()} ({KIND_META[kind].code})</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
            <div className={`grid gap-3 ${kind === 'TRANSFER' ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">{kind === 'TRANSFER' ? 'Kho gửi' : 'Kho'}</label>
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                  <option value="">-- Chọn kho --</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              {kind === 'TRANSFER' && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Kho nhận</label>
                  <select value={destWarehouseId} onChange={(e) => setDestWarehouseId(e.target.value)} required
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                    <option value="">-- Chọn kho --</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Dòng hàng</label>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}
                      className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                      <option value="">-- Chọn hàng --</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <select aria-label="Vị trí hàng" value={l.locationId || ''} onChange={e => setLine(i, { locationId: e.target.value })} className="min-w-0 w-36 border rounded-xl px-2 text-sm">
                      <option value="">Chưa phân vị trí</option>
                      {locations.filter(location => kind !== 'ISSUE' || location.purpose === 'SALEABLE').map(location => <option key={location.id} value={location.id}>{location.code}</option>)}
                    </select>
                    <input type="number" min={0.000001} step="any" value={l.quantity}
                      onChange={(e) => setLine(i, { quantity: Number(e.target.value) })}
                      className="w-24 px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none" title="Số lượng" />
                    <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      className="p-2 text-gray-300 hover:text-red-500 transition-colors" title="Xóa dòng">
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setLines((ls) => [...ls, { productId: '', quantity: 1 }])}
                className="mt-2 text-xs font-bold text-emerald-600 hover:underline">+ Thêm dòng</button>
              {lines.some((l) => l.productId) && (
                <p className="text-xs text-gray-400 mt-1">Đang chọn: {lines.filter((l) => l.productId).map((l) => productName(l.productId)).join(', ')}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Ghi chú</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-xl">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60 flex items-center gap-2">
              {saving ? <><RefreshCw size={14} className="animate-spin" />Đang tạo...</> : 'Tạo phiếu nháp'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
