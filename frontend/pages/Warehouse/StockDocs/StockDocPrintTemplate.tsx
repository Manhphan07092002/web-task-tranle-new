import React from 'react';
import type { StockDocument, StockDocDetailLine, Warehouse } from '../../../services/stockService';
import { docTienBangChu } from '../../../utils/docTienBangChu';

export interface PrintOptions {
  showPriceOnIssue?: boolean;
  showSerialColumn?: boolean;
  accountDebit?: string;
  accountCredit?: string;
  creatorName?: string;
  receiverName?: string;
  warehouseKeeperName?: string;
  chiefAccountantName?: string;
  directorName?: string;
}

interface StockDocPrintTemplateProps {
  doc: StockDocument & { lines?: StockDocDetailLine[] };
  warehouses?: Warehouse[];
  options?: PrintOptions;
}

/** Tách danh sách serial từ chuỗi serialLot */
function parseSerialList(serialLot?: string | null): string[] {
  if (!serialLot) return [];
  return String(serialLot)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const StockDocPrintTemplate = React.forwardRef<HTMLDivElement, StockDocPrintTemplateProps>(
  ({ doc, warehouses = [], options = {} }, ref) => {
    const isIssue = doc.docType === 'ISSUE';
    const isReceipt = doc.docType === 'RECEIPT';
    const isTransfer = doc.docType === 'TRANSFER';
    const isReturn = doc.docType === 'RETURN';

    const currentWh = warehouses.find((w) => w.id === (doc.warehouseId || doc.sourceWarehouseId));
    const destWh = warehouses.find((w) => w.id === doc.destWarehouseId);
    const warehouseAddress = currentWh?.address || '275-279 Diên Hồng - P Hòa Xuân- Quận Cẩm Lệ, Tp Đà Nẵng';

    // Parse date
    const dateSource = doc.docDate || doc.postingDate || doc.createdAt || new Date().toISOString();
    const docDateObj = new Date(dateSource);
    const day = String(docDateObj.getDate()).padStart(2, '0');
    const month = String(docDateObj.getMonth() + 1).padStart(2, '0');
    const year = docDateObj.getFullYear();

    // Accounts
    const defaultDebit = isIssue ? '632' : isReceipt ? '1561' : isTransfer ? '157' : '1561';
    const defaultCredit = isIssue ? '1561' : isReceipt ? '331' : isTransfer ? '1561' : '131';

    const accountDebit = options.accountDebit || doc.lines?.[0]?.accountDebit || defaultDebit;
    const accountCredit = options.accountCredit || doc.lines?.[0]?.accountCredit || defaultCredit;

    // Lines & Totals
    const lines = doc.lines || [];
    const totalQty = lines.reduce((sum, ln) => sum + Number(ln.quantity || 0), 0);
    const totalAmount = Number(doc.totalAmount ?? lines.reduce((sum, ln) => sum + Number(ln.totalAmount || (Number(ln.quantity || 0) * Number(ln.unitPrice || 0))), 0));

    // Form title & Code
    let formCode = '01 - VT';
    let docTitle = 'PHIẾU NHẬP KHO';
    if (isIssue) {
      formCode = '02 - VT';
      docTitle = 'PHIẾU GIAO HÀNG KIÊM PHIẾU XUẤT KHO';
    } else if (isTransfer) {
      formCode = '03 - VT';
      docTitle = 'PHIẾU XUẤT KHO KIÊM VẬN CHUYỂN NỘI BỘ';
    } else if (isReturn) {
      formCode = '01 - VT';
      docTitle = 'PHIẾU NHẬP KHO (HÀNG TRẢ LẠI)';
    }

    // Invoice date
    let invoiceDateStr = '';
    if (doc.invoiceDate) {
      const invD = new Date(doc.invoiceDate);
      invoiceDateStr = `Ngày ${String(invD.getDate()).padStart(2, '0')} tháng ${String(invD.getMonth() + 1).padStart(2, '0')} năm ${invD.getFullYear()}`;
    }

    const showPrices = isReceipt || isReturn || Boolean(options.showPriceOnIssue);
    const showSerialCol = options.showSerialColumn !== undefined ? options.showSerialColumn : true;

    return (
      <div
        ref={ref}
        className="stock-print-template bg-white text-black p-8 sm:p-10 max-w-[210mm] mx-auto text-[13px] leading-relaxed"
        style={{ fontFamily: '"Times New Roman", Times, serif' }}
      >
        {/* CSS đồng nhất Times New Roman 100% và chuẩn A4 Portrait */}
        <style dangerouslySetInnerHTML={{ __html: `
          .stock-print-template,
          .stock-print-template * {
            font-family: "Times New Roman", Times, serif !important;
          }
          @media print {
            @page {
              size: A4 portrait;
              margin: 12mm 15mm 15mm 15mm;
            }
            html, body, div, table, tr, th, td, p, span, h1, h2, h3, h4, * {
              font-family: "Times New Roman", Times, serif !important;
              color: black !important;
            }
            body {
              background: white !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .stock-print-template {
              padding: 0 !important;
              max-width: 100% !important;
              margin: 0 !important;
              box-shadow: none !important;
              border: none !important;
            }
            .no-print {
              display: none !important;
            }
            table {
              page-break-inside: auto;
            }
            tr {
              page-break-inside: avoid;
              page-break-after: auto;
            }
            thead {
              display: table-header-group;
            }
            tfoot {
              display: table-footer-group;
            }
            .signature-block {
              break-inside: avoid;
              page-break-inside: avoid;
            }
          }
        ` }} />

        {/* 1. Header (Logo & Thông tin cty bên trái | Mẫu số bên phải) */}
        <div className="flex justify-between items-start gap-4 mb-4">
          <div className="flex items-start gap-3.5 flex-1">
            <img
              src="/logo-tranle-print.png"
              alt="Tran Le Electricity"
              className="w-[70px] h-auto object-contain shrink-0 mt-0.5"
              style={{ width: '70px', height: 'auto' }}
            />
            <div className="text-[13px] leading-[1.35]">
              <div className="font-bold">
                CÔNG TY CỔ PHẦN THIẾT BỊ ĐIỆN TRẦN LÊ
              </div>
              <div>275-279 Diên Hồng, Phường Hòa Xuân, Thành phố Đà</div>
              <div>Nẵng, Việt Nam.</div>
              <div>Tel: 0939792428</div>
            </div>
          </div>

          <div className="text-center shrink-0">
            <div className="font-bold text-[13px]">
              Mẫu số: {formCode}
            </div>
            <div className="italic text-[11px] leading-snug">
              (Kèm theo Thông tư số 99/2025/TT-BTC<br />
              ngày 27 tháng 10 năm 2025 của Bộ trưởng Bộ tài chính)
            </div>
          </div>
        </div>

        {/* 2. Tiêu đề phiếu, Ngày tháng & Nợ/Có */}
        <div className="text-center my-4">
          <h1 className="text-[18px] font-bold uppercase tracking-wide mb-1">
            {docTitle}
          </h1>
          <div className="grid grid-cols-3 items-start text-[13px]">
            <div />
            <div className="text-center leading-snug">
              <div className="italic">
                Ngày {day} tháng {month} năm {year}
              </div>
              <div className="mt-0.5 font-normal">
                Số: {doc.code || '—'}
              </div>
            </div>
            <div className="text-right text-[12px] leading-snug pr-1">
              <div>Nợ: {accountDebit}</div>
              <div>Có: {accountCredit}</div>
            </div>
          </div>
        </div>

        {/* 3. Thông tin người nhận/giao & lý do */}
        <div className="space-y-1 mb-3.5 text-[13px] leading-normal">
          {isIssue && (
            <>
              <div>
                <span>- Họ và tên người nhận hàng: </span>
                <span>{doc.partnerName || '—'}{doc.deliverer ? ` - ${doc.deliverer}` : ''}</span>
              </div>
              <div>
                <span>- Địa chỉ (bộ phận): </span>
                <span>{doc.partnerAddress || '—'}</span>
              </div>
              <div>
                <span>- Lý do xuất kho: </span>
                <span>{doc.notes || `Xuất kho bán hàng ${doc.partnerName || ''}`}</span>
              </div>
              <div className="flex justify-between items-start flex-wrap gap-2">
                <div>
                  <span>- Xuất tại kho (ngăn lô): </span>
                  <span>{doc.warehouseName || currentWh?.name || '—'}</span>
                </div>
                <div className="text-right max-w-[55%]">
                  <span>Địa điểm: </span>
                  <span>{warehouseAddress}</span>
                </div>
              </div>
            </>
          )}

          {isReceipt && (
            <>
              <div>
                <span>- Họ và tên người giao: </span>
                <span>{doc.partnerName || doc.deliverer || '—'}</span>
              </div>
              <div>
                <span>- Theo hóa đơn số {doc.invoiceNumber || '—'} {invoiceDateStr ? `${invoiceDateStr} ` : ''}của {doc.partnerName || '—'}</span>
              </div>
              <div className="flex justify-between items-start flex-wrap gap-2">
                <div>
                  <span>- Nhập tại kho: </span>
                  <span>{doc.warehouseName || currentWh?.name || '—'}</span>
                </div>
                <div className="text-right max-w-[55%]">
                  <span>Địa điểm: </span>
                  <span>{warehouseAddress}</span>
                </div>
              </div>
            </>
          )}

          {isTransfer && (
            <>
              <div>
                <span>- Người vận chuyển / giao nhận: </span>
                <span>{doc.deliverer || doc.createdByName || '—'}</span>
              </div>
              <div>
                <span>- Lý do điều chuyển: </span>
                <span>{doc.notes || `Điều chuyển nội bộ từ kho ${currentWh?.name || ''} sang kho ${destWh?.name || ''}`}</span>
              </div>
              <div className="flex justify-between items-start flex-wrap gap-2">
                <div>
                  <span>- Xuất tại kho: </span>
                  <span>{doc.sourceWarehouseName || currentWh?.name || '—'}</span>
                </div>
                <div>
                  <span>Đến kho: </span>
                  <span>{doc.destWarehouseName || destWh?.name || '—'}</span>
                </div>
              </div>
            </>
          )}

          {isReturn && (
            <>
              <div>
                <span>- Người trả hàng / Khách hàng: </span>
                <span>{doc.partnerName || '—'}{doc.deliverer ? ` - ${doc.deliverer}` : ''}</span>
              </div>
              <div>
                <span>- Lý do trả hàng: </span>
                <span>{doc.notes || 'Nhập kho hàng khách trả lại'}</span>
              </div>
              <div className="flex justify-between items-start flex-wrap gap-2">
                <div>
                  <span>- Nhập tại kho: </span>
                  <span>{doc.warehouseName || currentWh?.name || '—'}</span>
                </div>
                <div className="text-right max-w-[55%]">
                  <span>Địa điểm: </span>
                  <span>{warehouseAddress}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 4. Bảng chi tiết hàng hóa (Chuẩn 100% mẫu Bộ Tài Chính) */}
        <table className="w-full border-collapse border border-black text-[12px] mb-2 table-fixed" style={{ border: '1px solid black' }}>
          <thead>
            <tr className="text-center font-bold">
              <th
                className="border border-black px-1 py-1.5 text-center text-[11px]"
                rowSpan={2}
                style={{ width: '30px', border: '1px solid black' }}
              >
                STT
              </th>
              <th
                className="border border-black px-2 py-1.5 text-center leading-snug"
                rowSpan={2}
                style={{ border: '1px solid black' }}
              >
                Tên, nhãn hiệu, quy cách, phẩm chất vật tư, dụng cụ sản phẩm, hàng hóa
              </th>
              <th
                className="border border-black px-1 py-1.5 text-center leading-tight text-[11px]"
                rowSpan={2}
                style={{ width: showPrices ? '68px' : '78px', border: '1px solid black' }}
              >
                Mã số
              </th>
              <th
                className="border border-black px-1 py-1.5 text-center text-[11px]"
                rowSpan={2}
                style={{ width: showPrices ? '38px' : '44px', border: '1px solid black' }}
              >
                ĐVT
              </th>
              <th
                className="border border-black px-1 py-1 text-center text-[11px]"
                colSpan={2}
                style={{ width: showPrices ? '110px' : '124px', border: '1px solid black' }}
              >
                Số lượng
              </th>
              {showPrices && (
                <>
                  <th
                    className="border border-black px-1 py-1.5 text-center leading-tight text-[11px]"
                    rowSpan={2}
                    style={{ width: '64px', border: '1px solid black' }}
                  >
                    Đơn giá
                  </th>
                  <th
                    className="border border-black px-1 py-1.5 text-center leading-tight text-[11px]"
                    rowSpan={2}
                    style={{ width: '74px', border: '1px solid black' }}
                  >
                    Thành tiền
                  </th>
                </>
              )}
              {showSerialCol && (
                <th
                  className="border border-black px-1 py-1.5 text-center leading-tight text-[11px]"
                  rowSpan={2}
                  style={{ width: showPrices ? '64px' : '74px', border: '1px solid black' }}
                >
                  Số SN
                </th>
              )}
            </tr>
            <tr className="text-center font-bold">
              <th
                className="border border-black px-1 py-1 text-center text-[10px] leading-tight"
                style={{ width: showPrices ? '55px' : '62px', border: '1px solid black' }}
              >
                {isReceipt ? 'Theo chứng từ' : 'Yêu cầu'}
              </th>
              <th
                className="border border-black px-1 py-1 text-center text-[10px] leading-tight"
                style={{ width: showPrices ? '55px' : '62px', border: '1px solid black' }}
              >
                {isReceipt ? 'Thực nhập' : 'Thực xuất'}
              </th>
            </tr>
            <tr className="text-center font-bold text-[11px]">
              <th className="border border-black py-0.5 text-center" style={{ border: '1px solid black' }}>A</th>
              <th className="border border-black py-0.5 text-center" style={{ border: '1px solid black' }}>B</th>
              <th className="border border-black py-0.5 text-center" style={{ border: '1px solid black' }}>C</th>
              <th className="border border-black py-0.5 text-center" style={{ border: '1px solid black' }}>D</th>
              <th className="border border-black py-0.5 text-center" style={{ border: '1px solid black' }}>1</th>
              <th className="border border-black py-0.5 text-center" style={{ border: '1px solid black' }}>2</th>
              {showPrices && (
                <>
                  <th className="border border-black py-0.5 text-center" style={{ border: '1px solid black' }}>3</th>
                  <th className="border border-black py-0.5 text-center" style={{ border: '1px solid black' }}>4</th>
                </>
              )}
              {showSerialCol && (
                <th className="border border-black py-0.5 text-center" style={{ border: '1px solid black' }}>
                  {showPrices ? '5' : '3'}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {lines.length > 0 ? (
              lines.map((ln, idx) => {
                const qty = Number(ln.quantity || 0);
                const unitPrice = Number(ln.unitPrice || 0);
                const lineTotal = Number(ln.totalAmount || (qty * unitPrice));
                const serials = parseSerialList(ln.serialLot);
                const noteText = (ln.notes || ln.note || '').trim();

                return (
                  <tr key={ln.id || idx}>
                    <td className="border border-black px-1 py-1.5 text-center text-[11px]" style={{ border: '1px solid black' }}>
                      {idx + 1}
                    </td>
                    <td className="border border-black px-2 py-1.5 leading-snug text-left" style={{ border: '1px solid black' }}>
                      <div className="font-medium text-[12px]">{ln.productName || '—'}</div>
                      {/* Nếu không bật cột riêng, in serial/ghi chú ngay dưới tên sản phẩm */}
                      {!showSerialCol && (serials.length > 0 || noteText) && (
                        <div className="mt-1 text-[11px] text-gray-700 italic space-y-0.5">
                          {serials.length > 0 && <div>Số seri: {serials.join(', ')}</div>}
                          {noteText && noteText !== ln.serialLot && <div>Ghi chú: {noteText}</div>}
                        </div>
                      )}
                    </td>
                    <td className="border border-black px-1 py-1.5 text-center text-[11px] break-all leading-tight" style={{ border: '1px solid black' }}>
                      {ln.productCode || ln.productSku || '—'}
                    </td>
                    <td className="border border-black px-1 py-1.5 text-center text-[11px]" style={{ border: '1px solid black' }}>
                      {ln.uom || ln.unit || '—'}
                    </td>
                    <td className="border border-black px-1 py-1.5 text-right text-[11px]" style={{ border: '1px solid black' }}>
                      {qty.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="border border-black px-1 py-1.5 text-right text-[11px]" style={{ border: '1px solid black' }}>
                      {/* Nếu phiếu đã hoàn tất thì hiển thị số thực, nếu nháp để trống cho thủ kho ghi */}
                      {doc.status === 'DONE' ? qty.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                    </td>
                    {showPrices && (
                      <>
                        <td className="border border-black px-1 py-1.5 text-right text-[11px]" style={{ border: '1px solid black' }}>
                          {unitPrice > 0 ? unitPrice.toLocaleString('vi-VN', { minimumFractionDigits: 2 }) : '—'}
                        </td>
                        <td className="border border-black px-1 py-1.5 text-right font-semibold text-[11px]" style={{ border: '1px solid black' }}>
                          {lineTotal > 0 ? lineTotal.toLocaleString('vi-VN') : '—'}
                        </td>
                      </>
                    )}
                    {showSerialCol && (
                      <td className="border border-black px-1 py-1 text-center text-[11px] break-all" style={{ border: '1px solid black' }}>
                        {serials.length > 0 ? (
                          serials.length <= 4 ? (
                            <div className="space-y-0.5">
                              {serials.map((sn, sIdx) => (
                                <div key={sIdx} className="leading-tight font-medium">
                                  {sn}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="leading-snug text-[11px]">
                              {serials.join(', ')}
                            </div>
                          )
                        ) : noteText && noteText !== ln.serialLot ? (
                          <div className="italic text-gray-700 text-[11px]">{noteText}</div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={4 + 2 + (showPrices ? 2 : 0) + (showSerialCol ? 1 : 0)}
                  className="border border-black py-4 text-center text-gray-500 italic"
                  style={{ border: '1px solid black' }}
                >
                  Không có mặt hàng nào.
                </td>
              </tr>
            )}

            {/* Dòng Cộng */}
            <tr className="font-bold text-[11px]">
              <td className="border border-black px-1 py-1.5 text-center" colSpan={4} style={{ border: '1px solid black' }}>
                Cộng
              </td>
              <td className="border border-black px-1 py-1.5 text-right" style={{ border: '1px solid black' }}>
                {totalQty.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td className="border border-black px-1 py-1.5 text-right" style={{ border: '1px solid black' }}>
                {doc.status === 'DONE' ? totalQty.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
              </td>
              {showPrices && (
                <>
                  <td className="border border-black px-1 py-1.5 text-center" style={{ border: '1px solid black' }} />
                  <td className="border border-black px-1 py-1.5 text-right font-bold" style={{ border: '1px solid black' }}>
                    {totalAmount > 0 ? totalAmount.toLocaleString('vi-VN') : '—'}
                  </td>
                </>
              )}
              {showSerialCol && <td className="border border-black px-1 py-1.5 text-center" style={{ border: '1px solid black' }} />}
            </tr>
          </tbody>
        </table>

        {/* 5. Ghi chú dưới bảng & Số tiền viết bằng chữ */}
        {showPrices && totalAmount > 0 && (
          <div className="mb-1 text-[13px]">
            <span>- Tổng số tiền (Viết bằng chữ): </span>
            <span className="font-bold italic">{docTienBangChu(totalAmount)}</span>
          </div>
        )}

        <div className="mb-4 text-[13px]">
          <span>- Số chứng từ gốc kèm theo: </span>
          <span>{doc.customsDeclarationNumber || doc.invoiceLookupCode || doc.invoiceNumber || ''}</span>
        </div>

        {/* 6. Chữ ký chân trang (Đúng chuẩn 100% Mẫu 02-VT / 01-VT) */}
        <div className="signature-block mt-5">
          <div className="flex justify-end mb-1 pr-6">
            <div className="italic text-[13px]">
              Ngày {day} tháng {month} năm {year}
            </div>
          </div>

          {isIssue ? (
            /* Phiếu xuất: 5 cột chữ ký */
            <div className="grid grid-cols-5 text-center text-[12px] gap-1 items-start">
              <div>
                <div className="font-bold">Người lập biểu</div>
                <div className="italic text-[11px]">(Ký, họ tên)</div>
                <div className="h-16 flex items-end justify-center font-bold text-[11px]">
                  {options.creatorName || doc.createdByName || ''}
                </div>
              </div>
              <div>
                <div className="font-bold">Người nhận hàng</div>
                <div className="italic text-[11px]">(Ký, họ tên)</div>
                <div className="h-16 flex items-end justify-center font-bold text-[11px] uppercase px-1 leading-tight">
                  {options.receiverName || doc.partnerName || ''}
                </div>
              </div>
              <div>
                <div className="font-bold">Thủ kho</div>
                <div className="italic text-[11px]">(Ký, họ tên)</div>
                <div className="h-16 flex items-end justify-center font-bold text-[11px]">
                  {options.warehouseKeeperName || ''}
                </div>
              </div>
              <div>
                <div className="font-bold leading-tight">Kế toán trưởng</div>
                <div className="italic text-[10px] leading-tight">
                  (Hoặc bộ phận có nhu<br />cầu nhập)
                </div>
                <div className="italic text-[10px]">(Ký, họ tên)</div>
                <div className="h-12 flex items-end justify-center font-bold text-[11px]">
                  {options.chiefAccountantName || ''}
                </div>
              </div>
              <div>
                <div className="font-bold">Giám đốc</div>
                <div className="italic text-[11px]">(Ký, họ tên, đóng dấu)</div>
                <div className="h-16 flex items-end justify-center font-bold text-[11px]">
                  {options.directorName || ''}
                </div>
              </div>
            </div>
          ) : (
            /* Phiếu nhập / chuyển / trả: 4 cột chữ ký */
            <div className="grid grid-cols-4 text-center text-[12px] gap-2 items-start">
              <div>
                <div className="font-bold">Người lập biểu</div>
                <div className="italic text-[11px]">(Ký, họ tên)</div>
                <div className="h-16 flex items-end justify-center font-bold text-[11px]">
                  {options.creatorName || doc.createdByName || ''}
                </div>
              </div>
              <div>
                <div className="font-bold">
                  {isReceipt ? 'Người giao hàng' : isTransfer ? 'Người vận chuyển' : 'Người trả hàng'}
                </div>
                <div className="italic text-[11px]">(Ký, họ tên)</div>
                <div className="h-16 flex items-end justify-center font-bold text-[11px] px-1 leading-tight">
                  {options.receiverName || doc.deliverer || doc.partnerName || ''}
                </div>
              </div>
              <div>
                <div className="font-bold">Thủ kho</div>
                <div className="italic text-[11px]">(Ký, họ tên)</div>
                <div className="h-16 flex items-end justify-center font-bold text-[11px]">
                  {options.warehouseKeeperName || ''}
                </div>
              </div>
              <div>
                <div className="font-bold leading-tight">Kế toán trưởng</div>
                <div className="italic text-[10px] leading-tight">
                  (Hoặc bộ phận có nhu<br />cầu nhập)
                </div>
                <div className="italic text-[10px]">(Ký, họ tên)</div>
                <div className="h-12 flex items-end justify-center font-bold text-[11px]">
                  {options.chiefAccountantName || ''}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);
