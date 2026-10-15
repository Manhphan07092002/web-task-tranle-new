import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, PlusCircle, RefreshCw, AlertCircle, X, Pencil, Trash2, Copy, Warehouse as WarehouseIcon } from 'lucide-react';
import { Card } from '../../components/UI';
import { Pagination } from '../../components/Pagination';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { getStockLocations, saveStockLocation, type StockLocation } from '../../services/locationService';
import { getWarehouses, createWarehouse, updateWarehouse, deleteWarehouse, type Warehouse } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';
import { useRBAC } from '../../hooks/useRBAC';
import { LEVELS } from '../../utils/rbac';

const TYPES = ['INTERNAL', 'SUPPLIER', 'CUSTOMER', 'TRANSIT', 'LOSS', 'ADJUSTMENT'];
const PURPOSES = ['SALEABLE', 'WARRANTY', 'DAMAGED', 'DEMO', 'QUARANTINE', 'PICKING', 'RECEIVING', 'OTHER'];

// Kho & Vị trí (§24) — master/detail gọn: sidebar chọn kho + bảng vị trí của kho đang chọn.
// Thêm/sửa/xóa kho chỉ TP+ (backend enforce, UI chỉ ẩn nút).
export default function LocationsPage({ deptKey }: { deptKey: DeptKey }) {
  const { managementLevel } = useRBAC();
  const canManage = managementLevel >= LEVELS.MANAGER && managementLevel !== LEVELS.ADMIN;
  const [rows, setRows] = useState<StockLocation[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [whPage, setWhPage] = useState(1);
  const [whPageSize, setWhPageSize] = useState(10);
  const [editing, setEditing] = useState<StockLocation | null | undefined>(undefined);
  const [editingWh, setEditingWh] = useState<Warehouse | null | undefined>(undefined);
  const [deletingWh, setDeletingWh] = useState<Warehouse | null>(null);

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [l, w] = await Promise.all([
        getStockLocations(warehouseId || undefined),
        getWarehouses().catch(() => [] as Warehouse[]),
      ]);
      setRows(l); setWarehouses(w);
    } catch (e: any) {
      setError(e.message || 'Không tải được vị trí');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [warehouseId]);

  // Mặc định chọn kho đầu tiên trong phạm vi để khỏi lặp 7 vị trí seed trên mọi kho.
  useEffect(() => {
    if (!warehouseId && warehouses.length > 0) setWarehouseId(warehouses[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses]);

  const whTotalPages = Math.max(1, Math.ceil(warehouses.length / whPageSize));
  const safeWhPage = Math.min(Math.max(1, whPage), whTotalPages);
  const pagedWarehouses = warehouses.slice((safeWhPage - 1) * whPageSize, safeWhPage * whPageSize);
  const selected = warehouses.find((w) => w.id === warehouseId) || null;

  const saveWarehouse = async (body: { code: string; name: string; address: string; isActive: boolean }) => {
    if (editingWh && editingWh.id) {
      await updateWarehouse(editingWh.id, body);
    } else {
      const { id } = await createWarehouse(body);
      setWarehouseId(id);
    }
  };

  const confirmDeleteWarehouse = async () => {
    if (!deletingWh) return;
    try {
      await deleteWarehouse(deletingWh.id);
      setDeletingWh(null);
      setWarehouseId('');
      await fetchAll();
    } catch (e: any) {
      setDeletingWh(null);
      setError(e.message || 'Xóa kho thất bại');
    }
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Kho vận · Hàng hóa</p>
          <h1 className="text-2xl font-bold text-gray-800">Kho &amp; Vị trí</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
            <RefreshCw size={16} />
          </button>
          {canManage && (
            <button onClick={() => setEditingWh(null)}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-md transition-colors">
              <WarehouseIcon size={16} /> Thêm kho
            </button>
          )}
          <button onClick={() => setEditing(null)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-md transition-colors">
            <PlusCircle size={16} /> Thêm vị trí
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
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải vị trí...</p>
        </div>
      ) : warehouses.length === 0 ? (
        <Card className="py-16 text-center text-gray-400">
          <MapPin size={36} className="mx-auto mb-3 opacity-25" strokeWidth={1.5} />
          <p className="font-medium">Chưa có kho nào trong phạm vi của bạn</p>
        </Card>
      ) : (
        <>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase">
                  <th className="py-1.5 px-5 w-12 hidden sm:table-cell">STT</th>
                  <th className="py-1.5 px-4">Mã kho</th>
                  <th className="py-1.5 px-4">Tên kho</th>
                  <th className="py-1.5 px-4 hidden md:table-cell">Địa chỉ</th>
                  <th className="py-1.5 px-4">Trạng thái</th>
                  {canManage && <th className="py-1.5 px-5 text-right">Thao tác</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pagedWarehouses.map((w, idx) => (
                  <tr key={w.id} onClick={() => setWarehouseId(w.id)}
                    className={`cursor-pointer ${w.id === warehouseId ? 'bg-emerald-50/60' : 'hover:bg-gray-50/70'}`}>
                    <td className="py-1.5 px-5 text-gray-400 text-xs hidden sm:table-cell">{(safeWhPage - 1) * whPageSize + idx + 1}</td>
                    <td className="py-1.5 px-4 font-mono font-bold text-gray-800 text-xs">{w.code}</td>
                    <td className="py-1.5 px-4 text-gray-700">{w.name}</td>
                    <td className="py-1.5 px-4 text-xs text-gray-500 hidden md:table-cell">{w.address || '—'}</td>
                    <td className="py-1.5 px-4 text-xs">{w.isActive ? <span className="text-emerald-600 font-bold">Đang sử dụng</span> : <span className="text-gray-400">Ngưng</span>}</td>
                    {canManage && (
                      <td className="py-1.5 px-5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setEditingWh({ ...w, id: '' })} className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Nhân bản kho">
                          <Copy size={14} />
                        </button>
                        <button onClick={() => setEditingWh(w)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Sửa kho">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeletingWh(w)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Xóa kho">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-500">Tổng số: <b className="text-gray-700">{warehouses.length}</b></span>
            <label className="ml-auto flex items-center gap-2 text-sm text-gray-500">
              Số dòng/trang
              <select value={whPageSize} onChange={(e) => { setWhPageSize(Number(e.target.value)); setWhPage(1); }}
                className="px-2 py-1.5 border border-gray-200 rounded-lg bg-white text-sm outline-none">
                {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <div className="px-5 pb-4">
            <Pagination currentPage={safeWhPage} totalPages={whTotalPages} onPageChange={setWhPage} totalItems={warehouses.length} itemsPerPage={whPageSize} />
          </div>
        </Card>

        <Card className="overflow-hidden">
          {selected && (
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 font-bold text-gray-700 text-sm">{selected.name}</div>
          )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="py-1.5 px-5">Mã / Tên</th>
                    <th className="py-1.5 px-4 hidden lg:table-cell">Loại</th>
                    <th className="py-1.5 px-4">Mục đích</th>
                    <th className="py-1.5 px-4">Trạng thái</th>
                    <th className="py-1.5 px-5 text-right">Sửa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50/70">
                      <td className="py-1.5 px-5">
                        <span className="font-mono font-bold text-gray-800 text-xs">{l.code}</span>
                        <span className="text-gray-500 text-xs ml-2">{l.name}</span>
                      </td>
                      <td className="py-1.5 px-4 text-xs text-gray-500 hidden lg:table-cell">{l.type}</td>
                      <td className="py-1.5 px-4"><span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-600">{l.purpose}</span></td>
                      <td className="py-1.5 px-4 text-xs">{l.isActive ? <span className="text-emerald-600 font-bold">Hoạt động</span> : <span className="text-gray-400">Ngưng</span>}</td>
                      <td className="py-1.5 px-5 text-right">
                        <button onClick={() => setEditing(l)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Sửa">
                          <Pencil size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="py-10 text-center text-gray-400 text-sm">Kho này chưa có vị trí nào</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {editing !== undefined && (
        <LocationModal
          initial={editing} warehouses={warehouses} locations={rows}
          onClose={() => setEditing(undefined)}
          onDone={async () => { setEditing(undefined); await fetchAll(); }}
        />
      )}

      {editingWh !== undefined && (
        <WarehouseModal
          initial={editingWh}
          onClose={() => setEditingWh(undefined)}
          onDone={async (body) => {
            try {
              await saveWarehouse(body);
              setEditingWh(undefined);
              await fetchAll();
            } catch (e: any) {
              setError(e.message || 'Lưu kho thất bại');
            }
          }}
        />
      )}

      <ConfirmDialog
        isOpen={deletingWh !== null}
        title="Xóa kho?"
        message={deletingWh ? `Xóa "${deletingWh.name}" cùng toàn bộ vị trí trong kho. Chỉ xóa được kho chưa có chứng từ/tồn kho. Không thể hoàn tác.` : ''}
        confirmText="Xóa kho"
        onConfirm={confirmDeleteWarehouse}
        onCancel={() => setDeletingWh(null)}
      />

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}

function WarehouseModal({ initial, onClose, onDone }: {
  initial: Warehouse | null; onClose: () => void; onDone: (body: { code: string; name: string; address: string; isActive: boolean }) => Promise<void>;
}) {
  const [code, setCode] = useState(initial?.code || '');
  const [name, setName] = useState(initial?.name || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [isActive, setIsActive] = useState(initial ? !!initial.isActive : true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) { setErr('Nhập mã và tên kho.'); return; }
    setSaving(true); setErr('');
    try {
      await onDone({ code: code.trim(), name: name.trim(), address: address.trim(), isActive });
    } catch (e: any) {
      setErr(e.message || 'Lưu thất bại.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{initial && initial.id ? 'Sửa kho' : 'Thêm kho'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mã kho</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="VD: HN2"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Tên kho</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Kho Hà Nội 2"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Địa chỉ</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none" />
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4 rounded border-gray-300" />
                Đang sử dụng
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
              {saving ? 'Đang lưu...' : initial && initial.id ? 'Lưu thay đổi' : 'Thêm kho'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LocationModal({ initial, warehouses, locations, onClose, onDone }: {
  initial: StockLocation | null; warehouses: Warehouse[]; locations: StockLocation[];
  onClose: () => void; onDone: () => Promise<void>;
}) {
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId || '');
  const [code, setCode] = useState(initial?.code || '');
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || 'INTERNAL');
  const [purpose, setPurpose] = useState(initial?.purpose || 'SALEABLE');
  const [parentId, setParentId] = useState(initial?.parentId || '');
  const [isActive, setIsActive] = useState(initial ? !!initial.isActive : true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouseId || !code.trim() || !name.trim()) { setErr('Chọn kho, nhập mã và tên vị trí.'); return; }
    setSaving(true); setErr('');
    try {
      await saveStockLocation({
        id: initial?.id, warehouseId, code: code.trim(), name: name.trim(),
        type, purpose, parentId: parentId || null, isActive,
      });
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Lưu thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const parents = locations.filter((l) => l.warehouseId === warehouseId && l.id !== initial?.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{initial ? 'Sửa vị trí' : 'Thêm vị trí'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Kho</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required disabled={!!initial}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none disabled:bg-gray-50">
                <option value="">-- Chọn kho --</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mã</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="VD: A-01-02"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Tên</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Kệ A tầng 2"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Loại</label>
              <select value={type} onChange={(e) => setType(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Mục đích</label>
              <select value={purpose} onChange={(e) => setPurpose(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Thuộc vị trí cha</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                <option value="">-- Không --</option>
                {parents.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4 rounded border-gray-300" />
                Hoạt động
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60">
              {saving ? 'Đang lưu...' : initial ? 'Lưu thay đổi' : 'Thêm vị trí'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
