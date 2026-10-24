import React, { useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer, X, SlidersHorizontal, ChevronDown, Check } from 'lucide-react';
import type { StockDocument, StockDocDetailLine, Warehouse } from '../../../services/stockService';
import { StockDocPrintTemplate, type PrintOptions } from './StockDocPrintTemplate';

interface StockDocPrintModalProps {
  doc: StockDocument & { lines?: StockDocDetailLine[] };
  warehouses?: Warehouse[];
  onClose: () => void;
}

export function StockDocPrintModal({ doc, warehouses = [], onClose }: StockDocPrintModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [showConfig, setShowConfig] = useState(false);

  const [options, setOptions] = useState<PrintOptions>({
    showPriceOnIssue: doc.docType === 'RECEIPT', // default show for receipt, opt-in for issue
    showSerialColumn: true, // mặc định hiển thị cột Số SN riêng giúp phân biệt sản phẩm
    accountDebit: doc.lines?.[0]?.accountDebit || (doc.docType === 'ISSUE' ? '632' : '1561'),
    accountCredit: doc.lines?.[0]?.accountCredit || (doc.docType === 'ISSUE' ? '1561' : '331'),
    creatorName: doc.createdByName || '',
    receiverName: doc.deliverer || doc.partnerName || '',
    warehouseKeeperName: '',
    chiefAccountantName: '',
    directorName: '',
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `${doc.code || 'Phieu_Kho'}_${doc.docType}`,
    pageStyle: `
      @page {
        size: A4 portrait;
        margin: 12mm 15mm 15mm 15mm;
      }
      *, html, body, div, table, tr, th, td, p, span, h1, h2, h3, h4 {
        font-family: "Times New Roman", Times, serif !important;
        color: black !important;
      }
      body {
        margin: 0;
        padding: 0;
      }
    `,
  });

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      {/* Top action bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3.5 flex items-center justify-between shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <Printer size={20} />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900 leading-tight">
              In chứng từ: {doc.code || 'Phiếu kho'}
            </h2>
            <p className="text-xs text-gray-500">
              {doc.docType === 'ISSUE' ? 'Mẫu 02 - VT (Phiếu giao hàng kiêm xuất kho)' : 'Mẫu 01 - VT (Phiếu nhập kho)'} • Khổ giấy A4 Dọc
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowConfig(!showConfig)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
              showConfig ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <SlidersHorizontal size={14} />
            Tùy chỉnh thông tin in
            <ChevronDown size={14} className={`transition-transform ${showConfig ? 'rotate-180' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => handlePrint()}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all"
          >
            <Printer size={16} />
            In phiếu ngay
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors ml-1"
            title="Đóng xem trước"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Optional Config Accordion Panel */}
      {showConfig && (
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-3.5 text-xs grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 shrink-0 animate-in slide-in-from-top-2 duration-150 shadow-inner">
          <div className="col-span-2 flex items-center gap-3 bg-white px-3 py-2 rounded-lg border border-gray-200">
            {doc.docType === 'ISSUE' && (
              <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={options.showPriceOnIssue}
                  onChange={(e) => setOptions({ ...options, showPriceOnIssue: e.target.checked })}
                  className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                />
                In kèm đơn giá & thành tiền
              </label>
            )}
            <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-700 select-none">
              <input
                type="checkbox"
                checked={options.showSerialColumn}
                onChange={(e) => setOptions({ ...options, showSerialColumn: e.target.checked })}
                className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
              />
              Hiển thị cột "Số SN" riêng
            </label>
          </div>

          <div>
            <label className="block text-gray-500 font-medium mb-1">Tài khoản Nợ</label>
            <input
              type="text"
              value={options.accountDebit || ''}
              onChange={(e) => setOptions({ ...options, accountDebit: e.target.value })}
              className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 font-mono text-gray-800 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-gray-500 font-medium mb-1">Tài khoản Có</label>
            <input
              type="text"
              value={options.accountCredit || ''}
              onChange={(e) => setOptions({ ...options, accountCredit: e.target.value })}
              className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 font-mono text-gray-800 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-gray-500 font-medium mb-1">Thủ kho</label>
            <input
              type="text"
              placeholder="Tên thủ kho ký..."
              value={options.warehouseKeeperName || ''}
              onChange={(e) => setOptions({ ...options, warehouseKeeperName: e.target.value })}
              className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-gray-500 font-medium mb-1">Kế toán trưởng</label>
            <input
              type="text"
              placeholder="Tên KTT..."
              value={options.chiefAccountantName || ''}
              onChange={(e) => setOptions({ ...options, chiefAccountantName: e.target.value })}
              className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {doc.docType === 'ISSUE' && (
            <div>
              <label className="block text-gray-500 font-medium mb-1">Giám đốc</label>
              <input
                type="text"
                placeholder="Tên Giám đốc..."
                value={options.directorName || ''}
                onChange={(e) => setOptions({ ...options, directorName: e.target.value })}
                className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 focus:outline-none focus:border-emerald-500"
              />
            </div>
          )}
        </div>
      )}

      {/* Main Preview Container */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 flex justify-center bg-gray-500/20">
        <div
          className="bg-white shadow-2xl rounded-sm w-[210mm] min-h-[297mm] ring-1 ring-black/10 my-auto"
          style={{ fontFamily: '"Times New Roman", Times, serif' }}
        >
          <StockDocPrintTemplate
            ref={printRef}
            doc={doc}
            warehouses={warehouses}
            options={options}
          />
        </div>
      </div>
    </div>
  );
}
