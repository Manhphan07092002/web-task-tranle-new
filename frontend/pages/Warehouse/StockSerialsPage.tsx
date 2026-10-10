import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScanLine, Search, Plus, Pencil, Trash2, X, Package, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useReactToPrint } from 'react-to-print';
import { Card } from '../../components/UI';
import { useAuth } from '../../contexts/AuthContext';
import {
  createLot, deleteLot, getLots, getSerialDetail, getStockProducts, searchSerials, updateLot, updateSerialStatus,
  type InventoryLot, type SerialItem, type StockProduct,
} from '../../services/stockMasterService';

const SERIAL_STATUS_META: Record<string, { label: string; badge: string }> = {
  IN_STOCK: { label: 'Trong kho', badge: 'bg-emerald-100 text-emerald-700' },
  RESERVED: { label: 'Đã giữ', badge: 'bg-blue-100 text-blue-700' },
  ISSUED: { label: 'Đã xuất', badge: 'bg-slate-100 text-slate-500' },
  WARRANTY: { label: 'Bảo hành', badge: 'bg-purple-100 text-purple-700' },
  DAMAGED: { label: 'Hàng lỗi', badge: 'bg-rose-100 text-rose-700' },
  LOST: { label: 'Mất', badge: 'bg-rose-100 text-rose-700' },
};

const filterCls = 'px-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-sm text-gray-800 dark:text-slate-100';

export default function StockSerialsPage() {
  const { user } = useAuth();
  const level = user?.managementLevel ?? 10;
  const isManager = level !== 99 && level >= 20;
  const [tab, setTab] = useState<'serials' | 'lots'>('serials');
  const [error, setError] = useState<string | null>(null);

  // ---- serials ----
  const [searchParams] = useSearchParams();
  const [serials, setSerials] = useState<SerialItem[]>([]);
  const [serialsLoading, setSerialsLoading] = useState(false);
  const [serialSearch, setSerialSearch] = useState(searchParams.get('search') || '');
  const [serialStatus, setSerialStatus] = useState('');
  const [selected, setSelected] = useState<SerialItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusForm, setStatusForm] = useState({ status: 'IN_STOCK', notes: '', customerRef: '' });
  const labelRef = useRef<HTMLDivElement>(null);
  const handlePrintLabel = useReactToPrint({
    contentRef: labelRef,
    documentTitle: `Nhan_${selected?.serialNo || 'serial'}`,
  });

  const loadSerials = useCallback(async () => {
    try {
      setSerialsLoading(true);
      setError(null);
      setSerials(await searchSerials({
        search: serialSearch.trim() || undefined,
        status: serialStatus || undefined,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được serial.');
    } finally {
      setSerialsLoading(false);
    }
  }, [serialSearch, serialStatus]);

  useEffect(() => { if (tab === 'serials') loadSerials(); }, [tab, loadSerials]);

  const openSerial = async (serialNo: string) => {
    try {
      setDetailLoading(true);
      setError(null);
      const detail = await getSerialDetail(serialNo);
      setSelected(detail);
      setStatusForm({ status: detail.status, notes: '', customerRef: detail.customerRef || '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được chi tiết serial.');
    } finally {
      setDetailLoading(false);
    }
  };

  const saveSerialStatus = async () => {
    if (!selected) return;
    try {
      setError(null);
      await updateSerialStatus(selected.serialNo, {
        status: statusForm.status,
        notes: statusForm.notes.trim() || undefined,
        customerRef: statusForm.customerRef.trim() || undefined,
      });
      await openSerial(selected.serialNo);
      await loadSerials();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Đổi trạng thái thất bại');
    }
  };

  // ---- lots ----
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [lotSearch, setLotSearch] = useState('');
  const [showLotForm, setShowLotForm] = useState(false);
  const [editingLot, setEditingLot] = useState<InventoryLot | null>(null);
  const [lotForm, setLotForm] = useState({ productCode: '', productName: '', productId: '', lotCode: '', expiryDate: '', supplierName: '', quantity: '1', unit: 'pcs' });
  const [catalog, setCatalog] = useState<StockProduct[]>([]);

  const loadLots = useCallback(async () => {
    try {
      setLotsLoading(true);
      setError(null);
      const [list, prods] = await Promise.all([
        getLots({ search: lotSearch.trim() || undefined }),
        getStockProducts().catch(() => [] as StockProduct[]),
      ]);
      setLots(list);
      setCatalog(prods);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được lô hàng.');
    } finally {
      setLotsLoading(false);
    }
  }, [lotSearch]);

  useEffect(() => { if (tab === 'lots') loadLots(); }, [tab, loadLots]);

  const submitLot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      if (editingLot) {
        await updateLot(editingLot.id, {
          expiryDate: lotForm.expiryDate || null,
          supplierName: undefined,
        });
      } else {
        const code = lotForm.productCode.trim();
        const match = catalog.find((p) => p.code.toLowerCase() === code.toLowerCase());
        if (!match) {
          setError(`Không tìm thấy hàng hóa có mã '${code}' trong danh mục.`);
          return;
        }
        await createLot({
          productId: match.id,
          productCode: match.code,
          productName: match.name,
          lotCode: lotForm.lotCode.trim(),
          expiryDate: lotForm.expiryDate || undefined,
        });
      }
      setShowLotForm(false);
      setEditingLot(null);
      await loadLots();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu lô thất bại');
    }
  };

  const removeLot = async (lot: InventoryLot) => {
    if (!window.confirm(`Xóa lô '${lot.lotCode}'?`)) return;
    try {
      setError(null);
      await deleteLot(lot.id);
      await loadLots();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xóa lô thất bại');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
          <ScanLine className="text-emerald-500" /> Serial / Lô
        </h1>
        <p className="text-gray-500 dark:text-slate-400 mt-1">
          Tra cứu serial, số lô, hạn dùng, bảo hành và lịch sử di chuyển
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {([
          { value: 'serials', label: 'Serial' },
          { value: 'lots', label: 'Lô hàng' },
        ] as const).map((t) => (
          <button
            key={t.value}
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

      {tab === 'serials' && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <Card className="overflow-hidden p-0 xl:col-span-3">
            <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={serialSearch} onChange={(e) => setSerialSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadSerials()}
                  placeholder="Nhập serial / lot / model / SKU..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 text-sm focus:ring-2 focus:ring-emerald-500 text-gray-800 dark:text-slate-100"
                />
              </div>
              <select value={serialStatus} onChange={(e) => setSerialStatus(e.target.value)} className={filterCls} aria-label="Lọc trạng thái">
                <option value="">Mọi trạng thái</option>
                {Object.entries(SERIAL_STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
              </select>
              <button onClick={loadSerials} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold">Tìm</button>
            </div>
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full text-left border-collapse min-w-[560px]">
                <thead className="sticky top-0 bg-gray-50 dark:bg-slate-700/80">
                  <tr className="border-b border-gray-100 dark:border-slate-700">
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Serial</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hàng hóa</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Kho / Lô</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {serialsLoading ? (
                    <tr><td colSpan={4} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
                  ) : serials.length === 0 ? (
                    <tr><td colSpan={4} className="p-8 text-center text-gray-400">Không tìm thấy serial nào.</td></tr>
                  ) : (
                    serials.map((s) => (
                      <tr
                        key={s.id}
                        className={`hover:bg-gray-50 dark:hover:bg-slate-700/30 cursor-pointer ${selected?.serialNo === s.serialNo ? 'bg-emerald-50/60 dark:bg-emerald-900/10' : ''}`}
                        onClick={() => openSerial(s.serialNo)}
                      >
                        <td className="p-3 text-sm font-bold font-mono">{s.serialNo}</td>
                        <td className="p-3 text-sm">
                          {s.productName}
                          <span className="block text-xs text-gray-400">{s.productCode}</span>
                        </td>
                        <td className="p-3 text-sm text-gray-500">
                          {s.warehouseCode || '-'}{s.lotCode ? ` • Lô ${s.lotCode}` : ''}
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded font-bold text-xs ${SERIAL_STATUS_META[s.status]?.badge || ''}`}>
                            {SERIAL_STATUS_META[s.status]?.label || s.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-4 xl:col-span-2 h-fit">
            {!selected && !detailLoading ? (
              <p className="text-sm text-gray-400 text-center py-10">Chọn một serial để xem chi tiết, bảo hành và lịch sử.</p>
            ) : detailLoading && !selected ? (
              <p className="text-sm text-gray-400 text-center py-10">Đang tải...</p>
            ) : selected ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold font-mono text-gray-800 dark:text-slate-100">{selected.serialNo}</h2>
                    <p className="text-sm text-gray-500">{selected.productName} ({selected.productCode})</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={handlePrintLabel} className="p-1.5 text-gray-500 hover:text-emerald-600 rounded-full hover:bg-gray-100" title="In nhãn">
                      <Printer size={16} />
                    </button>
                    <button onClick={() => setSelected(null)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100" title="Đóng">
                      <X size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-xl border border-gray-100 dark:border-slate-700 p-3">
                  <QRCodeSVG value={selected.serialNo} size={84} />
                  <div className="text-xs text-gray-500">
                    <p className="font-bold text-gray-700 dark:text-slate-200">Mã QR tra cứu</p>
                    <p>Quét bằng trang Quét mã để mở nhanh serial này.</p>
                  </div>
                </div>

                <div ref={labelRef} className="hidden print:block">
                  <div style={{ padding: 16, fontFamily: 'sans-serif', color: '#000' }}>
                    <h2 style={{ fontSize: 20, margin: 0 }}>{selected.productName}</h2>
                    <p style={{ fontSize: 14, margin: '4px 0' }}>{selected.productCode} • Serial: <b>{selected.serialNo}</b></p>
                    <p style={{ fontSize: 12, margin: '4px 0' }}>
                      Kho: {selected.warehouseCode || '-'} • Vị trí: {selected.locationCode || '-'}
                      {selected.lotCode ? ` • Lô: ${selected.lotCode}` : ''}
                    </p>
                    {selected.warrantyEnd ? <p style={{ fontSize: 12, margin: '4px 0' }}>Bảo hành đến: {selected.warrantyEnd}</p> : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ['Trạng thái', SERIAL_STATUS_META[selected.status]?.label || selected.status],
                    ['Kho hiện tại', selected.warehouseCode || '-'],
                    ['Vị trí', selected.locationCode || '-'],
                    ['Số lô', selected.lotCode || '-'],
                    ['HSD lô', selected.lotExpiry || '-'],
                    ['Bảo hành', selected.warrantyStart && selected.warrantyEnd ? `${selected.warrantyStart} → ${selected.warrantyEnd}` : '-'],
                    ['Phiếu nhập', selected.receiptCode || '-'],
                    ['Phiếu xuất', selected.issueCode || '-'],
                    ['Khách hàng', selected.customerRef || '-'],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-gray-100 dark:border-slate-700 p-2.5">
                      <p className="text-[11px] font-bold text-gray-400 uppercase">{k}</p>
                      <p className="font-bold text-gray-800 dark:text-slate-100 truncate" title={String(v)}>{v}</p>
                    </div>
                  ))}
                </div>

                {isManager && (
                  <div className="rounded-xl border border-gray-100 dark:border-slate-700 p-3 space-y-2">
                    <p className="text-xs font-bold text-gray-500 uppercase">Đổi trạng thái (TP)</p>                    <select value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })} className={`${filterCls} w-full`}>
                      {Object.entries(SERIAL_STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                    </select>
                    <input
                      value={statusForm.customerRef} onChange={(e) => setStatusForm({ ...statusForm, customerRef: e.target.value })}
                      placeholder="Khách hàng / dự án (nếu có)" className={`${filterCls} w-full`} />
                    <input
                      value={statusForm.notes} onChange={(e) => setStatusForm({ ...statusForm, notes: e.target.value })}
                      placeholder="Ghi chú (bắt buộc với hàng lỗi/mất/bảo hành)" className={`${filterCls} w-full`} />
                    <button onClick={saveSerialStatus} className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm">
                      Lưu trạng thái
                    </button>
                  </div>
                )}

                <div>
                  <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Lịch sử di chuyển</h3>
                  {selected.timeline.length === 0 ? (
                    <p className="text-sm text-gray-400">Chưa có biến động ghi theo serial.</p>
                  ) : (
                    <ol className="relative border-l-2 border-gray-100 dark:border-slate-700 ml-2 space-y-3">
                      {selected.timeline.map((m) => (
                        <li key={m.id} className="ml-4 relative">
                          <span className={`absolute -left-[25px] top-1 w-3 h-3 rounded-full border-2 border-white ${m.qty >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                          <p className="text-sm font-bold text-gray-800 dark:text-slate-100">
                            {m.moveType}
                            <span className="ml-1 font-semibold text-gray-500">• {m.docCode || ''}</span>
                          </p>
                          <p className="text-xs text-gray-400">
                            {m.warehouseCode || ''} • {new Date(m.createdAt).toLocaleString('vi-VN')}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      )}

      {tab === 'lots' && (
        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={lotSearch} onChange={(e) => setLotSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadLots()}
                  placeholder="Tìm số lô / hàng hóa"
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/50 text-sm focus:ring-2 focus:ring-emerald-500 text-gray-800 dark:text-slate-100"
                />
              </div>
              <button onClick={loadLots} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold">Lọc</button>
              <button
                onClick={() => {
                  setEditingLot(null);
                  setLotForm({ productCode: '', productName: '', productId: '', lotCode: '', expiryDate: '', supplierName: '', quantity: '1', unit: 'pcs' });
                  setShowLotForm(true);
                }}
                className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold text-gray-600 dark:text-slate-300 hover:bg-gray-50 inline-flex items-center gap-1"
              >
                <Plus size={14} /> Thêm lô
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[760px]">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700">
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Số lô</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hàng hóa</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase">Hạn dùng</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Serials</th>
                    <th className="p-3 text-xs font-bold text-gray-500 uppercase text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {lotsLoading ? (
                    <tr><td colSpan={5} className="p-8 text-center text-gray-400">Đang tải...</td></tr>
                  ) : lots.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-gray-400">Chưa có lô nào.</td></tr>
                  ) : (
                    lots.map((lot) => (
                      <tr key={lot.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                        <td className="p-3 text-sm font-bold font-mono">{lot.lotCode}</td>
                        <td className="p-3 text-sm">
                          {lot.productName}
                          <span className="block text-xs text-gray-400">{lot.productCode}</span>
                        </td>
                        <td className="p-3 text-sm">{lot.expiryDate || '-'}</td>
                        <td className="p-3 text-sm text-center font-bold">{lot.serialCount}</td>
                        <td className="p-3 text-center">
                          <span className="inline-flex gap-1">
                            <button
                              onClick={() => {
                                setEditingLot(lot);
                                setLotForm({
                                  productCode: lot.productCode, productName: lot.productName, productId: '',
                                  lotCode: lot.lotCode, expiryDate: lot.expiryDate || '',
                                  supplierName: '', quantity: '1', unit: 'pcs',
                                });
                                setShowLotForm(true);
                              }}
                              title="Sửa HSD" className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg"><Pencil size={15} /></button>
                            {isManager && (
                              <button onClick={() => removeLot(lot)} title="Xóa lô" className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 size={15} /></button>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {showLotForm && (
            <Card className="p-4">
              <h2 className="font-bold text-gray-800 dark:text-slate-100 mb-3">{editingLot ? 'Sửa lô hàng' : 'Thêm lô hàng'}</h2>
              <form onSubmit={submitLot} className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {!editingLot && (
                  <>
                    <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                      Mã hàng hóa *
                      <input value={lotForm.productCode} onChange={(e) => setLotForm({ ...lotForm, productCode: e.target.value })}
                        placeholder="Nhập đúng mã SKU" className={filterCls} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                      Tên hàng hóa *
                      <input value={lotForm.productName} onChange={(e) => setLotForm({ ...lotForm, productName: e.target.value })} className={filterCls} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                      Số lô *
                      <input value={lotForm.lotCode} onChange={(e) => setLotForm({ ...lotForm, lotCode: e.target.value })} className={filterCls} />
                    </label>
                  </>
                )}
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-600 dark:text-slate-300">
                  Hạn sử dụng
                  <input type="date" value={lotForm.expiryDate} onChange={(e) => setLotForm({ ...lotForm, expiryDate: e.target.value })} className={filterCls} />
                </label>
                <div className="md:col-span-3 flex justify-end gap-2">
                  <button type="button" onClick={() => { setShowLotForm(false); setEditingLot(null); }}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm">Hủy</button>
                  <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm">
                    {editingLot ? 'Lưu' : 'Thêm lô'}
                  </button>
                </div>
              </form>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
