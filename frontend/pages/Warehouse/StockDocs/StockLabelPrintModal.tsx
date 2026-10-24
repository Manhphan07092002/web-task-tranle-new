import React, { useRef, useState, useMemo } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Tag, X, Printer, Settings2, SlidersHorizontal, CheckSquare, Square, CheckCircle2 } from 'lucide-react';
import { BarcodeRenderer } from '../../../components/BarcodeRenderer';
import type { StockDocument, StockDocDetailLine } from '../../../services/stockService';
import { parseSerialList } from '../../../services/serialUtils';

export interface PrintableLabelItem {
  id: string;
  productName: string;
  productSku?: string;
  serialNumber: string;
  date?: string;
  unit?: string;
  warehouseName?: string;
}

export interface PrintableLocationItem {
  id: string;
  warehouseName: string;
  code: string;
  name: string;
}

interface StockLabelPrintModalProps {
  doc?: StockDocument & { lines?: StockDocDetailLine[] };
  customItems?: PrintableLabelItem[];
  locationItems?: PrintableLocationItem[];
  onClose: () => void;
}

type LabelSizeKey = '50x30' | '75x50' | '100x50';

interface LabelSizeConfig {
  name: string;
  widthMm: number;
  heightMm: number;
  cssSize: string;
  barcodeHeight: number;
  qrSize: number;
}

const LABEL_SIZES: Record<LabelSizeKey, LabelSizeConfig> = {
  '50x30': {
    name: '50mm × 30mm (Tem thiết bị chuẩn)',
    widthMm: 50,
    heightMm: 30,
    cssSize: '50mm 30mm',
    barcodeHeight: 30,
    qrSize: 52,
  },
  '75x50': {
    name: '75mm × 50mm (Tem thùng / Inverter lớn)',
    widthMm: 75,
    heightMm: 50,
    cssSize: '75mm 50mm',
    barcodeHeight: 46,
    qrSize: 75,
  },
  '100x50': {
    name: '100mm × 50mm (Tem Kệ kho / Thùng carton)',
    widthMm: 100,
    heightMm: 50,
    cssSize: '100mm 50mm',
    barcodeHeight: 52,
    qrSize: 85,
  },
};

export function StockLabelPrintModal({
  doc,
  customItems,
  locationItems,
  onClose,
}: StockLabelPrintModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  // Cấu hình in
  const [sizeKey, setSizeKey] = useState<LabelSizeKey>(locationItems ? '75x50' : '50x30');
  const [codeType, setCodeType] = useState<'barcode' | 'qr'>('barcode');
  const [showCompany, setShowCompany] = useState(true);
  const [showDate, setShowDate] = useState(true);
  const [copiesPerItem, setCopiesPerItem] = useState(1);
  const [showConfig, setShowConfig] = useState(false);

  // Trích xuất danh sách tem sản phẩm từ chứng từ kho
  const allLabels = useMemo<PrintableLabelItem[]>(() => {
    if (customItems) return customItems;
    if (locationItems) return [];
    if (!doc || !doc.lines) return [];

    const dateStr = doc.docDate
      ? new Date(doc.docDate).toLocaleDateString('vi-VN')
      : new Date().toLocaleDateString('vi-VN');

    const result: PrintableLabelItem[] = [];
    doc.lines.forEach((ln, lineIdx) => {
      const serials = parseSerialList(ln.serialLot);
      if (serials.length > 0) {
        serials.forEach((sn, snIdx) => {
          result.push({
            id: `${ln.id || lineIdx}-${sn}-${snIdx}`,
            productName: ln.productName || 'Sản phẩm',
            productSku: ln.productCode || ln.productSku || '',
            serialNumber: sn,
            date: dateStr,
            unit: ln.uom || ln.unit || '',
            warehouseName: doc.warehouseName || '',
          });
        });
      } else {
        // Mặt hàng không có serial: tạo 1 tem cho sản phẩm với mã SKU
        const count = Number(ln.quantity || 1);
        for (let i = 0; i < Math.min(count, 50); i++) {
          result.push({
            id: `${ln.id || lineIdx}-nosn-${i}`,
            productName: ln.productName || 'Sản phẩm',
            productSku: ln.productCode || ln.productSku || '',
            serialNumber: ln.productCode || ln.productSku || `SP-${lineIdx + 1}`,
            date: dateStr,
            unit: ln.uom || ln.unit || '',
            warehouseName: doc.warehouseName || '',
          });
        }
      }
    });

    return result;
  }, [doc, customItems, locationItems]);

  // Trạng thái chọn từng tem để in
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (locationItems) return locationItems.map((l) => l.id);
    return allLabels.map((l) => l.id);
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (locationItems) {
      setSelectedIds(locationItems.map((l) => l.id));
    } else {
      setSelectedIds(allLabels.map((l) => l.id));
    }
  };

  const deselectAll = () => {
    setSelectedIds([]);
  };

  const activeSize = LABEL_SIZES[sizeKey];

  // Danh sách nhãn thực sự được render ra bản in
  const itemsToPrint = useMemo(() => {
    if (locationItems) {
      return locationItems.filter((l) => selectedIds.includes(l.id));
    }
    return allLabels.filter((l) => selectedIds.includes(l.id));
  }, [locationItems, allLabels, selectedIds]);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Tem_${doc?.code || 'Kho'}_${sizeKey}`,
    pageStyle: `
      @page {
        size: ${activeSize.cssSize};
        margin: 0;
      }
      *, html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: transparent !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .label-page {
        page-break-after: always;
        break-after: page;
        width: ${activeSize.widthMm}mm !important;
        height: ${activeSize.heightMm}mm !important;
        overflow: hidden !important;
        box-sizing: border-box !important;
        padding: 1.5mm !important;
        display: flex !important;
        flex-direction: column !important;
        justify-content: space-between !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif !important;
      }
    `,
  });

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Top Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3.5 flex items-center justify-between shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <Tag size={20} />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900 leading-tight">
              In tem nhãn nhiệt {locationItems ? 'vị trí kệ kho' : 'sản phẩm & serial'}
            </h2>
            <p className="text-xs text-gray-500">
              Khổ tem: {activeSize.name} • Đã chọn {itemsToPrint.length} tem
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowConfig(!showConfig)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
              showConfig ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <SlidersHorizontal size={14} />
            Cấu hình tem in
          </button>

          <button
            type="button"
            disabled={itemsToPrint.length === 0}
            onClick={() => handlePrint()}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all cursor-pointer"
          >
            <Printer size={16} />
            In tem ngay ({itemsToPrint.length * copiesPerItem})
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors ml-1"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Config Drawer / Accordion */}
      {showConfig && (
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-3.5 text-xs grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 shrink-0 animate-in slide-in-from-top-2 duration-150 shadow-inner">
          <div>
            <label className="block text-gray-500 font-semibold mb-1">Khổ tem in nhiệt</label>
            <select
              value={sizeKey}
              onChange={(e) => setSizeKey(e.target.value as LabelSizeKey)}
              className="w-full bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 font-medium text-gray-800 outline-none focus:border-blue-500"
            >
              {Object.entries(LABEL_SIZES).map(([k, cfg]) => (
                <option key={k} value={k}>
                  {cfg.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-gray-500 font-semibold mb-1">Định dạng mã</label>
            <select
              value={codeType}
              onChange={(e) => setCodeType(e.target.value as 'barcode' | 'qr')}
              className="w-full bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 font-medium text-gray-800 outline-none focus:border-blue-500"
            >
              <option value="barcode">Mã vạch Barcode (Code 128)</option>
              <option value="qr">Mã vuông QR Code (2D)</option>
            </select>
          </div>

          <div>
            <label className="block text-gray-500 font-semibold mb-1">Số bản / mỗi tem</label>
            <select
              value={copiesPerItem}
              onChange={(e) => setCopiesPerItem(Number(e.target.value))}
              className="w-full bg-white border border-gray-200 rounded-xl px-2.5 py-1.5 font-medium text-gray-800 outline-none focus:border-blue-500"
            >
              <option value={1}>1 bản (Dán máy)</option>
              <option value={2}>2 bản (Dán máy + Dán thùng)</option>
              <option value={3}>3 bản</option>
            </select>
          </div>

          <div className="col-span-2 flex items-center gap-4 bg-white px-3 py-1.5 rounded-xl border border-gray-200 mt-auto">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-700 select-none">
              <input
                type="checkbox"
                checked={showCompany}
                onChange={(e) => setShowCompany(e.target.checked)}
                className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
              />
              In tên Trần Lê
            </label>
            <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-700 select-none">
              <input
                type="checkbox"
                checked={showDate}
                onChange={(e) => setShowDate(e.target.checked)}
                className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
              />
              In ngày nhập
            </label>
          </div>
        </div>
      )}

      {/* Main Body: Sidebar chọn danh sách + Preview trực tiếp */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Danh sách tem */}
        <div className="w-72 sm:w-80 border-r border-gray-200 bg-white flex flex-col shrink-0">
          <div className="p-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <span className="text-xs font-bold text-gray-700">
              Chọn tem in ({itemsToPrint.length}/{(locationItems || allLabels).length})
            </span>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={selectAll}
                className="text-blue-600 hover:underline font-semibold"
              >
                Tất cả
              </button>
              <span className="text-gray-300">|</span>
              <button
                type="button"
                onClick={deselectAll}
                className="text-gray-500 hover:underline"
              >
                Bỏ chọn
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 p-2 space-y-1">
            {locationItems ? (
              locationItems.map((loc) => {
                const on = selectedIds.includes(loc.id);
                return (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => toggleSelect(loc.id)}
                    className={`w-full flex items-start gap-2.5 p-2 rounded-xl text-left transition-colors ${
                      on ? 'bg-blue-50/80 text-blue-900' : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    {on ? (
                      <CheckSquare size={16} className="text-blue-600 shrink-0 mt-0.5" />
                    ) : (
                      <Square size={16} className="text-gray-300 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-mono font-bold truncate">{loc.code}</p>
                      <p className="text-[11px] text-gray-500 truncate">{loc.name}</p>
                    </div>
                  </button>
                );
              })
            ) : allLabels.length > 0 ? (
              allLabels.map((item) => {
                const on = selectedIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleSelect(item.id)}
                    className={`w-full flex items-start gap-2.5 p-2 rounded-xl text-left transition-colors ${
                      on ? 'bg-blue-50/80 text-blue-900' : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    {on ? (
                      <CheckSquare size={16} className="text-blue-600 shrink-0 mt-0.5" />
                    ) : (
                      <Square size={16} className="text-gray-300 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-mono font-bold text-gray-900 truncate">
                        {item.serialNumber}
                      </p>
                      <p className="text-[11px] text-gray-500 truncate">{item.productName}</p>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="p-6 text-center text-xs text-gray-400">
                Không tìm thấy danh sách tem để in.
              </div>
            )}
          </div>
        </div>

        {/* Right Preview Canvas */}
        <div className="flex-1 bg-gray-500/20 overflow-y-auto p-6 sm:p-10 flex flex-col items-center">
          <p className="text-xs text-gray-600 mb-4 bg-white/80 backdrop-blur-xs px-4 py-1.5 rounded-full shadow-xs">
            Xem trước bản in nhiệt khổ <b>{activeSize.name}</b> (Cuộn {itemsToPrint.length * copiesPerItem} tem)
          </p>

          {/* Printable Container */}
          <div ref={printRef} className="space-y-4">
            {itemsToPrint.map((item: any, idx) => {
              const copies = Array.from({ length: copiesPerItem });
              return copies.map((_, copyIdx) => (
                <div
                  key={`${item.id}-${idx}-${copyIdx}`}
                  className="label-page bg-white shadow-md border border-gray-300 rounded-sm text-black"
                  style={{
                    width: `${activeSize.widthMm}mm`,
                    height: `${activeSize.heightMm}mm`,
                    padding: '2mm 2.5mm',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                  }}
                >
                  {locationItems ? (
                    // TEM VỊ TRÍ KỆ KHO (Location Label)
                    <div className="h-full flex flex-col justify-between text-center">
                      <div>
                        {showCompany && (
                          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-600 border-b border-black pb-0.5 mb-1">
                            {item.warehouseName || 'CÔNG TY CP THIẾT BỊ ĐIỆN TRẦN LÊ'}
                          </div>
                        )}
                        <h4 className="font-mono font-black text-[15px] leading-tight text-black tracking-wide">
                          {item.code}
                        </h4>
                        <p className="text-[10px] text-gray-700 font-semibold truncate mt-0.5">
                          {item.name}
                        </p>
                      </div>

                      <div className="flex justify-center my-0.5">
                        <BarcodeRenderer
                          value={item.code}
                          type="qr"
                          height={activeSize.qrSize / 2.2}
                        />
                      </div>

                      <div className="text-[8px] text-gray-500 font-mono">
                        Vị trí ngăn/kệ • Quét để định vị
                      </div>
                    </div>
                  ) : (
                    // TEM THIẾT BỊ / SERIAL (Product & Serial Label)
                    <div className="h-full flex flex-col justify-between">
                      {/* Header */}
                      <div className="flex items-center justify-between text-[8px] border-b border-black pb-0.5 mb-0.5 leading-tight">
                        <span className="font-bold tracking-tight truncate max-w-[70%]">
                          {showCompany ? 'TRẦN LÊ ELECTRICITY' : (item.productSku || 'THIẾT BỊ')}
                        </span>
                        {showDate && item.date && (
                          <span className="font-mono text-gray-600">{item.date}</span>
                        )}
                      </div>

                      {/* Product Name */}
                      <div className="leading-none mb-1">
                        <p
                          className="font-bold text-[10px] line-clamp-2 leading-snug text-black"
                          title={item.productName}
                        >
                          {item.productName}
                        </p>
                        {item.productSku && (
                          <p className="text-[8.5px] font-mono text-gray-600">
                            Model: {item.productSku}
                          </p>
                        )}
                      </div>

                      {/* Barcode / QR Center */}
                      <div className="flex flex-col items-center justify-center my-auto">
                        <BarcodeRenderer
                          value={item.serialNumber}
                          type={codeType}
                          width={1.4}
                          height={activeSize.barcodeHeight}
                        />
                        <div className="text-center font-mono font-bold text-[10px] tracking-widest mt-0.5 text-black">
                          {item.serialNumber}
                        </div>
                      </div>

                      {/* Footer micro info */}
                      <div className="flex justify-between items-center text-[7.5px] text-gray-500 border-t border-dotted border-gray-400 pt-0.5 mt-0.5">
                        <span className="truncate">Kho: {item.warehouseName || 'Chính'}</span>
                        <span className="font-mono uppercase">CHÍNH HÃNG</span>
                      </div>
                    </div>
                  )}
                </div>
              ));
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
