import React, { useEffect, useState } from 'react';
import { Card } from '../../components/UI';
import { Pagination } from '../../components/Pagination';
import { FeedbackDialog } from '../../components/FeedbackDialog';
import { getAvailableInventory, getInventoryDetails, getWarehouses, type AvailableInventoryRow, type InventoryDetails, type Warehouse } from '../../services/stockService';

export default function AvailableInventoryReference() {
  const [rows, setRows] = useState<AvailableInventoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [query, setQuery] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [tracking, setTracking] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<InventoryDetails | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  useEffect(() => { getWarehouses().then(setWarehouses).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [query, warehouseId, tracking, onlyAvailable]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    getAvailableInventory({
      q: query.trim() || undefined,
      warehouseId: warehouseId || undefined,
      tracking: tracking || undefined,
      onlyAvailable,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }).then((result) => {
      if (!cancelled) { setRows(result.rows); setTotal(result.total); }
    }).catch((e: any) => {
      if (!cancelled) setError(e.message || 'Không tải được tồn kho khả dụng');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, warehouseId, tracking, onlyAvailable, page, pageSize]);

  const trackingLabel = (value: string | null) => value === 'SERIAL' ? 'Serial' : value === 'LOT' ? 'Lô' : 'Số lượng';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const openDetails = async (row: AvailableInventoryRow) => {
    try { setDetails(await getInventoryDetails(row.productId, row.warehouseId)); }
    catch (e: any) { setDetailsError(e.message || 'Không tải được chi tiết tồn kho'); }
  };

  return (
    <>
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-bold text-gray-800">Tồn kho khả dụng</h2>
            <p className="text-xs text-gray-400 mt-0.5">Tồn hiện tại để kiểm tra trước khi tạo giữ hàng.</p>
          </div>
          <span className="text-xs text-gray-400">{total} dòng</span>
        </div>
        <div className="p-3 border-b border-gray-100 bg-gray-50/60 flex flex-wrap gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm sản phẩm / mã / Serial / thương hiệu..." className="flex-1 min-w-[220px] px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none focus:border-emerald-500" />
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm text-gray-700 outline-none focus:border-emerald-500">
            <option value="">Tất cả kho</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
          <select value={tracking} onChange={(e) => setTracking(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm text-gray-700 outline-none focus:border-emerald-500">
            <option value="">Tất cả loại quản lý</option>
            <option value="SERIAL">Serial</option><option value="LOT">Lô</option><option value="QUANTITY">Số lượng</option>
          </select>
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} className="accent-emerald-600" /> Còn khả dụng
          </label>
        </div>
        {error && <p className="m-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">{error}</p>}
        {loading ? <div className="py-8 text-center text-sm text-gray-400">Đang tải tồn kho...</div> : rows.length === 0 ? <div className="py-8 text-center text-sm text-gray-400">Không có tồn kho phù hợp.</div> : (
          <div className="overflow-x-auto">
            <table className="wh-table w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200"><tr>
                {['Mã SP / Sản phẩm', 'Kho', 'Tồn thực tế', 'Đang giữ', 'Khả dụng', 'Quản lý', 'Thao tác'].map((header) => <th key={header} className="text-left py-2 px-3 text-xs font-bold text-gray-500 uppercase">{header}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">{rows.map((row) => <tr key={`${row.productId}:${row.warehouseId}`} className="hover:bg-emerald-50/40">
                <td className="py-2.5 px-4"><div className="font-mono text-xs font-bold text-gray-700" title={row.productId}>{row.productCode || row.productId}</div><div className="text-xs text-gray-600 mt-0.5">{row.productName || '—'}</div></td>
                <td className="py-2.5 px-3 text-xs text-gray-600">{row.warehouseName || row.warehouseId}</td>
                <td className="py-2.5 px-3 text-right font-mono text-xs">{Number(row.onHand).toLocaleString('vi-VN')} {row.unit || ''}</td>
                <td className="py-2.5 px-3 text-right font-mono text-xs text-amber-700">{Number(row.reserved).toLocaleString('vi-VN')} {row.unit || ''}</td>
                <td className="py-2.5 px-3 text-right font-mono text-xs font-bold text-emerald-700">{Number(row.available).toLocaleString('vi-VN')} {row.unit || ''}</td>
                <td className="py-2.5 px-3 text-center"><span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-bold">{trackingLabel(row.tracking)}</span></td>
                <td className="py-2.5 px-4 text-right"><button type="button" onClick={() => openDetails(row)} className="px-2.5 py-1 rounded-lg text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100">Xem</button></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {!loading && total > 0 && <div className="px-4 pb-4"><Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} totalItems={total} itemsPerPage={pageSize} onItemsPerPageChange={(size) => { setPageSize(size); setPage(1); }} /></div>}
      </Card>
      {detailsError && <FeedbackDialog title="Không tải được tồn kho" message={detailsError} tone="error" onClose={() => setDetailsError(null)} />}
      {details && <InventoryDetailsModal details={details} onClose={() => setDetails(null)} />}
    </>
  );
}

function InventoryDetailsModal({ details, onClose }: { details: InventoryDetails; onClose: () => void }) {
  // Ưu tiên Serial đã ghi nhận: các sản phẩm legacy có thể chưa đổi metadata
  // tracking nhưng vẫn được xử lý bằng Serial bắt buộc trong quy trình mới.
  const showSerials = details.serials.length > 0 || details.product.tracking === 'SERIAL';
  return <div className="fixed inset-0 z-[75] bg-slate-900/45 backdrop-blur-[2px] p-3 sm:p-6 flex items-center justify-center" role="dialog" aria-modal="true">
    <div className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-3xl bg-white shadow-2xl">
      <div className="sticky top-0 z-10 px-5 py-4 border-b border-gray-100 bg-white flex items-start justify-between"><div><p className="text-xs font-bold text-gray-400 uppercase">Chi tiết tồn kho</p><h2 className="text-xl font-bold text-gray-800 mt-1">{details.product.name}</h2><p className="text-xs text-gray-500 mt-1">{details.product.importCode || details.product.id} · {details.warehouse.name}</p></div><button type="button" onClick={onClose} className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-bold text-gray-600">Đóng</button></div>
      <div className="p-5 space-y-4"><div className="grid grid-cols-3 gap-2 sm:gap-4">{[['Tồn thực tế', details.summary.onHand, 'bg-gray-50'], ['Đang giữ', details.summary.reserved, 'bg-amber-50'], ['Khả dụng', details.summary.available, 'bg-emerald-50']].map(([label, value, cls]) => <div key={String(label)} className={`rounded-xl p-3 ${cls}`}><p className="text-xs text-gray-500">{label}</p><b className="text-lg">{Number(value).toLocaleString('vi-VN')} {details.product.unit || ''}</b></div>)}</div>
        <div className="overflow-x-auto border border-gray-100 rounded-xl"><table className="wh-table wh-table-compact w-full text-sm"><thead className="bg-gray-50"><tr>{['Serial / Lô', 'Ngày nhập', 'Số lượng còn', 'Trạng thái', 'Phiếu nhập'].map((header) => <th key={header} className="text-left px-3 py-2 text-xs font-bold text-gray-500 uppercase">{header}</th>)}</tr></thead><tbody className="divide-y divide-gray-50">{showSerials ? (details.serials.length > 0 ? details.serials.map((item) => <tr key={item.id}><td className="px-3 py-2 font-mono text-xs font-bold">{item.serialNumber || '—'}</td><td className="px-3 py-2 text-xs">{item.receivedAt ? new Date(item.receivedAt).toLocaleDateString('vi-VN') : '—'}</td><td className="px-3 py-2 text-xs">1</td><td className="px-3 py-2 text-xs">{item.stockStatus}</td><td className="px-3 py-2 text-xs">{item.receiptCode || '—'}</td></tr>) : <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">Chưa có Serial được ghi nhận cho tồn kho này.</td></tr>) : (details.lots.length > 0 ? details.lots.map((item) => <tr key={item.id}><td className="px-3 py-2 text-xs font-bold">{item.lotCode}</td><td className="px-3 py-2 text-xs">{item.receivedAt ? new Date(item.receivedAt).toLocaleDateString('vi-VN') : '—'}</td><td className="px-3 py-2 text-xs">{Number(item.remainingQty).toLocaleString('vi-VN')} {item.unit || details.product.unit || ''}</td><td className="px-3 py-2 text-xs">{item.remainingQty > 0 ? 'Còn hàng' : 'Hết hàng'}</td><td className="px-3 py-2 text-xs">{item.receiptCode || '—'}</td></tr>) : <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">Chưa có dữ liệu chi tiết cho tồn kho này.</td></tr>)}</tbody></table></div>
      </div>
    </div>
  </div>;
}
