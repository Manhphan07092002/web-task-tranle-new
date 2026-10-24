import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  itemsPerPage?: number;
  onItemsPerPageChange?: (itemsPerPage: number) => void;
  pageSizeOptions?: number[];
}

export function Pagination({ currentPage, totalPages, onPageChange, totalItems, itemsPerPage, onItemsPerPageChange, pageSizeOptions = [10, 20, 50, 100] }: PaginationProps) {
  if (totalPages <= 1 && !onItemsPerPageChange) return null;

  const pages = [];
  const maxVisiblePages = 5;

  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 px-1">
      <div className="flex items-center gap-3 text-sm text-gray-500 font-medium">
        {totalItems !== undefined && itemsPerPage !== undefined && totalItems > 0 && (
          <span>Hiển thị <b className="text-gray-700">{Math.min((currentPage - 1) * itemsPerPage + 1, totalItems)}</b>–<b className="text-gray-700">{Math.min(currentPage * itemsPerPage, totalItems)}</b> / <b className="text-gray-700">{totalItems}</b></span>
        )}
        {onItemsPerPageChange && itemsPerPage !== undefined && (
          <label className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-xs text-gray-400">Hiển thị</span>
            <select value={itemsPerPage} onChange={(e) => onItemsPerPageChange(Number(e.target.value))} className="px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 outline-none focus:border-emerald-400">
              {pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            <span className="text-xs text-gray-400">dòng</span>
          </label>
        )}
      </div>

      <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Trang đầu"
        >
          <ChevronsLeft size={18} />
        </button>
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Trang trước"
        >
          <ChevronLeft size={18} />
        </button>

        <div className="flex items-center px-2 space-x-1">
          {startPage > 1 && (
            <>
              <button onClick={() => onPageChange(1)} className="w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">1</button>
              {startPage > 2 && <span className="text-gray-400">...</span>}
            </>
          )}

          {pages.map(p => (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium transition-all ${
                currentPage === p
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {p}
            </button>
          ))}

          {endPage < totalPages && (
            <>
              {endPage < totalPages - 1 && <span className="text-gray-400">...</span>}
              <button onClick={() => onPageChange(totalPages)} className="w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">{totalPages}</button>
            </>
          )}
        </div>

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Trang tiếp"
        >
          <ChevronRight size={18} />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Trang cuối"
        >
          <ChevronsRight size={18} />
        </button>
      </div>
    </div>
  );
}
