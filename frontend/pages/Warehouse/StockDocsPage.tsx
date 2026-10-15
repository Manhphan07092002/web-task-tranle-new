import { getStockLocations, type StockLocation } from '../../services/locationService';
import { ReceiveTransferButton } from './ReceiveTransferButton';
import { apiFetch } from '../../services/api';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { PlusCircle, RefreshCw, AlertCircle, X, CheckCircle2, Truck, PackageCheck, ChevronDown, Eye, Ban, FileText, Calendar, Building2, User } from 'lucide-react';
import { Card } from '../../components/UI';
import {
  getStockDocuments, getWarehouses, createReceipt, createIssue, createTransfer,
  advanceDocument, advanceTransfer, getPartnerSuggestions, getStockDocument, cancelStockDocument,
  type StockDocument, type StockDocLine, type Warehouse,
  type PartnerSuggestion, type PartnerSuggestionsData, type StockDocDetailLine,
} from '../../services/stockService';
import { getProducts, type Product } from '../../services/productService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import { useData } from '../../contexts/DataContext';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

type Kind = 'RECEIPT' | 'ISSUE' | 'TRANSFER';

const KIND_META: Record<Kind, { title: string; code: string; actionDone: string }> = {
  RECEIPT: { title: 'Nhập kho', code: 'PNK', actionDone: 'Hoàn tất nhận hàng' },
  ISSUE: { title: 'Xuất kho', code: 'PXK', actionDone: 'Hoàn tất xuất hàng' },
  TRANSFER: { title: 'Điều chuyển', code: 'DCK', actionDone: 'Xác nhận' },
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Nháp', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  IN_TRANSIT: { label: 'Đang vận chuyển', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  DONE: { label: 'Hoàn tất', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCELLED: { label: 'Đã hủy', cls: 'bg-red-50 text-red-600 border-red-200' },
};

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
                          {d.status === 'DRAFT' && kind !== 'TRANSFER' && (
                            <button disabled={actingId === d.id} onClick={() => act(d.id, () => advanceDocument(kind === 'RECEIPT' ? 'receipts' : 'issues', d.id, 'complete'), 'Hoàn tất thất bại')}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-60 transition-colors shadow-sm">
                              {actingId === d.id ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}{meta.actionDone}
                            </button>
                          )}
                          {d.status === 'DRAFT' && kind === 'TRANSFER' && (
                            <button disabled={actingId === d.id} onClick={() => act(d.id, () => advanceTransfer(d.id, 'ship'), 'Gửi hàng thất bại')}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold disabled:opacity-60 transition-colors shadow-sm">
                              {actingId === d.id ? <RefreshCw size={12} className="animate-spin" /> : <Truck size={12} />}Xác nhận gửi
                            </button>
                          )}
                          {d.status === 'IN_TRANSIT' && kind === 'TRANSFER' && (
                            <ReceiveTransferButton id={d.id} warehouseId={d.destWarehouseId!} onDone={fetchAll} />
                          )}
                          {d.status === 'DRAFT' && (
                            <button
                              disabled={actingId === d.id}
                              onClick={() => {
                                if (window.confirm('Bạn có chắc muốn hủy phiếu nháp này?')) {
                                  act(d.id, () => cancelStockDocument(d.id), 'Hủy phiếu thất bại');
                                }
                              }}
                              className="p-1.5 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Hủy phiếu"
                            >
                              <Ban size={15} />
                            </button>
                          )}
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

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}

function SearchCombo<T extends { id: string }>({
  items,
  selectedId,
  display,
  match,
  onPick,
  placeholder,
  inputClassName,
  placement = 'auto',
  minWidth = 260,
  renderItem,
  showArrow = false,
}: {
  items: T[];
  selectedId: string;
  display: (t: T) => string;
  match: (t: T, q: string) => boolean;
  onPick: (t: T | null) => void;
  placeholder?: string;
  inputClassName?: string;
  placement?: 'top' | 'bottom' | 'auto';
  minWidth?: number;
  renderItem?: (t: T, isHighlight: boolean) => React.ReactNode;
  showArrow?: boolean;
}) {
  const selected = items.find((t) => t.id === selectedId) || null;
  const [text, setText] = useState(selected ? display(selected) : '');
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const [coords, setCoords] = useState<{ top: number; bottom: number; left: number; width: number; height: number }>({
    top: 0,
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
  });

  useEffect(() => {
    setText(selected ? display(selected) : '');
  }, [selectedId]);

  const updateCoords = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setCoords({
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        width: r.width,
        height: r.height,
      });
    }
  };

  useEffect(() => {
    if (!open) return;
    updateCoords();

    const onScroll = () => updateCoords();
    const onResize = () => updateCoords();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
      setShowAll(false);
      if (text.trim() === '') commit(null);
      else setText(selected ? display(selected) : text);
    };
    document.addEventListener('mousedown', onDocMouseDown);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onDocMouseDown);
    };
  }, [open, text, selected]);

  const q = text.trim().toLowerCase();
  const isDisplayMatch = selected ? text.trim() === display(selected).trim() : false;
  // Khi showAll bật, hoặc text khớp với giá trị đang chọn, hoặc text rỗng -> hiển thị toàn bộ danh sách
  const isFilterActive = Boolean(q) && !isDisplayMatch && !showAll;
  const suggestions = isFilterActive
    ? items.filter((t) => match(t, q))
    : items;

  const commit = (t: T | null) => {
    onPick(t);
    setOpen(false);
    setShowAll(false);
  };

  const handleOpen = (forceAll = false) => {
    updateCoords();
    if (forceAll) setShowAll(true);
    setOpen(true);
    if (selected) {
      const idx = items.findIndex((t) => t.id === selected.id);
      setHighlight(idx >= 0 ? idx : 0);
    } else {
      setHighlight(0);
    }
  };

  const toggleDropdown = () => {
    if (open) {
      setOpen(false);
      setShowAll(false);
    } else {
      handleOpen(true);
      inputRef.current?.focus();
    }
  };

  useEffect(() => {
    if (open && dropdownRef.current && suggestions.length > 0) {
      const active = dropdownRef.current.children[highlight] as HTMLElement | undefined;
      active?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [highlight, open, suggestions.length]);

  const currentCoords = coords.width > 0 ? coords : (inputRef.current?.getBoundingClientRect() || coords);
  const spaceAbove = currentCoords.top;
  const spaceBelow = typeof window !== 'undefined' ? window.innerHeight - currentCoords.bottom : 500;
  const isPopUp = placement === 'top'
    ? spaceAbove >= 130 || spaceBelow < 130
    : (placement === 'auto' ? (spaceBelow < 220 && spaceAbove >= 140) : false);

  const dropdownWidth = Math.max(currentCoords.width, minWidth);
  const windowW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const leftPos = Math.max(8, Math.min(currentCoords.left, windowW - dropdownWidth - 12));

  const dropdownStyle: React.CSSProperties = isPopUp
    ? {
        position: 'fixed',
        left: `${leftPos}px`,
        bottom: `${Math.max(8, (typeof window !== 'undefined' ? window.innerHeight : 800) - currentCoords.top + 4)}px`,
        width: `${dropdownWidth}px`,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: `${Math.min(280, Math.max(120, spaceAbove - 16))}px`,
        zIndex: 99999,
      }
    : {
        position: 'fixed',
        left: `${leftPos}px`,
        top: `${currentCoords.bottom + 4}px`,
        width: `${dropdownWidth}px`,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: `${Math.min(280, Math.max(120, spaceBelow - 16))}px`,
        zIndex: 99999,
      };

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        ref={inputRef}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setShowAll(false);
          setText(e.target.value);
          handleOpen(false);
        }}
        onFocus={() => handleOpen(false)}
        onClick={() => {
          if (!open) handleOpen(true);
        }}
        onBlur={(e) => {
          if (dropdownRef.current?.contains(e.relatedTarget as Node)) return;
          if (containerRef.current?.contains(e.relatedTarget as Node)) return;
          setTimeout(() => {
            setOpen(false);
            setShowAll(false);
            if (text.trim() === '') commit(null);
            else setText(selected ? display(selected) : text);
          }, 150);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            handleOpen(true);
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            if (open && suggestions.length > 0) {
              e.preventDefault();
              commit(suggestions[Math.min(highlight, suggestions.length - 1)]);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
            setShowAll(false);
          }
        }}
        className={`${inputClassName || ''} ${showArrow ? 'pr-9' : ''}`}
      />
      {showArrow && (
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleDropdown();
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700 transition-colors focus:outline-none flex items-center justify-center rounded-lg hover:bg-gray-100/70"
          title="Sổ toàn bộ danh sách"
        >
          <ChevronDown
            size={16}
            className={`transition-transform duration-200 ${open ? 'rotate-180 text-emerald-600' : 'text-gray-500'}`}
          />
        </button>
      )}
      {open && typeof document !== 'undefined' && createPortal(
        <ul
          ref={dropdownRef}
          style={dropdownStyle}
          className="overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-2xl text-sm divide-y divide-gray-100 animate-in fade-in zoom-in-95 duration-100"
        >
          {suggestions.length === 0 ? (
            <li className="px-3.5 py-3 text-xs text-gray-400 text-center italic">Không tìm thấy kết quả phù hợp</li>
          ) : (
            suggestions.map((t, idx) => {
              const isSelected = selected ? t.id === selected.id : false;
              const isHighlighted = idx === highlight;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(t);
                    }}
                    className={`w-full text-left px-3.5 py-2.5 transition-colors flex items-center justify-between gap-2 ${
                      isHighlighted
                        ? 'bg-emerald-50 text-emerald-900 font-medium'
                        : isSelected
                        ? 'bg-emerald-50/40 text-emerald-800 font-semibold'
                        : 'hover:bg-gray-50 text-gray-800'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      {renderItem ? (
                        renderItem(t, isHighlighted)
                      ) : (
                        <div className="font-medium text-gray-800 truncate">{display(t)}</div>
                      )}
                    </div>
                    {isSelected && (
                      <CheckCircle2 size={15} className="text-emerald-600 shrink-0 ml-1.5" />
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>,
        document.body
      )}
    </div>
  );
}

function FormattedNumberInput({
  value,
  onChange,
  className,
  title,
  placeholder = '0',
}: {
  value: number;
  onChange: (val: number) => void;
  className?: string;
  title?: string;
  placeholder?: string;
}) {
  const format = (v: number | string | undefined | null) => {
    if (v === undefined || v === null || v === '') return '';
    const n = Number(String(v).replace(/,/g, ''));
    if (isNaN(n)) return '';
    const str = String(n);
    const parts = str.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  };

  const [text, setText] = useState<string>(() => (value !== undefined && value !== null ? format(value) : '0'));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const cleanNum = Number(text.replace(/,/g, '')) || 0;
    if (cleanNum !== (value ?? 0)) {
      setText(format(value ?? 0));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (!raw.trim()) {
      setText('');
      onChange(0);
      return;
    }

    const cursorPos = e.target.selectionStart || 0;
    const rawBeforeCursor = raw.slice(0, cursorPos);
    const meaningfulBeforeCursor = (rawBeforeCursor.match(/[\d.]/g) || []).length;

    const clean = raw.replace(/[^\d.]/g, '');
    const parts = clean.split('.');
    const integerPart = (parts[0] || '0').replace(/^0+(?=\d)/, '');
    const decimalPart = parts.length > 1 ? '.' + parts.slice(1).join('') : '';

    const formattedInt = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const formatted = formattedInt + decimalPart;

    const numValue = Number(integerPart + decimalPart) || 0;

    setText(formatted);
    onChange(numValue);

    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      let newCursor = 0;
      let countedMeaningful = 0;
      if (meaningfulBeforeCursor === 0) {
        newCursor = 0;
      } else {
        for (let i = 0; i < formatted.length; i++) {
          if (/[\d.]/.test(formatted[i])) {
            countedMeaningful++;
          }
          if (countedMeaningful >= meaningfulBeforeCursor) {
            newCursor = i + 1;
            break;
          }
        }
        if (newCursor === 0) newCursor = formatted.length;
      }
      inputRef.current.setSelectionRange(newCursor, newCursor);
    });
  };

  const handleBlur = () => {
    if (text === '' || isNaN(Number(text.replace(/,/g, '')))) {
      setText('0');
      onChange(0);
    } else {
      setText(format(value ?? 0));
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (e.target.value === '0') {
      e.target.select();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      className={className}
      title={title}
      placeholder={placeholder}
    />
  );
}

function UnitSuggestInput({
  value,
  onChange,
  availableUnits,
  className,
  placeholder = 'ĐVT',
}: {
  value: string;
  onChange: (val: string) => void;
  availableUnits: string[];
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const [coords, setCoords] = useState<{ top: number; bottom: number; left: number; width: number }>({
    top: 0,
    bottom: 0,
    left: 0,
    width: 0,
  });

  const updateCoords = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setCoords({
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        width: r.width,
      });
    }
  };

  useEffect(() => {
    if (!open) return;
    updateCoords();

    const onScroll = () => updateCoords();
    const onResize = () => updateCoords();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (inputRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onDocMouseDown);
    };
  }, [open]);

  const q = value.trim().toLowerCase();
  const filtered = q
    ? availableUnits.filter((u) => u.toLowerCase().includes(q))
    : availableUnits;
  const displayUnits = filtered.length > 0 ? filtered : availableUnits;

  const currentCoords = coords.width > 0 ? coords : (inputRef.current?.getBoundingClientRect() || coords);
  const spaceAbove = currentCoords.top;
  const dropdownWidth = Math.max(currentCoords.width, 100);
  const windowW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const leftPos = Math.max(8, Math.min(currentCoords.left, windowW - dropdownWidth - 12));

  const isPopUp = spaceAbove >= 130;
  const dropdownStyle: React.CSSProperties = isPopUp
    ? {
        position: 'fixed',
        left: `${leftPos}px`,
        bottom: `${Math.max(8, (typeof window !== 'undefined' ? window.innerHeight : 800) - currentCoords.top + 4)}px`,
        width: `${dropdownWidth}px`,
        maxHeight: '180px',
        zIndex: 99999,
      }
    : {
        position: 'fixed',
        left: `${leftPos}px`,
        top: `${currentCoords.bottom + 4}px`,
        width: `${dropdownWidth}px`,
        maxHeight: '180px',
        zIndex: 99999,
      };

  const handlePick = (u: string) => {
    onChange(u);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => {
          updateCoords();
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={(e) => {
          if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              updateCoords();
              setOpen(true);
            }
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, Math.max(displayUnits.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            if (displayUnits.length > 0) {
              e.preventDefault();
              handlePick(displayUnits[Math.min(highlight, displayUnits.length - 1)]);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className={className}
      />
      {open && displayUnits.length > 0 && typeof document !== 'undefined' && createPortal(
        <ul
          ref={dropdownRef}
          style={dropdownStyle}
          className="overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-xl text-xs divide-y divide-gray-100 animate-in fade-in duration-100"
        >
          {displayUnits.map((u, idx) => (
            <li key={u}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handlePick(u);
                }}
                className={`w-full text-center py-1.5 px-2 transition-colors font-medium ${
                  idx === highlight ? 'bg-emerald-50 text-emerald-800' : 'hover:bg-gray-50 text-gray-700'
                }`}
              >
                {u}
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

function PartnerSuggestInput({
  mode,
  value,
  onChange,
  onSelectPartner,
  partners,
  placeholder,
  className,
}: {
  mode: 'code' | 'name';
  value: string;
  onChange: (val: string) => void;
  onSelectPartner: (p: PartnerSuggestion) => void;
  partners: PartnerSuggestion[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const [coords, setCoords] = useState<{ top: number; bottom: number; left: number; width: number }>({
    top: 0,
    bottom: 0,
    left: 0,
    width: 0,
  });

  const updateCoords = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setCoords({
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        width: r.width,
      });
    }
  };

  useEffect(() => {
    if (!open) return;
    updateCoords();

    const onScroll = () => updateCoords();
    const onResize = () => updateCoords();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onDocMouseDown);
    };
  }, [open]);

  const q = value.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!q) return partners.slice(0, 30);
    return partners
      .filter((p) => {
        const c = (p.code || '').toLowerCase();
        const n = (p.name || '').toLowerCase();
        return c.includes(q) || n.includes(q);
      })
      .slice(0, 30);
  }, [partners, q]);

  const currentCoords = coords.width > 0 ? coords : (inputRef.current?.getBoundingClientRect() || coords);
  const spaceAbove = currentCoords.top;
  const spaceBelow = typeof window !== 'undefined' ? window.innerHeight - currentCoords.bottom : 500;
  const isPopUp = spaceBelow < 220 && spaceAbove >= 140;

  const dropdownWidth = Math.max(currentCoords.width, 320);
  const windowW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const leftPos = Math.max(8, Math.min(currentCoords.left, windowW - dropdownWidth - 12));

  const dropdownStyle: React.CSSProperties = isPopUp
    ? {
        position: 'fixed',
        left: `${leftPos}px`,
        bottom: `${Math.max(8, (typeof window !== 'undefined' ? window.innerHeight : 800) - currentCoords.top + 4)}px`,
        width: `${dropdownWidth}px`,
        maxHeight: `${Math.min(260, Math.max(120, spaceAbove - 16))}px`,
        zIndex: 99999,
      }
    : {
        position: 'fixed',
        left: `${leftPos}px`,
        top: `${currentCoords.bottom + 4}px`,
        width: `${dropdownWidth}px`,
        maxHeight: `${Math.min(260, Math.max(120, spaceBelow - 16))}px`,
        zIndex: 99999,
      };

  const handlePick = (p: PartnerSuggestion) => {
    onSelectPartner(p);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => {
          updateCoords();
          setOpen(true);
          setHighlight(0);
        }}
        onClick={() => {
          if (!open) {
            updateCoords();
            setOpen(true);
          }
        }}
        onKeyDown={(e) => {
          if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              updateCoords();
              setOpen(true);
            }
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, Math.max(suggestions.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            if (suggestions.length > 0 && highlight < suggestions.length) {
              e.preventDefault();
              handlePick(suggestions[highlight]);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className={className}
      />
      {open && suggestions.length > 0 && typeof document !== 'undefined' && createPortal(
        <ul
          ref={dropdownRef}
          style={dropdownStyle}
          className="overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-2xl text-xs divide-y divide-gray-100 animate-in fade-in zoom-in-95 duration-100"
        >
          {suggestions.map((p, idx) => (
            <li key={p.id || `${p.code}-${p.name}-${idx}`}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handlePick(p);
                }}
                className={`w-full text-left px-3 py-2.5 transition-colors flex flex-col gap-0.5 ${
                  idx === highlight ? 'bg-emerald-50 text-emerald-950' : 'hover:bg-gray-50 text-gray-800'
                }`}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  {p.code ? (
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-200">
                      {p.code}
                    </span>
                  ) : null}
                  <span className="font-semibold text-gray-900 text-xs">{p.name || '—'}</span>
                </div>
                {p.address ? (
                  <div className="text-[11px] text-gray-500 truncate flex items-center gap-1">
                    <span className="text-gray-400">📍</span> {p.address}
                  </div>
                ) : null}
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

function TextSuggestInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
  as = 'input',
  rows = 2,
  textareaRef,
}: {
  value: string;
  onChange: (val: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
  as?: 'input' | 'textarea';
  rows?: number;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const [coords, setCoords] = useState<{ top: number; bottom: number; left: number; width: number }>({
    top: 0,
    bottom: 0,
    left: 0,
    width: 0,
  });

  const updateCoords = () => {
    if (elementRef.current) {
      const r = elementRef.current.getBoundingClientRect();
      setCoords({
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        width: r.width,
      });
    }
  };

  useEffect(() => {
    if (!open) return;
    updateCoords();

    const onScroll = () => updateCoords();
    const onResize = () => updateCoords();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onDocMouseDown);
    };
  }, [open]);

  const q = value.trim().toLowerCase();
  const matched = useMemo(() => {
    const list = suggestions.filter((s) => s && s.trim().length > 0);
    if (!q) return list.slice(0, 15);
    return list.filter((s) => s.toLowerCase().includes(q)).slice(0, 15);
  }, [suggestions, q]);

  const currentCoords = coords.width > 0 ? coords : (elementRef.current?.getBoundingClientRect() || coords);
  const spaceAbove = currentCoords.top;
  const spaceBelow = typeof window !== 'undefined' ? window.innerHeight - currentCoords.bottom : 500;
  const isPopUp = spaceBelow < 200 && spaceAbove >= 130;

  const dropdownWidth = Math.max(currentCoords.width, 260);
  const windowW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const leftPos = Math.max(8, Math.min(currentCoords.left, windowW - dropdownWidth - 12));

  const dropdownStyle: React.CSSProperties = isPopUp
    ? {
        position: 'fixed',
        left: `${leftPos}px`,
        bottom: `${Math.max(8, (typeof window !== 'undefined' ? window.innerHeight : 800) - currentCoords.top + 4)}px`,
        width: `${dropdownWidth}px`,
        maxHeight: `${Math.min(240, Math.max(100, spaceAbove - 16))}px`,
        zIndex: 99999,
      }
    : {
        position: 'fixed',
        left: `${leftPos}px`,
        top: `${currentCoords.bottom + 4}px`,
        width: `${dropdownWidth}px`,
        maxHeight: `${Math.min(240, Math.max(100, spaceBelow - 16))}px`,
        zIndex: 99999,
      };

  const handlePick = (item: string) => {
    onChange(item);
    setOpen(false);
  };

  const commonProps = {
    value,
    placeholder,
    className,
    onChange: (e: any) => {
      onChange(e.target.value);
      setOpen(true);
      setHighlight(0);
    },
    onFocus: () => {
      updateCoords();
      setOpen(true);
      setHighlight(0);
    },
    onClick: () => {
      if (!open) {
        updateCoords();
        setOpen(true);
      }
    },
    onKeyDown: (e: any) => {
      if (!open) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          updateCoords();
          setOpen(true);
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, Math.max(matched.length - 1, 0)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        if (matched.length > 0 && highlight < matched.length) {
          e.preventDefault();
          handlePick(matched[highlight]);
        }
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    },
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {as === 'textarea' ? (
        <textarea
          ref={(node) => {
            elementRef.current = node;
            if (typeof textareaRef === 'function') textareaRef(node);
            else if (textareaRef && 'current' in textareaRef) (textareaRef as any).current = node;
          }}
          rows={rows}
          {...commonProps}
        />
      ) : (
        <input
          ref={(node) => { elementRef.current = node; }}
          {...commonProps}
        />
      )}
      {open && matched.length > 0 && typeof document !== 'undefined' && createPortal(
        <ul
          ref={dropdownRef}
          style={dropdownStyle}
          className="overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-2xl text-xs divide-y divide-gray-100 animate-in fade-in duration-100"
        >
          {matched.map((s, idx) => (
            <li key={`${s}-${idx}`}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handlePick(s);
                }}
                className={`w-full text-left px-3 py-2 transition-colors ${
                  idx === highlight ? 'bg-emerald-50 text-emerald-900 font-medium' : 'hover:bg-gray-50 text-gray-700'
                }`}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

function DocDetailModal({
  docId,
  warehouses,
  kind,
  onClose,
  onUpdated,
}: {
  docId: string;
  warehouses: Warehouse[];
  kind: Kind;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [doc, setDoc] = useState<(StockDocument & { lines?: StockDocDetailLine[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

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
      alert(err?.message || 'Hủy phiếu thất bại');
      setActionLoading(false);
    }
  };

  const handleAdvanceDoc = async () => {
    if (!doc) return;
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
      alert(err?.message || 'Thao tác hoàn tất thất bại');
      setActionLoading(false);
    }
  };

  const st = doc ? STATUS_LABEL[doc.status] || STATUS_LABEL.DRAFT : STATUS_LABEL.DRAFT;
  const isTransfer = doc?.docType === 'TRANSFER' || kind === 'TRANSFER';
  const meta = KIND_META[kind];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/70">
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
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/70">
          <div>
            {doc?.status === 'DRAFT' && (
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
            {doc?.status === 'DRAFT' && (
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
    </div>
  );
}

function DocCreateModal({ kind, warehouses, products, users, onClose, onDone, onError }: {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${moneyKind ? 'max-w-[79.2rem]' : 'max-w-3xl'} flex flex-col`} style={{ maxHeight: '92vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-gray-900">Tạo phiếu {KIND_META[kind].title.toLowerCase()} ({KIND_META[kind].code})</h3>
            {moneyKind && <p className="text-sm font-extrabold text-emerald-700 font-mono mt-0.5">Tổng: {(totals.pre + totals.vat).toLocaleString('vi-VN')} ₫</p>}
          </div>
          <div className="flex items-center gap-2">
            {kind === 'RECEIPT' && (
              <select value={receiptSubType} onChange={(e) => setReceiptSubType(e.target.value)} title="Loại chứng từ"
                className="px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none max-w-[280px]">
                <option value="DOMESTIC_PURCHASE">Mua hàng trong nước nhập kho</option>
                <option value="IMPORT_PURCHASE">Mua hàng nhập khẩu nhập kho</option>
                <option value="OTHER_RECEIPT">Nhập kho khác</option>
              </select>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {err && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm"><AlertCircle size={14} />{err}</div>}
            <div className={`grid gap-4 ${kind === 'TRANSFER' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
              <div className="flex items-center gap-3">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap shrink-0 min-w-[70px]">
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
                <div className="flex items-center gap-3">
                  <label className="text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap shrink-0 min-w-[70px]">
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
                  <div className="grid grid-cols-3 gap-x-3 gap-y-2">
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
                    <div className="col-span-2">
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
                    <div className="col-span-3">
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
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Nhân viên mua hàng</label>
                      <select value={purchaserId} onChange={(e) => setPurchaserId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none">
                        <option value="">-- Chọn --</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                    <div className="col-span-3">
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
                    <div className="col-span-3">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Tham chiếu</label>
                      <div className="flex gap-2">
                        <select value={referenceType} onChange={(e) => setReferenceType(e.target.value)} title="Loại tham chiếu"
                          className="w-36 px-2 py-2 border border-gray-200 rounded-xl bg-white text-sm outline-none">
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
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
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
                    <div className="col-span-2">
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
                      className="w-64 px-3 py-2 border border-gray-200 rounded-none text-sm outline-none text-right tabular-nums focus:border-emerald-500"
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
                <div className="grid grid-cols-2 md:grid-cols-5 gap-x-3 gap-y-2 border border-gray-100 rounded-2xl px-4 py-3 bg-white">
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
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-xl">Hủy</button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm disabled:opacity-60 flex items-center gap-2">
              {saving ? <><RefreshCw size={14} className="animate-spin" />Đang tạo...</> : 'Tạo phiếu nháp'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
