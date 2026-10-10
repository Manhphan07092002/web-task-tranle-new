import { useState } from 'react';
import { Card } from '../../components/UI';
import { useData } from '../../contexts/DataContext';
import { createTransaction } from '../../services/warehouseService';
import { txTypeLabel } from './dashboard/warehouseLabels';

interface Props {
  presetType?: string;
  presetScope?: 'internal' | 'site';
  showScopeSelect?: boolean;
  initial?: { productCode?: string; productName?: string; fromLocation?: string; toLocation?: string };
  title?: string;
  submitLabel?: string;
  toLocationLabel?: string;
  onCreated: () => void | Promise<void>;
  onError: (msg: string) => void;
  onCancel?: () => void;
}

const EMPTY = {
  type: 'IN',
  productCode: '',
  productName: '',
  quantity: '1',
  unit: 'pcs',
  fromLocation: '',
  toLocation: '',
  notes: '',
  referenceDoc: '',
  assignedTo: '',
  dueDate: '',
  priority: 'normal',
  transferScope: 'internal',
};

// Shared create form used by /warehouse and the dedicated doc pages.
export function WarehouseTransactionForm({
  presetType, presetScope, showScopeSelect = true, initial, title = 'Tạo phiếu kho',
  submitLabel = 'Tạo phiếu', toLocationLabel, onCreated, onError, onCancel,
}: Props) {
  const { users } = useData();
  const [form, setForm] = useState({
    ...EMPTY,
    type: presetType || 'IN',
    transferScope: (presetScope || 'internal') as 'internal' | 'site',
    productCode: initial?.productCode || '',
    productName: initial?.productName || '',
    fromLocation: initial?.fromLocation || '',
    toLocation: initial?.toLocation || '',
  });
  const [saving, setSaving] = useState(false);

  const inputCls = 'px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.productCode.trim() || !form.productName.trim()) {
      onError('Mã và tên sản phẩm là bắt buộc.');
      return;
    }
    const qty = Number(form.quantity);
    if (!qty || qty <= 0) {
      onError('Số lượng phải lớn hơn 0.');
      return;
    }
    try {
      setSaving(true);
      await createTransaction({
        type: form.type,
        productCode: form.productCode.trim(),
        productName: form.productName.trim(),
        quantity: qty,
        unit: form.unit.trim() || 'pcs',
        fromLocation: form.fromLocation.trim() || undefined,
        toLocation: form.toLocation.trim() || undefined,
        notes: form.notes.trim() || undefined,
        referenceDoc: form.referenceDoc.trim() || undefined,
        assignedTo: form.assignedTo || undefined,
        dueDate: form.dueDate || undefined,
        priority: form.priority,
        transferScope: form.type === 'TRANSFER' ? form.transferScope : undefined,
      });
      setForm({ ...EMPTY, type: presetType || 'IN', transferScope: presetScope || 'internal' });
      await onCreated();
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : 'Tạo phiếu thất bại');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">{title}</h2>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {!presetType && (
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
            Loại phiếu
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputCls}>
              {['IN', 'OUT', 'TRANSFER', 'RETURN', 'ADJUST'].map((t) => (
                <option key={t} value={t}>{txTypeLabel(t)} ({t})</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
          Mã sản phẩm *
          <input value={form.productCode} onChange={(e) => setForm({ ...form, productCode: e.target.value })}
            placeholder="VD: PANEL-MONO-450W" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
          Tên sản phẩm *
          <input value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })}
            placeholder="VD: Tấm pin mặt trời Mono 450W" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
          Số lượng *
          <input type="number" min="0" step="any" value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
          Đơn vị
          <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
            placeholder="pcs" className={inputCls} />
        </label>
        {(form.type === 'OUT' || form.type === 'TRANSFER' || form.type === 'RETURN') && (
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
            Vị trí nguồn
            <input value={form.fromLocation} onChange={(e) => setForm({ ...form, fromLocation: e.target.value })}
              placeholder="VD: Khu A-Giá 01" className={inputCls} />
          </label>
        )}
        {(form.type === 'IN' || form.type === 'TRANSFER' || form.type === 'RETURN') && (
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
            {toLocationLabel || (form.type === 'TRANSFER' && form.transferScope === 'site' ? 'Công trường nhận' : 'Vị trí đến')}
            <input value={form.toLocation} onChange={(e) => setForm({ ...form, toLocation: e.target.value })}
              placeholder={form.type === 'TRANSFER' && form.transferScope === 'site' ? 'VD: Công trường ABC' : 'VD: Khu A-Giá 01'} className={inputCls} />
          </label>
        )}
        {form.type === 'TRANSFER' && showScopeSelect && !presetScope && (
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
            Phạm vi điều chuyển
            <select value={form.transferScope} onChange={(e) => setForm({ ...form, transferScope: e.target.value as 'internal' | 'site' })} className={inputCls}>
              <option value="internal">Giữa các kho</option>
              <option value="site">Ra công trường</option>
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
          Người xử lý
          <select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className={inputCls}>
            <option value="">-- Tự xử lý --</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
          Hạn xử lý
          <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
          Ưu tiên
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={inputCls}>
            <option value="low">Thấp</option>
            <option value="normal">Bình thường</option>
            <option value="high">Cao</option>
            <option value="urgent">Khẩn</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
          Ghi chú
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Ghi chú thêm..." className={inputCls} />
        </label>
        <div className="md:col-span-3 flex justify-end gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm">
              Hủy
            </button>
          )}
          <button type="submit" disabled={saving}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
            {submitLabel}
          </button>
        </div>
      </form>
    </Card>
  );
}
