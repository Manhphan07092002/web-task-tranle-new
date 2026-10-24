import { getStockLocations, type StockLocation } from '../../services/locationService';
import { ReceiveTransferButton } from './ReceiveTransferButton';
import { apiFetch } from '../../services/api';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PlusCircle, RefreshCw, AlertCircle, X, CheckCircle2, Truck, PackageCheck, ChevronDown, Eye, Ban, Pencil, Copy, Trash2, ListChecks, FileText, Calendar, Building2, User, Printer, Tag, ArrowLeft } from 'lucide-react';
import { Card } from '../../components/UI';
import { Pagination } from '../../components/Pagination';
import { FeedbackDialog } from '../../components/FeedbackDialog';
import { StockDocPrintModal } from './StockDocs/StockDocPrintModal';
import { StockLabelPrintModal } from './StockDocs/StockLabelPrintModal';
import {
  getStockDocuments, getWarehouses, getAvailableInventory, getInventoryDetails, createReceipt, createIssue, createReturn, createTransfer,
  advanceDocument, advanceTransfer, getPartnerSuggestions, getStockDocument, cancelStockDocument, deleteStockDocument, countLinesMissingSerials, getProcessingSummary,
  type StockDocument, type StockDocLine, type Warehouse, type ProcessingSummary,
  type PartnerSuggestion, type PartnerSuggestionsData, type StockDocDetailLine, type AvailableInventoryRow, type InventoryDetails,
} from '../../services/stockService';
import { getProducts, type Product } from '../../services/productService';
import { getDeptHomePath, getDeptModulePath } from '../../components/layout/menus/departmentMenus';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { levelOf, LEVELS } from '../../utils/rbac';
import type { DeptKey } from '../../components/layout/menus/menuTypes';


import { KIND_META, STATUS_LABEL, type Kind } from './StockDocs/meta';
import { DocDetailModal } from './StockDocs/DocDetailModal';
import { DocCreateModal } from './StockDocs/DocCreateModal';

// Trang chứng từ kho dùng chung cho Nhập/Xuất/Điều chuyển (§13–18).
export default function StockDocsPage({ deptKey, kind }: { deptKey: DeptKey; kind: Kind }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const meta = KIND_META[kind];
  const urlDocId = searchParams.get('documentId');
  const fromProcessing = searchParams.get('from') === 'wh_processing';
  const [docs, setDocs] = useState<StockDocument[]>([]);
  const [summary, setSummary] = useState<ProcessingSummary>({});
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [printDoc, setPrintDoc] = useState<(StockDocument & { lines?: StockDocDetailLine[] }) | null>(null);
  const [loadingPrintDoc, setLoadingPrintDoc] = useState(false);
  const [labelDoc, setLabelDoc] = useState<(StockDocument & { lines?: StockDocDetailLine[] }) | null>(null);
  const [loadingLabelDoc, setLoadingLabelDoc] = useState(false);

  const handlePrintDoc = async (docId: string) => {
    setLoadingPrintDoc(true);
    try {
      const fullDoc = await getStockDocument(docId);
      setPrintDoc(fullDoc);
    } catch (err: any) {
      setNotice({ title: 'Không thể tải chứng từ', message: err?.message || 'Lỗi khi tải chi tiết để in' });
    } finally {
      setLoadingPrintDoc(false);
    }
  };

  const handlePrintLabels = async (docId: string) => {
    setLoadingLabelDoc(true);
    try {
      const fullDoc = await getStockDocument(docId);
      setLabelDoc(fullDoc);
    } catch (err: any) {
      setNotice({ title: 'Không thể tải chi tiết để in tem', message: err?.message || 'Lỗi khi tải chi tiết để in tem' });
    } finally {
      setLoadingLabelDoc(false);
    }
  };
  const [notice, setNotice] = useState<{
    title: string; message: string; tone?: 'warning' | 'error' | 'success'; docId?: string;
    action?: 'processing' | 'count';
  } | null>(null);
  const [inventory, setInventory] = useState<AvailableInventoryRow[]>([]);
  const [inventoryTotal, setInventoryTotal] = useState(0);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [inventoryWarehouse, setInventoryWarehouse] = useState('');
  const [inventoryTracking, setInventoryTracking] = useState('');
  const [inventoryOnlyAvailable, setInventoryOnlyAvailable] = useState(true);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryPageSize, setInventoryPageSize] = useState(10);
  const [inventoryDetails, setInventoryDetails] = useState<InventoryDetails | null>(null);
  const [inventoryDetailsLoading, setInventoryDetailsLoading] = useState(false);
  const [inventoryDetailsError, setInventoryDetailsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [hasMore, setHasMore] = useState(false);
  const [datePreset, setDatePreset] = useState<'ALL' | 'TODAY' | 'MONTH' | 'YEAR'>('ALL');
  const [dateSortOrder, setDateSortOrder] = useState<'asc' | 'desc'>('desc');
  const { users } = useData();
  const { user } = useAuth();
  // Đồng bộ với requireWarehouseManager ở backend: Admin không thực hiện
  // nghiệp vụ kho, còn Trưởng phòng trở lên được cấu hình hạch toán.
  const canEditFinancials = levelOf(user) >= LEVELS.MANAGER && levelOf(user) !== LEVELS.ADMIN;
  const navigate = useNavigate();
  const { showToast } = useNotifications();

  const processingPath = (docId: string) =>
    getDeptModulePath(deptKey, 'wh_processing', { documentId: docId });
  const countPath = () => getDeptModulePath(deptKey, 'wh_count');

  const dateRange = () => {
    if (datePreset === 'ALL') return {};
    const now = new Date();
    const start = datePreset === 'TODAY' ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : datePreset === 'MONTH' ? new Date(now.getFullYear(), now.getMonth(), 1)
      : new Date(now.getFullYear(), 0, 1);
    const end = datePreset === 'TODAY' ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      : datePreset === 'MONTH' ? new Date(now.getFullYear(), now.getMonth() + 1, 1)
      : new Date(now.getFullYear() + 1, 0, 1);
    return { from: start.toISOString(), to: end.toISOString() };
  };

  const fetchAll = async () => {
    setLoading(true); setError(null);
    try {
      const [d, w, s] = await Promise.all([
        getStockDocuments({ docType: kind, ...dateRange(), sortOrder: dateSortOrder, limit: pageSize + 1, offset: (page - 1) * pageSize }),
        getWarehouses().catch(() => [] as Warehouse[]),
        getProcessingSummary({ docType: kind }).catch(() => ({}) as ProcessingSummary),
      ]);
      setHasMore(d.length > pageSize); setDocs(d.slice(0, pageSize)); setWarehouses(w); setSummary(s);
      getProducts().then(setProducts).catch(() => {});
    } catch (e: any) {
      setError(e.message || 'Không tải được chứng từ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind, page, pageSize, datePreset, dateSortOrder]);
  useEffect(() => { setPage(1); }, [kind]);
  useEffect(() => {
    if (urlDocId) {
      setSelectedDocId(urlDocId);
    }
  }, [urlDocId]);
  const visibleDocs = docs;

  useEffect(() => {
    if (!['RECEIPT', 'ISSUE', 'TRANSFER'].includes(kind)) { setInventory([]); setInventoryTotal(0); return; }
    let cancelled = false;
    setInventoryLoading(true); setInventoryError(null);
    getAvailableInventory({
      q: inventoryQuery.trim() || undefined,
      warehouseId: inventoryWarehouse || undefined,
      tracking: inventoryTracking || undefined,
      onlyAvailable: inventoryOnlyAvailable,
      limit: inventoryPageSize,
      offset: (inventoryPage - 1) * inventoryPageSize,
    }).then((result) => { if (!cancelled) { setInventory(result.rows); setInventoryTotal(result.total); } })
      .catch((e: any) => { if (!cancelled) setInventoryError(e.message || 'Không tải được tồn kho khả dụng'); })
      .finally(() => { if (!cancelled) setInventoryLoading(false); });
    return () => { cancelled = true; };
  }, [kind, inventoryQuery, inventoryWarehouse, inventoryTracking, inventoryOnlyAvailable, inventoryPage, inventoryPageSize]);
  useEffect(() => { setInventoryPage(1); }, [kind, inventoryQuery, inventoryWarehouse, inventoryTracking, inventoryOnlyAvailable]);

  const act = async (id: string, fn: () => Promise<unknown>, doneMsg: string, okToast?: { title: string; message: string }) => {
    setActingId(id); setError(null);
    try {
      await fn();
      await fetchAll();
      if (okToast) showToast({ type: 'success', title: okToast.title, message: okToast.message });
      return true;
    } catch (e: any) {
      const message = e.message || doneMsg;
      if (e.status === 409 && /kiểm kê|đang đếm/i.test(message)) {
        setNotice({
          title: 'Chưa thể hoàn tất vì kho đang kiểm kê',
          message: 'Kho này đang có đợt kiểm kê ở trạng thái “Đang đếm”. Hãy hoàn tất hoặc hủy đợt kiểm kê trước khi ghi nhận phiếu; như vậy số liệu kiểm kê sẽ không bị thay đổi giữa chừng.',
          tone: 'warning',
          action: 'count',
        });
      } else if (/serial/i.test(message)) {
        setNotice({ title: 'Serial không hợp lệ', message, docId: id, action: 'processing', tone: 'error' });
      } else {
        setError(message);
      }
      return false;
    } finally {
      setActingId(null);
    }
  };

  const whName = (id: string | null) => warehouses.find((w) => w.id === id)?.name || id || '—';

  const completeWithCheck = async (d: StockDocument, fn: () => Promise<unknown>, failMsg: string) => {
    // Bước xử lý hàng hóa là điều kiện bắt buộc để backend chuyển phiếu sang READY.
    // Không gửi yêu cầu hoàn tất một phiếu nháp rồi trả về lỗi 400 cho người dùng.
    if (d.status !== 'READY') {
      setNotice({
        title: 'Phiếu chưa sẵn sàng hoàn tất',
        message: 'Hãy xử lý và xác nhận đầy đủ hàng hóa trước. Sau khi phiếu chuyển sang “Sẵn sàng hoàn tất”, bạn mới có thể ghi nhận tồn kho.',
        docId: d.id,
        action: 'processing',
      });
      return;
    }
    const ok = await act(d.id, fn, failMsg);
    if (ok) {
      const done = d.docType === 'RECEIPT' ? 'nhập kho' : d.docType === 'ISSUE' ? 'xuất kho' : d.docType === 'RETURN' ? 'nhận lại hàng' : 'điều chuyển';
      showToast({
        type: 'success',
        title: `✅ Hoàn tất ${d.docType === 'RECEIPT' ? 'nhập kho' : d.docType === 'ISSUE' ? 'giao hàng' : d.docType === 'RETURN' ? 'nhận lại hàng' : 'điều chuyển'}`,
        message: `Phiếu ${d.code || d.id.slice(0, 8)} đã ${done} thành công. Tồn kho và serial đã được cập nhật.`,
      });
    }
  };


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
        // Nhân bản là một phiếu mới: không mang theo Serial/Lô đã xử lý của phiếu gốc.
        // Người dùng sẽ nhập/quét lại Serial ở bước Xử lý hàng hóa.
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
          : detail.docType === 'RETURN'
            ? await createReturn({ warehouseId: detail.warehouseId!, lines: cleanLines, notes, ...header })
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
      {fromProcessing && (
        <div className="flex items-center justify-between p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-950 text-sm shadow-xs flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-medium">
              Bạn đang làm việc từ danh sách <b>Xử lý phiếu</b>.
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate(getDeptModulePath(deptKey, 'wh_processing'))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <ArrowLeft size={14} /> Quay lại Xử lý phiếu
          </button>
        </div>
      )}

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

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-500">Lọc nhanh:</span>
        {([['ALL', 'Tất cả'], ['TODAY', 'Hôm nay'], ['MONTH', 'Tháng này'], ['YEAR', 'Năm nay']] as const).map(([value, label]) => (
          <button key={value} onClick={() => { setDatePreset(value); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${datePreset === value ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
        <label className="ml-0 sm:ml-2 flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-600">
          <Calendar size={14} className="text-gray-400" />
          <span>Sắp xếp ngày:</span>
          <select
            value={dateSortOrder}
            onChange={(event) => { setDateSortOrder(event.target.value as 'asc' | 'desc'); setPage(1); }}
            className="bg-transparent text-xs font-bold text-gray-700 outline-none cursor-pointer"
            aria-label="Sắp xếp chứng từ theo ngày tạo"
          >
            <option value="desc">Mới nhất</option>
            <option value="asc">Cũ nhất</option>
          </select>
        </label>
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
            <table className="wh-table w-full text-sm">
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
                {visibleDocs.map((d) => {
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
                          {(d.status === 'DRAFT' || d.status === 'PROCESSING') && (
                            <button disabled={actingId === d.id} onClick={() => navigate(processingPath(d.id))}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold disabled:opacity-60 transition-colors shadow-sm whitespace-nowrap">
                              <ListChecks size={12} />Xử lý hàng hóa
                            </button>
                          )}
                          {d.status === 'READY' && kind !== 'TRANSFER' && (
                            <button disabled={actingId === d.id} onClick={() => completeWithCheck(d, () => advanceDocument(kind === 'RECEIPT' ? 'receipts' : kind === 'RETURN' ? 'returns' : 'issues', d.id, 'complete'), 'Hoàn tất thất bại')}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-60 transition-colors shadow-sm whitespace-nowrap">
                              {actingId === d.id ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}{meta.actionDone}
                            </button>
                          )}
                          {d.status === 'READY' && kind === 'TRANSFER' && (
                            <button disabled={actingId === d.id} onClick={() => act(d.id, () => advanceTransfer(d.id, 'ship'), 'Gửi hàng thất bại')}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold disabled:opacity-60 transition-colors shadow-sm whitespace-nowrap">
                              {actingId === d.id ? <RefreshCw size={12} className="animate-spin" /> : <Truck size={12} />}Xác nhận gửi
                            </button>
                          )}
                          {d.status === 'IN_TRANSIT' && kind === 'TRANSFER' && (
                            <ReceiveTransferButton id={d.id} warehouseId={d.destWarehouseId!} onDone={fetchAll} />
                          )}
                          {d.status !== 'DRAFT' && d.status !== 'PROCESSING' && !(d.status === 'IN_TRANSIT' && kind === 'TRANSFER') && (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedDocId(d.id)}
                            className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                            title="Xem chi tiết"
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            type="button"
                            disabled={loadingLabelDoc}
                            onClick={() => handlePrintLabels(d.id)}
                            className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                            title="In tem nhãn nhiệt (Mã vạch / QR)"
                          >
                            <Tag size={15} />
                          </button>
                          <button
                            type="button"
                            disabled={loadingPrintDoc}
                            onClick={() => handlePrintDoc(d.id)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                            title="In phiếu chứng từ (Mẫu chuẩn Bộ Tài Chính)"
                          >
                            <Printer size={15} />
                          </button>
                          {(d.status === 'DRAFT' || d.status === 'PROCESSING') && kind !== 'TRANSFER' && (() => {
                            const s = summary[d.id];
                            const label = s && s.total > 0
                              ? (s.done >= s.total ? '✓ Đủ' : `Xử lý (${s.done}/${s.total})`)
                              : 'Xử lý';
                            const ready = s && s.total > 0 && s.done >= s.total;
                            return (
                              <button
                                type="button"
                                onClick={() => navigate(processingPath(d.id))}
                                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold transition-colors ${ready
                                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
                                title="Xử lý Serial / Lô"
                              >
                                {!s || s.total === 0 ? <ListChecks size={13} /> : null}{label}
                              </button>
                            );
                          })()}
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
      {!loading && docs.length > 0 && <Pagination currentPage={page} totalPages={hasMore ? page + 1 : page} onPageChange={setPage} itemsPerPage={pageSize} onItemsPerPageChange={(size) => { setPageSize(size); setPage(1); }} />}

      {['RECEIPT', 'ISSUE', 'TRANSFER'].includes(kind) && (
        <AvailableInventoryPanel
          kind={kind}
          rows={inventory}
          warehouses={warehouses}
          loading={inventoryLoading}
          error={inventoryError}
          query={inventoryQuery}
          warehouseId={inventoryWarehouse}
          tracking={inventoryTracking}
          onlyAvailable={inventoryOnlyAvailable}
          page={inventoryPage}
          pageSize={inventoryPageSize}
          totalRows={inventoryTotal}
          onPageChange={setInventoryPage}
          onPageSizeChange={(size) => { setInventoryPageSize(size); setInventoryPage(1); }}
          onQuery={setInventoryQuery}
          onWarehouse={setInventoryWarehouse}
          onTracking={setInventoryTracking}
          onOnlyAvailable={setInventoryOnlyAvailable}
          onView={async (row) => {
            setInventoryDetailsLoading(true); setInventoryDetailsError(null);
            try { setInventoryDetails(await getInventoryDetails(row.productId, row.warehouseId)); }
            catch (e: any) { setInventoryDetailsError(e.message || 'Không tải được chi tiết tồn kho'); }
            finally { setInventoryDetailsLoading(false); }
          }}
        />
      )}

      {inventoryDetailsLoading && <div className="fixed inset-0 z-[70] bg-slate-900/30 flex items-center justify-center"><div className="rounded-xl bg-white px-5 py-4 text-sm text-gray-600 shadow-xl">Đang tải chi tiết tồn kho...</div></div>}
      {inventoryDetailsError && <FeedbackDialog title="Không tải được tồn kho" message={inventoryDetailsError} tone="error" onClose={() => setInventoryDetailsError(null)} />}
      {inventoryDetails && <InventoryDetailsModal details={inventoryDetails} onClose={() => setInventoryDetails(null)} />}

      {selectedDocId && (
        <DocDetailModal
          docId={selectedDocId}
          warehouses={warehouses}
          kind={kind}
          onClose={() => {
            setSelectedDocId(null);
            if (searchParams.get('documentId')) {
              const next = new URLSearchParams(searchParams);
              next.delete('documentId');
              setSearchParams(next, { replace: true });
            }
          }}
          onUpdated={fetchAll}
          onEdit={(id) => { setSelectedDocId(null); setEditingId(id); }}
          deptKey={deptKey}
        />
      )}

      {printDoc && (
        <StockDocPrintModal
          doc={printDoc}
          warehouses={warehouses}
          onClose={() => setPrintDoc(null)}
        />
      )}

      {labelDoc && (
        <StockLabelPrintModal
          doc={labelDoc}
          onClose={() => setLabelDoc(null)}
        />
      )}

      {showCreate && (
        <DocCreateModal
          kind={kind} warehouses={warehouses} products={products} users={users.map((u: any) => ({ id: u.id, name: u.name }))}
          canEditFinancials={canEditFinancials}
          onClose={() => setShowCreate(false)}
          onDone={async (created) => {
            setShowCreate(false);
            await fetchAll();
            // Tạo xong chuyển thẳng sang hàng đợi Xử lý phiếu.
            if (created?.id && kind !== 'TRANSFER') {
              showToast({
                type: 'success',
                title: `Đã tạo phiếu ${created.code || ''}`.trim(),
                message: 'Chuyển sang Xử lý phiếu — đủ hàng mới được bấm Hoàn tất.',
              });
              navigate(processingPath(created.id));
            }
          }}
          onError={setError}
        />
      )}

      {editingId && (
        <DocCreateModal
          key={editingId}
          kind={kind} warehouses={warehouses} products={products} users={users.map((u: any) => ({ id: u.id, name: u.name }))}
          canEditFinancials={canEditFinancials}
          editingId={editingId}
          onClose={() => setEditingId(null)}
          onDone={async () => { setEditingId(null); await fetchAll(); }}
          onError={setError}
        />
      )}

      {notice && (
        <FeedbackDialog
          title={notice.title}
          message={notice.message}
          tone={notice.tone}
          actionLabel={notice.action === 'count' ? 'Mở Kiểm kê' : notice.action === 'processing' ? 'Mở trang xử lý phiếu' : undefined}
          onAction={notice.action ? () => {
            setNotice(null);
            navigate(notice.action === 'count' ? countPath() : processingPath(notice.docId!));
          } : undefined}
          onClose={() => setNotice(null)}
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
              disabled={actingId === target.id || loadingPrintDoc}
              onClick={() => { setMenu(null); handlePrintDoc(target.id); }}
              className={`${itemCls} text-gray-700 hover:bg-gray-50`}
            >
              <Printer size={15} className="text-blue-500" /> In phiếu chứng từ
            </button>
            <button
              type="button"
              disabled={actingId === target.id || loadingLabelDoc}
              onClick={() => { setMenu(null); handlePrintLabels(target.id); }}
              className={`${itemCls} text-gray-700 hover:bg-gray-50`}
            >
              <Tag size={15} className="text-amber-500" /> In tem nhãn nhiệt
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

function AvailableInventoryPanel({
  kind, rows, warehouses, loading, error, query, warehouseId, tracking, onlyAvailable,
  page, pageSize, totalRows, onPageChange, onPageSizeChange,
  onQuery, onWarehouse, onTracking, onOnlyAvailable,
  onView,
}: {
  kind: Kind;
  rows: AvailableInventoryRow[];
  warehouses: Warehouse[];
  loading: boolean;
  error: string | null;
  query: string;
  warehouseId: string;
  tracking: string;
  onlyAvailable: boolean;
  page: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onQuery: (value: string) => void;
  onWarehouse: (value: string) => void;
  onTracking: (value: string) => void;
  onOnlyAvailable: (value: boolean) => void;
  onView: (row: AvailableInventoryRow) => void;
}) {
  const trackingLabel = (value: string | null) => value === 'SERIAL' ? 'Serial' : value === 'LOT' ? 'Lô' : value === 'QUANTITY' || value === 'NONE' || !value ? 'Số lượng' : value;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const helperText = kind === 'ISSUE'
    ? 'Tồn thực tế trừ số lượng đang giữ cho các phiếu xuất chưa hoàn tất.'
    : kind === 'TRANSFER'
      ? 'Tồn khả dụng tại các kho nguồn để kiểm tra trước khi điều chuyển.'
      : 'Tồn hiện tại để tham khảo khi tiếp nhận hàng vào kho.';
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-bold text-gray-800">Tồn kho khả dụng</h2>
          <p className="text-xs text-gray-400 mt-0.5">{helperText}</p>
        </div>
        <span className="text-xs text-gray-400">{rows.length} dòng</span>
      </div>
      <div className="p-3 border-b border-gray-100 bg-gray-50/60 flex flex-wrap gap-2">
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Tìm sản phẩm / mã / Serial / thương hiệu..."
          className="flex-1 min-w-[220px] px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none focus:border-emerald-500" />
        <select value={warehouseId} onChange={(e) => onWarehouse(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm text-gray-700 outline-none focus:border-emerald-500">
          <option value="">Tất cả kho</option>
          {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
        </select>
        <select value={tracking} onChange={(e) => onTracking(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm text-gray-700 outline-none focus:border-emerald-500">
          <option value="">Tất cả loại quản lý</option>
          <option value="SERIAL">Serial</option>
          <option value="LOT">Lô</option>
          <option value="QUANTITY">Số lượng</option>
        </select>
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={onlyAvailable} onChange={(e) => onOnlyAvailable(e.target.checked)} className="accent-emerald-600" />
          Còn khả dụng
        </label>
      </div>
      {error && <p className="m-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">{error}</p>}
      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">Đang tải tồn kho...</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">Không có tồn kho phù hợp với bộ lọc.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="wh-table w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-2 px-4 text-xs font-bold text-gray-500 uppercase">Mã SP / Sản phẩm</th>
                <th className="text-left py-2 px-3 text-xs font-bold text-gray-500 uppercase">Kho</th>
                <th className="text-right py-2 px-3 text-xs font-bold text-gray-500 uppercase">Tồn thực tế</th>
                <th className="text-right py-2 px-3 text-xs font-bold text-gray-500 uppercase">Đang giữ</th>
                <th className="text-right py-2 px-3 text-xs font-bold text-gray-500 uppercase">Khả dụng</th>
                <th className="text-center py-2 px-3 text-xs font-bold text-gray-500 uppercase">Quản lý</th>
                <th className="text-right py-2 px-4 text-xs font-bold text-gray-500 uppercase">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row) => (
                <tr key={`${row.productId}:${row.warehouseId}`} className="hover:bg-emerald-50/40">
                  <td className="py-2.5 px-4">
                    <div className="font-mono text-xs font-bold text-gray-700" title={row.productId}>{row.productCode || row.productId}</div>
                    <div className="text-xs text-gray-600 mt-0.5">{row.productName || '—'}</div>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-gray-600">{row.warehouseName || row.warehouseId}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs">{Number(row.onHand).toLocaleString('vi-VN')} {row.unit || ''}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs text-amber-700">{Number(row.reserved).toLocaleString('vi-VN')} {row.unit || ''}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs font-bold text-emerald-700">{Number(row.available).toLocaleString('vi-VN')} {row.unit || ''}</td>
                  <td className="py-2.5 px-3 text-center"><span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-bold">{trackingLabel(row.tracking)}</span></td>
                  <td className="py-2.5 px-4 text-right"><button type="button" onClick={() => onView(row)} className="px-2.5 py-1 rounded-lg text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100">Xem</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && totalRows > 0 && (
        <div className="px-4 pb-4">
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            totalItems={totalRows}
            itemsPerPage={pageSize}
            onItemsPerPageChange={onPageSizeChange}
          />
        </div>
      )}
    </Card>
  );
}

function InventoryDetailsModal({ details, onClose }: { details: InventoryDetails; onClose: () => void }) {
  const formatDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('vi-VN') : '—';
  // Từ khi áp dụng quy trình quét Serial bắt buộc, một sản phẩm legacy có thể
  // vẫn mang tracking = QUANTITY/LOT nhưng các đơn vị tồn thực tế đã được lưu
  // trong stock_serials. Ưu tiên dữ liệu nghiệp vụ thực tế để không hiện bảng Lô rỗng.
  const showSerials = details.serials.length > 0 || details.product.tracking === 'SERIAL';
  return (
    <div className="fixed inset-0 z-[75] bg-slate-900/45 backdrop-blur-[2px] p-3 sm:p-6 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-6xl max-h-[92vh] overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 px-5 py-4 border-b border-gray-100 bg-white flex items-start justify-between gap-3">
          <div><p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Chi tiết tồn kho</p><h2 className="text-xl font-bold text-gray-800 mt-1">{details.product.name}</h2><p className="text-xs text-gray-500 mt-1">{details.product.id} · {details.warehouse.name}</p></div>
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50">Đóng</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <div className="rounded-xl bg-gray-50 p-3"><p className="text-xs text-gray-500">Tồn thực tế</p><b className="text-lg">{Number(details.summary.onHand).toLocaleString('vi-VN')} {details.product.unit || ''}</b></div>
            <div className="rounded-xl bg-amber-50 p-3"><p className="text-xs text-amber-700">Đang giữ</p><b className="text-lg text-amber-800">{Number(details.summary.reserved).toLocaleString('vi-VN')} {details.product.unit || ''}</b></div>
            <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Khả dụng</p><b className="text-lg text-emerald-800">{Number(details.summary.available).toLocaleString('vi-VN')} {details.product.unit || ''}</b></div>
          </div>
          {showSerials ? (
            <div className="overflow-x-auto border border-gray-100 rounded-xl"><table className="wh-table wh-table-compact w-full text-sm"><thead className="bg-gray-50"><tr>{['Serial','Ngày nhập','Phiếu nhập','NCC','Trạng thái','Phiếu xuất'].map((h) => <th key={h} className="text-left px-3 py-2 text-xs font-bold text-gray-500 uppercase">{h}</th>)}</tr></thead><tbody className="divide-y divide-gray-50">{details.serials.length > 0 ? details.serials.map((serial) => <tr key={serial.id}><td className="px-3 py-2 font-mono font-bold text-xs">{serial.serialNumber || '—'}</td><td className="px-3 py-2 text-xs">{formatDate(serial.receivedAt)}</td><td className="px-3 py-2 text-xs">{serial.receiptCode || '—'}</td><td className="px-3 py-2 text-xs">{serial.supplier || serial.receiptPartnerName || '—'}</td><td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs font-bold">{serial.stockStatus}</span></td><td className="px-3 py-2 text-xs">{serial.issueCode || '—'}</td></tr>) : <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-gray-400">Chưa có Serial được ghi nhận cho tồn kho này.</td></tr>}</tbody></table></div>
          ) : (
            <div className="overflow-x-auto border border-gray-100 rounded-xl"><table className="wh-table wh-table-compact w-full text-sm"><thead className="bg-gray-50"><tr>{['Lô / phiếu nhập','Ngày nhập','SL nhập','Còn lại','Đã xuất','NCC','Kho'].map((h) => <th key={h} className="text-left px-3 py-2 text-xs font-bold text-gray-500 uppercase">{h}</th>)}</tr></thead><tbody className="divide-y divide-gray-50">{details.lots.length > 0 ? details.lots.map((lot) => <tr key={lot.id}><td className="px-3 py-2 text-xs"><b>{lot.lotCode}</b><div className="text-gray-400">{lot.receiptCode || '—'}</div></td><td className="px-3 py-2 text-xs">{formatDate(lot.receivedAt)}</td><td className="px-3 py-2 text-xs">{Number(lot.initialQty).toLocaleString('vi-VN')} {lot.unit || details.product.unit || ''}</td><td className="px-3 py-2 text-xs font-bold text-emerald-700">{Number(lot.remainingQty).toLocaleString('vi-VN')} {lot.unit || details.product.unit || ''}</td><td className="px-3 py-2 text-xs">{Number(lot.initialQty - lot.remainingQty).toLocaleString('vi-VN')} {lot.unit || details.product.unit || ''}</td><td className="px-3 py-2 text-xs">{lot.supplier || lot.receiptPartnerName || '—'}</td><td className="px-3 py-2 text-xs">{details.warehouse.name}</td></tr>) : <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-gray-400">Chưa có dữ liệu lô hoặc phiếu nhập chi tiết.</td></tr>}</tbody></table></div>
          )}
        </div>
      </div>
    </div>
  );
}

