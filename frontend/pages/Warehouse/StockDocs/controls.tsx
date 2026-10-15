// Input dùng chung cho chứng từ kho (tách từ StockDocsPage.tsx).
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


export function SearchCombo<T extends { id: string }>({
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

export function FormattedNumberInput({
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

export function UnitSuggestInput({
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

export function PartnerSuggestInput({
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

export function TextSuggestInput({
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

