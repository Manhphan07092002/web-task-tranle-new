import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, TriangleAlert, Truck, LucideIcon,
  ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, ClipboardCheck,
} from 'lucide-react';
import { Card } from '../../components/UI';
import { useAuth } from '../../contexts/AuthContext';
import {
  getStockBalances, getStockDocuments, getStockAlerts, getStockMoves, getStockCounts, getWarehouses, getSlowStock,
  type StockDocument,
} from '../../services/stockService';
import { getReservations } from '../../services/reservationService';
import { roleLabel } from '../../components/layout/menus/resolveDepartment';
import { DEPT_LABELS, type DeptKey } from '../../components/layout/menus/menuTypes';

// Tổng quan Kho vận tách 2 bản (§7 NV / §8 TP — 09_KHO_VAN).
// NV: biết hôm nay cần làm gì, không nhiễu quản trị.
// TP: toàn cảnh phòng/scope trong 10–20 giây.
export default function WarehouseOverview({ deptKey }: { deptKey: DeptKey }) {
  const { user } = useAuth();
  const level = user?.managementLevel ?? 10;

  if (user && level === 99) {
    return (
      <div className="w-full max-w-[1400px] mx-auto">
        <Card className="p-10 text-center text-gray-400">
          <LayoutDashboard size={36} className="mx-auto mb-3 opacity-25" />
          <p className="font-medium text-gray-700">Quản trị viên không xem dữ liệu kinh doanh kho</p>
          <p className="text-sm mt-1">Dùng trang Quản trị hệ thống (người dùng, vai trò, mapping MISA).</p>
        </Card>
      </div>
    );
  }

  if (user && level >= 20) return <ManagerOverview deptKey={deptKey} />;
  return <StaffOverview deptKey={deptKey} />;
}

function useWarehouseData() {
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<{ productId: string; warehouseId: string; available: number; onHand: number; reserved: number }[]>([]);
  const [docs, setDocs] = useState<StockDocument[]>([]);
  const [alerts, setAlerts] = useState<{ productId: string; warehouseId: string }[]>([]);
  const [moves, setMoves] = useState<{ createdBy?: string | null; createdByName?: string | null; createdAt: string }[]>([]);
  const [counts, setCounts] = useState<{ id: string; status: string }[]>([]);
  const [slow, setSlow] = useState<{ productId: string; warehouseId: string; onHand: number }[]>([]);
  const [holds, setHolds] = useState<{ id: string; productId: string; warehouseId: string; quantity: number; expiresAt?: string | null; status: string }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [b, d, a, m, c, w, s, h] = await Promise.all([
          getStockBalances({ limit: 200 }).catch(() => []),
          getStockDocuments({ limit: 50 }).catch(() => []),
          getStockAlerts().catch(() => []),
          getStockMoves({ limit: 50 }).catch(() => []),
          getStockCounts(undefined, undefined, { limit: 20 }).catch(() => []),
          getWarehouses().catch(() => []),
          getSlowStock(undefined, 90).catch(() => []),
          getReservations(undefined, undefined, { limit: 50 }).catch(() => []),
        ]);
        if (!cancelled) {
          setBalances(b); setDocs(d); setAlerts(a); setMoves(m); setCounts(c); setWarehouses(w); setSlow(s); setHolds(h);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { loading, balances, docs, alerts, moves, counts, warehouses, slow, holds };
}

function Header({ deptKey, title, subtitle }: { deptKey: DeptKey; title: string; subtitle: string }) {
  const { user } = useAuth();
  const today = new Date().toLocaleDateString('vi-VN');
  return (
    <div>
      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
        <LayoutDashboard size={12} /> {DEPT_LABELS[deptKey]}
        {user && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-blue-600 text-white tracking-normal">
            {roleLabel(user.managementLevel)}
          </span>
        )}
      </p>
      <h1 className="text-2xl font-bold text-gray-800 mt-1">{title}</h1>
      <p className="text-gray-500 text-sm mt-1">{user ? `Xin chào ${user.name} — ` : ''}{subtitle} · {today}</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-col items-center py-16 gap-3">
      <div className="w-10 h-10 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
      <p className="text-gray-400 text-sm">Đang tải số liệu kho...</p>
    </div>
  );
}

// ─── Bản NV (§7): Tổng quan của tôi ───────────────────────────────────────────

function StaffOverview({ deptKey }: { deptKey: DeptKey }) {
  const { user } = useAuth();
  const { loading, balances, docs, counts, warehouses, holds } = useWarehouseData();

  const receipts = docs.filter((d) => d.docType === 'RECEIPT' && d.status === 'DRAFT');
  const issues = docs.filter((d) => d.docType === 'ISSUE' && d.status === 'DRAFT');
  const transfers = docs.filter((d) => d.docType === 'TRANSFER' && (d.status === 'DRAFT' || d.status === 'IN_TRANSIT'));
  const counting = counts.filter((c) => c.status === 'COUNTING');

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name || id;
  const myScopeNames = [...new Set([
    ...balances.map((b) => b.warehouseId),
    ...docs.map((d) => docWarehouse(d)),
  ].filter(Boolean))].map(whName);
  const docWh = (d: { warehouseId?: string | null; sourceWarehouseId?: string | null }) =>
    d.warehouseId || d.sourceWarehouseId || '';

  // Bảng việc cần xử lý (§7.4): mã / loại / nội dung / trạng thái.
  const workRows = [
    ...receipts.map((d) => ({ id: d.id, code: d.code, kind: 'Nhập', detail: `Nhận hàng về ${whName(docWh(d))}`, status: 'Chờ nhận', to: '/dept/warehouse?m=wh_receipt' })),
    ...issues.map((d) => ({ id: d.id, code: d.code, kind: 'Xuất', detail: `Soạn hàng tại ${whName(docWh(d))}`, status: 'Cần soạn', to: '/dept/warehouse?m=wh_issue' })),
    ...transfers.map((d) => ({
      id: d.id, code: d.code, kind: 'Điều chuyển',
      detail: d.status === 'DRAFT' ? 'Chờ gửi' : 'Chờ nhận',
      status: d.status === 'DRAFT' ? 'Chờ gửi' : 'Chờ nhận',
      to: '/dept/warehouse?m=wh_transfer',
    })),
    ...counting.map((c: any) => ({ id: c.id, code: c.code, kind: 'Kiểm kê', detail: `Đếm tại ${whName(c.warehouseId)}`, status: 'Đang đếm', to: '/dept/warehouse?m=wh_count' })),
  ].slice(0, 12);

  // Cảnh báo cá nhân (§7.5): quá hạn nhận, kiểm kê dở, hết hàng, giữ sắp hết hạn.
  const weekAgo = Date.now() - 7 * 86_400_000;
  const warnings: string[] = [
    ...docs.filter((d) => d.docType === 'TRANSFER' && d.status === 'IN_TRANSIT' && new Date(d.createdAt).getTime() < weekAgo)
      .slice(0, 3).map((d) => `Điều chuyển ${d.code || d.id.slice(0, 8)} quá 7 ngày chưa nhận.`),
    ...counting.slice(0, 2).map((c: any) => `Kiểm kê ${c.code || ''} chưa hoàn tất.`),
  ];
  const outCount = balances.filter((b) => Number(b.available) <= 0).length;
  if (outCount > 0) warnings.push(`${outCount} dòng hàng đã hết trong phạm vi của bạn.`);
  const expiring = holds.filter((h) => h.status === 'HELD' && h.expiresAt && new Date(h.expiresAt).getTime() - Date.now() < 3 * 86_400_000);
  if (expiring.length > 0) warnings.push(`${expiring.length} giữ hàng sắp hết hạn (≤ 3 ngày).`);

  const myDoneWeek = useMemo(() => {
    if (!user) return 0;
    const cutoff = Date.now() - 7 * 86_400_000;
    return docs.filter((d) => d.status === 'DONE' && (d as any).createdBy === user.id && new Date(d.createdAt).getTime() >= cutoff).length;
  }, [docs, user]);

  const kpi = [
    { label: 'Cần nhập', value: receipts.length },
    { label: 'Cần xuất', value: issues.length },
    { label: 'Điều chuyển', value: transfers.length },
    { label: 'Kiểm kê', value: counting.length },
    { label: 'Tôi xong tuần này', value: myDoneWeek },
  ];

  const quick: { label: string; to: string; Icon: LucideIcon }[] = [
    { label: 'Nhận hàng', to: '/dept/warehouse?m=wh_receipt', Icon: ArrowDownToLine },
    { label: 'Soạn hàng', to: '/dept/warehouse?m=wh_issue', Icon: ArrowUpFromLine },
    { label: 'Điều chuyển', to: '/dept/warehouse?m=wh_transfer', Icon: ArrowLeftRight },
    { label: 'Tiếp tục kiểm kê', to: '/dept/warehouse?m=wh_count', Icon: ClipboardCheck },
  ];

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <Header deptKey={deptKey} title="Tổng quan của tôi" subtitle={`hôm nay cần xử lý những việc này${myScopeNames.length > 0 ? ` · Kho: ${myScopeNames.slice(0, 3).join(', ')}${myScopeNames.length > 3 ? '…' : ''}` : ''}`} />
      {loading ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {kpi.map((s) => (
              <Card key={s.label} className="p-4">
                <p className="text-2xl font-black text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-500">{s.label}</p>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {quick.map((q) => (
              <Link key={q.label} to={q.to} className="flex items-center gap-2.5 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm shadow-md transition-colors">
                <q.Icon size={16} />{q.label}
              </Link>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-5 md:col-span-2">
              <h2 className="font-bold text-gray-800 mb-3 text-sm uppercase tracking-wider">
                Việc cần xử lý hôm nay ({workRows.length}{docs.filter((d) => d.status === 'DRAFT' || d.status === 'IN_TRANSIT').length > workRows.length ? '+' : ''})
              </h2>
              {workRows.length === 0 ? (
                <p className="text-sm text-gray-400">Không có việc nào chờ — kho thông thoáng.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="wh-table w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 uppercase">
                        <th className="py-2 pr-2">Mã</th>
                        <th className="py-2 pr-2">Loại</th>
                        <th className="py-2 pr-2">Nội dung</th>
                        <th className="py-2 pr-2">Trạng thái</th>
                        <th className="py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {workRows.map((w) => (
                        <tr key={w.kind + w.id} className="hover:bg-gray-50/70">
                          <td className="py-2 pr-2 font-mono font-bold text-gray-700 text-xs">{w.code || w.id.slice(0, 8)}</td>
                          <td className="py-2 pr-2 text-gray-500 text-xs">{w.kind}</td>
                          <td className="py-2 pr-2 text-gray-700 text-xs">{w.detail}</td>
                          <td className="py-2 pr-2"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">{w.status}</span></td>
                          <td className="py-2 text-right"><Link to={w.to} className="text-xs font-bold text-emerald-600 hover:underline">Mở →</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card className="p-5 md:col-span-2">
              <h2 className="font-bold text-gray-800 mb-3 text-sm uppercase tracking-wider flex items-center gap-2">
                <TriangleAlert size={15} /> Cảnh báo của bạn ({warnings.length})
              </h2>
              {warnings.length === 0 ? (
                <p className="text-sm text-gray-400">Không có cảnh báo nào.</p>
              ) : (
                <ul className="space-y-2">
                  {warnings.map((msg, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <TriangleAlert size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />{msg}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Bản TP (§8): Tổng quan quản trị ──────────────────────────────────────────

function ManagerOverview({ deptKey }: { deptKey: DeptKey }) {
  const { loading, balances, docs, alerts, moves, counts, warehouses, slow, holds } = useWarehouseData();
  const [warehouseId, setWarehouseId] = useState('');

  const inScope = (w: string) => !warehouseId || w === warehouseId;
  const sku = countLines(balances, warehouseId, 'sku');
  const out = countLines(balances, warehouseId, 'out');
  const pending = docs.filter((d) => (d.status === 'DRAFT' || d.status === 'IN_TRANSIT') && inScope(docWarehouse(d))).length;
  const transit = docs.filter((d) => d.docType === 'TRANSFER' && d.status === 'IN_TRANSIT' && inScope(docWarehouse(d))).length;
  const variance = counts.filter((c) => c.status === 'COUNTING').length;
  const warnCount = alerts.filter((a) => inScope(a.warehouseId)).length;

  const perWarehouse = warehouses
    .filter((w) => inScope(w.id))
    .map((w) => {
      const lines = balances.filter((b) => b.warehouseId === w.id);
      const warn = alerts.filter((a) => a.warehouseId === w.id).length
        + docs.filter((d) => d.status === 'DRAFT' && docWarehouse(d) === w.id).length;
      return {
        ...w,
        sku: new Set(lines.map((b) => b.productId)).size,
        waitIn: docs.filter((d) => d.docType === 'RECEIPT' && d.status === 'DRAFT' && docWarehouse(d) === w.id).length,
        waitOut: docs.filter((d) => d.docType === 'ISSUE' && d.status === 'DRAFT' && docWarehouse(d) === w.id).length,
        warn,
        state: warn === 0 ? 'Bình thường' : warn <= 3 ? 'Cần chú ý' : 'Cần xử lý',
      };
    });

  const handlers = useMemo(() => {
    const map = new Map<string, { ops: number; docs: number; days: Set<string> }>();
    const cutoff = Date.now() - 30 * 86_400_000;
    for (const m of moves) {
      if (!m.createdBy || new Date(m.createdAt).getTime() < cutoff) continue;
      const name = m.createdByName || m.createdBy;
      const slot = map.get(name) || { ops: 0, docs: 0, days: new Set<string>() };
      slot.ops++;
      slot.days.add(new Date(m.createdAt).toISOString().slice(0, 10));
      map.set(name, slot);
    }
    for (const d of docs) {
      const creator = (d as any).createdBy;
      if (!creator || new Date(d.createdAt).getTime() < cutoff) continue;
      const slot = map.get(creator) || { ops: 0, docs: 0, days: new Set<string>() };
      slot.docs++;
      slot.days.add(new Date(d.createdAt).toISOString().slice(0, 10));
      map.set(creator, slot);
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ops: v.ops, docs: v.docs, days: v.days.size }))
      .sort((a, b) => b.ops - a.ops)
      .slice(0, 8);
  }, [moves, docs]);

  // Cảnh báo quản trị (§8.5): hết hàng, dưới ngưỡng, tồn lâu, điều chuyển trễ, kiểm kê dở, giữ sắp hết hạn.
  const adminWarnings = useMemo(() => {
    const list: { to: string; msg: string }[] = [];
    const out = balances.filter((b) => Number(b.available) <= 0 && inScope(b.warehouseId));
    if (out.length > 0) list.push({ to: '/dept/warehouse?m=wh_alerts', msg: `${out.length} dòng hàng đã hết.` });
    const low = alerts.filter((a) => inScope(a.warehouseId));
    if (low.length > 0) list.push({ to: '/dept/warehouse?m=wh_alerts', msg: `${low.length} dòng dưới ngưỡng Min/điểm đặt.` });
    const slowCount = slow.filter((s) => inScope(s.warehouseId)).length;
    if (slowCount > 0) list.push({ to: '/dept/warehouse?m=wh_slow', msg: `${slowCount} dòng tồn lâu quá 90 ngày.` });
    const oldTransit = docs.filter((d) => d.docType === 'TRANSFER' && d.status === 'IN_TRANSIT' && inScope(docWarehouse(d)) && Date.now() - new Date(d.createdAt).getTime() > 7 * 86_400_000);
    if (oldTransit.length > 0) list.push({ to: '/dept/warehouse?m=wh_in_transit', msg: `${oldTransit.length} điều chuyển quá 7 ngày chưa nhận.` });
    const openCounts = counts.filter((c) => c.status === 'COUNTING');
    if (openCounts.length > 0) list.push({ to: '/dept/warehouse?m=wh_count', msg: `${openCounts.length} đợt kiểm kê chưa đóng.` });
    const expiring = holds.filter((h) => h.status === 'HELD' && h.expiresAt && inScope(h.warehouseId) && new Date(h.expiresAt).getTime() - Date.now() < 3 * 86_400_000);
    if (expiring.length > 0) list.push({ to: '/dept/warehouse?m=wh_reservation', msg: `${expiring.length} giữ hàng sắp hết hạn (≤ 3 ngày).` });
    return list.slice(0, 8);
  }, [balances, alerts, docs, counts, holds, slow, warehouseId]);

  const kpi = [
    { label: 'SKU đang tồn', value: sku },
    { label: 'Cảnh báo tồn', value: warnCount },
    { label: 'Phiếu chờ', value: pending },
    { label: 'Đang vận chuyển', value: transit },
    { label: 'Chênh lệch chưa xử lý', value: variance },
  ];

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <Header deptKey={deptKey} title="Tổng quan kho vận" subtitle="toàn cảnh trong 20 giây" />
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
          className="px-4 pr-9 py-2.5 border border-gray-200 rounded-xl bg-white text-sm outline-none shadow-sm appearance-none">
          <option value="">Tất cả kho</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      {loading ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {kpi.map((s) => (
              <Card key={s.label} className="p-4">
                <p className="text-xl font-black text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-500">{s.label}</p>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 font-bold text-gray-700 text-sm">Tình hình các kho</div>
            <div className="overflow-x-auto">
              <table className="wh-table w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="py-1.5 px-5">Kho</th>
                    <th className="py-1.5 px-4 text-right">SKU</th>
                    <th className="py-1.5 px-4 text-right">Chờ nhập</th>
                    <th className="py-1.5 px-4 text-right">Chờ xuất</th>
                    <th className="py-1.5 px-4 text-right">Cảnh báo</th>
                    <th className="py-1.5 px-5">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {perWarehouse.length === 0 && (
                    <tr><td colSpan={6} className="py-8 text-center text-gray-400">Chưa có kho nào trong phạm vi.</td></tr>
                  )}
                  {perWarehouse.map((w) => (
                    <tr key={w.id} className="hover:bg-gray-50/70">
                      <td className="py-1.5 px-5 font-semibold text-gray-800">{w.name}</td>
                      <td className="py-1.5 px-4 text-right text-gray-600">{w.sku}</td>
                      <td className="py-1.5 px-4 text-right text-gray-600">{w.waitIn}</td>
                      <td className="py-1.5 px-4 text-right text-gray-600">{w.waitOut}</td>
                      <td className="py-1.5 px-4 text-right font-bold text-gray-800">{w.warn}</td>
                      <td className="py-1.5 px-5">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${w.state === 'Bình thường' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : w.state === 'Cần chú ý' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                          {w.state}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-bold text-gray-800 mb-3 text-sm uppercase tracking-wider flex items-center gap-2">
              <TriangleAlert size={15} /> Cảnh báo quản trị ({adminWarnings.length})
            </h2>
            {adminWarnings.length === 0 ? (
              <p className="text-sm text-gray-400">Mọi kho đang ổn định.</p>
            ) : (
              <ul className="space-y-2">
                {adminWarnings.map((w, i) => (
                  <li key={i}>
                    <Link to={w.to} className="flex items-start gap-2 text-sm text-gray-700 hover:text-amber-700">
                      <TriangleAlert size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />{w.msg}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-bold text-gray-800 mb-3 text-sm uppercase tracking-wider">Hiệu suất xử lý (30 ngày)</h2>
            {handlers.length === 0 ? (
              <p className="text-sm text-gray-400">Chưa có số liệu xử lý.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="wh-table w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 uppercase">
                      <th className="py-2 pr-2">Nhân viên</th>
                      <th className="py-2 pr-2 text-right">Thao tác</th>
                      <th className="py-2 pr-2 text-right">Phiếu tạo</th>
                      <th className="py-2 text-right">Ngày hoạt động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {handlers.map((h) => (
                      <tr key={h.name} className="hover:bg-gray-50/70">
                        <td className="py-2 pr-2 font-medium text-gray-700 truncate max-w-[180px]">{h.name}</td>
                        <td className="py-2 pr-2 text-right font-black text-gray-800">{h.ops}</td>
                        <td className="py-2 pr-2 text-right text-gray-600">{h.docs}</td>
                        <td className="py-2 text-right text-gray-600">{h.days}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-3">Chỉ số liệu nghiệp vụ kiểm chứng được, không dùng chấm điểm nhân sự.</p>
          </Card>
        </>
      )}
    </div>
  );
}

function docWarehouse(d: { warehouseId?: string | null; sourceWarehouseId?: string | null; destWarehouseId?: string | null }): string {
  return d.warehouseId || d.sourceWarehouseId || d.destWarehouseId || '';
}

function countLines(
  balances: { productId: string; warehouseId: string; available: number }[],
  warehouseId: string, kind: 'sku' | 'out'
): number {
  const lines = warehouseId ? balances.filter((b) => b.warehouseId === warehouseId) : balances;
  if (kind === 'sku') return new Set(lines.map((b) => b.productId)).size;
  return lines.filter((b) => Number(b.available) <= 0).length;
}
