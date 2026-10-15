import { getStockLocations, type StockLocation } from '../../../services/locationService';
import { ReceiveTransferButton } from '../ReceiveTransferButton';
import { apiFetch } from '../../../services/api';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { PlusCircle, RefreshCw, AlertCircle, X, CheckCircle2, Truck, PackageCheck, ChevronDown, Eye, Ban, FileText, Calendar, Building2, User } from 'lucide-react';
import { Card } from '../../../components/UI';
import {
  getStockDocuments, getWarehouses, createReceipt, createIssue, createTransfer,
  advanceDocument, advanceTransfer, getPartnerSuggestions, getStockDocument, cancelStockDocument,
  type StockDocument, type StockDocLine, type Warehouse,
  type PartnerSuggestion, type PartnerSuggestionsData, type StockDocDetailLine,
} from '../../../services/stockService';
import { getProducts, type Product } from '../../../services/productService';
import { getDeptHomePath } from '../../../components/layout/menus/departmentMenus';
import { useData } from '../../../contexts/DataContext';
import type { DeptKey } from '../../../components/layout/menus/menuTypes';


import { KIND_META, type Kind } from './meta';
import { SearchCombo, FormattedNumberInput, UnitSuggestInput, PartnerSuggestInput, TextSuggestInput } from './controls';

export function DocCreateModal({ kind, warehouses, products, users, onClose, onDone, onError }: {
  kind: Kind; warehouses: Warehouse[]; products: Product[]; users: { id: string; name: string }[];
  onClose: () => void; onDone: () => Promise<void>; onError: (m: string) => void;
}) {
  const [warehouseId, setWarehouseId] = useState('');
  const [destWarehouseId, setDestWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<StockDocLine[]>([{ productId: '', quantity: 1, unitPrice: 0, vatRate: 8, serialLot: '' }]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [partnerSuggestions, setPartnerSuggestions] = useState<PartnerSuggestionsData>({
    partners: [],
    deliverers: [],
    notes: [],
    addresses: [],
  });

  useEffect(() => {
    getPartnerSuggestions()
      .then(setPartnerSuggestions)
      .catch(() => {});
  }, []);

  const handlePickPartner = (p: PartnerSuggestion) => {
    if (p.code) setPartnerCode(p.code);
    if (p.name) setPartnerName(p.name);
    if (p.address) setPartnerAddress(p.address);
    if (p.deliverer && !deliverer) setDeliverer(p.deliverer);
  };

  useEffect(() => {
    if (!warehouseId && warehouses.length > 0) setWarehouseId(warehouses[0].id);
  }, [warehouses]);
  const moneyKind = kind !== 'TRANSFER';
  const [costTab, setCostTab] = useState<'goods' | 'cost'>('goods');
  const [referenceType, setReferenceType] = useState('PO');
  const [referenceId, setReferenceId] = useState('');
  const [invoiceLookupCode, setInvoiceLookupCode] = useState('');
  const [invoiceLookupUrl, setInvoiceLookupUrl] = useState('');
  const [shippingFee, setShippingFee] = useState('');
  const [tkKho, setTkKho] = useState('1561');
  const [tkCongNo, setTkCongNo] = useState('331');
  const [costItem, setCostItem] = useState('');
  const [costObject, setCostObject] = useState('');
  const [project, setProject] = useState('');
  const [receiptSubType, setReceiptSubType] = useState('DOMESTIC_PURCHASE');
  const [partnerCode, setPartnerCode] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [partnerAddress, setPartnerAddress] = useState('');
  const [deliverer, setDeliverer] = useState('');
  const [purchaserId, setPurchaserId] = useState('');
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('UNPAID');
  const [paymentDueDate, setPaymentDueDate] = useState('');
  const [attachments, setAttachments] = useState<{ name: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const notesRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const uploadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const formData = new FormData();
    arr.forEach((f) => formData.append('files', f));
    setUploading(true);
    try {
      const res = await apiFetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Tải file thất bại');
      setAttachments((prev) => [...prev, ...((data.files || []) as any[]).map((f: any) => ({ name: f.name, url: f.url }))]);
    } catch (e: any) {
      setErr(e.message || 'Tải file thất bại.');
    } finally {
      setUploading(false);
    }
  };
  useEffect(() => {
    let active = true;
    setLocations([]);
    setLines(lines => lines.map(line => ({ ...line, locationId: '' })));
    if (warehouseId) getStockLocations(warehouseId)
      .then(rows => { if (active) setLocations(rows.filter(row => row.isActive)); })
      .catch(error => { if (active) setErr(error.message); });
    return () => { active = false; };
  }, [warehouseId]);

  const availableUnits = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.unit && p.unit.trim()) set.add(p.unit.trim());
    });
    ['Bộ', 'Cái', 'Tấm', 'Cuộn', 'Mét', 'Kg', 'Hộp', 'Thùng', 'Lô'].forEach((u) => set.add(u));
    return Array.from(set);
  }, [products]);

  const setLine = (i: number, patch: Partial<StockDocLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const pickProduct = (i: number, p: Product | null) => {
    setLines((ls) => ls.map((l, j) => {
      if (j !== i) return l;
      if (!p) return { ...l, productId: '', unit: '' };
      return {
        ...l,
        productId: p.id,
        unitPrice: Number(l.unitPrice) > 0 ? l.unitPrice : (p.salePrice || p.defaultPrice || 0),
        unit: p.unit || l.unit || '',
      };
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    if (kind !== 'TRANSFER' && !warehouseId) {
      setErr('Vui lòng chọn kho (*).');
      return;
    }
    if (kind === 'TRANSFER') {
      if (!warehouseId) {
        setErr('Vui lòng chọn kho gửi (*).');
        return;
      }
      if (!destWarehouseId) {
        setErr('Vui lòng chọn kho nhận (*).');
        return;
      }
      if (warehouseId === destWarehouseId) {
        setErr('Kho gửi và kho nhận phải khác nhau.');
        return;
      }
    }

    if (lines.length === 0) {
      setErr('Vui lòng thêm ít nhất 1 dòng hàng hóa.');
      return;
    }

    const invalidLines = lines
      .map((l, idx) => {
        const noProduct = !l.productId;
        const invalidQty = !l.quantity || Number(l.quantity) <= 0 || isNaN(Number(l.quantity));
        return { idx, noProduct, invalidQty, hasError: noProduct || invalidQty };
      })
      .filter((x) => x.hasError);

    if (invalidLines.length > 0) {
      if (costTab !== 'goods') setCostTab('goods');
      const details = invalidLines
        .map((x) => {
          const issues: string[] = [];
          if (x.noProduct) issues.push('chưa chọn hàng hóa');
          if (x.invalidQty) issues.push('số lượng phải > 0');
          return `Dòng #${x.idx + 1} (${issues.join(', ')})`;
        })
        .join('; ');
      setErr(`Phát hiện ${invalidLines.length} dòng nhập sai hoặc thiếu: ${details}. Vui lòng kiểm tra các ô được đánh dấu đỏ.`);
      return;
    }

    const clean = lines.map((l) => ({
      ...l,
      quantity: Number(l.quantity),
      serialLot: l.serialLot?.trim() || undefined,
      accountDebit: moneyKind ? (tkKho.trim() || '1561') : undefined,
      accountCredit: moneyKind ? (tkCongNo.trim() || '331') : undefined,
      projectId: moneyKind ? (project.trim() || undefined) : undefined,
      costItem: moneyKind ? (costItem.trim() || undefined) : undefined,
      costObjectId: moneyKind ? (costObject.trim() || undefined) : undefined,
    }));

    setSaving(true); setErr('');
    try {
      const header = moneyKind ? {
        receiptSubType: kind === 'RECEIPT' ? receiptSubType : undefined,
        partnerCode: partnerCode.trim() || undefined,
        partnerName: partnerName.trim() || undefined,
        partnerAddress: partnerAddress.trim() || undefined,
        deliverer: deliverer.trim() || undefined,
        purchaserId: purchaserId || undefined,
        postingDate: postingDate || undefined,
        docDate: docDate || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        invoiceDate: invoiceDate || undefined,
        paymentStatus,
        paymentDueDate: paymentDueDate || undefined,
        referenceType: referenceType || undefined,
        referenceId: referenceId.trim() || undefined,
        invoiceLookupCode: invoiceLookupCode.trim() || undefined,
        invoiceLookupUrl: invoiceLookupUrl.trim() || undefined,
        shippingFee: shippingFee === '' ? undefined : Number(shippingFee),
      } : {};
      const attachUrls = attachments.map((a) => a.url);
      if (kind === 'RECEIPT') await createReceipt({ warehouseId, lines: clean, notes: notes || undefined, ...header, ...(attachUrls.length > 0 ? { attachments: attachUrls } : {}) });
      else if (kind === 'ISSUE') await createIssue({ warehouseId, lines: clean, notes: notes || undefined, ...header, ...(attachUrls.length > 0 ? { attachments: attachUrls } : {}) });
      else await createTransfer({ sourceWarehouseId: warehouseId, destWarehouseId, lines: clean, notes: notes || undefined });
      await onDone();
    } catch (e: any) {
      const msg = e.message || 'Tạo phiếu thất bại.';
      setErr(msg); onError(msg);
    } finally {
      setSaving(false);
    }
  };

  const productName = (id: string) => products.find((p) => p.id === id)?.name || '';
  const whCode = warehouses.find((w) => w.id === warehouseId)?.code || '';

  const totals = lines.reduce((acc, l) => {
    const pre = Number(l.quantity || 0) * Number(l.unitPrice || 0);
    const vat = pre * (Number(l.vatRate ?? 8) / 100);
    return { pre: acc.pre + pre, vat: acc.vat + vat };
  }, { pre: 0, vat: 0 });

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm p-0 overflow-y-auto">
      <div className="bg-white shadow-2xl w-full h-[100vh] h-[100dvh] flex flex-col">
        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 text-sm sm:text-base truncate">Tạo phiếu {KIND_META[kind].title.toLowerCase()} ({KIND_META[kind].code})</h3>
            {moneyKind && <p className="text-sm font-extrabold text-emerald-700 font-mono mt-0.5">Tổng: {(totals.pre + totals.vat).toLocaleString('vi-VN')} ₫</p>}
          </div>
          <div className="flex items-center gap-2">
            {kind === 'RECEIPT' && (
              <select value={receiptSubType} onChange={(e) => setReceiptSubType(e.target.value)} title="Loại chứng từ"
                className="px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none max-w-[150px] sm:max-w-[280px] truncate">
                <option value="DOMESTIC_PURCHASE">Mua hàng trong nước nhập kho</option>
                <option value="IMPORT_PURCHASE">Mua hàng nhập khẩu nhập kho</option>
                <option value="OTHER_RECEIPT">Nhập kho khác</option>
              </select>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4">
            {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
            <div className={`grid gap-4 ${kind === 'TRANSFER' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap shrink-0 sm:min-w-[70px]">
                  {kind === 'TRANSFER' ? 'Kho gửi' : 'Kho'} <span className="text-red-500 font-bold">*</span>
                </label>
                <div className="flex-1 min-w-0">
                  <SearchCombo
                    items={warehouses}
                    selectedId={warehouseId}
                    display={(w) => `${w.code} · ${w.name}`}
                    match={(w, q) => `${w.code} ${w.name}`.toLowerCase().includes(q)}
                    onPick={(w) => setWarehouseId(w ? w.id : '')}
                    placeholder="-- Chọn kho (*) --"
                    showArrow={true}
                    inputClassName={`w-full px-4 py-2 border rounded-xl bg-white text-sm outline-none transition-colors ${hasAttemptedSubmit && !warehouseId ? 'border-red-500 ring-1 ring-red-400 bg-red-50/50' : 'border-gray-200 focus:border-emerald-500'}`}
                  />
                </div>
              </div>
              {kind === 'TRANSFER' && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                  <label className="text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap shrink-0 sm:min-w-[70px]">
                    Kho nhận <span className="text-red-500 font-bold">*</span>
                  </label>
                  <div className="flex-1 min-w-0">
                    <SearchCombo
                      items={warehouses}
                      selectedId={destWarehouseId}
                      display={(w) => `${w.code} · ${w.name}`}
                      match={(w, q) => `${w.code} ${w.name}`.toLowerCase().includes(q)}
                      onPick={(w) => setDestWarehouseId(w ? w.id : '')}
                      placeholder="-- Chọn kho nhận (*) --"
                      showArrow={true}
                      inputClassName={`w-full px-4 py-2 border rounded-xl bg-white text-sm outline-none transition-colors ${hasAttemptedSubmit && (!destWarehouseId || destWarehouseId === warehouseId) ? 'border-red-500 ring-1 ring-red-400 bg-red-50/50' : 'border-gray-200 focus:border-emerald-500'}`}
                    />
                  </div>
                </div>
              )}
            </div>
            {moneyKind && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Nhà cung cấp</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-3 gap-y-2">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Mã NCC/KH</label>
                      <PartnerSuggestInput
                        mode="code"
                        value={partnerCode}
                        onChange={setPartnerCode}
                        onSelectPartner={handlePickPartner}
                        partners={partnerSuggestions.partners}
                        placeholder="CTY.SINPOWER"
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Tên NCC/KH</label>
                      <PartnerSuggestInput
                        mode="name"
                        value={partnerName}
                        onChange={setPartnerName}
                        onSelectPartner={handlePickPartner}
                        partners={partnerSuggestions.partners}
                        placeholder="CÔNG TY TNHH..."
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Địa chỉ</label>
                      <TextSuggestInput
                        value={partnerAddress}
                        onChange={setPartnerAddress}
                        suggestions={partnerSuggestions.addresses}
                        placeholder="Địa chỉ..."
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Người giao hàng</label>
                      <TextSuggestInput
                        value={deliverer}
                        onChange={setDeliverer}
                        suggestions={partnerSuggestions.deliverers}
                        placeholder="Nguyễn Văn A"
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Nhân viên mua hàng</label>
                      <select value={purchaserId} onChange={(e) => setPurchaserId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                        <option value="">-- Chọn --</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Diễn giải</label>
                      <TextSuggestInput
                        as="textarea"
                        rows={2}
                        textareaRef={notesRef}
                        value={notes}
                        onChange={setNotes}
                        suggestions={partnerSuggestions.notes.length > 0 ? partnerSuggestions.notes : [
                          'Mua hàng theo hóa đơn số...',
                          'Nhập kho hàng mua trong nước',
                          'Nhập kho hàng nhập khẩu',
                          'Xuất kho bán hàng theo hóa đơn',
                          'Xuất kho vật tư cho công trình'
                        ]}
                        placeholder="Mua hàng theo hóa đơn số..."
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none resize-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Tham chiếu</label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <select value={referenceType} onChange={(e) => setReferenceType(e.target.value)} title="Loại tham chiếu"
                          className="w-full sm:w-36 px-2 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                          <option value="PO">PO mua hàng</option>
                          <option value="CONTRACT">Hợp đồng MB</option>
                          <option value="INVOICE">Hóa đơn</option>
                          <option value="CUSTOMS">Tờ khai HQ</option>
                          <option value="PROJECT">Dự án</option>
                          <option value="OTHER">Khác</option>
                        </select>
                        <input value={referenceId} onChange={(e) => setReferenceId(e.target.value)} placeholder="PO-2026-0021"
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none" />
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Chứng từ</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Ngày hạch toán <span className="text-red-500 font-bold">*</span></label>
                      <input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Ngày chứng từ <span className="text-red-500 font-bold">*</span></label>
                      <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Số phiếu</label>
                      <input readOnly disabled value="Tự động" title="Số phiếu do hệ thống sinh khi lưu"
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 text-sm text-gray-400 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Thanh toán</label>
                      <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                        <option value="UNPAID">Chưa thanh toán</option>
                        <option value="PAID">Đã thanh toán</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Hạn thanh toán</label>
                      <input type="date" value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none" />
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Dòng hàng</label>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <div className="flex bg-gray-100 rounded-xl p-0.5">
                  <button type="button" onClick={() => setCostTab('goods')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg ${costTab === 'goods' ? 'bg-white shadow text-emerald-700' : 'text-gray-500'}`}>Hàng tiền</button>
                  <button type="button" onClick={() => setCostTab('cost')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg ${costTab === 'cost' ? 'bg-white shadow text-emerald-700' : 'text-gray-500'}`}>Chi phí</button>
                </div>
                <span className="ml-auto text-xs text-gray-400">Loại tiền: <b className="text-gray-700">VNĐ</b></span>
              </div>
              {costTab === 'goods' ? (
                <div className="overflow-x-auto border border-gray-200">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="py-2 px-1 text-xs font-bold text-gray-500 uppercase w-8 text-center">#</th>
                        <th className="py-2 px-1 text-center text-xs font-bold text-gray-500 uppercase w-20">Mã hàng <span className="text-red-500 font-bold">*</span></th>
                        <th className="py-2 px-2 text-left text-xs font-bold text-gray-500 uppercase min-w-[180px]">Tên hàng <span className="text-red-500 font-bold">*</span></th>
                        <th className="py-2 px-1 text-center text-xs font-bold text-gray-500 uppercase w-16">Kho</th>
                        <th className="py-2 px-1 text-center text-xs font-bold text-gray-500 uppercase w-32">Vị trí</th>
                        <th className="py-2 px-0.5 text-center text-xs font-bold text-gray-500 uppercase hidden md:table-cell w-12">ĐVT</th>
                        <th className="py-2 px-0.5 text-center text-xs font-bold text-gray-500 uppercase w-12">SL <span className="text-red-500 font-bold">*</span></th>
                        {moneyKind && (
                          <>
                            <th className="py-2 px-1 text-center text-xs font-bold text-gray-500 uppercase w-28">Đơn giá</th>
                            <th className="py-2 px-2 text-right text-xs font-bold text-gray-500 uppercase min-w-[90px]">Thành tiền</th>
                            <th className="py-2 px-0.5 text-center text-xs font-bold text-gray-500 uppercase w-11">VAT%</th>
                            <th className="py-2 px-2 text-right text-xs font-bold text-gray-500 uppercase min-w-[85px]">Tiền thuế</th>
                            <th className="py-2 px-2 text-right text-xs font-bold text-gray-500 uppercase min-w-[100px]">Tổng tiền</th>
                            <th className="py-2 px-1 text-center text-xs font-bold text-gray-500 uppercase w-28">Serial/Lot</th>
                          </>
                        )}
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {lines.map((l, i) => {
                        const lineTotal = Number(l.quantity || 0) * Number(l.unitPrice || 0);
                        const vatAmount = lineTotal * (Number(l.vatRate ?? 8) / 100);
                        const totalLine = lineTotal + vatAmount;

                        const noProduct = !l.productId;
                        const invalidQty = !l.quantity || Number(l.quantity) <= 0 || isNaN(Number(l.quantity));
                        const isRowError = hasAttemptedSubmit && (noProduct || invalidQty);

                        return (
                        <tr key={i} className={`border-l-4 transition-colors ${
                          isRowError
                            ? 'bg-red-50/80 hover:bg-red-100/60 border-l-red-500'
                            : 'hover:bg-gray-50/70 border-l-transparent'
                        }`}>
                          <td className="py-1 px-1 text-center text-xs">
                            {isRowError ? (
                              <span
                                className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white font-bold text-[10px] shadow-sm animate-pulse mx-auto"
                                title={`Dòng #${i + 1}: ${noProduct ? 'Chưa chọn hàng hóa' : ''}${noProduct && invalidQty ? '; ' : ''}${invalidQty ? 'Số lượng phải > 0' : ''}`}
                              >
                                !
                              </span>
                            ) : (
                              <span className="text-gray-400">{i + 1}</span>
                            )}
                          </td>
                          <td className="py-1 px-1 w-20 text-center">
                            <SearchCombo
                              items={products}
                              selectedId={l.productId}
                              display={(p) => p.importCode || ''}
                              match={(p, q) => `${p.importCode || ''} ${p.name || ''}`.toLowerCase().includes(q)}
                              onPick={(p) => pickProduct(i, p)}
                              placeholder="Mã..."
                              inputClassName={`w-20 px-1 py-1 border rounded-none text-xs outline-none focus:border-emerald-500 text-center mx-auto transition-colors ${
                                hasAttemptedSubmit && noProduct
                                  ? 'border-red-400 bg-red-50/70 text-red-900 placeholder:text-red-400 ring-1 ring-red-400/40'
                                  : 'border-gray-200 bg-white text-gray-900'
                              }`}
                              placement="top"
                              minWidth={340}
                              renderItem={(p) => (
                                <div className="flex flex-col gap-0.5 text-left">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {p.importCode ? (
                                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
                                        {p.importCode}
                                      </span>
                                    ) : (
                                      <span className="text-gray-400 text-[11px]">—</span>
                                    )}
                                    <span className="font-semibold text-gray-900 text-xs">{p.name}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                                    {p.category && <span>{p.category}</span>}
                                    {p.unit && <span>· ĐVT: <b className="text-gray-700">{p.unit}</b></span>}
                                    {p.defaultPrice ? <span>· Giá: {Number(p.defaultPrice).toLocaleString('vi-VN')} ₫</span> : null}
                                  </div>
                                </div>
                              )}
                            />
                          </td>
                          <td className="py-1 px-2 min-w-[180px]">
                            <SearchCombo
                              items={products}
                              selectedId={l.productId}
                              display={(p) => p.name}
                              match={(p, q) => `${p.name} ${p.importCode || ''} ${p.unit || ''}`.toLowerCase().includes(q)}
                              onPick={(p) => pickProduct(i, p)}
                              placeholder={hasAttemptedSubmit && noProduct ? '⚠️ Bắt buộc chọn hàng (*)...' : 'Gõ tên/mã hàng...'}
                              inputClassName={`w-full px-2 py-1 border rounded-none text-xs outline-none transition-colors ${
                                hasAttemptedSubmit && noProduct
                                  ? 'border-red-400 bg-red-50/70 text-red-900 placeholder:text-red-400 ring-1 ring-red-400/40'
                                  : 'border-gray-200 bg-white text-gray-900'
                              }`}
                              placement="top"
                              minWidth={360}
                              renderItem={(p) => (
                                <div className="flex flex-col gap-0.5 text-left">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {p.importCode && (
                                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
                                        {p.importCode}
                                      </span>
                                    )}
                                    <span className="font-semibold text-gray-900 text-xs">{p.name}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                                    {p.category && <span>{p.category}</span>}
                                    {p.unit && <span>· ĐVT: <b className="text-gray-700">{p.unit}</b></span>}
                                    {p.defaultPrice ? <span>· Giá: {Number(p.defaultPrice).toLocaleString('vi-VN')} ₫</span> : null}
                                  </div>
                                </div>
                              )}
                            />
                          </td>
                          <td className="py-1 px-1 text-center text-gray-600 text-xs w-16">{whCode}</td>
                          <td className="py-1 px-1 text-center w-32">
                            <select aria-label="Vị trí hàng" value={l.locationId || ''} onChange={e => setLine(i, { locationId: e.target.value })} className="w-32 px-1.5 py-1 border border-gray-200 rounded-none text-xs outline-none bg-white truncate text-center mx-auto">
                              <option value="">Chưa phân vị trí</option>
                              {locations.filter(location => kind !== 'ISSUE' || location.purpose === 'SALEABLE').map(location => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}
                            </select>
                          </td>
                          <td className="py-1 px-0.5 text-center hidden md:table-cell w-12">
                            <UnitSuggestInput
                              value={l.unit !== undefined ? (l.unit || '') : (products.find((p) => p.id === l.productId)?.unit || '')}
                              onChange={(val) => setLine(i, { unit: val })}
                              availableUnits={availableUnits}
                              placeholder="ĐVT"
                              className="w-11 px-0.5 py-1 border border-gray-200 rounded-none bg-white text-xs outline-none text-center mx-auto focus:border-emerald-500"
                            />
                          </td>
                          <td className="py-1 px-0.5 text-center w-12">
                            <input type="number" min={0.000001} step="any" value={l.quantity}
                              onChange={(e) => setLine(i, { quantity: Number(e.target.value) })}
                              className={`w-11 px-0.5 py-1 border rounded-none text-xs outline-none text-center tabular-nums mx-auto [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors ${
                                hasAttemptedSubmit && invalidQty
                                  ? 'border-red-400 bg-red-50/70 text-red-900 font-bold ring-1 ring-red-400/40 focus:border-red-500'
                                  : 'border-gray-200 bg-white text-gray-900'
                              }`}
                              title={hasAttemptedSubmit && invalidQty ? 'Số lượng bắt buộc > 0' : 'Số lượng'} />
                          </td>
                          {moneyKind && (
                            <>
                              <td className="py-1 px-1 text-center w-28">
                                <FormattedNumberInput
                                  value={l.unitPrice ?? 0}
                                  onChange={(val) => setLine(i, { unitPrice: val })}
                                  className="w-28 px-1.5 py-1 border border-gray-200 rounded-none text-xs outline-none text-right tabular-nums mx-auto focus:border-emerald-500"
                                  title="Đơn giá"
                                  placeholder="0"
                                />
                              </td>
                              <td className="py-1 px-2 text-right font-medium text-gray-800 tabular-nums text-xs min-w-[90px]">{lineTotal.toLocaleString('vi-VN')}</td>
                              <td className="py-1 px-0.5 text-center w-11">
                                <input type="number" min={0} max={100} step="any" value={l.vatRate ?? 8}
                                  onChange={(e) => setLine(i, { vatRate: Number(e.target.value) })}
                                  className="w-10 px-0.5 py-1 border border-gray-200 rounded-none text-xs outline-none text-center tabular-nums mx-auto [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" title="% VAT" />
                              </td>
                              <td className="py-1 px-2 text-right text-gray-600 tabular-nums text-xs min-w-[85px]">{vatAmount.toLocaleString('vi-VN')}</td>
                              <td className="py-1 px-2 text-right font-bold text-emerald-700 tabular-nums text-xs min-w-[100px]">{totalLine.toLocaleString('vi-VN')}</td>
                              <td className="py-1 px-1 text-center w-28">
                                <input value={l.serialLot || ''} onChange={(e) => setLine(i, { serialLot: e.target.value })}
                                  className="w-28 px-1.5 py-1 border border-gray-200 rounded-none text-xs outline-none text-center mx-auto" title="Serial/Lot" />
                              </td>
                            </>
                          )}
                          <td className="py-1.5 px-2 text-center">
                            <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                              className="p-1.5 text-gray-300 hover:text-red-500 transition-colors" title="Xóa dòng">
                              <X size={15} />
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 font-bold text-sm">
                        <td colSpan={99} className="py-2 px-3 text-right text-gray-700">
                          Tổng SL: {lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0).toLocaleString('vi-VN')}
                          {moneyKind && (<> · Tiền hàng: {totals.pre.toLocaleString('vi-VN')} · VAT: {totals.vat.toLocaleString('vi-VN')} · Tổng: {(totals.pre + totals.vat).toLocaleString('vi-VN')}</>)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Chi phí mua hàng (vận chuyển, hải quan, bốc xếp...)</label>
                    <FormattedNumberInput
                      value={Number(shippingFee) || 0}
                      onChange={(v) => setShippingFee(v > 0 ? String(v) : '')}
                      className="w-full sm:w-64 px-3 py-2 border border-gray-200 rounded-none text-sm outline-none text-right tabular-nums focus:border-emerald-500"
                      title="Chi phí mua hàng"
                      placeholder="0"
                    />
                  </div>
                  <p className="text-xs text-gray-400">Phân bổ chi phí vào giá vốn từng dòng sẽ thực hiện ở bước sau; hiện tại chi phí chỉ lưu ở đầu phiếu.</p>
                </div>
              )}
              </div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => setLines((ls) => [...ls, { productId: '', quantity: 1, unitPrice: 0, vatRate: 8, serialLot: '' }])}
                  className="px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg">+ Thêm dòng</button>
                <button type="button" onClick={() => setLines([])}
                  className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg">Xóa hết dòng</button>
                <button type="button" onClick={() => notesRef.current?.focus()}
                  className="px-3 py-1.5 text-xs font-bold text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg">+ Thêm ghi chú</button>
                <span className="ml-auto text-xs text-gray-400">Tổng số: {lines.length} dòng</span>
              </div>
              {hasAttemptedSubmit && lines.some((l) => !l.productId || !l.quantity || Number(l.quantity) <= 0) && (
                <div className="mt-2.5 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2.5 animate-in fade-in">
                  <AlertCircle size={16} className="flex-shrink-0 text-red-500" />
                  <span>
                    Có <b>{lines.filter((l) => !l.productId || !l.quantity || Number(l.quantity) <= 0).length} dòng</b> chưa chọn hàng hóa hoặc chưa nhập số lượng hợp lệ (được tô nền đỏ và đánh dấu biểu tượng <b>!</b>). Vui lòng hoàn tất thông tin để lưu phiếu.
                  </span>
                </div>
              )}
              {lines.some((l) => l.productId) && (
                <p className="text-xs text-gray-400 mt-1">Đang chọn: {lines.filter((l) => l.productId).map((l) => productName(l.productId)).join(', ')}</p>
              )}
            {moneyKind && (
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Hạch toán (áp dụng cho mọi dòng)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-x-3 gap-y-2 border border-gray-100 rounded-2xl px-4 py-3 bg-white">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">TK Kho / Nợ</label>
                    <input value={tkKho} onChange={(e) => setTkKho(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none text-right font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">TK Công nợ / Có</label>
                    <input value={tkCongNo} onChange={(e) => setTkCongNo(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none text-right font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Khoản mục CP</label>
                    <input value={costItem} onChange={(e) => setCostItem(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Đối tượng THCP</label>
                    <input value={costObject} onChange={(e) => setCostObject(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Công trình / Dự án</label>
                    <input value={project} onChange={(e) => setProject(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none" />
                  </div>
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Đính kèm <span className="font-medium normal-case text-gray-400">(tối đa 5MB/file)</span></label>
              <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files); }}
                className={`border-2 border-dashed rounded-2xl px-4 py-6 text-center text-sm transition-colors ${dragOver ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ''; }} />
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="text-emerald-700 font-bold hover:underline disabled:opacity-60">
                  {uploading ? 'Đang tải lên...' : 'Chọn tệp hoặc kéo thả vào đây'}
                </button>
              </div>
              {attachments.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {attachments.map((a, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm bg-white border border-gray-100 rounded-xl px-3 py-1.5">
                      <a href={a.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-emerald-700 hover:underline">{a.name}</a>
                      <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                        className="p-1 text-gray-300 hover:text-red-500" title="Gỡ file">
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {moneyKind && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Hóa đơn / Tham chiếu</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Số hóa đơn</label>
                      <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="439"
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Ngày hóa đơn</label>
                      <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Mã tra cứu HĐĐT</label>
                      <input value={invoiceLookupCode} onChange={(e) => setInvoiceLookupCode(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">URL HĐĐT</label>
                      <input value={invoiceLookupUrl} onChange={(e) => setInvoiceLookupUrl(e.target.value)} placeholder="https://..."
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none" />
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Tổng tiền</p>
                  <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl px-4 py-3 text-sm space-y-1">
                    <div className="flex justify-between text-gray-600"><span>Tiền hàng</span><span className="font-bold font-mono">{totals.pre.toLocaleString('vi-VN')}</span></div>
                    <div className="flex justify-between text-gray-600"><span>Chiết khấu</span><span className="font-bold font-mono">0</span></div>
                    <div className="flex justify-between text-gray-600"><span>Thuế GTGT</span><span className="font-bold font-mono">{totals.vat.toLocaleString('vi-VN')}</span></div>
                    <div className="flex justify-between text-gray-900 font-extrabold text-base border-t border-emerald-200 pt-1"><span>Tổng thanh toán</span><span className="font-mono">{(totals.pre + totals.vat).toLocaleString('vi-VN')}</span></div>
                    <div className="flex justify-between text-gray-600"><span>Giá trị nhập kho</span><span className="font-bold font-mono">{totals.pre.toLocaleString('vi-VN')}</span></div>
                  </div>
                </div>
              </div>
            )}
            {!moneyKind && (
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Ghi chú</label>
                <textarea ref={notesRef} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none resize-none" />
              </div>
            )}
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50 flex-shrink-0">
            <button type="button" onClick={onClose} className="w-full sm:w-auto px-4 py-2.5 sm:py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-xl text-center">Hủy</button>
            <button type="submit" disabled={saving}
              className="w-full sm:w-auto px-5 py-2.5 sm:py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? <><RefreshCw size={14} className="animate-spin" />Đang tạo...</> : 'Tạo phiếu nháp'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
