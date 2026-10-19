import { getStockLocations, type StockLocation } from '../../../services/locationService';
import { ReceiveTransferButton } from '../ReceiveTransferButton';
import { apiFetch } from '../../../services/api';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { PlusCircle, RefreshCw, AlertCircle, X, CheckCircle2, Truck, PackageCheck, ChevronDown, Eye, Ban, Pencil, FileText, Calendar, Building2, User } from 'lucide-react';
import { Card } from '../../../components/UI';
import { FeedbackDialog } from '../../../components/FeedbackDialog';
import {
  getStockDocuments, getWarehouses, createReceipt, createIssue, createTransfer,
  advanceDocument, advanceTransfer, getPartnerSuggestions, getStockDocument, cancelStockDocument, countLinesMissingSerials,
  type StockDocument, type StockDocLine, type Warehouse,
  type PartnerSuggestion, type PartnerSuggestionsData, type StockDocDetailLine,
} from '../../../services/stockService';
import { getProducts, type Product } from '../../../services/productService';
import { getDeptHomePath, getDeptModulePath } from '../../../components/layout/menus/departmentMenus';
import { useData } from '../../../contexts/DataContext';
import type { DeptKey } from '../../../components/layout/menus/menuTypes';


import { KIND_META, STATUS_LABEL, type Kind } from './meta';

export function DocDetailModal({
  docId,
  warehouses,
  kind,
  onClose,
  onUpdated,
  onEdit,
  deptKey,
  readOnly = false,
}: {
  docId: string;
  warehouses: Warehouse[];
  kind: Kind;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  onEdit?: (id: string) => void;
  deptKey: DeptKey;
  readOnly?: boolean;
}) {
  const [doc, setDoc] = useState<(StockDocument & { lines?: StockDocDetailLine[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string; docId?: string } | null>(null);
  const navigate = useNavigate();
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const whName = (id?: string | null) => warehouses.find((w) => w.id === id)?.name || id || '—';

  const loadDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getStockDocument(docId);
      setDoc(data);
    } catch (err: any) {
      setError(err?.message || 'Không thể tải thông tin chứng từ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [docId]);

  const handleCancelDoc = async () => {
    if (!doc) return;
    if (!window.confirm('Bạn có chắc chắn muốn hủy phiếu nháp này không?')) return;
    setActionLoading(true);
    try {
      await cancelStockDocument(doc.id);
      await onUpdated();
      onClose();
    } catch (err: any) {
      setNotice({ title: 'Không thể hủy phiếu', message: err?.message || 'Hủy phiếu thất bại' });
      setActionLoading(false);
    }
  };

  const handleAdvanceDoc = async () => {
    if (!doc) return;
    if (doc.docType !== 'TRANSFER') {
      const missing = countLinesMissingSerials(doc.lines || []);
      if (missing > 0) {
        setNotice({ title: 'Phiếu chưa đủ thông tin hàng hóa', message: `Còn ${missing} dòng chưa được xử lý Serial hoặc xác nhận không có Serial. Hãy xử lý đủ các dòng trước khi hoàn tất phiếu.`, docId: doc.id });
        return;
      }
    }
    setActionLoading(true);
    try {
      if (doc.docType === 'TRANSFER') {
        await advanceTransfer(doc.id, 'ship');
      } else {
        await advanceDocument(doc.docType === 'RECEIPT' ? 'receipts' : 'issues', doc.id, 'complete');
      }
      await onUpdated();
      onClose();
    } catch (err: any) {
      setNotice({ title: 'Chưa thể hoàn tất phiếu', message: err?.message || 'Thao tác hoàn tất thất bại', docId: doc.id });
      setActionLoading(false);
    }
  };

  const st = doc ? STATUS_LABEL[doc.status] || STATUS_LABEL.DRAFT : STATUS_LABEL.DRAFT;
  const isTransfer = doc?.docType === 'TRANSFER' || kind === 'TRANSFER';
  const meta = KIND_META[kind];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-stretch justify-center p-0 overflow-y-auto">
      <div className="bg-white shadow-2xl w-full h-[100vh] h-[100dvh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50/70">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-lg text-xs font-black tracking-wider uppercase bg-emerald-100 text-emerald-800">
              {meta.code}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-900 text-base">
                  {meta.title} {doc?.code ? `— ${doc.code}` : ''}
                </h3>
                {doc && (
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${st.cls}`}>
                    {st.label}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400">Mã định danh: {docId}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
          {loading ? (
            <div className="py-16 text-center text-gray-400 flex flex-col items-center gap-3">
              <RefreshCw size={24} className="animate-spin text-emerald-600" />
              <span>Đang tải thông tin chi tiết phiếu...</span>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={loadDetail}
                className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700"
              >
                Thử lại
              </button>
            </div>
          ) : doc ? (
            <>
              {/* Header Info Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Block 1: Thông tin kho & thời gian */}
                <div className="bg-gray-50/70 border border-gray-100 rounded-xl p-3.5 space-y-2">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar size={13} className="text-gray-400" />
                    <span>Chứng từ & Kho</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Ngày lập:</span>
                      <span className="font-semibold text-gray-800">
                        {doc.docDate
                          ? new Date(doc.docDate).toLocaleDateString('vi-VN')
                          : doc.createdAt
                          ? new Date(doc.createdAt).toLocaleDateString('vi-VN')
                          : '—'}
                      </span>
                    </div>
                    {(doc.accountingDate || doc.postingDate) && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Ngày hạch toán:</span>
                        <span className="font-semibold text-gray-800">
                          {new Date((doc.accountingDate || doc.postingDate)!).toLocaleDateString('vi-VN')}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500">Kho hàng:</span>
                      <span className="font-semibold text-gray-800 text-right truncate max-w-[150px]">
                        {isTransfer
                          ? `${whName(doc.sourceWarehouseId)} → ${whName(doc.destWarehouseId)}`
                          : whName(doc.warehouseId)}
                      </span>
                    </div>
                    {doc.createdBy && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Người lập:</span>
                        <span className="font-semibold text-gray-800">{doc.createdBy}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Block 2: Đối tác & Giao nhận */}
                {!isTransfer ? (
                  <div className="bg-gray-50/70 border border-gray-100 rounded-xl p-3.5 space-y-2">
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Building2 size={13} className="text-gray-400" />
                      <span>Đối tác & Người giao nhận</span>
                    </div>
                    <div className="space-y-1.5 text-xs">
                      <div>
                        <span className="text-gray-500">Đối tác: </span>
                        <span className="font-semibold text-gray-800">
                          {doc.partnerName || doc.partnerCode || '—'}
                        </span>
                        {doc.partnerCode && doc.partnerName && (
                          <span className="text-gray-400 ml-1">({doc.partnerCode})</span>
                        )}
                      </div>
                      {doc.partnerAddress && (
                        <div className="text-gray-600 truncate" title={doc.partnerAddress}>
                          <span className="text-gray-500">Đ/c: </span>
                          {doc.partnerAddress}
                        </div>
                      )}
                      {doc.deliverer && (
                        <div>
                          <span className="text-gray-500">Người giao/nhận: </span>
                          <span className="font-semibold text-gray-800">{doc.deliverer}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50/70 border border-gray-100 rounded-xl p-3.5 space-y-2">
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Truck size={13} className="text-gray-400" />
                      <span>Thông tin vận chuyển</span>
                    </div>
                    <div className="space-y-1.5 text-xs">
                      <div>
                        <span className="text-gray-500">Kho xuất: </span>
                        <span className="font-semibold text-gray-800">{whName(doc.sourceWarehouseId)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Kho nhập: </span>
                        <span className="font-semibold text-gray-800">{whName(doc.destWarehouseId)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Block 3: Hóa đơn & Ghi chú */}
                <div className="bg-gray-50/70 border border-gray-100 rounded-xl p-3.5 space-y-2">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText size={13} className="text-gray-400" />
                    <span>Hóa đơn / Diễn giải</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {doc.invoiceNumber && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Số hóa đơn:</span>
                        <span className="font-semibold text-gray-800">{doc.invoiceNumber}</span>
                      </div>
                    )}
                    {doc.invoiceDate && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Ngày HĐ:</span>
                        <span className="font-semibold text-gray-800">
                          {new Date(doc.invoiceDate).toLocaleDateString('vi-VN')}
                        </span>
                      </div>
                    )}
                    {doc.invoiceLookupCode && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Mã tra cứu:</span>
                        <span className="font-mono text-gray-700">{doc.invoiceLookupCode}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-500">Diễn giải: </span>
                      <span className="text-gray-800 italic">{doc.notes || '—'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-gray-50/80 px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
                  <span className="font-bold text-xs uppercase tracking-wider text-gray-600">
                    Danh sách hàng hóa ({doc.lines?.length || 0})
                  </span>
                </div>
                <div className="overflow-x-auto max-h-[380px]">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-gray-100/70 border-b border-gray-200 text-gray-600 uppercase font-semibold">
                      <tr>
                        <th className="py-2 px-3 text-center w-10">#</th>
                        <th className="py-2 px-3 text-left">Mã hàng</th>
                        <th className="py-2 px-3 text-left">Tên hàng / Mặt hàng</th>
                        <th className="py-2 px-3 text-center w-16">ĐVT</th>
                        <th className="py-2 px-3 text-right w-20">SL</th>
                        {!isTransfer && (
                          <>
                            <th className="py-2 px-3 text-right">Đơn giá</th>
                            <th className="py-2 px-3 text-right">Tiền hàng</th>
                            <th className="py-2 px-3 text-center w-16">Thuế (%)</th>
                            <th className="py-2 px-3 text-right">Tiền thuế</th>
                            <th className="py-2 px-3 text-right">Tổng tiền</th>
                          </>
                        )}
                        <th className="py-2 px-3 text-left">Ghi chú / Số lô</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {doc.lines && doc.lines.length > 0 ? (
                        doc.lines.map((ln: StockDocDetailLine, idx: number) => {
                          const qty = Number(ln.quantity || 0);
                          const up = Number(ln.unitPrice || 0);
                          const linePre = Number(ln.preVatAmount ?? qty * up);
                          const vatR = Number(ln.vatRate || 0);
                          const lineVat = Number(ln.vatAmount ?? Math.round((linePre * vatR) / 100));
                          const lineTot = Number(ln.totalAmount ?? linePre + lineVat);

                          return (
                            <tr key={ln.id || idx} className="hover:bg-gray-50/60">
                              <td className="py-2.5 px-3 text-center text-gray-400 font-mono">{idx + 1}</td>
                              <td className="py-2.5 px-3 font-mono font-bold text-gray-800">
                                {ln.productSku || ln.productCode || ln.productId?.slice(0, 8) || '—'}
                              </td>
                              <td className="py-2.5 px-3 font-medium text-gray-800">
                                {ln.productName || '—'}
                              </td>
                              <td className="py-2.5 px-3 text-center text-gray-600">{ln.uom || ln.unit || '—'}</td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-gray-900">
                                {qty.toLocaleString('vi-VN')}
                              </td>
                              {!isTransfer && (
                                <>
                                  <td className="py-2.5 px-3 text-right font-mono text-gray-700">
                                    {up.toLocaleString('vi-VN')}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-gray-800">
                                    {linePre.toLocaleString('vi-VN')}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono text-gray-600">
                                    {vatR}%
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-gray-700">
                                    {lineVat.toLocaleString('vi-VN')}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                                    {lineTot.toLocaleString('vi-VN')}
                                  </td>
                                </>
                              )}
                              <td className="py-2.5 px-3 text-gray-500">
                                {ln.serialLot || ln.notes || ln.note || '—'}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={isTransfer ? 6 : 11} className="py-6 text-center text-gray-400">
                            Phiếu này chưa có mặt hàng nào.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Total Summary for Receipt/Issue */}
              {!isTransfer && (
                <div className="flex justify-end">
                  <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl px-5 py-3 w-80 text-xs space-y-1.5 shadow-sm">
                    <div className="flex justify-between text-gray-600">
                      <span>Tiền hàng:</span>
                      <span className="font-mono font-bold">
                        {Number(doc.totalPreTax ?? doc.totalPreVat ?? 0).toLocaleString('vi-VN')} ₫
                      </span>
                    </div>
                    <div className="flex justify-between text-gray-600">
                      <span>Thuế GTGT:</span>
                      <span className="font-mono font-bold">
                        {Number(doc.vatAmount ?? doc.totalVat ?? 0).toLocaleString('vi-VN')} ₫
                      </span>
                    </div>
                    <div className="flex justify-between text-gray-900 font-extrabold text-sm border-t border-emerald-200 pt-1.5">
                      <span>Tổng thanh toán:</span>
                      <span className="font-mono text-emerald-800">
                        {Number(doc.totalAmount || 0).toLocaleString('vi-VN')} ₫
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50/70">
          <div>
            {!readOnly && doc?.status === 'DRAFT' && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleCancelDoc}
                className="flex items-center gap-1.5 px-4 py-2 border border-red-300 text-red-600 hover:bg-red-50 rounded-xl text-xs font-bold disabled:opacity-50 transition-colors"
              >
                <Ban size={14} />
                Hủy phiếu nháp
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200 rounded-xl transition-colors"
            >
              Đóng
            </button>
            {!readOnly && doc?.status === 'DRAFT' && onEdit && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => onEdit(doc.id)}
                className="flex items-center gap-1.5 px-5 py-2 border border-blue-300 text-blue-700 hover:bg-blue-50 rounded-xl text-xs font-bold disabled:opacity-50 transition-colors"
              >
                <Pencil size={14} />
                Sửa
              </button>
            )}
            {!readOnly && doc?.status === 'DRAFT' && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleAdvanceDoc}
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-colors shadow-sm"
              >
                {actionLoading ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                {meta.actionDone}
              </button>
            )}
          </div>
        </div>
      </div>
      {notice && (
        <FeedbackDialog
          title={notice.title}
          message={notice.message}
          tone="error"
          actionLabel={notice.docId ? 'Mở trang xử lý phiếu' : undefined}
          onAction={notice.docId ? () => { const id = notice.docId!; setNotice(null); onClose(); navigate(getDeptModulePath(deptKey, 'wh_processing', { documentId: id })); } : undefined}
          onClose={() => setNotice(null)}
        />
      )}
    </div>
  );
}

