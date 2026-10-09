import { useEffect, useState } from 'react';
import { Package, ClipboardList, Check, X } from 'lucide-react';
import { Card } from '../../components/UI';
import { useRBAC } from '../../hooks/useRBAC';
import * as warehouseService from '../../services/warehouseService';
import type { InventoryItem, WarehouseTransaction } from '../../services/warehouseService';

export default function WarehousePage() {
  const { canApprove } = useRBAC();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<WarehouseTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setActionError(null);
      const [inv, trans] = await Promise.all([
        warehouseService.getInventory(),
        warehouseService.getTransactions(),
      ]);
      setInventory(inv);
      setTransactions(trans);
    } catch (error) {
      console.error('Failed to load warehouse data', error);
      setActionError('Không tải được dữ liệu kho.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleApprove = async (id: string) => {
    try {
      await warehouseService.approveTransaction(id);
      await loadData();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : 'Duyệt phiếu thất bại');
    }
  };

  const handleReject = async (id: string) => {
    const reason = window.prompt('Lý do từ chối phiếu kho:');
    if (reason === null) return;
    try {
      await warehouseService.rejectTransaction(id, reason);
      await loadData();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : 'Từ chối phiếu thất bại');
    }
  };

  const filteredInventory = inventory.filter((item) =>
    item.productName.toLowerCase().includes(search.toLowerCase()) ||
    item.productCode.toLowerCase().includes(search.toLowerCase())
  );

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({
    type: 'IN',
    productCode: '',
    productName: '',
    quantity: '1',
    toLocation: '',
    notes: '',
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.productCode.trim() || !createForm.productName.trim()) {
      setActionError('Mã và tên sản phẩm là bắt buộc.');
      return;
    }
    const qty = Number(createForm.quantity);
    if (!qty || qty <= 0) {
      setActionError('Số lượng phải lớn hơn 0.');
      return;
    }
    try {
      setActionError(null);
      await warehouseService.createTransaction({
        type: createForm.type,
        productCode: createForm.productCode.trim(),
        productName: createForm.productName.trim(),
        quantity: qty,
        toLocation: createForm.toLocation.trim() || undefined,
        notes: createForm.notes.trim() || undefined,
      });
      setCreateForm({ type: 'IN', productCode: '', productName: '', quantity: '1', toLocation: '', notes: '' });
      setShowCreateForm(false);
      await loadData();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : 'Tạo phiếu thất bại');
    }
  };

  const canApproveWarehouse = canApprove('warehouse');
  const pendingCount = transactions.filter((t) => t.status === 'pending').length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <Package className="text-emerald-500" /> Quản Lý Kho Vận
          </h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1">
            Tồn kho theo phòng ban • {pendingCount} phiếu chờ duyệt
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shadow-sm"
        >
          {showCreateForm ? 'Đóng' : '+ Tạo phiếu kho'}
        </button>
      </div>

      {showCreateForm && (
        <Card className="p-4">
          <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">Tạo phiếu xuất / nhập kho</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Loại phiếu
              <select
                value={createForm.type}
                onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
              >
                <option value="IN">Nhập kho (IN)</option>
                <option value="OUT">Xuất kho (OUT)</option>
                <option value="ADJUST">Điều chỉnh (ADJUST)</option>
                <option value="TRANSFER">Chuyển kho (TRANSFER)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Mã sản phẩm *
              <input
                value={createForm.productCode}
                onChange={(e) => setCreateForm({ ...createForm, productCode: e.target.value })}
                placeholder="VD: PANEL-MONO-450W"
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Tên sản phẩm *
              <input
                value={createForm.productName}
                onChange={(e) => setCreateForm({ ...createForm, productName: e.target.value })}
                placeholder="VD: Tấm pin mặt trời Mono 450W"
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Số lượng *
              <input
                type="number"
                min="0"
                step="any"
                value={createForm.quantity}
                onChange={(e) => setCreateForm({ ...createForm, quantity: e.target.value })}
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Vị trí đến
              <input
                value={createForm.toLocation}
                onChange={(e) => setCreateForm({ ...createForm, toLocation: e.target.value })}
                placeholder="VD: Khu A-Giá 01"
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
              Ghi chú
              <input
                value={createForm.notes}
                onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                placeholder="Ghi chú thêm..."
                className="px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100"
              />
            </label>
            <div className="md:col-span-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm"
              >
                Tạo phiếu
              </button>
            </div>
          </form>
        </Card>
      )}

      {actionError && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {actionError}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex flex-col sm:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <input
              type="text"
              placeholder="Tìm theo mã / tên sản phẩm..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-4 pr-4 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 focus:ring-2 focus:ring-emerald-500 text-gray-800 dark:text-slate-100"
            />
          </div>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-bold text-gray-600 dark:text-slate-300 hover:bg-gray-50"
          >
            Tải lại
          </button>
        </div>

        <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
          <Package size={16} className="text-emerald-600" />
          <h2 className="font-bold text-gray-800 dark:text-slate-100">Tồn kho ({filteredInventory.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã SP</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Tên SP</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Số lượng</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">ĐVT</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Vị trí</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
              ) : filteredInventory.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Không có tồn kho trong phạm vi quyền của bạn.</td></tr>
              ) : (
                filteredInventory.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="p-3 text-sm font-semibold">{item.productCode}</td>
                    <td className="p-3 text-sm font-bold">{item.productName}</td>
                    <td className="p-3 text-sm text-center font-bold">{Number(item.quantity).toLocaleString('vi-VN')}</td>
                    <td className="p-3 text-sm">{item.unit}</td>
                    <td className="p-3 text-sm text-gray-500">{item.warehouseLocation || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
          <ClipboardList size={16} className="text-blue-600" />
          <h2 className="font-bold text-gray-800 dark:text-slate-100">Phiếu xuất / nhập kho ({transactions.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Loại</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Mã SP</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">SL</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {transactions.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">Chưa có phiếu kho nào.</td></tr>
              ) : (
                transactions.map((trans) => (
                  <tr key={trans.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="p-3 text-sm font-bold">{trans.type}</td>
                    <td className="p-3 text-sm">{trans.productCode}</td>
                    <td className="p-3 text-sm text-center">{Number(trans.quantity).toLocaleString('vi-VN')}</td>
                    <td className="p-3 text-sm">
                      <span className={`px-2 py-1 rounded font-bold text-xs ${trans.status === 'pending' ? 'bg-amber-100 text-amber-700' : trans.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {trans.status}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      {trans.status === 'pending' && canApproveWarehouse ? (
                        <div className="flex justify-center gap-2">
                          <button onClick={() => handleApprove(trans.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Duyệt">
                            <Check size={16} />
                          </button>
                          <button onClick={() => handleReject(trans.id)} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg" title="Từ chối">
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
