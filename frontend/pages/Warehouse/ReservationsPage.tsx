import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, PlusCircle, RefreshCw, AlertCircle, X, ChevronDown, Undo2, CheckCircle2 } from 'lucide-react';
import { Card } from '../../components/UI';
import { getReservations, holdStock, settleReservation, type Reservation } from '../../services/reservationService';
import { getWarehouses, type Warehouse } from '../../services/stockService';
import { getProducts, type Product } from '../../services/productService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';
import { useAuth } from '../../contexts/AuthContext';
import { levelOf, LEVELS } from '../../utils/rbac';

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  HELD: { label: 'Đang giữ', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  RELEASED: { label: 'Đã giải phóng', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  CONSUMED: { label: 'Đã xuất', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

const SOURCE_LABEL: Record<string, string> = {
  SALES_ORDER: 'Đơn bán', PROJECT: 'Dự án', WARRANTY: 'Bảo hành', INTERNAL: 'Nội bộ',
};

// Giữ hàng / phân bổ TP (§21): giữ từ available, giải phóng khi hủy/hết hạn,
// consume khi xuất xong. Không tạo move khi giữ.
export default function ReservationsPage({ deptKey }: { deptKey: DeptKey }) {
  const { user } = useAuth();
  const canManage = levelOf(user) >= LEVELS.MANAGER && levelOf(user) !== LEVELS.ADMIN;
  const [rows, setRows] = useState<Reservation[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('HELD');
  const [actingId, setActingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [r, w] = await Promise.all([
        getReservations(undefined, status || undefined),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setRows(r); setWarehouses(w);
      getProducts().then(setProducts).catch(() => {});
    } catch (e: any) {
      setError(e.message || 'Không tải được giữ hàng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  const act = async (id: string, action: 'release' | 'consume') => {
    setActingId(id); setError(null);
    try {
      await settleReservation(id, action);
      await fetchAll();
    } catch (e: any) {
      setError(e.message || 'Thao tác thất bại');
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kho vận · Vận hành</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Giữ hàng / Phân bổ</h1>
          <p className="text-gray-500 text-sm mt-1">Chỉ giữ từ tồn khả dụng — giải phóng khi hủy, xuất khi bàn giao.{canManage ? '' : ' Bạn đang ở chế độ xem (cần quyền quản lý kho để thao tác).'}</p>
        </div>
        <div className="flex gap-2">
          <div className="flex bg-gray-100 rounded-xl p-1">
            {['HELD', 'CONSUMED', 'RELEASED', ''].map((s) => (
              <button key={s} onClick={() => setStatus(s)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${status === s ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}>
                {s === '' ? 'Tất cả' : STATUS_LABEL[s].label}
              </button>
            ))}
          </div>
          {canManage && (
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-md transition-colors">
              <PlusCircle size={16} /> Giữ hàng
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          <AlertCircle size={15} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải giữ hàng...</p>
        </div>
      ) : rows.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <Bookmark size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Không có giữ hàng nào</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-5 text-xs font-bold text-gray-500 uppercase">Hàng / Kho</th>
                  <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase">Số lượng</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase hidden md:table-cell">Nguồn</th>
                  <th className="text-center py-2 px-4 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                  <th className="text-right py-2 px-5 text-xs font-bold text-gray-500 uppercase">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => {
                  const st = STATUS_LABEL[r.status] || STATUS_LABEL.HELD;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50/70">
                      <td className="py-2 px-5">
                        <p className="font-semibold text-gray-800">{r.productName || r.productId}</p>
                        <p className="text-xs text-gray-400">{r.warehouseName || r.warehouseId}</p>
                      </td>
                      <td className="py-2 px-4 text-right font-black text-gray-900">{Number(r.quantity).toLocaleString('vi-VN')}</td>
                      <td className="py-2 px-4 text-xs text-gray-500 hidden md:table-cell">{SOURCE_LABEL[r.sourceType] || r.sourceType}{r.sourceId ? ` · ${r.sourceId}` : ''}</td>
                      <td className="py-2 px-4 text-center"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${st.cls}`}>{st.label}</span></td>
                      <td className="py-2 px-5">
                        {r.status === 'HELD' && canManage && (
                          <div className="flex justify-end gap-2">
                            <button disabled={actingId === r.id} onClick={() => act(r.id, 'release')}
                              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg text-xs font-bold disabled:opacity-60">
                              {actingId === r.id ? <RefreshCw size={13} className="animate-spin" /> : <Undo2 size={13} />}Giải phóng
                            </button>
                            <button disabled={actingId === r.id} onClick={() => act(r.id, 'consume')}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-60">
                              {actingId === r.id ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}Xuất hàng
                            </button>
                          </div>
                        )}
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
        <HoldCreateModal warehouses={warehouses} products={products}
          onClose={() => setShowCreate(false)}
          onDone={async () => { setShowCreate(false); await fetchAll(); }}
          onError={setError} />
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}

function HoldCreateModal({ warehouses, products, onClose, onDone, onError }: {
  warehouses: Warehouse[]; products: Product[];
  onClose: () => void; onDone: () => Promise<void>; onError: (m: string) => void;
}) {
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [sourceType, setSourceType] = useState('INTERNAL');
  const [sourceId, setSourceId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || !warehouseId || !(Number(quantity) > 0)) { setErr('Chọn hàng, kho và số lượng hợp lệ.'); return; }
    setSaving(true); setErr('');
    try {
      await holdStock({ productId, warehouseId, quantity: Number(quantity), sourceType, sourceId: sourceId || undefined });
      await onDone();
    } catch (e: any) {
      const msg = e.message || 'Giữ hàng thất bại.';
      setErr(msg); onError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Giữ hàng mới</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mặt hàng</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                <option value="">-- Chọn hàng --</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Kho</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                <option value="">-- Chọn kho --</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Số lượng</label>
              <input type="number" min={1} step="any" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Nguồn</label>
              <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                <option value="INTERNAL">Nội bộ</option>
                <option value="SALES_ORDER">Đơn bán</option>
                <option value="PROJECT">Dự án</option>
                <option value="WARRANTY">Bảo hành</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mã nguồn (tùy chọn)</label>
              <input value={sourceId} onChange={(e) => setSourceId(e.target.value)} placeholder="VD: SO-00123"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60 flex items-center gap-2">
              {saving ? <><RefreshCw size={14} className="animate-spin" />Đang giữ...</> : 'Giữ hàng'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
