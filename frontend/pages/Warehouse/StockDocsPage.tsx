import { getStockLocations, type StockLocation } from '../../services/locationService';
import { ReceiveTransferButton } from './ReceiveTransferButton';
import { apiFetch } from '../../services/api';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { PlusCircle, RefreshCw, AlertCircle, X, CheckCircle2, Truck, PackageCheck, ChevronDown, Eye, Ban, Pencil, Copy, Trash2, Camera, FileText, Calendar, Building2, User } from 'lucide-react';
import { Card } from '../../components/UI';
import {
  getStockDocuments, getWarehouses, createReceipt, createIssue, createTransfer,
  advanceDocument, advanceTransfer, getPartnerSuggestions, getStockDocument, cancelStockDocument, deleteStockDocument, countLinesMissingSerials,
  type StockDocument, type StockDocLine, type Warehouse,
  type PartnerSuggestion, type PartnerSuggestionsData, type StockDocDetailLine,
} from '../../services/stockService';
import { getProducts, type Product } from '../../services/productService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import { useData } from '../../contexts/DataContext';
import type { DeptKey } from '../../components/layout/menus/menuTypes';


import { KIND_META, STATUS_LABEL, type Kind } from './StockDocs/meta';
import { DocDetailModal } from './StockDocs/DocDetailModal';
import { DocCreateModal } from './StockDocs/DocCreateModal';
import { SerialBulkModal } from './StockDocs/SerialBulkModal';

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
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { users } = useData();

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

  const completeWithCheck = async (d: StockDocument, fn: () => Promise<unknown>, failMsg: string) => {
    // NV tự quyết từng dòng: chỉ cảnh báo khi thiếu serial, không chặn cứng.
    // (Luồng chính đã bắt quét đủ serial trước nút Hoàn tất; đây là lưới an toàn.)
    if (d.docType !== 'TRANSFER') {
      try {
        const detail = await getStockDocument(d.id);
        const missing = countLinesMissingSerials(detail.lines || []);
        if (missing > 0 && !window.confirm(`Có ${missing} dòng chưa nhập serial/bảo hành. Vẫn hoàn thành phiếu?`)) return;
      } catch { /* không tải được chi tiết thì vẫn cho hoàn thành */ }
    }
    await act(d.id, fn, failMsg);
  };

  const [serialBulkId, setSerialBulkId] = useState<string | null>(null);

  // Menu chuột phải: mặc định click = xem, chuột phải chọn Nhân bản / Sửa / Xóa.
  const [menu, setMenu] = useState<{ x: number; y: number; docId: string } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('click', close);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent, docId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const w = 200;
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - w - 12),
      y: Math.min(e.clientY, window.innerHeight - 180),
      docId,
    });
  };

  const cloneDoc = async (d: StockDocument) => {
    setMenu(null);
    setActingId(d.id); setError(null);
    try {
      const detail = await getStockDocument(d.id);
      const cleanLines = (detail.lines || []).map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        unitPrice: Number((l as any).unitPrice) || 0,
        locationId: (l as any).locationId ?? null,
        note: (l as any).note ?? null,
        vatRate: Number((l as any).vatRate ?? 8),
        vatAmount: (l as any).vatAmount ?? undefined,
        totalAmount: (l as any).totalAmount ?? undefined,
        serialLot: (l as any).serialLot ?? undefined,
        accountDebit: (l as any).accountDebit || undefined,
        accountCredit: (l as any).accountCredit || undefined,
        projectId: (l as any).projectId || undefined,
        costItem: (l as any).costItem || undefined,
        costObjectId: (l as any).costObjectId || undefined,
      }));
      const notes = `Nhân bản từ ${detail.code || detail.id.slice(0, 8)}${detail.notes ? ` — ${detail.notes}` : ''}`;
      let created: { id: string };
      if (detail.docType === 'TRANSFER') {
        created = await createTransfer({ sourceWarehouseId: detail.sourceWarehouseId!, destWarehouseId: detail.destWarehouseId!, lines: cleanLines, notes });
      } else {
        const header = {
          partnerCode: detail.partnerCode || undefined,
          partnerName: detail.partnerName || undefined,
          partnerAddress: detail.partnerAddress || undefined,
          deliverer: detail.deliverer || undefined,
          purchaserId: detail.purchaserId || undefined,
          postingDate: (detail.postingDate || '').slice(0, 10) || undefined,
          docDate: (detail.docDate || '').slice(0, 10) || undefined,
          invoiceNumber: detail.invoiceNumber || undefined,
          invoiceDate: (detail.invoiceDate || '').slice(0, 10) || undefined,
          paymentStatus: detail.paymentStatus || undefined,
          paymentDueDate: (detail.paymentDueDate || '').slice(0, 10) || undefined,
          shippingFee: detail.shippingFee !== undefined && detail.shippingFee !== null ? Number(detail.shippingFee) : undefined,
        };
        created = detail.docType === 'RECEIPT'
          ? await createReceipt({ warehouseId: detail.warehouseId!, lines: cleanLines, notes, ...header })
          : await createIssue({ warehouseId: detail.warehouseId!, lines: cleanLines, notes, ...header });
      }
      await fetchAll();
      // Mở form sửa của phiếu mới để duyệt lại như khi tạo mới, thay vì màn chi tiết.
      setEditingId(created.id);
    } catch (e: any) {
      setError(e.message || 'Nhân bản phiếu thất bại');
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
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
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Mã phiếu</th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-gray-500 uppercase">{kind === 'TRANSFER' ? 'Tuyến điều chuyển' : 'Kho'}</th>
                  {kind !== 'TRANSFER' && (
                    <th className="text-left py-2 px-3 text-xs font-bold text-gray-500 uppercase">Đối tác / NCC</th>
                  )}
                  {kind !== 'TRANSFER' && (
                    <th className="text-right py-2 px-3 text-xs font-bold text-gray-500 uppercase">Tổng tiền</th>
                  )}
                  <th className="text-center py-2 px-3 text-xs font-bold text-gray-500 uppercase">Trạng thái</th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-gray-500 uppercase">Ngày tạo</th>
                  <th className="text-center py-2 px-3 text-xs font-bold text-gray-500 uppercase">Duyệt phiếu</th>
                  <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {docs.map((d) => {
                  const st = STATUS_LABEL[d.status] || STATUS_LABEL.DRAFT;
                  const route = d.docType === 'TRANSFER' ? `${whName(d.sourceWarehouseId)} → ${whName(d.destWarehouseId)}` : whName(d.warehouseId);
                  return (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedDocId(d.id)}
                      onContextMenu={(e) => openMenu(e, d.id)}
                      className="hover:bg-emerald-50/40 transition-colors cursor-pointer group"
                    >
                      <td className="py-2.5 px-4 font-bold text-gray-800 font-mono text-[13px] group-hover:text-emerald-700">
                        {d.code || d.id.slice(0, 8)}
                      </td>
                      <td className="py-2.5 px-3 text-gray-600 text-xs">{route}</td>
                      {kind !== 'TRANSFER' && (
                        <td className="py-2.5 px-3 text-gray-700 text-xs">
                          {d.partnerName ? (
                            <div className="font-medium text-gray-800 truncate max-w-[220px]" title={d.partnerName}>
                              {d.partnerName}
                            </div>
                          ) : d.partnerCode ? (
                            <span className="text-gray-500">{d.partnerCode}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      )}
                      {kind !== 'TRANSFER' && (
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-xs text-gray-800">
                          {d.totalAmount !== undefined && d.totalAmount !== null
                            ? Number(d.totalAmount).toLocaleString('vi-VN') + ' ₫'
                            : '—'}
                        </td>
                      )}
                      <td className="py-2.5 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="py-2.5 px-3 text-gray-400 text-xs">
                        {d.createdAt ? new Date(d.createdAt).toLocaleString('vi-VN') : '—'}
                      </td>
                      <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          {d.status === 'DRAFT' && kind !== 'TRANSFER' && (Number(d.missingSerials) || 0) > 0 && (
                            <button disabled={actingId === d.id} onClick={() => setSerialBulkId(d.id)}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold disabled:opacity-60 transition-colors shadow-sm whitespace-nowrap">
                              <Camera size={12} />Quét serial ({Number(d.missingSerials)})
                            </button>
                          )}
                          {d.status === 'DRAFT' && kind !== 'TRANSFER' && !((Number(d.missingSerials) || 0) > 0) && (
                            <button disabled={actingId === d.id} onClick={() => completeWithCheck(d, () => advanceDocument(kind === 'RECEIPT' ? 'receipts' : 'issues', d.id, 'complete'), 'Hoàn tất thất bại')}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-60 transition-colors shadow-sm whitespace-nowrap">
                              {actingId === d.id ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}{meta.actionDone}
                            </button>
                          )}
                          {d.status === 'DRAFT' && kind === 'TRANSFER' && (
                            <button disabled={actingId === d.id} onClick={() => act(d.id, () => advanceTransfer(d.id, 'ship'), 'Gửi hàng thất bại')}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold disabled:opacity-60 transition-colors shadow-sm whitespace-nowrap">
                              {actingId === d.id ? <RefreshCw size={12} className="animate-spin" /> : <Truck size={12} />}Xác nhận gửi
                            </button>
                          )}
                          {d.status === 'IN_TRANSIT' && kind === 'TRANSFER' && (
                            <ReceiveTransferButton id={d.id} warehouseId={d.destWarehouseId!} onDone={fetchAll} />
                          )}
                          {d.status !== 'DRAFT' && !(d.status === 'IN_TRANSIT' && kind === 'TRANSFER') && (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedDocId(d.id)}
                            className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="Xem chi tiết"
                          >
                            <Eye size={15} />
                          </button>
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

      {selectedDocId && (
        <DocDetailModal
          docId={selectedDocId}
          warehouses={warehouses}
          kind={kind}
          onClose={() => setSelectedDocId(null)}
          onUpdated={fetchAll}
          onEdit={(id) => { setSelectedDocId(null); setEditingId(id); }}
        />
      )}

      {showCreate && (
        <DocCreateModal
          kind={kind} warehouses={warehouses} products={products} users={users.map((u: any) => ({ id: u.id, name: u.name }))}
          onClose={() => setShowCreate(false)}
          onDone={async () => { setShowCreate(false); await fetchAll(); }}
          onError={setError}
        />
      )}

      {serialBulkId && (
        <SerialBulkModal
          key={serialBulkId}
          docId={serialBulkId}
          kind={kind === 'TRANSFER' ? 'RECEIPT' : kind}
          onClose={() => setSerialBulkId(null)}
          onCompleted={async () => { setSerialBulkId(null); await fetchAll(); }}
        />
      )}

      {editingId && (
        <DocCreateModal
          key={editingId}
          kind={kind} warehouses={warehouses} products={products} users={users.map((u: any) => ({ id: u.id, name: u.name }))}
          editingId={editingId}
          onClose={() => setEditingId(null)}
          onDone={async () => { setEditingId(null); await fetchAll(); }}
          onError={setError}
        />
      )}

      {menu && (() => {
        const target = docs.find((x) => x.id === menu.docId);
        if (!target) return null;
        const canModify = target.status === 'DRAFT' || target.status === 'CANCELLED';
        const itemCls = 'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors text-left disabled:opacity-40';
        return (
          <div
            className="fixed z-[80] w-[200px] bg-white border border-gray-200 rounded-xl shadow-2xl py-1.5 animate-in fade-in zoom-in-95 duration-100"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <p className="px-3.5 py-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-wider truncate border-b border-gray-100 mb-1">
              {target.code || target.id.slice(0, 8)}
            </p>
            <button
              type="button"
              disabled={actingId === target.id}
              onClick={() => { setMenu(null); setSelectedDocId(target.id); }}
              className={`${itemCls} text-gray-700 hover:bg-gray-50`}
            >
              <Eye size={15} className="text-gray-400" /> Xem chi tiết
            </button>
            <button
              type="button"
              disabled={actingId === target.id}
              onClick={() => cloneDoc(target)}
              className={`${itemCls} text-gray-700 hover:bg-gray-50`}
            >
              <Copy size={15} className="text-gray-400" /> Nhân bản
            </button>
            {target.status === 'DRAFT' && (
              <button
                type="button"
                disabled={actingId === target.id}
                onClick={() => { setMenu(null); setEditingId(target.id); }}
                className={`${itemCls} text-blue-700 hover:bg-blue-50`}
              >
                <Pencil size={15} className="text-blue-400" /> Sửa
              </button>
            )}
            {canModify && (
              <button
                type="button"
                disabled={actingId === target.id}
                onClick={() => {
                  setMenu(null);
                  if (window.confirm(`Xóa hẳn phiếu ${target.code || target.id.slice(0, 8)}? Hành động này không thể hoàn tác.`)) {
                    act(target.id, () => deleteStockDocument(target.id), 'Xóa phiếu thất bại');
                  }
                }}
                className={`${itemCls} text-red-600 hover:bg-red-50`}
              >
                <Trash2 size={15} className="text-red-400" /> Xóa
              </button>
            )}
          </div>
        );
      })()}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}

