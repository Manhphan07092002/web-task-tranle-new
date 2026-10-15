import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScanLine, PlusCircle, RefreshCw, AlertCircle, X, ChevronDown, Pencil } from 'lucide-react';
import { Card } from '../../components/UI';
import {
  getStockSerials, registerSerial, updateSerial, getWarehouses,
  type StockSerial, type Warehouse, type SerialStatus,
} from '../../services/stockService';
import { getProducts, type Product } from '../../services/productService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';
import { useAuth } from '../../contexts/AuthContext';
import { levelOf, LEVELS } from '../../utils/rbac';

const STATUSES: SerialStatus[] = ['SALEABLE', 'WARRANTY', 'DAMAGED', 'DEMO', 'QUARANTINE', 'SOLD'];
const STATUS_LABEL: Record<string, string> = {
  SALEABLE: 'Bán được', WARRANTY: 'Bảo hành', DAMAGED: 'Hàng lỗi',
  DEMO: 'Demo', QUARANTINE: 'Cách ly', SOLD: 'Đã bán',
};

// Serial / Lô (§22): tìm kiếm chung + chi tiết + đổi trạng thái (TP).
export default function SerialPage({ deptKey }: { deptKey: DeptKey }) {
  const { user } = useAuth();
  const canManage = levelOf(user) >= LEVELS.MANAGER && levelOf(user) !== LEVELS.ADMIN;
  const [rows, setRows] = useState<StockSerial[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<StockSerial | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [s, w] = await Promise.all([
        getStockSerials({ q: debouncedQ || undefined, status: status || undefined }),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setRows(s); setWarehouses(w);
      getProducts().then(setProducts).catch(() => {});
    } catch (e: any) {
      setError(e.message || 'Không tải được serial/lô');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [debouncedQ, status]);

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Hàng hóa</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Serial / Lô</h1>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-md transition-colors">
          <PlusCircle size={16} /> Đăng ký serial
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <ScanLine className="absolute left-3.5 top-3 text-gray-400" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nhập serial / lô / model / SKU..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-emerald-200 outline-none shadow-sm" />
        </div>
        <div className="relative">
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="pl-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">
            <option value="">Mọi trạng thái</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
        </div>
        <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
          <RefreshCw size={16} />
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
          <p className="text-gray-400 text-sm">Đang tải serial...</p>
        </div>
      ) : rows.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <ScanLine size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Không tìm thấy serial/lô nào</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-5 text-xs font-bold text-gray-500 uppercase">Serial / Lô · Sản phẩm</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Kho</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase hidden md:table-cell">Bảo hành</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                  <th className="text-right py-2 px-5 text-xs font-bold text-gray-500 uppercase">Sửa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/70">
                    <td className="py-2 px-5">
                      <p className="font-mono font-bold text-gray-800 text-[13px]">{r.serialNumber || r.lotCode || '—'}</p>
                      <p className="text-xs text-gray-400">{r.productName || r.productId}{r.lotCode && r.serialNumber ? ` · Lô ${r.lotCode}` : ''}</p>
                    </td>
                    <td className="py-2 px-4 text-xs text-gray-500">{r.warehouseName || r.warehouseId}</td>
                    <td className="py-2 px-4 text-xs text-gray-500 hidden md:table-cell">
                      {r.warrantyStart ? `${r.warrantyStart}${r.warrantyMonths ? ` · ${r.warrantyMonths} tháng` : ''}` : '—'}
                    </td>
                    <td className="py-2 px-4"><span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-600">{STATUS_LABEL[r.status] || r.status}</span></td>
                    <td className="py-2 px-5 text-right">
                      <button onClick={() => setEditing(r)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Chi tiết / đổi trạng thái">
                        <Pencil size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showCreate && (
        <SerialModal warehouses={warehouses} products={products}
          onClose={() => setShowCreate(false)}
          onDone={async () => { setShowCreate(false); await fetchAll(); }} />
      )}
      {editing && (
        <SerialStatusModal serial={editing} canManage={canManage}
          onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await fetchAll(); }} />
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}

function SerialModal({ warehouses, products, onClose, onDone }: {
  warehouses: Warehouse[]; products: Product[];
  onClose: () => void; onDone: () => Promise<void>;
}) {
  const [productId, setProductId] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [warrantyMonths, setWarrantyMonths] = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || !warehouseId || (!serialNumber.trim() && !lotCode.trim())) {
      setErr('Chọn hàng, kho và nhập serial hoặc lô.');
      return;
    }
    setSaving(true); setErr('');
    try {
      await registerSerial({
        productId, warehouseId,
        serialNumber: serialNumber.trim() || null, lotCode: lotCode.trim() || null,
        warrantyMonths: Number(warrantyMonths) || 0,
      });
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Đăng ký thất bại.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Đăng ký serial / lô</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mặt hàng</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} required
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
              <option value="">-- Chọn hàng --</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Serial</label>
              <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="VD: SAJ25A000123"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Lô</label>
              <input value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="VD: LOT-2026-001"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Kho</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                <option value="">-- Chọn kho --</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Bảo hành (tháng)</label>
              <input type="number" min={0} value={warrantyMonths} onChange={(e) => setWarrantyMonths(Number(e.target.value))}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
              {saving ? 'Đang lưu...' : 'Đăng ký'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SerialStatusModal({ serial, canManage, onClose, onDone }: {
  serial: StockSerial; canManage: boolean; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [status, setStatus] = useState<SerialStatus>(serial.status);
  const [customerName, setCustomerName] = useState(serial.customerName || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await updateSerial(serial.id, { status, customerName: customerName || null });
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Cập nhật thất bại (đổi trạng thái cần cấp TP).');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 font-mono text-sm">{serial.serialNumber || serial.lotCode}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
          <p className="text-sm text-gray-500">{serial.productName || serial.productId} · {serial.warehouseName || serial.warehouseId}</p>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Trạng thái (cần cấp TP)</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as SerialStatus)} disabled={!canManage}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none disabled:bg-gray-50 disabled:text-gray-400">
              {(['SALEABLE', 'WARRANTY', 'DAMAGED', 'DEMO', 'QUARANTINE', 'SOLD'] as SerialStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
            {!canManage && <p className="text-xs text-gray-400 mt-1">Bạn đang ở chế độ xem — đổi trạng thái cần cấp TP trở lên.</p>}
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Khách hàng / dự án gán</label>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none" />
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
              {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
