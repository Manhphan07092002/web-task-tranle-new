import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, AlertCircle, ChevronDown } from 'lucide-react';
import { Card } from '../../components/UI';
import { getStockReport, type StockReportRow } from '../../services/stockService';
import { getDeptHomePath } from '../../components/layout/menus/departmentMenus';
import type { DeptKey } from '../../components/layout/menus/menuTypes';

const PERIODS = [
  { days: 7, label: '7 ngày' },
  { days: 30, label: '30 ngày' },
  { days: 90, label: '90 ngày' },
];

// Báo cáo kho (§30.1–30.2): Nhập–Xuất–Tồn theo kỳ + tồn theo kho.
// moves: RECEIPT/TRANSFER_IN (+), ISSUE/TRANSFER_OUT (−).
export default function WarehouseReportsPage({ deptKey }: { deptKey: DeptKey }) {
  const [rows, setRows] = useState<StockReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [revision, setRevision] = useState(0);
  const fetchAll = () => setRevision(value => value + 1);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const to = new Date();
    getStockReport(new Date(to.getTime() - days * 86400000).toISOString(), to.toISOString())
      .then(data => { if (active) setRows(data); })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days, revision]);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Kho vận · Báo cáo</p>
          <h1 className="text-2xl font-bold text-gray-800 mt-1">Nhập – Xuất – Tồn</h1>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}
              className="pl-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">
              {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-3 text-gray-400 pointer-events-none" size={14} />
          </div>
          <button onClick={fetchAll} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 shadow-sm" title="Tải lại">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          <AlertCircle size={15} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3">
          <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Đang tải báo cáo...</p>
        </div>
      ) : !error && (
        <>
          <p className="text-sm text-gray-500">Theo từng hàng và đơn vị tính. Tồn cuối = tồn đầu + nhập − xuất + điều chỉnh / lắp tách bộ.</p>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left bg-gray-50">
                {['Kho', 'Hàng hóa', 'ĐVT', 'Tồn đầu', 'Nhập', 'Xuất', 'Điều chỉnh / Bộ', 'Tồn cuối'].map(label => <th key={label} className="p-3 whitespace-nowrap">{label}</th>)}
              </tr></thead>
              <tbody>
                {!rows.length && <tr><td colSpan={8} className="p-8 text-center text-gray-500">Chưa có dữ liệu.</td></tr>}
                {rows.map(row => <tr key={row.warehouseId + ':' + row.productId} className="border-t">
                  <td className="p-3">{row.warehouseName}</td><td className="p-3">{row.productName || row.productId}</td><td className="p-3">{row.unit || '—'}</td>
                  {(['opening', 'inbound', 'outbound', 'adjustment', 'closing'] as const).map(key => <td key={key} className="p-3 text-right tabular-nums">{row[key].toLocaleString('vi-VN')}</td>)}
                </tr>)}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <Link to={getDeptHomePath(deptKey) || '/'} className="inline-block text-sm text-emerald-600 hover:underline font-medium">
        ← Về tổng quan kho vận
      </Link>
    </div>
  );
}
